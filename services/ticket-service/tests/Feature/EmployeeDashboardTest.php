<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Client;
use App\Models\Employee;
use App\Services\EmployeeDashboardService;
use App\Services\SLAService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class EmployeeDashboardTest extends TestCase
{
    use DatabaseTransactions;

    protected Employee $employeeA;
    protected Employee $employeeB;
    protected Client $customer;

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'mysql']);
        config(['database.connections.mysql.database' => 'ticketing_system_test']);
        DB::purge('mysql');
        DB::reconnect('mysql');

        Cache::flush();

        $testEmails = [
            'emp.alice.0024@example.com',
            'emp.bob.0024@example.com',
        ];

        DB::table('ticket_audit_logs')->whereIn('ticket_ID', function ($q) {
            $q->select('ticket_ID')->from('tickets')->whereIn('branch_id', [921, 922]);
        })->delete();

        DB::table('tickets')->whereIn('branch_id', [921, 922])->delete();
        DB::table('employees')->whereIn('email', $testEmails)->delete();

        // Branches
        DB::table('branches')->updateOrInsert(
            ['id' => 921],
            [
                'slug' => 'branch-921',
                'name' => 'Branch 921',
                'code' => 'B921',
                'region' => 'Central',
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        // Problem category, priorities, statuses
        DB::table('problem_categories')->updateOrInsert(
            ['problem_category_ID' => 1],
            ['category_name' => 'Hardware', 'created_at' => now(), 'updated_at' => now()]
        );
        DB::table('ticket_types')->updateOrInsert(
            ['ticket_type_ID' => 1],
            ['type_name' => 'Incident', 'created_at' => now(), 'updated_at' => now()]
        );
        DB::table('ticket_priorities')->updateOrInsert(
            ['priority_ID' => 1],
            ['priority_name' => 'Low', 'color_code' => 'green', 'created_at' => now(), 'updated_at' => now()]
        );
        DB::table('ticket_priorities')->updateOrInsert(
            ['priority_ID' => 3],
            ['priority_name' => 'High', 'color_code' => 'red', 'created_at' => now(), 'updated_at' => now()]
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
        DB::table('ticket_statuses')->updateOrInsert(
            ['ticket_status_ID' => 4],
            ['status_name' => 'Closed', 'created_at' => now(), 'updated_at' => now()]
        );
        DB::table('ticket_statuses')->updateOrInsert(
            ['ticket_status_ID' => 5],
            ['status_name' => 'Reopened', 'created_at' => now(), 'updated_at' => now()]
        );

        DB::table('clients')->updateOrInsert(
            ['id' => 9201],
            [
                'client_name' => 'Client 9201',
                'email' => 'client9201@example.com',
                'contact_number' => '5559201',
                'address' => '9201 Client Way',
                'status' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
        $this->customer = Client::find(9201);

        $this->employeeA = Employee::create([
            'emp_id' => 89201,
            'first_name' => 'Alice',
            'last_name' => 'Engineer',
            'email' => 'emp.alice.0024@example.com',
            'role' => 'technician',
            'department' => 'Field Services',
            'branch_id' => 921,
            'branch' => 'branch-921',
            'is_active' => 1,
            'password_hash' => bcrypt('password'),
        ]);

        $this->employeeB = Employee::create([
            'emp_id' => 89202,
            'first_name' => 'Bob',
            'last_name' => 'Technician',
            'email' => 'emp.bob.0024@example.com',
            'role' => 'technician',
            'department' => 'Field Services',
            'branch_id' => 921,
            'branch' => 'branch-921',
            'is_active' => 1,
            'password_hash' => bcrypt('password'),
        ]);
    }

    /**
     * AC-6, AC-2.1, AC-2.2, AC-2.5: Dual role dashboard returns separated assigned & requested sections.
     */
    public function test_employee_can_view_dual_role_dashboard(): void
    {
        $now = Carbon::now();

        // 1. Tickets Assigned to Alice: 1 Open, 1 In Progress
        DB::table('tickets')->insert([
            'ticket_number' => 'TCK-ASSIGN-01',
            'title' => 'Assigned Printer Repair',
            'description' => 'Fix paper jam sensor',
            'created_by' => 9201,
            'assigned_to' => $this->employeeA->emp_id,
            'branch_id' => 921,
            'problem_category_ID' => 1,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1, // Open
            'priority_ID' => 1,
            'created_at' => $now->copy()->subHours(5),
            'resolution_due_at' => $now->copy()->addHours(20),
            'updated_at' => $now,
        ]);

        DB::table('tickets')->insert([
            'ticket_number' => 'TCK-ASSIGN-02',
            'title' => 'Assigned Workstation Setup',
            'description' => 'Deploy developer laptop',
            'created_by' => 9201,
            'assigned_to' => $this->employeeA->emp_id,
            'branch_id' => 921,
            'problem_category_ID' => 1,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 2, // In Progress
            'priority_ID' => 3,
            'created_at' => $now->copy()->subHours(10),
            'resolution_due_at' => $now->copy()->subHour(1), // Breached
            'updated_at' => $now,
        ]);

        // 2. Tickets Requested by Alice: 1 Resolved pending auto-close, 1 Reopened
        DB::table('tickets')->insert([
            'ticket_number' => 'TCK-REQ-01',
            'title' => 'Requested Monitor Stand Replacement',
            'description' => 'Need ergonomic arm',
            'created_by' => 1,
            'requested_by' => $this->employeeA->emp_id,
            'assigned_to' => $this->employeeB->emp_id,
            'branch_id' => 921,
            'problem_category_ID' => 1,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 3, // Resolved
            'priority_ID' => 1,
            'resolved_at' => $now->copy()->subHours(4),
            'created_at' => $now->copy()->subDays(1),
            'updated_at' => $now,
        ]);

        DB::table('tickets')->insert([
            'ticket_number' => 'TCK-REQ-02',
            'title' => 'Requested Keyboard Issue',
            'description' => 'Keys sticking again',
            'created_by' => 1,
            'requested_by' => $this->employeeA->emp_id,
            'assigned_to' => $this->employeeB->emp_id,
            'branch_id' => 921,
            'problem_category_ID' => 1,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 5, // Reopened
            'priority_ID' => 1,
            'created_at' => $now->copy()->subDays(2),
            'updated_at' => $now,
        ]);

        // 3. Ticket Assigned to Bob (Should NOT appear in Alice's assigned list)
        DB::table('tickets')->insert([
            'ticket_number' => 'TCK-BOB-01',
            'title' => 'Bob Private Task',
            'description' => 'Should not be seen by Alice',
            'created_by' => 9201,
            'assigned_to' => $this->employeeB->emp_id,
            'branch_id' => 921,
            'problem_category_ID' => 1,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1,
            'priority_ID' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $response = $this->actingAs($this->employeeA, 'api')
            ->getJson('/api/employee/dashboard?force_refresh=true')
            ->assertOk()
            ->assertJsonStructure([
                'status',
                'assigned' => [
                    'total_assigned',
                    'status_breakdown' => [
                        'open',
                        'in_progress',
                        'on_hold',
                        'resolved',
                        'closed',
                    ],
                    'sla_risk' => [
                        'within_sla',
                        'near_breach',
                        'breached',
                    ],
                    'recent_tickets' => [
                        '*' => [
                            'ticket_id',
                            'ticket_number',
                            'title',
                            'priority',
                            'status',
                            'resolution_due_at',
                            'sla_risk_indicator',
                        ],
                    ],
                ],
                'requested' => [
                    'total_requested',
                    'status_breakdown' => [
                        'open',
                        'in_progress',
                        'on_hold',
                        'resolved',
                        'closed',
                    ],
                    'auto_close_pending_count',
                    'reopened_count',
                    'recent_tickets' => [
                        '*' => [
                            'ticket_id',
                            'ticket_number',
                            'title',
                            'status',
                            'assigned_technician_name',
                            'auto_close_countdown_seconds',
                            'is_reopened',
                        ],
                    ],
                ],
                'partial_errors',
            ]);

        $assigned = $response->json('assigned');
        $requested = $response->json('requested');

        $this->assertEquals(2, $assigned['total_assigned']);
        $this->assertEquals(1, $assigned['status_breakdown']['open']);
        $this->assertEquals(1, $assigned['status_breakdown']['in_progress']);
        $this->assertEquals(1, $assigned['sla_risk']['breached']);

        $this->assertEquals(2, $requested['total_requested']);
        $this->assertEquals(1, $requested['auto_close_pending_count']);
        $this->assertEquals(1, $requested['reopened_count']);
        $this->assertEmpty($response->json('partial_errors'));
    }

    /**
     * AC-7, AC-2.7: Server side scoping strictly confines data to authenticated employee.
     */
    public function test_employee_isolation_blocks_cross_technician_data(): void
    {
        // When Bob calls the endpoint, Alice's tickets are not in his queue
        $response = $this->actingAs($this->employeeB, 'api')
            ->getJson('/api/employee/dashboard?force_refresh=true')
            ->assertOk();

        $assigned = $response->json('assigned');
        $this->assertEquals(0, $assigned['total_assigned']);
    }

    /**
     * Customer role receives HTTP 403 Forbidden.
     */
    public function test_customer_role_is_denied_access(): void
    {
        $this->actingAs($this->customer, 'api')
            ->getJson('/api/employee/dashboard')
            ->assertStatus(403);
    }

    /**
     * AC-8, AC-2.8: Graceful partial failure isolation returns HTTP 200 with partial_errors.
     */
    public function test_graceful_partial_failure_isolation(): void
    {
        // Mock EmployeeDashboardService to simulate partial failure in requested section
        $mockService = $this->createMock(EmployeeDashboardService::class);
        $mockService->method('getEmployeeDashboard')
            ->willReturn([
                'assigned' => [
                    'total_assigned' => 5,
                    'status_breakdown' => ['open' => 5, 'in_progress' => 0, 'on_hold' => 0, 'resolved' => 0, 'closed' => 0],
                    'sla_risk' => ['within_sla' => 5, 'near_breach' => 0, 'breached' => 0],
                    'recent_tickets' => [],
                ],
                'requested' => null,
                'partial_errors' => [
                    [
                        'section' => 'requested',
                        'message' => 'Connection timeout to replica database',
                    ],
                ],
            ]);

        $this->app->instance(EmployeeDashboardService::class, $mockService);

        $response = $this->actingAs($this->employeeA, 'api')
            ->getJson('/api/employee/dashboard')
            ->assertOk();

        $this->assertNotNull($response->json('assigned'));
        $this->assertNull($response->json('requested'));
        $this->assertCount(1, $response->json('partial_errors'));
        $this->assertEquals('requested', $response->json('partial_errors.0.section'));
    }
}

