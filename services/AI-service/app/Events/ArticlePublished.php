<?php

namespace App\Events;

use App\Models\KbArticle;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Event published to the event bus when an article is published.
 * Notifies the AI Service and frontend that the article's embeddings
 * are now active in the RAG search index.
 */
class ArticlePublished implements ShouldBroadcastNow
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
        return 'article.published';
    }

    public function broadcastWith(): array
    {
        return [
            'type' => 'knowledge_base',
            'action' => 'published',
            'article_id' => $this->article->id,
            'title' => $this->article->title,
            'category' => $this->article->category,
            'status' => 'Published',
            'actor' => $this->actor,
            'occurred_at' => $this->occurredAt ?? now()->toIso8601String(),
        ];
    }
}
