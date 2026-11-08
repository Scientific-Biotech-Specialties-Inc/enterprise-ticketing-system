<?php

namespace App\Http\Controllers;

use App\Services\SLAService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Service to service SLA endpoints.
 *
 * Other microservices (for example employee-service, which changes a ticket's
 * priority during CS assignment) call this so SLA deadlines are always computed
 * by ticket-service, the owner of the SLA rules.
 */
class InternalSlaController extends Controller
{
    public function __construct(private SLAService $slaService)
    {
    }

    /**
     * Recalculate SLA deadlines for a ticket from its current category and priority.
     */
    public function recalculate(Request $request, int $ticketId)
    {
        $expected = (string) env('INTERNAL_TOKEN', '');
        $provided = (string) $request->header('X-Internal-Token', '');
        if ($expected === '' || !hash_equals($expected, $provided)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        try {
            $result = $this->slaService->recalculateForReclassification($ticketId);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['message' => $e->getMessage()], 404);
        } catch (\Throwable $e) {
            Log::warning("Internal SLA recalculation failed for ticket {$ticketId}: " . $e->getMessage());
            return response()->json(['message' => 'SLA recalculation failed.'], 500);
        }

        event(new \App\Events\TicketChanged(['type' => 'sla', 'ticket_id' => $ticketId]));

        return response()->json(['message' => 'SLA recalculated.', 'sla' => $result]);
    }
}
