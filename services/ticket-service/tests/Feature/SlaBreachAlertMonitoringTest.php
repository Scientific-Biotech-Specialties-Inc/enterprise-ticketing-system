<?php

namespace Tests\Feature;

use App\Services\SLAService;
use App\Services\TicketNotificationService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class SlaBreachAlertMonitoringTest extends TestCase
{
    use DatabaseTransactions;

    protected int $csEmpId = 301;
    protected int $assignedEmpId = 302;
    protected int $newAssigneeEmpId = 303;
    protected int $superAdminEmpId = 304;
    protected int $testClientId = 401;

    protected function setUp(): void
    {
        parent::setUp();

        Http::fake([
            '*/api/email/dispatch' => Http::response(['status' => 'sent'], 200),
            '*/api/email/dispatch-event' => Http::response(['status' => 'success'], 200),
            '*' => Http::response(['status' => 'success'], 200),
        ]);

        $this->setUpDatabaseSchema();
        $this->seedTestData();
    }

    protected function setUpDatabaseSchema(): void
    {
        if (DB::getDriverName() === 'sqlite') {
            DB::statement('PRAGMA foreign_keys = OFF');
        }

        if (!Schema::hasTable('clients')) {
            Schema::create('clients', function ($t) {
                $t->increments('id');
                $t->string('client_name')->default('Memorial Health');
                $t->string('email')->nullable();
                $t->timestamps();
            });
        }

        if (!Schema::hasTable('employees')) {
            Schema::create('employees', function ($t) {
                $t->bigIncrements('emp_id');
                $t->string('email')->unique();
                $t->string('first_name');
                $t->string('last_name');
                $t->string('role');
                $t->string('department');
                $t->string('position_level')->nullable();
                $t->string('technical_role')->nullable();
                $t->string('branch')->nullable()->default('Main');
                $t->boolean('is_active')->default(true);
                $t->timestamps();
            });
        }

        if (!Schema::hasTable('problem_categories')) {
            Schema::create('problem_categories', function ($t) {
                $t->increments('problem_category_ID');
                $t->string('category_name');
                $t->timestamps();
            });
        }

        if (!Schema::hasTable('ticket_priorities')) {
            Schema::create('ticket_priorities', function ($t) {
                $t->increments('priority_ID');
                $t->string('priority_name');
                $t->timestamps();
            });
        }

        if (!Schema::hasTable('ticket_statuses')) {
            Schema::create('ticket_statuses', function ($t) {
                $t->increments('ticket_status_ID');
                $t->string('status_name');
                $t->timestamps();
            });
        }

        if (!Schema::hasTable('slas')) {
            Schema::create('slas', function ($t) {
                $t->increments('sla_ID');
                $t->string('sla_name');
                $t->integer('response_time_minutes')->default(60);
                $t->integer('resolution_time_minutes')->default(240);
                $t->boolean('is_active')->default(true);
                $t->timestamps();
            });
        }

        if (!Schema::hasTable('sla_rules')) {
            Schema::create('sla_rules', function ($t) {
                $t->increments('id');
                $t->integer('department_id')->nullable();
                $t->integer('problem_category_ID')->nullable();
                $t->integer('priority_ID')->nullable();
                $t->integer('response_time_limit')->default(60);
                $t->integer('resolution_time_limit')->default(240);
                $t->boolean('is_active')->default(true);
                $t->timestamps();
            });
        }

        if (!Schema::hasTable('tickets')) {
            Schema::create('tickets', function ($t) {
                $t->increments('ticket_ID');
                $t->string('ticket_number')->nullable();
                $t->unsignedBigInteger('ticket_type_ID')->default(1);
                $t->unsignedBigInteger('created_by')->nullable();
                $t->unsignedBigInteger('problem_category_ID')->nullable();
                $t->unsignedBigInteger('ticket_status_ID')->default(1);
                $t->unsignedBigInteger('priority_ID')->default(1);
                $t->unsignedBigInteger('department_id')->nullable();
                $t->unsignedBigInteger('branch_id')->nullable();
                $t->unsignedBigInteger('assigned_to')->nullable();
                $t->string('title');
                $t->text('description')->nullable();
                $t->dateTime('resolution_due_at')->nullable();
                $t->dateTime('due_at')->nullable();
                $t->string('sla_status')->nullable();
                $t->dateTime('sla_breach_notified_at')->nullable();
                $t->dateTime('last_sla_breach_alert_at')->nullable();
                $t->dateTime('sla_risk_notified_at')->nullable();
                $t->timestamps();
            });
        } else {
            // Ensure columns exist on tickets
            if (!Schema::hasColumn('tickets', 'resolution_due_at')) {
                Schema::table('tickets', function ($t) {
                    $t->dateTime('resolution_due_at')->nullable();
                });
            }
            if (!Schema::hasColumn('tickets', 'sla_status')) {
                Schema::table('tickets', function ($t) {
                    $t->string('sla_status')->nullable();
                });
            }
            if (!Schema::hasColumn('tickets', 'sla_breach_notified_at')) {
                Schema::table('tickets', function ($t) {
                    $t->dateTime('sla_breach_notified_at')->nullable();
                });
            }
            if (!Schema::hasColumn('tickets', 'last_sla_breach_alert_at')) {
                Schema::table('tickets', function ($t) {
                    $t->dateTime('last_sla_breach_alert_at')->nullable();
                });
            }
            if (!Schema::hasColumn('tickets', 'sla_risk_notified_at')) {
                Schema::table('tickets', function ($t) {
                    $t->dateTime('sla_risk_notified_at')->nullable();
                });
            }
            if (!Schema::hasColumn('tickets', 'assigned_to')) {
                Schema::table('tickets', function ($t) {
                    $t->unsignedBigInteger('assigned_to')->nullable();
                });
            }
            if (!Schema::hasColumn('tickets', 'department_id')) {
                Schema::table('tickets', function ($t) {
                    $t->unsignedBigInteger('department_id')->nullable();
                });
            }
        }

        if (!Schema::hasTable('ticket_assignments')) {
            Schema::create('ticket_assignments', function ($t) {
                $t->increments('assignment_ID');
                $t->unsignedBigInteger('ticket_ID');
                $t->unsignedBigInteger('employee_ID');
                $t->boolean('is_active')->default(true);
                $t->dateTime('completed_at')->nullable();
                $t->timestamps();
            });
        }

        if (!Schema::hasTable('notifications')) {
            Schema::create('notifications', function ($t) {
                $t->increments('id');
                $t->unsignedBigInteger('recipient_id');
                $t->string('recipient_type');
                $t->string('title');
                $t->text('message');
                $t->unsignedBigInteger('ticket_id')->nullable();
                $t->string('type')->nullable();
                $t->text('data')->nullable();
                $t->boolean('is_read')->default(false);
                $t->timestamps();
            });
        }

        if (!Schema::hasTable('ticket_audit_logs')) {
            Schema::create('ticket_audit_logs', function ($t) {
                $t->increments('log_ID');
                $t->unsignedBigInteger('ticket_ID')->nullable();
                $t->string('action_type')->nullable();
                $t->unsignedBigInteger('action_by_ID')->nullable();
                $t->string('actor_type')->nullable();
                $t->text('details')->nullable();
                $t->timestamps();
            });
        }
    }

    protected function seedTestData(): void
    {
        DB::table('clients')->updateOrInsert(['id' => $this->testClientId], [
            'client_name' => 'Metro General Hospital',
            'email' => 'sla_metro_' . $this->testClientId . '@metrogeneral.test',
            'address' => '10 Metro Ave',
            'contact_number' => '0000000003',
        ]);

        DB::table('employees')->updateOrInsert(['emp_id' => $this->csEmpId], [
            'first_name' => 'Sarah',
            'last_name' => 'Jenkins',
            'email' => 'sarah.cs@example.com',
            'role' => 'customer service',
            'department' => 'Customer Service',
            'branch' => 'Main',
            'is_active' => true,
            'password_hash' => 'secret',
        ]);

        DB::table('employees')->updateOrInsert(['emp_id' => $this->assignedEmpId], [
            'first_name' => 'David',
            'last_name' => 'Kim',
            'email' => 'david.kim@example.com',
            'role' => 'Technician',
            'department' => 'Biomedical',
            'branch' => 'Main',
            'is_active' => true,
            'password_hash' => 'secret',
        ]);

        DB::table('employees')->updateOrInsert(['emp_id' => $this->newAssigneeEmpId], [
            'first_name' => 'Elena',
            'last_name' => 'Rostova',
            'email' => 'elena.rostova@example.com',
            'role' => 'Senior Specialist',
            'department' => 'Biomedical',
            'branch' => 'Main',
            'is_active' => true,
            'password_hash' => 'secret',
        ]);

        DB::table('employees')->updateOrInsert(['emp_id' => $this->superAdminEmpId], [
            'first_name' => 'Admin',
            'last_name' => 'Root',
            'email' => 'admin@example.com',
            'role' => 'super admin',
            'department' => 'Executive',
            'branch' => 'Main',
            'is_active' => true,
            'password_hash' => 'secret',
        ]);

        DB::table('problem_categories')->updateOrInsert(['problem_category_ID' => 1], [
            'category_name' => 'Critical Medical Imaging',
        ]);

        DB::table('ticket_priorities')->updateOrInsert(['priority_ID' => 1], [
            'priority_name' => 'Critical',
        ]);

        DB::table('ticket_statuses')->updateOrInsert(['ticket_status_ID' => 1], [
            'status_name' => 'In Progress',
        ]);

        DB::table('ticket_statuses')->updateOrInsert(['ticket_status_ID' => 2], [
            'status_name' => 'Closed',
        ]);

        DB::table('slas')->updateOrInsert(['sla_ID' => 1], [
            'sla_name' => 'Critical 4h SLA',
            'response_time_minutes' => 30,
            'resolution_time_minutes' => 240,
            'is_active' => true,
        ]);
    }

    /**
     * Requirement: Continuous monitoring detects the moment a ticket transitions into Breached status.
     */
    public function test_monitoring_detects_breached_ticket_and_transitions_sla_status(): void
    {
        $overdueDate = Carbon::now()->subHours(2);

        $ticketId = DB::table('tickets')->insertGetId([
            'ticket_number' => 'TKT-1001',
            'ticket_type_ID' => 1,
            'created_by' => $this->testClientId,
            'problem_category_ID' => 1,
            'priority_ID' => 1,
            'ticket_status_ID' => 1,
            'title' => 'MRI Scanner Coolant Leak',
            'description' => 'System coolant temperature exceeds threshold.',
            'resolution_due_at' => $overdueDate,
            'sla_status' => 'At Risk',
            'created_at' => Carbon::now()->subHours(6),
            'updated_at' => Carbon::now()->subHours(1),
        ]);

        DB::table('ticket_assignments')->insert([
            'ticket_ID' => $ticketId,
            'employee_ID' => $this->assignedEmpId,
            'assigned_by' => $this->csEmpId,
            'created_at' => Carbon::now()->subHours(5),
        ]);

        $slaService = app(SLAService::class);
        $result = $slaService->checkAndNotifySlaAlerts();

        $this->assertGreaterThanOrEqual(1, $result['evaluated_tickets']);
        $this->assertGreaterThanOrEqual(1, $result['breach_notifications_sent']);

        $updatedTicket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        $this->assertSame('Breached', $updatedTicket->sla_status);
        $this->assertNotNull($updatedTicket->sla_breach_notified_at);
        $this->assertNotNull($updatedTicket->last_sla_breach_alert_at);
    }

    /**
     * Requirement: Upon breach, alerts are automatically sent to CS and currently Assigned Employee.
     * Requirement: Alert content identifies Ticket ID, summary, customer, category, priority, overdue duration, link.
     */
    public function test_breach_alert_payload_content_and_recipient_distribution(): void
    {
        $overdueDate = Carbon::now()->subMinutes(90);

        $ticketId = DB::table('tickets')->insertGetId([
            'ticket_number' => 'TKT-1002',
            'ticket_type_ID' => 1,
            'created_by' => $this->testClientId,
            'problem_category_ID' => 1,
            'priority_ID' => 1,
            'ticket_status_ID' => 1,
            'title' => 'CT Gantry Rotation Lock',
            'description' => 'Emergency CT room blocked.',
            'resolution_due_at' => $overdueDate,
            'sla_status' => 'On Track',
            'created_at' => Carbon::now()->subHours(5),
            'updated_at' => Carbon::now()->subHours(2),
        ]);

        DB::table('ticket_assignments')->insert([
            'ticket_ID' => $ticketId,
            'employee_ID' => $this->assignedEmpId,
            'assigned_by' => $this->csEmpId,
            'created_at' => Carbon::now()->subHours(4),
        ]);

        $slaService = app(SLAService::class);
        $slaService->checkAndNotifySlaAlerts();

        // 1. Verify CS received alert
        $csNotification = DB::table('notifications')
            ->where('recipient_id', $this->csEmpId)
            ->where('ticket_id', $ticketId)
            ->first();

        $this->assertNotNull($csNotification, 'Customer Service representative should receive breach alert');
        $this->assertStringContainsString('Breached', $csNotification->title);
        $csData = json_decode($csNotification->data, true);
        $this->assertSame('overdue_sla_breach', $csData['type']);

        // 2. Verify assigned employee received alert
        $empNotification = DB::table('notifications')
            ->where('recipient_id', $this->assignedEmpId)
            ->where('ticket_id', $ticketId)
            ->first();

        $this->assertNotNull($empNotification, 'Assigned Employee should receive breach alert');
        $this->assertStringContainsString('Assigned Ticket', $empNotification->title);

        // 3. Verify alert payload content fields
        $payload = json_decode($empNotification->data, true);
        $this->assertIsArray($payload);
        $this->assertSame($ticketId, $payload['ticket_id']);
        $this->assertSame('CT Gantry Rotation Lock', $payload['summary']);
        $this->assertSame('Metro General Hospital', $payload['customer']);
        $this->assertSame('Critical Medical Imaging', $payload['category']);
        $this->assertSame('Critical', $payload['priority']);
        $this->assertSame('Breached', $payload['sla_status']);
        $this->assertStringContainsString('overdue', strtolower($payload['overdue_duration']));
        $this->assertNotEmpty($payload['link']);
        $this->assertNotEmpty($payload['deep_link']);
    }

    /**
     * Requirement: Alert is delivered strictly through recipient's configured channels (in-app and/or email).
     */
    public function test_respects_individual_notification_channel_preferences(): void
    {
        // Configure employee preference: in_app disabled, email enabled
        Cache::put("employee:notification_preferences:{$this->assignedEmpId}", [
            'in_app' => false,
            'email' => true,
        ], 3600);

        $overdueDate = Carbon::now()->subHours(1);

        $ticketId = DB::table('tickets')->insertGetId([
            'ticket_number' => 'TKT-1003',
            'ticket_type_ID' => 1,
            'created_by' => $this->testClientId,
            'problem_category_ID' => 1,
            'priority_ID' => 1,
            'ticket_status_ID' => 1,
            'title' => 'Telemetry Hub Disconnected',
            'description' => 'Vital signs telemetry unit unreachable.',
            'resolution_due_at' => $overdueDate,
            'sla_status' => 'At Risk',
            'created_at' => Carbon::now()->subHours(4),
            'updated_at' => Carbon::now()->subHours(1),
        ]);

        DB::table('ticket_assignments')->insert([
            'ticket_ID' => $ticketId,
            'employee_ID' => $this->assignedEmpId,
            'assigned_by' => $this->csEmpId,
            'created_at' => Carbon::now()->subHours(3),
        ]);

        $slaService = app(SLAService::class);
        $slaService->checkAndNotifySlaAlerts();

        // In-app notification must be skipped
        $empNotification = DB::table('notifications')
            ->where('recipient_id', $this->assignedEmpId)
            ->where('ticket_id', $ticketId)
            ->first();

        $this->assertNull($empNotification, 'In-app notification should be skipped when in_app preference is false');

        // Email dispatch was called via Http retry endpoint
        Http::assertSent(function ($request) {
            return str_contains($request->url(), '/api/email/dispatch');
        });
    }

    /**
     * Requirement: The breach event is recorded in the ticket's history/audit trail regardless of notification delivery outcome.
     */
    public function test_breach_event_recorded_in_audit_trail_durable_record(): void
    {
        $overdueDate = Carbon::now()->subMinutes(45);

        $ticketId = DB::table('tickets')->insertGetId([
            'ticket_number' => 'TKT-1004',
            'ticket_type_ID' => 1,
            'created_by' => $this->testClientId,
            'problem_category_ID' => 1,
            'priority_ID' => 1,
            'ticket_status_ID' => 1,
            'title' => 'Dialysis Station 4 Flow Alarm',
            'description' => 'Flow meter alert.',
            'resolution_due_at' => $overdueDate,
            'sla_status' => 'On Track',
            'created_at' => Carbon::now()->subHours(3),
            'updated_at' => Carbon::now()->subHours(1),
        ]);

        $slaService = app(SLAService::class);
        $slaService->checkAndNotifySlaAlerts();

        $auditLog = DB::table('ticket_audit_logs')
            ->where('ticket_ID', $ticketId)
            ->where('action_type', 'sla_breached')
            ->first();

        $this->assertNotNull($auditLog, 'Audit log entry must exist for sla_breached');
        $this->assertSame('system', $auditLog->actor_type);

        $details = json_decode($auditLog->details, true);
        $this->assertSame('Breached', $details['sla_status']);
        $this->assertSame('Metro General Hospital', $details['customer']);
        $this->assertSame('Critical Medical Imaging', $details['category']);
        $this->assertSame('Critical', $details['priority']);
    }

    /**
     * Requirement: If the Assigned Employee changes after a breach has occurred, the newly assigned employee
     * is also alerted (via their own configured channels) and sees the breach status upon assignment.
     */
    public function test_reassignment_of_breached_ticket_alerts_new_employee(): void
    {
        $overdueDate = Carbon::now()->subHours(3);

        $ticketId = DB::table('tickets')->insertGetId([
            'ticket_number' => 'TKT-1005',
            'ticket_type_ID' => 1,
            'created_by' => $this->testClientId,
            'problem_category_ID' => 1,
            'priority_ID' => 1,
            'ticket_status_ID' => 1,
            'title' => 'Infusion Pump Software Glitch',
            'description' => 'Unresponsive touchscreen.',
            'resolution_due_at' => $overdueDate,
            'sla_status' => 'Breached',
            'sla_breach_notified_at' => Carbon::now()->subHours(3),
            'last_sla_breach_alert_at' => Carbon::now()->subHours(3),
            'created_at' => Carbon::now()->subHours(8),
            'updated_at' => Carbon::now()->subHours(2),
        ]);

        $slaService = app(SLAService::class);
        $slaService->dispatchReassignmentBreachAlert($ticketId, $this->newAssigneeEmpId);

        // Verify newly assigned employee received urgent breach alert
        $reassignedNotification = DB::table('notifications')
            ->where('recipient_id', $this->newAssigneeEmpId)
            ->where('ticket_id', $ticketId)
            ->first();

        $this->assertNotNull($reassignedNotification, 'New assignee must receive breach alert upon assignment');
        $this->assertStringContainsString('Reassigned Ticket', $reassignedNotification->title);

        $data = json_decode($reassignedNotification->data, true);
        $this->assertTrue($data['is_reassignment']);
        $this->assertSame('Breached', $data['sla_status']);

        // Verify audit log for reassignment breach alert
        $auditLog = DB::table('ticket_audit_logs')
            ->where('ticket_ID', $ticketId)
            ->where('action_type', 'sla_breached_reassigned')
            ->first();

        $this->assertNotNull($auditLog, 'Audit log entry must be written for reassignment breach alert');
    }

    /**
     * Requirement: Background monitoring command retries and alerts Super Admin on failure.
     */
    public function test_monitoring_command_retries_and_alerts_super_admin_on_failure(): void
    {
        // Mock SLAService to throw exception to test retry policy
        $mockSlaService = $this->createMock(SLAService::class);
        $mockSlaService->expects($this->exactly(3))
            ->method('checkAndNotifySlaAlerts')
            ->willThrowException(new \RuntimeException('Database connection timeout during SLA scan'));

        $this->app->instance(SLAService::class, $mockSlaService);

        $exitCode = Artisan::call('tickets:check-sla-alerts');
        $this->assertSame(1, $exitCode);

        // Verify Super Admin received failure alert
        $adminAlert = DB::table('notifications')
            ->where('recipient_id', $this->superAdminEmpId)
            ->first();

        $this->assertNotNull($adminAlert, 'Super Admin should be alerted when background monitoring fails completely');
        $this->assertStringContainsString('Background Job Alert', $adminAlert->title);
        $adminData = json_decode($adminAlert->data, true);
        $this->assertSame('system_alert', $adminData['type']);
    }
}
