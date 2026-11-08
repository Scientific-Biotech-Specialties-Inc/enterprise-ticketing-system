<?php

namespace App\Http\Controllers;

use App\Exceptions\ArticleMissingEmbeddingsException;
use App\Exceptions\EmbeddingFailedException;
use App\Exceptions\IndexingInProgressException;
use App\Http\Middleware\AuthenticateTokenOrInternal;
use App\Models\KbArticle;
use App\Models\KbChunk;
use App\Models\KbEmbedding;
use App\Services\RagService;
use App\Services\AuditLoggingService;
use App\Services\ClamAVScanner;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class KbArticleController extends Controller
{
    protected RagService $ragService;
    protected AuditLoggingService $auditLoggingService;
    protected ClamAVScanner $scanner;

    public function __construct(
        RagService $ragService,
        AuditLoggingService $auditLoggingService,
        ?ClamAVScanner $scanner = null
    ) {
        $this->ragService = $ragService;
        $this->auditLoggingService = $auditLoggingService;
        $this->scanner = $scanner ?? app(ClamAVScanner::class);
    }

    /**
     * Spec 0036 (AC-11): resolve the acting user only from verified identity.
     *
     * The KB write routes sit behind `auth.token_or_internal`, so by the time this runs the caller
     * either sent a valid X-Internal-Token or a token whose signature was verified (staff RS256 JWT,
     * or a customer Passport token). Nothing is read from an unverified token payload, the request
     * body, or caller supplied headers.
     */
    protected function resolveActor(Request $request): array
    {
        if ($request->attributes->get('internal_call') === true || AuthenticateTokenOrInternal::hasValidInternalToken($request)) {
            return ['actor' => 'Internal Service', 'role' => 'superadmin', 'is_super_admin' => true];
        }

        $user = $request->user() ?? Auth::user();
        if (!$user) {
            return ['actor' => 'Unknown', 'role' => 'guest', 'is_super_admin' => false];
        }

        $normalize = fn ($value) => strtolower(str_replace([' ', '_', '-'], '', (string) ($value ?? '')));
        $userRole = $normalize($user->role ?? null);
        $userDept = $normalize($user->department ?? null);

        $name = trim(((string) ($user->first_name ?? '')) . ' ' . ((string) ($user->last_name ?? '')));
        if ($name === '') {
            $name = (string) ($user->name ?? $user->email ?? 'Super Admin');
        }

        return [
            'actor' => $name !== '' ? $name : 'Super Admin',
            'role' => $userRole ?: 'employee',
            'is_super_admin' => in_array($userRole, ['superadmin', 'systemadministrator', 'admin'], true)
                || in_array($userDept, ['superadmin', 'admin'], true),
        ];
    }

    /**
     * Probe summary for API responses (spec 0036, AC-5).
     */
    protected function probeSummary(KbArticle $article): array
    {
        $probe = RagService::lastProbe($article);
        $score = $article->probe_score !== null ? round((float) $article->probe_score, 4) : null;
        $rank = isset($probe['rank']) ? (int) $probe['rank'] : null;

        return [
            'score' => $score,
            'rank' => $rank,
            'low_retrievability' => RagService::isLowRetrievability($score, $rank, $this->ragService->minScore()),
        ];
    }

    /**
     * Shared error response for indexing failures (502) and a held index lock (409).
     */
    protected function indexingErrorResponse(\Throwable $e, KbArticle $article): JsonResponse
    {
        if ($e instanceof IndexingInProgressException) {
            return response()->json([
                'success' => false,
                'error_code' => 'INDEXING_IN_PROGRESS',
                'message' => $e->getMessage(),
                'data' => $this->formatArticle($article->fresh() ?? $article),
            ], 409);
        }

        return response()->json([
            'success' => false,
            'error_code' => 'INDEXING_FAILED',
            'message' => 'The article was saved, but indexing for AI search failed: ' . $e->getMessage(),
            'data' => $this->formatArticle($article->fresh() ?? $article),
        ], 502);
    }

    /**
     * Format a KbArticle model for standardized frontend consumption.
     */
    public function formatArticle(KbArticle $article): array
    {
        $publishedAt = $article->published_at ? $article->published_at->format('Y-m-d H:i:s') : null;
        $archivedAt = $article->archived_at ? $article->archived_at->format('Y-m-d H:i:s') : null;
        $createdAt = $article->created_at ? $article->created_at->format('Y-m-d') : now()->format('Y-m-d');

        return [
            'id' => (int) $article->id,
            'title' => (string) $article->title,
            'category' => (string) ($article->category ?? 'Troubleshooting Guides'),
            'machine' => $article->machine,
            'version' => (string) ($article->version ?? '1.0'),
            'file_type' => (string) ($article->file_type ?? 'PDF'),
            'fileType' => (string) ($article->file_type ?? 'PDF'),
            'uploaded_by' => (string) ($article->uploaded_by ?? 'Super Admin'),
            'uploadedBy' => (string) ($article->uploaded_by ?? 'Super Admin'),
            'uploadDate' => $createdAt,
            'upload_date' => $createdAt,
            'size' => (string) ($article->size ?? '1.5 MB'),
            'status' => $article->status === 'Published' ? 'Ready' : $article->status,
            'publish_state' => $article->status,
            'publishState' => $article->status,
            'processing_status' => (string) ($article->processing_status ?? 'Ready for AI Search'),
            'processingStatus' => (string) ($article->processing_status ?? 'Ready for AI Search'),
            'tags' => is_array($article->tags) ? $article->tags : [],
            'description' => (string) ($article->description ?? ''),
            'content' => (string) ($article->content ?? ''),
            // The raw storage path is internal (it points at the public disk, which nginx serves
            // without auth). Clients download through GET /articles/{id}/file instead.
            'has_file' => !empty($article->file_path),
            'history' => is_array($article->history) ? $article->history : [],
            'published_at' => $publishedAt,
            'archived_at' => $archivedAt,
            'chunks_count' => $article->chunks()->count(),
            'embeddings_count' => $article->embeddings()->count(),
            'active_embeddings_count' => $article->embeddings()->where('is_active', true)->count(),
            'index_error' => $article->index_error,
            'probe_score' => $article->probe_score !== null ? round((float) $article->probe_score, 4) : null,
            'low_retrievability' => $article->status === 'Published' ? $this->probeSummary($article)['low_retrievability'] : false,
            'created_at' => $article->created_at?->toIso8601String(),
            'updated_at' => $article->updated_at?->toIso8601String(),
        ];
    }

    /**
     * GET /api/articles
     * List all articles with optional filters.
     */
    public function index(Request $request): JsonResponse
    {
        $query = KbArticle::query();

        if ($request->filled('status')) {
            $query->where('status', $request->query('status'));
        }
        if ($request->filled('category')) {
            $query->where('category', $request->query('category'));
        }
        if ($request->filled('machine')) {
            $query->where('machine', $request->query('machine'));
        }
        if ($request->filled('search')) {
            $q = $request->query('search');
            $query->where(function ($b) use ($q) {
                $b->where('title', 'like', "%{$q}%")
                  ->orWhere('description', 'like', "%{$q}%");
            });
        }

        $articles = $query->orderBy('created_at', 'desc')->get();

        $formatted = $articles->map(fn (KbArticle $a) => $this->formatArticle($a))->values();

        return response()->json([
            'success' => true,
            'data' => $formatted,
            'count' => $formatted->count(),
        ]);
    }

    /**
     * GET /api/articles/categories
     * Returns standard and active categories.
     */
    public function categories(): JsonResponse
    {
        $defaults = [
            'User Manuals',
            'Troubleshooting Guides',
            'FAQs',
            'Product Specifications',
            'Maintenance Guides',
            'Installation Guides',
            'Warranty Documents',
        ];

        $inDb = KbArticle::distinct()->whereNotNull('category')->pluck('category')->toArray();
        $merged = array_values(array_unique(array_merge($defaults, $inDb)));

        return response()->json([
            'success' => true,
            'data' => $merged,
        ]);
    }

    /**
     * GET /api/articles/{id}
     * Retrieve single article details.
     */
    public function show($id): JsonResponse
    {
        $article = KbArticle::find($id);
        if (!$article) {
            return response()->json(['success' => false, 'message' => 'Article not found.'], 404);
        }

        return response()->json([
            'success' => true,
            'data' => $this->formatArticle($article),
        ]);
    }

    /**
     * POST /api/articles
     * Create a new article (Draft by default).
     */
    public function store(Request $request): JsonResponse
    {
        $auth = $this->resolveActor($request);
        if (!$auth['is_super_admin']) {
            return response()->json(['success' => false, 'message' => 'Forbidden: Only Super Administrators can create articles.'], 403);
        }

        $validated = $request->validate([
            'title' => 'required|string|max:255',
            'category' => 'nullable|string|max:100',
            'machine' => 'nullable|string|max:100',
            'version' => 'nullable|string|max:20',
            'file_type' => 'nullable|string|max:20',
            'size' => 'nullable|string|max:50',
            'tags' => 'nullable',
            'description' => 'nullable|string',
            'content' => 'nullable|string',
            'status' => 'nullable|in:Draft,Published,Archived',
            'auto_index' => 'nullable|boolean',
            'file' => 'nullable|file|max:10240',
        ]);

        $status = $validated['status'] ?? 'Draft';
        $actor = $auth['actor'];

        $file = $request->file('file');
        $storedPath = null;
        $content = $validated['content'] ?? '';
        $description = $validated['description'] ?? '';
        $fileType = $validated['file_type'] ?? ($file ? null : 'ARTICLE');
        $size = $validated['size'] ?? null;

        if ($file) {
            $filePath = $file->getRealPath();
            $ext = strtolower($file->getClientOriginalExtension());
            if (!in_array($ext, ['pdf', 'docx', 'csv', 'txt'])) {
                return response()->json([
                    'success' => false,
                    'message' => 'Invalid file format. Only PDF, DOCX, CSV, and TXT files are supported.',
                ], 422);
            }

            try {
                $scanResult = $this->scanner->scanDetails($filePath);
            } catch (\Throwable $e) {
                Log::error('ClamAV scan error during article creation: ' . $e->getMessage());
                return response()->json([
                    'success' => false,
                    'message' => 'Antivirus scan service error: ' . $e->getMessage(),
                ], 500);
            }

            if (!$scanResult['clean']) {
                Log::warning('Malware detected during article file upload', [
                    'threat' => $scanResult['threat'],
                    'file' => $file->getClientOriginalName(),
                    'actor' => $actor,
                ]);

                return response()->json([
                    'success' => false,
                    'error_code' => 'MALWARE_DETECTED',
                    'threat' => $scanResult['threat'] ?? 'Malware.Detected',
                    'message' => 'Security Alert: Uploaded file failed ClamAV antivirus inspection and was rejected.',
                ], 422);
            }

            $safeName = time() . '_' . preg_replace('/[^a-zA-Z0-9._-]/', '_', $file->getClientOriginalName());
            $storedPath = $file->storeAs('kb_articles', $safeName, 'public');
            $extractedContent = $this->extractTextFromFile($file, $ext);
            if (!empty($extractedContent)) {
                $content = $extractedContent;
                if (empty($description)) {
                    $description = mb_substr($extractedContent, 0, 250);
                }
            }
            $fileType = strtoupper($ext);
            $size = sprintf('%.1f %s', $file->getSize() >= 1048576 ? $file->getSize() / 1048576 : $file->getSize() / 1024, $file->getSize() >= 1048576 ? 'MB' : 'KB');
        }

        if (empty($fileType)) {
            $fileType = 'ARTICLE';
        }

        if (empty($size)) {
            $size = sprintf('%.1f KB', max(strlen($content) / 1024, 0.1));
        }

        $tags = $validated['tags'] ?? [];
        if (is_string($tags)) {
            $tags = array_values(array_filter(array_map('trim', explode(',', $tags))));
        }

        $historyEntry = [
            'id' => (string) Str::uuid(),
            'type' => 'created',
            'timestamp' => now()->format('Y-m-d H:i:s'),
            'actor' => $actor,
            'action' => 'Created',
            'details' => $file
                ? "Article created from uploaded {$file->getClientOriginalName()} in {$status} state."
                : "Article manually created in {$status} state.",
        ];

        $article = KbArticle::create([
            'title' => $validated['title'],
            'category' => $validated['category'] ?? 'Troubleshooting Guides',
            'machine' => $validated['machine'] ?? null,
            'version' => $validated['version'] ?? '1.0',
            'file_type' => $fileType,
            'file_path' => $storedPath,
            'uploaded_by' => $actor,
            'size' => $size,
            'status' => 'Draft', // initial state; publish is a separate step that requires indexing
            'processing_status' => 'Draft',
            'tags' => $tags,
            'description' => $description,
            'content' => $content,
            'history' => [$historyEntry],
        ]);

        // Spec 0036: index inside this request so the article is ready to publish when it returns.
        // Embeddings stay inactive until the article is published.
        if (!empty($article->content) || !empty($article->description)) {
            try {
                $this->ragService->indexArticle($article);
            } catch (EmbeddingFailedException|IndexingInProgressException $e) {
                return $this->indexingErrorResponse($e, $article);
            }
        }

        // If explicitly requested to publish immediately
        $probe = null;
        if ($status === 'Published') {
            try {
                $article = $this->ragService->publishArticle($article, $actor);
                $probe = $this->probeSummary($article);
            } catch (ArticleMissingEmbeddingsException $e) {
                return response()->json([
                    'success' => false,
                    'message' => $e->getMessage(),
                    'error_code' => 'NOT_INDEXED',
                    'data' => $this->formatArticle($article->fresh()),
                ], 422);
            }
        }

        $body = [
            'success' => true,
            'message' => 'Article created successfully.',
            'data' => $this->formatArticle($article->fresh()),
        ];
        if ($probe !== null) {
            $body['probe'] = $probe;
            $body['low_retrievability'] = $probe['low_retrievability'];
        }

        return response()->json($body, 201);
    }

    /**
     * PUT/PATCH /api/articles/{id}
     * Update article metadata without affecting embeddings or pipeline.
     */
    public function update(Request $request, $id): JsonResponse
    {
        $auth = $this->resolveActor($request);
        if (!$auth['is_super_admin']) {
            return response()->json(['success' => false, 'message' => 'Forbidden: Only Super Administrators can update articles.'], 403);
        }

        $article = KbArticle::find($id);
        if (!$article) {
            return response()->json(['success' => false, 'message' => 'Article not found.'], 404);
        }

        $validated = $request->validate([
            'title' => 'sometimes|required|string|max:255',
            'category' => 'sometimes|nullable|string|max:100',
            'machine' => 'sometimes|nullable|string|max:100',
            'version' => 'sometimes|nullable|string|max:20',
            'file_type' => 'sometimes|nullable|string|max:20',
            'file_path' => 'sometimes|nullable|string|max:255',
            'size' => 'sometimes|nullable|string|max:50',
            'processing_status' => 'sometimes|nullable|string|max:100',
            'tags' => 'sometimes|nullable|array',
            'description' => 'sometimes|nullable|string',
            'content' => 'sometimes|nullable|string',
            'status' => 'sometimes|nullable|in:Draft,Published,Archived',
        ]);

        $history = is_array($article->history) ? $article->history : [];
        $history[] = [
            'id' => (string) Str::uuid(),
            'type' => 'metadata',
            'timestamp' => now()->format('Y-m-d H:i:s'),
            'actor' => $auth['actor'],
            'action' => 'Updated Metadata',
            'details' => 'Article metadata or content modified.',
        ];

        // Publish state and indexing state are owned by the server (publish, archive and indexArticle).
        // Letting a client set them would bypass the NOT_INDEXED guard (spec 0036, AC-3).
        unset($validated['status'], $validated['processing_status']);

        $article->fill($validated);

        // Capture old -> new values for the audit trail before saving. Long text bodies are
        // flagged as changed rather than copied, to keep the audit row small.
        $changes = [];
        foreach (array_keys($article->getDirty()) as $field) {
            if (in_array($field, ['content', 'description'], true)) {
                $changes[$field] = ['changed' => true];
                continue;
            }
            $changes[$field] = ['from' => $article->getOriginal($field), 'to' => $article->getAttribute($field)];
        }

        $article->history = $history;
        $article->save();

        if (!empty($changes)) {
            $this->auditLoggingService->logArticleChange(
                (int) $article->id,
                (string) $article->title,
                'Metadata Updated',
                $auth['actor'],
                $auth['role'],
                ['changes' => $changes],
                $request->ip()
            );
        }

        // Spec 0036 (AC-6, AC-7): re-embed only when the indexed text changed. A Published article
        // keeps serving its old set until the new one is swapped in; a metadata only edit just
        // refreshes chunk metadata in place without calling the embedding API.
        $indexError = null;
        $hasIndexableText = trim((string) $article->content) !== '' || trim((string) $article->description) !== '';
        if ($hasIndexableText || $article->content_hash !== null) {
            try {
                $this->ragService->indexArticle($article);
            } catch (EmbeddingFailedException|IndexingInProgressException $e) {
                $indexError = $e;
            }
        }

        // Cache refresh and broadcast only; indexing already happened above.
        try {
            event(new \App\Events\ArticleUpdated($article, $auth['actor']));
        } catch (\Throwable $e) {
            Log::warning('Dispatching ArticleUpdated event failed: ' . $e->getMessage());
        }

        if ($indexError !== null) {
            return $this->indexingErrorResponse($indexError, $article);
        }

        return response()->json([
            'success' => true,
            'message' => 'Article updated successfully.',
            'data' => $this->formatArticle($article->fresh()),
        ]);
    }

    /**
     * POST /api/articles/{id}/publish
     * Super Admin action (spec 0036, AC-3 to AC-5): publish an article that is already indexed
     * with the current embedding model. Publish never indexes; it activates the existing
     * embeddings (IDs unchanged), runs the self retrieval probe, and the article is searchable
     * as soon as this returns. Otherwise 422 NOT_INDEXED.
     */
    public function publish(Request $request, $id): JsonResponse
    {
        $auth = $this->resolveActor($request);
        if (!$auth['is_super_admin']) {
            return response()->json([
                'success' => false,
                'message' => 'Forbidden: Only Super Administrators can publish articles.',
            ], 403);
        }

        $article = KbArticle::find($id);
        if (!$article) {
            return response()->json(['success' => false, 'message' => 'Article not found.'], 404);
        }

        // An article with no content was never indexed, so the single NOT_INDEXED guard in
        // publishArticle() covers it too (spec 0036, AC-3).
        try {
            // publishArticle() dispatches ArticlePublished itself (cache refresh and broadcast only).
            $updated = $this->ragService->publishArticle($article, $auth['actor']);
            $probe = $this->probeSummary($updated);

            return response()->json([
                'success' => true,
                'message' => $probe['low_retrievability']
                    ? 'Article published, but it is hard to find: its own title and description did not rank it highly. Consider improving the title, description or content.'
                    : 'Article published and searchable by the AI assistant.',
                'data' => $this->formatArticle($updated),
                'probe' => $probe,
                'low_retrievability' => $probe['low_retrievability'],
            ]);
        } catch (ArticleMissingEmbeddingsException $e) {
            return response()->json([
                'success' => false,
                'error_code' => 'NOT_INDEXED',
                'message' => $e->getMessage(),
                'data' => $this->formatArticle($article->fresh()),
            ], 422);
        } catch (\Throwable $e) {
            Log::error('Failed to publish article: ' . $e->getMessage(), ['trace' => $e->getTraceAsString()]);
            return response()->json([
                'success' => false,
                'message' => 'Failed to publish article: ' . $e->getMessage(),
            ], 500);
        }
    }

    /**
     * POST /api/articles/{id}/archive
     * Super Admin action: Archive article, removing its embeddings from active search index
     * while preserving article record, chunks, and file intact.
     */
    public function archive(Request $request, $id): JsonResponse
    {
        $auth = $this->resolveActor($request);
        if (!$auth['is_super_admin']) {
            return response()->json([
                'success' => false,
                'message' => 'Forbidden: Only Super Administrators can archive articles.',
            ], 403);
        }

        $article = KbArticle::find($id);
        if (!$article) {
            return response()->json(['success' => false, 'message' => 'Article not found.'], 404);
        }

        try {
            $updated = $this->ragService->archiveArticle($article, $auth['actor']);

            return response()->json([
                'success' => true,
                'message' => 'Article archived successfully; embeddings deactivated from active search index.',
                'data' => $this->formatArticle($updated),
            ]);
        } catch (\Throwable $e) {
            Log::error('Failed to archive article: ' . $e->getMessage(), ['trace' => $e->getTraceAsString()]);
            return response()->json([
                'success' => false,
                'message' => 'Failed to archive article: ' . $e->getMessage(),
            ], 500);
        }
    }

    /**
     * DELETE /api/articles/{id}
     * Permanently delete an article, its physical stored file, and all its search embeddings.
     * Enforces Super Admin RBAC, blocks deletion if article is mid-processing,
     * records independent audit log, and publishes ArticleDeleted event.
     */
    public function destroy(Request $request, $id): JsonResponse
    {
        $auth = $this->resolveActor($request);
        if (!$auth['is_super_admin']) {
            return response()->json([
                'success' => false,
                'message' => 'Forbidden: Only Super Administrators can permanently delete articles.',
            ], 403);
        }

        $article = KbArticle::find($id);
        if (!$article) {
            return response()->json([
                'success' => false,
                'message' => 'Article not found.',
            ], 404);
        }

        // Block deletion if article has an active process in progress (e.g. mid-extraction or indexing)
        if ($article->processing_status === 'Processing' || $article->status === 'Processing') {
            return response()->json([
                'success' => false,
                'error_code' => 'PROCESS_IN_PROGRESS',
                'message' => 'Article cannot be deleted while processing is in progress. Please wait until text extraction and indexing completes.',
            ], 409);
        }

        $articleId = (int) $article->id;
        $title = $article->title;
        $category = $article->category;
        $actor = $auth['actor'] ?? 'Super Admin';
        $actorRole = $auth['role'] ?? 'Super Admin';

        // Record independent audit log entry before deletion so it survives the hard-delete
        $this->auditLoggingService->logArticleDeletion(
            articleId: $articleId,
            title: $title,
            actor: $actor,
            actorRole: $actorRole,
            extraDetails: [
                'category' => $category,
                'machine' => $article->machine,
                'version' => $article->version,
                'file_type' => $article->file_type,
                'file_path' => $article->file_path,
                'status_before_delete' => $article->status,
            ],
            ipAddress: $request->ip()
        );

        // Permanently hard-delete stored files, embeddings, chunks, and database record
        try {
            $this->ragService->deleteArticle($article, $actor, skipAuditLog: true);
            event(new \App\Events\ArticleDeleted($articleId, $title, $actor, now()->toIso8601String(), $category));
        } catch (\App\Exceptions\ArticleProcessingInProgressException $e) {
            return response()->json([
                'success' => false,
                'error_code' => 'PROCESS_IN_PROGRESS',
                'message' => $e->getMessage(),
            ], 409);
        }

        return response()->json([
            'success' => true,
            'message' => "Article \"{$title}\" and its active search embeddings were permanently deleted.",
            'data' => [
                'id' => $articleId,
                'title' => $title,
            ],
        ]);
    }

    /**
     * POST /api/articles/{id}/reindex
     * Force re-indexing of an article when file or content has changed.
     */
    public function reindex(Request $request, $id): JsonResponse
    {
        $auth = $this->resolveActor($request);
        if (!$auth['is_super_admin']) {
            return response()->json(['success' => false, 'message' => 'Forbidden: Only Super Administrators can re-index articles.'], 403);
        }

        $article = KbArticle::find($id);
        if (!$article) {
            return response()->json(['success' => false, 'message' => 'Article not found.'], 404);
        }

        // Retry button for 'Indexing failed' (spec 0036): always embed again with the current model.
        try {
            $this->ragService->indexArticle($article, null, true);
        } catch (EmbeddingFailedException|IndexingInProgressException $e) {
            return $this->indexingErrorResponse($e, $article);
        }

        return response()->json([
            'success' => true,
            'message' => 'Article re-indexed successfully.',
            'data' => $this->formatArticle($article->fresh()),
        ]);
    }

    /**
     * POST /api/articles/{id}/replace-file
     * Replace an article's document file with ClamAV antivirus inspection,
     * text extraction, re-indexing, and history tracking.
     */
    public function replaceFile(Request $request, $id): JsonResponse
    {
        $auth = $this->resolveActor($request);
        if (!$auth['is_super_admin']) {
            return response()->json(['success' => false, 'message' => 'Forbidden: Only Super Administrators can replace article documents.'], 403);
        }

        $article = KbArticle::find($id);
        if (!$article) {
            return response()->json(['success' => false, 'message' => 'Article not found.'], 404);
        }

        $request->validate([
            'file' => 'required|file|max:10240', // 10MB limit
        ]);

        $file = $request->file('file');
        $filePath = $file->getRealPath();
        $ext = strtolower($file->getClientOriginalExtension());

        if (!in_array($ext, ['pdf', 'docx', 'csv', 'txt'])) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid file format. Only PDF, DOCX, CSV, and TXT files are supported.',
            ], 422);
        }

        // 1. Mandatory ClamAV Antivirus Daemon Inspection
        try {
            $scanResult = $this->scanner->scanDetails($filePath);
        } catch (\Throwable $e) {
            Log::error('ClamAV scan error during file replacement: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Antivirus scan service error: ' . $e->getMessage(),
            ], 500);
        }

        if (!$scanResult['clean']) {
            Log::warning('Malware detected during article file replacement', [
                'article_id' => $id,
                'threat' => $scanResult['threat'],
                'file' => $file->getClientOriginalName(),
                'actor' => $auth['actor'],
            ]);

            return response()->json([
                'success' => false,
                'error_code' => 'MALWARE_DETECTED',
                'threat' => $scanResult['threat'] ?? 'Malware.Detected',
                'message' => 'Security Alert: Replacement file failed ClamAV antivirus inspection and was rejected.',
            ], 422);
        }

        // 2. Remove old physical file if exists
        $this->ragService->deleteArticleFiles($article);

        // 3. Store new physical file in public storage disk
        $safeName = $article->id . '_' . time() . '_' . preg_replace('/[^a-zA-Z0-9._-]/', '_', $file->getClientOriginalName());
        $storedPath = $file->storeAs('kb_articles', $safeName, 'public');

        // 4. Extract content
        $extractedContent = $this->extractTextFromFile($file, $ext);
        if (!empty($extractedContent)) {
            $article->content = $extractedContent;
            // Update description if previous was empty or generic
            if (empty($article->description) || str_starts_with($article->description, 'SOP imported')) {
                $article->description = mb_substr($extractedContent, 0, 250);
            }
        }

        $formattedSize = sprintf('%.1f %s', $file->getSize() >= 1048576 ? $file->getSize() / 1048576 : $file->getSize() / 1024, $file->getSize() >= 1048576 ? 'MB' : 'KB');

        // 5. Update article record
        $article->file_path = $storedPath;
        $article->file_type = strtoupper($ext);
        $article->size = $formattedSize;
        // processing_status is set by indexArticle() below (Indexing, then Ready or failed).

        // 6. Record history entry
        $history = is_array($article->history) ? $article->history : [];
        array_unshift($history, [
            'id' => (string) Str::uuid(),
            'type' => 'file_replacement',
            'timestamp' => now()->format('Y-m-d H:i:s'),
            'actor' => $auth['actor'],
            'action' => 'File Replaced',
            'fileName' => $file->getClientOriginalName(),
            'fileSize' => $formattedSize,
            'details' => "Replaced with {$file->getClientOriginalName()} ({$formattedSize}) and passed ClamAV inspection.",
        ]);
        $article->history = $history;
        $article->save();

        $this->auditLoggingService->logArticleChange(
            (int) $article->id,
            (string) $article->title,
            'File Replaced',
            $auth['actor'],
            $auth['role'],
            ['file_name' => $file->getClientOriginalName(), 'file_size' => $formattedSize, 'file_type' => strtoupper($ext)],
            $request->ip()
        );

        // 7. Re-index embeddings (spec 0036, AC-6): the new set is built inactive and swapped in
        // atomically, activated if Published. On failure the old set keeps serving customers.
        $indexError = null;
        try {
            $this->ragService->indexArticle($article);
        } catch (EmbeddingFailedException|IndexingInProgressException $e) {
            $indexError = $e;
        }

        // Broadcast update event
        try {
            event(new \App\Events\ArticleUpdated($article, $auth['actor']));
        } catch (\Throwable $e) {
            Log::warning('Dispatching ArticleUpdated event failed: ' . $e->getMessage());
        }

        if ($indexError !== null) {
            return $this->indexingErrorResponse($indexError, $article);
        }

        // Index internals are not needed by the client after a replacement.
        $data = $this->formatArticle($article->fresh());
        unset($data['chunks_count'], $data['embeddings_count'], $data['active_embeddings_count']);

        return response()->json([
            'success' => true,
            'message' => "File for \"{$article->title}\" was successfully replaced, scanned by ClamAV, and re-indexed.",
            'data' => $data,
        ]);
    }

    /**
     * GET /api/articles/{id}/file
     * Download or view the original or generated file for an article.
     */
    public function downloadFile(Request $request, $id)
    {
        $article = KbArticle::find($id);
        if (!$article) {
            return response()->json(['success' => false, 'message' => 'Article not found.'], 404);
        }

        if (!empty($article->file_path)) {
            if (Storage::disk('public')->exists($article->file_path)) {
                $fullPath = storage_path('app/public/' . $article->file_path);
                return response()->download($fullPath, basename($article->file_path));
            }
            if (Storage::disk('local')->exists($article->file_path)) {
                $fullPath = storage_path('app/' . $article->file_path);
                return response()->download($fullPath, basename($article->file_path));
            }
        }

        $cleanTitle = preg_replace('/[^a-zA-Z0-9_-]/', '_', $article->title);
        $ext = strtolower($article->file_type ?? 'txt');
        $filename = "{$cleanTitle}_" . $ext . ($article->file_type === 'CSV' ? '.csv' : '.txt');
        $content = !empty($article->content) ? $article->content : ($article->description ?? $article->title);

        return response($content, 200, [
            'Content-Type' => $article->file_type === 'CSV' ? 'text/csv' : 'text/plain; charset=UTF-8',
            'Content-Disposition' => "attachment; filename=\"{$filename}\"",
        ]);
    }

    /**
     * Helper to extract text from an uploaded file based on its extension.
     */
    protected function extractTextFromFile($file, string $ext): string
    {
        $filePath = $file->getRealPath();
        if ($ext === 'csv') {
            $content = file_get_contents($filePath);
            $content = preg_replace('/^\xEF\xBB\xBF/', '', $content);
            $firstLine = strtok($content, "\r\n");
            $commaCount = substr_count($firstLine, ',');
            $semicolonCount = substr_count($firstLine, ';');
            $delimiter = ($semicolonCount > $commaCount) ? ';' : ',';

            $stream = fopen('php://memory', 'r+');
            fwrite($stream, $content);
            rewind($stream);
            $header = null;
            $rows = [];
            while (($row = fgetcsv($stream, 0, $delimiter)) !== false) {
                if ($header === null) {
                    $header = array_map(fn($col) => strtolower(trim(preg_replace('/[^a-zA-Z0-9_]/', '_', (string) $col))), $row);
                    continue;
                }
                if (empty(array_filter($row, fn($v) => trim((string)$v) !== ''))) {
                    continue;
                }
                $rowAssoc = [];
                foreach ($header as $idx => $colName) {
                    $rowAssoc[$colName] = isset($row[$idx]) ? trim((string)$row[$idx]) : '';
                }
                $rows[] = $rowAssoc;
            }
            fclose($stream);

            if (!empty($rows)) {
                $steps = [];
                $symptoms = '';
                $warning = '';
                $verify = '';
                $prerequisites = '';
                foreach ($rows as $r) {
                    $s = trim($r['steps'] ?? $r['step'] ?? $r['procedure'] ?? $r['solution'] ?? '');
                    if (!empty($s)) $steps[] = $s;
                    $sym = trim($r['symptoms'] ?? $r['symptom'] ?? $r['problem'] ?? '');
                    if (!empty($sym) && !str_contains($symptoms, $sym)) $symptoms .= ($symptoms ? "\n" : '') . $sym;
                    $warn = trim($r['warning'] ?? $r['warnings'] ?? $r['caution'] ?? '');
                    if (!empty($warn) && !str_contains($warning, $warn)) $warning .= ($warning ? "\n" : '') . $warn;
                    $v = trim($r['verify'] ?? $r['verification'] ?? '');
                    if (!empty($v) && !str_contains($verify, $v)) $verify .= ($verify ? "\n" : '') . $v;
                    $pre = trim($r['prerequisites'] ?? $r['prerequisite'] ?? '');
                    if (!empty($pre) && !str_contains($prerequisites, $pre)) $prerequisites .= ($prerequisites ? "\n" : '') . $pre;
                }
                $blocks = [];
                if (!empty($symptoms)) $blocks[] = "Symptoms / Problem Description:\n{$symptoms}";
                if (!empty($prerequisites)) $blocks[] = "Prerequisites & Tools:\n{$prerequisites}";
                if (!empty($steps)) $blocks[] = "Troubleshooting Steps:\n" . implode("\n", $steps);
                if (!empty($verify)) $blocks[] = "Verification:\n{$verify}";
                if (!empty($warning)) $blocks[] = "Safety & Operational Warnings:\n{$warning}";
                return implode("\n\n", $blocks);
            }
            return $content;
        }

        if ($ext === 'docx') {
            if (class_exists('ZipArchive')) {
                $zip = new \ZipArchive();
                if ($zip->open($filePath) === true) {
                    $xml = $zip->getFromName('word/document.xml');
                    $zip->close();
                    if ($xml !== false) {
                        $xml = str_replace(['</w:p>', '</w:r>'], ["\n", ' '], $xml);
                        return trim(strip_tags($xml));
                    }
                }
            }
        }

        if ($ext === 'txt') {
            return (string) file_get_contents($filePath);
        }

        if ($ext === 'pdf') {
            $raw = file_get_contents($filePath);
            if (preg_match_all('/\((.*?)\)\s*T[jJ]/s', $raw, $matches)) {
                $extracted = implode(' ', $matches[1]);
                if (mb_strlen(trim($extracted)) > 20) {
                    return trim($extracted);
                }
            }
        }

        return '';
    }

    /**
     * POST /api/articles/scan-file
     * Scan any uploaded knowledge document with ClamAV before proceeding.
     */
    public function scanFile(Request $request): JsonResponse
    {
        $auth = $this->resolveActor($request);
        if (!$auth['is_super_admin']) {
            return response()->json(['success' => false, 'message' => 'Forbidden: Only Super Administrators can upload documents.'], 403);
        }

        $request->validate([
            'file' => 'required|file|max:10240', // 10MB limit
        ]);

        $file = $request->file('file');
        $filePath = $file->getRealPath();

        try {
            $scanResult = $this->scanner->scanDetails($filePath);
        } catch (\Throwable $e) {
            Log::error('ClamAV scan error during knowledge base upload: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Unable to complete antivirus inspection: ' . $e->getMessage(),
            ], 500);
        }

        if (!$scanResult['clean']) {
            Log::warning('Malware detected in Knowledge Base file upload', [
                'threat' => $scanResult['threat'],
                'file' => $file->getClientOriginalName(),
                'actor' => $auth['actor'],
            ]);

            return response()->json([
                'success' => false,
                'error_code' => 'MALWARE_DETECTED',
                'threat' => $scanResult['threat'] ?? 'Malware.Detected',
                'message' => 'Security Alert: File failed ClamAV antivirus inspection and was rejected.',
            ], 422);
        }

        return response()->json([
            'success' => true,
            'message' => 'File passed ClamAV antivirus verification.',
            'data' => [
                'clean' => true,
                'name' => $file->getClientOriginalName(),
                'size' => $file->getSize(),
            ],
        ]);
    }

    /**
     * POST /api/articles/import-csv
     * Stream CSV through ClamAV, parse rows, and automatically create and index KbArticles.
     */
    public function importCsv(Request $request): JsonResponse
    {
        $auth = $this->resolveActor($request);
        if (!$auth['is_super_admin']) {
            return response()->json(['success' => false, 'message' => 'Forbidden: Only Super Administrators can import articles.'], 403);
        }

        $request->validate([
            'file' => 'required|file|max:10240', // 10MB limit
        ]);

        $file = $request->file('file');
        $filePath = $file->getRealPath();
        $actor = $auth['actor'];

        // 1. Mandatory ClamAV Antivirus Daemon Inspection
        try {
            $scanResult = $this->scanner->scanDetails($filePath);
        } catch (\Throwable $e) {
            Log::error('ClamAV scan failure during CSV import: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Antivirus scan service error: ' . $e->getMessage(),
            ], 500);
        }

        if (!$scanResult['clean']) {
            Log::warning('ClamAV intercepted infected CSV knowledge import', [
                'threat' => $scanResult['threat'],
                'file' => $file->getClientOriginalName(),
                'actor' => $actor,
            ]);

            return response()->json([
                'success' => false,
                'error_code' => 'MALWARE_DETECTED',
                'threat' => $scanResult['threat'] ?? 'Malware.Detected',
                'message' => 'Security Alert: CSV file failed ClamAV antivirus inspection and was rejected.',
            ], 422);
        }

        // 2. Read and parse CSV file
        $content = file_get_contents($filePath);
        if ($content === false || trim($content) === '') {
            return response()->json(['success' => false, 'message' => 'Uploaded CSV file is empty.'], 422);
        }

        // Strip UTF-8 BOM if present
        $content = preg_replace('/^\xEF\xBB\xBF/', '', $content);

        // Detect delimiter (comma vs semicolon)
        $firstLine = strtok($content, "\r\n");
        $commaCount = substr_count($firstLine, ',');
        $semicolonCount = substr_count($firstLine, ';');
        $delimiter = ($semicolonCount > $commaCount) ? ';' : ',';

        // Parse lines
        $stream = fopen('php://memory', 'r+');
        fwrite($stream, $content);
        rewind($stream);

        $header = null;
        $rows = [];
        while (($row = fgetcsv($stream, 0, $delimiter)) !== false) {
            if ($header === null) {
                $header = array_map(fn($col) => strtolower(trim(preg_replace('/[^a-zA-Z0-9_]/', '_', (string) $col))), $row);
                continue;
            }

            if (empty(array_filter($row, fn($v) => trim((string)$v) !== ''))) {
                continue; // Skip empty rows
            }

            // Combine into associative array
            $rowAssoc = [];
            foreach ($header as $idx => $colName) {
                $rowAssoc[$colName] = isset($row[$idx]) ? trim((string)$row[$idx]) : '';
            }
            $rows[] = $rowAssoc;
        }
        fclose($stream);

        if (empty($rows)) {
            return response()->json(['success' => false, 'message' => 'No valid data rows found in the CSV file.'], 422);
        }

        $importedArticles = [];
        $failedCount = 0;
        $indexFailedCount = 0;
        $groupedArticles = [];
        $currentArticle = null;

        // Group rows so that multi-row steps (Option B) merge into their parent article
        foreach ($rows as $index => $row) {
            $rawTitle = trim($row['title'] ?? $row['document_title'] ?? $row['name'] ?? $row['subject'] ?? '');
            $rawCategory = trim($row['category'] ?? $row['category_name'] ?? '');
            $rawMachine = trim($row['machine_model'] ?? $row['machine'] ?? $row['model'] ?? $row['device'] ?? '');
            $rawVersion = trim($row['version'] ?? $row['ver'] ?? '1.0');
            $rawTags = trim($row['tags'] ?? $row['tag'] ?? $row['keywords'] ?? '');
            $rawSymptoms = trim($row['symptoms'] ?? $row['symptom'] ?? $row['problem'] ?? $row['issue'] ?? '');
            $rawPrerequisites = trim($row['prerequisites'] ?? $row['prerequisite'] ?? $row['requirements'] ?? '');
            $rawSteps = trim($row['steps'] ?? $row['step'] ?? $row['procedure'] ?? $row['solution'] ?? $row['resolution'] ?? '');
            $rawVerify = trim($row['verify'] ?? $row['verification'] ?? $row['validation'] ?? '');
            $rawWarning = trim($row['warning'] ?? $row['warnings'] ?? $row['caution'] ?? '');
            $rawSopId = trim($row['id'] ?? $row['sop_id'] ?? '');

            // Check if this row is a continuation step of the current article:
            // Either the Title is empty OR it matches the current article's title (formatted or raw)
            $isContinuation = ($currentArticle !== null) && (
                empty($rawTitle) ||
                (strcasecmp($rawTitle, $currentArticle['title']) === 0) ||
                (strcasecmp($rawTitle, $currentArticle['raw_title'] ?? '') === 0)
            );

            if ($isContinuation) {
                if (!empty($rawSteps)) {
                    $currentArticle['steps'][] = $rawSteps;
                }
                if (!empty($rawSymptoms) && !str_contains($currentArticle['symptoms'], $rawSymptoms)) {
                    $currentArticle['symptoms'] .= "\n" . $rawSymptoms;
                }
                if (!empty($rawWarning) && !str_contains($currentArticle['warning'], $rawWarning)) {
                    $currentArticle['warning'] .= "\n" . $rawWarning;
                }
                if (!empty($rawVerify) && !str_contains($currentArticle['verify'], $rawVerify)) {
                    $currentArticle['verify'] .= "\n" . $rawVerify;
                }
            } else {
                if ($currentArticle !== null) {
                    $groupedArticles[] = $currentArticle;
                }

                if (empty($rawTitle) && empty($rawSteps) && empty($rawSymptoms)) {
                    continue;
                }

                $title = $rawTitle;
                if (empty($title)) {
                    $title = !empty($rawSymptoms) ? mb_substr($rawSymptoms, 0, 70) : "Procedure " . (count($groupedArticles) + 1);
                }
                if (!empty($rawSopId) && !str_contains($title, $rawSopId)) {
                    $title = "[{$rawSopId}] {$title}";
                }

                $currentArticle = [
                    'raw_title' => $rawTitle,
                    'title' => $title,
                    'category' => !empty($rawCategory) ? $rawCategory : 'Troubleshooting Guides',
                    'machine' => !empty($rawMachine) ? $rawMachine : null,
                    'version' => !empty($rawVersion) ? $rawVersion : '1.0',
                    'tags' => $rawTags,
                    'symptoms' => $rawSymptoms,
                    'prerequisites' => $rawPrerequisites,
                    'steps' => !empty($rawSteps) ? [$rawSteps] : [],
                    'verify' => $rawVerify,
                    'warning' => $rawWarning,
                ];
            }
        }

        if ($currentArticle !== null) {
            $groupedArticles[] = $currentArticle;
        }

        foreach ($groupedArticles as $item) {
            $title = $item['title'];
            $category = $item['category'];
            $machine = $item['machine'];
            $version = $item['version'];
            $tagsRaw = $item['tags'];
            $symptoms = $item['symptoms'];
            $prerequisites = $item['prerequisites'];
            $verify = $item['verify'];
            $warning = $item['warning'];

            // Assemble steps cleanly whether from single row or multiple rows
            $stepLines = [];
            foreach ($item['steps'] as $st) {
                if (str_contains($st, ' | ')) {
                    $stepLines[] = str_replace(' | ', "\n", $st);
                } else {
                    $stepLines[] = $st;
                }
            }
            $formattedSteps = implode("\n", $stepLines);

            // Build structured article content
            $contentBlocks = [];
            if (!empty($symptoms)) {
                $contentBlocks[] = "Symptoms / Problem Description:\n{$symptoms}";
            }
            if (!empty($prerequisites)) {
                $contentBlocks[] = "Prerequisites & Tools:\n{$prerequisites}";
            }
            if (!empty($formattedSteps)) {
                $contentBlocks[] = "Troubleshooting Steps:\n{$formattedSteps}";
            }
            if (!empty($verify)) {
                $contentBlocks[] = "Verification:\n{$verify}";
            }
            if (!empty($warning)) {
                $contentBlocks[] = "Safety & Operational Warnings:\n{$warning}";
            }

            $fullContent = implode("\n\n", $contentBlocks);
            $description = !empty($symptoms) ? mb_substr($symptoms, 0, 250) : "SOP imported from CSV";

            // Parse tags
            $tags = [];
            if (!empty($tagsRaw)) {
                $tags = array_values(array_filter(array_map('trim', preg_split('/[;,]/', $tagsRaw))));
            }

            $historyEntry = [
                'id' => (string) Str::uuid(),
                'type' => 'created',
                'timestamp' => now()->format('Y-m-d H:i:s'),
                'actor' => $actor,
                'action' => 'Bulk Imported from CSV',
                'details' => "Imported from {$file->getClientOriginalName()}.",
            ];

            $article = KbArticle::create([
                'title' => mb_substr($title, 0, 255),
                'category' => mb_substr($category, 0, 100),
                'machine' => !empty($machine) ? mb_substr($machine, 0, 100) : null,
                'version' => mb_substr($version, 0, 20),
                'file_type' => 'CSV',
                'uploaded_by' => $actor,
                'size' => sprintf('%.1f KB', max(strlen($fullContent) / 1024, 0.1)),
                'status' => 'Draft',
                'processing_status' => 'Draft',
                'tags' => $tags,
                'description' => $description,
                'content' => $fullContent,
                'history' => [$historyEntry],
            ]);

            // Index chunks and embeddings (inactive, since imports start as Draft). A failure marks
            // only this article 'Indexing failed' with its reason; the import carries on.
            if (!empty($fullContent)) {
                try {
                    $this->ragService->indexArticle($article);
                } catch (EmbeddingFailedException|IndexingInProgressException $e) {
                    $indexFailedCount++;
                }
            }

            $importedArticles[] = $this->formatArticle($article->fresh());
        }

        return response()->json([
            'success' => true,
            'message' => "Successfully imported " . count($importedArticles) . " knowledge articles from CSV.",
            'count' => count($importedArticles),
            'skipped' => $failedCount,
            'index_failed' => $indexFailedCount,
            'data' => $importedArticles,
        ], 201);
    }

    /**
     * GET /api/articles/template-csv
     * Returns a clean, user-friendly 7-column CSV template for Knowledge Base SOPs.
     */
    public function downloadTemplateCsv(): \Symfony\Component\HttpFoundation\StreamedResponse
    {
        $headers = [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="knowledge_base_template.csv"',
            'Pragma' => 'no-cache',
            'Cache-Control' => 'must-revalidate, post-check=0, pre-check=0',
            'Expires' => '0',
        ];

        return response()->stream(function () {
            $handle = fopen('php://output', 'w');
            // Write UTF-8 BOM for Microsoft Excel compatibility
            fprintf($handle, chr(0xEF).chr(0xBB).chr(0xBF));

            // Clean, user-friendly 7 columns
            fputcsv($handle, ['Title', 'Steps', 'Symptoms', 'Machine_Model', 'Category', 'Warning', 'Tags']);

            // 1 Simple, easy-to-understand sample row
            fputcsv($handle, [
                'Printer Paper Jam Error E-03',
                '1. Turn off the printer power switch. | 2. Open Front Cover A. | 3. Gently remove jammed paper in feed direction. | 4. Close cover and turn on power.',
                'Error Code E-03 on screen; paper stuck in feed rollers',
                'Canon X120',
                'Troubleshooting Guides',
                'Turn off power before touching internal rollers.',
                'printer;paper jam;e-03'
            ]);

            fclose($handle);
        }, 200, $headers);
    }
}

