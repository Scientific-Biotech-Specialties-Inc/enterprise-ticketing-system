<?php

namespace Tests\Feature;

use App\Models\EmailConfiguration;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Ticketing\Auth\Dto\AuthenticatedUserDto;
use Tests\TestCase;

/**
 * Spec 0040: Brevo email delivery in configuration-service.
 */
class EmailConfigurationTest extends TestCase
{
    use RefreshDatabase;

    private const VALID_KEY = 'xkeysib-0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab-AbCdEfGh12345678';

    private function superadmin(): AuthenticatedUserDto
    {
        return new AuthenticatedUserDto(['emp_id' => 5, 'role' => 'superadmin']);
    }

    private function internal(): array
    {
        $token = (string) env('INTERNAL_TOKEN');
        if ($token === '') {
            $this->markTestSkipped('INTERNAL_TOKEN is not configured.');
        }

        return ['X-Internal-Token' => $token];
    }

    private function fakeBrevo(int $accountStatus = 200, array $accountBody = ['email' => 'owner@example.com'], int $sendStatus = 201, array $sendBody = ['messageId' => '<abc@smtp-relay.mailin.fr>']): void
    {
        Http::fake([
            'api.brevo.com/v3/account' => Http::response($accountBody, $accountStatus),
            'api.brevo.com/v3/smtp/email' => Http::response($sendBody, $sendStatus),
        ]);
    }

    private function activeConfig(): EmailConfiguration
    {
        return EmailConfiguration::create([
            'provider' => 'Brevo',
            'api_key' => self::VALID_KEY,
            'from_name' => 'SBSI Support',
            'from_email' => 'support@example.com',
            'is_active' => true,
        ]);
    }

    public function test_superadmin_saves_a_verified_brevo_key_and_it_is_masked(): void
    {
        $this->fakeBrevo();

        $response = $this->actingAs($this->superadmin())->postJson('/api/email', [
            'apiKey' => self::VALID_KEY,
            'fromName' => 'SBSI Support',
            'fromEmail' => 'support@example.com',
        ]);

        $response->assertOk()
            ->assertJsonPath('data.provider', 'Brevo')
            ->assertJsonPath('data.apiKey', 'xkeysib-•••••••••');
        $this->assertStringNotContainsString(self::VALID_KEY, $response->getContent());

        $config = EmailConfiguration::where('is_active', true)->first();
        $this->assertSame('Brevo', $config->provider);
        $this->assertSame(self::VALID_KEY, $config->api_key);
        $this->assertNotSame(self::VALID_KEY, DB::table('email_configurations')->value('api_key'), 'api_key must be encrypted at rest');

        Http::assertSent(fn (HttpRequest $r) => $r->url() === 'https://api.brevo.com/v3/account'
            && $r->hasHeader('api-key', self::VALID_KEY));
    }

    public function test_smtp_key_is_rejected_without_calling_brevo(): void
    {
        Http::fake();

        $this->actingAs($this->superadmin())->postJson('/api/email', [
            'apiKey' => 'xsmtpsib-0123456789abcdef-AbCdEf',
            'fromName' => 'SBSI Support',
            'fromEmail' => 'support@example.com',
        ])->assertStatus(422)->assertJsonPath('errors.apiKey', fn ($m) => str_contains($m, 'SMTP key'));

        Http::assertNothingSent();
    }

    public function test_wrong_format_key_is_rejected(): void
    {
        Http::fake();

        $this->actingAs($this->superadmin())->postJson('/api/email', [
            'apiKey' => 're_oldresendkey123456',
            'fromName' => 'SBSI Support',
            'fromEmail' => 'support@example.com',
        ])->assertStatus(422)->assertJsonPath('errors.apiKey', fn ($m) => str_contains($m, 'xkeysib-'));

        Http::assertNothingSent();
    }

    public function test_revoked_key_returns_422(): void
    {
        $this->fakeBrevo(401, ['code' => 'unauthorized', 'message' => 'Key not found']);

        $this->actingAs($this->superadmin())->putJson('/api/email/api-key', ['apiKey' => self::VALID_KEY])
            ->assertStatus(422)
            ->assertJsonPath('errors.apiKey', fn ($m) => str_contains($m, 'invalid or revoked'));
    }

    public function test_blocked_ip_returns_the_authorised_ips_message(): void
    {
        $this->fakeBrevo(401, ['code' => 'unauthorized', 'message' => 'We have detected you are using an unrecognised IP address 203.0.113.9.']);

        $this->actingAs($this->superadmin())->postJson('/api/email', [
            'apiKey' => self::VALID_KEY,
            'fromName' => 'SBSI Support',
            'fromEmail' => 'support@example.com',
        ])->assertStatus(422)->assertJsonPath('errors.apiKey', fn ($m) => str_contains($m, 'Authorised IPs'));
    }

    public function test_send_test_email_goes_through_brevo_and_returns_message_id(): void
    {
        $this->fakeBrevo();
        $config = $this->activeConfig();

        $this->actingAs($this->superadmin())->postJson('/api/email/test', ['recipientEmail' => 'admin@example.com'])
            ->assertOk()
            ->assertJsonPath('message_id', '<abc@smtp-relay.mailin.fr>')
            ->assertJsonMissingPath('resend_id');

        $this->assertNotNull($config->fresh()->last_tested_at);
        Http::assertSent(fn (HttpRequest $r) => $r->url() === 'https://api.brevo.com/v3/smtp/email'
            && str_contains($r['subject'], 'Brevo'));
    }

    public function test_dispatch_maps_the_brevo_payload(): void
    {
        $this->fakeBrevo();
        $this->activeConfig();

        $this->withHeaders($this->internal())->postJson('/api/email/dispatch', [
            'to' => 'customer@example.com',
            'subject' => 'Ticket status changed',
            'html' => '<p>Hello</p>',
        ])->assertOk()->assertJsonPath('id', '<abc@smtp-relay.mailin.fr>');

        Http::assertSent(fn (HttpRequest $r) => $r->url() === 'https://api.brevo.com/v3/smtp/email'
            && $r['sender'] === ['email' => 'support@example.com', 'name' => 'SBSI Support']
            && $r['to'] === [['email' => 'customer@example.com']]
            && $r['htmlContent'] === '<p>Hello</p>'
            && $r['subject'] === 'Ticket status changed');
    }

    public function test_brevo_failure_on_dispatch_returns_502_with_error_status(): void
    {
        $this->fakeBrevo(sendStatus: 400, sendBody: ['code' => 'invalid_parameter', 'message' => 'sender is not valid']);
        $this->activeConfig();

        $this->withHeaders($this->internal())->postJson('/api/email/dispatch', [
            'to' => 'customer@example.com',
            'subject' => 'Ticket status changed',
            'html' => '<p>Hello</p>',
        ])->assertStatus(502)->assertJsonPath('status', 'error')->assertJsonPath('error', 'sender is not valid');
    }

    public function test_in_app_channel_skips_notification_mail_but_not_security_mail(): void
    {
        $this->fakeBrevo();
        $this->activeConfig();
        DB::table('notification_channels')->updateOrInsert(['alert_key' => 'new_ticket'], ['channel' => 'in_app']);

        $payload = ['to' => 'customer@example.com', 'subject' => 'Your verification code', 'html' => '<p>123456</p>'];

        $this->withHeaders($this->internal())->postJson('/api/email/dispatch', $payload)
            ->assertOk()->assertJsonPath('status', 'skipped');
        Http::assertNothingSent();

        $this->withHeaders($this->internal())->postJson('/api/email/dispatch', $payload + ['category' => 'security'])
            ->assertOk()->assertJsonPath('status', 'success');
        Http::assertSentCount(1);
    }

    public function test_unknown_category_is_rejected(): void
    {
        $this->withHeaders($this->internal())->postJson('/api/email/dispatch', [
            'to' => 'customer@example.com', 'subject' => 'x', 'html' => 'y', 'category' => 'marketing',
        ])->assertStatus(422);
    }

    public function test_dispatch_without_internal_token_is_unauthorized(): void
    {
        $this->actingAs($this->superadmin())->postJson('/api/email/dispatch', [
            'to' => 'customer@example.com', 'subject' => 'x', 'html' => 'y', 'category' => 'security',
        ])->assertStatus(401);
    }

    public function test_migration_deactivates_resend_rows_and_keeps_them(): void
    {
        $id = DB::table('email_configurations')->insertGetId([
            'provider' => 'Resend',
            'api_key' => encrypt('re_legacy', false),
            'from_name' => 'Old',
            'from_email' => 'old@example.com',
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $migration = require database_path('migrations/2026_11_13_000001_switch_email_provider_to_brevo.php');
        $migration->up();

        $this->assertDatabaseHas('email_configurations', ['id' => $id, 'provider' => 'Resend', 'is_active' => false]);
        $this->actingAs($this->superadmin())->getJson('/api/email')->assertOk()->assertJsonPath('is_configured', false);
    }
}
