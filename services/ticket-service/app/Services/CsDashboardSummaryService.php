<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Per agent summary for the CS "My Dashboard" (spec 0028 AC-12).
 *
 * Scope: the signed in CS agent's own activity inside their branch triage queue.
 *  - Queued: unassigned, unfinished tickets in the branch waiting for review.
 *  - Monitored: unfinished tickets this agent is assigned to, owns in progress, or delegated to someone.
 *  - Needs attention: monitored or queued tickets that are Breached or At Risk (existing SLA classification),
 *    plus reassignment requests waiting for a decision.
 * Each section is computed on its own so one failing query never blanks the rest of the dashboard.
 * The summary is read only; it never changes a ticket.
 */
class CsDashboardSummaryService
{
    /** Resolved, Closed and Discarded tickets no longer need triage. */
    private const FINISHED_STATUS_IDS = \App\Support\TicketStatusBuckets::FINISHED_IDS;

    /** Resolved tickets are still tracked until the customer closes them, so only Closed and Discarded drop out. */
    private const CLOSED_STATUS_IDS = \App\Support\TicketStatusBuckets::CLOSED_IDS;
    private const RESOLVED_STATUS_ID = 3;

    public function __construct(protected SLAService $slaService)
    {
    }

    public function getSummary($user, int $limit = 10): array
    {
        $agentId = (int) ($user->emp_id ?? $user->id ?? 0);
        $branchId = isset($user->branch_id) && $user->branch_id !== null ? (int) $user->branch_id : null;
        // Same branch rules as every other dashboard: the main branch also owns tickets saved with no
        // branch (NULL, '' or a legacy 'main'), which a plain `branch_id = 1` comparison would hide.
        $branch = $branchId !== null ? app(TicketDashboardService::class)->resolveBranchScope($user) : null;

        $partialErrors = [];
        $queued = $this->section('queued_tickets', $partialErrors, fn () => $this->queued($branch, $limit));
        $monitoredRows = null;
        $assigned = $this->section('assigned_monitored', $partialErrors, function () use ($agentId, $branch, &$monitoredRows) {
            $monitoredRows = $this->monitoredTickets($agentId, $branch);
            return $this->monitoredSummary($monitoredRows);
        });
        $pending = $this->section('pending_reassignments', $partialErrors, fn () => $this->pendingReassignments($branch));

        $workload = null;
        if ($monitoredRows !== null) {
            $workload = $this->section('workload_metrics', $partialErrors, fn () => $this->workload($monitoredRows, $pending));
        } else {
            $partialErrors[] = ['section' => 'workload_metrics', 'message' => 'Depends on assigned and monitored tickets, which could not be loaded.'];
        }

        $attention = $this->section('needs_attention', $partialErrors, function () use ($queued, $monitoredRows, $pending, $limit) {
            return $this->needsAttention($queued['items'] ?? [], $monitoredRows ?? [], $pending['items'] ?? [], $limit);
        });

        return [
            'status' => 'success',
            'scope' => ['agent_id' => $agentId, 'branch_id' => $branchId],
            'queued_tickets' => $queued,
            'assigned_monitored' => $assigned,
            'workload_metrics' => $workload,
            'needs_attention' => $attention,
            'pending_reassignments' => $pending ? ['count' => $pending['count']] : null,
            'partial_errors' => $partialErrors,
            'generated_at' => now()->toIso8601String(),
        ];
    }

    /** Run one section; on failure record it and return null so the rest still renders. */
    private function section(string $name, array &$partialErrors, callable $callback)
    {
        try {
            return $callback();
        } catch (\Throwable $e) {
            Log::warning("CS dashboard section {$name} failed: " . $e->getMessage());
            $partialErrors[] = ['section' => $name, 'message' => 'This section could not be loaded.'];
            return null;
        }
    }

    private function ticketBase(?object $branch, array $excludedStatusIds = self::FINISHED_STATUS_IDS)
    {
        $q = DB::table('tickets as t')
            ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->leftJoin('ticket_priorities as tp', 'tp.priority_ID', '=', 't.priority_ID')
            ->leftJoin('clients as c', 'c.id', '=', 't.created_by')
            ->leftJoin('employees as req', 'req.emp_id', '=', 't.requested_by')
            ->whereNotIn('t.ticket_status_ID', $excludedStatusIds)
            ->select(
                't.*',
                'ts.status_name',
                'tp.priority_name',
                'c.client_name',
                DB::raw("TRIM(CONCAT(COALESCE(req.first_name, ''), ' ', COALESCE(req.last_name, ''))) as requester_name")
            );

        if ($branch !== null) {
            app(TicketDashboardService::class)->applyBranchTicketFilter($q, $branch);
        }

        return $q;
    }

    private function queued(?object $branch, int $limit): array
    {
        $base = $this->ticketBase($branch)->whereNull('t.assigned_to');
        $count = (clone $base)->count();
        $items = (clone $base)->orderBy('t.created_at')->limit($limit)->get()
            ->map(fn ($row) => $this->ticketItem($row))->values()->all();

        return ['count' => $count, 'items' => $items];
    }

    /** Unfinished tickets this agent is assigned to, owns in progress, or delegated to an employee. */
    private function monitoredTickets(int $agentId, ?object $branch)
    {
        $delegated = DB::table('ticket_assignments')->where('assigned_by', $agentId)->select('ticket_ID');

        return $this->ticketBase($branch, self::CLOSED_STATUS_IDS)
            ->where(function ($q) use ($agentId, $delegated) {
                $q->where('t.assigned_to', $agentId)
                    ->orWhere('t.in_progress_owner', $agentId)
                    ->orWhereIn('t.ticket_ID', $delegated);
            })
            ->orderByDesc('t.updated_at')
            ->get();
    }

    private function monitoredSummary($rows): array
    {
        $byStatus = [];
        foreach ($rows as $row) {
            $byStatus[$row->status_name] = ($byStatus[$row->status_name] ?? 0) + 1;
        }
        ksort($byStatus);

        return ['count' => $rows->count(), 'by_status' => $byStatus];
    }

    protected function pendingReassignments(?object $branch): array
    {
        $q = DB::table('reassignment_requests as rr')
            ->join('tickets as t', 't.ticket_ID', '=', 'rr.ticket_id')
            ->leftJoin('employees as e', 'e.emp_id', '=', 'rr.employee_id')
            ->where('rr.status', 'pending')
            ->select(
                'rr.request_id', 'rr.ticket_id', 'rr.reason', 'rr.requested_at',
                't.ticket_number', 't.title',
                DB::raw("TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))) as requested_by_name")
            );
        if ($branch !== null) {
            app(TicketDashboardService::class)->applyBranchTicketFilter($q, $branch);
        }

        $rows = $q->orderBy('rr.requested_at')->get();

        return [
            'count' => $rows->count(),
            'items' => $rows->map(fn ($r) => [
                'ticket_ID' => (int) $r->ticket_id,
                'ref' => TicketNumberGeneratorService::refFor($r->ticket_id, $r->ticket_number ?? null),
                'title' => $r->title,
                'reason' => 'Reassignment pending',
                'detail' => trim(($r->requested_by_name ?: 'An employee') . ': ' . ($r->reason ?? '')),
                'customer' => $r->requested_by_name ?: 'Service Department',
                'status' => 'Pending Reassignment',
                'priority' => 'High',
                'requested_at' => $r->requested_at,
            ])->values()->all(),
        ];
    }

    private function workload($monitoredRows, ?array $pending): array
    {
        $atRisk = 0;
        $breached = 0;
        $active = 0;
        foreach ($monitoredRows as $row) {
            // Resolved tickets are tracked but no longer carry SLA pressure or workload.
            if ((int) $row->ticket_status_ID === self::RESOLVED_STATUS_ID) {
                continue;
            }
            $active++;
            $sla = $this->slaService->computeTicketSlaMetrics($row);
            if (!empty($sla['is_breached']) || ($sla['status'] ?? '') === 'Breached') {
                $breached++;
            } elseif (!empty($sla['is_at_risk']) || ($sla['status'] ?? '') === 'At Risk') {
                $atRisk++;
            }
        }

        return [
            'active_tickets' => $active,
            'at_risk' => $atRisk,
            'breached' => $breached,
            'pending_reassignments' => $pending['count'] ?? 0,
        ];
    }

    private function needsAttention(array $queuedItems, $monitoredRows, array $pendingItems, int $limit): array
    {
        $items = [];
        $seen = [];

        $consider = function ($row) use (&$items, &$seen) {
            $id = (int) $row->ticket_ID;
            if (isset($seen[$id])) {
                return;
            }
            $sla = $this->slaService->computeTicketSlaMetrics($row);
            $state = !empty($sla['is_breached']) || ($sla['status'] ?? '') === 'Breached'
                ? 'Breached'
                : (!empty($sla['is_at_risk']) || ($sla['status'] ?? '') === 'At Risk' ? 'At Risk' : null);
            if ($state === null) {
                return;
            }
            $seen[$id] = true;
            $items[] = $this->ticketItem($row) + ['reason' => $state, 'detail' => null];
        };

        foreach ($monitoredRows as $row) {
            if ((int) $row->ticket_status_ID !== self::RESOLVED_STATUS_ID) {
                $consider($row);
            }
        }
        // Queued rows were already shaped as items; fetch raw rows again so the same SLA rules apply.
        $queuedIds = array_column($queuedItems, 'ticket_ID');
        if (!empty($queuedIds)) {
            foreach ($this->ticketBase(null)->whereIn('t.ticket_ID', $queuedIds)->get() as $row) {
                $consider($row);
            }
        }

        // Breached first, then at risk.
        usort($items, fn ($a, $b) => ($a['reason'] === 'Breached' ? 0 : 1) <=> ($b['reason'] === 'Breached' ? 0 : 1));

        $combined = array_merge($items, $pendingItems);

        return [
            'count' => count($combined),
            'items' => array_slice($combined, 0, $limit),
        ];
    }

    private function ticketItem($row): array
    {
        $sla = $this->slaService->computeTicketSlaMetrics($row);

        return [
            'ticket_ID' => (int) $row->ticket_ID,
            'ref' => TicketNumberGeneratorService::refFor($row->ticket_ID, $row->ticket_number ?? null),
            'title' => $row->title,
            'customer' => (bool) ($row->is_internal ?? false)
                ? (($row->requester_name ?? '') !== '' ? $row->requester_name : 'Internal Requester')
                : ($row->client_name ?: 'Unknown Customer'),
            'status' => $row->status_name,
            'priority' => $row->priority_name,
            'sla_status' => $sla['status'] ?? 'On Track',
            'due_at' => $sla['due_at'] ?? null,
            'created_at' => $row->created_at,
        ];
    }
}
