<?php

namespace Tests\Feature;

use App\Events\ArticleArchived;
use App\Events\ArticlePublished;
use App\Models\KbArticle;
use App\Models\KbChunk;
use App\Models\KbEmbedding;
use App\Services\RagService;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

class KbArticlePublishArchiveTest extends TestCase
{
    use DatabaseTransactions;

    protected RagService $ragService;

    protected function setUp(): void
    {
        parent::setUp();
        $this->ragService = app(RagService::class);
    }

    /**
     * Helper to create a Super Admin authorization header.
     */
    protected function superAdminHeaders(string $actorName = 'Super Admin'): array
    {
        // Spec 0036 (AC-11): identity comes from a verified token, never from an unsigned payload.
        $this->actingAsSuperAdmin($actorName);

        return ['Accept' => 'application/json'];
    }

    /**
     * Helper to create regular employee authorization header.
     */
    protected function employeeHeaders(): array
    {
        $this->actingAsEmployee();

        return ['Accept' => 'application/json'];
    }

    /**
     * Requirement: Super Admin can publish a Draft article that has successfully processed embeddings.
     * State updates to Published, published_at is set, existing embeddings are activated,
     * version history captures timestamp and acting Super Admin, and ArticlePublished event is published.
     */
    public function test_superadmin_can_publish_article_with_processed_embeddings(): void
    {
        Event::fake([ArticlePublished::class]);

        $article = KbArticle::create([
            'title' => 'Canon X120 Troubleshooting Guidelines',
            'category' => 'Troubleshooting Guides',
            'machine' => 'Canon X120',
            'version' => '1.0',
            'status' => 'Draft',
            'processing_status' => 'Ready for AI Search',
            'content' => 'Canon X120 printer paper jam error E-03 resolution procedures.',
        ]);

        // Index chunks and embeddings with is_active = false
        $this->ragService->indexArticle($article);
        KbEmbedding::where('article_id', $article->id)->update(['is_active' => false]);

        $this->assertFalse(
            KbEmbedding::where('article_id', $article->id)->where('is_active', true)->exists(),
            'Pre-condition: Embeddings should be inactive before publishing.'
        );

        $response = $this->postJson(
            "/api/articles/{$article->id}/publish",
            ['actor' => 'Alice SuperAdmin'],
            $this->superAdminHeaders('Alice SuperAdmin')
        );

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
                'data' => [
                    'id' => $article->id,
                    'status' => 'Ready', // Frontend status mapped to Ready when Published
                    'publishState' => 'Published',
                    'publish_state' => 'Published',
                ],
            ]);

        $article->refresh();
        $this->assertEquals('Published', $article->status);
        $this->assertNotNull($article->published_at);

        // Verify embeddings were activated
        $activeEmbeddingsCount = KbEmbedding::where('article_id', $article->id)->where('is_active', true)->count();
        $this->assertGreaterThan(0, $activeEmbeddingsCount);

        // Verify version history captures timestamp and acting Super Admin
        $history = $article->history;
        $this->assertNotEmpty($history);
        $lastEntry = end($history);
        $this->assertEquals('published', $lastEntry['type']);
        $this->assertEquals('Alice SuperAdmin', $lastEntry['actor']);
        $this->assertNotNull($lastEntry['timestamp']);

        // Verify event published to event bus
        Event::assertDispatched(ArticlePublished::class, function (ArticlePublished $event) use ($article) {
            return $event->article->id === $article->id
                && $event->actor === 'Alice SuperAdmin'
                && $event->article->status === 'Published';
        });
    }

    /**
     * Requirement: Check that blocks publishing when the article has no successfully processed embeddings,
     * returning a clear error.
     */
    public function test_check_blocks_publishing_when_article_has_no_processed_embeddings(): void
    {
        Event::fake([ArticlePublished::class]);

        // Article has no embeddings (empty chunk/embedding table)
        $article = KbArticle::create([
            'title' => 'Unprocessed Document Without Embeddings',
            'category' => 'FAQs',
            'status' => 'Draft',
            'processing_status' => 'Processing', // or Failed
            'content' => null,
        ]);

        $this->assertEquals(0, KbEmbedding::where('article_id', $article->id)->count());

        $response = $this->postJson(
            "/api/articles/{$article->id}/publish",
            ['actor' => 'Super Admin'],
            $this->superAdminHeaders()
        );

        // Spec 0036 (AC-3, AC-12): publish never indexes; an unindexed article is refused.
        $response->assertStatus(422)
            ->assertJson([
                'success' => false,
                'error_code' => 'NOT_INDEXED',
            ]);
        $this->assertStringContainsString('not indexed for AI search', $response->json('message'));
        $this->assertSame(0, KbEmbedding::where('article_id', $article->id)->count(), 'Publish must not index.');

        $article->refresh();
        $this->assertEquals('Draft', $article->status, 'Article status must remain Draft.');
        $this->assertNull($article->published_at);

        // Verify event was NOT dispatched
        Event::assertNotDispatched(ArticlePublished::class);
    }

    /**
     * Requirement: Logic to add an article's existing embeddings to the active index on publish,
     * without re-triggering extraction if the file is unchanged.
     */
    public function test_publish_adds_existing_embeddings_without_retriggering_extraction(): void
    {
        $article = KbArticle::create([
            'title' => 'Epson L3110 Technical Manual',
            'category' => 'User Manuals',
            'machine' => 'Epson L3110',
            'status' => 'Draft',
            'processing_status' => 'Ready for AI Search',
            'content' => 'Epson L3110 EcoTank ink charging procedure, printhead alignment, and driver installation.',
        ]);

        // Initial extraction & embedding generation (inactive, since the article is a Draft)
        $this->ragService->indexArticle($article);
        $this->assertFalse(KbEmbedding::where('article_id', $article->id)->where('is_active', true)->exists());
        $callsBeforePublish = $this->embeddingCallCount();

        $initialChunkIds = KbChunk::where('article_id', $article->id)->pluck('id')->sort()->values()->toArray();
        $initialEmbeddingIds = KbEmbedding::where('article_id', $article->id)->pluck('id')->sort()->values()->toArray();
        $initialChunkCount = count($initialChunkIds);

        $this->assertGreaterThan(0, $initialChunkCount);

        // Publish the article
        $response = $this->postJson(
            "/api/articles/{$article->id}/publish",
            ['actor' => 'Super Admin'],
            $this->superAdminHeaders()
        );

        $response->assertStatus(200);

        // Verify chunks and embeddings were NOT re-created or re-extracted
        $postChunkIds = KbChunk::where('article_id', $article->id)->pluck('id')->sort()->values()->toArray();
        $postEmbeddingIds = KbEmbedding::where('article_id', $article->id)->pluck('id')->sort()->values()->toArray();

        $this->assertEquals($initialChunkIds, $postChunkIds, 'Chunk IDs must remain identical; extraction must NOT be re-triggered.');
        $this->assertEquals($initialEmbeddingIds, $postEmbeddingIds, 'Embedding IDs must remain identical.');

        // Embeddings must now be active
        $activeCount = KbEmbedding::where('article_id', $article->id)->where('is_active', true)->count();
        $this->assertEquals($initialChunkCount, $activeCount, 'All existing embeddings must be activated.');

        // The only embedding call during publish is the probe query, never a chunk re-embed.
        $this->assertSame(1, $this->embeddingCallCount() - $callsBeforePublish, 'Publish embeds only the probe query.');
        $response->assertJsonStructure(['probe' => ['score', 'rank', 'low_retrievability'], 'low_retrievability']);
    }

    /**
     * Requirement: Super Admin can archive an article, removing its embeddings from the active index
     * while keeping the article record, chunks, and file intact.
     * Records version history and dispatches ArticleArchived event.
     */
    public function test_superadmin_can_archive_published_article(): void
    {
        Event::fake([ArticleArchived::class]);

        $article = KbArticle::create([
            'title' => 'Brother MFC Maintenance Guide',
            'category' => 'Maintenance Guides',
            'machine' => 'Brother MFC',
            'status' => 'Draft',
            'processing_status' => 'Ready for AI Search',
            'content' => 'Brother MFC multi-function center maintenance steps and cleaning sequence.',
        ]);

        $this->ragService->indexArticle($article);
        $this->ragService->publishArticle($article);

        // Confirm active
        $this->assertEquals(
            KbEmbedding::where('article_id', $article->id)->count(),
            KbEmbedding::where('article_id', $article->id)->where('is_active', true)->count()
        );

        $chunkCountBeforeArchive = KbChunk::where('article_id', $article->id)->count();

        // Archive the article
        $response = $this->postJson(
            "/api/articles/{$article->id}/archive",
            ['actor' => 'Bob SuperAdmin'],
            $this->superAdminHeaders('Bob SuperAdmin')
        );

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
                'data' => [
                    'id' => $article->id,
                    'status' => 'Archived',
                    'publishState' => 'Archived',
                ],
            ]);

        $article->refresh();
        $this->assertEquals('Archived', $article->status);
        $this->assertNotNull($article->archived_at);

        // Embeddings must be removed from active index (is_active = false)
        $activeEmbeddings = KbEmbedding::where('article_id', $article->id)->where('is_active', true)->count();
        $this->assertEquals(0, $activeEmbeddings, 'All embeddings must be deactivated on archive.');

        // Article record and chunks must remain intact in DB
        $this->assertNotNull(KbArticle::find($article->id), 'Article record must remain intact.');
        $this->assertEquals($chunkCountBeforeArchive, KbChunk::where('article_id', $article->id)->count(), 'Chunks must remain intact.');
        $this->assertEquals($chunkCountBeforeArchive, KbEmbedding::where('article_id', $article->id)->count(), 'Embedding records must remain intact.');

        // Version history captures archive action
        $history = $article->history;
        $lastEntry = end($history);
        $this->assertEquals('archived', $lastEntry['type']);
        $this->assertEquals('Bob SuperAdmin', $lastEntry['actor']);
        $this->assertNotNull($lastEntry['timestamp']);

        // Event dispatched to event bus
        Event::assertDispatched(ArticleArchived::class, function (ArticleArchived $event) use ($article) {
            return $event->article->id === $article->id
                && $event->actor === 'Bob SuperAdmin'
                && $event->article->status === 'Archived';
        });
    }

    /**
     * Requirement: Only Published articles are included in the AI Service's active RAG index query.
     */
    public function test_only_published_articles_included_in_active_rag_query(): void
    {
        // 1. Create a Published article
        $pubArticle = KbArticle::create([
            'title' => 'HP LaserJet Pro Paper Jam Guide',
            'category' => 'Troubleshooting Guides',
            'machine' => 'HP LaserJet Pro',
            'status' => 'Draft',
            'processing_status' => 'Ready for AI Search',
            'content' => 'HP LaserJet Pro paper jam error 13.00.00 clear paper from tray 2 and fuser area.',
        ]);
        $this->ragService->indexArticle($pubArticle);
        $this->ragService->publishArticle($pubArticle);

        // 2. Create a Draft article with similar keywords
        $draftArticle = KbArticle::create([
            'title' => 'Draft Secret Unreleased HP LaserJet Internal Notes',
            'category' => 'Product Specifications',
            'machine' => 'HP LaserJet Pro',
            'status' => 'Draft',
            'processing_status' => 'Ready for AI Search',
            'content' => 'Internal draft notes regarding experimental HP LaserJet Pro paper jam sensor.',
        ]);
        $this->ragService->indexArticle($draftArticle);
        KbEmbedding::where('article_id', $draftArticle->id)->update(['is_active' => false]);

        // 3. Create an Archived article with similar keywords
        $archArticle = KbArticle::create([
            'title' => 'Archived Legacy HP LaserJet Pro Procedure',
            'category' => 'Troubleshooting Guides',
            'machine' => 'HP LaserJet Pro',
            'status' => 'Draft',
            'processing_status' => 'Ready for AI Search',
            'content' => 'Obsolete discontinued HP LaserJet Pro paper jam workaround.',
        ]);
        $this->ragService->indexArticle($archArticle);
        $this->ragService->archiveArticle($archArticle);

        // Query RAG for HP LaserJet paper jam
        $result = $this->ragService->retrieve('HP LaserJet Pro paper jam error 13.00.00', 10);

        $retrievedIds = array_column($result['chunks'], 'article_id');

        $this->assertContains($pubArticle->id, $retrievedIds, 'Published article MUST be included in RAG results.');
        $this->assertNotContains($draftArticle->id, $retrievedIds, 'Draft article MUST NOT be included in RAG results.');
        $this->assertNotContains($archArticle->id, $retrievedIds, 'Archived article MUST NOT be included in RAG results.');

        foreach ($result['chunks'] as $chunk) {
            $this->assertEquals('Published', $chunk['article_status']);
        }
    }

    /**
     * Requirement: Broadcasting contracts and channels for ArticlePublished and ArticleArchived.
     */
    public function test_events_implement_should_broadcast_now(): void
    {
        $article = KbArticle::create([
            'title' => 'Event Broadcast Test Article',
            'category' => 'FAQs',
            'status' => 'Published',
        ]);

        $publishedEvent = new ArticlePublished($article, 'Super Admin');
        $this->assertInstanceOf(ShouldBroadcastNow::class, $publishedEvent);
        $this->assertEquals('article.published', $publishedEvent->broadcastAs());
        $this->assertContains('knowledge-base', array_map(fn ($c) => $c->name, $publishedEvent->broadcastOn()));

        $archivedEvent = new ArticleArchived($article, 'Super Admin');
        $this->assertInstanceOf(ShouldBroadcastNow::class, $archivedEvent);
        $this->assertEquals('article.archived', $archivedEvent->broadcastAs());
        $this->assertContains('knowledge-base', array_map(fn ($c) => $c->name, $archivedEvent->broadcastOn()));
    }

    /**
     * Cybersec Authorization check: Non-Super-Admin users cannot publish or archive articles.
     */
    public function test_non_superadmin_cannot_publish_or_archive_articles(): void
    {
        $article = KbArticle::create([
            'title' => 'Restricted Admin Article',
            'category' => 'User Manuals',
            'status' => 'Draft',
            'processing_status' => 'Ready for AI Search',
            'content' => 'Some content',
        ]);
        $this->ragService->indexArticle($article);

        // Attempt publish with regular technician credentials
        $response = $this->postJson(
            "/api/articles/{$article->id}/publish",
            ['actor' => 'Regular Employee'],
            $this->employeeHeaders()
        );
        $response->assertStatus(403);

        // Attempt archive with regular technician credentials
        $response = $this->postJson(
            "/api/articles/{$article->id}/archive",
            ['actor' => 'Regular Employee'],
            $this->employeeHeaders()
        );
        $response->assertStatus(403);
    }
}
