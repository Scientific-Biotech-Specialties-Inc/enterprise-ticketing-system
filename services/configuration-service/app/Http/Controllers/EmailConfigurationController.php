<?php

namespace App\Http\Controllers;

use App\Models\EmailConfiguration;
use App\Models\EmailTemplate;
use App\Services\ResendService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class EmailConfigurationController extends Controller
{
    protected ResendService $resendService;

    public function __construct(ResendService $resendService)
    {
        $this->resendService = $resendService;
    }

    /**
     * Helper to write configuration change audit logs to ticket_audit_logs.
     */
    protected function logAudit(Request $request, string $actionType, string $module, string $target, string $text): void
    {
        try {
            $userId = $request->user()?->emp_id ?? $request->user()?->id ?? 1;
            DB::table('ticket_audit_logs')->insert([
                'ticket_ID'    => null,
                'action_type'  => $actionType,
                'action_by_ID' => $userId,
                'actor_type'   => 'superadmin',
                'details'      => json_encode([
                    'module' => $module,
                    'target' => $target,
                    'text'   => $text,
                ]),
                'created_at'   => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning("Failed to record configuration audit log: " . $e->getMessage());
        }
    }

    /**
     * Issues an ephemeral RSA public key for frontend payload encryption.
     * Caches the matching private key in Redis with a 15-minute TTL.
     */
    public function getEncryptionKey()
    {
        $config = [
            'digest_alg' => 'sha256',
            'private_key_bits' => 2048,
            'private_key_type' => OPENSSL_KEYTYPE_RSA,
        ];

        $res = openssl_pkey_new($config);
        openssl_pkey_export($res, $privateKey);
        $keyDetails = openssl_pkey_get_details($res);
        $publicKey = $keyDetails['key'];

        $keyId = Str::uuid()->toString();

        Cache::put("rsa_key_{$keyId}", $privateKey, now()->addMinutes(15));

        return response()->json([
            'key_id' => $keyId,
            'public_key' => $publicKey,
        ]);
    }

    /**
     * Retrieves the current email delivery configuration.
     * Guaranteed zero plaintext exposure: API key is always returned as re_•••••••••.
     */
    public function getConfiguration()
    {
        $config = EmailConfiguration::where('is_active', true)->latest()->first();

        if (!$config) {
            return response()->json([
                'is_configured' => false,
                'data' => null,
            ]);
        }

        return response()->json([
            'is_configured' => true,
            'data' => $config->toMaskedResponse(),
        ]);
    }

    /**
     * Saves or replaces the Resend email delivery configuration.
     * Validates and pings the Resend API before persisting the encrypted key.
     */
    public function saveConfiguration(Request $request)
    {
        $validated = $request->validate([
            'apiKey' => 'required|string|min:8',
            'fromName' => 'required|string|max:255',
            'fromEmail' => 'required|email|max:255',
        ], [
            'apiKey.required' => 'API Key is required and cannot be empty.',
            'fromName.required' => 'From Name is required and cannot be empty.',
            'fromEmail.required' => 'From Email is required and cannot be empty.',
            'fromEmail.email' => 'Please provide a valid sender email address.',
        ]);

        $rawApiKey = trim($validated['apiKey']);

        // Live ping verification against Resend API
        $verifyResult = $this->resendService->verifyApiKey($rawApiKey);
        if (!$verifyResult['valid']) {
            return response()->json([
                'message' => 'Resend API Key verification failed.',
                'errors' => [
                    'apiKey' => $verifyResult['error'],
                ],
            ], 422);
        }

        // Deactivate previous active configurations
        EmailConfiguration::where('is_active', true)->update(['is_active' => false]);

        // Create new active configuration (api_key is encrypted automatically via Eloquent cast)
        $config = EmailConfiguration::create([
            'provider' => 'Resend',
            'api_key' => $rawApiKey,
            'from_name' => trim($validated['fromName']),
            'from_email' => trim($validated['fromEmail']),
            'is_active' => true,
            'last_tested_at' => null,
        ]);

        $this->logAudit(
            $request,
            'config_create',
            'Email Delivery',
            'Resend Gateway',
            "Configured Resend email delivery with sender '{$config->from_name} <{$config->from_email}>'"
        );

        return response()->json([
            'message' => 'Resend email delivery configuration saved successfully.',
            'data' => $config->toMaskedResponse(),
        ]);
    }

    /**
     * Updates only the API key for the active configuration.
     * Verifies key against Resend API before persisting.
     */
    public function updateApiKey(Request $request)
    {
        $validated = $request->validate([
            'apiKey' => 'required|string|min:8',
        ], [
            'apiKey.required' => 'API Key is required and cannot be empty.',
        ]);

        $rawApiKey = trim($validated['apiKey']);

        // Live ping verification
        $verifyResult = $this->resendService->verifyApiKey($rawApiKey);
        if (!$verifyResult['valid']) {
            return response()->json([
                'message' => 'Resend API Key verification failed.',
                'errors' => [
                    'apiKey' => $verifyResult['error'],
                ],
            ], 422);
        }

        $config = EmailConfiguration::where('is_active', true)->latest()->first();

        if (!$config) {
            return response()->json([
                'message' => 'No active email configuration found to update. Please add a configuration first.',
            ], 404);
        }

        $config->update([
            'api_key' => $rawApiKey,
        ]);

        $this->logAudit(
            $request,
            'config_update',
            'Email Delivery',
            'API Credentials',
            'Updated and re-encrypted Resend API secret key'
        );

        return response()->json([
            'message' => 'Resend API Key updated and verified successfully.',
            'data' => $config->toMaskedResponse(),
        ]);
    }

    /**
     * Updates sender identity details (from_name, from_email) for the active configuration.
     */
    public function updateConfiguration(Request $request)
    {
        $validated = $request->validate([
            'fromName' => 'required|string|max:255',
            'fromEmail' => 'required|email|max:255',
        ], [
            'fromName.required' => 'From Name is required and cannot be empty.',
            'fromEmail.required' => 'From Email is required and cannot be empty.',
            'fromEmail.email' => 'Please provide a valid sender email address.',
        ]);

        $config = EmailConfiguration::where('is_active', true)->latest()->first();

        if (!$config) {
            return response()->json([
                'message' => 'No active email configuration found to update.',
            ], 404);
        }

        $config->update([
            'from_name' => trim($validated['fromName']),
            'from_email' => trim($validated['fromEmail']),
        ]);

        $this->logAudit(
            $request,
            'config_update',
            'Email Delivery',
            'Sender Identity',
            "Updated email sender identity to '{$config->from_name} <{$config->from_email}>'"
        );

        return response()->json([
            'message' => 'Email delivery configuration updated successfully.',
            'data' => $config->toMaskedResponse(),
        ]);
    }

    /**
     * Removes the active email delivery configuration.
     */
    public function removeConfiguration(Request $request)
    {
        EmailConfiguration::where('is_active', true)->update(['is_active' => false]);

        $this->logAudit(
            $request,
            'config_delete',
            'Email Delivery',
            'Resend Gateway',
            'Removed active Resend transactional email delivery configuration'
        );

        return response()->json([
            'message' => 'Email delivery configuration has been removed successfully.',
        ]);
    }

    /**
     * Dispatches a test email via Resend to verify deliverability.
     */
    public function sendTestEmail(Request $request)
    {
        $validated = $request->validate([
            'recipientEmail' => 'required|email',
            'apiKey' => 'nullable|string',
            'fromName' => 'nullable|string',
            'fromEmail' => 'nullable|email',
        ]);

        $recipient = trim($validated['recipientEmail']);
        $config = EmailConfiguration::where('is_active', true)->latest()->first();

        $apiKey = !empty($validated['apiKey']) ? trim($validated['apiKey']) : $config?->api_key;
        $fromName = !empty($validated['fromName']) ? trim($validated['fromName']) : ($config?->from_name ?? 'SBSI Support');
        $fromEmail = !empty($validated['fromEmail']) ? trim($validated['fromEmail']) : ($config?->from_email ?? 'onboarding@resend.dev');

        if (empty($apiKey)) {
            return response()->json([
                'message' => 'No API Key available to test. Please provide a key or save a configuration first.',
            ], 422);
        }

        $result = $this->resendService->sendTestEmail($apiKey, $fromName, $fromEmail, $recipient);

        if (!$result['success']) {
            return response()->json([
                'message' => 'Failed to deliver test email via Resend.',
                'error' => $result['error'],
            ], 422);
        }

        if ($config) {
            $config->update(['last_tested_at' => now()]);
        }

        $this->logAudit(
            $request,
            'config_update',
            'Email Delivery',
            'Test Verification',
            "Dispatched delivery verification test email to {$recipient}"
        );

        return response()->json([
            'message' => "A test verification email from \"{$fromName}\" <{$fromEmail}> was successfully delivered to {$recipient} via Resend.",
            'resend_id' => $result['id'],
            'last_tested' => now()->format('M j, h:i A'),
        ]);
    }

    /**
     * Inter-service dispatch endpoint for other microservices (e.g. ticket-service)
     * to send transactional emails via Resend using the active configuration.
     */
    public function dispatchEmail(Request $request)
    {
        $validated = $request->validate([
            'to' => 'required|email',
            'subject' => 'required|string',
            'html' => 'required|string',
            'alert_key' => 'nullable|string',
            'event_key' => 'nullable|string',
        ]);

        // TS103 Check delivery channel configuration: if in_app only, skip email dispatch
        $alertKey = $request->input('alert_key')
            ?? $this->mapEventKeyToAlertKey($request->input('event_key'))
            ?? $this->inferAlertKey($validated['subject']);

        if ($alertKey) {
            $channel = DB::table('notification_channels')->where('alert_key', $alertKey)->value('channel');
            if ($channel === 'in_app') {
                return response()->json([
                    'status'  => 'skipped',
                    'message' => "Email notification skipped because delivery channel for \"{$alertKey}\" is set to in-app only.",
                ]);
            }
        }

        $config = EmailConfiguration::where('is_active', true)->latest()->first();

        if (!$config) {
            return response()->json([
                'message' => 'No active email delivery configuration found.',
            ], 404);
        }

        $result = $this->resendService->sendRawEmail(
            $config->api_key,
            $config->from_name,
            $config->from_email,
            $validated['to'],
            $validated['subject'],
            $validated['html']
        );

        if (!$result['success']) {
            return response()->json([
                'message' => 'Failed to dispatch email via Resend.',
                'error' => $result['error'],
            ], 502);
        }

        return response()->json([
            'message' => 'Email dispatched successfully via Resend.',
            'id' => $result['id'],
        ]);
    }

    /**
     * Dispatches a dynamic, template-driven transactional email for ticket lifecycle events.
     * Hydrates template placeholders with runtime ticket data at the moment of creation.
     */
    public function dispatchEventEmail(Request $request)
    {
        $validated = $request->validate([
            'eventKey' => 'required|string',
            'to'       => 'required|email',
            'data'     => 'nullable|array',
        ]);

        $eventKey = $validated['eventKey'];
        $to = trim($validated['to']);
        $data = $validated['data'] ?? [];

        // TS103 Check delivery channel configuration: if in_app only, skip email dispatch
        $alertKey = $this->mapEventKeyToAlertKey($eventKey);
        if ($alertKey) {
            $channel = DB::table('notification_channels')->where('alert_key', $alertKey)->value('channel');
            if ($channel === 'in_app') {
                return response()->json([
                    'status'  => 'skipped',
                    'message' => "Email notification for event \"{$eventKey}\" is skipped because delivery channel is set to in-app only.",
                ]);
            }
        }

        $template = EmailTemplate::where('event_key', $eventKey)->first();

        // If template doesn't exist or is disabled by SuperAdmin, cleanly skip dispatch
        if (!$template || !$template->is_enabled) {
            return response()->json([
                'status'  => 'skipped',
                'message' => "Email notification for event \"{$eventKey}\" is disabled or template not found.",
            ]);
        }

        $config = EmailConfiguration::where('is_active', true)->latest()->first();
        if (!$config || empty($config->api_key)) {
            return response()->json([
                'status'  => 'error',
                'message' => 'No active email delivery configuration found.',
            ], 422);
        }

        // Hydrate placeholders dynamically
        $placeholders = [
            '{customer_name}'    => $data['customer_name'] ?? 'Valued Customer',
            '{ticket_number}'    => $data['ticket_number'] ?? 'TKT-0000',
            '{ticket_subject}'   => $data['ticket_subject'] ?? 'Ticket Notification',
            '{ticket_priority}'  => $data['ticket_priority'] ?? 'Medium',
            '{ticket_status}'    => $data['ticket_status'] ?? 'Open',
            '{previous_status}'  => $data['previous_status'] ?? 'Open',
            '{agent_name}'       => $data['agent_name'] ?? 'Support Specialist',
            '{sender_name}'      => $data['sender_name'] ?? 'Support Team',
            '{message_preview}'  => $data['message_preview'] ?? '',
            '{resolved_at}'      => $data['resolved_at'] ?? now()->format('M j, Y g:i A'),
            '{closed_at}'        => $data['closed_at'] ?? now()->format('M j, Y g:i A'),
            '{sla_deadline}'     => $data['sla_deadline'] ?? '',
            '{from_name}'        => $config->from_name ?? 'SBSI Support',
        ];

        foreach ($data as $k => $v) {
            if (is_scalar($v) && !isset($placeholders['{' . $k . '}'])) {
                $placeholders['{' . $k . '}'] = (string) $v;
            }
        }

        $subject = str_replace(array_keys($placeholders), array_values($placeholders), $template->subject);
        $body = str_replace(array_keys($placeholders), array_values($placeholders), $template->body);

        $ticketLink = $data['ticket_link'] ?? $placeholders['{ticket_link}'] ?? null;
        if (!$ticketLink && (!empty($data['ticket_id']) || !empty($data['ticket_number']))) {
            $tNum = preg_replace('/\D/', '', (string) ($data['ticket_id'] ?? $data['ticket_number'] ?? ''));
            $customerUrl = env('CUSTOMER_PORTAL_URL', env('CUSTOMER_FRONTEND_URL', 'http://localhost:5006'));
            $ticketLink = rtrim($customerUrl, '/') . "/my-tickets?ticketId={$tNum}";
        }

        $ctaButtonHtml = '';
        if ($ticketLink) {
            $ctaButtonHtml = '
                <div style="margin-top: 28px; text-align: left;">
                    <a href="' . htmlspecialchars($ticketLink) . '" target="_blank" style="display: inline-block; background-color: #252578; color: #ffffff !important; text-decoration: none; padding: 12px 26px; border-radius: 8px; font-weight: 700; font-size: 14px; box-shadow: 0 2px 4px rgba(37,37,120,0.2);">View Ticket Details</a>
                </div>
            ';
        }

        $html = '
            <div style="font-family: Arial, -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
                <div style="background-color: #252578; color: #ffffff; padding: 24px 28px;">
                    <h2 style="margin: 0; font-size: 19px; font-weight: 700; color: #ffffff; letter-spacing: -0.025em;">SBSI Enterprise Support Desk</h2>
                    <p style="margin: 6px 0 0 0; font-size: 12px; color: #cbd5e1;">' . htmlspecialchars($subject) . '</p>
                </div>
                <div style="padding: 28px; color: #1e293b; font-size: 14px; line-height: 1.6;">
                    ' . $body . '
                    ' . $ctaButtonHtml . '
                </div>
                <div style="background-color: #f8f9fa; border-top: 1px solid #e2e8f0; padding: 18px 28px; font-size: 12px; color: #8d8b8f;">
                    <p style="margin: 0; font-size: 11px; color: #8d8b8f; line-height: 1.5;">This is an automated notification from SBSI Enterprise Ticketing System. Please do not reply directly to this email.</p>
                </div>
            </div>
        ';

        $result = $this->resendService->sendRawEmail(
            $config->api_key,
            $config->from_name,
            $config->from_email,
            $to,
            $subject,
            $html
        );

        if (!$result['success']) {
            return response()->json([
                'status'  => 'error',
                'message' => 'Failed to dispatch email via Resend.',
                'error'   => $result['error'],
            ], 502);
        }

        return response()->json([
            'status'  => 'success',
            'message' => "Email for \"{$template->event_label}\" dispatched successfully via Resend.",
            'id'      => $result['id'],
        ]);
    }

    /**
     * Map email event key to alert key in notification_channels.
     */
    protected function mapEventKeyToAlertKey(?string $eventKey): ?string
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
     * Infer alert key from subject text.
     */
    protected function inferAlertKey(string $text): string
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
}
