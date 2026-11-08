<?php

namespace Tests\Feature;

use App\Events\BranchPriorityChanged;
use App\Models\Employee;
use App\Services\SLAService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

class BranchPriorityTest extends TestCase
{
    use DatabaseTransactions;

    protected Employee $superAdmin;
    protected Employee $regularEmployee;
    protected int $priorityId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seedBranch('luzon', 'Luzon Regional Center', 'LUZ');
        $this->seedBranch('visayas', 'Visayas Medical Hub', 'VIS');
        $this->seedBranch('main', 'Main Branch', 'MAIN');

        DB::table('ticket_priorities')->updateOrInsert(
            ['priority_ID' => 3],
            ['priority_name' => 'High', 'color_code' => 'bg-orange-100 text-orange-700', 'created_at' => now(), 'updated_at' => now()]
        );
        $this->priorityId = 3;

        $this->superAdmin = Employee::where('role', 'superadmin')->first()
            ?? Employee::create([
                'emp_id' => 99991, 'first_name' => 'Super', 'last_name' => 'Admin',
                'email' => 'superadmin_test@example.com', 'role' => 'superadmin',
                'department' => 'Executive', 'is_active' => true, 'password_hash' => 'secret',
            ]);
        $this->regularEmployee = Employee::where('role', '!=', 'superadmin')->first()
            ?? Employee::create([
                'emp_id' => 99992, 'first_name' => 'Regular', 'last_name' => 'Staff',
                'email' => 'staff_test@example.com', 'role' => 'service',
                'department' => 'Service', 'is_active' => true, 'password_hash' => 'secret',
            ]);

        DB::table('branch_priority_overrides')->delete();
    }

    private function url(string $branch = 'luzon', string $suffix = ''): string
    {
        return "/api/superadmin/branches/{$branch}/priorities{$suffix}";
    }

    private function payload(array $over = []): array
    {
        return array_merge([
            'base_priority_id' => $this->priorityId,
            'name' => 'High',
            'color' => 'bg-orange-100 text-orange-700',
            'response_time_limit' => 10,
            'resolution_time_limit' => 120,
        ], $over);
    }

    public function test_non_superadmin_is_forbidden(): void
    {
        $this->actingAs($this->regularEmployee, 'api')->getJson($this->url())->assertStatus(403);
        $this->actingAs($this->regularEmployee, 'api')->postJson($this->url(), $this->payload())->assertStatus(403);
    }

    public function test_unauthenticated_is_rejected(): void
    {
        $this->getJson($this->url())->assertStatus(401);
    }

    public function test_listing_falls_back_to_system_default_when_no_override(): void
    {
        $res = $this->actingAs($this->superAdmin, 'api')->getJson($this->url())->assertOk();

        $high = collect($res->json('priorities'))->firstWhere('basePriorityId', $this->priorityId);
        $this->assertTrue($high['isInherited']);
        $this->assertSame(30, $high['responseTimeLimit']);
        $this->assertFalse($res->json('slaChangePolicy.recalculatesExistingOpenTickets'));
        $this->assertNotEmpty($res->json('slaChangePolicy.tooltip'));
    }

    public function test_create_override_is_branch_scoped_audited_and_published(): void
    {
        Event::fake([BranchPriorityChanged::class]);

        $res = $this->actingAs($this->superAdmin, 'api')->postJson($this->url(), $this->payload())->assertStatus(201);

        $luzon = collect($res->json('priorities'))->firstWhere('basePriorityId', $this->priorityId);
        $this->assertFalse($luzon['isInherited']);
        $this->assertSame(10, $luzon['responseTimeLimit']);

        // Other branches are unaffected and still inherit
        $main = $this->actingAs($this->superAdmin, 'api')->getJson($this->url('main'))->json('priorities');
        $this->assertTrue(collect($main)->firstWhere('basePriorityId', $this->priorityId)['isInherited']);

        Event::assertDispatched(BranchPriorityChanged::class, fn ($e) => $e->action === 'created' && $e->branchId === 'luzon');

        $log = DB::table('ticket_audit_logs')->where('action_type', 'config_create')->orderByDesc('log_ID')->first()
            ?? DB::table('ticket_audit_logs')->where('action_type', 'config_create')->latest('created_at')->first();
        $details = json_decode($log->details, true);
        $this->assertSame('luzon', $details['branch_id']);
        $this->assertNull($details['before']);
        $this->assertSame(10, $details['after']['response_time_limit']);
        $this->assertSame((int) $this->superAdmin->emp_id, (int) $log->action_by_ID);
    }

    public function test_duplicate_override_conflicts_and_validation_rejects_bad_sla(): void
    {
        $this->actingAs($this->superAdmin, 'api')->postJson($this->url(), $this->payload())->assertStatus(201);
        $this->actingAs($this->superAdmin, 'api')->postJson($this->url(), $this->payload())->assertStatus(409);
        $this->actingAs($this->superAdmin, 'api')
            ->postJson($this->url('main'), $this->payload(['response_time_limit' => 100, 'resolution_time_limit' => 50]))
            ->assertStatus(422);
        $this->actingAs($this->superAdmin, 'api')->getJson($this->url('does-not-exist'))->assertStatus(404);
    }

    public function test_update_records_before_and_after_and_cannot_cross_branches(): void
    {
        $created = $this->actingAs($this->superAdmin, 'api')->postJson($this->url(), $this->payload())->json('override');
        $id = collect($this->actingAs($this->superAdmin, 'api')->getJson($this->url())->json('priorities'))
            ->firstWhere('basePriorityId', $this->priorityId)['id'];

        Event::fake([BranchPriorityChanged::class]);
        $this->actingAs($this->superAdmin, 'api')
            ->putJson($this->url('luzon', "/{$id}"), $this->payload(['response_time_limit' => 5, 'resolution_time_limit' => 60]))
            ->assertOk();
        Event::assertDispatched(BranchPriorityChanged::class, fn ($e) => $e->action === 'updated'
            && $e->before['response_time_limit'] === 10 && $e->after['response_time_limit'] === 5);

        // IDOR: same id through another branch must not resolve
        $this->actingAs($this->superAdmin, 'api')
            ->putJson($this->url('main', "/{$id}"), $this->payload())->assertStatus(404);
        $this->actingAs($this->superAdmin, 'api')->deleteJson($this->url('main', "/{$id}"))->assertStatus(404);
    }

    public function test_removal_is_blocked_when_a_ticket_references_the_override(): void
    {
        $this->actingAs($this->superAdmin, 'api')->postJson($this->url(), $this->payload())->assertStatus(201);
        $id = collect($this->actingAs($this->superAdmin, 'api')->getJson($this->url())->json('priorities'))
            ->firstWhere('basePriorityId', $this->priorityId)['id'];

        $this->createTicketFixture('luzon', $id);

        $this->actingAs($this->superAdmin, 'api')->deleteJson($this->url('luzon', "/{$id}"))
            ->assertStatus(409)
            ->assertJsonPath('code', 'BRANCH_PRIORITY_IN_USE');
        $this->assertDatabaseHas('branch_priority_overrides', ['id' => $id]);

        DB::table('tickets')->where('branch_priority_override_id', $id)->update(['branch_priority_override_id' => null]);
        Event::fake([BranchPriorityChanged::class]);
        $this->actingAs($this->superAdmin, 'api')->deleteJson($this->url('luzon', "/{$id}"))->assertOk();
        Event::assertDispatched(BranchPriorityChanged::class, fn ($e) => $e->action === 'removed');
        $this->assertDatabaseMissing('branch_priority_overrides', ['id' => $id]);
    }

    public function test_sla_uses_branch_override_for_new_tickets_and_never_recalculates_existing(): void
    {
        $this->actingAs($this->superAdmin, 'api')->postJson($this->url(), $this->payload())->assertStatus(201);
        $id = collect($this->actingAs($this->superAdmin, 'api')->getJson($this->url())->json('priorities'))
            ->firstWhere('basePriorityId', $this->priorityId)['id'];

        $ticketId = $this->createTicketFixture('luzon', null);
        $result = app(SLAService::class)->assignSlaToTicket($ticketId, 1, null, 'High', now(), 'dynamic', 'luzon');
        $this->assertTrue($result['is_branch_override']);
        $this->assertSame(10, $result['response_time_limit']);
        $before = DB::table('tickets')->where('ticket_ID', $ticketId)->value('response_due_at');

        $this->actingAs($this->superAdmin, 'api')
            ->putJson($this->url('luzon', "/{$id}"), $this->payload(['response_time_limit' => 1, 'resolution_time_limit' => 2]))
            ->assertOk();

        // Existing ticket keeps its deadline; only a new ticket sees the edit
        $this->assertSame($before, DB::table('tickets')->where('ticket_ID', $ticketId)->value('response_due_at'));
        $new = app(SLAService::class)->assignSlaToTicket($this->createTicketFixture('luzon', null), 1, null, 'High', now(), 'dynamic', 'luzon');
        $this->assertSame(1, $new['response_time_limit']);

        // A branch without an override falls back to the system-wide path
        $fallback = app(SLAService::class)->assignSlaToTicket($this->createTicketFixture('main', null), 1, null, 'High', now(), 'dynamic', 'main');
        $this->assertArrayNotHasKey('is_branch_override', $fallback);
    }

    private function createTicketFixture(string $branch, ?int $overrideId): int
    {
        $clientId = DB::table('clients')->insertGetId([
            'client_name' => 'Branch Test', 'email' => 'bp_' . uniqid() . '@example.com',
            'contact_number' => '1', 'address' => 'x', 'status' => true,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('ticket_statuses')->updateOrInsert(['ticket_status_ID' => 1], ['status_name' => 'Open', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('ticket_types')->updateOrInsert(['ticket_type_ID' => 1], ['type_name' => 'External', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('problem_categories')->updateOrInsert(['problem_category_ID' => 1], ['category_name' => 'Hardware Issue', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        $this->seedMachine(1, ['machine_name' => 'Demo Scanner', 'serial_number' => 'SN-1001']);

        return DB::table('tickets')->insertGetId([
            'machine_ID' => 1, 'problem_category_ID' => 1, 'created_by' => $clientId,
            'ticket_type_ID' => 1, 'priority_ID' => $this->priorityId, 'ticket_status_ID' => 1,
            'branch_id' => $branch, 'branch_priority_override_id' => $overrideId,
            'title' => 'Branch fixture', 'created_at' => now(), 'updated_at' => now(),
        ]);
    }
}
