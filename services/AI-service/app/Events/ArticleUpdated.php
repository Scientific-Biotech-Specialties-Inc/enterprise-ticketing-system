<?php

namespace App\Events;

use App\Models\KbArticle;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Event published when an article's content or metadata is updated.
 * Triggers asynchronous re-indexing of the RAG knowledge base.
 */
class ArticleUpdated implements ShouldBroadcastNow
{
    use Dispatchable, InteractsWithSockets, SerializesModels;

    public function __construct(
        public readonly KbArticle $article,
        public readonly string $actor = 'Super Admin',
        public readonly ?string $occurredAt = null
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
        return 'article.updated';
    }

    public function broadcastWith(): array
    {
        return [
            'type' => 'knowledge_base',
            'action' => 'updated',
            'article_id' => $this->article->id,
            'title' => $this->article->title,
            'category' => $this->article->category,
            'status' => $this->article->status,
            'actor' => $this->actor,
            'occurred_at' => $this->occurredAt ?? now()->toIso8601String(),
        ];
    }
}
