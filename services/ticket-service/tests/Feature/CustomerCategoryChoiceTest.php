<?php

namespace Tests\Feature;

use App\Models\Client;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Customers choose the problem category themselves (the form prefills the AI suggestion).
 * The server keeps their choice on create and lets them change it while the ticket is Open and unassigned.
 */
class CustomerCategoryChoiceTest extends TestCase
{
    use DatabaseTransactions;

    private int $software;
    private int $service;

    protected function setUp(): void
    {
        parent::setUp();
        config(['database.default' => 'mysql']);
        config(['database.connections.mysql.database' => 'ticketing_system_test']);
        DB::purge('mysql');
        DB::reconnect('mysql');
        Cache::flush();

        DB::table('ticket_statuses')->updateOrInsert(['ticket_status_ID' => 1], ['status_name' => 'Open']);
        DB::table('ticket_types')->updateOrInsert(['ticket_type_ID' => 2], ['type_name' => 'External', 'created_at' => now(), 'updated_at' => now()]);

        $this->software = $this->category('Software');
        $this->service = $this->category('Service');

        // Any AI call would be a bug when the customer already chose a category.
        Http::fake([
            '*/ticket-configurations/limits' => Http::response(['value' => ['isUnlimited' => true, 'limit' => 100]], 200),
            '*' => Http::response(['data' => ['category_id' => null, 'confidence' => 0]], 200),
        ]);
    }

    private function category(string $name): int
    {
        DB::table('problem_categories')->updateOrInsert(
            ['category_name' => $name, 'branch_id' => null],
            ['is_active' => 1, 'updated_at' => now()]
        );

        return (int) DB::table('problem_categories')->where('category_name', $name)->whereNull('branch_id')->value('problem_category_ID');
    }

    private function client(): Client
    {
        $uid = uniqid();
        return Client::create([
            'client_name' => "Choice Hospital {$uid}",
            'email' => "choice.{$uid}@client.test",
            'contact_number' => '0000000000',
            'address' => '1 Test Way',
        ]);
    }

    private function machineFor(Client $client): int
    {
        DB::statement('SET FOREIGN_KEY_CHECKS=0');
        try {
            return DB::table('machines')->insertGetId([
                'category_ID' => DB::table('machine_categories')->value('category_ID'),
                'client_ID' => $client->id,
                'machine_name' => 'Patient Monitor',
                'serial_number' => 'SN-' . strtoupper(uniqid()),
                'model' => 'VS-900',
                'brand' => 'Philips',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } finally {
            DB::statement('SET FOREIGN_KEY_CHECKS=1');
        }
    }

    private function openTicket(Client $client, int $categoryId, ?int $machineId): int
    {
        return DB::table('tickets')->insertGetId([
            'ticket_number' => 'CHC-' . strtoupper(uniqid()),
            'title' => 'Monitor Not Starting',
            'description' => 'The monitor does not power on at all.',
            'created_by' => $client->id,
            'ticket_type_ID' => 2,
            'is_internal' => false,
            'ticket_status_ID' => 1,
            'priority_ID' => DB::table('ticket_priorities')->value('priority_ID'),
            'problem_category_ID' => $categoryId,
            'machine_ID' => $machineId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_create_keeps_the_category_the_customer_chose_without_asking_the_ai(): void
    {
        $client = $this->client();

        $response = $this->actingAs($client, 'api')->postJson('/api/tickets', [
            'title' => 'Portal Login Fails',
            'description' => 'The customer portal rejects my password every time I sign in.',
            'problem_category_ID' => $this->software,
        ]);

        $response->assertSuccessful();
        $ticket = DB::table('tickets')->where('created_by', $client->id)->latest('ticket_ID')->first();
        $this->assertSame($this->software, (int) $ticket->problem_category_ID);
        $this->assertNull($ticket->machine_ID);
        Http::assertNotSent(fn ($request) => str_contains($request->url(), 'classify-category'));
    }

    public function test_customer_can_change_the_category_of_their_open_ticket(): void
    {
        $client = $this->client();
        $machine = $this->machineFor($client);
        $ticketId = $this->openTicket($client, $this->service, $machine);

        $this->actingAs($client, 'api')->patchJson("/api/tickets/{$ticketId}", [
            'title' => 'Monitor Not Starting',
            'description' => 'The monitor does not power on at all.',
            'problem_category_ID' => $this->software,
            'machine_ID' => null,
        ])->assertSuccessful();

        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        $this->assertSame($this->software, (int) $ticket->problem_category_ID);
        $this->assertNull($ticket->machine_ID, 'Switching to Software clears the machine');
    }

    public function test_switching_to_service_still_requires_a_machine(): void
    {
        $client = $this->client();
        $ticketId = $this->openTicket($client, $this->software, null);

        $this->actingAs($client, 'api')->patchJson("/api/tickets/{$ticketId}", [
            'problem_category_ID' => $this->service,
            'machine_ID' => null,
        ])->assertStatus(422)->assertJsonPath('errors.machine_ID.0', 'A Service ticket needs one of your registered machines.');
    }

    public function test_an_inactive_category_is_rejected(): void
    {
        $client = $this->client();
        $ticketId = $this->openTicket($client, $this->software, null);
        $inactive = DB::table('problem_categories')->insertGetId([
            'category_name' => 'Retired ' . uniqid(),
            'is_active' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->actingAs($client, 'api')->patchJson("/api/tickets/{$ticketId}", [
            'problem_category_ID' => $inactive,
        ])->assertStatus(422);
    }
}
