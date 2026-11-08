<?php

namespace App\Services;

use App\Events\TicketChanged;
use App\Exceptions\InvalidTicketTransitionException;
use App\Services\SLAService;
use App\Services\TicketCacheService;
use App\Services\TicketConfigurationService;
use App\Services\TicketNotificationService;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class TicketStateMachine
{
    // Canonical State Constants (Matching transition configuration & UI)
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
    public const STATE_ESCALATED = 'Escalated';

    // Internal In-Progress Ownership Constants
    public const OWNER_CS = 'cs';
    public const OWNER_EMPLOYEE = 'employee';

    // DB Ticket Status IDs
    public const STATUS_ID_OPEN = 1;
    public const STATUS_ID_IN_PROGRESS = 2;
    public const STATUS_ID_RESOLVED = 3;
    public const STATUS_ID_CLOSED = 4;
    public const STATUS_ID_ESCALATED = 5;
    public const STATUS_ID_PENDING_EVALUATION = 6;
    public const STATUS_ID_PENDING = 7;
    public const STATUS_ID_REOPENED = 8;
    public const STATUS_ID_DISCARDED = 9;
    public const STATUS_ID_CANCELLED = 9;
    public const STATUS_ID_PENDING_ASSIGNMENT = 10;
    public const STATUS_ID_ON_HOLD = 11;

    protected TicketCacheService $cacheService;
    protected TicketNotificationService $notificationService;
    protected SLAService $slaService;

    public function __construct(
        TicketCacheService $cacheService,
        TicketNotificationService $notificationService,
        SLAService $slaService
    ) {
        $this->cacheService = $cacheService;
        $this->notificationService = $notificationService;
        $this->slaService = $slaService;
    }

    /**
     * Resolve the granular lifecycle state of a ticket record.
     */
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

            case self::STATUS_ID_ESCALATED:
                return self::STATE_ESCALATED;

            case self::STATUS_ID_CANCELLED:
            case self::STATUS_ID_DISCARDED:
                return self::STATE_CANCELLED;

            default:
                $statusName = DB::table('ticket_statuses')->where('ticket_status_ID', $statusId)->value('status_name');
                $norm = strtolower(trim((string)$statusName));
                if ($norm === 'open') return self::STATE_OPEN;
                if ($norm === 'resolved') return self::STATE_RESOLVED;
                if ($norm === 'closed') return self::STATE_CLOSED;
                if ($norm === 'escalated') return self::STATE_ESCALATED;
                if ($norm === 'discarded' || $norm === 'cancelled') return self::STATE_CANCELLED;
                if ($norm === 'on hold' || $norm === 'pending') return self::STATE_ON_HOLD;
                if ($norm === 'pending assignment') return self::STATE_ASSIGNED;
                if ($norm === 'reopened') return self::STATE_REOPENED;
                return self::STATE_OPEN;
        }
    }

    /**
     * Resolve target state from user input, action name, or status ID.
     */
    public function resolveTargetState(string|int $target, $ticket = null, array $context = []): string
    {
        if (is_numeric($target)) {
            $id = (int) $target;
            switch ($id) {
                case self::STATUS_ID_OPEN:
                    return self::STATE_OPEN;
                case self::STATUS_ID_IN_PROGRESS:
                    if (($context['owner'] ?? null) === self::OWNER_CS || ($ticket && $ticket->in_progress_owner === self::OWNER_CS)) {
                        return self::STATE_IN_PROGRESS_CS;
                    }
                    return self::STATE_IN_PROGRESS_EMPLOYEE;
                case self::STATUS_ID_RESOLVED:
                    return self::STATE_RESOLVED;
                case self::STATUS_ID_CLOSED:
                    return self::STATE_CLOSED;
                case self::STATUS_ID_REOPENED:
                    return self::STATE_REOPENED;
                case self::STATUS_ID_ESCALATED:
                    return self::STATE_ESCALATED;
                case self::STATUS_ID_DISCARDED:
                    return self::STATE_CANCELLED;
                case self::STATUS_ID_PENDING_ASSIGNMENT:
                    return self::STATE_ASSIGNED;
                case self::STATUS_ID_ON_HOLD:
                case self::STATUS_ID_PENDING:
                    return self::STATE_ON_HOLD;
                case self::STATUS_ID_PENDING_EVALUATION:
                    return self::STATE_IN_PROGRESS_EMPLOYEE;
                default:
                    return self::STATE_OPEN;
            }
        }

        $str = trim((string) $target);
        $lower = strtolower($str);

        // Actions
        if ($lower === 'reopen') return self::STATE_REOPENED;
        if ($lower === 'assign') return self::STATE_ASSIGNED;
        if ($lower === 'reassign' || $lower === 'reassign_request') return self::STATE_REASSIGNED;
        if ($lower === 'accept') return self::STATE_IN_PROGRESS_EMPLOYEE;
        if ($lower === 'hold') return self::STATE_ON_HOLD;
        if ($lower === 'resume') {
            // If held from Pending Assignment (status 10), resume back to Assigned
            if ($ticket && (int)($ticket->held_from_status_ID ?? 0) === self::STATUS_ID_PENDING_ASSIGNMENT) {
                return self::STATE_ASSIGNED;
            }
            $prev = $ticket ? ($ticket->previous_in_progress_owner ?? $ticket->in_progress_owner) : null;
            return $prev === self::OWNER_CS ? self::STATE_IN_PROGRESS_CS : self::STATE_IN_PROGRESS_EMPLOYEE;
        }
        if ($lower === 'resolve') return self::STATE_RESOLVED;
        if ($lower === 'close') return self::STATE_CLOSED;
        if ($lower === 'escalate' || $lower === 'escalated') return self::STATE_ESCALATED;
        if ($lower === 'cancel' || $lower === 'discard') return self::STATE_CANCELLED;

        // Exact names
        foreach ([
            self::STATE_OPEN,
            self::STATE_IN_PROGRESS_CS,
            self::STATE_ASSIGNED,
            self::STATE_REASSIGNED,
            self::STATE_IN_PROGRESS_EMPLOYEE,
            self::STATE_RESOLVED,
            self::STATE_CLOSED,
            self::STATE_REOPENED,
            self::STATE_ON_HOLD,
            self::STATE_CANCELLED,
            self::STATE_ESCALATED,
        ] as $canonical) {
            if (strtolower($canonical) === $lower) {
                return $canonical;
            }
        }

        // Substring / fuzzy match
        if (str_contains($lower, 'cs') && str_contains($lower, 'progress')) {
            return self::STATE_IN_PROGRESS_CS;
        }
        if (str_contains($lower, 'employee') && str_contains($lower, 'progress')) {
            return self::STATE_IN_PROGRESS_EMPLOYEE;
        }
        if (str_contains($lower, 'hold') || str_contains($lower, 'pending')) {
            return self::STATE_ON_HOLD;
        }

        return $str;
    }

    /**
     * Retrieve the list of permitted next statuses from the current status.
     */
    public function getAllowedTransitions(string $currentState): array
    {
        $rules = TicketConfigurationService::getTransitionsConfig();
        if (isset($rules[$currentState]['allowed'])) {
            return (array) $rules[$currentState]['allowed'];
        }
        return TicketConfigurationService::DEFAULT_TRANSITIONS[$currentState]['allowed'] ?? [];
    }

    /**
     * Determine if a transition is permitted.
     *
     * The superadmin Transition Matrix (configuration "transitions") is the source of
     * truth for every editable state. Only system rules that are not editable in the
     * matrix are hardcoded here: Cancelled is terminal, On Hold resumes contextually,
     * Reopened routes to CS automatically, and rejected proof returns to In Progress.
     * Staying in the same state (e.g. reassigning an Assigned ticket) is not a transition.
     */
    public function canTransition(string $fromState, string $toState, array $context = []): bool
    {
        if ($fromState === self::STATE_CANCELLED) {
            return false;
        }

        if ($fromState === $toState) {
            return true;
        }

        // Contextual resume from On Hold/Pending (non-editable in the matrix)
        if ($fromState === self::STATE_ON_HOLD) {
            return in_array($toState, [
                self::STATE_ASSIGNED,
                self::STATE_IN_PROGRESS_CS,
                self::STATE_IN_PROGRESS_EMPLOYEE,
                self::STATE_CANCELLED,
            ], true);
        }

        // Reopened rule: Reopened automatically transitions to In Progress (CS-owned)
        if ($fromState === self::STATE_REOPENED && $toState === self::STATE_IN_PROGRESS_CS) {
            return true;
        }

        // Rejected proof returns the ticket to In Progress
        if (!empty($context['proof_rejected']) && in_array($toState, [
            self::STATE_IN_PROGRESS_EMPLOYEE,
            self::STATE_IN_PROGRESS_CS,
        ], true)) {
            return true;
        }

        $allowed = $this->getAllowedTransitions($fromState);
        return in_array($toState, $allowed, true);
    }

    /**
     * Validate an attempted state transition and throw an InvalidTicketTransitionException if rejected.
     */
    public function validateTransition($ticket, string $fromState, string $toState, array $context = []): void
    {
        if (is_numeric($ticket)) {
            $ticket = DB::table('tickets')->where('ticket_ID', $ticket)->first();
        }

        // 1. Terminal status check
        if ($fromState === self::STATE_CANCELLED) {
            throw new InvalidTicketTransitionException(
                $fromState,
                $toState,
                [],
                "Cannot transition ticket from terminal status 'Cancelled'. No further transitions are permitted."
            );
        }

        // 2. Reopening validation (Closed or Resolved -> Reopened / In Progress CS-owned)
        if ($toState === self::STATE_REOPENED || ($toState === self::STATE_IN_PROGRESS_CS && in_array($fromState, [self::STATE_CLOSED, self::STATE_RESOLVED], true))) {
            if (!in_array($fromState, [self::STATE_CLOSED, self::STATE_RESOLVED], true)) {
                throw new InvalidTicketTransitionException(
                    $fromState,
                    $toState,
                    $this->getAllowedTransitions($fromState),
                    "Cannot reopen ticket: Tickets can only be reopened from 'Closed' or 'Resolved' status (current status is '{$fromState}')."
                );
            }

            $windowConfig = TicketConfigurationService::getWindowConfig();
            if (!($windowConfig['reopenEnabled'] ?? true)) {
                throw new InvalidTicketTransitionException(
                    $fromState,
                    $toState,
                    [],
                    'Cannot reopen ticket: Reopening tickets is disabled by administrative operational policy.'
                );
            }

            $reopenDays = (int) ($windowConfig['reopenWindowDays'] ?? 2);
            $allowedHours = $reopenDays * 24;
            $cutoffTime = $ticket && $ticket->closed_at
                ? Carbon::parse($ticket->closed_at)
                : ($ticket && $ticket->resolved_at ? Carbon::parse($ticket->resolved_at) : null);

            if ($cutoffTime && $cutoffTime->diffInHours(now()) > $allowedHours) {
                $dayLabel = $reopenDays === 1 ? '1 day' : "{$reopenDays} days";
                throw new InvalidTicketTransitionException(
                    $fromState,
                    $toState,
                    [],
                    "Cannot reopen ticket: More than {$dayLabel} ({$allowedHours} hours) have passed since resolution/closure."
                );
            }

            return;
        }

        // 3. Contextual resume check for On Hold/Pending
        if ($fromState === self::STATE_ON_HOLD) {
            $validResumes = [
                self::STATE_ASSIGNED,
                self::STATE_IN_PROGRESS_CS,
                self::STATE_IN_PROGRESS_EMPLOYEE,
                self::STATE_CANCELLED,
            ];
            if (!in_array($toState, $validResumes, true)) {
                throw new InvalidTicketTransitionException(
                    $fromState,
                    $toState,
                    $validResumes,
                    "Cannot transition ticket on hold to '{$toState}'. Tickets on hold can only resume to 'Assigned', 'In Progress (CS-owned)' or 'In Progress (Employee-owned)'."
                );
            }
            return;
        }

        // Contextual proof rejection / pending evaluation transition
        if (
            (!empty($context['proof_rejected']) || ($ticket && (int)($ticket->ticket_status_ID ?? 0) === self::STATUS_ID_PENDING_EVALUATION))
            && in_array($toState, [self::STATE_IN_PROGRESS_EMPLOYEE, self::STATE_IN_PROGRESS_CS], true)
        ) {
            return;
        }

        // 4. Standard transition table validation
        if (!$this->canTransition($fromState, $toState, $context)) {
            $allowed = $this->getAllowedTransitions($fromState);
            throw new InvalidTicketTransitionException($fromState, $toState, $allowed);
        }
    }

    /**
     * Apply a state transition to a ticket, ensuring validation, DB update, audit logging,
     * cache invalidation, and real-time broadcasting.
     */
    public function applyTransition(
        int|object $ticket,
        string|int $targetStateOrAction,
        array $context = [],
        $actor = null
    ): array {
        $ticketId = is_numeric($ticket) ? (int)$ticket : (int)$ticket->ticket_ID;
        $ticketRecord = DB::table('tickets')->where('ticket_ID', $ticketId)->first();

        if (!$ticketRecord) {
            return ['status' => 404, 'data' => ['message' => 'Ticket not found']];
        }

        $currentState = $this->resolveState($ticketRecord);
        $resolvedTargetState = $this->resolveTargetState($targetStateOrAction, $ticketRecord, $context);

        // Crucial requirement: Reopened tickets automatically transition to In Progress (CS-owned)
        if ($resolvedTargetState === self::STATE_REOPENED) {
            $resolvedTargetState = self::STATE_IN_PROGRESS_CS;
        }

        // If target is already current state and no internal ownership changes, no-op
        if ($currentState === $resolvedTargetState && empty($context['force'])) {
            return [
                'status' => 200,
                'data' => [
                    'message' => "Ticket is already in state '{$currentState}'.",
                    'ticket' => $ticketRecord,
                    'state' => $currentState,
                    'transitioned' => false,
                ],
            ];
        }

        // Validate the attempted transition
        $this->validateTransition($ticketRecord, $currentState, $resolvedTargetState, $context);

        // Determine actor details without default fallback to 1
        $actorType = 'employee';
        $actorId = 0;
        if (is_array($actor)) {
            $actorType = $actor['type'] ?? 'employee';
            $actorId = (int) ($actor['id'] ?? $actor['emp_id'] ?? 0);
        } elseif ($actor instanceof \App\Models\Client || ($actor->role ?? '') === 'customer') {
            $actorType = 'customer';
            $actorId = (int) ($actor->id ?? $actor->client_id ?? 0);
        } elseif ($actor && (isset($actor->emp_id) || isset($actor->id))) {
            $actorId = (int) ($actor->emp_id ?? $actor->id);
            $roleClean = strtolower(str_replace([' ', '_', '-'], '', (string) ($actor->role ?? '')));
            if (in_array($roleClean, ['superadmin', 'admin', 'cs', 'customerservice'], true)) {
                $actorType = $roleClean;
            } else {
                $actorType = 'employee';
            }
        } else {
            $actorType = 'system';
            $actorId = 0;
        }

        $updateFields = [
            'updated_at' => now(),
        ];

        // Leaving On Hold (resume or cancel): clear held_from_status_ID and hold_reason
        if ($currentState === self::STATE_ON_HOLD) {
            $updateFields['held_from_status_ID'] = null;
            $updateFields['hold_reason'] = null;
        }

        $auditAction = 'status_transition';
        $auditDetails = [
            'from_state' => $currentState,
            'to_state' => $resolvedTargetState,
            'action' => is_string($targetStateOrAction) ? $targetStateOrAction : 'transition',
        ];

        // Map resolvedTargetState to database fields
        switch ($resolvedTargetState) {
            case self::STATE_OPEN:
                $updateFields['ticket_status_ID'] = self::STATUS_ID_OPEN;
                $updateFields['in_progress_owner'] = null;
                $auditAction = 'create';
                break;

            case self::STATE_ASSIGNED:
                $updateFields['ticket_status_ID'] = self::STATUS_ID_PENDING_ASSIGNMENT;
                $updateFields['in_progress_owner'] = null;
                if (!empty($context['assigned_to'])) {
                    $updateFields['assigned_to'] = $context['assigned_to'];
                }
                $auditAction = ($currentState === self::STATE_ON_HOLD) ? 'resume' : 'assign';
                break;

            case self::STATE_REASSIGNED:
                $updateFields['ticket_status_ID'] = self::STATUS_ID_PENDING_ASSIGNMENT;
                $auditAction = 'reassign';
                break;

            case self::STATE_IN_PROGRESS_CS:
                $updateFields['ticket_status_ID'] = self::STATUS_ID_IN_PROGRESS;
                $updateFields['in_progress_owner'] = self::OWNER_CS;
                // If reopened, unassign and clear timestamps
                if (in_array($currentState, [self::STATE_CLOSED, self::STATE_RESOLVED, self::STATE_REOPENED], true)) {
                    $updateFields['assigned_to'] = null;
                    $updateFields['resolved_at'] = null;
                    $updateFields['closed_at'] = null;
                    $updateFields['proof_rejected'] = false;
                    $updateFields['rejection_reason'] = null;
                    $auditAction = 'reopen';
                    $auditDetails['message'] = 'Ticket reopened and routed automatically to Customer Service (CS-owned).';
                    if (!empty($context['reason'])) {
                        $auditDetails['reason'] = $context['reason'];
                    }
                } elseif ($currentState === self::STATE_ON_HOLD) {
                    $auditAction = 'resume';
                } else {
                    $auditAction = 'in_progress';
                }
                break;

            case self::STATE_IN_PROGRESS_EMPLOYEE:
                $updateFields['ticket_status_ID'] = self::STATUS_ID_IN_PROGRESS;
                $updateFields['in_progress_owner'] = self::OWNER_EMPLOYEE;
                if ($currentState === self::STATE_ASSIGNED) {
                    $auditAction = 'accept';
                } elseif ($currentState === self::STATE_ON_HOLD) {
                    $auditAction = 'resume';
                } else {
                    $auditAction = 'in_progress';
                }
                break;

            case self::STATE_ON_HOLD:
                $updateFields['ticket_status_ID'] = self::STATUS_ID_ON_HOLD;
                $updateFields['held_from_status_ID'] = (int) $ticketRecord->ticket_status_ID;
                $updateFields['hold_reason'] = $context['reason'] ?? null;
                // Save previous owner so contextual resume knows where to return
                $updateFields['previous_in_progress_owner'] = $ticketRecord->in_progress_owner ?? self::OWNER_EMPLOYEE;
                $updateFields['in_progress_owner'] = null;
                $auditAction = 'hold';
                if (!empty($context['reason'])) {
                    $auditDetails['reason'] = $context['reason'];
                }
                break;

            case self::STATE_RESOLVED:
                $updateFields['ticket_status_ID'] = self::STATUS_ID_RESOLVED;
                $updateFields['in_progress_owner'] = null;
                $updateFields['resolved_at'] = now();
                $auditAction = 'resolve';
                break;

            case self::STATE_CLOSED:
                $updateFields['ticket_status_ID'] = self::STATUS_ID_CLOSED;
                $updateFields['in_progress_owner'] = null;
                if (!$ticketRecord->resolved_at) {
                    $updateFields['resolved_at'] = now();
                }
                $updateFields['closed_at'] = now();
                $auditAction = 'close';
                break;

            case self::STATE_CANCELLED:
                $updateFields['ticket_status_ID'] = self::STATUS_ID_DISCARDED;
                $updateFields['in_progress_owner'] = null;
                $auditAction = 'cancel';
                break;

            case self::STATE_ESCALATED:
                $updateFields['ticket_status_ID'] = self::STATUS_ID_ESCALATED;
                $updateFields['in_progress_owner'] = null;
                $auditAction = 'escalate';
                break;
        }

        if (array_key_exists('priority_ID', $context) && $context['priority_ID'] !== null) {
            $updateFields['priority_ID'] = $context['priority_ID'];
        }

        // Execute database updates inside transaction
        DB::transaction(function () use (
            $ticketId,
            $updateFields,
            $auditAction,
            $actorId,
            $actorType,
            $auditDetails,
            $resolvedTargetState,
            $currentState,
            $context
        ) {
            DB::table('tickets')->where('ticket_ID', $ticketId)->update($updateFields);

            // 1. Leaving On Hold -> resume SLA clock
            if ($currentState === self::STATE_ON_HOLD) {
                $this->slaService->resumeClock($ticketId);
            }

            // 2. Entering On Hold -> pause SLA clock and write internal note
            if ($resolvedTargetState === self::STATE_ON_HOLD) {
                $this->slaService->pauseClock($ticketId);

                $reason = $context['reason'] ?? null;
                if ($reason) {
                    $isStaff = in_array(strtolower($actorType), ['employee', 'admin', 'superadmin', 'cs', 'customerservice'], true);
                    if ($isStaff && $actorId > 0) {
                        DB::table('internal_notes')->insert([
                            'ticket_id' => $ticketId,
                            'employee_id' => $actorId,
                            'note' => 'Hold reason: ' . $reason,
                            'created_at' => now(),
                            'updated_at' => now(),
                        ]);
                    } else {
                        Log::warning("Skipped internal_notes insert for ticket {$ticketId} on hold: non-staff or invalid actor (actor_type: {$actorType}, actorId: {$actorId})");
                    }
                }
            }

            // 3. Reopening -> soft-end existing ticket_assignments (do NOT delete) and recalculate SLA
            if ($resolvedTargetState === self::STATE_IN_PROGRESS_CS && in_array($currentState, [self::STATE_CLOSED, self::STATE_RESOLVED, self::STATE_REOPENED], true)) {
                DB::table('ticket_assignments')
                    ->where('ticket_ID', $ticketId)
                    ->whereNull('completed_at')
                    ->update([
                        'assignment_status' => 'reopened_unassigned',
                        'completed_at' => now(),
                        'updated_at' => now(),
                    ]);

                try {
                    $this->slaService->recalculateForReopen($ticketId);
                } catch (\Throwable $e) {
                    Log::warning("SLA recalculateForReopen failed for ticket {$ticketId}: " . $e->getMessage());
                }
            }

            // 4. Record SLA resolution triggers
            if ($resolvedTargetState === self::STATE_RESOLVED || $resolvedTargetState === self::STATE_CLOSED) {
                try {
                    $this->slaService->recordResolution($ticketId, now());
                } catch (\Throwable $e) {
                    Log::warning("SLA recordResolution failed for ticket {$ticketId}: " . $e->getMessage());
                }
            }

            if ($resolvedTargetState === self::STATE_IN_PROGRESS_EMPLOYEE && $currentState === self::STATE_ASSIGNED) {
                try {
                    $this->slaService->recordFirstResponse($ticketId, now());
                } catch (\Throwable $e) {}
            }

            // 5. Insert audit log with structured timeline attributes
            DB::table('ticket_audit_logs')->insert([
                'ticket_ID' => $ticketId,
                'action_type' => $auditAction,
                'event_type' => in_array($auditAction, ['hold', 'resume', 'reopen', 'close', 'resolve'], true) ? $auditAction : 'status_change',
                'action_by_ID' => $actorId,
                'actor_type' => $actorType,
                'actor_role' => in_array(strtolower($actorType), ['employee', 'superadmin', 'admin', 'cs', 'systemadministrator', 'itadmin'], true) ? $actorType : null,
                'before_state' => json_encode(['state' => $currentState]),
                'after_state' => json_encode(['state' => $resolvedTargetState]),
                'details' => json_encode($auditDetails),
                'is_system' => ($actorType === 'system') ? 1 : 0,
                'is_internal' => ($resolvedTargetState === self::STATE_ON_HOLD) ? 1 : 0,
                'created_at' => now(),
            ]);
        });

        // Cache invalidation
        $this->cacheService->clearTicketCaches();

        // Broadcast real-time change event
        try {
            $this->notificationService->broadcastTicketChange('status_changed', $ticketId, [
                'state' => $resolvedTargetState,
                'ticket_status_ID' => $updateFields['ticket_status_ID'] ?? null,
                'in_progress_owner' => $updateFields['in_progress_owner'] ?? null,
            ]);
        } catch (\Throwable $e) {
            Log::warning("Failed to broadcast ticket change for ticket {$ticketId}: " . $e->getMessage());
        }

        $freshTicket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();

        return [
            'status' => 200,
            'data' => [
                'message' => "Ticket state transitioned to '{$resolvedTargetState}'.",
                'ticket' => $freshTicket,
                'state' => $resolvedTargetState,
                'in_progress_owner' => $freshTicket->in_progress_owner,
                'transitioned' => true,
            ],
        ];
    }
}
