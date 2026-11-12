<?php

namespace App\Services;

use App\Services\TicketCacheService;
use App\Services\TicketNotificationService;
use Illuminate\Support\Facades\DB;

class EmployeeReassignmentService
{
    protected TicketNotificationService $notificationService;
    protected TicketCacheService $cacheService;

    public function __construct(TicketNotificationService $notificationService, TicketCacheService $cacheService)
    {
        $this->notificationService = $notificationService;
        $this->cacheService = $cacheService;
    }

    /**
     * Submit an employee request for ticket reassignment.
     */
    public function submitRequest(int $ticketId, int $empId, string $reason): array
    {
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket) {
            return ['status' => 404, 'data' => ['message' => 'Ticket not found']];
        }

        $assignment = DB::table('ticket_assignments')
            ->where('ticket_ID', $ticketId)
            ->where('employee_ID', $empId)
            ->first();

        if (!$assignment) {
            return ['status' => 403, 'data' => ['message' => 'You are not assigned to this ticket.']];
        }

        DB::transaction(function () use ($ticketId, $empId, $reason) {
            DB::table('reassignment_requests')
                ->where('ticket_id', $ticketId)
                ->where('status', 'pending')
                ->update([
                    'status' => 'superseded',
                    'updated_at' => now(),
                ]);

            DB::table('reassignment_requests')->insert([
                'ticket_id' => $ticketId,
                'employee_id' => $empId,
                'reason' => $reason,
                'status' => 'pending',
                'requested_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            DB::table('ticket_assignments')
                ->where('ticket_ID', $ticketId)
                ->where('employee_ID', $empId)
                ->update([
                    'assignment_status' => 'reassign_requested',
                    'updated_at' => now(),
                ]);

            DB::table('ticket_audit_logs')->insert([
                'ticket_ID' => $ticketId,
                'action_type' => 'reassign_request',
                'action_by_ID' => $empId,
                'actor_type' => 'employee',
                'details' => json_encode(['reason' => $reason]),
                'created_at' => now(),
            ]);
        });

        $this->notificationService->broadcastTicketChange('reassign_requested', $ticketId, [
            'employee_id' => $empId,
            'reason' => $reason,
        ]);

        $this->cacheService->clearTicketCaches();

        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if ($ticket) {
            $customerId = $ticket->created_by;
            $title = $ticket->title;
            $emp = DB::table('employees')->where('emp_id', $empId)->first();
            $empName = $emp ? ($emp->first_name . ' ' . $emp->last_name) : 'Engineer';
            $ticketRef = 'TKT-' . str_pad((string) $ticketId, 4, '0', STR_PAD_LEFT);

            $csData = [
                'ticket_id' => $ticketId,
                'ticket_ref' => $ticketRef,
                'title' => $title,
                'requesting_employee' => $empName,
                'reason' => $reason,
                'type' => 'reassignment_request',
            ];

            $csTitle = 'Reassignment Requested';
            $csMessage = "Engineer " . $empName . " has requested reassignment for Ticket {$ticketRef}: \"" . $title . "\"." . ($reason !== '' ? " Reason: \"" . $reason . "\"." : "");

            // Route the request to the CSR who delegated the ticket, not every CSR.
            $delegatorId = (int) ($assignment->assigned_by ?? 0);
            $delegator = $delegatorId > 0
                ? DB::table('employees')->where('emp_id', $delegatorId)->where('role', 'customer service')->first()
                : null;

            if ($delegator) {
                $this->notificationService->notifyRecipient(
                    (int) $delegator->emp_id,
                    'employee',
                    $csTitle,
                    $csMessage,
                    $ticketId,
                    $csData
                );
            } else {
                // Delegator is unknown or no longer a CSR: fall back to CSRs in the engineer's branch.
                $branchCsIds = $emp && !empty($emp->branch)
                    ? DB::table('employees')
                        ->where('role', 'customer service')
                        ->where('branch', $emp->branch)
                        ->pluck('emp_id')
                    : collect();

                if ($branchCsIds->isNotEmpty()) {
                    foreach ($branchCsIds as $csEmpId) {
                        $this->notificationService->notifyRecipient((int) $csEmpId, 'employee', $csTitle, $csMessage, $ticketId, $csData);
                    }
                } else {
                    $this->notificationService->notifyCS($csTitle, $csMessage, $ticketId, $csData);
                }
            }

            $this->notificationService->notifyCustomer(
                $customerId,
                'Reassignment Requested',
                "Engineer " . $empName . " has requested reassignment for your ticket {$ticketRef}: \"" . $title . "\".",
                $ticketId
            );

            $catNameReas = DB::table('problem_categories')->where('problem_category_ID', $ticket->problem_category_ID)->value('category_name') ?? '';
            $prioNameReas = DB::table('ticket_priorities')->where('priority_ID', $ticket->priority_ID ?? 1)->value('priority_name') ?? '';
            $this->notificationService->sendCustomerEmail(
                $customerId,
                'Reassignment Requested',
                "Engineer " . $empName . " has requested reassignment for your ticket {$ticketRef}: \"" . $title . "\".",
                $ticketId,
                $title,
                $catNameReas,
                $prioNameReas
            );
        }

        return ['status' => 200, 'data' => ['message' => 'Reassignment request submitted successfully.']];
    }

    /**
     * Respond to a pending reassignment request (approve or deny).
     */
    public function respondToRequest(int $ticketId, array $validated, int $csEmpId): array
    {
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket) {
            return ['status' => 404, 'data' => ['message' => 'Ticket not found']];
        }

        if ($ticket->ticket_status_ID == 3) {
            return ['status' => 422, 'data' => ['message' => 'Resolved tickets cannot be reassigned.']];
        }

        $pendingRequest = DB::table('reassignment_requests')
            ->where('ticket_id', $ticketId)
            ->where('status', 'pending')
            ->orderByDesc('request_id')
            ->first();

        if (!$pendingRequest) {
            return ['status' => 404, 'data' => ['message' => 'No pending reassignment request found for this ticket.']];
        }

        $targetEmpId = $pendingRequest->employee_id;
        $newEmpId = $validated['new_employee_id'] ?? null;
        $rawDenyReason = trim($validated['reason'] ?? '');
        $denyReason = $rawDenyReason !== '' ? mb_strtoupper(mb_substr($rawDenyReason, 0, 1)) . mb_substr($rawDenyReason, 1) : '';

        if ($validated['action'] === 'approve' && $newEmpId) {
            $newEmp = DB::table('employees')->where('emp_id', $newEmpId)->first();
            if ($newEmp) {
                $track = \App\Http\Controllers\EmployeeDirectoryController::resolveCategoryTrack($ticket);
                $eligibility = \App\Http\Controllers\EmployeeDirectoryController::checkEligibility($newEmp, $ticket, $track);
                if (!$eligibility['eligible']) {
                    return [
                        'status' => 422,
                        'data' => [
                            'message' => 'The selected employee is not eligible for this ticket category.',
                            'code' => 'INELIGIBLE_EMPLOYEE',
                            'reason' => $eligibility['reason'],
                        ],
                    ];
                }
            }
        }

        DB::transaction(function () use ($ticketId, $pendingRequest, $validated, $csEmpId, $targetEmpId, $newEmpId, $denyReason) {
            if ($validated['action'] === 'approve') {
                DB::table('reassignment_requests')
                    ->where('request_id', $pendingRequest->request_id)
                    ->update([
                        'status' => 'approved',
                        'reviewed_at' => now(),
                        'updated_at' => now(),
                    ]);

                DB::table('ticket_assignments')
                    ->where('ticket_ID', $ticketId)
                    ->where('employee_ID', $targetEmpId)
                    ->delete();

                $updateData = ['updated_at' => now()];
                if ($newEmpId) {
                    $inProgressId = DB::table('ticket_statuses')
                        ->whereRaw('LOWER(status_name) = ?', ['in progress'])
                        ->value('ticket_status_ID') ?? 2;
                    $updateData['assigned_to'] = $newEmpId;
                    $updateData['ticket_status_ID'] = $inProgressId;
                    $updateData['in_progress_owner'] = 'employee';
                } else {
                    $inProgressId = DB::table('ticket_statuses')
                        ->whereRaw('LOWER(status_name) = ?', ['in progress'])
                        ->value('ticket_status_ID') ?? 2;
                    $updateData['assigned_to'] = null;
                    $updateData['ticket_status_ID'] = $inProgressId;
                    $updateData['in_progress_owner'] = 'cs';
                }

                DB::table('tickets')
                    ->where('ticket_ID', $ticketId)
                    ->update($updateData);

                if ($newEmpId) {
                    DB::table('ticket_assignments')->insert([
                        'ticket_ID' => $ticketId,
                        'employee_ID' => $newEmpId,
                        'assigned_by' => $csEmpId,
                        'assignment_status' => 'assigned',
                        'assigned_at' => now(),
                        'completed_at' => null,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]);
                }

                // Spec 0039 (AC-1, AC-3): the requester stops holding the ticket; the new assignee starts.
                $periods = app(AssignmentPeriodRecorder::class);
                $periods->release(
                    $ticketId,
                    $newEmpId ? AssignmentPeriodRecorder::REASON_REASSIGNED : AssignmentPeriodRecorder::REASON_RETURNED_TO_CS,
                    [(int) $targetEmpId]
                );
                if ($newEmpId) {
                    $periods->open($ticketId, (int) $newEmpId, (int) $csEmpId);
                }

                DB::table('ticket_audit_logs')->insert([
                    'ticket_ID' => $ticketId,
                    'action_type' => 'reassign_approve',
                    'action_by_ID' => $csEmpId,
                    'actor_type' => 'employee',
                    'details' => json_encode([
                        'message' => 'Reassignment request approved.',
                        'new_employee_id' => $newEmpId,
                    ]),
                    'created_at' => now(),
                ]);
            } else {
                DB::table('reassignment_requests')
                    ->where('request_id', $pendingRequest->request_id)
                    ->update([
                        'status' => 'denied',
                        'deny_reason' => $denyReason,
                        'reviewed_at' => now(),
                        'updated_at' => now(),
                    ]);

                DB::table('ticket_assignments')
                    ->where('ticket_ID', $ticketId)
                    ->where('employee_ID', $targetEmpId)
                    ->update([
                        'assignment_status' => 'assigned',
                        'updated_at' => now(),
                    ]);

                $inProgressId = DB::table('ticket_statuses')
                    ->whereRaw('LOWER(status_name) = ?', ['in progress'])
                    ->value('ticket_status_ID') ?? 2;

                DB::table('tickets')
                    ->where('ticket_ID', $ticketId)
                    ->update([
                        'assigned_to' => $targetEmpId,
                        'ticket_status_ID' => $inProgressId,
                        'in_progress_owner' => 'employee',
                        'updated_at' => now(),
                    ]);

                DB::table('ticket_audit_logs')->insert([
                    'ticket_ID' => $ticketId,
                    'action_type' => 'reassign_deny',
                    'action_by_ID' => $csEmpId,
                    'actor_type' => 'employee',
                    'details' => json_encode([
                        'message' => 'Reassignment request denied.',
                        'reason' => $denyReason,
                    ]),
                    'created_at' => now(),
                ]);
            }
        });

        $this->notificationService->broadcastTicketChange('reassigned_response', $ticketId, [
            'ticket_id' => $ticketId,
            'ticket_ID' => $ticketId,
            'ticketId' => $ticketId,
            'action' => $validated['action'],
            'employee_id' => $targetEmpId,
            'assigned_to' => $validated['action'] === 'approve' ? $newEmpId : $targetEmpId,
            'employee_ids' => $validated['action'] === 'approve' ? ($newEmpId ? [$newEmpId] : []) : [$targetEmpId],
            'removed_employee_ids' => $validated['action'] === 'approve' ? [$targetEmpId] : [],
            'previous_employee_ids' => $validated['action'] === 'approve' ? [$targetEmpId] : [],
            'disapproval_reason' => $validated['action'] === 'deny' ? $denyReason : null,
            'reassignment_deny_reason' => $validated['action'] === 'deny' ? $denyReason : null,
            'disapprovalReason' => $validated['action'] === 'deny' ? $denyReason : null,
            'reassignmentDenyReason' => $validated['action'] === 'deny' ? $denyReason : null,
        ]);

        $this->cacheService->clearTicketCaches();

        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if ($ticket) {
            $customerId = $ticket->created_by;
            $title = $ticket->title;
            $ticketRef = 'TKT-' . str_pad((string) $ticketId, 4, '0', STR_PAD_LEFT);
            $categoryName = DB::table('problem_categories')->where('problem_category_ID', $ticket->problem_category_ID)->value('category_name') ?? '';
            $priorityName = DB::table('ticket_priorities')->where('priority_ID', $ticket->priority_ID)->value('priority_name') ?? '';

            if ($validated['action'] === 'approve') {
                $this->notificationService->notifyRecipient(
                    $targetEmpId,
                    'employee',
                    'Reassignment Approved',
                    "Your reassignment request for Ticket {$ticketRef}: \"" . $title . "\" was approved.",
                    $ticketId,
                    ['ticket_id' => $ticketId, 'ticket_ref' => $ticketRef, 'title' => $title, 'type' => 'reassignment_approved'],
                    'reassignment'
                );

                if ($newEmpId) {
                    $newEmpData = DB::table('employees')->where('emp_id', $newEmpId)->first();
                    $newEmpName = $newEmpData ? ($newEmpData->first_name . ' ' . $newEmpData->last_name) : 'Engineer';

                    $assignData = [
                        'ticket_id' => $ticketId,
                        'ticket_ref' => $ticketRef,
                        'title' => $title,
                        'category' => $categoryName,
                        'priority' => $priorityName,
                        'type' => 'ticket_assigned',
                    ];

                    $this->notificationService->notifyRecipient(
                        $newEmpId,
                        'employee',
                        'Ticket Reassigned',
                        "Ticket {$ticketRef}: \"" . $title . "\" has been reassigned to you.",
                        $ticketId,
                        $assignData
                    );

                    $this->notificationService->sendTicketEmail(
                        $newEmpId,
                        'Ticket Reassigned',
                        "Ticket {$ticketRef}: \"{$title}\" has been reassigned to you.",
                        $ticketId,
                        $title,
                        $categoryName,
                        $priorityName
                    );

                    // If ticket is already breached, re-trigger immediate breach alert to newly assigned employee
                    $isBreached = ($ticket->sla_status ?? '') === 'Breached' || ($ticket->resolution_due_at && \Carbon\Carbon::parse($ticket->resolution_due_at)->isPast());
                    if ($isBreached) {
                        $overdueMinutes = $ticket->resolution_due_at ? max(1, (int) \Carbon\Carbon::parse($ticket->resolution_due_at)->diffInMinutes(now())) : 0;
                        $overdueDuration = $overdueMinutes >= 60
                            ? round($overdueMinutes / 60, 1) . ' hours overdue'
                            : "{$overdueMinutes} minutes overdue";

                        $customerName = $customerId ? (DB::table('clients')->where('id', $customerId)->value('client_name') ?? 'Valued Customer') : 'Valued Customer';

                        $breachData = [
                            'type' => 'overdue_sla_breach',
                            'ticket_id' => $ticketId,
                            'ticket_ref' => $ticketRef,
                            'title' => $title,
                            'summary' => $title,
                            'customer' => $customerName,
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
                            $newEmpId,
                            'employee',
                            "SLA Alert: Reassigned Ticket {$ticketRef} Already Breached",
                            "Urgent: You have been assigned Ticket {$ticketRef}: \"{$title}\" which has already breached its resolution SLA deadline ({$overdueDuration}). Immediate action required.",
                            $ticketId,
                            $breachData,
                            'overdue_sla_breach'
                        );

                        $this->notificationService->sendTicketEmail(
                            $newEmpId,
                            "SLA Alert: Reassigned Ticket {$ticketRef} Already Breached",
                            "Urgent: You have been assigned Ticket {$ticketRef}: \"{$title}\" which has already breached its resolution SLA deadline ({$overdueDuration}). Immediate action required.",
                            $ticketId,
                            $title,
                            $categoryName,
                            $priorityName,
                            'overdue_sla_breach',
                            [
                                'customer_name' => $customerName,
                                'sla_deadline' => $ticket->resolution_due_at,
                                'overdue_duration' => $overdueDuration,
                            ]
                        );

                        try {
                            DB::table('ticket_audit_logs')->insert([
                                'ticket_ID' => $ticketId,
                                'action_type' => 'sla_breached_reassigned',
                                'action_by_ID' => $csEmpId,
                                'actor_type' => 'employee',
                                'details' => json_encode([
                                    'sla_status' => 'Breached',
                                    'due_at' => $ticket->resolution_due_at,
                                    'overdue_duration' => $overdueDuration,
                                    'new_employee_id' => $newEmpId,
                                ]),
                                'created_at' => now(),
                            ]);
                        } catch (\Throwable $e) {}
                    }
                }

                $this->notificationService->notifyCS(
                    'Reassignment Approved',
                    "Reassignment request for Ticket {$ticketRef}: \"" . $title . "\" was approved." . ($newEmpId ? " Ticket reassigned to {$newEmpName}." : ""),
                    $ticketId,
                    null,
                    $csEmpId
                );
            } else {
                $denialData = [
                    'ticket_id' => $ticketId,
                    'ticket_ref' => $ticketRef,
                    'title' => $title,
                    'type' => 'reassignment_denied',
                    'reason' => $denyReason,
                ];

                $this->notificationService->notifyRecipient(
                    $targetEmpId,
                    'employee',
                    'Reassignment Rejected',
                    "Your reassignment request for Ticket {$ticketRef}: \"" . $title . "\" was rejected." . ($denyReason !== '' ? " Reason: \"" . $denyReason . "\"." : ""),
                    $ticketId,
                    $denialData,
                    'reassignment'
                );

                $this->notificationService->notifyCS(
                    'Reassignment Rejected',
                    "Reassignment request for Ticket {$ticketRef}: \"" . $title . "\" was rejected by CSR." . ($denyReason !== '' ? " Reason: \"" . $denyReason . "\"." : ""),
                    $ticketId,
                    null,
                    $csEmpId
                );
            }

            $this->notificationService->notifyCustomer(
                $customerId,
                $validated['action'] === 'approve' ? 'Ticket Reassigned' : 'Reassignment Rejected',
                $validated['action'] === 'approve'
                    ? "Reassignment request for your ticket {$ticketRef}: \"" . $title . "\" was approved. The ticket has been reassigned to a new engineer."
                    : "Reassignment request for ticket {$ticketRef}: \"" . $title . "\" was rejected.",
                $ticketId
            );

            $reassignEmailSubject = $validated['action'] === 'approve' ? 'Ticket Reassigned' : 'Reassignment Rejected';
            $reassignEmailMessage = $validated['action'] === 'approve'
                ? "Reassignment request for your ticket {$ticketRef}: \"" . $title . "\" was approved. The ticket has been reassigned to a new engineer."
                : "Reassignment request for ticket {$ticketRef}: \"" . $title . "\" was rejected.";
            $this->notificationService->sendCustomerEmail(
                $customerId,
                $reassignEmailSubject,
                $reassignEmailMessage,
                $ticketId,
                $title,
                $categoryName,
                $priorityName
            );
        }

        return ['status' => 200, 'data' => ['message' => 'Reassignment request responded to successfully.']];
    }

    /**
     * List all reassignment requests filtered by status and role.
     */
    public function listRequests($user, ?string $status): array
    {
        $query = DB::table('reassignment_requests as rr')
            ->join('tickets as t', 't.ticket_ID', '=', 'rr.ticket_id')
            ->join('employees as e', 'e.emp_id', '=', 'rr.employee_id')
            ->select(
                'rr.request_id',
                'rr.ticket_id',
                'rr.employee_id',
                'rr.reason',
                'rr.status',
                'rr.requested_at',
                'rr.reviewed_at',
                't.title as ticket_title',
                'e.first_name',
                'e.last_name',
                'e.email as employee_email'
            );

        $role = strtolower(trim((string) ($user->role ?? '')));
        $isCS = in_array($role, ['customer service', 'customer support', 'cs', 'head of cs', 'head of customer service', 'admin', 'superadmin', 'super admin']);
        if (!$isCS) {
            $query->where('rr.employee_id', $user->emp_id);
        } elseif (in_array($role, ['customer service', 'customer support', 'cs'], true)) {
            // A CSR works pending requests for tickets they delegated, plus fallback requests when delegator is absent or not a CSR.
            $csId = (int) $user->emp_id;
            $csBranch = !empty($user->branch) ? trim((string) $user->branch) : null;
            $query->where(function ($q) use ($csId, $csBranch) {
                $q->where('rr.status', '!=', 'pending')
                    ->orWhereExists(function ($sub) use ($csId) {
                        $sub->select(DB::raw(1))
                            ->from('ticket_assignments as ta')
                            ->whereColumn('ta.ticket_ID', 'rr.ticket_id')
                            ->whereColumn('ta.employee_ID', 'rr.employee_id')
                            ->where('ta.assigned_by', $csId);
                    })
                    ->orWhere(function ($fallbackQ) use ($csBranch) {
                        $fallbackQ->whereNotExists(function ($delegatorSub) {
                            $delegatorSub->select(DB::raw(1))
                                ->from('ticket_assignments as ta2')
                                ->join('employees as del', 'del.emp_id', '=', 'ta2.assigned_by')
                                ->whereColumn('ta2.ticket_ID', 'rr.ticket_id')
                                ->whereColumn('ta2.employee_ID', 'rr.employee_id')
                                ->whereIn('del.role', ['customer service', 'customer support', 'cs']);
                        });

                        if ($csBranch) {
                            $fallbackQ->where(function ($bQ) use ($csBranch) {
                                $bQ->where('e.branch', $csBranch)
                                    ->orWhereNull('e.branch')
                                    ->orWhere('e.branch', '');
                            });
                        }
                    });
            });
        }

        if ($status) {
            $query->where('rr.status', $status);
        }

        return $query->orderByDesc('rr.requested_at')->get()->map(function ($row) {
            return [
                'request_id' => $row->request_id,
                'ticket_id' => $row->ticket_id,
                'id' => 'TKT-' . str_pad((string) $row->ticket_id, 4, '0', STR_PAD_LEFT),
                'employee_id' => $row->employee_id,
                'employee_name' => trim($row->first_name . ' ' . $row->last_name),
                'employee_email' => $row->employee_email,
                'reason' => $row->reason,
                'status' => $row->status,
                'requested_at' => $row->requested_at,
                'reviewed_at' => $row->reviewed_at,
                'ticket_title' => $row->ticket_title,
            ];
        })->all();
    }
}
