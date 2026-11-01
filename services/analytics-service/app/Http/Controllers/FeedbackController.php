<?php

namespace App\Http\Controllers;

use App\Models\CustomerFeedback;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class FeedbackController extends Controller
{
    /**
     * Store new customer satisfaction feedback.
     */
    public function store(Request $request)
    {
        // Enforce the master feedback collection toggle via configuration-service API
        $isFeedbackEnabled = true;
        try {
            $configRes = Http::timeout(3)->get('http://configuration-service:8000/api/feedback-form/status');
            if ($configRes->successful()) {
                $statusData = $configRes->json();
                $isFeedbackEnabled = (bool) ($statusData['is_enabled'] ?? $statusData['isEnabled'] ?? true);
            }
        } catch (\Throwable $e) {
            Log::info('Configuration service status check bypassed in FeedbackController: ' . $e->getMessage());
        }

        if (!$isFeedbackEnabled) {
            return response()->json([
                'status'  => 'error',
                'message' => 'Customer feedback submissions and analytics collection are currently disabled by the system administrator.',
            ], 403);
        }

        $validated = $request->validate([
            'ticket_id'                   => 'required|string',
            'customer_id'                 => 'nullable|string',
            'ratings'                     => 'required|array',
            'comments'                    => 'nullable|array',
            'overall_comment'             => 'nullable|string',
            'question_answers'            => 'nullable|array',
            'category_questions_snapshot' => 'nullable|array',
        ]);

        $ratings = $validated['ratings'] ?? [];
        $comments = $validated['comments'] ?? [];

        // Validate that ticket is in Resolved or Closed status via ticket-service
        try {
            $ticketServiceUrl = env('TICKET_SERVICE_URL', 'http://ticket-service:8000');
            $ticketRes = Http::timeout(3)->get("{$ticketServiceUrl}/api/tickets/{$validated['ticket_id']}");
            if ($ticketRes->successful()) {
                $ticketData = $ticketRes->json();
                $ticketObj = $ticketData['ticket'] ?? $ticketData['data'] ?? $ticketData;
                $statusName = strtolower(trim((string) ($ticketObj['status_name'] ?? $ticketObj['status'] ?? '')));
                if (!in_array($statusName, ['resolved', 'closed'])) {
                    return response()->json([
                        'status'  => 'error',
                        'message' => 'Feedback can only be submitted for tickets in Resolved or Closed status.',
                    ], 422);
                }

                // Verify customer ownership if customer ID is present
                $ticketClientId = $ticketObj['client_ID'] ?? $ticketObj['client_id'] ?? $ticketObj['customer_id'] ?? null;
                $reqCustomerId = $validated['customer_id'] ?? $request->header('X-User-ID');
                if ($ticketClientId && $reqCustomerId && (string) $ticketClientId !== (string) $reqCustomerId) {
                    $userRole = strtolower(trim((string) ($request->header('X-User-Role') ?? '')));
                    if ($userRole === 'customer' || $userRole === 'client') {
                        return response()->json([
                            'status'  => 'error',
                            'message' => 'Unauthorized: You can only submit feedback for tickets you own.',
                        ], 403);
                    }
                }
            }
        } catch (\Throwable $e) {
            Log::info('Ticket status check bypassed in FeedbackController store: ' . $e->getMessage());
        }

        // Calculate average score across rated employees
        $ratingValues = array_values(array_filter($ratings, fn($r) => is_numeric($r) && $r > 0));
        $avgRating = count($ratingValues) > 0 ? (array_sum($ratingValues) / count($ratingValues)) : 5.0;

        // Build array of employee ratings
        $employeeRatings = [];
        foreach ($ratings as $empId => $score) {
            $employeeRatings[] = [
                'employee_id' => $empId,
                'rating'      => (int) $score,
                'comment'     => $comments[$empId] ?? '',
            ];
        }

        $feedback = CustomerFeedback::updateOrCreate(
            ['ticket_id' => $validated['ticket_id']],
            [
                'customer_id'                 => $validated['customer_id'] ?? null,
                'overall_rating'              => round($avgRating, 2),
                'overall_comment'             => $validated['overall_comment'] ?? '',
                'employee_ratings'            => $employeeRatings,
                'question_answers'            => $validated['question_answers'] ?? [],
                'category_questions_snapshot' => $validated['category_questions_snapshot'] ?? [],
            ]
        );

        return response()->json([
            'status'  => 'success',
            'message' => 'Customer feedback stored successfully.',
            'data'    => $feedback,
        ], 201);
    }

    /**
     * Update existing customer feedback within the 48-hour edit window.
     */
    public function updateByTicket(Request $request, $ticketId)
    {
        $feedback = CustomerFeedback::where('ticket_id', $ticketId)->first();
        if (!$feedback) {
            return response()->json([
                'status'  => 'not_found',
                'message' => 'No feedback found for this ticket to update.',
            ], 404);
        }

        // Enforce customer ownership check
        $reqCustomerId = $request->input('customer_id') ?? $request->header('X-User-ID');
        $userRole = strtolower(trim((string) ($request->header('X-User-Role') ?? '')));
        if ($feedback->customer_id && $reqCustomerId && ($userRole === 'customer' || $userRole === 'client')) {
            if ((string) $feedback->customer_id !== (string) $reqCustomerId) {
                return response()->json([
                    'status'  => 'error',
                    'message' => 'Unauthorized: You can only edit your own feedback.',
                ], 403);
            }
        }

        // Enforce 48-hour edit window
        $hoursSinceCreation = now()->diffInHours($feedback->created_at);
        if ($hoursSinceCreation > 48) {
            return response()->json([
                'status'  => 'error',
                'message' => 'The 48-hour feedback edit window has expired. Feedback can no longer be updated.',
                'hours_elapsed' => $hoursSinceCreation,
            ], 422);
        }

        $validated = $request->validate([
            'ratings'                     => 'nullable|array',
            'comments'                    => 'nullable|array',
            'overall_comment'             => 'nullable|string',
            'question_answers'            => 'nullable|array',
            'category_questions_snapshot' => 'nullable|array',
        ]);

        if (isset($validated['ratings'])) {
            $ratings = $validated['ratings'];
            $comments = $validated['comments'] ?? [];
            $ratingValues = array_values(array_filter($ratings, fn($r) => is_numeric($r) && $r > 0));
            $avgRating = count($ratingValues) > 0 ? (array_sum($ratingValues) / count($ratingValues)) : 5.0;

            $employeeRatings = [];
            foreach ($ratings as $empId => $score) {
                $employeeRatings[] = [
                    'employee_id' => $empId,
                    'rating'      => (int) $score,
                    'comment'     => $comments[$empId] ?? '',
                ];
            }
            $feedback->overall_rating = round($avgRating, 2);
            $feedback->employee_ratings = $employeeRatings;
        }

        if (array_key_exists('overall_comment', $validated)) {
            $feedback->overall_comment = $validated['overall_comment'] ?? '';
        }
        if (isset($validated['question_answers'])) {
            $feedback->question_answers = $validated['question_answers'];
        }
        if (isset($validated['category_questions_snapshot'])) {
            $feedback->category_questions_snapshot = $validated['category_questions_snapshot'];
        }

        $feedback->save();

        return response()->json([
            'status'  => 'success',
            'message' => 'Customer feedback updated successfully.',
            'data'    => $feedback,
        ]);
    }

    /**
     * Delete customer feedback within the 48-hour window.
     */
    public function deleteByTicket(Request $request, $ticketId)
    {
        $feedback = CustomerFeedback::where('ticket_id', $ticketId)->first();
        if (!$feedback) {
            return response()->json([
                'status'  => 'not_found',
                'message' => 'No feedback found for this ticket to delete.',
            ], 404);
        }

        // Enforce customer ownership check
        $reqCustomerId = $request->input('customer_id') ?? $request->header('X-User-ID');
        $userRole = strtolower(trim((string) ($request->header('X-User-Role') ?? '')));
        if ($feedback->customer_id && $reqCustomerId && ($userRole === 'customer' || $userRole === 'client')) {
            if ((string) $feedback->customer_id !== (string) $reqCustomerId) {
                return response()->json([
                    'status'  => 'error',
                    'message' => 'Unauthorized: You can only delete your own feedback.',
                ], 403);
            }
        }

        // Enforce 48-hour delete window
        $hoursSinceCreation = now()->diffInHours($feedback->created_at);
        if ($hoursSinceCreation > 48) {
            return response()->json([
                'status'  => 'error',
                'message' => 'The 48-hour feedback deletion window has expired. Feedback can no longer be deleted.',
                'hours_elapsed' => $hoursSinceCreation,
            ], 422);
        }

        $feedback->delete();

        return response()->json([
            'status'  => 'success',
            'message' => 'Customer feedback deleted successfully.',
        ]);
    }

    /**
     * Get feedback record for a specific ticket.
     */
    public function getByTicket($ticketId)
    {
        $candidateIds = [(string) $ticketId];
        $trimmedId = trim((string) $ticketId);
        if ($trimmedId !== '' && !in_array($trimmedId, $candidateIds, true)) {
            $candidateIds[] = $trimmedId;
        }

        if (is_numeric($trimmedId)) {
            $num = (int) $trimmedId;
            $candidateIds[] = sprintf('TKTS-%05d', $num);
            $candidateIds[] = sprintf('TKT-%05d', $num);
            $candidateIds[] = (string) $num;
        } elseif (preg_match('/^(?:TKTS|TKT)-?0*(\d+)$/i', $trimmedId, $m)) {
            $num = (int) $m[1];
            $candidateIds[] = (string) $num;
            $candidateIds[] = sprintf('TKTS-%05d', $num);
            $candidateIds[] = sprintf('TKT-%05d', $num);
        }

        $candidateIds = array_values(array_unique(array_filter($candidateIds)));
        $feedback = CustomerFeedback::whereIn('ticket_id', $candidateIds)->first();

        // Cross-check ticket-service only if not found in database directly
        if (!$feedback) {
            try {
                $ticketServiceUrl = env('TICKET_SERVICE_URL', 'http://ticket-service:8000');
                $tRes = Http::timeout(1)->get("{$ticketServiceUrl}/api/tickets/{$ticketId}");
                if ($tRes->successful()) {
                    $tData = $tRes->json();
                    $tObj = $tData['ticket'] ?? $tData['data'] ?? $tData;
                    $altNumber = $tObj['ticket_number'] ?? null;
                    $altId = $tObj['ticket_ID'] ?? $tObj['id'] ?? null;
                    if ($altNumber && !in_array($altNumber, $candidateIds, true)) {
                        $feedback = CustomerFeedback::where('ticket_id', $altNumber)->first();
                    }
                    if (!$feedback && $altId && !in_array((string) $altId, $candidateIds, true)) {
                        $feedback = CustomerFeedback::where('ticket_id', (string) $altId)->first();
                    }
                }
            } catch (\Throwable $e) {
                // ignore timeout or network error
            }
        }

        if (!$feedback) {
            return response()->json([
                'status'  => 'not_found',
                'message' => 'No feedback recorded for this ticket.',
                'data'    => null,
            ], 404);
        }

        return response()->json([
            'status' => 'success',
            'data'   => $feedback,
        ]);
    }

    /**
     * Get aggregate CSAT statistics.
     */
    public function csatStats(Request $request)
    {
        $query = CustomerFeedback::query();

        if ($request->filled('date_from')) {
            $query->where('created_at', '>=', \Carbon\Carbon::parse($request->query('date_from'))->startOfDay());
        }
        if ($request->filled('date_to')) {
            $query->where('created_at', '<=', \Carbon\Carbon::parse($request->query('date_to'))->endOfDay());
        }

        if ($request->filled('ticket_ids')) {
            $tIds = is_array($request->query('ticket_ids')) 
                ? $request->query('ticket_ids') 
                : explode(',', $request->query('ticket_ids'));
            $tIds = array_filter(array_map('trim', $tIds));
            if (!empty($tIds)) {
                $query->whereIn('ticket_id', $tIds);
            }
        }

        $avgScore = (clone $query)->avg('overall_rating');
        $totalReviews = (clone $query)->count();
        $satisfiedCount = (clone $query)->where('overall_rating', '>=', 4)->count();
        $satisfactionPercentage = $totalReviews > 0 ? round(($satisfiedCount / $totalReviews) * 100, 1) : 100.0;

        // Calculate monthly trend over last 6 periods
        $trendsQuery = CustomerFeedback::query();
        if ($request->filled('ticket_ids')) {
            $tIds = is_array($request->query('ticket_ids')) 
                ? $request->query('ticket_ids') 
                : explode(',', $request->query('ticket_ids'));
            $tIds = array_filter(array_map('trim', $tIds));
            if (!empty($tIds)) {
                $trendsQuery->whereIn('ticket_id', $tIds);
            }
        }
        $trends = $trendsQuery->select(
            DB::raw("DATE_FORMAT(created_at, '%b %Y') as month"),
            DB::raw("AVG(overall_rating) as csat")
        )
        ->groupBy('month')
        ->orderBy(DB::raw("MIN(created_at)"), 'asc')
        ->limit(6)
        ->get();

        return response()->json([
            'status' => 'success',
            'data' => [
                'average_score' => $avgScore !== null ? round((float) $avgScore, 2) : 5.0,
                'total_reviews' => $totalReviews,
                'satisfaction_percentage' => $satisfactionPercentage,
                'trends' => $trends,
            ],
        ]);
    }
}
