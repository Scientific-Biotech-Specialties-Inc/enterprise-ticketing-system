<?php

namespace Tests\Feature;

use App\Models\TicketDraft;
use App\Services\TicketDraftService;
use App\Services\TicketDashboardService;
use App\Services\TicketNotificationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class CustomerTicketFeaturesE2ETest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        echo "Ticket Service Database: " . DB::connection()->getDatabaseName() . PHP_EOL;

        Http::fake([
            '*' => Http::response(['status' => 'success'], 200),
        ]);

        if (DB::getDriverName() === 'sqlite') {
            DB::statement('PRAGMA foreign_keys = OFF');

            if (!Schema::hasTable('clients')) {
                Schema::create('clients', function ($t) {
                    $t->increments('id');
                    $t->string('client_name')->default('Test Client');
                    $t->string('email')->nullable();
                    $t->timestamps();
                });
            }

            if (!Schema::hasTable('problem_categories')) {
                Schema::create('problem_categories', function ($t) {
                    $t->increments('problem_category_ID');
                    $t->string('category_name');
                    $t->timestamps();
                });
            }

            if (!Schema::hasTable('machines')) {
                Schema::create('machines', function ($t) {
                    $t->increments('machine_ID');
                    $t->string('machine_name');
                    $t->string('serial_number')->nullable();
                    $t->unsignedBigInteger('client_ID')->nullable();
                    $t->timestamps();
                });
            }

            if (!Schema::hasTable('ticket_statuses')) {
                Schema::create('ticket_statuses', function ($t) {
                    $t->increments('ticket_status_ID');
                    $t->string('status_name');
                    $t->timestamps();
                });
            }

            if (!Schema::hasTable('priorities')) {
                Schema::create('priorities', function ($t) {
                    $t->increments('priority_ID');
                    $t->string('priority_name');
                    $t->timestamps();
                });
            }

            if (!Schema::hasTable('ticket_priorities')) {
                Schema::create('ticket_priorities', function ($t) {
                    $t->increments('priority_ID');
                    $t->string('priority_name');
                    $t->string('color_code')->nullable();
                    $t->timestamps();
                });
            }

            if (!Schema::hasTable('ticket_types')) {
                Schema::create('ticket_types', function ($t) {
                    $t->increments('ticket_type_ID');
                    $t->string('type_name');
                    $t->timestamps();
                });
            }

            if (!Schema::hasTable('tickets')) {
                Schema::create('tickets', function ($t) {
                    $t->increments('ticket_ID');
                    $t->string('ticket_number')->nullable();
                    $t->unsignedBigInteger('ticket_type_ID')->default(1);
                    $t->unsignedBigInteger('created_by')->nullable();
                    $t->unsignedBigInteger('machine_ID')->nullable();
                    $t->unsignedBigInteger('problem_category_ID')->nullable();
                    $t->unsignedBigInteger('ticket_status_ID')->default(1);
                    $t->unsignedBigInteger('priority_ID')->default(1);
                    $t->string('title');
                    $t->text('description');
                    $t->string('origin')->default('manual');
                    $t->boolean('is_internal')->default(false);
                    $t->timestamps();
                });
            }

            if (!Schema::hasTable('departments')) {
                Schema::create('departments', function ($t) {
                    $t->increments('id');
                    $t->string('name');
                    $t->boolean('is_active')->default(true);
                    $t->timestamps();
                });
            }
        }
    }

    public function test_ts020_ticket_draft_lifecycle_and_limit()
    {
        $draftService = app(TicketDraftService::class);
        $clientId = 999;

        // Initialize table and clean any existing drafts
        $draftService->getDrafts($clientId);
        TicketDraft::where('client_id', $clientId)->delete();

        // 1. Save initial draft with partial fields (only title)
        $save1 = $draftService->saveDraft($clientId, [
            'title' => 'Partial Draft Issue',
        ]);

        $this->assertTrue($save1['success']);
        $this->assertSame(200, $save1['status']);
        $this->assertSame('Partial Draft Issue', $save1['draft']['title']);
        $draftId = $save1['draft']['id'];

        // 2. Update the existing draft with more fields and attachments
        $save2 = $draftService->saveDraft($clientId, [
            'title' => 'Updated Draft Title',
            'description' => 'Now with detailed explanation',
            'attachments' => [
                ['name' => 'error.png', 'url' => 'https://example.com/error.png'],
            ],
        ], $draftId);

        $this->assertTrue($save2['success']);
        $this->assertSame('Updated Draft Title', $save2['draft']['title']);
        $this->assertSame('Now with detailed explanation', $save2['draft']['description']);
        $this->assertCount(1, $save2['draft']['attachments']);

        // 3. Retrieve single draft
        $single = $draftService->getDraft($clientId, $draftId);
        $this->assertNotNull($single);
        $this->assertSame('Updated Draft Title', $single['title']);

        // 4. Retrieve list of drafts
        $drafts = $draftService->getDrafts($clientId);
        $this->assertCount(1, $drafts);
        $this->assertSame($draftId, $drafts[0]['id']);

        // 5. Cross-customer ownership scoping (client 888 cannot see or edit client 999's draft)
        $otherClientGet = $draftService->getDraft(888, $draftId);
        $this->assertNull($otherClientGet);

        $otherClientUpdate = $draftService->saveDraft(888, ['title' => 'Hacked'], $draftId);
        $this->assertFalse($otherClientUpdate['success']);
        $this->assertSame(404, $otherClientUpdate['status']);

        // 6. Enforce maximum 10 drafts limit per customer
        for ($i = 2; $i <= 10; $i++) {
            $extra = $draftService->saveDraft($clientId, ['title' => "Draft #{$i}"]);
            $this->assertTrue($extra['success']);
        }

        $exceeded = $draftService->saveDraft($clientId, ['title' => 'Draft #11 should fail']);
        $this->assertFalse($exceeded['success']);
        $this->assertSame(422, $exceeded['status']);
        $this->assertSame('LIMIT_EXCEEDED', $exceeded['error']);

        // 7. Delete draft
        $deleted = $draftService->deleteDraft($clientId, $draftId);
        $this->assertTrue($deleted);

        // Count should now be 9, allowing another draft to be saved
        $afterDelete = $draftService->getDrafts($clientId);
        $this->assertCount(9, $afterDelete);

        $canSaveNow = $draftService->saveDraft($clientId, ['title' => 'Draft after deletion']);
        $this->assertTrue($canSaveNow['success']);

        // Cleanup
        TicketDraft::where('client_id', $clientId)->delete();
    }

    public function test_ts021_and_ts023_dynamic_filter_options_and_structure()
    {
        $dashboardService = app(TicketDashboardService::class);
        $testClientId = 777;

        if (DB::getDriverName() === 'sqlite') {
            DB::statement('PRAGMA foreign_keys = OFF');
        }

        DB::table('clients')->updateOrInsert(['id' => $testClientId], [
            'client_name' => 'Filter Test Client',
            'email' => 'filtertest@example.com',
            'address' => '7 Filter St',
            'contact_number' => '0000000006',
        ]);

        DB::table('problem_categories')->updateOrInsert(['problem_category_ID' => 1], ['category_name' => 'Hardware']);
        $this->seedMachine(1, [
            'machine_name' => 'CGI Machine Pro',
            'serial_number' => 'CGI-9988-AA',
            'client_ID' => $testClientId,
        ]);
        DB::table('ticket_statuses')->updateOrInsert(['ticket_status_ID' => 1], ['status_name' => 'Open']);
        DB::table('ticket_statuses')->updateOrInsert(['ticket_status_ID' => 2], ['status_name' => 'In Progress']);
        DB::table('ticket_priorities')->updateOrInsert(['priority_ID' => 1], ['priority_name' => 'Low']);
        DB::table('departments')->updateOrInsert(['id' => 1], ['name' => 'Service', 'is_active' => true]);

        // Seed a ticket for test customer
        DB::table('tickets')->insert([
            'ticket_type_ID' => 1,
            'created_by' => $testClientId,
            'machine_ID' => 1,
            'problem_category_ID' => 1,
            'ticket_status_ID' => 1,
            'priority_ID' => 1,
            'is_internal' => false,
            'title' => 'Filter Options Test',
            'description' => 'Test Desc',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // TS021: Customer filter options
        $customerOptions = $dashboardService->getCustomerFilterOptions($testClientId);
        $this->assertArrayHasKey('categories', $customerOptions);
        $this->assertArrayHasKey('machines', $customerOptions);
        $this->assertGreaterThanOrEqual(1, count($customerOptions['categories']));
        $this->assertGreaterThanOrEqual(1, count($customerOptions['machines']));

        // TS023: CS filter options
        $csOptions = $dashboardService->getCSFilterOptions();
        $this->assertArrayHasKey('departments', $csOptions);
        $this->assertArrayHasKey('statuses', $csOptions);
        $this->assertGreaterThanOrEqual(1, count($csOptions['departments']));
        $this->assertGreaterThanOrEqual(1, count($csOptions['statuses']));
        $statusNames = collect($csOptions['statuses'])->pluck('status_name')->toArray();
        $this->assertContains('Open', $statusNames);
        $this->assertContains('In Progress', $statusNames);

        DB::table('tickets')->where('created_by', $testClientId)->delete();
        DB::table('clients')->where('id', $testClientId)->delete();
    }

    public function test_ts005_ticket_notification_service_respects_preferences()
    {
        $notificationService = app(TicketNotificationService::class);
        $recipientId = 555;

        // Ensure notifications table exists with data column
        if (!Schema::hasTable('notifications')) {
            Schema::create('notifications', function ($t) {
                $t->increments('id');
                $t->unsignedBigInteger('recipient_id');
                $t->string('recipient_type');
                $t->string('title');
                $t->text('message');
                $t->unsignedBigInteger('ticket_id')->nullable();
                $t->json('data')->nullable();
                $t->boolean('is_read')->default(false);
                $t->timestamps();
            });
        } elseif (!Schema::hasColumn('notifications', 'data')) {
            Schema::table('notifications', function ($t) {
                $t->json('data')->nullable();
            });
        }

        DB::table('notifications')->where('recipient_id', $recipientId)->delete();

        // 1. When in_app is disabled, notifyRecipient skips inserting
        Cache::put("client:notification_preferences:{$recipientId}", [
            'in_app' => false,
            'email' => true,
        ], 3600);

        $notificationService->notifyRecipient(
            $recipientId,
            'client',
            'Test Title',
            'Test Message',
            null
        );

        $countDisabled = DB::table('notifications')->where('recipient_id', $recipientId)->count();
        $this->assertSame(0, $countDisabled);

        // 2. When in_app is enabled, notifyRecipient creates notification
        Cache::put("client:notification_preferences:{$recipientId}", [
            'in_app' => true,
            'email' => true,
        ], 3600);

        $notificationService->notifyRecipient(
            $recipientId,
            'client',
            'Test Title Enabled',
            'Test Message Enabled',
            null
        );

        $countEnabled = DB::table('notifications')->where('recipient_id', $recipientId)->count();
        $this->assertSame(1, $countEnabled);

        DB::table('notifications')->where('recipient_id', $recipientId)->delete();
    }
}
