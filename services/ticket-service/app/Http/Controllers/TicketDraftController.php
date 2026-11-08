<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ResolvesVerifiedPrincipal;
use App\Services\TicketDraftService;
use Illuminate\Http\Request;

class TicketDraftController extends Controller
{
    use ResolvesVerifiedPrincipal;

    protected TicketDraftService $draftService;

    public function __construct(TicketDraftService $draftService)
    {
        $this->draftService = $draftService;
    }

    /**
     * Spec 0034: the draft owner is the verified customer only. Returns an error response
     * (401 no valid token, 403 staff) or the customer id.
     *
     * @return int|\Illuminate\Http\JsonResponse
     */
    protected function resolveCustomerId(Request $request)
    {
        $principal = $this->verifiedPrincipal($request);
        if (!$principal) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }
        if ($principal['type'] !== 'customer') {
            return response()->json(['message' => 'Drafts are available to customers only.'], 403);
        }

        return $principal['id'];
    }

    public function saveDraft(Request $request)
    {
        $clientId = $this->resolveCustomerId($request);
        if ($clientId instanceof \Illuminate\Http\JsonResponse) {
            return $clientId;
        }

        $rawDraftId = $request->input('draft_id', $request->input('id'));
        $draftId = (!empty($rawDraftId) && is_numeric($rawDraftId)) ? (int) $rawDraftId : null;

        $result = $this->draftService->saveDraft($clientId, $request->all(), $draftId);

        return response()->json($result, $result['status'] ?? 200);
    }

    public function listDrafts(Request $request)
    {
        $clientId = $this->resolveCustomerId($request);
        if ($clientId instanceof \Illuminate\Http\JsonResponse) {
            return $clientId;
        }

        $drafts = $this->draftService->getDrafts($clientId);

        return response()->json([
            'drafts' => $drafts,
            'total' => count($drafts),
        ], 200);
    }

    public function getDraft(Request $request, $id)
    {
        $clientId = $this->resolveCustomerId($request);
        if ($clientId instanceof \Illuminate\Http\JsonResponse) {
            return $clientId;
        }

        $draft = $this->draftService->getDraft($clientId, (int) $id);
        if (!$draft) {
            return response()->json([
                'error' => 'DRAFT_NOT_FOUND',
                'message' => 'Draft not found or you do not have permission to view it.',
            ], 404);
        }

        return response()->json([
            'draft' => $draft,
        ], 200);
    }

    public function deleteDraft(Request $request, $id)
    {
        $clientId = $this->resolveCustomerId($request);
        if ($clientId instanceof \Illuminate\Http\JsonResponse) {
            return $clientId;
        }

        $success = $this->draftService->deleteDraft($clientId, (int) $id);
        if (!$success) {
            return response()->json([
                'error' => 'DRAFT_NOT_FOUND',
                'message' => 'Draft not found or already deleted.',
            ], 404);
        }

        return response()->json([
            'message' => 'Draft deleted successfully.',
        ], 200);
    }
}
