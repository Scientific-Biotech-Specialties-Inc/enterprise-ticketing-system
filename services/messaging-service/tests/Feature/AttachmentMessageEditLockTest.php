<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Message;
use Tests\TestCase;

/**
 * Spec 0037 (AC-18): a chat message that carries files can never be edited.
 */
class AttachmentMessageEditLockTest extends TestCase
{
    private const TICKET_ID = 990037001;
    private const CUSTOMER_ID = 990037;

    private array $created = [];

    protected function tearDown(): void
    {
        foreach ($this->created as $id) {
            try {
                Message::where('_id', $id)->delete();
            } catch (\Throwable $e) {
            }
        }
        parent::tearDown();
    }

    private function customer(): Client
    {
        $client = new Client();
        $client->forceFill(['id' => self::CUSTOMER_ID, 'client_name' => 'Spec 37 Customer']);
        $client->exists = true;
        return $client;
    }

    private function message(array $attachments): Message
    {
        $message = Message::create([
            'ticket_id' => self::TICKET_ID,
            'sender_id' => self::CUSTOMER_ID,
            'sender_name' => 'Spec 37 Customer',
            'sender_type' => 'customer',
            'sender_role' => 'Customer',
            'message' => 'original text',
            'attachments' => $attachments,
            'is_internal' => false,
        ]);
        $this->created[] = (string) $message->_id;
        return $message;
    }

    public function test_editing_a_message_with_attachments_returns_422_and_saves_nothing(): void
    {
        $message = $this->message([[
            'id' => 1, 'name' => 'scan.pdf', 'file_path' => 'ticket-attachments/1/scan.pdf',
            'url' => '/api/ticketing/attachment/download/ticket-attachments/1/scan.pdf', 'scan_status' => 'clean',
        ]]);

        $response = $this->actingAs($this->customer(), 'api')
            ->putJson('/api/tickets/' . self::TICKET_ID . '/messages/' . $message->_id, ['message' => 'changed text']);

        $response->assertStatus(422)
            ->assertJsonPath('message', 'Messages with attachments cannot be edited.');

        $fresh = Message::find($message->_id);
        $this->assertSame('original text', $fresh->message);
        $this->assertEmpty($fresh->edit_history ?? []);
        $this->assertFalse((bool) ($fresh->is_edited ?? false));
    }

    public function test_a_message_without_attachments_is_not_locked_by_this_rule(): void
    {
        $message = $this->message([]);

        $response = $this->actingAs($this->customer(), 'api')
            ->putJson('/api/tickets/' . self::TICKET_ID . '/messages/' . $message->_id, ['message' => 'changed text']);

        $this->assertNotSame('ATTACHMENT_MESSAGE_LOCKED', $response->json('code'));
    }

    public function test_has_attachments_helper(): void
    {
        $this->assertTrue(\App\Http\Controllers\MessageController::hasAttachments((object) ['attachments' => [['name' => 'a']]]));
        $this->assertFalse(\App\Http\Controllers\MessageController::hasAttachments((object) ['attachments' => []]));
        $this->assertFalse(\App\Http\Controllers\MessageController::hasAttachments((object) ['attachments' => null]));
    }
}
