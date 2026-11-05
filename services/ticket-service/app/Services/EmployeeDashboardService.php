<?php

namespace App\Services;

use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

class EmployeeDashboardService
{
    protected SLAService $slaService;

    public function __construct(SLAService $slaService)
    {
        $this->slaService = $slaService;
    }

    /**
     * Retrieve Employee dual role dashboard separating assigned workload and requested tickets.
     * Enforces graceful partial failure isolation (AC-8, AC-2.8).
     */
    public function getEmployeeDashboard(int $employeeId, int $userId, bool $forceRefresh = false): array
    {
        $assigned = null;
        $requested = null;
        $partialErrors = [];

        // 1. Fetch Assigned Technician Workload
        try {
            $assigned = $this->getAssignedWorkload($employeeId);
        } catch (\Throwable $e) {
            Log::error("EmployeeDashboard assigned workload error for employee {$employeeId}: " . $e->getMessage());
            $partialErrors[] = [
                'section' => 'assigned',
                'message' => 'Failed to retrieve assigned workload: ' . $e->getMessage(),
            ];
        }

        // 2. Fetch Requested / Submitted Tickets
        try {
            $requested = $this->getRequestedWorkload($userId, $employeeId);
        } catch (\Throwable $e) {
            Log::error("EmployeeDashboard requested workload error for user {$userId}/emp {$employeeId}: " . $e->getMessage());
            $partialErrors[] = [
                'section' => 'requested',
                'message' => 'Failed to retrieve requested workload: ' . $e->getMessage(),
            ];
        }

        return [
            'assigned' => $assigned,
            'requested' => $requested,
            'partial_errors' => $partialErrors,
        ];
    }

    /**
     * Compute assigned technician workload: status breakdown, SLA risk, and recent tickets.
     */
    public function getAssignedWorkload(int $employeeId): array
    {
        $tickets = DB::table('tickets as t')
            ->leftJoin('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->leftJoin('ticket_priorities as tp', 'tp.priority_ID', '=', 't.priority_ID')
            ->select(
                't.ticket_ID as ticket_id',
                't.ticket_number',
                't.title',
                't.assigned_to',
                't.ticket_status_ID',
                'ts.status_name',
                'tp.priority_name as priority',
                't.resolution_due_at',
                't.resolved_at',
                't.closed_at',
                't.created_at',
                't.sla_status'
            )
            ->where('t.assigned_to', $employeeId)
            ->orderByDesc('t.created_at')
            ->get();

        $statusBreakdown = [
            'open' => 0,
            'in_progress' => 0,
            'on_hold' => 0,
            'resolved' => 0,
            'closed' => 0,
        ];

        $slaRiskBreakdown = [
            'within_sla' => 0,
            'near_breach' => 0,
            'breached' => 0,
        ];

        $recentList = [];

        foreach ($tickets as $t) {
            $statusName = strtolower(trim((string) ($t->status_name ?? '')));
            if (in_array($statusName, ['open', 'pending assignment', 'pending_assignment'], true)) {
                $statusBreakdown['open']++;
            } elseif (in_array($statusName, ['in progress', 'in_progress', 'assigned', 'escalated'], true)) {
                $statusBreakdown['in_progress']++;
            } elseif (in_array($statusName, ['on hold', 'on_hold', 'paused'], true) || (int) $t->ticket_status_ID === 11) {
                $statusBreakdown['on_hold']++;
            } elseif ($statusName === 'resolved') {
                $statusBreakdown['resolved']++;
            } elseif ($statusName === 'closed') {
                $statusBreakdown['closed']++;
            }

            // SLA risk classification for active unresolved tickets
            $isUnresolved = !in_array($statusName, ['resolved', 'closed', 'cancelled', 'discarded'], true);
            $risk = 'within_sla';
            if ($isUnresolved) {
                $risk = $this->slaService->classifyTicketRisk($t);
                if (isset($slaRiskBreakdown[$risk])) {
                    $slaRiskBreakdown[$risk]++;
                }
            }

            if (count($recentList) < 10) {
                $recentList[] = [
                    'ticket_id' => (int) $t->ticket_id,
                    'ticket_number' => $t->ticket_number,
                    'title' => $t->title,
                    'priority' => $t->priority ?? 'Low',
                    'status' => $t->status_name ?? 'Open',
                    'resolution_due_at' => $t->resolution_due_at ? Carbon::parse($t->resolution_due_at)->toIso8601String() : null,
                    'sla_risk_indicator' => $risk,
                ];
            }
        }

        return [
            'total_assigned' => $tickets->count(),
            'status_breakdown' => $statusBreakdown,
            'sla_risk' => $slaRiskBreakdown,
            'recent_tickets' => $recentList,
        ];
    }

    /**
     * Compute requested workload: submitted tickets, auto close countdown, and reopened indicators.
     */
    public function getRequestedWorkload(int $userId, int $employeeId): array
    {
        $ticketsQuery = DB::table('tickets as t')
            ->leftJoin('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->leftJoin('employees as e', 'e.emp_id', '=', 't.assigned_to')
            ->select(
                't.ticket_ID as ticket_id',
                't.ticket_number',
                't.title',
                't.created_by',
                't.requested_by',
                't.ticket_status_ID',
                'ts.status_name',
                't.assigned_to',
                DB::raw("TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))) as technician_name"),
                't.resolved_at',
                't.closed_at',
                't.created_at'
            );



        // Scope strictly to tickets requested by this employee (requested_by) or created by (created_by)
        $ticketsQuery->where(function ($q) use ($employeeId, $userId) {
            $q->where('t.requested_by', $employeeId);
            if ($userId > 0) {
                $q->orWhere('t.created_by', $userId);
            }
        });

        $tickets = $ticketsQuery->orderByDesc('t.created_at')->get();

        $statusBreakdown = [
            'open' => 0,
            'in_progress' => 0,
            'on_hold' => 0,
            'resolved' => 0,
            'closed' => 0,
        ];

        $autoClosePendingCount = 0;
        $reopenedCount = 0;
        $recentList = [];

        $autoCloseWindowDays = 2; // standard policy default

        foreach ($tickets as $t) {
            $statusName = strtolower(trim((string) ($t->status_name ?? '')));
            if (in_array($statusName, ['open', 'pending assignment', 'pending_assignment'], true)) {
                $statusBreakdown['open']++;
            } elseif (in_array($statusName, ['in progress', 'in_progress', 'assigned', 'escalated'], true)) {
                $statusBreakdown['in_progress']++;
            } elseif (in_array($statusName, ['on hold', 'on_hold', 'paused'], true) || (int) $t->ticket_status_ID === 11) {
                $statusBreakdown['on_hold']++;
            } elseif ($statusName === 'resolved') {
                $statusBreakdown['resolved']++;
            } elseif ($statusName === 'closed') {
                $statusBreakdown['closed']++;
            }

            // Auto-close check
            $autoCloseCountdownSeconds = null;
            $isAutoClosePending = false;

            if ($statusName === 'resolved' && empty($t->closed_at)) {
                $resolvedAt = !empty($t->resolved_at) ? Carbon::parse($t->resolved_at) : null;
                $autoCloseAt = null;

                if (!empty($t->auto_close_at)) {
                    $autoCloseAt = Carbon::parse($t->auto_close_at);
                } elseif ($resolvedAt) {
                    $autoCloseAt = $resolvedAt->copy()->addDays($autoCloseWindowDays);
                }

                if ($autoCloseAt && $autoCloseAt->isFuture()) {
                    $isAutoClosePending = true;
                    $autoClosePendingCount++;
                    $autoCloseCountdownSeconds = max(0, now()->diffInSeconds($autoCloseAt, false));
                }
            }

            // Reopened check
            $isReopened = false;
            if ($statusName === 'reopened' || (int) $t->ticket_status_ID === 5 || !empty($t->reopened_at)) {
                $isReopened = true;
                $reopenedCount++;
            }

            if (count($recentList) < 10) {
                $recentList[] = [
                    'ticket_id' => (int) $t->ticket_id,
                    'ticket_number' => $t->ticket_number,
                    'title' => $t->title,
                    'status' => $t->status_name ?? 'Open',
                    'assigned_technician_name' => !empty($t->technician_name) ? $t->technician_name : null,
                    'auto_close_countdown_seconds' => $autoCloseCountdownSeconds,
                    'is_reopened' => $isReopened,
                ];
            }
        }

        return [
            'total_requested' => $tickets->count(),
            'status_breakdown' => $statusBreakdown,
            'auto_close_pending_count' => $autoClosePendingCount,
            'reopened_count' => $reopenedCount,
            'recent_tickets' => $recentList,
        ];
    }
}
