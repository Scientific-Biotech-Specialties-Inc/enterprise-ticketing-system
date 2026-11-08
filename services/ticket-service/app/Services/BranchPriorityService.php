<?php

namespace App\Services;

use App\Events\BranchPriorityChanged;
use App\Events\TicketChanged;
use App\Exceptions\BranchPriorityException;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Branch-specific priority levels and SLA implications.
 *
 * Resolution order for a ticket in a branch:
 *   1. branch override for the ticket's priority (this service)
 *   2. department / category SLA rules, then the default SLA policy (SLAService)
 *
 * SLA change policy (DECISION): editing or removing an override affects NEW
 * tickets only. Due dates are stamped on a ticket at creation and are never
 * recalculated, so SLA commitments made to existing tickets are not silently
 * tightened (which would manufacture breaches) or loosened (which would hide
 * them). This keeps SLA reporting and the audit trail truthful.
 */
class BranchPriorityService
{
    /** System-wide default SLA targets (minutes) by lower-cased priority name. */
    public const SYSTEM_DEFAULT_SLAS = [
        'critical' => ['responseTimeLimit' => 15, 'resolutionTimeLimit' => 240],
        'high' => ['responseTimeLimit' => 30, 'resolutionTimeLimit' => 480],
        'medium' => ['responseTimeLimit' => 120, 'resolutionTimeLimit' => 1440],
        'low' => ['responseTimeLimit' => 240, 'resolutionTimeLimit' => 4320],
    ];

    public const FALLBACK_SLA = ['responseTimeLimit' => 60, 'resolutionTimeLimit' => 1440];

    private const CLOSED_STATUSES = ['closed', 'cancelled', 'discarded', 'resolved'];

    public function __construct(private readonly TicketCacheService $cacheService)
    {
    }

    /**
     * Exposed to the frontend so tooltip text always matches real behaviour.
     */
    public static function slaChangePolicy(): array
    {
        return [
            'mode' => 'new_tickets_only',
            'recalculatesExistingOpenTickets' => false,
            'tooltip' => 'Changes to a branch SLA apply to tickets created after the change. '
                . 'Existing open tickets keep the response and resolution deadlines they were created with.',
        ];
    }

    public function findBranch(string $branchId): ?object
    {
        if ($branchId === 'system' || $branchId === 'all' || $branchId === '0' || empty($branchId)) {
            return (object) [
                'id' => 0,
                'slug' => 'system',
                'name' => 'System-wide (Global)',
                'code' => 'SYS',
                'region' => 'All Facilities',
                'is_active' => true,
            ];
        }

        return DB::table('branches')->where('slug', $branchId)->where('is_active', true)->first();
    }

    /**
     * Branch view: every system priority, replaced by the branch override
     * when one exists, otherwise inherited from the system-wide default.
     */
    public function listForBranch(string $branchId): array
    {
        $branch = $this->requireBranch($branchId);

        $priorities = DB::table('ticket_priorities')->orderBy('priority_ID')->get();
        $overrides = DB::table('branch_priority_overrides')
            ->where('branch_id', $branch->slug)
            ->get()
            ->keyBy('base_priority_id');

        $counts = $this->ticketCounts($overrides->pluck('id')->all());

        $items = $priorities->map(function ($priority) use ($branch, $overrides, $counts) {
            $default = $this->systemDefaultFor($priority);
            $override = $overrides->get($priority->priority_ID);

            $item = [
                'id' => $override?->id,
                'key' => $override ? "override-{$override->id}" : "inherited-{$branch->slug}-{$priority->priority_ID}",
                'branchId' => $branch->slug,
                'basePriorityId' => (int) $priority->priority_ID,
                'name' => $override?->name ?? $priority->priority_name,
                'color' => $override?->color ?? $priority->color_code,
                'responseTimeLimit' => $override ? (int) $override->response_time_limit : $default['responseTimeLimit'],
                'resolutionTimeLimit' => $override ? (int) $override->resolution_time_limit : $default['resolutionTimeLimit'],
                'isInherited' => $override === null,
                'systemDefault' => [
                    'name' => $priority->priority_name,
                    'color' => $priority->color_code,
                    'responseTimeLimit' => $default['responseTimeLimit'],
                    'resolutionTimeLimit' => $default['resolutionTimeLimit'],
                ],
                'activeTicketCount' => 0,
                'referencedTicketCount' => 0,
                'inUse' => false,
                'updatedAt' => $override?->updated_at,
            ];

            if ($override) {
                $c = $counts[$override->id] ?? ['open' => 0, 'total' => 0];
                $item['activeTicketCount'] = $c['open'];
                $item['referencedTicketCount'] = $c['total'];
                $item['inUse'] = $c['total'] > 0;
            }

            return $item;
        })->values()->all();

        return [
            'branch' => ['id' => $branch->slug, 'name' => $branch->name, 'code' => $branch->code],
            'priorities' => $items,
            'slaChangePolicy' => self::slaChangePolicy(),
        ];
    }

    /**
     * Override lookup used when assigning SLA to a new ticket.
     */
    public function resolveOverride(?string $branchId, int $basePriorityId): ?object
    {
        if (!$branchId) {
            return null;
        }

        return DB::table('branch_priority_overrides')
            ->where('branch_id', $branchId)
            ->where('base_priority_id', $basePriorityId)
            ->first();
    }

    public function create(string $branchId, array $data, $user): array
    {
        $branch = $this->requireBranch($branchId);
        $basePriority = DB::table('ticket_priorities')->where('priority_ID', $data['base_priority_id'])->first();
        if (!$basePriority) {
            throw new BranchPriorityException('The selected system priority does not exist.', 422);
        }

        try {
            $result = DB::transaction(function () use ($branch, $basePriority, $data, $user) {
                // Serialize concurrent creates for the same branch + priority.
                DB::table('ticket_priorities')->where('priority_ID', $basePriority->priority_ID)->lockForUpdate()->first();

                $exists = DB::table('branch_priority_overrides')
                    ->where('branch_id', $branch->slug)
                    ->where('base_priority_id', $basePriority->priority_ID)
                    ->exists();
                if ($exists) {
                    throw new BranchPriorityException(
                        "'{$basePriority->priority_name}' already has a branch-specific override for {$branch->name}.",
                        409
                    );
                }

                $actorId = $this->actorId($user);
                $id = DB::table('branch_priority_overrides')->insertGetId([
                    'branch_id' => $branch->slug,
                    'base_priority_id' => $basePriority->priority_ID,
                    'name' => $data['name'],
                    'color' => $data['color'] ?? $basePriority->color_code,
                    'response_time_limit' => (int) $data['response_time_limit'],
                    'resolution_time_limit' => (int) $data['resolution_time_limit'],
                    'created_by' => $actorId,
                    'updated_by' => $actorId,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                $after = $this->snapshot(DB::table('branch_priority_overrides')->where('id', $id)->first());
                $this->audit('config_create', $user, $branch, $basePriority->priority_name, null, $after,
                    "Created branch priority '{$after['name']}' for {$branch->name} (Response: {$after['response_time_limit']}m, Resolution: {$after['resolution_time_limit']}m)");

                return [$id, $after];
            });
        } catch (QueryException $e) {
            if (($e->errorInfo[0] ?? null) === '23000') {
                throw new BranchPriorityException('A branch-specific override already exists for this priority.', 409);
            }
            throw $e;
        }

        [$id, $after] = $result;
        $this->publish(BranchPriorityChanged::ACTION_CREATED, $branch->slug, null, $after, $user);

        return $after + ['id' => $id];
    }

    public function update(string $branchId, int $id, array $data, $user): array
    {
        $branch = $this->requireBranch($branchId);

        [$before, $after, $priorityName] = DB::transaction(function () use ($branch, $id, $data, $user) {
            // Scoped by branch to prevent cross-branch (IDOR) modification.
            $row = DB::table('branch_priority_overrides')
                ->where('id', $id)
                ->where('branch_id', $branch->slug)
                ->lockForUpdate()
                ->first();
            if (!$row) {
                throw new BranchPriorityException('Branch priority override not found.', 404);
            }

            $before = $this->snapshot($row);
            DB::table('branch_priority_overrides')->where('id', $id)->update([
                'name' => $data['name'],
                'color' => $data['color'] ?? $row->color,
                'response_time_limit' => (int) $data['response_time_limit'],
                'resolution_time_limit' => (int) $data['resolution_time_limit'],
                'updated_by' => $this->actorId($user),
                'updated_at' => now(),
            ]);

            $after = $this->snapshot(DB::table('branch_priority_overrides')->where('id', $id)->first());
            $priorityName = DB::table('ticket_priorities')->where('priority_ID', $row->base_priority_id)->value('priority_name');
            $this->audit('config_update', $user, $branch, $priorityName, $before, $after,
                "Updated branch priority '{$before['name']}' for {$branch->name} (Response: {$before['response_time_limit']}m → {$after['response_time_limit']}m, Resolution: {$before['resolution_time_limit']}m → {$after['resolution_time_limit']}m). Applies to new tickets only.");

            return [$before, $after, $priorityName];
        });

        $this->publish(BranchPriorityChanged::ACTION_UPDATED, $branch->slug, $before, $after, $user);

        return $after + ['id' => $id];
    }

    public function remove(string $branchId, int $id, $user): array
    {
        $branch = $this->requireBranch($branchId);

        try {
            $before = DB::transaction(function () use ($branch, $id, $user) {
                $row = DB::table('branch_priority_overrides')
                    ->where('id', $id)
                    ->where('branch_id', $branch->slug)
                    ->lockForUpdate()
                    ->first();
                if (!$row) {
                    throw new BranchPriorityException('Branch priority override not found.', 404);
                }

                $referenced = DB::table('tickets')
                    ->where('branch_priority_override_id', $id)
                    ->where('branch_id', $branch->slug)
                    ->count();
                if ($referenced > 0) {
                    throw new BranchPriorityException(
                        "Cannot remove '{$row->name}': it is referenced by {$referenced} ticket(s) in {$branch->name}.",
                        409,
                        ['code' => 'BRANCH_PRIORITY_IN_USE', 'referenced_ticket_count' => $referenced]
                    );
                }

                $before = $this->snapshot($row);
                $priorityName = DB::table('ticket_priorities')->where('priority_ID', $row->base_priority_id)->value('priority_name');
                DB::table('branch_priority_overrides')->where('id', $id)->delete();

                $this->audit('config_delete', $user, $branch, $priorityName, $before, null,
                    "Removed branch priority '{$before['name']}' from {$branch->name}; branch now inherits the system-wide default.");

                return $before;
            });
        } catch (QueryException $e) {
            // The tickets FK is RESTRICT: a ticket slipped in after our check.
            if (($e->errorInfo[0] ?? null) === '23000') {
                throw new BranchPriorityException(
                    'Cannot remove this priority: it is referenced by tickets in this branch.',
                    409,
                    ['code' => 'BRANCH_PRIORITY_IN_USE']
                );
            }
            throw $e;
        }

        $this->publish(BranchPriorityChanged::ACTION_REMOVED, $branch->slug, $before, null, $user);

        return $before;
    }

    private function requireBranch(string $branchId): object
    {
        $branch = $this->findBranch($branchId);
        if (!$branch) {
            throw new BranchPriorityException('Branch not found.', 404);
        }

        return $branch;
    }

    private function systemDefaultFor(object $priority): array
    {
        return self::SYSTEM_DEFAULT_SLAS[strtolower(trim($priority->priority_name))] ?? self::FALLBACK_SLA;
    }

    /**
     * @param  array<int>  $overrideIds
     * @return array<int, array{open:int,total:int}>
     */
    private function ticketCounts(array $overrideIds): array
    {
        if (empty($overrideIds)) {
            return [];
        }

        $rows = DB::table('tickets as t')
            ->leftJoin('ticket_statuses as s', 's.ticket_status_ID', '=', 't.ticket_status_ID')
            ->whereIn('t.branch_priority_override_id', $overrideIds)
            ->select('t.branch_priority_override_id as oid', 's.status_name')
            ->get();

        $counts = [];
        foreach ($rows as $row) {
            $counts[$row->oid] ??= ['open' => 0, 'total' => 0];
            $counts[$row->oid]['total']++;
            if (!in_array(strtolower((string) $row->status_name), self::CLOSED_STATUSES, true)) {
                $counts[$row->oid]['open']++;
            }
        }

        return $counts;
    }

    private function snapshot(object $row): array
    {
        return [
            'name' => $row->name,
            'color' => $row->color,
            'response_time_limit' => (int) $row->response_time_limit,
            'resolution_time_limit' => (int) $row->resolution_time_limit,
        ];
    }

    private function actorId($user): ?int
    {
        $id = $user->emp_id ?? $user->id ?? null;

        return $id !== null ? (int) $id : null;
    }

    private function audit(string $type, $user, object $branch, ?string $priorityName, ?array $before, ?array $after, string $text): void
    {
        $actorId = $this->actorId($user);
        $actorName = trim(($user->first_name ?? '') . ' ' . ($user->last_name ?? ''));

        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => $type,
            'action_by_ID' => $actorId,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'Branch Priority Configuration',
                'target' => "{$branch->name} / " . ($priorityName ?? 'priority'),
                'text' => $text,
                'branch_id' => $branch->slug,
                'branch_name' => $branch->name,
                'acting_admin' => ['id' => $actorId, 'name' => $actorName ?: null, 'role' => $user->role ?? 'superadmin'],
                'before' => $before,
                'after' => $after,
            ]),
            'created_at' => now(),
        ]);
    }

    /**
     * Publish to the event bus. Broadcast failures never fail the request:
     * the change is already committed and clients also re-read on load.
     */
    private function publish(string $action, string $branchId, ?array $before, ?array $after, $user): void
    {
        try {
            $this->cacheService->clearTicketCaches();
        } catch (\Throwable $e) {
            Log::warning('Branch priority cache invalidation failed: ' . $e->getMessage());
        }

        try {
            event(new BranchPriorityChanged($action, $branchId, $before, $after, $this->actorId($user), now()->toIso8601String()));
            event(new TicketChanged(['type' => 'config', 'section' => 'branch-priority', 'branch_id' => $branchId]));
        } catch (\Throwable $e) {
            Log::warning('Broadcasting BranchPriorityChanged failed: ' . $e->getMessage());
        }
    }
}
