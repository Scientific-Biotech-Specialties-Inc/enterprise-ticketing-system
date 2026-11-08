<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Regression: when employee-service changed a ticket's priority during CS assignment,
 * SLA deadlines kept the old priority's rule. ticket-service now exposes a token
 * protected endpoint that recalculates from the ticket's current priority, using
 * the same department the ticket's SLA was created against.
 */
class InternalSlaRecalculationTest extends TestCase
{
    use DatabaseTransactions;

    private int $deptId;
    private int $lowRuleId;
    private int $highRuleId;
    private int $highPriorityId;
    private int $ticketId;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake(['*' => Http::response(['status' => 'success'], 200)]);
        putenv('INTERNAL_TOKEN=test-internal-token');
        $_ENV['INTERNAL_TOKEN'] = 'test-internal-token';
        $_SERVER['INTERNAL_TOKEN'] = 'test-internal-token';

        $this->deptId = (int) DB::table('departments')->insertGetId([
            'name' => 'SLA Regression Dept ' . uniqid(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Other suites rename or remove priorities in the shared test DB, so make sure ours exist.
        foreach (['Low', 'High'] as $name) {
            if (!DB::table('ticket_priorities')->whereRaw('LOWER(priority_name) = ?', [strtolower($name)])->exists()) {
                DB::table('ticket_priorities')->insert(['priority_name' => $name, 'created_at' => now(), 'updated_at' => now()]);
            }
        }
        $this->highPriorityId = (int) DB::table('ticket_priorities')->whereRaw('LOWER(priority_name) = ?', ['high'])->value('priority_ID');

        $this->lowRuleId = (int) DB::table('sla_rules')->insertGetId([
            'department_id' => $this->deptId, 'category_id' => null, 'priority' => 'Low',
            'response_time_limit' => 240, 'resolution_time_limit' => 4320,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->highRuleId = (int) DB::table('sla_rules')->insertGetId([
            'department_id' => $this->deptId, 'category_id' => null, 'priority' => 'High',
            'response_time_limit' => 15, 'resolution_time_limit' => 120,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        $categoryId = (int) DB::table('problem_categories')->value('problem_category_ID');

        // Simulates a customer ticket created as Low, then switched to High directly
        // in the shared table (as employee-service does during assignment).
        $this->ticketId = (int) DB::table('tickets')->insertGetId([
            'ticket_number' => 'SLA-REG-' . uniqid(),
            'title' => 'SLA regression',
            'description' => 'SLA regression',
            'problem_category_ID' => $categoryId,
            'created_by' => (int) (DB::table('clients')->value('id') ?? 1),
            'ticket_type_ID' => (int) (DB::table('ticket_types')->value('ticket_type_ID') ?? 1),
            'priority_ID' => $this->highPriorityId,
            'ticket_status_ID' => 1,
            'is_internal' => 0,
            'sla_rule_id' => $this->lowRuleId,
            'sla_started_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_rejects_calls_without_internal_token(): void
    {
        $this->postJson("/api/internal/tickets/{$this->ticketId}/sla/recalculate")->assertStatus(403);
        $this->assertSame($this->lowRuleId, (int) DB::table('tickets')->where('ticket_ID', $this->ticketId)->value('sla_rule_id'));
    }

    public function test_recalculates_using_current_priority_and_original_department(): void
    {
        $this->postJson(
            "/api/internal/tickets/{$this->ticketId}/sla/recalculate",
            [],
            ['X-Internal-Token' => 'test-internal-token']
        )->assertOk();

        $this->assertSame(
            $this->highRuleId,
            (int) DB::table('tickets')->where('ticket_ID', $this->ticketId)->value('sla_rule_id'),
            'Ticket should move to the High rule of the department its SLA was created against.'
        );
    }
}
