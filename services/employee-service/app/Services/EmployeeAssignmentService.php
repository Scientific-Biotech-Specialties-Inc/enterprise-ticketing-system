<?php

namespace App\Services;

use App\Services\SLAService;
use App\Services\TicketCacheService;
use App\Services\TicketNotificationService;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class EmployeeAssignmentService
{
    protected TicketNotificationService $notificationService;
    protected TicketCacheService $cacheService;
    protected SLAService $slaService;
    protected TicketStateMachine $stateMachine;

    public function __construct(
        TicketNotificationService $notificationService,
        TicketCacheService $cacheService,
        SLAService $slaService,
        TicketStateMachine $stateMachine
    ) {
        $this->notificationService = $notificationService;
        $this->cacheService = $cacheService;
        $this->slaService = $slaService;
        $this->stateMachine = $stateMachine;
    }

    public function computeSlaMetrics($row): array
    {
        $now = now();
        $statusName = strtolower(trim((string) ($row->status_name ?? '')));
        $isClosedOrResolved = in_array($statusName, ['closed', 'resolved']);
        $isOnHold = in_array($statusName, ['on hold', 'on-hold', 'paused']);

        $resDueAtRaw = $row->resolution_due_at ?? null;
        $resDueAt = $resDueAtRaw ? Carbon::parse($resDueAtRaw) : null;
        $createdAtRaw = $row->created_at ?? null;
        $createdAt = $createdAtRaw ? Carbon::parse($createdAtRaw) : null;

        // 1. Paused / On Hold
        if ($isOnHold) {
            return [
                'status' => 'Paused',
                'due_at' => $resDueAt ? $resDueAt->toIso8601String() : null,
                'time_remaining_minutes' => $resDueAt ? max(0, (int) $now->diffInMinutes($resDueAt, false)) : null,
                'is_breached' => false,
                'is_at_risk' => false,
                'is_paused' => true,
            ];
        }

        // 2. Closed / Resolved
        if ($isClosedOrResolved) {
            $evalTime = !empty($row->resolved_at) ? Carbon::parse($row->resolved_at) : (!empty($row->closed_at) ? Carbon::parse($row->closed_at) : $now);
            $isBreached = $resDueAt ? $evalTime->gt($resDueAt) : false;
            return [
                'status' => $isBreached ? 'Breached' : 'Compliant',
                'due_at' => $resDueAt ? $resDueAt->toIso8601String() : null,
                'time_remaining_minutes' => 0,
                'is_breached' => $isBreached,
                'is_at_risk' => false,
                'is_paused' => false,
            ];
        }

        // 3. Explicitly unconfigured SLA
        if (($row->sla_status ?? '') === 'No SLA Configured') {
            return [
                'status' => 'No SLA Configured',
                'due_at' => null,
                'time_remaining_minutes' => null,
                'is_breached' => false,
                'is_at_risk' => false,
                'is_paused' => false,
            ];
        }

        // 4. Active Ticket with resolution_due_at
        if ($resDueAt) {
            $remainingMin = $now->diffInMinutes($resDueAt, false);
            if ($remainingMin < 0 || ($row->sla_status ?? '') === 'Breached') {
                return [
                    'status' => 'Breached',
                    'due_at' => $resDueAt->toIso8601String(),
                    'time_remaining_minutes' => 0,
                    'is_breached' => true,
                    'is_at_risk' => false,
                    'is_paused' => false,
                ];
            }

            $isAtRisk = false;
            if ($remainingMin <= 240) {
                $isAtRisk = true;
            } elseif ($createdAt) {
                $totalMinutes = max(1, $createdAt->diffInMinutes($resDueAt, false));
                if (($remainingMin / $totalMinutes) <= 0.25) {
                    $isAtRisk = true;
                }
            }

            return [
                'status' => $isAtRisk ? 'At Risk' : 'On Track',
                'due_at' => $resDueAt->toIso8601String(),
                'time_remaining_minutes' => (int) $remainingMin,
                'is_breached' => false,
                'is_at_risk' => $isAtRisk,
                'is_paused' => false,
            ];
        }

        // 5. Active Ticket fallback without resolution_due_at: use age from createdAt
        if ($createdAt) {
            $hours = $now->diffInHours($createdAt);
            if ($hours >= 48 || ($row->sla_status ?? '') === 'Breached') {
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
                    'time_remaining_minutes' => max(0, (int) ((48 - $hours) * 60)),
                    'is_breached' => false,
                    'is_at_risk' => true,
                    'is_paused' => false,
                ];
            }
            return [
                'status' => 'On Track',
                'due_at' => $createdAt->copy()->addHours(48)->toIso8601String(),
                'time_remaining_minutes' => max(0, (int) ((48 - $hours) * 60)),
                'is_breached' => false,
                'is_at_risk' => false,
                'is_paused' => false,
            ];
        }

        return [
            'status' => ($row->sla_status ?? '') === 'Breached' ? 'Breached' : 'On Track',
            'due_at' => null,
            'time_remaining_minutes' => null,
            'is_breached' => ($row->sla_status ?? '') === 'Breached',
            'is_at_risk' => false,
            'is_paused' => false,
        ];
    }

    public function slaLabel($createdAt, $row = null): string
    {
        if ($row) {
            return $this->computeSlaMetrics($row)['status'];
        }
        if (!$createdAt) {
            return 'On Track';
        }

        $createdAtObj = is_string($createdAt) ? Carbon::parse($createdAt) : $createdAt;
        $hours = now()->diffInHours($createdAtObj);
        if ($hours >= 48) {
            return 'Breached';
        }
        if ($hours >= 24) {
            return 'At Risk';
        }
        return 'On Track';
    }


    /**
     * Assign one or more employees to a ticket.
     */
    public function assignTicket(int $ticketId, array $validated, int $assignedBy): array
    {
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket) {
            return ['status' => 404, 'data' => ['message' => 'Ticket not found']];
        }

        $currentState = $this->stateMachine->resolveState($ticket);
        try {
            $this->stateMachine->validateTransition($ticket, $currentState, TicketStateMachine::STATE_ASSIGNED);
        } catch (\App\Exceptions\InvalidTicketTransitionException $e) {
            return ['status' => 422, 'data' => ['message' => $e->getMessage(), 'code' => 'INVALID_TICKET_TRANSITION']];
        }

        $removedEmpIds = [];
        DB::transaction(function () use ($ticketId, $validated, $assignedBy, &$removedEmpIds) {
            $pendingAssignmentId = DB::table('ticket_statuses')
                ->whereRaw('LOWER(status_name) = ?', ['pending assignment'])
                ->value('ticket_status_ID') ?? 10;

            $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
            $changes = [];

            if ($ticket && $ticket->assigned_to != $validated['employee_ids'][0]) {
                $changes[] = ['field' => 'assigned_to', 'old' => $ticket->assigned_to, 'new' => $validated['employee_ids'][0]];
            }
            if ($ticket && array_key_exists('priority_ID', $validated) && $validated['priority_ID'] !== null && $ticket->priority_ID != $validated['priority_ID']) {
                $changes[] = ['field' => 'priority_ID', 'old' => $ticket->priority_ID, 'new' => $validated['priority_ID']];
            }

            DB::table('tickets')
                ->where('ticket_ID', $ticketId)
                ->update([
                    'assigned_to' => $validated['employee_ids'][0],
                    'ticket_status_ID' => $pendingAssignmentId,
                    'in_progress_owner' => null,
                    'priority_ID' => $validated['priority_ID'] ?? DB::raw('priority_ID'),
                    'updated_at' => now(),
                ]);

            $existing = DB::table('ticket_assignments')
                ->where('ticket_ID', $ticketId)
                ->get()
                ->keyBy('employee_ID');

            $newEmpIds = $validated['employee_ids'];
            $toRemove = $existing->keys()->diff($newEmpIds);
            $removedEmpIds = $toRemove->values()->all();
            $toAdd = collect($newEmpIds)->diff($existing->keys());

            if ($toRemove->isNotEmpty()) {
                DB::table('ticket_assignments')
                    ->where('ticket_ID', $ticketId)
                    ->whereIn('employee_ID', $toRemove)
                    ->delete();
            }

            foreach ($toAdd as $employeeId) {
                DB::table('ticket_assignments')->insert([
                    'ticket_ID' => $ticketId,
                    'employee_ID' => $employeeId,
                    'assigned_by' => $assignedBy,
                    'assignment_status' => 'assigned',
                    'assigned_at' => now(),
                    'completed_at' => null,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }

            DB::table('reassignment_requests')
                ->where('ticket_id', $ticketId)
                ->where('status', 'pending')
                ->update([
                    'status' => 'approved',
                    'reviewed_at' => now(),
                    'updated_at' => now(),
                ]);

            foreach ($changes as $chg) {
                DB::table('ticket_audit_logs')->insert([
                    'ticket_ID' => $ticketId,
                    'action_type' => 'update',
                    'action_by_ID' => $assignedBy,
                    'actor_type' => 'employee',
                    'details' => json_encode($chg),
                    'created_at' => now(),
                ]);
            }

            DB::table('tickets')
                ->where('ticket_ID', $ticketId)
                ->whereNull('first_cs_response_at')
                ->update(['first_cs_response_at' => now()]);
        });

        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if ($ticket) {
            $customerId = $ticket->created_by;
            $title = $ticket->title;
            $empNames = DB::table('employees')->whereIn('emp_id', $validated['employee_ids'])->selectRaw("CONCAT(first_name, ' ', last_name) as name")->pluck('name')->all();
            $empNamesStr = implode(', ', $empNames);

            $categoryName = DB::table('problem_categories')->where('problem_category_ID', $ticket->problem_category_ID)->value('category_name') ?? '';
            $priorityName = DB::table('ticket_priorities')->where('priority_ID', $ticket->priority_ID)->value('priority_name') ?? '';
            $ticketRef = 'TKT-' . str_pad((string) $ticketId, 4, '0', STR_PAD_LEFT);

            $notificationData = [
                'ticket_id' => $ticketId,
                'ticket_ref' => $ticketRef,
                'title' => $title,
                'category' => $categoryName,
                'priority' => $priorityName,
                'type' => 'ticket_assigned',
            ];

            $slaMetrics = $this->computeSlaMetrics($ticket);
            $isBreached = ($ticket->sla_status ?? '') === 'Breached' || $slaMetrics['status'] === 'Breached' || ($ticket->resolution_due_at && \Carbon\Carbon::parse($ticket->resolution_due_at)->isPast());
            $overdueMinutes = $ticket->resolution_due_at ? max(1, (int) \Carbon\Carbon::parse($ticket->resolution_due_at)->diffInMinutes(now())) : 0;
            $overdueDuration = $overdueMinutes >= 60
                ? round($overdueMinutes / 60, 1) . ' hours overdue'
                : "{$overdueMinutes} minutes overdue";

            foreach ($validated['employee_ids'] as $employeeId) {
                $this->notificationService->notifyRecipient(
                    $employeeId,
                    'employee',
                    'Ticket Assigned',
                    "Ticket {$ticketRef}: \"" . $title . "\" has been assigned to you.",
                    $ticketId,
                    $notificationData
                );

                $this->notificationService->sendTicketEmail(
                    $employeeId,
                    'Ticket Assigned',
                    "Ticket {$ticketRef}: \"{$title}\" has been assigned to you.",
                    $ticketId,
                    $title,
                    $categoryName,
                    $priorityName
                );

                // If ticket was already breached, trigger immediate breach alert to the assigned employee
                if ($isBreached) {
                    $breachData = [
                        'type' => 'overdue_sla_breach',
                        'ticket_id' => $ticketId,
                        'ticket_ref' => $ticketRef,
                        'title' => $title,
                        'summary' => $title,
                        'customer' => $customerId ? (DB::table('clients')->where('id', $customerId)->value('client_name') ?? 'Valued Customer') : 'Valued Customer',
                        'category' => $categoryName,
                        'priority' => $priorityName,
                        'overdue_duration' => $overdueDuration,
                        'sla_status' => 'Breached',
                        'due_at' => $ticket->resolution_due_at ? \Carbon\Carbon::parse($ticket->resolution_due_at)->toIso8601String() : null,
                        'link' => "/ticketing/employee/machine",
                        'deep_link' => "/ticketing/employee/machine",
                        'is_reassignment' => true,
                    ];

                    $this->notificationService->notifyRecipient(
                        $employeeId,
                        'employee',
                        "SLA Alert: Assigned Ticket {$ticketRef} Breached",
                        "Urgent: Assigned Ticket {$ticketRef}: \"{$title}\" has breached its resolution SLA deadline ({$overdueDuration}). Immediate action required.",
                        $ticketId,
                        $breachData,
                        'overdue_sla_breach'
                    );

                    $this->notificationService->sendTicketEmail(
                        $employeeId,
                        "SLA Alert: Assigned Ticket {$ticketRef} Breached",
                        "Urgent: Assigned Ticket {$ticketRef}: \"{$title}\" has breached its resolution SLA deadline ({$overdueDuration}). Immediate action required.",
                        $ticketId,
                        $title,
                        $categoryName,
                        $priorityName,
                        'overdue_sla_breach',
                        [
                            'sla_deadline' => $ticket->resolution_due_at,
                            'overdue_duration' => $overdueDuration,
                        ]
                    );

                    try {
                        DB::table('ticket_audit_logs')->insert([
                            'ticket_ID' => $ticketId,
                            'action_type' => 'sla_breached_reassigned',
                            'action_by_ID' => $assignedBy,
                            'actor_type' => 'employee',
                            'details' => json_encode([
                                'sla_status' => 'Breached',
                                'due_at' => $ticket->resolution_due_at,
                                'overdue_duration' => $overdueDuration,
                                'new_employee_id' => $employeeId,
                            ]),
                            'created_at' => now(),
                        ]);
                    } catch (\Throwable $e) {}
                }
            }

            $this->notificationService->notifyCustomer(
                $customerId,
                'Engineer Assigned',
                "Engineer " . $empNamesStr . " has been assigned to your ticket {$ticketRef}: \"" . $title . "\".",
                $ticketId,
                $notificationData
            );

            $this->notificationService->sendCustomerEmail(
                $customerId,
                'Engineer Assigned',
                "Engineer(s) have been assigned to your ticket {$ticketRef}: \"" . $title . "\".",
                $ticketId,
                $title,
                $categoryName,
                $priorityName
            );

            $this->notificationService->notifyCS(
                'Ticket Assigned',
                "Ticket {$ticketRef}: \"" . $title . "\" has been assigned to " . $empNamesStr . ".",
                $ticketId,
                null,
                $assignedBy
            );

            if ($ticket->requested_by) {
                $this->notificationService->notifyRecipient(
                    $ticket->requested_by,
                    'employee',
                    'Ticket Assigned',
                    "Your requested ticket {$ticketRef}: \"" . $title . "\" has been assigned to " . $empNamesStr . ".",
                    $ticketId,
                    $notificationData
                );
            }
        }

        // Notify unassigned employees about ticket reassignment
        foreach ($removedEmpIds as $removedEmpId) {
            $ticketRef = 'TKT-' . str_pad((string) $ticketId, 4, '0', STR_PAD_LEFT);
            $this->notificationService->notifyRecipient(
                $removedEmpId,
                'employee',
                'Ticket Reassigned',
                "Ticket {$ticketRef}: \"" . ($ticket ? $ticket->title : '') . "\" has been reassigned to another engineer.",
                $ticketId,
                ['ticket_id' => $ticketId, 'ticket_ref' => $ticketRef, 'title' => $ticket ? $ticket->title : '', 'type' => 'ticket_unassigned']
            );
        }

        $this->notificationService->broadcastTicketChange('assigned', $ticketId, [
            'ticket_id' => $ticketId,
            'assigned_to' => $validated['employee_ids'][0],
            'employee_ids' => $validated['employee_ids'],
            'removed_employee_ids' => $removedEmpIds,
            'previous_employee_ids' => $removedEmpIds,
        ]);

        try {
            $empNames = DB::table('employees')
                ->whereIn('emp_id', $validated['employee_ids'])
                ->selectRaw("CONCAT(first_name, ' ', last_name) as name")
                ->pluck('name')
                ->all();
            $empNamesStr = implode(', ', $empNames);

            Http::withHeaders([
                'X-Internal-Token' => env('INTERNAL_TOKEN'),
            ])->post("http://messaging-service:8000/api/internal/tickets/{$ticketId}/messages", [
                'message' => "System: A Service Engineer ({$empNamesStr}) has been assigned to your ticket.",
                'sender_name' => 'System',
                'sender_type' => 'system',
                'sender_id' => null,
            ]);
        } catch (\Exception $e) {
            Log::error("Failed to send internal assignment message in assignTicket: " . $e->getMessage());
        }

        if (array_key_exists('priority_ID', $validated) && $validated['priority_ID'] !== null && (int) $validated['priority_ID'] !== (int) ($ticket->priority_ID ?? 0)) {
            $this->requestSlaRecalculation($ticketId);
        }

        $updatedTicket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        $this->cacheService->clearTicketCaches();

        return [
            'status' => 200,
            'data' => [
                'message' => 'Ticket assigned successfully.',
                'ticket' => $updatedTicket,
            ]
        ];
    }

    /**
     * Accept ticket by assigned engineer, or assign by customer service.
     */
    public function acceptTicket(int $ticketId, $user, ?array $validated = null): array
    {
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket) {
            return ['status' => 404, 'data' => ['message' => 'Ticket not found']];
        }

        if ($ticket->ticket_status_ID == 3) {
            return ['status' => 422, 'data' => ['message' => 'Resolved tickets cannot be reassigned.']];
        }

        $currentState = $this->stateMachine->resolveState($ticket);

        $role = strtolower(trim((string) (is_object($user) ? ($user->role ?? '') : ($user['role'] ?? ''))));
        $isCS = in_array($role, ['customer service', 'customer support', 'cs', 'head of cs', 'head of customer service', 'admin', 'superadmin', 'super admin']);

        // Branch 1: Employee accept logic (when engineer self-accepts)
        if (!$isCS || !$validated) {
            $empId = $user->emp_id;

            $assignment = DB::table('ticket_assignments')
                ->where('ticket_ID', $ticketId)
                ->where('employee_ID', $empId)
                ->first();

            if (!$assignment) {
                // If the employee is assigned_to on the ticket, create the missing assignment record so they can accept
                $isDirectlyAssigned = DB::table('tickets')
                    ->where('ticket_ID', $ticketId)
                    ->where('assigned_to', $empId)
                    ->exists();

                if ($isDirectlyAssigned) {
                    DB::table('ticket_assignments')->insert([
                        'ticket_ID' => $ticketId,
                        'employee_ID' => $empId,
                        'assigned_by' => $empId,
                        'assignment_status' => 'assigned',
                        'assigned_at' => now(),
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);
                    $assignment = DB::table('ticket_assignments')
                        ->where('ticket_ID', $ticketId)
                        ->where('employee_ID', $empId)
                        ->first();
                } else {
                    return ['status' => 403, 'data' => ['message' => 'You are not assigned to this ticket.']];
                }
            }

            if ($assignment && $assignment->assignment_status === 'accepted') {
                return ['status' => 200, 'data' => ['message' => 'Ticket already accepted.']];
            }

            // Only validate state machine transition if not already In Progress
            if ($currentState !== TicketStateMachine::STATE_IN_PROGRESS_EMPLOYEE) {
                try {
                    $this->stateMachine->validateTransition($ticket, $currentState, TicketStateMachine::STATE_IN_PROGRESS_EMPLOYEE);
                } catch (\App\Exceptions\InvalidTicketTransitionException $e) {
                    return [
                        'status' => 422,
                        'data' => [
                            'message' => $e->getMessage(),
                            'code' => 'INVALID_TICKET_TRANSITION',
                            'from_status' => $e->fromStatus,
                            'to_status' => $e->toStatus,
                            'allowed_statuses' => $e->allowedStatuses,
                        ]
                    ];
                }
            }

            DB::transaction(function () use ($ticketId, $empId) {
                DB::table('ticket_assignments')
                    ->where('ticket_ID', $ticketId)
                    ->where('employee_ID', $empId)
                    ->update([
                        'assignment_status' => 'accepted',
                        'accepted_at' => now(),
                        'updated_at' => now(),
                    ]);

                $inProgressId = DB::table('ticket_statuses')
                    ->whereRaw('LOWER(status_name) = ?', ['in progress'])
                    ->value('ticket_status_ID') ?? 2;

                DB::table('tickets')
                    ->where('ticket_ID', $ticketId)
                    ->update([
                        'ticket_status_ID' => $inProgressId,
                        'in_progress_owner' => 'employee',
                        'updated_at' => now(),
                    ]);

                try {
                    $this->slaService->recordFirstResponse($ticketId, now());
                } catch (\Exception $e) {
                    Log::warning("Failed to record first response in acceptTicket: " . $e->getMessage());
                }

                DB::table('ticket_audit_logs')->insert([
                    'ticket_ID' => $ticketId,
                    'action_type' => 'accept',
                    'action_by_ID' => $empId,
                    'actor_type' => 'employee',
                    'details' => json_encode(['message' => 'Assignment accepted by employee.']),
                    'created_at' => now(),
                ]);
            });

            $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
            if ($ticket) {
                $customerId = $ticket->created_by;
                $title = $ticket->title;
                $emp = DB::table('employees')->where('emp_id', $empId)->first();
                $empName = $emp ? ($emp->first_name . ' ' . $emp->last_name) : 'Engineer';

                $this->notificationService->notifyCustomer(
                    $customerId,
                    'Ticket Accepted',
                    "Engineer " . $empName . " has accepted and is now working on your ticket TKT-" . str_pad((string) $ticketId, 4, '0', STR_PAD_LEFT) . ": \"" . $title . "\".",
                    $ticketId
                );

                $catNameAcc = DB::table('problem_categories')->where('problem_category_ID', $ticket->problem_category_ID)->value('category_name') ?? '';
                $prioNameAcc = DB::table('ticket_priorities')->where('priority_ID', $ticket->priority_ID ?? 1)->value('priority_name') ?? '';
                $this->notificationService->sendCustomerEmail(
                    $customerId,
                    'Ticket Accepted',
                    "Engineer " . $empName . " has accepted and is now working on your ticket TKT-" . str_pad((string) $ticketId, 4, '0', STR_PAD_LEFT) . ": \"" . $title . "\".",
                    $ticketId,
                    $title,
                    $catNameAcc,
                    $prioNameAcc
                );

                $this->notificationService->notifyCS(
                    'Ticket Accepted',
                    "Engineer " . $empName . " has accepted ticket TKT-" . str_pad((string) $ticketId, 4, '0', STR_PAD_LEFT) . ": \"" . $title . "\".",
                    $ticketId
                );
            }

            $allActiveEmpIds = DB::table('ticket_assignments')->where('ticket_ID', $ticketId)->pluck('employee_ID')->all();
            $this->notificationService->broadcastTicketChange('accepted', $ticketId, [
                'ticket_id' => $ticketId,
                'assigned_to' => $empId,
                'accepted_by' => $empId,
                'employee_ids' => !empty($allActiveEmpIds) ? $allActiveEmpIds : [$empId],
            ]);

            try {
                $emp = DB::table('employees')->where('emp_id', $empId)->first();
                $empName = $emp ? ($emp->first_name . ' ' . $emp->last_name) : 'Engineer';

                Http::withHeaders([
                    'X-Internal-Token' => env('INTERNAL_TOKEN'),
                ])->post("http://messaging-service:8000/api/internal/tickets/{$ticketId}/messages", [
                    'message' => "System: Service Engineer {$empName} has accepted and is now working on your ticket.",
                    'sender_name' => 'System',
                    'sender_type' => 'system',
                    'sender_id' => null,
                ]);
            } catch (\Exception $e) {
                Log::error("Failed to send internal acceptance message in acceptTicket: " . $e->getMessage());
            }

            $this->cacheService->clearTicketCaches();
            return ['status' => 200, 'data' => ['message' => 'Ticket accepted and updated.']];
        }

        // Branch 2: Customer service assignment
        if (!$user) {
            return ['status' => 401, 'data' => ['message' => 'Unauthorized. Please log in.']];
        }

        try {
            $this->stateMachine->validateTransition($ticket, $currentState, TicketStateMachine::STATE_ASSIGNED);
        } catch (\App\Exceptions\InvalidTicketTransitionException $e) {
            return [
                'status' => 422,
                'data' => [
                    'message' => $e->getMessage(),
                    'code' => 'INVALID_TICKET_TRANSITION',
                    'from_status' => $e->fromStatus,
                    'to_status' => $e->toStatus,
                    'allowed_statuses' => $e->allowedStatuses,
                ]
            ];
        }

        $assignedBy = DB::table('employees')
            ->where('email', $validated['assigned_by_email'] ?? '')
            ->value('emp_id') ?? ($user ? $user->emp_id : 2);

        $employees = collect($validated['employee_ids'] ?? []);
        $changes = [];

        if ($employees->count() > 0) {
            $newAssigned = $employees->first();
            if ($ticket->assigned_to != $newAssigned) {
                $changes[] = ['field' => 'assigned_to', 'old' => $ticket->assigned_to, 'new' => $newAssigned];
            }
        }

        if (array_key_exists('priority_ID', $validated) && $validated['priority_ID'] !== null) {
            if ($ticket->priority_ID != $validated['priority_ID']) {
                $changes[] = ['field' => 'priority_ID', 'old' => $ticket->priority_ID, 'new' => $validated['priority_ID']];
            }
        }

        $removedEmpIds = [];
        DB::transaction(function () use ($ticketId, $validated, $assignedBy, $employees, $changes, &$removedEmpIds) {
            $pendingAssignmentId = DB::table('ticket_statuses')
                ->whereRaw('LOWER(status_name) = ?', ['pending assignment'])
                ->value('ticket_status_ID') ?? 7;

            $update = [
                'updated_at' => now(),
                'ticket_status_ID' => $pendingAssignmentId,
                'in_progress_owner' => null,
            ];
            if ($employees->count() > 0) {
                $update['assigned_to'] = $employees->first();
            }
            if (array_key_exists('priority_ID', $validated) && $validated['priority_ID'] !== null) {
                $update['priority_ID'] = $validated['priority_ID'];
            }

            DB::table('tickets')->where('ticket_ID', $ticketId)->update($update);

            if ($employees->count() > 0) {
                $existing = DB::table('ticket_assignments')
                    ->where('ticket_ID', $ticketId)
                    ->get()
                    ->keyBy('employee_ID');

                $newEmpIds = $employees->all();
                $toRemove = $existing->keys()->diff($newEmpIds);
                $removedEmpIds = $toRemove->values()->all();
                $toAdd = collect($newEmpIds)->diff($existing->keys());

                if ($toRemove->isNotEmpty()) {
                    DB::table('ticket_assignments')
                        ->where('ticket_ID', $ticketId)
                        ->whereIn('employee_ID', $toRemove)
                        ->delete();
                }

                foreach ($toAdd as $employeeId) {
                    DB::table('ticket_assignments')->insert([
                        'ticket_ID' => $ticketId,
                        'employee_ID' => $employeeId,
                        'assigned_by' => $assignedBy,
                        'assignment_status' => 'assigned',
                        'assigned_at' => now(),
                        'completed_at' => null,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);
                }

                DB::table('reassignment_requests')
                    ->where('ticket_id', $ticketId)
                    ->where('status', 'pending')
                    ->update([
                        'status' => 'approved',
                        'reviewed_at' => now(),
                        'updated_at' => now(),
                    ]);
            }

            foreach ($changes as $chg) {
                DB::table('ticket_audit_logs')->insert([
                    'ticket_ID' => $ticketId,
                    'action_type' => 'update',
                    'action_by_ID' => $assignedBy,
                    'actor_type' => 'employee',
                    'details' => json_encode($chg),
                    'created_at' => now(),
                ]);
            }
        });

        $this->notificationService->broadcastTicketChange('assigned', $ticketId, [
            'ticket_id' => $ticketId,
            'assigned_to' => $employees->first(),
            'employee_ids' => $employees->all(),
            'removed_employee_ids' => $removedEmpIds,
            'previous_employee_ids' => $removedEmpIds,
        ]);

        if (collect($changes)->contains(fn ($c) => $c['field'] === 'priority_ID')) {
            $this->requestSlaRecalculation($ticketId);
        }

        $this->cacheService->clearTicketCaches();

        $ticketRef = 'TKT-' . str_pad((string) $ticketId, 4, '0', STR_PAD_LEFT);

        foreach ($employees as $employeeId) {
            $this->notificationService->notifyRecipient(
                $employeeId,
                'employee',
                'Ticket Assigned',
                "Ticket {$ticketRef}: \"" . $ticket->title . "\" has been assigned to you.",
                $ticketId,
                ['ticket_id' => $ticketId, 'ticket_ref' => $ticketRef, 'title' => $ticket->title, 'type' => 'ticket_assigned']
            );

            $catName = DB::table('problem_categories')->where('problem_category_ID', $ticket->problem_category_ID)->value('category_name') ?? '';
            $prioName = DB::table('ticket_priorities')->where('priority_ID', $ticket->priority_ID ?? 1)->value('priority_name') ?? '';
            $this->notificationService->sendTicketEmail(
                $employeeId,
                'Ticket Assigned',
                "Ticket {$ticketRef}: \"{$ticket->title}\" has been assigned to you.",
                $ticketId,
                $ticket->title,
                $catName,
                $prioName
            );
        }

        $this->notificationService->notifyCustomer(
            $ticket->created_by,
            'Ticket Assigned',
            "Your ticket {$ticketRef}: \"" . $ticket->title . "\" has been assigned to a technician and is pending their acceptance.",
            $ticketId
        );

        $catName = DB::table('problem_categories')->where('problem_category_ID', $ticket->problem_category_ID)->value('category_name') ?? '';
        $prioName = DB::table('ticket_priorities')->where('priority_ID', $ticket->priority_ID ?? 1)->value('priority_name') ?? '';
        $this->notificationService->sendCustomerEmail(
            $ticket->created_by,
            'Ticket Assigned',
            "Your ticket {$ticketRef}: \"" . $ticket->title . "\" has been assigned to a technician and is pending their acceptance.",
            $ticketId,
            $ticket->title,
            $catName,
            $prioName
        );

        // Notify unassigned employees about ticket reassignment
        foreach ($removedEmpIds as $removedEmpId) {
            $this->notificationService->notifyRecipient(
                $removedEmpId,
                'employee',
                'Ticket Reassigned',
                "Ticket {$ticketRef}: \"" . $ticket->title . "\" has been reassigned to another engineer.",
                $ticketId,
                ['ticket_id' => $ticketId, 'ticket_ref' => $ticketRef, 'title' => $ticket->title, 'type' => 'ticket_unassigned']
            );
        }

        try {
            $empNames = DB::table('employees')
                ->whereIn('emp_id', $employees->all())
                ->selectRaw("CONCAT(first_name, ' ', last_name) as name")
                ->pluck('name')
                ->all();
            $empNamesStr = implode(', ', $empNames);

            Http::withHeaders([
                'X-Internal-Token' => env('INTERNAL_TOKEN'),
            ])->post("http://messaging-service:8000/api/internal/tickets/{$ticketId}/messages", [
                'message' => "System: A Service Engineer ({$empNamesStr}) has been assigned to your ticket.",
                'sender_name' => 'System',
                'sender_type' => 'system',
                'sender_id' => null,
            ]);
        } catch (\Exception $e) {
            Log::error("Failed to send internal assignment message in acceptTicket (CS): " . $e->getMessage());
        }

        return ['status' => 200, 'data' => ['message' => 'Ticket assigned successfully.']];
    }

    /**
     * Handle employee status, remarks, notes, and proof updates.
     */
    public function employeeUpdate(int $ticketId, int $empId, array $validated, bool $isProof): array
    {
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket) {
            return ['status' => 404, 'data' => ['message' => 'Ticket not found']];
        }

        if ((int) $ticket->ticket_status_ID === 11) {
            return [
                'status' => 422,
                'data' => [
                    'message' => 'Ticket is currently on hold. Customer Service must resume it before work or updates can be logged.',
                    'code' => 'TICKET_ON_HOLD',
                ],
            ];
        }

        $assignment = DB::table('ticket_assignments')
            ->where('ticket_ID', $ticketId)
            ->where('employee_ID', $empId)
            ->first();

        if (!$assignment) {
            return ['status' => 403, 'data' => ['message' => 'You are not assigned to this ticket.']];
        }

        $pendingReassign = DB::table('reassignment_requests')
            ->where('ticket_id', $ticketId)
            ->where('status', 'pending')
            ->exists();

        if ($pendingReassign) {
            return ['status' => 422, 'data' => ['message' => 'Cannot update ticket while a reassignment request is pending.']];
        }

        $newStatusName = $validated['status'] ?? null;
        if ($isProof && empty($newStatusName)) {
            $newStatusName = 'Pending Evaluation';
        }
        $rawRemarks = $validated['remarks'] ?? '';
        $remarksText = $rawRemarks !== '' ? mb_strtoupper(mb_substr($rawRemarks, 0, 1)) . mb_substr($rawRemarks, 1) : '';
        $internalNoteText = $validated['internal_note'] ?? null;
        $attachmentIds = $validated['attachments'] ?? [];
        $attachmentNames = [];

        // Internal tickets store a placeholder in created_by, so there is no customer to notify.
        $notifyCustomer = !(bool) $ticket->is_internal;

        // Validate the status change before any side effects: replacing proofs and binding
        // attachments call attachment-service, which a database rollback cannot undo.
        if ($newStatusName) {
            $transitionError = $this->validateEmployeeStatusChange($ticket, $newStatusName);
            if ($transitionError !== null) {
                return $transitionError;
            }
        }

        DB::transaction(function () use ($ticketId, $ticket, $empId, $newStatusName, $remarksText, $internalNoteText, $isProof, $assignment, $attachmentIds, &$attachmentNames, $notifyCustomer) {
            if ($isProof) {
                try {
                    $resp = Http::get("http://attachment-service:8000/api/attachments?assignment_id={$assignment->assignment_ID}");
                    if ($resp->successful()) {
                        $oldProofs = $resp->json('attachments') ?? [];
                        foreach ($oldProofs as $oldProof) {
                            Http::delete("http://attachment-service:8000/api/attachments/{$oldProof['id']}?is_proof=true");
                        }
                    }
                } catch (\Exception $e) {
                    Log::error("Failed to delete old proofs in employeeUpdate: " . $e->getMessage());
                }
            }

            if (!empty($attachmentIds)) {
                try {
                    $resp = Http::post('http://attachment-service:8000/api/bind', [
                        'ticket_id' => $isProof ? null : $ticketId,
                        'assignment_id' => $isProof ? $assignment->assignment_ID : null,
                        'attachment_ids' => $attachmentIds,
                        'is_proof' => $isProof
                    ]);
                    if ($resp->successful()) {
                        $attachmentNames = $resp->json('file_names') ?? [];
                    }
                } catch (\Exception $e) {
                    Log::error("Failed to bind attachments in employeeUpdate: " . $e->getMessage());
                }
            }

            $emp = DB::table('employees')->where('emp_id', $empId)->first();
            $empName = $emp ? ($emp->first_name . ' ' . $emp->last_name) : 'Engineer';
            $customerId = $ticket->created_by;

            $statusChanged = false;
            if ($newStatusName) {
                $statusId = DB::table('ticket_statuses')
                    ->whereRaw('LOWER(status_name) = ?', [strtolower($newStatusName)])
                    ->value('ticket_status_ID');

                // The transition was validated against the Transition Matrix before this transaction.
                if ($statusId && $statusId != $ticket->ticket_status_ID) {
                    $statusChanged = true;
                    $updateFields = [
                        'updated_at' => now(),
                    ];

                    if ($newStatusName === 'Resolved' || $statusId == 3) {
                        $updateFields['resolved_at'] = now();
                        $updateFields['in_progress_owner'] = null;
                    } elseif ($newStatusName === 'Closed' || $statusId == 4) {
                        if (!$ticket->resolved_at) {
                            $updateFields['resolved_at'] = now();
                        }
                        $updateFields['closed_at'] = now();
                        $updateFields['in_progress_owner'] = null;
                    } elseif (in_array(strtolower($newStatusName), ['on hold', 'hold', 'pending'])) {
                        $updateFields['previous_in_progress_owner'] = $ticket->in_progress_owner ?? 'employee';
                        $updateFields['in_progress_owner'] = null;
                    } elseif (in_array(strtolower($newStatusName), ['in progress', 'pending evaluation'])) {
                        $updateFields['in_progress_owner'] = 'employee';
                    }
                    $updateFields['ticket_status_ID'] = $statusId;

                    DB::table('tickets')
                        ->where('ticket_ID', $ticketId)
                        ->update($updateFields);

                    DB::table('ticket_audit_logs')->insert([
                        'ticket_ID' => $ticketId,
                        'action_type' => 'status_change',
                        'action_by_ID' => $empId,
                        'actor_type' => 'employee',
                        'details' => json_encode([
                            'status' => $newStatusName,
                            'remarks' => $remarksText,
                            'files' => $attachmentNames,
                        ]),
                        'created_at' => now(),
                    ]);

                    $statusNameToNotify = $newStatusName;
                    $ticketRef = 'TKT-' . str_pad((string) $ticketId, 4, '0', STR_PAD_LEFT);

                    $customerTitle = 'Ticket Status Updated';
                    if ($newStatusName === 'Resolved') {
                        $customerTitle = 'Ticket Resolved';
                    } elseif ($newStatusName === 'Pending') {
                        $customerTitle = 'Ticket Pending';
                    }

                    $customerNotificationData = null;
                    if ($newStatusName === 'Resolved') {
                        $customerNotificationData = [
                            'ticket_id' => $ticketId,
                            'ticket_ref' => $ticketRef,
                            'type' => 'ticket_resolved',
                            'feedback_link' => url("/feedback/{$ticketId}"),
                        ];
                    }

                    if ($notifyCustomer) {
                        $this->notificationService->notifyCustomer(
                            $customerId,
                            $customerTitle,
                            "Your ticket {$ticketRef} status has been updated to \"" . $statusNameToNotify . "\". Remark: \"" . $remarksText . "\".",
                            $ticketId,
                            $customerNotificationData
                        );
                    }

                    $this->notificationService->notifyCS(
                        'Ticket Status Updated',
                        "Ticket {$ticketRef} status updated to \"" . $statusNameToNotify . "\" by " . $empName . ". Remark: \"" . $remarksText . "\".",
                        $ticketId
                    );

                    if ($ticket->requested_by && $ticket->requested_by != $empId) {
                        $this->notificationService->notifyRecipient(
                            $ticket->requested_by,
                            'employee',
                            'Ticket Status Updated',
                            "Your requested ticket {$ticketRef} status has been updated to \"" . $statusNameToNotify . "\".",
                            $ticketId
                        );
                    }

                    $catName = DB::table('problem_categories')->where('problem_category_ID', $ticket->problem_category_ID)->value('category_name') ?? '';
                    $prioName = DB::table('ticket_priorities')->where('priority_ID', $ticket->priority_ID ?? 1)->value('priority_name') ?? '';
                    $this->sendCustomerEmailAfterResponse(
                        $notifyCustomer,
                        $customerId,
                        $customerTitle,
                        "Your ticket {$ticketRef}: \"" . $ticket->title . "\" status has been updated to \"" . $statusNameToNotify . "\".",
                        $ticketId,
                        $ticket->title,
                        $catName,
                        $prioName
                    );
                }
            }

            if (!empty($remarksText)) {
                DB::table('ticket_remarks')->insert([
                    'ticket_id' => $ticketId,
                    'employee_id' => $empId,
                    'remark' => $remarksText,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                if (!$statusChanged && !$isProof) {
                    if ($notifyCustomer) {
                        $this->notificationService->notifyCustomer(
                            $customerId,
                            'New Remark Added',
                            "Engineer " . $empName . " added a remark: \"" . $remarksText . "\" on ticket TKT-" . str_pad((string) $ticketId, 4, '0', STR_PAD_LEFT) . ".",
                            $ticketId
                        );
                    }

                    $catNameRem = DB::table('problem_categories')->where('problem_category_ID', $ticket->problem_category_ID)->value('category_name') ?? '';
                    $prioNameRem = DB::table('ticket_priorities')->where('priority_ID', $ticket->priority_ID ?? 1)->value('priority_name') ?? '';
                    $this->sendCustomerEmailAfterResponse(
                        $notifyCustomer,
                        $customerId,
                        'New Remark Added',
                        "Engineer " . $empName . " added a remark: \"" . $remarksText . "\" on your ticket TKT-" . str_pad((string) $ticketId, 4, '0', STR_PAD_LEFT) . ".",
                        $ticketId,
                        $ticket->title,
                        $catNameRem,
                        $prioNameRem
                    );

                    $this->notificationService->notifyCS(
                        'New Remark Added',
                        "Engineer " . $empName . " added a remark: \"" . $remarksText . "\" on ticket TKT-" . str_pad((string) $ticketId, 4, '0', STR_PAD_LEFT) . ".",
                        $ticketId
                    );
                }
            }

            if (!empty($internalNoteText)) {
                DB::table('internal_notes')->insert([
                    'ticket_id' => $ticketId,
                    'employee_id' => $empId,
                    'note' => $internalNoteText,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                DB::table('ticket_audit_logs')->insert([
                    'ticket_ID' => $ticketId,
                    'action_type' => 'internal_note',
                    'action_by_ID' => $empId,
                    'actor_type' => 'employee',
                    'details' => json_encode([
                        'note' => $internalNoteText,
                    ]),
                    'created_at' => now(),
                ]);

                $this->notificationService->notifyCS(
                    'New Internal Note',
                    "Engineer " . $empName . " added an internal note: \"" . $internalNoteText . "\" on ticket TKT-" . str_pad((string) $ticketId, 4, '0', STR_PAD_LEFT) . ".",
                    $ticketId
                );
            }

            if ($isProof) {
                $pendingEvaluationId = DB::table('ticket_statuses')
                    ->whereRaw('LOWER(status_name) = ?', ['pending evaluation'])
                    ->value('ticket_status_ID');

                if ($pendingEvaluationId) {
                    DB::table('tickets')
                        ->where('ticket_ID', $ticketId)
                        ->update([
                            'ticket_status_ID' => $pendingEvaluationId,
                            'in_progress_owner' => 'employee',
                            'proof_rejected' => false,
                            'rejection_reason' => null,
                            'updated_at' => now(),
                        ]);

                    DB::table('ticket_audit_logs')->insert([
                        'ticket_ID' => $ticketId,
                        'action_type' => 'proof_uploaded',
                        'action_by_ID' => $empId,
                        'actor_type' => 'employee',
                        'details' => json_encode(['message' => 'Proof of completion uploaded. Ticket status set to Pending Evaluation.']),
                        'created_at' => now(),
                    ]);

                    $ticketRefProof = 'TKT-' . str_pad((string) $ticketId, 4, '0', STR_PAD_LEFT);
                    $proofUploadData = [
                        'ticket_id' => $ticketId,
                        'ticket_ref' => $ticketRefProof,
                        'employee_name' => $empName,
                        'type' => 'proof_uploaded',
                    ];
                    $this->notificationService->notifyCustomer(
                        $customerId,
                        'Proof of Completion Uploaded',
                        "Proof of completion has been uploaded for ticket {$ticketRefProof} by " . $empName . ". Status is now Pending Evaluation.",
                        $ticketId,
                        $proofUploadData
                    );

                    $catNameProof = DB::table('problem_categories')->where('problem_category_ID', $ticket->problem_category_ID)->value('category_name') ?? '';
                    $prioNameProof = DB::table('ticket_priorities')->where('priority_ID', $ticket->priority_ID ?? 1)->value('priority_name') ?? '';
                    $this->sendCustomerEmailAfterResponse(
                        $notifyCustomer,
                        $customerId,
                        'Proof of Completion Uploaded',
                        "Proof of completion has been uploaded for your ticket {$ticketRefProof} by " . $empName . ". Status is now Pending Evaluation.",
                        $ticketId,
                        $ticket->title,
                        $catNameProof,
                        $prioNameProof
                    );

                    $this->notificationService->notifyCS(
                        'Proof of Completion Uploaded',
                        "Proof of completion has been uploaded for ticket {$ticketRefProof} by " . $empName . ". Ticket status set to Pending Evaluation.",
                        $ticketId,
                        $proofUploadData
                    );
                }
            }
        });

        $this->notificationService->broadcastTicketChange('updated', $ticketId);
        $this->cacheService->clearTicketCaches();

        return ['status' => 200, 'data' => ['message' => 'Ticket updated successfully.']];
    }

    /**
     * Check an employee-requested status change against the superadmin Transition Matrix.
     *
     * Submitting proof (Pending Evaluation) is the employee's request to resolve the ticket, so it
     * is checked as a move to Resolved. Otherwise a blocked "-> Resolved" transition would let the
     * employee submit proof and only fail later, when Customer Service approves it.
     *
     * Returns a 422 response payload when the transition is not allowed, or null when it is.
     */
    private function validateEmployeeStatusChange(object $ticket, string $newStatusName): ?array
    {
        $statusId = DB::table('ticket_statuses')
            ->whereRaw('LOWER(status_name) = ?', [strtolower($newStatusName)])
            ->value('ticket_status_ID');

        if (!$statusId || $statusId == $ticket->ticket_status_ID) {
            return null;
        }

        $targetState = match (strtolower(trim($newStatusName))) {
            'resolved', 'pending evaluation' => TicketStateMachine::STATE_RESOLVED,
            'closed' => TicketStateMachine::STATE_CLOSED,
            'on hold', 'hold', 'pending' => TicketStateMachine::STATE_ON_HOLD,
            'in progress' => TicketStateMachine::STATE_IN_PROGRESS_EMPLOYEE,
            default => null,
        };

        $currentState = $this->stateMachine->resolveState($ticket);
        if ($targetState === null || $currentState === $targetState) {
            return null;
        }

        try {
            $this->stateMachine->validateTransition($ticket, $currentState, $targetState);
        } catch (\App\Exceptions\InvalidTicketTransitionException $e) {
            return [
                'status' => 422,
                'data' => [
                    'message' => $e->getMessage(),
                    'code' => 'INVALID_TICKET_TRANSITION',
                    'from_status' => $e->fromStatus,
                    'to_status' => $e->toStatus,
                    'allowed_statuses' => $e->allowedStatuses,
                ],
            ];
        }

        return null;
    }

    /**
     * Send a customer email once the response has been returned, so a slow mail
     * provider can never hold the request (and its database transaction) open.
     */
    /**
     * Ask ticket-service (owner of SLA rules) to recalculate SLA deadlines after a
     * priority change made here. Failures are logged and never block assignment.
     */
    private function requestSlaRecalculation(int $ticketId): void
    {
        try {
            $ticketServiceUrl = rtrim((string) env('TICKET_SERVICE_URL', 'http://ticket-service:8000'), '/');
            $response = Http::timeout(5)
                ->withHeaders(['X-Internal-Token' => (string) env('INTERNAL_TOKEN', '')])
                ->post("{$ticketServiceUrl}/api/internal/tickets/{$ticketId}/sla/recalculate");
            if (!$response->successful()) {
                Log::warning("SLA recalculation request failed for ticket {$ticketId}: HTTP " . $response->status());
            }
        } catch (\Throwable $e) {
            Log::warning("SLA recalculation request failed for ticket {$ticketId}: " . $e->getMessage());
        }
    }

    private function sendCustomerEmailAfterResponse(
        bool $enabled,
        int $customerId,
        string $subject,
        string $message,
        int $ticketId,
        ?string $ticketTitle,
        string $category,
        string $priority
    ): void {
        if (!$enabled) {
            return;
        }

        app()->terminating(function () use ($customerId, $subject, $message, $ticketId, $ticketTitle, $category, $priority) {
            try {
                $this->notificationService->sendCustomerEmail(
                    $customerId,
                    $subject,
                    $message,
                    $ticketId,
                    (string) $ticketTitle,
                    $category,
                    $priority
                );
            } catch (\Throwable $e) {
                Log::warning("Deferred customer email failed for ticket {$ticketId}: {$e->getMessage()}");
            }
        });
    }

    /**
     * Get department summary statistics for a department manager.
     */
    public function getDepartmentSummaryForEmployee(string $employeeEmail): ?array
    {
        $employeeId = DB::table('employees')->where('email', $employeeEmail)->value('emp_id');
        if (!$employeeId) {
            return null;
        }

        $emp = DB::table('employees')->where('emp_id', $employeeId)->first();
        if (!$emp) {
            return null;
        }

        $isManager = (
            strtolower((string)($emp->position_level ?? '')) === 'manager' ||
            str_contains(strtolower((string)($emp->role ?? '')), 'manager') ||
            str_contains(strtolower((string)($emp->technical_role ?? '')), 'manager')
        );

        if (!$isManager) {
            return null;
        }

        $dept = strtolower(trim((string)($emp->department ?? '')));
        if ($dept === '') {
            return null;
        }

        $breachedQuery = DB::table('tickets as t')
            ->leftJoin('problem_categories as pc', 'pc.problem_category_ID', '=', 't.problem_category_ID')
            ->leftJoin('machines as m', 'm.machine_ID', '=', 't.machine_ID')
            ->leftJoin('clients as c', 'c.id', '=', 't.created_by')
            ->whereNotIn('t.ticket_status_ID', [3, 4])
            ->where(function ($d) use ($dept) {
                if (str_contains($dept, 'service')) {
                    $d->whereRaw('LOWER(COALESCE(pc.category_name, "")) LIKE ?', ['%service%'])
                      ->orWhereRaw('LOWER(COALESCE(pc.category_name, "")) LIKE ?', ['%biomedical%'])
                      ->orWhereRaw('LOWER(COALESCE(pc.category_name, "")) LIKE ?', ['%machine%'])
                      ->orWhereRaw('LOWER(COALESCE(pc.category_name, "")) LIKE ?', ['%maintenance%']);
                } elseif (str_contains($dept, 'it')) {
                    $d->whereRaw('LOWER(COALESCE(pc.category_name, "")) LIKE ?', ['%it%'])
                      ->orWhereRaw('LOWER(COALESCE(pc.category_name, "")) LIKE ?', ['%software%'])
                      ->orWhereRaw('LOWER(COALESCE(pc.category_name, "")) LIKE ?', ['%hardware%'])
                      ->orWhereRaw('LOWER(COALESCE(pc.category_name, "")) LIKE ?', ['%network%'])
                      ->orWhereRaw('LOWER(COALESCE(pc.category_name, "")) LIKE ?', ['%system%']);
                } else {
                    $d->whereRaw('LOWER(COALESCE(pc.category_name, "")) LIKE ?', ["%{$dept}%"]);
                }
            })
            ->where(function ($s) {
                $s->where('t.sla_status', 'Breached')
                  ->orWhere(function ($r) {
                      $r->whereNotNull('t.resolution_due_at')->where('t.resolution_due_at', '<', now());
                  });
            });

        $count = (clone $breachedQuery)->count();
        $first = (clone $breachedQuery)
            ->orderByDesc('t.updated_at')
            ->select('t.ticket_ID', 't.title', 'm.machine_name', 'c.client_name', 't.sla_status', 't.resolution_due_at', 'pc.category_name')
            ->first();

        $sampleTicket = null;
        if ($first) {
            $sampleTicket = [
                'id' => 'TKT-' . str_pad((string) $first->ticket_ID, 4, '0', STR_PAD_LEFT),
                'ticket_ID' => $first->ticket_ID,
                'title' => $first->title,
                'category' => $first->category_name ?? 'General',
                'facility' => $first->machine_name ?? $first->client_name ?? 'On-site',
                'equipment' => $first->machine_name ?? null,
                'sla_status' => 'Breached',
                'slaStatus' => 'Breached',
                'is_breached' => true,
                'resolution_due_at' => $first->resolution_due_at,
            ];
        }

        return [
            'is_manager' => true,
            'department' => $emp->department,
            'sla_breached_count' => $count,
            'sla_breached_ticket' => $sampleTicket,
        ];
    }

    /**
     * Get tickets assigned to an employee.
     */
    public function getEmployeeTickets(string $employeeEmail): array
    {
        $employeeId = DB::table('employees')->where('email', $employeeEmail)->value('emp_id');
        if (!$employeeId) {
            return [];
        }

        $emp = DB::table('employees')->where('emp_id', $employeeId)->first();
        $isManager = $emp && (
            strtolower((string)($emp->position_level ?? '')) === 'manager' ||
            str_contains(strtolower((string)($emp->role ?? '')), 'manager') ||
            str_contains(strtolower((string)($emp->technical_role ?? '')), 'manager')
        );
        $dept = strtolower(trim((string)($emp->department ?? '')));

        $query = DB::table('tickets as t')
            ->leftJoin('ticket_assignments as ta', function ($join) use ($employeeId) {
                $join->on('ta.ticket_ID', '=', 't.ticket_ID')
                     ->where('ta.employee_ID', '=', $employeeId);
            })
            ->leftJoin('problem_categories as pc', 'pc.problem_category_ID', '=', 't.problem_category_ID')
            ->leftJoin('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->leftJoin('ticket_priorities as tp', 'tp.priority_ID', '=', 't.priority_ID')
            ->leftJoin('machines as m', 'm.machine_ID', '=', 't.machine_ID')
            ->leftJoin('clients as c', 'c.id', '=', 't.created_by')
            ->leftJoin('ticket_types as tt', 'tt.ticket_type_ID', '=', 't.ticket_type_ID')
            ->where(function ($q) use ($employeeId, $isManager, $dept) {
                $q->where('ta.employee_ID', $employeeId)
                  ->orWhere('t.assigned_to', $employeeId);

                if ($isManager && $dept !== '') {
                    $q->orWhere(function ($sub) use ($dept) {
                        $sub->where('t.ticket_status_ID', 5)
                        ->where(function ($d) use ($dept) {
                            if (str_contains($dept, 'service')) {
                                $d->whereRaw('LOWER(COALESCE(pc.category_name, "" )) LIKE ?', ['%service%'])
                                  ->orWhereRaw('LOWER(COALESCE(pc.category_name, "" )) LIKE ?', ['%biomedical%'])
                                  ->orWhereRaw('LOWER(COALESCE(pc.category_name, "" )) LIKE ?', ['%machine%'])
                                  ->orWhereRaw('LOWER(COALESCE(pc.category_name, "" )) LIKE ?', ['%maintenance%']);
                            } elseif (str_contains($dept, 'it')) {
                                $d->whereRaw('LOWER(COALESCE(pc.category_name, "" )) LIKE ?', ['%it%'])
                                  ->orWhereRaw('LOWER(COALESCE(pc.category_name, "" )) LIKE ?', ['%software%'])
                                  ->orWhereRaw('LOWER(COALESCE(pc.category_name, "" )) LIKE ?', ['%hardware%'])
                                  ->orWhereRaw('LOWER(COALESCE(pc.category_name, "" )) LIKE ?', ['%network%'])
                                  ->orWhereRaw('LOWER(COALESCE(pc.category_name, "" )) LIKE ?', ['%system%']);
                            } else {
                                $d->whereRaw('LOWER(COALESCE(pc.category_name, "" )) LIKE ?', ["%{$dept}%"]);
                            }
                        });
                    });
                }
            })
            ->orderByDesc('t.updated_at')
            ->select(
                't.ticket_ID',
                't.title',
                'pc.category_name',
                'ts.status_name',
                'tp.priority_name',
                't.created_at',
                't.updated_at',
                't.resolution_due_at',
                't.response_due_at',
                't.sla_status',
                't.last_reminder_sent_at',
                'm.machine_name',
                'm.serial_number',
                'c.client_name',
                DB::raw("COALESCE(ta.assignment_status, 'assigned') as assignment_status"),
                't.proof_rejected',
                't.rejection_reason',
                't.hold_reason',
                't.escalation_reason',
                'tt.type_name as ticket_type'
            )
            ->distinct();

        $rows = $query->get();

        $ticketIds = $rows->pluck('ticket_ID')->toArray();
        $pendingReassigns = collect();
        $deniedReassigns = collect();
        $ticketTimelines = collect();

        if (!empty($ticketIds)) {
            $latestRequests = DB::table('reassignment_requests')
                ->whereIn('ticket_id', $ticketIds)
                ->orderByDesc('request_id')
                ->get()
                ->groupBy('ticket_id')
                ->map(fn($group) => $group->first());

            $pendingReassigns = $latestRequests->filter(fn($r) => $r->status === 'pending');
            $deniedReassigns = $latestRequests->filter(fn($r) => $r->status === 'denied');

            try {
                $auditLogs = DB::table('ticket_audit_logs as tal')
                    ->leftJoin('employees as e', 'e.emp_id', '=', 'tal.action_by_ID')
                    ->whereIn('tal.ticket_ID', $ticketIds)
                    ->select(
                        'tal.*',
                        DB::raw("TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))) as actor_name")
                    )
                    ->orderBy('tal.created_at', 'asc')
                    ->get()
                    ->groupBy('ticket_ID');

                foreach ($auditLogs as $tId => $logs) {
                    $events = [];
                    foreach ($logs as $log) {
                        $details = json_decode($log->details ?? '{}', true) ?? [];
                        $actor = $log->actor_name ?: ($log->actor_type === 'customer' ? 'Customer' : 'Staff');
                        $time = $log->created_at ? Carbon::parse($log->created_at)->toIso8601String() : null;
                        $type = 'system';
                        $text = '';

                        if ($log->action_type === 'reminder_sent') {
                            $type = 'reminder';
                            $recipient = $details['recipient_name'] ?? 'assigned technician';
                            $msg = trim($details['message'] ?? '');
                            $text = "Reminder sent to {$recipient} by {$actor}." . ($msg !== '' ? " Message: \"{$msg}\"" : '');
                        } elseif ($log->action_type === 'create') {
                            $text = "Ticket created by {$actor}.";
                        } elseif ($log->action_type === 'accept') {
                            $text = "Assignment accepted by {$actor}.";
                        } elseif ($log->action_type === 'reassign_request') {
                            $type = 'reassign';
                            $reason = $details['reason'] ?? '';
                            $text = "Reassignment request submitted by {$actor}. Reason: \"{$reason}\"";
                        } elseif ($log->action_type === 'reassign_deny' || $log->action_type === 'reassign_reject') {
                            $type = 'reassign';
                            $reason = $details['reason'] ?? '';
                            $text = "Reassignment request denied by {$actor}." . ($reason !== '' ? " Reason: \"{$reason}\"." : '');
                        } elseif ($log->action_type === 'status_change') {
                            $type = 'status';
                            $text = "Status updated to \"" . ($details['status'] ?? '') . "\" by {$actor}.";
                        } elseif ($log->action_type === 'hold') {
                            $text = "Ticket placed on hold by {$actor}." . (!empty($details['reason']) ? " Reason: \"" . $details['reason'] . "\"" : '');
                        } elseif ($log->action_type === 'resume') {
                            $text = "Ticket resumed from hold by {$actor}.";
                        }

                        if ($text !== '') {
                            $events[] = [
                                'id' => 'audit-' . $log->log_ID,
                                'type' => $type,
                                'text' => $text,
                                'timestamp' => $time,
                            ];
                        }
                    }
                    $ticketTimelines->put($tId, $events);
                }
            } catch (\Throwable $e) {
                // Non-blocking fallback
            }
        }

        $deniedAuditReasons = collect();
        if ($deniedReassigns->isNotEmpty()) {
            $deniedTicketIds = $deniedReassigns->keys()->all();
            $deniedAuditReasons = DB::table('ticket_audit_logs')
                ->whereIn('ticket_ID', $deniedTicketIds)
                ->whereIn('action_type', ['reassign_deny', 'reassign_reject'])
                ->orderByDesc('log_ID')
                ->get()
                ->groupBy('ticket_ID')
                ->map(function ($group) {
                    $first = $group->first();
                    $details = json_decode($first->details ?? '{}', true);
                    return $details['reason'] ?? null;
                });
        }

        return $rows->map(function ($row) use ($pendingReassigns, $deniedReassigns, $deniedAuditReasons, $ticketTimelines) {
            $pendingReassign = $pendingReassigns->get($row->ticket_ID);
            $deniedReassign = $deniedReassigns->get($row->ticket_ID);

            $csDisapprovalReason = null;
            if (empty($pendingReassign) && !empty($deniedReassign)) {
                $csDisapprovalReason = $deniedReassign->deny_reason ?: ($deniedAuditReasons->get($row->ticket_ID) ?: null);
            }

            $createdAtObj = is_string($row->created_at) ? Carbon::parse($row->created_at) : $row->created_at;
            $updatedAtObj = is_string($row->updated_at) ? Carbon::parse($row->updated_at) : $row->updated_at;
            $slaMetrics = $this->computeSlaMetrics($row);
            $statusLower = strtolower(trim((string) ($row->status_name ?? '')));
            $isAcceptedStatus = in_array($statusLower, [
                'in progress',
                'on hold',
                'pending evaluation',
                'pending',
                'resolved',
                'closed',
                'discarded',
                'discarded by customer',
            ], true);

            return [
                'id' => 'TKT-' . str_pad((string) $row->ticket_ID, 4, '0', STR_PAD_LEFT),
                'ticket_ID' => $row->ticket_ID,
                'title' => $row->title,
                'customer' => $row->client_name ?: 'Unknown Customer',
                'facility' => null,
                'equipment' => ($row->machine_name || $row->serial_number) ? ($row->machine_name . ($row->serial_number ? ' - ' . $row->serial_number : '')) : 'Unspecified Equipment',
                'status' => $row->status_name ?? 'Open',
                'priority' => $row->priority_name ?? 'Low',
                'category' => $row->category_name ?? 'General',
                'date' => $createdAtObj ? $createdAtObj->format('Y-m-d') : now()->format('Y-m-d'),
                'slaStatus' => $slaMetrics['status'],
                'sla_status' => $slaMetrics['status'],
                'resolution_due_at' => $slaMetrics['due_at'],
                'due_at' => $slaMetrics['due_at'],
                'time_remaining_minutes' => $slaMetrics['time_remaining_minutes'],
                'is_breached' => $slaMetrics['is_breached'],
                'is_at_risk' => $slaMetrics['is_at_risk'],
                'is_paused' => $slaMetrics['is_paused'],
                'lastUpdate' => ($updatedAtObj ?: $createdAtObj ?: now())->toIso8601String(),
                'accepted' => $row->assignment_status === 'accepted' || $isAcceptedStatus,
                'escalated' => (strtolower((string)($row->status_name ?? '')) === 'escalated'),
                'escalation_reason' => $row->escalation_reason ?? null,
                'hold_reason' => $row->hold_reason ?? null,
                'reassignmentRequested' => !empty($pendingReassign),
                'reassignmentReason' => $pendingReassign ? $pendingReassign->reason : null,
                'deniedReassignment' => empty($pendingReassign) && !empty($deniedReassign),
                'disapprovalReason' => $csDisapprovalReason,
                'reassignmentDenyReason' => $csDisapprovalReason,
                'proofRejected' => (bool)$row->proof_rejected,
                'rejectionReason' => $row->rejection_reason,
                'type' => $row->ticket_type ?? 'External',
                'ticket_type' => $row->ticket_type ?? 'External',
                'is_internal' => ($row->ticket_type ?? '') === 'Internal',
                'last_reminder_sent_at' => $row->last_reminder_sent_at ? Carbon::parse($row->last_reminder_sent_at)->toIso8601String() : null,
                'timeline' => $ticketTimelines->get($row->ticket_ID, []),
            ];
        })->values()->all();
    }

    /**
     * Get internal tickets created by an employee.
     */
    public function getInternalTickets(int $empId): array
    {
        $internalTypeId = DB::table('ticket_types')
            ->whereRaw('LOWER(type_name) = ?', ['internal'])
            ->value('ticket_type_ID');

        $rows = DB::table('tickets as t')
            ->join('ticket_types as tt', 'tt.ticket_type_ID', '=', 't.ticket_type_ID')
            ->leftJoin('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->leftJoin('ticket_priorities as tp', 'tp.priority_ID', '=', 't.priority_ID')
            ->leftJoin('machines as m', 'm.machine_ID', '=', 't.machine_ID')
            ->leftJoin('clients as c', 'c.id', '=', 't.created_by')
            ->leftJoin('problem_categories as pc', 'pc.problem_category_ID', '=', 't.problem_category_ID')
            ->where('t.ticket_type_ID', $internalTypeId)
            ->where('t.requested_by', $empId)
            ->orderByDesc('t.created_at')
            ->select(
                't.ticket_ID',
                't.title',
                't.description',
                't.assigned_to',
                'pc.category_name',
                'ts.status_name',
                'tp.priority_name',
                't.created_at',
                't.updated_at',
                't.resolution_due_at',
                't.sla_status',
                't.last_reminder_sent_at',
                'm.machine_name',
                'm.serial_number',
                'c.client_name',
                'tt.type_name as ticket_type'
            )
            ->get();

        return $rows->map(function ($row) {
            $slaMetrics = $this->computeSlaMetrics($row);
            $createdAtObj = is_string($row->created_at) ? Carbon::parse($row->created_at) : $row->created_at;
            $updatedAtObj = is_string($row->updated_at) ? Carbon::parse($row->updated_at) : $row->updated_at;
            return [
                'id' => 'TKT-' . str_pad((string) $row->ticket_ID, 4, '0', STR_PAD_LEFT),
                'ticket_ID' => $row->ticket_ID,
                'title' => $row->title,
                'description' => $row->description,
                'category' => $row->category_name ?? 'General',
                'status' => $row->status_name ?? 'Open',
                'priority' => $row->priority_name ?? 'Low',
                'customer' => $row->client_name ?: 'Unknown Customer',
                'equipment' => ($row->machine_name || $row->serial_number) ? ($row->machine_name . ($row->serial_number ? ' - ' . $row->serial_number : '')) : 'Unspecified Equipment',
                'date' => $createdAtObj ? $createdAtObj->format('Y-m-d') : now()->format('Y-m-d'),
                'lastUpdate' => ($updatedAtObj ?: $createdAtObj ?: now())->toIso8601String(),
                'slaStatus' => $slaMetrics['status'],
                'sla_status' => $slaMetrics['status'],
                'resolution_due_at' => $slaMetrics['due_at'],
                'due_at' => $slaMetrics['due_at'],
                'time_remaining_minutes' => $slaMetrics['time_remaining_minutes'],
                'is_breached' => $slaMetrics['is_breached'],
                'is_at_risk' => $slaMetrics['is_at_risk'],
                'is_paused' => $slaMetrics['is_paused'],
                'type' => $row->ticket_type ?? 'Internal',
                'is_internal' => true,
                'assigned_to' => $row->assigned_to,
                'last_reminder_sent_at' => $row->last_reminder_sent_at ? Carbon::parse($row->last_reminder_sent_at)->toIso8601String() : null,
            ];
        })->values()->all();
    }
}
