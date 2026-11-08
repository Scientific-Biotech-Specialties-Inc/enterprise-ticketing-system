<?php

namespace Tests\Feature;

use App\Services\ClamAVScanner;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Mockery;
use Tests\TestCase;

/**
 * The superadmin owns the upload limits (configuration-service). The attachment service must
 * enforce them on every upload, whatever the customer's browser claims.
 */
class UploadSizeLimitEnforcementTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        Storage::fake('public');
        Cache::forget('ticket:config:file_limits');
    }

    private function fakeSuperadminLimits(array $limits): void
    {
        Http::fake([
            '*/api/ticket-configurations/file_limits' => Http::response(['value' => $limits], 200),
        ]);
    }

    /**
     * A scanner that throws lets a test prove a file got past the size gate without needing a database:
     * the controller only reaches the scanner after the size check passes.
     */
    private function scannerThatProvesSizeGatePassed(): void
    {
        $scanner = Mockery::mock(ClamAVScanner::class);
        $scanner->shouldReceive('scanDetails')->andThrow(new \RuntimeException('reached scanner'));
        $this->app->instance(ClamAVScanner::class, $scanner);
    }

    private function scannerThatMustNotRun(): void
    {
        $scanner = Mockery::mock(ClamAVScanner::class);
        $scanner->shouldNotReceive('scanDetails');
        $this->app->instance(ClamAVScanner::class, $scanner);
    }

    public function test_file_over_the_superadmin_limit_is_rejected_before_scanning_or_saving(): void
    {
        $this->fakeSuperadminLimits(['maxFileSizeMB' => 1, 'allowedFileTypes' => ['PDF'], 'maxFileCount' => 5]);
        $this->scannerThatMustNotRun();

        $file = UploadedFile::fake()->create('big.pdf', 1025, 'application/pdf'); // 1 MB + 1 KB

        $response = $this->postJson('/api/upload', ['attachments' => [$file]]);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.attachments.0', "File 'big.pdf' exceeds the limit of 1 MB.");
        $this->assertSame([], Storage::disk('public')->allFiles());
        $this->assertSame([], Storage::disk('local')->allFiles());
    }

    public function test_file_exactly_at_the_limit_passes_the_size_check(): void
    {
        $this->fakeSuperadminLimits(['maxFileSizeMB' => 1, 'allowedFileTypes' => ['PDF'], 'maxFileCount' => 5]);
        $this->scannerThatProvesSizeGatePassed();

        $file = UploadedFile::fake()->create('exact.pdf', 1024, 'application/pdf');

        $response = $this->postJson('/api/upload', ['attachments' => [$file]]);

        // Not a 422 size rejection: it moved on to the scanner (which the test made fail on purpose).
        $response->assertStatus(500);
        $response->assertJsonPath('message', 'Unable to verify file security. Please try again later.');
    }

    public function test_lowering_the_limit_rejects_a_file_that_the_old_default_would_have_allowed(): void
    {
        $this->fakeSuperadminLimits(['maxFileSizeMB' => 2, 'allowedFileTypes' => ['PDF'], 'maxFileCount' => 5]);
        $this->scannerThatMustNotRun();

        $file = UploadedFile::fake()->create('ten-mb.pdf', 10 * 1024, 'application/pdf'); // under the 15 MB default

        $this->postJson('/api/upload', ['attachments' => [$file]])->assertStatus(422);
    }

    public function test_raising_the_limit_lets_a_file_through_that_the_old_default_would_have_blocked(): void
    {
        $this->fakeSuperadminLimits(['maxFileSizeMB' => 25, 'allowedFileTypes' => ['PDF'], 'maxFileCount' => 5]);
        $this->scannerThatProvesSizeGatePassed();

        $file = UploadedFile::fake()->create('twenty-mb.pdf', 20 * 1024, 'application/pdf'); // over the 15 MB default

        $this->postJson('/api/upload', ['attachments' => [$file]])->assertStatus(500);
    }

    public function test_one_oversized_file_in_a_batch_rejects_the_whole_upload(): void
    {
        $this->fakeSuperadminLimits(['maxFileSizeMB' => 1, 'allowedFileTypes' => ['PDF'], 'maxFileCount' => 5]);
        $this->scannerThatMustNotRun();

        $small = UploadedFile::fake()->create('small.pdf', 100, 'application/pdf');
        $big = UploadedFile::fake()->create('big.pdf', 2048, 'application/pdf');

        $response = $this->postJson('/api/upload', ['attachments' => [$small, $big]]);

        $response->assertStatus(422);
        $this->assertSame([], Storage::disk('public')->allFiles());
    }

    public function test_default_15mb_limit_applies_when_configuration_service_is_unreachable(): void
    {
        Http::fake([
            '*/api/ticket-configurations/file_limits' => Http::response('down', 503),
        ]);
        $this->scannerThatMustNotRun();

        $file = UploadedFile::fake()->create('over-default.pdf', 16 * 1024, 'application/pdf');

        $this->postJson('/api/upload', ['attachments' => [$file]])->assertStatus(422);
    }

    public function test_file_count_limit_from_the_superadmin_is_enforced(): void
    {
        $this->fakeSuperadminLimits(['maxFileSizeMB' => 5, 'allowedFileTypes' => ['PDF'], 'maxFileCount' => 2]);
        $this->scannerThatMustNotRun();

        $files = [
            UploadedFile::fake()->create('a.pdf', 10, 'application/pdf'),
            UploadedFile::fake()->create('b.pdf', 10, 'application/pdf'),
            UploadedFile::fake()->create('c.pdf', 10, 'application/pdf'),
        ];

        $response = $this->postJson('/api/upload', ['attachments' => $files]);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.attachments.0', 'A maximum of 2 files can be uploaded at a time.');
    }

    public function test_file_type_not_allowed_by_the_superadmin_is_rejected(): void
    {
        $this->fakeSuperadminLimits(['maxFileSizeMB' => 5, 'allowedFileTypes' => ['PDF'], 'maxFileCount' => 5]);
        $this->scannerThatMustNotRun();

        $file = UploadedFile::fake()->create('photo.png', 10, 'image/png');

        $this->postJson('/api/upload', ['attachments' => [$file]])->assertStatus(422);
    }
}
