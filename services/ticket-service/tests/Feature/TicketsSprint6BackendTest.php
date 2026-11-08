<?php

namespace Tests\Feature;

use App\Models\TicketDraft;
use App\Services\TicketDraftService;
use App\Services\TicketService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class TicketsSprint6BackendTest extends TestCase
{
    use DatabaseTransactions;

    protected int $testClientId = 101;
    protected int $otherClientId = 102;
    protected int $assignedEmpId = 201;
    protected int $otherEmpId = 202;
    protected int $adminEmpId = 203;

    protected function setUp(): void
    {
        parent::setUp();

        $aiHandoffResponse = Http::response([
            'success' => true,
            'data' => [
                'title' => 'CGI Machine Jammed Error 402',
                'description' => 'Customer reported jammed feeder on CGI Machine.',
                'category' => 'Hardware',
                'category_confidence' => 0.85,
                'machine' => 'CGI Machine Pro',
                'machine_confidence' => 0.90,
                'origin' => 'ai_chatbot',
            ],
        ], 200);

        Http::fake([
            'http://ai-service:8000/*' => $aiHandoffResponse,
            'http://AI-service:8000/*' => $aiHandoffResponse,
            'http://customer-service:8000/*' => Http::response([
                'user' => [
                    'emp_id' => $this->assignedEmpId,
                    'first_name' => 'Alice',
                    'last_name' => 'Engineer',
                    'email' => 'alice@example.com',
                    'department' => 'Service',
                    'role' => 'technician',
                    'branch' => 'Main',
                ],
            ], 200),
            '*' => Http::response(['status' => 'success'], 200),
        ]);

        $this->setUpDatabaseSchema();
        $this->seedTestData();
    }

    protected function setUpDatabaseSchema(): void
    {
        if (DB::getDriverName() === 'sqlite') {
            DB::statement('PRAGMA foreign_keys = OFF');
        }

        // 1. ticket_drafts table
        if (!Schema::hasTable('ticket_drafts')) {
            Schema::create('ticket_drafts', function ($t) {
                $t->increments('id');
                $t->unsignedBigInteger('client_id');
                $t->string('title')->nullable();
                $t->text('description')->nullable();
                $t->unsignedBigInteger('machine_ID')->nullable();
                $t->unsignedBigInteger('problem_category_ID')->nullable();
                $t->unsignedBigInteger('priority_ID')->nullable();
                $t->json('attachments')->nullable();
                $t->timestamps();
                $t->index('client_id');
            });
        }

        // 2. clients table
        if (!Schema::hasTable('clients')) {
            Schema::create('clients', function ($t) {
                $t->increments('id');
                $t->string('client_name')->default('Test Client');
                $t->string('email')->nullable();
                $t->timestamps();
            });
        }

        // 3. employees table
        if (!Schema::hasTable('employees')) {
            Schema::create('employees', function ($t) {
                $t->bigIncrements('emp_id');
                $t->string('email')->unique();
                $t->string('password_hash')->default('secret');
                $t->string('first_name');
                $t->string('last_name');
                $t->string('role');
                $t->string('department');
                $t->string('branch')->nullable()->default('Main');
                $t->boolean('is_active')->default(true);
                $t->timestamp('last_synced_at')->nullable();
                $t->timestamp('last_seen_at')->nullable();
                $t->timestamps();
            });
        }

        // 4. problem_categories table
        if (!Schema::hasTable('problem_categories')) {
            Schema::create('problem_categories', function ($t) {
                $t->increments('problem_category_ID');
                $t->string('category_name');
                $t->timestamps();
            });
        }

        // 5. machines table
        if (!Schema::hasTable('machines')) {
            Schema::create('machines', function ($t) {
                $t->increments('machine_ID');
                $t->string('machine_name');
                $t->string('serial_number')->nullable();
                $t->unsignedBigInteger('client_ID')->nullable();
                $t->timestamps();
            });
        }

        // 6. ticket_statuses table
        if (!Schema::hasTable('ticket_statuses')) {
            Schema::create('ticket_statuses', function ($t) {
                $t->increments('ticket_status_ID');
                $t->string('status_name');
                $t->timestamps();
            });
        }

        // 7. priorities table
        if (!Schema::hasTable('priorities')) {
            Schema::create('priorities', function ($t) {
                $t->increments('priority_ID');
                $t->string('priority_name');
                $t->timestamps();
            });
        }

        // 8. ticket_types table
        if (!Schema::hasTable('ticket_types')) {
            Schema::create('ticket_types', function ($t) {
                $t->increments('ticket_type_ID');
                $t->string('type_name');
                $t->timestamps();
            });
        }

        // 9. tickets table
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
                $t->string('conversation_id')->nullable();
                $t->boolean('is_internal')->default(false);
                $t->timestamps();
            });
        }

        // 10. ticket_assignments table
        if (!Schema::hasTable('ticket_assignments')) {
            Schema::create('ticket_assignments', function ($t) {
                $t->increments('assignment_ID');
                $t->unsignedBigInteger('ticket_ID');
                $t->unsignedBigInteger('employee_ID');
                $t->boolean('is_active')->default(true);
                $t->timestamps();
            });
        }

        // 11. internal_notes table
        if (!Schema::hasTable('internal_notes')) {
            Schema::create('internal_notes', function ($t) {
                $t->increments('id');
                $t->unsignedBigInteger('ticket_id');
                $t->unsignedBigInteger('employee_id');
                $t->text('note');
                $t->timestamps();
            });
        }

        // 12. ticket_audit_logs table
        if (!Schema::hasTable('ticket_audit_logs')) {
            Schema::create('ticket_audit_logs', function ($t) {
                $t->increments('log_ID');
                $t->unsignedBigInteger('ticket_ID')->nullable();
                $t->string('action_type')->nullable();
                $t->unsignedBigInteger('action_by_ID')->nullable();
                $t->string('actor_type')->nullable();
                $t->text('details')->nullable();
                $t->timestamps();
            });
        }

        // 13. departments table
        if (!Schema::hasTable('departments')) {
            Schema::create('departments', function ($t) {
                $t->increments('id');
                $t->string('name');
                $t->boolean('is_active')->default(true);
                $t->timestamps();
            });
        }
    }

    protected function seedTestData(): void
    {
        DB::table('clients')->updateOrInsert(['id' => $this->testClientId], ['client_name' => 'Acme Hospital', 'email' => 'acme@example.com', 'address' => '1 Acme Way', 'contact_number' => '0000000001']);
        DB::table('clients')->updateOrInsert(['id' => $this->otherClientId], ['client_name' => 'Other Clinic', 'email' => 'other@example.com', 'address' => '2 Other Way', 'contact_number' => '0000000002']);

        DB::table('employees')->updateOrInsert(['emp_id' => $this->assignedEmpId], [
            'first_name' => 'Alice',
            'last_name' => 'Engineer',
            'email' => 'alice@example.com',
            'role' => 'technician',
            'department' => 'Service',
            'branch' => 'Main',
            'is_active' => true,
            'password_hash' => 'secret',
        ]);

        DB::table('employees')->updateOrInsert(['emp_id' => $this->otherEmpId], [
            'first_name' => 'Bob',
            'last_name' => 'Unassigned',
            'email' => 'bob@example.com',
            'role' => 'technician',
            'department' => 'Service',
            'branch' => 'Visayas',
            'is_active' => true,
            'password_hash' => 'secret',
        ]);

        DB::table('employees')->updateOrInsert(['emp_id' => $this->adminEmpId], [
            'first_name' => 'Admin',
            'last_name' => 'User',
            'email' => 'admin@example.com',
            'role' => 'admin',
            'department' => 'Management',
            'branch' => 'Main',
            'is_active' => true,
            'password_hash' => 'secret',
        ]);

        DB::table('problem_categories')->updateOrInsert(['problem_category_ID' => 1], ['category_name' => 'Hardware']);
        DB::table('problem_categories')->updateOrInsert(['problem_category_ID' => 2], ['category_name' => 'Software']);

        $this->seedMachine(1, [
            'machine_name' => 'CGI Machine Pro',
            'serial_number' => 'CGI-9988-AA',
            'client_ID' => $this->testClientId,
        ]);

        $this->seedMachine(2, [
            'machine_name' => 'Other Machine',
            'serial_number' => 'OTH-1122-BB',
            'client_ID' => $this->otherClientId,
        ]);

        DB::table('ticket_statuses')->updateOrInsert(['ticket_status_ID' => 1], ['status_name' => 'Open']);
        DB::table('ticket_statuses')->updateOrInsert(['ticket_status_ID' => 2], ['status_name' => 'In Progress']);

        DB::table('priorities')->updateOrInsert(['priority_ID' => 1], ['priority_name' => 'Low']);
        DB::table('priorities')->updateOrInsert(['priority_ID' => 2], ['priority_name' => 'Medium']);
        DB::table('priorities')->updateOrInsert(['priority_ID' => 3], ['priority_name' => 'High']);

        DB::table('departments')->updateOrInsert(['id' => 1], ['name' => 'Service', 'is_active' => true]);
        DB::table('departments')->updateOrInsert(['id' => 2], ['name' => 'IT', 'is_active' => true]);
    }

    // =========================================================================
    // TS020: Ticket Drafts
    // =========================================================================

    public function test_ts020_save_draft_with_partial_information(): void
    {
        $draftService = app(TicketDraftService::class);

        // Saving draft does not require mandatory fields like machine_ID, problem_category_ID, or long description
        $result = $draftService->saveDraft($this->testClientId, [
            'title' => 'Incomplete Draft',
        ]);

        $this->assertTrue($result['success']);
        $this->assertSame(200, $result['status']);
        $this->assertSame('Incomplete Draft', $result['draft']['title']);
        $this->assertNull($result['draft']['machine_ID']);
    }

    public function test_ts020_draft_lifecycle_ownership_and_carryover(): void
    {
        $draftService = app(TicketDraftService::class);

        // 1. Save draft with attachment
        $res = $draftService->saveDraft($this->testClientId, [
            'title' => 'Draft with Attachment',
            'description' => 'Draft description text',
            'machine_ID' => 1,
            'problem_category_ID' => 1,
            'attachments' => [
                ['name' => 'sample.pdf', 'url' => 'https://example.com/sample.pdf'],
            ],
        ]);
        $this->assertTrue($res['success']);
        $draftId = $res['draft']['id'];

        // 2. Draft is strictly scoped: other client cannot view or delete it
        $otherView = $draftService->getDraft($this->otherClientId, $draftId);
        $this->assertNull($otherView);

        $otherDelete = $draftService->deleteDraft($this->otherClientId, $draftId);
        $this->assertFalse($otherDelete);

        // 3. Draft appears in customer's draft list, but not in tickets table
        $drafts = $draftService->getDrafts($this->testClientId);
        $this->assertCount(1, $drafts);
        $this->assertSame('Draft with Attachment', $drafts[0]['title']);

        $ticketCount = DB::table('tickets')->where('created_by', $this->testClientId)->count();
        $this->assertSame(0, $ticketCount, 'Drafts must be excluded from ticket tables and queries');

        // 4. Delete draft permanently
        $deleted = $draftService->deleteDraft($this->testClientId, $draftId);
        $this->assertTrue($deleted);
        $this->assertCount(0, $draftService->getDrafts($this->testClientId));
    }

    public function test_ts020_max_drafts_limit_enforced(): void
    {
        $draftService = app(TicketDraftService::class);

        // Seed 10 drafts
        for ($i = 1; $i <= 10; $i++) {
            $r = $draftService->saveDraft($this->testClientId, ['title' => "Draft #{$i}"]);
            $this->assertTrue($r['success']);
        }

        // 11th draft rejected with 422 LIMIT_EXCEEDED
        $exceeded = $draftService->saveDraft($this->testClientId, ['title' => 'Exceeded Draft']);
        $this->assertFalse($exceeded['success']);
        $this->assertSame(422, $exceeded['status']);
        $this->assertSame('LIMIT_EXCEEDED', $exceeded['error']);
    }

    // =========================================================================
    // TS027: AI Chatbot Ticket Escalation Pre-fill
    // =========================================================================

    public function test_ts027_escalation_handoff_prefill_and_cms_machine_verification(): void
    {
        $ticketController = app(\App\Http\Controllers\TicketController::class);

        $request = new \Illuminate\Http\Request();
        $request->setUserResolver(fn () => (object) ['id' => $this->testClientId, 'role' => 'client']);

        // Call escalateHandoff
        $response = $ticketController->escalateHandoff($request, 'test-conv-uuid');
        $data = $response->getData(true);

        $this->assertTrue($data['success']);
        $this->assertFalse($data['fallback']);
        $this->assertSame('CGI Machine Jammed Error 402', $data['data']['title']);
        $this->assertSame(1, $data['data']['problem_category_ID'], 'Category should match Hardware (ID 1)');
        $this->assertSame(1, $data['data']['machine_ID'], 'Machine should match client machine (ID 1)');
        $this->assertSame('ai_chatbot', $data['data']['origin']);
    }

    public function test_ts027_escalation_handoff_rejects_unowned_machine(): void
    {
        // When AI suggests a machine belonging to another client
        $unownedResponse = Http::response([
            'success' => true,
            'data' => [
                'title' => 'Machine Error',
                'description' => 'Unowned machine inquiry',
                'category' => 'Hardware',
                'category_confidence' => 0.85,
                'machine' => 'Other Machine', // Belongs to otherClientId (machine_ID 2)
                'machine_confidence' => 0.95,
                'origin' => 'ai_chatbot',
            ],
        ], 200);

        Http::swap(new \Illuminate\Http\Client\Factory());
        Http::fake([
            'http://ai-service:8000/*' => $unownedResponse,
            'http://AI-service:8000/*' => $unownedResponse,
        ]);

        $ticketController = app(\App\Http\Controllers\TicketController::class);
        $request = new \Illuminate\Http\Request();
        $request->setUserResolver(fn () => (object) ['id' => $this->testClientId, 'role' => 'client']);

        $response = $ticketController->escalateHandoff($request, 'test-conv-uuid');
        $data = $response->getData(true);

        $this->assertTrue($data['success']);
        // machine_ID should be null because Machine 2 does not belong to testClientId
        $this->assertNull($data['data']['machine_ID'], 'Machines not owned by customer must be discarded from prefill');
    }

    public function test_ts027_escalation_handoff_fallback_on_failure(): void
    {
        // When AI service fails or returns error
        $failureResponse = Http::response(['message' => 'Service Unavailable'], 503);
        Http::swap(new \Illuminate\Http\Client\Factory());
        Http::fake([
            'http://ai-service:8000/*' => $failureResponse,
            'http://AI-service:8000/*' => $failureResponse,
        ]);

        $ticketController = app(\App\Http\Controllers\TicketController::class);
        $request = new \Illuminate\Http\Request();
        $request->setUserResolver(fn () => (object) ['id' => $this->testClientId, 'role' => 'client']);

        $response = $ticketController->escalateHandoff($request, 'missing-conv');
        $data = $response->getData(true);

        $this->assertTrue($data['success']);
        $this->assertTrue($data['fallback']);
        $this->assertStringContainsString("We couldn't carry over your chat details", $data['notice']);
        $this->assertEmpty($data['data']['title']);
    }

    // =========================================================================
    // TS028: Internal Notes on Tickets
    // =========================================================================

    public function test_ts028_customer_cannot_access_or_add_internal_notes(): void
    {
        // Create ticket
        $ticketId = DB::table('tickets')->insertGetId([
            'title' => 'Internal Note Test Ticket',
            'description' => 'Description test',
            'created_by' => $this->testClientId,
            'machine_ID' => 1,
            'problem_category_ID' => 1,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $ticketController = app(\App\Http\Controllers\TicketController::class);

        // Customer request
        $request = new \Illuminate\Http\Request();
        $request->setUserResolver(fn () => (object) ['id' => $this->testClientId, 'role' => 'client']);

        $getRes = $ticketController->getInternalNotes($request, $ticketId);
        $this->assertSame(403, $getRes->getStatusCode());

        $request->merge(['note' => 'Customer trying to view/add internal note']);
        $addRes = $ticketController->addInternalNote($request, $ticketId);
        $this->assertSame(403, $addRes->getStatusCode());
    }

    public function test_ts028_assigned_employee_can_add_and_view_internal_notes(): void
    {
        $ticketId = DB::table('tickets')->insertGetId([
            'title' => 'Assigned Employee Note Ticket',
            'description' => 'Description test',
            'created_by' => $this->testClientId,
            'machine_ID' => 1,
            'problem_category_ID' => 1,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Assign to employee Alice
        DB::table('ticket_assignments')->insert([
            'ticket_ID' => $ticketId,
            'employee_ID' => $this->assignedEmpId,
            'assigned_by' => $this->adminEmpId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $ticketController = app(\App\Http\Controllers\TicketController::class);

        // 1. Assigned employee Alice adds internal note
        $addReq = new \Illuminate\Http\Request(['note' => 'Checked machine motor, awaiting replacement gear.']);
        $addReq->setUserResolver(fn () => (object) [
            'emp_id' => $this->assignedEmpId,
            'name' => 'Alice Engineer',
            'role' => 'technician',
        ]);

        $addRes = $ticketController->addInternalNote($addReq, $ticketId);
        $this->assertSame(201, $addRes->getStatusCode());

        // Verify note is saved
        $getReq = new \Illuminate\Http\Request();
        $getReq->setUserResolver(fn () => (object) [
            'emp_id' => $this->assignedEmpId,
            'name' => 'Alice Engineer',
            'role' => 'technician',
        ]);
        $getRes = $ticketController->getInternalNotes($getReq, $ticketId);
        $this->assertSame(200, $getRes->getStatusCode());
        $notes = $getRes->getData(true)['notes'];
        $this->assertCount(1, $notes);
        $this->assertSame('Checked machine motor, awaiting replacement gear.', $notes[0]['note']);
        $this->assertSame('Alice Engineer', $notes[0]['author_name']);

        // 2. Non-assigned employee Bob cannot access internal notes
        $bobReq = new \Illuminate\Http\Request();
        $bobReq->setUserResolver(fn () => (object) [
            'emp_id' => $this->otherEmpId,
            'name' => 'Bob Unassigned',
            'role' => 'technician',
        ]);
        $bobRes = $ticketController->getInternalNotes($bobReq, $ticketId);
        $this->assertSame(403, $bobRes->getStatusCode());

        // 3. Admin can view internal notes
        $adminReq = new \Illuminate\Http\Request();
        $adminReq->setUserResolver(fn () => (object) [
            'emp_id' => $this->adminEmpId,
            'name' => 'Admin User',
            'role' => 'admin',
        ]);
        $adminRes = $ticketController->getInternalNotes($adminReq, $ticketId);
        $this->assertSame(200, $adminRes->getStatusCode());

        // 4. Blank note is rejected
        $blankReq = new \Illuminate\Http\Request(['note' => '   ']);
        $blankReq->setUserResolver(fn () => (object) [
            'emp_id' => $this->assignedEmpId,
            'name' => 'Alice Engineer',
            'role' => 'technician',
        ]);
        $blankRes = $ticketController->addInternalNote($blankReq, $ticketId);
        $this->assertSame(422, $blankRes->getStatusCode());
    }

    // =========================================================================
    // TS105: Employee Profile Synced from Auth System
    // =========================================================================

    public function test_ts105_employee_profile_fetch_and_read_only_enforcement(): void
    {
        $directoryController = app(\App\Http\Controllers\EmployeeDirectoryController::class);

        // Fetch Alice's profile
        $req = new \Illuminate\Http\Request();
        $req->setUserResolver(fn () => (object) ['emp_id' => $this->assignedEmpId, 'role' => 'technician']);

        $res = $directoryController->employeeProfile($req);
        $data = $res->getData(true);

        $this->assertTrue($data['success']);
        $this->assertSame('Alice Engineer', $data['data']['name']);
        $this->assertSame('Service', $data['data']['department']);
        $this->assertArrayHasKey('auth_sourced_fields', $data['data']);
        $this->assertTrue($data['data']['auth_sourced_fields']['role']['read_only']);

        // Attempting to modify Auth-sourced field like role/department via API is rejected with 403
        $updateReq = new \Illuminate\Http\Request([
            'role' => 'Super Admin',
            'department' => 'Executive',
        ]);
        $updateReq->setUserResolver(fn () => (object) ['emp_id' => $this->assignedEmpId, 'role' => 'technician']);

        $updateRes = $directoryController->updateProfile($updateReq);
        $this->assertSame(403, $updateRes->getStatusCode());
        $this->assertSame('AUTH_SOURCED_FIELD_READ_ONLY', $updateRes->getData(true)['error_code']);
    }

    // =========================================================================
    // TS107: Admin Employee Search & Combinable Filtering
    // =========================================================================

    public function test_ts107_admin_employee_search_and_scoping(): void
    {
        $directoryController = app(\App\Http\Controllers\EmployeeDirectoryController::class);

        // 1. Partial Name search
        // The shared test database can hold other employees, so assert on this test's fixtures
        // and on every returned row matching the query, not on global totals.
        $req1 = new \Illuminate\Http\Request(['q' => 'Alic', 'per_page' => 100]);
        $req1->setUserResolver(fn () => (object) ['emp_id' => $this->adminEmpId, 'role' => 'superadmin']);
        $res1 = $directoryController->searchEmployees($req1);
        $data1 = $res1->getData(true);
        $this->assertTrue($data1['success']);
        $rows1 = collect($data1['data']);
        $this->assertContains($this->assignedEmpId, $rows1->pluck('id')->all());
        $this->assertSame('Alice Engineer', $rows1->firstWhere('id', $this->assignedEmpId)['name']);
        $this->assertNotContains($this->otherEmpId, $rows1->pluck('id')->all()); // Bob does not match "Alic"

        // 2. Combinable filters (Department + Role)
        $req2 = new \Illuminate\Http\Request(['department' => 'Service', 'role' => 'technician', 'per_page' => 100]);
        $req2->setUserResolver(fn () => (object) ['emp_id' => $this->adminEmpId, 'role' => 'superadmin']);
        $res2 = $directoryController->searchEmployees($req2);
        $data2 = $res2->getData(true);
        $rows2 = collect($data2['data']);
        $this->assertContains($this->assignedEmpId, $rows2->pluck('id')->all()); // Alice
        $this->assertContains($this->otherEmpId, $rows2->pluck('id')->all());    // Bob
        $this->assertNotContains($this->adminEmpId, $rows2->pluck('id')->all()); // admin role is filtered out
        foreach ($rows2 as $row) {
            $this->assertSame('service', strtolower($row['department']));
            $this->assertSame('technician', strtolower($row['role']));
        }

        // 3. Admin Branch Scoping: Admin in 'Main' branch cannot access employees in 'Visayas'
        $adminReq = new \Illuminate\Http\Request(['branch' => 'Visayas']);
        $adminReq->setUserResolver(fn () => (object) [
            'emp_id' => $this->adminEmpId,
            'role' => 'admin',
            'branch' => 'Main', // Admin is scoped to Main
        ]);
        $adminRes = $directoryController->searchEmployees($adminReq);
        $adminData = $adminRes->getData(true);

        // Bob is in Visayas, but Admin is locked to Main branch, so Bob is NOT returned
        $names = collect($adminData['data'])->pluck('name')->toArray();
        $this->assertNotContains('Bob Unassigned', $names);

        // 4. Pagination
        $pageReq = new \Illuminate\Http\Request(['per_page' => 1, 'page' => 1]);
        $pageReq->setUserResolver(fn () => (object) ['emp_id' => $this->adminEmpId, 'role' => 'superadmin']);
        $pageRes = $directoryController->searchEmployees($pageReq);
        $pageData = $pageRes->getData(true);
        $this->assertSame(1, count($pageData['data']));
        $this->assertSame(1, $pageData['current_page']);
        $this->assertGreaterThanOrEqual(1, $pageData['last_page']);

        // 5. Dynamic filter options
        $optionsReq = new \Illuminate\Http\Request();
        $optionsReq->setUserResolver(fn () => (object) ['emp_id' => $this->adminEmpId, 'role' => 'admin', 'branch' => 'Main']);
        $optionsRes = $directoryController->filterOptions($optionsReq);
        $optionsData = $optionsRes->getData(true);
        $this->assertTrue($optionsData['success']);
        $this->assertContains('Service', $optionsData['departments']);
        $this->assertContains('technician', $optionsData['roles']);
    }
}
