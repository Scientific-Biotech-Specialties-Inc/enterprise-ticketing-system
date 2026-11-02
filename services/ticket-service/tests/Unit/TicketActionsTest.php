<?php

namespace Tests\Unit;

use Tests\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use App\Models\Client;
use App\Models\Employee;
use App\Actions\Tickets\CreateTicketAction;
use App\Actions\Tickets\AssignTicketAction;
use App\Actions\Tickets\TransitionTicketStatusAction;
use App\Actions\Tickets\CalculateTicketSlaAction;
use App\Actions\Dashboards\GetCustomerDashboardMetricsAction;
use App\Actions\Dashboards\GetCsDashboardMetricsAction;
use App\Actions\Dashboards\GetAdminDashboardMetricsAction;

class TicketActionsTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'mysql']);
        config(['database.connections.mysql.database' => 'ticketing_system_test']);
        DB::purge('mysql');
        DB::reconnect('mysql');

        // Seed basic statuses & priorities for action tests
        if (!DB::table('ticket_statuses')->where('ticket_status_ID', 1)->exists()) {
            DB::table('ticket_statuses')->insert([
                ['ticket_status_ID' => 1, 'status_name' => 'Open', 'created_at' => now(), 'updated_at' => now()],
                ['ticket_status_ID' => 2, 'status_name' => 'In Progress', 'created_at' => now(), 'updated_at' => now()],
                ['ticket_status_ID' => 3, 'status_name' => 'On Hold', 'created_at' => now(), 'updated_at' => now()],
                ['ticket_status_ID' => 4, 'status_name' => 'Resolved', 'created_at' => now(), 'updated_at' => now()],
                ['ticket_status_ID' => 5, 'status_name' => 'Closed', 'created_at' => now(), 'updated_at' => now()],
            ]);
        }

        if (!DB::table('ticket_priorities')->where('priority_ID', 1)->exists()) {
            DB::table('ticket_priorities')->insert([
                ['priority_ID' => 1, 'priority_name' => 'Low', 'created_at' => now(), 'updated_at' => now()],
                ['priority_ID' => 2, 'priority_name' => 'Medium', 'created_at' => now(), 'updated_at' => now()],
                ['priority_ID' => 3, 'priority_name' => 'High', 'created_at' => now(), 'updated_at' => now()],
                ['priority_ID' => 4, 'priority_name' => 'Urgent', 'created_at' => now(), 'updated_at' => now()],
            ]);
        }

        if (!DB::table('problem_categories')->where('problem_category_ID', 1)->exists()) {
            DB::table('problem_categories')->insert([
                'problem_category_ID' => 1,
                'category_name' => 'Hardware',
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        if (!DB::table('departments')->where('id', 2)->exists()) {
            DB::table('departments')->insert([
                'id' => 2,
                'name' => 'Service Department',
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        DB::table('ticket_types')->updateOrInsert(
            ['ticket_type_ID' => 1],
            ['type_name' => 'Internal', 'created_at' => now(), 'updated_at' => now()]
        );
        DB::table('ticket_types')->updateOrInsert(
            ['ticket_type_ID' => 2],
            ['type_name' => 'External', 'created_at' => now(), 'updated_at' => now()]
        );
    }

    /**
     * covers: AC-7
     */
    public function test_assign_ticket_action_assigns_employee_and_writes_audit_log(): void
    {
        $ticketId = DB::table('tickets')->insertGetId([
            'ticket_number' => 'TKT-ASSIGN-' . uniqid(),
            'title' => 'Test Ticket for Assignment',
            'description' => 'Test description',
            'created_by' => 1,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1,
            'priority_ID' => 1,
            'problem_category_ID' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $employeeId = DB::table('employees')->insertGetId([
            'email' => 'tech.' . uniqid() . '@hospital.com',
            'first_name' => 'Jane',
            'last_name' => 'Tech',
            'role' => 'service',
            'department' => 'Service',
            'is_active' => true,
            'password_hash' => 'hash',
        ]);

        $actor = new Employee();
        $actor->emp_id = 99;
        $actor->first_name = 'Admin';
        $actor->last_name = 'User';

        $action = app(AssignTicketAction::class);
        $result = $action->execute($ticketId, $employeeId, $actor, 'Initial dispatch');

        $this->assertTrue($result['success']);
        $this->assertEquals($employeeId, $result['assigned_to']);

        $updatedTicket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        $this->assertEquals($employeeId, $updatedTicket->assigned_to);

        $this->assertDatabaseHas('ticket_audit_logs', [
            'ticket_ID' => $ticketId,
            'action_type' => 'assigned',
            'actor_id' => 99,
        ]);
    }

    /**
     * covers: AC-7
     */
    public function test_assign_ticket_action_returns_404_when_ticket_not_found(): void
    {
        $actor = new Employee();
        $actor->emp_id = 99;

        $action = app(AssignTicketAction::class);
        $result = $action->execute(99999999, 1, $actor);

        $this->assertFalse($result['success']);
        $this->assertEquals(404, $result['status']);
        $this->assertEquals('Ticket not found.', $result['message']);
    }

    /**
     * covers: AC-7
     */
    public function test_assign_ticket_action_returns_404_when_employee_not_found(): void
    {
        $ticketId = DB::table('tickets')->insertGetId([
            'ticket_number' => 'TKT-ASSIGN-NOTFOUND-' . uniqid(),
            'title' => 'Test Assignee Missing',
            'description' => 'Test description',
            'created_by' => 1,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1,
            'priority_ID' => 1,
            'problem_category_ID' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $actor = new Employee();
        $actor->emp_id = 99;

        $action = app(AssignTicketAction::class);
        $result = $action->execute($ticketId, 88888888, $actor);

        $this->assertFalse($result['success']);
        $this->assertEquals(404, $result['status']);
        $this->assertEquals('Assignee employee not found.', $result['message']);
    }

    /**
     * covers: AC-7
     */
    public function test_calculate_ticket_sla_action_returns_metrics(): void
    {
        $ticketId = DB::table('tickets')->insertGetId([
            'ticket_number' => 'TKT-SLA-' . uniqid(),
            'title' => 'Test SLA Ticket',
            'description' => 'SLA check',
            'created_by' => 1,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1,
            'priority_ID' => 1,
            'problem_category_ID' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $action = app(CalculateTicketSlaAction::class);
        $result = $action->execute($ticketId);

        $this->assertTrue($result['success']);
        $this->assertEquals($ticketId, $result['ticket_id']);
        $this->assertEquals('Low', $result['priority']);
    }

    /**
     * covers: AC-7
     */
    public function test_calculate_ticket_sla_action_returns_error_when_ticket_not_found(): void
    {
        $action = app(CalculateTicketSlaAction::class);
        $result = $action->execute(99999999);

        $this->assertFalse($result['success']);
        $this->assertEquals('Ticket not found.', $result['message']);
    }

    /**
     * covers: AC-7
     */
    public function test_create_ticket_action_creates_ticket_successfully(): void
    {
        $uid = uniqid();
        $client = Client::create([
            'client_name' => 'Clinic ' . $uid,
            'email' => 'clinic.' . $uid . '@test.com',
            'contact_number' => '123-456-7890',
            'address' => '100 Medical Plaza',
        ]);

        $action = app(CreateTicketAction::class);
        $payload = [
            'title' => 'Ultrasound Machine Sensor Offline',
            'description' => 'The transducer probe reports intermittent signal losses.',
            'problem_category_ID' => 1,
            'priority_ID' => 1,
            'origin' => 'portal',
        ];

        $result = $action->execute($payload, $client, 2);

        $this->assertTrue($result['success']);
        $this->assertArrayHasKey('ticket_id', $result);
        $this->assertArrayHasKey('ticket_number', $result);

        $this->assertDatabaseHas('tickets', [
            'ticket_ID' => $result['ticket_id'],
            'created_by' => $client->id,
            'title' => 'Ultrasound Machine Sensor Offline',
        ]);
    }

    /**
     * covers: AC-7
     */
    public function test_create_ticket_action_rejects_non_client_user(): void
    {
        $employee = new Employee();
        $employee->emp_id = 1;

        $action = app(CreateTicketAction::class);
        $payload = [
            'title' => 'Unauthorized submission attempt',
            'description' => 'Staff cannot use client creation action.',
            'problem_category_ID' => 1,
        ];

        $this->expectException(\LogicException::class);
        $this->expectExceptionMessage('Only authenticated customers can create external tickets.');

        $action->execute($payload, $employee);
    }

    /**
     * covers: AC-7
     */
    public function test_transition_ticket_status_action_successfully_updates_status(): void
    {
        $ticketId = DB::table('tickets')->insertGetId([
            'ticket_number' => 'TKT-TRANS-01-' . uniqid(),
            'title' => 'Transition Test Ticket',
            'description' => 'Testing lifecycle transitions',
            'created_by' => 1,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1, // Open
            'priority_ID' => 1,
            'problem_category_ID' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $actor = new Employee();
        $actor->emp_id = 50;
        $actor->first_name = 'Engineer';
        $actor->last_name = 'Staff';

        $action = app(TransitionTicketStatusAction::class);
        $result = $action->execute($ticketId, 2, $actor, ['reason' => 'Technician started investigation']);

        $this->assertTrue($result['success']);
        $this->assertEquals('In Progress', $result['new_status']);

        $updated = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        $this->assertEquals(2, $updated->ticket_status_ID);
    }

    /**
     * covers: AC-7
     */
    public function test_transition_ticket_status_action_returns_early_for_identical_status(): void
    {
        $ticketId = DB::table('tickets')->insertGetId([
            'ticket_number' => 'TKT-TRANS-02-' . uniqid(),
            'title' => 'Identical Status Test',
            'description' => 'Testing idempotency',
            'created_by' => 1,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1,
            'priority_ID' => 1,
            'problem_category_ID' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $actor = new Employee();
        $actor->emp_id = 50;

        $action = app(TransitionTicketStatusAction::class);
        $result = $action->execute($ticketId, 1, $actor);

        $this->assertTrue($result['success']);
        $this->assertEquals('Ticket is already in this status.', $result['message']);
    }

    /**
     * covers: AC-7
     */
    public function test_transition_ticket_status_action_returns_404_for_non_existent_ticket(): void
    {
        $actor = new Employee();
        $actor->emp_id = 50;

        $action = app(TransitionTicketStatusAction::class);
        $result = $action->execute(99999999, 2, $actor);

        $this->assertFalse($result['success']);
        $this->assertEquals(404, $result['status']);
        $this->assertEquals('Ticket not found.', $result['message']);
    }

    /**
     * covers: AC-7
     */
    public function test_get_customer_dashboard_metrics_action_returns_metrics_for_customer(): void
    {
        $uid = uniqid();
        $client = Client::create([
            'client_name' => 'Hospital Dash ' . $uid,
            'email' => 'dash.' . $uid . '@hospital.com',
            'contact_number' => '555-444-3333',
            'address' => '500 Health Way',
        ]);

        $ticketId = DB::table('tickets')->insertGetId([
            'ticket_number' => 'TKT-DASH-' . substr($uid, -4),
            'title' => 'Customer Metric Ticket',
            'description' => 'Dashboard count test',
            'created_by' => $client->id,
            'ticket_type_ID' => 2,
            'ticket_status_ID' => 1,
            'priority_ID' => 1,
            'problem_category_ID' => 1,
            'is_internal' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $action = app(GetCustomerDashboardMetricsAction::class);
        $result = $action->execute($client->id, 5);

        $this->assertIsArray($result);
        $this->assertArrayHasKey('summary', $result);
        $this->assertArrayHasKey('recent_tickets', $result);
        $this->assertEquals(1, $result['summary']['open']);
    }

    /**
     * covers: AC-7
     */
    public function test_get_cs_dashboard_metrics_action_returns_workload_metrics(): void
    {
        $action = app(GetCsDashboardMetricsAction::class);
        $result = $action->execute(10);

        $this->assertIsArray($result);
        $this->assertArrayHasKey('summary', $result);
        $this->assertArrayHasKey('recent_tickets', $result);
    }

    /**
     * covers: AC-7
     */
    public function test_get_admin_dashboard_metrics_action_returns_scoped_metrics(): void
    {
        $superAdmin = new Employee();
        $superAdmin->emp_id = 1;
        $superAdmin->role = 'superadmin';

        $action = app(GetAdminDashboardMetricsAction::class);
        $result = $action->execute($superAdmin, ['scope' => 'all'], true);

        $this->assertIsArray($result);
        $this->assertArrayHasKey('kpis', $result);
        $this->assertArrayHasKey('status_distribution', $result);
    }
}
