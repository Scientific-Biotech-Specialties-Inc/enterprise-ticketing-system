<?php

namespace Tests\Feature;

use App\Mail\FirstLoginOtpMail;
use App\Services\AuthService;
use App\Services\Mail\ConfigServiceMailer;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Spec 0040: auth email goes through configuration-service first (category=security) and
 * falls back to the Brevo SMTP relay (Laravel Mail) when that call fails.
 */
class ConfigServiceMailerTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        if (!Schema::hasTable('password_reset_otps')) {
            Schema::create('password_reset_otps', function ($table) {
                $table->id();
                $table->string('email')->unique();
                $table->string('otp_hash');
                $table->unsignedTinyInteger('attempts')->default(0);
                $table->timestamp('expires_at');
                $table->timestamp('used_at')->nullable();
                $table->timestamps();
            });
        }
    }

    private function mailable(): FirstLoginOtpMail
    {
        return new FirstLoginOtpMail('Jane Customer', '482913', 10);
    }

    public function test_security_mail_posts_rendered_html_to_configuration_service(): void
    {
        Http::fake(['*/api/email/dispatch' => Http::response(['status' => 'success', 'id' => 'm-1'], 200)]);
        Mail::fake();

        app(ConfigServiceMailer::class)->send('jane@customer.test', $this->mailable(), null, ConfigServiceMailer::CATEGORY_SECURITY);

        Http::assertSent(fn (HttpRequest $r) => str_ends_with($r->url(), '/api/email/dispatch')
            && $r['to'] === 'jane@customer.test'
            && $r['category'] === 'security'
            && $r['subject'] === 'Your first login verification code'
            && str_contains($r['html'], '482913')
            && $r->hasHeader('X-Internal-Token'));
        Mail::assertNothingSent();
    }

    public function test_server_error_falls_back_to_smtp_and_logs_only_the_domain(): void
    {
        Http::fake(['*/api/email/dispatch' => Http::response(['status' => 'error', 'error' => 'boom'], 500)]);
        Mail::fake();
        Log::spy();

        app(ConfigServiceMailer::class)->send('jane@customer.test', $this->mailable(), null, ConfigServiceMailer::CATEGORY_SECURITY);

        Mail::assertSent(FirstLoginOtpMail::class, fn ($m) => $m->hasTo('jane@customer.test'));
        Log::shouldHaveReceived('warning')->once()->withArgs(function ($message, $context) {
            $flat = json_encode($context);

            return str_contains($message, 'SMTP backup')
                && $context['service'] === 'customer-service'
                && $context['recipient_domain'] === 'customer.test'
                && !str_contains($flat, 'jane@')
                && !str_contains($flat, '482913');
        });
    }

    public function test_connection_error_falls_back_to_smtp(): void
    {
        Http::fake(fn () => throw new ConnectionException('Connection refused'));
        Mail::fake();

        app(ConfigServiceMailer::class)->send('jane@customer.test', $this->mailable(), null, ConfigServiceMailer::CATEGORY_SECURITY);

        Mail::assertSent(FirstLoginOtpMail::class);
    }

    public function test_ok_response_with_error_status_falls_back(): void
    {
        Http::fake(['*/api/email/dispatch' => Http::response(['status' => 'error'], 200)]);
        Mail::fake();

        app(ConfigServiceMailer::class)->send('jane@customer.test', $this->mailable(), null, ConfigServiceMailer::CATEGORY_SECURITY);

        Mail::assertSent(FirstLoginOtpMail::class);
    }

    public function test_skipped_status_does_not_fall_back(): void
    {
        Http::fake(['*/api/email/dispatch' => Http::response(['status' => 'skipped'], 200)]);
        Mail::fake();

        app(ConfigServiceMailer::class)->send('jane@customer.test', $this->mailable(), 'new_ticket');

        Mail::assertNothingSent();
    }

    public function test_first_login_otp_reports_failure_when_both_paths_fail(): void
    {
        Http::fake(['*/api/email/dispatch' => Http::response([], 503)]);
        Mail::shouldReceive('to')->andThrow(new \RuntimeException('SMTP down'));

        $sent = app(AuthService::class)->sendFirstLoginOtp('jane@customer.test', 'Jane Customer');

        $this->assertFalse($sent);
    }

    public function test_first_login_otp_succeeds_through_configuration_service(): void
    {
        Http::fake(['*/api/email/dispatch' => Http::response(['status' => 'success'], 200)]);
        Mail::fake();

        $this->assertTrue(app(AuthService::class)->sendFirstLoginOtp('jane@customer.test', 'Jane Customer'));
        Mail::assertNothingSent();
    }
}
