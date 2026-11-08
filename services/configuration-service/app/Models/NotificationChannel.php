<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class NotificationChannel extends Model
{
    use HasFactory;

    protected $table = 'notification_channels';

    protected $fillable = [
        'alert_key',
        'title',
        'badge',
        'badge_color',
        'channel',
        'default_channel',
        'description',
        'is_system_alert',
    ];

    protected $casts = [
        'is_system_alert' => 'boolean',
    ];

    /**
     * Standardized API representation.
     */
    public function toApiResponse(): array
    {
        return [
            'id'              => $this->id,
            'key'             => $this->alert_key,
            'alert_key'       => $this->alert_key,
            'title'           => $this->title,
            'badge'           => $this->badge,
            'badgeColor'      => $this->badge_color,
            'badge_color'     => $this->badge_color,
            'channel'         => $this->channel,
            'defaultChannel'  => $this->default_channel,
            'default_channel' => $this->default_channel,
            'description'     => $this->description,
            'isSystemAlert'   => (bool) $this->is_system_alert,
            'is_system_alert' => (bool) $this->is_system_alert,
            'updatedAt'       => $this->updated_at?->toISOString(),
            'updated_at'       => $this->updated_at?->toISOString(),
        ];
    }
}
