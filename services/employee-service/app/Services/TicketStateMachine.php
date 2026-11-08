<?php

namespace App\Services;

use App\Exceptions\InvalidTicketTransitionException;
use App\Services\SLAService;
use App\Services\TicketCacheService;
use App\Services\TicketNotificationService;
use Carbon\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class TicketStateMachine
{
    public const STATE_OPEN = 'Open';
    public const STATE_IN_PROGRESS_CS = 'In Progress (CS-owned)';
    public const STATE_ASSIGNED = 'Assigned';
    public const STATE_REASSIGNED = 'Reassigned';
    public const STATE_IN_PROGRESS_EMPLOYEE = 'In Progress (Employee-owned)';
    public const STATE_RESOLVED = 'Resolved';
    public const STATE_CLOSED = 'Closed';
    public const STATE_REOPENED = 'Reopened';
    public const STATE_ON_HOLD = 'On Hold/Pending';
    public const STATE_CANCELLED = 'Cancelled';

    public const OWNER_CS = 'cs';
    public const OWNER_EMPLOYEE = 'employee';

    public const STATUS_ID_OPEN = 1;
    public const STATUS_ID_IN_PROGRESS = 2;
    public const STATUS_ID_RESOLVED = 3;
    public const STATUS_ID_CLOSED = 4;
    public const STATUS_ID_CANCELLED = 5;
    public const STATUS_ID_ESCALATED = 5;
    public const STATUS_ID_PENDING_EVALUATION = 6;
    public const STATUS_ID_PENDING = 7;
    public const STATUS_ID_REOPENED = 8;
    public const STATUS_ID_DISCARDED = 9;
    public const STATUS_ID_PENDING_ASSIGNMENT = 10;
    public const STATUS_ID_ON_HOLD = 11;

    public const DEFAULT_TRANSITIONS = [
        'Open' => [
            'allowed' => ['In Progress (CS-owned)', 'Assigned', 'In Progress (Employee-owned)', 'Closed', 'Cancelled'],
            'type' => 'editable',
        ],
        'In Progress (CS-owned)' => [
            'allowed' => ['On Hold/Pending', 'Assigned', 'Resolved', 'Closed'],
            'type' => 'editable',
        ],
        'Assigned' => [
            'allowed' => ['Reassigned', 'In Progress (Employee-owned)', 'Assigned', 'On Hold/Pending'],
            'type' => 'editable',
        ],
        'Reassigned' => [
            'allowed' => ['In Progress (Employee-owned)', 'Assigned', 'On Hold/Pending'],
            'type' => 'editable',
        ],
        'In Progress (Employee-owned)' => [
            'allowed' => ['On Hold/Pending', 'Reassigned', 'Resolved', 'Assigned', 'Closed'],
            'type' => 'editable',
        ],
        'Resolved' => [
            'allowed' => ['Closed', 'In Progress (Employee-owned)'],
            'type' => 'editable',
        ],
        'Closed' => [
            'allowed' => ['Reopened'],
            'type' => 'editable',
        ],
        'Reopened' => [
            'allowed' => ['In Progress (CS-owned)'],
            'type' => 'fixed',
        ],
        'On Hold/Pending' => [
            'allowed' => [],
            'type' => 'contextual',
        ],
        'Cancelled' => [
            'allowed' => [],
            'type' => 'terminal',
        ],
    ];

    public function resolveState($ticket): string
    {
        if (is_numeric($ticket)) {
            $ticket = DB::table('tickets')->where('ticket_ID', $ticket)->first();
        }

        if (!$ticket) {
            return self::STATE_OPEN;
        }

        $statusId = (int) $ticket->ticket_status_ID;
        $inProgressOwner = $ticket->in_progress_owner ?? null;

        switch ($statusId) {
            case self::STATUS_ID_OPEN:
                return self::STATE_OPEN;

            case self::STATUS_ID_PENDING_ASSIGNMENT:
                $hasPendingReassign = DB::table('reassignment_requests')
                    ->where('ticket_id', $ticket->ticket_ID)
                    ->where('status', 'pending')
                    ->exists();
                if ($hasPendingReassign) {
                    return self::STATE_REASSIGNED;
                }
                return self::STATE_ASSIGNED;

            case self::STATUS_ID_IN_PROGRESS:
                if ($inProgressOwner === self::OWNER_CS) {
                    return self::STATE_IN_PROGRESS_CS;
                }
                return self::STATE_IN_PROGRESS_EMPLOYEE;

            case self::STATUS_ID_ON_HOLD:
            case self::STATUS_ID_PENDING:
                return self::STATE_ON_HOLD;

            case self::STATUS_ID_PENDING_EVALUATION:
                return self::STATE_IN_PROGRESS_EMPLOYEE;

            case self::STATUS_ID_RESOLVED:
                return self::STATE_RESOLVED;

            case self::STATUS_ID_CLOSED:
                return self::STATE_CLOSED;

            case self::STATUS_ID_REOPENED:
                return self::STATE_REOPENED;

            case self::STATUS_ID_CANCELLED:
            case self::STATUS_ID_DISCARDED:
                return self::STATE_CANCELLED;

            default:
                $statusName = DB::table('ticket_statuses')->where('ticket_status_ID', $statusId)->value('status_name');
                $norm = strtolower(trim((string)$statusName));
                if ($norm === 'open') return self::STATE_OPEN;
                if ($norm === 'resolved') return self::STATE_RESOLVED;
                if ($norm === 'closed') return self::STATE_CLOSED;
                if ($norm === 'discarded' || $norm === 'cancelled') return self::STATE_CANCELLED;
                if ($norm === 'on hold' || $norm === 'pending') return self::STATE_ON_HOLD;
                if ($norm === 'pending assignment') return self::STATE_ASSIGNED;
                if ($norm === 'reopened') return self::STATE_REOPENED;
                return self::STATE_OPEN;
        }
    }

    public function getAllowedTransitions(string $currentState): array
    {
        try {
            $rules = Cache::remember('ticket:config:transitions', 300, function () {
                $configUrl = env('CONFIGURATION_SERVICE_URL', 'http://configuration-service:8000');
                $resp = Http::timeout(5)->get("{$configUrl}/api/ticket-configurations/transitions");
                if ($resp->successful()) {
                    $json = $resp->json();
                    return $json['value'] ?? $json;
                }
                return self::DEFAULT_TRANSITIONS;
            });
            if (isset($rules[$currentState]['allowed'])) {
                $allowed = (array) $rules[$currentState]['allowed'];
                return $allowed;
            }
        } catch (\Throwable $e) {}

        $allowed = self::DEFAULT_TRANSITIONS[$currentState]['allowed'] ?? [];
        return $allowed;
    }

    public function canTransition(string $fromState, string $toState): bool
    {
        if ($fromState === self::STATE_CANCELLED) {
            return false;
        }

        if ($fromState === self::STATE_ON_HOLD) {
            return in_array($toState, [
                self::STATE_IN_PROGRESS_CS,
                self::STATE_IN_PROGRESS_EMPLOYEE,
                self::STATE_CANCELLED,
            ], true);
        }

        if ($fromState === self::STATE_REOPENED && $toState === self::STATE_IN_PROGRESS_CS) {
            return true;
        }

        // Staying in the same state (e.g. reassigning an Assigned ticket) is not a transition.
        if ($fromState === $toState) {
            return true;
        }

        // Every other editable transition is governed by the superadmin Transition Matrix.
        $allowed = $this->getAllowedTransitions($fromState);
        return in_array($toState, $allowed, true);
    }

    public function validateTransition($ticket, string $fromState, string $toState, array $context = []): void
    {
        if (is_numeric($ticket)) {
            $ticket = DB::table('tickets')->where('ticket_ID', $ticket)->first();
        }

        if ($fromState === self::STATE_CANCELLED) {
            throw new InvalidTicketTransitionException(
                $fromState,
                $toState,
                [],
                "Cannot transition ticket from terminal status 'Cancelled'. No further transitions are permitted."
            );
        }

        if ($fromState === self::STATE_ON_HOLD) {
            $validResumes = [self::STATE_IN_PROGRESS_CS, self::STATE_IN_PROGRESS_EMPLOYEE, self::STATE_CANCELLED];
            if (!in_array($toState, $validResumes, true)) {
                throw new InvalidTicketTransitionException(
                    $fromState,
                    $toState,
                    $validResumes,
                    "Cannot transition ticket on hold to '{$toState}'. Tickets on hold can only resume to 'In Progress (CS-owned)' or 'In Progress (Employee-owned)'."
                );
            }
            return;
        }

        if (!$this->canTransition($fromState, $toState)) {
            $allowed = $this->getAllowedTransitions($fromState);
            throw new InvalidTicketTransitionException($fromState, $toState, $allowed);
        }
    }
}
