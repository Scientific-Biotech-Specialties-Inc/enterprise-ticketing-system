<?php

namespace Tests\Feature;

use App\Models\ProofOfCompletion;
use App\Models\TicketAttachment;
use App\Services\ClamAVScanner;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Mockery;
use Tests\Concerns\FakesAttachmentAccess;
use Tests\TestCase;

/**
 * Spec 0037, Slice A: attachments are private. Files open only for a signed in
 * participant of the file's ticket, or for the uploader while the file is pending.
 */
class PrivateAttachmentAccessTest extends TestCase
{
    use DatabaseTransactions;
    use FakesAttachmentAccess;

    private int $ticketId;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('attachments');
        Storage::fake('public');
        Storage::fake('local');
        Cache::forget('ticket:config:file_limits');

        $ticketId = DB::table('tickets')->value('ticket_ID');
        if ($ticketId === null) {
            $this->markTestSkipped('Needs at least one ticket row for the ticket_attachments foreign key.');
        }
        $this->ticketId = (int) $ticketId;
    }

    private function boundAttachment(string $path = null, string $mime = 'application/pdf'): TicketAttachment
    {
        $path ??= "ticket-attachments/{$this->ticketId}/spec37-" . uniqid() . '.pdf';
        Storage::disk('attachments')->put($path, '%PDF-1.4 spec 0037');

        return TicketAttachment::create([
            'ticket_id' => $this->ticketId,
            'file_name' => basename($path),
            'file_path' => $path,
            'file_type' => $mime,
            'uploaded_at' => now(),
            'uploaded_by_id' => 501,
            'uploaded_by_type' => 'customer',
        ]);
    }

    private function pendingAttachment(int $uploaderId, string $uploaderType): TicketAttachment
    {
        $path = 'ticket-attachments/pending/' . uniqid() . '/draft.png';
        Storage::disk('attachments')->put($path, 'png-bytes');

        return TicketAttachment::create([
            'ticket_id' => null,
            'file_name' => 'draft.png',
            'file_path' => $path,
            'file_type' => 'image/png',
            'uploaded_at' => now(),
            'uploaded_by_id' => $uploaderId,
            'uploaded_by_type' => $uploaderType,
        ]);
    }

    /** AC-1: no bearer token means 401 on every file route, before any lookup. */
    public function test_file_routes_return_401_without_a_token(): void
    {
        $this->fakeAttachmentAccess(allowedByTicket: [$this->ticketId => true]);
        $att = $this->boundAttachment();

        foreach (["/storage/{$att->file_path}", "/download/{$att->file_path}", "/api/storage/{$att->file_path}", "/api/download/{$att->file_path}"] as $url) {
            $this->getJson($url)->assertStatus(401);
        }
        Http::assertNothingSent();
    }

    /** AC-2: a signed in caller who is not a participant gets 404, not 403. */
    public function test_non_participant_gets_404(): void
    {
        $this->fakeAttachmentAccess(allowedByTicket: [$this->ticketId => false]);
        $att = $this->boundAttachment();

        $this->withToken($this->callerBearer)->get("/api/download/{$att->file_path}")->assertStatus(404);
        $this->withToken($this->callerBearer)->get("/storage/{$att->file_path}")->assertStatus(404);
    }

    /** AC-3: a participant gets the bytes, the stored MIME type, and private no-store headers. */
    public function test_participant_gets_the_file_with_private_headers(): void
    {
        $this->fakeAttachmentAccess(allowedByTicket: [$this->ticketId => true]);
        $att = $this->boundAttachment();

        $response = $this->withToken($this->callerBearer)->get("/api/storage/{$att->file_path}");

        $response->assertOk();
        $this->assertStringStartsWith('application/pdf', (string) $response->headers->get('Content-Type'));
        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));
        $this->assertStringContainsString('private', (string) $response->headers->get('Cache-Control'));
        $this->assertSame('nosniff', $response->headers->get('X-Content-Type-Options'));
        $this->assertSame('%PDF-1.4 spec 0037', file_get_contents($response->baseResponse->getFile()->getPathname()));

        $download = $this->withToken($this->callerBearer)->get("/api/download/{$att->file_path}");
        $download->assertOk();
        $this->assertStringContainsString('attachment', (string) $download->headers->get('Content-Disposition'));
        $this->assertStringContainsString('no-store', (string) $download->headers->get('Cache-Control'));
    }

    /** The forwarded bearer and internal token reach ticket-service, and answers are cached. */
    public function test_access_check_forwards_the_bearer_and_is_cached(): void
    {
        $this->fakeAttachmentAccess(allowedByTicket: [$this->ticketId => true]);
        $att = $this->boundAttachment();

        $this->withToken($this->callerBearer)->get("/api/storage/{$att->file_path}")->assertOk();
        $this->withToken($this->callerBearer)->get("/api/storage/{$att->file_path}")->assertOk();

        Http::assertSentCount(1);
        Http::assertSent(fn ($request) => $request->hasHeader('Authorization', 'Bearer ' . $this->callerBearer)
            && $request->hasHeader('X-Internal-Token', 'test-internal-token')
            && str_contains($request->url(), "ticket_id={$this->ticketId}"));
    }

    /** AC-4: a pending file opens only for the user who uploaded it. */
    public function test_pending_file_opens_only_for_its_uploader(): void
    {
        $att = $this->pendingAttachment(777, 'employee');

        $this->fakeAttachmentAccess(userId: 777, userType: 'employee');
        $this->withToken($this->callerBearer)->get("/api/storage/{$att->file_path}")->assertOk();

        // Same id but a customer, so a different person.
        $this->fakeAttachmentAccess(userId: 777, userType: 'customer');
        $this->withToken($this->callerBearer)->get("/api/storage/{$att->file_path}")->assertStatus(404);

        $this->fakeAttachmentAccess(userId: 778, userType: 'employee');
        $this->withToken($this->callerBearer)->get("/api/storage/{$att->file_path}")->assertStatus(404);
    }

    /** AC-4: a proof not yet bound to an assignment follows the same uploader only rule. */
    public function test_pending_proof_opens_only_for_its_uploader(): void
    {
        $path = 'ticket-attachments/pending/' . uniqid() . '/proof.pdf';
        Storage::disk('attachments')->put($path, 'proof');
        ProofOfCompletion::create([
            'assignment_ID' => null, 'file_name' => 'proof.pdf', 'file_path' => $path,
            'file_type' => 'application/pdf', 'file_size' => 5, 'uploaded_at' => now(),
            'uploaded_by_id' => 42, 'uploaded_by_type' => 'employee',
        ]);

        $this->fakeAttachmentAccess(userId: 42, userType: 'employee');
        $this->withToken($this->callerBearer)->get("/api/storage/{$path}")->assertOk();

        $this->fakeAttachmentAccess(userId: 43, userType: 'employee');
        $this->withToken($this->callerBearer)->get("/api/storage/{$path}")->assertStatus(404);
    }

    /** Security model: unknown paths and traversal attempts return 404. */
    public function test_unknown_or_traversal_paths_return_404(): void
    {
        $this->fakeAttachmentAccess(allowedByTicket: [$this->ticketId => true]);
        Storage::disk('attachments')->put('ticket-attachments/orphan.pdf', 'no row');

        $this->withToken($this->callerBearer)->get('/api/storage/ticket-attachments/orphan.pdf')->assertStatus(404);
        $this->withToken($this->callerBearer)->get('/api/storage/ticket-attachments/../../.env')->assertStatus(404);
    }

    /** Key invariant: if ticket-service cannot answer, files stay closed. */
    public function test_fails_closed_when_ticket_service_is_down(): void
    {
        $this->fakeAttachmentAccess(status: 500);
        $att = $this->boundAttachment();

        $this->withToken($this->callerBearer)->get("/api/storage/{$att->file_path}")->assertStatus(503);
    }

    /** Phase 1 fallback: a participant can still read a file that has not moved off the public disk yet. */
    public function test_reads_fall_back_to_the_public_disk_during_migration(): void
    {
        $this->fakeAttachmentAccess(allowedByTicket: [$this->ticketId => true]);
        $path = "ticket-attachments/{$this->ticketId}/legacy-" . uniqid() . '.pdf';
        Storage::disk('public')->put($path, 'legacy bytes');
        TicketAttachment::create([
            'ticket_id' => $this->ticketId, 'file_name' => 'legacy.pdf', 'file_path' => $path,
            'file_type' => 'application/pdf', 'uploaded_at' => now(),
        ]);

        $this->withToken($this->callerBearer)->get("/api/storage/{$path}")->assertOk();
    }

    /** AC-5: uploads land on the private disk after a clean scan, with the uploader recorded. */
    public function test_upload_scans_then_writes_to_the_private_disk_and_records_the_uploader(): void
    {
        Http::fake(['*/api/ticket-configurations/file_limits' => Http::response(['value' => ['maxFileSizeMB' => 5, 'allowedFileTypes' => ['PDF'], 'maxFileCount' => 5]], 200)]);
        $this->fakeAttachmentAccess(userId: 909, userType: 'employee');

        $scanner = Mockery::mock(ClamAVScanner::class);
        $scanner->shouldReceive('scanDetails')->once()->andReturnUsing(function () {
            $this->assertSame([], Storage::disk('attachments')->allFiles(), 'Nothing is stored before the scan finishes.');
            return ['clean' => true, 'threat' => null, 'raw' => 'stream: OK'];
        });
        $this->app->instance(ClamAVScanner::class, $scanner);

        $response = $this->withToken($this->callerBearer)->postJson('/api/upload', [
            'attachments' => [UploadedFile::fake()->create('report.pdf', 10, 'application/pdf')],
        ]);

        $response->assertOk();
        $path = $response->json('attachments.0.file_path');
        $this->assertStringStartsWith('ticket-attachments/pending/', $path);
        $this->assertSame('/api/ticketing/attachment/download/' . $path, $response->json('attachments.0.url'));
        Storage::disk('attachments')->assertExists($path);
        $this->assertSame([], Storage::disk('public')->allFiles());

        $row = TicketAttachment::where('file_path', $path)->first();
        $this->assertSame(909, (int) $row->uploaded_by_id);
        $this->assertSame('employee', $row->uploaded_by_type);
    }

    /** Uploads with no verifiable identity are refused before scanning. */
    public function test_upload_without_identity_returns_401(): void
    {
        Http::fake(['*/api/ticket-configurations/file_limits' => Http::response(['value' => ['maxFileSizeMB' => 5, 'allowedFileTypes' => ['PDF'], 'maxFileCount' => 5]], 200)]);
        $scanner = Mockery::mock(ClamAVScanner::class);
        $scanner->shouldNotReceive('scanDetails');
        $this->app->instance(ClamAVScanner::class, $scanner);

        $this->postJson('/api/upload', [
            'attachments' => [UploadedFile::fake()->create('report.pdf', 10, 'application/pdf')],
        ])->assertStatus(401);
    }

    /** A chat upload that names a ticket the uploader belongs to is bound straight away. */
    public function test_chat_upload_with_ticket_id_is_bound_to_that_ticket(): void
    {
        Http::fake(['*/api/ticket-configurations/file_limits' => Http::response(['value' => ['maxFileSizeMB' => 5, 'allowedFileTypes' => ['PDF'], 'maxFileCount' => 5]], 200)]);
        $this->fakeAttachmentAccess(userId: 501, userType: 'customer', allowedByTicket: [$this->ticketId => true]);
        $scanner = Mockery::mock(ClamAVScanner::class);
        $scanner->shouldReceive('scanDetails')->andReturn(['clean' => true, 'threat' => null, 'raw' => 'OK']);
        $this->app->instance(ClamAVScanner::class, $scanner);

        $response = $this->withToken($this->callerBearer)->postJson('/api/upload', [
            'ticket_id' => $this->ticketId,
            'attachments' => [UploadedFile::fake()->create('chat.pdf', 10, 'application/pdf')],
        ]);

        $response->assertOk();
        $row = TicketAttachment::where('file_path', $response->json('attachments.0.file_path'))->first();
        $this->assertSame($this->ticketId, (int) $row->ticket_id);
    }

    /** AC-6: the move command supports --dry-run, keeps paths, and is safe to rerun. */
    public function test_move_command_is_dry_runnable_and_idempotent(): void
    {
        Storage::disk('public')->put('ticket-attachments/5/a.pdf', 'aaa');
        Storage::disk('public')->put('ticket-attachments/proofs/9/b.png', 'bbb');

        $this->artisan('attachments:move-to-private', ['--dry-run' => true])->assertSuccessful();
        Storage::disk('public')->assertExists('ticket-attachments/5/a.pdf');
        Storage::disk('attachments')->assertMissing('ticket-attachments/5/a.pdf');

        $this->artisan('attachments:move-to-private')->assertSuccessful();
        Storage::disk('attachments')->assertExists('ticket-attachments/5/a.pdf');
        Storage::disk('attachments')->assertExists('ticket-attachments/proofs/9/b.png');
        Storage::disk('public')->assertMissing('ticket-attachments/5/a.pdf');
        $this->assertSame('aaa', Storage::disk('attachments')->get('ticket-attachments/5/a.pdf'));

        $this->artisan('attachments:move-to-private')
            ->expectsOutputToContain('Moved 0 file(s)')
            ->assertSuccessful();

        $this->artisan('attachments:move-to-private', ['--reverse' => true])->assertSuccessful();
        Storage::disk('public')->assertExists('ticket-attachments/5/a.pdf');
        Storage::disk('attachments')->assertMissing('ticket-attachments/5/a.pdf');
    }
}
