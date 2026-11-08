<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

class FeedbackQuestionsUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public string $category;
    public string $action;
    public array $questions;

    /**
     * Create a new event instance.
     */
    public function __construct(string $category, string $action, array $questions = [])
    {
        $this->category  = $category;
        $this->action    = $action;
        $this->questions = $questions;
    }

    /**
     * Get the channels the event should broadcast on.
     *
     * @return array<int, \Illuminate\Broadcasting\Channel>
     */
    public function broadcastOn(): array
    {
        return [
            new Channel('feedback-config'),
            new Channel('feedback-config.' . strtolower($this->category)),
        ];
    }

    /**
     * The event's broadcast name.
     */
    public function broadcastAs(): string
    {
        return 'feedback.questions.updated';
    }

    /**
     * Get the data to broadcast.
     *
     * @return array<string, mixed>
     */
    public function broadcastWith(): array
    {
        return [
            'category'   => $this->category,
            'action'     => $this->action,
            'questions'  => $this->questions,
            'timestamp'  => now()->toIso8601String(),
        ];
    }
}
