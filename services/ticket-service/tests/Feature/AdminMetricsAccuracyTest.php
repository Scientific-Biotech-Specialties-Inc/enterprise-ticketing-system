<?php

namespace Tests\Feature;

use App\Models\Employee;
use App\Services\CsatSnapshotService;
use App\Services\SlaOutcomeService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Spec 0031: admin metrics accuracy, live manager queues, fast dashboard ranges.
 */
class AdminMetricsAccuracyTest extends TestCase
{
    use DatabaseTransactions;

    private const BRANCH = 931;
    private const OTHER_BRANCH = 932;
    private const ON_HOLD_STATUS = 11;

    private int $ticketSeq = 0;

    /** Body every faked analytics-service call answers with; tests may change it. */
    private array $analyticsResponse = ['status' => 'success', 'data' => ['total_reviews' => 0, 'ticket_ratings' => []]];

    protected Employee $admin;
    protected Employee $serviceTech;
    protected Employee $itTech;
    protected Employee $financeEmp;

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'mysql']);
        config(['database.connections.mysql.database' => 'ticketing_system_test']);
        DB::purge('mysql');
        DB::reconnect('mysql');
        Cache::flush();

        Http::fake(fn () => Http::response($this->analyticsResponse, 200));

        DB::table('tickets')->whereIn('branch_id', [self::BRANCH, self::OTHER_BRANCH])->delete();
        DB::table('employees')->where('email', 'like', '%@spec0031.test')->delete();

        foreach ([self::BRANCH => 'spec31-main', self::OTHER_BRANCH => 'spec31-other'] as $id => $slug) {
            DB::table('branches')->updateOrInsert(['id' => $id], [
                'slug' => $slug, 'name' => "Spec31 {$id}", 'code' => "S{$id}", 'region' => 'Test',
                'is_active' => 1, 'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        DB::table('problem_categories')->updateOrInsert(['problem_category_ID' => 1], ['category_name' => 'Hardware', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('ticket_types')->updateOrInsert(['ticket_type_ID' => 1], ['type_name' => 'Incident', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('ticket_priorities')->updateOrInsert(['priority_ID' => 1], ['priority_name' => 'High', 'color_code' => 'red', 'created_at' => now(), 'updated_at' => now()]);
        foreach ([1 => 'Open', 2 => 'In Progress', 3 => 'Resolved', 4 => 'Closed', self::ON_HOLD_STATUS => 'On Hold'] as $id => $name) {
            DB::table('ticket_statuses')->updateOrInsert(['ticket_status_ID' => $id], ['status_name' => $name, 'created_at' => now(), 'updated_at' => now()]);
        }
        DB::table('users')->updateOrInsert(['id' => 1], ['name' => 'System', 'email' => 'sys@spec0031.test', 'password' => 'x', 'created_at' => now(), 'updated_at' => now()]);

        $this->admin = $this->employee(93101, 'admin', 'Operations', 'Admin');
        $this->serviceTech = $this->employee(93102, 'service', 'Service', 'Engineer');
        $this->itTech = $this->employee(93103, 'service', 'IT', 'Employee');
        $this->financeEmp = $this->employee(93104, 'service', 'Finance', 'Employee');
    }

    private function employee(int $id, string $role, string $department, string $position, int $branch = self::BRANCH): Employee
    {
        return Employee::create([
            'emp_id' => $id,
            'first_name' => "Emp{$id}",
            'last_name' => $department,
            'email' => "emp{$id}@spec0031.test",
            'role' => $role,
            'department' => $department,
            'position_level' => $position,
            'branch_id' => $branch,
            'branch' => $branch === self::BRANCH ? 'spec31-main' : 'spec31-other',
            'is_active' => 1,
            'password_hash' => bcrypt('password'),
        ]);
    }

    private function ticket(array $over = []): int
    {
        $this->ticketSeq++;

        return DB::table('tickets')->insertGetId(array_merge([
            'ticket_number' => 'S31-' . $this->ticketSeq . '-' . uniqid(),
            'title' => 'Spec 31 ticket ' . $this->ticketSeq,
            'description' => 'test',
            'problem_category_ID' => 1,
            'created_by' => 1,
            'assigned_to' => null,
            'branch_id' => self::BRANCH,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 2,
            'priority_ID' => 1,
            'created_at' => now()->subDay(),
            'updated_at' => now(),
        ], $over));
    }

    private function row(array $over): object
    {
        return (object) array_merge([
            'ticket_ID' => 1, 'status_name' => 'In Progress', 'ticket_status_ID' => 2, 'sla_status' => null,
            'resolution_due_at' => null, 'resolved_at' => null, 'closed_at' => null, 'created_at' => now()->subDays(2),
        ], $over);
    }

    // ─── AC-4, AC-5, AC-6: the shared SLA outcome rule ─────────────────────────────────────

    public function test_sla_outcome_rule_classifies_every_case(): void
    {
        $svc = app(SlaOutcomeService::class);
        $due = now()->subDay();

        $this->assertSame('met', $svc->classify($this->row(['status_name' => 'Resolved', 'resolution_due_at' => $due, 'resolved_at' => $due->copy()->subHour()])));
        $this->assertSame('met', $svc->classify($this->row(['status_name' => 'Closed', 'resolution_due_at' => $due, 'closed_at' => $due])), 'on the deadline counts as met');
        $this->assertSame('breached', $svc->classify($this->row(['status_name' => 'Resolved', 'resolution_due_at' => $due, 'resolved_at' => $due->copy()->addHour()])));
        $this->assertSame('breached', $svc->classify($this->row(['status_name' => 'Open', 'resolution_due_at' => $due])), 'open and past due');
        $this->assertNull($svc->classify($this->row(['status_name' => 'Open', 'resolution_due_at' => now()->addDay()])), 'open, not yet due');
        $this->assertNull($svc->classify($this->row(['status_name' => 'On Hold', 'ticket_status_ID' => self::ON_HOLD_STATUS, 'resolution_due_at' => $due])), 'on hold');
        $this->assertNull($svc->classify($this->row(['status_name' => 'Discarded', 'resolution_due_at' => $due])), 'discarded');
        $this->assertNull($svc->classify($this->row(['status_name' => 'Resolved', 'resolved_at' => now()])), 'no SLA configured');

        $openBreach = $this->row(['status_name' => 'Open', 'resolution_due_at' => $due]);
        $this->assertTrue($svc->outcomeDate($openBreach)->equalTo($due), 'open breaches count on their due date');

        $this->assertNull($svc->rate(0, 0));
        $this->assertSame(33.3, $svc->rate(1, 2));
    }

    // ─── AC-1, AC-2: Service and IT only ─────────────────────────────────────────────────

    public function test_department_performance_lists_exactly_service_and_it_even_without_data(): void
    {
        $this->ticket(['assigned_to' => $this->serviceTech->emp_id, 'resolution_due_at' => now()->addDay()]);
        $this->ticket(['assigned_to' => $this->financeEmp->emp_id, 'resolution_due_at' => now()->subDay()]);

        $response = $this->actingAs($this->admin, 'api')
            ->getJson('/api/admin/reports/departments?preset=Last 7 Days&force_refresh=true')
            ->assertOk();

        $departments = collect($response->json('departments'));
        $this->assertEqualsCanonicalizing(['Service', 'IT'], $departments->pluck('department')->all());
        $this->assertFalse($departments->firstWhere('department', 'IT')['has_data']);
        $this->assertNull($departments->firstWhere('department', 'IT')['sla_compliance_rate']);
    }

    public function test_employee_performance_and_dashboard_exclude_non_technical_staff(): void
    {
        $this->ticket(['assigned_to' => $this->financeEmp->emp_id]);

        $employees = collect($this->actingAs($this->admin, 'api')
            ->getJson('/api/admin/reports/employees?preset=Last 7 Days&force_refresh=true')
            ->assertOk()
            ->json('employees'));

        $this->assertNull($employees->firstWhere('employee_id', $this->financeEmp->emp_id));
        $this->assertNotNull($employees->firstWhere('employee_id', $this->serviceTech->emp_id));
        $this->assertNotNull($employees->firstWhere('employee_id', $this->itTech->emp_id));

        $dashboard = $this->actingAs($this->admin, 'api')
            ->getJson('/api/admin/dashboard?preset=Last 7 Days&forceRefresh=true')
            ->assertOk();

        $this->assertSame(2, $dashboard->json('kpis.active_employees_count'));
        $this->assertSame(1, $dashboard->json('kpis.total_tickets'), 'ticket totals still count every branch ticket');
        $this->assertEqualsCanonicalizing(['Service', 'IT'], array_column($dashboard->json('sla.by_department'), 'department'));
        $this->assertEqualsCanonicalizing(['Service', 'IT'], $dashboard->json('workload.by_department.labels'));
    }

    // ─── AC-3, AC-4, AC-5, AC-6: real SLA rates by outcome date ───────────────────────────

    public function test_employee_sla_rate_follows_the_outcome_rule_and_window(): void
    {
        $tech = $this->serviceTech->emp_id;
        // Met: resolved yesterday before its deadline.
        $this->ticket(['assigned_to' => $tech, 'ticket_status_ID' => 3, 'resolution_due_at' => now()->subHours(20), 'resolved_at' => now()->subDay()]);
        // Breached: resolved after its deadline.
        $this->ticket(['assigned_to' => $tech, 'ticket_status_ID' => 3, 'resolution_due_at' => now()->subDays(2), 'resolved_at' => now()->subDay()]);
        // Breached: created 40 days ago, still open, due 3 days ago (counts in Last 7 Days by due date).
        $this->ticket(['assigned_to' => $tech, 'ticket_status_ID' => 1, 'created_at' => now()->subDays(40), 'resolution_due_at' => now()->subDays(3)]);
        // Excluded: open, not yet due; and no SLA at all.
        $this->ticket(['assigned_to' => $tech, 'ticket_status_ID' => 2, 'resolution_due_at' => now()->addDays(2)]);
        $this->ticket(['assigned_to' => $tech, 'ticket_status_ID' => 3, 'resolved_at' => now()->subHour()]);
        // IT tech has only an open, not yet due ticket: no SLA data.
        $this->ticket(['assigned_to' => $this->itTech->emp_id, 'ticket_status_ID' => 2, 'resolution_due_at' => now()->addDay()]);

        $employees = collect($this->actingAs($this->admin, 'api')
            ->getJson('/api/admin/reports/employees?preset=Last 7 Days&force_refresh=true')
            ->assertOk()
            ->json('employees'));

        $service = $employees->firstWhere('employee_id', $tech);
        $this->assertSame(1, $service['sla_met_count']);
        $this->assertSame(2, $service['sla_breached_count']);
        $this->assertEquals(33.3, $service['sla_compliance_rate']);

        $it = $employees->firstWhere('employee_id', $this->itTech->emp_id);
        $this->assertNull($it['sla_compliance_rate'], 'no met or breached tickets means null, never 100');

        // Today only: the met and breached resolutions happened yesterday, the open breach was due 3 days ago.
        $today = collect($this->actingAs($this->admin, 'api')
            ->getJson('/api/admin/reports/employees?preset=Today&force_refresh=true')
            ->json('employees'))->firstWhere('employee_id', $tech);
        $this->assertNull($today['sla_compliance_rate']);
    }

    public function test_unassigned_breach_counts_overall_but_not_for_any_department(): void
    {
        $this->ticket(['assigned_to' => null, 'ticket_status_ID' => 1, 'resolution_due_at' => now()->subDays(2)]);
        $this->ticket(['assigned_to' => $this->serviceTech->emp_id, 'ticket_status_ID' => 3, 'resolution_due_at' => now()->subHours(5), 'resolved_at' => now()->subHours(6)]);

        $dashboard = $this->actingAs($this->admin, 'api')
            ->getJson('/api/admin/dashboard?preset=Last 7 Days&forceRefresh=true')
            ->assertOk();

        $this->assertSame(1, $dashboard->json('kpis.sla_met_count'));
        $this->assertSame(1, $dashboard->json('kpis.sla_breached_count'));
        $this->assertEquals(50.0, $dashboard->json('kpis.sla_compliance_rate'));

        $byDept = collect($dashboard->json('sla.by_department'))->keyBy('department');
        $this->assertSame(1, $byDept['Service']['met']);
        $this->assertSame(0, $byDept['Service']['breached'], 'the unassigned breach is not attributed to Service');
        $this->assertNull($byDept['IT']['compliance_percentage']);
    }

    // ─── AC-7, AC-8, AC-9: manager dashboard ─────────────────────────────────────────────

    public function test_service_manager_sees_only_service_assignee_breaches_in_own_branch(): void
    {
        $manager = $this->employee(93110, 'service', 'Service', 'Manager');
        $older = $this->ticket(['assigned_to' => $this->serviceTech->emp_id, 'ticket_status_ID' => 2, 'resolution_due_at' => now()->subDays(30)]);
        $newer = $this->ticket(['assigned_to' => $this->serviceTech->emp_id, 'ticket_status_ID' => 1, 'resolution_due_at' => now()->subHour()]);
        $this->ticket(['assigned_to' => $this->serviceTech->emp_id, 'ticket_status_ID' => 2, 'resolution_due_at' => now()->addDay()]);
        $this->ticket(['assigned_to' => $this->serviceTech->emp_id, 'ticket_status_ID' => self::ON_HOLD_STATUS, 'resolution_due_at' => now()->subDay()]);
        $unassigned = $this->ticket(['assigned_to' => null, 'ticket_status_ID' => 1, 'resolution_due_at' => now()->subDay()]);
        $itBreach = $this->ticket(['assigned_to' => $this->itTech->emp_id, 'ticket_status_ID' => 1, 'resolution_due_at' => now()->subDay()]);
        $otherTech = $this->employee(93111, 'service', 'Service', 'Engineer', self::OTHER_BRANCH);
        $otherBranch = $this->ticket(['branch_id' => self::OTHER_BRANCH, 'assigned_to' => $otherTech->emp_id, 'ticket_status_ID' => 1, 'resolution_due_at' => now()->subDay()]);

        $response = $this->actingAs($manager, 'api')
            ->getJson('/api/manager/dashboard?branch_id=' . self::OTHER_BRANCH . '&forceRefresh=true')
            ->assertOk()
            ->assertJsonPath('scope.department', 'Service')
            ->assertJsonPath('scope.mode', 'department')
            ->assertJsonPath('scope.branch_id', self::BRANCH);

        $ids = array_column($response->json('breached_queue'), 'ticket_ID');
        $this->assertSame([$older, $newer], $ids, 'most overdue first, Service assignees only');
        $this->assertNotContains($unassigned, $ids);
        $this->assertNotContains($itBreach, $ids);
        $this->assertNotContains($otherBranch, $ids);

        $this->assertSame(['total_open' => 4, 'unassigned' => 0, 'within_sla' => 1, 'breached' => 2], $response->json('summary'));
        $this->assertGreaterThan(30 * 24 * 60 - 5, $response->json('breached_queue.0.overdue_minutes'));
    }

    public function test_cs_manager_sees_every_branch_breach_including_unassigned(): void
    {
        $manager = $this->employee(93112, 'customer service', 'Customer Service', 'Manager');
        $unassigned = $this->ticket(['assigned_to' => null, 'ticket_status_ID' => 1, 'resolution_due_at' => now()->subDay()]);
        $itBreach = $this->ticket(['assigned_to' => $this->itTech->emp_id, 'ticket_status_ID' => 1, 'resolution_due_at' => now()->subDays(2)]);

        $response = $this->actingAs($manager, 'api')
            ->getJson('/api/manager/dashboard?forceRefresh=true')
            ->assertOk()
            ->assertJsonPath('scope.mode', 'branch');

        $queue = collect($response->json('breached_queue'))->keyBy('ticket_ID');
        $this->assertNull($queue[$unassigned]['department']);
        $this->assertNull($queue[$unassigned]['assignee_name']);
        $this->assertSame('IT', $queue[$itBreach]['department']);
        $this->assertSame(1, $response->json('summary.unassigned'));
    }

    public function test_non_managers_and_unsupported_managers_are_denied(): void
    {
        $csAgent = $this->employee(93113, 'customer service', 'Customer Service', 'Employee');
        $financeManager = $this->employee(93114, 'service', 'Finance', 'Manager');

        foreach ([$this->serviceTech, $csAgent, $this->admin, $financeManager] as $caller) {
            $this->actingAs($caller, 'api')->getJson('/api/manager/dashboard')->assertStatus(403);
        }

        $ghost = new Employee(['email' => 'ghost@spec0031.test']);
        $this->actingAs($ghost, 'api')->getJson('/api/manager/dashboard')->assertStatus(404);
    }

    // ─── AC-13, AC-14: no auth call on the request path, CSAT time budget ─────────────────

    public function test_admin_dashboard_makes_no_auth_module_call(): void
    {
        $this->ticket(['assigned_to' => $this->serviceTech->emp_id]);

        $this->actingAs($this->admin, 'api')->getJson('/api/admin/dashboard?forceRefresh=true')->assertOk();
        $this->actingAs($this->admin, 'api')->getJson('/api/admin/reports/departments?force_refresh=true')->assertOk();

        Http::assertNotSent(fn (HttpRequest $request) => str_contains($request->url(), 'users-by-roles'));
    }

    public function test_csat_failure_sets_unavailable_flag_and_skips_calls_for_a_minute(): void
    {
        Http::fake(function () {
            throw new ConnectionException('timed out');
        });
        $this->ticket(['assigned_to' => $this->serviceTech->emp_id]);

        $first = $this->actingAs($this->admin, 'api')->getJson('/api/admin/dashboard?forceRefresh=true')->assertOk();
        $this->assertFalse($first->json('kpis.csat_available'));
        $this->assertNull($first->json('kpis.csat_score'));
        $this->assertTrue(Cache::has(CsatSnapshotService::DOWN_FLAG_KEY));

        $callsBefore = count(Http::recorded());
        $snapshot = app(CsatSnapshotService::class)->forTickets([1, 2, 3], now()->subWeek(), now());
        $this->assertFalse($snapshot['available']);
        $this->assertSame($callsBefore, count(Http::recorded()), 'no CSAT call while the unavailable flag is set');
    }

    public function test_csat_snapshot_reads_ticket_ratings_and_never_invents_a_score(): void
    {
        $this->analyticsResponse = ['status' => 'success', 'data' => [
            'average_score' => 4.5, 'total_reviews' => 2, 'satisfaction_percentage' => 100.0, 'ticket_ratings' => ['11' => 4, '12' => 5],
        ]];

        $snapshot = app(CsatSnapshotService::class)->forTickets([11, 12], now()->subWeek(), now());
        $this->assertTrue($snapshot['available']);
        $this->assertSame(4.5, $snapshot['average_score']);
        $this->assertSame([11 => 4.0, 12 => 5.0], $snapshot['ticket_ratings']);

        Cache::flush();
        $this->analyticsResponse = ['status' => 'success', 'data' => ['average_score' => 5.0, 'total_reviews' => 0]];
        $empty = app(CsatSnapshotService::class)->forTickets([13], now()->subWeek(), now());
        $this->assertNull($empty['average_score'], 'no reviews means no score');
    }
}
