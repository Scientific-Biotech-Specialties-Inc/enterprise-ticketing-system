<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Client;
use App\Models\Employee;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class SuperAdminDashboardTest extends TestCase
{
    use DatabaseTransactions;

    protected Employee $superAdmin;
    protected Employee $regularAdmin;
    protected Employee $technician;
    protected Client $customer;

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'mysql']);
        config(['database.connections.mysql.database' => 'ticketing_system_test']);
        DB::purge('mysql');
        DB::reconnect('mysql');

        Cache::flush();

        $testEmails = [
            'super.admin.0024@example.com',
            'branch.admin.0024@example.com',
            'tech.employee.0024@example.com',
        ];

        DB::table('ticket_audit_logs')->whereIn('ticket_ID', function ($q) {
            $q->select('ticket_ID')->from('tickets')->whereIn('branch_id', [911, 912]);
        })->delete();

        DB::table('tickets')->whereIn('branch_id', [911, 912])->delete();
        DB::table('employees')->whereIn('email', $testEmails)->delete();

        // Setup test branches
        DB::table('branches')->updateOrInsert(
            ['id' => 911],
            [
                'slug' => 'branch-alpha-911',
                'name' => 'Branch Alpha',
                'code' => 'BAL',
                'region' => 'North',
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        DB::table('branches')->updateOrInsert(
            ['id' => 912],
            [
                'slug' => 'branch-beta-912',
                'name' => 'Branch Beta',
                'code' => 'BBE',
                'region' => 'South',
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );

        // Core lookup entities
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

        DB::table('clients')->updateOrInsert(
            ['id' => 9101],
            [
                'client_name' => 'SuperAdmin Test Customer',
                'email' => 'customer.0024@example.com',
                'contact_number' => '5551234567',
                'address' => '123 Customer St',
                'status' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
        $this->customer = Client::find(9101);

        $this->superAdmin = Employee::create([
            'emp_id' => 89001,
            'first_name' => 'Sam',
            'last_name' => 'Super',
            'email' => 'super.admin.0024@example.com',
            'role' => 'superadmin',
            'department' => 'Executive',
            'branch_id' => 911,
            'branch' => 'branch-alpha-911',
            'is_active' => 1,
            'password_hash' => bcrypt('password'),
        ]);

        $this->regularAdmin = Employee::create([
            'emp_id' => 89002,
            'first_name' => 'Rachel',
            'last_name' => 'Admin',
            'email' => 'branch.admin.0024@example.com',
            'role' => 'admin',
            'department' => 'Operations',
            'branch_id' => 911,
            'branch' => 'branch-alpha-911',
            'is_active' => 1,
            'password_hash' => bcrypt('password'),
        ]);

        $this->technician = Employee::create([
            'emp_id' => 89003,
            'first_name' => 'Tom',
            'last_name' => 'Tech',
            'email' => 'tech.employee.0024@example.com',
            'role' => 'technician',
            'department' => 'Service',
            'branch_id' => 911,
            'branch' => 'branch-alpha-911',
            'is_active' => 1,
            'password_hash' => bcrypt('password'),
        ]);
    }

    /**
     * AC-1, AC-1.1: Super Admin receives complete system wide dashboard payload.
     */
    public function test_superadmin_can_access_system_wide_dashboard(): void
    {
        $now = Carbon::now();

        // Seed tickets across branches
        DB::table('tickets')->insert([
            'ticket_number' => 'TCK-SADM-001',
            'title' => 'Server Overheat Incident',
            'description' => 'Main server rack temperature exceeded safety threshold',
            'created_by' => 9101,
            'assigned_to' => $this->technician->emp_id,
            'branch_id' => 911,
            'problem_category_ID' => 1,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 2,
            'priority_ID' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        DB::table('tickets')->insert([
            'ticket_number' => 'TCK-SADM-002',
            'title' => 'Network Switch Failure',
            'description' => 'South branch switch unreachable',
            'created_by' => 9101,
            'assigned_to' => null,
            'branch_id' => 912,
            'problem_category_ID' => 1,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1,
            'priority_ID' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $response = $this->actingAs($this->superAdmin, 'api')
            ->getJson('/api/superadmin/system-dashboard?force_refresh=true')
            ->assertOk()
            ->assertJsonStructure([
                'status',
                'summary' => [
                    'total_tickets',
                    'active_tickets',
                    'escalated_tickets',
                    'sla_breaches',
                    'tickets_created_today',
                    'users_by_role' => [
                        'superadmin',
                        'admin',
                        'cs',
                        'employee',
                        'customer',
                        'total',
                    ],
                ],
                'kpis' => [
                    'sla_compliance_rate',
                    'avg_resolution_hours',
                    'csat_score',
                ],
                'branch_comparisons' => [
                    '*' => [
                        'branch_id',
                        'branch_name',
                        'branch_code',
                        'total_tickets',
                        'active_tickets',
                        'escalated_tickets',
                        'sla_breaches',
                        'sla_compliance_rate',
                        'avg_resolution_hours',
                        'csat_score',
                    ],
                ],
                'recent_activity',
                'meta' => [
                    'cached',
                    'generated_at',
                    'filters_applied',
                ],
            ]);

        $data = $response->json();
        $this->assertEquals('success', $data['status']);
        $this->assertGreaterThanOrEqual(2, $data['summary']['total_tickets']);
        $this->assertGreaterThanOrEqual(1, $data['summary']['tickets_created_today']);
    }

    /**
     * AC-4, AC-1.8: Non Super Admin roles are rejected with HTTP 403 Forbidden.
     */
    public function test_regular_admin_and_customer_denied_access(): void
    {
        // Branch Admin denied
        $this->actingAs($this->regularAdmin, 'api')
            ->getJson('/api/superadmin/system-dashboard')
            ->assertStatus(403)
            ->assertJson([
                'status' => 'error',
            ]);

        // Customer denied
        $this->actingAs($this->customer, 'api')
            ->getJson('/api/superadmin/system-dashboard')
            ->assertStatus(403);
    }

    /**
     * AC-2, AC-1.3: tickets_created_today remains strictly anchored to current date.
     */
    public function test_tickets_created_today_anchored_regardless_of_date_filter(): void
    {
        $now = Carbon::now();

        // 1 ticket created today
        DB::table('tickets')->insert([
            'ticket_number' => 'TCK-TODAY-001',
            'title' => 'Today Ticket',
            'description' => 'Created today',
            'created_by' => 9101,
            'branch_id' => 911,
            'problem_category_ID' => 1,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1,
            'priority_ID' => 1,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        // 2 tickets created 30 days ago
        DB::table('tickets')->insert([
            'ticket_number' => 'TCK-PAST-001',
            'title' => 'Past Ticket 1',
            'description' => 'Created in past',
            'created_by' => 9101,
            'branch_id' => 911,
            'problem_category_ID' => 1,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 3,
            'priority_ID' => 1,
            'created_at' => $now->copy()->subDays(30),
            'resolved_at' => $now->copy()->subDays(29),
            'updated_at' => $now->copy()->subDays(29),
        ]);

        // Request dashboard with date filter pointing to the past 35 days to 25 days ago
        $from = $now->copy()->subDays(35)->toDateString();
        $to = $now->copy()->subDays(25)->toDateString();

        $response = $this->actingAs($this->superAdmin, 'api')
            ->getJson("/api/superadmin/system-dashboard?date_from={$from}&date_to={$to}&force_refresh=true")
            ->assertOk();

        $summary = $response->json('summary');
        // Filtered tickets count is from the past range
        $this->assertEquals(1, $summary['total_tickets']);
        // But tickets_created_today MUST reflect today (at least 1)
        $this->assertGreaterThanOrEqual(1, $summary['tickets_created_today']);
    }

    /**
     * AC-3, AC-1.6: Sort branch comparisons on valid metric and reject invalid sort with 422.
     */
    public function test_branch_comparisons_sorting_and_validation(): void
    {
        // Sort descending by branch_name
        $resp = $this->actingAs($this->superAdmin, 'api')
            ->getJson('/api/superadmin/system-dashboard?sort_by=branch_name&sort_dir=asc&force_refresh=true')
            ->assertOk();

        $branches = $resp->json('branch_comparisons');
        $this->assertNotEmpty($branches);

        // Invalid sort_by string returns 422
        $this->actingAs($this->superAdmin, 'api')
            ->getJson('/api/superadmin/system-dashboard?sort_by=malicious_sql_injection_attempt')
            ->assertStatus(422)
            ->assertJsonValidationErrors(['sort_by']);
    }

    public function test_period_and_date_range_query_names_select_the_window(): void
    {
        foreach (['period', 'date_range'] as $name) {
            $this->actingAs($this->superAdmin, 'api')
                ->getJson('/api/superadmin/system-dashboard?' . $name . '=This%20Month')
                ->assertStatus(200)
                ->assertJsonPath('meta.filters_applied.preset', 'this_month');
        }
    }
}
