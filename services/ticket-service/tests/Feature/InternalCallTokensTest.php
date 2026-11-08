<?php

namespace Tests\Feature;

use App\Services\CsatSnapshotService;
use App\Services\TicketNotificationService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Spec 0034: calls from ticket-service to other services carry proof of who is calling.
 *  - analytics-service only answers verified staff, so the CSAT lookup passes on the staff member's own token.
 *  - configuration-service only accepts email dispatch from a service with a valid X-Internal-Token.
 */
class InternalCallTokensTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
    }

    private function bindRequest(?string $bearer): void
    {
        $request = Request::create('/api/admin-dashboard', 'GET');
        if ($bearer !== null) {
            $request->headers->set('Authorization', 'Bearer ' . $bearer);
        }
        app()->instance('request', $request);
    }

    private function csatBody(): array
    {
        return ['data' => ['average_score' => 4.5, 'satisfaction_percentage' => 80.0, 'total_reviews' => 2, 'ticket_ratings' => ['1' => 4.0, '2' => 5.0]]];
    }

    public function test_csat_lookup_passes_on_the_staff_members_own_token(): void
    {
        Http::fake(['*csat-stats*' => Http::response($this->csatBody(), 200)]);
        $this->bindRequest('staff-jwt-123');

        $snapshot = app(CsatSnapshotService::class)->forTickets([1, 2], now()->subDays(7), now());

        $this->assertTrue($snapshot['available']);
        $this->assertSame(4.5, $snapshot['average_score']);
        Http::assertSent(fn ($request) => str_contains($request->url(), '/api/csat-stats')
            && $request->hasHeader('Authorization', 'Bearer staff-jwt-123'));
    }

    public function test_csat_lookup_sends_no_authorization_header_when_there_is_no_caller_token(): void
    {
        Http::fake(['*csat-stats*' => Http::response(['message' => 'Unauthenticated.'], 401)]);
        $this->bindRequest(null);

        app(CsatSnapshotService::class)->forTickets([1], now()->subDays(7), now());

        Http::assertSent(fn ($request) => str_contains($request->url(), '/api/csat-stats') && !$request->hasHeader('Authorization'));
    }

    public function test_csat_shows_as_unavailable_not_invented_when_analytics_refuses_the_caller(): void
    {
        Http::fake(['*csat-stats*' => Http::response(['message' => 'Staff access only.'], 403)]);
        $this->bindRequest('customer-token');

        $snapshot = app(CsatSnapshotService::class)->forTickets([1], now()->subDays(7), now());

        $this->assertFalse($snapshot['available']);
        $this->assertNull($snapshot['average_score']);
        $this->assertTrue(Cache::has(CsatSnapshotService::DOWN_FLAG_KEY));
    }

    public function test_template_email_dispatch_presents_the_internal_token(): void
    {
        $token = (string) env('INTERNAL_TOKEN');
        if ($token === '') {
            $this->markTestSkipped('INTERNAL_TOKEN is not configured.');
        }

        Http::fake([
            '*email/dispatch-event*' => Http::response(['status' => 'success'], 200),
            '*' => Http::response([], 404),
        ]);

        $sent = app(TicketNotificationService::class)->dispatchTemplateEmail('person@example.com', 'ticket_created', ['ticket_id' => 5]);

        $this->assertTrue($sent);
        Http::assertSent(fn ($request) => str_contains($request->url(), '/api/email/dispatch-event')
            && $request->hasHeader('X-Internal-Token', $token));
    }

    public function test_template_email_dispatch_reports_failure_when_configuration_service_refuses(): void
    {
        // The base TestCase already fakes a successful dispatch, and the first matching fake wins. Start clean.
        Http::swap(new \Illuminate\Http\Client\Factory());
        Http::preventStrayRequests();
        Http::fake([
            '*email/dispatch-event*' => Http::response(['message' => 'Unauthorized internal service request.'], 401),
            '*' => Http::response([], 404),
        ]);

        $sent = app(TicketNotificationService::class)->dispatchTemplateEmail('person@example.com', 'ticket_created', []);

        $this->assertFalse($sent);
    }
}
