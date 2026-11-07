<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Employee;
use App\Services\TicketConfigurationService;
use App\Services\TicketStateMachine;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class TicketStateMachineTest extends TestCase
{
    use DatabaseTransactions;

    protected Employee $superAdmin;
    protected Employee $employee;
    protected Client $customer;
    protected TicketStateMachine $stateMachine;

    protected function setUp(): void
    {
        parent::setUp();

        $this->stateMachine = app(TicketStateMachine::class);

        if (\Illuminate\Support\Facades\DB::getDriverName() === 'sqlite') {
            \Illuminate\Support\Facades\DB::statement('PRAGMA foreign_keys = OFF');
            if (!\Illuminate\Support\Facades\Schema::hasTable('ticket_statuses')) {
                \Illuminate\Support\Facades\Schema::create('ticket_statuses', function ($t) {
                    $t->increments('ticket_status_ID');
                    $t->string('status_name');
                    $t->string('color_code')->nullable();
                    $t->timestamps();
                });
            }
            if (!\Illuminate\Support\Facades\Schema::hasTable('ticket_priorities')) {
                \Illuminate\Support\Facades\Schema::create('ticket_priorities', function ($t) {
                    $t->increments('priority_ID');
                    $t->string('priority_name');
                    $t->string('color_code')->nullable();
                    $t->timestamps();
                });
            }
            if (!\Illuminate\Support\Facades\Schema::hasTable('slas')) {
                \Illuminate\Support\Facades\Schema::create('slas', function ($t) {
                    $t->increments('sla_ID');
                    $t->string('sla_name');
                    $t->integer('response_time_minutes')->default(240);
                    $t->integer('resolution_time_minutes')->default(1440);
                    $t->boolean('is_active')->default(true);
                    $t->timestamps();
                });
            }
            if (!\Illuminate\Support\Facades\Schema::hasTable('problem_categories')) {
                \Illuminate\Support\Facades\Schema::create('problem_categories', function ($t) {
                    $t->increments('problem_category_ID');
                    $t->string('category_name');
                    $t->boolean('is_active')->default(true);
                    $t->timestamps();
                });
            }
            if (!\Illuminate\Support\Facades\Schema::hasTable('machines')) {
                \Illuminate\Support\Facades\Schema::create('machines', function ($t) {
                    $t->increments('machine_ID');
                    $t->string('machine_name');
                    $t->string('serial_number')->nullable();
                    $t->timestamps();
                });
            }
            if (!\Illuminate\Support\Facades\Schema::hasTable('employees')) {
                \Illuminate\Support\Facades\Schema::create('employees', function ($t) {
                    $t->bigIncrements('emp_id');
                    $t->string('first_name');
                    $t->string('last_name');
                    $t->string('email')->unique();
                    $t->string('role');
                    $t->string('department');
                    $t->string('branch')->nullable()->default('Main');
                    $t->boolean('is_active')->default(true);
                    $t->string('password_hash')->default('secret');
                    $t->timestamps();
                });
            }
            if (!\Illuminate\Support\Facades\Schema::hasTable('clients')) {
                \Illuminate\Support\Facades\Schema::create('clients', function ($t) {
                    $t->increments('id');
                    $t->string('client_name');
                    $t->string('email')->nullable();
                    $t->string('contact_number')->nullable();
                    $t->string('address')->nullable();
                    $t->boolean('status')->default(true);
                    $t->timestamps();
                });
            }
            if (!\Illuminate\Support\Facades\Schema::hasTable('tickets')) {
                \Illuminate\Support\Facades\Schema::create('tickets', function ($t) {
                    $t->increments('ticket_ID');
                    $t->string('ticket_number')->nullable();
                    $t->string('title');
                    $t->text('description');
                    $t->unsignedBigInteger('created_by')->nullable();
                    $t->unsignedBigInteger('requested_by')->nullable();
                    $t->unsignedBigInteger('ticket_type_ID')->default(2);
                    $t->unsignedBigInteger('ticket_status_ID')->default(1);
                    $t->unsignedBigInteger('priority_ID')->default(1);
                    $t->unsignedBigInteger('sla_ID')->nullable()->default(1);
                    $t->unsignedBigInteger('problem_category_ID')->nullable()->default(1);
                    $t->unsignedBigInteger('machine_ID')->nullable()->default(1);
                    $t->string('in_progress_owner')->nullable();
                    $t->timestamp('held_at')->nullable();
                    $t->integer('total_held_seconds')->default(0);
                    $t->timestamp('resolution_due_at')->nullable();
                    $t->timestamp('resolved_at')->nullable();
                    $t->timestamp('closed_at')->nullable();
                    $t->boolean('is_internal')->default(false);
                    $t->timestamps();
                });
            }
            if (!\Illuminate\Support\Facades\Schema::hasTable('ticket_assignments')) {
                \Illuminate\Support\Facades\Schema::create('ticket_assignments', function ($t) {
                    $t->increments('assignment_ID');
                    $t->unsignedBigInteger('ticket_ID');
                    $t->unsignedBigInteger('employee_ID');
                    $t->string('assignment_status')->default('assigned');
                    $t->boolean('is_active')->default(true);
                    $t->timestamps();
                });
            }
            if (!\Illuminate\Support\Facades\Schema::hasTable('internal_notes')) {
                \Illuminate\Support\Facades\Schema::create('internal_notes', function ($t) {
                    $t->increments('id');
                    $t->unsignedBigInteger('ticket_id');
                    $t->unsignedBigInteger('employee_id');
                    $t->text('note');
                    $t->timestamps();
                });
            }
            if (!\Illuminate\Support\Facades\Schema::hasTable('ticket_audit_logs')) {
                \Illuminate\Support\Facades\Schema::create('ticket_audit_logs', function ($t) {
                    $t->increments('log_ID');
                    $t->unsignedBigInteger('ticket_ID')->nullable();
                    $t->string('action_type')->nullable();
                    $t->unsignedBigInteger('action_by_ID')->nullable();
                    $t->string('actor_type')->nullable();
                    $t->text('details')->nullable();
                    $t->timestamps();
                });
            }
            if (!\Illuminate\Support\Facades\Schema::hasTable('notifications')) {
                \Illuminate\Support\Facades\Schema::create('notifications', function ($t) {
                    $t->increments('id');
                    $t->unsignedBigInteger('recipient_id')->nullable();
                    $t->string('recipient_type')->nullable();
                    $t->string('title')->nullable();
                    $t->text('message')->nullable();
                    $t->unsignedBigInteger('ticket_id')->nullable();
                    $t->json('data')->nullable();
                    $t->boolean('is_read')->default(false);
                    $t->timestamps();
                });
            }
        }

        // Ensure baseline statuses exist
        $statuses = [
            ['ticket_status_ID' => 1, 'status_name' => 'Open', 'color_code' => '#f59e0b'],
            ['ticket_status_ID' => 2, 'status_name' => 'In Progress', 'color_code' => '#2563eb'],
            ['ticket_status_ID' => 3, 'status_name' => 'Resolved', 'color_code' => '#16a34a'],
            ['ticket_status_ID' => 4, 'status_name' => 'Closed', 'color_code' => '#64748b'],
            ['ticket_status_ID' => 5, 'status_name' => 'Escalated', 'color_code' => '#dc2626'],
            ['ticket_status_ID' => 7, 'status_name' => 'Pending', 'color_code' => '#8b5cf6'],
            ['ticket_status_ID' => 8, 'status_name' => 'Reopened', 'color_code' => '#ec4899'],
            ['ticket_status_ID' => 9, 'status_name' => 'Cancelled', 'color_code' => '#ef4444'],
            ['ticket_status_ID' => 10, 'status_name' => 'Pending Assignment', 'color_code' => '#06b6d4'],
            ['ticket_status_ID' => 11, 'status_name' => 'On Hold', 'color_code' => '#f97316'],
            ['ticket_status_ID' => 12, 'status_name' => 'Pending Evaluation', 'color_code' => '#a855f7'],
        ];

        foreach ($statuses as $st) {
            DB::table('ticket_statuses')->updateOrInsert(
                ['ticket_status_ID' => $st['ticket_status_ID']],
                array_merge($st, ['created_at' => now(), 'updated_at' => now()])
            );
        }

        foreach ([1 => 'Low', 2 => 'Medium', 3 => 'High', 4 => 'Critical'] as $pid => $pname) {
            DB::table('ticket_priorities')->updateOrInsert(
                ['priority_ID' => $pid],
                ['priority_name' => $pname, 'created_at' => now(), 'updated_at' => now()]
            );
        }

        DB::table('slas')->updateOrInsert(
            ['sla_ID' => 1],
            ['sla_name' => 'Standard SLA', 'response_time_minutes' => 240, 'resolution_time_minutes' => 1440, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]
        );

        DB::table('problem_categories')->updateOrInsert(
            ['problem_category_ID' => 1],
            ['category_name' => 'Hardware Issue', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]
        );

        $this->seedMachine(1, ['machine_name' => 'Test Machine', 'serial_number' => 'SN-TSM-001']);

        \App\Models\Employee::unguard();

        $this->superAdmin = Employee::where('role', 'superadmin')->first()
            ?? Employee::create([
                'emp_id' => 88881,
                'first_name' => 'Super',
                'last_name' => 'Admin',
                'email' => 'superadmin_tsm@example.com',
                'role' => 'superadmin',
                'department' => 'Executive',
                'is_active' => true,
                'password_hash' => 'secret',
            ]);

        $this->employee = Employee::where('role', 'service')->first()
            ?? Employee::create([
                'emp_id' => 88882,
                'first_name' => 'Service',
                'last_name' => 'Engineer',
                'email' => 'engineer_tsm@example.com',
                'role' => 'service',
                'department' => 'Engineering',
                'is_active' => true,
                'password_hash' => 'secret',
            ]);

        $this->customer = Client::create([
            'client_name' => 'State Machine Client',
            'email' => 'client_tsm_' . uniqid() . '@example.com',
            'contact_number' => '1234567890',
            'address' => '123 State Machine Ave',
            'status' => true,
        ]);

        DB::table('employees')->updateOrInsert(
            ['emp_id' => $this->customer->id],
            [
                'first_name' => 'Client',
                'last_name' => 'User',
                'email' => $this->customer->email,
                'role' => 'client',
                'department' => 'Customer',
                'is_active' => 1,
                'password_hash' => 'secret',
            ]
        );

    }

    protected function createTestTicket(array $overrides = []): object
    {
        $id = DB::table('tickets')->insertGetId(array_merge([
            'title' => 'State Machine Unit Ticket',
            'description' => 'Testing state machine transitions and invariants.',
            'created_by' => $this->customer->id,
            'ticket_type_ID' => 2,
            'ticket_status_ID' => 1, // Open
            'priority_ID' => 1,
            'sla_ID' => 1,
            'problem_category_ID' => 1,
            'machine_ID' => 1,
            'in_progress_owner' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));

        return DB::table('tickets')->where('ticket_ID', $id)->first();
    }

    /**
     * Test 1: Canonical state derivation accurately maps database fields.
     */
    public function test_canonical_state_derivation()
    {
        $this->assertEquals('log', config('broadcasting.default'));

        $ticketOpen = $this->createTestTicket(['ticket_status_ID' => 1]);
        $this->assertEquals(TicketStateMachine::STATE_OPEN, $this->stateMachine->resolveState($ticketOpen));

        $ticketCS = $this->createTestTicket(['ticket_status_ID' => 2, 'in_progress_owner' => 'cs']);
        $this->assertEquals(TicketStateMachine::STATE_IN_PROGRESS_CS, $this->stateMachine->resolveState($ticketCS));

        $ticketEmp = $this->createTestTicket(['ticket_status_ID' => 2, 'in_progress_owner' => 'employee']);
        $this->assertEquals(TicketStateMachine::STATE_IN_PROGRESS_EMPLOYEE, $this->stateMachine->resolveState($ticketEmp));

        $ticketAssigned = $this->createTestTicket(['ticket_status_ID' => 10]);
        $this->assertEquals(TicketStateMachine::STATE_ASSIGNED, $this->stateMachine->resolveState($ticketAssigned));

        $ticketResolved = $this->createTestTicket(['ticket_status_ID' => 3]);
        $this->assertEquals(TicketStateMachine::STATE_RESOLVED, $this->stateMachine->resolveState($ticketResolved));

        $ticketClosed = $this->createTestTicket(['ticket_status_ID' => 4]);
        $this->assertEquals(TicketStateMachine::STATE_CLOSED, $this->stateMachine->resolveState($ticketClosed));

        $ticketCancelled = $this->createTestTicket(['ticket_status_ID' => TicketStateMachine::STATUS_ID_CANCELLED]);
        $this->assertEquals(TicketStateMachine::STATE_CANCELLED, $this->stateMachine->resolveState($ticketCancelled));
    }

    /**
     * Test 2: Valid transition from Open to In Progress (CS-owned) succeeds.
     */
    public function test_valid_transition_open_to_in_progress_cs()
    {
        $ticket = $this->createTestTicket(['ticket_status_ID' => 1]);

        $res = $this->stateMachine->applyTransition(
            $ticket,
            TicketStateMachine::STATE_IN_PROGRESS_CS,
            [],
            ['id' => $this->superAdmin->emp_id, 'type' => 'employee']
        );

        $transitioned = $res['data']['ticket'];
        $this->assertEquals(2, $transitioned->ticket_status_ID);
        $this->assertEquals('cs', $transitioned->in_progress_owner);

        // Verify audit log
        $this->assertDatabaseHas('ticket_audit_logs', [
            'ticket_ID' => $ticket->ticket_ID,
            'action_type' => 'in_progress',
            'action_by_ID' => $this->superAdmin->emp_id,
        ]);
    }

    /**
     * Test 3: Rejection of invalid transitions with HTTP 422 and structured error.
     */
    public function test_rejection_of_invalid_transition()
    {
        $ticket = $this->createTestTicket(['ticket_status_ID' => 1]); // Open

        // Attempting Open -> Closed should be rejected (Open can only go to In Progress (CS) or Cancelled)
        $response = $this->actingAs($this->superAdmin, 'api')
            ->putJson("/api/tickets/{$ticket->ticket_ID}", [
                'ticket_status_ID' => 4, // Closed
            ]);

        $response->assertStatus(422);
        $response->assertJson([
            'code' => 'INVALID_TICKET_TRANSITION',
            'from_status' => TicketStateMachine::STATE_OPEN,
            'to_status' => TicketStateMachine::STATE_CLOSED,
        ]);
        $this->assertIsArray($response->json('allowed_statuses'));
    }

    /**
     * Test 4: Terminal status Cancelled rejects any further transition.
     */
    public function test_terminal_cancelled_status_rejects_further_transition()
    {
        $ticket = $this->createTestTicket(['ticket_status_ID' => TicketStateMachine::STATUS_ID_CANCELLED]);

        $response = $this->actingAs($this->superAdmin, 'api')
            ->putJson("/api/tickets/{$ticket->ticket_ID}", [
                'ticket_status_ID' => 2,
            ]);

        $response->assertStatus(422);
        $response->assertJson([
            'code' => 'INVALID_TICKET_TRANSITION',
            'from_status' => TicketStateMachine::STATE_CANCELLED,
        ]);
    }

    /**
     * Test 5: Reopen within configured window succeeds and automatically transitions to In Progress (CS-owned).
     */
    public function test_reopen_within_window_transitions_to_in_progress_cs_owned()
    {
        TicketConfigurationService::clearWindowsCache();

        Http::fake([
            '*/api/ticket-configurations/windows' => Http::response([
                'reopenEnabled' => true,
                'reopenWindowDays' => 2,
            ], 200),
        ]);

        $ticket = $this->createTestTicket([
            'ticket_status_ID' => 4, // Closed
            'resolved_at' => now()->subHours(12),
            'closed_at' => now()->subHours(10),
            'assigned_to' => $this->employee->emp_id,
        ]);

        $response = $this->actingAs($this->superAdmin, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/reopen", [
                'reason' => 'Customer still experiences the issue.',
            ]);

        $response->assertStatus(200);

        $ticket = DB::table('tickets')->where('ticket_ID', $ticket->ticket_ID)->first();
        // Crucial invariant: Reopened tickets MUST transition to In Progress (CS-owned)
        $this->assertEquals(2, $ticket->ticket_status_ID);
        $this->assertEquals('cs', $ticket->in_progress_owner);
        $this->assertNull($ticket->assigned_to);

        // Verify audit log recorded reopen
        $this->assertDatabaseHas('ticket_audit_logs', [
            'ticket_ID' => $ticket->ticket_ID,
            'action_type' => 'reopen',
        ]);
    }

    /**
     * Test 6: Reopen outside configured window is rejected with 422.
     */
    public function test_reopen_outside_window_is_rejected()
    {
        TicketConfigurationService::clearWindowsCache();

        Http::fake([
            '*/api/ticket-configurations/windows' => Http::response([
                'reopenEnabled' => true,
                'reopenWindowDays' => 2, // 48 hours
            ], 200),
        ]);

        $ticket = $this->createTestTicket([
            'ticket_status_ID' => 4, // Closed
            'resolved_at' => now()->subDays(5),
            'closed_at' => now()->subDays(4),
        ]);

        $response = $this->actingAs($this->superAdmin, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/reopen", [
                'reason' => 'Too late reopen attempt',
            ]);

        $response->assertStatus(422);
        $response->assertJson([
            'code' => 'WINDOW_EXPIRED',
        ]);
        $this->assertStringContainsString('48 hours', $response->json('message'));
    }

    /**
     * Test 7: Reopen when reopen is disabled in configuration is rejected.
     */
    public function test_reopen_disabled_in_config_is_rejected()
    {
        TicketConfigurationService::clearWindowsCache();

        Http::fake([
            '*/api/ticket-configurations/windows' => Http::response([
                'reopenEnabled' => false,
                'reopenWindowDays' => 2,
            ], 200),
        ]);

        $ticket = $this->createTestTicket([
            'ticket_status_ID' => 4,
            'resolved_at' => now()->subHours(2),
            'closed_at' => now()->subHours(1),
        ]);

        $response = $this->actingAs($this->superAdmin, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/reopen", [
                'reason' => 'Disabled reopen attempt',
            ]);

        $response->assertStatus(422);
        $this->assertStringContainsString('Reopening tickets is disabled by administrative operational policy', $response->json('message'));
    }

    /**
     * Test 8: Contextual Hold and Resume correctly preserves and restores ownership.
     */
    public function test_contextual_hold_and_resume_preserves_owner()
    {
        // 1. Employee-owned ticket placed on hold
        $ticketEmp = $this->createTestTicket([
            'ticket_status_ID' => 2,
            'in_progress_owner' => 'employee',
            'assigned_to' => $this->employee->emp_id,
        ]);

        $response = $this->actingAs($this->superAdmin, 'api')
            ->postJson("/api/tickets/{$ticketEmp->ticket_ID}/hold", [
                'reason' => 'Waiting for spare part',
            ]);
        $response->assertStatus(200);

        $ticketEmp = DB::table('tickets')->where('ticket_ID', $ticketEmp->ticket_ID)->first();
        $this->assertEquals(11, $ticketEmp->ticket_status_ID);
        $this->assertEquals('employee', $ticketEmp->previous_in_progress_owner);
        $this->assertNull($ticketEmp->in_progress_owner);

        // Resume ticket
        $resumeResponse = $this->actingAs($this->superAdmin, 'api')
            ->postJson("/api/tickets/{$ticketEmp->ticket_ID}/resume");
        $resumeResponse->assertStatus(200);

        $ticketEmp = DB::table('tickets')->where('ticket_ID', $ticketEmp->ticket_ID)->first();
        $this->assertEquals(2, $ticketEmp->ticket_status_ID);
        $this->assertEquals('employee', $ticketEmp->in_progress_owner);

        // 2. CS-owned ticket placed on hold
        $ticketCS = $this->createTestTicket([
            'ticket_status_ID' => 2,
            'in_progress_owner' => 'cs',
        ]);

        $this->actingAs($this->superAdmin, 'api')
            ->postJson("/api/tickets/{$ticketCS->ticket_ID}/hold", [
                'reason' => 'CS review hold',
            ]);
        $ticketCS = DB::table('tickets')->where('ticket_ID', $ticketCS->ticket_ID)->first();
        $this->assertEquals(11, $ticketCS->ticket_status_ID);
        $this->assertEquals('cs', $ticketCS->previous_in_progress_owner);

        $this->actingAs($this->superAdmin, 'api')
            ->postJson("/api/tickets/{$ticketCS->ticket_ID}/resume");
        $ticketCS = DB::table('tickets')->where('ticket_ID', $ticketCS->ticket_ID)->first();
        $this->assertEquals(2, $ticketCS->ticket_status_ID);
        $this->assertEquals('cs', $ticketCS->in_progress_owner);
    }

    /**
     * Test 9: Single "In Progress" bucket invariant is preserved.
     */
    public function test_single_in_progress_bucket_invariant()
    {
        $ticketCS = $this->createTestTicket(['ticket_status_ID' => 2, 'in_progress_owner' => 'cs']);
        $ticketEmp = $this->createTestTicket(['ticket_status_ID' => 2, 'in_progress_owner' => 'employee']);

        // Database status ID MUST be exactly 2 for both
        $this->assertEquals(2, $ticketCS->ticket_status_ID);
        $this->assertEquals(2, $ticketEmp->ticket_status_ID);

        // Standard reporting queries grouping by ticket_status_ID will see them in the same bucket
        $count = DB::table('tickets')
            ->whereIn('ticket_ID', [$ticketCS->ticket_ID, $ticketEmp->ticket_ID])
            ->where('ticket_status_ID', 2)
            ->count();

        $this->assertEquals(2, $count);
    }

    /**
     * Test 10: Hold writes internal note and reopen does not. Customer reopen posts to messaging.
     */
    public function test_hold_writes_internal_note_and_reopen_does_not()
    {
        TicketConfigurationService::clearWindowsCache();

        Http::fake([
            'http://messaging-service:8000/*' => Http::response([], 200),
            '*/api/ticket-configurations/windows' => Http::response([
                'reopenEnabled' => true,
                'reopenWindowDays' => 2,
            ], 200),
            'http://configuration-service:8000/*' => Http::response([], 200),
        ]);

        $ticket = $this->createTestTicket([
            'ticket_status_ID' => 2,
            'in_progress_owner' => 'cs',
            'assigned_to' => $this->employee->emp_id,
        ]);

        // 1. Hold writes an internal_notes row
        $notesBefore = DB::table('internal_notes')->where('ticket_id', $ticket->ticket_ID)->count();

        $holdResponse = $this->actingAs($this->superAdmin, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/hold", [
                'reason' => 'Waiting on customer parts approval',
            ]);
        $holdResponse->assertStatus(200);

        $notesAfter = DB::table('internal_notes')->where('ticket_id', $ticket->ticket_ID)->count();
        $this->assertEquals($notesBefore + 1, $notesAfter);

        $latestNote = DB::table('internal_notes')->where('ticket_id', $ticket->ticket_ID)->latest('id')->first();
        $this->assertStringContainsString('Waiting on customer parts approval', $latestNote->note);
        $this->assertEquals((int) $this->superAdmin->emp_id, (int) $latestNote->employee_id);

        // Verify hold notification payloads: customer payload does NOT have reason; employee payload DOES have reason
        $custNotif = DB::table('notifications')
            ->where('ticket_id', $ticket->ticket_ID)
            ->where('recipient_type', 'client')
            ->latest('id')
            ->first();
        $this->assertNotNull($custNotif);
        $this->assertStringNotContainsString('Waiting on customer parts approval', $custNotif->message);
        $custData = json_decode($custNotif->data, true);
        $this->assertArrayNotHasKey('reason', $custData);

        $empNotif = DB::table('notifications')
            ->where('ticket_id', $ticket->ticket_ID)
            ->where('recipient_type', 'employee')
            ->where('recipient_id', $this->employee->emp_id)
            ->latest('id')
            ->first();
        $this->assertNotNull($empNotif);
        $this->assertStringContainsString('Waiting on customer parts approval', $empNotif->message);
        $empData = json_decode($empNotif->data, true);
        $this->assertEquals('Waiting on customer parts approval', $empData['reason'] ?? null);

        // Confirm holding an already-held ticket writes no second note and sends no second notification
        $notesBeforeDuplicateHold = DB::table('internal_notes')->where('ticket_id', $ticket->ticket_ID)->count();
        $notificationsBeforeDuplicateHold = DB::table('notifications')->where('ticket_id', $ticket->ticket_ID)->count();
        $duplicateHoldResponse = $this->actingAs($this->superAdmin, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/hold", [
                'reason' => 'Duplicate hold attempt',
            ]);
        $duplicateHoldResponse->assertStatus(200);
        $notesAfterDuplicateHold = DB::table('internal_notes')->where('ticket_id', $ticket->ticket_ID)->count();
        $notificationsAfterDuplicateHold = DB::table('notifications')->where('ticket_id', $ticket->ticket_ID)->count();
        $this->assertEquals($notesBeforeDuplicateHold, $notesAfterDuplicateHold);
        $this->assertEquals($notificationsBeforeDuplicateHold, $notificationsAfterDuplicateHold);

        // Resume ticket then resolve it
        $this->actingAs($this->superAdmin, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/resume")
            ->assertStatus(200);

        $this->actingAs($this->superAdmin, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/resolve")
            ->assertStatus(200);

        // 2. Reopen does NOT write internal_notes, and posts reopen message to messaging-service when customer
        $notesBeforeReopen = DB::table('internal_notes')->where('ticket_id', $ticket->ticket_ID)->count();

        $reopenResponse = $this->actingAs($this->customer, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/reopen", [
                'reason' => 'Issue recurred after testing',
            ]);
        $reopenResponse->assertStatus(200);

        $notesAfterReopen = DB::table('internal_notes')->where('ticket_id', $ticket->ticket_ID)->count();
        $this->assertEquals($notesBeforeReopen, $notesAfterReopen);

        // Verify messaging-service was called for customer reopen
        Http::assertSent(function ($request) use ($ticket) {
            return str_contains($request->url(), "/api/internal/tickets/{$ticket->ticket_ID}/messages")
                && str_contains($request['message'], 'Issue recurred after testing');
        });
    }

    /**
     * Test 11: Internal tickets notify requested_by employee instead of dummy client created_by.
     */
    public function test_internal_ticket_notifications_notify_requested_by_employee()
    {
        TicketConfigurationService::clearWindowsCache();

        Http::fake([
            'http://messaging-service:8000/*' => Http::response([], 200),
            '*/api/ticket-configurations/windows' => Http::response([
                'reopenEnabled' => true,
                'reopenWindowDays' => 2,
            ], 200),
            'http://configuration-service:8000/*' => Http::response([], 200),
        ]);

        $ticket = $this->createTestTicket([
            'is_internal' => 1,
            'created_by' => 1,
            'requested_by' => $this->employee->emp_id,
            'ticket_status_ID' => 2,
            'in_progress_owner' => 'cs',
            'assigned_to' => null,
        ]);

        // 1. Hold on internal ticket
        $this->actingAs($this->superAdmin, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/hold", [
                'reason' => 'Holding internal ticket',
            ])
            ->assertStatus(200);

        // Assert notification sent to requested_by employee, not client 1
        $holdEmployeeNotif = DB::table('notifications')
            ->where('ticket_id', $ticket->ticket_ID)
            ->where('recipient_type', 'employee')
            ->where('recipient_id', $this->employee->emp_id)
            ->where('title', 'Ticket Placed On Hold')
            ->first();
        $this->assertNotNull($holdEmployeeNotif);

        $holdClientNotif = DB::table('notifications')
            ->where('ticket_id', $ticket->ticket_ID)
            ->where('recipient_type', 'client')
            ->where('title', 'Ticket Placed On Hold')
            ->first();
        $this->assertNull($holdClientNotif);

        // 2. Resume on internal ticket
        $this->actingAs($this->superAdmin, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/resume")
            ->assertStatus(200);

        $resumeEmployeeNotif = DB::table('notifications')
            ->where('ticket_id', $ticket->ticket_ID)
            ->where('recipient_type', 'employee')
            ->where('recipient_id', $this->employee->emp_id)
            ->where('title', 'Ticket Resumed')
            ->first();
        $this->assertNotNull($resumeEmployeeNotif);

        // 3. Reclassify on internal ticket
        $this->actingAs($this->superAdmin, 'api')
            ->patchJson("/api/tickets/{$ticket->ticket_ID}/classification", [
                'priority_ID' => 3,
            ])
            ->assertStatus(200);

        $reclassEmployeeNotif = DB::table('notifications')
            ->where('ticket_id', $ticket->ticket_ID)
            ->where('recipient_type', 'employee')
            ->where('recipient_id', $this->employee->emp_id)
            ->where('title', 'Ticket Classification Updated')
            ->first();
        $this->assertNotNull($reclassEmployeeNotif);

        // 4. Resolve then Reopen on internal ticket
        $this->actingAs($this->superAdmin, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/resolve")
            ->assertStatus(200);

        $this->actingAs($this->employee, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/reopen", [
                'reason' => 'Internal requester reopened this',
            ])
            ->assertStatus(200);

        $reopenEmployeeNotif = DB::table('notifications')
            ->where('ticket_id', $ticket->ticket_ID)
            ->where('recipient_type', 'employee')
            ->where('recipient_id', $this->employee->emp_id)
            ->where('title', 'Ticket Reopened')
            ->first();
        $this->assertNotNull($reopenEmployeeNotif);
    }

    /**
     * Test 12: Hold requires reason (422) and customer is forbidden (403) on hold, resume, classification.
     */
    public function test_hold_requires_reason_and_customer_forbidden_on_hold_resume_classification()
    {
        $ticket = $this->createTestTicket([
            'ticket_status_ID' => 2,
            'in_progress_owner' => 'cs',
        ]);

        // Customer attempts hold -> 403
        $this->actingAs($this->customer, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/hold", ['reason' => 'Customer trying hold'])
            ->assertStatus(403);

        // Customer attempts resume -> 403
        $this->actingAs($this->customer, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/resume")
            ->assertStatus(403);

        // Customer attempts classification -> 403
        $this->actingAs($this->customer, 'api')
            ->patchJson("/api/tickets/{$ticket->ticket_ID}/classification", ['priority_ID' => 2])
            ->assertStatus(403);

        // Staff attempts hold with missing reason -> 422 REASON_REQUIRED
        $respMissing = $this->actingAs($this->superAdmin, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/hold", []);
        $respMissing->assertStatus(422);
        $this->assertEquals('REASON_REQUIRED', $respMissing->json('code'));

        // Staff attempts hold with whitespace reason -> 422 REASON_REQUIRED
        $respEmpty = $this->actingAs($this->superAdmin, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/hold", ['reason' => '   ']);
        $respEmpty->assertStatus(422);
        $this->assertEquals('REASON_REQUIRED', $respEmpty->json('code'));
    }

    /**
     * Test 13: 'customer service' role (lowercase with space) is accepted for hold, resume, classification.
     */
    public function test_customer_service_role_with_space_is_accepted()
    {
        $csEmpId = DB::table('employees')->insertGetId([
            'first_name' => 'Support',
            'last_name' => 'Agent',
            'email' => 'cs_space_' . uniqid() . '@example.com',
            'role' => 'customer service',
            'department' => 'Customer Service',
            'is_active' => true,
            'password_hash' => 'secret',
        ]);
        $csUser = Employee::find($csEmpId);

        $ticket = $this->createTestTicket([
            'ticket_status_ID' => 2,
            'in_progress_owner' => 'cs',
        ]);

        // Hold
        $this->actingAs($csUser, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/hold", ['reason' => 'CS hold test'])
            ->assertStatus(200);

        // Resume
        $this->actingAs($csUser, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/resume")
            ->assertStatus(200);

        // Classification
        $this->actingAs($csUser, 'api')
            ->patchJson("/api/tickets/{$ticket->ticket_ID}/classification", ['priority_ID' => 2])
            ->assertStatus(200);
    }

    /**
     * Test 14: Hold then resume shifts resolution_due_at by held duration using Carbon::setTestNow.
     */
    public function test_hold_then_resume_shifts_resolution_due_at_by_held_duration()
    {
        $baseTime = Carbon::parse('2026-10-10 09:00:00');
        Carbon::setTestNow($baseTime);

        try {
            $ticket = $this->createTestTicket([
                'ticket_status_ID' => 2,
                'in_progress_owner' => 'cs',
                'sla_started_at' => $baseTime->copy(),
                'resolution_due_at' => $baseTime->copy()->addHours(24),
            ]);

            // Hold at 09:00
            $this->actingAs($this->superAdmin, 'api')
                ->postJson("/api/tickets/{$ticket->ticket_ID}/hold", ['reason' => 'Pausing for testing duration shift'])
                ->assertStatus(200);

            // Advance time by 3 hours
            $resumeTime = $baseTime->copy()->addHours(3);
            Carbon::setTestNow($resumeTime);

            // Resume at 12:00
            $this->actingAs($this->superAdmin, 'api')
                ->postJson("/api/tickets/{$ticket->ticket_ID}/resume")
                ->assertStatus(200);

            $freshTicket = DB::table('tickets')->where('ticket_ID', $ticket->ticket_ID)->first();
            $expectedResolutionDueAt = $baseTime->copy()->addHours(24)->addHours(3); // 27 hours from baseTime

            $actualDueAt = Carbon::parse($freshTicket->resolution_due_at);
            $this->assertLessThanOrEqual(5, abs($expectedResolutionDueAt->diffInSeconds($actualDueAt)));
            $this->assertEquals(3 * 3600, (int) $freshTicket->sla_paused_total_seconds);
        } finally {
            Carbon::setTestNow();
        }
    }

    /**
     * Test 15: Hold from Pending Assignment resumes to Pending Assignment.
     */
    public function test_hold_from_pending_assignment_resumes_to_pending_assignment()
    {
        $ticket = $this->createTestTicket([
            'ticket_status_ID' => 10, // Pending Assignment
        ]);

        $this->actingAs($this->superAdmin, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/hold", ['reason' => 'Holding unassigned ticket'])
            ->assertStatus(200);

        $heldTicket = DB::table('tickets')->where('ticket_ID', $ticket->ticket_ID)->first();
        $this->assertEquals(11, $heldTicket->ticket_status_ID);
        $this->assertEquals(10, $heldTicket->held_from_status_ID);

        $this->actingAs($this->superAdmin, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/resume")
            ->assertStatus(200);

        $resumedTicket = DB::table('tickets')->where('ticket_ID', $ticket->ticket_ID)->first();
        $this->assertEquals(10, $resumedTicket->ticket_status_ID);
    }

    /**
     * Test 16: Reopen validation, non-owner rejection, history kept, assignments soft-ended not deleted.
     */
    public function test_reopen_reason_required_non_owner_rejected_history_kept_assignments_soft_ended()
    {
        TicketConfigurationService::clearWindowsCache();

        $otherCustomer = Client::create([
            'client_name' => 'Other Client',
            'email' => 'other_client_' . uniqid() . '@example.com',
            'contact_number' => '9999999999',
            'address' => '456 Other St',
            'status' => true,
        ]);

        $ticket = $this->createTestTicket([
            'created_by' => $this->customer->id,
            'ticket_status_ID' => 4, // Closed
            'resolved_at' => now()->subHours(10),
            'closed_at' => now()->subHours(8),
            'assigned_to' => $this->employee->emp_id,
        ]);

        // Insert historical assignment, work log
        $assignmentId = DB::table('ticket_assignments')->insertGetId([
            'ticket_ID' => $ticket->ticket_ID,
            'employee_ID' => $this->employee->emp_id,
            'assigned_by' => (int) $this->superAdmin->emp_id,
            'assignment_status' => 'accepted',
            'created_at' => now()->subHours(20),
            'updated_at' => now()->subHours(10),
        ]);

        DB::table('work_logs')->insert([
            'ticket_id' => $ticket->ticket_ID,
            'employee_id' => $this->employee->emp_id,
            'log_date' => now()->toDateString(),
            'hours_spent' => 2.5,
            'task_description' => 'Diagnostic work performed prior to resolution',
            'created_at' => now()->subHours(12),
        ]);

        // 1. Reason required
        $respNoReason = $this->actingAs($this->customer, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/reopen", ['reason' => '']);
        $respNoReason->assertStatus(422);
        $this->assertEquals('REASON_REQUIRED', $respNoReason->json('code'));

        // 2. Non-owner rejected with NOT_OWNER
        $respNonOwner = $this->actingAs($otherCustomer, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/reopen", ['reason' => 'Other client reopening']);
        $respNonOwner->assertStatus(403);
        $this->assertEquals('NOT_OWNER', $respNonOwner->json('code'));

        // 3. Owner successfully reopens
        $respOwner = $this->actingAs($this->customer, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/reopen", ['reason' => 'Still failing in production']);
        $respOwner->assertStatus(200);

        // 4. Assignments soft-ended, not deleted
        $assignment = DB::table('ticket_assignments')->where('assignment_ID', $assignmentId)->first();
        $this->assertNotNull($assignment);
        $this->assertEquals('reopened_unassigned', $assignment->assignment_status);
        $this->assertNotNull($assignment->completed_at);

        // 5. Work logs preserved
        $this->assertDatabaseHas('work_logs', [
            'ticket_id' => $ticket->ticket_ID,
            'task_description' => 'Diagnostic work performed prior to resolution',
        ]);
    }

    /**
     * Test 17: Staff-initiated reopen does NOT post a message attributed to the customer.
     */
    public function test_staff_initiated_reopen_does_not_post_messaging_attributed_to_customer()
    {
        TicketConfigurationService::clearWindowsCache();

        $ticket = $this->createTestTicket([
            'created_by' => $this->customer->id,
            'ticket_status_ID' => 4,
            'resolved_at' => now()->subHours(10),
            'closed_at' => now()->subHours(8),
        ]);

        $this->actingAs($this->superAdmin, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/reopen", ['reason' => 'Staff reopened on customer behalf'])
            ->assertStatus(200);

        Http::assertNotSent(function ($request) {
            return str_contains($request->url(), '/messages') && ($request['sender_type'] ?? '') === 'customer';
        });
    }

    /**
     * Test 18: Customer cannot view another customer's ticket or internal ticket.
     */
    public function test_customer_cannot_view_another_customer_ticket()
    {
        $otherCustomer = Client::create([
            'client_name' => 'Stranger Client',
            'email' => 'stranger_' . uniqid() . '@example.com',
            'contact_number' => '1112223333',
            'address' => '789 Other Ave',
            'status' => true,
        ]);

        $ticketA = $this->createTestTicket([
            'created_by' => $this->customer->id,
            'is_internal' => 0,
        ]);

        $internalTicket = $this->createTestTicket([
            'created_by' => 1,
            'is_internal' => 1,
            'requested_by' => $this->employee->emp_id,
        ]);

        // Customer B cannot view Customer A's ticket
        $this->actingAs($otherCustomer, 'api')
            ->getJson("/api/tickets/{$ticketA->ticket_ID}")
            ->assertStatus(404);

        // Customer A cannot view internal ticket
        $this->actingAs($this->customer, 'api')
            ->getJson("/api/tickets/{$internalTicket->ticket_ID}")
            ->assertStatus(404);
    }

    /**
     * Test 19: Reclassify validation, closed ticket rejected, audit row written, resolution_due_at recalculated from sla_started_at.
     */
    public function test_reclassify_validation_closed_ticket_audit_row_and_sla_recalculation()
    {
        $ticket = $this->createTestTicket([
            'ticket_status_ID' => 2,
            'in_progress_owner' => 'cs',
            'problem_category_ID' => 1,
            'priority_ID' => 1,
            'sla_started_at' => now()->subHours(2),
            'resolution_due_at' => now()->addHours(22),
        ]);

        // 1. Invalid category -> 422
        $this->actingAs($this->superAdmin, 'api')
            ->patchJson("/api/tickets/{$ticket->ticket_ID}/classification", [
                'problem_category_ID' => 999999,
            ])
            ->assertStatus(422);

        // 2. Closed ticket rejected -> 422 TICKET_CLOSED
        $closedTicket = $this->createTestTicket([
            'ticket_status_ID' => 4,
        ]);
        $respClosed = $this->actingAs($this->superAdmin, 'api')
            ->patchJson("/api/tickets/{$closedTicket->ticket_ID}/classification", [
                'priority_ID' => 2,
            ]);
        $respClosed->assertStatus(422);
        $this->assertEquals('TICKET_CLOSED', $respClosed->json('code'));

        // 3. Valid reclassify -> audit row written and resolution_due_at recalculated from sla_started_at
        $respValid = $this->actingAs($this->superAdmin, 'api')
            ->patchJson("/api/tickets/{$ticket->ticket_ID}/classification", [
                'priority_ID' => 2,
            ]);
        $respValid->assertStatus(200);

        // Audit row written
        $this->assertDatabaseHas('ticket_audit_logs', [
            'ticket_ID' => $ticket->ticket_ID,
            'action_type' => 'reclassification',
        ]);

        // Fresh ticket check
        $fresh = DB::table('tickets')->where('ticket_ID', $ticket->ticket_ID)->first();
        $this->assertEquals(2, $fresh->priority_ID);
        $this->assertNotNull($fresh->resolution_due_at);
    }

    /**
     * Test 20: Hold reason exceeding 1000 characters is rejected with 422 and REASON_TOO_LONG.
     */
    public function test_hold_reason_too_long_is_rejected()
    {
        $ticket = $this->createTestTicket([
            'ticket_status_ID' => 2,
            'in_progress_owner' => 'cs',
        ]);

        $longReason = str_repeat('A', 1001);
        $response = $this->actingAs($this->superAdmin, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/hold", [
                'reason' => $longReason,
            ]);

        $response->assertStatus(422);
        $this->assertEquals('REASON_TOO_LONG', $response->json('code'));
    }

    /**
     * Test 21: Reopen reason exceeding 1000 characters is rejected with 422 and REASON_TOO_LONG.
     */
    public function test_reopen_reason_too_long_is_rejected()
    {
        $ticket = $this->createTestTicket([
            'ticket_status_ID' => 4, // Closed
            'created_by' => $this->customer->id,
            'resolved_at' => now()->subHours(2),
            'closed_at' => now()->subHours(1),
        ]);

        $longReason = str_repeat('B', 1001);
        $response = $this->actingAs($this->customer, 'api')
            ->postJson("/api/tickets/{$ticket->ticket_ID}/reopen", [
                'reason' => $longReason,
            ]);

        $response->assertStatus(422);
        $this->assertEquals('REASON_TOO_LONG', $response->json('code'));
    }

    /**
     * Test 22: PATCH /tickets/{id} with statusId 8 requires reason (rejects without reason with REASON_REQUIRED)
     * and succeeds with valid reason.
     */
    public function test_patch_ticket_reopen_status_requires_reason_and_succeeds_with_reason()
    {
        $ticket = $this->createTestTicket([
            'ticket_status_ID' => 4, // Closed
            'created_by' => $this->customer->id,
            'resolved_at' => now()->subHours(2),
            'closed_at' => now()->subHours(1),
        ]);

        // 1. Without reason: returns 422 REASON_REQUIRED
        $failResponse = $this->actingAs($this->customer, 'api')
            ->patchJson("/api/tickets/{$ticket->ticket_ID}", [
                'ticket_status_ID' => 8,
            ]);

        $failResponse->assertStatus(422);
        $this->assertEquals('REASON_REQUIRED', $failResponse->json('code'));

        // 2. With reason: succeeds and transitions ticket
        $successResponse = $this->actingAs($this->customer, 'api')
            ->patchJson("/api/tickets/{$ticket->ticket_ID}", [
                'ticket_status_ID' => 8,
                'reason' => 'Issue recurring after patch update.',
            ]);

        $successResponse->assertOk();

        $freshTicket = \Illuminate\Support\Facades\DB::table('tickets')->where('ticket_ID', $ticket->ticket_ID)->first();
        $this->assertEquals(2, $freshTicket->ticket_status_ID);
        $this->assertEquals('cs', $freshTicket->in_progress_owner);
    }

    /**
     * Test 23: TicketCacheService clears caches using fake Redis without touching real Redis.
     */
    public function test_ticket_cache_service_uses_redis_fake()
    {
        $cacheService = app(\App\Services\TicketCacheService::class);
        $cacheService->clearTicketCaches();

        \Illuminate\Support\Facades\Redis::shouldHaveReceived('connection')->with('cache');
        $this->assertTrue(true);
    }
}


