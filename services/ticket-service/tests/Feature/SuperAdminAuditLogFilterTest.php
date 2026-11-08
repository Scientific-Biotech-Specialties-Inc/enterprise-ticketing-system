<?php

namespace Tests\Feature;

use App\Models\Employee;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Spec 0029 AC-18, AC-19, AC-20: Super Admin audit log filters, dynamic options and pagination.
 */
class SuperAdminAuditLogFilterTest extends TestCase
{
    use DatabaseTransactions;

    protected Employee $superAdmin;
    protected Employee $regularAdmin;
    protected int $alphaTicket;
    protected int $betaTicket;

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'mysql']);
        config(['database.connections.mysql.database' => 'ticketing_system_test']);
        DB::purge('mysql');
        DB::reconnect('mysql');
        Cache::flush();

        $this->cleanUp();

        foreach ([911 => 'alpha', 912 => 'beta'] as $id => $slug) {
            DB::table('branches')->updateOrInsert(['id' => $id], [
                'slug' => "branch-{$slug}-{$id}", 'name' => "Branch {$slug}", 'code' => strtoupper(substr($slug, 0, 3)),
                'region' => 'Test', 'is_active' => 1, 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
        DB::table('problem_categories')->updateOrInsert(['problem_category_ID' => 1], ['category_name' => 'Hardware', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('ticket_types')->updateOrInsert(['ticket_type_ID' => 1], ['type_name' => 'Incident', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('ticket_priorities')->updateOrInsert(['priority_ID' => 1], ['priority_name' => 'Low', 'color_code' => 'green', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('ticket_statuses')->updateOrInsert(['ticket_status_ID' => 1], ['status_name' => 'Open', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('clients')->updateOrInsert(['id' => 9201], [
            'client_name' => 'Audit Filter Customer', 'email' => 'audit.filter@example.com', 'contact_number' => '5550000',
            'address' => 'x', 'status' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);

        DB::table('employees')->whereIn('email', ['audit.super@example.com', 'audit.admin@example.com'])->delete();
        $this->superAdmin = Employee::create([
            'emp_id' => 89101, 'first_name' => 'Audit', 'last_name' => 'Super', 'email' => 'audit.super@example.com',
            'role' => 'superadmin', 'department' => 'Executive', 'branch_id' => 911, 'branch' => 'branch-alpha-911',
            'is_active' => 1, 'password_hash' => bcrypt('password'),
        ]);
        $this->regularAdmin = Employee::create([
            'emp_id' => 89102, 'first_name' => 'Audit', 'last_name' => 'Admin', 'email' => 'audit.admin@example.com',
            'role' => 'admin', 'department' => 'IT', 'branch_id' => 911, 'branch' => 'branch-alpha-911',
            'is_active' => 1, 'password_hash' => bcrypt('password'),
        ]);

        $this->alphaTicket = $this->makeTicket('TCK-AUD-A', 911);
        $this->betaTicket = $this->makeTicket('TCK-AUD-B', 912);

        $this->log($this->alphaTicket, 'sla_breached', '2026-10-01 10:00:00');
        $this->log($this->alphaTicket, 'reassign_request', '2026-10-05 10:00:00');
        $this->log($this->betaTicket, 'sla_breached', '2026-10-10 10:00:00');
    }

    protected function tearDown(): void
    {
        $this->cleanUp();
        parent::tearDown();
    }

    /** The suite reconnects the database, so rows are removed by hand instead of relying on rollback. */
    private function cleanUp(): void
    {
        $ticketIds = DB::table('tickets')->whereIn('ticket_number', ['TCK-AUD-A', 'TCK-AUD-B'])->pluck('ticket_ID');
        DB::table('ticket_audit_logs')->whereIn('ticket_ID', $ticketIds)->delete();
        DB::table('tickets')->whereIn('ticket_ID', $ticketIds)->delete();
        DB::table('employees')->whereIn('email', ['audit.super@example.com', 'audit.admin@example.com'])->delete();
    }

    private function makeTicket(string $number, int $branchId): int
    {
        return (int) DB::table('tickets')->insertGetId([
            'ticket_number' => $number, 'title' => $number, 'description' => 'x', 'created_by' => 9201,
            'branch_id' => $branchId, 'problem_category_ID' => 1, 'ticket_type_ID' => 1, 'ticket_status_ID' => 1,
            'priority_ID' => 1, 'created_at' => now(), 'updated_at' => now(),
        ], 'ticket_ID');
    }

    private function log(int $ticketId, string $type, string $when): void
    {
        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => $ticketId, 'action_type' => $type, 'action_by_ID' => $this->superAdmin->emp_id,
            'actor_type' => 'superadmin', 'details' => json_encode(['text' => "marker {$type}"]), 'created_at' => $when,
        ]);
    }

    private function fetch(string $query = '')
    {
        return $this->actingAs($this->superAdmin, 'api')->getJson('/api/superadmin/audit-logs' . $query);
    }

    /** @return array<int, array> rows belonging to this test only */
    private function mine($response): array
    {
        $rows = $response->json('entries') ?? $response->json();
        return array_values(array_filter($rows, fn ($r) => in_array($r['branch_id'], [911, 912], true)));
    }

    public function test_event_type_filter_returns_only_matching_entries(): void
    {
        $rows = $this->mine($this->fetch('?event_type=sla_breached')->assertOk());

        $this->assertCount(2, $rows);
        $this->assertSame(['sla_breached'], array_values(array_unique(array_column($rows, 'event_type'))));
        $this->assertSame([], $this->fetch('?event_type=no_such_event')->assertOk()->json());
    }

    public function test_branch_filter_narrows_to_one_branch_and_unknown_branch_is_empty(): void
    {
        $rows = $this->mine($this->fetch('?branch_id=912')->assertOk());
        $this->assertCount(1, $rows);
        $this->assertSame(912, $rows[0]['branch_id']);

        $this->assertSame([], $this->fetch('?branch_id=99999')->assertOk()->json());
    }

    public function test_filters_combine_with_and_logic(): void
    {
        $rows = $this->mine($this->fetch('?event_type=sla_breached&branch_id=911&date_from=2026-09-30&date_to=2026-10-02')->assertOk());
        $this->assertCount(1, $rows);

        $this->assertSame([], $this->mine($this->fetch('?event_type=reassign_request&branch_id=912')->assertOk()));
        $this->assertSame([], $this->mine($this->fetch('?event_type=sla_breached&date_from=2026-10-11')->assertOk()));
    }

    public function test_pagination_is_opt_in_and_reports_totals(): void
    {
        $this->assertIsArray($this->fetch()->assertOk()->json(0));

        $page = $this->fetch('?branch_id=911&per_page=1&page=2')->assertOk();
        $page->assertJsonPath('pagination.current_page', 2)
            ->assertJsonPath('pagination.per_page', 1)
            ->assertJsonPath('pagination.total', 2)
            ->assertJsonPath('pagination.last_page', 2)
            ->assertJsonPath('count', 1);
    }

    public function test_invalid_filter_values_are_rejected(): void
    {
        $this->fetch('?date_from=not-a-date')->assertStatus(422);
        $this->fetch('?per_page=9999')->assertStatus(422);
    }

    public function test_filter_options_are_built_from_database_values(): void
    {
        $response = $this->actingAs($this->superAdmin, 'api')->getJson('/api/superadmin/audit-logs/filters')->assertOk();

        $this->assertContains('sla_breached', $response->json('action_types'));
        $this->assertContains('reassign_request', $response->json('action_types'));
        $this->assertContains(911, array_column($response->json('branches'), 'id'));
    }

    public function test_non_superadmin_cannot_read_logs_or_filter_options(): void
    {
        $this->actingAs($this->regularAdmin, 'api')->getJson('/api/superadmin/audit-logs?event_type=sla_breached')->assertStatus(403);
        $this->actingAs($this->regularAdmin, 'api')->getJson('/api/superadmin/audit-logs/filters')->assertStatus(403);
    }

    /**
     * Spec 0029 AC-20: the affected entity must be the ticket's real number, never a label padded from the internal row ID
     * (which names a different ticket whenever ID and number diverge).
     */
    public function test_entry_target_is_the_stored_ticket_number(): void
    {
        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => $this->betaTicket, 'action_type' => 'sla_breached', 'action_by_ID' => 1,
            'actor_type' => 'system', 'details' => json_encode(['sla_status' => 'Breached']), 'created_at' => '2026-10-11 10:00:00',
        ]);

        $rows = $this->mine($this->fetch('?per_page=200')->assertOk());
        $targets = array_values(array_unique(array_column($rows, 'target')));
        sort($targets);

        // System actor rows and Super Admin rows without their own target both resolve to the ticket number.
        $this->assertSame(['TCK-AUD-A', 'TCK-AUD-B'], $targets);
    }

    public function test_search_matches_the_ticket_number(): void
    {
        $rows = $this->mine($this->fetch('?search=TCK-AUD-B')->assertOk());

        $this->assertCount(1, $rows);
        $this->assertSame('TCK-AUD-B', $rows[0]['target']);
    }
}
