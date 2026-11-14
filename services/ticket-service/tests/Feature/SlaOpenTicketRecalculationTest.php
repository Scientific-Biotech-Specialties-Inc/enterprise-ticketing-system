<?php

namespace Tests\Feature;

use App\Services\SLAService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * After a superadmin changes business hours (e.g. UTC -> Asia/Manila) existing open
 * tickets kept their old, shifted deadlines. recalculateOpenTickets() applies the
 * current rules and hours to open tickets only, and keeps On Hold tickets Paused.
 */
class SlaOpenTicketRecalculationTest extends TestCase
{
    use DatabaseTransactions;

    private int $ruleId;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake(['*' => Http::response(['status' => 'success'], 200)]);

        Cache::put('ticket:config:business_hours', [
            'enabled' => true,
            'timezone' => 'Asia/Manila',
            'startTime' => '09:00',
            'endTime' => '17:00',
            'workingDays' => [1, 2, 3, 4, 5],
        ], 300);

        foreach (['High'] as $name) {
            if (!DB::table('ticket_priorities')->whereRaw('LOWER(priority_name) = ?', [strtolower($name)])->exists()) {
                DB::table('ticket_priorities')->insert(['priority_name' => $name, 'created_at' => now(), 'updated_at' => now()]);
            }
        }

        $deptId = (int) DB::table('departments')->insertGetId(['name' => 'Recalc Dept ' . uniqid(), 'code' => 'T' . strtoupper(substr(uniqid(), -8)), 'created_at' => now(), 'updated_at' => now()]);
        $this->ruleId = (int) DB::table('sla_rules')->insertGetId([
            'department_id' => $deptId, 'category_id' => null, 'priority' => 'High',
            'response_time_limit' => 15, 'resolution_time_limit' => 120,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    protected function tearDown(): void
    {
        Cache::forget('ticket:config:business_hours');
        parent::tearDown();
    }

    private function ticket(string $statusName, array $extra = []): int
    {
        $statusId = (int) DB::table('ticket_statuses')->whereRaw('LOWER(status_name) = ?', [strtolower($statusName)])->value('ticket_status_ID');

        return (int) DB::table('tickets')->insertGetId(array_merge([
            'ticket_number' => 'RECALC-' . uniqid(),
            'title' => 'Recalc',
            'description' => 'Recalc',
            'problem_category_ID' => (int) DB::table('problem_categories')->value('problem_category_ID'),
            'created_by' => (int) (DB::table('clients')->value('id') ?? 1),
            'ticket_type_ID' => (int) (DB::table('ticket_types')->value('ticket_type_ID') ?? 1),
            'priority_ID' => (int) DB::table('ticket_priorities')->whereRaw('LOWER(priority_name) = ?', ['high'])->value('priority_ID'),
            'ticket_status_ID' => $statusId,
            'is_internal' => 0,
            'sla_rule_id' => $this->ruleId,
            // Saturday 22:15 UTC = Sunday 06:15 Manila
            'sla_started_at' => '2026-11-07 22:15:00',
            'created_at' => '2026-11-07 22:15:00',
            'updated_at' => now(),
            // Old deadline computed with 09:00 to 17:00 UTC
            'response_due_at' => '2026-11-09 09:15:00',
            'resolution_due_at' => '2026-11-09 11:00:00',
        ], $extra));
    }

    public function test_open_tickets_get_deadlines_in_the_business_timezone(): void
    {
        $id = $this->ticket('Open');

        $result = app(SLAService::class)->recalculateOpenTickets();

        $this->assertGreaterThanOrEqual(1, $result['recalculated']);
        $row = DB::table('tickets')->where('ticket_ID', $id)->first();
        // Monday 09:00 Manila = 01:00 UTC; +15 min response, +2 h resolution
        $this->assertSame('2026-11-09 01:15:00', (string) $row->response_due_at);
        $this->assertSame('2026-11-09 03:00:00', (string) $row->resolution_due_at);
    }

    public function test_on_hold_ticket_stays_paused(): void
    {
        $id = $this->ticket('On Hold', ['sla_paused_at' => now()->subHour(), 'sla_status' => 'Paused']);

        app(SLAService::class)->recalculateOpenTickets();

        $this->assertSame('Paused', DB::table('tickets')->where('ticket_ID', $id)->value('sla_status'));
    }

    public function test_closed_tickets_are_not_touched(): void
    {
        $id = $this->ticket('Closed');

        app(SLAService::class)->recalculateOpenTickets();

        $this->assertSame('2026-11-09 11:00:00', (string) DB::table('tickets')->where('ticket_ID', $id)->value('resolution_due_at'));
    }
}
