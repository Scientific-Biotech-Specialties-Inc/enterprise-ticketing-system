<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Employee;
use App\Models\BranchTicketForecast;
use App\Models\BranchRecurringIssueTrend;
use App\Models\ForecastJobRun;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class AdminReportsTest extends TestCase
{
    use DatabaseTransactions;

    protected Employee $admin;
    protected Employee $otherBranchAdmin;
    protected Employee $technician;
    protected Employee $inactiveTechnician;
    protected Employee $superAdmin;
    protected Employee $regularStaff;

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'mysql']);
        config(['database.connections.mysql.database' => 'ticketing_system_test']);
        DB::purge('mysql');
        DB::reconnect('mysql');

        Cache::flush();

        $testEmails = [
            'alice.admin@example.com',
            'oscar.other@example.com',
            'bob.tech@example.com',
            'ian.idle@example.com',
            'sam.super@example.com',
            'rachel.regular@example.com',
            'inactive.tech@example.com',
            'cs.agent@example.com',
        ];
        DB::table('reassignment_requests')->whereIn('employee_id', function ($q) use ($testEmails) {
            $q->select('emp_id')->from('employees')->whereIn('email', $testEmails);
        })->delete();
        DB::table('tickets')->whereIn('branch_id', [901, 902])->delete();
        DB::table('branch_ticket_forecasts')->whereIn('branch_id', [901, 902])->delete();
        DB::table('branch_recurring_issue_trends')->whereIn('branch_id', [901, 902])->delete();
        DB::table('forecast_job_runs')->whereIn('branch_id', [901, 902])->delete();
        DB::table('daily_employee_performance')->whereIn('branch_id', [901, 902])->delete();
        DB::table('employees')->whereIn('email', $testEmails)->delete();

        // Setup test branch
        DB::table('branches')->updateOrInsert(
            ['id' => 901],
            [
                'slug' => 'test-branch-901',
                'name' => 'Test Branch 901',
                'code' => 'TB901',
                'region' => 'Region Test',
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        DB::table('branches')->updateOrInsert(
            ['id' => 902],
            [
                'slug' => 'other-branch-902',
                'name' => 'Other Branch 902',
                'code' => 'OB902',
                'region' => 'Region Other',
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        DB::table('problem_categories')->updateOrInsert(
            ['problem_category_ID' => 1],
            ['category_name' => 'Hardware', 'created_at' => now(), 'updated_at' => now()]
        );

        DB::table('ticket_types')->updateOrInsert(
            ['ticket_type_ID' => 1],
            ['type_name' => 'Incident', 'created_at' => now(), 'updated_at' => now()]
        );

        DB::table('ticket_priorities')->updateOrInsert(
            ['priority_ID' => 1],
            ['priority_name' => 'Low', 'color_code' => 'green', 'created_at' => now(), 'updated_at' => now()]
        );

        DB::table('ticket_statuses')->updateOrInsert(
            ['ticket_status_ID' => 1],
            ['status_name' => 'Open', 'created_at' => now(), 'updated_at' => now()]
        );
        DB::table('ticket_statuses')->updateOrInsert(
            ['ticket_status_ID' => 2],
            ['status_name' => 'In Progress', 'created_at' => now(), 'updated_at' => now()]
        );
        DB::table('ticket_statuses')->updateOrInsert(
            ['ticket_status_ID' => 3],
            ['status_name' => 'Resolved', 'created_at' => now(), 'updated_at' => now()]
        );
        DB::table('ticket_statuses')->updateOrInsert(
            ['ticket_status_ID' => 4],
            ['status_name' => 'Closed', 'created_at' => now(), 'updated_at' => now()]
        );

        DB::table('users')->updateOrInsert(
            ['id' => 1],
            ['name' => 'System Admin', 'email' => 'sysadmin@example.com', 'password' => 'secret', 'created_at' => now(), 'updated_at' => now()]
        );

        DB::table('clients')->updateOrInsert(
            ['id' => 1],
            [
                'client_name' => 'Test Client 1',
                'email' => 'client1@test.com',
                'contact_number' => '1234567890',
                'address' => 'Test Address',
                'status' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        // Branch Admin
        $this->admin = Employee::create([
            'emp_id' => 88001,
            'first_name' => 'Alice',
            'last_name' => 'Admin',
            'email' => 'alice.admin@example.com',
            'role' => 'admin',
            'department' => 'Operations',
            'branch_id' => 901,
            'branch' => 'test-branch-901',
            'is_active' => 1,
            'password_hash' => bcrypt('password'),
        ]);

        // Admin from another branch
        $this->otherBranchAdmin = Employee::create([
            'emp_id' => 88002,
            'first_name' => 'Oscar',
            'last_name' => 'Other',
            'email' => 'oscar.other@example.com',
            'role' => 'admin',
            'department' => 'Operations',
            'branch_id' => 902,
            'branch' => 'other-branch-902',
            'is_active' => 1,
            'password_hash' => bcrypt('password'),
        ]);

        // Active Technician
        $this->technician = Employee::create([
            'emp_id' => 88003,
            'first_name' => 'Bob',
            'last_name' => 'Tech',
            'email' => 'bob.tech@example.com',
            'role' => 'technical',
            'department' => 'Service',
            'position_level' => 'Senior Technician',
            'branch_id' => 901,
            'branch' => 'test-branch-901',
            'is_active' => 1,
            'password_hash' => bcrypt('password'),
        ]);

        // Inactive Technician (No tickets assigned in period)
        $this->inactiveTechnician = Employee::create([
            'emp_id' => 88004,
            'first_name' => 'Ian',
            'last_name' => 'Idle',
            'email' => 'ian.idle@example.com',
            'role' => 'technical',
            'department' => 'Service',
            'position_level' => 'Junior Technician',
            'branch_id' => 901,
            'branch' => 'test-branch-901',
            'is_active' => 1,
            'password_hash' => bcrypt('password'),
        ]);

        // SuperAdmin
        $this->superAdmin = Employee::create([
            'emp_id' => 88005,
            'first_name' => 'Sam',
            'last_name' => 'Super',
            'email' => 'sam.super@example.com',
            'role' => 'superadmin',
            'department' => 'Executive',
            'branch_id' => 901,
            'branch' => 'test-branch-901',
            'is_active' => 1,
            'password_hash' => bcrypt('password'),
        ]);

        // Regular Non-Admin Staff
        $this->regularStaff = Employee::create([
            'emp_id' => 88006,
            'first_name' => 'Rachel',
            'last_name' => 'Regular',
            'email' => 'rachel.regular@example.com',
            'role' => 'technical',
            'department' => 'Service',
            'branch_id' => 901,
            'branch' => 'test-branch-901',
            'is_active' => 1,
            'password_hash' => bcrypt('password'),
        ]);
    }

    /**
     * AC-1, AC-2, AC-3: Admin can view employee performance with approved reassignment rate and assigned capacity.
     */
    public function test_admin_can_view_employee_performance_metrics(): void
    {
        $now = Carbon::now();

        // Create 2 resolved tickets and 1 open ticket for technician
        $t1 = DB::table('tickets')->insertGetId([
            'ticket_number' => 'TCK-ADMIN-001',
            'title' => 'Hardware Repair Issue 1',
            'description' => 'Fix hard drive failure',
            'problem_category_ID' => 1,
            'machine_ID' => null,
            'created_by' => 1,
            'assigned_to' => $this->technician->emp_id,
            'branch_id' => 901,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 4, // Closed
            'priority_ID' => 1,
            'created_at' => $now->copy()->subHours(5),
            'resolved_at' => $now->copy()->subHours(2),
            'resolution_due_at' => $now->copy()->addHours(10),
            'updated_at' => $now,
        ]);

        $t2 = DB::table('tickets')->insertGetId([
            'ticket_number' => 'TCK-ADMIN-002',
            'title' => 'Hardware Repair Issue 2',
            'description' => 'Replace power supply',
            'problem_category_ID' => 1,
            'machine_ID' => null,
            'created_by' => 1,
            'assigned_to' => $this->technician->emp_id,
            'branch_id' => 901,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 3, // Resolved
            'priority_ID' => 1,
            'created_at' => $now->copy()->subHours(8),
            'resolved_at' => $now->copy()->subHours(4),
            'resolution_due_at' => $now->copy()->addHours(5),
            'updated_at' => $now,
        ]);

        // Spec 0039: employee figures come from the technician's own holding periods.
        $this->period($t1, $this->technician->emp_id, $now->copy()->subHours(5), $now->copy()->subHours(5), $now->copy()->subHours(2), 'closed');
        $this->period($t2, $this->technician->emp_id, $now->copy()->subHours(8), $now->copy()->subHours(8), $now->copy()->subHours(4), 'resolved');

        // Create an approved reassignment request originating from this employee
        DB::table('reassignment_requests')->insert([
            'ticket_id' => $t1,
            'employee_id' => $this->technician->emp_id,
            'reason' => 'Requires special calibration tool',
            'status' => 'approved',
            'requested_at' => $now->copy()->subHours(3),
            'reviewed_at' => $now->copy()->subHours(2),
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $response = $this->actingAs($this->admin, 'api')
            ->getJson('/api/admin-reports/employees?preset=Last 7 Days&force_refresh=true')
            ->assertOk()
            ->assertJsonStructure([
                'status',
                'branch' => ['id', 'name', 'slug'],
                'preset',
                'total_employees',
                'active_employees',
                'employees' => [
                    '*' => [
                        'employee_id',
                        'name',
                        'department',
                        'has_data',
                        'period_status',
                        'performance_score',
                        'score_status',
                        'pending_count',
                        'response_sla_rate',
                        'response_met_count',
                        'response_breached_count',
                        'average_response_minutes',
                        'tickets_assigned',
                        'tickets_resolved',
                        'resolution_rate',
                        'average_resolution_hours',
                        'sla_compliance_rate',
                        'reassignment_rate',
                    ],
                ],
            ]);

        $empData = collect($response->json('employees'))->firstWhere('employee_id', $this->technician->emp_id);
        $this->assertNotNull($empData);
        $this->assertTrue($empData['has_data']);
        $this->assertSame('active', $empData['period_status']);
        $this->assertSame(2, $empData['tickets_assigned']);
        $this->assertSame(2, $empData['tickets_resolved']);
        $this->assertEquals(100.0, $empData['resolution_rate']);
        $this->assertEquals(3.5, $empData['average_resolution_hours']); // (3h + 4h) / 2 = 3.5h
        $this->assertEquals(50.0, $empData['reassignment_rate']); // 1 approved / 2 assigned = 50%
    }

    /**
     * AC-4: Employee with no assigned tickets in period receives explicit nulls and has_data false.
     */
    public function test_employee_with_no_tickets_returns_explicit_null_and_no_data(): void
    {
        $response = $this->actingAs($this->admin, 'api')
            ->getJson('/api/admin-reports/employees?preset=Last 7 Days&force_refresh=true')
            ->assertOk();

        $empData = collect($response->json('employees'))->firstWhere('employee_id', $this->inactiveTechnician->emp_id);
        $this->assertNotNull($empData);
        $this->assertFalse($empData['has_data']);
        $this->assertSame('no_data', $empData['period_status']);
        $this->assertSame(0, $empData['tickets_assigned']);
        $this->assertSame(0, $empData['tickets_resolved']);
        $this->assertNull($empData['resolution_rate']);
        $this->assertNull($empData['average_resolution_hours']);
        $this->assertNull($empData['sla_compliance_rate']);
        $this->assertNull($empData['reassignment_rate']);
        $this->assertNull($empData['csat_score']);
    }

    /**
     * AC-3: Internal tickets where employee was strictly requester are excluded from their Assigned capacity metrics.
     */
    public function test_employee_performance_excludes_requester_only_activity_on_internal_tickets(): void
    {
        $now = Carbon::now();

        // Create internal ticket where inactiveTechnician was the REQUESTER, but someone else was assigned
        DB::table('tickets')->insertGetId([
            'ticket_number' => 'INT-REQ-ONLY-001',
            'title' => 'Internal Keyboard Replacement',
            'description' => 'Requester only',
            'problem_category_ID' => 1,
            'machine_ID' => null,
            'created_by' => 1,
            'requested_by' => $this->inactiveTechnician->emp_id, // Requester
            'is_internal' => 1,
            'assigned_to' => $this->technician->emp_id, // Assigned to someone else
            'branch_id' => 901,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1,
            'priority_ID' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $response = $this->actingAs($this->admin, 'api')
            ->getJson('/api/admin-reports/employees?preset=Today&force_refresh=true')
            ->assertOk();

        $inactiveData = collect($response->json('employees'))->firstWhere('employee_id', $this->inactiveTechnician->emp_id);
        $this->assertNotNull($inactiveData);
        $this->assertFalse($inactiveData['has_data'], 'Requester-only internal ticket must not count as assigned ticket');
        $this->assertSame(0, $inactiveData['tickets_assigned']);
    }

    /**
     * AC-5: Server-side branch scoping blocks cross-branch tampering for non-superadmin users.
     */
    public function test_server_side_branch_scoping_blocks_cross_branch_access(): void
    {
        // Admin from branch 901 attempts to query branch 902
        $response = $this->actingAs($this->admin, 'api')
            ->getJson('/api/admin-reports/employees?branch_id=902')
            ->assertStatus(403)
            ->assertJson([
                'status' => 'error',
                'message' => 'Access denied: Cross-branch reporting access is prohibited.',
            ]);

        // SuperAdmin can query branch 902 without restriction
        $superResponse = $this->actingAs($this->superAdmin, 'api')
            ->getJson('/api/admin-reports/employees?branch_id=902')
            ->assertOk();

        $this->assertSame(902, $superResponse->json('branch.id'));
    }

    /**
     * Non-admin role is rejected with HTTP 403.
     */
    public function test_regular_technician_role_is_denied_access_to_admin_reports(): void
    {
        $this->actingAs($this->regularStaff, 'api')
            ->getJson('/api/admin-reports/employees')
            ->assertStatus(403)
            ->assertJson([
                'status' => 'error',
                'message' => 'Access denied: Admin role required to view operational reports.',
            ]);
    }

    /**
     * AC-7, AC-8, AC-9, AC-10, AC-11: Department performance rollups, open vs overdue, workload distribution, and sorting.
     */
    public function test_admin_can_view_department_performance_metrics_and_sort(): void
    {
        $now = Carbon::now();

        // Create open ticket (not overdue)
        DB::table('tickets')->insertGetId([
            'ticket_number' => 'TCK-DEPT-001',
            'title' => 'Active Network Check',
            'description' => 'In progress',
            'problem_category_ID' => 1,
            'machine_ID' => null,
            'created_by' => 1,
            'assigned_to' => $this->technician->emp_id,
            'branch_id' => 901,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 2, // In Progress
            'priority_ID' => 1,
            'resolution_due_at' => $now->copy()->addHours(24),
            'created_at' => $now->copy()->subHour(),
            'updated_at' => $now,
        ]);

        // Create overdue ticket (deadline in the past)
        DB::table('tickets')->insertGetId([
            'ticket_number' => 'TCK-DEPT-002',
            'title' => 'Critical Server Down',
            'description' => 'Overdue',
            'problem_category_ID' => 1,
            'machine_ID' => null,
            'created_by' => 1,
            'assigned_to' => $this->technician->emp_id,
            'branch_id' => 901,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1, // Open
            'priority_ID' => 1,
            'resolution_due_at' => $now->copy()->subHours(10), // Breached
            'created_at' => $now->copy()->subDays(2),
            'updated_at' => $now,
        ]);

        $response = $this->actingAs($this->admin, 'api')
            ->getJson('/api/admin-reports/departments?preset=Last 7 Days&sort_by=total_tickets&sort_dir=desc&force_refresh=true')
            ->assertOk()
            ->assertJsonStructure([
                'status',
                'branch' => ['id', 'name', 'slug'],
                'total_departments',
                'departments' => [
                    '*' => [
                        'department',
                        'staff_count',
                        'has_data',
                        'total_tickets',
                        'open_tickets_count',
                        'overdue_tickets_count',
                        'workload_distribution' => [
                            '*' => [
                                'employee_id',
                                'name',
                                'active_tickets_count',
                                'share_percentage',
                            ],
                        ],
                    ],
                ],
            ]);

        $serviceDept = collect($response->json('departments'))->firstWhere('department', 'Service');
        $this->assertNotNull($serviceDept);
        $this->assertTrue($serviceDept['has_data']);
        $this->assertGreaterThanOrEqual(2, $serviceDept['total_tickets']);
        // Open (still inside SLA) and overdue (breached) are separate counts that add up to all unclosed tickets.
        $this->assertGreaterThanOrEqual(1, $serviceDept['open_tickets_count']);
        $this->assertGreaterThanOrEqual(1, $serviceDept['overdue_tickets_count']);
        $this->assertSame(
            $serviceDept['unclosed_tickets_count'],
            $serviceDept['open_tickets_count'] + $serviceDept['overdue_tickets_count']
        );
        $this->assertGreaterThanOrEqual(2, $serviceDept['unclosed_tickets_count']);

        // Check workload distribution
        $techWorkload = collect($serviceDept['workload_distribution'])->firstWhere('employee_id', $this->technician->emp_id);
        $this->assertNotNull($techWorkload);
        $this->assertGreaterThanOrEqual(2, $techWorkload['active_tickets_count']);
    }

    /**
     * AC-13, AC-15: Predictive insights fallback with insufficient_data when below 14 days of history.
     */
    public function test_predictive_insights_returns_insufficient_data_when_below_14_days(): void
    {
        // Branch 901 currently has only a few days of tickets, well below 14 days
        $response = $this->actingAs($this->admin, 'api')
            ->getJson('/api/admin-reports/predictive-insights?force_refresh=true')
            ->assertOk()
            ->assertJson([
                'status' => 'insufficient_data',
                'historical_basis' => [
                    'minimum_days_required' => 14,
                ],
            ]);

        $this->assertEmpty($response->json('volume_forecast'));
        $this->assertStringContainsString('Insufficient historical data', $response->json('message'));
    }

    /**
     * AC-14, AC-16, AC-17, AC-18: Batch forecasting calculation and job health tracking.
     */
    public function test_predictive_insights_forecast_calculation_and_job_logging(): void
    {
        $now = Carbon::now();

        // Seed 15 distinct days of tickets in branch 901 to cross the 14-day threshold
        for ($i = 1; $i <= 15; $i++) {
            DB::table('tickets')->insert([
                'ticket_number' => "TCK-HIST-{$i}",
                'title' => "Historical Ticket Day {$i}",
                'description' => "Test history",
                'problem_category_ID' => 1,
                'machine_ID' => null,
                'created_by' => 1,
                'assigned_to' => $this->technician->emp_id,
                'branch_id' => 901,
                'ticket_type_ID' => 1,
                'ticket_status_ID' => 3,
                'priority_ID' => 1,
                'created_at' => $now->copy()->subDays($i)->setHour(10),
                'resolved_at' => $now->copy()->subDays($i)->setHour(12),
                'updated_at' => $now,
            ]);
        }

        // Run Artisan calculation command
        $this->artisan('tickets:calculate-forecasts', ['--horizon' => 7])
            ->assertExitCode(0);

        // Verify forecast records exist
        $forecastCount = BranchTicketForecast::where('branch_id', 901)
            ->where('calculation_status', 'success')
            ->count();
        $this->assertGreaterThanOrEqual(7, $forecastCount);

        // Verify job execution health log exists
        $jobRun = ForecastJobRun::where('branch_id', 901)->latest('id')->first();
        $this->assertNotNull($jobRun);
        $this->assertSame('success', $jobRun->status);
        $this->assertGreaterThanOrEqual(15, $jobRun->records_processed);
        $this->assertGreaterThan(0, $jobRun->duration_ms);

        // Verify API endpoint returns projected volume
        $apiResponse = $this->actingAs($this->admin, 'api')
            ->getJson('/api/admin-reports/predictive-insights')
            ->assertOk()
            ->assertJson([
                'status' => 'success',
                'historical_basis' => [
                    'minimum_days_required' => 14,
                ],
            ]);

        $this->assertNotEmpty($apiResponse->json('volume_forecast'));
        $this->assertCount(7, $apiResponse->json('volume_forecast'));
    }

    /**
     * Spec 0029 AC-10: the nightly job stores 7 days, so a 30 day request must top the horizon up
     * instead of returning the 7 stored rows.
     */
    public function test_thirty_day_horizon_is_served_after_the_nightly_seven_day_run(): void
    {
        $now = Carbon::now();
        for ($i = 1; $i <= 15; $i++) {
            DB::table('tickets')->insert([
                'ticket_number' => "TCK-H30-{$i}", 'title' => "History {$i}", 'description' => 'x',
                'problem_category_ID' => 1, 'machine_ID' => null, 'created_by' => 1,
                'assigned_to' => $this->technician->emp_id, 'branch_id' => 901, 'ticket_type_ID' => 1,
                'ticket_status_ID' => 3, 'priority_ID' => 1,
                'created_at' => $now->copy()->subDays($i)->setHour(10), 'updated_at' => $now,
            ]);
        }
        $this->artisan('tickets:calculate-forecasts', ['--horizon' => 7])->assertExitCode(0);

        $response = $this->actingAs($this->admin, 'api')
            ->getJson('/api/admin-reports/predictive-insights?horizon_days=30')
            ->assertOk()
            ->assertJsonPath('status', 'success');

        $this->assertCount(30, $response->json('volume_forecast'));
    }

    /**
     * Spec 0029 AC-12: the All Branches view must not claim a successful 60 day basis when no branch
     * has enough history; it reports insufficient data, and otherwise the real days used.
     */
    public function test_all_branches_forecast_reports_true_status_and_basis(): void
    {
        // Forecast rows are a derived cache, so the future window is reset to a known state.
        DB::table('branch_ticket_forecasts')->where('forecast_date', '>=', Carbon::today()->toDateString())->delete();
        $seed = function (int $branchId, string $status, int $days, int $volume) {
            for ($d = 0; $d < 7; $d++) {
                BranchTicketForecast::updateOrCreate(
                    ['branch_id' => $branchId, 'forecast_date' => Carbon::today()->addDays($d)->toDateString()],
                    ['predicted_volume' => $volume, 'lower_bound' => 0, 'upper_bound' => $volume,
                     'historical_days_used' => $days, 'calculation_status' => $status, 'calculated_at' => now()]
                );
            }
        };
        $seed(901, 'insufficient_data', 4, 0);
        $seed(902, 'insufficient_data', 3, 0);

        $insufficient = $this->actingAs($this->superAdmin, 'api')
            ->getJson('/api/admin-reports/predictive-insights?branch_id=all&horizon_days=7')
            ->assertOk()
            ->assertJsonPath('status', 'insufficient_data')
            ->assertJsonPath('historical_basis.days_used', 4);
        $this->assertSame([], $insufficient->json('volume_forecast'));

        Cache::flush();
        $seed(902, 'success', 20, 5);

        $this->actingAs($this->superAdmin, 'api')
            ->getJson('/api/admin-reports/predictive-insights?branch_id=all&horizon_days=7')
            ->assertOk()
            ->assertJsonPath('status', 'success')
            ->assertJsonPath('historical_basis.days_used', 20)
            ->assertJsonCount(7, 'volume_forecast');
    }

    /**
     * AC-1, AC-3: SuperAdmin can query All Branches (global scope) across facilities combined.
     */
    public function test_superadmin_can_query_all_branches_scope(): void
    {
        $now = Carbon::now();

        // Seed ticket in branch 901
        DB::table('tickets')->insert([
            'ticket_number' => 'TCK-ALL-901',
            'title' => 'Branch 901 Ticket',
            'description' => 'Test 901',
            'problem_category_ID' => 1,
            'machine_ID' => null,
            'created_by' => 1,
            'assigned_to' => $this->technician->emp_id,
            'branch_id' => 901,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1,
            'priority_ID' => 1,
            'created_at' => $now->copy()->subHours(2),
            'updated_at' => $now,
        ]);

        // Seed ticket in branch 902
        DB::table('tickets')->insert([
            'ticket_number' => 'TCK-ALL-902',
            'title' => 'Branch 902 Ticket',
            'description' => 'Test 902',
            'problem_category_ID' => 1,
            'machine_ID' => null,
            'created_by' => 1,
            'assigned_to' => $this->technician->emp_id,
            'branch_id' => 902,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1,
            'priority_ID' => 1,
            'created_at' => $now->copy()->subHours(1),
            'updated_at' => $now,
        ]);

        $response = $this->actingAs($this->superAdmin, 'api')
            ->getJson('/api/admin/dashboard?branch_id=all&preset=Last+7+Days&force_refresh=true')
            ->assertOk();

        $this->assertSame('all', $response->json('branch.slug'));
        $this->assertSame('All Branches', $response->json('branch.name'));
        $this->assertGreaterThanOrEqual(2, $response->json('kpis.total_tickets'));
    }

    /**
     * AC-2: Regular admin assigned to Branch A attempting to query Branch B or All Branches gets HTTP 403.
     */
    public function test_admin_branch_isolation_blocks_cross_branch_query_and_all_branches(): void
    {
        // Admin assigned to 901 attempting to query branch 902
        $this->actingAs($this->admin, 'api')
            ->getJson('/api/admin/dashboard?branch_id=902')
            ->assertForbidden();

        // Admin assigned to 901 attempting to query branch_id=all
        $this->actingAs($this->admin, 'api')
            ->getJson('/api/admin/dashboard?branch_id=all')
            ->assertForbidden();

        // Admin attempting to query employee performance on another branch
        $this->actingAs($this->admin, 'api')
            ->getJson('/api/admin-reports/employees?branch_id=902')
            ->assertForbidden();

        // Admin attempting to query departments performance with branch=all
        $this->actingAs($this->admin, 'api')
            ->getJson('/api/admin-reports/departments?branch=all')
            ->assertForbidden();
    }

    /**
     * AC-7, AC-8: Synchronous ETL trigger executes calculations and clears caches.
     */
    public function test_synchronous_etl_trigger_endpoint_executes_and_invalidates_cache(): void
    {
        $response = $this->actingAs($this->superAdmin, 'api')
            ->postJson('/api/etl/trigger', [
                'full_sync' => true,
                'branch_id' => 'all',
            ])
            ->assertOk()
            ->assertJson([
                'status' => 'success',
                'message' => 'ETL synchronization completed successfully.',
            ]);

        $this->assertArrayHasKey('records_processed', $response->json());
        $this->assertArrayHasKey('duration_ms', $response->json());
        $this->assertArrayHasKey('timestamp', $response->json());
    }

    /**
     * AC-7: Non-superadmin Admin cannot trigger ETL for other branches.
     */
    public function test_regular_admin_cannot_trigger_etl_for_other_branches(): void
    {
        $this->actingAs($this->admin, 'api')
            ->postJson('/api/etl/trigger', [
                'branch_id' => 902,
            ])
            ->assertForbidden();
    }

    /**
     * Spec 0025 (AC-2, AC-3, AC-4): Employee performance excludes inactive/admin/CS accounts and never falls back to fake names.
     */
    public function test_employee_performance_excludes_inactive_and_non_technician_roles_and_removes_fake_names(): void
    {
        // Insert an inactive technician and a Customer Service employee in branch 901
        Employee::create([
            'emp_id' => 9910,
            'first_name' => 'Inactive',
            'last_name' => 'Tech',
            'email' => 'inactive.tech@example.com',
            'password_hash' => 'hashed',
            'department' => 'Service',
            'role' => 'Technician',
            'branch_id' => 901,
            'branch' => 'Cebu Branch',
            'is_active' => 0,
        ]);

        Employee::create([
            'emp_id' => 9911,
            'first_name' => 'Customer',
            'last_name' => 'Agent',
            'email' => 'cs.agent@example.com',
            'password_hash' => 'hashed',
            'department' => 'Customer Service',
            'role' => 'Customer Service',
            'branch_id' => 901,
            'branch' => 'Cebu Branch',
            'is_active' => 1,
        ]);

        $response = $this->actingAs($this->admin, 'api')
            ->getJson('/api/admin-reports/employees?preset=Last+30+Days&force_refresh=true')
            ->assertOk();

        $names = collect($response->json('employees'))->pluck('name')->all();
        $this->assertContains('Bob Tech', $names);
        $this->assertNotContains('Inactive Tech', $names);
        $this->assertNotContains('Customer Agent', $names);
        $this->assertNotContains('Alice Admin', $names);
        $this->assertNotContains('Mark Reyes', $names);
    }

    /**
     * Spec 0025 (AC-5, AC-12): Unified admin dashboard embeds employee_performance.employees, departments, and branch_comparisons.
     */
    public function test_unified_admin_dashboard_embeds_employees_departments_and_superadmin_branch_comparisons(): void
    {
        $response = $this->actingAs($this->superAdmin, 'api')
            ->getJson('/api/admin/dashboard?branch_id=all&preset=Last+7+Days&force_refresh=true')
            ->assertOk();

        $this->assertIsArray($response->json('employee_performance.employees'));
        $this->assertIsArray($response->json('departments'));
        $this->assertIsArray($response->json('branch_comparisons'));
        $this->assertNotEmpty($response->json('branch_comparisons'));
    }

    /**
     * Spec 0025 (AC-8, AC-10, AC-12, AC-13): Live operational reports return tabular headers/rows for all 6 report types and enforce branch isolation.
     */
    public function test_live_admin_reports_returns_structured_rows_for_all_six_report_types_and_enforces_branch_isolation(): void
    {
        $reportTypes = [
            'ticket_volume',
            'sla_compliance',
            'department_performance',
            'equipment_maintenance',
            'csat_satisfaction',
            'predictive_risk',
        ];

        $this->withoutExceptionHandling();
        foreach ($reportTypes as $type) {
            $res = $this->actingAs($this->superAdmin, 'api')
                ->getJson("/api/admin/reports?report_type={$type}&preset=Last+30+Days&branch_id=all&force_refresh=true")
                ->assertOk();

            $this->assertSame('success', $res->json('status'));
            $this->assertSame($type, $res->json('report_type'));
            $this->assertIsArray($res->json('headers'));
            $this->assertNotEmpty($res->json('headers'));
            $this->assertIsArray($res->json('rows'));
        }
        $this->withExceptionHandling();

        // Branch isolation check on /api/admin/reports for regular Admin
        $this->actingAs($this->admin, 'api')
            ->getJson('/api/admin/reports?report_type=ticket_volume&branch_id=all')
            ->assertForbidden();

        $this->actingAs($this->admin, 'api')
            ->getJson('/api/admin/reports?report_type=ticket_volume&branch_id=902')
            ->assertForbidden();
    }

    /**
     * Regression: a non admin employee must not read the branch dashboard.
     */
    public function test_admin_dashboard_rejects_non_admin_roles(): void
    {
        $this->actingAs($this->regularStaff, 'api')
            ->getJson('/api/admin/dashboard')
            ->assertForbidden();

        $this->actingAs($this->admin, 'api')
            ->getJson('/api/admin/dashboard')
            ->assertOk();
    }

    /**
     * Regression: CS dashboard and incoming queue must require a token.
     */
    public function test_cs_dashboard_routes_require_authentication(): void
    {
        $this->getJson('/api/cs-dashboard')->assertUnauthorized();
        $this->getJson('/api/cs-incoming')->assertUnauthorized();
    }

    /**
     * Regression: date_from and date_to without a preset must be honoured as a custom range
     * (this is exactly how the Admin dashboard sends Custom Range).
     */
    public function test_dates_without_preset_are_treated_as_custom_range(): void
    {
        Cache::flush();
        $query = 'date_from=2026-01-01&date_to=2026-01-31';

        $dashboard = $this->actingAs($this->admin, 'api')
            ->getJson("/api/admin/dashboard?{$query}")
            ->assertOk();
        $this->assertSame('Custom Range', $dashboard->json('period.preset'));
        $this->assertStringStartsWith('2026-01-01', $dashboard->json('period.date_from'));
        $this->assertStringStartsWith('2026-01-31', $dashboard->json('period.date_to'));

        foreach (['/api/admin-reports/employees', '/api/admin-reports/departments', '/api/admin/reports?report_type=ticket_volume'] as $path) {
            $separator = str_contains($path, '?') ? '&' : '?';
            $response = $this->actingAs($this->admin, 'api')
                ->getJson("{$path}{$separator}{$query}")
                ->assertOk();
            $period = $response->json('period') ?? $response->json();
            $this->assertSame('Custom Range', $period['preset'], "{$path} ignored the custom dates");
            $this->assertStringStartsWith('2026-01-01', $period['date_from']);
        }
    }

    /**
     * Spec 0029 AC-6: the comparative list sorts by the requested metric and keeps "no data" rows last.
     */
    public function test_employee_list_sorts_by_metric_and_keeps_no_data_rows_last(): void
    {
        $now = Carbon::now();
        $sortTicket = DB::table('tickets')->insertGetId([
            'ticket_number' => 'TCK-SORT-001',
            'title' => 'Sort fixture',
            'description' => 'Sort fixture',
            'problem_category_ID' => 1,
            'created_by' => 1,
            'assigned_to' => $this->technician->emp_id,
            'branch_id' => 901,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1,
            'priority_ID' => 1,
            'created_at' => $now->copy()->subDay(),
            'updated_at' => $now,
        ]);
        // Spec 0039: an accepted, still open period gives the technician a 0% resolution rate.
        $this->period($sortTicket, $this->technician->emp_id, $now->copy()->subDay(), $now->copy()->subDay()->addMinutes(10));

        foreach (['asc', 'desc'] as $dir) {
            $rows = $this->actingAs($this->admin, 'api')
                ->getJson("/api/admin-reports/employees?preset=Last 7 Days&sort_by=resolution_rate&sort_dir={$dir}&force_refresh=true")
                ->assertOk()
                ->assertJsonPath('sort_by', 'resolution_rate')
                ->assertJsonPath('sort_dir', $dir)
                ->json('employees');

            $values = array_column($rows, 'resolution_rate');
            $firstNull = array_search(null, $values, true);
            $this->assertNotFalse($firstNull, 'fixture should include an employee with no data');
            $this->assertGreaterThan(0, $firstNull, 'employees with data come first');
            foreach (array_slice($values, $firstNull) as $v) {
                $this->assertNull($v, 'no data rows stay at the end');
            }

            $numeric = array_slice($values, 0, $firstNull);
            $expected = $numeric;
            $dir === 'asc' ? sort($expected) : rsort($expected);
            $this->assertEquals($expected, $numeric);
        }

        $this->actingAs($this->admin, 'api')
            ->getJson('/api/admin-reports/employees?preset=Last 7 Days&sort_by=not_a_column&force_refresh=true')
            ->assertOk();
    }

    /** Spec 0039: one holding period row for an employee on a ticket. */
    private function period(int $ticketId, int $employeeId, Carbon $assignedAt, ?Carbon $acceptedAt = null, ?Carbon $releasedAt = null, ?string $reason = null): void
    {
        DB::table('ticket_assignment_periods')->insert([
            'ticket_ID' => $ticketId,
            'employee_ID' => $employeeId,
            'assigned_at' => $assignedAt,
            'accepted_at' => $acceptedAt,
            'released_at' => $releasedAt,
            'release_reason' => $reason,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
