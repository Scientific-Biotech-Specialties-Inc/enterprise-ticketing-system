<?php

namespace Tests\Feature;

use Illuminate\Contracts\Debug\ExceptionHandler;
use Illuminate\Support\Facades\Http;
use League\OAuth2\Server\Exception\OAuthServerException;
use Tests\TestCase;

/**
 * Regression: Passport reports every rejected or expired bearer token as an
 * OAuthServerException. The handler treated it as an unhandled error and made a
 * blocking 3 second call to notification-service on each one, which slowed every
 * request carrying a bad token and timed out attachment access checks.
 */
class RejectedTokenAlertTest extends TestCase
{
    public function test_a_rejected_bearer_token_does_not_raise_a_system_alert(): void
    {
        Http::fake();

        app(ExceptionHandler::class)->report(OAuthServerException::accessDenied('Token rejected'));

        Http::assertNotSent(fn ($request) => str_contains($request->url(), 'system-alerts'));
    }

    public function test_a_real_server_error_still_raises_a_system_alert(): void
    {
        Http::fake();

        app(ExceptionHandler::class)->report(new \RuntimeException('Something actually broke'));

        Http::assertSent(fn ($request) => str_contains($request->url(), 'system-alerts'));
    }

    public function test_a_bad_bearer_token_is_rejected_quickly_without_alerting(): void
    {
        Http::fake();

        $this->getJson('/api/user', ['Authorization' => 'Bearer aaa.bbb.ccc'])->assertStatus(401);

        Http::assertNotSent(fn ($request) => str_contains($request->url(), 'system-alerts'));
    }
}
