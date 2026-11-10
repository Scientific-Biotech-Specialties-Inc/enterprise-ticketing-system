<?php

namespace Tests\Feature;

use App\Models\Employee;
use App\Services\CsDashboardSummaryService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Spec 0028 AC-12: CS "My Dashboard" is scoped to the agent's own activity and branch queue.
 */
class CsDashboardSummaryTest extends TestCase
{
    use DatabaseTransactions;

    private const BRANCH = 921;
    private const OTHER_BRANCH = 922;
    private const NUMBERS = ['TCK-CSD-Q', 'TCK-CSD-OWN', 'TCK-CSD-DEL', 'TCK-CSD-OTHER', 'TCK-CSD-BR', 'TCK-CSD-DONE', 'TCK-CSD-NULL'];
    private const EMAILS = ['csd.agent@example.com', 'csd.other@example.com', 'csd.tech@example.com', 'csd.customer.role@example.com'];

    protected Employee $agentA;
    protected Employee $agentB;
    protected Employee $tech;
    protected Employee $nonCs;
    protected array $ids = [];

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'mysql']);
        config(['database.connections.mysql.database' => 'ticketing_system_test']);
        DB::purge('mysql');
        DB::reconnect('mysql');
        Cache::flush();
        $this->cleanUp();

        foreach ([self::BRANCH => 'one', self::OTHER_BRANCH => 'two'] as $id => $slug) {
            DB::table('branches')->updateOrInsert(['id' => $id], [
                'slug' => "csd-{$slug}-{$id}", 'name' => "CSD Branch {$slug}", 'code' => 'C' . $id,
                'region' => 'Test', 'is_active' => 1, 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
        DB::table('problem_categories')->updateOrInsert(['problem_category_ID' => 1], ['category_name' => 'Hardware', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('ticket_types')->updateOrInsert(['ticket_type_ID' => 1], ['type_name' => 'Incident', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('ticket_priorities')->updateOrInsert(['priority_ID' => 1], ['priority_name' => 'Low', 'color_code' => 'green', 'created_at' => now(), 'updated_at' => now()]);
        foreach ([1 => 'Open', 2 => 'In Progress', 3 => 'Resolved', 4 => 'Closed'] as $id => $name) {
            DB::table('ticket_statuses')->updateOrInsert(['ticket_status_ID' => $id], ['status_name' => $name, 'created_at' => now(), 'updated_at' => now()]);
        }
        DB::table('clients')->updateOrInsert(['id' => 9401], [
            'client_name' => 'CSD Customer', 'email' => 'csd.customer@example.com', 'contact_number' => '5550000',
            'address' => 'x', 'status' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->agentA = $this->employee(89201, 'csd.agent@example.com', 'customer service');
        $this->agentB = $this->employee(89202, 'csd.other@example.com', 'customer service');
        $this->tech = $this->employee(89203, 'csd.tech@example.com', 'technician');
        $this->nonCs = $this->employee(89204, 'csd.customer.role@example.com', 'technician');

        $overdue = now()->subHours(6);
        // In the branch queue: unassigned and already past due.
        $this->ids['queued'] = $this->ticket('TCK-CSD-Q', self::BRANCH, 1, null, $overdue);
        // Owned by agent A, healthy.
        $this->ids['own'] = $this->ticket('TCK-CSD-OWN', self::BRANCH, 2, $this->agentA->emp_id, now()->addDays(3));
        // Delegated by agent B to a technician and past due.
        $this->ids['delegated'] = $this->ticket('TCK-CSD-DEL', self::BRANCH, 2, $this->tech->emp_id, $overdue);
        DB::table('ticket_assignments')->insert([
            'ticket_ID' => $this->ids['delegated'], 'employee_ID' => $this->tech->emp_id, 'assigned_by' => $this->agentB->emp_id,
            'assignment_status' => 'assigned', 'assigned_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        // Belongs to nobody the agents track.
        $this->ids['other'] = $this->ticket('TCK-CSD-OTHER', self::BRANCH, 2, $this->tech->emp_id, now()->addDays(3));
        // Same shape of ticket in another branch.
        $this->ids['branch'] = $this->ticket('TCK-CSD-BR', self::OTHER_BRANCH, 1, null, $overdue);
        // Finished tickets never appear in the queue.
        $this->ids['done'] = $this->ticket('TCK-CSD-DONE', self::BRANCH, 4, null, $overdue);

        DB::table('reassignment_requests')->insert([
            'ticket_id' => $this->ids['other'], 'employee_id' => $this->tech->emp_id, 'reason' => 'Needs a specialist',
            'status' => 'pending', 'requested_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    protected function tearDown(): void
    {
        $this->cleanUp();
        parent::tearDown();
    }

    private function cleanUp(): void
    {
        $ticketIds = DB::table('tickets')->whereIn('ticket_number', self::NUMBERS)->pluck('ticket_ID');
        DB::table('reassignment_requests')->whereIn('ticket_id', $ticketIds)->delete();
        DB::table('ticket_assignments')->whereIn('ticket_ID', $ticketIds)->delete();
        DB::table('tickets')->whereIn('ticket_ID', $ticketIds)->delete();
        DB::table('employees')->whereIn('email', self::EMAILS)->delete();
    }

    private function employee(int $id, string $email, string $role): Employee
    {
        return Employee::create([
            'emp_id' => $id, 'first_name' => 'CSD', 'last_name' => "E{$id}", 'email' => $email, 'role' => $role,
            'department' => 'Customer Service', 'branch_id' => self::BRANCH, 'branch' => 'csd-one-921',
            'is_active' => 1, 'password_hash' => bcrypt('password'),
        ]);
    }

    private function ticket(string $number, int $branchId, int $statusId, ?int $assignedTo, $dueAt): int
    {
        return (int) DB::table('tickets')->insertGetId([
            'ticket_number' => $number, 'title' => $number, 'description' => 'x', 'created_by' => 9401,
            'assigned_to' => $assignedTo, 'branch_id' => $branchId, 'problem_category_ID' => 1,
            'ticket_type_ID' => 1, 'ticket_status_ID' => $statusId, 'priority_ID' => 1,
            'resolution_due_at' => $dueAt, 'created_at' => now()->subDay(), 'updated_at' => now(),
        ], 'ticket_ID');
    }

    private function summaryFor(Employee $user): array
    {
        return $this->actingAs($user, 'api')->getJson('/api/cs-dashboard-summary')->assertOk()->json();
    }

    public function test_agent_sees_own_monitored_tickets_and_the_shared_branch_queue(): void
    {
        $data = $this->summaryFor($this->agentA);

        // Queue: only the unassigned, unfinished ticket in this branch.
        $this->assertSame(1, $data['queued_tickets']['count']);
        $this->assertSame('TCK-CSD-Q', $data['queued_tickets']['items'][0]['title']);
        $this->assertSame('CSD Customer', $data['queued_tickets']['items'][0]['customer']);

        // Monitored: only the ticket agent A owns, grouped by status.
        $this->assertSame(1, $data['assigned_monitored']['count']);
        $this->assertSame(['In Progress' => 1], $data['assigned_monitored']['by_status']);
        $this->assertSame(1, $data['workload_metrics']['active_tickets']);
        $this->assertSame(0, $data['workload_metrics']['breached']);
        $this->assertSame([], $data['partial_errors']);
    }

    public function test_delegated_tickets_are_tracked_by_the_delegating_agent_only(): void
    {
        $b = $this->summaryFor($this->agentB);
        $this->assertSame(1, $b['assigned_monitored']['count']);
        $this->assertSame(1, $b['workload_metrics']['breached']);

        $a = $this->summaryFor($this->agentA);
        $this->assertSame(0, $a['workload_metrics']['breached']);
    }

    public function test_needs_attention_lists_breached_queue_items_and_pending_reassignments(): void
    {
        $data = $this->summaryFor($this->agentB);

        $reasons = array_column($data['needs_attention']['items'], 'reason');
        $this->assertContains('Breached', $reasons);
        $this->assertContains('Reassignment pending', $reasons);
        $this->assertSame(1, $data['pending_reassignments']['count']);
        $this->assertSame(1, $data['workload_metrics']['pending_reassignments']);

        $titles = array_column($data['needs_attention']['items'], 'title');
        $this->assertContains('TCK-CSD-DEL', $titles);
        $this->assertContains('TCK-CSD-Q', $titles);
        $this->assertNotContains('TCK-CSD-BR', $titles, 'other branch tickets stay out');
        $this->assertNotContains('TCK-CSD-DONE', $titles, 'finished tickets stay out');
    }

    public function test_main_branch_agent_still_sees_tickets_saved_without_a_branch(): void
    {
        // Regression: the dashboard showed 0 because `branch_id = 1` never matches a NULL branch_id,
        // while every other dashboard treats the main branch as owning unbranched tickets.
        DB::table('branches')->updateOrInsert(['id' => 1], [
            'slug' => 'main', 'name' => 'Main Branch', 'code' => 'MAIN',
            'region' => 'Test', 'is_active' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->agentA->update(['branch_id' => 1, 'branch' => 'main']);
        DB::table('tickets')->insert([
            'ticket_number' => 'TCK-CSD-NULL', 'title' => 'TCK-CSD-NULL', 'description' => 'x', 'created_by' => 9401,
            'assigned_to' => null, 'branch_id' => null, 'problem_category_ID' => 1,
            'ticket_type_ID' => 1, 'ticket_status_ID' => 1, 'priority_ID' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        // Call the service with a large limit: the shared test database holds many older unbranched tickets.
        $summary = app(CsDashboardSummaryService::class)->getSummary($this->agentA, 5000);
        $titles = array_column($summary['queued_tickets']['items'], 'title');

        $this->assertContains('TCK-CSD-NULL', $titles);
        $this->assertNotContains('TCK-CSD-BR', $titles, 'a different branch is still excluded');
    }

    public function test_non_cs_roles_are_rejected(): void
    {
        $this->actingAs($this->nonCs, 'api')->getJson('/api/cs-dashboard-summary')->assertStatus(403);
    }

    public function test_one_failing_section_is_reported_and_the_rest_still_render(): void
    {
        $service = new class(app(\App\Services\SLAService::class)) extends CsDashboardSummaryService {
            // Simulate the reassignment query failing.
            protected function pendingReassignments(?object $branch): array
            {
                throw new \RuntimeException('boom');
            }
        };

        $data = $service->getSummary($this->agentA, 10);

        $this->assertSame('pending_reassignments', $data['partial_errors'][0]['section']);
        $this->assertNull($data['pending_reassignments']);
        $this->assertSame(1, $data['queued_tickets']['count']);
        $this->assertSame(1, $data['assigned_monitored']['count']);
        $this->assertNotNull($data['needs_attention']);
    }
}
