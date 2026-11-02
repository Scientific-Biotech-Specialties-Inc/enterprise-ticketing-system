<?php

namespace App\Actions\Tickets;

use Illuminate\Support\Facades\DB;
use App\Services\SLAService;

class CalculateTicketSlaAction
{
    public function __construct(
        protected SLAService $slaService
    ) {}

    /**
     * Calculate SLA metrics and due dates for a ticket.
     *
     * @param mixed $ticket
     * @param int|null $priorityId
     * @return array
     */
    public function execute($ticket, ?int $priorityId = null): array
    {
        $ticketObj = is_numeric($ticket) ? DB::table('tickets')->where('ticket_ID', $ticket)->first() : (object) $ticket;
        if (!$ticketObj) {
            return ['success' => false, 'message' => 'Ticket not found.'];
        }

        $effectivePriorityId = $priorityId ?? $ticketObj->priority_ID ?? 1;
        $priorityName = DB::table('ticket_priorities')->where('priority_ID', $effectivePriorityId)->value('priority_name') ?? 'Low';
        $departmentId = $ticketObj->department_id ?? 2;
        $problemCategoryId = $ticketObj->problem_category_ID ?? 1;
        $branchId = $ticketObj->branch_id ?? null;

        $tracking = DB::table('sla_trackings')->where('ticket_id', $ticketObj->ticket_ID)->first();

        return [
            'success' => true,
            'ticket_id' => $ticketObj->ticket_ID,
            'priority' => $priorityName,
            'response_due_at' => $tracking->response_due_at ?? null,
            'resolution_due_at' => $tracking->resolution_due_at ?? null,
            'sla_status' => $tracking->sla_status ?? 'within_sla',
            'is_breached' => $tracking ? (bool) $tracking->is_breached : false,
        ];
    }
}

