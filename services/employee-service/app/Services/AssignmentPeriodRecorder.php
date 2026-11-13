<?php

namespace App\Services;

use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Spec 0039: writes ticket_assignment_periods, one row per stretch of time one employee held one ticket.
 *
 * Mirrored from ticket-service (App\Services\AssignmentPeriodRecorder), which owns the table through its
 * migration. Keep the two in step: only addBusinessHours() differs between them.
 *
 * Every method must run inside the transaction of the assignment change it records, and never swallows a
 * failure: if a period write fails, the caller's transaction rolls back (AC-21).
 *
 * Invariants (enforced here, MySQL has no partial unique index):
 * - at most one open period (released_at null) per ticket and employee; open() on an open period is a no op
 * - accepted_at and released_at are never earlier than assigned_at; accepted_at is set once
 * - rows are never deleted; only accepted_at, paused_at, paused_seconds, ack_paused_seconds,
 *   released_at and release_reason are ever updated
 */
class AssignmentPeriodRecorder
{
    public const TABLE = 'ticket_assignment_periods';

    public const REASON_REASSIGNED = 'reassigned';
    public const REASON_RETURNED_TO_CS = 'returned_to_cs';
    public const REASON_RESOLVED = 'resolved';
    public const REASON_CLOSED = 'closed';
    public const REASON_DISCARDED = 'discarded';

    public const REASONS = [
        self::REASON_REASSIGNED,
        self::REASON_RETURNED_TO_CS,
        self::REASON_RESOLVED,
        self::REASON_CLOSED,
        self::REASON_DISCARDED,
    ];

    /** Ticket status ids that end a holding period (see TicketStateMachine). */
    private const STATUS_ID_RESOLVED = 3;
    private const STATUS_ID_CLOSED = 4;
    private const STATUS_ID_DISCARDED = 9;
    private const STATUS_ID_ON_HOLD = 11;

    protected ?BusinessHoursCalculator $businessHours;

    public function __construct(?BusinessHoursCalculator $businessHours = null)
    {
        $this->businessHours = $businessHours;
    }

    /**
     * Start a holding period (AC-1). No op when the employee already holds the ticket.
     */
    public function open(int $ticketId, int $employeeId, ?int $assignedBy = null, ?Carbon $at = null): void
    {
        $at = $at ? $at->copy() : now();

        $alreadyOpen = DB::table(self::TABLE)
            ->where('ticket_ID', $ticketId)
            ->where('employee_ID', $employeeId)
            ->whereNull('released_at')
            ->lockForUpdate()
            ->exists();
        if ($alreadyOpen) {
            return;
        }

        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket) {
            throw new \RuntimeException("Cannot record an assignment period: ticket {$ticketId} not found.");
        }

        $ackDueAt = $this->ackDueAt($ticket, $at);

        DB::table(self::TABLE)->insert([
            'ticket_ID' => $ticketId,
            'employee_ID' => $employeeId,
            'assigned_by' => $assignedBy ?: null,
            'assigned_at' => $at,
            'ack_due_at' => $ackDueAt,
            'accepted_at' => null,
            // A ticket assigned while On Hold starts its period paused (AC-4).
            'paused_at' => $this->ticketIsOnHold($ticket) ? $at : null,
            'paused_seconds' => 0,
            'ack_paused_seconds' => 0,
            'released_at' => null,
            'release_reason' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * Mark the employee's open period accepted (AC-2). Accepting twice never moves accepted_at.
     */
    public function accept(int $ticketId, int $employeeId, ?Carbon $at = null): void
    {
        $at = $at ? $at->copy() : now();

        $period = DB::table(self::TABLE)
            ->where('ticket_ID', $ticketId)
            ->where('employee_ID', $employeeId)
            ->whereNull('released_at')
            ->lockForUpdate()
            ->first();
        if (!$period || $period->accepted_at !== null) {
            return;
        }

        $acceptedAt = $this->notBefore($at, $period->assigned_at);
        $update = ['accepted_at' => $acceptedAt, 'updated_at' => now()];

        // Accepted while paused: the pause so far was before acceptance, so it is banked into
        // ack_paused_seconds now and the rest of the pause counts as ordinary hold time.
        if ($period->paused_at !== null) {
            $elapsed = $this->secondsBetween($period->paused_at, $acceptedAt);
            $update['paused_seconds'] = (int) $period->paused_seconds + $elapsed;
            $update['ack_paused_seconds'] = (int) $period->ack_paused_seconds + $elapsed;
            $update['paused_at'] = $acceptedAt;
        }

        DB::table(self::TABLE)->where('id', $period->id)->update($update);
    }

    /**
     * Pause every open period on the ticket (AC-4). Already paused periods are left alone.
     */
    public function pause(int $ticketId, ?Carbon $at = null): void
    {
        $at = $at ? $at->copy() : now();

        DB::table(self::TABLE)
            ->where('ticket_ID', $ticketId)
            ->whereNull('released_at')
            ->whereNull('paused_at')
            ->update(['paused_at' => $at, 'updated_at' => now()]);
    }

    /**
     * Resume every paused open period on the ticket (AC-4).
     */
    public function resume(int $ticketId, ?Carbon $at = null): void
    {
        $at = $at ? $at->copy() : now();

        $periods = DB::table(self::TABLE)
            ->where('ticket_ID', $ticketId)
            ->whereNull('released_at')
            ->whereNotNull('paused_at')
            ->lockForUpdate()
            ->get();

        foreach ($periods as $period) {
            DB::table(self::TABLE)->where('id', $period->id)->update(
                $this->closePause($period, $at) + ['updated_at' => now()]
            );
        }
    }

    /**
     * End open periods on the ticket (AC-3). $employeeIds null releases every holder.
     * A period released while paused closes its pause first.
     *
     * @param array<int, int|string>|null $employeeIds
     * @return int number of periods released
     */
    public function release(int $ticketId, string $reason, ?array $employeeIds = null, ?Carbon $at = null): int
    {
        if (!in_array($reason, self::REASONS, true)) {
            throw new \InvalidArgumentException("Unknown assignment period release reason '{$reason}'.");
        }
        if ($employeeIds !== null && $employeeIds === []) {
            return 0;
        }

        $at = $at ? $at->copy() : now();

        $query = DB::table(self::TABLE)
            ->where('ticket_ID', $ticketId)
            ->whereNull('released_at');
        if ($employeeIds !== null) {
            $query->whereIn('employee_ID', array_map('intval', $employeeIds));
        }
        $periods = $query->lockForUpdate()->get();

        foreach ($periods as $period) {
            $releasedAt = $this->notBefore($at, $period->assigned_at);
            $update = [
                'released_at' => $releasedAt,
                'release_reason' => $reason,
                'updated_at' => now(),
            ];
            if ($period->paused_at !== null) {
                $update = $this->closePause($period, $releasedAt) + $update;
            }

            DB::table(self::TABLE)->where('id', $period->id)->update($update);
        }

        return $periods->count();
    }

    /**
     * Release every holder when a ticket moves into Resolved, Closed or Discarded.
     * Any other status is ignored, so callers may pass whatever status they just wrote.
     */
    public function releaseForStatus(int $ticketId, int $statusId, ?Carbon $at = null): int
    {
        $reason = match ($statusId) {
            self::STATUS_ID_RESOLVED => self::REASON_RESOLVED,
            self::STATUS_ID_CLOSED => self::REASON_CLOSED,
            self::STATUS_ID_DISCARDED => self::REASON_DISCARDED,
            default => null,
        };

        return $reason === null ? 0 : $this->release($ticketId, $reason, null, $at);
    }

    /**
     * Accept by deadline for a period starting at $assignedAt (AC-1): business hours from assignment,
     * using the response time limit of the SLA source the ticket resolved to. Null when no source applies.
     */
    public function ackDueAt(object $ticket, Carbon $assignedAt): ?Carbon
    {
        $limit = $this->responseLimitMinutes($ticket);
        if ($limit === null) {
            return null;
        }

        return $this->addBusinessHours($assignedAt->copy(), $limit);
    }

    /**
     * Response time limit (minutes) of the SLA source recorded on the ticket. Those source columns are
     * written by the rule chain that sets tickets.response_due_at (branch category policy, then branch
     * priority override, then sla_rules, then the default SLA), at most one of them set.
     */
    public function responseLimitMinutes(object $ticket): ?int
    {
        if (!empty($ticket->branch_sla_policy_id)) {
            $policy = DB::table('branch_sla_policies')->where('id', $ticket->branch_sla_policy_id)->first();
            // Same fallback the rule chain applies to an empty branch policy limit.
            return $policy ? ((int) $policy->response_time_limit ?: 30) : null;
        }

        if (!empty($ticket->branch_priority_override_id)) {
            $limit = DB::table('branch_priority_overrides')->where('id', $ticket->branch_priority_override_id)->value('response_time_limit');
            return $limit === null ? null : (int) $limit;
        }

        if (!empty($ticket->sla_rule_id)) {
            $limit = DB::table('sla_rules')->where('id', $ticket->sla_rule_id)->value('response_time_limit');
            return $limit === null ? null : (int) $limit;
        }

        if (!empty($ticket->sla_ID)) {
            $sla = DB::table('slas')->where('sla_ID', $ticket->sla_ID)->first();
            return $sla ? (int) ($sla->response_time_minutes ?? 1440) : null;
        }

        return null;
    }

    protected function addBusinessHours(Carbon $start, int $minutes): Carbon
    {
        return ($this->businessHours ?? app(BusinessHoursCalculator::class))->addBusinessHours($start, $minutes);
    }

    protected function ticketIsOnHold(object $ticket): bool
    {
        return !empty($ticket->sla_paused_at) || (int) ($ticket->ticket_status_ID ?? 0) === self::STATUS_ID_ON_HOLD;
    }

    /**
     * Fields that end a pause at $at: elapsed time goes to paused_seconds, and also to
     * ack_paused_seconds while the period is not yet accepted.
     */
    protected function closePause(object $period, Carbon $at): array
    {
        $elapsed = $this->secondsBetween($period->paused_at, $at);

        $fields = [
            'paused_at' => null,
            'paused_seconds' => (int) $period->paused_seconds + $elapsed,
        ];
        if ($period->accepted_at === null) {
            $fields['ack_paused_seconds'] = (int) $period->ack_paused_seconds + $elapsed;
        }

        return $fields;
    }

    protected function secondsBetween($from, Carbon $to): int
    {
        $from = Carbon::parse($from);

        return $to->gt($from) ? (int) $from->diffInSeconds($to) : 0;
    }

    protected function notBefore(Carbon $at, $floor): Carbon
    {
        $floor = Carbon::parse($floor);

        return $at->lt($floor) ? $floor : $at;
    }
}
