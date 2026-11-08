<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\Message;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Event;

class MessageParticipantNotificationTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Event::fake([\App\Events\MessageSent::class, \App\Events\TicketChanged::class]);
    }

    public function test_ping_and_clear_presence_endpoints()
    {
        $user = new \Illuminate\Auth\GenericUser([
            'id' => 99,
            'name' => 'Test Tech',
            'user_type' => 'employee',
        ]);

        $this->actingAs($user);

        // 1. Ping presence
        $res = $this->postJson('/api/tickets/888/presence');
        $res->assertStatus(200);
        $res->assertJson([
            'status' => 'ok',
            'ticket_id' => 888,
            'user_key' => 'employee:99',
            'expires_in' => 30,
        ]);

        // Verify key stored in Redis
        $hasKey = Cache::store('redis')->has('ticket:presence:888:employee:99') || Cache::has('ticket:presence:888:employee:99');
        $this->assertTrue($hasKey);

        // 2. Clear presence
        $clearRes = $this->deleteJson('/api/tickets/888/presence');
        $clearRes->assertStatus(200);
        $clearRes->assertJson([
            'status' => 'cleared',
            'ticket_id' => 888,
            'user_key' => 'employee:99',
        ]);

        // Verify key cleared
        $hasKeyAfter = Cache::store('redis')->has('ticket:presence:888:employee:99') || Cache::has('ticket:presence:888:employee:99');
        $this->assertFalse($hasKeyAfter);
    }
}
