<?php

namespace App\Actions\Tickets;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Services\TicketCacheService;
use App\Services\TicketStateMachine;

class TransitionTicketStatusAction
{
    public function __construct(
        protected TicketCacheService $cacheService,
        protected TicketStateMachine $stateMachine
    ) {}

    /**
     * Transition a ticket status wrapped in a database transaction.
     *
     * @param int $ticketId
     * @param int $newStatusId
     * @param mixed $actor
     * @param array $context
     * @return array
     */
    public function execute(int $ticketId, int $newStatusId, $actor, array $context = []): array
    {
        return DB::transaction(function () use ($ticketId, $newStatusId, $actor, $context) {
            $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
            if (!$ticket) {
                return ['success' => false, 'message' => 'Ticket not found.', 'status' => 404];
            }

            $currentStatusId = (int) $ticket->ticket_status_ID;
            if ($currentStatusId === (int) $newStatusId) {
                return [
                    'success' => true,
                    'message' => 'Ticket is already in this status.',
                    'ticket' => (array) $ticket,
                ];
            }

            // Verify transition through TicketStateMachine
            $validation = $this->stateMachine->canTransition($ticket, $newStatusId, $actor, $context);
            if (!$validation['allowed']) {
                return [
                    'success' => false,
                    'message' => $validation['message'] ?? 'Status transition not allowed.',
                    'status' => 422,
                ];
            }

            $newStatusName = DB::table('ticket_statuses')->where('ticket_status_ID', $newStatusId)->value('status_name') ?? '';
            $oldStatusName = DB::table('ticket_statuses')->where('ticket_status_ID', $currentStatusId)->value('status_name') ?? '';

            $updateData = [
                'ticket_status_ID' => $newStatusId,
                'updated_at' => now(),
            ];

            $normNew = strtolower(trim($newStatusName));
            if ($normNew === 'resolved') {
                $updateData['resolved_at'] = now();
            } elseif ($normNew === 'closed') {
                $updateData['closed_at'] = now();
                if (empty($ticket->resolved_at)) {
                    $updateData['resolved_at'] = now();
                }
            } elseif ($normNew === 'on hold') {
                $updateData['on_hold_since'] = now();
                if (!empty($context['reason'])) {
                    $updateData['on_hold_reason'] = $context['reason'];
                }
            } elseif ($normNew === 'in progress') {
                $updateData['on_hold_since'] = null;
                $updateData['on_hold_reason'] = null;
            }

            DB::table('tickets')->where('ticket_ID', $ticketId)->update($updateData);

            // Audit log
            $actorId = $actor->emp_id ?? $actor->id ?? null;
            $actorName = trim(($actor->first_name ?? '') . ' ' . ($actor->last_name ?? ''));
            if (empty($actorName)) {
                $actorName = $actor->name ?? ($actor->email ?? 'System');
            }

            $details = [
                'field' => 'ticket_status_ID',
                'old' => $currentStatusId,
                'new' => $newStatusId,
                'old_status' => $oldStatusName,
                'new_status' => $newStatusName,
            ];
            if (!empty($context['reason'])) {
                $details['reason'] = $context['reason'];
            }

            DB::table('ticket_audit_logs')->insert([
                'ticket_ID' => $ticketId,
                'action_type' => 'status_changed',
                'actor_type' => ($actor instanceof \App\Models\Client) ? 'Customer' : 'Employee',
                'actor_id' => $actorId,
                'actor_name' => $actorName,
                'details' => json_encode($details),
                'created_at' => now(),
            ]);

            $this->cacheService->clearTicketCaches();

            $updatedTicket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();

            return [
                'success' => true,
                'message' => "Ticket status updated to {$newStatusName}.",
                'ticket' => (array) $updatedTicket,
                'old_status' => $oldStatusName,
                'new_status' => $newStatusName,
            ];
        });
    }
}

