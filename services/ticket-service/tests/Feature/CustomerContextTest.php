<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Employee;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class CustomerContextTest extends TestCase
{
    use DatabaseTransactions;
    protected function setUp(): void
    {
        parent::setUp();
        if (!DB::table('machine_categories')->where('category_ID', 1)->exists()) {
            DB::table('machine_categories')->insert([
                'category_ID' => 1,
                'category_name' => 'Imaging',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    /**
     * Test: Assigned employee can view customer contact details and machine context (TS029).
     */
    public function test_assigned_employee_can_view_customer_and_machine_context(): void
    {
        $uniqueSuffix = uniqid();
        $clientEmail = "contact_{$uniqueSuffix}@metrogeneral.org";

        // 1. Seed customer, machine, and ticket
        $clientId = DB::table('clients')->insertGetId([
            'client_name' => 'Metro General Hospital',
            'email' => $clientEmail,
            'contact_number' => '+63 917 123 4567',
            'address' => '123 Medical Boulevard, QC',
            'status' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $userId = DB::table('users')->insertGetId([
            'name' => 'Metro General Hospital',
            'email' => "user_{$uniqueSuffix}@metrogeneral.org",
            'password' => 'secret',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $machineId = DB::table('machines')->insertGetId([
            'category_ID' => 1,
            'client_ID' => $userId,
            'machine_name' => 'CT Scanner Pro',
            'serial_number' => 'CT-PRO-' . $uniqueSuffix,
            'model' => 'Revolution Apex',
            'brand' => 'GE Healthcare',
            'status' => 'active',
            'purchase_date' => now()->subYears(2),
            'last_maintenance_date' => now()->subMonths(3),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $assignedTech = Employee::firstOrCreate(
            ['email' => "assigned_tech_{$uniqueSuffix}@example.com"],
            [
                'first_name' => 'Roberto',
                'last_name' => 'Reyes',
                'role' => 'technician',
                'department' => 'Service',
                'is_active' => true,
            ]
        );

        $ticketId = DB::table('tickets')->insertGetId([
            'title' => 'CT Scanner Calibration Drift',
            'description' => 'Image slices showing irregular artifacts during calibration scan.',
            'created_by' => $clientId,
            'assigned_to' => $assignedTech->emp_id,
            'machine_ID' => $machineId,
            'problem_category_ID' => 1,
            'ticket_type_ID' => 2,
            'ticket_status_ID' => 2,
            'is_internal' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Prior ticket on this machine to verify history summary count
        DB::table('tickets')->insert([
            'title' => 'Previous Maintenance',
            'description' => 'Routine checkup completed',
            'created_by' => $clientId,
            'assigned_to' => $assignedTech->emp_id,
            'machine_ID' => $machineId,
            'problem_category_ID' => 1,
            'ticket_type_ID' => 2,
            'ticket_status_ID' => 3,
            'resolved_at' => now()->subMonths(1),
            'is_internal' => false,
            'created_at' => now()->subMonths(2),
            'updated_at' => now()->subMonths(1),
        ]);

        $response = $this->actingAs($assignedTech, 'api')
            ->getJson("/api/tickets/{$ticketId}/customer-context");

        $response->assertOk();
        $response->assertJson([
            'success' => true,
            'ticket_id' => $ticketId,
            'customer' => [
                'name' => 'Metro General Hospital',
                'email' => $clientEmail,
                'phone' => '+63 917 123 4567',
                'address' => '123 Medical Boulevard, QC',
            ],
            'machine' => [
                'linked' => true,
                'machine_name' => 'CT Scanner Pro',
                'brand' => 'GE Healthcare',
                'model' => 'Revolution Apex',
                'serial_number' => 'CT-PRO-' . $uniqueSuffix,
                'history_summary' => [
                    'past_ticket_count' => 1,
                ],
            ],
            'machine_message' => null,
        ]);

        // Sensitive billing data must strictly NOT exist in payload
        $this->assertArrayNotHasKey('billing_details', $response->json('customer'));
        $this->assertArrayNotHasKey('payment_method', $response->json('customer'));
        $this->assertArrayNotHasKey('contract_pricing', $response->json('customer'));
    }

    /**
     * Test: Ticket without machine returns clear 'No machine details linked' message (TS029).
     */
    public function test_ticket_without_machine_returns_clear_unlinked_message(): void
    {
        $uniqueSuffix = uniqid();
        $clientEmail = "info_{$uniqueSuffix}@clinicplus.org";

        $clientId = DB::table('clients')->insertGetId([
            'client_name' => 'Clinic Plus',
            'email' => $clientEmail,
            'contact_number' => '+63 920 555 1234',
            'address' => '45 Avenue, Makati',
            'status' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $assignedTech = Employee::firstOrCreate(
            ['email' => "tech_nomachine_{$uniqueSuffix}@example.com"],
            [
                'first_name' => 'Elena',
                'last_name' => 'Santos',
                'role' => 'technician',
                'department' => 'Service',
                'is_active' => true,
            ]
        );

        $ticketId = DB::table('tickets')->insertGetId([
            'title' => 'Software Portal Access Request',
            'description' => 'Need password reset on medical portal.',
            'created_by' => $clientId,
            'assigned_to' => $assignedTech->emp_id,
            'machine_ID' => null,
            'problem_category_ID' => 1,
            'ticket_type_ID' => 2,
            'ticket_status_ID' => 2,
            'is_internal' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->actingAs($assignedTech, 'api')
            ->getJson("/api/tickets/{$ticketId}/customer-context");

        $response->assertOk();
        $response->assertJson([
            'success' => true,
            'ticket_id' => $ticketId,
            'customer' => [
                'name' => 'Clinic Plus',
                'email' => $clientEmail,
            ],
            'machine' => null,
            'machine_message' => 'No machine details linked',
        ]);
    }

    /**
     * Test: Unassigned employee without CS/Admin role is rejected with 403 Forbidden (TS029).
     */
    public function test_unassigned_employee_cannot_access_context(): void
    {
        $uniqueSuffix = uniqid();

        $clientId = DB::table('clients')->insertGetId([
            'client_name' => 'St Jude Diagnostics',
            'email' => "care_{$uniqueSuffix}@stjude.org",
            'contact_number' => '+63 918 333 4444',
            'address' => 'Pasig City',
            'status' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $assignedTech = Employee::firstOrCreate(
            ['email' => "primary_owner_{$uniqueSuffix}@example.com"],
            [
                'first_name' => 'Assigned',
                'last_name' => 'Engineer',
                'role' => 'technician',
                'department' => 'Service',
                'is_active' => true,
            ]
        );

        $unassignedTech = Employee::firstOrCreate(
            ['email' => "unassigned_intruder_{$uniqueSuffix}@example.com"],
            [
                'first_name' => 'Other',
                'last_name' => 'Staff',
                'role' => 'technician',
                'department' => 'Service',
                'is_active' => true,
            ]
        );

        $ticketId = DB::table('tickets')->insertGetId([
            'title' => 'Restricted Context Ticket',
            'description' => 'Confidential customer inquiry.',
            'created_by' => $clientId,
            'assigned_to' => $assignedTech->emp_id,
            'machine_ID' => null,
            'problem_category_ID' => 1,
            'ticket_type_ID' => 2,
            'ticket_status_ID' => 2,
            'is_internal' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->actingAs($unassignedTech, 'api')
            ->getJson("/api/tickets/{$ticketId}/customer-context");

        $response->assertStatus(403);
        $response->assertJson([
            'code' => 'UNAUTHORIZED_CONTEXT_ACCESS',
        ]);
    }

    /**
     * Test: Customer Support and Admin can view context across all tickets (TS029).
     */
    public function test_cs_and_admin_can_view_context_for_any_ticket(): void
    {
        $uniqueSuffix = uniqid();

        $clientId = DB::table('clients')->insertGetId([
            'client_name' => 'Apex Healthcare',
            'email' => "ops_{$uniqueSuffix}@apex.org",
            'contact_number' => '+63 919 777 8888',
            'address' => 'Taguig City',
            'status' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $csAgent = Employee::firstOrCreate(
            ['email' => "cs_viewer_{$uniqueSuffix}@example.com"],
            [
                'first_name' => 'Camille',
                'last_name' => 'Support',
                'role' => 'customer service',
                'department' => 'Customer Service',
                'is_active' => true,
            ]
        );

        $otherTech = Employee::firstOrCreate(
            ['email' => "other_tech_{$uniqueSuffix}@example.com"],
            [
                'first_name' => 'Other',
                'last_name' => 'Tech',
                'role' => 'technician',
                'department' => 'Service',
                'is_active' => true,
            ]
        );

        $ticketId = DB::table('tickets')->insertGetId([
            'title' => 'Ventilator Sensor Alarm',
            'description' => 'Constant alarm on sensor unit.',
            'created_by' => $clientId,
            'assigned_to' => $otherTech->emp_id,
            'machine_ID' => null,
            'problem_category_ID' => 1,
            'ticket_type_ID' => 2,
            'ticket_status_ID' => 2,
            'is_internal' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->actingAs($csAgent, 'api')
            ->getJson("/api/tickets/{$ticketId}/customer-context");

        $response->assertOk();
        $response->assertJson([
            'success' => true,
            'ticket_id' => $ticketId,
            'customer' => [
                'name' => 'Apex Healthcare',
            ],
        ]);
    }
}
