<?php

namespace Tests\Feature;

use Ticketing\Auth\Dto\AuthenticatedUserDto;
use Tests\TestCase;

/**
 * Spec 0034 follow up: the configuration service trusts only a verified token or a valid
 * X-Internal-Token. Headers, bodies, hand built tokens and a dev token grant nothing.
 */
class ConfigAccessTest extends TestCase
{
    private function staff(string $role, int $empId = 5): AuthenticatedUserDto
    {
        return new AuthenticatedUserDto(['emp_id' => $empId, 'role' => $role]);
    }

    private function customer(): AuthenticatedUserDto
    {
        return new AuthenticatedUserDto(['client_ID' => 9001, 'client_id' => 9001, 'id' => 9001, 'role' => 'customer']);
    }

    private function internal(): array
    {
        $token = (string) env('INTERNAL_TOKEN');
        if ($token === '') {
            $this->markTestSkipped('INTERNAL_TOKEN is not configured.');
        }

        return ['X-Internal-Token' => $token];
    }

    private function forgedJwt(string $role): string
    {
        $b64 = fn (array $d) => rtrim(strtr(base64_encode(json_encode($d)), '+/', '-_'), '=');

        return $b64(['alg' => 'none']) . '.' . $b64(['role' => $role, 'department' => 'superadmin', 'email' => 'superadmin@x.com']) . '.sig';
    }

    public function test_public_reads_need_no_token(): void
    {
        foreach (['/api/encryption-key', '/api/ticket-configurations/system-status', '/api/feedback-form/status', '/api/ticket-configurations/file_limits'] as $url) {
            $status = $this->getJson($url)->getStatusCode();
            $this->assertNotContains($status, [401, 403], "{$url} should be public");
        }
    }

    public function test_admin_routes_return_401_without_a_token(): void
    {
        $this->putJson('/api/ticket-configurations/windows', [])->assertStatus(401);
        $this->putJson('/api/ticket-configurations/bogus_key', [])->assertStatus(401);
        $this->getJson('/api/email')->assertStatus(401);
        $this->putJson('/api/email', [])->assertStatus(401);
        $this->deleteJson('/api/email')->assertStatus(401);
        $this->postJson('/api/email/test', [])->assertStatus(401);
        $this->getJson('/api/email-templates')->assertStatus(401);
        $this->putJson('/api/email-templates/ticket_created', [])->assertStatus(401);
        $this->getJson('/api/notification-channels')->assertStatus(401);
        $this->postJson('/api/feedback-questions', [])->assertStatus(401);
        $this->postJson('/api/feedback-form/status', [])->assertStatus(401);
        $this->postJson('/api/ticketing/configuration/email/test', [])->assertStatus(401);
    }

    public function test_spoofed_headers_forged_tokens_and_dev_token_grant_nothing(): void
    {
        $spoof = ['X-User-Role' => 'superadmin', 'X-User-Id' => '1', 'X-Actor-Name' => 'Super Admin'];

        $this->withHeaders($spoof)->putJson('/api/ticket-configurations/bogus_key', [])->assertStatus(401);
        $this->withHeaders($spoof)->getJson('/api/email')->assertStatus(401);
        $this->withHeaders($spoof + ['Authorization' => 'Bearer ' . $this->forgedJwt('superadmin')])
            ->putJson('/api/ticket-configurations/bogus_key', [])->assertStatus(401);
        $this->withHeaders(['Authorization' => 'Bearer frontend-dev-token'])->getJson('/api/email')->assertStatus(401);
        $this->withHeaders(['X-Internal-Token' => 'wrong'])->getJson('/api/email')->assertStatus(401);
    }

    public function test_customers_and_non_admin_staff_are_forbidden(): void
    {
        $this->actingAs($this->customer())->withHeaders(['X-User-Role' => 'superadmin'])->putJson('/api/ticket-configurations/bogus_key', [])->assertStatus(403);
        $this->actingAs($this->customer())->getJson('/api/email')->assertStatus(403);
        $this->actingAs($this->staff('cs'))->putJson('/api/ticket-configurations/bogus_key', [])->assertStatus(403);
        $this->actingAs($this->staff('service engineer'))->postJson('/api/feedback-questions', [])->assertStatus(403);
    }

    public function test_verified_admin_and_superadmin_reach_the_controller(): void
    {
        // An unknown section is rejected by the controller with 422, which proves access was granted.
        $this->actingAs($this->staff('admin'))->putJson('/api/ticket-configurations/bogus_key', [])->assertStatus(422);
        $this->actingAs($this->staff('Super Admin'))->putJson('/api/ticket-configurations/bogus_key', [])->assertStatus(422);
    }

    public function test_email_dispatch_is_for_internal_services_only(): void
    {
        $headers = $this->internal();

        $this->postJson('/api/email/dispatch', [])->assertStatus(401);
        $this->postJson('/api/email/dispatch-event', [])->assertStatus(401);
        $this->actingAs($this->staff('superadmin'))->postJson('/api/email/dispatch', [])->assertStatus(401);

        $status = $this->withHeaders($headers)->postJson('/api/email/dispatch', [])->getStatusCode();
        $this->assertNotContains($status, [401, 403]);
    }

    public function test_internal_token_may_write_admin_routes(): void
    {
        $this->withHeaders($this->internal())->putJson('/api/ticket-configurations/bogus_key', [])->assertStatus(401);
        // The controller still insists on X-Internal-Call: ticket-service for writes, so a bare token is not enough there.
        $this->withHeaders($this->internal() + ['X-Internal-Call' => 'ticket-service'])
            ->putJson('/api/ticket-configurations/bogus_key', [])->assertStatus(422);
    }

    /**
     * Guard: controllers must not trust caller supplied identity or hand decode tokens.
     */
    public function test_controllers_do_not_trust_headers_or_decode_tokens(): void
    {
        $pattern = '/(?:->header|->input|->query)\(\s*[\'"](?:X-User-Id|X-User-ID|X-User-Role|X-User-Type|X-User-Name|X-Actor-Name|user_id|actor)[\'"]|base64_decode|frontend-dev-token/i';

        $offenders = [];
        $dir = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(app_path('Http'), \FilesystemIterator::SKIP_DOTS));
        foreach ($dir as $file) {
            if ($file->getExtension() !== 'php' || in_array($file->getFilename(), ['VerifyEmployeeJwt.php', 'DecryptRsaPayload.php'], true)) {
                continue;
            }
            foreach (file($file->getPathname()) as $i => $line) {
                if (preg_match($pattern, $line)) {
                    $offenders[] = $file->getFilename() . ':' . ($i + 1) . ' ' . trim($line);
                }
            }
        }

        $this->assertSame([], $offenders, "Untrusted identity inputs found:\n" . implode("\n", $offenders));
    }
}
