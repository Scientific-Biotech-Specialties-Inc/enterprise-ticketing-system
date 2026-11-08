<?php

namespace Tests\Feature;

use App\Models\KbArticle;
use App\Models\KbChunk;
use App\Models\KbEmbedding;
use App\Services\ClamAVScanner;
use App\Services\RagService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class KbCsvImportAndClamAvTest extends TestCase
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

    protected function superAdminHeaders(string $actorName = 'Super Admin'): array
    {
        // Spec 0036 (AC-11): identity comes from a verified token, never from an unsigned payload.
        $this->actingAsSuperAdmin($actorName);

        return ['Accept' => 'application/json'];
    }

    protected function employeeHeaders(): array
    {
        $this->actingAsEmployee();

        return ['Accept' => 'application/json'];
    }

    /**
     * Test 1: Anyone or Super Admin can download the CSV template
     */
    public function test_can_download_csv_template(): void
    {
        $response = $this->get('/api/articles/template-csv');

        $response->assertStatus(200);
        $this->assertStringContainsString('text/csv', (string) $response->headers->get('content-type'));
        $content = $response->streamedContent();
        $this->assertStringContainsString('Title', $content);
        $this->assertStringContainsString('Steps', $content);
        $this->assertStringContainsString('Symptoms', $content);
        $this->assertStringContainsString('Machine_Model', $content);
        $this->assertStringContainsString('Category', $content);
        $this->assertStringContainsString('Warning', $content);
        $this->assertStringContainsString('Tags', $content);
        $this->assertStringContainsString('Printer Paper Jam Error E-03', $content);
    }

    /**
     * Test 2: File upload scan rejects EICAR malware test string with HTTP 422
     */
    public function test_scan_file_rejects_malware_file(): void
    {
        $eicarString = 'X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
        $file = UploadedFile::fake()->createWithContent('eicar_test.pdf', $eicarString);

        $response = $this->postJson('/api/articles/scan-file', [
            'file' => $file,
        ], $this->superAdminHeaders());

        $response->assertStatus(422)
            ->assertJson([
                'success' => false,
                'error_code' => 'MALWARE_DETECTED',
            ]);
    }

    /**
     * Test 3: File upload scan permits clean file
     */
    public function test_scan_file_allows_clean_file(): void
    {
        $cleanContent = "Clean equipment manual text for printer diagnostics.";
        $file = UploadedFile::fake()->createWithContent('clean_manual.pdf', $cleanContent);

        $response = $this->postJson('/api/articles/scan-file', [
            'file' => $file,
        ], $this->superAdminHeaders());

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
                'data' => [
                    'clean' => true,
                ],
            ]);
    }

    /**
     * Test 4: CSV import blocks infected CSV file
     */
    public function test_import_csv_blocks_infected_csv(): void
    {
        $eicarCsv = "title,symptoms,steps\n" .
            "\"Trojan Procedure\",\"EICAR-STANDARD-ANTIVIRUS-TEST-FILE\",\"1. Bad step\"";

        $file = UploadedFile::fake()->createWithContent('malware.csv', $eicarCsv);

        $response = $this->postJson('/api/articles/import-csv', [
            'file' => $file,
        ], $this->superAdminHeaders());

        $response->assertStatus(422)
            ->assertJson([
                'success' => false,
                'error_code' => 'MALWARE_DETECTED',
            ]);
    }

    /**
     * Test 5: CSV import creates and indexes articles properly
     */
    public function test_import_csv_creates_and_indexes_articles(): void
    {
        $csvContent = "document_title,category,machine_model,version,tags,id,type,title,symptoms,prerequisites,steps,verify,warning,related_ids\n" .
            '"LIS Knowledge Base","Troubleshooting Guides","Sysmex 500","1.0","analyzer;serial","SOP-1.1","SOP","Analyzer Transmission Recovery","Results do not reach LIS","Server access","1. Check driver. | 2. Reseat cable.","Results reach LIS","Port must be scoped.","SOP-1.2"' . "\n" .
            '"LIS Knowledge Base","FAQs","MySQL Server","1.0","mysql;timeout","FAQ-01","FAQ","Resolving Host Blocked Error","LL_RESPONSE_TIMEOUT_ERROR","MySQL admin access","1. Run FLUSH HOSTS; | 2. Set max_connect_errors = 10000;","Client logs in without timeout","Monitor connection drops.","SOP-1.1"';

        $file = UploadedFile::fake()->createWithContent('knowledge_import.csv', $csvContent);

        $response = $this->postJson('/api/articles/import-csv', [
            'file' => $file,
        ], $this->superAdminHeaders());

        $response->assertStatus(201)
            ->assertJson([
                'success' => true,
                'count' => 2,
            ]);

        // Verify first article in DB
        $article1 = KbArticle::where('title', 'like', '%Analyzer Transmission Recovery%')->first();
        $this->assertNotNull($article1);
        $this->assertEquals('Draft', $article1->status);
        $this->assertEquals('CSV', $article1->file_type);
        $this->assertStringContainsString('Sysmex 500', $article1->machine);
        $this->assertStringContainsString('Symptoms / Problem Description:', $article1->content);
        $this->assertStringContainsString('Troubleshooting Steps:', $article1->content);

        // Verify chunks and embeddings generated
        $chunksCount = KbChunk::where('article_id', $article1->id)->count();
        $this->assertGreaterThan(0, $chunksCount);
        $embeddingsCount = KbEmbedding::where('article_id', $article1->id)->count();
        $this->assertGreaterThan(0, $embeddingsCount);

        // Verify embeddings are inactive while article is in Draft
        $activeEmbeddingsCount = KbEmbedding::where('article_id', $article1->id)->where('is_active', true)->count();
        $this->assertEquals(0, $activeEmbeddingsCount);

        // Verify second article in DB
        $article2 = KbArticle::where('title', 'like', '%Resolving Host Blocked Error%')->first();
        $this->assertNotNull($article2);
        $this->assertEquals('FAQs', $article2->category);
    }

    /**
     * Test 6: Non-Super Admin is forbidden from importing CSV
     */
    public function test_non_super_admin_forbidden_from_importing_csv(): void
    {
        $csvContent = "title,symptoms,steps\n\"Sample SOP\",\"Error\",\"1. Do step\"";
        $file = UploadedFile::fake()->createWithContent('sops.csv', $csvContent);

        $response = $this->postJson('/api/articles/import-csv', [
            'file' => $file,
        ], $this->employeeHeaders());

        $response->assertStatus(403);
    }

    /**
     * Test 7: CSV import supports Option B (multi-row steps under empty or matching Title)
     */
    public function test_import_csv_supports_multi_row_steps_option_b(): void
    {
        // 7 clean columns: Title,Steps,Symptoms,Machine_Model,Category,Warning,Tags
        // Row 1: Article with Title and Step 1
        // Row 2: Empty Title, Step 2
        // Row 3: Empty Title, Step 3
        // Row 4: New Article with Title and Step 1
        $csvContent = "Title,Steps,Symptoms,Machine_Model,Category,Warning,Tags\n" .
            '"Centrifuge Rotor Balance Calibration","1. Power off centrifuge and wait for rotor standstill.","Vibration warning light blinking during 3000 RPM cycle","Centrifuge Heraeus Biofuge","Maintenance Guides","Wear safety goggles when inspecting rotor bowl.","centrifuge;rotor;calibration"' . "\n" .
            '"","2. Open lid manually using emergency release pin.","","","","",""' . "\n" .
            '"","3. Inspect four bucket trunnions with caliper and lubricate with silicone grease.","","","","",""' . "\n" .
            '"Incubator Temperature Sensor Reset","1. Press and hold SET button for 5 seconds until calibration menu appears.","Display shows temp error E-12","Memmert IN55","Troubleshooting Guides","Ensure chamber is empty before initiating reset.","incubator;temperature;e-12"';

        $file = UploadedFile::fake()->createWithContent('multi_row_steps.csv', $csvContent);

        $response = $this->postJson('/api/articles/import-csv', [
            'file' => $file,
        ], $this->superAdminHeaders());

        $response->assertStatus(201)
            ->assertJson([
                'success' => true,
                'count' => 2,
            ]);

        // Verify the first article merged all 3 rows into its steps
        $article1 = KbArticle::where('title', 'like', '%Centrifuge Rotor Balance Calibration%')->first();
        $this->assertNotNull($article1);
        $this->assertEquals('Centrifuge Heraeus Biofuge', $article1->machine);
        $this->assertEquals('Maintenance Guides', $article1->category);
        $this->assertStringContainsString('1. Power off centrifuge', $article1->content);
        $this->assertStringContainsString('2. Open lid manually', $article1->content);
        $this->assertStringContainsString('3. Inspect four bucket trunnions', $article1->content);
        $this->assertStringContainsString('Wear safety goggles', $article1->content);

        // Verify the second article is separate and has its step
        $article2 = KbArticle::where('title', 'like', '%Incubator Temperature Sensor Reset%')->first();
        $this->assertNotNull($article2);
        $this->assertEquals('Memmert IN55', $article2->machine);
        $this->assertStringContainsString('1. Press and hold SET button', $article2->content);
    }

    /**
     * Test 8: Super Admin can replace an article's file with ClamAV check and re-indexing
     */
    public function test_super_admin_can_replace_article_file(): void
    {
        $article = KbArticle::create([
            'title' => 'Original Document Title',
            'category' => 'Troubleshooting Guides',
            'file_type' => 'PDF',
            'size' => '1.0 MB',
            'status' => 'Draft',
            'processing_status' => 'Ready for AI Search',
            'content' => 'Old content to be replaced.',
            'history' => [],
        ]);

        $replacementContent = "Title,Steps,Symptoms\n\"Updated SOP Title\",\"1. New step procedure\",\"Resolved issue\"";
        $file = UploadedFile::fake()->createWithContent('replacement.csv', $replacementContent);

        $response = $this->postJson("/api/articles/{$article->id}/replace-file", [
            'file' => $file,
        ], $this->superAdminHeaders());

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
            ]);

        $fresh = $article->fresh();
        $this->assertEquals('CSV', $fresh->file_type);
        $this->assertStringContainsString('1. New step procedure', $fresh->content);
        $this->assertNotEmpty($fresh->history);
        $this->assertEquals('file_replacement', $fresh->history[0]['type']);
    }

    /**
     * Test 9: Download file returns article content
     */
    public function test_download_file_returns_content(): void
    {
        $article = KbArticle::create([
            'title' => 'Sample For Download',
            'category' => 'Troubleshooting Guides',
            'file_type' => 'CSV',
            'size' => '0.5 KB',
            'status' => 'Draft',
            'processing_status' => 'Ready for AI Search',
            'content' => 'Symptoms / Problem Description: Sample symptom for download',
            'history' => [],
        ]);

        $response = $this->get("/api/articles/{$article->id}/file", $this->superAdminHeaders());
        $response->assertStatus(200);
        $this->assertStringContainsString('Sample symptom for download', $response->getContent());
    }
}


