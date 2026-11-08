<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class EmailTemplate extends Model
{
    use HasFactory;

    protected $table = 'email_templates';

    protected $fillable = [
        'event_key',
        'event_label',
        'is_enabled',
        'subject',
        'body',
    ];

    protected $casts = [
        'is_enabled' => 'boolean',
    ];

    /**
     * All known template placeholder tokens with human-readable descriptions.
     */
    public static function availablePlaceholders(): array
    {
        return [
            '{customer_name}'    => 'Full name of the ticket submitter',
            '{ticket_number}'    => 'Unique ticket reference number (e.g. TKT-0001)',
            '{ticket_subject}'   => 'Subject / title of the ticket',
            '{ticket_priority}'  => 'Priority level (e.g. Low, Medium, High, Critical)',
            '{ticket_status}'    => 'Current status label (e.g. Open, In Progress, Resolved)',
            '{previous_status}'  => 'Status label before the change (status change events)',
            '{agent_name}'       => 'Full name of the assigned agent',
            '{sender_name}'      => 'Full name of the message sender (message events)',
            '{message_preview}'  => 'First 200 characters of the latest message',
            '{resolved_at}'      => 'Formatted date/time when ticket was resolved',
            '{closed_at}'        => 'Formatted date/time when ticket was closed',
            '{sla_deadline}'     => 'Formatted SLA response deadline date/time',
            '{from_name}'        => 'Configured sender display name (from Email Delivery tab)',
        ];
    }

    /**
     * Safe response array for API consumption.
     */
    public function toApiResponse(): array
    {
        return [
            'id'          => $this->id,
            'event_key'   => $this->event_key,
            'event_label' => $this->event_label,
            'is_enabled'  => (bool) $this->is_enabled,
            'subject'     => $this->subject,
            'body'        => $this->body,
            'updated_at'  => $this->updated_at?->format('M j, Y g:i A'),
        ];
    }
}
