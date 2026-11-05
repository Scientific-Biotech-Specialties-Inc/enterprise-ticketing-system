<?php

namespace App\Services;

use App\Models\KbArticle;
use App\Models\KbChunk;
use App\Models\KbEmbedding;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class RagService
{
    protected string $apiKey;
    protected string $embeddingUrl;

    public function __construct()
    {
        $this->apiKey = config('services.gemini.api_key') ?? env('GEMINI_API_KEY', '');
        $this->embeddingUrl = 'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent';
    }

    /**
     * Generate 768-dimensional vector embedding for text using Google Gemini text-embedding-004
     * with deterministic unit-normalized fallback for resilience and offline testing.
     */
    public function generateEmbedding(string $text): array
    {
        $text = trim($text);
        if (empty($text)) {
            return array_fill(0, 768, 0.0);
        }

        if (!empty($this->apiKey)) {
            try {
                $response = Http::withHeaders([
                    'Content-Type' => 'application/json',
                ])->timeout(8)->post("{$this->embeddingUrl}?key={$this->apiKey}", [
                    'model' => 'models/text-embedding-004',
                    'content' => [
                        'parts' => [
                            ['text' => mb_substr($text, 0, 2048)]
                        ]
                    ]
                ]);

                if ($response->successful()) {
                    $json = $response->json();
                    $values = $json['embedding']['values'] ?? null;
                    if (is_array($values) && count($values) > 0) {
                        return $values;
                    }
                }
            } catch (\Throwable $e) {
                Log::warning('Gemini text-embedding-004 failed, using fallback embedding: ' . $e->getMessage());
            }
        }

        return $this->computeFallbackEmbedding($text);
    }

    /**
     * Deterministic, high-entropy TF-IDF normalized vector generator (768 dimensions)
     * used when Gemini API is unavailable or in offline testing.
     */
    public function computeFallbackEmbedding(string $text): array
    {
        $dim = 768;
        $vec = array_fill(0, $dim, 0.0);
        $words = preg_split('/[\s\p{P}]+/u', mb_strtolower($text), -1, PREG_SPLIT_NO_EMPTY);

        foreach ($words as $i => $word) {
            $h1 = crc32($word) % $dim;
            if ($h1 < 0) $h1 += $dim;
            $h2 = abs(crc32($word . '_salt')) % $dim;

            $weight = 1.0 + (1.0 / (1.0 + $i));
            $vec[$h1] += $weight;
            $vec[$h2] += ($weight * 0.5);
        }

        // Normalize to unit length
        $norm = 0.0;
        for ($d = 0; $d < $dim; $d++) {
            $norm += $vec[$d] * $vec[$d];
        }
        $norm = sqrt($norm);
        if ($norm > 0.000001) {
            for ($d = 0; $d < $dim; $d++) {
                $vec[$d] = round($vec[$d] / $norm, 6);
            }
        }

        return $vec;
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
     * Index or re-index an article's content into chunks and embeddings.
     */
    public function indexArticle(KbArticle $article, ?string $contentOverride = null): void
    {
        if ($contentOverride !== null) {
            $article->content = $contentOverride;
            $article->save();
        }
        $content = $contentOverride ?? $article->content ?? $article->description ?? $article->title;
        $chunks = $this->chunkText($content);

        // Remove previous chunks and embeddings by primary key to prevent MySQL InnoDB gap lock deadlocks
        $existingChunkIds = KbChunk::where('article_id', $article->id)->pluck('id');
        if ($existingChunkIds->isNotEmpty()) {
            KbEmbedding::whereIn('chunk_id', $existingChunkIds)->delete();
            KbChunk::whereIn('id', $existingChunkIds)->delete();
        }

        $isActive = ($article->status === 'Published');

        foreach ($chunks as $index => $chunkText) {
            $chunk = KbChunk::create([
                'article_id' => $article->id,
                'chunk_index' => $index,
                'content' => $chunkText,
                'token_count' => (int) ceil(mb_strlen($chunkText) / 4),
                'metadata' => [
                    'title' => $article->title,
                    'category' => $article->category,
                    'machine' => $article->machine,
                    'version' => $article->version,
                ],
            ]);

            $embeddingVector = $this->generateEmbedding($chunkText);

            KbEmbedding::create([
                'chunk_id' => $chunk->id,
                'article_id' => $article->id,
                'embedding' => $embeddingVector,
                'dimensions' => count($embeddingVector),
                'is_active' => $isActive,
            ]);
        }

        $article->update([
            'processing_status' => 'Ready for AI Search',
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
     * Publish an article and immediately activate its existing embeddings in the search index
     * without re-triggering extraction if the file is unchanged.
     * Blocks publishing if the article has no successfully processed embeddings.
     */
    public function publishArticle(KbArticle $article, string $actor = 'Super Admin'): KbArticle
    {
        // 1. Guard check: blocks publishing when the article has no successfully processed embeddings
        $embeddingsCount = KbEmbedding::where('article_id', $article->id)->count();
        $isProcessed = ($article->processing_status === 'Ready for AI Search' || $article->processing_status === 'Ready');

        if ($embeddingsCount === 0 || !$isProcessed) {
            throw new \App\Exceptions\ArticleMissingEmbeddingsException(
                "Cannot publish article: no successfully processed embeddings exist for this article. Please extract and process document content before publishing."
            );
        }

        // 2. Activate existing embeddings in the active index without re-extracting
        KbEmbedding::where('article_id', $article->id)->update([
            'is_active' => true,
            'updated_at' => now(),
        ]);

        $history = is_array($article->history) ? $article->history : [];
        $history[] = [
            'id' => (string) \Illuminate\Support\Str::uuid(),
            'type' => 'published',
            'timestamp' => now()->format('Y-m-d H:i:s'),
            'actor' => $actor,
            'action' => 'Published',
            'details' => 'Article published; activated existing embeddings in RAG index without re-extraction.',
        ];

        $article->status = 'Published';
        $article->published_at = now();
        $article->history = $history;
        $article->save();

        // 3. Refresh RAG active index
        $this->refreshIndex($article->id);

        // 4. Publish event to event bus
        try {
            event(new \App\Events\ArticlePublished($article, $actor, now()->toIso8601String()));
        } catch (\Throwable $e) {
            Log::warning('Broadcasting ArticlePublished failed: ' . $e->getMessage());
        }

        return $article->fresh(['chunks', 'embeddings']);
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
            }
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
     * @param string $query User query
     * @param int $topK Number of chunks to retrieve
     * @param float $minScore Minimum relevance threshold
     * @return array {chunks: array, duration_ms: float, matched: bool}
     */
    public function retrieve(string $query, int $topK = 5, float $minScore = 0.20): array
    {
        $startTime = hrtime(true);

        $queryEmbedding = $this->generateEmbedding($query);

        // Extract symptom/problem line if user provided multi-line structured input (e.g. 1. Machine 2. Serial 4. Symptom)
        $lines = explode("\n", $query);
        $symptomText = '';
        foreach ($lines as $line) {
            $trimmed = trim(preg_replace('/^(?:\d+[\.\)\-:]|\b[qQ]\d+[:\.]|\b(?:machine|problem|issue|item|serial)[:\-])\s*/i', '', $line));
            if (mb_strlen($trimmed) > 20) {
                $symptomText .= " " . $trimmed;
            }
        }
        $symptomEmbedding = !empty($symptomText) ? $this->generateEmbedding(trim($symptomText)) : null;

        // Candidate selection: strictly Published articles and active embeddings in search index
        $candidates = DB::table('kb_embeddings as e')
            ->join('kb_chunks as c', 'c.id', '=', 'e.chunk_id')
            ->join('kb_articles as a', 'a.id', '=', 'e.article_id')
            ->where('a.status', '=', 'Published')
            ->where('e.is_active', true)
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

        // Filter articles meeting minScore
        $matchedArticles = array_filter($articleGroups, fn ($a) => $a['max_score'] >= $minScore);

        // Sort articles: prioritize semantic match, and if 2 articles both match the problem (close score margin < 0.15),
        // prioritize the most recently updated article so newer KB procedures take precedence.
        uasort($matchedArticles, function ($a, $b) {
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
            'candidates_evaluated' => count($candidates),
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

