<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Services\TicketService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Regression: creating a customer ticket must not crash on the title cleanup
 * and must write an in-app "New Ticket Created" notification for every CS employee.
 * Also covers showTicket for a customer (reassignment privacy filter ordering).
 */
class CsNewTicketNotificationTest extends TestCase
{
    use DatabaseTransactions;

    private Client $customer;
    private int $machineId;

    protected function setUp(): void
    {
        parent::setUp();

        Http::fake(['*' => Http::response([], 200)]);

        $this->customer = Client::create([
            'client_name' => 'CS Notify Client',
            'email' => 'cs_notify_' . uniqid() . '@example.com',
            'contact_number' => '1234567890',
            'address' => 'Test Address',
            'status' => true,
        ]);

        // ticket_audit_logs.action_by_ID has an FK to employees, so mirror the client there.
        DB::table('employees')->updateOrInsert(
            ['emp_id' => $this->customer->id],
            [
                'first_name' => 'Client', 'last_name' => 'User',
                'email' => $this->customer->email, 'role' => 'client',
                'department' => 'Customer', 'is_active' => 1, 'password_hash' => 'secret',
            ]
        );

        DB::table('problem_categories')->updateOrInsert(
            ['problem_category_ID' => 1],
            ['category_name' => 'Hardware Issue', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]
        );

        // machines.client_ID has an FK to users, so mirror the client there too.
        DB::table('users')->updateOrInsert(
            ['id' => $this->customer->id],
            ['email' => $this->customer->email, 'name' => 'CS Notify Client', 'password' => 'secret', 'created_at' => now(), 'updated_at' => now()]
        );

        $this->machineId = (int) DB::table('machines')->insertGetId([
            'category_ID' => 1,
            'client_ID' => $this->customer->id,
            'machine_name' => 'Notify Scanner',
            'serial_number' => 'SN-' . uniqid(),
            'created_at' => now(), 'updated_at' => now(),
        ]);

        DB::table('employees')->updateOrInsert(
            ['emp_id' => 99981],
            [
                'first_name' => 'Cee', 'last_name' => 'Ess',
                'email' => 'cs_notify_staff@example.com', 'role' => 'customer service',
                'department' => 'Customer Service', 'is_active' => 1, 'password_hash' => 'secret',
            ]
        );
    }

    private function createTicket(string $title): int
    {
        $result = app(TicketService::class)->createTicket([
            'machine_ID' => $this->machineId,
            'problem_category_ID' => 1,
            'title' => $title,
            'description' => 'The scanner stopped responding.',
        ], $this->customer, 2);

        return (int) $result['ticket']->ticket_ID;
    }

    public function test_creating_a_ticket_notifies_every_customer_service_employee(): void
    {
        $ticketId = $this->createTicket('Scanner Malfunction Alert');

        $csIds = DB::table('employees')
            ->whereRaw('LOWER(role) IN (?, ?, ?, ?, ?)', ['customer service', 'cs', 'customer support', 'head of cs', 'head of customer service'])
            ->pluck('emp_id')->all();
        $this->assertNotEmpty($csIds);

        $notified = DB::table('notifications')
            ->where('ticket_id', $ticketId)
            ->where('recipient_type', 'employee')
            ->where('title', 'New Ticket Created')
            ->pluck('recipient_id')->map(fn ($id) => (int) $id)->all();

        foreach ($csIds as $csId) {
            $this->assertContains((int) $csId, $notified, "CS employee {$csId} was not notified");
        }
    }

    public function test_stored_title_and_notification_use_the_cleaned_title(): void
    {
        $ticketId = $this->createTicket('1. Scanner Malfunction Alert');

        $this->assertSame('Scanner Malfunction Alert', DB::table('tickets')->where('ticket_ID', $ticketId)->value('title'));
        $message = DB::table('notifications')->where('ticket_id', $ticketId)->where('title', 'New Ticket Created')->value('message');
        $this->assertStringContainsString('"Scanner Malfunction Alert"', (string) $message);
    }

    public function test_customer_can_load_ticket_details_without_reassignment_entries(): void
    {
        $ticketId = $this->createTicket('Scanner Malfunction Alert');
        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => $ticketId, 'action_type' => 'reassign_request', 'event_type' => 'reassign_request',
            'action_by_ID' => $this->customer->id, 'actor_type' => 'employee',
            'details' => json_encode([]), 'is_system' => 0, 'is_internal' => 0, 'created_at' => now(),
        ]);

        $data = app(TicketService::class)->showTicket($ticketId, $this->customer, true);

        $this->assertNotNull($data);
        $this->assertFalse((bool) ($data['reassignmentRequested'] ?? false));
        $this->assertStringNotContainsString('reassign', strtolower(json_encode($data['timeline'] ?? [])));
    }
}
