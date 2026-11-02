<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Employee;
use App\Models\TicketAuditLog;
use App\Services\AuditTimelineService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class TicketTimelineTest extends TestCase
{
    use DatabaseTransactions;

    protected Employee $technician;
    protected Employee $admin;
    protected Client $customerOwner;
    protected Client $customerOther;
    protected AuditTimelineService $timelineService;

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'mysql']);
        config(['database.connections.mysql.database' => 'ticketing_system_test']);
        DB::purge('mysql');
        DB::reconnect('mysql');

        Cache::flush();
        $this->timelineService = app(AuditTimelineService::class);

        $testEmails = [
            'tech.timeline.0024@example.com',
            'admin.timeline.0024@example.com',
        ];

        DB::table('ticket_audit_logs')->whereIn('ticket_ID', function ($q) {
            $q->select('ticket_ID')->from('tickets')->whereIn('branch_id', [931]);
        })->delete();

        DB::table('tickets')->whereIn('branch_id', [931])->delete();
        DB::table('employees')->whereIn('email', $testEmails)->delete();

        // Branches
        DB::table('branches')->updateOrInsert(
            ['id' => 931],
            [
                'slug' => 'branch-931',
                'name' => 'Branch 931',
                'code' => 'B931',
                'region' => 'East',
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        // Core entities
        DB::table('problem_categories')->updateOrInsert(
            ['problem_category_ID' => 1],
            ['category_name' => 'Network', 'created_at' => now(), 'updated_at' => now()]
        );
        DB::table('ticket_types')->updateOrInsert(
            ['ticket_type_ID' => 1],
            ['type_name' => 'Incident', 'created_at' => now(), 'updated_at' => now()]
        );
        DB::table('ticket_priorities')->updateOrInsert(
            ['priority_ID' => 1],
            ['priority_name' => 'Low', 'color_code' => 'green', 'created_at' => now(), 'updated_at' => now()]
        );
        DB::table('ticket_statuses')->updateOrInsert(
            ['ticket_status_ID' => 1],
            ['status_name' => 'Open', 'created_at' => now(), 'updated_at' => now()]
        );
        DB::table('ticket_statuses')->updateOrInsert(
            ['ticket_status_ID' => 2],
            ['status_name' => 'In Progress', 'created_at' => now(), 'updated_at' => now()]
        );
        DB::table('ticket_statuses')->updateOrInsert(
            ['ticket_status_ID' => 3],
            ['status_name' => 'Resolved', 'created_at' => now(), 'updated_at' => now()]
        );

        DB::table('clients')->updateOrInsert(
            ['id' => 9301],
            [
                'client_name' => 'Alice Customer',
                'email' => 'alice.client.0024@example.com',
                'contact_number' => '5559301',
                'address' => '9301 Client Road',
                'status' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
        $this->customerOwner = Client::find(9301);

        DB::table('clients')->updateOrInsert(
            ['id' => 9302],
            [
                'client_name' => 'Eve Snoop',
                'email' => 'eve.client.0024@example.com',
                'contact_number' => '5559302',
                'address' => '9302 Client Road',
                'status' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
        $this->customerOther = Client::find(9302);

        $this->technician = Employee::create([
            'emp_id' => 89301,
            'first_name' => 'David',
            'last_name' => 'Device',
            'email' => 'tech.timeline.0024@example.com',
            'role' => 'technician',
            'department' => 'IT Support',
            'branch_id' => 931,
            'branch' => 'branch-931',
            'is_active' => 1,
            'password_hash' => bcrypt('password'),
        ]);

        $this->admin = Employee::create([
            'emp_id' => 89302,
            'first_name' => 'Amanda',
            'last_name' => 'Admin',
            'email' => 'admin.timeline.0024@example.com',
            'role' => 'admin',
            'department' => 'Operations',
            'branch_id' => 931,
            'branch' => 'branch-931',
            'is_active' => 1,
            'password_hash' => bcrypt('password'),
        ]);
    }

    /**
     * AC-9, AC-10, AC-3.1, AC-3.3: Timeline captures state mutations chronologically and supports pagination.
     */
    public function test_record_and_retrieve_chronological_timeline(): void
    {
        $now = Carbon::now();

        $ticketId = DB::table('tickets')->insertGetId([
            'ticket_number' => 'TCK-TIME-001',
            'title' => 'Timeline Validation Ticket',
            'description' => 'Test event stream recording',
            'created_by' => 9301,
            'assigned_to' => $this->technician->emp_id,
            'branch_id' => 931,
            'problem_category_ID' => 1,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1,
            'priority_ID' => 1,
            'created_at' => $now->copy()->subHours(3),
            'updated_at' => $now,
        ]);

        // Record three chronological events via service
        $this->timelineService->recordEvent(
            $ticketId,
            'create',
            'ticket_created',
            9301,
            'customer',
            'customer',
            null,
            ['status' => 'Open'],
            'Ticket created by customer',
            false,
            false
        );

        $this->timelineService->recordEvent(
            $ticketId,
            'assignment',
            'technician_assigned',
            $this->admin->emp_id,
            'admin',
            'admin',
            ['assigned_to' => null],
            ['assigned_to' => $this->technician->emp_id],
            'Assigned to technician David',
            false,
            false
        );

        $this->timelineService->recordEvent(
            $ticketId,
            'internal_note',
            'internal_note',
            $this->technician->emp_id,
            'employee',
            'technician',
            null,
            ['note' => 'Investigating port 8080 timeout privately'],
            'Investigating port 8080 timeout privately',
            false,
            true // Internal
        );

        // Fetch as staff member (Technician)
        $response = $this->actingAs($this->technician, 'api')
            ->getJson("/api/tickets/{$ticketId}/timeline?order=desc&per_page=10")
            ->assertOk()
            ->assertJsonStructure([
                'status',
                'data' => [
                    '*' => [
                        'log_id',
                        'ticket_id',
                        'ticket_number',
                        'action_type',
                        'event_type',
                        'actor' => [
                            'id',
                            'name',
                            'type',
                            'role',
                        ],
                        'before_state',
                        'after_state',
                        'details',
                        'is_system',
                        'is_internal',
                        'created_at',
                    ],
                ],
                'pagination' => [
                    'current_page',
                    'per_page',
                    'total',
                    'last_page',
                ],
            ]);

        $data = $response->json('data');
        $this->assertCount(3, $data);
        $this->assertEquals(3, $response->json('pagination.total'));

        // Default desc order: newest event first (internal_note)
        $this->assertEquals('internal_note', $data[0]['action_type']);
        $this->assertTrue($data[0]['is_internal']);

        // Test ascending order
        $ascResp = $this->actingAs($this->technician, 'api')
            ->getJson("/api/tickets/{$ticketId}/timeline?order=asc")
            ->assertOk();
        $ascData = $ascResp->json('data');
        $this->assertEquals('create', $ascData[0]['action_type']);
    }

    /**
     * AC-10, AC-3.4: Filter timeline events by event_type.
     */
    public function test_event_type_filtering(): void
    {
        $ticketId = DB::table('tickets')->insertGetId([
            'ticket_number' => 'TCK-TIME-002',
            'title' => 'Filter Test Ticket',
            'description' => 'Test event filter',
            'created_by' => 9301,
            'branch_id' => 931,
            'problem_category_ID' => 1,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1,
            'priority_ID' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->timelineService->recordEvent($ticketId, 'create', 'ticket_created', 9301, 'customer');
        $this->timelineService->recordEvent($ticketId, 'hold', 'hold', $this->admin->emp_id, 'admin');

        $filteredResp = $this->actingAs($this->admin, 'api')
            ->getJson("/api/tickets/{$ticketId}/timeline?event_type=hold")
            ->assertOk();

        $data = $filteredResp->json('data');
        $this->assertCount(1, $data);
        $this->assertEquals('hold', $data[0]['action_type']);
    }

    /**
     * AC-11, AC-3.5: Customer token automatically redacts all is_internal = true entries.
     */
    public function test_customer_privacy_filter_redacts_internal_records(): void
    {
        $ticketId = DB::table('tickets')->insertGetId([
            'ticket_number' => 'TCK-TIME-003',
            'title' => 'Customer Privacy Ticket',
            'description' => 'Testing redaction',
            'created_by' => 9301,
            'branch_id' => 931,
            'problem_category_ID' => 1,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1,
            'priority_ID' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // 1 public event
        $this->timelineService->recordEvent(
            $ticketId,
            'create',
            'ticket_created',
            9301,
            'customer',
            'customer',
            null,
            null,
            'Public customer submission',
            false,
            false
        );

        // 1 internal technician note (is_internal = true)
        $this->timelineService->recordEvent(
            $ticketId,
            'internal_note',
            'internal_note',
            $this->technician->emp_id,
            'employee',
            'technician',
            null,
            null,
            'Secret internal discussion: possible hardware defect',
            false,
            true
        );

        // When Customer Owner calls the timeline, only the public event is returned
        $custResponse = $this->actingAs($this->customerOwner, 'api')
            ->getJson("/api/tickets/{$ticketId}/timeline")
            ->assertOk();

        $custData = $custResponse->json('data');
        $this->assertCount(1, $custData);
        $this->assertEquals('create', $custData[0]['action_type']);
        $this->assertFalse($custData[0]['is_internal']);

        // When Technician calls the timeline, BOTH events are returned
        $techResponse = $this->actingAs($this->technician, 'api')
            ->getJson("/api/tickets/{$ticketId}/timeline")
            ->assertOk();

        $techData = $techResponse->json('data');
        $this->assertCount(2, $techData);
    }

    /**
     * Customer trying to access another customer's ticket timeline receives 403.
     */
    public function test_customer_cannot_view_another_customers_ticket_timeline(): void
    {
        $ticketId = DB::table('tickets')->insertGetId([
            'ticket_number' => 'TCK-TIME-004',
            'title' => 'Owner Ticket',
            'description' => 'Owned by Alice',
            'created_by' => 9301,
            'branch_id' => 931,
            'problem_category_ID' => 1,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1,
            'priority_ID' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->actingAs($this->customerOther, 'api')
            ->getJson("/api/tickets/{$ticketId}/timeline")
            ->assertStatus(403);
    }

    /**
     * AC-12, AC-3.7: Permanent immutability guard blocks updating or deleting audit logs.
     */
    public function test_immutability_guard_blocks_updates_and_deletions(): void
    {
        $ticketId = DB::table('tickets')->insertGetId([
            'ticket_number' => 'TCK-TIME-005',
            'title' => 'Immutability Ticket',
            'description' => 'Verify audit logs cannot be modified',
            'created_by' => 9301,
            'branch_id' => 931,
            'problem_category_ID' => 1,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1,
            'priority_ID' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $logId = $this->timelineService->recordEvent(
            $ticketId,
            'create',
            'ticket_created',
            9301,
            'customer'
        );

        $logModel = TicketAuditLog::find($logId);
        $this->assertNotNull($logModel);

        // Updating must throw RuntimeException
        $updateBlocked = false;
        try {
            $logModel->details = 'Tampered content';
            $logModel->save();
        } catch (\RuntimeException $e) {
            $updateBlocked = true;
        }
        $this->assertTrue($updateBlocked, 'Updating a TicketAuditLog model must be blocked.');

        // Deleting must throw RuntimeException
        $deleteBlocked = false;
        try {
            $logModel->delete();
        } catch (\RuntimeException $e) {
            $deleteBlocked = true;
        }
        $this->assertTrue($deleteBlocked, 'Deleting a TicketAuditLog model must be blocked.');
    }

    /**
     * AC-3.10: Non-existent ticket returns HTTP 404.
     */
    public function test_non_existent_ticket_returns_404(): void
    {
        $this->actingAs($this->technician, 'api')
            ->getJson('/api/tickets/999999999/timeline')
            ->assertStatus(404);
    }
}

