<?php

namespace Tests\Feature;

use App\Models\Employee;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class TicketReminderTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::getDriverName() === 'sqlite') {
            DB::statement('PRAGMA foreign_keys = OFF');
        }

        if (!\Illuminate\Support\Facades\Schema::hasTable('clients')) {
            \Illuminate\Support\Facades\Schema::create('clients', function ($t) {
                $t->increments('id');
                $t->string('client_name')->default('Test Hospital');
                $t->string('email')->nullable();
                $t->boolean('status')->default(true);
                $t->timestamps();
            });
        }

        if (!\Illuminate\Support\Facades\Schema::hasTable('employees')) {
            \Illuminate\Support\Facades\Schema::create('employees', function ($t) {
                $t->bigIncrements('emp_id');
                $t->string('email')->unique();
                $t->string('first_name');
                $t->string('last_name');
                $t->string('role');
                $t->string('department');
                $t->string('branch')->nullable()->default('Main');
                $t->boolean('is_active')->default(true);
                $t->string('password_hash')->nullable();
                $t->timestamps();
            });
        }

        if (!\Illuminate\Support\Facades\Schema::hasTable('problem_categories')) {
            \Illuminate\Support\Facades\Schema::create('problem_categories', function ($t) {
                $t->increments('problem_category_ID');
                $t->string('category_name');
            });
            DB::table('problem_categories')->insert(['problem_category_ID' => 1, 'category_name' => 'General']);
        }

        if (!\Illuminate\Support\Facades\Schema::hasTable('machines')) {
            \Illuminate\Support\Facades\Schema::create('machines', function ($t) {
                $t->increments('machine_ID');
                $t->string('machine_name');
                $t->string('serial_number')->default('SN-1234');
            });
            DB::table('machines')->insert(['machine_ID' => 1, 'machine_name' => 'Ultrasound Machine', 'serial_number' => 'US-1001']);
        }

        if (!\Illuminate\Support\Facades\Schema::hasTable('ticket_statuses')) {
            \Illuminate\Support\Facades\Schema::create('ticket_statuses', function ($t) {
                $t->increments('ticket_status_ID');
                $t->string('status_name');
            });
            DB::table('ticket_statuses')->insert([
                ['ticket_status_ID' => 1, 'status_name' => 'Open'],
                ['ticket_status_ID' => 2, 'status_name' => 'In Progress'],
                ['ticket_status_ID' => 3, 'status_name' => 'Resolved'],
                ['ticket_status_ID' => 4, 'status_name' => 'Closed'],
                ['ticket_status_ID' => 10, 'status_name' => 'Pending Assignment'],
            ]);
        }

        if (!\Illuminate\Support\Facades\Schema::hasTable('ticket_priorities')) {
            \Illuminate\Support\Facades\Schema::create('ticket_priorities', function ($t) {
                $t->increments('priority_ID');
                $t->string('priority_name');
            });
            DB::table('ticket_priorities')->insert([
                ['priority_ID' => 1, 'priority_name' => 'Low'],
                ['priority_ID' => 2, 'priority_name' => 'Medium'],
                ['priority_ID' => 3, 'priority_name' => 'High'],
                ['priority_ID' => 4, 'priority_name' => 'Critical'],
            ]);
        }

        foreach ([1 => 'Low', 2 => 'Medium', 3 => 'High', 4 => 'Critical'] as $pid => $pname) {
            if (DB::table('ticket_priorities')->where('priority_ID', $pid)->doesntExist()) {
                DB::table('ticket_priorities')->insert(['priority_ID' => $pid, 'priority_name' => $pname]);
            }
        }

        if (!\Illuminate\Support\Facades\Schema::hasTable('tickets')) {
            \Illuminate\Support\Facades\Schema::create('tickets', function ($t) {
                $t->bigIncrements('ticket_ID');
                $t->string('ticket_number')->nullable();
                $t->string('title');
                $t->text('description')->nullable();
                $t->unsignedInteger('machine_ID')->nullable();
                $t->unsignedInteger('problem_category_ID')->nullable();
                $t->unsignedInteger('created_by')->nullable();
                $t->unsignedBigInteger('assigned_to')->nullable();
                $t->unsignedInteger('ticket_type_ID')->default(1);
                $t->unsignedInteger('priority_ID')->nullable();
                $t->unsignedInteger('ticket_status_ID')->default(1);
                $t->dateTime('resolution_due_at')->nullable();
                $t->dateTime('resolved_at')->nullable();
                $t->dateTime('closed_at')->nullable();
                $t->dateTime('last_reminder_sent_at')->nullable();
                $t->string('sla_status', 32)->nullable()->default('On Track');
                $t->boolean('is_internal')->default(false);
                $t->unsignedBigInteger('requested_by')->nullable();
                $t->timestamps();
            });
        }

        if (!\Illuminate\Support\Facades\Schema::hasTable('notifications')) {
            \Illuminate\Support\Facades\Schema::create('notifications', function ($t) {
                $t->bigIncrements('id');
                $t->unsignedBigInteger('recipient_id');
                $t->string('recipient_type');
                $t->string('title');
                $t->text('message');
                $t->unsignedBigInteger('ticket_id')->nullable();
                $t->text('data')->nullable();
                $t->boolean('is_read')->default(false);
                $t->timestamps();
            });
        }

        if (!\Illuminate\Support\Facades\Schema::hasTable('ticket_audit_logs')) {
            \Illuminate\Support\Facades\Schema::create('ticket_audit_logs', function ($t) {
                $t->bigIncrements('log_ID');
                $t->unsignedBigInteger('ticket_ID');
                $t->string('action_type');
                $t->unsignedBigInteger('action_by_ID')->nullable();
                $t->string('actor_type')->nullable();
                $t->text('details')->nullable();
                $t->timestamps();
            });
        }
    }

    public function test_send_reminder_successfully_updates_cooldown_and_creates_notification(): void
    {
        Cache::flush();

        // 1. Create client, CS employee, and assigned technician
        $clientId = DB::table('clients')->insertGetId([
            'client_name' => 'Memorial Medical Center',
            'email' => 'mmc_' . uniqid() . '@example.com',
            'address' => '5 Memorial Rd',
            'contact_number' => '0000000004',
            'status' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $csEmpId = DB::table('employees')->insertGetId([
            'first_name' => 'Remind',
            'last_name' => 'Dispatcher',
            'email' => 'cs_remind_' . uniqid() . '@example.com',
            'role' => 'customer service',
            'department' => 'Customer Service',
            'is_active' => 1,
            'password_hash' => 'hash',
        ]);

        $techEmpId = DB::table('employees')->insertGetId([
            'first_name' => 'Technician',
            'last_name' => 'Specialist',
            'email' => 'tech_' . uniqid() . '@example.com',
            'role' => 'service engineer',
            'department' => 'Biomedical Engineering',
            'is_active' => 1,
            'password_hash' => 'hash',
        ]);

        $machineId = DB::table('machines')->value('machine_ID') ?? $this->seedMachine(1);
        $problemCategoryId = DB::table('problem_categories')->value('problem_category_ID') ?? 1;

        // 2. Create active in-progress ticket assigned to techEmpId
        $ticketId = DB::table('tickets')->insertGetId([
            'ticket_number' => 'REM-TEST-001',
            'title' => 'Critical Infusion Pump Calibration Failure',
            'description' => 'Alarm sounding continuously.',
            'problem_category_ID' => $problemCategoryId,
            'machine_ID' => $machineId,
            'created_by' => $clientId,
            'assigned_to' => $techEmpId,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 2, // In Progress
            'priority_ID' => 2,
            'resolution_due_at' => now()->addHours(2),
            'sla_status' => 'At Risk',
            'created_at' => now()->subHours(4),
            'updated_at' => now(),
        ]);

        $csUser = Employee::where('emp_id', $csEmpId)->first();

        // 3. Dispatch reminder request with custom_message
        // Spec 0034: sender id and role come from the verified user, so no identity headers are sent.
        $response = $this->actingAs($csUser)
            ->postJson("/api/tickets/{$ticketId}/reminders", [
                'custom_message' => 'Please update client on calibration status.',
            ]);

        $response->assertStatus(200)
            ->assertJson([
                'status' => 'success',
                'data' => [
                    'ticket_id' => $ticketId,
                    'assigned_to' => $techEmpId,
                ],
            ]);

        // 4. Verify ticket record updated
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        $this->assertNotNull($ticket->last_reminder_sent_at);

        // 5. Verify notification inserted
        $notif = DB::table('notifications')
            ->where('recipient_id', $techEmpId)
            ->where('ticket_id', $ticketId)
            ->first();
        $this->assertNotNull($notif, 'In-app notification must be created for assigned technician');
        $this->assertStringContainsString('Action required on Ticket', $notif->title);
        $this->assertStringContainsString('Please update client on calibration status.', $notif->message);

        // 6. Verify audit log entry
        $audit = DB::table('ticket_audit_logs')
            ->where('ticket_ID', $ticketId)
            ->where('action_type', 'reminder_sent')
            ->first();
        $this->assertNotNull($audit, 'Audit log entry must be created');

        // 7. Verify cooldown: second immediate reminder triggers 429
        $secondResponse = $this->actingAs($csUser)
            ->postJson("/api/tickets/{$ticketId}/reminders", [
                'custom_message' => 'Another reminder',
            ]);

        $secondResponse->assertStatus(429)
            ->assertJsonStructure(['status', 'message', 'cooldown_remaining_minutes']);
    }

    public function test_customer_claiming_admin_role_by_header_or_body_gets_403(): void
    {
        $customer = new \Ticketing\Auth\Dto\AuthenticatedUserDto(['client_ID' => 9001, 'client_id' => 9001, 'id' => 9001, 'role' => 'customer']);

        $this->actingAs($customer)
            ->withHeaders(['X-User-Role' => 'admin', 'X-User-ID' => '1'])
            ->postJson('/api/tickets/1/reminders', ['user_role' => 'admin', 'emp_id' => 1, 'sender_id' => 1, 'user' => ['role' => 'admin']])
            ->assertStatus(403);
    }

    public function test_staff_header_role_does_not_override_verified_role(): void
    {
        $tech = new \Ticketing\Auth\Dto\AuthenticatedUserDto(['emp_id' => 55, 'role' => 'service engineer']);

        $this->actingAs($tech)
            ->withHeaders(['X-User-Role' => 'admin', 'X-User-ID' => '1'])
            ->postJson('/api/tickets/1/reminders', ['user_role' => 'admin'])
            ->assertStatus(403);
    }

    public function test_reminder_without_a_token_gets_401_and_has_no_default_sender(): void
    {
        $this->withHeaders(['X-User-Role' => 'admin', 'X-User-ID' => '1'])
            ->postJson('/api/tickets/1/reminders', ['emp_id' => 1])
            ->assertStatus(401);
    }

    public function test_cs_dashboard_summary_includes_real_sla_breached_count(): void
    {
        Cache::flush();

        $clientId = DB::table('clients')->insertGetId([
            'client_name' => 'Metro Health Center',
            'email' => 'metro_' . uniqid() . '@example.com',
            'address' => '6 Metro Health Rd',
            'contact_number' => '0000000005',
            'status' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $machineId = DB::table('machines')->value('machine_ID') ?? $this->seedMachine(1);
        $problemCategoryId = DB::table('problem_categories')->value('problem_category_ID') ?? 1;

        // Create an overdue ticket
        DB::table('tickets')->insert([
            'ticket_number' => 'BREACH-DASH-01',
            'title' => 'Overdue MRI Maintenance',
            'problem_category_ID' => $problemCategoryId,
            'machine_ID' => $machineId,
            'created_by' => $clientId,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 2, // In Progress
            'priority_ID' => 2,
            'resolution_due_at' => now()->subDay(), // Past due
            'sla_status' => 'Breached',
            'created_at' => now()->subDays(2),
            'updated_at' => now(),
        ]);

        // CS dashboard requires authentication, so call it as a seeded CS employee.
        $csDashEmpId = 99456;
        DB::table('employees')->where('emp_id', $csDashEmpId)->delete();
        DB::table('employees')->insert([
            'emp_id' => $csDashEmpId,
            'first_name' => 'Dash',
            'last_name' => 'Agent',
            'email' => 'dash.agent_' . uniqid() . '@example.com',
            'role' => 'customer service',
            'department' => 'Customer Service',
            'is_active' => 1,
            'password_hash' => 'secret',
        ]);
        $csDashUser = Employee::where('emp_id', $csDashEmpId)->first();

        $response = $this->actingAs($csDashUser, 'api')
            ->getJson('/api/cs-dashboard')
            ->assertOk();

        $data = $response->json();
        $this->assertArrayHasKey('summary', $data);
        $this->assertArrayHasKey('sla_breached', $data['summary']);
        $this->assertGreaterThanOrEqual(1, $data['summary']['sla_breached']);
        $this->assertArrayHasKey('recent_tickets', $data);
        $this->assertNotEmpty($data['recent_tickets']);
        $first = $data['recent_tickets'][0];
        $this->assertArrayHasKey('sla_status', $first);
        $this->assertArrayHasKey('is_breached', $first);
    }
}
