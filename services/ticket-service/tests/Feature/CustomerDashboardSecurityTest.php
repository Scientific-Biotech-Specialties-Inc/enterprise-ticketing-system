<?php

namespace Tests\Feature;

use Tests\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use App\Models\Client;

class CustomerDashboardSecurityTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'mysql']);
        config(['database.connections.mysql.database' => 'ticketing_system_test']);
        DB::purge('mysql');
        DB::reconnect('mysql');

        DB::table('ticket_types')->updateOrInsert(
            ['ticket_type_ID' => 1],
            ['type_name' => 'Internal', 'created_at' => now(), 'updated_at' => now()]
        );
        DB::table('ticket_types')->updateOrInsert(
            ['ticket_type_ID' => 2],
            ['type_name' => 'External', 'created_at' => now(), 'updated_at' => now()]
        );

        DB::table('oauth_personal_access_clients')->updateOrInsert(
            ['id' => 1],
            ['client_id' => 1, 'created_at' => now(), 'updated_at' => now()]
        );
        DB::table('oauth_clients')->updateOrInsert(
            ['id' => 1],
            [
                'name' => 'Personal Access Client',
                'secret' => 'personal-secret',
                'provider' => 'polymorphic_users',
                'redirect' => 'http://localhost',
                'personal_access_client' => 1,
                'password_client' => 0,
                'revoked' => 0,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
    }

    /**
     * covers: AC-5
     */
    public function test_customer_dashboard_requires_subsystem_authentication(): void
    {
        $response = $this->getJson('/api/customer-dashboard');
        $response->assertStatus(401);
    }

    /**
     * covers: AC-5
     */
    public function test_customer_dashboard_scopes_metrics_strictly_to_authenticated_customer_and_ignores_query_created_by(): void
    {
        $uid = uniqid();

        // 1. Arrange two distinct customer clients in the database
        $clientA = Client::create([
            'client_name' => 'Alice Hospital ' . $uid,
            'email' => 'alice.' . $uid . '@hospital-client.com',
            'contact_number' => '111-222-3333',
            'address' => '123 Medical Way',
        ]);

        $clientB = Client::create([
            'client_name' => 'Bob Clinic ' . $uid,
            'email' => 'bob.' . $uid . '@clinic-client.com',
            'contact_number' => '444-555-6666',
            'address' => '456 Healthcare Blvd',
        ]);

        $statusId = DB::table('ticket_statuses')->value('ticket_status_ID') ?? 1;
        $priorityId = DB::table('ticket_priorities')->value('priority_ID') ?? 1;
        $categoryId = DB::table('problem_categories')->value('problem_category_ID') ?? 1;

        $ticketANumber = 'TKT-ALICE-' . strtoupper(substr($uid, -4));
        $ticketBNumber = 'TKT-BOB-' . strtoupper(substr($uid, -4));

        $ticketAId = DB::table('tickets')->insertGetId([
            'ticket_number' => $ticketANumber,
            'title' => 'Alice Private Ticket',
            'description' => 'Alice sensitive issue',
            'created_by' => $clientA->id,
            'ticket_type_ID' => 2,
            'ticket_status_ID' => $statusId,
            'priority_ID' => $priorityId,
            'problem_category_ID' => $categoryId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $ticketBId = DB::table('tickets')->insertGetId([
            'ticket_number' => $ticketBNumber,
            'title' => 'Bob Private Ticket',
            'description' => 'Bob sensitive issue',
            'created_by' => $clientB->id,
            'ticket_type_ID' => 2,
            'ticket_status_ID' => $statusId,
            'priority_ID' => $priorityId,
            'problem_category_ID' => $categoryId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // 2. Act as Customer A via Passport api guard
        // Attempt IDOR exploit: Customer A queries dashboard supplying created_by=clientB->id
        $response = $this->actingAs($clientA, 'api')->getJson('/api/customer-dashboard?created_by=' . $clientB->id);

        // 3. Assert: Request succeeds but results are strictly filtered to Customer A
        $response->assertStatus(200);
        $data = $response->json();

        $this->assertArrayHasKey('summary', $data);
        $this->assertArrayHasKey('recent_tickets', $data);

        $returnedTicketIds = collect($data['recent_tickets'])->pluck('ticket_ID')->all();
        $this->assertContains($ticketAId, $returnedTicketIds, 'Customer A should see their own ticket ID.');
        $this->assertNotContains($ticketBId, $returnedTicketIds, 'Customer A must not see Customer B tickets despite tampering created_by.');
    }

    /**
     * covers: AC-5
     */
    public function test_customer_filter_options_requires_subsystem_authentication_and_scopes_to_customer(): void
    {
        $uid = uniqid();

        $unauthResponse = $this->getJson('/api/customer/filter-options');
        $unauthResponse->assertStatus(401);

        $client = Client::create([
            'client_name' => 'Charlie Center ' . $uid,
            'email' => 'charlie.' . $uid . '@client-test.com',
            'contact_number' => '777-888-9999',
            'address' => '789 Care Drive',
        ]);

        $authResponse = $this->actingAs($client, 'api')->getJson('/api/customer/filter-options');
        $authResponse->assertStatus(200);
        $data = $authResponse->json();
        $this->assertArrayHasKey('statuses', $data);
        $this->assertArrayHasKey('categories', $data);
    }

    /**
     * covers: Customer Passport authentication fallback
     */
    public function test_customer_dashboard_authenticates_with_passport_customer_guard(): void
    {
        $uid = uniqid();
        $client = Client::create([
            'client_name' => 'Dana Clinic ' . $uid,
            'email' => 'dana.' . $uid . '@clinic-test.com',
            'contact_number' => '333-444-5555',
            'address' => '321 Health Road',
        ]);

        $response = $this->actingAs($client, 'api')->getJson('/api/customer-dashboard');

        $response->assertStatus(200);
        $this->assertArrayHasKey('summary', $response->json());
    }
}
