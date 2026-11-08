<?php

namespace Tests\Feature;

use App\Events\TicketChanged;
use App\Events\TicketDefaultsUpdated;
use App\Models\Client;
use App\Models\Employee;
use App\Services\TicketConfigurationService;
use App\Services\TicketService;
use App\Services\SLAService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class TicketDefaultsTest extends TestCase
{
    use DatabaseTransactions;

    protected Employee $superAdmin;
    protected Employee $regularEmployee;
    protected Client $customer;

    protected function setUp(): void
    {
        parent::setUp();

        // Ensure baseline tables have basic reference data
        DB::table('ticket_priorities')->updateOrInsert(
            ['priority_ID' => 1],
            ['priority_name' => 'Low', 'color_code' => '#22c55e', 'created_at' => now(), 'updated_at' => now()]
        );
        DB::table('ticket_priorities')->updateOrInsert(
            ['priority_ID' => 2],
            ['priority_name' => 'Medium', 'color_code' => '#f59e0b', 'created_at' => now(), 'updated_at' => now()]
        );
        DB::table('ticket_priorities')->updateOrInsert(
            ['priority_ID' => 3],
            ['priority_name' => 'High', 'color_code' => '#ef4444', 'created_at' => now(), 'updated_at' => now()]
        );

        DB::table('ticket_statuses')->updateOrInsert(
            ['ticket_status_ID' => 1],
            ['status_name' => 'Open', 'color_code' => '#f59e0b', 'created_at' => now(), 'updated_at' => now()]
        );
        DB::table('ticket_statuses')->updateOrInsert(
            ['ticket_status_ID' => 2],
            ['status_name' => 'In Progress', 'color_code' => '#2563eb', 'created_at' => now(), 'updated_at' => now()]
        );
        DB::table('ticket_statuses')->updateOrInsert(
            ['ticket_status_ID' => 3],
            ['status_name' => 'Resolved', 'color_code' => '#16a34a', 'created_at' => now(), 'updated_at' => now()]
        );

        DB::table('slas')->updateOrInsert(
            ['sla_ID' => 1],
            ['sla_name' => 'Standard SLA', 'response_time_minutes' => 240, 'resolution_time_minutes' => 1440, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]
        );

        $deptId = DB::table('departments')->where('name', 'Customer Service')->value('id');
        if (!$deptId) {
            DB::table('departments')->insertOrIgnore([
                'name' => 'Customer Service',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        DB::table('problem_categories')->updateOrInsert(
            ['problem_category_ID' => 1],
            ['category_name' => 'Hardware Issue', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]
        );

        $this->seedMachine(1, ['machine_name' => 'Demo Scanner', 'serial_number' => 'SN-1001']);

        // Retrieve or create Super Admin employee
        $this->superAdmin = Employee::where('role', 'superadmin')->first()
            ?? Employee::create([
                'emp_id' => 99991,
                'first_name' => 'Super',
                'last_name' => 'Admin',
                'email' => 'superadmin_test@example.com',
                'role' => 'superadmin',
                'department' => 'Executive',
                'is_active' => true,
                'password_hash' => 'secret',
            ]);

        // Retrieve or create Regular employee
        $this->regularEmployee = Employee::where('role', '!=', 'superadmin')->first()
            ?? Employee::create([
                'emp_id' => 99992,
                'first_name' => 'Regular',
                'last_name' => 'Staff',
                'email' => 'staff_test@example.com',
                'role' => 'service',
                'department' => 'Service',
                'is_active' => true,
                'password_hash' => 'secret',
            ]);

        // Create a dedicated fresh Customer for test runs
        $this->customer = Client::create([
            'client_name' => 'Defaults Test Client',
            'email' => 'client_test_' . uniqid() . '@example.com',
            'contact_number' => '1234567890',
            'address' => 'Test Address',
            'status' => true,
        ]);

        // Satisfy ticket_audit_logs foreign key constraint action_by_ID -> employees(emp_id)
        DB::table('employees')->updateOrInsert(
            ['emp_id' => $this->customer->id],
            [
                'first_name' => 'Client',
                'last_name' => 'User',
                'email' => $this->customer->email,
                'role' => 'client',
                'department' => 'Customer',
                'is_active' => 1,
                'password_hash' => 'secret',
            ]
        );
    }

    /**
     * Test 1: Unauthenticated request is rejected with 401.
     */
    public function test_unauthenticated_request_is_rejected()
    {
        $response = $this->getJson('/api/superadmin/ticket-defaults');
        $this->assertTrue(in_array($response->status(), [401, 403]));
    }

    /**
     * Test 2: Non-superadmin authenticated user is forbidden with 403.
     */
    public function test_non_superadmin_user_is_forbidden()
    {
        $response = $this->actingAs($this->regularEmployee, 'api')
            ->getJson('/api/superadmin/ticket-defaults');

        $response->assertStatus(403);
    }

    /**
     * Test 3: Superadmin can view ticket defaults.
     */
    public function test_superadmin_can_view_ticket_defaults()
    {
        Http::fake([
            '*/api/ticket-configurations/defaults' => Http::response([
                'status' => 'Open',
                'priority' => 'Low',
                'slaPolicy' => 'dynamic',
            ], 200),
        ]);

        TicketConfigurationService::clearDefaultsCache();

        $response = $this->actingAs($this->superAdmin, 'api')
            ->getJson('/api/superadmin/ticket-defaults');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'key',
            'value' => ['status', 'priority', 'slaPolicy'],
            'status',
            'priority',
            'slaPolicy',
            'available_starting_statuses',
            'available_priorities',
            'available_slas',
        ]);
        $this->assertEquals('Open', $response->json('status'));
        $this->assertEquals('Low', $response->json('priority'));
    }

    /**
     * Test 4: Validation restricts default status to a valid starting status per state machine.
     */
    public function test_validation_restricts_default_status_to_valid_starting_status()
    {
        $invalidStatuses = ['In Progress', 'Resolved', 'Closed', 'Cancelled', 'NonExistentStatus'];

        foreach ($invalidStatuses as $badStatus) {
            $response = $this->actingAs($this->superAdmin, 'api')
                ->putJson('/api/superadmin/ticket-defaults', [
                    'status' => $badStatus,
                    'priority' => 'Low',
                    'slaPolicy' => 'dynamic',
                ]);

            $response->assertStatus(422);
            $response->assertJsonValidationErrors(['status']);
        }
    }

    /**
     * Test 5: Validation restricts default priority to an existing configured priority level.
     */
    public function test_validation_restricts_default_priority_to_existing_configured_level()
    {
        $response = $this->actingAs($this->superAdmin, 'api')
            ->putJson('/api/superadmin/ticket-defaults', [
                'status' => 'Open',
                'priority' => 'UltraMegaUrgent', // Does not exist in ticket_priorities
                'slaPolicy' => 'dynamic',
            ]);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['priority']);
    }

    /**
     * Test 6: Validation rejects invalid SLA policy.
     */
    public function test_validation_rejects_invalid_sla_policy()
    {
        $response = $this->actingAs($this->superAdmin, 'api')
            ->putJson('/api/superadmin/ticket-defaults', [
                'status' => 'Open',
                'priority' => 'Low',
                'slaPolicy' => 'InvalidPolicyName999',
            ]);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors(['slaPolicy']);
    }

    /**
     * Test 7: Superadmin can update ticket defaults successfully with event and audit logging.
     */
    public function test_superadmin_can_update_ticket_defaults_with_audit_and_event()
    {
        Event::fake([TicketDefaultsUpdated::class, TicketChanged::class]);

        Http::fake([
            '*/api/ticket-configurations/defaults' => Http::response([
                'status' => 'Open',
                'priority' => 'Medium',
                'slaPolicy' => 'Standard SLA',
            ], 200),
        ]);

        TicketConfigurationService::clearDefaultsCache();

        $response = $this->actingAs($this->superAdmin, 'api')
            ->putJson('/api/superadmin/ticket-defaults', [
                'status' => 'Open',
                'priority' => 'Medium',
                'slaPolicy' => 'Standard SLA',
            ]);

        $response->assertStatus(200);
        $this->assertEquals('Open', $response->json('status'));
        $this->assertEquals('Medium', $response->json('priority'));
        $this->assertEquals('Standard SLA', $response->json('slaPolicy'));

        // Verify Event published
        Event::assertDispatched(TicketDefaultsUpdated::class);
        Event::assertDispatched(TicketChanged::class);

        // Verify Audit Log recorded in database
        $auditLog = DB::table('ticket_audit_logs')
            ->where('action_type', 'config_update')
            ->where('action_by_ID', $this->superAdmin->emp_id)
            ->where('actor_type', 'superadmin')
            ->orderBy('log_ID', 'desc')
            ->first();

        $this->assertNotNull($auditLog);
        $details = json_decode($auditLog->details, true);
        $this->assertEquals('Ticket Defaults Configuration', $details['module']);
        $this->assertEquals('Medium', $details['new_defaults']['priority']);
    }

    /**
     * Test 8: Superadmin can reset ticket defaults to system baseline.
     */
    public function test_superadmin_can_reset_ticket_defaults()
    {
        Event::fake([TicketDefaultsUpdated::class, TicketChanged::class]);

        Http::fake([
            '*/api/ticket-configurations/defaults/reset' => Http::response([
                'status' => 'Open',
                'priority' => 'Low',
                'slaPolicy' => 'dynamic',
            ], 200),
        ]);

        TicketConfigurationService::clearDefaultsCache();

        $response = $this->actingAs($this->superAdmin, 'api')
            ->postJson('/api/superadmin/ticket-defaults/reset');

        $response->assertStatus(200);
        $this->assertEquals('Open', $response->json('status'));
        $this->assertEquals('Low', $response->json('priority'));
        $this->assertEquals('dynamic', $response->json('slaPolicy'));

        Event::assertDispatched(TicketDefaultsUpdated::class);

        $auditLog = DB::table('ticket_audit_logs')
            ->where('action_type', 'config_reset')
            ->where('action_by_ID', $this->superAdmin->emp_id)
            ->orderBy('log_ID', 'desc')
            ->first();

        $this->assertNotNull($auditLog);
    }

    /**
     * Test 9: Ticket creation applies default status and priority ONLY when no other value is supplied or determined.
     */
    public function test_ticket_creation_applies_defaults_when_not_supplied()
    {
        // Mock defaults config to Medium priority
        Http::fake([
            '*/api/ticket-configurations/defaults' => Http::response([
                'status' => 'Open',
                'priority' => 'Medium',
                'slaPolicy' => 'dynamic',
            ], 200),
            'http://attachment-service:8000/*' => Http::response([], 200),
            'http://messaging-service:8000/*' => Http::response([], 200),
        ]);
        TicketConfigurationService::clearDefaultsCache();

        /** @var TicketService $ticketService */
        $ticketService = app(TicketService::class);

        // Customer creates ticket without priority_ID
        $payload = [
            'machine_ID' => 1,
            'problem_category_ID' => 1,
            'title' => 'Scanner Malfunction Alert',
            'description' => 'Scanner is throwing an optical sensor fault.',
        ];

        $result = $ticketService->createTicket($payload, $this->customer, 2);
        $ticketId = $result['ticket']->ticket_ID;

        $createdTicket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();

        // Default status 1 ('Open') and default priority 2 ('Medium') must be applied
        $this->assertEquals(1, $createdTicket->ticket_status_ID);
        $this->assertEquals(2, $createdTicket->priority_ID);
    }

    /**
     * Test 10: Ticket creation uses supplied priority when explicitly provided.
     */
    public function test_ticket_creation_respects_supplied_priority()
    {
        // Mock defaults config to Low priority
        Http::fake([
            '*/api/ticket-configurations/defaults' => Http::response([
                'status' => 'Open',
                'priority' => 'Low',
                'slaPolicy' => 'dynamic',
            ], 200),
            'http://attachment-service:8000/*' => Http::response([], 200),
            'http://messaging-service:8000/*' => Http::response([], 200),
        ]);
        TicketConfigurationService::clearDefaultsCache();

        /** @var TicketService $ticketService */
        $ticketService = app(TicketService::class);

        // Creator explicitly provides High priority (3)
        $payload = [
            'machine_ID' => 1,
            'problem_category_ID' => 1,
            'priority_ID' => 3, // High
            'title' => 'Critical Optical Failure',
            'description' => 'System offline completely.',
        ];

        $result = $ticketService->createTicket($payload, $this->customer, 2);
        $ticketId = $result['ticket']->ticket_ID;

        $createdTicket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();

        // Must respect explicitly supplied priority (3), not default
        $this->assertEquals(3, $createdTicket->priority_ID);
    }

    /**
     * Test 11: SLA Fallback Logic:
     * - When a category/priority/branch-specific SLA rule matches, matched rule is applied.
     * - When NO rule matches, default SLA policy fallback is applied.
     */
    public function test_sla_policy_fallback_logic()
    {
        /** @var SLAService $slaService */
        $slaService = app(SLAService::class);

        // Create a specific SLA rule for Department 2, Category 1, High priority
        DB::table('sla_rules')->insert([
            'id' => 999,
            'department_id' => 2,
            'category_id' => 1,
            'priority' => 'High',
            'response_time_limit' => 60,
            'resolution_time_limit' => 240,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Create dummy ticket 1: matches the rule
        $ticket1Id = DB::table('tickets')->insertGetId([
            'machine_ID' => 1,
            'problem_category_ID' => 1,
            'created_by' => $this->customer->id,
            'ticket_type_ID' => 2,
            'is_internal' => false,
            'priority_ID' => 3,
            'ticket_status_ID' => 1,
            'title' => 'Matched Rule Ticket',
            'description' => 'Desc',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $res1 = $slaService->assignSlaToTicket($ticket1Id, 2, 1, 'High', now(), 'Standard SLA');
        $this->assertFalse($res1['is_fallback']);
        $this->assertEquals(999, $res1['sla_rule_id']);
        $this->assertEquals(60, $res1['response_time_limit']);

        // Create dummy ticket 2: NO matching rule exists (department 99, category 99, priority Unknown)
        $ticket2Id = DB::table('tickets')->insertGetId([
            'machine_ID' => 1,
            'problem_category_ID' => 1,
            'created_by' => $this->customer->id,
            'ticket_type_ID' => 2,
            'is_internal' => false,
            'priority_ID' => 1,
            'ticket_status_ID' => 1,
            'title' => 'Fallback Rule Ticket',
            'description' => 'Desc',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $res2 = $slaService->assignSlaToTicket($ticket2Id, 99, 99, 'NonExistentPriority', now(), 'Standard SLA');
        $this->assertTrue($res2['is_fallback']);
        $this->assertEquals(1, $res2['sla_ID']); // Standard SLA id
        $this->assertNull($res2['sla_rule_id']);
        $this->assertEquals(240, $res2['response_time_limit']);
    }

    /**
     * Test 12: Changing defaults does NOT alter already-created tickets.
     */
    public function test_changing_defaults_does_not_alter_existing_tickets()
    {
        // 1. Create ticket under initial defaults
        $ticketId = DB::table('tickets')->insertGetId([
            'machine_ID' => 1,
            'problem_category_ID' => 1,
            'created_by' => $this->customer->id,
            'ticket_type_ID' => 2,
            'is_internal' => false,
            'priority_ID' => 1, // Low
            'ticket_status_ID' => 1, // Open
            'title' => 'Original Baseline Ticket',
            'description' => 'Desc',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // 2. Change defaults to High priority
        Http::fake([
            '*/api/ticket-configurations/defaults' => Http::response([
                'status' => 'Open',
                'priority' => 'High',
                'slaPolicy' => 'Standard SLA',
            ], 200),
        ]);

        $this->actingAs($this->superAdmin, 'api')
            ->putJson('/api/superadmin/ticket-defaults', [
                'status' => 'Open',
                'priority' => 'High',
                'slaPolicy' => 'Standard SLA',
            ]);

        // 3. Inspect existing ticket
        $ticketAfter = DB::table('tickets')->where('ticket_ID', $ticketId)->first();

        // Priority and status of existing ticket must NOT be changed!
        $this->assertEquals(1, $ticketAfter->priority_ID);
        $this->assertEquals(1, $ticketAfter->ticket_status_ID);
    }
}
