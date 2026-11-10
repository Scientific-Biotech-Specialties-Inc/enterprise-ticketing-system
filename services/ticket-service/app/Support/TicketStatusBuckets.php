<?php

namespace App\Support;

use App\Services\TicketStateMachine as S;

/**
 * One definition of "active" and "closed" for every dashboard (CS, employee, customer, admin,
 * super admin), so the same ticket counts the same way no matter who is looking.
 *
 * Ids come from the ticket_statuses table through TicketStateMachine::STATUS_ID_*. Never hard code
 * status ids in a dashboard query: a stale list once made SuperAdmin treat "Pending Assignment"
 * (10) as finished and "Discarded" (9) as active.
 */
final class TicketStatusBuckets
{
    /** Work is over: Resolved, Closed, Discarded (Cancelled shares the Discarded id). */
    public const FINISHED_IDS = [S::STATUS_ID_RESOLVED, S::STATUS_ID_CLOSED, S::STATUS_ID_DISCARDED];

    /** Permanently done: Closed or Discarded. A Resolved ticket can still be reopened. */
    public const CLOSED_IDS = [S::STATUS_ID_CLOSED, S::STATUS_ID_DISCARDED];

    public static function isActive(int $statusId): bool
    {
        return !in_array($statusId, self::FINISHED_IDS, true);
    }
}
