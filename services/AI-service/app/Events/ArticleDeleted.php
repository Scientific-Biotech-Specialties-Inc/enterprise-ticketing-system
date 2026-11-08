<?php

namespace App\Events;

use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Event published to the event bus when a knowledge article is permanently deleted.
 * Notifies the AI Service, vector index cache, and frontend that the article
 * and its embeddings have been permanently purged.
 */
class ArticleDeleted implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets;

    public function __construct(
        public readonly int $articleId,
        public readonly string $title,
        public readonly string $actor = 'Super Admin',
        public readonly ?string $occurredAt = null,
        public readonly ?string $category = null,
        public readonly ?array $details = null
    ) {
    }

    public function broadcastOn(): array
    {
        return [
            new Channel('knowledge-base'),
            new Channel('ai-support'),
        ];
    }

    public function broadcastAs(): string
    {
        return 'article.deleted';
    }

    public function broadcastWith(): array
    {
        return [
            'type' => 'knowledge_base',
            'action' => 'deleted',
            'article_id' => $this->articleId,
            'title' => $this->title,
            'category' => $this->category,
            'actor' => $this->actor,
            'details' => $this->details,
            'occurred_at' => $this->occurredAt ?? now()->toIso8601String(),
        ];
    }
}
