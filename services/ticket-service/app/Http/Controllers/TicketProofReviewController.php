<?php

namespace App\Http\Controllers;

use App\Services\ProofReviewService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Records that CS opened a proof of completion file (spec 0038 AC-31).
 * Thin controller: validation here, rules in ProofReviewService.
 */
class TicketProofReviewController extends Controller
{
    public function __construct(private ProofReviewService $proofReview)
    {
    }

    /**
     * POST /tickets/{ticketId}/proof-views
     */
    public function store(Request $request, int $ticketId): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $validated = $request->validate([
            'attachment_id' => ['required', 'integer', 'min:1'],
        ]);

        $result = $this->proofReview->recordView($ticketId, (int) $validated['attachment_id'], $user);

        return response()->json($result['data'], $result['status']);
    }
}
