<?php

namespace Tests\Feature;

use App\Actions\Tickets\CreateTicketAction;
use App\Models\Client;
use App\Models\Employee;
use App\Services\SLAService;
use App\Services\TicketDashboardService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

/**
 * Spec 0037, Slices B and C: every ticket records the SLA source it was given, and the
 * CS queue uses one SLA status rule for badges, summary cards, and server side filters.
 */
class SlaLinkAndCsFilterTest extends TestCase
{
    use DatabaseTransactions;

    private int $deptId;
    private int $categoryId;
    private string $categoryName;
    private int $highPriorityId;
    private string $branch = 'spec37-branch';
    private int $clientId;
    private string $token;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake(['*' => Http::response(['status' => 'success'], 200)]);

        $this->token = 'S37' . strtoupper(substr(uniqid(), -6));
        $this->seedBranch($this->branch, 'Spec 37 Branch');

        $this->deptId = (int) DB::table('departments')->insertGetId([
            'name' => 'Spec37 Dept ' . uniqid(), 'created_at' => now(), 'updated_at' => now(),
        ]);

        if (!DB::table('ticket_priorities')->whereRaw('LOWER(priority_name) = ?', ['high'])->exists()) {
            DB::table('ticket_priorities')->insert(['priority_name' => 'High', 'created_at' => now(), 'updated_at' => now()]);
        }
        $this->highPriorityId = (int) DB::table('ticket_priorities')->whereRaw('LOWER(priority_name) = ?', ['high'])->value('priority_ID');

        $this->categoryName = 'Spec37 Category ' . uniqid();
        $this->categoryId = (int) DB::table('problem_categories')->insertGetId([
            'category_name' => $this->categoryName, 'created_at' => now(), 'updated_at' => now(),
        ]);

        $uid = uniqid();
        $this->clientId = (int) Client::create([
            'client_name' => "Spec37 Client {$uid}", 'email' => "c.{$uid}@spec37.test", 'contact_number' => '1', 'address' => 'x',
        ])->id;
    }

    private function ticket(array $over = []): int
    {
        return (int) DB::table('tickets')->insertGetId(array_merge([
            'ticket_number' => 'S37-' . uniqid(),
            'title' => "{$this->token} ticket",
            'description' => 'Spec 37',
            'problem_category_ID' => $this->categoryId,
            'created_by' => $this->clientId,
            'ticket_type_ID' => (int) (DB::table('ticket_types')->value('ticket_type_ID') ?? 1),
            'priority_ID' => $this->highPriorityId,
            'ticket_status_ID' => $this->statusId('Open'),
            'is_internal' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ], $over));
    }

    private function statusId(string $name): int
    {
        $id = DB::table('ticket_statuses')->whereRaw('LOWER(status_name) = ?', [strtolower($name)])->value('ticket_status_ID');
        if ($id === null) {
            $id = DB::table('ticket_statuses')->insertGetId(['status_name' => $name, 'created_at' => now(), 'updated_at' => now()]);
        }
        return (int) $id;
    }

    private function branchPolicy(int $resolutionMinutes = 600): int
    {
        return (int) DB::table('branch_sla_policies')->insertGetId([
            'branch_id' => $this->branch, 'category_id' => $this->categoryId, 'category_name' => $this->categoryName,
            'priority' => 'High', 'resolution_time_limit' => $resolutionMinutes, 'response_time_limit' => 60,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function rule(): int
    {
        return (int) DB::table('sla_rules')->insertGetId([
            'department_id' => $this->deptId, 'category_id' => null, 'priority' => 'High',
            'response_time_limit' => 30, 'resolution_time_limit' => 480, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function sources(int $ticketId): array
    {
        return (array) DB::table('tickets')->where('ticket_ID', $ticketId)
            ->first(array_merge(SLAService::SLA_SOURCE_COLUMNS, ['sla_started_at', 'response_due_at', 'resolution_due_at', 'sla_status']));
    }

    private function nonNullSources(array $row): array
    {
        return array_keys(array_filter(array_intersect_key($row, array_flip(SLAService::SLA_SOURCE_COLUMNS)), fn ($v) => $v !== null));
    }

    // ── Slice B ──────────────────────────────────────────────────────────

    /** AC-8: a branch category policy match is saved with its due dates, and only that source. */
    public function test_branch_category_policy_is_saved_on_the_ticket(): void
    {
        $policyId = $this->branchPolicy();
        $ticketId = $this->ticket(['branch_id' => $this->branch]);

        app(SLAService::class)->assignSlaToTicket($ticketId, $this->deptId, $this->categoryId, 'High', now(), 'dynamic', $this->branch);

        $row = $this->sources($ticketId);
        $this->assertSame($policyId, (int) $row['branch_sla_policy_id']);
        $this->assertSame(['branch_sla_policy_id'], $this->nonNullSources($row));
        $this->assertNotNull($row['sla_started_at']);
        $this->assertNotNull($row['response_due_at']);
        $this->assertNotNull($row['resolution_due_at']);
        $this->assertSame('On Track', $row['sla_status']);
    }

    /** AC-8: a system SLA rule match saves only sla_rule_id. */
    public function test_sla_rule_is_saved_alone(): void
    {
        $ruleId = $this->rule();
        $ticketId = $this->ticket();

        app(SLAService::class)->assignSlaToTicket($ticketId, $this->deptId, $this->categoryId, 'High', now(), 'dynamic', null);

        $row = $this->sources($ticketId);
        $this->assertSame($ruleId, (int) $row['sla_rule_id']);
        $this->assertSame(['sla_rule_id'], $this->nonNullSources($row));
    }

    /** AC-8: when nothing resolves, all four sources are null and the ticket says so honestly. */
    public function test_nothing_resolves_means_no_sla_configured(): void
    {
        DB::table('slas')->update(['is_active' => false]);
        $ticketId = $this->ticket();

        app(SLAService::class)->assignSlaToTicket($ticketId, $this->deptId, $this->categoryId, 'High', now(), 'dynamic', null);

        $row = $this->sources($ticketId);
        $this->assertSame([], $this->nonNullSources($row));
        $this->assertNull($row['resolution_due_at']);
        $this->assertSame('No SLA Configured', $row['sla_status']);
    }

    /** AC-9: recalculation writes the new source and clears the old one. */
    public function test_reclassification_from_rule_to_branch_policy_clears_the_rule(): void
    {
        $ruleId = $this->rule();
        $ticketId = $this->ticket(['sla_rule_id' => $ruleId, 'sla_started_at' => now(), 'resolution_due_at' => now()->addHours(8)]);
        $policyId = $this->branchPolicy();

        app(SLAService::class)->recalculateForReclassification($ticketId, null, null, $this->branch);

        $row = $this->sources($ticketId);
        $this->assertSame($policyId, (int) $row['branch_sla_policy_id']);
        $this->assertSame(['branch_sla_policy_id'], $this->nonNullSources($row));
    }

    /** AC-10: if SLA assignment throws, the ticket is still created, flagged, and logged at error level. */
    public function test_sla_failure_at_creation_flags_the_ticket(): void
    {
        $this->partialMock(SLAService::class, function ($mock) {
            $mock->shouldReceive('assignSlaToTicket')->andThrow(new \RuntimeException('resolver exploded'));
        });
        Log::spy();

        $client = Client::find($this->clientId);
        $result = app(CreateTicketAction::class)->execute([
            'title' => 'Spec 37 sla failure',
            'description' => 'Creation must survive an SLA failure.',
            'problem_category_ID' => $this->categoryId,
            'priority_ID' => $this->highPriorityId,
            'origin' => 'portal',
        ], $client, $this->deptId);

        $this->assertTrue($result['success']);
        $this->assertSame('SLA Unavailable', DB::table('tickets')->where('ticket_ID', $result['ticket_id'])->value('sla_status'));
        Log::shouldHaveReceived('error')->withArgs(function ($message, $context = []) use ($result) {
            return str_contains($message, 'SLA assignment failed')
                && ($context['ticket_ID'] ?? null) === $result['ticket_id']
                && str_contains($context['error'] ?? '', 'resolver exploded');
        })->once();
    }

    /** AC-11: dry run changes nothing, a real run repairs the ticket, a rerun changes nothing. */
    public function test_backfill_is_dry_runnable_and_idempotent(): void
    {
        $policyId = $this->branchPolicy();
        $created = now()->subHours(2)->startOfSecond();
        $lost = $this->ticket(['branch_id' => $this->branch, 'created_at' => $created]);
        $failed = $this->ticket(['branch_id' => $this->branch, 'created_at' => $created, 'sla_status' => 'SLA Unavailable']);
        $closed = $this->ticket(['branch_id' => $this->branch, 'ticket_status_ID' => $this->statusId('Closed')]);

        $this->artisan('tickets:backfill-sla', ['--dry-run' => true])->assertSuccessful();
        $this->assertNull(DB::table('tickets')->where('ticket_ID', $lost)->value('branch_sla_policy_id'));

        $this->artisan('tickets:backfill-sla')->assertSuccessful();
        foreach ([$lost, $failed] as $id) {
            $row = $this->sources($id);
            $this->assertSame($policyId, (int) $row['branch_sla_policy_id']);
            $this->assertNotNull($row['resolution_due_at']);
            $this->assertNotSame('SLA Unavailable', $row['sla_status']);
            $this->assertSame($created->toDateTimeString(), \Illuminate\Support\Carbon::parse($row['sla_started_at'])->toDateTimeString());
        }
        $this->assertNull(DB::table('tickets')->where('ticket_ID', $closed)->value('branch_sla_policy_id'), 'Closed tickets are left alone.');

        $this->artisan('tickets:backfill-sla')->expectsOutputToContain('Updated 0.')->assertSuccessful();
    }

    /** AC-12: the no_sla filter no longer queries a missing column. */
    public function test_cs_incoming_no_sla_filter_returns_200(): void
    {
        $cs = Employee::create([
            'first_name' => 'Spec37', 'last_name' => 'CS', 'email' => 'cs.' . uniqid() . '@spec37.test',
            'role' => 'cs', 'department' => 'Customer Service', 'position_level' => 'Employee',
            'is_active' => 1, 'password_hash' => bcrypt('password'),
        ]);

        $this->actingAs($cs, 'api')->getJson('/api/cs-incoming?sla_status=no_sla&forceRefresh=1')->assertOk();
    }

    // ── Slice C ──────────────────────────────────────────────────────────

    private function metrics(array $fields): string
    {
        return app(SLAService::class)->computeTicketSlaMetrics((object) $fields)['status'];
    }

    /** AC-13: the single precedence, and no guessed deadlines. */
    public function test_sla_status_precedence(): void
    {
        $this->assertSame('SLA Unavailable', $this->metrics(['sla_status' => 'SLA Unavailable', 'status_name' => 'On Hold', 'sla_rule_id' => 1, 'resolution_due_at' => now()->subDay()]));
        $this->assertSame('Paused', $this->metrics(['status_name' => 'On Hold', 'sla_rule_id' => 1, 'resolution_due_at' => now()->subDay()]));
        $this->assertSame('No SLA Configured', $this->metrics(['status_name' => 'On Hold']));
        $this->assertSame('Compliant', $this->metrics(['status_name' => 'Resolved', 'sla_ID' => 1, 'resolution_due_at' => now(), 'resolved_at' => now()->subHour()]));
        $this->assertSame('Breached', $this->metrics(['status_name' => 'Closed', 'sla_ID' => 1, 'resolution_due_at' => now()->subDay(), 'closed_at' => now()]));
        $this->assertSame('Breached', $this->metrics(['status_name' => 'Open', 'branch_sla_policy_id' => 1, 'resolution_due_at' => now()->subMinute()]));
        $this->assertSame('At Risk', $this->metrics(['status_name' => 'Open', 'branch_sla_policy_id' => 1, 'resolution_due_at' => now()->addHours(3)]));
        $this->assertSame('On Track', $this->metrics(['status_name' => 'Open', 'branch_sla_policy_id' => 1, 'resolution_due_at' => now()->addHours(5)]));

        // No due date: never Breached or At Risk, however old the ticket is.
        $this->assertSame('No SLA Configured', $this->metrics(['status_name' => 'Open', 'created_at' => now()->subDays(5)]));
        $this->assertSame('On Track', $this->metrics(['status_name' => 'Open', 'sla_rule_id' => 1, 'created_at' => now()->subDays(5)]));
    }

    /** AC-13, AC-14: the SQL filter and summary use the same rule as the row badges, past the first 100 rows. */
    public function test_breached_filter_covers_every_page_and_matches_the_summary(): void
    {
        $ruleId = $this->rule();
        for ($i = 0; $i < 105; $i++) {
            $this->ticket(['sla_rule_id' => $ruleId, 'resolution_due_at' => now()->subHours(1 + $i)]);
        }
        $this->ticket(['sla_rule_id' => $ruleId, 'resolution_due_at' => now()->addDays(2)]);   // on track
        $this->ticket(['sla_rule_id' => $ruleId, 'resolution_due_at' => now()->subDay(), 'ticket_status_ID' => $this->statusId('On Hold')]); // paused
        $this->ticket(['created_at' => now()->subDays(4)]); // no SLA, old: must not count as breached

        $service = app(TicketDashboardService::class);
        $filters = ['search' => $this->token, 'sla_status' => 'breached'];

        $page1 = $service->getCsIncoming(50, 'all', 1, $filters, true);
        $page3 = $service->getCsIncoming(50, 'all', 3, $filters, true);

        $this->assertSame(105, $page1['pagination']['total']);
        $this->assertSame(105, $page1['sla_summary']['breached']);
        $this->assertSame(1, $page1['sla_summary']['paused']);
        $this->assertSame(1, $page1['sla_summary']['on_track']);
        $this->assertSame(1, $page1['sla_summary']['no_sla']);
        $this->assertCount(5, $page3['incoming_tickets']);

        foreach (array_merge($page1['incoming_tickets'], $page3['incoming_tickets']) as $row) {
            $this->assertSame('Breached', $row['sla_status']);
        }

        foreach (['paused' => 'Paused', 'no_sla' => 'No SLA Configured', 'on_track' => 'On Track'] as $key => $label) {
            $result = $service->getCsIncoming(50, 'all', 1, ['search' => $this->token, 'sla_status' => $key], true);
            $this->assertSame($page1['sla_summary'][$key], $result['pagination']['total'], "{$key} card count equals its filtered rows");
            foreach ($result['incoming_tickets'] as $row) {
                $this->assertSame($label, $row['sla_status']);
            }
        }
    }

    // ── Slice C: scope (no scope keeps every ticket) ──────────────────────

    private function employeeId(): int
    {
        return (int) Employee::create([
            'first_name' => 'Spec37', 'last_name' => 'Tech', 'email' => 'tech.' . uniqid() . '@spec37.test',
            'role' => 'service', 'department' => 'Service', 'position_level' => 'Employee',
            'is_active' => 1, 'password_hash' => bcrypt('password'),
        ])->emp_id;
    }

    private function assign(int $ticketId, int $empId, string $status): void
    {
        DB::table('ticket_assignments')->insert([
            'ticket_ID' => $ticketId, 'employee_ID' => $empId, 'assigned_by' => $empId,
            'assignment_status' => $status, 'assigned_at' => now(),
        ]);
    }

    /** One ticket per queue situation, by name. */
    private function queueFixtures(): array
    {
        $emp = $this->employeeId();
        $ruleId = $this->rule();
        $t = [];
        $t['open'] = $this->ticket(['sla_rule_id' => $ruleId, 'resolution_due_at' => now()->addDay()]);
        $t['pending'] = $this->ticket(['sla_rule_id' => $ruleId, 'resolution_due_at' => now()->addDay()]);
        $this->assign($t['pending'], $emp, 'assigned');
        $t['accepted'] = $this->ticket(['sla_rule_id' => $ruleId, 'resolution_due_at' => now()->subHour(), 'ticket_status_ID' => $this->statusId('In Progress')]);
        $this->assign($t['accepted'], $emp, 'accepted');
        $t['reopened'] = $this->ticket(['sla_rule_id' => $ruleId, 'resolution_due_at' => now()->addDay(), 'ticket_status_ID' => $this->statusId('Reopened')]);
        $this->assign($t['reopened'], $emp, 'accepted');
        $t['evaluation'] = $this->ticket(['sla_rule_id' => $ruleId, 'resolution_due_at' => now()->addDay(), 'ticket_status_ID' => $this->statusId('Pending Evaluation')]);
        $t['reassign'] = $this->ticket(['sla_rule_id' => $ruleId, 'resolution_due_at' => now()->subHour(), 'ticket_status_ID' => $this->statusId('In Progress')]);
        $this->assign($t['reassign'], $emp, 'accepted');
        DB::table('reassignment_requests')->insert([
            'ticket_id' => $t['reassign'], 'employee_id' => $emp, 'reason' => 'Spec 37', 'status' => 'pending',
            'requested_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        $t['closed'] = $this->ticket(['sla_rule_id' => $ruleId, 'resolution_due_at' => now()->addDay(), 'ticket_status_ID' => $this->statusId('Closed'), 'closed_at' => now()]);
        $t['onhold'] = $this->ticket(['sla_rule_id' => $ruleId, 'resolution_due_at' => now()->addDay(), 'ticket_status_ID' => $this->statusId('On Hold')]);
        return $t;
    }

    private function ids(array $filters): array
    {
        $rows = app(TicketDashboardService::class)->getCsIncoming(100, 'all', 1, ['search' => $this->token] + $filters, true)['incoming_tickets'];
        $ids = array_map(fn ($r) => $r['ticket_ID'], $rows);
        sort($ids);
        return $ids;
    }

    private function sorted(array $ids): array
    {
        sort($ids);
        return $ids;
    }

    /** No scope keeps the old behaviour: every ticket (CS History, manager pages, Messaging). */
    public function test_no_scope_returns_every_ticket(): void
    {
        $t = $this->queueFixtures();
        $this->assertSame($this->sorted(array_values($t)), $this->ids([]));
    }

    /** AC-14, AC-16: each scope keeps the membership its page used to compute in the browser. */
    public function test_scopes_match_the_old_tab_rules(): void
    {
        $t = $this->queueFixtures();

        $this->assertSame(
            $this->sorted([$t['open'], $t['pending'], $t['reopened'], $t['closed'], $t['onhold']]),
            $this->ids(['scope' => 'incoming'])
        );
        $this->assertSame(
            $this->sorted([$t['pending'], $t['accepted'], $t['reopened'], $t['evaluation'], $t['reassign'], $t['closed'], $t['onhold']]),
            $this->ids(['scope' => 'assigned'])
        );

        $this->assertSame([$t['pending']], $this->ids(['scope' => 'incoming', 'tab' => 'pending_assignment']));
        $this->assertSame([$t['reassign']], $this->ids(['scope' => 'assigned', 'tab' => 'reassigned']));
        $this->assertSame([$t['closed']], $this->ids(['scope' => 'assigned', 'tab' => 'resolved_closed']));
    }

    /** AC-15: each card equals its rows. AC-16: Incoming's Paused count only covers Incoming tickets. */
    public function test_scoped_summary_cards_equal_their_filtered_rows(): void
    {
        $this->queueFixtures();
        $service = app(TicketDashboardService::class);

        foreach (['incoming', 'assigned'] as $scope) {
            $base = ['search' => $this->token, 'scope' => $scope];
            $summary = $service->getCsIncoming(10, 'all', 1, $base, true)['slaSummary'];
            foreach (['breached', 'at_risk', 'on_track', 'paused', 'compliant', 'no_sla'] as $key) {
                $total = $service->getCsIncoming(10, 'all', 1, $base + ['sla_status' => $key], true)['total'];
                $this->assertSame($summary[$key], $total, "{$scope} {$key} card equals its rows");
            }
        }

        $incoming = $service->getCsIncoming(10, 'all', 1, ['search' => $this->token, 'scope' => 'incoming'], true);
        $this->assertSame(1, $incoming['slaSummary']['paused']);
        $this->assertSame(0, $incoming['slaSummary']['breached'], 'The overdue fixtures are all assigned or awaiting reassignment');
    }

    public function test_tab_counts_cover_the_whole_scope(): void
    {
        $this->queueFixtures();
        $service = app(TicketDashboardService::class);

        $incoming = $service->getCsIncoming(10, 'all', 1, ['search' => $this->token, 'scope' => 'incoming', 'tab' => 'open'], true);
        $assigned = $service->getCsIncoming(10, 'all', 1, ['search' => $this->token, 'scope' => 'assigned'], true);

        // Tab counts ignore filters (as the tabs always did), so they include at least our fixtures.
        $this->assertGreaterThanOrEqual(5, $incoming['tab_counts']['all']);
        $this->assertSame($incoming['tab_counts']['all'], $incoming['tab_counts']['open'] + $incoming['tab_counts']['pending']);
        $this->assertGreaterThanOrEqual(1, $assigned['tab_counts']['reassigned']);
        $this->assertGreaterThanOrEqual(7, $assigned['tab_counts']['all']);
    }

    public function test_endpoint_validates_scope_and_sla_filter_and_keeps_old_fields(): void
    {
        $cs = Employee::create([
            'first_name' => 'Spec37', 'last_name' => 'CS', 'email' => 'cs2.' . uniqid() . '@spec37.test',
            'role' => 'cs', 'department' => 'Customer Service', 'position_level' => 'Employee',
            'is_active' => 1, 'password_hash' => bcrypt('password'),
        ]);

        $this->actingAs($cs, 'api')->getJson('/api/cs-incoming?scope=everything')->assertStatus(422);
        $this->actingAs($cs, 'api')->getJson('/api/cs-incoming?sla_status=sideways')->assertStatus(422);

        $this->actingAs($cs, 'api')->getJson('/api/cs-incoming?scope=assigned&sla_status=breached&page=1&limit=5&forceRefresh=1')
            ->assertOk()
            ->assertJsonStructure(['data', 'total', 'page', 'per_page', 'last_page', 'slaSummary' => ['breached', 'at_risk', 'on_track', 'paused', 'compliant', 'no_sla'], 'tab_counts', 'incoming_tickets', 'sla_summary', 'pagination']);

        // Old callers with no scope still get the old keys and every ticket.
        $this->actingAs($cs, 'api')->getJson('/api/cs-incoming?limit=100&forceRefresh=1')
            ->assertOk()
            ->assertJsonStructure(['incoming_tickets', 'sla_summary', 'pagination'])
            ->assertJsonPath('scope', null);
    }
}
