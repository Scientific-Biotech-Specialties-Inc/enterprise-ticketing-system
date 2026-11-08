<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Str;
use App\Models\AiConversation;
use App\Services\GeminiService;

class AiChatController extends Controller
{
    protected GeminiService $geminiService;

    public function __construct(GeminiService $geminiService)
    {
        $this->geminiService = $geminiService;
    }

    /**
     * Spec 0034: identity comes only from the verified token, or from a valid X-Internal-Token
     * (trusted microservice). Never from a user_id the caller supplies.
     */
    protected function getAuthenticatedUser(Request $request): ?object
    {
        // 1. Verified Passport token
        $user = auth('api')->user() ?? $request->user();
        if ($user) {
            return $user;
        }

        // 2. Trusted internal microservice token
        if (\App\Http\Middleware\AuthenticateTokenOrInternal::hasValidInternalToken($request)) {
            return (object) ['is_internal' => true];
        }

        return null;
    }

    protected function isInternal(?object $auth): bool
    {
        return $auth !== null && !empty($auth->is_internal);
    }

    /** Staff (a verified user with an emp_id) may read customer AI chats, never change them. */
    protected function isStaff(?object $auth): bool
    {
        if ($auth === null || $this->isInternal($auth)) {
            return false;
        }

        // A staff JWT verified by VerifyEmployeeJwt becomes an AuthenticatedUserDto. Its claims carry no emp_id,
        // so the DTO type itself is the proof of staff identity (customers authenticate through Passport).
        return $auth instanceof \Ticketing\Auth\Dto\AuthenticatedUserDto
            || (int) ($auth->emp_id ?? 0) > 0;
    }

    /** 403 for a staff caller on a route that changes a conversation. */
    protected function staffWriteDenied(?object $auth)
    {
        if ($this->isStaff($auth)) {
            return response()->json(['success' => false, 'message' => 'Staff can read customer chats but not change them.'], 403);
        }

        return null;
    }

    /** The verified user id of a token caller, or null. */
    protected function tokenUserId(?object $auth): ?string
    {
        if ($auth === null || $this->isInternal($auth)) {
            return null;
        }
        $id = $auth->id ?? $auth->emp_id ?? (method_exists($auth, 'getAuthIdentifier') ? $auth->getAuthIdentifier() : null);

        return $id !== null && $id !== '' ? (string) $id : null;
    }

    /**
     * A user_id named in the request is honoured only for a trusted internal call or a verified staff reader
     * (the exceptions in spec 0034). A customer token can never use it to pick the owner.
     */
    protected function internalCallerUserId(Request $request): ?string
    {
        $id = $request->input('user_id');

        return $id !== null && $id !== '' ? (string) $id : null;
    }

    /** Internal calls reach any conversation. A token caller reaches only a conversation they own. */
    protected function canAccess(AiConversation $conversation, ?object $auth, bool $readOnly = false): bool
    {
        if ($this->isInternal($auth) || ($readOnly && $this->isStaff($auth))) {
            return true;
        }
        $uid = $this->tokenUserId($auth);

        return $uid !== null && !empty($conversation->user_id) && (string) $conversation->user_id === $uid;
    }

    /** Someone else's conversation is reported as not found, so ids cannot be probed. */
    protected function conversationNotFound()
    {
        return response()->json(['success' => false, 'message' => 'Conversation not found'], 404);
    }

    /**
     * POST /api/chat
     * Handles conversation chat with Google Gemini.
     */
    public function chat(Request $request)
    {
        $validated = $request->validate([
            'messages' => 'required|array',
            'conversation_id' => 'nullable|string',
            'user_id' => 'nullable|numeric', // used only on a trusted internal call
        ]);

        $auth = $this->getAuthenticatedUser($request);
        if (!$auth) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
        }

        if ($denied = $this->staffWriteDenied($auth)) {
            return $denied;
        }

        $isInternal = $this->isInternal($auth);
        $userId = $isInternal ? $this->internalCallerUserId($request) : $this->tokenUserId($auth);

        $convId = $validated['conversation_id'] ?? Str::uuid()->toString();
        $incomingMessages = $validated['messages'];

        // Retrieve or initialize conversation record and verify ownership
        $conversation = AiConversation::find($convId);
        if ($conversation && !$this->canAccess($conversation, $auth)) {
            return $this->conversationNotFound();
        }

        // Call Gemini Service
        $result = $this->geminiService->generateResponse($incomingMessages, $convId);

        // Retrieve or initialize conversation record and persist
        try {
            if (!$conversation) {
                $title = $this->extractMeaningfulTitle($incomingMessages);

                $conversation = new AiConversation([
                    'id' => $convId,
                    'user_id' => $userId,
                    'title' => $title,
                    'status' => 'active',
                    'messages' => [],
                ]);
            } elseif ($conversation->title === 'Support Inquiry' || $this->isGreetingOnly($conversation->title)) {
                $updatedTitle = $this->extractMeaningfulTitle($incomingMessages);
                if ($updatedTitle !== 'Support Inquiry') {
                    $conversation->title = $updatedTitle;
                }
            }

            // Append latest exchange
            $aiTimestamp = now()->toIso8601String();
            $aiMsgRecord = [
                'id' => 'ai-' . round(microtime(true) * 1000),
                'role' => 'ai',
                'content' => $result['content'],
                'timestamp' => $aiTimestamp,
            ];

            $allMessages = array_merge($incomingMessages, [$aiMsgRecord]);
            $conversation->messages = $allMessages;

            if ($result['escalate']) {
                $conversation->status = 'escalated';
                $conversation->escalation_data = $result['ticket_data'];
                if (!empty($result['ticket_data']['title']) && ($conversation->title === 'Support Inquiry' || $this->isGreetingOnly($conversation->title))) {
                    $conversation->title = $result['ticket_data']['title'];
                }
            }

            $conversation->save();
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('Failed to save AI conversation: ' . $e->getMessage());
        }

        return response()->json([
            'success' => true,
            'content' => $result['content'],
            'escalate' => $result['escalate'],
            'ticket_data' => $result['ticket_data'],
            'conversation_id' => $convId,
            'is_duplicate' => false,
        ]);
    }

    /**
     * GET /api/conversations
     * Returns conversations list for an authenticated user.
     */
    public function conversations(Request $request)
    {
        $auth = $this->getAuthenticatedUser($request);
        if (!$auth) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
        }

        $query = AiConversation::query();

        if ($this->isInternal($auth)) {
            if (($requestedUserId = $this->internalCallerUserId($request)) !== null) {
                $query->where('user_id', $requestedUserId);
            }
        } elseif ($this->isStaff($auth)) {
            // Staff read the chats of the customer they name. With no customer named they see none.
            $requestedUserId = $this->internalCallerUserId($request);
            $query->where('user_id', $requestedUserId ?? '__none__');
        } else {
            $query->where('user_id', $this->tokenUserId($auth));
        }

        $conversations = $query->orderBy('updated_at', 'desc')
            ->select(['id', 'user_id', 'title', 'status', 'messages', 'escalation_data', 'created_at', 'updated_at'])
            ->get()
            ->map(function ($c) {
                $cleaned = preg_replace('/^(?:\d+[\.\)\-:](?!\d)|\b[qQ]\d+[:\.]|\b(?:machine|problem|issue|item)[:\-])\s*/i', '', $c->title ?? '');
                $cleaned = trim($cleaned);
                if (!empty($cleaned) && $cleaned !== $c->title) {
                    $c->title = ucfirst($cleaned);
                    $c->save();
                }
                $c->message_count = is_array($c->messages) ? count($c->messages) : 0;
                unset($c->messages);
                return $c;
            });

        return response()->json([
            'success' => true,
            'conversations' => $conversations,
        ]);
    }

    /**
     * GET /api/conversations/{id}
     * Returns full conversation details and message history.
     */
    public function showConversation(Request $request, string $id)
    {
        $auth = $this->getAuthenticatedUser($request);
        if (!$auth) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
        }

        $conversation = AiConversation::find($id);

        if (!$conversation) {
            return response()->json([
                'success' => false,
                'message' => 'Conversation not found',
            ], 404);
        }

        if (!$this->canAccess($conversation, $auth, true)) {
            return $this->conversationNotFound();
        }

        return response()->json([
            'success' => true,
            'conversation' => $conversation,
        ]);
    }

    /**
     * DELETE /api/conversations/{id}
     * Deletes a conversation record.
     */
    public function deleteConversation(Request $request, string $id)
    {
        $auth = $this->getAuthenticatedUser($request);
        if (!$auth) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
        }

        if ($denied = $this->staffWriteDenied($auth)) {
            return $denied;
        }

        $conversation = AiConversation::find($id);

        if (!$conversation) {
            return response()->json([
                'success' => true,
                'message' => 'Conversation already deleted or not found',
            ]);
        }

        if (!$this->canAccess($conversation, $auth)) {
            return $this->conversationNotFound();
        }

        $conversation->delete();

        return response()->json([
            'success' => true,
            'message' => 'Conversation deleted successfully',
        ]);
    }

    /**
     * DELETE /api/conversations/{id}/messages/{messageId}
     * Individual messages are part of the support record (they feed escalation handoffs and
     * ticket context), so they can never be deleted one by one. The route stays registered so
     * older clients get a clear 403 instead of a 404.
     */
    public function deleteMessage(Request $request, string $id, string $messageId)
    {
        $auth = $this->getAuthenticatedUser($request);
        if (!$auth) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
        }

        if ($denied = $this->staffWriteDenied($auth)) {
            return $denied;
        }

        // Keep the ownership check first so another user's conversation still reads as 404.
        $conversation = AiConversation::find($id);
        if (!$conversation || !$this->canAccess($conversation, $auth)) {
            return $this->conversationNotFound();
        }

        return response()->json([
            'success' => false,
            'message' => 'Chat messages cannot be deleted.',
        ], 403);
    }

    /**
     * POST /api/tickets
     * Updates conversation status to ticket_created.
     */
    public function createTicket(Request $request)
    {
        $auth = $this->getAuthenticatedUser($request);
        if (!$auth) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
        }

        if ($denied = $this->staffWriteDenied($auth)) {
            return $denied;
        }

        $convId = $request->input('conversation_id');
        if ($convId) {
            $conversation = AiConversation::find($convId);
            if ($conversation) {
                if (!$this->canAccess($conversation, $auth)) {
                    return $this->conversationNotFound();
                }
                $conversation->status = 'ticket_created';
                if ($ticketId = $request->input('ticket_id')) {
                    // Persist the ticket link so staff can open the exact AI chat behind a ticket.
                    $escalation = $conversation->escalation_data ?? [];
                    $escalation['ticket_id'] = (int) $ticketId;
                    $conversation->escalation_data = $escalation;
                }
                $conversation->save();
            }
        }

        return response()->json([
            'success' => true,
            'message' => 'Ticket created link confirmed',
        ]);
    }

    public function markTicketCreated(Request $request)
    {
        return $this->createTicket($request);
    }

    /**
     * Extract a meaningful title from user messages, ignoring pure greetings.
     */
    protected function extractMeaningfulTitle(array $messages): string
    {
        $greetings = [
            'hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening',
            'good day', 'greetings', 'help', 'test', 'support', 'hi there', 'hello there',
            'ok', 'okay', 'yes', 'no', 'thanks', 'thank you', 'please help'
        ];

        foreach ($messages as $m) {
            if (($m['role'] ?? '') === 'user' && !empty($m['content'])) {
                $trimmed = trim($m['content']);
                $lower = strtolower($trimmed);
                $cleaned = trim(preg_replace('/[^\w\s]/', '', $lower));

                if (in_array($cleaned, $greetings, true)) {
                    continue;
                }

                foreach ($greetings as $g) {
                    if (str_starts_with($cleaned, $g . ' ')) {
                        $trimmed = trim(substr($trimmed, strlen($g)));
                        $trimmed = ltrim($trimmed, " ,.!?-");
                        break;
                    }
                }

                // Strip question numbers like "1.", "1)", "1 -", "Q1:", "Machine:"
                $trimmed = preg_replace('/^(?:\d+[\.\)\-:](?!\d)|\b[qQ]\d+[:\.]|\b(?:machine|problem|issue|item)[:\-])\s*/i', '', $trimmed);
                $trimmed = trim($trimmed);

                if (!empty($trimmed) && mb_strlen($trimmed) >= 3) {
                    return ucfirst(mb_substr($trimmed, 0, 55)) . (mb_strlen($trimmed) > 55 ? '...' : '');
                }
            }
        }

        return 'Support Inquiry';
    }

    /**
     * GET /api/conversations/{id}/escalate-handoff
     * Returns structured handoff data for ticket creation pre-fill (TS027 & TS050).
     */
    public function escalateHandoff(Request $request, string $id)
    {
        $auth = $this->getAuthenticatedUser($request);
        if (!$auth) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
        }

        $conversation = AiConversation::find($id);
        if (!$conversation) {
            return response()->json([
                'success' => true,
                'fallback' => true,
                'notice' => "We couldn't carry over your chat details — please fill in your ticket.",
                'data' => [
                    'title' => '',
                    'description' => '',
                    'category' => null,
                    'machine' => null,
                    'origin' => 'ai_chatbot',
                    'conversation_id' => $id,
                ],
            ]);
        }

        if (!$this->canAccess($conversation, $auth, true)) {
            return $this->conversationNotFound();
        }

        $escalationData = $conversation->escalation_data ?? [];
        $title = $escalationData['title'] ?? $conversation->title ?? 'Technical Support Request';

        // Generate clean human-readable summary instead of raw transcript dump
        $summary = '';
        if (!empty($escalationData['description']) && $escalationData['description'] !== 'Submitted via AI Support Assistant.') {
            $summary = $escalationData['description'];
        } else {
            $userIssues = [];
            $messages = is_array($conversation->messages) ? $conversation->messages : [];
            foreach ($messages as $m) {
                if (($m['role'] ?? '') === 'user' && !empty($m['content'])) {
                    $c = trim($m['content']);
                    if (!$this->isGreetingOnly($c)) {
                        $userIssues[] = $c;
                    }
                }
            }
            if (!empty($userIssues)) {
                $summary = "Customer reported issue: " . implode(" | ", array_slice($userIssues, 0, 3));
            } else {
                $summary = "Issue escalated from AI Support Assistant for technician review.";
            }
        }

        // Confidence threshold check (0.70)
        $CONFIDENCE_THRESHOLD = 0.70;

        $category = null;
        $catConf = (float) ($escalationData['category_confidence'] ?? 0.0);
        if (!empty($escalationData['category']) && $catConf >= $CONFIDENCE_THRESHOLD) {
            $category = $escalationData['category'];
        }

        $machine = null;
        $machConf = (float) ($escalationData['machine_confidence'] ?? 0.0);
        if (!empty($escalationData['machine']) && $machConf >= $CONFIDENCE_THRESHOLD) {
            $machine = $escalationData['machine'];
        }

        return response()->json([
            'success' => true,
            'fallback' => false,
            'data' => [
                'title' => $title,
                'description' => $summary,
                'category' => $category,
                'category_confidence' => $catConf,
                'machine' => $machine,
                'machine_confidence' => $machConf,
                'origin' => 'ai_chatbot',
                'conversation_id' => $conversation->id,
            ],
        ]);
    }

    /**
     * Check if a given title consists purely of greetings.
     */
    protected function isGreetingOnly(string $title): bool
    {
        $greetings = [
            'hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening',
            'good day', 'greetings', 'help', 'test', 'support', 'hi there', 'hello there'
        ];
        $cleaned = trim(preg_replace('/[^\w\s]/', '', strtolower($title)));
        return in_array($cleaned, $greetings, true);
    }

    /**
     * POST /api/classify-department
     * Classifies whether a ticket issue belongs to IT or Service.
     */
    public function classifyDepartment(Request $request)
    {
        $title = (string) $request->input('title', '');
        $description = (string) $request->input('description', '');

        $classification = $this->geminiService->classifyDepartment($title, $description);

        return response()->json([
            'success' => true,
            'data' => $classification,
        ]);
    }
}
