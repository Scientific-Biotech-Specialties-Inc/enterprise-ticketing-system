<?php

namespace App\Services;

use App\Exceptions\ArticleMissingEmbeddingsException;
use App\Exceptions\EmbeddingFailedException;
use App\Exceptions\IndexingInProgressException;
use App\Models\KbArticle;
use App\Models\KbChunk;
use App\Models\KbEmbedding;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class RagService
{
    public const STATUS_INDEXING = 'Indexing';
    public const STATUS_READY = 'Ready for AI Search';
    public const STATUS_FAILED = 'Indexing failed';

    /** Spec 0036 (AC-5): the article must rank in the top N of its own probe. */
    public const PROBE_TOP_N = 3;

    /** Seconds the per article index lock is held at most. */
    protected const INDEX_LOCK_SECONDS = 120;

    protected EmbeddingClient $embeddings;

    public function __construct(?EmbeddingClient $embeddings = null)
    {
        $this->embeddings = $embeddings ?? app(EmbeddingClient::class);
    }

    /**
     * The embedding model every stored and compared vector must come from.
     */
    public function embeddingModel(): string
    {
        return $this->embeddings->model();
    }

    /**
     * Retrieval and probe threshold (KB_MIN_SCORE).
     */
    public function minScore(): float
    {
        return (float) config('services.kb.min_score', 0.55);
    }

    /**
     * Use a different embedding client (kb:reembed swaps in one that retries on 429).
     */
    public function withEmbeddingClient(EmbeddingClient $client): static
    {
        $clone = clone $this;
        $clone->embeddings = $client;

        return $clone;
    }

    /**
     * The exact text that gets chunked and embedded: content, else description, else title.
     */
    public function indexableText(KbArticle $article): string
    {
        foreach ([$article->content, $article->description, $article->title] as $candidate) {
            $text = trim((string) $candidate);
            if ($text !== '') {
                return $text;
            }
        }

        return '';
    }

    /**
     * SHA256 of the indexable text (stored as kb_articles.content_hash).
     */
    public function contentHash(KbArticle $article): string
    {
        return hash('sha256', $this->indexableText($article));
    }

    /**
     * True when the article's indexed text differs from what is currently embedded,
     * or the current embeddings are missing or from another model.
     */
    public function needsReindex(KbArticle $article): bool
    {
        if ($article->content_hash === null || !hash_equals((string) $article->content_hash, $this->contentHash($article))) {
            return true;
        }

        return !$this->hasCurrentModelEmbeddings($article);
    }

    public function hasCurrentModelEmbeddings(KbArticle $article): bool
    {
        return KbEmbedding::where('article_id', $article->id)
            ->where('embedding_model', $this->embeddingModel())
            ->exists();
    }

    /**
     * Chunk text into digestible segments with word boundary awareness.
     */
    public function chunkText(string $text, int $maxChars = 600, int $overlapChars = 80): array
    {
        $text = trim($text);
        if (empty($text)) {
            return [];
        }

        if (mb_strlen($text) <= $maxChars) {
            return [$text];
        }

        $chunks = [];
        $paragraphs = preg_split('/\n\s*\n/', $text);
        $currentChunk = '';

        foreach ($paragraphs as $para) {
            $para = trim($para);
            if (empty($para)) continue;

            if (mb_strlen($currentChunk) + mb_strlen($para) + 2 <= $maxChars) {
                $currentChunk .= (empty($currentChunk) ? '' : "\n\n") . $para;
            } else {
                if (!empty($currentChunk)) {
                    $chunks[] = $currentChunk;
                }
                if (mb_strlen($para) > $maxChars) {
                    // Split long paragraph by sentences or words
                    $sentences = preg_split('/(?<=[.?!])\s+/', $para);
                    $subChunk = '';
                    foreach ($sentences as $sentence) {
                        if (mb_strlen($subChunk) + mb_strlen($sentence) + 1 <= $maxChars) {
                            $subChunk .= (empty($subChunk) ? '' : ' ') . $sentence;
                        } else {
                            if (!empty($subChunk)) $chunks[] = $subChunk;
                            $subChunk = $sentence;
                        }
                    }
                    $currentChunk = $subChunk;
                } else {
                    $currentChunk = $para;
                }
            }
        }

        if (!empty($currentChunk)) {
            $chunks[] = $currentChunk;
        }

        return !empty($chunks) ? $chunks : [$text];
    }

    /**
     * Spec 0036 (AC-1, AC-2, AC-6, AC-7): index an article's text into chunks and embeddings.
     *
     * - Same content hash and current model embeddings exist (and not forced): no embedding call,
     *   chunk metadata is refreshed in place. Returns 'unchanged'.
     * - Otherwise every chunk is embedded first. Only when all succeed does one transaction write
     *   the new set, delete the old set, and activate the new one (if the article is Published).
     *   Returns 'indexed'.
     * - On an embedding failure nothing new is written, the previous set keeps serving, the article
     *   becomes 'Indexing failed' with a readable index_error, and EmbeddingFailedException is thrown.
     *
     * @throws EmbeddingFailedException
     * @throws IndexingInProgressException
     */
    public function indexArticle(KbArticle $article, ?string $contentOverride = null, bool $force = false): string
    {
        if ($contentOverride !== null) {
            $article->content = $contentOverride;
            $article->save();
        }

        $lock = Cache::lock("kb:index:{$article->id}", self::INDEX_LOCK_SECONDS);
        if (!$lock->get()) {
            throw new IndexingInProgressException();
        }

        try {
            $article->refresh();

            if (!$force && !$this->needsReindex($article)) {
                $this->refreshChunkMetadata($article);
                if ($article->processing_status !== self::STATUS_READY || $article->index_error !== null) {
                    $article->update(['processing_status' => self::STATUS_READY, 'index_error' => null]);
                }

                return 'unchanged';
            }

            $text = $this->indexableText($article);
            $hash = hash('sha256', $text);
            $chunks = $this->chunkText($text);

            $article->update(['processing_status' => self::STATUS_INDEXING]);

            try {
                $vectors = $this->embeddings->embedMany($chunks, EmbeddingClient::TASK_DOCUMENT, (string) $article->title);
            } catch (EmbeddingFailedException $e) {
                $article->update([
                    'processing_status' => self::STATUS_FAILED,
                    'index_error' => $e->getMessage(),
                ]);
                Log::warning('Knowledge Base article indexing failed.', [
                    'article_id' => $article->id,
                    'reason' => $e->getMessage(),
                ]);
                throw $e;
            }

            $model = $this->embeddingModel();

            DB::transaction(function () use ($article, $chunks, $vectors, $hash, $model) {
                $oldChunkIds = KbChunk::where('article_id', $article->id)->pluck('id');
                $newEmbeddingIds = [];

                // 1. Build the new set as inactive.
                foreach ($chunks as $index => $chunkText) {
                    $chunk = KbChunk::create([
                        'article_id' => $article->id,
                        'chunk_index' => $index,
                        'content' => $chunkText,
                        'token_count' => (int) ceil(mb_strlen($chunkText) / 4),
                        'metadata' => $this->chunkMetadata($article),
                    ]);

                    $newEmbeddingIds[] = KbEmbedding::create([
                        'chunk_id' => $chunk->id,
                        'article_id' => $article->id,
                        'embedding' => $vectors[$index],
                        'dimensions' => count($vectors[$index]),
                        'embedding_model' => $model,
                        'is_active' => false,
                    ])->id;
                }

                // 2. Delete the old set by primary key (avoids InnoDB gap lock deadlocks).
                if ($oldChunkIds->isNotEmpty()) {
                    KbEmbedding::whereIn('chunk_id', $oldChunkIds)->delete();
                    KbChunk::whereIn('id', $oldChunkIds)->delete();
                }

                // 3. Activate the new set when the article is live.
                if ($article->status === 'Published') {
                    KbEmbedding::whereIn('id', $newEmbeddingIds)->update(['is_active' => true]);
                }

                $article->update([
                    'processing_status' => self::STATUS_READY,
                    'content_hash' => $hash,
                    'index_error' => null,
                ]);
            });

            $this->refreshIndex($article->id);

            return 'indexed';
        } finally {
            $lock->release();
        }
    }

    /**
     * Metadata copied onto every chunk.
     */
    protected function chunkMetadata(KbArticle $article): array
    {
        return [
            'title' => $article->title,
            'category' => $article->category,
            'machine' => $article->machine,
            'version' => $article->version,
        ];
    }

    /**
     * Spec 0036 (AC-7): update kb_chunks.metadata in place without touching embeddings.
     */
    public function refreshChunkMetadata(KbArticle $article): void
    {
        KbChunk::where('article_id', $article->id)->update([
            'metadata' => json_encode($this->chunkMetadata($article)),
            'updated_at' => now(),
        ]);
    }

    /**
     * Refresh in-memory or Redis RAG index cache.
     */
    public function refreshIndex(?int $articleId = null): void
    {
        \Illuminate\Support\Facades\Cache::forget('rag_active_articles_count');
        \Illuminate\Support\Facades\Cache::forget('rag_active_embeddings_count');
        if ($articleId) {
            \Illuminate\Support\Facades\Cache::forget("rag_article_{$articleId}");
        }
        Log::info('RAG index cache refreshed.', ['article_id' => $articleId]);
    }

    /**
     * True when publish may proceed: the article is 'Ready for AI Search' and has at least one
     * embedding from the configured model (spec 0036, AC-3).
     */
    public function isIndexedForPublish(KbArticle $article): bool
    {
        return $article->processing_status === self::STATUS_READY && $this->hasCurrentModelEmbeddings($article);
    }

    /**
     * Spec 0036 (AC-3, AC-4, AC-5): publish an already indexed article.
     *
     * Publish never indexes. It activates the article's current model embeddings (chunk and
     * embedding IDs stay identical), flips the status, then runs the self retrieval probe and
     * stores its score. The article is searchable as soon as this returns.
     *
     * @throws ArticleMissingEmbeddingsException when the article is not indexed with the current model
     */
    public function publishArticle(KbArticle $article, string $actor = 'Super Admin'): KbArticle
    {
        $article->refresh();

        // 1. Guard: only an article indexed with the current model may go live.
        if (!$this->isIndexedForPublish($article)) {
            throw new ArticleMissingEmbeddingsException(
                'Cannot publish article: it is not indexed for AI search with the current embedding model. '
                . 'Wait for indexing to finish, or use Retry if indexing failed, then publish again.'
            );
        }

        // 2. Activate the existing current model embeddings without indexing again.
        $model = $this->embeddingModel();
        DB::transaction(function () use ($article, $model) {
            KbEmbedding::where('article_id', $article->id)
                ->where('embedding_model', $model)
                ->update(['is_active' => true, 'updated_at' => now()]);

            $article->status = 'Published';
            $article->published_at = now();
            $article->save();
        });

        // 3. Refresh RAG active index so the next retrieve() sees it.
        $this->refreshIndex($article->id);

        // 4. Self retrieval probe (the article is Published now, so retrieve() can see it).
        $probe = $this->probeArticle($article);

        $history = is_array($article->history) ? $article->history : [];
        $history[] = [
            'id' => (string) Str::uuid(),
            'type' => 'published',
            'timestamp' => now()->format('Y-m-d H:i:s'),
            'actor' => $actor,
            'action' => 'Published',
            'details' => 'Article published; activated existing embeddings in RAG index without re-extraction.',
            'probe' => $probe,
        ];

        $article->history = $history;
        $article->probe_score = $probe['score'];
        $article->save();

        // 4. Publish event to event bus
        try {
            event(new \App\Events\ArticlePublished($article, $actor, now()->toIso8601String()));
        } catch (\Throwable $e) {
            Log::warning('Broadcasting ArticlePublished failed: ' . $e->getMessage());
        }

        return $article->fresh(['chunks', 'embeddings']);
    }

    /**
     * Spec 0036 (AC-5): search for the article using its own title plus description and report
     * where it lands. Never throws: if the query cannot be embedded the score is null, which
     * counts as low retrievability.
     *
     * @return array{score: float|null, rank: int|null, low_retrievability: bool, error?: string}
     */
    public function probeArticle(KbArticle $article): array
    {
        $query = trim($article->title . "\n" . ($article->description ?? ''));

        try {
            $ranked = $this->rankArticles($query);
        } catch (EmbeddingFailedException $e) {
            Log::warning('Knowledge Base publish probe could not embed its query.', [
                'article_id' => $article->id,
                'reason' => $e->getMessage(),
            ]);

            return ['score' => null, 'rank' => null, 'low_retrievability' => true, 'error' => $e->getMessage()];
        }

        $rank = null;
        $score = null;
        foreach (array_values($ranked) as $position => $group) {
            if ((int) $group['article_id'] === (int) $article->id) {
                $rank = $position + 1;
                $score = round((float) $group['max_score'], 4);
                break;
            }
        }

        return [
            'score' => $score,
            'rank' => $rank,
            'low_retrievability' => self::isLowRetrievability($score, $rank, $this->minScore()),
        ];
    }

    /**
     * Derived flag shared by publish, kb:reembed and formatArticle.
     */
    public static function isLowRetrievability(?float $score, ?int $rank, float $minScore): bool
    {
        return $score === null || $rank === null || $rank > self::PROBE_TOP_N || $score < $minScore;
    }

    /**
     * The probe recorded with the most recent publish or kb:reembed history entry.
     */
    public static function lastProbe(KbArticle $article): ?array
    {
        $history = is_array($article->history) ? $article->history : [];
        for ($i = count($history) - 1; $i >= 0; $i--) {
            if (isset($history[$i]['probe']) && is_array($history[$i]['probe'])) {
                return $history[$i]['probe'];
            }
        }

        return null;
    }

    /**
     * Archive an article and immediately remove its embeddings from the active search index,
     * while keeping the article record, chunks, and file intact.
     */
    public function archiveArticle(KbArticle $article, string $actor = 'Super Admin'): KbArticle
    {
        // Remove embeddings from active index while keeping article record and file intact
        KbEmbedding::where('article_id', $article->id)->update([
            'is_active' => false,
            'updated_at' => now(),
        ]);

        $history = is_array($article->history) ? $article->history : [];
        $history[] = [
            'id' => (string) \Illuminate\Support\Str::uuid(),
            'type' => 'archived',
            'timestamp' => now()->format('Y-m-d H:i:s'),
            'actor' => $actor,
            'action' => 'Archived',
            'details' => 'Article archived; removed embeddings from active RAG index while preserving article and file.',
        ];

        $article->status = 'Archived';
        $article->archived_at = now();
        $article->history = $history;
        $article->save();

        // Refresh RAG active index
        $this->refreshIndex($article->id);

        // Publish event to event bus
        try {
            event(new \App\Events\ArticleArchived($article, $actor, now()->toIso8601String()));
        } catch (\Throwable $e) {
            Log::warning('Broadcasting ArticleArchived failed: ' . $e->getMessage());
        }

        return $article->fresh(['chunks', 'embeddings']);
    }

    /**
     * Permanently delete an article and immediately purge all its chunks, embeddings, and stored files.
     * Enforces in-progress check, independent audit logging, cache refresh, and event bus notification.
     */
    public function deleteArticle(KbArticle $article, string $actor = 'Super Admin', ?int $actorEmpId = null, bool $skipAuditLog = false): bool
    {
        // 1. In-progress check: block deletion if the article is actively being processed or re-extracted
        $inProgressStatuses = ['Processing', 'Extracting', 'Indexing', 'Replacing'];
        if (in_array($article->processing_status, $inProgressStatuses, true)) {
            Log::warning('Delete blocked: article processing in progress', [
                'article_id' => $article->id,
                'title' => $article->title,
                'processing_status' => $article->processing_status,
                'actor' => $actor,
            ]);
            throw new \App\Exceptions\ArticleProcessingInProgressException(
                "Cannot delete article while an extraction or indexing process is currently in progress. Please wait for the process to complete or cancel it."
            );
        }

        $articleId = $article->id;
        $title = $article->title;
        $category = $article->category;
        $filePath = $article->file_path;

        // 2. Permanently delete article's stored physical file from file storage
        $this->deleteArticleFiles($article);

        // 3. Permanently delete chunks, embeddings, and article database record in an atomic transaction
        $deleted = DB::transaction(function () use ($article, $articleId) {
            // Immediate removal of chunks and embeddings from database
            $chunkIds = KbChunk::where('article_id', $articleId)->pluck('id');
            if ($chunkIds->isNotEmpty()) {
                KbEmbedding::whereIn('chunk_id', $chunkIds)->delete();
                KbChunk::whereIn('id', $chunkIds)->delete();
            }
            // Defense-in-depth safety cleanup by direct article_id
            KbEmbedding::where('article_id', $articleId)->delete();
            KbChunk::where('article_id', $articleId)->delete();

            // Permanently remove article record from database
            return (bool) $article->delete();
        });

        // 4. Record independent deletion event in audit log service (ticket_audit_logs) if not already handled
        if (!$skipAuditLog) {
            $this->recordDeletionAuditLog($articleId, $title, $category, $actor, $actorEmpId, $filePath);
        }

        // 5. Immediate removal of article's chunks/embeddings from the active RAG index caches
        $this->refreshIndex($articleId);

        // 6. Publish event to event bus if not already published
        if (!$skipAuditLog) {
            try {
                event(new \App\Events\ArticleDeleted($articleId, $title, $actor, now()->toIso8601String(), $category));
            } catch (\Throwable $e) {
                Log::warning('Broadcasting ArticleDeleted failed: ' . $e->getMessage());
            }
        }

        return $deleted;
    }

    /**
     * Permanently delete stored physical files associated with an article across storage disks.
     */
    public function deleteArticleFiles(KbArticle $article): void
    {
        try {
            $filePath = $article->file_path;
            if (!empty($filePath)) {
                // Cybersecurity check: prevent path traversal attacks
                if (str_contains($filePath, '..')) {
                    Log::warning('Suspected path traversal attempt in file_path during deletion', [
                        'file_path' => $filePath,
                        'article_id' => $article->id,
                    ]);
                } else {
                    if (\Illuminate\Support\Facades\Storage::disk('local')->exists($filePath)) {
                        \Illuminate\Support\Facades\Storage::disk('local')->delete($filePath);
                    }
                    if (\Illuminate\Support\Facades\Storage::disk('public')->exists($filePath)) {
                        \Illuminate\Support\Facades\Storage::disk('public')->delete($filePath);
                    }
                    $fullPath = storage_path('app/public/' . $filePath);
                    if (\Illuminate\Support\Facades\File::exists($fullPath)) {
                        \Illuminate\Support\Facades\File::delete($fullPath);
                    }
                }
            }

            // Clean up dedicated article directories if present
            $dirs = ["kb_documents/{$article->id}", "kb/{$article->id}"];
            foreach ($dirs as $articleDir) {
                if (\Illuminate\Support\Facades\Storage::disk('local')->exists($articleDir)) {
                    \Illuminate\Support\Facades\Storage::disk('local')->deleteDirectory($articleDir);
                }
                if (\Illuminate\Support\Facades\Storage::disk('public')->exists($articleDir)) {
                    \Illuminate\Support\Facades\Storage::disk('public')->deleteDirectory($articleDir);
                }
            }
        } catch (\Throwable $e) {
            Log::warning("Failed to delete stored file for article #{$article->id}: " . $e->getMessage());
        }
    }

    /**
     * Record independent deletion event in ticket_audit_logs.
     * Survives the hard-deletion of the article record itself.
     */
    public function recordDeletionAuditLog(
        int $articleId,
        string $title,
        ?string $category,
        string $actor,
        ?int $actorEmpId,
        ?string $filePath
    ): void {
        try {
            $empId = $actorEmpId;
            if (!$empId) {
                $empId = DB::table('employees')
                    ->where('role', 'like', '%admin%')
                    ->value('emp_id')
                    ?? DB::table('employees')->value('emp_id')
                    ?? 1;
            }
            $empId = $empId ?: 1;

            DB::table('ticket_audit_logs')->insert([
                'ticket_ID' => null,
                'action_type' => 'kb_article_deleted',
                'action_by_ID' => $empId,
                'actor_type' => 'superadmin',
                'details' => json_encode([
                    'module' => 'Knowledge Base',
                    'target' => $title,
                    'text' => "Permanently deleted knowledge article \"{$title}\" and purged all associated files and vector embeddings.",
                    'article_id' => $articleId,
                    'category' => $category,
                    'actor' => $actor,
                    'file_path' => $filePath,
                ]),
                'created_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::error('Failed to record deletion audit log: ' . $e->getMessage(), [
                'article_id' => $articleId,
                'title' => $title,
            ]);
        }
    }

    /**
     * Calculate cosine similarity between two unit-normalized vectors.
     */
    public function cosineSimilarity(array $vecA, array $vecB): float
    {
        $count = min(count($vecA), count($vecB));
        if ($count === 0) return 0.0;

        $dotProduct = 0.0;
        $normA = 0.0;
        $normB = 0.0;

        for ($i = 0; $i < $count; $i++) {
            $a = (float) $vecA[$i];
            $b = (float) $vecB[$i];
            $dotProduct += $a * $b;
            $normA += $a * $a;
            $normB += $b * $b;
        }

        if ($normA <= 0.0 || $normB <= 0.0) return 0.0;
        return $dotProduct / (sqrt($normA) * sqrt($normB));
    }

    /**
     * RAG Index Retrieval:
     * - Filters STRICTLY to embeddings belonging to Published articles (`a.status = 'Published' AND e.is_active = true`).
     * - Disambiguation & Freshness: when multiple articles cover the same problem, prioritizes the most updated one.
     * - Structured extraction: handles multi-line machine/issue inputs and orders troubleshooting steps chronologically.
     * - Defense-in-depth safety check: inspects each candidate chunk against real-time DB state.
     * - Measures and logs execution latency against 5-second target.
     *
     * Spec 0036 (AC-8, AC-9): only active embeddings from the configured model on Published
     * articles are compared, and the threshold defaults to KB_MIN_SCORE. If the query cannot be
     * embedded, EmbeddingFailedException is thrown so the caller escalates to a manual ticket.
     *
     * @param string $query User query
     * @param int $topK Number of chunks to retrieve
     * @param float|null $minScore Minimum relevance threshold (null means KB_MIN_SCORE)
     * @return array {chunks: array, duration_ms: float, matched: bool}
     *
     * @throws EmbeddingFailedException
     */
    public function retrieve(string $query, int $topK = 5, ?float $minScore = null): array
    {
        $startTime = hrtime(true);
        $minScore ??= $this->minScore();

        $articleGroups = $this->rankArticles($query, $candidateCount);

        // Filter articles meeting minScore (rankArticles already sorted them).
        $matchedArticles = array_filter($articleGroups, fn ($a) => $a['max_score'] >= $minScore);

        // Select chunks from the top ranked articles in chronological order (chunk_index ASC)
        // so Gemini receives complete numbered troubleshooting steps in sequence.
        $selectedChunks = [];
        foreach ($matchedArticles as $art) {
            $chunks = $art['chunks'];
            usort($chunks, fn ($c1, $c2) => $c1['chunk_index'] <=> $c2['chunk_index']);

            foreach ($chunks as $c) {
                $selectedChunks[] = [
                    'score' => $c['score'],
                    'embedding_id' => $c['embedding_id'],
                    'article_id' => $art['article_id'],
                    'chunk_id' => $c['chunk_id'],
                    'chunk_index' => $c['chunk_index'],
                    'article_title' => $art['article_title'],
                    'article_category' => $art['article_category'],
                    'article_machine' => $art['article_machine'],
                    'article_status' => $art['article_status'],
                    'article_updated_at' => $art['article_updated_at'],
                    'content' => $c['content'],
                ];
                if (count($selectedChunks) >= $topK) {
                    break 2;
                }
            }
        }

        // Cybersec defense-in-depth safety check & monitoring
        $verifiedPublishedChunks = $this->verifyPublishedChunks($selectedChunks, $query);

        $durationMs = round((hrtime(true) - $startTime) / 1e6, 2);

        // Performance monitoring log
        Log::info('RAG retrieval executed', [
            'query_length' => mb_strlen($query),
            'candidates_evaluated' => $candidateCount,
            'matched_articles' => count($matchedArticles),
            'matched_chunks' => count($verifiedPublishedChunks),
            'duration_ms' => $durationMs,
            'under_5s_target' => $durationMs < 5000.0,
        ]);

        // Dual-compatible array: accessible both as list of chunks and via keys
        $output = array_values($verifiedPublishedChunks);
        $output['chunks'] = $verifiedPublishedChunks;
        $output['duration_ms'] = $durationMs;
        $output['matched'] = count($verifiedPublishedChunks) > 0;

        return $output;
    }

    /**
     * Score every candidate article against the query and return them best first.
     *
     * Candidates are strictly active embeddings from the configured model on Published articles.
     * Vectors from any other model (for example the old 'hash-fallback-v1') are never compared.
     *
     * @return array<int, array> article groups with max_score and chunks, sorted best first
     *
     * @throws EmbeddingFailedException when the query cannot be embedded
     */
    public function rankArticles(string $query, ?int &$candidateCount = null): array
    {
        // Extract symptom/problem line if user provided multi-line structured input (e.g. 1. Machine 2. Serial 4. Symptom)
        $lines = explode("\n", $query);
        $symptomText = '';
        foreach ($lines as $line) {
            $trimmed = trim(preg_replace('/^(?:\d+[\.\)\-:](?!\d)|\b[qQ]\d+[:\.]|\b(?:machine|problem|issue|item|serial)[:\-])\s*/i', '', $line));
            if (mb_strlen($trimmed) > 20) {
                $symptomText .= " " . $trimmed;
            }
        }
        $symptomText = trim($symptomText);

        // Embed the query (and the symptom text, when present) in one request.
        $queryTexts = [trim($query) !== '' ? $query : ' '];
        if ($symptomText !== '' && $symptomText !== trim($query)) {
            $queryTexts[] = $symptomText;
        }
        $queryVectors = $this->embeddings->embedMany($queryTexts, EmbeddingClient::TASK_QUERY);
        $queryEmbedding = $queryVectors[0];
        $symptomEmbedding = $queryVectors[1] ?? null;

        // Candidate selection: strictly Published articles and active, current model embeddings
        $candidates = DB::table('kb_embeddings as e')
            ->join('kb_chunks as c', 'c.id', '=', 'e.chunk_id')
            ->join('kb_articles as a', 'a.id', '=', 'e.article_id')
            ->where('a.status', '=', 'Published')
            ->where('e.is_active', true)
            ->where('e.embedding_model', '=', $this->embeddingModel())
            ->select([
                'e.id as embedding_id',
                'e.article_id',
                'e.chunk_id',
                'e.embedding',
                'c.content as chunk_content',
                'c.chunk_index',
                'a.title as article_title',
                'a.category as article_category',
                'a.machine as article_machine',
                'a.status as article_status',
                'a.updated_at as article_updated_at',
            ])
            ->get();

        $articleGroups = [];

        foreach ($candidates as $candidate) {
            $vec = is_string($candidate->embedding) ? json_decode($candidate->embedding, true) : (array) $candidate->embedding;
            if (!is_array($vec) || empty($vec)) {
                continue;
            }

            $score = $this->cosineSimilarity($queryEmbedding, $vec);
            if ($symptomEmbedding) {
                $symptomScore = $this->cosineSimilarity($symptomEmbedding, $vec);
                $score = max($score, $symptomScore);
            }

            $artId = $candidate->article_id;
            if (!isset($articleGroups[$artId])) {
                $articleGroups[$artId] = [
                    'article_id' => $artId,
                    'article_title' => $candidate->article_title,
                    'article_category' => $candidate->article_category,
                    'article_machine' => $candidate->article_machine,
                    'article_status' => $candidate->article_status,
                    'article_updated_at' => $candidate->article_updated_at,
                    'max_score' => 0.0,
                    'chunks' => [],
                ];
            }

            if ($score > $articleGroups[$artId]['max_score']) {
                $articleGroups[$artId]['max_score'] = round($score, 4);
            }

            $articleGroups[$artId]['chunks'][] = [
                'embedding_id' => $candidate->embedding_id,
                'chunk_id' => $candidate->chunk_id,
                'chunk_index' => (int) $candidate->chunk_index,
                'score' => round($score, 4),
                'content' => $candidate->chunk_content,
            ];
        }

        $candidateCount = count($candidates);

        // Sort articles: prioritize semantic match, and if 2 articles both match the problem (close score margin < 0.15),
        // prioritize the most recently updated article so newer KB procedures take precedence.
        uasort($articleGroups, function ($a, $b) {
            $scoreDiff = $b['max_score'] - $a['max_score'];
            if (abs($scoreDiff) < 0.15) {
                $timeA = strtotime($a['article_updated_at'] ?? '1970-01-01');
                $timeB = strtotime($b['article_updated_at'] ?? '1970-01-01');
                if ($timeA !== $timeB) {
                    return $timeB <=> $timeA; // Most updated article first
                }
            }
            return $b['max_score'] <=> $a['max_score'];
        });

        return $articleGroups;
    }

    /**
     * Defense-in-depth safety check: inspects chunks against live DB state.
     * Drops any non-Published content and triggers Log::alert.
     */
    public function verifyPublishedChunks(array $chunks, string $query = ''): array
    {
        $verifiedPublishedChunks = [];

        foreach ($chunks as $chunk) {
            $currentStatus = DB::table('kb_articles')->where('id', $chunk['article_id'])->value('status');

            if ($currentStatus !== 'Published') {
                Log::alert('SECURITY ALERT: Non-published article content intercepted in RAG retrieval', [
                    'article_id' => $chunk['article_id'],
                    'article_title' => $chunk['article_title'] ?? 'Unknown',
                    'status' => $currentStatus,
                    'current_status' => $currentStatus,
                    'chunk_id' => $chunk['chunk_id'] ?? null,
                    'query' => $query,
                    'score' => $chunk['score'] ?? null,
                    'timestamp' => now()->toIso8601String(),
                ]);
                continue;
            }

            $verifiedPublishedChunks[] = $chunk;
        }

        return $verifiedPublishedChunks;
    }
}

