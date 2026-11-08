<?php

namespace Tests\Feature;

use App\Models\KbArticle;
use App\Models\KbChunk;
use App\Models\KbEmbedding;
use App\Services\GeminiService;
use App\Services\RagService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Spec 0036: published Knowledge Base articles are reliably searchable by the AI.
 */
class KbPublishReadinessTest extends TestCase
{
    use DatabaseTransactions;

    protected RagService $rag;

    protected function setUp(): void
    {
        parent::setUp();
        $this->rag = app(RagService::class);
    }

    private function createIndexedArticle(string $title, string $content, string $description = ''): KbArticle
    {
        $this->actingAsSuperAdmin('Alice SuperAdmin');
        $res = $this->postJson('/api/articles', [
            'title' => $title,
            'content' => $content,
            'description' => $description,
            'category' => 'Troubleshooting Guides',
        ]);
        $res->assertStatus(201);

        return KbArticle::findOrFail($res->json('data.id'));
    }

    private function publishedArticle(string $title, string $content, string $description = ''): KbArticle
    {
        $article = $this->createIndexedArticle($title, $content, $description);
        $this->postJson("/api/articles/{$article->id}/publish")->assertStatus(200);

        return $article->fresh();
    }

    private function retrievedIds(array $result): array
    {
        return array_values(array_unique(array_column($result['chunks'], 'article_id')));
    }

    /** AC-1, AC-3, AC-4, AC-5 */
    public function test_happy_path_indexes_with_model_publishes_with_probe_and_is_searchable_immediately(): void
    {
        $article = $this->createIndexedArticle(
            'Zebra ZT410 ribbon out alarm',
            "Zebra ZT410 shows ribbon out alarm even with ribbon loaded.\n\nClean the ribbon sensor and recalibrate the media.",
            'Zebra ZT410 ribbon out alarm with ribbon loaded'
        );

        $article->refresh();
        $this->assertSame(RagService::STATUS_READY, $article->processing_status);
        $this->assertSame(hash('sha256', $article->content), $article->content_hash);
        $embeddings = KbEmbedding::where('article_id', $article->id)->get();
        $this->assertNotEmpty($embeddings);
        foreach ($embeddings as $e) {
            $this->assertSame('gemini-embedding-001', $e->embedding_model);
            $this->assertSame(768, $e->dimensions);
            $this->assertFalse($e->is_active, 'Draft embeddings stay inactive.');
        }

        $res = $this->postJson("/api/articles/{$article->id}/publish");
        $res->assertStatus(200)
            ->assertJsonPath('data.publish_state', 'Published')
            ->assertJsonPath('probe.rank', 1)
            ->assertJsonPath('low_retrievability', false)
            ->assertJsonPath('data.low_retrievability', false);
        $this->assertGreaterThanOrEqual(0.55, $res->json('probe.score'));
        $this->assertNotNull($article->fresh()->probe_score);

        // AC-4: searchable on the very next call, with no queue job in between.
        $result = $this->rag->retrieve('Zebra ZT410 ribbon out alarm');
        $this->assertContains($article->id, $this->retrievedIds($result));
    }

    /** AC-2, AC-3 */
    public function test_embedding_failure_marks_indexing_failed_leaves_no_chunks_and_blocks_publish(): void
    {
        $this->failEmbeddingsWith(404);
        $this->actingAsSuperAdmin();

        $res = $this->postJson('/api/articles', ['title' => 'Broken model article', 'content' => 'Some content to embed.']);
        $res->assertStatus(502)
            ->assertJsonPath('error_code', 'INDEXING_FAILED')
            ->assertJsonPath('data.processing_status', RagService::STATUS_FAILED);

        $article = KbArticle::findOrFail($res->json('data.id'));
        $this->assertSame(RagService::STATUS_FAILED, $article->processing_status);
        $this->assertStringContainsString('HTTP 404', $article->index_error);
        $this->assertStringNotContainsString('test-key', $article->index_error, 'The API key must never appear in index_error.');
        $this->assertStringNotContainsString((string) config('services.gemini.api_key'), (string) $res->getContent());
        $this->assertSame(0, KbChunk::where('article_id', $article->id)->count());
        $this->assertSame(0, KbEmbedding::where('article_id', $article->id)->count());

        $this->postJson("/api/articles/{$article->id}/publish")
            ->assertStatus(422)
            ->assertJsonPath('error_code', 'NOT_INDEXED');

        // Retry (reindex) succeeds once the API is healthy again.
        $this->restoreEmbeddings();
        $this->postJson("/api/articles/{$article->id}/reindex")
            ->assertStatus(200)
            ->assertJsonPath('data.processing_status', RagService::STATUS_READY)
            ->assertJsonPath('data.index_error', null);
    }

    /** The embedding API key is sent as a header, never as a query string. */
    public function test_embedding_requests_send_the_key_in_a_header(): void
    {
        $this->rag->retrieve('anything at all');

        $sent = Http::recorded(fn (HttpRequest $r) => str_contains($r->url(), ':batchEmbedContents'));
        $this->assertNotEmpty($sent);
        foreach ($sent as [$request]) {
            $this->assertStringNotContainsString('key=', $request->url());
            $this->assertTrue($request->hasHeader('x-goog-api-key'));
            $this->assertStringContainsString('models/gemini-embedding-001:batchEmbedContents', $request->url());
        }
    }

    /** AC-6 */
    public function test_live_edit_failure_keeps_the_old_set_serving(): void
    {
        $article = $this->publishedArticle('Kyocera paper feed squeal', 'Kyocera paper feed squeal: clean the pickup roller.');
        $oldIds = KbEmbedding::where('article_id', $article->id)->where('is_active', true)->pluck('id')->sort()->values()->all();
        $this->assertNotEmpty($oldIds);

        $this->failEmbeddingsWith(503);
        $this->patchJson("/api/articles/{$article->id}", ['content' => 'Completely new procedure text for the roller.'])
            ->assertStatus(502)
            ->assertJsonPath('data.processing_status', RagService::STATUS_FAILED);

        $article->refresh();
        $this->assertSame(RagService::STATUS_FAILED, $article->processing_status);
        $this->assertStringContainsString('HTTP 503', $article->index_error);
        $this->assertSame($oldIds, KbEmbedding::where('article_id', $article->id)->where('is_active', true)->pluck('id')->sort()->values()->all());

        $this->restoreEmbeddings();
        $this->assertContains($article->id, $this->retrievedIds($this->rag->retrieve('Kyocera paper feed squeal')));
    }

    /** AC-6: a successful live edit swaps the whole set and stays active. */
    public function test_live_edit_success_swaps_in_the_new_set_atomically(): void
    {
        $article = $this->publishedArticle('Ricoh toner low warning', 'Ricoh toner low warning: shake the cartridge.');
        $oldIds = KbEmbedding::where('article_id', $article->id)->pluck('id')->all();

        $this->patchJson("/api/articles/{$article->id}", ['content' => 'Ricoh toner low warning: replace the cartridge and reset the counter.'])
            ->assertStatus(200);

        $new = KbEmbedding::where('article_id', $article->id)->get();
        $this->assertNotEmpty($new);
        $this->assertEmpty(array_intersect($oldIds, $new->pluck('id')->all()), 'Old embeddings are gone.');
        $this->assertTrue($new->every(fn ($e) => $e->is_active && $e->embedding_model === 'gemini-embedding-001'));
    }

    /** AC-7 */
    public function test_metadata_only_edit_does_not_call_the_embedding_api(): void
    {
        $article = $this->publishedArticle('Canon C3520 waste toner full', 'Canon C3520 waste toner full: replace the waste toner box.');
        $chunkIds = KbChunk::where('article_id', $article->id)->pluck('id')->all();
        $calls = $this->embeddingCallCount();

        $this->patchJson("/api/articles/{$article->id}", [
            'title' => 'Canon C3520 waste toner box full',
            'category' => 'Maintenance Guides',
            'machine' => 'Canon C3520',
            'version' => '2.0',
        ])->assertStatus(200);

        $this->assertSame($calls, $this->embeddingCallCount(), 'No embedding call for a metadata only edit.');
        $this->assertSame($chunkIds, KbChunk::where('article_id', $article->id)->pluck('id')->all());
        $meta = KbChunk::where('article_id', $article->id)->first()->metadata;
        $this->assertSame('Canon C3520 waste toner box full', $meta['title']);
        $this->assertSame('Maintenance Guides', $meta['category']);
        $this->assertSame('Canon C3520', $meta['machine']);
        $this->assertSame('2.0', $meta['version']);
    }

    /** AC-3: the client cannot flip publish or processing state through PATCH. */
    public function test_patch_cannot_set_status_or_processing_status(): void
    {
        $this->actingAsSuperAdmin();
        $article = KbArticle::create(['title' => 'No content yet', 'status' => 'Draft', 'processing_status' => 'Draft']);

        $this->patchJson("/api/articles/{$article->id}", ['status' => 'Published', 'processing_status' => 'Ready for AI Search'])
            ->assertStatus(200);

        $article->refresh();
        $this->assertSame('Draft', $article->status);
        $this->assertSame('Draft', $article->processing_status);
    }

    /** AC-8 */
    public function test_vectors_from_another_model_are_never_returned(): void
    {
        $article = KbArticle::create(['title' => 'Legacy hash vector article', 'status' => 'Published', 'processing_status' => RagService::STATUS_READY]);
        $chunk = KbChunk::create(['article_id' => $article->id, 'chunk_index' => 0, 'content' => 'legacy hash vector article', 'token_count' => 5]);
        KbEmbedding::create([
            'chunk_id' => $chunk->id,
            'article_id' => $article->id,
            'embedding' => self::fakeEmbedding('legacy hash vector article'),
            'dimensions' => 768,
            'embedding_model' => 'hash-fallback-v1',
            'is_active' => true,
        ]);

        $result = $this->rag->retrieve('legacy hash vector article', 10, 0.0);
        $this->assertNotContains($article->id, $this->retrievedIds($result));

        // And an article like that cannot be (re)published until it is re-embedded.
        $this->actingAsSuperAdmin();
        $this->postJson("/api/articles/{$article->id}/publish")->assertStatus(422)->assertJsonPath('error_code', 'NOT_INDEXED');
    }

    /** AC-8, AC-10 */
    public function test_query_embedding_failure_escalates_to_manual_ticket(): void
    {
        $this->failEmbeddingsWith(500);

        $response = app(GeminiService::class)->generateResponse([
            ['role' => 'user', 'content' => 'My printer keeps eating paper halfway through every job.'],
        ]);

        $this->assertTrue($response['escalate']);
        $this->assertFalse($response['rag_matched']);
        $this->assertStringContainsString('create a support ticket', $response['content']);
        $this->assertNotEmpty($response['ticket_title']);
    }

    /** AC-10 */
    public function test_chat_uses_configured_model_header_key_and_escalates_on_timeout(): void
    {
        $this->assertSame('gemini-3.5-flash', config('services.gemini.model'));
        $this->assertLessThanOrEqual(15, config('services.gemini.timeout'));

        // This test is about the chat call, not matching quality, so let the fake vectors match.
        config(['services.kb.min_score' => 0.1]);
        $this->publishedArticle('Sharp MX jam code J-12', 'Sharp MX jam code J-12: open the right side door and remove paper.');

        $request = null;
        Http::fake(['*:generateContent' => function (HttpRequest $r) use (&$request) {
            $request = $r;
            throw new ConnectionException('cURL error 28: Operation timed out');
        }]);

        $response = app(GeminiService::class)->generateResponse([
            ['role' => 'user', 'content' => 'Sharp MX jam code J-12'],
        ]);

        $this->assertNotNull($request, 'The chat call must reach Gemini when an article matches.');
        $this->assertTrue($response['escalate'], 'A chat timeout must escalate to manual ticket creation.');
        $this->assertTrue($response['is_fallback'] ?? false);
        $this->assertStringContainsString('models/' . config('services.gemini.model') . ':generateContent', $request->url());
        $this->assertStringNotContainsString('key=', $request->url());
        $this->assertTrue($request->hasHeader('x-goog-api-key'));
    }

    /** AC-11 */
    public function test_forged_unsigned_superadmin_jwt_gets_401_and_verified_employee_gets_403(): void
    {
        $article = KbArticle::create(['title' => 'Auth target', 'status' => 'Draft', 'processing_status' => 'Draft']);

        $b64 = fn ($v) => rtrim(strtr(base64_encode(json_encode($v)), '+/', '-_'), '=');
        $forged = $b64(['alg' => 'RS256', 'typ' => 'JWT']) . '.' . $b64(['sub' => 1, 'role' => 'superadmin', 'name' => 'Mallory', 'exp' => time() + 3600]) . '.' . $b64('sig');
        $headers = ['Authorization' => "Bearer {$forged}", 'X-Actor-Name' => 'Mallory', 'Accept' => 'application/json'];

        $writes = [
            ['post', '/api/articles', ['title' => 'x']],
            ['patch', "/api/articles/{$article->id}", ['title' => 'x']],
            ['put', "/api/articles/{$article->id}", ['title' => 'x']],
            ['post', "/api/articles/{$article->id}/publish", []],
            ['post', "/api/articles/{$article->id}/archive", []],
            ['post', "/api/articles/{$article->id}/reindex", []],
            ['post', "/api/articles/{$article->id}/replace-file", []],
            ['post', '/api/articles/import-csv', []],
            ['post', '/api/articles/scan-file', []],
            ['delete', "/api/articles/{$article->id}", []],
            ['post', "/api/kb/articles/{$article->id}/publish", []],
        ];

        foreach ($writes as [$method, $uri, $data]) {
            $this->json(strtoupper($method), $uri, $data, $headers)->assertStatus(401);
        }

        $this->actingAsEmployee();
        $this->postJson("/api/articles/{$article->id}/publish")->assertStatus(403);
        $this->deleteJson("/api/articles/{$article->id}")->assertStatus(403);

        $this->assertSame('Draft', $article->fresh()->status);
    }

    /** Concurrency: a second index attempt while the lock is held returns 409. */
    public function test_concurrent_index_attempt_returns_409(): void
    {
        $article = $this->createIndexedArticle('Lock target', 'Content for the lock test.');

        $lock = Cache::lock("kb:index:{$article->id}", 120);
        $this->assertTrue($lock->get());
        try {
            $this->postJson("/api/articles/{$article->id}/reindex")
                ->assertStatus(409)
                ->assertJsonPath('error_code', 'INDEXING_IN_PROGRESS');
        } finally {
            $lock->release();
        }
    }

    /** AC-9 */
    public function test_kb_reembed_is_idempotent_and_prints_score_stats(): void
    {
        $a = $this->publishedArticle('HP M404 fuser error 50.2', 'HP M404 fuser error 50.2: power cycle and check the fuser connector.');
        $b = $this->createIndexedArticle('Draft only article', 'Draft content that is not published.');

        foreach ([1, 2] as $run) {
            $exit = Artisan::call('kb:reembed', ['--article' => [$a->id, $b->id], '--retries' => 0]);
            $output = Artisan::output();

            $this->assertSame(0, $exit, "Run {$run} must succeed.");
            $this->assertStringContainsString('median', $output);
            $this->assertStringContainsString((string) $a->id, $output);

            foreach ([$a, $b] as $article) {
                $embeddings = KbEmbedding::where('article_id', $article->id)->get();
                $this->assertNotEmpty($embeddings);
                $this->assertTrue($embeddings->every(fn ($e) => $e->embedding_model === 'gemini-embedding-001'));
                $this->assertSame($article->fresh()->status === 'Published', $embeddings->every(fn ($e) => $e->is_active));
            }
        }

        $this->assertNotNull($a->fresh()->probe_score);
        $this->assertSame('reindexed', collect($a->fresh()->history)->last()['type']);
    }

    /** AC-5: a hard to find article stays Published but is flagged. */
    public function test_low_retrievability_is_flagged_but_article_stays_published(): void
    {
        config(['services.kb.min_score' => 0.99]);
        $article = $this->createIndexedArticle('Short title', "A long body about something else entirely.\n\nMore unrelated words here to dilute.");

        $res = $this->postJson("/api/articles/{$article->id}/publish");
        $res->assertStatus(200)
            ->assertJsonPath('low_retrievability', true)
            ->assertJsonPath('data.publish_state', 'Published')
            ->assertJsonPath('data.low_retrievability', true);
        $this->assertSame('Published', $article->fresh()->status);
    }

    public function test_superadmin_can_create_article_manually_without_file(): void
    {
        $this->actingAsSuperAdmin();

        $res = $this->postJson('/api/articles', [
            'title' => 'Manual SOP for Network Reset',
            'category' => 'Troubleshooting Guides',
            'machine' => 'Cisco Router 2901',
            'version' => '1.2',
            'tags' => 'network, reset, cisco',
            'description' => 'Quick manual guide to rebooting Cisco routers on Floor 2.',
            'content' => "### Symptoms\nNo internet on Floor 2.\n\n### Steps\n1. Locate Rack 4B.\n2. Power off switch for 10 seconds.\n3. Power back on and wait for green LED.",
        ]);

        $res->assertStatus(201)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.title', 'Manual SOP for Network Reset')
            ->assertJsonPath('data.file_type', 'ARTICLE')
            ->assertJsonPath('data.processing_status', 'Ready for AI Search');

        $articleId = $res->json('data.id');
        $article = KbArticle::findOrFail($articleId);
        $this->assertSame('ARTICLE', $article->file_type);
        $this->assertNull($article->file_path);
        $this->assertNotEmpty($article->chunks);
        $this->assertNotEmpty($article->embeddings);
    }

    public function test_superadmin_can_create_article_with_uploaded_document_file(): void
    {
        $this->actingAsSuperAdmin();

        $fakeFile = \Illuminate\Http\UploadedFile::fake()->createWithContent(
            'printer_setup.txt',
            "Step 1: Unbox the printer.\nStep 2: Connect Ethernet cable to port 1.\nStep 3: Print test page."
        );

        $res = $this->post('/api/articles', [
            'title' => 'Direct Upload Setup Guide',
            'category' => 'Installation Guides',
            'file' => $fakeFile,
        ]);

        $res->assertStatus(201)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.file_type', 'TXT')
            ->assertJsonPath('data.processing_status', 'Ready for AI Search');

        $articleId = $res->json('data.id');
        $article = KbArticle::findOrFail($articleId);
        $this->assertSame('TXT', $article->file_type);
        $this->assertNotNull($article->file_path);
        $this->assertStringContainsString('Step 1: Unbox the printer', $article->content);
    }
}
