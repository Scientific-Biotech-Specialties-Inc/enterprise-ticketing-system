<?php

namespace App\Http\Controllers;

use App\Services\TicketAccessService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Internal endpoint attachment-service calls before serving a file (spec 0037).
 *
 * Guarded by both X-Internal-Token and auth.subsystem on the forwarded caller
 * bearer, so a leaked internal token alone cannot enumerate access.
 */
class InternalAttachmentAccessController extends Controller
{
    public function __construct(private TicketAccessService $access)
    {
    }

    public function check(Request $request)
    {
        $validated = $request->validate([
            'ticket_id' => ['nullable', 'integer'],
            'assignment_id' => ['nullable', 'integer'],
        ]);

        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $identity = $this->access->identityOf($user);

        $ticketId = $validated['ticket_id'] ?? null;
        $assignmentId = $validated['assignment_id'] ?? null;

        if ($ticketId === null && $assignmentId !== null) {
            $ticketId = DB::table('ticket_assignments')->where('assignment_ID', (int) $assignmentId)->value('ticket_ID');
            if ($ticketId === null) {
                return response()->json(['message' => 'Assignment not found.'], 404);
            }
        }

        // No ticket asked: the caller only wants its own verified identity (pending uploads).
        if ($ticketId === null) {
            return response()->json(['allowed' => true] + $identity);
        }

        $ticket = DB::table('tickets')->where('ticket_ID', (int) $ticketId)->first();
        if (!$ticket) {
            return response()->json(['message' => 'Ticket not found.'], 404);
        }

        return response()->json(['allowed' => $this->access->canView($user, $ticket)] + $identity);
    }
}
