<?php

namespace App\Http\Controllers;

use App\Services\AuditTimelineService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

class TicketTimelineController extends Controller
{
    protected AuditTimelineService $timelineService;

    public function __construct(AuditTimelineService $timelineService)
    {
        $this->timelineService = $timelineService;
    }

    /**
     * Retrieve chronological audit timeline for a specific ticket.
     * Automatically applies customer redactions on internal entries (AC-11, AC-3.5).
     */
    public function timeline(Request $request, $id): JsonResponse
    {
        $ticketId = (int) $id;
        if ($ticketId <= 0) {
            return response()->json([
                'status' => 'error',
                'message' => 'Invalid ticket identifier provided.',
            ], 422);
        }

        $user = $request->user();
        if (!$user) {
            return response()->json(['status' => 'error', 'message' => 'Unauthenticated.'], 401);
        }

        $filters = [
            'event_type' => $request->query('event_type'),
            'date_from' => $request->query('date_from'),
            'date_to' => $request->query('date_to'),
            'order' => $request->query('order', 'desc'),
            'page' => $request->query('page', 1),
            'per_page' => $request->query('per_page', 30),
        ];

        try {
            $result = $this->timelineService->getTicketTimeline(
                $ticketId,
                $filters,
                $user,
                (int) ($filters['per_page'] ?? 30)
            );

            return response()->json($result, 200);
        } catch (NotFoundHttpException $e) {
            return response()->json([
                'status' => 'error',
                'message' => $e->getMessage(),
            ], 404);
        } catch (AccessDeniedHttpException $e) {
            return response()->json([
                'status' => 'error',
                'message' => $e->getMessage(),
            ], 403);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error("TicketTimelineController error: " . $e->getMessage() . " at " . $e->getFile() . ":" . $e->getLine());
            return response()->json([
                'status' => 'error',
                'message' => 'Failed to retrieve ticket timeline. Please check service logs.',
            ], 500);
        }
    }
}

