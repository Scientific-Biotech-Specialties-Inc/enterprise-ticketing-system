<?php

namespace App\Actions\Tickets;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Services\TicketCacheService;
use App\Services\TicketStateMachine;

class AssignTicketAction
{
    public function __construct(
        protected TicketCacheService $cacheService
    ) {}

    /**
     * Assign a ticket to an employee wrapped in a database transaction.
     *
     * @param int $ticketId
     * @param int $assignedTo
     * @param mixed $actor
     * @param string|null $reason
     * @return array
     */
    public function execute(int $ticketId, int $assignedTo, $actor, ?string $reason = null): array
    {
        return DB::transaction(function () use ($ticketId, $assignedTo, $actor, $reason) {
            $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
            if (!$ticket) {
                return ['success' => false, 'message' => 'Ticket not found.', 'status' => 404];
            }

            $employee = DB::table('employees')->where('emp_id', $assignedTo)->first();
            if (!$employee) {
                return ['success' => false, 'message' => 'Assignee employee not found.', 'status' => 404];
            }

            $oldAssignedTo = $ticket->assigned_to;

            $updateData = [
                'assigned_to' => $assignedTo,
                'in_progress_owner' => TicketStateMachine::OWNER_EMPLOYEE,
                'updated_at' => now(),
            ];

            // If ticket is Open or unassigned, update status to Assigned/In Progress if needed
            $openStatusId = DB::table('ticket_statuses')->where('status_name', 'Open')->value('ticket_status_ID');
            $assignedStatusId = DB::table('ticket_statuses')->where('status_name', 'In Progress')->value('ticket_status_ID');
            if ($openStatusId && (int) $ticket->ticket_status_ID === (int) $openStatusId && $assignedStatusId) {
                $updateData['ticket_status_ID'] = $assignedStatusId;
            }

            DB::table('tickets')->where('ticket_ID', $ticketId)->update($updateData);

            // Audit log
            $actorId = $actor->emp_id ?? $actor->id ?? null;
            $actorName = trim(($actor->first_name ?? '') . ' ' . ($actor->last_name ?? ''));
            if (empty($actorName)) {
                $actorName = $actor->name ?? ($actor->email ?? 'System');
            }

            $details = [
                'field' => 'assigned_to',
                'old' => $oldAssignedTo,
                'new' => $assignedTo,
                'assignee_name' => trim(($employee->first_name ?? '') . ' ' . ($employee->last_name ?? '')),
                'actor_name' => $actorName,
            ];
            if ($reason) {
                $details['reason'] = $reason;
            }

            DB::table('ticket_audit_logs')->insert([
                'ticket_ID' => $ticketId,
                'action_type' => 'assigned',
                'actor_type' => 'Employee',
                'action_by_ID' => $actorId,
                'details' => json_encode($details),
                'created_at' => now(),
            ]);

            $this->cacheService->clearTicketCaches();

            $updatedTicket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();

            return [
                'success' => true,
                'message' => 'Ticket assigned successfully.',
                'ticket' => (array) $updatedTicket,
                'assigned_to' => $assignedTo,
            ];
        });
    }
}

