<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Published on the event bus whenever a branch-specific priority level
 * (and its SLA implication) is created, edited, or removed.
 */
class BranchPriorityChanged implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public const ACTION_CREATED = 'created';
    public const ACTION_UPDATED = 'updated';
    public const ACTION_REMOVED = 'removed';

    public function __construct(
        public readonly string $action,
        public readonly string $branchId,
        public readonly ?array $before,
        public readonly ?array $after,
        public readonly ?int $actingUserId,
        public readonly string $occurredAt
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
        return 'branch.priority.changed';
    }

    public function broadcastWith(): array
    {
        return [
            'type' => 'config',
            'section' => 'branch-priority',
            'action' => $this->action,
            'branch_id' => $this->branchId,
            'before' => $this->before,
            'after' => $this->after,
            'acting_user_id' => $this->actingUserId,
            'occurred_at' => $this->occurredAt,
        ];
    }
}
