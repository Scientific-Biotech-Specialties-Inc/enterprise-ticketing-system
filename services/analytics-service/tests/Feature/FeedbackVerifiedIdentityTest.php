<?php

namespace Tests\Feature;

use App\Models\CustomerFeedback;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Ticketing\Auth\Dto\AuthenticatedUserDto;
use Tests\TestCase;

/**
 * Spec 0034 (AC-4 to AC-7, AC-13): feedback and stats routes take identity from the verified token only.
 */
class FeedbackVerifiedIdentityTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        if (!Schema::hasTable('customer_feedback')) {
            $this->markTestSkipped('customer_feedback table is not migrated.');
        }
    }

    private function customer(int $id): AuthenticatedUserDto
    {
        return new AuthenticatedUserDto(['client_ID' => $id, 'client_id' => $id, 'id' => $id, 'role' => 'customer']);
    }

    private function staff(int $empId, string $role = 'cs'): AuthenticatedUserDto
    {
        return new AuthenticatedUserDto(['emp_id' => $empId, 'role' => $role]);
    }

    private function fakeTicket(int $ownerId, string $status = 'Resolved'): void
    {
        Http::fake([
            '*feedback-form/status*' => Http::response(['is_enabled' => true], 200),
            // Spec 0038 AC-34: the real GET /tickets/{id}/ownership response shape (flat, not wrapped).
            '*/api/tickets/*/ownership' => Http::response([
                'ticket_ID' => 5001,
                'ticket_number' => 'TKT-0001',
                'client_ID' => $ownerId,
                'status_name' => $status,
                'is_internal' => false,
            ], 200),
        ]);
    }

    private function payload(array $extra = []): array
    {
        return array_merge(['ticket_id' => '5001', 'ratings' => ['7' => 5], 'overall_comment' => 'Great'], $extra);
    }

    private function makeFeedback(int $ownerId, string $ticketId = '5001'): CustomerFeedback
    {
        return CustomerFeedback::create([
            'ticket_id' => $ticketId,
            'customer_id' => (string) $ownerId,
            'overall_rating' => 5,
            'overall_comment' => 'ok',
            'employee_ratings' => [],
            'question_answers' => [],
            'category_questions_snapshot' => [],
        ]);
    }

    public function test_every_feedback_and_stats_route_returns_401_without_a_token(): void
    {
        $spoof = ['X-User-ID' => '9001', 'X-User-Role' => 'admin'];

        $this->withHeaders($spoof)->postJson('/api/feedback', $this->payload(['customer_id' => '9001']))->assertStatus(401);
        $this->withHeaders($spoof)->getJson('/api/feedback/ticket/5001')->assertStatus(401);
        $this->withHeaders($spoof)->putJson('/api/feedback/ticket/5001', ['customer_id' => '9001'])->assertStatus(401);
        $this->withHeaders($spoof)->deleteJson('/api/feedback/ticket/5001')->assertStatus(401);
        $this->withHeaders($spoof)->getJson('/api/csat-stats')->assertStatus(401);
        $this->withHeaders($spoof)->getJson('/api/predictive-metrics')->assertStatus(401);
        $this->withHeaders($spoof)->getJson('/api/analytics/csat-stats')->assertStatus(401);
    }

    public function test_customer_creates_feedback_for_own_resolved_ticket_and_body_customer_id_is_ignored(): void
    {
        $this->fakeTicket(9001);

        $this->actingAs($this->customer(9001))
            ->withHeaders(['X-User-ID' => '9002', 'X-User-Role' => 'admin'])
            ->postJson('/api/feedback', $this->payload(['customer_id' => '9002']))
            ->assertStatus(201);

        $this->assertSame('9001', CustomerFeedback::where('ticket_id', '5001')->value('customer_id'));
    }

    public function test_feedback_for_someone_elses_ticket_is_refused_and_nothing_is_saved(): void
    {
        $this->fakeTicket(9002);

        $this->actingAs($this->customer(9001))->postJson('/api/feedback', $this->payload())->assertStatus(404);

        $this->assertSame(0, CustomerFeedback::where('ticket_id', '5001')->count());
    }

    public function test_feedback_requires_a_resolved_or_closed_ticket(): void
    {
        $this->fakeTicket(9001, 'In Progress');

        $this->actingAs($this->customer(9001))->postJson('/api/feedback', $this->payload())->assertStatus(422);
        $this->assertSame(0, CustomerFeedback::where('ticket_id', '5001')->count());
    }

    public function test_feedback_is_refused_with_503_when_ticket_service_is_down(): void
    {
        Http::fake([
            '*feedback-form/status*' => Http::response(['is_enabled' => true], 200),
            '*/api/tickets/*' => fn () => throw new ConnectionException('ticket-service down'),
        ]);

        $this->actingAs($this->customer(9001))->postJson('/api/feedback', $this->payload())->assertStatus(503);
        $this->assertSame(0, CustomerFeedback::where('ticket_id', '5001')->count());

        Http::fake([
            '*feedback-form/status*' => Http::response(['is_enabled' => true], 200),
            '*/api/tickets/*' => Http::response('boom', 500),
        ]);

        $this->actingAs($this->customer(9001))->postJson('/api/feedback', $this->payload())->assertStatus(503);
        $this->assertSame(0, CustomerFeedback::where('ticket_id', '5001')->count());
    }

    public function test_ticket_lookup_is_made_as_the_caller_with_their_own_token(): void
    {
        $this->fakeTicket(9001);

        $this->actingAs($this->customer(9001))
            ->withHeader('Authorization', 'Bearer customer-token-abc')
            ->postJson('/api/feedback', $this->payload())
            ->assertStatus(201);

        Http::assertSent(fn ($request) => str_contains($request->url(), '/api/tickets/5001')
            && $request->hasHeader('Authorization', 'Bearer customer-token-abc'));
    }

    public function test_a_refusal_from_ticket_service_is_reported_as_not_found_and_nothing_is_saved(): void
    {
        foreach ([401, 403, 404] as $status) {
            Http::fake([
                '*feedback-form/status*' => Http::response(['is_enabled' => true], 200),
                '*/api/tickets/*' => Http::response(['message' => 'no'], $status),
            ]);

            $this->actingAs($this->customer(9001))->postJson('/api/feedback', $this->payload())->assertStatus(404);
        }

        $this->assertSame(0, CustomerFeedback::where('ticket_id', '5001')->count());
    }

    public function test_the_ticket_owner_is_compared_as_text_so_a_numeric_or_string_id_both_match(): void
    {
        Http::fake([
            '*feedback-form/status*' => Http::response(['is_enabled' => true], 200),
            '*/api/tickets/*' => Http::response(['ticket' => ['client_ID' => '9001', 'status_name' => 'Closed']], 200),
        ]);

        $this->actingAs($this->customer(9001))->postJson('/api/feedback', $this->payload())->assertStatus(201);
    }

    public function test_feedback_requires_ratings_and_a_ticket_id(): void
    {
        $this->fakeTicket(9001);

        $this->actingAs($this->customer(9001))->postJson('/api/feedback', ['ticket_id' => '5001'])->assertStatus(422);
        $this->actingAs($this->customer(9001))->postJson('/api/feedback', ['ratings' => ['7' => 5]])->assertStatus(422);
    }

    public function test_feedback_is_refused_with_403_when_the_admin_has_turned_it_off(): void
    {
        Http::fake(['*feedback-form/status*' => Http::response(['is_enabled' => false], 200)]);

        $this->actingAs($this->customer(9001))->postJson('/api/feedback', $this->payload())->assertStatus(403);
        $this->assertSame(0, CustomerFeedback::where('ticket_id', '5001')->count());
    }

    public function test_staff_cannot_create_feedback(): void
    {
        $this->fakeTicket(9001);

        $this->actingAs($this->staff(1, 'admin'))->postJson('/api/feedback', $this->payload())->assertStatus(403);
    }

    public function test_read_is_allowed_for_owner_and_staff_and_hidden_from_other_customers(): void
    {
        $this->makeFeedback(9001);

        $this->actingAs($this->customer(9001))->getJson('/api/feedback/ticket/5001')->assertStatus(200);
        $this->actingAs($this->staff(3))->getJson('/api/feedback/ticket/5001')->assertStatus(200);
        $this->actingAs($this->customer(9002))
            ->withHeaders(['X-User-ID' => '9001'])
            ->getJson('/api/feedback/ticket/5001?customer_id=9001')
            ->assertStatus(404);
    }

    public function test_update_is_owner_only_and_inside_the_48_hour_window(): void
    {
        $fb = $this->makeFeedback(9001);

        $this->actingAs($this->customer(9002))
            ->withHeaders(['X-User-ID' => '9001'])
            ->putJson('/api/feedback/ticket/5001', ['customer_id' => '9001', 'overall_comment' => 'hijack'])
            ->assertStatus(404);
        $this->assertSame('ok', $fb->fresh()->overall_comment);

        $this->actingAs($this->staff(3, 'admin'))->putJson('/api/feedback/ticket/5001', ['overall_comment' => 'staff'])->assertStatus(403);

        $this->actingAs($this->customer(9001))->putJson('/api/feedback/ticket/5001', ['overall_comment' => 'better'])->assertStatus(200);
        $this->assertSame('better', $fb->fresh()->overall_comment);

        CustomerFeedback::where('id', $fb->id)->update(['created_at' => now()->subHours(49)]);
        $this->actingAs($this->customer(9001))->putJson('/api/feedback/ticket/5001', ['overall_comment' => 'late'])->assertStatus(422);
    }

    public function test_delete_is_for_admin_and_superadmin_only_with_no_time_window(): void
    {
        $fb = $this->makeFeedback(9001);
        CustomerFeedback::where('id', $fb->id)->update(['created_at' => now()->subDays(30)]);

        $this->actingAs($this->customer(9001))->deleteJson('/api/feedback/ticket/5001')->assertStatus(403);
        $this->actingAs($this->customer(9002))->withHeaders(['X-User-Role' => 'admin'])->deleteJson('/api/feedback/ticket/5001')->assertStatus(403);
        $this->actingAs($this->staff(3, 'cs'))->deleteJson('/api/feedback/ticket/5001')->assertStatus(403);
        $this->assertNotNull(CustomerFeedback::find($fb->id));

        $this->actingAs($this->staff(4, 'admin'))->deleteJson('/api/feedback/ticket/5001')->assertStatus(200);
        $this->assertNull(CustomerFeedback::find($fb->id));

        $fb2 = $this->makeFeedback(9001, '5002');
        $this->actingAs($this->staff(5, 'super_admin'))->deleteJson('/api/feedback/ticket/5002')->assertStatus(200);
        $this->assertNull(CustomerFeedback::find($fb2->id));
    }

    public function test_csat_stats_and_predictive_metrics_are_staff_only(): void
    {
        $this->actingAs($this->customer(9001))->getJson('/api/csat-stats')->assertStatus(403);
        $this->actingAs($this->customer(9001))->withHeaders(['X-User-Role' => 'admin'])->getJson('/api/predictive-metrics')->assertStatus(403);

        $this->actingAs($this->staff(3))->getJson('/api/csat-stats')->assertStatus(200);
    }

    /**
     * Guard: controllers must never read client supplied identity again.
     */
    public function test_controllers_do_not_read_banned_identity_inputs(): void
    {
        $banned = 'X-Client-Id|X-User-Id|X-User-ID|X-User-Role|X-User-Type|X-User-Name|user_id|client_id|customer_id|emp_id|sender_id|created_by|user_role';
        $pattern = '/(?:->header|->input|->query|->get|->filled|->has|->post|->cookie)\(\s*[\'"](?:' . $banned . ')[\'"]|\$request->(?:user_id|client_id|customer_id|emp_id|sender_id|created_by|user_role)\b|\$validated\[\'customer_id\'\]/i';

        $offenders = [];
        $dir = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(app_path('Http'), \FilesystemIterator::SKIP_DOTS));
        foreach ($dir as $file) {
            if ($file->getExtension() !== 'php') {
                continue;
            }
            foreach (file($file->getPathname()) as $i => $line) {
                if (preg_match($pattern, $line)) {
                    $offenders[] = basename($file->getPathname()) . ':' . ($i + 1) . ' ' . trim($line);
                }
            }
        }

        $this->assertSame([], $offenders, "Banned identity inputs found:\n" . implode("\n", $offenders));
    }
}
