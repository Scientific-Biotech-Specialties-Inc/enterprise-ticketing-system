<?php

namespace App\Http\Controllers;

use App\Models\EmailConfiguration;
use App\Models\EmailTemplate;
use App\Services\ResendService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class EmailTemplateController extends Controller
{
    protected ResendService $resendService;

    public function __construct(ResendService $resendService)
    {
        $this->resendService = $resendService;
    }

    /**
     * Helper to write template configuration audit logs to ticket_audit_logs.
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
            Log::warning("Failed to record template configuration audit log: " . $e->getMessage());
        }
    }
    /**
     * Returns all email templates with their current subject, body, and enabled state.
     */
    public function index()
    {
        $templates = EmailTemplate::orderBy('id')->get();

        return response()->json([
            'templates'    => $templates->map->toApiResponse()->values(),
            'placeholders' => EmailTemplate::availablePlaceholders(),
        ]);
    }

    /**
     * Returns a single template by event key.
     */
    public function show(string $eventKey)
    {
        $template = EmailTemplate::where('event_key', $eventKey)->firstOrFail();

        return response()->json([
            'template'     => $template->toApiResponse(),
            'placeholders' => EmailTemplate::availablePlaceholders(),
        ]);
    }

    /**
     * Updates the subject and body of a specific email template.
     */
    public function update(Request $request, string $eventKey)
    {
        $validated = $request->validate([
            'subject'    => 'required|string|max:500',
            'body'       => 'required|string',
            'is_enabled' => 'boolean',
        ], [
            'subject.required' => 'Email subject is required.',
            'body.required'    => 'Email body is required.',
        ]);

        $combined = ($validated['subject'] ?? '') . ' ' . ($validated['body'] ?? '');
        if (!preg_match('/\{\{[a-zA-Z0-9_]+\}\}/', $combined)) {
            return response()->json([
                'message' => 'Email template must contain at least one dynamic placeholder (e.g. {{ticket_number}}, {{customer_name}}). Removing all placeholders is not permitted.',
                'errors' => [
                    'body' => ['At least one dynamic placeholder is required.'],
                ],
            ], 422);
        }

        $template = EmailTemplate::where('event_key', $eventKey)->firstOrFail();

        $template->update([
            'subject'    => trim($validated['subject']),
            'body'       => $validated['body'],
            'is_enabled' => $validated['is_enabled'] ?? $template->is_enabled,
        ]);

        $this->logAudit(
            $request,
            'config_update',
            'Email Templates',
            $template->event_label,
            "Updated email template content and subject for '{$template->event_label}'"
        );

        return response()->json([
            'message'  => "Email template for \"{$template->event_label}\" updated successfully.",
            'template' => $template->fresh()->toApiResponse(),
        ]);
    }

    /**
     * Toggles the is_enabled flag for a specific email template.
     */
    public function toggle(Request $request, string $eventKey)
    {
        $validated = $request->validate([
            'is_enabled' => 'required|boolean',
        ]);

        $template = EmailTemplate::where('event_key', $eventKey)->firstOrFail();

        $template->update(['is_enabled' => $validated['is_enabled']]);

        $state = $validated['is_enabled'] ? 'enabled' : 'disabled';

        $this->logAudit(
            $request,
            'config_update',
            'Email Templates',
            $template->event_label,
            "Toggled email template '{$template->event_label}' to {$state}"
        );

        return response()->json([
            'message'  => "Email notifications for \"{$template->event_label}\" have been {$state}.",
            'template' => $template->fresh()->toApiResponse(),
        ]);
    }

    /**
     * Resets a template back to its factory default subject and body.
     */
    public function reset(Request $request, string $eventKey)
    {
        $defaults = [
            'ticket_created' => [
                'subject' => 'Your Ticket #{ticket_number} Has Been Created',
                'body'    => '<p>Dear {customer_name},</p><p>Your support ticket <strong>#{ticket_number}</strong> has been successfully created and is now in our queue.</p><p><strong>Subject:</strong> {ticket_subject}<br><strong>Priority:</strong> {ticket_priority}<br><strong>Status:</strong> {ticket_status}</p><p>Our team will review and respond shortly.</p><p>Best regards,<br>{from_name}</p>',
            ],
            'ticket_assigned' => [
                'subject' => 'Ticket #{ticket_number} Has Been Assigned to an Agent',
                'body'    => '<p>Dear {customer_name},</p><p>Your ticket <strong>#{ticket_number}</strong> has been assigned to one of our support agents who will be handling your request.</p><p><strong>Assigned Agent:</strong> {agent_name}<br><strong>Subject:</strong> {ticket_subject}</p><p>You will be notified of any updates.</p><p>Best regards,<br>{from_name}</p>',
            ],
            'ticket_status_changed' => [
                'subject' => 'Ticket #{ticket_number} Status Updated to {ticket_status}',
                'body'    => '<p>Dear {customer_name},</p><p>The status of your ticket <strong>#{ticket_number}</strong> has been updated.</p><p><strong>Previous Status:</strong> {previous_status}<br><strong>New Status:</strong> {ticket_status}<br><strong>Subject:</strong> {ticket_subject}</p><p>Please log in to the portal to view the full details.</p><p>Best regards,<br>{from_name}</p>',
            ],
            'ticket_resolved' => [
                'subject' => 'Ticket #{ticket_number} Has Been Resolved',
                'body'    => '<p>Dear {customer_name},</p><p>We are pleased to inform you that your ticket <strong>#{ticket_number}</strong> has been marked as resolved.</p><p><strong>Subject:</strong> {ticket_subject}<br><strong>Resolution Date:</strong> {resolved_at}</p><p>If you believe the issue is not fully resolved, you can reopen the ticket within 3 days from the portal.</p><p>Thank you for reaching out to us!</p><p>Best regards,<br>{from_name}</p>',
            ],
            'ticket_closed' => [
                'subject' => 'Ticket #{ticket_number} Has Been Closed',
                'body'    => '<p>Dear {customer_name},</p><p>Your ticket <strong>#{ticket_number}</strong> has been closed.</p><p><strong>Subject:</strong> {ticket_subject}<br><strong>Closed At:</strong> {closed_at}</p><p>We hope your issue was resolved to your satisfaction. You may submit a new ticket at any time from your portal.</p><p>Best regards,<br>{from_name}</p>',
            ],
            'ticket_escalated' => [
                'subject' => 'Ticket #{ticket_number} Has Been Escalated',
                'body'    => '<p>Dear {customer_name},</p><p>Your ticket <strong>#{ticket_number}</strong> has been escalated to a senior support team due to its priority or complexity.</p><p><strong>Subject:</strong> {ticket_subject}<br><strong>Priority:</strong> {ticket_priority}</p><p>We are actively working to resolve your issue as quickly as possible.</p><p>Best regards,<br>{from_name}</p>',
            ],
            'new_message' => [
                'subject' => 'New Message on Ticket #{ticket_number}',
                'body'    => '<p>Dear {customer_name},</p><p>A new message has been added to your support ticket <strong>#{ticket_number}</strong>.</p><p><strong>From:</strong> {sender_name}<br><strong>Message:</strong> {message_preview}</p><p>Log in to the portal to view the full conversation and reply.</p><p>Best regards,<br>{from_name}</p>',
            ],
            'sla_breach_warning' => [
                'subject' => 'SLA Warning: Ticket #{ticket_number} Approaching Deadline',
                'body'    => '<p>Dear {customer_name},</p><p>This is an automated notification that your ticket <strong>#{ticket_number}</strong> is approaching its SLA deadline.</p><p><strong>Subject:</strong> {ticket_subject}<br><strong>SLA Deadline:</strong> {sla_deadline}<br><strong>Priority:</strong> {ticket_priority}</p><p>Our team has been alerted and is working on your request.</p><p>Best regards,<br>{from_name}</p>',
            ],
        ];

        $template = EmailTemplate::where('event_key', $eventKey)->firstOrFail();

        if (!isset($defaults[$eventKey])) {
            return response()->json(['message' => 'No default template available for this event.'], 422);
        }

        $template->update($defaults[$eventKey]);

        $this->logAudit(
            $request,
            'config_update',
            'Email Templates',
            $template->event_label,
            "Reset email template '{$template->event_label}' to system defaults"
        );

        return response()->json([
            'message'  => "Email template for \"{$template->event_label}\" has been reset to system defaults.",
            'template' => $template->fresh()->toApiResponse(),
        ]);
    }

    /**
     * Dispatches a test preview email for a specific template to the superadmin/recipient.
     */
    public function sendTestTemplateEmail(Request $request, string $eventKey)
    {
        $validated = $request->validate([
            'recipientEmail' => 'required|email',
            'subject'        => 'nullable|string',
            'body'           => 'nullable|string',
        ]);

        $recipient = trim($validated['recipientEmail']);
        $template = EmailTemplate::where('event_key', $eventKey)->firstOrFail();

        $config = EmailConfiguration::where('is_active', true)->latest()->first();
        if (!$config || empty($config->api_key)) {
            return response()->json([
                'message' => 'Email delivery is not configured yet. Please configure your Resend credentials in the Email Delivery tab first.',
            ], 422);
        }

        $subject = !empty($validated['subject']) ? trim($validated['subject']) : $template->subject;
        $body = !empty($validated['body']) ? $validated['body'] : $template->body;

        // Sample placeholder replacements for realistic preview testing
        $sampleData = [
            '{customer_name}'    => 'Jane Doe (Sample Customer)',
            '{ticket_number}'    => 'TKT-2026-0042',
            '{ticket_subject}'   => 'Unable to connect to diagnostic ultrasound scanner',
            '{ticket_priority}'  => 'High',
            '{ticket_status}'    => 'In Progress',
            '{previous_status}'  => 'Open',
            '{agent_name}'       => 'Alex Smith (Service Engineer)',
            '{sender_name}'      => 'Sarah Lee (Support Team)',
            '{message_preview}'  => 'We have reviewed your request and assigned a certified technician to inspect the device on site.',
            '{resolved_at}'      => now()->format('M j, Y g:i A'),
            '{closed_at}'        => now()->format('M j, Y g:i A'),
            '{sla_deadline}'     => now()->addHours(4)->format('M j, Y g:i A'),
            '{from_name}'        => $config->from_name ?? 'SBSI Support',
        ];

        $renderedSubject = str_replace(array_keys($sampleData), array_values($sampleData), $subject);
        $renderedBody = str_replace(array_keys($sampleData), array_values($sampleData), $body);

        $htmlWrapper = '
            <div style="font-family: Arial, -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
                <div style="background-color: #252578; color: #ffffff; padding: 20px 24px;">
                    <h2 style="margin: 0; font-size: 18px; font-weight: 700; letter-spacing: -0.025em;">SBSI Enterprise Support Desk</h2>
                    <p style="margin: 4px 0 0 0; font-size: 12px; opacity: 0.85;">Sample Notification Preview: ' . htmlspecialchars($template->event_label) . '</p>
                </div>
                <div style="padding: 24px; color: #374151; font-size: 14px; line-height: 1.6;">
                    ' . $renderedBody . '
                </div>
                <div style="background-color: #f9fafb; border-top: 1px solid #e5e7eb; padding: 16px 24px; font-size: 12px; color: #6b7280;">
                    <div style="margin-bottom: 8px;">
                        <strong style="color: #374151;">Template:</strong> ' . htmlspecialchars($template->event_label) . ' (<code style="background: #e5e7eb; padding: 2px 4px; border-radius: 4px; font-family: monospace;">' . htmlspecialchars($template->event_key) . '</code>)<br/>
                        <strong style="color: #374151;">Sender:</strong> ' . htmlspecialchars($config->from_name ?? 'SBSI Support') . ' &lt;' . htmlspecialchars($config->from_email ?? 'support@sbs-med.com') . '&gt;<br/>
                        <strong style="color: #374151;">Recipient:</strong> ' . htmlspecialchars($recipient) . '
                    </div>
                    <p style="margin: 0; font-size: 11px; color: #9ca3af;">This is a test notification generated from the Super Admin Email Templates configuration dashboard.</p>
                </div>
            </div>
        ';

        $result = $this->resendService->sendRawEmail(
            $config->api_key,
            $config->from_name ?? 'SBSI Support',
            $config->from_email ?? 'support@sbs-med.com',
            $recipient,
            '[TEST PREVIEW] ' . $renderedSubject,
            $htmlWrapper
        );

        if (!$result['success']) {
            return response()->json([
                'message' => 'Failed to dispatch test template email through Resend.',
                'error'   => $result['error'],
            ], 422);
        }

        $this->logAudit(
            $request,
            'config_update',
            'Email Templates',
            $template->event_label,
            "Dispatched test preview email for template '{$template->event_label}' to {$recipient}"
        );

        return response()->json([
            'message'   => "Test email for \"{$template->event_label}\" successfully delivered to {$recipient}.",
            'resend_id' => $result['id'],
        ]);
    }
}
