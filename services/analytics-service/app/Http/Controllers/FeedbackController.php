<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ResolvesVerifiedPrincipal;
use App\Models\CustomerFeedback;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class FeedbackController extends Controller
{
    use ResolvesVerifiedPrincipal;

    private const ADMIN_ROLES = ['admin', 'superadmin'];

    private function normalizedRole(?string $role): string
    {
        return str_replace([' ', '_', '-'], '', strtolower(trim((string) $role)));
    }

    /** 401 when nobody is verified, otherwise the principal. */
    private function requirePrincipal(Request $request)
    {
        $principal = $this->verifiedPrincipal($request);

        return $principal ?: response()->json(['status' => 'error', 'message' => 'Unauthenticated.'], 401);
    }

    /** Fetch a ticket from ticket-service as the caller. Returns [httpStatus, ticketArray|null]. */
    private function fetchTicketAsCaller(Request $request, string $ticketId, int $timeout = 3): array
    {
        // ticket-service resolves tickets by numeric primary key only. A display number such as
        // "TKT-0012" would raise a type error there and surface as a misleading 503.
        if (!ctype_digit($ticketId)) {
            return [404, null];
        }

        $ticketServiceUrl = env('TICKET_SERVICE_URL', 'http://ticket-service:8000');
        $http = Http::timeout($timeout)->acceptJson();
        if ($token = $this->callerToken($request)) {
            $http = $http->withToken($token);
        }
        $res = $http->get("{$ticketServiceUrl}/api/tickets/" . rawurlencode($ticketId));
        if (!$res->successful()) {
            return [$res->status(), null];
        }
        $data = $res->json();

        return [200, $data['ticket'] ?? $data['data'] ?? $data];
    }

    /**
     * Store new customer satisfaction feedback.
     */
    public function store(Request $request)
    {
        $principal = $this->requirePrincipal($request);
        if ($principal instanceof \Illuminate\Http\JsonResponse) {
            return $principal;
        }
        if ($principal['type'] !== 'customer') {
            return response()->json(['status' => 'error', 'message' => 'Only customers can submit feedback.'], 403);
        }

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
            'ratings'                     => 'required|array',
            'comments'                    => 'nullable|array',
            'overall_comment'             => 'nullable|string',
            'question_answers'            => 'nullable|array',
            'category_questions_snapshot' => 'nullable|array',
        ]);

        $ratings = $validated['ratings'] ?? [];
        $comments = $validated['comments'] ?? [];

        // Spec 0034: the ticket must belong to the verified customer and be Resolved or Closed.
        // If ticket-service cannot answer, refuse the request. The ownership check is never skipped.
        try {
            [$ticketStatus, $ticketObj] = $this->fetchTicketAsCaller($request, (string) $validated['ticket_id']);
        } catch (\Throwable $e) {
            Log::warning('Feedback ticket lookup failed: ' . $e->getMessage());
            $ticketStatus = 0;
            $ticketObj = null;
        }

        if (in_array($ticketStatus, [401, 403, 404], true)) {
            return response()->json(['status' => 'error', 'message' => 'Ticket not found.'], 404);
        }
        if ($ticketStatus !== 200 || !is_array($ticketObj)) {
            return response()->json([
                'status'  => 'error',
                'message' => 'Feedback cannot be verified right now. Please try again shortly.',
            ], 503);
        }

        $ticketClientId = $ticketObj['client_ID'] ?? $ticketObj['client_id'] ?? $ticketObj['customer_id'] ?? null;
        if ($ticketClientId === null || (string) $ticketClientId !== (string) $principal['id']) {
            return response()->json(['status' => 'error', 'message' => 'Ticket not found.'], 404);
        }

        $statusName = strtolower(trim((string) ($ticketObj['status_name'] ?? $ticketObj['status'] ?? '')));
        if (!in_array($statusName, ['resolved', 'closed'], true)) {
            return response()->json([
                'status'  => 'error',
                'message' => 'Feedback can only be submitted for tickets in Resolved or Closed status.',
            ], 422);
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
                'customer_id'                 => (string) $principal['id'],
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
        $principal = $this->requirePrincipal($request);
        if ($principal instanceof \Illuminate\Http\JsonResponse) {
            return $principal;
        }
        if ($principal['type'] !== 'customer') {
            return response()->json(['status' => 'error', 'message' => 'Only the customer who wrote the feedback can edit it.'], 403);
        }

        $feedback = CustomerFeedback::where('ticket_id', $ticketId)->first();
        if (!$feedback) {
            return response()->json([
                'status'  => 'not_found',
                'message' => 'No feedback found for this ticket to update.',
            ], 404);
        }

        // Another customer's feedback is reported as not found, so ids cannot be probed.
        if ((string) $feedback->customer_id !== (string) $principal['id']) {
            return response()->json([
                'status'  => 'not_found',
                'message' => 'No feedback found for this ticket to update.',
            ], 404);
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
        $principal = $this->requirePrincipal($request);
        if ($principal instanceof \Illuminate\Http\JsonResponse) {
            return $principal;
        }
        if ($principal['type'] !== 'staff' || !in_array($this->normalizedRole($principal['role']), self::ADMIN_ROLES, true)) {
            return response()->json(['status' => 'error', 'message' => 'Only administrators can delete feedback.'], 403);
        }

        $feedback = CustomerFeedback::where('ticket_id', $ticketId)->first();
        if (!$feedback) {
            return response()->json([
                'status'  => 'not_found',
                'message' => 'No feedback found for this ticket to delete.',
            ], 404);
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
    public function getByTicket(Request $request, $ticketId)
    {
        $principal = $this->requirePrincipal($request);
        if ($principal instanceof \Illuminate\Http\JsonResponse) {
            return $principal;
        }

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
                [$tStatus, $tObj] = $this->fetchTicketAsCaller($request, (string) $ticketId, 1);
                if ($tStatus === 200 && is_array($tObj)) {
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

        // A customer sees only their own feedback. Staff can read any.
        if ($feedback && $principal['type'] === 'customer' && (string) $feedback->customer_id !== (string) $principal['id']) {
            $feedback = null;
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
        $principal = $this->requirePrincipal($request);
        if ($principal instanceof \Illuminate\Http\JsonResponse) {
            return $principal;
        }
        if ($principal['type'] !== 'staff') {
            return response()->json(['status' => 'error', 'message' => 'Staff access only.'], 403);
        }

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
        // No reviews means no score: never report an invented 100% or 5.0 (spec 0031 AC-14).
        $satisfactionPercentage = $totalReviews > 0 ? round(($satisfiedCount / $totalReviews) * 100, 1) : null;

        // Average rating per ticket, used by ticket-service for per employee and per department CSAT.
        $ticketRatings = [];
        if ($request->filled('ticket_ids')) {
            $ticketRatings = (clone $query)
                ->select('ticket_id', DB::raw('AVG(overall_rating) as rating'))
                ->groupBy('ticket_id')
                ->pluck('rating', 'ticket_id')
                ->map(fn ($rating) => round((float) $rating, 2))
                ->all();
        }

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
                'average_score' => $avgScore !== null ? round((float) $avgScore, 2) : null,
                'total_reviews' => $totalReviews,
                'satisfaction_percentage' => $satisfactionPercentage,
                'ticket_ratings' => (object) $ticketRatings,
                'trends' => $trends,
            ],
        ]);
    }
}
