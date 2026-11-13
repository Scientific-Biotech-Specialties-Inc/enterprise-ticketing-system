<?php

namespace Tests\Unit;

use App\Mail\TicketNotificationMail;
use App\Services\TicketNotificationService;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * Spec 0040: ticket notification email goes through configuration-service (Brevo API) and
 * falls back to the Brevo SMTP relay when that call fails.
 */
class EmailDispatchFallbackTest extends TestCase
{
    private function dispatch(string $to = 'jane@customer.test'): void
    {
        $service = app(TicketNotificationService::class);
        $method = new \ReflectionMethod($service, 'dispatchEmail');
        $method->setAccessible(true);
        $method->invoke($service, $to, new TicketNotificationMail(
            'Ticket status changed', 'Your ticket is now In Progress.', 'TKT-0042', 'Printer jam', 'Hardware', 'High', 'http://localhost/tickets/42'
        ), 'status_update');
    }

    public function test_success_does_not_use_smtp(): void
    {
        Http::fake(['*/api/email/dispatch' => Http::response(['status' => 'success', 'id' => 'm-1'], 200)]);
        Mail::fake();

        $this->dispatch();

        Http::assertSent(fn (HttpRequest $r) => $r['category'] === 'notification' && $r['alert_key'] === 'status_update');
        Mail::assertNothingSent();
    }

    public function test_server_error_falls_back_to_smtp_and_logs_only_the_domain(): void
    {
        Http::fake(['*/api/email/dispatch' => Http::response(['status' => 'error', 'error' => 'sender is not valid'], 502)]);
        Mail::fake();
        Log::spy();

        $this->dispatch();

        Mail::assertSent(TicketNotificationMail::class, fn ($m) => $m->hasTo('jane@customer.test'));
        Log::shouldHaveReceived('warning')->withArgs(fn ($message, $context = []) => str_contains($message, 'SMTP backup')
            && ($context['service'] ?? null) === 'ticket-service'
            && ($context['recipient_domain'] ?? null) === 'customer.test'
            && !str_contains(json_encode($context), 'jane@'));
    }

    public function test_ok_response_with_error_status_falls_back(): void
    {
        Http::fake(['*/api/email/dispatch' => Http::response(['status' => 'error'], 200)]);
        Mail::fake();

        $this->dispatch();

        Mail::assertSent(TicketNotificationMail::class);
    }

    public function test_skipped_status_does_not_fall_back(): void
    {
        Http::fake(['*/api/email/dispatch' => Http::response(['status' => 'skipped'], 200)]);
        Mail::fake();

        $this->dispatch();

        Mail::assertNothingSent();
    }
}
