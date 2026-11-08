<?php

namespace App\Events;

use App\Models\Message;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class MessageUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public $message;

    /**
     * Create a new event instance.
     */
    public function __construct(Message $message)
    {
        $this->message = $message;
    }

    /**
     * Get the channels the event should broadcast on.
     *
     * @return array<int, \Illuminate\Broadcasting\Channel>
     */
    public function broadcastOn(): array
    {
        return [
            new PrivateChannel('ticket.' . $this->message->ticket_id),
        ];
    }

    /**
     * Get the data to broadcast.
     *
     * @return array<string, mixed>
     */
    public function broadcastWith(): array
    {
        return [
            'id' => (string)($this->message->id ?? $this->message->_id),
            '_id' => (string)($this->message->id ?? $this->message->_id),
            'ticket_id' => (int)$this->message->ticket_id,
            'message' => $this->message->message,
            'edit_history' => $this->message->edit_history ?? [],
            'is_edited' => (bool)($this->message->is_edited ?? true),
            'edited' => (bool)($this->message->edited ?? true),
            'edited_at' => $this->message->edited_at ?? now()->toIso8601String(),
            'created_at' => $this->message->created_at ? \Illuminate\Support\Carbon::parse($this->message->created_at)->toIso8601String() : null,
            'updated_at' => $this->message->updated_at ? \Illuminate\Support\Carbon::parse($this->message->updated_at)->toIso8601String() : now()->toIso8601String(),
        ];
    }
}
