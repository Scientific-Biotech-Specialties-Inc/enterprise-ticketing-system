<?php

namespace App\Http\Controllers;

use App\Exceptions\TicketLimitConfigurationUnavailableException;
use App\Exceptions\TicketLimitExceededException;
use App\Services\TicketCacheService;
use App\Services\TicketDashboardService;
use App\Services\TicketNotificationService;
use App\Services\TicketService;
use Illuminate\Http\Request;

class TicketController extends Controller
{
    protected TicketService $ticketService;
    protected TicketDashboardService $dashboardService;
    protected TicketNotificationService $notificationService;
    protected TicketCacheService $cacheService;

    public function __construct(
        TicketService $ticketService,
        TicketDashboardService $dashboardService,
        TicketNotificationService $notificationService,
        TicketCacheService $cacheService
    ) {
        $this->ticketService = $ticketService;
        $this->dashboardService = $dashboardService;
        $this->notificationService = $notificationService;
        $this->cacheService = $cacheService;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CORE TICKET LIFECYCLE
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Get cached form options for ticket creation.
     */
    public function formOptions()
    {
        return response()->json($this->ticketService->getFormOptions());
    }

    /**
     * Store an external ticket created by a customer.
     */
    public function store(Request $request)
    {
        // Enforce Maintenance Mode: Block ticket creation when system is Under Maintenance
        $systemStatus = \App\Services\TicketConfigurationService::getSystemStatus();
        if (trim(strtolower($systemStatus)) === 'under maintenance') {
            return response()->json([
                'message' => 'Ticket creation is temporarily disabled. The system is currently undergoing scheduled maintenance. Please try again later.'
            ], 503);
        }

        $user = $request->user();
        if (!$user instanceof \App\Models\Client) {
            return response()->json(['message' => 'Only authenticated customers can create external tickets.'], 403);
        }

        $draftId = $request->input('draft_id');
        $draftAttachments = [];
        if ($draftId) {
            try {
                $draft = app(\App\Services\TicketDraftService::class)->getDraft((int) $user->id, (int) $draftId);
                if ($draft && !empty($draft['attachments'])) {
                    foreach ($draft['attachments'] as $att) {
                        if (is_numeric($att)) {
                            $draftAttachments[] = (int) $att;
                        } elseif (is_array($att)) {
                            if (isset($att['id'])) {
                                $draftAttachments[] = (int) $att['id'];
                            } elseif (isset($att['attachment_id'])) {
                                $draftAttachments[] = (int) $att['attachment_id'];
                            }
                        }
                    }
                }
            } catch (\Throwable $e) {
                // Non-blocking draft inspection
            }
        }

        if (!empty($draftAttachments)) {
            $existingAtts = $request->input('attachments', []);
            if (!is_array($existingAtts)) $existingAtts = [];
            $mergedAtts = array_values(array_unique(array_merge($existingAtts, $draftAttachments)));
            $request->merge(['attachments' => $mergedAtts]);
        }

        if ($request->has('attachments')) {
            $rawAttachments = $request->input('attachments');
            if (is_string($rawAttachments)) {
                $decoded = json_decode($rawAttachments, true);
                $rawAttachments = is_array($decoded) ? $decoded : (strlen(trim($rawAttachments)) ? [$rawAttachments] : []);
            } elseif (is_numeric($rawAttachments)) {
                $rawAttachments = [(int) $rawAttachments];
            } elseif (!is_array($rawAttachments)) {
                $rawAttachments = [];
            }
            $request->merge(['attachments' => array_values(array_filter(array_map('intval', (array) $rawAttachments)))]);
        } else {
            $request->merge(['attachments' => []]);
        }

        $deptId = (int) $request->input('department_id', 2);
        $isServiceDept = ($deptId === 1);

        if ($request->has('machine_ID') && ($request->input('machine_ID') === '' || $request->input('machine_ID') === 'null' || $request->input('machine_ID') === null)) {
            $request->merge(['machine_ID' => null]);
        }

        $validated = $request->validate([
            'machine_ID' => $isServiceDept
                ? ['required', 'integer', 'exists:machines,machine_ID']
                : ['nullable', 'integer', 'exists:machines,machine_ID'],
            'problem_category_ID' => ['required', 'integer', 'exists:problem_categories,problem_category_ID'],
            'priority_ID' => ['nullable', 'integer', 'exists:ticket_priorities,priority_ID'],
            'branch_id' => ['nullable', 'string', 'max:64', 'exists:branches,slug'],
            'title' => ['required', 'string', 'max:255', $this->ticketService->rejectMarkup(), $this->ticketService->validateProperCasing()],
            'description' => ['required', 'string', $this->ticketService->rejectMarkup()],
            'attachments' => ['nullable', 'array', 'max:' . \App\Services\TicketConfigurationService::getMaxFileCount()],
            'attachments.*' => ['integer'],
            'origin' => ['nullable', 'string', 'max:50'],
            'conversation_id' => ['nullable', 'string', 'max:64'],
            'department_id' => ['nullable', 'integer'],
        ]);

        try {
            $result = app(\App\Actions\Tickets\CreateTicketAction::class)->execute($validated, $user, $deptId);
        } catch (TicketLimitExceededException $e) {
            return response()->json([
                'message' => $e->getMessage(),
                'code' => 'MAX_OPEN_TICKETS_REACHED',
                'limit' => $e->limit,
                'open_ticket_count' => $e->openTicketCount,
            ], 422);
        } catch (TicketLimitConfigurationUnavailableException $e) {
            return response()->json([
                'message' => $e->getMessage(),
                'code' => 'TICKET_LIMIT_CONFIGURATION_UNAVAILABLE',
            ], 503);
        }

        // TS020: Draft is only removed once final submission succeeds
        if ($draftId) {
            try {
                app(\App\Services\TicketDraftService::class)->deleteDraft((int) $user->id, (int) $draftId);
            } catch (\Throwable $e) {
                // Non-blocking draft cleanup
            }
        }

        // TS027: Link ticket to chatbot conversation if originating from AI escalation
        if (!empty($validated['conversation_id'])) {
            try {
                // Spec 0034: the AI service verifies the caller, so pass on the customer's own token.
                $linkClient = \Illuminate\Support\Facades\Http::timeout(3);
                if ($callerToken = ($request->bearerToken() ?: $request->cookie('access_token'))) {
                    $linkClient = $linkClient->withToken((string) $callerToken);
                }
                $linkClient->post('http://AI-service:8000/api/tickets', [
                    'conversation_id' => $validated['conversation_id'],
                    'ticket_id' => $result['ticket_id'] ?? null,
                ]);
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::warning("Could not link conversation {$validated['conversation_id']} to ticket: " . $e->getMessage());
            }
        }

        return response()->json($result, 201);
    }

    /**
     * Store an internal ticket created by an employee.
     */
    public function storeInternalTicket(Request $request)
    {
        $user = $request->user();
        if (!$user || $user instanceof \App\Models\Client) {
            return response()->json(['message' => 'Only employees can create internal tickets.'], 403);
        }

        $systemStatus = \App\Services\TicketConfigurationService::getSystemStatus();
        $isSuperAdmin = ($user instanceof \App\Models\Employee) && strtolower(str_replace([' ', '_', '-'], '', (string) ($user->role ?? ''))) === 'superadmin';
        if (!$isSuperAdmin && trim(strtolower($systemStatus)) === 'under maintenance') {
            return response()->json([
                'message' => 'Ticket creation is temporarily disabled. The system is currently undergoing scheduled maintenance. Please try again later.'
            ], 503);
        }

        if ($request->has('attachments')) {
            $rawAttachments = $request->input('attachments');
            if (is_string($rawAttachments)) {
                $decoded = json_decode($rawAttachments, true);
                $rawAttachments = is_array($decoded) ? $decoded : (strlen(trim($rawAttachments)) ? [$rawAttachments] : []);
            } elseif (is_numeric($rawAttachments)) {
                $rawAttachments = [(int) $rawAttachments];
            } elseif (!is_array($rawAttachments)) {
                $rawAttachments = [];
            }
            $request->merge(['attachments' => array_values(array_filter(array_map('intval', (array) $rawAttachments)))]);
        } else {
            $request->merge(['attachments' => []]);
        }

        // Equipment is required for Service (department 1) and optional for IT (department 2).
        $internalDeptId = $request->input('department_id') ? (int) $request->input('department_id') : null;
        if ($request->has('machine_ID') && in_array($request->input('machine_ID'), ['', 'null'], true)) {
            $request->merge(['machine_ID' => null]);
        }

        $validated = $request->validate([
            'machine_ID' => $internalDeptId === 2
                ? ['nullable', 'integer', 'exists:machines,machine_ID']
                : ['required', 'integer', 'exists:machines,machine_ID'],
            'problem_category_ID' => ['required', 'integer', 'exists:problem_categories,problem_category_ID'],
            'priority_ID' => ['nullable', 'integer', 'exists:ticket_priorities,priority_ID'],
            'branch_id' => ['nullable', 'string', 'max:64', 'exists:branches,slug'],
            'title' => ['required', 'string', 'max:255', $this->ticketService->rejectMarkup(), $this->ticketService->validateProperCasing()],
            'description' => ['required', 'string', $this->ticketService->rejectMarkup()],
            'attachments' => ['nullable', 'array', 'max:' . \App\Services\TicketConfigurationService::getMaxFileCount()],
            'attachments.*' => ['integer'],
        ]);

        $deptId = $internalDeptId;

        try {
            $result = $this->ticketService->createInternalTicket($validated, $user, $deptId);
        } catch (TicketLimitExceededException $e) {
            return response()->json([
                'message' => $e->getMessage(),
                'code' => 'MAX_OPEN_TICKETS_REACHED',
                'limit' => $e->limit,
                'open_ticket_count' => $e->openTicketCount,
            ], 422);
        } catch (TicketLimitConfigurationUnavailableException $e) {
            return response()->json([
                'message' => $e->getMessage(),
                'code' => 'TICKET_LIMIT_CONFIGURATION_UNAVAILABLE',
            ], 503);
        }

        return response()->json($result, 201);
    }

    /**
     * View detailed ticket info.
     */
    public function show(Request $request, int $ticketId)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $isCustomer = ($user instanceof \App\Models\Client);

        $data = $this->ticketService->showTicket($ticketId, $user, $isCustomer);
        if (!$data) {
            return response()->json(['message' => 'Ticket not found'], 404);
        }

        return response()->json($data);
    }

    /**
     * Update ticket details, status, or priority.
     */
    public function updateTicket(Request $request, int $ticketId)
    {
        $validated = $request->validate([
            'ticket_status_ID' => ['nullable', 'integer', 'exists:ticket_statuses,ticket_status_ID'],
            'priority_ID' => ['nullable', 'integer', 'exists:ticket_priorities,priority_ID'],
            'assigned_to' => ['nullable', 'integer', 'exists:employees,emp_id'],
            'assigned_by_email' => ['nullable', 'email'],
            'proof_rejected' => ['nullable', 'boolean'],
            'rejection_reason' => ['nullable', 'string', new \App\Rules\NoMarkup()],
            'escalation_reason' => ['nullable', 'string', 'max:1000', new \App\Rules\NoMarkup()],
            'reason' => ['nullable', 'string', 'max:1000', new \App\Rules\NoMarkup()],
            'title' => ['nullable', 'string', 'max:255', $this->ticketService->rejectMarkup(), $this->ticketService->validateProperCasing()],
            'description' => ['nullable', 'string', $this->ticketService->rejectMarkup()],
            'problem_category_ID' => ['nullable', 'integer', 'exists:problem_categories,problem_category_ID'],
            'machine_ID' => ['nullable', 'integer', 'exists:machines,machine_ID'],
        ]);

        $user = $request->user();
        $result = $this->ticketService->updateTicket($ticketId, $validated, $user);

        return response()->json($result['data'], $result['status']);
    }

    /**
     * Discard an open, unassigned ticket.
     */
    public function destroy(Request $request, int $ticketId)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $result = $this->ticketService->destroyTicket($ticketId, $user);
        return response()->json($result['data'], $result['status']);
    }

    /**
     * Put ticket on hold.
     */
    public function holdTicket(Request $request, int $ticketId)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }
        $reason = $request->input('reason');
        $result = $this->ticketService->holdTicket($ticketId, $user, $reason);
        return response()->json($result['data'], $result['status']);
    }

    /**
     * Resume ticket from on hold.
     */
    public function resumeTicket(Request $request, int $ticketId)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }
        $result = $this->ticketService->resumeTicket($ticketId, $user);
        return response()->json($result['data'], $result['status']);
    }

    /**
     * Resolve ticket.
     */
    public function resolveTicket(Request $request, int $ticketId)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }
        $result = $this->ticketService->resolveTicket($ticketId, $user);
        return response()->json($result['data'], $result['status']);
    }

    /**
     * Close ticket.
     */
    public function closeTicket(Request $request, int $ticketId)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }
        $result = $this->ticketService->closeTicket($ticketId, $user);
        return response()->json($result['data'], $result['status']);
    }

    /**
     * Reopen ticket (routes automatically to In Progress CS-owned).
     */
    public function reopenTicket(Request $request, int $ticketId)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }
        $reason = $request->input('reason');
        $result = $this->ticketService->reopenTicket($ticketId, $user, $reason);
        return response()->json($result['data'], $result['status']);
    }

    /**
     * Reclassify ticket category and/or priority with SLA recalculation.
     * Restricted to Customer Service and Administrators.
     */
    public function reclassifyTicket(Request $request, int $ticketId)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $validated = $request->validate([
            'problem_category_ID' => ['nullable', 'integer', 'exists:problem_categories,problem_category_ID'],
            'priority_ID' => ['nullable', 'integer', 'exists:ticket_priorities,priority_ID'],
        ]);

        if (empty($validated['problem_category_ID']) && empty($validated['priority_ID'])) {
            return response()->json(['message' => 'At least one of problem_category_ID or priority_ID must be provided.'], 422);
        }

        $result = $this->ticketService->reclassifyTicket($ticketId, $validated, $user);
        return response()->json($result['data'], $result['status']);
    }

    /**
     * Cancel / Discard ticket.
     */
    public function cancelTicket(Request $request, int $ticketId)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }
        $result = $this->ticketService->cancelTicket($ticketId, $user);
        return response()->json($result['data'], $result['status']);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BACKWARD COMPATIBILITY BRIDGES
    // ─────────────────────────────────────────────────────────────────────────

    public function customerDashboard(Request $request)
    {
        return app(TicketDashboardController::class)->customerDashboard($request);
    }

    public function csDashboard(Request $request)
    {
        return app(TicketDashboardController::class)->csDashboard($request);
    }

    public function csIncoming(Request $request)
    {
        return app(TicketDashboardController::class)->csIncoming($request);
    }

    public function getNotifications(Request $request)
    {
        return app(TicketNotificationController::class)->getNotifications($request);
    }

    public function markNotificationsRead(Request $request)
    {
        return app(TicketNotificationController::class)->markNotificationsRead($request);
    }

    public function markNotificationRead(Request $request, int $id)
    {
        return app(TicketNotificationController::class)->markNotificationRead($request, $id);
    }

    public function getSuperAdminConfig(Request $request)
    {
        return app(SuperAdminConfigController::class)->getSuperAdminConfig($request);
    }

    public function createSuperAdminEquipment(Request $request)
    {
        return app(SuperAdminConfigController::class)->createSuperAdminEquipment($request);
    }

    public function updateSuperAdminEquipment(Request $request, int $id)
    {
        return app(SuperAdminConfigController::class)->updateSuperAdminEquipment($request, $id);
    }

    public function deleteSuperAdminEquipment(Request $request, int $id)
    {
        return app(SuperAdminConfigController::class)->deleteSuperAdminEquipment($request, $id);
    }

    public function createSuperAdminPriority(Request $request)
    {
        return app(SuperAdminConfigController::class)->createSuperAdminPriority($request);
    }

    public function updateSuperAdminPriority(Request $request, int $id)
    {
        return app(SuperAdminConfigController::class)->updateSuperAdminPriority($request, $id);
    }

    public function deleteSuperAdminPriority(Request $request, int $id)
    {
        return app(SuperAdminConfigController::class)->deleteSuperAdminPriority($request, $id);
    }

    public function getSuperAdminAuditLogs(Request $request)
    {
        return app(SuperAdminConfigController::class)->getSuperAdminAuditLogs($request);
    }

    public function getSuperAdminHistory(Request $request)
    {
        return app(SuperAdminConfigController::class)->getSuperAdminHistory($request);
    }

    /**
     * View relevant customer and machine resolution context (TS029).
     */
    public function customerContext(Request $request, int $ticketId)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $result = $this->ticketService->getCustomerContext($ticketId, $user);
        return response()->json($result['data'], $result['status']);
    }

    /**
     * Get AI Chatbot escalation handoff pre-fill data (TS027).
     * Validates machine against customer CMS records and category. Falls back gracefully on failure.
     */
    public function escalateHandoff(Request $request, string $conversationId)
    {
        $user = $request->user();
        $clientId = $user ? ($user->id ?? $user->client_id ?? 1) : 1;

        $fallbackData = [
            'success' => true,
            'fallback' => true,
            'notice' => "We couldn't carry over your chat details — please fill in your ticket.",
            'data' => [
                'title' => '',
                'description' => '',
                'machine_ID' => null,
                'problem_category_ID' => null,
                'origin' => 'ai_chatbot',
                'conversation_id' => $conversationId,
            ],
        ];

        try {
            $token = $request->bearerToken();
            $client = \Illuminate\Support\Facades\Http::timeout(4);
            if ($token) {
                $client = $client->withHeaders(['Authorization' => "Bearer {$token}"]);
            }
            $aiBaseUrl = rtrim(config('services.ai.url', env('AI_SERVICE_URL', 'http://ai-service:8000')), '/');
            $res = $client->get("{$aiBaseUrl}/api/conversations/{$conversationId}/escalate-handoff");

            if (!$res->successful()) {
                return response()->json($fallbackData);
            }

            $handoff = $res->json('data') ?? [];
            if (empty($handoff)) {
                return response()->json($fallbackData);
            }

            $title = $handoff['title'] ?? '';
            $description = $handoff['description'] ?? '';

            // 1. Validate Category
            $categoryId = null;
            if (!empty($handoff['category'])) {
                $rawCat = strtolower(trim((string) $handoff['category']));
                $catQuery = \Illuminate\Support\Facades\DB::table('problem_categories')
                    ->whereRaw('LOWER(category_name) = ?', [$rawCat]);
                $catQuery->where('is_active', true);
                $categoryId = $catQuery->value('problem_category_ID');
            }

            // 2. Validate Machine is CMS-verified and tied to this customer account
            $machineId = null;
            if (!empty($handoff['machine'])) {
                $rawMach = strtolower(trim((string) $handoff['machine']));
                $matchedMachine = \Illuminate\Support\Facades\DB::table('machines')
                    ->where('client_ID', $clientId)
                    ->where(function ($q) use ($rawMach) {
                        if (is_numeric($rawMach)) {
                            $q->where('machine_ID', (int) $rawMach);
                        }
                        $q->orWhereRaw('LOWER(machine_name) = ?', [$rawMach])
                          ->orWhereRaw('LOWER(serial_number) = ?', [$rawMach])
                          ->orWhereRaw('LOWER(machine_name) LIKE ?', ["%{$rawMach}%"]);
                    })
                    ->first();

                if ($matchedMachine) {
                    $machineId = (int) $matchedMachine->machine_ID;
                }
            }

            return response()->json([
                'success' => true,
                'fallback' => false,
                'data' => [
                    'title' => $title,
                    'description' => $description,
                    'machine_ID' => $machineId,
                    'problem_category_ID' => $categoryId,
                    'origin' => 'ai_chatbot',
                    'conversation_id' => $conversationId,
                ],
            ]);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("Escalate handoff error for conversation {$conversationId}: " . $e->getMessage());
            return response()->json($fallbackData);
        }
    }

    /**
     * Get internal notes for a ticket (TS028).
     * Scoped strictly to authorized staff (Assigned Employee, CS, Admin, Super Admin).
     * Never visible to customers.
     */
    public function getInternalNotes(Request $request, int $ticketId)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        // Strict customer exclusion invariant
        if ($user instanceof \App\Models\Client) {
            return response()->json(['message' => 'Access denied: Customers cannot view internal notes under any circumstance.'], 403);
        }

        $empId = (int) ($user->emp_id ?? $user->id);
        $isCsOrAdmin = \App\Helpers\RoleHelper::isCsOrAdmin($user);

        $ticket = \Illuminate\Support\Facades\DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket) {
            return response()->json(['message' => 'Ticket not found.'], 404);
        }

        if (!$isCsOrAdmin) {
            $assignedTo = (int) ($ticket->assigned_to ?? 0);
            $isAssigned = ($assignedTo === $empId) ||
                \Illuminate\Support\Facades\DB::table('ticket_assignments')
                    ->where('ticket_ID', $ticketId)
                    ->where('employee_ID', $empId)
                    ->exists();

            if (!$isAssigned) {
                return response()->json(['message' => 'Access denied: You are not assigned to this ticket.'], 403);
            }
        }

        $isSqlite = \Illuminate\Support\Facades\DB::getDriverName() === 'sqlite';
        $fullNameRaw = $isSqlite ? "(e.first_name || ' ' || e.last_name) as author_name" : "CONCAT(e.first_name, ' ', e.last_name) as author_name";

        $notes = \Illuminate\Support\Facades\DB::table('internal_notes as in')
            ->leftJoin('employees as e', 'e.emp_id', '=', 'in.employee_id')
            ->where('in.ticket_id', $ticketId)
            ->select(
                'in.id',
                'in.ticket_id',
                'in.employee_id',
                'in.note',
                'in.created_at',
                'in.updated_at',
                \Illuminate\Support\Facades\DB::raw($fullNameRaw),
                'e.role as author_role'
            )
            ->orderBy('in.created_at', 'asc')
            ->get()
            ->map(fn ($row) => [
                'id' => (int) $row->id,
                'note_id' => (int) $row->id,
                'ticket_id' => (int) $row->ticket_id,
                'text' => $row->note,
                'note' => $row->note,
                'author' => !empty(trim((string) $row->author_name)) ? trim($row->author_name) : 'Staff Member',
                'author_name' => !empty(trim((string) $row->author_name)) ? trim($row->author_name) : 'Staff Member',
                'author_role' => $row->author_role ?: 'Employee',
                'created_at' => $row->created_at ? \Carbon\Carbon::parse($row->created_at)->toIso8601String() : null,
                'updated_at' => $row->updated_at ? \Carbon\Carbon::parse($row->updated_at)->toIso8601String() : null,
                'timestamp' => $row->created_at ? \Carbon\Carbon::parse($row->created_at)->toIso8601String() : null,
            ]);

        return response()->json([
            'success' => true,
            'ticket_id' => $ticketId,
            'notes' => $notes,
            'total' => count($notes),
        ]);
    }

    /**
     * Add an internal note to a ticket (TS028).
     * Scoped to authorized staff (Assigned Employee, CS, Admin, Super Admin).
     * Enforces required non-empty note and audit log.
     */
    public function addInternalNote(Request $request, int $ticketId)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        // Strict customer exclusion invariant
        if ($user instanceof \App\Models\Client) {
            return response()->json(['message' => 'Access denied: Customers cannot add internal notes.'], 403);
        }

        $empId = (int) ($user->emp_id ?? $user->id);
        $isCsOrAdmin = \App\Helpers\RoleHelper::isCsOrAdmin($user);

        $ticket = \Illuminate\Support\Facades\DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket) {
            return response()->json(['message' => 'Ticket not found.'], 404);
        }

        if (!$isCsOrAdmin) {
            $assignedTo = (int) ($ticket->assigned_to ?? 0);
            $isAssigned = ($assignedTo === $empId) ||
                \Illuminate\Support\Facades\DB::table('ticket_assignments')
                    ->where('ticket_ID', $ticketId)
                    ->where('employee_ID', $empId)
                    ->exists();

            if (!$isAssigned) {
                return response()->json(['message' => 'Access denied: You are not assigned to this ticket.'], 403);
            }
        }

        $noteText = trim((string) ($request->input('note') ?? $request->input('internal_note') ?? $request->input('text') ?? ''));
        if (\App\Rules\NoMarkup::contains($noteText)) {
            return response()->json([
                'message' => 'The note must not contain HTML or script markup.',
                'errors' => ['note' => ['The note must not contain HTML or script markup.']]
            ], 422);
        }
        if (empty($noteText)) {
            return response()->json([
                'message' => 'The note field is required and cannot be empty.',
                'errors' => ['note' => ['The note field is required.']]
            ], 422);
        }

        // internal_notes table is created by database migration

        $noteId = \Illuminate\Support\Facades\DB::table('internal_notes')->insertGetId([
            'ticket_id' => $ticketId,
            'employee_id' => $empId,
            'note' => $noteText,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $authorName = trim(($user->first_name ?? '') . ' ' . ($user->last_name ?? ''));
        if (empty($authorName)) {
            $authorName = $user->name ?? 'Staff Member';
        }
        $authorRole = $user->role ?? 'Employee';

        // Record independent audit log with internal flag set
        try {
            app(\App\Services\AuditTimelineService::class)->recordEvent(
                $ticketId,
                'internal_note',
                'internal_note',
                $empId,
                'employee',
                $authorRole,
                null,
                ['note_id' => $noteId, 'note' => $noteText],
                $noteText,
                false,
                true
            );
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("Failed to record internal note audit log: " . $e->getMessage());
        }

        return response()->json([
            'success' => true,
            'message' => 'Internal note added successfully.',
            'note' => [
                'id' => (int) $noteId,
                'note_id' => (int) $noteId,
                'ticket_id' => $ticketId,
                'text' => $noteText,
                'note' => $noteText,
                'author' => $authorName,
                'author_role' => $authorRole,
                'created_at' => now()->toIso8601String(),
                'updated_at' => now()->toIso8601String(),
                'timestamp' => now()->toIso8601String(),
            ],
        ], 201);
    }
}