<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Employee;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Spec 0037, Slice A: attachment-service asks ticket-service whether the forwarded
 * caller belongs to a file's ticket. Needs both the internal token and a caller identity.
 */
class InternalAttachmentAccessTest extends TestCase
{
    use DatabaseTransactions;

    private const TOKEN = 'test-internal-token';

    private Client $owner;
    private Client $stranger;
    private int $ticketId;
    private int $seq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake(['*' => Http::response(['status' => 'success'], 200)]);
        putenv('INTERNAL_TOKEN=' . self::TOKEN);
        $_ENV['INTERNAL_TOKEN'] = self::TOKEN;
        $_SERVER['INTERNAL_TOKEN'] = self::TOKEN;

        $uid = uniqid();
        $this->owner = Client::create(['client_name' => "Spec37 Owner {$uid}", 'email' => "owner.{$uid}@spec37.test", 'contact_number' => '1', 'address' => 'x']);
        $this->stranger = Client::create(['client_name' => "Spec37 Stranger {$uid}", 'email' => "stranger.{$uid}@spec37.test", 'contact_number' => '2', 'address' => 'y']);
        $this->ticketId = $this->ticket(['created_by' => $this->owner->id]);
    }

    private function ticket(array $over = []): int
    {
        return (int) DB::table('tickets')->insertGetId(array_merge([
            'ticket_number' => 'S37-' . (++$this->seq) . '-' . uniqid(),
            'title' => 'Spec 37 access',
            'description' => 'Spec 37 access',
            'problem_category_ID' => (int) DB::table('problem_categories')->value('problem_category_ID'),
            'created_by' => $this->owner->id ?? (int) DB::table('clients')->value('id'),
            'ticket_type_ID' => (int) (DB::table('ticket_types')->value('ticket_type_ID') ?? 1),
            'priority_ID' => (int) (DB::table('ticket_priorities')->value('priority_ID') ?? 1),
            'ticket_status_ID' => 1,
            'is_internal' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ], $over));
    }

    private function employee(int $id, string $role, string $department): Employee
    {
        return Employee::create([
            'emp_id' => $id,
            'first_name' => "Spec37 {$id}",
            'last_name' => $department,
            'email' => "emp{$id}." . uniqid() . '@spec37.test',
            'role' => $role,
            'department' => $department,
            'position_level' => 'Employee',
            'is_active' => 1,
            'password_hash' => bcrypt('password'),
        ]);
    }

    private function check(array $query, ?string $token = self::TOKEN)
    {
        $headers = $token === null ? [] : ['X-Internal-Token' => $token];
        return $this->getJson('/api/internal/attachment-access?' . http_build_query($query), $headers);
    }

    public function test_rejects_a_bad_internal_token(): void
    {
        $this->actingAs($this->owner, 'api');
        $this->check(['ticket_id' => $this->ticketId], 'wrong')->assertStatus(403);
        $this->check(['ticket_id' => $this->ticketId], null)->assertStatus(403);
    }

    public function test_rejects_a_missing_caller_identity(): void
    {
        $this->check(['ticket_id' => $this->ticketId])->assertStatus(401);
    }

    public function test_customer_owner_is_allowed_and_another_customer_is_not(): void
    {
        $this->actingAs($this->owner, 'api');
        $this->check(['ticket_id' => $this->ticketId])
            ->assertOk()
            ->assertJson(['allowed' => true, 'user_id' => $this->owner->id, 'user_type' => 'customer']);

        $this->actingAs($this->stranger, 'api');
        $this->check(['ticket_id' => $this->ticketId])->assertOk()->assertJson(['allowed' => false]);
    }

    public function test_customer_cannot_open_internal_ticket_files_even_as_creator(): void
    {
        $internal = $this->ticket(['created_by' => $this->owner->id, 'is_internal' => 1]);
        $this->actingAs($this->owner, 'api');
        $this->check(['ticket_id' => $internal])->assertOk()->assertJson(['allowed' => false]);
    }

    public function test_employee_rules_follow_the_chat_thread_rule(): void
    {
        $assignee = $this->employee(937001, 'service', 'Service');
        $delegate = $this->employee(937002, 'service', 'Service');
        $outsider = $this->employee(937003, 'service', 'Finance');
        $cs = $this->employee(937004, 'cs', 'Customer Service');
        $admin = $this->employee(937005, 'superadmin', 'IT');

        DB::table('tickets')->where('ticket_ID', $this->ticketId)->update(['assigned_to' => $assignee->emp_id]);
        DB::table('ticket_assignments')->insert([
            'ticket_ID' => $this->ticketId,
            'employee_ID' => $delegate->emp_id,
            'assignment_status' => 'assigned',
            'assigned_by' => $delegate->emp_id,
            'assigned_at' => now(),
        ]);

        foreach ([$assignee, $delegate, $cs, $admin] as $emp) {
            $this->actingAs($emp, 'api');
            $this->check(['ticket_id' => $this->ticketId])
                ->assertOk()
                ->assertJson(['allowed' => true, 'user_id' => $emp->emp_id, 'user_type' => 'employee']);
        }

        $this->actingAs($outsider, 'api');
        $this->check(['ticket_id' => $this->ticketId])->assertOk()->assertJson(['allowed' => false]);
    }

    public function test_internal_ticket_requester_is_allowed(): void
    {
        $requester = $this->employee(937010, 'service', 'Finance');
        $internal = $this->ticket(['is_internal' => 1, 'requested_by' => $requester->emp_id]);

        $this->actingAs($requester, 'api');
        $this->check(['ticket_id' => $internal])->assertOk()->assertJson(['allowed' => true]);
    }

    public function test_manager_of_the_ticket_department_is_allowed(): void
    {
        // A customer ticket with no SLA rule resolves to department 2.
        $deptName = DB::table('departments')->where('id', 2)->value('name');
        if (!$deptName) {
            $this->markTestSkipped('Needs department 2 in the test database.');
        }

        $manager = $this->employee(937020, 'manager', $deptName);
        $otherManager = $this->employee(937021, 'manager', $deptName . ' Elsewhere');

        $this->actingAs($manager, 'api');
        $this->check(['ticket_id' => $this->ticketId])->assertOk()->assertJson(['allowed' => true]);

        $this->actingAs($otherManager, 'api');
        $this->check(['ticket_id' => $this->ticketId])->assertOk()->assertJson(['allowed' => false]);
    }

    public function test_assignment_id_resolves_to_its_ticket(): void
    {
        $tech = $this->employee(937030, 'service', 'Service');
        $assignmentId = DB::table('ticket_assignments')->insertGetId([
            'ticket_ID' => $this->ticketId,
            'employee_ID' => $tech->emp_id,
            'assignment_status' => 'accepted',
            'assigned_by' => $tech->emp_id,
            'assigned_at' => now(),
        ]);

        $this->actingAs($this->owner, 'api');
        $this->check(['assignment_id' => $assignmentId])->assertOk()->assertJson(['allowed' => true]);

        $this->actingAs($this->stranger, 'api');
        $this->check(['assignment_id' => $assignmentId])->assertOk()->assertJson(['allowed' => false]);
    }

    public function test_unknown_ticket_or_assignment_is_404(): void
    {
        $this->actingAs($this->owner, 'api');
        $this->check(['ticket_id' => 999999999])->assertStatus(404);
        $this->check(['assignment_id' => 999999999])->assertStatus(404);
    }

    public function test_no_ticket_returns_the_callers_identity(): void
    {
        $this->actingAs($this->owner, 'api');
        $this->check([])->assertOk()->assertJson(['allowed' => true, 'user_id' => $this->owner->id, 'user_type' => 'customer']);
    }
}
