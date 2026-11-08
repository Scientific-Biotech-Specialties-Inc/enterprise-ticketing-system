<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class TicketLimitsUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public readonly array $previousConfig,
        public readonly array $newConfig,
        public readonly ?int $actingUserId,
        public readonly string $updatedAt
    ) {
    }

    public function broadcastOn(): array
    {
        return [
            new Channel('ticket-config'),
            new Channel('ticket-updates'),
        ];
    }

    public function broadcastAs(): string
    {
        return 'ticket.limit.config.updated';
    }

    public function broadcastWith(): array
    {
        return [
            'type' => 'config',
            'section' => 'limits',
            'key' => 'limits',
            'previous_value' => $this->previousConfig,
            'value' => $this->newConfig,
            'updated_at' => $this->updatedAt,
        ];
    }
}
