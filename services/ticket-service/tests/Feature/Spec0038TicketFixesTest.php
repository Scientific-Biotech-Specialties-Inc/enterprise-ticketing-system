<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Employee;
use App\Services\ProofReviewService;
use App\Services\TicketDashboardService;
use App\Services\TicketStateMachine;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Spec 0038: ticket modal, dashboard, and AI escalation defect fixes (backend).
 */
class Spec0038TicketFixesTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'mysql']);
        config(['database.connections.mysql.database' => 'ticketing_system_test']);
        DB::purge('mysql');
        DB::reconnect('mysql');
        Cache::flush();

        // The test database's status table differs from production; pin the ids this spec uses.
        foreach ([
            1 => 'Open', 2 => 'In Progress', 3 => 'Resolved', 4 => 'Closed', 6 => 'Pending Evaluation',
            7 => 'Pending', 8 => 'Reopened', 9 => 'Discarded', 10 => 'Pending Assignment', 11 => 'On Hold',
        ] as $id => $name) {
            DB::table('ticket_statuses')->updateOrInsert(['ticket_status_ID' => $id], ['status_name' => $name]);
        }
        DB::table('ticket_statuses')->where('ticket_status_ID', 5)->update(['status_name' => 'Escalated']);
        DB::table('ticket_types')->updateOrInsert(['ticket_type_ID' => 2], ['type_name' => 'External', 'created_at' => now(), 'updated_at' => now()]);
    }

    private function client(string $label): Client
    {
        $uid = uniqid();
        return Client::create([
            'client_name' => "{$label} Hospital {$uid}",
            'email' => strtolower($label) . ".{$uid}@client.test",
            'contact_number' => '0000000000',
            'address' => '1 Test Way',
        ]);
    }

    private function employee(string $role, string $department = 'Service'): Employee
    {
        $id = DB::table('employees')->insertGetId([
            'first_name' => ucfirst($role),
            'last_name' => 'Tester',
            'email' => str_replace(' ', '', $role) . '.' . uniqid() . '@staff.test',
            'role' => $role,
            'department' => $department,
            'is_active' => 1,
            'password_hash' => 'hash',
        ]);
        return Employee::where('emp_id', $id)->first();
    }

    private function machineFor(Client $client): int
    {
        $categoryId = DB::table('machine_categories')->value('category_ID');
        // The test database still has an old machines.client_ID foreign key to `users`;
        // production points it at `clients`. Relax checks for this insert only.
        DB::statement('SET FOREIGN_KEY_CHECKS=0');
        try {
            return $this->insertMachine($categoryId, $client);
        } finally {
            DB::statement('SET FOREIGN_KEY_CHECKS=1');
        }
    }

    private function insertMachine($categoryId, Client $client): int
    {
        return DB::table('machines')->insertGetId([
            'category_ID' => $categoryId,
            'client_ID' => $client->id,
            'machine_name' => 'Patient Monitor',
            'serial_number' => 'SN-' . strtoupper(uniqid()),
            'model' => 'VS-900',
            'brand' => 'Philips',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function ticket(Client $client, int $statusId, array $extra = []): int
    {
        return DB::table('tickets')->insertGetId(array_merge([
            'ticket_number' => 'S38-' . strtoupper(uniqid()),
            'title' => 'Spec 0038 Ticket',
            'description' => 'Test ticket',
            'created_by' => $client->id,
            'ticket_type_ID' => 2,
            'is_internal' => false,
            'ticket_status_ID' => $statusId,
            'priority_ID' => DB::table('ticket_priorities')->value('priority_ID'),
            'problem_category_ID' => DB::table('problem_categories')->value('problem_category_ID'),
            'created_at' => now(),
            'updated_at' => now(),
        ], $extra));
    }

    private function assign(int $ticketId, Employee $emp, string $status = 'assigned', $assignedAt = null): int
    {
        return DB::table('ticket_assignments')->insertGetId([
            'ticket_ID' => $ticketId,
            'employee_ID' => $emp->emp_id,
            'assigned_by' => $emp->emp_id,
            'assignment_status' => $status,
            'assigned_at' => $assignedAt ?? now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** AC-5 */
    public function test_external_ticket_rejects_a_machine_registered_to_another_customer(): void
    {
        $owner = $this->client('Owner');
        $other = $this->client('Other');
        $othersMachine = $this->machineFor($other);

        $response = $this->actingAs($owner, 'api')->postJson('/api/tickets', [
            'title' => 'Monitor Not Starting',
            'description' => 'The monitor does not power on.',
            'machine_ID' => $othersMachine,
            'problem_category_ID' => DB::table('problem_categories')->value('problem_category_ID'),
            'department_id' => 1,
        ]);

        $response->assertStatus(422)
            ->assertJsonPath('errors.machine_ID.0', 'The selected machine is not registered to this customer.');
    }

    /** AC-8 / AC-9 */
    public function test_reminders_target_each_assignee_with_its_own_cooldown(): void
    {
        Http::fake();
        $client = $this->client('Remind');
        $cs = $this->employee('customer service', 'Customer Service');
        $first = $this->employee('service engineer');
        $second = $this->employee('service engineer');
        $outsider = $this->employee('service engineer');

        $ticketId = $this->ticket($client, 2, ['assigned_to' => $first->emp_id]);
        $this->assign($ticketId, $first, 'accepted', now()->subHour());
        $this->assign($ticketId, $second, 'assigned', now());

        $this->actingAs($cs)->postJson("/api/tickets/{$ticketId}/reminders", ['employee_id' => $first->emp_id])
            ->assertStatus(200)->assertJsonPath('data.employee_id', $first->emp_id);

        // Reminding one assignee never blocks reminding another.
        $this->actingAs($cs)->postJson("/api/tickets/{$ticketId}/reminders", ['employee_id' => $second->emp_id])
            ->assertStatus(200)->assertJsonPath('data.employee_id', $second->emp_id);

        $this->actingAs($cs)->postJson("/api/tickets/{$ticketId}/reminders", ['employee_id' => $first->emp_id])
            ->assertStatus(429)->assertJsonStructure(['cooldown_remaining_minutes']);

        // AC-9: not an active assignee.
        $this->actingAs($cs)->postJson("/api/tickets/{$ticketId}/reminders", ['employee_id' => $outsider->emp_id])
            ->assertStatus(422);

        $this->assertNotNull(DB::table('ticket_assignments')->where('ticket_ID', $ticketId)->where('employee_ID', $second->emp_id)->value('last_reminder_sent_at'));
        $this->assertNotNull(DB::table('tickets')->where('ticket_ID', $ticketId)->value('last_reminder_sent_at'));
    }

    /** AC-12 */
    public function test_customer_summary_buckets_every_status_into_exactly_one_card(): void
    {
        $this->assertSame('open', TicketDashboardService::customerSummaryBucket('Pending'));
        $this->assertSame('open', TicketDashboardService::customerSummaryBucket('Pending Assignment'));
        $this->assertSame('in_progress', TicketDashboardService::customerSummaryBucket('Escalated'));
        $this->assertSame('in_progress', TicketDashboardService::customerSummaryBucket('Pending Evaluation'));
        $this->assertSame('in_progress', TicketDashboardService::customerSummaryBucket('Reopened'));
        $this->assertSame('in_progress', TicketDashboardService::customerSummaryBucket('On Hold'));
        $this->assertSame('resolved', TicketDashboardService::customerSummaryBucket('Resolved'));
        $this->assertSame('closed', TicketDashboardService::customerSummaryBucket('Closed'));
        $this->assertNull(TicketDashboardService::customerSummaryBucket('Discarded'));
    }

    /** AC-12 / AC-13 */
    public function test_customer_dashboard_counts_active_tickets_and_lists_each_ticket_once(): void
    {
        $client = $this->client('Counts');
        foreach ([1, 7, 10, 2, 5, 6, 11, 8, 3, 4, 9] as $status) {
            $this->ticket($client, $status);
        }
        $multi = $this->ticket($client, 2, ['created_at' => now()->addMinute()]);
        $this->assign($multi, $this->employee('service engineer'), 'accepted');
        $this->assign($multi, $this->employee('service engineer'), 'assigned');

        $response = $this->actingAs($client, 'api')->getJson('/api/customer-dashboard');
        $response->assertStatus(200);

        // Open: Open, Pending, Pending Assignment. In Progress: In Progress x2, Escalated,
        // Pending Evaluation, On Hold, Reopened. Discarded excluded.
        $response->assertJsonPath('summary.open', 3)
            ->assertJsonPath('summary.in_progress', 6)
            ->assertJsonPath('summary.resolved', 1)
            ->assertJsonPath('summary.closed', 1);

        $ids = collect($response->json('recent_tickets'))->pluck('ticket_ID')->all();
        $this->assertSame(count($ids), count(array_unique($ids)), 'Each ticket appears once in recent tickets.');
        $this->assertContains($multi, $ids);
    }

    /** AC-28 / AC-29 */
    public function test_resume_returns_a_held_pending_evaluation_ticket_to_pending_evaluation(): void
    {
        Http::fake();
        $client = $this->client('Hold');
        $cs = $this->employee('customer service', 'Customer Service');
        $tech = $this->employee('service engineer');
        $ticketId = $this->ticket($client, 6, ['in_progress_owner' => 'employee', 'assigned_to' => $tech->emp_id, 'proof_rejected' => false]);
        $this->assign($ticketId, $tech, 'accepted');

        $machine = app(TicketStateMachine::class);
        $machine->applyTransition($ticketId, 'hold', ['reason' => 'Waiting for parts'], $cs);
        $held = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        $this->assertSame(11, (int) $held->ticket_status_ID);
        $this->assertSame(6, (int) $held->held_from_status_ID);

        $machine->applyTransition($ticketId, 'resume', [], $cs);
        $resumed = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        $this->assertSame(6, (int) $resumed->ticket_status_ID);
        $this->assertSame('employee', $resumed->in_progress_owner);
        $this->assertFalse((bool) $resumed->proof_rejected);

        $audit = DB::table('ticket_audit_logs')->where('ticket_ID', $ticketId)->where('action_type', 'resume')->orderByDesc('log_ID')->first();
        $details = json_decode($audit->details, true);
        $this->assertSame('On Hold', $details['from_status']);
        $this->assertSame('Pending Evaluation', $details['to_status']);
    }

    /** AC-31 / AC-32 / AC-33 */
    public function test_cs_must_open_every_proof_file_before_approving(): void
    {
        Http::fake([
            '*/api/attachments*' => Http::response(['attachments' => [
                ['id' => 901, 'name' => 'calibration.pdf'],
                ['id' => 902, 'name' => 'photo.jpg'],
            ]], 200),
            '*' => Http::response([], 200),
        ]);
        $client = $this->client('Proof');
        $cs = $this->employee('customer service', 'Customer Service');
        $otherCs = $this->employee('customer service', 'Customer Service');
        $tech = $this->employee('service engineer');
        $ticketId = $this->ticket($client, 6, ['in_progress_owner' => 'employee', 'assigned_to' => $tech->emp_id]);
        $this->assign($ticketId, $tech, 'accepted');
        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => $ticketId,
            'action_type' => 'status_change',
            'action_by_ID' => $tech->emp_id,
            'actor_type' => 'employee',
            'details' => json_encode(['status' => 'Pending Evaluation']),
            'created_at' => now()->subMinute(),
        ]);

        $gate = app(ProofReviewService::class);
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();

        $blocked = $gate->approvalGateError($ticket, 4, $cs);
        $this->assertSame(422, $blocked['status']);
        $this->assertSame('PROOF_NOT_VIEWED', $blocked['data']['code']);
        $this->assertEqualsCanonicalizing(['calibration.pdf', 'photo.jpg'], $blocked['data']['unviewed_files']);

        // Only CS or admin can record a view, and only for a proof of this ticket.
        $this->actingAs($client, 'api')->postJson("/api/tickets/{$ticketId}/proof-views", ['attachment_id' => 901])->assertStatus(403);
        $this->actingAs($cs)->postJson("/api/tickets/{$ticketId}/proof-views", ['attachment_id' => 999])->assertStatus(422);

        $this->actingAs($cs)->postJson("/api/tickets/{$ticketId}/proof-views", ['attachment_id' => 901])
            ->assertStatus(200)->assertJsonPath('all_viewed', false);
        $this->actingAs($cs)->postJson("/api/tickets/{$ticketId}/proof-views", ['attachment_id' => 902])
            ->assertStatus(200)->assertJsonPath('all_viewed', true);

        $this->assertNull($gate->approvalGateError($ticket, 4, $cs), 'The user who opened every file may approve.');
        $this->assertSame('PROOF_NOT_VIEWED', $gate->approvalGateError($ticket, 4, $otherCs)['data']['code'] ?? null,
            'Another CS user who opened nothing is still blocked.');

        // The real CS approval path (PATCH to Closed) is refused for the second user.
        $this->actingAs($otherCs)->patchJson("/api/tickets/{$ticketId}", ['ticket_status_ID' => 4])
            ->assertStatus(422)->assertJsonPath('code', 'PROOF_NOT_VIEWED');
    }

    /** AC-33 */
    public function test_approval_is_blocked_when_no_proof_was_uploaded(): void
    {
        Http::fake(['*/api/attachments*' => Http::response(['attachments' => []], 200)]);
        $client = $this->client('NoProof');
        $cs = $this->employee('customer service', 'Customer Service');
        $tech = $this->employee('service engineer');
        $ticketId = $this->ticket($client, 6, ['assigned_to' => $tech->emp_id]);
        $this->assign($ticketId, $tech, 'accepted');

        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        $result = app(ProofReviewService::class)->approvalGateError($ticket, 4, $cs);
        $this->assertSame(422, $result['status']);
        $this->assertSame([], $result['data']['unviewed_files']);
    }

    /** AC-34 */
    public function test_ownership_endpoint_returns_owner_and_hides_other_customers_tickets(): void
    {
        $owner = $this->client('OwnerLookup');
        $other = $this->client('OtherLookup');
        $cs = $this->employee('customer service', 'Customer Service');
        $ticketId = $this->ticket($owner, 3);

        $this->actingAs($owner, 'api')->getJson("/api/tickets/{$ticketId}/ownership")
            ->assertStatus(200)
            ->assertJson([
                'ticket_ID' => $ticketId,
                'client_ID' => $owner->id,
                'status_name' => 'Resolved',
                'is_internal' => false,
            ]);

        $this->actingAs($other, 'api')->getJson("/api/tickets/{$ticketId}/ownership")->assertStatus(404);
        $this->actingAs($cs)->getJson("/api/tickets/{$ticketId}/ownership")->assertStatus(200);
    }
}
