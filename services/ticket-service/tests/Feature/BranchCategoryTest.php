<?php

namespace Tests\Feature;

use App\Events\BranchCategoryChanged;
use App\Events\BranchSlaPolicyChanged;
use App\Models\Employee;
use App\Services\BranchCategoryService;
use App\Services\SLAService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

class BranchCategoryTest extends TestCase
{
    use DatabaseTransactions;

    protected Employee $superAdmin;
    protected Employee $regularEmployee;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seedBranch('luzon', 'Luzon Regional Center', 'LUZ');
        $this->seedBranch('visayas', 'Visayas Medical Hub', 'VIS');
        $this->seedBranch('main', 'Main Branch', 'MAIN');

        $this->superAdmin = Employee::where('role', 'superadmin')->first()
            ?? Employee::create([
                'emp_id' => 99981,
                'first_name' => 'Super',
                'last_name' => 'Admin',
                'email' => 'superadmin_cat_test@example.com',
                'role' => 'superadmin',
                'department' => 'Executive',
                'is_active' => true,
                'password_hash' => 'secret',
            ]);

        $this->regularEmployee = Employee::where('role', '!=', 'superadmin')->first()
            ?? Employee::create([
                'emp_id' => 99982,
                'first_name' => 'Regular',
                'last_name' => 'Staff',
                'email' => 'staff_cat_test@example.com',
                'role' => 'service',
                'department' => 'Service',
                'is_active' => true,
                'password_hash' => 'secret',
            ]);

        $itCat = \Illuminate\Support\Facades\DB::table('problem_categories')->where('category_name', 'IT')->first();
        if (!$itCat) {
            $itCatId = \Illuminate\Support\Facades\DB::table('problem_categories')->insertGetId([
                'category_name' => 'IT',
                'description' => 'Information Technology',
                'is_system_default' => 1,
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            \Illuminate\Support\Facades\DB::table('branch_sla_policies')->where('category_name', 'IT')->update(['category_id' => $itCatId]);
        }

        $this->seedLuzonBranchFixtures();
    }

    /**
     * Mirror the luzon seed data from the 2026_10_05_000003 migration. The shared test database
     * does not keep it, and these tests depend on it.
     */
    private function seedLuzonBranchFixtures(): void
    {
        $db = \Illuminate\Support\Facades\DB::class;
        $itCatId = $db::table('problem_categories')->where('category_name', 'IT')->value('problem_category_ID');

        foreach ([1 => 'Low', 2 => 'Medium', 3 => 'High', 4 => 'Critical'] as $pid => $pname) {
            if ($db::table('ticket_priorities')->where('priority_ID', $pid)->doesntExist()) {
                $db::table('ticket_priorities')->insert(['priority_ID' => $pid, 'priority_name' => $pname, 'created_at' => now(), 'updated_at' => now()]);
            }
        }

        $categoryIds = [];
        foreach ([
            'Biomedical Facility Maintenance' => 'Specialized biomedical hardware and clinical facility maintenance',
            'Radiology Support' => 'Imaging equipment calibration and radiology software support',
        ] as $name => $description) {
            $categoryIds[$name] = $db::table('problem_categories')
                ->where('branch_id', 'luzon')->where('category_name', $name)->value('problem_category_ID')
                ?? $db::table('problem_categories')->insertGetId([
                    'category_name' => $name, 'branch_id' => 'luzon', 'description' => $description,
                    'is_active' => true, 'is_system_default' => false,
                    'created_at' => now(), 'updated_at' => now(),
                ]);
        }

        $db::table('branch_sla_policies')->updateOrInsert(
            ['branch_id' => 'luzon', 'category_name' => 'IT', 'priority' => 'High'],
            ['category_id' => $itCatId, 'resolution_time_limit' => 360, 'response_time_limit' => 30, 'created_at' => now(), 'updated_at' => now()]
        );
        $db::table('branch_sla_policies')->updateOrInsert(
            ['branch_id' => 'luzon', 'category_name' => 'Biomedical Facility Maintenance', 'priority' => 'Critical'],
            ['category_id' => $categoryIds['Biomedical Facility Maintenance'], 'resolution_time_limit' => 120, 'response_time_limit' => 15, 'created_at' => now(), 'updated_at' => now()]
        );
    }

    public function test_unauthenticated_is_rejected(): void
    {
        $this->getJson('/api/superadmin/branches/luzon/categories')->assertStatus(401);
        $this->postJson('/api/superadmin/branches/luzon/categories', ['category_name' => 'Test'])->assertStatus(401);
        $this->postJson('/api/superadmin/branches/luzon/sla-policies', [])->assertStatus(401);
    }

    public function test_non_superadmin_is_forbidden(): void
    {
        $this->actingAs($this->regularEmployee, 'api')
            ->getJson('/api/superadmin/branches/luzon/categories')
            ->assertStatus(403);

        $this->actingAs($this->regularEmployee, 'api')
            ->postJson('/api/superadmin/branches/luzon/categories', ['category_name' => 'Test'])
            ->assertStatus(403);
    }

    public function test_list_categories_and_sla_policies_with_fallback(): void
    {
        $res = $this->actingAs($this->superAdmin, 'api')
            ->getJson('/api/superadmin/branches/luzon/categories')
            ->assertOk();

        $categories = collect($res->json('categories'));
        $this->assertTrue($categories->pluck('name')->contains('IT'));
        $this->assertTrue($categories->pluck('name')->contains('Biomedical Facility Maintenance'));

        // Check SLA policies matrix
        $slaPolicies = collect($res->json('slaPolicies'));
        $this->assertNotEmpty($slaPolicies);

        // IT High was seeded as 360m override
        $itHigh = $slaPolicies->first(fn ($p) => $p['categoryName'] === 'IT' && $p['priority'] === 'High');
        $this->assertNotNull($itHigh);
        $this->assertTrue($itHigh['isOverride']);
        $this->assertSame(360, $itHigh['resolutionTimeLimit']);

        // IT Low has no override, falls back to system default (4320m)
        $itLow = $slaPolicies->first(fn ($p) => $p['categoryName'] === 'IT' && $p['priority'] === 'Low');
        $this->assertNotNull($itLow);
        $this->assertFalse($itLow['isOverride']);
        $this->assertSame(4320, $itLow['resolutionTimeLimit']);

        // Check SLA change policy metadata
        $policy = $res->json('slaChangePolicy');
        $this->assertSame('new_tickets_only', $policy['mode']);
        $this->assertFalse($policy['recalculatesExistingOpenTickets']);
        $this->assertNotEmpty($policy['tooltip']);
    }

    public function test_create_branch_specific_category(): void
    {
        Event::fake([BranchCategoryChanged::class]);

        $payload = [
            'category_name' => 'Cardiology Lab Equipment',
            'description' => 'Diagnostic sensors, ECG monitors, and ultrasound hardware.',
        ];

        $res = $this->actingAs($this->superAdmin, 'api')
            ->postJson('/api/superadmin/branches/luzon/categories', $payload)
            ->assertStatus(201);

        $created = $res->json('category');
        $this->assertSame('Cardiology Lab Equipment', $created['name']);
        $this->assertSame('luzon', $created['branch_id']);

        $this->assertDatabaseHas('problem_categories', [
            'category_name' => 'Cardiology Lab Equipment',
            'branch_id' => 'luzon',
        ]);

        Event::assertDispatched(BranchCategoryChanged::class, function ($e) {
            return $e->action === BranchCategoryChanged::ACTION_CREATED
                && $e->branchId === 'luzon'
                && ($e->after['name'] ?? null) === 'Cardiology Lab Equipment';
        });

        // Verify audit log
        $log = DB::table('ticket_audit_logs')
            ->where('details', 'like', '%Cardiology Lab Equipment%')
            ->latest('log_ID')
            ->first();
        $this->assertNotNull($log);
        $details = json_decode($log->details, true);
        $this->assertSame('luzon', $details['branch_id']);
        $this->assertSame((int) $this->superAdmin->emp_id, (int) $details['acting_admin']['id']);
    }

    public function test_create_system_wide_category(): void
    {
        $payload = [
            'category_name' => 'Global IT Facilities',
            'description' => 'Available system-wide across all company branches.',
        ];

        $res = $this->actingAs($this->superAdmin, 'api')
            ->postJson('/api/superadmin/branches/system/categories', $payload)
            ->assertStatus(201);

        $created = $res->json('category');
        $this->assertNull($created['branch_id']);

        $this->assertDatabaseHas('problem_categories', [
            'category_name' => 'Global IT Facilities',
            'branch_id' => null,
        ]);
    }

    public function test_update_category(): void
    {
        Event::fake([BranchCategoryChanged::class]);

        $catId = DB::table('problem_categories')->insertGetId([
            'category_name' => 'Original Diagnostics Name',
            'description' => 'Original desc',
            'branch_id' => 'luzon',
            'is_active' => true,
            'is_system_default' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $res = $this->actingAs($this->superAdmin, 'api')
            ->putJson("/api/superadmin/branches/luzon/categories/{$catId}", [
                'category_name' => 'Updated Diagnostics Name',
                'description' => 'Updated desc',
            ])
            ->assertOk();

        $this->assertSame('Updated Diagnostics Name', $res->json('category.name'));
        $this->assertDatabaseHas('problem_categories', [
            'problem_category_ID' => $catId,
            'category_name' => 'Updated Diagnostics Name',
        ]);

        Event::assertDispatched(BranchCategoryChanged::class, function ($e) {
            return $e->action === BranchCategoryChanged::ACTION_UPDATED
                && $e->before['name'] === 'Original Diagnostics Name'
                && $e->after['name'] === 'Updated Diagnostics Name';
        });
    }

    public function test_category_removal_is_blocked_when_open_tickets_reference_it(): void
    {
        $catId = DB::table('problem_categories')
            ->where('branch_id', 'luzon')
            ->where('category_name', 'Biomedical Facility Maintenance')
            ->value('problem_category_ID');
        $this->assertNotNull($catId);

        // Ensure at least one open ticket references it
        $clientId = DB::table('clients')->value('id') ?? 1;
        $machineId = DB::table('machines')->value('machine_ID') ?? $this->seedMachine(1);
        DB::table('tickets')->insert([
            'ticket_number' => 'TEST-OPEN-999',
            'title' => 'Open Ticket Blocking Deletion',
            'problem_category_ID' => $catId,
            'branch_id' => 'luzon',
            'machine_ID' => $machineId,
            'created_by' => $clientId,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1, // Open
            'priority_ID' => 2,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Attempt deletion
        $res = $this->actingAs($this->superAdmin, 'api')
            ->deleteJson("/api/superadmin/branches/luzon/categories/{$catId}")
            ->assertStatus(409);

        $this->assertSame('CATEGORY_IN_USE_OPEN_TICKETS', $res->json('code'));
        $this->assertStringContainsString('referenced by', $res->json('message'));
        $this->assertGreaterThanOrEqual(1, $res->json('open_ticket_count'));
    }

    public function test_system_default_category_cannot_be_removed(): void
    {
        $res = $this->actingAs($this->superAdmin, 'api')
            ->deleteJson('/api/superadmin/branches/luzon/categories/1')
            ->assertStatus(422);

        $this->assertSame('SYSTEM_DEFAULT_PROTECTED', $res->json('code'));
    }

    public function test_category_removal_succeeds_when_no_open_tickets(): void
    {
        Event::fake([BranchCategoryChanged::class]);

        $catId = DB::table('problem_categories')->insertGetId([
            'category_name' => 'Deletable Category With Zero Tickets',
            'description' => 'No tickets created',
            'branch_id' => 'luzon',
            'is_active' => true,
            'is_system_default' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $res = $this->actingAs($this->superAdmin, 'api')
            ->deleteJson("/api/superadmin/branches/luzon/categories/{$catId}")
            ->assertOk();

        $this->assertSame('deleted', $res->json('result.status'));
        $this->assertDatabaseMissing('problem_categories', [
            'problem_category_ID' => $catId,
        ]);

        Event::assertDispatched(BranchCategoryChanged::class, function ($e) {
            return $e->action === BranchCategoryChanged::ACTION_REMOVED;
        });
    }

    public function test_create_and_delete_branch_sla_policy(): void
    {
        Event::fake([BranchSlaPolicyChanged::class]);

        // 1. Create SLA policy override for Luzon / IT / Critical
        $res = $this->actingAs($this->superAdmin, 'api')
            ->postJson('/api/superadmin/branches/luzon/sla-policies', [
                'category_name' => 'IT',
                'priority' => 'Critical',
                'resolution_time_limit' => 95,
                'response_time_limit' => 12,
            ])
            ->assertOk();

        $this->assertSame(95, $res->json('policy.resolution_time_limit'));
        $this->assertSame(12, $res->json('policy.response_time_limit'));

        $this->assertDatabaseHas('branch_sla_policies', [
            'branch_id' => 'luzon',
            'category_name' => 'IT',
            'priority' => 'Critical',
            'resolution_time_limit' => 95,
        ]);

        Event::assertDispatched(BranchSlaPolicyChanged::class, function ($e) {
            return $e->action === BranchSlaPolicyChanged::ACTION_SAVED
                && $e->branchId === 'luzon'
                && $e->categoryName === 'IT'
                && $e->priority === 'Critical';
        });

        // 2. Delete SLA policy override (reverting back to system-wide default)
        $delRes = $this->actingAs($this->superAdmin, 'api')
            ->deleteJson('/api/superadmin/branches/luzon/sla-policies', [
                'category_name' => 'IT',
                'priority' => 'Critical',
            ])
            ->assertOk();

        $this->assertDatabaseMissing('branch_sla_policies', [
            'branch_id' => 'luzon',
            'category_name' => 'IT',
            'priority' => 'Critical',
        ]);

        Event::assertDispatched(BranchSlaPolicyChanged::class, function ($e) {
            return $e->action === BranchSlaPolicyChanged::ACTION_REMOVED;
        });
    }

    public function test_sla_policy_change_affects_new_tickets_only_and_preserves_existing(): void
    {
        // 1. Set SLA policy override: Luzon + IT + High = 200m
        $this->actingAs($this->superAdmin, 'api')
            ->postJson('/api/superadmin/branches/luzon/sla-policies', [
                'category_name' => 'IT',
                'priority' => 'High',
                'resolution_time_limit' => 200,
                'response_time_limit' => 20,
            ])
            ->assertOk();

        $clientId = DB::table('clients')->value('id') ?? 1;
        $machineId = DB::table('machines')->value('machine_ID') ?? $this->seedMachine(1);
        $itCatId = (int) DB::table('problem_categories')->where('category_name', 'IT')->value('problem_category_ID');

        $ticketId = DB::table('tickets')->insertGetId([
            'ticket_number' => 'SLA-TEST-001',
            'title' => 'Testing SLA override stamping',
            'problem_category_ID' => $itCatId,
            'branch_id' => 'luzon',
            'machine_ID' => $machineId,
            'created_by' => $clientId,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1,
            'priority_ID' => 3, // High
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Assign SLA
        $slaService = app(SLAService::class);
        $res = $slaService->assignSlaToTicket($ticketId, 1, $itCatId, 'High', now(), null, 'luzon');
        $this->assertTrue($res['is_branch_override']);
        $this->assertSame(200, $res['resolution_time_limit']);

        $originalResolutionDueAt = DB::table('tickets')->where('ticket_ID', $ticketId)->value('resolution_due_at');

        // 2. Now change the SLA policy for future tickets: Luzon + IT + High = 500m
        $this->actingAs($this->superAdmin, 'api')
            ->postJson('/api/superadmin/branches/luzon/sla-policies', [
                'category_name' => 'IT',
                'priority' => 'High',
                'resolution_time_limit' => 500,
                'response_time_limit' => 45,
            ])
            ->assertOk();

        // 3. Verify existing open ticket keeps its original due date!
        $currentResolutionDueAt = DB::table('tickets')->where('ticket_ID', $ticketId)->value('resolution_due_at');
        $this->assertSame($originalResolutionDueAt, $currentResolutionDueAt, 'Existing ticket due date was altered, violating SLA integrity!');

        // 4. A newly created ticket receives the new SLA limit (500m)
        $ticketId2 = DB::table('tickets')->insertGetId([
            'ticket_number' => 'SLA-TEST-002',
            'title' => 'New Ticket receiving new policy',
            'problem_category_ID' => $itCatId,
            'branch_id' => 'luzon',
            'machine_ID' => $machineId,
            'created_by' => $clientId,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1,
            'priority_ID' => 3,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $res2 = $slaService->assignSlaToTicket($ticketId2, 1, $itCatId, 'High', now(), null, 'luzon');
        $this->assertSame(500, $res2['resolution_time_limit']);
    }
}
