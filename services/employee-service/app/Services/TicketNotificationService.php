<?php

namespace App\Services;

use App\Events\TicketChanged;
use App\Mail\TicketNotificationMail;
use App\Services\Mail\ConfigServiceMailer;
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
            $response = Http::timeout(6)->withHeaders(['X-Internal-Token' => (string) env('INTERNAL_TOKEN', '')])->post("{$configUrl}/api/email/dispatch-event", [
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
            Log::warning("Configuration-service template dispatch-event failed, trying direct dispatch then SMTP backup: {$e->getMessage()}");
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

        $ticketRef = 'TKT-' . str_pad((string) $ticketId, 4, '0', STR_PAD_LEFT);
        $ticketLink = url("/tickets/{$ticketId}");

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
            // Spec 0040: configuration-service (Brevo API) first, Brevo SMTP relay as backup.
            app(ConfigServiceMailer::class)->send($employee->email, new TicketNotificationMail(
                $subject,
                $message,
                $ticketRef,
                $ticketTitle,
                $category,
                $priority,
                $ticketLink
            ), $alertKey, ConfigServiceMailer::CATEGORY_NOTIFICATION);
        } catch (\Throwable $e) {
            Log::warning("Failed to send ticket email to employee {$empId}: {$e->getMessage()}");
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

        $ticketRef = 'TKT-' . str_pad((string) $ticketId, 4, '0', STR_PAD_LEFT);
        $ticketLink = url("/tickets/{$ticketId}");

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
            // Spec 0040: configuration-service (Brevo API) first, Brevo SMTP relay as backup.
            app(ConfigServiceMailer::class)->send($client->email, new TicketNotificationMail(
                $subject,
                $message,
                $ticketRef,
                $ticketTitle,
                $category,
                $priority,
                $ticketLink
            ), $alertKey, ConfigServiceMailer::CATEGORY_NOTIFICATION);
        } catch (\Throwable $e) {
            Log::warning("Failed to send customer email to client {$customerId}: {$e->getMessage()}");
        }
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

        try {
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
        } catch (\Throwable $e) {
            Log::warning("Failed to broadcast TicketChanged event: " . $e->getMessage());
        }
    }
}
