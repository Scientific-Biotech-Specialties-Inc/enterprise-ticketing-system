<?php

namespace App\Jobs;

use App\Models\KbArticle;
use App\Models\KbChunk;
use App\Models\KbEmbedding;
use App\Services\RagService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class IndexKbArticleJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $articleId;
    public string $action; // 'publish', 'update', 'archive', 'delete', 'add'
    public string $actor;
    public ?string $contentOverride;

    /**
     * The number of times the job may be attempted.
     */
    public int $tries = 3;

    /**
     * The number of seconds to wait before retrying the job.
     */
    public array $backoff = [5, 15, 60];

    /**
     * The maximum number of unhandled exceptions to allow before failing.
     */
    public int $maxExceptions = 3;

    /**
     * Create a new job instance.
     */
    public function __construct(int $articleId, string $action = 'update', string $actor = 'Super Admin', ?string $contentOverride = null)
    {
        $this->articleId = $articleId;
        $this->action = strtolower(trim($action));
        $this->actor = $actor;
        $this->contentOverride = $contentOverride;
        $this->onQueue('indexing');
    }

    /**
     * Execute the job.
     */
    public function handle(RagService $ragService): void
    {
        Log::info("Processing IndexKbArticleJob [Action: {$this->action}] for article #{$this->articleId}", [
            'attempt' => $this->attempts(),
            'actor' => $this->actor,
        ]);

        $article = KbArticle::find($this->articleId);

        // Handle delete/remove action even if article model is already deleted
        if ($this->action === 'delete' || $this->action === 'remove') {
            DB::transaction(function () use ($ragService) {
                $chunkIds = KbChunk::where('article_id', $this->articleId)->pluck('id');
                if ($chunkIds->isNotEmpty()) {
                    KbEmbedding::whereIn('chunk_id', $chunkIds)->delete();
                    KbChunk::whereIn('id', $chunkIds)->delete();
                }
                KbEmbedding::where('article_id', $this->articleId)->delete();
                KbChunk::where('article_id', $this->articleId)->delete();
                $ragService->refreshIndex($this->articleId);
            });
            Log::info("IndexKbArticleJob: Purged index for deleted article #{$this->articleId}");
            return;
        }

        if (!$article) {
            Log::warning("IndexKbArticleJob: Article #{$this->articleId} not found, skipping.");
            return;
        }

        switch ($this->action) {
            case 'archive':
                // Promptly deactivate embeddings from active search index
                DB::transaction(function () use ($article, $ragService) {
                    KbEmbedding::where('article_id', $article->id)->update([
                        'is_active' => false,
                        'updated_at' => now(),
                    ]);
                    $ragService->refreshIndex($article->id);
                });
                Log::info("IndexKbArticleJob: Article #{$article->id} embeddings deactivated from active RAG index.");
                break;

            case 'publish':
            case 'add':
            case 'update':
            default:
                // Spec 0036: indexArticle() embeds first, then swaps the new set in one transaction
                // (activating it when Published), and marks 'Indexing failed' on its own if embedding fails.
                // It must not run inside an outer transaction, since it calls the embedding API.
                $result = $ragService->indexArticle($article, $this->contentOverride);
                Log::info("IndexKbArticleJob: Article #{$article->id} index {$result} [Status: {$article->status}].");
                break;
        }
    }

    /**
     * Handle a job failure after exhausting all retries.
     */
    public function failed(\Throwable $exception): void
    {
        Log::alert("CRITICAL: IndexKbArticleJob exhausted retries for article #{$this->articleId}", [
            'action' => $this->action,
            'error' => $exception->getMessage(),
            'trace' => $exception->getTraceAsString(),
        ]);

        try {
            $article = KbArticle::find($this->articleId);
            if ($article) {
                $article->update([
                    'processing_status' => RagService::STATUS_FAILED,
                ]);
            }
        } catch (\Throwable $e) {
            Log::error("Failed to update article status on job failure: " . $e->getMessage());
        }
    }
}
