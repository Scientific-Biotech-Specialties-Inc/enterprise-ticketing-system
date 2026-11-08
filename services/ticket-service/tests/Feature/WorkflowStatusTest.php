<?php

namespace Tests\Feature;

use App\Models\Employee;
use App\Models\WorkflowStatus;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\TestCase;

class WorkflowStatusTest extends TestCase
{
    use DatabaseTransactions;

    protected Employee $superAdmin;
    protected Employee $regularStaff;

    protected function setUp(): void
    {
        parent::setUp();

        $this->superAdmin = Employee::where('role', 'superadmin')->first()
            ?? Employee::create([
                'emp_id' => 88881,
                'first_name' => 'Super',
                'last_name' => 'Admin',
                'email' => 'superadmin_wf@example.com',
                'role' => 'superadmin',
                'department' => 'Executive',
                'is_active' => true,
                'password_hash' => 'secret',
            ]);

        $this->regularStaff = Employee::where('role', '!=', 'superadmin')->first()
            ?? Employee::create([
                'emp_id' => 88882,
                'first_name' => 'Regular',
                'last_name' => 'Staff',
                'email' => 'staff_wf@example.com',
                'role' => 'technician',
                'department' => 'IT Support',
                'is_active' => true,
                'password_hash' => 'secret',
            ]);
    }

    public function test_get_workflow_statuses_auto_seeds_canonical_six_and_marks_is_system(): void
    {
        $response = $this->actingAs($this->superAdmin, 'api')
            ->getJson('/api/superadmin/workflow-statuses');

        $response->assertStatus(200);
        $statuses = $response->json('workflow_statuses');

        $this->assertNotEmpty($statuses);

        $names = array_column($statuses, 'name');
        $this->assertContains('New', $names);
        $this->assertContains('Assigned', $names);
        $this->assertContains('Pending Reassignment', $names);
        $this->assertContains('In Progress', $names);
        $this->assertContains('Pending Parts', $names);
        $this->assertContains('Pending Evaluation', $names);
        $this->assertContains('Resolved', $names);
        $this->assertContains('Closed', $names);

        foreach ($statuses as $s) {
            if (in_array($s['name'], ['New', 'Assigned', 'Pending Reassignment', 'In Progress', 'Pending Parts', 'Pending Evaluation', 'Resolved', 'Closed'])) {
                $this->assertTrue((bool)$s['is_system']);
            }
        }
    }

    public function test_deleting_system_workflow_status_is_forbidden_and_returns_422(): void
    {
        $this->actingAs($this->superAdmin, 'api')->getJson('/api/superadmin/workflow-statuses');

        $systemStatus = WorkflowStatus::where('name', 'In Progress')->firstOrFail();

        $response = $this->actingAs($this->superAdmin, 'api')
            ->deleteJson("/api/superadmin/workflow-statuses/{$systemStatus->id}");

        $response->assertStatus(422)
            ->assertJson([
                'message' => 'Core system workflow statuses cannot be deleted.'
            ]);

        $this->assertDatabaseHas('workflow_statuses', ['id' => $systemStatus->id]);
    }

    public function test_create_custom_workflow_status_with_prerequisite(): void
    {
        $this->actingAs($this->superAdmin, 'api')->getJson('/api/superadmin/workflow-statuses');

        $inProgress = WorkflowStatus::where('name', 'In Progress')->firstOrFail();

        $response = $this->actingAs($this->superAdmin, 'api')
            ->postJson('/api/superadmin/workflow-statuses', [
                'name' => 'Quality Review',
                'description' => 'Awaiting QA sign-off',
                'bg_color' => '#E0E7FF',
                'text_color' => '#3730A3',
                'order_position' => 8,
                'requires_previous_fulfilled' => true,
                'prerequisite_status_id' => $inProgress->id,
            ]);

        $response->assertStatus(201);
        $created = $response->json('workflow_status');

        $this->assertEquals('Quality Review', $created['name']);
        $this->assertFalse((bool)$created['is_system']);
        $this->assertTrue((bool)$created['requires_previous_fulfilled']);
        $this->assertEquals($inProgress->id, $created['prerequisite_status_id']);
    }

    public function test_cannot_set_status_as_its_own_prerequisite(): void
    {
        $this->actingAs($this->superAdmin, 'api')->getJson('/api/superadmin/workflow-statuses');

        $custom = WorkflowStatus::create([
            'name' => 'Custom Stage',
            'order_position' => 10,
            'is_system' => false,
        ]);

        $response = $this->actingAs($this->superAdmin, 'api')
            ->putJson("/api/superadmin/workflow-statuses/{$custom->id}", [
                'name' => 'Custom Stage',
                'prerequisite_status_id' => $custom->id,
            ]);

        $response->assertStatus(422)
            ->assertJson([
                'message' => 'A status cannot have itself as a prerequisite.'
            ]);
    }

    public function test_cannot_delete_status_if_another_status_requires_it_as_prerequisite(): void
    {
        $this->actingAs($this->superAdmin, 'api')->getJson('/api/superadmin/workflow-statuses');

        $parent = WorkflowStatus::create([
            'name' => 'Stage Alpha',
            'order_position' => 15,
            'is_system' => false,
        ]);

        $child = WorkflowStatus::create([
            'name' => 'Stage Beta',
            'order_position' => 16,
            'is_system' => false,
            'requires_previous_fulfilled' => true,
            'prerequisite_status_id' => $parent->id,
        ]);

        $response = $this->actingAs($this->superAdmin, 'api')
            ->deleteJson("/api/superadmin/workflow-statuses/{$parent->id}");

        $response->assertStatus(422)
            ->assertJsonFragment([
                'message' => "Cannot delete status 'Stage Alpha' because status 'Stage Beta' requires it as a prerequisite."
            ]);

        $this->assertDatabaseHas('workflow_statuses', ['id' => $parent->id]);
    }

    public function test_reset_defaults_endpoint_restores_canonical_statuses(): void
    {
        $response = $this->actingAs($this->superAdmin, 'api')
            ->postJson('/api/superadmin/workflow-statuses/reset-defaults');

        $response->assertStatus(200)
            ->assertJsonFragment([
                'message' => 'Canonical workflow statuses restored successfully.',
            ]);
    }

    public function test_non_superadmin_is_forbidden(): void
    {
        $response = $this->actingAs($this->regularStaff, 'api')
            ->getJson('/api/superadmin/workflow-statuses');

        $response->assertStatus(403);
    }
}
