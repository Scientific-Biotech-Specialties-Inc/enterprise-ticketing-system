<?php

namespace Tests\Feature;

use Tests\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Log;
use App\Models\KbArticle;
use App\Models\KbChunk;
use App\Models\KbEmbedding;
use App\Services\RagService;
use App\Services\GeminiService;

class KnowledgeBaseRagTest extends TestCase
{
    use DatabaseTransactions;

    protected RagService $ragService;

    protected function setUp(): void
    {
        parent::setUp();
        $this->ragService = app(RagService::class);
    }

    /**
     * Requirement 1: Ensure RAG index query filters strictly to Published articles.
     * Draft and Archived articles must NEVER be retrieved.
     */
    public function test_rag_index_query_strictly_filters_to_published_articles()
    {
        $published = KbArticle::create([
            'title' => 'Canon X120 Official Quick Guide',
            'category' => 'User Manuals',
            'machine' => 'Canon X120',
            'status' => 'Published',
        ]);
        $this->ragService->indexArticle($published, 'Canon X120 tray loading guidelines and toner replacement.');
        $this->ragService->publishArticle($published);

        $draft = KbArticle::create([
            'title' => 'Internal Draft Confidential Spec',
            'category' => 'Product Specifications',
            'machine' => 'Canon X120',
            'status' => 'Draft',
        ]);
        $this->ragService->indexArticle($draft, 'Confidential internal Canon X120 unreleased hardware specifications.');
        KbEmbedding::where('article_id', $draft->id)->update(['is_active' => false]);

        $archived = KbArticle::create([
            'title' => 'Decommissioned Canon X120 Old Workaround',
            'category' => 'Troubleshooting Guides',
            'machine' => 'Canon X120',
            'status' => 'Archived',
        ]);
        $this->ragService->indexArticle($archived, 'Old Canon X120 legacy firmware bypass instructions.');
        $this->ragService->archiveArticle($archived);

        // Retrieve with query targeting Canon X120
        $results = $this->ragService->retrieve('How do I replace toner in Canon X120?', 10, 0.10);

        $chunks = $results['chunks'] ?? $results;
        $retrievedArticleIds = array_column($chunks, 'article_id');

        $this->assertContains($published->id, $retrievedArticleIds, 'Published article should be retrieved.');
        $this->assertNotContains($draft->id, $retrievedArticleIds, 'Draft article must NEVER be retrieved by RAG.');
        $this->assertNotContains($archived->id, $retrievedArticleIds, 'Archived article must NEVER be retrieved by RAG.');

        foreach ($chunks as $item) {
            $this->assertEquals('Published', $item['article_status'], 'All retrieved items must strictly be Published.');
        }
    }

    /**
     * Requirement 2: Ensure archiving an article removes its embeddings from active index immediately.
     */
    public function test_archiving_article_removes_embeddings_from_active_index_immediately()
    {
        $article = KbArticle::create([
            'title' => 'Network Spooler Diagnostic Manual',
            'category' => 'Troubleshooting Guides',
            'status' => 'Published',
        ]);
        $this->ragService->indexArticle($article, 'Steps to restart Windows print spooler and reset local queue.');
        $this->ragService->publishArticle($article);

        // Verify active in index
        $this->assertTrue(
            KbEmbedding::where('article_id', $article->id)->where('is_active', true)->exists(),
            'Embeddings should be active when published.'
        );

        // Archive article
        $this->ragService->archiveArticle($article);

        // Embeddings must be immediately deactivated
        $activeCount = KbEmbedding::where('article_id', $article->id)->where('is_active', true)->count();
        $this->assertEquals(0, $activeCount, 'Archiving must deactivate all embeddings immediately.');
        $this->assertEquals('Archived', $article->fresh()->status);

        // Query RAG - must not return archived article
        $results = $this->ragService->retrieve('restart Windows print spooler', 5, 0.10);
        $chunks = $results['chunks'] ?? $results;
        $retrievedArticleIds = array_column($chunks, 'article_id');
        $this->assertNotContains($article->id, $retrievedArticleIds, 'Archived article embeddings must not be in active search index.');
    }

    /**
     * Requirement 3: Ensure permanently deleting an article removes its embeddings immediately.
     */
    public function test_permanently_deleting_article_removes_embeddings_immediately()
    {
        $article = KbArticle::create([
            'title' => 'Temporary Obsolete Guide',
            'category' => 'Maintenance Guides',
            'status' => 'Published',
        ]);
        $this->ragService->indexArticle($article, 'Unique obsolete maintenance details for deletion test.');
        $this->ragService->publishArticle($article);

        $articleId = $article->id;

        // Permanently delete article
        $this->ragService->deleteArticle($article);

        // Verify database records are purged
        $this->assertNull(KbArticle::find($articleId), 'Article record should be deleted.');
        $this->assertEquals(0, KbChunk::where('article_id', $articleId)->count(), 'All chunks must be purged.');
        $this->assertEquals(0, KbEmbedding::where('article_id', $articleId)->count(), 'All embeddings must be purged.');

        // Query RAG - must not return deleted article
        $results = $this->ragService->retrieve('Unique obsolete maintenance details', 5, 0.10);
        $chunks = $results['chunks'] ?? $results;
        $retrievedArticleIds = array_column($chunks, 'article_id');
        $this->assertNotContains($articleId, $retrievedArticleIds);
    }

    /**
     * Requirement 4: Ensure publishing an article adds its embeddings back into the active index immediately.
     */
    public function test_publishing_article_adds_embeddings_back_into_active_index_immediately()
    {
        $article = KbArticle::create([
            'title' => 'Epson L3110 Setup Manual',
            'category' => 'User Manuals',
            'status' => 'Draft',
        ]);
        $this->ragService->indexArticle($article, 'Epson L3110 initial ink charging and wireless Wi-Fi setup procedure.');

        // Verify inactive initially
        $this->assertEquals(
            0,
            KbEmbedding::where('article_id', $article->id)->where('is_active', true)->count(),
            'Draft article embeddings must not be active.'
        );

        // Publish article
        $this->ragService->publishArticle($article);

        // Verify active immediately
        $activeCount = KbEmbedding::where('article_id', $article->id)->where('is_active', true)->count();
        $this->assertGreaterThan(0, $activeCount, 'Publishing must activate embeddings immediately.');
        $this->assertEquals('Published', $article->fresh()->status);

        // Query RAG - must now return newly published article
        $results = $this->ragService->retrieve('Epson L3110 ink charging setup', 5, 0.10);
        $chunks = $results['chunks'] ?? $results;
        $retrievedArticleIds = array_column($chunks, 'article_id');
        $this->assertContains($article->id, $retrievedArticleIds, 'Newly published article must be immediately searchable.');
    }

    /**
     * Requirement 5: Fallback response path when no Published article matches, directing toward ticket creation.
     */
    public function test_fallback_response_path_when_no_published_article_matches()
    {
        $geminiService = app(GeminiService::class);

        // Query for something completely unrelated that has no published articles
        $conversationHistory = [
            ['role' => 'user', 'content' => 'How do I repair the hydraulic space rocket thrusters on Mars?']
        ];

        $response = $geminiService->generateResponse($conversationHistory);

        $this->assertArrayHasKey('content', $response);
        $this->assertArrayHasKey('escalate', $response);
        $this->assertArrayHasKey('ticket_data', $response);

        // When no published KB matches, it must direct to ticket escalation
        $this->assertTrue($response['escalate'], 'Must escalate when no published articles match.');
        $this->assertFalse($response['rag_matched'], 'rag_matched must be false when no articles match.');
        $this->assertNotEmpty($response['ticket_data']['title']);
        $this->assertNotEmpty($response['ticket_data']['description']);
    }

    /**
     * Requirement 6: Monitoring/logging detects if non-Published article content is ever returned.
     */
    public function test_monitoring_alert_logged_if_non_published_article_is_detected()
    {
        Log::shouldReceive('alert')
            ->once()
            ->withArgs(function ($message, $context) {
                return str_contains($message, 'SECURITY ALERT: Non-published article content intercepted in RAG retrieval')
                    && isset($context['status'])
                    && $context['status'] === 'Draft';
            });

        // Still allow other log levels
        Log::shouldReceive('info')->zeroOrMoreTimes();
        Log::shouldReceive('warning')->zeroOrMoreTimes();
        Log::shouldReceive('error')->zeroOrMoreTimes();
        Log::shouldReceive('debug')->zeroOrMoreTimes();

        $draft = KbArticle::create([
            'title' => 'Leaked Draft Document',
            'category' => 'FAQs',
            'status' => 'Draft',
        ]);

        // Simulate unapproved candidate chunk reaching defense-in-depth safety check
        $unapprovedCandidate = [
            'article_id' => $draft->id,
            'article_title' => $draft->title,
            'chunk_id' => 9999,
            'score' => 0.95,
        ];

        $verified = $this->ragService->verifyPublishedChunks([$unapprovedCandidate], 'Leaked draft secrets');
        $this->assertEmpty($verified, 'Unapproved draft chunk must be dropped by safety verification.');
    }

    /**
     * Requirement 7: Verify query performance to ensure Published-only filter does not push response times past 5s.
     */
    public function test_rag_query_performance_under_five_seconds()
    {
        $startTime = microtime(true);

        $results = $this->ragService->retrieve('General printer error troubleshooting', 5);

        $durationMs = (microtime(true) - $startTime) * 1000;

        $this->assertLessThan(5000, $durationMs, "RAG retrieval took {$durationMs}ms, which exceeds the 5000ms threshold.");
    }
}
