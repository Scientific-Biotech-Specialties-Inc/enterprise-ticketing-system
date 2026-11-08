<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class TicketDefaultsUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public readonly array $previousDefaults,
        public readonly array $newDefaults,
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
        return 'ticket.defaults.updated';
    }

    public function broadcastWith(): array
    {
        return [
            'type' => 'config',
            'section' => 'defaults',
            'key' => 'defaults',
            'previous_defaults' => $this->previousDefaults,
            'new_defaults' => $this->newDefaults,
            'acting_user_id' => $this->actingUserId,
            'updated_at' => $this->updatedAt,
        ];
    }
}
