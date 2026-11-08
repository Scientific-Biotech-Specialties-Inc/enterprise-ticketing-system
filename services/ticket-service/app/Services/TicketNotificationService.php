<?php

namespace App\Services;

use App\Events\TicketChanged;
use App\Mail\TicketNotificationMail;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

class TicketNotificationService
{
    /**
     * Get user ID and user type (client or employee) from the incoming request.
     */
    public function getRecipientInfo(Request $request): array
    {
        $user = $request->user();
        if (!$user) {
            return [null, null];
        }
        if ($user instanceof \App\Models\Client) {
            return [$user->id, 'client'];
        }
        return [$user->emp_id, 'employee'];
    }

    /**
     * Maps subject/title to an alert type key for channel lookup.
     */
    public function inferAlertKey(string $text): string
    {
        $normalized = strtolower($text);
        if (str_contains($normalized, 'reassign')) return 'reassignment';
        if (str_contains($normalized, 'escalat') || str_contains($normalized, 'delegat') || str_contains($normalized, 'assign')) return 'escalation_delegation';
        if (
            str_contains($normalized, 'status') ||
            str_contains($normalized, 'resolv') ||
            str_contains($normalized, 'close') ||
            str_contains($normalized, 'reopen') ||
            str_contains($normalized, 'reject') ||
            str_contains($normalized, 'approv') ||
            str_contains($normalized, 'complet') ||
            str_contains($normalized, 'proof')
        ) return 'status_update';
        if (str_contains($normalized, 'message') || str_contains($normalized, 'chat')) return 'new_message';
        if (str_contains($normalized, 'overdue') || str_contains($normalized, 'breach') || str_contains($normalized, 'sla')) return 'overdue_sla_breach';
        if (str_contains($normalized, 'system') || str_contains($normalized, 'critical')) return 'system_alert';
        if (str_contains($normalized, 'creat') || str_contains($normalized, 'new')) return 'new_ticket';
        return 'new_ticket';
    }

    /**
     * Maps email template event key to delivery channel alert key.
     */
    public function mapEventKeyToAlertKey(?string $eventKey): ?string
    {
        if (!$eventKey) return null;
        return match ($eventKey) {
            'ticket_created' => 'new_ticket',
            'ticket_assigned', 'ticket_escalated' => 'escalation_delegation',
            'ticket_status_changed', 'ticket_resolved', 'ticket_closed' => 'status_update',
            'new_message' => 'new_message',
            'sla_breach_warning', 'overdue_sla_breach' => 'overdue_sla_breach',
            'reassignment' => 'reassignment',
            'system_alert' => 'system_alert',
            default => null,
        };
    }

    /**
     * Looks up the configured delivery channel ('email', 'in_app', 'both') for an alert key.
     */
    public function getDeliveryChannel(?string $alertKey): string
    {
        if (!$alertKey) {
            return 'both';
        }

        try {
            $channel = DB::table('notification_channels')->where('alert_key', $alertKey)->value('channel');
            if ($channel && in_array($channel, ['email', 'in_app', 'both'], true)) {
                return $channel;
            }
        } catch (\Throwable $e) {
            // Default to 'both' if table is unavailable
        }

        return 'both';
    }

    /**
     * Persist an in-app notification in the database.
     * Respects the configured delivery channel; skips insertion if channel is 'email' only.
     */
    public function notifyRecipient(
        int $recipientId,
        string $recipientType,
        string $title,
        string $message,
        ?int $ticketId = null,
        ?array $data = null,
        ?string $alertKey = null
    ): void {
        $key = $alertKey ?? $this->inferAlertKey($title);
        $channel = $this->getDeliveryChannel($key);

        // If configured as 'email' only, skip in-app notification insertion
        if ($channel === 'email') {
            Log::info("In-app notification for alert [{$key}] skipped due to 'email only' delivery channel setting.");
            return;
        }

        // TS005: If recipient is a client, verify that in-app alerts are enabled in customer preferences
        if ($recipientType === 'client') {
            try {
                $clientPrefs = \Illuminate\Support\Facades\Cache::store('redis')->get("client:notification_preferences:{$recipientId}");
            } catch (\Throwable $e) {
                $clientPrefs = null;
            }
            if (!$clientPrefs) {
                $clientPrefs = \Illuminate\Support\Facades\Cache::get("client:notification_preferences:{$recipientId}");
            }
            if ($clientPrefs && isset($clientPrefs['in_app']) && $clientPrefs['in_app'] === false) {
                Log::info("In-app notification for client [{$recipientId}] skipped due to customer preferences.");
                return;
            }
        }

        // Check employee notification preferences if recipient is an employee
        if ($recipientType === 'employee') {
            try {
                $empPrefs = \Illuminate\Support\Facades\Cache::store('redis')->get("employee:notification_preferences:{$recipientId}");
            } catch (\Throwable $e) {
                $empPrefs = null;
            }
            if (!$empPrefs) {
                $empPrefs = \Illuminate\Support\Facades\Cache::get("employee:notification_preferences:{$recipientId}");
            }
            if ($empPrefs && isset($empPrefs['in_app']) && $empPrefs['in_app'] === false) {
                Log::info("In-app notification for employee [{$recipientId}] skipped due to employee preferences.");
                return;
            }
        }

        DB::table('notifications')->insert([
            'recipient_id'   => $recipientId,
            'recipient_type' => $recipientType,
            'title'          => $title,
            'message'        => $message,
            'ticket_id'      => $ticketId,
            'data'           => $data ? json_encode($data) : null,
            'is_read'        => false,
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);
    }

    /**
     * Resolves concrete recipients for a given alert event at send time.
     * Evaluates active routing configuration from TicketConfigurationService (cached in Redis).
     *
     * HARD-CODED INVARIANT: system_alert is explicitly locked to Super Admin
     * and will NEVER route to other roles or configurable scopes.
     */
    public function resolveRecipientsForAlert(string $alertKey, ?int $ticketId = null, array $context = []): array
    {
        // 1. HARD-CODED DISPATCH: system_alert ALWAYS and ONLY routes to Super Admin
        if ($alertKey === 'system_alert') {
            $superAdminIds = DB::table('employees')
                ->whereRaw('LOWER(REPLACE(role, " ", "")) = ?', ['superadmin'])
                ->pluck('emp_id')
                ->all();

            return array_map(fn($id) => ['id' => (int) $id, 'type' => 'employee'], $superAdminIds);
        }

        // 2. Fetch routing configuration from configuration-service / Redis
        $routing = TicketConfigurationService::getRoutingConfig();
        $tokens = $routing[$alertKey] ?? (TicketConfigurationService::DEFAULT_ROUTING[$alertKey] ?? ['role_cs']);

        $recipients = [];
        $excludeUserId = $context['exclude_user_id'] ?? null;
        $excludeUserType = $context['exclude_user_type'] ?? 'employee';

        $ticket = null;
        if ($ticketId) {
            $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        }

        foreach ($tokens as $token) {
            // Dynamic Contextual: Assigned Employee(s)
            if ($token === 'contextual_assigned' && $ticketId) {
                $assignedIds = DB::table('ticket_assignments')
                    ->where('ticket_ID', $ticketId)
                    ->pluck('employee_ID')
                    ->map(fn($id) => (int) $id)
                    ->all();

                if (!empty($ticket?->assigned_to)) {
                    $assignedIds[] = (int) $ticket->assigned_to;
                }

                foreach (array_unique($assignedIds) as $empId) {
                    if ($excludeUserId && $excludeUserType === 'employee' && (int) $empId === (int) $excludeUserId) {
                        continue;
                    }
                    $recipients[] = ['id' => (int) $empId, 'type' => 'employee'];
                }
            }

            // Dynamic Contextual: Requester / Creator
            elseif ($token === 'contextual_requester' && $ticket) {
                if (!empty($ticket->is_internal) && !empty($ticket->requested_by)) {
                    $reqId = (int) $ticket->requested_by;
                    if (!($excludeUserId && $excludeUserType === 'employee' && $reqId === (int) $excludeUserId)) {
                        $recipients[] = ['id' => $reqId, 'type' => 'employee'];
                    }
                } elseif (!empty($ticket->created_by)) {
                    $cId = (int) $ticket->created_by;
                    if (!($excludeUserId && $excludeUserType === 'client' && $cId === (int) $excludeUserId)) {
                        $recipients[] = ['id' => $cId, 'type' => 'client'];
                    }
                }
            }

            // Static Role: Customer Service
            elseif ($token === 'role_cs') {
                $csIds = DB::table('employees')
                    ->whereRaw('LOWER(role) IN (?, ?, ?, ?, ?)', ['customer service', 'cs', 'customer support', 'head of cs', 'head of customer service'])
                    ->pluck('emp_id')
                    ->all();

                foreach ($csIds as $empId) {
                    if ($excludeUserId && $excludeUserType === 'employee' && (int) $empId === (int) $excludeUserId) {
                        continue;
                    }
                    $recipients[] = ['id' => (int) $empId, 'type' => 'employee'];
                }
            }

            // Static Role: Service Engineers / Technicians
            elseif ($token === 'role_service') {
                $serviceIds = DB::table('employees')
                    ->whereRaw('LOWER(role) IN (?, ?, ?)', ['service', 'service engineer', 'technician'])
                    ->pluck('emp_id')
                    ->all();

                foreach ($serviceIds as $empId) {
                    if ($excludeUserId && $excludeUserType === 'employee' && (int) $empId === (int) $excludeUserId) {
                        continue;
                    }
                    $recipients[] = ['id' => (int) $empId, 'type' => 'employee'];
                }
            }

            // Static Role: IT Admin
            elseif ($token === 'role_it_admin') {
                $itIds = DB::table('employees')
                    ->whereRaw('LOWER(role) IN (?, ?, ?)', ['it admin', 'it_admin', 'it administrator'])
                    ->pluck('emp_id')
                    ->all();

                foreach ($itIds as $empId) {
                    if ($excludeUserId && $excludeUserType === 'employee' && (int) $empId === (int) $excludeUserId) {
                        continue;
                    }
                    $recipients[] = ['id' => (int) $empId, 'type' => 'employee'];
                }
            }

            // Static Role: Super Admin
            elseif ($token === 'role_superadmin') {
                $adminIds = DB::table('employees')
                    ->whereRaw('LOWER(REPLACE(role, " ", "")) = ?', ['superadmin'])
                    ->pluck('emp_id')
                    ->all();

                foreach ($adminIds as $empId) {
                    if ($excludeUserId && $excludeUserType === 'employee' && (int) $empId === (int) $excludeUserId) {
                        continue;
                    }
                    $recipients[] = ['id' => (int) $empId, 'type' => 'employee'];
                }
            }

            // Dynamic Department: dept_{id}
            elseif (str_starts_with($token, 'dept_')) {
                $deptId = (int) substr($token, 5);
                $deptEmpIds = DB::table('employees')
                    ->where('department_id', $deptId)
                    ->pluck('emp_id')
                    ->all();

                foreach ($deptEmpIds as $empId) {
                    if ($excludeUserId && $excludeUserType === 'employee' && (int) $empId === (int) $excludeUserId) {
                        continue;
                    }
                    $recipients[] = ['id' => (int) $empId, 'type' => 'employee'];
                }
            }
        }

        // Deduplicate recipients by type + id
        $unique = [];
        foreach ($recipients as $r) {
            $key = $r['type'] . ':' . $r['id'];
            $unique[$key] = $r;
        }

        return array_values($unique);
    }

    /**
     * Dispatch alert notifications across configured channels to resolved recipients at send time.
     */
    public function dispatchAlert(
        string $alertKey,
        string $title,
        string $message,
        ?int $ticketId = null,
        array $data = [],
        array $context = []
    ): void {
        $recipients = $this->resolveRecipientsForAlert($alertKey, $ticketId, $context);

        // Fetch ticket details for email templates if ticketId is provided
        $ticketTitle = '';
        $categoryName = '';
        $priorityName = '';
        if ($ticketId) {
            $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
            if ($ticket) {
                $ticketTitle = $ticket->title ?? '';
                $categoryName = DB::table('problem_categories')->where('problem_category_ID', $ticket->problem_category_ID)->value('category_name') ?? '';
                $priorityName = DB::table('ticket_priorities')->where('priority_ID', $ticket->priority_ID ?? 1)->value('priority_name') ?? '';
            }
        }

        foreach ($recipients as $r) {
            // 1. In-app notification
            $this->notifyRecipient(
                $r['id'],
                $r['type'],
                $title,
                $message,
                $ticketId,
                $data,
                $alertKey
            );

            // 2. Email notification
            if ($ticketId) {
                if ($r['type'] === 'employee') {
                    $this->sendTicketEmail(
                        $r['id'],
                        $title,
                        $message,
                        $ticketId,
                        $ticketTitle,
                        $categoryName,
                        $priorityName,
                        $alertKey,
                        $data
                    );
                } else {
                    $this->sendCustomerEmail(
                        $r['id'],
                        $title,
                        $message,
                        $ticketId,
                        $ticketTitle,
                        $categoryName,
                        $priorityName,
                        $alertKey,
                        $data
                    );
                }
            }
        }
    }

    /**
     * Notify all customer service employees.
     */
    public function notifyCS(string $title, string $message, ?int $ticketId = null, ?array $data = null, ?int $excludeUserId = null, ?string $alertKey = null): void
    {
        $csUsers = DB::table('employees')
            ->where(function ($q) {
                $q->whereRaw('LOWER(role) IN (?, ?, ?, ?, ?, ?)', [
                    'customer service',
                    'cs',
                    'customer support',
                    'head of cs',
                    'head of customer service',
                    'cs_manager'
                ])
                ->orWhereRaw('LOWER(department) IN (?, ?)', [
                    'customer service',
                    'customer support'
                ]);
            })
            ->pluck('emp_id');

        foreach ($csUsers as $csEmpId) {
            if ($excludeUserId !== null && (int) $csEmpId === $excludeUserId) {
                continue;
            }
            $this->notifyRecipient((int)$csEmpId, 'employee', $title, $message, $ticketId, $data, $alertKey ?? 'reassignment');
        }
    }

    /**
     * Notify Super Administrators (for critical background failures or system alerts).
     */
    public function notifySuperAdmin(string $title, string $message, ?array $data = null): void
    {
        $admins = DB::table('employees')
            ->whereRaw('LOWER(role) IN (?, ?, ?, ?)', ['super admin', 'superadmin', 'admin', 'administrator'])
            ->pluck('emp_id');

        foreach ($admins as $empId) {
            $this->notifyRecipient((int) $empId, 'employee', $title, $message, null, $data, 'system_alert');
        }
    }

    /**
     * Notify customer (and requested_by employee if internal).
     */
    public function notifyCustomer(int $customerId, string $title, string $message, ?int $ticketId = null, ?array $data = null, ?string $alertKey = null): void
    {
        $this->notifyRecipient($customerId, 'client', $title, $message, $ticketId, $data, $alertKey);

        if ($ticketId) {
            $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first(['requested_by']);
            if ($ticket && $ticket->requested_by) {
                $this->notifyRecipient((int)$ticket->requested_by, 'employee', $title, $message, $ticketId, $data, $alertKey);
            }
        }
    }

    /**
     * Maps subject/action to an event template key.
     */
    protected function inferEventKey(string $subject): ?string
    {
        $normalized = strtolower($subject);
        if (str_contains($normalized, 'created')) return 'ticket_created';
        if (str_contains($normalized, 'assign')) return 'ticket_assigned';
        if (str_contains($normalized, 'status')) return 'ticket_status_changed';
        if (str_contains($normalized, 'resolved')) return 'ticket_resolved';
        if (str_contains($normalized, 'closed')) return 'ticket_closed';
        if (str_contains($normalized, 'escalat')) return 'ticket_escalated';
        if (str_contains($normalized, 'message')) return 'new_message';
        if (str_contains($normalized, 'sla')) return 'sla_breach_warning';
        return null;
    }

    /**
     * Dispatches a template-driven email via configuration-service.
     */
    public function dispatchTemplateEmail(string $recipientEmail, ?string $eventKey, array $data = []): bool
    {
        if (!$eventKey) {
            return false;
        }

        $alertKey = $this->mapEventKeyToAlertKey($eventKey);
        $channel = $this->getDeliveryChannel($alertKey);
        if ($channel === 'in_app') {
            Log::info("Template email dispatch [{$eventKey}] skipped due to 'in_app only' delivery channel setting.");
            return true;
        }

        try {
            $configUrl = env('CONFIGURATION_SERVICE_URL', 'http://configuration-service:8000');
            $response = Http::timeout(6)->post("{$configUrl}/api/email/dispatch-event", [
                'eventKey' => $eventKey,
                'to'       => $recipientEmail,
                'data'     => $data,
            ]);

            if ($response->successful()) {
                $status = $response->json('status');
                if ($status === 'success' || $status === 'skipped') {
                    Log::info("Event email [{$eventKey}] handled by configuration-service for {$recipientEmail} (status: {$status})");
                    return true;
                }
            }
        } catch (\Throwable $e) {
            Log::warning("Configuration-service template dispatch-event failed: {$e->getMessage()}");
        }

        return false;
    }

    /**
     * Dispatch email notification to an assigned employee.
     */
    public function sendTicketEmail(
        int $empId,
        string $subject,
        string $message,
        int $ticketId,
        string $ticketTitle,
        string $category,
        string $priority,
        ?string $eventKey = null,
        array $extraData = []
    ): void {
        $employee = DB::table('employees')->where('emp_id', $empId)->first();
        if (!$employee || !$employee->email) {
            return;
        }

        $alertKey = $this->mapEventKeyToAlertKey($eventKey) ?? $this->inferAlertKey($subject);
        $channel = $this->getDeliveryChannel($alertKey);

        // If configured as 'in_app' only, skip email dispatch
        if ($channel === 'in_app') {
            Log::info("Email notification for alert [{$alertKey}] skipped due to 'in_app only' delivery channel setting.");
            return;
        }

        // Check employee notification preferences
        try {
            $empPrefs = \Illuminate\Support\Facades\Cache::store('redis')->get("employee:notification_preferences:{$empId}");
        } catch (\Throwable $e) {
            $empPrefs = null;
        }
        if (!$empPrefs) {
            $empPrefs = \Illuminate\Support\Facades\Cache::get("employee:notification_preferences:{$empId}");
        }
        if ($empPrefs && isset($empPrefs['email']) && $empPrefs['email'] === false) {
            Log::info("Employee email notification for employee [{$empId}] skipped due to employee preferences.");
            return;
        }

        $savedNumber = DB::table('tickets')->where('ticket_ID', $ticketId)->value('ticket_number');
        $ticketRef = $savedNumber ?: ('TKT-' . str_pad((string) $ticketId, 4, '0', STR_PAD_LEFT));
        $employeeBaseUrl = env('EMPLOYEE_PORTAL_URL', env('EMPLOYEE_FRONTEND_URL', 'http://localhost:5006/ticketing'));
        $ticketLink = rtrim($employeeBaseUrl, '/') . "/machine";

        $inferredKey = $eventKey ?? $this->inferEventKey($subject);
        $templateDispatched = $this->dispatchTemplateEmail($employee->email, $inferredKey, array_merge([
            'customer_name'   => ($employee->first_name ?? '') . ' ' . ($employee->last_name ?? ''),
            'agent_name'      => ($employee->first_name ?? '') . ' ' . ($employee->last_name ?? ''),
            'ticket_number'   => $ticketRef,
            'ticket_subject'  => $ticketTitle,
            'ticket_priority' => $priority,
            'ticket_category' => $category,
            'ticket_link'     => $ticketLink,
            'message_preview' => $message,
        ], $extraData));

        if ($templateDispatched) {
            return;
        }

        try {
            $mailable = new TicketNotificationMail(
                $subject,
                $message,
                $ticketRef,
                $ticketTitle,
                $category,
                $priority,
                $ticketLink
            );
            $this->dispatchEmail($employee->email, $mailable, $alertKey);
        } catch (\Exception $e) {
            Log::warning("Failed to send ticket email to {$employee->email}: {$e->getMessage()}");
        }
    }

    /**
     * Dispatch email notification to a customer.
     */
    public function sendCustomerEmail(
        int $customerId,
        string $subject,
        string $message,
        int $ticketId,
        string $ticketTitle,
        string $category,
        string $priority,
        ?string $eventKey = null,
        array $extraData = []
    ): void {
        $client = DB::table('clients')->where('id', $customerId)->first();
        if (!$client || !$client->email) {
            return;
        }

        $alertKey = $this->mapEventKeyToAlertKey($eventKey) ?? $this->inferAlertKey($subject);
        $channel = $this->getDeliveryChannel($alertKey);

        // If configured as 'in_app' only, skip email dispatch
        if ($channel === 'in_app') {
            Log::info("Email notification for alert [{$alertKey}] skipped due to 'in_app only' delivery channel setting.");
            return;
        }

        // TS005: Verify customer has not disabled email notifications in preferences
        try {
            $clientPrefs = \Illuminate\Support\Facades\Cache::store('redis')->get("client:notification_preferences:{$customerId}");
        } catch (\Throwable $e) {
            $clientPrefs = null;
        }
        if (!$clientPrefs) {
            $clientPrefs = \Illuminate\Support\Facades\Cache::get("client:notification_preferences:{$customerId}");
        }
        if ($clientPrefs && isset($clientPrefs['email']) && $clientPrefs['email'] === false) {
            Log::info("Customer email notification for client [{$customerId}] skipped due to customer preferences.");
            return;
        }

        $savedNumber = DB::table('tickets')->where('ticket_ID', $ticketId)->value('ticket_number');
        $ticketRef = $savedNumber ?: ('TKT-' . str_pad((string) $ticketId, 4, '0', STR_PAD_LEFT));
        $customerBaseUrl = env('CUSTOMER_PORTAL_URL', env('CUSTOMER_FRONTEND_URL', 'http://localhost:5006'));
        $ticketLink = rtrim($customerBaseUrl, '/') . "/my-tickets?ticketId={$ticketId}";

        $inferredKey = $eventKey ?? $this->inferEventKey($subject);
        $templateDispatched = $this->dispatchTemplateEmail($client->email, $inferredKey, array_merge([
            'customer_name'   => $client->client_name ?? 'Valued Customer',
            'ticket_number'   => $ticketRef,
            'ticket_subject'  => $ticketTitle,
            'ticket_priority' => $priority,
            'ticket_category' => $category,
            'ticket_link'     => $ticketLink,
            'message_preview' => $message,
        ], $extraData));

        if ($templateDispatched) {
            return;
        }

        try {
            $mailable = new TicketNotificationMail(
                $subject,
                $message,
                $ticketRef,
                $ticketTitle,
                $category,
                $priority,
                $ticketLink
            );
            $this->dispatchEmail($client->email, $mailable, $alertKey);
        } catch (\Exception $e) {
            Log::warning("Failed to send customer email to {$client->email}: {$e->getMessage()}");
        }
    }

    /**
     * Dispatches email via configuration-service (Resend), falling back to SMTP.
     */
    protected function dispatchEmail(string $recipientEmail, TicketNotificationMail $mailable, ?string $alertKey = null): void
    {
        $key = $alertKey ?? $this->inferAlertKey($mailable->subject ?? '');
        $channel = $this->getDeliveryChannel($key);
        if ($channel === 'in_app') {
            Log::info("Ticket notification email [{$key}] skipped due to 'in_app only' delivery channel setting.");
            return;
        }

        try {
            $configUrl = env('CONFIGURATION_SERVICE_URL', 'http://configuration-service:8000');
            $response = Http::timeout(6)->retry(3, 100)->post("{$configUrl}/api/email/dispatch", [
                'to' => $recipientEmail,
                'subject' => $mailable->subject ?? 'Ticket Notification',
                'html' => $mailable->render(),
                'alert_key' => $key,
            ]);

            if ($response->successful()) {
                Log::info("Ticket notification email dispatched via Resend to {$recipientEmail}");
                return;
            }
        } catch (\Throwable $e) {
            Log::warning("Configuration service email dispatch failed, falling back to SMTP: {$e->getMessage()}");
        }

        Mail::to($recipientEmail)->send($mailable);
    }

    /**
     * Broadcast ticket lifecycle changes over Laravel Reverb WebSockets.
     */
    public function broadcastTicketChange(string $action, int $ticketId, array $payload = []): void
    {
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();

        $fullTicket = null;
        if ($ticketId > 0) {
            if (isset($payload['ticket'])) {
                $fullTicket = $payload['ticket'];
            } else {
                try {
                    $fullTicket = app(TicketService::class)->getFullTicketDetails($ticketId);
                } catch (\Throwable $e) {
                    $fullTicket = null;
                }
            }
        }

        $assignedEmpIds = [];
        if ($ticketId > 0) {
            $assignedEmpIds = DB::table('ticket_assignments')
                ->where('ticket_ID', $ticketId)
                ->pluck('employee_ID')
                ->map(fn($id) => (int)$id)
                ->all();
        }

        event(new TicketChanged(array_merge([
            'action' => $action,
            'ticket_ID' => $ticketId,
            'ticketId' => $ticketId,
            'updated_at' => now()->toISOString(),
            'customer_id' => $ticket?->created_by,
            'assigned_to' => $ticket?->assigned_to,
            'employee_ids' => $assignedEmpIds,
            'ticket_status_ID' => $ticket?->ticket_status_ID,
            'ticket' => $fullTicket,
        ], $payload)));
    }
}
