<?php

namespace Tests\Feature;

use App\Events\ArticleDeleted;
use App\Models\KbArticle;
use App\Models\KbAuditLog;
use App\Models\KbChunk;
use App\Models\KbEmbedding;
use App\Services\RagService;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class KbArticleHardDeleteTest extends TestCase
{
    use DatabaseTransactions;

    protected RagService $ragService;

    protected function setUp(): void
    {
        parent::setUp();
        $this->ragService = app(RagService::class);
        Storage::fake('local');
        Storage::fake('public');
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
     * Requirement 1 & 3: Hard-delete permanently removes the article's database record
     * and immediately removes all chunks and embeddings from the active RAG index.
     */
    public function test_hard_delete_permanently_removes_article_and_rag_embeddings(): void
    {
        Event::fake([ArticleDeleted::class]);

        $article = KbArticle::create([
            'title' => 'Canon X120 Obsolete Workaround',
            'category' => 'Troubleshooting Guides',
            'machine' => 'Canon X120',
            'version' => '1.0',
            'status' => 'Published',
            'processing_status' => 'Ready for AI Search',
            'content' => 'Legacy workaround steps for obsolete Canon X120 firmware.',
        ]);

        $this->ragService->indexArticle($article);
        $this->ragService->publishArticle($article);

        $articleId = $article->id;

        // Verify pre-condition: chunks and active embeddings exist
        $this->assertGreaterThan(0, KbChunk::where('article_id', $articleId)->count());
        $this->assertGreaterThan(0, KbEmbedding::where('article_id', $articleId)->where('is_active', true)->count());

        // Perform hard-delete via endpoint
        $response = $this->deleteJson(
            "/api/articles/{$articleId}",
            ['actor' => 'Super Admin'],
            $this->superAdminHeaders()
        );

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
            ]);

        // Assert article database record is permanently deleted
        $this->assertNull(KbArticle::find($articleId), 'Article record must be completely removed from database.');

        // Assert chunks and embeddings are immediately purged
        $this->assertEquals(0, KbChunk::where('article_id', $articleId)->count(), 'Chunks must be purged.');
        $this->assertEquals(0, KbEmbedding::where('article_id', $articleId)->count(), 'Embeddings must be purged.');

        // Query RAG: article content must not be returned
        $retrieval = $this->ragService->retrieve('obsolete Canon X120 firmware', 5, 0.10);
        $chunks = $retrieval['chunks'] ?? $retrieval;
        $retrievedIds = array_column($chunks, 'article_id');
        $this->assertNotContains($articleId, $retrievedIds, 'Deleted article must not appear in RAG results.');
    }

    /**
     * Requirement 2: Permanent deletion of the article's stored file from file storage.
     */
    public function test_permanent_deletion_removes_stored_file_from_storage(): void
    {
        Event::fake([ArticleDeleted::class]);

        $testFilePath = 'kb_documents/canon_x120_manual_v1.pdf';
        Storage::disk('local')->put($testFilePath, '%PDF-1.4 Mock document content');

        $this->assertTrue(Storage::disk('local')->exists($testFilePath), 'File should exist before delete.');

        $article = KbArticle::create([
            'title' => 'Canon X120 Stored File Manual',
            'category' => 'User Manuals',
            'machine' => 'Canon X120',
            'status' => 'Draft',
            'processing_status' => 'Ready for AI Search',
            'file_path' => $testFilePath,
            'content' => 'Mock manual content.',
        ]);

        $response = $this->deleteJson(
            "/api/articles/{$article->id}",
            ['actor' => 'Super Admin'],
            $this->superAdminHeaders()
        );

        $response->assertStatus(200);

        // Assert file is permanently deleted from storage
        $this->assertFalse(
            Storage::disk('local')->exists($testFilePath),
            'Article file must be permanently removed from storage.'
        );
    }

    /**
     * Requirement 4: Check that blocks deletion while article has an in-progress process,
     * returning a clear 409 error if blocked.
     */
    public function test_blocks_deletion_while_processing_in_progress(): void
    {
        $article = KbArticle::create([
            'title' => 'Epson L3110 Mid-Extraction Document',
            'category' => 'Product Specifications',
            'status' => 'Draft',
            'processing_status' => 'Processing', // In-progress state
            'content' => 'In-flight content extraction.',
        ]);

        $response = $this->deleteJson(
            "/api/articles/{$article->id}",
            ['actor' => 'Super Admin'],
            $this->superAdminHeaders()
        );

        $response->assertStatus(409)
            ->assertJson([
                'success' => false,
                'error_code' => 'PROCESS_IN_PROGRESS',
            ]);

        // Assert article still exists in database
        $this->assertNotNull(KbArticle::find($article->id), 'Article must NOT be deleted while processing is active.');
    }

    /**
     * Requirement 5: Audit logging service records deletion event independently of the article record itself,
     * so the log entry survives the delete.
     */
    public function test_audit_logging_records_deletion_independently_and_survives_delete(): void
    {
        Event::fake([ArticleDeleted::class]);

        $article = KbArticle::create([
            'title' => 'Audited Deletion Article',
            'category' => 'FAQs',
            'status' => 'Published',
            'processing_status' => 'Ready for AI Search',
            'content' => 'Content to be deleted with audit trail.',
        ]);

        $articleId = $article->id;
        $title = $article->title;

        $response = $this->deleteJson(
            "/api/articles/{$articleId}",
            ['actor' => 'Admin User'],
            $this->superAdminHeaders('Admin User')
        );

        $response->assertStatus(200);

        // Article record is hard-deleted
        $this->assertNull(KbArticle::find($articleId));

        // Independent audit log entry MUST exist and survive
        $auditLog = KbAuditLog::where('article_id', $articleId)
            ->where('action', 'Deleted')
            ->first();

        $this->assertNotNull($auditLog, 'Independent audit log must exist after article is hard-deleted.');
        $this->assertEquals($title, $auditLog->article_title);
        $this->assertEquals('Admin User', $auditLog->actor);
        $this->assertEquals('Knowledge Base', $auditLog->module);
        $this->assertNotNull($auditLog->created_at);
    }

    /**
     * Requirement 6: Enforce role-based access control so only Super Admin can call this endpoint.
     */
    public function test_non_superadmin_and_guest_cannot_delete_articles(): void
    {
        $article = KbArticle::create([
            'title' => 'Protected Company Knowledge',
            'category' => 'User Manuals',
            'status' => 'Published',
            'processing_status' => 'Ready for AI Search',
            'content' => 'Protected manual content.',
        ]);

        // 1. Regular employee attempt -> 403 Forbidden
        $empResponse = $this->deleteJson(
            "/api/articles/{$article->id}",
            ['actor' => 'Technician User'],
            $this->employeeHeaders()
        );
        $empResponse->assertStatus(403);

        // 2. Unauthenticated attempt -> 403 Forbidden
        $guestResponse = $this->deleteJson(
            "/api/articles/{$article->id}",
            ['actor' => 'Guest']
        );
        $guestResponse->assertStatus(403);

        // Assert article was NOT deleted
        $this->assertNotNull(KbArticle::find($article->id), 'Article must remain untouched when unauthorized.');
    }

    /**
     * Requirement 7: Publish an event to the event bus when an article is permanently deleted.
     */
    public function test_publishes_article_deleted_event_to_event_bus(): void
    {
        Event::fake([ArticleDeleted::class]);

        $article = KbArticle::create([
            'title' => 'Event Dispatch Test Article',
            'category' => 'Maintenance Guides',
            'status' => 'Draft',
            'processing_status' => 'Ready for AI Search',
            'content' => 'Maintenance test content.',
        ]);

        $articleId = $article->id;
        $title = $article->title;

        $response = $this->deleteJson(
            "/api/articles/{$articleId}",
            ['actor' => 'Super Admin'],
            $this->superAdminHeaders()
        );

        $response->assertStatus(200);

        // Assert ArticleDeleted event was broadcast
        Event::assertDispatched(ArticleDeleted::class, function (ArticleDeleted $event) use ($articleId, $title) {
            return $event->articleId === $articleId
                && $event->title === $title
                && $event->actor === 'Super Admin'
                && $event instanceof ShouldBroadcastNow
                && $event->broadcastAs() === 'article.deleted'
                && in_array('knowledge-base', array_map(fn ($c) => $c->name, $event->broadcastOn()));
        });
    }
}
