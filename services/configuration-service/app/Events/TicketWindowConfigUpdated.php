<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class TicketWindowConfigUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public array $windowConfig;
    public ?int $actingUserId;

    /**
     * Create a new event instance.
     */
    public function __construct(array $windowConfig, ?int $actingUserId = null)
    {
        $this->windowConfig = $windowConfig;
        $this->actingUserId = $actingUserId;
    }

    /**
     * Get the channels the event should broadcast on.
     *
     * @return array<int, \Illuminate\Broadcasting\Channel>
     */
    public function broadcastOn(): array
    {
        return [
            new Channel('ticket-config'),
            new Channel('ticket-updates'),
        ];
    }

    /**
     * The event's broadcast name.
     */
    public function broadcastAs(): string
    {
        return 'ticket.window.config.updated';
    }

    /**
     * Get the data to broadcast.
     *
     * @return array<string, mixed>
     */
    public function broadcastWith(): array
    {
        return [
            'key' => 'windows',
            'value' => $this->windowConfig,
            'acting_user_id' => $this->actingUserId,
            'updated_at' => now()->toIso8601String(),
        ];
    }
}
