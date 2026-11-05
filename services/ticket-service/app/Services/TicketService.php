<?php

namespace App\Services;

use App\Helpers\RoleHelper;
use Carbon\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class TicketService
{
    protected TicketNotificationService $notificationService;
    protected TicketCacheService $cacheService;
    protected SLAService $slaService;
    protected TicketLimitService $ticketLimitService;
    protected TicketNumberGeneratorService $numberGeneratorService;
    protected TicketStateMachine $stateMachine;

    public function __construct(
        TicketNotificationService $notificationService,
        TicketCacheService $cacheService,
        SLAService $slaService,
        TicketLimitService $ticketLimitService,
        TicketNumberGeneratorService $numberGeneratorService,
        TicketStateMachine $stateMachine
    ) {
        $this->notificationService = $notificationService;
        $this->cacheService = $cacheService;
        $this->slaService = $slaService;
        $this->ticketLimitService = $ticketLimitService;
        $this->numberGeneratorService = $numberGeneratorService;
        $this->stateMachine = $stateMachine;
    }

    /**
     * Proper casing validation rule closure.
     */
    public function validateProperCasing(): \Closure
    {
        return function ($attribute, $value, $fail) {
            $trimmed = trim((string) $value);
            if (empty($trimmed)) return;
            if (!preg_match('/^[A-Z0-9]/', $trimmed)) {
                $fail('The title must start with an uppercase letter or number.');
            }
            $lettersOnly = preg_replace('/[^a-zA-Z]/', '', $trimmed);
            if (mb_strlen($lettersOnly) > 4 && $lettersOnly === mb_strtoupper($lettersOnly)) {
                $fail('The title must be in proper casing and not all uppercase.');
            }
            if ($trimmed === mb_strtolower($trimmed)) {
                $fail('The title must be in proper casing and not all lowercase.');
            }
        };
    }

    /**
     * Compute human-readable SLA label based on creation time.
     */
    public function slaLabel($createdAt, $ticket = null): string
    {
        if ($ticket) {
            return $this->slaService->computeTicketSlaMetrics($ticket)['status'];
        }

        if (!$createdAt) {
            return 'On Track';
        }

        $createdAtObj = is_string($createdAt) ? Carbon::parse($createdAt) : $createdAt;
        $hours = now()->diffInHours($createdAtObj);
        if ($hours >= 48) {
            return 'Breached';
        }
        if ($hours >= 24) {
            return 'At Risk';
        }
        return 'On Track';
    }

    /**
     * Formatted ticket summary used across broadcasts and notifications.
     */
    public function getFullTicketDetails(int $ticketId): ?array
    {
        $row = DB::table('tickets as t')
            ->join('problem_categories as pc', 'pc.problem_category_ID', '=', 't.problem_category_ID')
            ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->leftJoin('clients as c', 'c.id', '=', 't.created_by')
            ->leftJoin('machines as m', 'm.machine_ID', '=', 't.machine_ID')
            ->leftJoin('ticket_priorities as tp', 'tp.priority_ID', '=', 't.priority_ID')
            ->leftJoin('employees as e', 'e.emp_id', '=', 't.assigned_to')
            ->leftJoin('ticket_types as tt', 'tt.ticket_type_ID', '=', 't.ticket_type_ID')
            ->select(
                't.ticket_ID',
                't.ticket_number',
                't.title',
                't.is_internal',
                't.requested_by',
                'pc.category_name',
                'ts.status_name',
                'tp.priority_name',
                'e.department',
                't.created_at',
                'c.client_name',
                'm.machine_name',
                'm.serial_number',
                'tt.type_name as ticket_type',
                't.sla_rule_id',
                't.response_due_at',
                't.resolution_due_at',
                't.first_response_at',
                't.resolved_at',
                't.response_sla_status',
                't.resolution_sla_status',
                't.hold_reason',
                't.escalation_reason'
            )
            ->where('t.ticket_ID', $ticketId)
            ->first();

        if (!$row) {
            return null;
        }

        $assignments = DB::table('ticket_assignments')
            ->where('ticket_ID', $ticketId)
            ->get();

        $assignedIds = $assignments->pluck('employee_ID')->map(fn($id) => (int)$id)->all();

        $pendingReassign = DB::table('reassignment_requests')
            ->where('ticket_id', $ticketId)
            ->where('status', 'pending')
            ->orderByDesc('request_id')
            ->first();

        $createdAtObj = is_string($row->created_at) ? Carbon::parse($row->created_at) : $row->created_at;
        $slaStatusEval = $this->slaService->evaluateSlaStatusForTicket($row);

        $displayNumber = $row->ticket_number ?: (TicketNumberGeneratorService::refFor($row->ticket_ID, $row->ticket_number ?? null));

        return [
            'id' => $displayNumber,
            'ticket_number' => $displayNumber,
            'ticket_ID' => (int) $row->ticket_ID,
            'customer' => $row->client_name ?: 'Unknown Customer',
            'title' => $row->title,
            'category' => $row->category_name,
            'status' => $row->status_name,
            'priority' => $row->priority_name,
            'department' => $row->department,
            'equipment' => $row->machine_name . ' - ' . $row->serial_number,
            'sla' => $this->slaLabel($createdAtObj),
            'date' => $createdAtObj ? $createdAtObj->format('m/d/Y') : now()->format('m/d/Y'),
            'assigned' => $assignedIds,
            'reassignmentRequested' => !empty($pendingReassign),
            'reassignmentReason' => $pendingReassign ? $pendingReassign->reason : null,
            'hold_reason' => $row->hold_reason ?? null,
            'escalation_reason' => $row->escalation_reason ?? null,
            'type' => $row->ticket_type ?? 'External',
            'ticket_type' => $row->ticket_type ?? 'External',
            'is_internal' => (bool)$row->is_internal,
            'requested_by' => $row->requested_by,
            'sla_rule_id' => $row->sla_rule_id,
            'response_due_at' => $row->response_due_at,
            'resolution_due_at' => $row->resolution_due_at,
            'first_response_at' => $row->first_response_at,
            'resolved_at' => $row->resolved_at,
            'response_sla_status' => $slaStatusEval['response_sla_status'] ?? $row->response_sla_status,
            'resolution_sla_status' => $slaStatusEval['resolution_sla_status'] ?? $row->resolution_sla_status,
        ];
    }

    /**
     * Get cached form options for ticket creation modals.
     */
    public function getFormOptions(): array
    {
        return \Illuminate\Support\Facades\Cache::remember('ticket_form_options_cache', 3600, function () {
            $machines = DB::table('machines')
                ->select('machine_ID', 'machine_name', 'serial_number')
                ->orderBy('machine_name')
                ->get();

            $problemCategories = DB::table('problem_categories')
                ->select('problem_category_ID', 'category_name')
                ->where('is_active', true)
                ->orderBy('category_name')
                ->get();

            $ticketTypes = DB::table('ticket_types')
                ->select('ticket_type_ID', 'type_name')
                ->orderBy('type_name')
                ->get();

            $priorities = DB::table('ticket_priorities')
                ->select('priority_ID', 'priority_name')
                ->orderBy('priority_ID')
                ->get();

            return [
                'machines' => $machines,
                'machine_categories' => DB::table('machine_categories')->orderBy('category_name')->get(),
                'problem_categories' => $problemCategories,
                'ticket_types' => $ticketTypes,
                'ticket_priorities' => $priorities,
                'ticket_statuses' => DB::table('ticket_statuses')->orderBy('ticket_status_ID')->get(),
                'slas' => DB::table('slas')->where('is_active', true)->orderBy('sla_ID')->get(),

                'equipment_options' => $machines->map(fn ($row) => [
                    'value' => $row->machine_ID,
                    'label' => $row->machine_name . ' - ' . $row->serial_number,
                ])->values()->all(),
                'category_options' => $problemCategories->map(fn ($row) => [
                    'value' => $row->problem_category_ID,
                    'label' => $row->category_name,
                ])->values()->all(),
                'priority_options' => $priorities->map(fn ($row) => [
                    'value' => $row->priority_ID,
                    'label' => $row->priority_name,
                ])->values()->all(),
                'ticket_type_options' => $ticketTypes->map(fn ($row) => [
                    'value' => $row->ticket_type_ID,
                    'label' => $row->type_name,
                ])->values()->all(),
            ];
        });
    }

    /**
     * Create external ticket submitted by a customer.
     */
    public function createTicket(array $validated, $user, ?int $departmentId = 2): array
    {
        if (!$user instanceof \App\Models\Client) {
            throw new \LogicException('Only authenticated customers can create external tickets.');
        }

        $clientId = (int) $user->id;
        $rawTitle = strip_tags($validated['title']);
        $cleanedTitle = preg_replace('/^(?:\d+[\.\)\-:]|\b[qQ]\d+[:\.]|\b(?:machine|problem|issue|item)[:\-])\s*/i', '', $rawTitle);
        $finalTitle = !empty(trim($cleanedTitle)) ? trim($cleanedTitle) : $rawTitle;

        $externalTypeId = DB::table('ticket_types')->where('type_name', 'External')->value('ticket_type_ID') ?? 2;

        $deptCodeParam = null;
        if ($departmentId) {
            $deptName = DB::table('departments')->where('id', $departmentId)->value('name') ?? '';
            if (stripos($deptName, 'IT') !== false) {
                $deptCodeParam = 'IT';
            } elseif (stripos($deptName, 'Service') !== false) {
                $deptCodeParam = 'SVC';
            } elseif (!empty($deptName)) {
                $deptCodeParam = strtoupper(substr(preg_replace('/[^A-Za-z0-9]/', '', $deptName), 0, 4));
            }
        }
        $ticketNumber = $this->numberGeneratorService->generateNextTicketNumber($deptCodeParam);

        $defaults = TicketConfigurationService::getDefaultsConfig();

        // Status & Priority: apply configured defaults ONLY when no value is supplied or determined
        $priorityId = $validated['priority_ID'] ?? null;
        if (empty($priorityId)) {
            $defaultPriorityName = $defaults['priority'] ?? 'Low';
            $priorityId = DB::table('ticket_priorities')
                ->whereRaw('LOWER(priority_name) = ?', [strtolower(trim($defaultPriorityName))])
                ->value('priority_ID') ?: 1;
        }

        $statusId = $validated['ticket_status_ID'] ?? null;
        if (empty($statusId)) {
            $defaultStatusName = $defaults['status'] ?? 'Open';
            $statusId = DB::table('ticket_statuses')
                ->whereRaw('LOWER(status_name) = ?', [strtolower(trim($defaultStatusName))])
                ->value('ticket_status_ID') ?: 1;
        }

        $ticketData = [
            'ticket_number' => $ticketNumber,
            'machine_ID' => !empty($validated['machine_ID']) ? (int) $validated['machine_ID'] : null,
            'problem_category_ID' => $validated['problem_category_ID'],
            'created_by' => $clientId,
            'requested_by' => null,
            'assigned_to' => null,
            'ticket_type_ID' => $externalTypeId,
            'is_internal' => false,
            'priority_ID' => $priorityId,
            'branch_id' => $validated['branch_id'] ?? null,
            'ticket_status_ID' => $statusId,
            'sla_ID' => null,
            'title' => $finalTitle,
            'description' => strip_tags($validated['description']),
            'resolved_at' => null,
            'closed_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ];

        $ticketData['origin'] = $validated['origin'] ?? 'manual';

        $ticketId = $this->ticketLimitService->createWithinLimit(
            $clientId,
            false,
            fn () => DB::table('tickets')->insertGetId($ticketData)
        );

        try {
            $priorityName = DB::table('ticket_priorities')->where('priority_ID', $priorityId)->value('priority_name') ?? 'Low';
            $this->slaService->assignSlaToTicket(
                $ticketId,
                (int)$departmentId,
                (int)$validated['problem_category_ID'],
                $priorityName,
                now(),
                $defaults['slaPolicy'] ?? 'dynamic',
                $validated['branch_id'] ?? null
            );
        } catch (\Exception $e) {
            Log::warning("Failed to assign SLA in store: " . $e->getMessage());
        }

        $attachmentIds = $validated['attachments'] ?? [];
        if (!empty($attachmentIds)) {
            try {
                Http::post('http://attachment-service:8000/api/bind', [
                    'ticket_id' => $ticketId,
                    'attachment_ids' => $attachmentIds,
                    'is_proof' => false
                ]);
            } catch (\Exception $e) {
                Log::error("Failed to bind attachments in store: " . $e->getMessage());
            }
        }

        $storedAttachments = [];
        try {
            $resp = Http::get("http://attachment-service:8000/api/attachments?ticket_id={$ticketId}");
            if ($resp->successful()) {
                $storedAttachments = $resp->json('attachments') ?? [];
            }
        } catch (\Exception $e) {
            Log::error("Failed to fetch attachments in store: " . $e->getMessage());
        }

        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        $this->cacheService->clearTicketCaches();

        $dashboardTicket = DB::table('tickets as t')
            ->join('machines as m', 'm.machine_ID', '=', 't.machine_ID')
            ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->select('t.ticket_ID', 't.title', 'm.machine_name', 'm.serial_number', 'ts.status_name')
            ->where('t.ticket_ID', $ticketId)
            ->first();

        $customerId = $clientId;
        $clientName = DB::table('clients')->where('id', $customerId)->value('client_name') ?? 'Customer';
        $ticketRef = TicketNumberGeneratorService::refFor($ticketId);

        // Send-time notification routing: dispatch new_ticket alert according to active recipient routing configuration
        $this->notificationService->dispatchAlert(
            'new_ticket',
            'New Ticket Created',
            "New Ticket {$ticketRef}: \"" . $validated['title'] . "\" has been created by {$clientName}.",
            $ticketId,
            ['ticket_id' => $ticketId, 'title' => $validated['title']]
        );

        $this->notificationService->notifyCustomer(
            $customerId,
            'Ticket Created',
            "Your ticket {$ticketRef}: \"" . $validated['title'] . "\" has been created successfully. Our team will review it shortly.",
            $ticketId
        );

        $categoryName = DB::table('problem_categories')->where('problem_category_ID', $validated['problem_category_ID'])->value('category_name') ?? '';
        $priorityName = DB::table('ticket_priorities')->where('priority_ID', $validated['priority_ID'] ?? 1)->value('priority_name') ?? '';
        $this->notificationService->sendCustomerEmail(
            $customerId,
            'Ticket Created',
            "Your ticket {$ticketNumber}: \"" . $validated['title'] . "\" has been created successfully.",
            $ticketId,
            $validated['title'],
            $categoryName,
            $priorityName
        );

        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => $ticketId,
            'action_type' => 'create',
            'event_type' => 'ticket_created',
            'action_by_ID' => $clientId,
            'actor_type' => 'customer',
            'actor_role' => 'customer',
            'before_state' => null,
            'after_state' => json_encode([
                'status_id' => $statusId,
                'priority_id' => $priorityId,
                'category_id' => $validated['problem_category_ID'],
            ]),
            'details' => json_encode([
                'machine_ID' => $validated['machine_ID'] ?? null,
                'problem_category_ID' => $validated['problem_category_ID'],
                'title' => strip_tags($validated['title']),
            ]),
            'is_system' => 0,
            'is_internal' => 0,
            'created_at' => now(),
        ]);

        $statusName = DB::table('ticket_statuses')->where('ticket_status_ID', $statusId)->value('status_name') ?? 'Open';
        $this->notificationService->broadcastTicketChange('created', $ticketId, [
            'status' => $statusName,
            'title' => $validated['title'],
            'customer_id' => $customerId,
        ]);

        try {
            Http::withHeaders([
                'X-Internal-Token' => env('INTERNAL_TOKEN'),
            ])->post("http://messaging-service:8000/api/internal/tickets/{$ticketId}/messages", [
                'message' => "Hi! I am the Customer Support Assistant. A representative will be with you shortly. For your reference, this chat is for your ticket: {$ticketNumber}.",
                'sender_name' => 'Customer Support Assistant',
                'sender_type' => 'cs',
                'sender_id' => null,
            ]);
        } catch (\Exception $e) {
            Log::error("Failed to send initial internal message: " . $e->getMessage());
        }

        return [
            'message' => 'Ticket created successfully.',
            'ticket' => $ticket,
            'dashboard_ticket' => $dashboardTicket ? [
                'id' => $ticketNumber,
                'ticket_number' => $ticketNumber,
                'title' => $dashboardTicket->title,
                'equipment' => $dashboardTicket->machine_name . ' - ' . $dashboardTicket->serial_number,
                'status' => $dashboardTicket->status_name,
            ] : null,
            'attachments' => $storedAttachments,
        ];
    }

    /**
     * Create internal ticket submitted by an employee.
     */
    public function createInternalTicket(array $validated, $user, ?int $requestedDepartmentId = null): array
    {
        $internalTypeId = DB::table('ticket_types')->where('type_name', 'Internal')->value('ticket_type_ID');
        $empId = (int) $user->emp_id;

        $deptCodeParam = !empty($user->department) ? $user->department : null;
        $ticketNumber = $this->numberGeneratorService->generateNextTicketNumber($deptCodeParam);

        $defaults = TicketConfigurationService::getDefaultsConfig();

        // Status & Priority: apply configured defaults ONLY when no value is supplied or determined
        $priorityId = $validated['priority_ID'] ?? null;
        if (empty($priorityId)) {
            $defaultPriorityName = $defaults['priority'] ?? 'Low';
            $priorityId = DB::table('ticket_priorities')
                ->whereRaw('LOWER(priority_name) = ?', [strtolower(trim($defaultPriorityName))])
                ->value('priority_ID') ?: 1;
        }

        $statusId = $validated['ticket_status_ID'] ?? null;
        if (empty($statusId)) {
            $defaultStatusName = $defaults['status'] ?? 'Open';
            $statusId = DB::table('ticket_statuses')
                ->whereRaw('LOWER(status_name) = ?', [strtolower(trim($defaultStatusName))])
                ->value('ticket_status_ID') ?: 1;
        }

        $ticketId = $this->ticketLimitService->createWithinLimit(
            $empId,
            true,
            fn () => DB::table('tickets')->insertGetId([
                'ticket_number' => $ticketNumber,
                'machine_ID' => $validated['machine_ID'] ?? null,
                'problem_category_ID' => $validated['problem_category_ID'],
                'created_by' => 1,
                'requested_by' => $empId,
                'assigned_to' => null,
                'ticket_type_ID' => $internalTypeId,
                'is_internal' => true,
                'priority_ID' => $priorityId,
                'branch_id' => $validated['branch_id'] ?? null,
                'ticket_status_ID' => $statusId,
                'sla_ID' => null,
                'title' => strip_tags($validated['title']),
                'description' => strip_tags($validated['description']),
                'resolved_at' => null,
                'closed_at' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ])
        );

        try {
            $deptId = $requestedDepartmentId;
            if (!$deptId && !empty($user->department)) {
                $deptId = DB::table('departments')->whereRaw('LOWER(name) = ?', [strtolower($user->department)])->value('id');
            }
            if (!$deptId) {
                $deptId = 2;
            }
            $priorityName = DB::table('ticket_priorities')->where('priority_ID', $priorityId)->value('priority_name') ?? 'Low';
            $this->slaService->assignSlaToTicket(
                $ticketId,
                (int)$deptId,
                (int)$validated['problem_category_ID'],
                $priorityName,
                now(),
                $defaults['slaPolicy'] ?? 'dynamic',
                $validated['branch_id'] ?? null
            );
        } catch (\Exception $e) {
            Log::warning("Failed to assign SLA in storeInternalTicket: " . $e->getMessage());
        }

        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => $ticketId,
            'action_type' => 'create',
            'event_type' => 'ticket_created',
            'action_by_ID' => $empId,
            'actor_type' => 'employee',
            'actor_role' => $user->role ?? 'employee',
            'before_state' => null,
            'after_state' => json_encode([
                'status_id' => $statusId,
                'priority_id' => $priorityId,
                'category_id' => $validated['problem_category_ID'],
            ]),
            'details' => json_encode([
                'machine_ID' => $validated['machine_ID'] ?? null,
                'problem_category_ID' => $validated['problem_category_ID'],
                'title' => strip_tags($validated['title']),
            ]),
            'is_system' => 0,
            'is_internal' => 1,
            'created_at' => now(),
        ]);

        $attachmentIds = $validated['attachments'] ?? [];
        if (!empty($attachmentIds)) {
            try {
                Http::post('http://attachment-service:8000/api/bind', [
                    'ticket_id' => $ticketId,
                    'attachment_ids' => $attachmentIds,
                    'is_proof' => false
                ]);
            } catch (\Exception $e) {
                Log::error("Failed to bind attachments in storeInternalTicket: " . $e->getMessage());
            }
        }

        $storedAttachments = [];
        try {
            $resp = Http::get("http://attachment-service:8000/api/attachments?ticket_id={$ticketId}");
            if ($resp->successful()) {
                $storedAttachments = $resp->json('attachments') ?? [];
            }
        } catch (\Exception $e) {
            Log::error("Failed to fetch attachments in storeInternalTicket: " . $e->getMessage());
        }

        $ticketRef = $ticketNumber;
        // Send-time notification routing: dispatch new_ticket alert according to active recipient routing configuration
        $this->notificationService->dispatchAlert(
            'new_ticket',
            'New Internal Ticket Created',
            "New internal ticket {$ticketRef}: \"" . $validated['title'] . "\" has been created and awaits delegation.",
            $ticketId,
            [
                'ticket_id' => $ticketId,
                'ticket_ref' => $ticketRef,
                'title' => $validated['title'],
            ]
        );

        $this->notificationService->notifyRecipient(
            $empId,
            'employee',
            'Internal Ticket Created',
            "Your internal ticket {$ticketRef}: \"" . $validated['title'] . "\" has been submitted successfully.",
            $ticketId,
            [
                'ticket_id' => $ticketId,
                'ticket_ref' => $ticketRef,
                'title' => $validated['title'],
            ]
        );

        $statusName = DB::table('ticket_statuses')->where('ticket_status_ID', $statusId)->value('status_name') ?? 'Open';
        $this->notificationService->broadcastTicketChange('created', $ticketId, [
            'status' => $statusName,
            'title' => $validated['title'],
        ]);

        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        $this->cacheService->clearTicketCaches();

        try {
            Http::withHeaders([
                'X-Internal-Token' => env('INTERNAL_TOKEN'),
            ])->post("http://messaging-service:8000/api/internal/tickets/{$ticketId}/messages", [
                'message' => "Hi! I am the Customer Support Assistant. A representative will be with you shortly. For your reference, this chat is for your ticket: {$ticketNumber}.",
                'sender_name' => 'Customer Support Assistant',
                'sender_type' => 'cs',
                'sender_id' => null,
            ]);
        } catch (\Exception $e) {
            Log::error("Failed to send initial internal message: " . $e->getMessage());
        }

        return [
            'message' => 'Internal ticket created successfully.',
            'ticket' => $ticket,
            'id' => $ticketNumber,
            'ticket_number' => $ticketNumber,
            'attachments' => $storedAttachments,
        ];
    }

    /**
     * Get detailed ticket data including timeline, attachments, worklogs, and SLA.
     */
    public function showTicket(int $ticketId, $user, bool $isCustomer): ?array
    {
        $ticket = DB::table('tickets as t')
            ->join('problem_categories as pc', 'pc.problem_category_ID', '=', 't.problem_category_ID')
            ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->leftJoin('ticket_priorities as tp', 'tp.priority_ID', '=', 't.priority_ID')
            ->leftJoin('machines as m', 'm.machine_ID', '=', 't.machine_ID')
            ->leftJoin('machine_categories as mc', 'mc.category_ID', '=', 'm.category_ID')
            ->leftJoin('clients as c', 'c.id', '=', 't.created_by')
            ->leftJoin('employees as req', 'req.emp_id', '=', 't.requested_by')
            ->leftJoin('ticket_types as tt', 'tt.ticket_type_ID', '=', 't.ticket_type_ID')
            ->select(
                't.ticket_ID',
                't.ticket_number',
                't.title',
                't.description',
                't.problem_category_ID',
                't.machine_ID',
                'pc.category_name',
                'ts.status_name',
                'tp.priority_name',
                't.created_at',
                't.updated_at',
                'm.machine_name',
                'm.serial_number',
                'm.model as machine_model',
                'm.brand as machine_brand',
                'mc.category_name as equipment_type',
                'c.client_name',
                DB::raw("TRIM(CONCAT(COALESCE(req.first_name, ''), ' ', COALESCE(req.last_name, ''))) as requester_employee_name"),
                't.created_by',
                't.assigned_to',
                't.proof_rejected',
                't.rejection_reason',
                't.resolved_at',
                't.closed_at',
                't.is_internal',
                't.requested_by',
                'tt.type_name as ticket_type',
                't.ticket_status_ID',
                't.in_progress_owner',
                't.previous_in_progress_owner',
                't.resolution_due_at',
                't.response_due_at',
                't.first_response_at',
                't.response_sla_status',
                't.resolution_sla_status',
                't.last_reminder_sent_at',
                't.hold_reason',
                't.escalation_reason'
            )
            ->where('t.ticket_ID', $ticketId)
            ->first();

        if (!$ticket) {
            return null;
        }

        if ($user instanceof \App\Models\Client) {
            if ((int)$ticket->is_internal !== 0 || (int)$ticket->created_by !== (int)$user->id) {
                return null;
            }
        }

        $assignment = null;
        if (!($user instanceof \App\Models\Client)) {
            $assignment = DB::table('ticket_assignments')
                ->where('ticket_ID', $ticketId)
                ->where('employee_ID', $user->emp_id)
                ->first();
        }
        $accepted = $assignment && $assignment->assignment_status === 'accepted';

        $pendingReassign = DB::table('reassignment_requests as rr')
            ->leftJoin('employees as e', 'e.emp_id', '=', 'rr.employee_id')
            ->where('rr.ticket_id', $ticketId)
            ->where('rr.status', 'pending')
            ->orderByDesc('rr.request_id')
            ->select(
                'rr.*',
                DB::raw("CONCAT(e.first_name, ' ', e.last_name) as requesting_employee_name"),
                'e.department as requesting_employee_department'
            )
            ->first();

        $latestReassign = DB::table('reassignment_requests as rr')
            ->where('rr.ticket_id', $ticketId)
            ->orderByDesc('rr.request_id')
            ->select('rr.*')
            ->first();

        $deniedReassign = (empty($pendingReassign) && $latestReassign && $latestReassign->status === 'denied')
            ? $latestReassign
            : null;

        $latestDenyAuditReason = null;
        if ($deniedReassign) {
            $latestDenyAudit = DB::table('ticket_audit_logs')
                ->where('ticket_ID', $ticketId)
                ->whereIn('action_type', ['reassign_deny', 'reassign_reject'])
                ->orderByDesc('log_ID')
                ->first();
            if ($latestDenyAudit) {
                $denyDetails = json_decode($latestDenyAudit->details ?? '{}', true);
                $latestDenyAuditReason = $denyDetails['reason'] ?? null;
            }
        }
        $actualDenyReason = $deniedReassign ? ($deniedReassign->deny_reason ?: $latestDenyAuditReason) : null;

        $auditLogs = DB::table('ticket_audit_logs as tal')
            ->leftJoin('employees as e', function ($join) {
                $join->on('e.emp_id', '=', 'tal.action_by_ID')
                    ->whereIn('tal.actor_type', ['employee', 'superadmin', 'admin', 'cs', 'customerservice']);
            })
            ->leftJoin('clients as c', function ($join) {
                $join->on('c.id', '=', 'tal.action_by_ID')
                    ->where('tal.actor_type', '=', 'customer');
            })
            ->select(
                'tal.*',
                DB::raw("CONCAT(e.first_name, ' ', e.last_name) as employee_name"),
                'c.client_name as customer_name'
            )
            ->where('tal.ticket_ID', $ticketId)
            ->orderBy('tal.created_at', 'asc')
            ->get();

        $prioritiesMap = DB::table('ticket_priorities')->pluck('priority_name', 'priority_ID')->toArray();
        $statusesMap = DB::table('ticket_statuses')->pluck('status_name', 'ticket_status_ID')->toArray();
        $categoriesMap = DB::table('problem_categories')->pluck('category_name', 'problem_category_ID')->toArray();
        $machinesMap = DB::table('machines')->pluck('machine_name', 'machine_ID')->toArray();

        $employeeIds = [];
        foreach ($auditLogs as $log) {
            if ($log->action_type === 'update') {
                $details = json_decode($log->details, true);
                if (($details['field'] ?? '') === 'assigned_to' && !empty($details['new'])) {
                    $employeeIds[] = (int)$details['new'];
                }
            }
        }

        $employeeNamesMap = [];
        if (!empty($employeeIds)) {
            $employeeNamesMap = DB::table('employees')
                ->whereIn('emp_id', array_unique($employeeIds))
                ->select('emp_id', DB::raw("CONCAT(first_name, ' ', last_name) as name"))
                ->pluck('name', 'emp_id')
                ->toArray();
        }

        $timeline = [];
        foreach ($auditLogs as $log) {
            $formattedTime = $log->created_at ? Carbon::parse($log->created_at)->toIso8601String() : '';
            $details = json_decode($log->details, true) ?? [];

            $actorName = '';
            if ($log->actor_type === 'customer') {
                $actorName = trim($log->customer_name ?? '') ?: 'Customer';
            } elseif ($log->actor_type === 'system' || (int)$log->action_by_ID === 0) {
                $actorName = 'System';
            } else {
                $emp = trim($log->employee_name ?? '');
                $actorName = $emp ?: 'CS Representative';
            }

            $timelineText = '';
            if ($log->action_type === 'create') {
                $timelineText = "Ticket created by {$actorName}.";
            } elseif ($log->action_type === 'reopen') {
                $reason = $details['reason'] ?? '';
                $timelineText = "Ticket reopened by {$actorName}." . ($reason !== '' ? " Reason: \"{$reason}\"." : '');
            } elseif ($log->action_type === 'accept') {
                $timelineText = "Assignment accepted by {$actorName}.";
            } elseif ($log->action_type === 'assign') {
                $assignedTo = $details['assigned_to'] ?? '';
                $empName = $employeeNamesMap[$assignedTo] ?? ($details['employee_name'] ?? ($assignedTo ? "Employee #{$assignedTo}" : 'an engineer'));
                $timelineText = "Ticket assigned to {$empName} by {$actorName}.";
            } elseif ($log->action_type === 'reassign') {
                $assignedTo = $details['assigned_to'] ?? '';
                $empName = $employeeNamesMap[$assignedTo] ?? ($details['employee_name'] ?? ($assignedTo ? "Employee #{$assignedTo}" : 'an engineer'));
                $timelineText = "Ticket reassigned to {$empName} by {$actorName}.";
            } elseif ($log->action_type === 'reassign_request') {
                $reason = $details['reason'] ?? '';
                $timelineText = "Reassignment request submitted by {$actorName}. Reason: \"{$reason}\"";
            } elseif ($log->action_type === 'reassign_approve') {
                $timelineText = "Reassignment request approved by {$actorName}. Ticket status reset to Open.";
            } elseif ($log->action_type === 'reassign_deny' || $log->action_type === 'reassign_reject') {
                $reason = $details['reason'] ?? '';
                $timelineText = "Reassignment request denied by {$actorName}." . ($reason !== '' ? " Reason: \"{$reason}\"." : '') . " Ticket status returned to In Progress.";
            } elseif ($log->action_type === 'hold') {
                $reason = $details['reason'] ?? '';
                $timelineText = "Ticket placed on hold by {$actorName}." . ($reason !== '' ? " Reason: \"{$reason}\"." : '');
            } elseif ($log->action_type === 'resume') {
                $timelineText = "Ticket resumed from hold by {$actorName}.";
            } elseif ($log->action_type === 'resolve') {
                $notes = $details['resolution_notes'] ?? ($details['remarks'] ?? '');
                $timelineText = "Ticket resolved by {$actorName}." . ($notes !== '' ? " Notes: \"{$notes}\"." : '');
            } elseif ($log->action_type === 'close') {
                $timelineText = "Ticket closed by {$actorName}.";
            } elseif ($log->action_type === 'cancel') {
                $reason = $details['reason'] ?? '';
                $timelineText = "Ticket cancelled by {$actorName}." . ($reason !== '' ? " Reason: \"{$reason}\"." : '');
            } elseif ($log->action_type === 'in_progress') {
                $timelineText = "Ticket marked in progress by {$actorName}.";
            } elseif ($log->action_type === 'status_change') {
                $newStatus = $details['status'] ?? '';
                $remarks = $details['remarks'] ?? '';
                $filesText = !empty($details['files']) ? ' (Attached: ' . implode(', ', $details['files']) . ')' : '';
                $timelineText = "Status updated to \"{$newStatus}\" by {$actorName}." . ($remarks !== '' ? " Remarks: \"{$remarks}\"" : '') . $filesText;
            } elseif ($log->action_type === 'proof_uploaded') {
                $timelineText = "Proof of completion uploaded by {$actorName}.";
            } elseif ($log->action_type === 'internal_note_added') {
                $timelineText = "Internal note added by {$actorName}.";
            } elseif ($log->action_type === 'reclassification') {
                $newCat = $categoriesMap[$details['new_category_id'] ?? 0] ?? ($details['new_category'] ?? 'updated category');
                $timelineText = "Ticket reclassified to \"{$newCat}\" by {$actorName}.";
            } elseif ($log->action_type === 'update') {
                $field = $details['field'] ?? '';
                $newVal = $details['new'] ?? '';
                if ($field === 'priority_ID') {
                    $priorityName = $prioritiesMap[$newVal] ?? $newVal;
                    $timelineText = "Priority updated to \"{$priorityName}\" by {$actorName}.";
                } elseif ($field === 'assigned_to') {
                    $empName = $employeeNamesMap[$newVal] ?? $newVal;
                    $timelineText = "Ticket assigned to {$empName} by {$actorName}.";
                } elseif ($field === 'ticket_status_ID') {
                    $statusName = $statusesMap[$newVal] ?? $newVal;
                    $timelineText = "Status updated to \"{$statusName}\" by {$actorName}.";
                } elseif ($field === 'title') {
                    $timelineText = "Ticket title edited by {$actorName} to \"{$newVal}\".";
                } elseif ($field === 'description') {
                    $timelineText = "Ticket description edited by {$actorName}.";
                } elseif ($field === 'problem_category_ID') {
                    $catName = $categoriesMap[$newVal] ?? $newVal;
                    $timelineText = "Category updated to \"{$catName}\" by {$actorName}.";
                } elseif ($field === 'machine_ID') {
                    $machName = $machinesMap[$newVal] ?? $newVal;
                    $timelineText = "Machine updated to \"{$machName}\" by {$actorName}.";
                } elseif ($field === 'proof_rejected') {
                    $timelineText = "Proof of completion rejected by {$actorName}.";
                } elseif ($field === 'rejection_reason') {
                    $timelineText = "Rejection reason updated by {$actorName} to: \"{$newVal}\".";
                } else {
                    $timelineText = "Ticket updated by {$actorName}: {$field} changed.";
                }
            } elseif ($log->action_type === 'reminder_sent') {
                $recipient = $details['recipient_name'] ?? ($details['recipient_id'] ? "Employee #{$details['recipient_id']}" : 'assigned technician');
                $msg = trim($details['message'] ?? '');
                $timelineText = "Reminder sent to {$recipient} by {$actorName}." . ($msg !== '' ? " Message: \"{$msg}\"" : '');
            }

            if ($timelineText) {
                $timeline[] = [
                    'id' => 'timeline-' . $log->log_ID,
                    'type' => $log->action_type === 'reminder_sent' ? 'reminder' : 'system',
                    'text' => $timelineText,
                    'timestamp' => $formattedTime,
                ];
            }
        }

        $statusHistory = [];
        $hasCreateLog = false;
        foreach ($auditLogs as $log) {
            $actor = $log->employee_name ?: 'Employee';
            if ($log->actor_type === 'customer') {
                $actor = $log->customer_name ?: 'Customer';
            } elseif ($log->actor_type === 'system' || (int)$log->action_by_ID === 0) {
                $actor = 'System';
            }

            $details = json_decode($log->details, true) ?? [];
            $logTime = $log->created_at ? Carbon::parse($log->created_at)->toIso8601String() : '';

            if ($log->action_type === 'create') {
                $hasCreateLog = true;
                $statusHistory[] = [
                    'status' => 'Open',
                    'timestamp' => $logTime,
                    'actor' => $actor,
                ];
            } elseif ($log->action_type === 'status_change') {
                $statusHistory[] = [
                    'status' => $details['status'] ?? '',
                    'timestamp' => $logTime,
                    'actor' => $actor,
                ];
            } elseif ($log->action_type === 'assign' || $log->action_type === 'reassign') {
                $statusHistory[] = [
                    'status' => 'Pending Assignment',
                    'timestamp' => $logTime,
                    'actor' => $actor,
                ];
            } elseif ($log->action_type === 'accept' || $log->action_type === 'in_progress') {
                $statusHistory[] = [
                    'status' => 'In Progress',
                    'timestamp' => $logTime,
                    'actor' => $actor,
                ];
            } elseif ($log->action_type === 'hold') {
                $statusHistory[] = [
                    'status' => 'On Hold',
                    'timestamp' => $logTime,
                    'actor' => $actor,
                ];
            } elseif ($log->action_type === 'resume') {
                $statusHistory[] = [
                    'status' => 'In Progress',
                    'timestamp' => $logTime,
                    'actor' => $actor,
                ];
            } elseif ($log->action_type === 'resolve') {
                $statusHistory[] = [
                    'status' => 'Resolved',
                    'timestamp' => $logTime,
                    'actor' => $actor,
                ];
            } elseif ($log->action_type === 'close') {
                $statusHistory[] = [
                    'status' => 'Closed',
                    'timestamp' => $logTime,
                    'actor' => $actor,
                ];
            } elseif ($log->action_type === 'reopen') {
                $statusHistory[] = [
                    'status' => 'In Progress',
                    'timestamp' => $logTime,
                    'actor' => $actor,
                ];
            } elseif ($log->action_type === 'cancel') {
                $statusHistory[] = [
                    'status' => 'Cancelled',
                    'timestamp' => $logTime,
                    'actor' => $actor,
                ];
            } elseif ($log->action_type === 'update') {
                if (($details['field'] ?? '') === 'ticket_status_ID') {
                    $statusName = $statusesMap[$details['new'] ?? 0] ?? 'Unknown';
                    $statusHistory[] = [
                        'status' => $statusName,
                        'timestamp' => $logTime,
                        'actor' => $actor,
                    ];
                }
            }
        }

        if (!$hasCreateLog) {
            array_unshift($statusHistory, [
                'status' => 'Open',
                'timestamp' => $ticket->created_at ? Carbon::parse($ticket->created_at)->toIso8601String() : '',
                'actor' => 'System',
            ]);
        }

        // Deduplicate consecutive identical statuses in status history
        $dedupedStatusHistory = [];
        $lastStatus = null;
        foreach ($statusHistory as $sh) {
            if ($sh['status'] && $sh['status'] !== $lastStatus) {
                $dedupedStatusHistory[] = $sh;
                $lastStatus = $sh['status'];
            }
        }
        $statusHistory = $dedupedStatusHistory;

        $dbNotes = [];
        if (!$isCustomer) {
            $dbNotes = DB::table('internal_notes as in')
                ->join('employees as e', 'e.emp_id', '=', 'in.employee_id')
                ->select('in.*', DB::raw("CONCAT(e.first_name, ' ', e.last_name) as employee_name"))
                ->where('in.ticket_id', $ticketId)
                ->orderBy('in.created_at', 'asc')
                ->get()
                ->map(fn($row) => [
                    'id' => 'note-' . $row->id,
                    'text' => $row->note,
                    'author' => $row->employee_name ?: 'Staff Member',
                    'timestamp' => $row->created_at ? Carbon::parse($row->created_at)->toIso8601String() : '',
                ])
                ->all();
        }

        $dbRemarks = DB::table('ticket_remarks as tr')
            ->join('employees as e', 'e.emp_id', '=', 'tr.employee_id')
            ->select('tr.*', DB::raw("CONCAT(e.first_name, ' ', e.last_name) as employee_name"))
            ->where('tr.ticket_id', $ticketId)
            ->orderBy('tr.created_at', 'asc')
            ->get()
            ->map(fn($row) => [
                'id' => 'remark-' . $row->id,
                'remark' => $row->remark,
                'author' => $row->employee_name ?: 'Staff Member',
                'timestamp' => $row->created_at ? Carbon::parse($row->created_at)->toIso8601String() : '',
            ])
            ->all();

        $auditRemarks = [];
        foreach ($auditLogs as $log) {
            if ($log->action_type === 'status_change') {
                $details = json_decode($log->details, true) ?? [];
                if (!empty($details['remarks'])) {
                    $author = 'Staff Member';
                    if ($log->actor_type === 'customer') {
                        $author = $log->customer_name ?: 'Customer';
                    } elseif ($log->actor_type === 'system' || (int)$log->action_by_ID === 0) {
                        $author = 'System';
                    } elseif ($log->employee_name) {
                        $author = $log->employee_name;
                    }
                    $auditRemarks[] = [
                        'id' => 'audit-remark-' . $log->log_ID,
                        'remark' => $details['remarks'],
                        'status' => $details['status'] ?? null,
                        'author' => $author,
                        'timestamp' => $log->created_at ? Carbon::parse($log->created_at)->toIso8601String() : '',
                    ];
                }
            } elseif ($log->action_type === 'reassign_request') {
                $details = json_decode($log->details, true) ?? [];
                if (!empty($details['reason'])) {
                    $auditRemarks[] = [
                        'id' => 'reassign-remark-' . $log->log_ID,
                        'remark' => 'Reassignment request reason: ' . $details['reason'],
                        'status' => 'Pending Reassignment',
                        'author' => $log->employee_name ?: 'Assigned Employee',
                        'timestamp' => $log->created_at ? Carbon::parse($log->created_at)->toIso8601String() : '',
                    ];
                }
            }
        }

        $rawMergedRemarks = array_merge($dbRemarks, $auditRemarks);
        usort($rawMergedRemarks, function($a, $b) {
            return strcmp($a['timestamp'], $b['timestamp']);
        });

        $allRemarks = [];
        $seenRemarkKeys = [];
        foreach ($rawMergedRemarks as $rem) {
            $norm = strtolower(trim((string)($rem['remark'] ?? '')));
            if ($norm === '') continue;
            $authorKey = strtolower(trim((string)($rem['author'] ?? '')));
            $dedupKey = $norm . '|' . $authorKey;
            if (!isset($seenRemarkKeys[$dedupKey])) {
                $seenRemarkKeys[$dedupKey] = true;
                $allRemarks[] = $rem;
            }
        }

        foreach ($allRemarks as $rem) {
            // Check if remark text is already covered in a timeline status event
            $normRem = strtolower(trim((string)$rem['remark']));
            $alreadyInTimeline = false;
            foreach ($timeline as $tEvt) {
                if (str_contains(strtolower($tEvt['text'] ?? ''), $normRem)) {
                    $alreadyInTimeline = true;
                    break;
                }
            }
            if (!$alreadyInTimeline) {
                $timeline[] = [
                    'id' => 'timeline-remark-' . $rem['id'],
                    'type' => 'remark',
                    'text' => "Remark added by " . $rem['author'] . ": \"" . $rem['remark'] . "\"",
                    'timestamp' => $rem['timestamp'],
                ];
            }
        }

        if (!$isCustomer) {
            foreach ($dbNotes as $note) {
                $timeline[] = [
                    'id' => 'timeline-note-' . $note['id'],
                    'type' => 'internal_note',
                    'text' => "Added staff internal note: \"" . $note['text'] . "\"",
                    'timestamp' => $note['timestamp'],
                ];
            }
        }

        usort($timeline, function($a, $b) {
            return strcmp($a['timestamp'], $b['timestamp']);
        });

        $attachmentCacheKey = "ticket_attachments_data_{$ticketId}";
        $cachedAttachmentData = Cache::get($attachmentCacheKey);
        if ($cachedAttachmentData !== null && is_array($cachedAttachmentData)) {
            $attachments = $cachedAttachmentData['attachments'] ?? [];
            $proofAttachments = $cachedAttachmentData['proofAttachments'] ?? [];
        } else {
            $attachments = [];
            try {
                $resp = Http::timeout(5.0)->get("http://attachment-service:8000/api/attachments?ticket_id={$ticketId}");
                if ($resp->successful()) {
                    $attachments = $resp->json('attachments') ?? [];
                }
            } catch (\Exception $e) {
                Log::warning("Failed to fetch attachments for ticket {$ticketId}: " . $e->getMessage());
            }

            if (empty($attachments)) {
                try {
                    $dbAttachments = DB::table('ticket_attachments')
                        ->where('ticket_id', $ticketId)
                        ->get()
                        ->map(function ($row) {
                            return [
                                'id' => $row->attachment_id ?? $row->id,
                                'name' => $row->file_name ?? $row->name,
                                'url' => str_starts_with($row->file_path ?? '', 'http') ? $row->file_path : '/storage/' . ($row->file_path ?? ''),
                                'file_type' => $row->file_type ?? null,
                                'uploaded_at' => $row->uploaded_at ?? $row->created_at ?? null,
                            ];
                        })
                        ->all();
                    if (!empty($dbAttachments)) {
                        $attachments = $dbAttachments;
                    }
                } catch (\Throwable $e) {}
            }

            $proofAttachments = [];
            try {
                $assignments = DB::table('ticket_assignments')
                    ->where('ticket_ID', $ticketId)
                    ->pluck('assignment_ID')
                    ->all();

                foreach ($assignments as $assignmentId) {
                    try {
                        $resp = Http::timeout(1.5)->get("http://attachment-service:8000/api/attachments?assignment_id={$assignmentId}");
                        if ($resp->successful()) {
                            $assignmentAttachments = $resp->json('attachments') ?? [];
                            $proofAttachments = array_merge($proofAttachments, $assignmentAttachments);
                        }
                    } catch (\Exception $e) {}
                }

                if (empty($proofAttachments) && !empty($assignments)) {
                    $dbProofs = DB::table('proof_of_completion')
                        ->whereIn('assignment_ID', $assignments)
                        ->get()
                        ->map(function ($row) {
                            return [
                                'id' => $row->proof_ID,
                                'name' => $row->file_name,
                                'url' => str_starts_with($row->file_path, 'http') ? $row->file_path : '/storage/' . $row->file_path,
                                'file_type' => $row->file_type,
                                'size' => $row->file_size,
                                'uploaded_at' => $row->uploaded_at
                            ];
                        })
                        ->all();
                    $proofAttachments = $dbProofs;
                }
            } catch (\Exception $e) {
                Log::warning("Failed to fetch proof attachments for ticket {$ticketId}: " . $e->getMessage());
            }

            try {
                Cache::put($attachmentCacheKey, [
                    'attachments' => $attachments,
                    'proofAttachments' => $proofAttachments,
                ], 60);
            } catch (\Exception $e) {}
        }

        $createdAtIso = $ticket->created_at ? Carbon::parse($ticket->created_at)->toIso8601String() : null;
        $updatedAtIso = $ticket->updated_at ? Carbon::parse($ticket->updated_at)->toIso8601String() : $createdAtIso;
        $resolvedAtIso = $ticket->resolved_at ? Carbon::parse($ticket->resolved_at)->toIso8601String() : null;
        $closedAtIso = $ticket->closed_at ? Carbon::parse($ticket->closed_at)->toIso8601String() : null;

        $assignedEmployees = DB::table('ticket_assignments as ta')
            ->join('employees as e', 'e.emp_id', '=', 'ta.employee_ID')
            ->where('ta.ticket_ID', $ticketId)
            ->select(
                'e.emp_id as id',
                DB::raw("CONCAT(e.first_name, ' ', e.last_name) as name"),
                'e.email',
                'e.department',
                'e.role',
                'ta.assignment_status',
                'ta.assigned_at',
                'ta.accepted_at'
            )
            ->get();

        $assigned = $assignedEmployees->pluck('id')->map(fn($id) => (int)$id)->all();
        $primaryAssignedName = $assignedEmployees->first()?->name;

        if (!$primaryAssignedName && $ticket->assigned_to) {
            $primaryAssignedName = DB::table('employees')
                ->where('emp_id', $ticket->assigned_to)
                ->select(DB::raw("CONCAT(first_name, ' ', last_name) as name"))
                ->value('name');
        }

        $department = $assignedEmployees->first()?->department;
        if (!$department && !empty($assigned)) {
            $department = DB::table('employees')
                ->whereIn('emp_id', $assigned)
                ->value('department');
        }

        $equipmentType = $ticket->equipment_type ?: ($ticket->category_name ? ($ticket->category_name . ' Equipment') : 'Medical Equipment');

        return [
            'id' => TicketNumberGeneratorService::refFor($ticket->ticket_ID, $ticket->ticket_number ?? null),
            'ticket_ID' => $ticket->ticket_ID,
            'title' => $ticket->title,
            'description' => $ticket->description,
            'category' => $ticket->category_name,
            'problem_category_ID' => $ticket->problem_category_ID,
            'machine_ID' => $ticket->machine_ID,
            'machine_name' => $ticket->machine_name,
            'serial_number' => $ticket->serial_number,
            'machine_model' => $ticket->machine_model ?? null,
            'machine_brand' => $ticket->machine_brand ?? null,
            'equipment_type' => $equipmentType,
            'equipmentType' => $equipmentType,
            'equipment_category' => $equipmentType,
            'status' => $ticket->status_name,
            'ticket_status_ID' => (int) $ticket->ticket_status_ID,
            'in_progress_owner' => $ticket->in_progress_owner,
            'state' => $this->stateMachine->resolveState($ticket),
            'allowed_transitions' => $this->stateMachine->getAllowedTransitions($this->stateMachine->resolveState($ticket)),
            'priority' => $ticket->priority_name,
            'date' => $createdAtIso,
            'lastUpdate' => $updatedAtIso,
            'created_at' => $createdAtIso,
            'updated_at' => $updatedAtIso,
            'date_created' => $createdAtIso,
            'last_updated' => $updatedAtIso,
            'slaStatus' => $this->slaLabel($ticket->created_at, $ticket),
            'sla' => $this->slaLabel($ticket->created_at, $ticket),
            'sla_status' => $this->slaLabel($ticket->created_at, $ticket),
            'resolution_due_at' => (!empty($ticket->resolution_due_at)) ? Carbon::parse($ticket->resolution_due_at)->toIso8601String() : null,
            'sla_metrics' => $this->slaService->computeTicketSlaMetrics($ticket),
            'equipment' => $ticket->machine_name ? ($ticket->machine_name . ($ticket->serial_number ? ' - ' . $ticket->serial_number : '')) : ($ticket->serial_number ?: 'Not specified'),
            'customer' => (bool) $ticket->is_internal
                ? (($ticket->requester_employee_name !== '' && $ticket->requester_employee_name !== null)
                    ? $ticket->requester_employee_name
                    : ($ticket->requested_by ? 'Employee #' . $ticket->requested_by : 'Internal Requester'))
                : ($ticket->client_name ?: 'Unknown Customer'),
            'accepted' => $accepted,
            'assigned_employee' => $primaryAssignedName,
            'assigned_employee_name' => $primaryAssignedName,
            'assigned_to_name' => $primaryAssignedName,
            'assigned_employees' => $assignedEmployees->toArray(),
            'reassignmentRequested' => !empty($pendingReassign),
            'reassignmentReason' => $pendingReassign ? $pendingReassign->reason : null,
            'reassignmentRequestedBy' => $pendingReassign ? ($pendingReassign->requesting_employee_name ?: 'Assigned Employee') : null,
            'reassignmentDepartment' => $pendingReassign ? ($pendingReassign->requesting_employee_department ?: $department) : $department,
            'reassignmentRequestedAt' => $pendingReassign ? ($pendingReassign->requested_at ? Carbon::parse($pendingReassign->requested_at)->toIso8601String() : ($pendingReassign->created_at ? Carbon::parse($pendingReassign->created_at)->toIso8601String() : null)) : null,
            'reassignmentEmployeeId' => $pendingReassign ? (int)$pendingReassign->employee_id : null,
            'deniedReassignment' => !empty($deniedReassign),
            'reassignmentDenied' => !empty($deniedReassign),
            'disapprovalReason' => $actualDenyReason,
            'reassignmentDenyReason' => $actualDenyReason,
            'proofRejected' => (bool)$ticket->proof_rejected,
            'rejectionReason' => $ticket->rejection_reason,
            'resolved_at' => $resolvedAtIso,
            'closed_at' => $closedAtIso,
            'internalNotes' => $dbNotes,
            'remarks' => $allRemarks,
            'remarks_history' => $allRemarks,
            'timeline' => $timeline,
            'attachments' => $attachments,
            'proofAttachments' => $proofAttachments,
            'proofFiles' => $proofAttachments,
            'assigned' => $assigned,
            'department' => $department,
            'status_history' => $statusHistory,
            'ticket_type' => $ticket->ticket_type ?? 'External',
            'is_internal' => (bool)$ticket->is_internal,
            'requested_by' => $ticket->requested_by,
            'last_reminder_sent_at' => $ticket->last_reminder_sent_at ? Carbon::parse($ticket->last_reminder_sent_at)->toIso8601String() : null,
            'worklogs' => DB::table('work_logs')->where('ticket_id', $ticketId)->orderBy('log_date', 'desc')->orderBy('created_at', 'desc')->get(),
        ];
    }

    /**
     * Update ticket properties, status, or details.
     */
    public function updateTicket(int $ticketId, array $validated, $user): array
    {
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket) {
            return ['status' => 404, 'data' => ['message' => 'Ticket not found']];
        }

        // 1. Client cross-ticket and internal ticket isolation
        if ($user instanceof \App\Models\Client) {
            if ((int)$ticket->is_internal !== 0 || (int)$ticket->created_by !== (int)$user->id) {
                return ['status' => 403, 'data' => ['message' => 'You do not have permission to update this ticket.', 'code' => 'NOT_OWNER']];
            }
        }

        if ($ticket->is_internal && $user instanceof \App\Models\Client) {
            return ['status' => 404, 'data' => ['message' => 'Ticket not found']];
        }

        // 2. Reject status 11 (On Hold) via generic update endpoint
        if (array_key_exists('ticket_status_ID', $validated) && (int) $validated['ticket_status_ID'] === 11) {
            return [
                'status' => 422,
                'data' => [
                    'message' => 'Status 11 (On Hold) cannot be set via the generic update endpoint. Use POST /tickets/{id}/hold with a mandatory reason.',
                    'code' => 'USE_DEDICATED_HOLD_ENDPOINT',
                ],
            ];
        }

        // 3. Reject resuming a ticket that is On Hold via generic update endpoint
        if ((int) $ticket->ticket_status_ID === 11 && array_key_exists('ticket_status_ID', $validated) && (int) $validated['ticket_status_ID'] !== 11) {
            return [
                'status' => 422,
                'data' => [
                    'message' => 'Tickets on hold must be resumed via POST /tickets/{id}/resume.',
                    'code' => 'USE_DEDICATED_HOLD_ENDPOINT',
                ],
            ];
        }

        // 4. Treat status 8 (or status 2 when ticket is in status 3 or 4) as Reopen
        $statusToSet = array_key_exists('ticket_status_ID', $validated) && $validated['ticket_status_ID'] !== null
            ? (int) $validated['ticket_status_ID']
            : null;

        // Reject re-escalation if already escalated
        if ($statusToSet === 5 && (int)$ticket->ticket_status_ID === 5) {
            return [
                'status' => 422,
                'data' => [
                    'message' => 'This ticket is already escalated and cannot be escalated again.',
                    'code' => 'ALREADY_ESCALATED',
                ],
            ];
        }

        $isReopenAttempt = ($statusToSet === 8) || ($statusToSet === 2 && in_array((int)$ticket->ticket_status_ID, [3, 4], true));
        if ($isReopenAttempt) {
            $reason = $validated['reason'] ?? $validated['rejection_reason'] ?? null;
            return $this->reopenTicket($ticketId, $user, $reason);
        }

        // 5. Ownership / permission checks on customer setting status 3 or 4
        if ($user instanceof \App\Models\Client && ($statusToSet === 3 || $statusToSet === 4)) {
            if ((int)$ticket->created_by !== (int)$user->id || (int)$ticket->is_internal !== 0) {
                return ['status' => 403, 'data' => ['message' => 'You do not have permission to update this ticket.', 'code' => 'NOT_OWNER']];
            }
        }

        // 6. Check closed/cancelled classification edit restriction
        $isClosedOrCancelled = in_array((int)$ticket->ticket_status_ID, [4, 5, 9], true);
        $attemptsCategoryChange = array_key_exists('problem_category_ID', $validated) && $validated['problem_category_ID'] !== null && (int)$validated['problem_category_ID'] !== (int)$ticket->problem_category_ID;
        $attemptsPriorityChange = array_key_exists('priority_ID', $validated) && $validated['priority_ID'] !== null && (int)$validated['priority_ID'] !== (int)($ticket->priority_ID ?? 1);

        if ($isClosedOrCancelled && ($attemptsCategoryChange || $attemptsPriorityChange)) {
            return [
                'status' => 422,
                'data' => [
                    'message' => 'Cannot edit classification of a closed or cancelled ticket.',
                    'code' => 'TICKET_CLOSED',
                ],
            ];
        }

        // 7. Content & Classification editing permission rules
        if ($user instanceof \App\Models\Client) {
            $isEditingContent = array_key_exists('title', $validated) ||
                array_key_exists('description', $validated) ||
                array_key_exists('problem_category_ID', $validated) ||
                array_key_exists('machine_ID', $validated);

            if ($isEditingContent) {
                $statusName = DB::table('ticket_statuses')->where('ticket_status_ID', $ticket->ticket_status_ID)->value('status_name');
                $isOpen = ($ticket->ticket_status_ID == 1 || strtolower((string) $statusName) === 'open');
                $isAssigned = !empty($ticket->assigned_to);

                if (!$isOpen || $isAssigned) {
                    return ['status' => 403, 'data' => ['message' => 'Tickets can only be edited while Open and not yet assigned to an employee.']];
                }
            }

            if (array_key_exists('priority_ID', $validated) && $validated['priority_ID'] !== null) {
                return ['status' => 403, 'data' => ['message' => 'Customers cannot edit ticket priority.', 'code' => 'FORBIDDEN']];
            }
        } else {
            // Staff / Employee edits:
            // Category edits: Customer service, admin, superadmin may edit on any non-closed ticket.
            if ($attemptsCategoryChange && !RoleHelper::isCsOrAdmin($user)) {
                return [
                    'status' => 403,
                    'data' => [
                        'message' => 'Only Customer Service or Administrators can edit ticket category.',
                        'code' => 'FORBIDDEN',
                    ],
                ];
            }
        }

        // 8. State machine validation if ticket_status_ID is present
        if ($statusToSet !== null) {
            $currentState = $this->stateMachine->resolveState($ticket);
            $targetState = $this->stateMachine->resolveTargetState($statusToSet, $ticket, [
                'user' => $user,
                'proof_rejected' => $validated['proof_rejected'] ?? false,
            ]);

            try {
                $this->stateMachine->validateTransition($ticket, $currentState, $targetState, [
                    'user' => $user,
                    'proof_rejected' => $validated['proof_rejected'] ?? false,
                ]);
            } catch (\App\Exceptions\InvalidTicketTransitionException $e) {
                return [
                    'status' => 422,
                    'data' => [
                        'message' => $e->getMessage(),
                        'code' => 'INVALID_TICKET_TRANSITION',
                        'from_status' => $e->fromStatus,
                        'to_status' => $e->toStatus,
                        'allowed_statuses' => $e->allowedStatuses,
                    ]
                ];
            }

            if ($statusToSet === 3 && $ticket->is_internal) {
                $isCS = RoleHelper::isCsOrAdmin($user);
                if (!$isCS) {
                    return ['status' => 403, 'data' => ['message' => 'Only the assigned employee or customer service can resolve an internal ticket.']];
                }
            }

            if ($statusToSet === 4 && $ticket->is_internal) {
                $isCS = RoleHelper::isCsOrAdmin($user);
                $isRequestor = ($user && !($user instanceof \App\Models\Client) && $user->emp_id == $ticket->requested_by);
                if (!$isCS && !$isRequestor) {
                    return ['status' => 403, 'data' => ['message' => 'Only the requestor or a customer service agent can close an internal ticket.']];
                }
            }

            if ($statusToSet === 3) {
                $department = DB::table('employees')
                    ->where('emp_id', $ticket->assigned_to)
                    ->value('department');
                if (empty($department)) {
                    return ['status' => 422, 'data' => ['message' => 'Cannot resolve ticket: Department is not set.']];
                }
                $hasAssignment = DB::table('ticket_assignments')
                    ->where('ticket_ID', $ticketId)
                    ->exists();
                if (!$hasAssignment) {
                    return ['status' => 422, 'data' => ['message' => 'Cannot resolve ticket: No employees are assigned.']];
                }
            }
        }

        $assignedBy = 2;
        $actorType = 'employee';
        if ($user && ($user instanceof \App\Models\Client || ($user->role ?? '') === 'customer')) {
            $actorType = 'customer';
            $assignedBy = $user->id ?? $user->client_id ?? 1;
        } else {
            if ($user && isset($user->emp_id)) {
                $assignedBy = $user->emp_id;
            } else {
                $assignedBy = DB::table('employees')
                    ->where('email', $validated['assigned_by_email'] ?? '')
                    ->value('emp_id') ?? 2;
            }
        }

        $changes = [];

        if ($statusToSet !== null) {
            if ($ticket->ticket_status_ID != $statusToSet) {
                $changes[] = ['field' => 'ticket_status_ID', 'old' => $ticket->ticket_status_ID, 'new' => $statusToSet];
            }
        }

        if (array_key_exists('priority_ID', $validated) && $validated['priority_ID'] !== null) {
            if ($ticket->priority_ID != $validated['priority_ID']) {
                $changes[] = ['field' => 'priority_ID', 'old' => $ticket->priority_ID, 'new' => $validated['priority_ID']];
            }
        }

        if (array_key_exists('proof_rejected', $validated)) {
            if ((bool)$ticket->proof_rejected != (bool)$validated['proof_rejected']) {
                $changes[] = ['field' => 'proof_rejected', 'old' => $ticket->proof_rejected, 'new' => $validated['proof_rejected']];
            }
        }

        if (array_key_exists('rejection_reason', $validated)) {
            if ($ticket->rejection_reason != $validated['rejection_reason']) {
                $changes[] = ['field' => 'rejection_reason', 'old' => $ticket->rejection_reason, 'new' => $validated['rejection_reason']];
            }
        }

        if (array_key_exists('title', $validated) && $validated['title'] !== null) {
            $newTitle = strip_tags(trim($validated['title']));
            if ($ticket->title !== $newTitle) {
                $changes[] = ['field' => 'title', 'old' => $ticket->title, 'new' => $newTitle];
            }
        }

        if (array_key_exists('description', $validated) && $validated['description'] !== null) {
            $newDesc = trim($validated['description']);
            if ($ticket->description !== $newDesc) {
                $changes[] = ['field' => 'description', 'old' => $ticket->description, 'new' => $newDesc];
            }
        }

        if (array_key_exists('problem_category_ID', $validated) && $validated['problem_category_ID'] !== null) {
            if ($ticket->problem_category_ID != $validated['problem_category_ID']) {
                $changes[] = ['field' => 'problem_category_ID', 'old' => $ticket->problem_category_ID, 'new' => $validated['problem_category_ID']];
            }
        }

        if (array_key_exists('machine_ID', $validated) && $validated['machine_ID'] !== null) {
            if ($ticket->machine_ID != $validated['machine_ID']) {
                $changes[] = ['field' => 'machine_ID', 'old' => $ticket->machine_ID, 'new' => $validated['machine_ID']];
            }
        }

        if (array_key_exists('assigned_to', $validated) && $validated['assigned_to'] !== null) {
            if ($ticket->assigned_to != $validated['assigned_to']) {
                $changes[] = ['field' => 'assigned_to', 'old' => $ticket->assigned_to, 'new' => $validated['assigned_to']];
            }
        }

        if (array_key_exists('escalation_reason', $validated) && $validated['escalation_reason'] !== null) {
            $changes[] = ['field' => 'escalation_reason', 'old' => $ticket->escalation_reason ?? null, 'new' => $validated['escalation_reason']];
        }

        if (empty($changes)) {
            return ['status' => 200, 'data' => ['message' => 'No changes to update.']];
        }

        DB::transaction(function () use ($ticketId, $validated, $assignedBy, $changes, $ticket, $actorType, $attemptsCategoryChange, $attemptsPriorityChange) {
            $update = ['updated_at' => now()];
            if (array_key_exists('ticket_status_ID', $validated) && $validated['ticket_status_ID'] !== null) {
                $statusToSet = (int) $validated['ticket_status_ID'];

                $update['ticket_status_ID'] = $statusToSet;
                if ($statusToSet === 2) {
                    $update['in_progress_owner'] = !empty($ticket->assigned_to) ? TicketStateMachine::OWNER_EMPLOYEE : TicketStateMachine::OWNER_CS;
                } elseif (in_array($statusToSet, [3, 4, 9, 10], true)) {
                    $update['in_progress_owner'] = null;
                } elseif ($statusToSet === 5) {
                    $update['in_progress_owner'] = null;
                    $escReason = $validated['escalation_reason'] ?? $validated['reason'] ?? null;
                    if ($escReason) {
                        $update['escalation_reason'] = $escReason;
                    }
                    if (!empty($validated['assigned_to'])) {
                        $newAssignedTo = (int) $validated['assigned_to'];
                        $update['assigned_to'] = $newAssignedTo;

                        DB::table('ticket_assignments')->where('ticket_ID', $ticketId)->delete();
                        DB::table('ticket_assignments')->insert([
                            'ticket_ID' => $ticketId,
                            'employee_ID' => $newAssignedTo,
                            'assigned_by' => $assignedBy,
                            'assignment_status' => 'assigned',
                            'assigned_at' => now(),
                            'created_at' => now(),
                            'updated_at' => now(),
                        ]);
                    }
                }
                
                if ($statusToSet == 3 || $statusToSet == 4) {
                    if (!$ticket->resolved_at) {
                        $update['resolved_at'] = now();
                    }
                    if ($statusToSet == 4) {
                        $update['closed_at'] = now();
                    }
                    try {
                        $this->slaService->recordResolution($ticketId, now());
                    } catch (\Exception $e) {
                        Log::warning("Failed to record resolution SLA in updateTicket: " . $e->getMessage());
                    }
                }

                if ($actorType === 'employee') {
                    try {
                        $this->slaService->recordFirstResponse($ticketId, now());
                    } catch (\Exception $e) {}
                }
                
                if ($statusToSet == 2 && $ticket->ticket_status_ID == 6) {
                    $isProofRejection = (array_key_exists('proof_rejected', $validated) && $validated['proof_rejected']);
                    if (!$isProofRejection) {
                        $update['resolved_at'] = null;
                        $update['closed_at'] = null;
                        $update['proof_rejected'] = false;
                        $update['rejection_reason'] = null;
                        $update['assigned_to'] = null;
                        DB::table('ticket_assignments')->where('ticket_ID', $ticketId)->delete();
                    } else {
                        $update['resolved_at'] = null;
                        $update['closed_at'] = null;
                    }
                }
            }
            if (array_key_exists('priority_ID', $validated) && $validated['priority_ID'] !== null) {
                $update['priority_ID'] = $validated['priority_ID'];
            }
            if (array_key_exists('proof_rejected', $validated)) {
                $update['proof_rejected'] = $validated['proof_rejected'];
            }
            if (array_key_exists('rejection_reason', $validated)) {
                $update['rejection_reason'] = $validated['rejection_reason'];
            }
            if (array_key_exists('title', $validated) && $validated['title'] !== null) {
                $update['title'] = strip_tags(trim($validated['title']));
            }
            if (array_key_exists('description', $validated) && $validated['description'] !== null) {
                $update['description'] = trim($validated['description']);
            }
            if (array_key_exists('problem_category_ID', $validated) && $validated['problem_category_ID'] !== null) {
                $update['problem_category_ID'] = $validated['problem_category_ID'];
            }
            if (array_key_exists('machine_ID', $validated) && $validated['machine_ID'] !== null) {
                $update['machine_ID'] = $validated['machine_ID'];
            }
            if (array_key_exists('assigned_to', $validated) && $validated['assigned_to'] !== null && empty($update['assigned_to'])) {
                $update['assigned_to'] = (int) $validated['assigned_to'];
            }
            if (array_key_exists('escalation_reason', $validated) && $validated['escalation_reason'] !== null && empty($update['escalation_reason'])) {
                $update['escalation_reason'] = $validated['escalation_reason'];
            }

            DB::table('tickets')->where('ticket_ID', $ticketId)->update($update);

            // Recalculate SLA if category or priority changed
            if ($attemptsCategoryChange || $attemptsPriorityChange) {
                try {
                    $newCat = $validated['problem_category_ID'] ?? $ticket->problem_category_ID;
                    $newPrio = $validated['priority_ID'] ?? ($ticket->priority_ID ?? 1);
                    $this->slaService->recalculateForReclassification($ticketId, $newCat, $newPrio);
                } catch (\Throwable $e) {
                    Log::warning("SLA recalculateForReclassification failed in updateTicket: " . $e->getMessage());
                }
            }

            foreach ($changes as $chg) {
                $actionType = 'update';
                if ($chg['field'] === 'problem_category_ID' || $chg['field'] === 'priority_ID') {
                    $actionType = 'update';
                }

                DB::table('ticket_audit_logs')->insert([
                    'ticket_ID' => $ticketId,
                    'action_type' => $actionType,
                    'action_by_ID' => $assignedBy,
                    'actor_type' => $actorType,
                    'details' => json_encode($chg),
                    'created_at' => now(),
                ]);
            }
        });

        if ($statusToSet === 5) {
            $assignedManagerId = $validated['assigned_to'] ?? $ticket->assigned_to ?? null;
            $escReason = $validated['escalation_reason'] ?? $validated['reason'] ?? 'Escalated by Customer Service for supervisory review.';
            $ticketRef = TicketNumberGeneratorService::refFor($ticketId);
            $ticketTitle = $ticket->title ?? "Ticket #{$ticketId}";

            if ($assignedManagerId) {
                $mgrTitle = "Urgent: Ticket Escalated - {$ticketRef}";
                $mgrMessage = "Manager Alert: Ticket {$ticketRef}: \"{$ticketTitle}\" has been escalated to you. Reason: \"{$escReason}\". Immediate departmental intervention required.";

                try {
                    $this->notificationService->notifyRecipient(
                        (int) $assignedManagerId,
                        'employee',
                        $mgrTitle,
                        $mgrMessage,
                        $ticketId,
                        [
                            'ticket_id' => $ticketId,
                            'ticket_ref' => $ticketRef,
                            'type' => 'ticket_escalated',
                            'escalation_reason' => $escReason,
                            'is_manager_alert' => true,
                        ],
                        'ticket_escalated'
                    );

                    $catNameEsc = DB::table('problem_categories')->where('problem_category_ID', $ticket->problem_category_ID)->value('category_name') ?? '';
                    $prioNameEsc = DB::table('ticket_priorities')->where('priority_ID', $ticket->priority_ID ?? 1)->value('priority_name') ?? '';

                    $this->notificationService->sendTicketEmail(
                        (int) $assignedManagerId,
                        $mgrTitle,
                        $mgrMessage,
                        $ticketId,
                        $ticketTitle,
                        $catNameEsc,
                        $prioNameEsc,
                        'ticket_escalated',
                        [
                            'escalation_reason' => $escReason,
                        ]
                    );
                } catch (\Throwable $e) {
                    Log::warning("Failed to dispatch manager escalation notification for ticket #{$ticketId}: " . $e->getMessage());
                }
            }

            try {
                $this->notificationService->broadcastTicketChange('escalated', $ticketId, [
                    'ticket_id' => $ticketId,
                    'status' => 'Escalated',
                    'status_id' => 5,
                    'assigned_to' => $assignedManagerId,
                    'escalation_reason' => $escReason,
                ]);
            } catch (\Throwable $e) {
                Log::warning("Failed to broadcast ticket escalation change: " . $e->getMessage());
            }
        }

        if (array_key_exists('proof_rejected', $validated) && $validated['proof_rejected']) {
            $assignedEmployeeId = $ticket->assigned_to;
            if ($assignedEmployeeId) {
                $ticketRefForProof = TicketNumberGeneratorService::refFor($ticketId);
                $proofRejectData = [
                    'ticket_id' => $ticketId,
                    'ticket_ref' => $ticketRefForProof,
                    'reason' => $validated['rejection_reason'] ?? '',
                    'type' => 'proof_rejected',
                ];
                $this->notificationService->notifyRecipient(
                    $assignedEmployeeId,
                    'employee',
                    'Proof of Completion Rejected',
                    "Your proof of completion for ticket {$ticketRefForProof} has been rejected. Reason: \"" . ($validated['rejection_reason'] ?? '') . "\".",
                    $ticketId,
                    $proofRejectData
                );
            }
            
            $proofRejectCustData = [
                'ticket_id' => $ticketId,
                'ticket_ref' => TicketNumberGeneratorService::refFor($ticketId),
                'type' => 'proof_rejected',
            ];
            $this->notificationService->notifyCustomer(
                $ticket->created_by,
                'Proof of Completion Rejected',
                "The proof of completion for ticket " . TicketNumberGeneratorService::refFor($ticketId) . " has been rejected by customer service.",
                $ticketId,
                $proofRejectCustData
            );

            $catNameRej = DB::table('problem_categories')->where('problem_category_ID', $ticket->problem_category_ID)->value('category_name') ?? '';
            $prioNameRej = DB::table('ticket_priorities')->where('priority_ID', $ticket->priority_ID ?? 1)->value('priority_name') ?? '';
            $this->notificationService->sendCustomerEmail(
                $ticket->created_by,
                'Proof of Completion Rejected',
                "The proof of completion for your ticket " . TicketNumberGeneratorService::refFor($ticketId) . " has been rejected.",
                $ticketId,
                $ticket->title,
                $catNameRej,
                $prioNameRej
            );
        } else if (array_key_exists('ticket_status_ID', $validated) && ($validated['ticket_status_ID'] == 3 || $validated['ticket_status_ID'] == 4) && $ticket->ticket_status_ID == 6) {
            $assignedEmployeeId = $ticket->assigned_to;
            if ($assignedEmployeeId) {
                $this->notificationService->notifyRecipient(
                    $assignedEmployeeId,
                    'employee',
                    'Proof of Completion Approved',
                    "Your proof of completion for ticket " . TicketNumberGeneratorService::refFor($ticketId) . " has been approved.",
                    $ticketId
                );
            }

            $statusName = DB::table('ticket_statuses')->where('ticket_status_ID', $validated['ticket_status_ID'])->value('status_name') ?? 'Closed';
            $notificationTitle = "Ticket {$statusName}";
            $statusText = "has been marked as {$statusName}";

            $closedData = [
                'ticket_id' => $ticketId,
                'ticket_ref' => TicketNumberGeneratorService::refFor($ticketId),
                'type' => 'ticket_closed',
            ];
            $this->notificationService->notifyCustomer(
                $ticket->created_by,
                $notificationTitle,
                "Your ticket " . TicketNumberGeneratorService::refFor($ticketId) . " {$statusText}.",
                $ticketId,
                $closedData
            );

            $catNameClose = DB::table('problem_categories')->where('problem_category_ID', $ticket->problem_category_ID)->value('category_name') ?? '';
            $prioNameClose = DB::table('ticket_priorities')->where('priority_ID', $ticket->priority_ID ?? 1)->value('priority_name') ?? '';
            $this->notificationService->sendCustomerEmail(
                $ticket->created_by,
                $notificationTitle,
                "Your ticket " . TicketNumberGeneratorService::refFor($ticketId) . " {$statusText}.",
                $ticketId,
                $ticket->title,
                $catNameClose,
                $prioNameClose
            );
        }

        foreach ($changes as $chg) {
            $field = $chg['field'];
            $oldVal = $chg['old'];
            $newVal = $chg['new'];
            
            $detailText = '';
            if ($field === 'ticket_status_ID') {
                $oldStatus = DB::table('ticket_statuses')->where('ticket_status_ID', $oldVal)->value('status_name') ?? $oldVal;
                $newStatus = DB::table('ticket_statuses')->where('ticket_status_ID', $newVal)->value('status_name') ?? $newVal;
                $detailText = "status was updated from \"{$oldStatus}\" to \"{$newStatus}\"";
            } elseif ($field === 'priority_ID') {
                $oldPriority = DB::table('ticket_priorities')->where('priority_ID', $oldVal)->value('priority_name') ?? $oldVal;
                $newPriority = DB::table('ticket_priorities')->where('priority_ID', $newVal)->value('priority_name') ?? $newVal;
                $detailText = "priority was updated from \"{$oldPriority}\" to \"{$newPriority}\"";
            }
            
            if ($detailText) {
                $ticketRefFields = TicketNumberGeneratorService::refFor($ticketId);
                $customerTitle = 'Ticket Updated';
                $customerData = null;

                if ($field === 'ticket_status_ID') {
                    $newStatusName = DB::table('ticket_statuses')->where('ticket_status_ID', $newVal)->value('status_name') ?? '';
                    if ($newStatusName === 'Resolved') {
                        $customerTitle = 'Ticket Resolved';
                        $customerData = [
                            'ticket_id' => $ticketId,
                            'ticket_ref' => $ticketRefFields,
                            'type' => 'ticket_resolved',
                            'feedback_link' => url("/feedback/{$ticketId}"),
                        ];
                    } elseif ($newStatusName === 'Closed') {
                        $customerTitle = 'Ticket Closed';
                        $customerData = [
                            'ticket_id' => $ticketId,
                            'ticket_ref' => $ticketRefFields,
                            'type' => 'ticket_closed',
                        ];
                    }
                }

                $this->notificationService->notifyCustomer(
                    $ticket->created_by,
                    $customerTitle,
                    "Your ticket {$ticketRefFields} {$detailText}.",
                    $ticketId,
                    $customerData
                );

                if ($ticket->requested_by) {
                    $this->notificationService->notifyRecipient(
                        $ticket->requested_by,
                        'employee',
                        'Ticket Updated',
                        "Your requested ticket {$ticketRefFields} {$detailText}.",
                        $ticketId
                    );
                }

                $catName = DB::table('problem_categories')->where('problem_category_ID', $ticket->problem_category_ID)->value('category_name') ?? '';
                $prioName = DB::table('ticket_priorities')->where('priority_ID', $ticket->priority_ID ?? 1)->value('priority_name') ?? '';
                $this->notificationService->sendCustomerEmail(
                    $ticket->created_by,
                    $customerTitle,
                    "Your ticket {$ticketRefFields}: \"" . $ticket->title . "\" {$detailText}.",
                    $ticketId,
                    $ticket->title,
                    $catName,
                    $prioName
                );
            }
        }

        if (array_key_exists('ticket_status_ID', $validated) && ($validated['ticket_status_ID'] == 2 || $validated['ticket_status_ID'] == 8) && ($ticket->ticket_status_ID == 3 || $ticket->ticket_status_ID == 4)) {
            $assignedEmployeeId = $ticket->assigned_to;
            if ($assignedEmployeeId) {
                $this->notificationService->notifyRecipient(
                    $assignedEmployeeId,
                    'employee',
                    'Ticket Reopened by Customer',
                    "Ticket " . TicketNumberGeneratorService::refFor($ticketId) . " has been reopened by the customer and is back in progress.",
                    $ticketId
                );
            }
            $this->notificationService->notifyCustomer(
                $ticket->created_by,
                'Ticket Reopened',
                "Your ticket " . TicketNumberGeneratorService::refFor($ticketId) . " has been reopened.",
                $ticketId
            );
            $catNameR = DB::table('problem_categories')->where('problem_category_ID', $ticket->problem_category_ID)->value('category_name') ?? '';
            $prioNameR = DB::table('ticket_priorities')->where('priority_ID', $ticket->priority_ID ?? 1)->value('priority_name') ?? '';
            $this->notificationService->sendCustomerEmail(
                $ticket->created_by,
                'Ticket Reopened',
                "Your ticket " . TicketNumberGeneratorService::refFor($ticketId) . " has been reopened.",
                $ticketId,
                $ticket->title,
                $catNameR,
                $prioNameR
            );
            $this->notificationService->notifyCS(
                'Ticket Reopened by Customer',
                "Ticket " . TicketNumberGeneratorService::refFor($ticketId) . " has been reopened by the customer.",
                $ticketId
            );
        }

        $this->notificationService->broadcastTicketChange('updated', $ticketId, [
            'ticket_status_ID' => $validated['ticket_status_ID'] ?? $ticket->ticket_status_ID,
            'priority_ID' => $validated['priority_ID'] ?? $ticket->priority_ID,
        ]);

        $this->cacheService->clearTicketCaches();
        return ['status' => 200, 'data' => ['message' => 'Ticket updated successfully.']];
    }

    /**
     * Discard an unassigned open ticket.
     */
    public function destroyTicket(int $ticketId, $user): array
    {
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket) {
            return ['status' => 404, 'data' => ['message' => 'Ticket not found']];
        }

        $currentState = $this->stateMachine->resolveState($ticket);
        try {
            $this->stateMachine->validateTransition($ticket, $currentState, TicketStateMachine::STATE_CANCELLED);
        } catch (\App\Exceptions\InvalidTicketTransitionException $e) {
            return [
                'status' => 422,
                'data' => [
                    'message' => $e->getMessage(),
                    'code' => 'INVALID_TICKET_TRANSITION',
                    'from_status' => $e->fromStatus,
                    'to_status' => $e->toStatus,
                    'allowed_statuses' => $e->allowedStatuses,
                ]
            ];
        }

        if ($user instanceof \App\Models\Client && (int)$ticket->created_by !== (int)$user->id) {
            return ['status' => 403, 'data' => ['message' => 'You do not have permission to discard this ticket.']];
        }

        return $this->stateMachine->applyTransition($ticket, TicketStateMachine::STATE_CANCELLED, [], $user);
    }

    /**
     * Put an in-progress ticket on hold.
     */
    public function holdTicket(int $ticketId, $user, ?string $reason = null): array
    {
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket) {
            return ['status' => 404, 'data' => ['message' => 'Ticket not found']];
        }

        if (!RoleHelper::isCsOrAdmin($user)) {
            return [
                'status' => 403,
                'data' => [
                    'message' => 'Only Customer Service or Administrators can put a ticket on hold.',
                    'code' => 'FORBIDDEN',
                ],
            ];
        }

        $trimmedReason = trim((string) $reason);
        if (empty($trimmedReason) || mb_strlen($trimmedReason) < 3) {
            return [
                'status' => 422,
                'data' => [
                    'message' => 'A reason is required to put a ticket on hold (minimum 3 characters).',
                    'code' => 'REASON_REQUIRED',
                ],
            ];
        }

        if (mb_strlen($trimmedReason) > 1000) {
            return [
                'status' => 422,
                'data' => [
                    'message' => 'The reason cannot exceed 1000 characters.',
                    'code' => 'REASON_TOO_LONG',
                ],
            ];
        }

        try {
            $result = $this->stateMachine->applyTransition($ticketId, 'hold', ['reason' => $trimmedReason], $user);

            if (($result['status'] ?? 0) === 200 && !empty($result['data']['transitioned'])) {
                // TODO: TS005 per-user notification preferences
                try {
                    $ticketRef = TicketNumberGeneratorService::refFor($ticketId);
                    $customerHoldData = [
                        'ticket_id' => $ticketId,
                        'ticket_ref' => $ticketRef,
                        'type' => 'ticket_on_hold',
                    ];
                    $employeeHoldData = [
                        'ticket_id' => $ticketId,
                        'ticket_ref' => $ticketRef,
                        'reason' => $trimmedReason,
                        'type' => 'ticket_on_hold',
                    ];

                    if ($ticket->is_internal && !empty($ticket->requested_by)) {
                        $this->notificationService->notifyRecipient(
                            (int) $ticket->requested_by,
                            'employee',
                            'Ticket Placed On Hold',
                            "Ticket {$ticketRef} has been placed on hold.",
                            $ticketId,
                            $customerHoldData
                        );
                    } else {
                        $this->notificationService->notifyCustomer(
                            (int) $ticket->created_by,
                            'Ticket Placed On Hold',
                            "Ticket {$ticketRef} has been placed on hold.",
                            $ticketId,
                            $customerHoldData
                        );
                    }

                    if (!empty($ticket->assigned_to)) {
                        $this->notificationService->notifyRecipient(
                            (int) $ticket->assigned_to,
                            'employee',
                            'Assigned Ticket Placed On Hold',
                            "Ticket {$ticketRef} assigned to you has been placed on hold. Reason: \"{$trimmedReason}\".",
                            $ticketId,
                            $employeeHoldData
                        );
                    }
                } catch (\Throwable $e) {
                    Log::warning("Failed to dispatch hold notifications for ticket {$ticketId}: " . $e->getMessage());
                }
            }

            return $result;
        } catch (\App\Exceptions\InvalidTicketTransitionException $e) {
            return [
                'status' => 422,
                'data' => [
                    'message' => $e->getMessage(),
                    'code' => 'INVALID_TICKET_TRANSITION',
                    'from_status' => $e->fromStatus,
                    'to_status' => $e->toStatus,
                    'allowed_statuses' => $e->allowedStatuses,
                ],
            ];
        }
    }

    /**
     * Resume a ticket from on-hold back to in-progress.
     */
    public function resumeTicket(int $ticketId, $user): array
    {
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket) {
            return ['status' => 404, 'data' => ['message' => 'Ticket not found']];
        }

        if (!RoleHelper::isCsOrAdmin($user)) {
            return [
                'status' => 403,
                'data' => [
                    'message' => 'Only Customer Service or Administrators can resume a ticket from on hold.',
                    'code' => 'FORBIDDEN',
                ],
            ];
        }

        try {
            $result = $this->stateMachine->applyTransition($ticketId, 'resume', [], $user);

            if (($result['status'] ?? 0) === 200 && !empty($result['data']['transitioned'])) {
                // TODO: TS005 per-user notification preferences
                try {
                    $ticketRef = TicketNumberGeneratorService::refFor($ticketId);
                    $resumeData = [
                        'ticket_id' => $ticketId,
                        'ticket_ref' => $ticketRef,
                        'type' => 'ticket_resumed',
                    ];

                    if ($ticket->is_internal && !empty($ticket->requested_by)) {
                        $this->notificationService->notifyRecipient(
                            (int) $ticket->requested_by,
                            'employee',
                            'Ticket Resumed',
                            "Ticket {$ticketRef} has been resumed and is back in progress.",
                            $ticketId,
                            $resumeData
                        );
                    } else {
                        $this->notificationService->notifyCustomer(
                            (int) $ticket->created_by,
                            'Ticket Resumed',
                            "Ticket {$ticketRef} has been resumed and is back in progress.",
                            $ticketId,
                            $resumeData
                        );
                    }

                    if (!empty($ticket->assigned_to)) {
                        $this->notificationService->notifyRecipient(
                            (int) $ticket->assigned_to,
                            'employee',
                            'Assigned Ticket Resumed',
                            "Ticket {$ticketRef} assigned to you has been resumed.",
                            $ticketId,
                            $resumeData
                        );
                    }
                } catch (\Throwable $e) {
                    Log::warning("Failed to dispatch resume notifications for ticket {$ticketId}: " . $e->getMessage());
                }
            }

            return $result;
        } catch (\App\Exceptions\InvalidTicketTransitionException $e) {
            return [
                'status' => 422,
                'data' => [
                    'message' => $e->getMessage(),
                    'code' => 'INVALID_TICKET_TRANSITION',
                    'from_status' => $e->fromStatus,
                    'to_status' => $e->toStatus,
                    'allowed_statuses' => $e->allowedStatuses,
                ],
            ];
        }
    }

    /**
     * Resolve a ticket.
     */
    public function resolveTicket(int $ticketId, $user): array
    {
        return $this->stateMachine->applyTransition($ticketId, 'resolve', [], $user);
    }

    /**
     * Close a resolved ticket.
     */
    public function closeTicket(int $ticketId, $user): array
    {
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket) {
            return ['status' => 404, 'data' => ['message' => 'Ticket not found']];
        }

        if ($user instanceof \App\Models\Client) {
            if ((int)$ticket->is_internal !== 0 || (int)$ticket->created_by !== (int)$user->id) {
                return [
                    'status' => 403,
                    'data' => [
                        'message' => 'You do not have permission to close this ticket.',
                        'code' => 'NOT_OWNER',
                    ],
                ];
            }
        } else {
            if ((int)$ticket->is_internal === 1) {
                $isRequester = isset($user->emp_id) && (int)$user->emp_id === (int)$ticket->requested_by;
                $isCsOrAdmin = RoleHelper::isCsOrAdmin($user);
                if (!$isRequester && !$isCsOrAdmin) {
                    return [
                        'status' => 403,
                        'data' => [
                            'message' => 'Only the requester or Customer Service can close this ticket.',
                            'code' => 'FORBIDDEN',
                        ],
                    ];
                }
            }
        }

        try {
            return $this->stateMachine->applyTransition($ticketId, 'close', [], $user);
        } catch (\App\Exceptions\InvalidTicketTransitionException $e) {
            return [
                'status' => 422,
                'data' => [
                    'message' => $e->getMessage(),
                    'code' => 'INVALID_TICKET_TRANSITION',
                    'from_status' => $e->fromStatus,
                    'to_status' => $e->toStatus,
                    'allowed_statuses' => $e->allowedStatuses,
                ],
            ];
        }
    }

    /**
     * Reopen a closed or resolved ticket (routes automatically to In Progress CS-owned).
     */
    public function reopenTicket(int $ticketId, $user, ?string $reason = null): array
    {
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket) {
            return ['status' => 404, 'data' => ['message' => 'Ticket not found']];
        }

        $trimmedReason = trim((string) $reason);
        if (empty($trimmedReason) || mb_strlen($trimmedReason) < 3) {
            return [
                'status' => 422,
                'data' => [
                    'message' => 'A reason is required to reopen this ticket (minimum 3 characters).',
                    'code' => 'REASON_REQUIRED',
                ],
            ];
        }

        if (mb_strlen($trimmedReason) > 1000) {
            return [
                'status' => 422,
                'data' => [
                    'message' => 'The reason cannot exceed 1000 characters.',
                    'code' => 'REASON_TOO_LONG',
                ],
            ];
        }

        // Ownership checks
        if ($user instanceof \App\Models\Client) {
            if ((int)$ticket->is_internal !== 0 || (int)$ticket->created_by !== (int)$user->id) {
                return [
                    'status' => 403,
                    'data' => [
                        'message' => 'You do not have permission to reopen this ticket.',
                        'code' => 'NOT_OWNER',
                    ],
                ];
            }
        } else {
            if ((int)$ticket->is_internal === 1) {
                $isRequester = isset($user->emp_id) && (int)$user->emp_id === (int)$ticket->requested_by;
                $isCsOrAdmin = RoleHelper::isCsOrAdmin($user);
                if (!$isRequester && !$isCsOrAdmin) {
                    return [
                        'status' => 403,
                        'data' => [
                            'message' => 'Only the requester or Customer Service can reopen this ticket.',
                            'code' => 'FORBIDDEN',
                        ],
                    ];
                }
            } else {
                if (!RoleHelper::isCsOrAdmin($user)) {
                    return [
                        'status' => 403,
                        'data' => [
                            'message' => 'Only Customer Service can reopen customer tickets.',
                            'code' => 'FORBIDDEN',
                        ],
                    ];
                }
            }
        }

        // Validate status is Resolved (3) or Closed (4)
        if (!in_array((int)$ticket->ticket_status_ID, [3, 4], true)) {
            return [
                'status' => 422,
                'data' => [
                    'message' => "Tickets can only be reopened from 'Closed' or 'Resolved' status.",
                    'code' => 'NOT_REOPENABLE',
                ],
            ];
        }

        // Check reopen window
        $windowConfig = TicketConfigurationService::getWindowConfig();
        if (!($windowConfig['reopenEnabled'] ?? true)) {
            return [
                'status' => 422,
                'data' => [
                    'message' => 'Reopening tickets is disabled by administrative operational policy.',
                    'code' => 'WINDOW_EXPIRED',
                ],
            ];
        }

        $reopenDays = (int) ($windowConfig['reopenWindowDays'] ?? 2);
        $allowedHours = $reopenDays * 24;
        $cutoffTime = $ticket->closed_at
            ? Carbon::parse($ticket->closed_at)
            : ($ticket->resolved_at ? Carbon::parse($ticket->resolved_at) : null);

        if ($cutoffTime && $cutoffTime->diffInHours(now()) > $allowedHours) {
            $dayLabel = $reopenDays === 1 ? '1 day' : "{$reopenDays} days";
            return [
                'status' => 422,
                'data' => [
                    'message' => "Cannot reopen ticket: More than {$dayLabel} ({$allowedHours} hours) have passed since resolution/closure.",
                    'code' => 'WINDOW_EXPIRED',
                ],
            ];
        }

        // Capture previous assigned employee before state machine nulls it
        $previousAssignedTo = $ticket->assigned_to;
        if (!$previousAssignedTo) {
            $previousAssignedTo = DB::table('ticket_assignments')
                ->where('ticket_ID', $ticketId)
                ->orderByDesc('assignment_ID')
                ->value('employee_ID');
        }

        try {
            $transitionResult = $this->stateMachine->applyTransition(
                $ticketId,
                'reopen',
                [
                    'reason' => $trimmedReason,
                    'previous_assigned_to' => $previousAssignedTo,
                ],
                $user
            );
        } catch (\App\Exceptions\InvalidTicketTransitionException $e) {
            return [
                'status' => 422,
                'data' => [
                    'message' => $e->getMessage(),
                    'code' => 'WINDOW_EXPIRED',
                ],
            ];
        }

        if (isset($transitionResult['data']) && is_array($transitionResult['data'])) {
            $transitionResult['data']['previous_assigned_to'] = $previousAssignedTo;
        }

        if (($transitionResult['status'] ?? 0) === 200 && !empty($transitionResult['data']['transitioned'])) {
            // TODO: TS005 per-user notification preferences
            try {
                $ticketRef = TicketNumberGeneratorService::refFor($ticketId);
                $reopenNotificationData = [
                    'ticket_id' => $ticketId,
                    'ticket_ref' => $ticketRef,
                    'reason' => $trimmedReason,
                    'type' => 'ticket_reopened',
                ];

                // Notify CS
                $this->notificationService->notifyCS(
                    'Ticket Reopened',
                    "Ticket {$ticketRef} has been reopened. Reason: \"{$trimmedReason}\".",
                    $ticketId,
                    $reopenNotificationData
                );

                // Notify previously assigned employee if one existed
                if ($previousAssignedTo) {
                    $this->notificationService->notifyRecipient(
                        (int) $previousAssignedTo,
                        'employee',
                        'Assigned Ticket Reopened',
                        "Ticket {$ticketRef} previously assigned to you has been reopened. Reason: \"{$trimmedReason}\".",
                        $ticketId,
                        $reopenNotificationData
                    );
                }

                // Notify customer or internal requester
                if ($ticket->is_internal && !empty($ticket->requested_by)) {
                    $this->notificationService->notifyRecipient(
                        (int) $ticket->requested_by,
                        'employee',
                        'Ticket Reopened',
                        "Ticket {$ticketRef} has been reopened. Reason: \"{$trimmedReason}\".",
                        $ticketId,
                        $reopenNotificationData
                    );
                } else {
                    $this->notificationService->notifyCustomer(
                        (int) $ticket->created_by,
                        'Ticket Reopened',
                        "Your ticket {$ticketRef} has been reopened. Reason: \"{$trimmedReason}\".",
                        $ticketId,
                        $reopenNotificationData
                    );
                }
            } catch (\Throwable $e) {
                Log::warning("Failed to dispatch reopen notifications for ticket {$ticketId}: " . $e->getMessage());
            }

            // Post reopen message to messaging-service only when actor is a customer
            if ($user instanceof \App\Models\Client) {
                try {
                    $clientName = $user->client_name ?? 'Customer';
                    Http::withHeaders([
                        'X-Internal-Token' => env('INTERNAL_TOKEN'),
                    ])->post("http://messaging-service:8000/api/internal/tickets/{$ticketId}/messages", [
                        'message' => "Ticket reopened. Reason: {$trimmedReason}",
                        'sender_name' => $clientName,
                        'sender_type' => 'customer',
                        'sender_id' => (int) $user->id,
                    ]);
                } catch (\Throwable $e) {
                    Log::warning("Failed to post reopen message to messaging-service for ticket {$ticketId}: " . $e->getMessage());
                }
            }
        }

        return $transitionResult;
    }

    /**
     * Reclassify ticket category and/or priority with SLA recalculation.
     * Restricted strictly to Customer Service and Administrators.
     */
    public function reclassifyTicket(int $ticketId, array $validated, $user): array
    {
        if (!RoleHelper::isCsOrAdmin($user)) {
            return [
                'status' => 403,
                'data' => [
                    'message' => 'Only Customer Service or Administrators can reclassify tickets.',
                    'code' => 'FORBIDDEN',
                ],
            ];
        }

        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket) {
            return ['status' => 404, 'data' => ['message' => 'Ticket not found']];
        }

        // Closed (4) or Cancelled (5, 9) tickets cannot be reclassified
        if (in_array((int)$ticket->ticket_status_ID, [4, 5, 9], true)) {
            return [
                'status' => 422,
                'data' => [
                    'message' => 'Cannot reclassify a closed or cancelled ticket.',
                    'code' => 'TICKET_CLOSED',
                ],
            ];
        }

        $oldCategory = (int) $ticket->problem_category_ID;
        $newCategory = array_key_exists('problem_category_ID', $validated) && $validated['problem_category_ID'] !== null
            ? (int) $validated['problem_category_ID']
            : $oldCategory;

        $oldPriority = (int) ($ticket->priority_ID ?? 1);
        $newPriority = array_key_exists('priority_ID', $validated) && $validated['priority_ID'] !== null
            ? (int) $validated['priority_ID']
            : $oldPriority;

        if ($oldCategory === $newCategory && $oldPriority === $newPriority) {
            return [
                'status' => 200,
                'data' => [
                    'message' => 'No classification changes to update.',
                    'ticket_id' => $ticketId,
                    'problem_category_ID' => $oldCategory,
                    'priority_ID' => $oldPriority,
                ],
            ];
        }

        $isAssigned = !empty($ticket->assigned_to);
        $reassignmentNeeded = $isAssigned;

        $actorId = $user->emp_id ?? $user->id ?? 1;
        $actorType = 'employee';
        if (isset($user->role) && in_array(strtolower(str_replace(' ', '', (string)$user->role)), ['superadmin', 'admin'], true)) {
            $actorType = strtolower(str_replace(' ', '', (string)$user->role));
        }

        $slaRecalc = null;
        DB::transaction(function () use (
            $ticketId,
            $newCategory,
            $newPriority,
            $oldCategory,
            $oldPriority,
            $actorId,
            $actorType,
            $reassignmentNeeded,
            &$slaRecalc
        ) {
            DB::table('tickets')->where('ticket_ID', $ticketId)->update([
                'problem_category_ID' => $newCategory,
                'priority_ID' => $newPriority,
                'updated_at' => now(),
            ]);

            try {
                $slaRecalc = $this->slaService->recalculateForReclassification($ticketId, $newCategory, $newPriority);
            } catch (\Throwable $e) {
                Log::warning("SLA recalculateForReclassification failed in reclassifyTicket: " . $e->getMessage());
            }

            DB::table('ticket_audit_logs')->insert([
                'ticket_ID' => $ticketId,
                'action_type' => 'reclassification',
                'action_by_ID' => $actorId,
                'actor_type' => $actorType,
                'details' => json_encode([
                    'old_category_id' => $oldCategory,
                    'new_category_id' => $newCategory,
                    'old_priority_id' => $oldPriority,
                    'new_priority_id' => $newPriority,
                    'reassignment_needed' => $reassignmentNeeded,
                ]),
                'created_at' => now(),
            ]);
        });

        $this->cacheService->clearTicketCaches();
        $this->notificationService->broadcastTicketChange('updated', $ticketId, [
            'problem_category_ID' => $newCategory,
            'priority_ID' => $newPriority,
        ]);

        // TODO: TS005 per-user notification preferences
        try {
            $ticketRef = TicketNumberGeneratorService::refFor($ticketId);
            $reclassifyData = [
                'ticket_id' => $ticketId,
                'ticket_ref' => $ticketRef,
                'old_category_id' => $oldCategory,
                'new_category_id' => $newCategory,
                'old_priority_id' => $oldPriority,
                'new_priority_id' => $newPriority,
                'type' => 'ticket_reclassified',
            ];

            // Notify customer or internal requester
            if ($ticket->is_internal && !empty($ticket->requested_by)) {
                $this->notificationService->notifyRecipient(
                    (int) $ticket->requested_by,
                    'employee',
                    'Ticket Classification Updated',
                    "Ticket {$ticketRef} classification has been updated.",
                    $ticketId,
                    $reclassifyData
                );
            } else {
                $this->notificationService->notifyCustomer(
                    (int) $ticket->created_by,
                    'Ticket Classification Updated',
                    "Your ticket {$ticketRef} classification has been updated.",
                    $ticketId,
                    $reclassifyData
                );
            }

            // Notify assigned employee if assigned
            if (!empty($ticket->assigned_to)) {
                $this->notificationService->notifyRecipient(
                    (int) $ticket->assigned_to,
                    'employee',
                    'Assigned Ticket Classification Updated',
                    "Ticket {$ticketRef} assigned to you has been reclassified.",
                    $ticketId,
                    $reclassifyData
                );
            }
        } catch (\Throwable $e) {
            Log::warning("Failed to dispatch reclassification notifications for ticket {$ticketId}: " . $e->getMessage());
        }

        return [
            'status' => 200,
            'data' => [
                'message' => 'Ticket classification updated successfully.',
                'ticket_id' => $ticketId,
                'old_category_id' => $oldCategory,
                'new_category_id' => $newCategory,
                'old_priority_id' => $oldPriority,
                'new_priority_id' => $newPriority,
                'reassignment_needed' => $reassignmentNeeded,
                'sla' => $slaRecalc,
            ],
        ];
    }

    /**
     * Cancel / Discard a ticket.
     */
    public function cancelTicket(int $ticketId, $user): array
    {
        return $this->stateMachine->applyTransition($ticketId, 'cancel', [], $user);
    }

    /**
     * View customer and machine context for assigned employee, CS, or Admin (TS029).
     * Server-side access control guarantees this context is only returned to the
     * assigned employee or privileged support roles, with sensitive customer billing
     * data strictly excluded.
     */
    public function getCustomerContext(int $ticketId, $user): array
    {
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket) {
            return [
                'status' => 404,
                'data' => ['message' => 'Ticket not found.', 'code' => 'TICKET_NOT_FOUND'],
            ];
        }

        // 1. Server-side access control
        if ($user instanceof \App\Models\Client) {
            if ((int) $ticket->is_internal !== 0 || (int) $ticket->created_by !== (int) $user->id) {
                return [
                    'status' => 403,
                    'data' => [
                        'message' => 'Access denied. You do not have permission to view context for this ticket.',
                        'code' => 'UNAUTHORIZED_CONTEXT_ACCESS',
                    ],
                ];
            }
        } else {
            $role = strtolower(trim((string) ($user->role ?? '')));
            $isCSOrAdmin = in_array($role, ['customer service', 'customer support', 'cs', 'head of cs', 'head of customer service', 'admin', 'superadmin', 'super admin'], true);

            $empId = $user->emp_id ?? $user->id ?? null;
            $isAssigned = ((int) $ticket->assigned_to === (int) $empId);
            if (!$isAssigned && $empId) {
                $isAssigned = DB::table('ticket_assignments')
                    ->where('ticket_ID', $ticketId)
                    ->where('employee_ID', $empId)
                    ->whereIn('assignment_status', ['assigned', 'accepted'])
                    ->exists();
            }

            if (!$isAssigned && !$isCSOrAdmin) {
                return [
                    'status' => 403,
                    'data' => [
                        'message' => 'Access denied. Only the currently assigned employee or support administrators can view customer and machine context for this ticket.',
                        'code' => 'UNAUTHORIZED_CONTEXT_ACCESS',
                    ],
                ];
            }
        }

        // 2. Customer Contact Details (Sanitized, excluding billing/financial info)
        $customerContext = [];
        if ($ticket->is_internal) {
            $reqId = $ticket->requested_by ?? $ticket->created_by;
            $emp = DB::table('employees')->where('emp_id', $reqId)->first();
            $missingFields = [];
            if (empty($emp?->email)) $missingFields[] = 'email';
            if (empty($emp?->department)) $missingFields[] = 'department';

            $customerContext = [
                'type' => 'internal_employee',
                'id' => $emp ? (int) $emp->emp_id : null,
                'name' => $emp ? trim("{$emp->first_name} {$emp->last_name}") : 'Internal Staff',
                'first_name' => $emp->first_name ?? null,
                'last_name' => $emp->last_name ?? null,
                'email' => $emp->email ?? null,
                'department' => $emp->department ?? null,
                'role' => $emp->role ?? null,
                'phone' => null,
                'address' => null,
                'preferred_contact_method' => 'Email',
                'missing_fields' => $missingFields,
            ];
        } else {
            $client = DB::table('clients')->where('id', $ticket->created_by)->first();
            $missingFields = [];
            if (empty($client?->contact_number)) $missingFields[] = 'phone';
            if (empty($client?->email)) $missingFields[] = 'email';
            if (empty($client?->address)) $missingFields[] = 'address';

            $customerContext = [
                'type' => 'customer',
                'id' => $client ? (int) $client->id : null,
                'name' => $client->client_name ?? 'Unknown Customer',
                'email' => $client->email ?? null,
                'phone' => $client->contact_number ?? null,
                'address' => $client->address ?? null,
                'preferred_contact_method' => !empty($client?->contact_number) ? 'Phone' : 'Email',
                'status' => $client ? (bool) $client->status : false,
                'missing_fields' => $missingFields,
            ];
        }

        // 3. Machine Details & History Summary
        $machineContext = null;
        if (!empty($ticket->machine_ID)) {
            $machine = DB::table('machines as m')
                ->leftJoin('machine_categories as mc', 'mc.category_ID', '=', 'm.category_ID')
                ->where('m.machine_ID', $ticket->machine_ID)
                ->select(
                    'm.machine_ID',
                    'm.machine_name',
                    'm.brand',
                    'm.model',
                    'm.serial_number',
                    'm.status',
                    'm.purchase_date',
                    'm.last_maintenance_date',
                    'mc.category_name as category_name'
                )
                ->first();

            if ($machine) {
                $pastTicketCount = DB::table('tickets')
                    ->where('machine_ID', $ticket->machine_ID)
                    ->where('ticket_ID', '!=', $ticketId)
                    ->count();

                $lastResolved = DB::table('tickets')
                    ->where('machine_ID', $ticket->machine_ID)
                    ->where('ticket_ID', '!=', $ticketId)
                    ->whereNotNull('resolved_at')
                    ->orderByDesc('resolved_at')
                    ->value('resolved_at');

                $lastServiceDate = $lastResolved ?? $machine->last_maintenance_date ?? null;

                $machineContext = [
                    'linked' => true,
                    'machine_id' => (int) $machine->machine_ID,
                    'machine_name' => $machine->machine_name,
                    'make' => $machine->brand ?? 'Unknown',
                    'brand' => $machine->brand ?? 'Unknown',
                    'model' => $machine->model ?? 'Unknown',
                    'serial_number' => $machine->serial_number ?? 'N/A',
                    'status' => $machine->status ?? 'active',
                    'category' => $machine->category_name ?? 'General',
                    'location' => $customerContext['address'] ?? 'Customer Site',
                    'installation_date' => $machine->purchase_date ?? null,
                    'purchase_date' => $machine->purchase_date ?? null,
                    'last_maintenance_date' => $machine->last_maintenance_date ?? null,
                    'history_summary' => [
                        'past_ticket_count' => (int) $pastTicketCount,
                        'last_service_date' => $lastServiceDate ? \Carbon\Carbon::parse($lastServiceDate)->toIso8601String() : null,
                    ],
                ];
            }
        }

        return [
            'status' => 200,
            'data' => [
                'success' => true,
                'ticket_id' => (int) $ticketId,
                'ticket_number' => $ticket->ticket_number ?? null,
                'customer' => $customerContext,
                'machine' => $machineContext,
                'machine_message' => $machineContext ? null : 'No machine details linked',
            ],
        ];
    }
}
