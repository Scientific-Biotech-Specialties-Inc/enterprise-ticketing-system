<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class TicketNumberFormatUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public readonly array $previousFormat,
        public readonly array $newFormat,
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
        return 'ticket.number_format.updated';
    }

    public function broadcastWith(): array
    {
        return [
            'type' => 'config',
            'section' => 'number_format',
            'previous_format' => $this->previousFormat,
            'new_format' => $this->newFormat,
            'updated_at' => $this->updatedAt,
        ];
    }
}
