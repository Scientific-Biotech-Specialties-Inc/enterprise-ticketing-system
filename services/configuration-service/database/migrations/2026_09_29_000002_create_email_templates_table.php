<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Run the migrations.
     * Creates the email_templates table for storing configurable email event templates.
     */
    public function up(): void
    {
        Schema::create('email_templates', function (Blueprint $table) {
            $table->id();

            // The event key this template belongs to (e.g. 'ticket_created', 'ticket_resolved')
            $table->string('event_key')->unique();

            // Human-readable label for display
            $table->string('event_label');

            // Whether this template is enabled (can be disabled to suppress emails for this event)
            $table->boolean('is_enabled')->default(true);

            // Email subject line — supports {placeholders}
            $table->string('subject', 500);

            // HTML body — supports {placeholders}
            $table->longText('body');

            $table->timestamps();
            $table->index('event_key');
            $table->index('is_enabled');
        });

        // Seed default system templates
        $defaults = [
            [
                'event_key'   => 'ticket_created',
                'event_label' => 'Ticket Creation',
                'is_enabled'  => true,
                'subject'     => 'Your Ticket #{ticket_number} Has Been Created',
                'body'        => '<p>Dear {customer_name},</p><p>Your support ticket <strong>#{ticket_number}</strong> has been successfully created and is now in our queue.</p><p><strong>Subject:</strong> {ticket_subject}<br><strong>Priority:</strong> {ticket_priority}<br><strong>Status:</strong> {ticket_status}</p><p>Our team will review and respond shortly.</p><p>Best regards,<br>{from_name}</p>',
            ],
            [
                'event_key'   => 'ticket_assigned',
                'event_label' => 'Ticket Assigned',
                'is_enabled'  => true,
                'subject'     => 'Ticket #{ticket_number} Has Been Assigned to an Agent',
                'body'        => '<p>Dear {customer_name},</p><p>Your ticket <strong>#{ticket_number}</strong> has been assigned to one of our support agents who will be handling your request.</p><p><strong>Assigned Agent:</strong> {agent_name}<br><strong>Subject:</strong> {ticket_subject}</p><p>You will be notified of any updates.</p><p>Best regards,<br>{from_name}</p>',
            ],
            [
                'event_key'   => 'ticket_status_changed',
                'event_label' => 'Status Change',
                'is_enabled'  => true,
                'subject'     => 'Ticket #{ticket_number} Status Updated to {ticket_status}',
                'body'        => '<p>Dear {customer_name},</p><p>The status of your ticket <strong>#{ticket_number}</strong> has been updated.</p><p><strong>Previous Status:</strong> {previous_status}<br><strong>New Status:</strong> {ticket_status}<br><strong>Subject:</strong> {ticket_subject}</p><p>Please log in to the portal to view the full details.</p><p>Best regards,<br>{from_name}</p>',
            ],
            [
                'event_key'   => 'ticket_resolved',
                'event_label' => 'Ticket Resolved',
                'is_enabled'  => true,
                'subject'     => 'Ticket #{ticket_number} Has Been Resolved',
                'body'        => '<p>Dear {customer_name},</p><p>We are pleased to inform you that your ticket <strong>#{ticket_number}</strong> has been marked as resolved.</p><p><strong>Subject:</strong> {ticket_subject}<br><strong>Resolution Date:</strong> {resolved_at}</p><p>If you believe the issue is not fully resolved, you can reopen the ticket within 3 days from the portal.</p><p>Thank you for reaching out to us!</p><p>Best regards,<br>{from_name}</p>',
            ],
            [
                'event_key'   => 'ticket_closed',
                'event_label' => 'Ticket Closed',
                'is_enabled'  => true,
                'subject'     => 'Ticket #{ticket_number} Has Been Closed',
                'body'        => '<p>Dear {customer_name},</p><p>Your ticket <strong>#{ticket_number}</strong> has been closed.</p><p><strong>Subject:</strong> {ticket_subject}<br><strong>Closed At:</strong> {closed_at}</p><p>We hope your issue was resolved to your satisfaction. You may submit a new ticket at any time from your portal.</p><p>Best regards,<br>{from_name}</p>',
            ],
            [
                'event_key'   => 'ticket_escalated',
                'event_label' => 'Ticket Escalated',
                'is_enabled'  => true,
                'subject'     => 'Ticket #{ticket_number} Has Been Escalated',
                'body'        => '<p>Dear {customer_name},</p><p>Your ticket <strong>#{ticket_number}</strong> has been escalated to a senior support team due to its priority or complexity.</p><p><strong>Subject:</strong> {ticket_subject}<br><strong>Priority:</strong> {ticket_priority}</p><p>We are actively working to resolve your issue as quickly as possible.</p><p>Best regards,<br>{from_name}</p>',
            ],
            [
                'event_key'   => 'new_message',
                'event_label' => 'New Message',
                'is_enabled'  => true,
                'subject'     => 'New Message on Ticket #{ticket_number}',
                'body'        => '<p>Dear {customer_name},</p><p>A new message has been added to your support ticket <strong>#{ticket_number}</strong>.</p><p><strong>From:</strong> {sender_name}<br><strong>Message:</strong> {message_preview}</p><p>Log in to the portal to view the full conversation and reply.</p><p>Best regards,<br>{from_name}</p>',
            ],
            [
                'event_key'   => 'sla_breach_warning',
                'event_label' => 'SLA Breach Warning',
                'is_enabled'  => true,
                'subject'     => 'SLA Warning: Ticket #{ticket_number} Approaching Deadline',
                'body'        => '<p>Dear {customer_name},</p><p>This is an automated notification that your ticket <strong>#{ticket_number}</strong> is approaching its SLA deadline.</p><p><strong>Subject:</strong> {ticket_subject}<br><strong>SLA Deadline:</strong> {sla_deadline}<br><strong>Priority:</strong> {ticket_priority}</p><p>Our team has been alerted and is working on your request.</p><p>Best regards,<br>{from_name}</p>',
            ],
        ];

        DB::table('email_templates')->insert(
            array_map(function ($t) {
                return array_merge($t, [
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }, $defaults)
        );
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('email_templates');
    }
};
