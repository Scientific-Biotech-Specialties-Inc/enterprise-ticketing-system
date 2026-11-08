<?php

namespace App\Events;

use App\Models\KbArticle;
use Illuminate\Broadcasting\Channel;
use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Event published to the event bus when an article is archived.
 * Notifies the AI Service and frontend that the article's embeddings
 * have been deactivated from the active RAG search index.
 */
class ArticleArchived implements ShouldBroadcastNow
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
        return 'article.archived';
    }

    public function broadcastWith(): array
    {
        return [
            'type' => 'knowledge_base',
            'action' => 'archived',
            'article_id' => $this->article->id,
            'title' => $this->article->title,
            'category' => $this->article->category,
            'status' => 'Archived',
            'actor' => $this->actor,
            'occurred_at' => $this->occurredAt ?? now()->toIso8601String(),
        ];
    }
}
