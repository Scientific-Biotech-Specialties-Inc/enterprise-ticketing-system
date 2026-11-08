<?php

namespace Database\Seeders;

use App\Models\KbArticle;
use App\Models\KbChunk;
use App\Models\KbEmbedding;
use App\Services\RagService;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class KnowledgeBaseSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        $ragService = app(RagService::class);

        $articles = [
            [
                'id' => 1,
                'title' => 'Canon X120 User Manual',
                'category' => 'User Manuals',
                'machine' => 'Canon X120',
                'version' => '2.1',
                'file_type' => 'PDF',
                'uploaded_by' => 'Admin',
                'size' => '4.2 MB',
                'status' => 'Published',
                'processing_status' => 'Ready for AI Search',
                'tags' => ['manual', 'canon', 'x120', 'printer'],
                'description' => 'Official user manual for Canon X120 printer covering installation, toner replacement, paper tray configuration, and error code troubleshooting.',
                'content' => "Canon X120 User Manual and Technical Reference Guide.\n\n" .
                    "1. Setup & Installation: Ensure the device is connected to a dedicated 220V power socket. Load Letter or A4 paper in Tray 1 with the paper guides firmly against the edges.\n\n" .
                    "2. Paper Jam Resolution: When Error Code E-03 appears, open Front Cover A, gently pull the jammed paper in the direction of feed. Check the duplex unit under Cover B for torn paper fragments.\n\n" .
                    "3. Toner Cartridge Replacement: Open the top access door. Release the cyan, magenta, yellow, and black locking levers. Insert genuine Canon Cartridge 057 and push firmly until the locking click is heard.\n\n" .
                    "4. Preventive Maintenance: Clean the roller assembly every 5,000 pages using a lint-free isopropyl alcohol wipe. Do not touch the transfer belt.",
                'history' => [
                    ['id' => 'hist-101', 'type' => 'created', 'timestamp' => '2026-06-15 09:30:00', 'actor' => 'Admin', 'action' => 'Created', 'details' => 'Initial upload.'],
                    ['id' => 'hist-1011', 'type' => 'published', 'timestamp' => '2026-06-15 10:00:00', 'actor' => 'Super Admin', 'action' => 'Published', 'details' => 'Published to active RAG index.'],
                ],
                'published_at' => '2026-06-15 10:00:00',
            ],
            [
                'id' => 2,
                'title' => 'Troubleshooting Guide v2.1',
                'category' => 'Troubleshooting Guides',
                'machine' => 'No Machine',
                'version' => '2.1',
                'file_type' => 'PDF',
                'uploaded_by' => 'Admin',
                'size' => '1.8 MB',
                'status' => 'Published',
                'processing_status' => 'Ready for AI Search',
                'tags' => ['troubleshooting', 'network', 'offline', 'general'],
                'description' => 'Universal enterprise equipment troubleshooting guide for common hardware, connectivity, and power issues.',
                'content' => "Universal Enterprise Equipment Diagnostic & Troubleshooting Guide.\n\n" .
                    "1. Power & Boot Failures: Verify the main AC power cord is seated firmly in the IEC connector. Inspect the breaker switch at the back panel. If the LED indicator blinks orange 4 times, power supply unit requires replacement.\n\n" .
                    "2. Network Connectivity Failures: Check Ethernet cable link and activity LEDs. If IP address shows 169.254.x.x, DHCP reservation has expired. Restart network switch port or assign static IP in the subnet 192.168.10.x.\n\n" .
                    "3. Overheating & Sensor Alarms: Check exhaust fan grilles for dust obstruction. Ambient room temperature must not exceed 30°C (86°F). If thermal sensor trips, leave powered off for 15 minutes before rebooting.",
                'history' => [
                    ['id' => 'hist-102', 'type' => 'created', 'timestamp' => '2026-06-14 14:15:00', 'actor' => 'Admin', 'action' => 'Created', 'details' => 'Initial upload.'],
                    ['id' => 'hist-1021', 'type' => 'published', 'timestamp' => '2026-06-14 15:00:00', 'actor' => 'Super Admin', 'action' => 'Published', 'details' => 'Published to active RAG index.'],
                ],
                'published_at' => '2026-06-14 15:00:00',
            ],
            [
                'id' => 3,
                'title' => 'Common FAQs 2026',
                'category' => 'FAQs',
                'machine' => 'No Machine',
                'version' => '1.0',
                'file_type' => 'DOCX',
                'uploaded_by' => 'Admin',
                'size' => '876 KB',
                'status' => 'Draft',
                'processing_status' => 'Processing', // No processed embeddings! Blocks publishing!
                'tags' => ['faq', 'questions', 'draft'],
                'description' => 'Frequently asked questions compilation pending text extraction and embedding generation.',
                'content' => null, // Not yet processed
                'history' => [
                    ['id' => 'hist-103', 'type' => 'created', 'timestamp' => '2026-06-13 11:00:00', 'actor' => 'Admin', 'action' => 'Created', 'details' => 'Draft uploaded, queued for processing.'],
                ],
                'published_at' => null,
            ],
            [
                'id' => 4,
                'title' => 'Product Spec Sheet',
                'category' => 'Product Specifications',
                'machine' => 'Epson L3110',
                'version' => '3.0',
                'file_type' => 'PDF',
                'uploaded_by' => 'Admin',
                'size' => '2.1 MB',
                'status' => 'Draft',
                'processing_status' => 'Ready for AI Search', // Has embeddings but is_active = false
                'tags' => ['specs', 'epson', 'l3110'],
                'description' => 'Product specifications and technical tolerances for Epson L3110 EcoTank series.',
                'content' => "Epson L3110 EcoTank Specification Sheet.\n\n" .
                    "Print Speed: Up to 33.0 ppm (Black draft), 15.0 ppm (Color draft).\n" .
                    "Resolution: 5760 x 1440 dpi with Variable-Sized Droplet Technology.\n" .
                    "Ink System: Epson genuine 003 ink bottles (Black, Cyan, Magenta, Yellow).\n" .
                    "Connectivity: High Speed USB 2.0. Duty cycle: 30,000 pages per month.",
                'history' => [
                    ['id' => 'hist-104', 'type' => 'created', 'timestamp' => '2026-06-12 16:45:00', 'actor' => 'Admin', 'action' => 'Created', 'details' => 'Uploaded and processed into embeddings.'],
                ],
                'published_at' => null,
            ],
            [
                'id' => 5,
                'title' => 'Maintenance Schedule',
                'category' => 'Maintenance Guides',
                'machine' => 'Canon X220',
                'version' => '1.2',
                'file_type' => 'DOCX',
                'uploaded_by' => 'Admin',
                'size' => '1.2 MB',
                'status' => 'Archived',
                'processing_status' => 'Ready for AI Search',
                'tags' => ['maintenance', 'canon', 'x220', 'archived'],
                'description' => 'Legacy maintenance schedule and procedures for decommissioned Canon X220 units.',
                'content' => "Canon X220 Periodic Maintenance Schedule & Checklist.\n\n" .
                    "Monthly: Inspect fuser unit rollers, check oil pad, clean pickup rollers.\n" .
                    "Quarterly: Lubricate carriage rails with G-40 grease. Verify laser diode alignment.\n" .
                    "Annual: Replace ozone filters and ozone lamp.",
                'history' => [
                    ['id' => 'hist-105', 'type' => 'created', 'timestamp' => '2026-06-11 10:20:00', 'actor' => 'Admin', 'action' => 'Created', 'details' => 'Initial upload.'],
                    ['id' => 'hist-1051', 'type' => 'published', 'timestamp' => '2026-06-11 11:00:00', 'actor' => 'Super Admin', 'action' => 'Published', 'details' => 'Published.'],
                    ['id' => 'hist-1052', 'type' => 'archived', 'timestamp' => '2026-06-11 16:00:00', 'actor' => 'Super Admin', 'action' => 'Archived', 'details' => 'Archived by Super Admin; removed from active search.'],
                ],
                'published_at' => '2026-06-11 11:00:00',
                'archived_at' => '2026-06-11 16:00:00',
            ],
        ];

        foreach ($articles as $data) {
            $existing = KbArticle::find($data['id']);
            if (!$existing) {
                $article = KbArticle::create($data);
            } else {
                $existing->update($data);
                $article = $existing;
            }

            // Index chunks & embeddings if content exists
            // indexArticle() activates the new embeddings only when the article is Published.
            // Spec 0036: a failed embedding call leaves the article 'Indexing failed' instead of storing fake vectors.
            if (!empty($article->content)) {
                try {
                    $ragService->indexArticle($article);
                } catch (\App\Exceptions\EmbeddingFailedException $e) {
                    $this->command?->warn("Article #{$article->id} could not be indexed: {$e->getMessage()}");
                }
            }
        }
    }
}
