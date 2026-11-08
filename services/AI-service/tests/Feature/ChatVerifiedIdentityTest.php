<?php

namespace Tests\Feature;

use App\Models\AiConversation;
use App\Services\GeminiService;
use Illuminate\Auth\GenericUser;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Spec 0034 (AC-10, AC-13): AI chat routes take identity from the verified token, or from a valid
 * X-Internal-Token, and never from a user_id the caller supplies.
 */
class ChatVerifiedIdentityTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        $this->mock(GeminiService::class, function ($mock) {
            $mock->shouldReceive('generateResponse')->andReturn(['content' => 'Hello', 'escalate' => false, 'ticket_data' => null]);
            $mock->shouldReceive('classifyDepartment')->andReturn(['department' => 'IT']);
        });
    }

    private function user(int $id): GenericUser
    {
        return new GenericUser(['id' => $id, 'name' => 'Customer ' . $id]);
    }

    private function conversationOf(int $ownerId): AiConversation
    {
        return AiConversation::create([
            'id' => Str::uuid()->toString(),
            'user_id' => $ownerId,
            'title' => 'Printer broken',
            'status' => 'active',
            'messages' => [['id' => 'm1', 'role' => 'user', 'content' => 'help']],
        ]);
    }

    private function internalHeaders(): array
    {
        $token = (string) env('INTERNAL_TOKEN');
        if ($token === '') {
            $this->markTestSkipped('INTERNAL_TOKEN is not configured.');
        }

        return ['X-Internal-Token' => $token];
    }

    public function test_every_chat_route_returns_401_without_a_token_even_with_a_user_id(): void
    {
        $conv = $this->conversationOf(9001);

        $this->postJson('/api/chat', ['messages' => [['role' => 'user', 'content' => 'hi']], 'user_id' => 9001])->assertStatus(401);
        $this->postJson('/api/classify-department', ['title' => 'x', 'description' => 'y', 'user_id' => 9001])->assertStatus(401);
        $this->getJson('/api/conversations?user_id=9001')->assertStatus(401);
        $this->getJson("/api/conversations/{$conv->id}?user_id=9001")->assertStatus(401);
        $this->getJson("/api/conversations/{$conv->id}/escalate-handoff?user_id=9001")->assertStatus(401);
        $this->getJson("/api/escalate-handoff/{$conv->id}?user_id=9001")->assertStatus(401);
        $this->deleteJson("/api/conversations/{$conv->id}?user_id=9001")->assertStatus(401);
        $this->deleteJson("/api/conversations/{$conv->id}/messages/m1?user_id=9001")->assertStatus(401);
        $this->postJson('/api/tickets', ['conversation_id' => $conv->id, 'user_id' => 9001])->assertStatus(401);

        $this->assertNotNull(AiConversation::find($conv->id));
    }

    public function test_a_wrong_internal_token_is_refused(): void
    {
        $this->withHeaders(['X-Internal-Token' => 'not-the-token'])->getJson('/api/conversations')->assertStatus(401);
    }

    public function test_token_caller_owns_what_they_create_and_cannot_pick_the_owner(): void
    {
        $res = $this->actingAs($this->user(9001), 'api')
            ->postJson('/api/chat', ['messages' => [['role' => 'user', 'content' => 'My printer is broken']], 'user_id' => 9002]);
        $res->assertStatus(200);

        $this->assertSame('9001', (string) AiConversation::find($res->json('conversation_id'))->user_id);
    }

    public function test_list_returns_only_the_callers_own_conversations(): void
    {
        $mine = $this->conversationOf(9001);
        $theirs = $this->conversationOf(9002);

        $res = $this->actingAs($this->user(9001), 'api')->getJson('/api/conversations?user_id=9002');

        $res->assertStatus(200);
        $ids = collect($res->json('conversations'))->pluck('id')->all();
        $this->assertContains($mine->id, $ids);
        $this->assertNotContains($theirs->id, $ids);
    }

    public function test_customer_a_gets_404_on_customer_bs_conversation_for_every_route(): void
    {
        $b = $this->conversationOf(9002);
        $a = $this->user(9001);

        $this->actingAs($a, 'api')->getJson("/api/conversations/{$b->id}?user_id=9002")->assertStatus(404);
        $this->actingAs($a, 'api')->getJson("/api/conversations/{$b->id}/escalate-handoff?user_id=9002")->assertStatus(404);
        $this->actingAs($a, 'api')->getJson("/api/escalate-handoff/{$b->id}")->assertStatus(404);
        $this->actingAs($a, 'api')->deleteJson("/api/conversations/{$b->id}?user_id=9002")->assertStatus(404);
        $this->actingAs($a, 'api')->deleteJson("/api/conversations/{$b->id}/messages/m1", ['user_id' => 9002])->assertStatus(404);
        $this->actingAs($a, 'api')->postJson('/api/tickets', ['conversation_id' => $b->id, 'user_id' => 9002])->assertStatus(404);
        $this->actingAs($a, 'api')
            ->postJson('/api/chat', ['conversation_id' => $b->id, 'user_id' => 9002, 'messages' => [['role' => 'user', 'content' => 'hi']]])
            ->assertStatus(404);

        $fresh = AiConversation::find($b->id);
        $this->assertNotNull($fresh);
        $this->assertSame('active', $fresh->status);
        $this->assertCount(1, $fresh->messages);
    }

    public function test_owner_can_read_hand_off_and_delete_their_own_conversation(): void
    {
        $mine = $this->conversationOf(9001);
        $a = $this->user(9001);

        $this->actingAs($a, 'api')->getJson("/api/conversations/{$mine->id}")->assertStatus(200);
        $this->actingAs($a, 'api')->getJson("/api/conversations/{$mine->id}/escalate-handoff")->assertStatus(200);
        $this->actingAs($a, 'api')->postJson('/api/tickets', ['conversation_id' => $mine->id])->assertStatus(200);
        $this->actingAs($a, 'api')->deleteJson("/api/conversations/{$mine->id}")->assertStatus(200);

        $this->assertNull(AiConversation::find($mine->id));
    }

    private function staff(int $empId = 3): \Ticketing\Auth\Dto\AuthenticatedUserDto
    {
        return new \Ticketing\Auth\Dto\AuthenticatedUserDto(['emp_id' => $empId, 'role' => 'cs']);
    }

    public function test_staff_can_read_a_customers_ai_chats(): void
    {
        $theirs = $this->conversationOf(9002);
        $other = $this->conversationOf(9003);

        $list = $this->actingAs($this->staff(), 'api')->getJson('/api/conversations?user_id=9002');
        $list->assertStatus(200);
        $ids = collect($list->json('conversations'))->pluck('id')->all();
        $this->assertContains($theirs->id, $ids);
        $this->assertNotContains($other->id, $ids);

        // With no customer named, staff see nothing instead of every chat.
        $this->assertSame([], $this->actingAs($this->staff(), 'api')->getJson('/api/conversations')->json('conversations'));

        $this->actingAs($this->staff(), 'api')->getJson("/api/conversations/{$theirs->id}")->assertStatus(200);
        $this->actingAs($this->staff(), 'api')->getJson("/api/conversations/{$theirs->id}/escalate-handoff")->assertStatus(200);
    }

    public function test_staff_cannot_change_a_customers_ai_chat(): void
    {
        $theirs = $this->conversationOf(9002);
        $staff = $this->staff();

        $this->actingAs($staff, 'api')->deleteJson("/api/conversations/{$theirs->id}")->assertStatus(403);
        $this->actingAs($staff, 'api')->deleteJson("/api/conversations/{$theirs->id}/messages/m1")->assertStatus(403);
        $this->actingAs($staff, 'api')->postJson('/api/tickets', ['conversation_id' => $theirs->id])->assertStatus(403);
        $this->actingAs($staff, 'api')
            ->postJson('/api/chat', ['conversation_id' => $theirs->id, 'messages' => [['role' => 'user', 'content' => 'hi']]])
            ->assertStatus(403);

        $fresh = AiConversation::find($theirs->id);
        $this->assertNotNull($fresh);
        $this->assertSame('active', $fresh->status);
        $this->assertCount(1, $fresh->messages);
    }

    public function test_a_customer_token_still_cannot_use_user_id_to_read_someone_else(): void
    {
        $theirs = $this->conversationOf(9002);

        $ids = collect($this->actingAs($this->user(9001), 'api')->getJson('/api/conversations?user_id=9002')->json('conversations'))->pluck('id')->all();
        $this->assertNotContains($theirs->id, $ids);
    }

    public function test_internal_token_call_still_works_and_may_name_the_user(): void
    {
        $headers = $this->internalHeaders();
        $theirs = $this->conversationOf(9002);

        $this->withHeaders($headers)->getJson("/api/conversations/{$theirs->id}")->assertStatus(200);

        $ids = collect($this->withHeaders($headers)->getJson('/api/conversations?user_id=9002')->json('conversations'))->pluck('id')->all();
        $this->assertContains($theirs->id, $ids);

        $res = $this->withHeaders($headers)->postJson('/api/chat', ['messages' => [['role' => 'user', 'content' => 'hi']], 'user_id' => 9003]);
        $res->assertStatus(200);
        $this->assertSame('9003', (string) AiConversation::find($res->json('conversation_id'))->user_id);
    }

    /**
     * Guard: controllers must not read caller supplied identity again, apart from the one
     * allowlisted internal call helper.
     */
    public function test_controllers_do_not_read_banned_identity_inputs(): void
    {
        $banned = 'X-Client-Id|X-User-Id|X-User-ID|X-User-Role|X-User-Type|X-User-Name|user_id|client_id|customer_id|emp_id|sender_id|created_by|user_role';
        $pattern = '/(?:->header|->input|->query|->get|->filled|->has|->post|->cookie)\(\s*[\'"](?:' . $banned . ')[\'"]|\$request->(?:user_id|client_id|customer_id|emp_id|sender_id|created_by|user_role)\b/i';
        // Trusted exception: body user_id on a valid X-Internal-Token call only.
        $allowlist = ["\$id = \$request->input('user_id');"];

        $offenders = [];
        $dir = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(app_path('Http'), \FilesystemIterator::SKIP_DOTS));
        foreach ($dir as $file) {
            if ($file->getExtension() !== 'php') {
                continue;
            }
            foreach (file($file->getPathname()) as $i => $line) {
                if (!preg_match($pattern, $line)) {
                    continue;
                }
                foreach ($allowlist as $allowed) {
                    if (str_contains($line, $allowed)) {
                        continue 2;
                    }
                }
                $offenders[] = basename($file->getPathname()) . ':' . ($i + 1) . ' ' . trim($line);
            }
        }

        $this->assertSame([], $offenders, "Banned identity inputs found:\n" . implode("\n", $offenders));
    }
}
