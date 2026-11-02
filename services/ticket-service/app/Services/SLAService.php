<?php

namespace App\Services;

use App\Repositories\SLARepositoryInterface;
use App\Services\BranchPriorityService;
use App\Services\TicketConfigurationService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class SLAService
{
    /**
     * Reopen SLA calculation mode flag:
     * - 'reset': Start fresh resolution window from the moment of reopen (now() + rule resolution minutes).
     * - 'remaining': Continue remaining time based on previous deadline.
     */
    public const REOPEN_SLA_MODE_RESET = 'reset';
    public const REOPEN_SLA_MODE_REMAINING = 'remaining';
    public const REOPEN_SLA_MODE = self::REOPEN_SLA_MODE_RESET;

    protected $slaRepository;

    public function __construct(SLARepositoryInterface $slaRepository)
    {
        $this->slaRepository = $slaRepository;
    }

    /**
     * Shared helper to determine the department ID for SLA rule lookup.
     * Mirrors creation logic:
     * - Customer tickets (is_internal == 0) -> department 2 (Service).
     * - Internal tickets (is_internal == 1) -> department of the requester (requested_by), fallback 2.
     */
    public function resolveDepartmentForTicket($ticket): int
    {
        if (is_numeric($ticket)) {
            $ticket = DB::table('tickets')->where('ticket_ID', (int) $ticket)->first();
        }

        if (!$ticket) {
            return 2;
        }

        if (empty($ticket->is_internal)) {
            return 2;
        }

        if (!empty($ticket->requested_by)) {
            $deptName = DB::table('employees')->where('emp_id', $ticket->requested_by)->value('department');
            if (!empty($deptName)) {
                $deptId = DB::table('departments')->whereRaw('LOWER(name) = ?', [strtolower(trim($deptName))])->value('id');
                if (!empty($deptId)) {
                    return (int) $deptId;
                }
            }
        }

        return 2;
    }

    /**
     * Shared rule-resolution logic used by both initial assignment and recalculation:
     * 1. Branch Category SLA Policy (highest precedence for branch when category is matched)
     * 2. Branch Priority Override
     * 3. SLARule (department + category + priority)
     * 4. Default SLA Policy fallback
     */
    public function resolveSlaPolicy(
        int $departmentId,
        ?int $categoryId,
        string $priority,
        ?string $branchId = null,
        ?string $defaultSlaPolicy = null
    ): array {
        // 1. Branch Category SLA Policy & Branch Priority Override
        if ($branchId) {
            $categoryName = $categoryId
                ? DB::table('problem_categories')->where('problem_category_ID', $categoryId)->value('category_name')
                : null;

            if ($categoryId !== null || !empty($categoryName)) {
                $branchCategorySla = DB::table('branch_sla_policies')
                    ->where('branch_id', $branchId)
                    ->where(function ($q) use ($categoryId, $categoryName) {
                        if ($categoryId) {
                            $q->where('category_id', $categoryId);
                        }
                        if ($categoryName) {
                            $q->orWhereRaw('LOWER(category_name) = ?', [strtolower(trim($categoryName))]);
                        }
                    })
                    ->whereRaw('LOWER(priority) = ?', [strtolower(trim($priority))])
                    ->first();

                if ($branchCategorySla) {
                    $responseTimeLimit = (int) ($branchCategorySla->response_time_limit ?: 30);
                    $resolutionTimeLimit = (int) $branchCategorySla->resolution_time_limit;

                    return [
                        'sla_rule_id' => null,
                        'sla_ID' => null,
                        'branch_sla_policy_id' => $branchCategorySla->id,
                        'branch_priority_override_id' => null,
                        'response_time_limit' => $responseTimeLimit,
                        'resolution_time_limit' => $resolutionTimeLimit,
                        'is_fallback' => false,
                        'is_branch_override' => true,
                    ];
                }
            }

            // 2. Branch Priority Override
            $basePriorityId = DB::table('ticket_priorities')
                ->whereRaw('LOWER(priority_name) = ?', [strtolower(trim($priority))])
                ->value('priority_ID');
            $override = $basePriorityId
                ? app(BranchPriorityService::class)->resolveOverride($branchId, (int) $basePriorityId)
                : null;

            if ($override) {
                return [
                    'sla_rule_id' => null,
                    'sla_ID' => null,
                    'branch_sla_policy_id' => null,
                    'branch_priority_override_id' => $override->id,
                    'response_time_limit' => (int) $override->response_time_limit,
                    'resolution_time_limit' => (int) $override->resolution_time_limit,
                    'is_fallback' => false,
                    'is_branch_override' => true,
                ];
            }
        }

        // 3. System-wide SLA Rules (Department + Category + Priority)
        $rule = $this->slaRepository->findMatchingRule($departmentId, $categoryId, $priority);
        if ($rule) {
            return [
                'sla_rule_id' => $rule->id,
                'sla_ID' => null,
                'branch_sla_policy_id' => null,
                'branch_priority_override_id' => null,
                'response_time_limit' => (int) $rule->response_time_limit,
                'resolution_time_limit' => (int) $rule->resolution_time_limit,
                'is_fallback' => false,
                'is_branch_override' => false,
            ];
        }

        // 4. Default SLA Policy fallback
        $policy = $defaultSlaPolicy ?? TicketConfigurationService::getDefaultsConfig()['slaPolicy'] ?? 'dynamic';
        $slaRecord = null;
        if ($policy !== 'dynamic' && !empty($policy)) {
            $slaRecord = DB::table('slas')
                ->where('is_active', true)
                ->where(function ($q) use ($policy) {
                    $q->where('sla_ID', $policy)
                      ->orWhereRaw('LOWER(sla_name) = ?', [strtolower(trim($policy))]);
                })
                ->first();
        }

        if (!$slaRecord) {
            $slaRecord = DB::table('slas')->where('is_active', true)->orderBy('sla_ID')->first();
        }

        $slaId = $slaRecord ? $slaRecord->sla_ID : null;
        $responseTimeLimit = $slaRecord ? ($slaRecord->response_time_minutes ?? 1440) : 1440;
        $resolutionTimeLimit = $slaRecord ? ($slaRecord->resolution_time_minutes ?? 2880) : 2880;

        return [
            'sla_rule_id' => null,
            'sla_ID' => $slaId,
            'branch_sla_policy_id' => null,
            'branch_priority_override_id' => null,
            'response_time_limit' => (int) $responseTimeLimit,
            'resolution_time_limit' => (int) $resolutionTimeLimit,
            'is_fallback' => true,
            'is_branch_override' => false,
        ];
    }

    /**
     * Calculate future due date considering working business hours (Monday-Friday 8AM-5PM).
     * If business hours enforcement is disabled, falls back to a 24/7 calendar.
     */
    public function addBusinessHours(Carbon $start, int $minutes, array $config = []): Carbon
    {
        if ($minutes <= 0) {
            return $start->copy();
        }

        $windowConfig = !empty($config) ? $config : TicketConfigurationService::getWindowConfig();
        $enabled = (bool) ($windowConfig['businessHoursEnabled'] ?? true);

        if (!$enabled) {
            return $start->copy()->addMinutes($minutes);
        }

        $current = $start->copy();
        $remainingMinutes = $minutes;

        // Ensure current time is moved forward to start of business hours if outside
        $current = $this->advanceToNextBusinessWindow($current);

        while ($remainingMinutes > 0) {
            $endOfDay = $current->copy()->setTime(17, 0, 0);
            $availableToday = $current->diffInMinutes($endOfDay, false);

            if ($remainingMinutes <= $availableToday) {
                return $current->addMinutes($remainingMinutes);
            }

            $remainingMinutes -= $availableToday;
            // Move to 08:00 of next day, then advance if weekend
            $current = $current->addDay()->setTime(8, 0, 0);
            $current = $this->advanceToNextBusinessWindow($current);
        }

        return $current;
    }

    /**
     * Advance a timestamp to the next available working business window.
     */
    protected function advanceToNextBusinessWindow(Carbon $time): Carbon
    {
        $current = $time->copy();

        while (true) {
            // Saturday or Sunday
            if ($current->isWeekend()) {
                $current = $current->next(Carbon::MONDAY)->setTime(8, 0, 0);
                continue;
            }

            // Before 08:00
            if ($current->hour < 8) {
                return $current->setTime(8, 0, 0);
            }

            // At or after 17:00
            if ($current->hour >= 17) {
                $current = $current->addDay()->setTime(8, 0, 0);
                continue;
            }

            return $current;
        }
    }

    /**
     * Dynamically determine and assign matching SLA rule and deadlines to a newly created ticket.
     */
    public function assignSlaToTicket(
        int $ticketId,
        int $departmentId,
        ?int $categoryId,
        string $priority,
        $createdAt = null,
        ?string $defaultSlaPolicy = null,
        ?string $branchId = null
    ) {
        $createdAtObj = $createdAt ? (is_string($createdAt) ? Carbon::parse($createdAt) : $createdAt) : now();

        $resolved = $this->resolveSlaPolicy($departmentId, $categoryId, $priority, $branchId, $defaultSlaPolicy);

        $responseDueAt = $this->addBusinessHours($createdAtObj, (int) $resolved['response_time_limit']);
        $resolutionDueAt = $this->addBusinessHours($createdAtObj, (int) $resolved['resolution_time_limit']);

        $slaStatus = 'On Track';
        if (empty($resolved['sla_rule_id']) && empty($resolved['sla_ID']) && empty($resolved['branch_sla_policy_id']) && empty($resolved['branch_priority_override_id'])) {
            $slaStatus = 'No SLA Configured';
        }

        $update = [
            'branch_id' => $branchId,
            'branch_priority_override_id' => $resolved['branch_priority_override_id'],
            'sla_rule_id' => $resolved['sla_rule_id'],
            'sla_ID' => $resolved['sla_ID'],
            'sla_started_at' => $createdAtObj,
            'sla_paused_at' => null,
            'sla_paused_total_seconds' => 0,
            'response_due_at' => $responseDueAt,
            'resolution_due_at' => $resolutionDueAt,
            'sla_status' => $slaStatus,
            'updated_at' => now(),
        ];

        DB::table('tickets')->where('ticket_ID', $ticketId)->update($update);

        $result = [
            'sla_rule_id' => $resolved['sla_rule_id'],
            'sla_ID' => $resolved['sla_ID'],
            'branch_sla_policy_id' => $resolved['branch_sla_policy_id'],
            'branch_priority_override_id' => $resolved['branch_priority_override_id'],
            'response_due_at' => $responseDueAt->toDateTimeString(),
            'resolution_due_at' => $resolutionDueAt->toDateTimeString(),
            'response_time_limit' => $resolved['response_time_limit'],
            'resolution_time_limit' => $resolved['resolution_time_limit'],
            'is_fallback' => $resolved['is_fallback'],
            'sla_status' => $slaStatus,
        ];

        if (!empty($resolved['is_branch_override'])) {
            $result['is_branch_override'] = true;
        }

        return $result;
    }

    /**
     * Pause the SLA clock for a ticket entering On Hold.
     * Sets sla_paused_at = now() if null.
     */
    public function pauseClock(int $ticketId): bool
    {
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket || $ticket->sla_paused_at !== null) {
            return false;
        }

        DB::table('tickets')->where('ticket_ID', $ticketId)->update([
            'sla_paused_at' => now(),
            'sla_status' => 'Paused',
            'updated_at' => now(),
        ]);

        return true;
    }

    /**
     * Resume the SLA clock for a ticket leaving On Hold.
     * In a transaction with lockForUpdate:
     * - Adds paused seconds to sla_paused_total_seconds.
     * - Shifts resolution_due_at (only if resolved_at is null) forward by that amount.
     * - Shifts response_due_at (only if first_response_at is null) forward by that amount.
     * - Clears sla_paused_at.
     * No-op if not paused.
     */
    public function resumeClock(int $ticketId): bool
    {
        return DB::transaction(function () use ($ticketId) {
            $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->lockForUpdate()->first();
            if (!$ticket || empty($ticket->sla_paused_at)) {
                return false;
            }

            $pausedAt = Carbon::parse($ticket->sla_paused_at);
            $now = now();
            $pausedSeconds = max(0, $now->diffInSeconds($pausedAt));
            $totalPausedSeconds = (int) ($ticket->sla_paused_total_seconds ?? 0) + $pausedSeconds;

            $update = [
                'sla_paused_at' => null,
                'sla_paused_total_seconds' => $totalPausedSeconds,
                'updated_at' => $now,
            ];

            // Shift resolution_due_at forward by paused seconds only if not yet resolved
            $resDueAt = null;
            if ($ticket->resolution_due_at && empty($ticket->resolved_at)) {
                $resDueAt = Carbon::parse($ticket->resolution_due_at)->addSeconds($pausedSeconds);
                $update['resolution_due_at'] = $resDueAt;
            }

            // Shift response_due_at forward by paused seconds only if first response not yet recorded
            if ($ticket->response_due_at && empty($ticket->first_response_at)) {
                $update['response_due_at'] = Carbon::parse($ticket->response_due_at)->addSeconds($pausedSeconds);
            }

            // Re-evaluate SLA status
            $slaStatus = 'On Track';
            if ($resDueAt) {
                if ($now->gt($resDueAt)) {
                    $slaStatus = 'Breached';
                } elseif ($now->diffInMinutes($resDueAt, false) <= 240) {
                    $slaStatus = 'At Risk';
                }
            }
            $update['sla_status'] = $slaStatus;

            DB::table('tickets')->where('ticket_ID', $ticketId)->update($update);

            return true;
        });
    }

    /**
     * Recalculate SLA deadlines when category, priority, or branch changes.
     * Based on COALESCE(sla_started_at, created_at) + rule minutes + sla_paused_total_seconds.
     * Updates sla_ID and sla_rule_id to the newly resolved policy.
     * Returns old and new deadlines.
     */
    public function recalculateForReclassification(
        int $ticketId,
        ?int $newCategoryId = null,
        ?int $newPriorityId = null,
        ?string $branchId = null
    ): array {
        return DB::transaction(function () use ($ticketId, $newCategoryId, $newPriorityId, $branchId) {
            $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->lockForUpdate()->first();
            if (!$ticket) {
                throw new \InvalidArgumentException("Ticket {$ticketId} not found");
            }

            $oldResponseDueAt = $ticket->response_due_at;
            $oldResolutionDueAt = $ticket->resolution_due_at;

            $categoryId = $newCategoryId !== null ? $newCategoryId : $ticket->problem_category_ID;
            $priorityId = $newPriorityId !== null ? $newPriorityId : $ticket->priority_ID;
            $branch = $branchId !== null ? $branchId : $ticket->branch_id;

            $priorityName = DB::table('ticket_priorities')->where('priority_ID', $priorityId)->value('priority_name') ?? 'Low';
            $departmentId = $this->resolveDepartmentForTicket($ticket);

            $resolvedPolicy = $this->resolveSlaPolicy($departmentId, $categoryId, $priorityName, $branch);

            $baseTime = $ticket->sla_started_at
                ? Carbon::parse($ticket->sla_started_at)
                : ($ticket->created_at ? Carbon::parse($ticket->created_at) : now());

            $pausedSeconds = (int) ($ticket->sla_paused_total_seconds ?? 0);

            $newResolutionDueAt = $this->addBusinessHours($baseTime, (int) $resolvedPolicy['resolution_time_limit'])
                ->addSeconds($pausedSeconds);

            $now = now();
            $slaStatus = 'On Track';
            if (empty($resolvedPolicy['sla_rule_id']) && empty($resolvedPolicy['sla_ID']) && empty($resolvedPolicy['branch_sla_policy_id']) && empty($resolvedPolicy['branch_priority_override_id'])) {
                $slaStatus = 'No SLA Configured';
            } elseif ($now->gt($newResolutionDueAt)) {
                $slaStatus = 'Breached';
            } elseif ($now->diffInMinutes($newResolutionDueAt, false) <= 240) {
                $slaStatus = 'At Risk';
            }

            $update = [
                'problem_category_ID' => $categoryId,
                'priority_ID' => $priorityId,
                'branch_id' => $branch,
                'branch_priority_override_id' => $resolvedPolicy['branch_priority_override_id'] ?? null,
                'sla_rule_id' => $resolvedPolicy['sla_rule_id'] ?? null,
                'sla_ID' => $resolvedPolicy['sla_ID'] ?? null,
                'resolution_due_at' => $newResolutionDueAt,
                'sla_status' => $slaStatus,
                'updated_at' => now(),
            ];

            // Only update response_due_at if first_response_at is null
            $newResponseDueAt = $oldResponseDueAt;
            if (empty($ticket->first_response_at)) {
                $newResponseDueAt = $this->addBusinessHours($baseTime, (int) $resolvedPolicy['response_time_limit'])
                    ->addSeconds($pausedSeconds);
                $update['response_due_at'] = $newResponseDueAt;
            }

            // Update live resolution SLA status if not resolved
            if (empty($ticket->resolved_at)) {
                $update['resolution_sla_status'] = $now->gt($newResolutionDueAt) ? 'BREACHED' : 'PENDING';
            }

            DB::table('tickets')->where('ticket_ID', $ticketId)->update($update);

            return [
                'ticket_ID' => $ticketId,
                'old_response_due_at' => $oldResponseDueAt,
                'new_response_due_at' => is_string($newResponseDueAt) ? $newResponseDueAt : ($newResponseDueAt ? $newResponseDueAt->toDateTimeString() : null),
                'old_resolution_due_at' => $oldResolutionDueAt,
                'new_resolution_due_at' => $newResolutionDueAt->toDateTimeString(),
                'resolved_policy' => $resolvedPolicy,
                'sla_status' => $slaStatus,
            ];
        });
    }

    /**
     * Recalculate SLA for reopened ticket:
     * - Clears resolved_at, closed_at.
     * - Sets resolution_sla_status = 'PENDING'.
     * - Sets sla_started_at = now() and sla_paused_total_seconds = 0 so subsequent reclassifications do not backdate deadlines.
     * - Sets resolution_due_at = now() + rule resolution minutes.
     * - Updates sla_ID and sla_rule_id to the newly resolved policy.
     */
    public function recalculateForReopen(int $ticketId): array
    {
        return DB::transaction(function () use ($ticketId) {
            $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->lockForUpdate()->first();
            if (!$ticket) {
                throw new \InvalidArgumentException("Ticket {$ticketId} not found");
            }

            $priorityName = DB::table('ticket_priorities')->where('priority_ID', $ticket->priority_ID)->value('priority_name') ?? 'Low';
            $departmentId = $this->resolveDepartmentForTicket($ticket);

            $resolvedPolicy = $this->resolveSlaPolicy($departmentId, $ticket->problem_category_ID, $priorityName, $ticket->branch_id);

            $now = now();
            $newResolutionDueAt = $now->copy()->addMinutes($resolvedPolicy['resolution_time_limit']);

            $update = [
                'resolved_at' => null,
                'closed_at' => null,
                'resolution_sla_status' => 'PENDING',
                'sla_started_at' => $now,
                'sla_paused_at' => null,
                'sla_paused_total_seconds' => 0,
                'resolution_due_at' => $newResolutionDueAt,
                'sla_rule_id' => $resolvedPolicy['sla_rule_id'] ?? null,
                'sla_ID' => $resolvedPolicy['sla_ID'] ?? null,
                'branch_priority_override_id' => $resolvedPolicy['branch_priority_override_id'] ?? null,
                'updated_at' => $now,
            ];

            DB::table('tickets')->where('ticket_ID', $ticketId)->update($update);

            return [
                'ticket_ID' => $ticketId,
                'resolution_due_at' => $newResolutionDueAt->toDateTimeString(),
                'resolution_sla_status' => 'PENDING',
                'resolved_policy' => $resolvedPolicy,
            ];
        });
    }

    /**
     * Record first employee response timestamp and evaluate Response SLA status.
     */
    public function recordFirstResponse(int $ticketId, $timestamp = null)
    {
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket) {
            return null;
        }

        // If first response already recorded, retain original response timestamp & status
        if ($ticket->first_response_at) {
            return [
                'first_response_at' => $ticket->first_response_at,
                'response_sla_status' => $ticket->response_sla_status,
            ];
        }

        $respTime = $timestamp ? (is_string($timestamp) ? Carbon::parse($timestamp) : $timestamp) : now();
        $status = null;

        if ($ticket->response_due_at) {
            $dueAt = Carbon::parse($ticket->response_due_at);
            $status = $respTime->lte($dueAt) ? 'MET' : 'BREACHED';
        }

        DB::table('tickets')
            ->where('ticket_ID', $ticketId)
            ->update([
                'first_response_at' => $respTime,
                'response_sla_status' => $status,
                'updated_at' => now(),
            ]);

        return [
            'first_response_at' => $respTime->toDateTimeString(),
            'response_sla_status' => $status,
        ];
    }

    /**
     * Record resolution timestamp and evaluate Resolution SLA status.
     * Fix: Do not overwrite an existing MET/BREACHED result when a ticket goes Resolved -> Closed.
     */
    public function recordResolution(int $ticketId, $timestamp = null)
    {
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket) {
            return null;
        }

        // Retain existing evaluation if already evaluated
        if ($ticket->resolution_sla_status && in_array($ticket->resolution_sla_status, ['MET', 'BREACHED'], true)) {
            return [
                'resolved_at' => $ticket->resolved_at,
                'resolution_sla_status' => $ticket->resolution_sla_status,
            ];
        }

        $resTime = $timestamp ? (is_string($timestamp) ? Carbon::parse($timestamp) : $timestamp) : now();
        $status = null;

        if ($ticket->resolution_due_at) {
            $dueAt = Carbon::parse($ticket->resolution_due_at);
            $status = $resTime->lte($dueAt) ? 'MET' : 'BREACHED';
        }

        $finalResolvedAt = $ticket->resolved_at ?: $resTime;

        DB::table('tickets')
            ->where('ticket_ID', $ticketId)
            ->update([
                'resolved_at' => $finalResolvedAt,
                'resolution_sla_status' => $status,
                'updated_at' => now(),
            ]);

        return [
            'resolved_at' => is_string($finalResolvedAt) ? $finalResolvedAt : Carbon::parse($finalResolvedAt)->toDateTimeString(),
            'resolution_sla_status' => $status,
        ];
    }

    /**
     * Backward-compatible fallback applicator.
     */
    public function applyDefaultSlaPolicy(int $ticketId, string $defaultSlaPolicy, Carbon $createdAtObj)
    {
        return $this->assignSlaToTicket($ticketId, 2, null, 'Low', $createdAtObj, $defaultSlaPolicy);
    }

    /**
     * Evaluate live SLA status for reporting / display purposes.
     */
    public function evaluateSlaStatusForTicket($ticket)
    {
        if (!$ticket) {
            return null;
        }

        $now = now();

        // Response SLA status
        $responseStatus = $ticket->response_sla_status;
        if (!$responseStatus && $ticket->response_due_at) {
            if ($ticket->first_response_at) {
                $responseStatus = Carbon::parse($ticket->first_response_at)->lte(Carbon::parse($ticket->response_due_at)) ? 'MET' : 'BREACHED';
            } elseif ($now->gt(Carbon::parse($ticket->response_due_at))) {
                $responseStatus = 'BREACHED';
            } else {
                $responseStatus = 'PENDING';
            }
        }

        // Resolution SLA status
        $resolutionStatus = $ticket->resolution_sla_status;
        if (!$resolutionStatus && $ticket->resolution_due_at) {
            if ($ticket->resolved_at) {
                $resolutionStatus = Carbon::parse($ticket->resolved_at)->lte(Carbon::parse($ticket->resolution_due_at)) ? 'MET' : 'BREACHED';
            } elseif ($now->gt(Carbon::parse($ticket->resolution_due_at))) {
                $resolutionStatus = 'BREACHED';
            } else {
                $resolutionStatus = 'PENDING';
            }
        }

        return [
            'response_sla_status' => $responseStatus,
            'resolution_sla_status' => $resolutionStatus,
        ];
    }

    /**
     * Compute comprehensive SLA metrics (status, due date, minutes remaining) for ticket monitoring.
     * Consistently used by CS queue and ticket detail view.
     */
    public function computeTicketSlaMetrics($ticket): array
    {
        if (!$ticket) {
            return [
                'status' => 'On Track',
                'due_at' => null,
                'time_remaining_minutes' => null,
                'is_breached' => false,
                'is_at_risk' => false,
                'is_paused' => false,
            ];
        }

        $now = now();
        $statusName = strtolower(trim((string) ($ticket->status_name ?? $ticket->status ?? '')));
        $isClosedOrResolved = in_array($statusName, ['closed', 'resolved']);
        $isOnHold = in_array($statusName, ['on hold', 'on-hold', 'paused']) || ((int) ($ticket->ticket_status_ID ?? 0) === 11);

        $resDueAtRaw = $ticket->resolution_due_at ?? null;
        $resDueAt = $resDueAtRaw ? Carbon::parse($resDueAtRaw) : null;
        $resolvedAtRaw = $ticket->resolved_at ?? $ticket->closed_at ?? null;
        $resolvedAt = $resolvedAtRaw ? Carbon::parse($resolvedAtRaw) : null;
        $createdAtRaw = $ticket->created_at ?? null;
        $createdAt = $createdAtRaw ? Carbon::parse($createdAtRaw) : null;

        // Check for explicitly unconfigured SLA
        if (
            (isset($ticket->sla_status) && $ticket->sla_status === 'No SLA Configured') ||
            (empty($resDueAt) && empty($ticket->sla_rule_id) && empty($ticket->sla_ID) && empty($ticket->branch_sla_policy_id) && empty($ticket->branch_priority_override_id))
        ) {
            return [
                'status' => 'No SLA Configured',
                'due_at' => null,
                'time_remaining_minutes' => null,
                'is_breached' => false,
                'is_at_risk' => false,
                'is_paused' => false,
                'is_unavailable' => true,
            ];
        }

        // 1. Paused / On Hold
        if ($isOnHold) {
            return [
                'status' => 'Paused',
                'due_at' => $resDueAt ? $resDueAt->toIso8601String() : null,
                'time_remaining_minutes' => $resDueAt ? max(0, $now->diffInMinutes($resDueAt, false)) : null,
                'is_breached' => false,
                'is_at_risk' => false,
                'is_paused' => true,
            ];
        }

        // 2. Closed / Resolved
        if ($isClosedOrResolved) {
            $isBreached = false;
            if ($resDueAt) {
                $evalTime = $resolvedAt ?: $now;
                $isBreached = $evalTime->gt($resDueAt);
            }
            return [
                'status' => $isBreached ? 'Breached' : 'Compliant',
                'due_at' => $resDueAt ? $resDueAt->toIso8601String() : null,
                'time_remaining_minutes' => 0,
                'is_breached' => $isBreached,
                'is_at_risk' => false,
                'is_paused' => false,
            ];
        }

        // 3. Active Ticket with resolution_due_at
        if ($resDueAt) {
            $minutesRemaining = $now->diffInMinutes($resDueAt, false);
            if ($minutesRemaining < 0) {
                return [
                    'status' => 'Breached',
                    'due_at' => $resDueAt->toIso8601String(),
                    'time_remaining_minutes' => 0,
                    'is_breached' => true,
                    'is_at_risk' => false,
                    'is_paused' => false,
                ];
            }

            // At risk if <= 4 hours (240 mins) remaining or <= 25% of total time if createdAt is available
            $isAtRisk = false;
            if ($minutesRemaining <= 240) {
                $isAtRisk = true;
            } elseif ($createdAt) {
                $totalMinutes = max(1, $createdAt->diffInMinutes($resDueAt, false));
                if (($minutesRemaining / $totalMinutes) <= 0.25) {
                    $isAtRisk = true;
                }
            }

            return [
                'status' => $isAtRisk ? 'At Risk' : 'On Track',
                'due_at' => $resDueAt->toIso8601String(),
                'time_remaining_minutes' => (int) $minutesRemaining,
                'is_breached' => false,
                'is_at_risk' => $isAtRisk,
                'is_paused' => false,
            ];
        }

        // 4. Active Ticket fallback without resolution_due_at: use age from createdAt
        if ($createdAt) {
            $hours = $now->diffInHours($createdAt);
            if ($hours >= 48) {
                return [
                    'status' => 'Breached',
                    'due_at' => $createdAt->copy()->addHours(48)->toIso8601String(),
                    'time_remaining_minutes' => 0,
                    'is_breached' => true,
                    'is_at_risk' => false,
                    'is_paused' => false,
                ];
            }
            if ($hours >= 24) {
                return [
                    'status' => 'At Risk',
                    'due_at' => $createdAt->copy()->addHours(48)->toIso8601String(),
                    'time_remaining_minutes' => max(0, (48 - $hours) * 60),
                    'is_breached' => false,
                    'is_at_risk' => true,
                    'is_paused' => false,
                ];
            }
            return [
                'status' => 'On Track',
                'due_at' => $createdAt->copy()->addHours(48)->toIso8601String(),
                'time_remaining_minutes' => max(0, (48 - $hours) * 60),
                'is_breached' => false,
                'is_at_risk' => false,
                'is_paused' => false,
            ];
        }

        return [
            'status' => 'On Track',
            'due_at' => null,
            'time_remaining_minutes' => null,
            'is_breached' => false,
            'is_at_risk' => false,
            'is_paused' => false,
        ];
    }

    /**
     * Classify ticket risk into standard categories: 'breached', 'near_breach', 'within_sla'.
     * Used by SuperAdmin, Admin, and Employee personal dashboards.
     */
    public function classifyTicketRisk($ticket): string
    {
        $metrics = $this->computeTicketSlaMetrics($ticket);
        if (!empty($metrics['is_breached']) || ($metrics['status'] ?? '') === 'Breached') {
            return 'breached';
        }
        if (!empty($metrics['is_at_risk']) || ($metrics['status'] ?? '') === 'At Risk') {
            return 'near_breach';
        }
        return 'within_sla';
    }

    /**
     * Inspect all active tickets for SLA breach or at risk conditions.
     * Dispatches notifications to CS and assigned employees with deduplication.
     */
    public function checkAndNotifySlaAlerts(): array
    {
        $now = now();
        $notificationService = app(TicketNotificationService::class);

        // Fetch unresolved tickets (excluding Closed, Resolved, Discarded, Cancelled)
        $activeTickets = DB::table('tickets as t')
            ->leftJoin('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->leftJoin('clients as c', 'c.id', '=', 't.created_by')
            ->where(function ($q) {
                $q->whereNull('ts.status_name')
                  ->orWhereNotIn(DB::raw('LOWER(ts.status_name)'), ['closed', 'resolved', 'discarded', 'cancelled']);
            })
            ->select('t.*', 'ts.status_name', 'c.client_name')
            ->get();

        $breachNotifiedCount = 0;
        $riskNotifiedCount = 0;
        $evaluatedCount = 0;
        $cadenceMinutes = $this->getSlaBreachRealertInterval();

        foreach ($activeTickets as $ticket) {
            $evaluatedCount++;
            $ticketId = (int) $ticket->ticket_ID;
            $metrics = $this->computeTicketSlaMetrics($ticket);
            $status = $metrics['status'];

            // 1. Check Breached
            if ($status === 'Breached') {
                $lastAlert = $ticket->last_sla_breach_alert_at ?: $ticket->sla_breach_notified_at;
                $shouldAlert = empty($ticket->sla_breach_notified_at);
                if (!$shouldAlert && $lastAlert && Carbon::parse($lastAlert)->diffInMinutes($now) >= $cadenceMinutes) {
                    $shouldAlert = true;
                }

                if ($shouldAlert) {
                    $this->dispatchSlaBreachAlert($ticket, $metrics, $notificationService);
                    DB::table('tickets')->where('ticket_ID', $ticketId)->update([
                        'sla_status' => 'Breached',
                        'sla_breach_notified_at' => $ticket->sla_breach_notified_at ?: $now,
                        'last_sla_breach_alert_at' => $now,
                        'updated_at' => $now,
                    ]);
                    $breachNotifiedCount++;
                } elseif (($ticket->sla_status ?? '') !== 'Breached') {
                    DB::table('tickets')->where('ticket_ID', $ticketId)->update([
                        'sla_status' => 'Breached',
                        'updated_at' => $now,
                    ]);
                }
                continue;
            }

            // 2. Check At Risk
            if ($status === 'At Risk') {
                if (empty($ticket->sla_risk_notified_at)) {
                    $this->dispatchSlaRiskAlert($ticket, $metrics, $notificationService);
                    DB::table('tickets')->where('ticket_ID', $ticketId)->update([
                        'sla_status' => 'At Risk',
                        'sla_risk_notified_at' => $now,
                        'updated_at' => $now,
                    ]);
                    $riskNotifiedCount++;
                } elseif (($ticket->sla_status ?? '') !== 'At Risk') {
                    DB::table('tickets')->where('ticket_ID', $ticketId)->update([
                        'sla_status' => 'At Risk',
                        'updated_at' => $now,
                    ]);
                }
                continue;
            }

            // 3. Status is On Track, Paused, or No SLA Configured
            if (($ticket->sla_status ?? '') !== $status) {
                DB::table('tickets')->where('ticket_ID', $ticketId)->update([
                    'sla_status' => $status,
                    'updated_at' => $now,
                ]);
            }
        }

        return [
            'evaluated_tickets' => $evaluatedCount,
            'breach_notifications_sent' => $breachNotifiedCount,
            'risk_notifications_sent' => $riskNotifiedCount,
        ];
    }

    /**
     * Get the cadence interval in minutes for recurring breach alerts from configuration.
     */
    public function getSlaBreachRealertInterval(): int
    {
        try {
            $configService = app(TicketConfigurationService::class);
            $interval = $configService->get('sla_breach_realert_interval_minutes');
            if ($interval && is_numeric($interval) && (int) $interval > 0) {
                return (int) $interval;
            }
        } catch (\Throwable $e) {
            // fallback if configuration service is unavailable
        }
        return 240; // Default 4 hours cadence
    }

    /**
     * Dispatch alert notifications to CS and assigned employees for an SLA breach.
     */
    protected function dispatchSlaBreachAlert($ticket, array $metrics, TicketNotificationService $notificationService): void
    {
        $ticketId = (int) $ticket->ticket_ID;
        $ticketRef = 'TKT-' . str_pad((string) $ticketId, 4, '0', STR_PAD_LEFT);
        $ticketTitle = $ticket->title ?: 'Ticket #' . $ticketId;
        $dueAt = $metrics['due_at'] ?? $ticket->resolution_due_at;

        // Fetch Category name
        $categoryName = !empty($ticket->problem_category_ID)
            ? DB::table('problem_categories')->where('problem_category_ID', $ticket->problem_category_ID)->value('category_name')
            : 'General';

        // Fetch Priority name
        $priorityName = !empty($ticket->priority_ID)
            ? DB::table('ticket_priorities')->where('priority_ID', $ticket->priority_ID)->value('priority_name')
            : 'Medium';

        // Fetch Customer name
        $customerName = $ticket->client_name ?: (
            !empty($ticket->created_by) ? DB::table('clients')->where('id', $ticket->created_by)->value('client_name') : 'Valued Customer'
        );

        // Compute overdue duration
        $overdueMinutes = $dueAt ? max(1, (int) Carbon::parse($dueAt)->diffInMinutes(now())) : 0;
        $overdueDuration = $overdueMinutes >= 60
            ? round($overdueMinutes / 60, 1) . ' hours overdue'
            : "{$overdueMinutes} minutes overdue";

        // Collect assigned employee IDs
        $assignedEmpIds = DB::table('ticket_assignments')
            ->where('ticket_ID', $ticketId)
            ->whereNull('completed_at')
            ->pluck('employee_ID')
            ->map(fn($id) => (int) $id)
            ->all();

        if (!empty($ticket->assigned_to)) {
            $assignedEmpIds[] = (int) $ticket->assigned_to;
        }
        $assignedEmpIds = array_values(array_unique(array_filter($assignedEmpIds)));

        $notificationData = [
            'type' => 'overdue_sla_breach',
            'ticket_id' => $ticketId,
            'ticket_ref' => $ticketRef,
            'title' => $ticketTitle,
            'summary' => $ticketTitle,
            'customer' => $customerName,
            'category' => $categoryName,
            'priority' => $priorityName,
            'overdue_duration' => $overdueDuration,
            'sla_status' => 'Breached',
            'due_at' => $dueAt,
            'link' => "/ticketing/employee/machine",
            'deep_link' => "/ticketing/employee/machine",
        ];

        $csTitle = "SLA Alert: Ticket {$ticketRef} Breached";
        $csMessage = "Ticket {$ticketRef}: \"{$ticketTitle}\" has breached its resolution SLA deadline ({$overdueDuration}).";
        $notificationService->notifyCS($csTitle, $csMessage, $ticketId, $notificationData, null, 'overdue_sla_breach');

        $empTitle = "SLA Alert: Assigned Ticket {$ticketRef} Breached";
        $empMessage = "Urgent: Assigned Ticket {$ticketRef}: \"{$ticketTitle}\" has breached its resolution SLA deadline ({$overdueDuration}). Immediate action required.";
        foreach ($assignedEmpIds as $empId) {
            $notificationService->notifyRecipient(
                $empId,
                'employee',
                $empTitle,
                $empMessage,
                $ticketId,
                $notificationData,
                'overdue_sla_breach'
            );

            // Also send email alert respecting preferences and retry logic
            $notificationService->sendTicketEmail(
                $empId,
                $empTitle,
                $empMessage,
                $ticketId,
                $ticketTitle,
                $categoryName,
                $priorityName,
                'overdue_sla_breach',
                [
                    'customer_name' => $customerName,
                    'sla_deadline' => $dueAt,
                    'overdue_duration' => $overdueDuration,
                ]
            );
        }

        // Notify designated Department Manager(s) for this ticket (AC-9)
        $managers = $this->resolveDepartmentManagersForTicket($ticket);
        foreach ($managers as $manager) {
            if ($manager && !in_array((int) $manager->emp_id, $assignedEmpIds, true)) {
                $mgrTitle = "Department SLA Breach Alert: {$ticketRef}";
                $mgrMessage = "Manager Alert: Ticket {$ticketRef}: \"{$ticketTitle}\" has breached its resolution SLA deadline ({$overdueDuration}). Immediate departmental intervention required.";
                $notificationService->notifyRecipient(
                    (int) $manager->emp_id,
                    'employee',
                    $mgrTitle,
                    $mgrMessage,
                    $ticketId,
                    array_merge($notificationData, [
                        'is_manager_alert' => true,
                        'manager_name' => $manager->first_name . ' ' . $manager->last_name,
                    ]),
                    'overdue_sla_breach'
                );

                $notificationService->sendTicketEmail(
                    (int) $manager->emp_id,
                    $mgrTitle,
                    $mgrMessage,
                    $ticketId,
                    $ticketTitle,
                    $categoryName,
                    $priorityName,
                    'overdue_sla_breach',
                    [
                        'customer_name' => $customerName,
                        'sla_deadline' => $dueAt,
                        'overdue_duration' => $overdueDuration,
                    ]
                );
            }
        }

        // Broadcast real-time change
        $notificationService->broadcastTicketChange('sla_breach', $ticketId, [
            'ticket_id' => $ticketId,
            'sla_status' => 'Breached',
            'employee_ids' => $assignedEmpIds,
            'manager_id' => $manager ? (int) $manager->emp_id : null,
            'overdue_duration' => $overdueDuration,
        ]);

        // Audit log entry
        $systemEmpId = DB::table('employees')->value('emp_id') ?? 1;
        try {
            DB::table('ticket_audit_logs')->insert([
                'ticket_ID' => $ticketId,
                'action_type' => 'sla_breached',
                'action_by_ID' => $systemEmpId,
                'actor_type' => 'system',
                'details' => json_encode([
                    'sla_status' => 'Breached',
                    'due_at' => $dueAt,
                    'overdue_duration' => $overdueDuration,
                    'customer' => $customerName,
                    'category' => $categoryName,
                    'priority' => $priorityName,
                    'assigned_employees' => $assignedEmpIds,
                ]),
                'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("Failed to record sla_breached audit log for ticket #{$ticketId}: {$e->getMessage()}");
        }
    }

    /**
     * Dispatch an urgent breach alert to a newly assigned employee when a ticket is already breached.
     */
    public function dispatchReassignmentBreachAlert(int $ticketId, int $newEmployeeId): void
    {
        $ticket = DB::table('tickets as t')
            ->leftJoin('clients as c', 'c.id', '=', 't.created_by')
            ->where('t.ticket_ID', $ticketId)
            ->select('t.*', 'c.client_name')
            ->first();

        if (!$ticket) {
            return;
        }

        $metrics = $this->computeTicketSlaMetrics($ticket);
        if ($metrics['status'] !== 'Breached') {
            return;
        }

        $notificationService = app(TicketNotificationService::class);
        $dueAt = $metrics['due_at'] ?? $ticket->resolution_due_at;
        $ticketRef = 'TKT-' . str_pad((string) $ticketId, 4, '0', STR_PAD_LEFT);
        $ticketTitle = $ticket->title ?: 'Ticket #' . $ticketId;

        $categoryName = !empty($ticket->problem_category_ID)
            ? DB::table('problem_categories')->where('problem_category_ID', $ticket->problem_category_ID)->value('category_name')
            : 'General';
        $priorityName = !empty($ticket->priority_ID)
            ? DB::table('ticket_priorities')->where('priority_ID', $ticket->priority_ID)->value('priority_name')
            : 'Medium';
        $customerName = $ticket->client_name ?: (
            !empty($ticket->created_by) ? DB::table('clients')->where('id', $ticket->created_by)->value('client_name') : 'Valued Customer'
        );

        $overdueMinutes = $dueAt ? max(1, (int) Carbon::parse($dueAt)->diffInMinutes(now())) : 0;
        $overdueDuration = $overdueMinutes >= 60
            ? round($overdueMinutes / 60, 1) . ' hours overdue'
            : "{$overdueMinutes} minutes overdue";

        $notificationData = [
            'type' => 'overdue_sla_breach',
            'ticket_id' => $ticketId,
            'ticket_ref' => $ticketRef,
            'title' => $ticketTitle,
            'summary' => $ticketTitle,
            'customer' => $customerName,
            'category' => $categoryName,
            'priority' => $priorityName,
            'overdue_duration' => $overdueDuration,
            'sla_status' => 'Breached',
            'due_at' => $dueAt,
            'link' => "/ticketing/employee/machine",
            'deep_link' => "/ticketing/employee/machine",
            'is_reassignment' => true,
        ];

        $empTitle = "SLA Alert: Reassigned Ticket {$ticketRef} Already Breached";
        $empMessage = "Urgent: You have been assigned Ticket {$ticketRef}: \"{$ticketTitle}\" which has already breached its resolution SLA deadline ({$overdueDuration}). Immediate action required.";

        $notificationService->notifyRecipient(
            $newEmployeeId,
            'employee',
            $empTitle,
            $empMessage,
            $ticketId,
            $notificationData,
            'overdue_sla_breach'
        );

        $notificationService->sendTicketEmail(
            $newEmployeeId,
            $empTitle,
            $empMessage,
            $ticketId,
            $ticketTitle,
            $categoryName,
            $priorityName,
            'overdue_sla_breach',
            [
                'customer_name' => $customerName,
                'sla_deadline' => $dueAt,
                'overdue_duration' => $overdueDuration,
            ]
        );

        // Audit log entry for reassignment breach alert
        $systemEmpId = DB::table('employees')->value('emp_id') ?? 1;
        try {
            DB::table('ticket_audit_logs')->insert([
                'ticket_ID' => $ticketId,
                'action_type' => 'sla_breached_reassigned',
                'action_by_ID' => $systemEmpId,
                'actor_type' => 'system',
                'details' => json_encode([
                    'sla_status' => 'Breached',
                    'due_at' => $dueAt,
                    'overdue_duration' => $overdueDuration,
                    'new_employee_id' => $newEmployeeId,
                    'customer' => $customerName,
                    'category' => $categoryName,
                    'priority' => $priorityName,
                ]),
                'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("Failed to record sla_breached_reassigned audit log: {$e->getMessage()}");
        }
    }

    /**
     * Dispatch alert notifications to CS and assigned employees for an at-risk ticket.
     */
    protected function dispatchSlaRiskAlert($ticket, array $metrics, TicketNotificationService $notificationService): void
    {
        $ticketId = (int) $ticket->ticket_ID;
        $ticketRef = 'TKT-' . str_pad((string) $ticketId, 4, '0', STR_PAD_LEFT);
        $ticketTitle = $ticket->title ?: 'Ticket #' . $ticketId;
        $dueAt = $metrics['due_at'] ?? $ticket->resolution_due_at;
        $remainingMin = $metrics['time_remaining_minutes'] ?? 0;
        $remainingText = $remainingMin > 60 ? round($remainingMin / 60, 1) . ' hours' : "{$remainingMin} minutes";

        // Collect assigned employee IDs
        $assignedEmpIds = DB::table('ticket_assignments')
            ->where('ticket_ID', $ticketId)
            ->whereNull('completed_at')
            ->pluck('employee_ID')
            ->map(fn($id) => (int) $id)
            ->all();

        if (!empty($ticket->assigned_to)) {
            $assignedEmpIds[] = (int) $ticket->assigned_to;
        }
        $assignedEmpIds = array_values(array_unique(array_filter($assignedEmpIds)));

        $notificationData = [
            'type' => 'sla_breach_warning',
            'ticket_id' => $ticketId,
            'ticket_ref' => $ticketRef,
            'title' => $ticketTitle,
            'sla_status' => 'At Risk',
            'due_at' => $dueAt,
            'time_remaining_minutes' => $remainingMin,
            'link' => "/ticketing/employee/machine",
        ];

        $csTitle = "SLA Warning: Ticket {$ticketRef} At Risk";
        $csMessage = "Ticket {$ticketRef}: \"{$ticketTitle}\" is at risk of breaching SLA deadline ({$remainingText} remaining).";
        $notificationService->notifyCS($csTitle, $csMessage, $ticketId, $notificationData, null, 'sla_breach_warning');

        $empTitle = "SLA Warning: Assigned Ticket {$ticketRef} At Risk";
        $empMessage = "Warning: Assigned Ticket {$ticketRef}: \"{$ticketTitle}\" has {$remainingText} remaining before SLA breach. Please take prompt action.";
        foreach ($assignedEmpIds as $empId) {
            $notificationService->notifyRecipient(
                $empId,
                'employee',
                $empTitle,
                $empMessage,
                $ticketId,
                $notificationData,
                'sla_breach_warning'
            );
        }

        // Broadcast real-time change
        $notificationService->broadcastTicketChange('sla_at_risk', $ticketId, [
            'ticket_id' => $ticketId,
            'sla_status' => 'At Risk',
            'employee_ids' => $assignedEmpIds,
        ]);

        // Audit log entry
        $systemEmpId = DB::table('employees')->value('emp_id') ?? 1;
        try {
            DB::table('ticket_audit_logs')->insert([
                'ticket_ID' => $ticketId,
                'action_type' => 'sla_at_risk',
                'action_by_ID' => $systemEmpId,
                'actor_type' => 'system',
                'details' => json_encode([
                    'sla_status' => 'At Risk',
                    'due_at' => $dueAt,
                    'time_remaining_minutes' => $remainingMin,
                    'assigned_employees' => $assignedEmpIds,
                ]),
                'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            // Silently continue if audit log table structure varies
        }
    }

    /**
     * Resolve the designated department manager for a ticket (AC-9).
     */
    public function resolveDepartmentManagersForTicket($ticket): array
    {
        $categoryName = '';
        if (!empty($ticket->problem_category_ID)) {
            $categoryName = (string) (DB::table('problem_categories')->where('problem_category_ID', $ticket->problem_category_ID)->value('category_name') ?? '');
        }
        $catLower = strtolower($categoryName . ' ' . ($ticket->title ?? '') . ' ' . ($ticket->description ?? ''));

        // Check assigned employee's department or ticket department
        $assignedDept = '';
        if (!empty($ticket->assigned_to)) {
            $assignedDept = (string) (DB::table('employees')->where('emp_id', $ticket->assigned_to)->value('department') ?? '');
        }

        $hasPosLevel = \Illuminate\Support\Facades\Schema::hasColumn('employees', 'position_level');

        $targetDept = $assignedDept;
        if (empty($targetDept) && !empty($ticket->department_id)) {
            $targetDept = (string) (DB::table('departments')->where('id', $ticket->department_id)->value('name') ?? '');
        }

        $managers = collect();

        if (!empty($targetDept)) {
            $directManagers = DB::table('employees')
                ->whereRaw('LOWER(department) = ?', [strtolower(trim($targetDept))])
                ->where(function ($q) use ($hasPosLevel) {
                    if ($hasPosLevel) {
                        $q->whereIn(DB::raw('LOWER(COALESCE(position_level, ""))'), ['manager', 'lead', 'senior'])
                          ->orWhereRaw('LOWER(COALESCE(role, "")) LIKE ?', ['%manager%'])
                          ->orWhereRaw('LOWER(COALESCE(role, "")) LIKE ?', ['%lead%']);
                    } else {
                        $q->whereRaw('LOWER(COALESCE(role, "")) LIKE ?', ['%manager%'])
                          ->orWhereRaw('LOWER(COALESCE(role, "")) LIKE ?', ['%lead%']);
                    }
                })
                ->orderByRaw("CASE 
                    WHEN LOWER(COALESCE(position_level, '')) = 'manager' THEN 1 
                    WHEN LOWER(COALESCE(position_level, '')) = 'lead' THEN 2 
                    WHEN LOWER(COALESCE(position_level, '')) = 'senior' THEN 3 
                    ELSE 4 END")
                ->get();

            if ($directManagers->isNotEmpty()) {
                $managers = $managers->merge($directManagers);
            }
        }

        $fullContext = strtolower($catLower . ' ' . $assignedDept);

        $isIT = (bool) preg_match('/\b(it|information technology|software|network|system|server|database|computer|login|password|wifi|bug|api)\b/i', $fullContext);
        $isCS = (bool) preg_match('/\b(customer service|customer support|cs|inquiry|billing|account|client)\b/i', $fullContext);
        $isService = (bool) preg_match('/\b(service|biomedical|machine|hardware|device|calibration|repair|equipment|imaging|clinical|maintenance|radiology|facilities)\b/i', $fullContext);

        if ($isIT && !$isCS && !$isService) {
            $deptType = 'it';
        } elseif ($isCS && !$isService && !$isIT) {
            $deptType = 'cs';
        } else {
            $deptType = $isIT ? 'it' : 'service';
        }

        if (!empty($assignedDept)) {
            $adLower = strtolower($assignedDept);
            if (str_contains($adLower, 'customer')) {
                $deptType = 'cs';
            } elseif (str_contains($adLower, 'it') || str_contains($adLower, 'network')) {
                $deptType = 'it';
            } elseif (str_contains($adLower, 'service') || str_contains($adLower, 'biomedical') || str_contains($adLower, 'radiology') || str_contains($adLower, 'facilities')) {
                $deptType = 'service';
            }
        }

        $query = DB::table('employees')
            ->where(function ($q) use ($hasPosLevel) {
                if ($hasPosLevel) {
                    $q->whereRaw('LOWER(COALESCE(position_level, "")) = ?', ['manager'])
                      ->orWhereRaw('LOWER(COALESCE(position_level, "")) = ?', ['lead'])
                      ->orWhereRaw('LOWER(COALESCE(role, "")) LIKE ?', ['%manager%']);
                } else {
                    $q->whereRaw('LOWER(COALESCE(role, "")) LIKE ?', ['%manager%'])
                      ->orWhereRaw('LOWER(COALESCE(role, "")) LIKE ?', ['%lead%']);
                }
            });

        if ($deptType === 'it') {
            $query->where(function ($q) {
                $q->whereRaw('LOWER(COALESCE(department, "")) LIKE ?', ['%it%'])
                  ->orWhereRaw('LOWER(COALESCE(department, "")) LIKE ?', ['%network%'])
                  ->orWhereRaw('LOWER(COALESCE(role, "")) LIKE ?', ['%it%']);
            });
        } elseif ($deptType === 'cs') {
            $query->where(function ($q) {
                $q->whereRaw('LOWER(COALESCE(department, "")) LIKE ?', ['%customer%'])
                  ->orWhereRaw('LOWER(COALESCE(role, "")) LIKE ?', ['%customer%']);
            });
        } else {
            $query->where(function ($q) {
                $q->where(function ($sq) {
                    $sq->whereRaw('LOWER(COALESCE(department, "")) LIKE ?', ['%service%'])
                       ->orWhereRaw('LOWER(COALESCE(department, "")) LIKE ?', ['%biomedical%'])
                       ->orWhereRaw('LOWER(COALESCE(department, "")) LIKE ?', ['%radiology%'])
                       ->orWhereRaw('LOWER(COALESCE(department, "")) LIKE ?', ['%facilities%']);
                })->whereRaw('LOWER(COALESCE(department, "")) NOT LIKE ?', ['%customer%'])
                  ->whereRaw('LOWER(COALESCE(role, "")) NOT LIKE ?', ['%customer%']);
            });
        }

        if ($hasPosLevel) {
            $query->orderByRaw("CASE WHEN LOWER(COALESCE(position_level, '')) = 'manager' THEN 1 WHEN LOWER(COALESCE(position_level, '')) = 'lead' THEN 2 ELSE 3 END");
        }

        $deptManagers = $query->get();
        if ($deptManagers->isNotEmpty()) {
            $managers = $managers->merge($deptManagers);
        }

        // Fallback to Configuration Service
        try {
            $configUrl = env('CONFIGURATION_SERVICE_URL', 'http://configuration-service:8000');
            $res = \Illuminate\Support\Facades\Http::timeout(2)->get("{$configUrl}/api/ticket-configurations/department_managers");
            if ($res->successful()) {
                $val = $res->json('value') ?? $res->json();
                if (!empty($val[$deptType]['id'])) {
                    $cfgManager = DB::table('employees')->where('emp_id', $val[$deptType]['id'])->first();
                    if ($cfgManager) {
                        $managers->push($cfgManager);
                    }
                }
            }
        } catch (\Throwable $e) {}

        if ($managers->isEmpty()) {
            $defaultMgrId = match ($deptType) {
                'it' => 1038,
                'cs' => 1,
                default => 1028,
            };
            $defManager = DB::table('employees')->where('emp_id', $defaultMgrId)->first();
            if ($defManager) {
                $managers->push($defManager);
            }
        }

        return $managers->unique('emp_id')->values()->all();
    }

    public function resolveDepartmentManagerForTicket($ticket): ?object
    {
        $managers = $this->resolveDepartmentManagersForTicket($ticket);
        return !empty($managers) ? $managers[0] : null;
    }

    protected function unusedOldResolve($ticket): ?object
    {
        $categoryName = '';
        if (!empty($ticket->problem_category_ID)) {
            $categoryName = (string) (DB::table('problem_categories')->where('problem_category_ID', $ticket->problem_category_ID)->value('category_name') ?? '');
        }
        $catLower = strtolower($categoryName . ' ' . ($ticket->title ?? '') . ' ' . ($ticket->description ?? ''));

        // Check assigned employee's department or ticket department
        $assignedDept = '';
        if (!empty($ticket->assigned_to)) {
            $assignedDept = (string) (DB::table('employees')->where('emp_id', $ticket->assigned_to)->value('department') ?? '');
        }

        $hasPosLevel = \Illuminate\Support\Facades\Schema::hasColumn('employees', 'position_level');

        // 1. Direct department match from ticket or assigned employee
        $targetDept = $assignedDept;
        if (empty($targetDept) && !empty($ticket->department_id)) {
            $targetDept = (string) (DB::table('departments')->where('id', $ticket->department_id)->value('name') ?? '');
        }

        if (!empty($targetDept)) {
            $directManager = DB::table('employees')
                ->whereRaw('LOWER(department) = ?', [strtolower(trim($targetDept))])
                ->where(function ($q) use ($hasPosLevel) {
                    if ($hasPosLevel) {
                        $q->whereIn(DB::raw('LOWER(COALESCE(position_level, ""))'), ['manager', 'lead', 'senior'])
                          ->orWhereRaw('LOWER(COALESCE(role, "")) LIKE ?', ['%manager%'])
                          ->orWhereRaw('LOWER(COALESCE(role, "")) LIKE ?', ['%lead%']);
                    } else {
                        $q->whereRaw('LOWER(COALESCE(role, "")) LIKE ?', ['%manager%'])
                          ->orWhereRaw('LOWER(COALESCE(role, "")) LIKE ?', ['%lead%']);
                    }
                })
                ->orderByRaw("CASE 
                    WHEN LOWER(COALESCE(position_level, '')) = 'manager' THEN 1 
                    WHEN LOWER(COALESCE(position_level, '')) = 'lead' THEN 2 
                    WHEN LOWER(COALESCE(position_level, '')) = 'senior' THEN 3 
                    ELSE 4 END")
                ->first();

            if ($directManager) {
                return $directManager;
            }
        }

        $fullContext = strtolower($catLower . ' ' . $assignedDept);

        $isIT = (bool) preg_match('/\b(it|information technology|software|network|system|server|database|computer|login|password|wifi|bug|api)\b/i', $fullContext);
        $isCS = (bool) preg_match('/\b(customer service|customer support|cs|inquiry|billing|account|client)\b/i', $fullContext);
        $isService = (bool) preg_match('/\b(service|biomedical|machine|hardware|device|calibration|repair|equipment|imaging|clinical|maintenance|radiology|facilities)\b/i', $fullContext);

        if ($isIT && !$isCS && !$isService) {
            $deptType = 'it';
        } elseif ($isCS && !$isService && !$isIT) {
            $deptType = 'cs';
        } else {
            $deptType = $isIT ? 'it' : 'service';
        }

        if (!empty($assignedDept)) {
            $adLower = strtolower($assignedDept);
            if (str_contains($adLower, 'customer')) {
                $deptType = 'cs';
            } elseif (str_contains($adLower, 'it') || str_contains($adLower, 'network')) {
                $deptType = 'it';
            } elseif (str_contains($adLower, 'service') || str_contains($adLower, 'biomedical') || str_contains($adLower, 'radiology') || str_contains($adLower, 'facilities')) {
                $deptType = 'service';
            }
        }

        // Search employees table for manager (do NOT require is_active since is_active is an online presence flag)
        $query = DB::table('employees')
            ->where(function ($q) use ($hasPosLevel) {
                if ($hasPosLevel) {
                    $q->whereRaw('LOWER(COALESCE(position_level, "")) = ?', ['manager'])
                      ->orWhereRaw('LOWER(COALESCE(position_level, "")) = ?', ['lead'])
                      ->orWhereRaw('LOWER(COALESCE(role, "")) LIKE ?', ['%manager%']);
                } else {
                    $q->whereRaw('LOWER(COALESCE(role, "")) LIKE ?', ['%manager%'])
                      ->orWhereRaw('LOWER(COALESCE(role, "")) LIKE ?', ['%lead%']);
                }
            });

        if ($deptType === 'it') {
            $query->where(function ($q) {
                $q->whereRaw('LOWER(COALESCE(department, "")) LIKE ?', ['%it%'])
                  ->orWhereRaw('LOWER(COALESCE(department, "")) LIKE ?', ['%network%'])
                  ->orWhereRaw('LOWER(COALESCE(role, "")) LIKE ?', ['%it%']);
            });
        } elseif ($deptType === 'cs') {
            $query->where(function ($q) {
                $q->whereRaw('LOWER(COALESCE(department, "")) LIKE ?', ['%customer%'])
                  ->orWhereRaw('LOWER(COALESCE(role, "")) LIKE ?', ['%customer%']);
            });
        } else {
            // Service: must NOT match customer service
            $query->where(function ($q) {
                $q->where(function ($sq) {
                    $sq->whereRaw('LOWER(COALESCE(department, "")) LIKE ?', ['%service%'])
                       ->orWhereRaw('LOWER(COALESCE(department, "")) LIKE ?', ['%biomedical%'])
                       ->orWhereRaw('LOWER(COALESCE(department, "")) LIKE ?', ['%radiology%'])
                       ->orWhereRaw('LOWER(COALESCE(department, "")) LIKE ?', ['%facilities%']);
                })->whereRaw('LOWER(COALESCE(department, "")) NOT LIKE ?', ['%customer%'])
                  ->whereRaw('LOWER(COALESCE(role, "")) NOT LIKE ?', ['%customer%']);
            });
        }

        if ($hasPosLevel) {
            $query->orderByRaw("CASE WHEN LOWER(COALESCE(position_level, '')) = 'manager' THEN 1 WHEN LOWER(COALESCE(position_level, '')) = 'lead' THEN 2 ELSE 3 END");
        }

        $manager = $query->first();

        if ($manager) {
            return $manager;
        }

        // Fallback to Configuration Service
        try {
            $configUrl = env('CONFIGURATION_SERVICE_URL', 'http://configuration-service:8000');
            $res = \Illuminate\Support\Facades\Http::timeout(2)->get("{$configUrl}/api/ticket-configurations/department_managers");
            if ($res->successful()) {
                $val = $res->json('value') ?? $res->json();
                if (!empty($val[$deptType]['id'])) {
                    return DB::table('employees')->where('emp_id', $val[$deptType]['id'])->first();
                }
            }
        } catch (\Throwable $e) {}

        // Fallback to designated canonical manager IDs
        $defaultMgrId = match ($deptType) {
            'it' => 1038,       // Michael Scott (IT Support Manager)
            'cs' => 1,          // Ava Santos (Customer Support Manager)
            default => 1028,    // Carlos Mendoza (Service Manager)
        };

        return DB::table('employees')->where('emp_id', $defaultMgrId)->first();
    }
}
