<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Lightweight ticket ownership lookup for other services (spec 0038 AC-34).
 *
 * Reads only the tickets and ticket_statuses tables and makes no outbound HTTP
 * calls, so callers such as analytics-service feedback get a fast answer instead
 * of the full ticket detail payload. A customer caller gets 404 for a ticket that
 * is not theirs (spec 0034).
 */
class TicketOwnershipController extends Controller
{
    /**
     * GET /tickets/{ticketId}/ownership
     */
    public function show(Request $request, int $ticketId): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $ticket = DB::table('tickets as t')
            ->leftJoin('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->where('t.ticket_ID', $ticketId)
            ->first(['t.ticket_ID', 't.ticket_number', 't.created_by', 't.is_internal', 'ts.status_name']);

        $notFound = response()->json(['message' => 'Ticket not found.'], 404);
        if (!$ticket) {
            return $notFound;
        }

        if ($user instanceof \App\Models\Client) {
            if ((bool) $ticket->is_internal || (int) $ticket->created_by !== (int) $user->id) {
                return $notFound;
            }
        }

        return response()->json([
            'ticket_ID' => (int) $ticket->ticket_ID,
            'ticket_number' => $ticket->ticket_number,
            'client_ID' => (bool) $ticket->is_internal ? null : (int) $ticket->created_by,
            'status_name' => $ticket->status_name,
            'is_internal' => (bool) $ticket->is_internal,
        ]);
    }
}
