<?php

namespace Tests\Feature;

use App\Models\Employee;
use App\Services\AssignmentPeriodMetrics;
use App\Services\AssignmentPeriodRecorder;
use App\Services\TicketStateMachine;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Spec 0039: employee performance measured from each person's assignment periods.
 */
class EmployeeAssignmentPeriodsTest extends TestCase
{
    use DatabaseTransactions;

    private const BRANCH = 939;
    private const OTHER_BRANCH = 940;
    private const RULE_PRIORITY = 'spec0039-test';

    private int $ticketSeq = 0;
    private int $slaRuleId;

    /** CSAT ratings analytics-service answers with, keyed by ticket id. */
    private array $ratings = [];

    protected Employee $admin;
    protected Employee $mark;
    protected Employee $ana;

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'mysql']);
        config(['database.connections.mysql.database' => 'ticketing_system_test']);
        DB::purge('mysql');
        DB::reconnect('mysql');
        Cache::flush();

        // Business hours off, so accept by deadlines are plain clock arithmetic; CSAT from $this->ratings.
        Http::fake(function ($request) {
            if (str_contains($request->url(), 'business_hours')) {
                return Http::response(['value' => ['enabled' => false]], 200);
            }

            return Http::response(['status' => 'success', 'data' => [
                'total_reviews' => count($this->ratings),
                'average_score' => $this->ratings ? array_sum($this->ratings) / count($this->ratings) : null,
                'ticket_ratings' => $this->ratings,
            ]], 200);
        });

        $this->cleanUp();

        foreach ([self::BRANCH => 'spec39-main', self::OTHER_BRANCH => 'spec39-other'] as $id => $slug) {
            DB::table('branches')->updateOrInsert(['id' => $id], [
                'slug' => $slug, 'name' => "Spec39 {$id}", 'code' => "T{$id}", 'region' => 'Test',
                'is_active' => 1, 'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        DB::table('problem_categories')->updateOrInsert(['problem_category_ID' => 1], ['category_name' => 'Hardware', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('ticket_types')->updateOrInsert(['ticket_type_ID' => 1], ['type_name' => 'Incident', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('ticket_priorities')->updateOrInsert(['priority_ID' => 1], ['priority_name' => 'High', 'color_code' => 'red', 'created_at' => now(), 'updated_at' => now()]);
        foreach ([1 => 'Open', 2 => 'In Progress', 3 => 'Resolved', 4 => 'Closed', 9 => 'Discarded', 10 => 'Pending Assignment', 11 => 'On Hold'] as $id => $name) {
            DB::table('ticket_statuses')->updateOrInsert(['ticket_status_ID' => $id], ['status_name' => $name, 'created_at' => now(), 'updated_at' => now()]);
        }
        DB::table('users')->updateOrInsert(['id' => 1], ['name' => 'System', 'email' => 'sys@spec0039.test', 'password' => 'x', 'created_at' => now(), 'updated_at' => now()]);

        $departmentId = (int) (DB::table('departments')->value('id')
            ?? DB::table('departments')->insertGetId(['name' => 'Service', 'is_active' => 1, 'created_at' => now(), 'updated_at' => now()]));
        $this->slaRuleId = DB::table('sla_rules')->insertGetId([
            // Only ever read by id; a priority no ticket uses keeps it out of other tests' rule lookups.
            'department_id' => $departmentId, 'category_id' => 1, 'priority' => self::RULE_PRIORITY,
            'response_time_limit' => 30, 'resolution_time_limit' => 240,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->admin = $this->employee(93901, 'admin', 'Operations', 'Admin');
        $this->mark = $this->employee(93902, 'service', 'Service', 'Engineer');
        $this->ana = $this->employee(93903, 'service', 'IT', 'Employee');
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        // The reconnect in setUp means fixtures are committed, so remove them (and the faked config cache).
        $this->cleanUp();
        Cache::flush();
        parent::tearDown();
    }

    private function cleanUp(): void
    {
        DB::table('tickets')->whereIn('branch_id', [self::BRANCH, self::OTHER_BRANCH])->delete();
        DB::table('employees')->where('email', 'like', '%@spec0039.test')->delete();
        DB::table('sla_rules')->where('priority', self::RULE_PRIORITY)->delete();
    }

    private function employee(int $id, string $role, string $department, string $position, int $branch = self::BRANCH): Employee
    {
        return Employee::create([
            'emp_id' => $id,
            'first_name' => "Emp{$id}",
            'last_name' => $department,
            'email' => "emp{$id}@spec0039.test",
            'role' => $role,
            'department' => $department,
            'position_level' => $position,
            'branch_id' => $branch,
            'branch' => $branch === self::BRANCH ? 'spec39-main' : 'spec39-other',
            'is_active' => 1,
            'password_hash' => bcrypt('password'),
        ]);
    }

    private function ticket(array $over = []): int
    {
        $this->ticketSeq++;

        return DB::table('tickets')->insertGetId(array_merge([
            'ticket_number' => 'S39-' . $this->ticketSeq . '-' . uniqid(),
            'title' => 'Spec 39 ticket ' . $this->ticketSeq,
            'description' => 'test',
            'problem_category_ID' => 1,
            'created_by' => 1,
            'assigned_to' => null,
            'branch_id' => self::BRANCH,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 2,
            'priority_ID' => 1,
            'sla_rule_id' => $this->slaRuleId,
            'created_at' => now()->subDay(),
            'updated_at' => now(),
        ], $over));
    }

    private function recorder(): AssignmentPeriodRecorder
    {
        return app(AssignmentPeriodRecorder::class);
    }

    private function periods(int $ticketId)
    {
        return DB::table('ticket_assignment_periods')->where('ticket_ID', $ticketId)->orderBy('id')->get();
    }

    private function p(array $over): object
    {
        static $id = 0;
        $id++;

        return (object) array_merge([
            'id' => $id, 'ticket_ID' => 1, 'employee_ID' => 1, 'assigned_at' => null, 'ack_due_at' => null,
            'accepted_at' => null, 'paused_at' => null, 'paused_seconds' => 0, 'ack_paused_seconds' => 0,
            'released_at' => null, 'release_reason' => null,
        ], $over);
    }

    private function employeesReport(string $query = 'preset=Last 7 Days'): \Illuminate\Support\Collection
    {
        return collect($this->actingAs($this->admin, 'api')
            ->getJson("/api/admin/reports/employees?{$query}&force_refresh=true")
            ->assertOk()
            ->json('employees'))->keyBy('employee_id');
    }

    // ─── History recording (AC-1 to AC-5) ───────────────────────────────────────────

    public function test_open_records_the_accept_by_deadline_from_the_ticket_sla_source(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-11-10 09:00:00'));
        $ticket = $this->ticket();
        $noSla = $this->ticket(['sla_rule_id' => null]);

        $this->recorder()->open($ticket, $this->mark->emp_id, $this->admin->emp_id);
        $this->recorder()->open($ticket, $this->mark->emp_id, $this->admin->emp_id); // no op
        $this->recorder()->open($noSla, $this->mark->emp_id, $this->admin->emp_id);

        $rows = $this->periods($ticket);
        $this->assertCount(1, $rows, 'at most one open period per ticket and employee');
        $this->assertSame('2026-11-10 09:30:00', $rows[0]->ack_due_at, 'assigned_at + 30 minute response limit');
        $this->assertSame($this->admin->emp_id, (int) $rows[0]->assigned_by);
        $this->assertNull($this->periods($noSla)[0]->ack_due_at, 'no SLA source, no accept by deadline');
    }

    public function test_accept_is_set_once_and_release_records_the_reason(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-11-10 09:00:00'));
        $ticket = $this->ticket();
        $this->recorder()->open($ticket, $this->mark->emp_id, $this->admin->emp_id);

        Carbon::setTestNow(Carbon::parse('2026-11-10 09:20:00'));
        $this->recorder()->accept($ticket, $this->mark->emp_id);
        Carbon::setTestNow(Carbon::parse('2026-11-10 09:50:00'));
        $this->recorder()->accept($ticket, $this->mark->emp_id);

        $this->assertSame('2026-11-10 09:20:00', $this->periods($ticket)[0]->accepted_at, 'accepting twice never moves accepted_at');

        $this->recorder()->release($ticket, AssignmentPeriodRecorder::REASON_REASSIGNED, [$this->mark->emp_id]);
        $this->recorder()->open($ticket, $this->ana->emp_id, $this->admin->emp_id);

        $rows = $this->periods($ticket);
        $this->assertSame('reassigned', $rows[0]->release_reason);
        $this->assertSame('2026-11-10 09:50:00', $rows[0]->released_at);
        $this->assertNull($rows[1]->released_at, 'the new holder has an open period');
    }

    public function test_on_hold_pauses_the_accept_clock_through_the_state_machine(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-11-10 09:00:00'));
        $ticket = $this->ticket(['assigned_to' => $this->mark->emp_id, 'ticket_status_ID' => 10]);
        $this->recorder()->open($ticket, $this->mark->emp_id, $this->admin->emp_id);

        $machine = app(TicketStateMachine::class);
        Carbon::setTestNow(Carbon::parse('2026-11-10 09:10:00'));
        $machine->applyTransition($ticket, 'hold', ['reason' => 'Waiting on parts'], $this->admin);
        $this->assertSame('2026-11-10 09:10:00', $this->periods($ticket)[0]->paused_at);

        Carbon::setTestNow(Carbon::parse('2026-11-10 10:10:00'));
        $machine->applyTransition($ticket, 'resume', [], $this->admin);
        Carbon::setTestNow(Carbon::parse('2026-11-10 10:25:00'));
        $this->recorder()->accept($ticket, $this->mark->emp_id);

        $period = $this->periods($ticket)[0];
        $this->assertNull($period->paused_at);
        $this->assertSame(3600, (int) $period->paused_seconds);
        $this->assertSame(3600, (int) $period->ack_paused_seconds, 'hold before acceptance');

        $metrics = app(AssignmentPeriodMetrics::class);
        $now = Carbon::parse('2026-11-10 10:30:00');
        $this->assertSame('2026-11-10 10:30:00', $metrics->acceptBy($period, $now)->toDateTimeString(), 'AC-5: 09:30 + 60 minutes held');
        $this->assertSame('met', $metrics->responseOutcome($period, $now));

        $figures = $metrics->summarize([$period], [], [], $now);
        $this->assertEquals(25.0, $figures['average_response_minutes'], 'AC-10: 85 minutes minus 60 held');
    }

    public function test_resolving_and_discarding_release_every_holder(): void
    {
        $resolved = $this->ticket(['assigned_to' => $this->mark->emp_id]);
        $this->recorder()->open($resolved, $this->mark->emp_id, $this->admin->emp_id);
        $this->recorder()->accept($resolved, $this->mark->emp_id);
        app(TicketStateMachine::class)->applyTransition($resolved, 'resolve', [], $this->admin);

        $discarded = $this->ticket(['assigned_to' => $this->ana->emp_id, 'ticket_status_ID' => 1]);
        $this->recorder()->open($discarded, $this->ana->emp_id, $this->admin->emp_id);
        app(TicketStateMachine::class)->applyTransition($discarded, 'cancel', [], $this->admin);

        $this->assertSame('resolved', $this->periods($resolved)[0]->release_reason);
        $this->assertSame('discarded', $this->periods($discarded)[0]->release_reason);
    }

    public function test_a_period_released_while_paused_closes_its_pause_first(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-11-10 09:00:00'));
        $ticket = $this->ticket();
        $this->recorder()->open($ticket, $this->mark->emp_id, $this->admin->emp_id);
        Carbon::setTestNow(Carbon::parse('2026-11-10 09:10:00'));
        $this->recorder()->pause($ticket);
        Carbon::setTestNow(Carbon::parse('2026-11-10 09:40:00'));
        $this->recorder()->release($ticket, AssignmentPeriodRecorder::REASON_RETURNED_TO_CS);

        $period = $this->periods($ticket)[0];
        $this->assertNull($period->paused_at);
        $this->assertSame(1800, (int) $period->paused_seconds);
        $this->assertSame(1800, (int) $period->ack_paused_seconds);
    }

    public function test_a_failed_period_write_rolls_back_the_assignment(): void
    {
        $ticket = $this->ticket();

        try {
            DB::transaction(function () use ($ticket) {
                DB::table('ticket_assignments')->insert([
                    'ticket_ID' => $ticket, 'employee_ID' => $this->mark->emp_id, 'assigned_by' => $this->admin->emp_id,
                    'assignment_status' => 'assigned', 'assigned_at' => now(), 'created_at' => now(), 'updated_at' => now(),
                ]);
                // Forced failure: the holder does not exist, so the period insert violates its foreign key.
                $this->recorder()->open($ticket, 99999999, $this->admin->emp_id);
            });
            $this->fail('the period write failure must reach the caller');
        } catch (\Illuminate\Database\QueryException $e) {
            // expected
        }

        $this->assertFalse(DB::table('ticket_assignments')->where('ticket_ID', $ticket)->exists(), 'AC-21: no assignment without its history');
        $this->assertCount(0, $this->periods($ticket));
    }

    // ─── Metric rules (AC-7 to AC-17) ─────────────────────────────────────────────

    public function test_pending_turns_into_a_response_breach_once_the_accept_by_time_passes(): void
    {
        $metrics = app(AssignmentPeriodMetrics::class);
        $period = $this->p(['assigned_at' => '2026-11-10 09:00:00', 'ack_due_at' => '2026-11-10 09:30:00']);

        $at915 = Carbon::parse('2026-11-10 09:15:00');
        $this->assertTrue($metrics->isPending($period, $at915));
        $early = $metrics->summarize([$period], [], [], $at915);
        $this->assertSame(1, $early['pending_count']);
        $this->assertSame(0, $early['tickets_assigned'], 'AC-8: pending is not assigned yet');
        $this->assertNull($early['response_sla_rate']);

        $at940 = Carbon::parse('2026-11-10 09:40:00');
        $late = $metrics->summarize([$period], [], [], $at940);
        $this->assertSame(0, $late['pending_count']);
        $this->assertSame(1, $late['tickets_assigned']);
        $this->assertSame(1, $late['response_breached_count']);
        $this->assertEquals(0.0, $late['response_sla_rate']);
    }

    public function test_a_released_unaccepted_period_is_judged_at_its_release(): void
    {
        $metrics = app(AssignmentPeriodMetrics::class);
        $now = Carbon::parse('2026-11-10 12:00:00');
        $releasedInTime = $this->p(['assigned_at' => '2026-11-10 09:00:00', 'ack_due_at' => '2026-11-10 09:30:00',
            'released_at' => '2026-11-10 09:20:00', 'release_reason' => 'reassigned']);
        $releasedLate = $this->p(['assigned_at' => '2026-11-10 09:00:00', 'ack_due_at' => '2026-11-10 09:30:00',
            'released_at' => '2026-11-10 09:45:00', 'release_reason' => 'reassigned']);

        $this->assertNull($metrics->responseOutcome($releasedInTime, $now));
        $this->assertSame('breached', $metrics->responseOutcome($releasedLate, $now));
    }

    public function test_reassignment_charges_the_breach_to_whoever_held_the_ticket_at_the_deadline(): void
    {
        $metrics = app(AssignmentPeriodMetrics::class);
        $now = Carbon::parse('2026-11-10 15:00:00');
        $ticket = (object) ['ticket_ID' => 7, 'status_name' => 'Resolved', 'ticket_status_ID' => 3, 'sla_status' => 'Breached',
            'resolution_due_at' => '2026-11-10 12:00:00', 'resolved_at' => '2026-11-10 14:00:00', 'closed_at' => null,
            'created_at' => '2026-11-10 08:00:00'];
        $markP = $this->p(['ticket_ID' => 7, 'employee_ID' => 1, 'assigned_at' => '2026-11-10 09:00:00', 'accepted_at' => '2026-11-10 09:05:00',
            'released_at' => '2026-11-10 13:00:00', 'release_reason' => 'reassigned']);
        $anaP = $this->p(['ticket_ID' => 7, 'employee_ID' => 2, 'assigned_at' => '2026-11-10 13:00:00', 'accepted_at' => '2026-11-10 13:10:00',
            'released_at' => '2026-11-10 14:00:00', 'release_reason' => 'resolved']);

        $outcomes = $metrics->attributeResolutionOutcomes([$markP, $anaP], [7 => $ticket], $now);
        $this->assertSame([$markP->id => 'breached'], $outcomes);

        $mark = $metrics->summarize([$markP], $outcomes, [], $now);
        $ana = $metrics->summarize([$anaP], $outcomes, [], $now);
        $this->assertSame(1, $mark['sla_breached_count']);
        $this->assertSame(0, $mark['tickets_resolved']);
        $this->assertSame(1, $ana['tickets_resolved'], 'AC-13: Ana gets the resolved count');
        $this->assertSame(0, $ana['sla_breached_count']);
    }

    public function test_a_breach_while_back_with_cs_is_charged_to_nobody(): void
    {
        $metrics = app(AssignmentPeriodMetrics::class);
        $ticket = (object) ['ticket_ID' => 8, 'status_name' => 'In Progress', 'ticket_status_ID' => 2, 'sla_status' => null,
            'resolution_due_at' => '2026-11-10 12:00:00', 'resolved_at' => null, 'closed_at' => null, 'created_at' => '2026-11-10 08:00:00'];
        $returned = $this->p(['ticket_ID' => 8, 'assigned_at' => '2026-11-10 09:00:00', 'accepted_at' => '2026-11-10 09:05:00',
            'released_at' => '2026-11-10 12:00:00', 'release_reason' => 'returned_to_cs']);

        $this->assertSame([], $metrics->attributeResolutionOutcomes([$returned], [8 => $ticket], Carbon::parse('2026-11-10 15:00:00')));
    }

    public function test_performance_score_drops_missing_parts_and_needs_enough_judged_periods(): void
    {
        $metrics = app(AssignmentPeriodMetrics::class);

        $this->assertSame([87.5, 'scored'], $metrics->performanceScore(80.0, 100.0, null, 3), 'AC-16: (80x50 + 100x30) / 80');
        $this->assertSame([90.0, 'scored'], $metrics->performanceScore(80.0, 100.0, 5.0, 3));
        $this->assertSame([null, 'not_enough_data'], $metrics->performanceScore(80.0, 100.0, null, 2), 'AC-17');

        config(['ticketing.performance.min_judged_periods' => 1, 'ticketing.performance.score_weights' => ['resolution_sla' => 1, 'response_sla' => 0, 'csat' => 0]]);
        $this->assertSame([80.0, 'scored'], $metrics->performanceScore(80.0, 100.0, 5.0, 1), 'weights and minimum come from config');
    }

    // ─── Surfaces (AC-6, AC-18 to AC-22) ────────────────────────────────────────────

    public function test_dashboard_report_counts_only_periods_and_ranks_by_score(): void
    {
        $markId = $this->mark->emp_id;
        $anaId = $this->ana->emp_id;

        // Mark: 3 tickets accepted in time and resolved before the deadline -> scored 100.
        foreach (range(1, 3) as $i) {
            $t = $this->ticket(['assigned_to' => $markId, 'ticket_status_ID' => 3, 'resolution_due_at' => now()->subHours(1), 'resolved_at' => now()->subHours(2)]);
            DB::table('ticket_assignment_periods')->insert([
                'ticket_ID' => $t, 'employee_ID' => $markId, 'assigned_at' => now()->subHours(6), 'ack_due_at' => now()->subHours(5),
                'accepted_at' => now()->subHours(5)->subMinutes(10), 'released_at' => now()->subHours(2), 'release_reason' => 'resolved',
                'created_at' => now(), 'updated_at' => now(),
            ]);
            $this->ratings[$t] = 4.0;
        }
        // Mark also has one Pending period.
        $pending = $this->ticket(['assigned_to' => $markId, 'resolution_due_at' => now()->addDay()]);
        DB::table('ticket_assignment_periods')->insert([
            'ticket_ID' => $pending, 'employee_ID' => $markId, 'assigned_at' => now()->subMinutes(5), 'ack_due_at' => now()->addMinutes(25),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        // Ana: one judged period only -> not enough data. A pre tracking ticket adds nothing.
        $anaTicket = $this->ticket(['assigned_to' => $anaId, 'resolution_due_at' => now()->addDay()]);
        DB::table('ticket_assignment_periods')->insert([
            'ticket_ID' => $anaTicket, 'employee_ID' => $anaId, 'assigned_at' => now()->subHours(3), 'ack_due_at' => now()->subHours(2),
            'accepted_at' => now()->subHours(2)->subMinutes(30), 'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->ticket(['assigned_to' => $anaId, 'ticket_status_ID' => 3, 'resolution_due_at' => now()->subDay(), 'resolved_at' => now()->subHours(3)]);

        $rows = $this->actingAs($this->admin, 'api')
            ->getJson('/api/admin/reports/employees?preset=Last 7 Days&force_refresh=true')
            ->assertOk()
            ->json('employees');
        $byId = collect($rows)->keyBy('employee_id');

        $mark = $byId[$markId];
        $this->assertSame(1, $mark['pending_count']);
        $this->assertSame(3, $mark['tickets_assigned']);
        $this->assertSame(3, $mark['tickets_resolved']);
        $this->assertEquals(100.0, $mark['response_sla_rate']);
        $this->assertEquals(100.0, $mark['sla_compliance_rate']);
        $this->assertEquals(50.0, $mark['average_response_minutes']);
        $this->assertEquals(4.0, $mark['csat_score']);
        $this->assertSame('scored', $mark['score_status']);
        $this->assertEquals(96.0, $mark['performance_score'], '(100x50 + 100x30 + 80x20) / 100');

        $ana = $byId[$anaId];
        $this->assertSame(1, $ana['tickets_assigned'], 'AC-6: the ticket with no period counts for nobody');
        $this->assertNull($ana['performance_score']);
        $this->assertSame('not_enough_data', $ana['score_status']);

        // AC-18: default order is score high to low, not_enough_data after every scored row.
        $statuses = array_column($rows, 'score_status');
        $this->assertSame($markId, $rows[0]['employee_id']);
        $firstUnscored = array_search('not_enough_data', $statuses, true);
        foreach (array_slice($statuses, $firstUnscored) as $status) {
            $this->assertSame('not_enough_data', $status);
        }

        // AC-19: the tabular report and its export carry the same values.
        $report = $this->actingAs($this->admin, 'api')
            ->getJson('/api/admin/reports?report_type=employee_performance&preset=Last 7 Days&force_refresh=true')
            ->assertOk()
            ->json();
        $markRow = collect($report['rows'])->firstWhere('Employee', $mark['name']);
        $this->assertSame('96', (string) $markRow['Performance Score']);
        $this->assertSame(1, $markRow['Pending']);
        $this->assertSame(3, $markRow['Tickets Assigned']);
        $this->assertSame('100%', $markRow['Response SLA (%)']);
        $this->assertSame('50', (string) $markRow['Avg Response (mins)']);
        $anaRow = collect($report['rows'])->firstWhere('Employee', $ana['name']);
        $this->assertSame('Not enough data', $anaRow['Performance Score']);

        $csv = $this->actingAs($this->admin, 'api')
            ->postJson('/api/admin/reports/export', [
                'report_type' => 'employee_performance', 'format' => 'csv', 'filters' => ['preset' => 'Last 7 Days'],
            ])->assertOk()->getContent();
        $this->assertStringContainsString('Performance Score', $csv);
        $this->assertStringContainsString('Not enough data', $csv);
    }

    public function test_branch_admin_cannot_request_another_branch_or_all(): void
    {
        $this->actingAs($this->admin, 'api')
            ->getJson('/api/admin/reports/employees?branch_id=all')
            ->assertForbidden();
        $this->actingAs($this->admin, 'api')
            ->getJson('/api/admin/reports/employees?branch_id=' . self::OTHER_BRANCH)
            ->assertForbidden();
    }

    public function test_department_and_overall_figures_ignore_assignment_periods(): void
    {
        $t = $this->ticket(['assigned_to' => $this->mark->emp_id, 'ticket_status_ID' => 3, 'resolution_due_at' => now()->subHours(5), 'resolved_at' => now()->subHours(6)]);

        $before = $this->actingAs($this->admin, 'api')->getJson('/api/admin/dashboard?preset=Last 7 Days&forceRefresh=true')->assertOk();

        // A breach attributed by periods to someone else must not move the spec 0031 figures.
        DB::table('ticket_assignment_periods')->insert([
            'ticket_ID' => $t, 'employee_ID' => $this->ana->emp_id, 'assigned_at' => now()->subDay(), 'accepted_at' => now()->subDay(),
            'released_at' => now()->subHours(6), 'release_reason' => 'resolved', 'created_at' => now(), 'updated_at' => now(),
        ]);
        Cache::flush();
        $after = $this->actingAs($this->admin, 'api')->getJson('/api/admin/dashboard?preset=Last 7 Days&forceRefresh=true')->assertOk();

        $this->assertSame($before->json('kpis'), $after->json('kpis'));
        $this->assertSame($before->json('sla.by_department'), $after->json('sla.by_department'));
        $this->assertSame($before->json('departments'), $after->json('departments'));
    }
}
