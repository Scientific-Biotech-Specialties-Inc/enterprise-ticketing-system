<?php

namespace App\Services;

use Carbon\Carbon;

/**
 * Spec 0039: per employee performance figures computed from ticket_assignment_periods.
 *
 * Input rows are plain objects. A period row carries the period columns (id, ticket_ID, employee_ID,
 * assigned_at, ack_due_at, accepted_at, paused_at, paused_seconds, ack_paused_seconds, released_at,
 * release_reason). A ticket row carries what SlaOutcomeService::classify needs.
 *
 * Nothing here reads ticket_assignments or tickets.first_response_at.
 */
class AssignmentPeriodMetrics
{
    public const RESPONSE_MET = 'met';
    public const RESPONSE_BREACHED = 'breached';

    public const SCORE_SCORED = 'scored';
    public const SCORE_NOT_ENOUGH_DATA = 'not_enough_data';

    private const FINISHING_REASONS = [AssignmentPeriodRecorder::REASON_RESOLVED, AssignmentPeriodRecorder::REASON_CLOSED];

    protected SlaOutcomeService $slaOutcomes;

    public function __construct(?SlaOutcomeService $slaOutcomes = null)
    {
        $this->slaOutcomes = $slaOutcomes ?? app(SlaOutcomeService::class);
    }

    /**
     * Accept by time of a period (AC-5): ack_due_at + ack_paused_seconds, plus the current pause
     * while the period is paused and not accepted. Null when the period has no ack_due_at.
     */
    public function acceptBy(object $period, Carbon $now): ?Carbon
    {
        if (empty($period->ack_due_at)) {
            return null;
        }

        $acceptBy = Carbon::parse($period->ack_due_at)->addSeconds((int) ($period->ack_paused_seconds ?? 0));

        if (!empty($period->paused_at) && empty($period->accepted_at)) {
            $pausedAt = Carbon::parse($period->paused_at);
            if ($now->gt($pausedAt)) {
                $acceptBy->addSeconds((int) $pausedAt->diffInSeconds($now));
            }
        }

        return $acceptBy;
    }

    /**
     * Pending (AC-7): open, not accepted, and the accept by time has not passed (or the period is paused).
     * A period with no accept by deadline stays Pending until it is accepted or released.
     */
    public function isPending(object $period, Carbon $now): bool
    {
        if (!empty($period->released_at) || !empty($period->accepted_at)) {
            return false;
        }
        if (!empty($period->paused_at)) {
            return true;
        }

        $acceptBy = $this->acceptBy($period, $now);

        return $acceptBy === null || $now->lte($acceptBy);
    }

    /**
     * Response outcome (AC-9): met, breached, or null (no ack_due_at, or no outcome yet).
     * An unaccepted period that was released is judged at its release time, so a holder is never
     * charged for a deadline that passed after the ticket left them.
     */
    public function responseOutcome(object $period, Carbon $now): ?string
    {
        $acceptBy = $this->acceptBy($period, $now);
        if ($acceptBy === null) {
            return null;
        }

        if (!empty($period->accepted_at)) {
            return Carbon::parse($period->accepted_at)->lte($acceptBy) ? self::RESPONSE_MET : self::RESPONSE_BREACHED;
        }

        $judgedAt = !empty($period->released_at) ? Carbon::parse($period->released_at) : $now;
        if (!empty($period->released_at) && $judgedAt->gt($now)) {
            $judgedAt = $now;
        }

        return $judgedAt->gt($acceptBy) ? self::RESPONSE_BREACHED : null;
    }

    /**
     * Resolution outcome attribution (AC-11) for every ticket. Returns period id => 'met' | 'breached'.
     * A breach goes to the period(s) holding the ticket at resolution_due_at; a met outcome to the
     * period(s) released as resolved or closed (the latest such release, if the ticket was reopened).
     *
     * @param iterable<object> $allPeriods every period of the tickets, any employee, any date
     * @param array<int, object> $ticketsById
     * @return array<int, string>
     */
    public function attributeResolutionOutcomes(iterable $allPeriods, array $ticketsById, Carbon $now): array
    {
        $periodsByTicket = [];
        foreach ($allPeriods as $period) {
            $periodsByTicket[(int) $period->ticket_ID][] = $period;
        }

        $attributed = [];
        foreach ($periodsByTicket as $ticketId => $periods) {
            $ticket = $ticketsById[$ticketId] ?? null;
            if ($ticket === null) {
                continue;
            }

            $outcome = $this->slaOutcomes->classify($ticket, $now);
            if ($outcome === SlaOutcomeService::BREACHED) {
                $due = Carbon::parse($ticket->resolution_due_at);
                foreach ($periods as $period) {
                    if ($this->heldAt($period, $due)) {
                        $attributed[(int) $period->id] = SlaOutcomeService::BREACHED;
                    }
                }
            } elseif ($outcome === SlaOutcomeService::MET) {
                foreach ($this->finishingPeriods($periods) as $period) {
                    $attributed[(int) $period->id] = SlaOutcomeService::MET;
                }
            }
        }

        return $attributed;
    }

    /**
     * Periods credited with a ticket's finish (met outcome, CSAT): released as resolved or closed,
     * at the latest such release time.
     *
     * @param array<int, object> $periods periods of one ticket
     * @return array<int, object>
     */
    public function finishingPeriods(array $periods): array
    {
        $finishing = array_values(array_filter(
            $periods,
            fn ($p) => in_array($p->release_reason ?? null, self::FINISHING_REASONS, true) && !empty($p->released_at)
        ));
        if ($finishing === []) {
            return [];
        }

        $latest = max(array_map(fn ($p) => Carbon::parse($p->released_at)->getTimestamp(), $finishing));

        return array_values(array_filter($finishing, fn ($p) => Carbon::parse($p->released_at)->getTimestamp() === $latest));
    }

    /**
     * Figures for one employee from their periods in the window (AC-7 to AC-17).
     *
     * @param array<int, object> $periods the employee's periods whose assigned_at is in the window
     * @param array<int, string> $resolutionOutcomes from attributeResolutionOutcomes()
     * @param array<int, float> $ratingByPeriod period id => CSAT rating credited to it
     */
    public function summarize(array $periods, array $resolutionOutcomes, array $ratingByPeriod, Carbon $now): array
    {
        $pending = 0;
        $assigned = 0;
        $resolved = 0;
        $responseMet = 0;
        $responseBreached = 0;
        $slaMet = 0;
        $slaBreached = 0;
        $judged = 0;
        $responseSeconds = [];
        $resolutionSeconds = [];
        $ratings = [];

        foreach ($periods as $period) {
            if ($this->isPending($period, $now)) {
                $pending++;
                continue;
            }

            $assigned++;
            $id = (int) $period->id;

            $response = $this->responseOutcome($period, $now);
            if ($response === self::RESPONSE_MET) {
                $responseMet++;
            } elseif ($response === self::RESPONSE_BREACHED) {
                $responseBreached++;
            }

            $resolution = $resolutionOutcomes[$id] ?? null;
            if ($resolution === SlaOutcomeService::MET) {
                $slaMet++;
            } elseif ($resolution === SlaOutcomeService::BREACHED) {
                $slaBreached++;
            }

            if ($response !== null || $resolution !== null) {
                $judged++;
            }

            if (!empty($period->accepted_at)) {
                $seconds = $this->secondsBetween($period->assigned_at, $period->accepted_at) - (int) ($period->ack_paused_seconds ?? 0);
                $responseSeconds[] = max(0, $seconds);
            }

            $finished = in_array($period->release_reason ?? null, self::FINISHING_REASONS, true);
            if ($finished) {
                $resolved++;
                if (!empty($period->accepted_at)) {
                    $workPaused = (int) ($period->paused_seconds ?? 0) - (int) ($period->ack_paused_seconds ?? 0);
                    $seconds = $this->secondsBetween($period->accepted_at, $period->released_at) - max(0, $workPaused);
                    $resolutionSeconds[] = max(0, $seconds);
                }
            }

            if (isset($ratingByPeriod[$id])) {
                $ratings[] = (float) $ratingByPeriod[$id];
            }
        }

        $responseRate = $this->slaOutcomes->rate($responseMet, $responseBreached);
        $slaRate = $this->slaOutcomes->rate($slaMet, $slaBreached);
        $csatScore = $ratings !== [] ? round(array_sum($ratings) / count($ratings), 2) : null;

        [$score, $scoreStatus] = $this->performanceScore($slaRate, $responseRate, $csatScore, $judged);

        return [
            'performance_score' => $score,
            'score_status' => $scoreStatus,
            'judged_periods' => $judged,
            'pending_count' => $pending,
            'tickets_assigned' => $assigned,
            'tickets_resolved' => $resolved,
            'resolution_rate' => $assigned > 0 ? round(($resolved / $assigned) * 100, 1) : null,
            'sla_compliance_rate' => $slaRate,
            'sla_met_count' => $slaMet,
            'sla_breached_count' => $slaBreached,
            'response_sla_rate' => $responseRate,
            'response_met_count' => $responseMet,
            'response_breached_count' => $responseBreached,
            'average_response_minutes' => $responseSeconds !== [] ? round((array_sum($responseSeconds) / count($responseSeconds)) / 60, 1) : null,
            'average_resolution_hours' => $resolutionSeconds !== [] ? round((array_sum($resolutionSeconds) / count($resolutionSeconds)) / 3600, 1) : null,
            'csat_score' => $csatScore,
            'csat_reviews_count' => count($ratings),
        ];
    }

    /**
     * Performance Score (AC-16, AC-17): weighted average of the parts that exist, weights rescaled to 100.
     *
     * @return array{0: ?float, 1: string}
     */
    public function performanceScore(?float $resolutionSlaRate, ?float $responseSlaRate, ?float $csatScore, int $judgedPeriods): array
    {
        $minimum = (int) config('ticketing.performance.min_judged_periods', 3);
        if ($judgedPeriods < $minimum) {
            return [null, self::SCORE_NOT_ENOUGH_DATA];
        }

        $weights = (array) config('ticketing.performance.score_weights', ['resolution_sla' => 50, 'response_sla' => 30, 'csat' => 20]);
        $parts = [
            'resolution_sla' => $resolutionSlaRate,
            'response_sla' => $responseSlaRate,
            'csat' => $csatScore !== null ? ($csatScore / 5) * 100 : null,
        ];

        $weighted = 0.0;
        $totalWeight = 0.0;
        foreach ($parts as $key => $value) {
            $weight = (float) ($weights[$key] ?? 0);
            if ($value === null || $weight <= 0) {
                continue;
            }
            $weighted += $value * $weight;
            $totalWeight += $weight;
        }

        if ($totalWeight <= 0) {
            return [null, self::SCORE_NOT_ENOUGH_DATA];
        }

        return [round($weighted / $totalWeight, 1), self::SCORE_SCORED];
    }

    protected function heldAt(object $period, Carbon $moment): bool
    {
        if (Carbon::parse($period->assigned_at)->gt($moment)) {
            return false;
        }

        return empty($period->released_at) || Carbon::parse($period->released_at)->gt($moment);
    }

    protected function secondsBetween($from, $to): int
    {
        $from = Carbon::parse($from);
        $to = Carbon::parse($to);

        return $to->gt($from) ? (int) $from->diffInSeconds($to) : 0;
    }
}
