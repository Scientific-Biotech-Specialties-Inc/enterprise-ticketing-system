<?php

namespace App\Http\Controllers;

use App\Events\MessageSent;
use App\Events\MessageUpdated;
use App\Events\MessageDeleted;
use App\Models\Message;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class MessageController extends Controller
{
    /**
     * Get parsed messaging configuration from MySQL ticket_configurations.
     */
    protected function getMessagingConfig(): array
    {
        $defaultConfig = [
            'default_participants' => 'customer_cs',
            'allow_delegated_employee' => true,
            'allow_full_history' => true,
            'notify_on_employee_join' => true,
            'internal' => [
                'mode' => 'requestor_cs_delegated',
                'allow_direct_assigned' => true,
                'allow_full_history' => true,
                'notify_on_activity' => true,
            ],
        ];

        try {
            $msgConfigRow = \Illuminate\Support\Facades\DB::connection('mysql')
                ->table('ticket_configurations')
                ->where('key', 'messaging')
                ->value('value');
            if ($msgConfigRow) {
                $parsed = is_string($msgConfigRow) ? json_decode($msgConfigRow, true) : $msgConfigRow;
                if (is_array($parsed)) {
                    $defaultInternal = $defaultConfig['internal'];
                    $currentInternal = isset($parsed['internal']) && is_array($parsed['internal'])
                        ? array_merge($defaultInternal, $parsed['internal'])
                        : $defaultInternal;

                    $config = array_merge($defaultConfig, $parsed);
                    $config['internal'] = $currentInternal;
                    return $config;
                }
            }
        } catch (\Throwable $e) {}

        return $defaultConfig;
    }

    /**
     * Get all messages for a specific ticket.
     */
    public function index($ticket_id)
    {
        $user = Auth::user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $ticketRecord = \Illuminate\Support\Facades\DB::connection('mysql')
            ->table('tickets')
            ->where('ticket_ID', (int)$ticket_id)
            ->first();

        if (!$ticketRecord) {
            return response()->json(['message' => 'Ticket not found.'], 404);
        }

        $isInternal = !empty($ticketRecord->is_internal);
        $messagingConfig = $this->getMessagingConfig();

        // Check access authorization on the ticket
        if ($user instanceof \App\Models\Employee) {
            $dept = strtolower($user->department ?? '');
            $role = strtolower($user->role ?? '');
            $isCS = str_contains($dept, 'customer service') || str_contains($dept, 'support') || $dept === 'cs' || str_contains($role, 'cs');
            $cleanRole = str_replace([' ', '_', '-'], '', $role);
            $isAdmin = in_array($cleanRole, ['superadmin', 'super_admin', 'admin', 'itadmin', 'it_admin']);

            if (!$isCS && !$isAdmin) {
                $empId = (int)$user->emp_id;
                $isRequester = ((int)$ticketRecord->requested_by === $empId);

                if ($isInternal) {
                    if (!$isRequester) {
                        $isAssigned = ((int)$ticketRecord->assigned_to === $empId);
                        if (!$isAssigned) {
                            $isAssigned = \Illuminate\Support\Facades\DB::connection('mysql')
                                ->table('ticket_assignments')
                                ->where('ticket_ID', (int)$ticket_id)
                                ->where('employee_ID', $empId)
                                ->exists();
                        }

                        if (!$isAssigned) {
                            return response()->json(['message' => 'You are not authorized to view this internal ticket thread.'], 403);
                        }

                        $internalMode = $messagingConfig['internal']['mode'] ?? 'requestor_cs_delegated';
                        if ($internalMode === 'requestor_cs_only') {
                            return response()->json(['message' => 'Assigned employee messaging on internal tickets is disabled by system policy.'], 403);
                        }
                    }
                } else {
                    if (!$isRequester) {
                        $isAssigned = ((int)$ticketRecord->assigned_to === $empId);
                        if (!$isAssigned) {
                            $isAssigned = \Illuminate\Support\Facades\DB::connection('mysql')
                                ->table('ticket_assignments')
                                ->where('ticket_ID', (int)$ticket_id)
                                ->where('employee_ID', $empId)
                                ->exists();
                        }

                        if (!$isAssigned) {
                            return response()->json(['message' => 'You are not assigned to this ticket.'], 403);
                        }

                        $allowDelegated = (bool)($messagingConfig['allow_delegated_employee'] ?? true);
                        if (!$allowDelegated) {
                            return response()->json(['message' => 'Delegated employee messaging is disabled by system policy.'], 403);
                        }
                    }
                }
            }
        } else {
            // Customer / Client
            if ($isInternal) {
                return response()->json(['message' => 'Customers cannot access internal ticket threads.'], 403);
            }
            if (!empty($ticketRecord->created_by) && (int)$ticketRecord->created_by !== (int)$user->id) {
                return response()->json(['message' => 'You do not have access to this ticket thread.'], 403);
            }
        }

        $userKey = $this->resolveUserKey($user);

        // Fetch messages for the ticket ordered by created_at ascending,
        // excluding those that are soft-deleted ("deleted for you") by this user.
        $messages = Message::where('ticket_id', (int)$ticket_id)
            ->whereNotIn('deleted_by', [$userKey])
            ->orderBy('created_at', 'asc')
            ->get();

        // Gating attachments by scan status (Pending/Clean/Quarantined) and ensuring sender_role
        $messages = $messages->map(function ($msg) use ($ticketRecord, $isInternal) {
            // Ensure sender_role is populated for historical records
            if (empty($msg->sender_role)) {
                if ($isInternal && $msg->sender_type === 'employee' && (int)$msg->sender_id === (int)$ticketRecord->requested_by) {
                    $msg->sender_role = 'Requestor';
                } elseif ($msg->sender_type === 'cs') {
                    $msg->sender_role = 'Customer Support';
                } elseif ($msg->sender_type === 'employee') {
                    $msg->sender_role = $isInternal ? 'Assigned Employee' : 'Staff / Engineer';
                } else {
                    $msg->sender_role = 'Customer';
                }
            }

            // Gating attachments: hide URLs for quarantined or pending scans
            if (!empty($msg->attachments) && is_array($msg->attachments)) {
                $gated = [];
                foreach ($msg->attachments as $att) {
                    $status = strtolower($att['scan_status'] ?? 'clean');
                    if ($status === 'quarantined' || !empty($att['virus_detected'])) {
                        $att['url'] = null;
                        $att['file_path'] = null;
                        $att['scan_status'] = 'quarantined';
                        $att['threat_alert'] = 'This file was flagged as a security threat and blocked.';
                    } elseif ($status === 'pending') {
                        $att['url'] = null;
                        $att['scan_status'] = 'pending';
                    } else {
                        $att['scan_status'] = 'clean';
                    }
                    $gated[] = $att;
                }
                $msg->attachments = $gated;
            } else {
                $msg->attachments = [];
            }

            return $msg;
        });

        return response()->json([
            'messages' => $messages
        ]);
    }

    /**
     * Store an auto-generated internal message from a subsystem.
     */
    public function storeInternal(Request $request, $ticket_id)
    {
        $token = $request->header('X-Internal-Token');
        if (!$token || $token !== env('INTERNAL_TOKEN')) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $request->validate([
            'message' => ['required', 'string', 'max:5000', new \App\Rules\NoMarkup()],
            'sender_name' => 'required|string|max:255',
            'sender_type' => 'required|string|max:50',
            'sender_id' => 'nullable|integer',
        ]);

        $message = Message::create([
            'ticket_id' => (int)$ticket_id,
            'sender_id' => $request->input('sender_id'),
            'sender_name' => $request->input('sender_name'),
            'sender_type' => $request->input('sender_type'),
            'message' => $request->input('message'),
        ]);

        broadcast(new MessageSent($message))->toOthers();

        return response()->json([
            'message' => 'Internal message stored successfully.',
            'message_obj' => $message
        ], 201);
    }

    /**
     * Store a new message and broadcast it.
     */
    public function store(Request $request, $ticket_id)
    {
        $user = Auth::user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $rawMessage = $request->input('message');
        $hasText = is_string($rawMessage) && trim($rawMessage) !== '';
        $hasUploadFiles = $request->hasFile('attachments');
        $hasJsonAttachments = is_array($request->input('attachments')) && count($request->input('attachments')) > 0;

        if (!$hasText && !$hasUploadFiles && !$hasJsonAttachments) {
            return response()->json([
                'message' => 'Please provide either a message or an attachment.',
                'code' => 'EMPTY_CONTENT',
                'errors' => [
                    'message' => ['At least message text or an attached file is required.']
                ]
            ], 422);
        }

        if ($hasText && \App\Rules\NoMarkup::contains($rawMessage)) {
            return response()->json([
                'message' => 'Message must not contain HTML or script markup.',
                'code' => 'MARKUP_NOT_ALLOWED',
                'errors' => ['message' => ['The message must not contain HTML or script markup.']]
            ], 422);
        }

        if ($hasText && mb_strlen($rawMessage) > 5000) {
            return response()->json([
                'message' => 'Message exceeds maximum length of 5000 characters.',
                'code' => 'CONTENT_TOO_LONG',
                'errors' => [
                    'message' => ['The message must not exceed 5000 characters.']
                ]
            ], 422);
        }

        // Check ticket existence and state before processing payload
        $ticketRecord = \Illuminate\Support\Facades\DB::connection('mysql')
            ->table('tickets')
            ->where('ticket_ID', (int)$ticket_id)
            ->first();

        if (!$ticketRecord) {
            return response()->json(['message' => 'Ticket not found.'], 404);
        }

        $isInternalTicket = !empty($ticketRecord->is_internal);
        $statusId = (int)$ticketRecord->ticket_status_ID;
        $isClosed = ($statusId === 4);

        if ($isClosed) {
            return response()->json([
                'message' => 'This conversation is archived because the ticket has been closed. Reopen the ticket to restore the conversation.'
            ], 403);
        }

        $messagingConfig = $this->getMessagingConfig();

        // Resolve sender information and capture immutable sender_role snapshot at time of send
        $senderId = null;
        $senderName = '';
        $senderType = '';
        $senderRole = 'Customer';

        if ($user instanceof \App\Models\Employee) {
            $senderId = $user->emp_id;
            $senderName = trim(($user->first_name ?? '') . ' ' . ($user->last_name ?? ''));
            
            $dept = strtolower($user->department ?? '');
            $role = strtolower($user->role ?? '');
            $rawRole = trim($user->role ?? '');
            $rawDept = trim($user->department ?? '');

            $isCS = str_contains($dept, 'customer service') || str_contains($dept, 'support') || $dept === 'cs' || str_contains($role, 'cs');
            $cleanRole = str_replace([' ', '_', '-'], '', $role);
            $isAdmin = in_array($cleanRole, ['superadmin', 'super_admin', 'admin', 'itadmin', 'it_admin']);

            $isRequester = ((int)$ticketRecord->requested_by === (int)$senderId);
            $isAssigned = ((int)$ticketRecord->assigned_to === (int)$senderId);
            if (!$isAssigned) {
                $isAssigned = \Illuminate\Support\Facades\DB::connection('mysql')
                    ->table('ticket_assignments')
                    ->where('ticket_ID', (int)$ticket_id)
                    ->where('employee_ID', (int)$senderId)
                    ->exists();
            }

            if ($isInternalTicket) {
                if ($isRequester) {
                    $senderType = 'employee';
                    $senderRole = 'Requestor';
                } elseif ($isCS) {
                    $senderType = 'cs';
                    $senderRole = 'Customer Support';
                } elseif ($isAdmin) {
                    $senderType = 'employee';
                    $senderRole = in_array($cleanRole, ['superadmin', 'super_admin']) ? 'Super Admin' : 'IT Admin';
                } elseif ($isAssigned) {
                    $internalMode = $messagingConfig['internal']['mode'] ?? 'requestor_cs_delegated';
                    if ($internalMode === 'requestor_cs_only') {
                        return response()->json(['message' => 'Assigned employee messaging on internal tickets is disabled by system policy.'], 403);
                    }
                    $senderType = 'employee';
                    $senderRole = 'Assigned Employee';
                } else {
                    return response()->json(['message' => 'You are not authorized to post to this internal ticket thread.'], 403);
                }
            } else {
                if ($isCS) {
                    if ($isRequester) {
                        return response()->json(['message' => 'You cannot message on a ticket you created.'], 403);
                    }
                    $senderType = 'cs';
                    $senderRole = 'Customer Support';
                } else {
                    $senderType = 'employee';
                    if (in_array($cleanRole, ['superadmin', 'super_admin'])) {
                        $senderRole = 'Super Admin';
                    } elseif (in_array($cleanRole, ['admin', 'itadmin', 'it_admin'])) {
                        $senderRole = 'IT Admin';
                    } elseif (!empty($rawRole)) {
                        $senderRole = ucwords(str_replace(['_', '-'], ' ', $rawRole));
                    } elseif (!empty($rawDept)) {
                        $senderRole = ucwords(str_replace(['_', '-'], ' ', $rawDept));
                    } else {
                        $senderRole = 'Staff / Engineer';
                    }

                    if (!$isRequester && !$isAdmin) {
                        if (!$isAssigned) {
                            return response()->json(['message' => 'You are not assigned to this ticket.'], 403);
                        }
                        $allowDelegated = (bool)($messagingConfig['allow_delegated_employee'] ?? true);
                        if (!$allowDelegated) {
                            return response()->json([
                                'message' => 'Delegated employee messaging is disabled by system policy.'
                            ], 403);
                        }
                    }
                }
            }
        } elseif ($user instanceof \App\Models\Client) {
            if ($isInternalTicket) {
                return response()->json(['message' => 'Customers cannot access internal ticket threads.'], 403);
            }
            if (!empty($ticketRecord->created_by) && (int)$ticketRecord->created_by !== (int)$user->id) {
                return response()->json(['message' => 'You do not have access to this ticket thread.'], 403);
            }
            $senderId = $user->id;
            $senderName = $user->client_name ?? 'Customer';
            $senderType = 'customer';
            $senderRole = 'Customer';
        } else {
            if ($isInternalTicket) {
                return response()->json(['message' => 'Customers cannot access internal ticket threads.'], 403);
            }
            if (!empty($ticketRecord->created_by) && (int)$ticketRecord->created_by !== (int)$user->id) {
                return response()->json(['message' => 'You do not have access to this ticket thread.'], 403);
            }
            $senderId = $user->id;
            $senderName = $user->name ?? 'User';
            $senderType = 'customer';
            $senderRole = 'Customer';
        }

        // Process attachments: either proxy uploaded files to attachment-service or use verified payload
        $processedAttachments = [];

        if ($hasUploadFiles) {
            $files = $request->file('attachments');
            if (!is_array($files)) {
                $files = [$files];
            }

            try {
                $attachmentUrl = env('ATTACHMENT_SERVICE_URL', 'http://attachment-service:8000');
                $httpRequest = \Illuminate\Support\Facades\Http::timeout(30);

                if ($request->bearerToken()) {
                    $httpRequest = $httpRequest->withToken($request->bearerToken());
                }

                foreach ($files as $file) {
                    $httpRequest = $httpRequest->attach(
                        'attachments[]',
                        file_get_contents($file->getRealPath()),
                        $file->getClientOriginalName()
                    );
                }

                $uploadResponse = $httpRequest->post("{$attachmentUrl}/api/upload", [
                    'ticket_id' => (int)$ticket_id,
                ]);

                if ($uploadResponse->status() === 422) {
                    $errData = $uploadResponse->json();
                    return response()->json([
                        'message' => $errData['message'] ?? 'Attachment validation failed.',
                        'code' => !empty($errData['virus_detected']) ? 'MALWARE_DETECTED' : 'ATTACHMENT_VALIDATION_FAILED',
                        'errors' => $errData['errors'] ?? ['attachments' => [$errData['message'] ?? 'Validation failed']],
                        'quarantined' => $errData['quarantined'] ?? [],
                    ], 422);
                }

                if (!$uploadResponse->successful()) {
                    return response()->json([
                        'message' => 'Failed to process attachments: ' . ($uploadResponse->json('message') ?? 'Attachment service error'),
                        'code' => 'ATTACHMENT_SERVICE_ERROR',
                    ], 500);
                }

                $uploadData = $uploadResponse->json();
                $uploadedList = $uploadData['attachments'] ?? [];
                foreach ($uploadedList as $u) {
                    $processedAttachments[] = [
                        'id' => $u['id'] ?? null,
                        'name' => $u['name'] ?? 'attachment',
                        'url' => $u['url'] ?? '',
                        'file_path' => !empty($u['url']) ? ltrim(str_replace('/storage/', '', $u['url']), '/') : '',
                        'file_type' => $u['file_type'] ?? null,
                        'file_size' => $u['file_size'] ?? null,
                        'scan_status' => 'clean',
                    ];
                }
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::error('Error uploading message attachments: ' . $e->getMessage());
                return response()->json([
                    'message' => 'Attachment service is temporarily unavailable. Please try again.',
                    'code' => 'ATTACHMENT_SERVICE_UNAVAILABLE',
                    'error' => $e->getMessage(),
                ], 500);
            }
        } elseif ($hasJsonAttachments) {
            $rawAtts = $request->input('attachments');
            foreach ($rawAtts as $att) {
                if (is_array($att)) {
                    $scanStatus = $att['scan_status'] ?? (!empty($att['virus_detected']) ? 'quarantined' : 'clean');
                    $processedAttachments[] = [
                        'id' => $att['id'] ?? null,
                        'name' => $att['name'] ?? $att['file_name'] ?? 'attachment',
                        'url' => $att['url'] ?? '',
                        'file_path' => $att['file_path'] ?? '',
                        'file_type' => $att['file_type'] ?? null,
                        'file_size' => $att['file_size'] ?? $att['size'] ?? null,
                        'scan_status' => $scanStatus,
                    ];
                }
            }
        }

        // Create the message in MongoDB with sender_role snapshot, attachments, and accurate timestamp
        $message = Message::create([
            'ticket_id' => (int)$ticket_id,
            'sender_id' => $senderId,
            'sender_name' => $senderName,
            'sender_type' => $senderType,
            'sender_role' => $senderRole,
            'message' => $rawMessage ? trim($rawMessage) : '',
            'attachments' => $processedAttachments,
            'is_internal' => (bool)$isInternalTicket,
            'exclude_ai' => $isInternalTicket ? true : false,
        ]);

        // Broadcast to Reverb (port 6002) for real-time messaging
        broadcast(new MessageSent($message))->toOthers();

        // Create Notifications in MySQL & Broadcast TicketChanged on central Reverb
        try {
            $ticket = \Illuminate\Support\Facades\DB::connection('mysql')
                ->table('tickets')
                ->where('ticket_ID', (int)$ticket_id)
                ->first();

            if ($ticket) {
                if (($senderType === 'cs' || $senderType === 'employee') && !$ticket->first_response_at) {
                    $now = now();
                    $status = null;
                    if (!empty($ticket->response_due_at)) {
                        $dueAt = \Illuminate\Support\Carbon::parse($ticket->response_due_at);
                        $status = $now->lte($dueAt) ? 'MET' : 'BREACHED';
                    }
                    \Illuminate\Support\Facades\DB::connection('mysql')
                        ->table('tickets')
                        ->where('ticket_ID', (int)$ticket_id)
                        ->update([
                            'first_response_at' => $now,
                            'response_sla_status' => $status,
                            'updated_at' => $now,
                        ]);
                }

                $recipients = []; // array of ['id' => X, 'type' => 'client'|'employee']

                // 1. Thread participant: Requester
                if (!empty($ticket->is_internal) && !empty($ticket->requested_by)) {
                    $recipients[] = ['id' => (int)$ticket->requested_by, 'type' => 'employee'];
                } elseif (!empty($ticket->created_by)) {
                    $recipients[] = ['id' => (int)$ticket->created_by, 'type' => 'client'];
                }

                // 2. Thread participant: Currently Assigned Employee(s) from MySQL at send-time
                $assignedEmpIds = [];
                if (!empty($ticket->assigned_to)) {
                    $assignedEmpIds[] = (int)$ticket->assigned_to;
                }
                $dbAssigned = \Illuminate\Support\Facades\DB::connection('mysql')
                    ->table('ticket_assignments')
                    ->where('ticket_ID', (int)$ticket_id)
                    ->pluck('employee_ID')
                    ->map(fn($id) => (int)$id)
                    ->all();
                $assignedEmpIds = array_unique(array_merge($assignedEmpIds, $dbAssigned));

                foreach ($assignedEmpIds as $empId) {
                    $recipients[] = ['id' => (int)$empId, 'type' => 'employee'];
                }

                // 3. Thread participants: Historical staff message authors from MongoDB for this ticket
                try {
                    $historicalStaffSenders = Message::where('ticket_id', (int)$ticket_id)
                        ->whereIn('sender_type', ['cs', 'employee'])
                        ->whereNotNull('sender_id')
                        ->get(['sender_id', 'sender_type']);

                    foreach ($historicalStaffSenders as $hSender) {
                        $hId = (int)$hSender->sender_id;
                        if ($hId > 0) {
                            $recipients[] = ['id' => $hId, 'type' => 'employee'];
                        }
                    }
                } catch (\Throwable $thSenders) {
                    \Illuminate\Support\Facades\Log::warning("Could not fetch historical message senders: " . $thSenders->getMessage());
                }

                // 4. Configurable routing tokens from ticket_configurations
                $routingTokens = ['contextual_assigned'];
                try {
                    $routingRow = \Illuminate\Support\Facades\DB::connection('mysql')
                        ->table('ticket_configurations')
                        ->where('key', 'routing')
                        ->value('value');
                    if ($routingRow) {
                        $parsed = is_string($routingRow) ? json_decode($routingRow, true) : $routingRow;
                        if (is_array($parsed) && !empty($parsed['new_message'])) {
                            $routingTokens = $parsed['new_message'];
                        }
                    }
                } catch (\Throwable $e) {}

                foreach ($routingTokens as $token) {
                    if ($token === 'contextual_assigned') {
                        if ($senderType === 'customer' && empty($assignedEmpIds)) {
                            // Fallback to CS if no employee assigned so customer message is never lost
                            $csIds = \Illuminate\Support\Facades\DB::connection('mysql')
                                ->table('employees')
                                ->whereRaw('LOWER(role) IN (?, ?, ?, ?, ?)', ['customer service', 'cs', 'customer support', 'head of cs', 'head of customer service'])
                                ->pluck('emp_id')
                                ->map(fn($id) => (int)$id)
                                ->all();
                            foreach ($csIds as $empId) {
                                $recipients[] = ['id' => $empId, 'type' => 'employee'];
                            }
                        }
                    } elseif ($token === 'contextual_requester') {
                        if ($ticket->is_internal) {
                            $recipients[] = ['id' => (int)$ticket->requested_by, 'type' => 'employee'];
                        } else {
                            $recipients[] = ['id' => (int)$ticket->created_by, 'type' => 'client'];
                        }
                    } elseif ($token === 'role_cs') {
                        $csIds = \Illuminate\Support\Facades\DB::connection('mysql')
                            ->table('employees')
                            ->whereRaw('LOWER(role) IN (?, ?, ?, ?, ?)', ['customer service', 'cs', 'customer support', 'head of cs', 'head of customer service'])
                            ->pluck('emp_id')
                            ->map(fn($id) => (int)$id)
                            ->all();
                        foreach ($csIds as $empId) {
                            $recipients[] = ['id' => $empId, 'type' => 'employee'];
                        }
                    } elseif ($token === 'role_service') {
                        $svcIds = \Illuminate\Support\Facades\DB::connection('mysql')
                            ->table('employees')
                            ->whereIn('role', ['service', 'service engineer', 'technician'])
                            ->pluck('emp_id')
                            ->map(fn($id) => (int)$id)
                            ->all();
                        foreach ($svcIds as $empId) {
                            $recipients[] = ['id' => $empId, 'type' => 'employee'];
                        }
                    } elseif ($token === 'role_it_admin') {
                        $itIds = \Illuminate\Support\Facades\DB::connection('mysql')
                            ->table('employees')
                            ->whereIn('role', ['it admin', 'it_admin', 'it administrator'])
                            ->pluck('emp_id')
                            ->map(fn($id) => (int)$id)
                            ->all();
                        foreach ($itIds as $empId) {
                            $recipients[] = ['id' => $empId, 'type' => 'employee'];
                        }
                    } elseif ($token === 'role_superadmin') {
                        $adminIds = \Illuminate\Support\Facades\DB::connection('mysql')
                            ->table('employees')
                            ->whereRaw('LOWER(REPLACE(role, " ", "")) = ?', ['superadmin'])
                            ->pluck('emp_id')
                            ->map(fn($id) => (int)$id)
                            ->all();
                        foreach ($adminIds as $empId) {
                            $recipients[] = ['id' => $empId, 'type' => 'employee'];
                        }
                    } elseif (str_starts_with($token, 'dept_')) {
                        $deptId = (int) substr($token, 5);
                        $deptEmpIds = \Illuminate\Support\Facades\DB::connection('mysql')
                            ->table('employees')
                            ->where('department_id', $deptId)
                            ->pluck('emp_id')
                            ->map(fn($id) => (int)$id)
                            ->all();
                        foreach ($deptEmpIds as $empId) {
                            $recipients[] = ['id' => $empId, 'type' => 'employee'];
                        }
                    }
                }

                // Fallback: If sender is employee/CS and no recipients resolved, always ensure customer/requester gets notified
                if ($senderType !== 'customer' && empty($recipients)) {
                    if ($ticket->is_internal) {
                        $recipients[] = ['id' => (int)$ticket->requested_by, 'type' => 'employee'];
                    } else {
                        $recipients[] = ['id' => (int)$ticket->created_by, 'type' => 'client'];
                    }
                }

                // Fallback: If sender is customer and no recipients resolved (unassigned ticket), notify CS
                if ($senderType === 'customer' && empty($recipients)) {
                    $csIds = \Illuminate\Support\Facades\DB::connection('mysql')
                        ->table('employees')
                        ->whereRaw('LOWER(role) IN (?, ?, ?, ?, ?)', ['customer service', 'cs', 'customer support', 'head of cs', 'head of customer service'])
                        ->pluck('emp_id')
                        ->map(fn($id) => (int)$id)
                        ->all();
                    foreach ($csIds as $empId) {
                        $recipients[] = ['id' => $empId, 'type' => 'employee'];
                    }
                }

                // 5. Filter out the sender and enforce strict scoping
                $scopedRecipients = [];
                foreach ($recipients as $r) {
                    $rId = (int)($r['id'] ?? 0);
                    $rType = $r['type'] ?? 'employee';

                    // Internal ticket scoping: Never leak to clients
                    if (!empty($ticket->is_internal) && $rType === 'client') {
                        continue;
                    }

                    // Exclude message sender
                    if ($senderType === 'customer' && $rType === 'client' && $rId === (int)$senderId) {
                        continue;
                    }
                    if ($senderType !== 'customer' && $rType === 'employee' && $rId === (int)$senderId) {
                        continue;
                    }

                    if ($rId > 0) {
                        $scopedRecipients[$rType . ':' . $rId] = ['id' => $rId, 'type' => $rType];
                    }
                }
                $recipients = array_values($scopedRecipients);

                // 6. Check system delivery channel configuration for 'new_message'
                $channel = 'both';
                try {
                    $chVal = \Illuminate\Support\Facades\DB::connection('mysql')
                        ->table('notification_channels')
                        ->where('alert_key', 'new_message')
                        ->value('channel');
                    if ($chVal && in_array($chVal, ['email', 'in_app', 'both'], true)) {
                        $channel = $chVal;
                    }
                } catch (\Throwable $e) {}

                // Build message preview and notification content
                $previewText = !empty(trim($message->message ?? ''))
                    ? \Illuminate\Support\Str::limit($message->message, 80)
                    : ('Sent an attachment' . (!empty($message->attachments) && count($message->attachments) > 1 ? ' (' . count($message->attachments) . ' files)' : ''));
                $notificationTitle = 'New Message on Ticket #' . $ticket_id;
                $notificationBody = $senderName . ': ' . $previewText;

                // 7. Deliver to each recipient, respecting preferences & live presence suppression
                foreach ($recipients as $recipient) {
                    $inAppAllowed = ($channel !== 'email');
                    $emailAllowed = ($channel !== 'in_app');

                    // Check client notification preferences from Redis / Cache
                    if ($recipient['type'] === 'client') {
                        try {
                            $clientPrefs = \Illuminate\Support\Facades\Cache::store('redis')->get("client:notification_preferences:{$recipient['id']}");
                        } catch (\Throwable $e) {
                            $clientPrefs = null;
                        }
                        if (!$clientPrefs) {
                            try {
                                $clientPrefs = \Illuminate\Support\Facades\Cache::get("client:notification_preferences:{$recipient['id']}");
                            } catch (\Throwable $e) {}
                        }
                        if (is_array($clientPrefs)) {
                            if (isset($clientPrefs['in_app']) && $clientPrefs['in_app'] === false) {
                                $inAppAllowed = false;
                            }
                            if (isset($clientPrefs['email']) && $clientPrefs['email'] === false) {
                                $emailAllowed = false;
                            }
                        }
                    }

                    // Check "already viewing live" thread presence in Redis
                    $isViewingLive = false;
                    if ($inAppAllowed) {
                        $presenceKeys = ($recipient['type'] === 'client')
                            ? ["ticket:presence:{$ticket_id}:customer:{$recipient['id']}", "ticket:presence:{$ticket_id}:client:{$recipient['id']}"]
                            : ["ticket:presence:{$ticket_id}:employee:{$recipient['id']}", "ticket:presence:{$ticket_id}:cs:{$recipient['id']}"];
                        foreach ($presenceKeys as $pkey) {
                            try {
                                if (\Illuminate\Support\Facades\Cache::store('redis')->has($pkey) || \Illuminate\Support\Facades\Cache::has($pkey)) {
                                    $isViewingLive = true;
                                    break;
                                }
                            } catch (\Throwable $e) {}
                        }
                    }

                    // Resolve deep link
                    if ($recipient['type'] === 'client') {
                        $deepLink = '/messages?selectedTicketId=' . $ticket_id;
                    } else {
                        $empRole = '';
                        try {
                            $empRow = \Illuminate\Support\Facades\DB::connection('mysql')
                                ->table('employees')
                                ->where('emp_id', $recipient['id'])
                                ->first();
                            $dept = strtolower($empRow->department ?? '');
                            $role = strtolower($empRow->role ?? '');
                            if (str_contains($dept, 'customer service') || str_contains($dept, 'support') || $dept === 'cs' || str_contains($role, 'cs')) {
                                $empRole = 'cs';
                            }
                        } catch (\Throwable $e) {}
                        $deepLink = ($empRole === 'cs')
                            ? ('/cs/messages?selectedTicketId=' . $ticket_id)
                            : ('/employee/messages?selectedTicketId=' . $ticket_id);
                    }

                    // Insert in-app notification if allowed and not suppressed by live presence
                    if ($inAppAllowed && !$isViewingLive) {
                        try {
                            \Illuminate\Support\Facades\DB::connection('mysql')
                                ->table('notifications')
                                ->insert([
                                    'recipient_id' => $recipient['id'],
                                    'recipient_type' => $recipient['type'],
                                    'title' => $notificationTitle,
                                    'message' => $notificationBody,
                                    'ticket_id' => (int)$ticket_id,
                                    'data' => json_encode([
                                        'type' => 'new_message',
                                        'ticket_id' => (int)$ticket_id,
                                        'ticketId' => (int)$ticket_id,
                                        'sender_id' => $senderId,
                                        'sender_name' => $senderName,
                                        'sender_type' => $senderType,
                                        'sender_role' => $senderRole,
                                        'message_preview' => $previewText,
                                        'link' => $deepLink,
                                    ]),
                                    'is_read' => false,
                                    'created_at' => now(),
                                    'updated_at' => now(),
                                ]);
                        } catch (\Throwable $insertErr) {
                            \Illuminate\Support\Facades\Log::warning("Failed to insert notification for recipient {$recipient['type']}:{$recipient['id']}: " . $insertErr->getMessage());
                        }
                    }

                    // Attempt transactional email delivery if enabled
                    if ($emailAllowed) {
                        try {
                            $recipientEmail = null;
                            if ($recipient['type'] === 'client') {
                                $recipientEmail = \Illuminate\Support\Facades\DB::connection('mysql')->table('clients')->where('id', $recipient['id'])->value('email');
                            } else {
                                $recipientEmail = \Illuminate\Support\Facades\DB::connection('mysql')->table('employees')->where('emp_id', $recipient['id'])->value('email');
                            }

                            if ($recipientEmail) {
                                $configServiceUrl = env('CONFIGURATION_SERVICE_URL', 'http://configuration-service:8000');
                                \Illuminate\Support\Facades\Http::timeout(5)->withHeaders(['X-Internal-Token' => (string) env('INTERNAL_TOKEN', '')])->retry(2, 100)->post("{$configServiceUrl}/api/email/dispatch", [
                                    'to' => $recipientEmail,
                                    'subject' => $notificationTitle,
                                    'html' => "<p><strong>{$senderName}</strong> ({$senderRole}) posted a new message on ticket #{$ticket_id}:</p><blockquote>" . e($previewText) . "</blockquote><p><a href=\"" . url($deepLink) . "\">View ticket conversation</a></p>",
                                    'alert_key' => 'new_message',
                                    'event_key' => 'new_message',
                                ]);
                            }
                        } catch (\Throwable $mailEx) {
                            \Illuminate\Support\Facades\Log::warning("Email notification dispatch for recipient {$recipient['type']}:{$recipient['id']} failed: " . $mailEx->getMessage());
                        }
                    }
                }

                // Broadcast TicketChanged event to update frontend headers (port 6001) in real-time
                event(new \App\Events\TicketChanged([
                    'action' => 'message_sent',
                    'ticket_ID' => (int)$ticket_id,
                    'ticketId' => (int)$ticket_id,
                    'updated_at' => now()->toISOString(),
                    'customer_id' => $ticket->created_by,
                    'assigned_to' => $ticket->assigned_to,
                    'ticket_status_ID' => $ticket->ticket_status_ID,
                ]));
            }
        } catch (\Exception $ex) {
            \Illuminate\Support\Facades\Log::error('Error creating notification for message: ' . $ex->getMessage());
        }

        return response()->json([
            'message' => 'Message sent successfully',
            'data' => $message
        ], 201);
    }

    /**
     * Update a message (edit) and broadcast it.
     */
    public function update(Request $request, $ticket_id, $message_id)
    {
        $user = Auth::user();
        // Spec 0034: identity comes only from the verified token, never from headers or body ids.

        if (!$user) {
            return response()->json([
                'message' => 'Unauthorized.',
                'code' => 'UNAUTHORIZED',
            ], 401);
        }

        // Enforce non-empty content validation (consistent with new messages)
        $rawMessage = $request->input('message');
        if (!is_string($rawMessage) || trim($rawMessage) === '') {
            return response()->json([
                'message' => 'Message content cannot be empty.',
                'code' => 'EMPTY_CONTENT',
                'errors' => [
                    'message' => ['The message field cannot be empty.']
                ]
            ], 422);
        }

        $newMessage = trim($rawMessage);
        if (mb_strlen($newMessage) > 5000) {
            return response()->json([
                'message' => 'Message exceeds maximum length of 5000 characters.',
                'code' => 'CONTENT_TOO_LONG',
                'errors' => [
                    'message' => ['The message must not exceed 5000 characters.']
                ]
            ], 422);
        }

        // Locate message in MongoDB (support both int and string ticket_id)
        $message = Message::whereIn('ticket_id', [(int)$ticket_id, (string)$ticket_id])->find($message_id);
        if (!$message) {
            return response()->json([
                'message' => 'Message not found.',
                'code' => 'NOT_FOUND',
            ], 404);
        }

        // Security check: Restricted strictly to the original sender
        $userKey = $this->resolveUserKey($user);
        $messageSenderKey = $message->sender_type . ':' . $message->sender_id;

        if ($userKey !== $messageSenderKey) {
            return response()->json([
                'message' => 'You cannot edit a message sent by someone else.',
                'code' => 'UNAUTHORIZED_SENDER',
            ], 403);
        }

        // Check ticket status for closed or archived state
        try {
            $ticketRecord = \Illuminate\Support\Facades\DB::connection('mysql')
                ->table('tickets')
                ->where('ticket_ID', (int)$ticket_id)
                ->first();

            if ($ticketRecord && (int)$ticketRecord->ticket_status_ID === 4) {
                return response()->json([
                    'message' => 'This conversation is archived because the ticket has been closed. Messages cannot be edited.',
                    'code' => 'CONVERSATION_ARCHIVED',
                ], 403);
            }
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Error checking ticket status in message update: ' . $e->getMessage());
        }

        // Enforce configured edit-time window
        $editWindowMinutes = (int) env('MESSAGE_EDIT_WINDOW_MINUTES', 15);
        try {
            $configRow = \Illuminate\Support\Facades\DB::connection('mysql')
                ->table('ticket_configurations')
                ->where('key', 'windows')
                ->value('value');
            if ($configRow) {
                $parsed = is_string($configRow) ? json_decode($configRow, true) : $configRow;
                if (is_array($parsed)) {
                    if (isset($parsed['messageEditWindowMinutes'])) {
                        $editWindowMinutes = (int)$parsed['messageEditWindowMinutes'];
                    } elseif (isset($parsed['message_edit_window_minutes'])) {
                        $editWindowMinutes = (int)$parsed['message_edit_window_minutes'];
                    }
                }
            }
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Error checking edit window config: ' . $e->getMessage());
        }

        if ($editWindowMinutes > 0 && !empty($message->created_at)) {
            $createdAt = \Illuminate\Support\Carbon::parse($message->created_at);
            $expiresAt = $createdAt->copy()->addMinutes($editWindowMinutes);
            if (now()->greaterThan($expiresAt)) {
                return response()->json([
                    'message' => "The edit window for this message has expired. Messages can only be edited within {$editWindowMinutes} minutes of sending.",
                    'code' => 'EDIT_WINDOW_EXPIRED',
                    'edit_window_minutes' => $editWindowMinutes,
                    'sent_at' => $createdAt->toIso8601String(),
                    'expired_at' => $expiresAt->toIso8601String(),
                ], 422);
            }
        }

        $priorContent = $message->message;
        $editedAt = now()->toIso8601String();
        $editorName = $this->resolveUserName($user);

        // Store version in edit_history (never destructively overwrite prior versions)
        $history = $message->edit_history ?? [];
        $versionNumber = count($history) + 1;

        $history[] = [
            'version' => $versionNumber,
            'message' => $priorContent,
            'edited_at' => $editedAt,
            'edited_by' => $userKey,
            'editor_name' => $editorName,
        ];

        // Ensure original created_at timestamp is preserved unchanged for thread chronological ordering
        $originalCreatedAt = $message->created_at;

        $message->edit_history = $history;
        $message->message = $newMessage;
        $message->is_edited = true;
        $message->edited = true;
        $message->edited_at = $editedAt;
        $message->created_at = $originalCreatedAt;

        try {
            $message->save();
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('Failed to save edited message: ' . $e->getMessage());
            return response()->json([
                'message' => 'Failed to save message edit. Please try again.',
                'code' => 'SAVE_FAILED',
                'error' => $e->getMessage(),
            ], 500);
        }

        // Audit Logging (Log traceability & MySQL ticket_audit_logs)
        \Illuminate\Support\Facades\Log::info('Message edited for audit traceability', [
            'ticket_id' => (int)$ticket_id,
            'message_id' => (string)($message->id ?? $message->_id),
            'editor_key' => $userKey,
            'editor_name' => $editorName,
            'edited_at' => $editedAt,
            'prior_content' => $priorContent,
            'new_content' => $newMessage,
            'version' => $versionNumber,
        ]);

        try {
            $actorType = ($user instanceof \App\Models\Employee) ? 'employee' : 'client';
            $actionById = ($user instanceof \App\Models\Employee) ? (int)$user->emp_id : (int)$user->id;
            \Illuminate\Support\Facades\DB::connection('mysql')
                ->table('ticket_audit_logs')
                ->insert([
                    'ticket_ID' => (int)$ticket_id,
                    'action_type' => 'message_edit',
                    'action_by_ID' => $actionById,
                    'actor_type' => $actorType,
                    'details' => json_encode([
                        'message_id' => (string)($message->id ?? $message->_id),
                        'editor' => $editorName,
                        'editor_key' => $userKey,
                        'edited_at' => $editedAt,
                        'prior_content' => $priorContent,
                        'new_content' => $newMessage,
                        'version' => $versionNumber,
                    ]),
                    'created_at' => now(),
                ]);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Failed to record message_edit in ticket_audit_logs: ' . $e->getMessage());
        }

        // Broadcast to Reverb (port 6002) for real-time update to participants without triggering "new message" notifications
        broadcast(new MessageUpdated($message))->toOthers();

        return response()->json([
            'message' => 'Message updated successfully',
            'data' => $message,
        ]);
    }

    /**
     * Retrieve the edit history of a message.
     */
    public function history(Request $request, $ticket_id, $message_id)
    {
        $user = Auth::user();
        // Spec 0034: identity comes only from the verified token, never from headers or body ids.

        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $message = Message::whereIn('ticket_id', [(int)$ticket_id, (string)$ticket_id])->find($message_id);
        if (!$message) {
            return response()->json(['message' => 'Message not found'], 404);
        }

        $history = $message->edit_history ?? [];

        return response()->json([
            'message_id' => (string)($message->id ?? $message->_id),
            'ticket_id' => (int)$ticket_id,
            'original_sent_at' => $message->created_at ? \Illuminate\Support\Carbon::parse($message->created_at)->toIso8601String() : null,
            'is_edited' => (bool)($message->is_edited ?? $message->edited ?? (!empty($history))),
            'edited_at' => $message->edited_at ?? null,
            'current_content' => $message->message,
            'versions_count' => count($history) + 1,
            'edit_count' => count($history),
            'edit_history' => $history,
        ]);
    }

    /**
     * Delete a message for the current user ("delete for you").
     */
    public function destroy($ticket_id, $message_id)
    {
        $user = Auth::user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $message = Message::whereIn('ticket_id', [(int)$ticket_id, (string)$ticket_id])->find($message_id);
        if (!$message) {
            return response()->json(['message' => 'Message not found'], 404);
        }

        $userKey = $this->resolveUserKey($user);

        // Add user key to deleted_by array if not already present
        $deletedBy = $message->deleted_by ?? [];
        if (!in_array($userKey, $deletedBy)) {
            $deletedBy[] = $userKey;
            $message->deleted_by = $deletedBy;
            $message->save();
        }

        // Broadcast deletion event so other sessions/tabs of the same user hide it
        broadcast(new MessageDeleted($message->id, (int)$ticket_id, $userKey))->toOthers();

        return response()->json([
            'message' => 'Message deleted for you successfully'
        ]);
    }

    /**
     * Heartbeat ping to mark user presence on a ticket thread.
     */
    public function pingPresence(Request $request, $ticket_id)
    {
        $user = Auth::user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $userKey = $this->resolveUserKey($user);
        $redisKey = "ticket:presence:{$ticket_id}:{$userKey}";

        try {
            \Illuminate\Support\Facades\Cache::store('redis')->put($redisKey, now()->toISOString(), 30);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Cache::put($redisKey, now()->toISOString(), 30);
        }

        return response()->json([
            'status' => 'ok',
            'ticket_id' => (int)$ticket_id,
            'user_key' => $userKey,
            'expires_in' => 30,
        ]);
    }

    /**
     * Clear user presence when navigating away or unmounting.
     */
    public function clearPresence(Request $request, $ticket_id)
    {
        $user = Auth::user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $userKey = $this->resolveUserKey($user);
        $redisKey = "ticket:presence:{$ticket_id}:{$userKey}";

        try {
            \Illuminate\Support\Facades\Cache::store('redis')->forget($redisKey);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Cache::forget($redisKey);
        }

        return response()->json([
            'status' => 'cleared',
            'ticket_id' => (int)$ticket_id,
            'user_key' => $userKey,
        ]);
    }

    /**
     * Helper to resolve the unique identifier key for a user.
     */
    protected function resolveUserKey($user)
    {
        if ($user instanceof \App\Models\Employee) {
            $senderId = $user->emp_id;
            $dept = strtolower($user->department ?? '');
            $role = strtolower($user->role ?? '');
            if (str_contains($dept, 'customer service') || str_contains($dept, 'support') || $dept === 'cs' || str_contains($role, 'cs')) {
                $senderType = 'cs';
            } else {
                $senderType = 'employee';
            }
        } elseif ($user instanceof \Illuminate\Auth\GenericUser && isset($user->user_type)) {
            $senderId = $user->id;
            $senderType = $user->user_type;
        } else {
            $senderId = $user->id;
            $senderType = 'customer';
        }
        return $senderType . ':' . $senderId;
    }

    /**
     * Helper to resolve the display name for a user.
     */
    protected function resolveUserName($user)
    {
        if ($user instanceof \App\Models\Employee) {
            return trim(($user->first_name ?? '') . ' ' . ($user->last_name ?? ''));
        } elseif ($user instanceof \App\Models\Client) {
            return $user->client_name ?? 'Client';
        }
        return $user->name ?? 'User';
    }
}
