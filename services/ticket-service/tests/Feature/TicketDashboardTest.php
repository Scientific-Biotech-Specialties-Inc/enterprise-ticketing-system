<?php

namespace Tests\Feature;

use App\Models\Employee;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class TicketDashboardTest extends TestCase
{
    use DatabaseTransactions;

    public function test_cs_dashboard_and_incoming_display_requester_employee_name_for_internal_tickets(): void
    {
        Cache::flush();

        $client1 = DB::table('clients')->where('id', 1)->first();
        $this->assertNotNull($client1, 'Client 1 must exist');
        $client1Name = $client1->client_name;

        // Ensure requester employee exists with known name
        $empId = 99123;
        DB::table('employees')->where('emp_id', $empId)->delete();
        DB::table('employees')->insert([
            'emp_id' => $empId,
            'first_name' => 'Arthur',
            'last_name' => 'Dent',
            'email' => 'arthur.dent@example.com',
            'role' => 'customer service',
            'department' => 'Customer Service',
            'is_active' => 1,
            'password_hash' => 'secret',
        ]);

        if (!DB::table('machines')->where('machine_ID', 1)->exists()) {
            DB::table('machines')->insert([
                'machine_ID' => 1,
                'category_ID' => 1,
                'client_ID' => 1,
                'machine_name' => 'Test Machine',
                'serial_number' => 'TEST-DASH-001',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
        $machineId = 1;
        $problemCategoryId = DB::table('problem_categories')->value('problem_category_ID') ?? 1;
        $priorityId = DB::table('ticket_priorities')->value('priority_ID') ?? 1;

        // 1. Create internal ticket (created_by = 1, requested_by = 99123, is_internal = 1)
        $internalTicketId = DB::table('tickets')->insertGetId([
            'ticket_number' => 'INT-DASH-991',
            'title' => 'Internal Server Maintenance Request',
            'description' => 'Internal maintenance',
            'problem_category_ID' => $problemCategoryId,
            'machine_ID' => $machineId,
            'created_by' => 1,
            'requested_by' => $empId,
            'is_internal' => 1,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1,
            'priority_ID' => $priorityId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // 2. Create external ticket (created_by = 1, requested_by = null, is_internal = 0)
        $externalTicketId = DB::table('tickets')->insertGetId([
            'ticket_number' => 'EXT-DASH-992',
            'title' => 'External Customer Request',
            'description' => 'External issue',
            'problem_category_ID' => $problemCategoryId,
            'machine_ID' => $machineId,
            'created_by' => 1,
            'requested_by' => null,
            'is_internal' => 0,
            'ticket_type_ID' => 1,
            'ticket_status_ID' => 1,
            'priority_ID' => $priorityId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Test CS Dashboard
        // CS routes require authentication, so call them as the CS employee seeded above.
        $csUser = Employee::where('emp_id', $empId)->first();
        $csDashResponse = $this->actingAs($csUser, 'api')->getJson('/api/cs-dashboard')->assertOk();
        $recentTickets = collect($csDashResponse->json('recent_tickets'));

        $internalDashRow = $recentTickets->firstWhere('title', 'Internal Server Maintenance Request');
        $this->assertNotNull($internalDashRow, 'Internal ticket must be present in CS dashboard recent tickets');
        $this->assertSame('Arthur Dent', $internalDashRow['customer'], 'Internal ticket customer name must be requester employee name');
        $this->assertNotSame($client1Name, $internalDashRow['customer'], 'Internal ticket must NOT show client 1 name');

        $externalDashRow = $recentTickets->firstWhere('title', 'External Customer Request');
        $this->assertNotNull($externalDashRow, 'External ticket must be present in CS dashboard recent tickets');
        $this->assertSame($client1Name, $externalDashRow['customer'], 'External ticket customer name must be client name');

        // Test CS Incoming
        Cache::flush();
        $csIncomingResponse = $this->actingAs($csUser, 'api')->getJson('/api/cs-incoming?type=all&limit=50')->assertOk();
        $incomingTickets = collect($csIncomingResponse->json('incoming_tickets'));

        $internalIncomingRow = $incomingTickets->firstWhere('ticket_ID', $internalTicketId);
        $this->assertNotNull($internalIncomingRow, 'Internal ticket must be present in CS incoming list');
        $this->assertSame('Arthur Dent', $internalIncomingRow['customer'], 'Internal ticket customer name in incoming list must be requester employee name');
        $this->assertNotSame($client1Name, $internalIncomingRow['customer'], 'Internal ticket in incoming list must NOT show client 1 name');

        $externalIncomingRow = $incomingTickets->firstWhere('ticket_ID', $externalTicketId);
        $this->assertNotNull($externalIncomingRow, 'External ticket must be present in CS incoming list');
        $this->assertSame($client1Name, $externalIncomingRow['customer'], 'External ticket customer name in incoming list must be client name');

        // Test Ticket Detail View (showTicket)
        $empUser = Employee::where('emp_id', $empId)->first();
        $internalShowResponse = $this->actingAs($empUser, 'api')
            ->getJson("/api/tickets/{$internalTicketId}")
            ->assertOk();
        $this->assertSame('Arthur Dent', $internalShowResponse->json('customer'), 'Internal ticket detail view must display requester employee name as customer');
        $this->assertNotSame($client1Name, $internalShowResponse->json('customer'), 'Internal ticket detail view must NOT show client 1 name as customer');

        $externalShowResponse = $this->actingAs($empUser, 'api')
            ->getJson("/api/tickets/{$externalTicketId}")
            ->assertOk();
        $this->assertSame($client1Name, $externalShowResponse->json('customer'), 'External ticket detail view must display client name as customer');
    }
}

