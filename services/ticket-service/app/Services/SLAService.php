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

    /** The four columns that record where a ticket's SLA came from (spec 0037). */
    public const SLA_SOURCE_COLUMNS = ['branch_sla_policy_id', 'branch_priority_override_id', 'sla_rule_id', 'sla_ID'];

    /**
     * Source column values for a resolveSlaPolicy() result: the resolved source is set
     * and the other three are null, so at most one is ever non null (spec 0037, AC-8, AC-9).
     */
    public function slaSourceColumns(array $resolved): array
    {
        $columns = [];
        foreach (self::SLA_SOURCE_COLUMNS as $column) {
            $columns[$column] = $resolved[$column] ?? null;
        }
        return $columns;
    }

    /** True when resolveSlaPolicy() found no SLA source at all. */
    public function hasNoSlaSource(array $resolved): bool
    {
        foreach (self::SLA_SOURCE_COLUMNS as $column) {
            if (!empty($resolved[$column])) {
                return false;
            }
        }
        return true;
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
            // Customer tickets are created against the department sent by the client
            // (e.g. Service = 1), which is not stored on the ticket. Reuse the department
            // of the SLA rule assigned at creation so recalculation stays consistent.
            if (!empty($ticket->sla_rule_id)) {
                $ruleDeptId = DB::table('sla_rules')->where('id', $ticket->sla_rule_id)->value('department_id');
                if (!empty($ruleDeptId)) {
                    return (int) $ruleDeptId;
                }
            }
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
     * Recalculate SLA deadlines for every open ticket using the current SLA rules
     * and business hours. Used after a superadmin changes business hours or limits,
     * since those changes otherwise only affect deadlines calculated afterwards.
     *
     * @return array{recalculated:int, failed:int}
     */
    public function recalculateOpenTickets(): array
    {
        $ids = DB::table('tickets as t')
            ->leftJoin('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->where(function ($q) {
                $q->whereNull('ts.status_name')
                  ->orWhereNotIn(DB::raw('LOWER(ts.status_name)'), ['closed', 'resolved', 'discarded', 'cancelled']);
            })
            ->pluck('t.ticket_ID');

        $recalculated = 0;
        $failed = 0;
        foreach ($ids as $id) {
            try {
                $this->recalculateForReclassification((int) $id);
                $recalculated++;
            } catch (\Throwable $e) {
                $failed++;
                \Illuminate\Support\Facades\Log::warning("SLA bulk recalculation failed for ticket {$id}: " . $e->getMessage());
            }
        }

        return ['recalculated' => $recalculated, 'failed' => $failed];
    }

    /**
     * Calculate a future due date that only counts configured working hours.
     *
     * Working hours come from the superadmin "business_hours" configuration
     * (timezone, start/end time, working days). Counting happens in that local
     * timezone so "08:00 to 17:00" means the business's own clock, and the result
     * is returned in the original timezone. When business hours are disabled
     * the limit is counted around the clock (24/7).
     *
     * @param array $config Optional override (same shape as getBusinessHoursConfig()).
     *                      The legacy key 'businessHoursEnabled' is still honoured.
     */
    public function addBusinessHours(Carbon $start, int $minutes, array $config = []): Carbon
    {
        if ($minutes <= 0) {
            return $start->copy();
        }

        $hours = $this->normalizeBusinessHours(!empty($config) ? $config : TicketConfigurationService::getBusinessHoursConfig());

        if (!$hours['enabled']) {
            return $start->copy()->addMinutes($minutes);
        }

        $originalTimezone = $start->getTimezone();
        $current = $this->advanceToNextBusinessWindow($start->copy()->setTimezone($hours['timezone']), $hours);
        $remainingMinutes = $minutes;

        while ($remainingMinutes > 0) {
            $endOfDay = $current->copy()->setTime($hours['endHour'], $hours['endMinute'], 0);
            $availableToday = intdiv(max(0, $endOfDay->getTimestamp() - $current->getTimestamp()), 60);

            if ($remainingMinutes <= $availableToday) {
                return $current->addMinutes($remainingMinutes)->setTimezone($originalTimezone);
            }

            $remainingMinutes -= $availableToday;
            $current = $this->advanceToNextBusinessWindow(
                $current->addDay()->setTime($hours['startHour'], $hours['startMinute'], 0),
                $hours
            );
        }

        return $current->setTimezone($originalTimezone);
    }

    /**
     * Advance a timestamp (already in the business timezone) to the next working moment.
     */
    protected function advanceToNextBusinessWindow(Carbon $time, ?array $hours = null): Carbon
    {
        $hours = $hours ?? $this->normalizeBusinessHours(TicketConfigurationService::getBusinessHoursConfig());
        $current = $time->copy();

        // Bounded loop: skipping at most two weeks guarantees termination.
        for ($i = 0; $i < 15; $i++) {
            $startOfDay = $current->copy()->setTime($hours['startHour'], $hours['startMinute'], 0);
            $endOfDay = $current->copy()->setTime($hours['endHour'], $hours['endMinute'], 0);

            if (!in_array($current->dayOfWeekIso, $hours['workingDays'], true) || $current->gte($endOfDay)) {
                $current = $current->addDay()->setTime($hours['startHour'], $hours['startMinute'], 0);
                continue;
            }

            return $current->lt($startOfDay) ? $startOfDay : $current;
        }

        return $current;
    }

    /**
     * Normalise a business hours config into parsed hour/minute parts.
     */
    protected function normalizeBusinessHours(array $config): array
    {
        $defaults = TicketConfigurationService::DEFAULT_BUSINESS_HOURS;
        $enabled = array_key_exists('enabled', $config)
            ? (bool) $config['enabled']
            : (bool) ($config['businessHoursEnabled'] ?? $defaults['enabled']);

        $timezone = (string) ($config['timezone'] ?? $defaults['timezone']);
        if (!in_array($timezone, \DateTimeZone::listIdentifiers(), true)) {
            $timezone = 'UTC';
        }

        [$startHour, $startMinute] = array_map('intval', explode(':', (string) ($config['startTime'] ?? $defaults['startTime'])) + [0, 0]);
        [$endHour, $endMinute] = array_map('intval', explode(':', (string) ($config['endTime'] ?? $defaults['endTime'])) + [0, 0]);
        if ($endHour * 60 + $endMinute <= $startHour * 60 + $startMinute) {
            [$startHour, $startMinute, $endHour, $endMinute] = [8, 0, 17, 0];
        }

        $days = array_values(array_filter(
            array_map('intval', (array) ($config['workingDays'] ?? $defaults['workingDays'])),
            fn ($d) => $d >= 1 && $d <= 7
        ));

        return [
            'enabled' => $enabled,
            'timezone' => $timezone,
            'startHour' => $startHour,
            'startMinute' => $startMinute,
            'endHour' => $endHour,
            'endMinute' => $endMinute,
            'workingDays' => $days ?: [1, 2, 3, 4, 5],
        ];
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

        // Spec 0037 (AC-8): due dates only exist when an SLA source resolved. With no
        // source, the ticket is honestly "No SLA Configured" rather than given made up dates.
        $noSource = $this->hasNoSlaSource($resolved);
        $responseDueAt = $noSource ? null : $this->addBusinessHours($createdAtObj, (int) $resolved['response_time_limit']);
        $resolutionDueAt = $noSource ? null : $this->addBusinessHours($createdAtObj, (int) $resolved['resolution_time_limit']);

        $slaStatus = $noSource ? 'No SLA Configured' : 'On Track';

        $update = [
            'branch_id' => $branchId,
        ] + $this->slaSourceColumns($resolved) + [
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
            'response_due_at' => $responseDueAt?->toDateTimeString(),
            'resolution_due_at' => $resolutionDueAt?->toDateTimeString(),
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
        // Spec 0039 (AC-4): pause every open assignment period. Runs even when the ticket clock was
        // already paused, so period history never misses a hold; the recorder is idempotent.
        (new AssignmentPeriodRecorder($this))->pause($ticketId);

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
            // Spec 0039 (AC-4): resume paused assignment periods (idempotent, see pauseClock).
            (new AssignmentPeriodRecorder($this))->resume($ticketId);

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
            if ($this->hasNoSlaSource($resolvedPolicy)) {
                $slaStatus = 'No SLA Configured';
            } elseif ($now->gt($newResolutionDueAt)) {
                $slaStatus = 'Breached';
            } elseif ($now->diffInMinutes($newResolutionDueAt, false) <= 240) {
                $slaStatus = 'At Risk';
            }

            // A ticket on hold keeps its clock paused; resume() extends the deadline later.
            if (!empty($ticket->sla_paused_at)) {
                $slaStatus = 'Paused';
            }

            $update = [
                'problem_category_ID' => $categoryId,
                'priority_ID' => $priorityId,
                'branch_id' => $branch,
            ] + $this->slaSourceColumns($resolvedPolicy) + [
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

            // Spec 0037: no SLA source means no due dates (No SLA Configured, never a guessed deadline).
            if ($this->hasNoSlaSource($resolvedPolicy)) {
                $update['resolution_due_at'] = null;
                $update['response_due_at'] = null;
                $update['resolution_sla_status'] = null;
                $newResponseDueAt = null;
            }

            DB::table('tickets')->where('ticket_ID', $ticketId)->update($update);

            return [
                'ticket_ID' => $ticketId,
                'old_response_due_at' => $oldResponseDueAt,
                'new_response_due_at' => is_string($newResponseDueAt) ? $newResponseDueAt : ($newResponseDueAt ? $newResponseDueAt->toDateTimeString() : null),
                'old_resolution_due_at' => $oldResolutionDueAt,
                'new_resolution_due_at' => $update['resolution_due_at'] ? $newResolutionDueAt->toDateTimeString() : null,
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
                'updated_at' => $now,
            ] + $this->slaSourceColumns($resolvedPolicy);

            if ($this->hasNoSlaSource($resolvedPolicy)) {
                $update['resolution_due_at'] = null;
                $newResolutionDueAt = null;
            }

            DB::table('tickets')->where('ticket_ID', $ticketId)->update($update);

            return [
                'ticket_ID' => $ticketId,
                'resolution_due_at' => $newResolutionDueAt?->toDateTimeString(),
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

    /** Minutes before resolution_due_at when an open ticket counts as At Risk (AC-13 step 6). */
    public const AT_RISK_MINUTES = 240;

    /**
     * Compute comprehensive SLA metrics (status, due date, minutes remaining) for ticket monitoring.
     * Consistently used by CS queue and ticket detail view.
     *
     * Spec 0037 (AC-13) precedence, shared with slaStatusKeySql() so row badges, summary
     * cards, and SQL filters always agree:
     *   1. sla_status 'SLA Unavailable' stays Unavailable
     *   2. No SLA Configured: no source column and no resolution_due_at
     *   3. Paused: the ticket is On Hold
     *   4. Closed or Resolved: Breached if resolved after resolution_due_at, else Compliant
     *   5. Breached: now is past resolution_due_at
     *   6. At Risk: within 4 hours of resolution_due_at
     *   7. On Track
     * Tickets with no due date never get a guessed (24 or 48 hour) status.
     */
    public function computeTicketSlaMetrics($ticket): array
    {
        $result = fn (string $status, $dueAt = null, $remaining = null, array $flags = []) => array_merge([
            'status' => $status,
            'due_at' => $dueAt ? $dueAt->toIso8601String() : null,
            'time_remaining_minutes' => $remaining,
            'is_breached' => false,
            'is_at_risk' => false,
            'is_paused' => false,
        ], $flags);

        if (!$ticket) {
            return $result('On Track');
        }

        $now = now();
        $statusName = strtolower(trim((string) ($ticket->status_name ?? $ticket->status ?? '')));
        $isClosedOrResolved = in_array($statusName, ['closed', 'resolved'], true);
        $isOnHold = in_array($statusName, ['on hold', 'on-hold', 'paused'], true) || ((int) ($ticket->ticket_status_ID ?? 0) === 11);

        $resDueAtRaw = $ticket->resolution_due_at ?? null;
        $resDueAt = $resDueAtRaw ? Carbon::parse($resDueAtRaw) : null;
        $resolvedAtRaw = ($ticket->resolved_at ?? null) ?: ($ticket->closed_at ?? null);
        $resolvedAt = $resolvedAtRaw ? Carbon::parse($resolvedAtRaw) : null;

        // 1. SLA assignment failed at creation; tickets:backfill-sla repairs it.
        if (($ticket->sla_status ?? null) === 'SLA Unavailable') {
            return $result('SLA Unavailable', null, null, ['is_unavailable' => true]);
        }

        // 2. No SLA source and no due date.
        $hasSource = false;
        foreach (self::SLA_SOURCE_COLUMNS as $column) {
            if (!empty($ticket->{$column} ?? null)) {
                $hasSource = true;
                break;
            }
        }
        if (!$hasSource && !$resDueAt) {
            return $result('No SLA Configured', null, null, ['is_unavailable' => true]);
        }

        // 3. On Hold: the clock is paused.
        if ($isOnHold) {
            return $result('Paused', $resDueAt, $resDueAt ? max(0, $now->diffInMinutes($resDueAt, false)) : null, ['is_paused' => true]);
        }

        // 4. Closed or Resolved.
        if ($isClosedOrResolved) {
            $isBreached = $resDueAt !== null && ($resolvedAt ?: $now)->gt($resDueAt);
            return $result($isBreached ? 'Breached' : 'Compliant', $resDueAt, 0, ['is_breached' => $isBreached]);
        }

        if (!$resDueAt) {
            return $result('On Track');
        }

        // 5. Breached.
        if ($now->gt($resDueAt)) {
            return $result('Breached', $resDueAt, 0, ['is_breached' => true]);
        }

        // 6. At Risk.
        $remaining = (int) $now->diffInMinutes($resDueAt, false);
        if ($resDueAt->lte($now->copy()->addMinutes(self::AT_RISK_MINUTES))) {
            return $result('At Risk', $resDueAt, $remaining, ['is_at_risk' => true]);
        }

        // 7. On Track.
        return $result('On Track', $resDueAt, $remaining);
    }

    /**
     * SQL form of computeTicketSlaMetrics() (spec 0037, AC-13, AC-14). Returns a CASE
     * expression and its bindings that yield one key per ticket row:
     * unavailable, no_sla, paused, compliant, breached, at_risk, on_track.
     *
     * @param string $t  tickets alias
     * @param string $ts ticket_statuses alias (must be joined)
     * @return array{0: string, 1: array}
     */
    public function slaStatusKeySql(string $t = 't', string $ts = 'ts', ?Carbon $now = null): array
    {
        $now = ($now ?? now())->copy();
        $nowStr = $now->toDateTimeString();
        $riskStr = $now->copy()->addMinutes(self::AT_RISK_MINUTES)->toDateTimeString();

        $noSource = implode(' AND ', array_map(fn ($c) => "{$t}.{$c} IS NULL", self::SLA_SOURCE_COLUMNS));
        $due = "{$t}.resolution_due_at";
        $status = "LOWER(COALESCE({$ts}.status_name, ''))";

        $sql = "(CASE"
            . " WHEN {$t}.sla_status = 'SLA Unavailable' THEN 'unavailable'"
            . " WHEN ({$noSource}) AND {$due} IS NULL THEN 'no_sla'"
            . " WHEN {$status} IN ('on hold', 'on-hold', 'paused') OR {$t}.ticket_status_ID = 11 THEN 'paused'"
            . " WHEN {$status} IN ('closed', 'resolved') THEN"
            . "   (CASE WHEN {$due} IS NOT NULL AND COALESCE({$t}.resolved_at, {$t}.closed_at, ?) > {$due} THEN 'breached' ELSE 'compliant' END)"
            . " WHEN {$due} IS NULL THEN 'on_track'"
            . " WHEN {$due} < ? THEN 'breached'"
            . " WHEN {$due} <= ? THEN 'at_risk'"
            . " ELSE 'on_track' END)";

        return [$sql, [$nowStr, $nowStr, $riskStr]];
    }

    /** Map a UI or API SLA filter value to a slaStatusKeySql() key, or null for "all". */
    public static function normalizeSlaFilterKey(?string $value): ?string
    {
        $v = strtolower(trim((string) $value));
        $v = str_replace([' ', '-'], '_', $v);
        return match ($v) {
            '', 'all', 'all_sla', 'all_sla_statuses' => null,
            'breached' => 'breached',
            'at_risk', 'atrisk' => 'at_risk',
            'on_track', 'ontrack' => 'on_track',
            'paused' => 'paused',
            'compliant' => 'compliant',
            'no_sla', 'no_sla_configured', 'nosla' => 'no_sla',
            'unavailable', 'sla_unavailable' => 'unavailable',
            default => 'invalid',
        };
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
        // $managers can be empty (no department manager), so never rely on the foreach variable here.
        $lastManager = collect($managers)->filter()->last();
        $notificationService->broadcastTicketChange('sla_breach', $ticketId, [
            'ticket_id' => $ticketId,
            'sla_status' => 'Breached',
            'employee_ids' => $assignedEmpIds,
            'manager_id' => $lastManager ? (int) $lastManager->emp_id : null,
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
                'actor_role' => 'system',
                'is_system' => 1,
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
                'is_system' => 1,
                'actor_role' => 'system',
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

        $hasPosLevel = true;

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

        $hasPosLevel = true;

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
