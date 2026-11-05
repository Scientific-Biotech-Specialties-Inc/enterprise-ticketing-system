<?php

namespace App\Services;

use Carbon\Carbon;

/**
 * The one SLA outcome rule for admin and manager dashboards (spec 0031 AC-4, AC-5, AC-6).
 *
 *   Met       resolved or closed, and resolved_at (else closed_at) is on or before resolution_due_at.
 *   Breached  resolved or closed after resolution_due_at, or still open (not on hold) and past resolution_due_at.
 *   Excluded  no SLA configured, on hold or paused, open and not yet due, discarded or cancelled.
 *
 * A ticket belongs to a period by its outcome date: resolved_at (else closed_at) when finished,
 * resolution_due_at when it is an open breach. No other code path should decide met or breached
 * for the admin dashboard, admin reports, or manager dashboard.
 */
class SlaOutcomeService
{
    public const MET = 'met';
    public const BREACHED = 'breached';

    private const FINISHED_STATUSES = ['resolved', 'closed'];
    private const DROPPED_STATUSES = ['discarded', 'cancelled'];

    protected SLAService $slaService;

    public function __construct(?SLAService $slaService = null)
    {
        $this->slaService = $slaService ?? app(SLAService::class);
    }

    /**
     * Classify one ticket row. Needs status_name (or ticket_status_ID for on hold), resolution_due_at,
     * resolved_at, closed_at, sla_status and created_at. Returns 'met', 'breached', or null (excluded).
     */
    public function classify(object $ticket, ?Carbon $now = null): ?string
    {
        $now ??= now();
        $status = $this->statusOf($ticket);

        if (in_array($status, self::DROPPED_STATUSES, true)) {
            return null;
        }

        try {
            $metrics = $this->slaService->computeTicketSlaMetrics($ticket);
        } catch (\Throwable $e) {
            return null;
        }

        if (($metrics['status'] ?? '') === 'No SLA Configured' || !empty($metrics['is_paused'])) {
            return null;
        }

        $dueAt = $this->parse($ticket->resolution_due_at ?? null);
        if ($dueAt === null) {
            return null;
        }

        if (in_array($status, self::FINISHED_STATUSES, true)) {
            $endedAt = $this->endedAt($ticket);
            if ($endedAt === null) {
                return null;
            }

            return $endedAt->lte($dueAt) ? self::MET : self::BREACHED;
        }

        return $dueAt->lt($now) ? self::BREACHED : null;
    }

    /**
     * The date a ticket's SLA outcome counts on, or null when it has no outcome yet.
     */
    public function outcomeDate(object $ticket, ?Carbon $now = null): ?Carbon
    {
        $outcome = $this->classify($ticket, $now);
        if ($outcome === null) {
            return null;
        }

        if (in_array($this->statusOf($ticket), self::FINISHED_STATUSES, true)) {
            return $this->endedAt($ticket);
        }

        return $this->parse($ticket->resolution_due_at ?? null);
    }

    /**
     * The outcome of a ticket when its outcome date falls inside [from, to], else null.
     */
    public function classifyInWindow(object $ticket, Carbon $from, Carbon $to, ?Carbon $now = null): ?string
    {
        $outcome = $this->classify($ticket, $now);
        if ($outcome === null) {
            return null;
        }

        $date = $this->outcomeDate($ticket, $now);

        return ($date !== null && $date->betweenIncluded($from, $to)) ? $outcome : null;
    }

    /**
     * SQL prefilter for the SLA ticket set of a period. Rows it keeps still go through classifyInWindow,
     * so it only has to be wide enough, never exact.
     *
     * @param \Illuminate\Database\Query\Builder $query must join ticket_statuses
     */
    public function applyOutcomeWindow($query, Carbon $from, Carbon $to, string $ticketAlias = 't', string $statusAlias = 'ts')
    {
        $dueUntil = $to->copy()->min(now());
        $finished = self::FINISHED_STATUSES;
        $notOpen = array_merge(self::FINISHED_STATUSES, self::DROPPED_STATUSES);

        return $query->where(function ($w) use ($from, $to, $dueUntil, $finished, $notOpen, $ticketAlias, $statusAlias) {
            $w->where(function ($q) use ($from, $to, $finished, $ticketAlias, $statusAlias) {
                $q->whereIn($this->lowerColumn("{$statusAlias}.status_name"), $finished)
                  ->where(function ($d) use ($from, $to, $ticketAlias) {
                      $d->whereBetween("{$ticketAlias}.resolved_at", [$from, $to])
                        ->orWhere(function ($c) use ($from, $to, $ticketAlias) {
                            $c->whereNull("{$ticketAlias}.resolved_at")
                              ->whereBetween("{$ticketAlias}.closed_at", [$from, $to]);
                        });
                  });
            });

            if ($from->lte($dueUntil)) {
                $w->orWhere(function ($q) use ($from, $dueUntil, $notOpen, $ticketAlias, $statusAlias) {
                    $q->whereNotIn($this->lowerColumn("{$statusAlias}.status_name"), $notOpen)
                      ->whereBetween("{$ticketAlias}.resolution_due_at", [$from, $dueUntil]);
                });
            }
        });
    }

    /**
     * Compliance rate: met / (met + breached) * 100, one decimal. Null when there is nothing to measure.
     */
    public function rate(int $met, int $breached): ?float
    {
        $total = $met + $breached;

        return $total > 0 ? round(($met / $total) * 100, 1) : null;
    }

    /**
     * Count met and breached tickets in a window.
     *
     * @param iterable<object> $tickets
     * @return array{met: int, breached: int, rate: ?float}
     */
    public function tally(iterable $tickets, Carbon $from, Carbon $to, ?Carbon $now = null): array
    {
        $met = 0;
        $breached = 0;
        foreach ($tickets as $ticket) {
            $outcome = $this->classifyInWindow($ticket, $from, $to, $now);
            if ($outcome === self::MET) {
                $met++;
            } elseif ($outcome === self::BREACHED) {
                $breached++;
            }
        }

        return ['met' => $met, 'breached' => $breached, 'rate' => $this->rate($met, $breached)];
    }

    /**
     * True when the ticket is open (not finished, dropped, or on hold) and past its resolution deadline.
     * Same breach rule the manager breached queue uses (AC-7).
     */
    public function isOpenBreach(object $ticket, ?Carbon $now = null): bool
    {
        return !in_array($this->statusOf($ticket), self::FINISHED_STATUSES, true)
            && $this->classify($ticket, $now) === self::BREACHED;
    }

    protected function statusOf(object $ticket): string
    {
        return strtolower(trim((string) ($ticket->status_name ?? $ticket->status ?? '')));
    }

    protected function endedAt(object $ticket): ?Carbon
    {
        return $this->parse($ticket->resolved_at ?? null) ?? $this->parse($ticket->closed_at ?? null);
    }

    protected function parse($value): ?Carbon
    {
        if ($value === null || $value === '') {
            return null;
        }

        try {
            return $value instanceof Carbon ? $value->copy() : Carbon::parse($value);
        } catch (\Throwable $e) {
            return null;
        }
    }

    protected function lowerColumn(string $column)
    {
        return \Illuminate\Support\Facades\DB::raw("LOWER(TRIM({$column}))");
    }
}
