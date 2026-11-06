<?php

namespace Tests\Feature;

use App\Models\TicketDraft;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Ticketing\Auth\Dto\AuthenticatedUserDto;
use Tests\TestCase;

/**
 * Spec 0034 (AC-1, AC-2, AC-3): ticket draft routes take identity from the verified token only.
 */
class TicketDraftVerifiedIdentityTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::getDriverName() === 'sqlite') {
            DB::statement('PRAGMA foreign_keys = OFF');
        } else {
            DB::statement('SET FOREIGN_KEY_CHECKS=0');
        }

        if (!Schema::hasTable('ticket_drafts')) {
            $this->markTestSkipped('ticket_drafts table is not migrated.');
        }
    }

    private function customer(int $id): AuthenticatedUserDto
    {
        return new AuthenticatedUserDto(['client_ID' => $id, 'client_id' => $id, 'id' => $id, 'role' => 'customer']);
    }

    private function staff(int $empId): AuthenticatedUserDto
    {
        return new AuthenticatedUserDto(['emp_id' => $empId, 'role' => 'cs']);
    }

    public function test_customer_saves_lists_and_deletes_own_draft_with_token_only(): void
    {
        $a = $this->customer(9001);

        $save = $this->actingAs($a)->postJson('/api/tickets/draft', ['title' => 'My draft', 'description' => 'text']);
        $save->assertStatus(200);
        $draftId = $save->json('draft.id');

        $this->actingAs($a)->getJson('/api/tickets/drafts')->assertStatus(200)->assertJsonPath('total', 1);
        $this->actingAs($a)->getJson("/api/tickets/drafts/{$draftId}")->assertStatus(200);
        $this->actingAs($a)->deleteJson("/api/tickets/drafts/{$draftId}")->assertStatus(200);

        $this->assertSame(0, TicketDraft::where('client_id', 9001)->count());
    }

    public function test_requests_without_a_valid_token_get_401(): void
    {
        $this->postJson('/api/tickets/draft', ['title' => 'x'])->assertStatus(401);
        $this->getJson('/api/tickets/drafts')->assertStatus(401);
        $this->getJson('/api/tickets/drafts/1')->assertStatus(401);
        $this->deleteJson('/api/tickets/drafts/1')->assertStatus(401);

        // Identity headers and body ids never stand in for a token.
        $this->withHeaders(['X-Client-Id' => '9001', 'X-User-Id' => '9001'])
            ->postJson('/api/tickets/draft', ['title' => 'x', 'client_id' => 9001, 'user_id' => 9001])
            ->assertStatus(401);
    }

    public function test_forged_unsigned_jwt_and_opaque_bearer_return_401(): void
    {
        $b64 = fn (array $d) => rtrim(strtr(base64_encode(json_encode($d)), '+/', '-_'), '=');
        $forged = $b64(['alg' => 'none']) . '.' . $b64(['sub' => 9001, 'client_id' => 9001]) . '.';

        $this->withHeader('Authorization', 'Bearer ' . $forged)->getJson('/api/tickets/drafts')->assertStatus(401);
        $this->withHeader('Authorization', 'Bearer 1|anything')->getJson('/api/tickets/drafts')->assertStatus(401);
    }

    public function test_customer_cannot_reach_another_customers_draft_even_with_spoofed_identity(): void
    {
        $owner = TicketDraft::create(['client_id' => 9002, 'title' => 'Private', 'description' => 'b', 'priority_ID' => 1]);
        $a = $this->customer(9001);

        $spoof = ['X-Client-Id' => '9002', 'X-User-Id' => '9002'];

        $this->actingAs($a)->withHeaders($spoof)->getJson("/api/tickets/drafts/{$owner->id}?client_id=9002")->assertStatus(404);
        $this->actingAs($a)->withHeaders($spoof)->deleteJson("/api/tickets/drafts/{$owner->id}", ['client_id' => 9002])->assertStatus(404);
        $this->actingAs($a)->withHeaders($spoof)
            ->postJson('/api/tickets/draft', ['draft_id' => $owner->id, 'title' => 'hijack', 'client_id' => 9002])
            ->assertStatus(404);

        $list = $this->actingAs($a)->withHeaders($spoof)->getJson('/api/tickets/drafts?client_id=9002');
        $list->assertStatus(200)->assertJsonPath('total', 0);

        $this->assertSame('Private', TicketDraft::find($owner->id)->title);
    }

    public function test_staff_token_on_draft_routes_gets_403(): void
    {
        $staff = $this->staff(77);

        $this->actingAs($staff)->postJson('/api/tickets/draft', ['title' => 'x'])->assertStatus(403);
        $this->actingAs($staff)->getJson('/api/tickets/drafts')->assertStatus(403);
        $this->actingAs($staff)->getJson('/api/tickets/drafts/1')->assertStatus(403);
        $this->actingAs($staff)->deleteJson('/api/tickets/drafts/1')->assertStatus(403);
    }
}
