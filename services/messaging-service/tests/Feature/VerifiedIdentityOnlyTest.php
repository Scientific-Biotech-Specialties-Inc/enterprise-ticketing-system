<?php

namespace Tests\Feature;

use Tests\TestCase;

/**
 * Spec 0034 (AC-9, AC-13): message edit and delete take identity from the verified token only.
 */
class VerifiedIdentityOnlyTest extends TestCase
{
    public function test_message_update_with_only_identity_headers_and_no_token_gets_401(): void
    {
        $this->withHeaders(['X-User-Id' => '5', 'X-User-Type' => 'employee', 'X-User-Name' => 'Eve'])
            ->putJson('/api/tickets/1/messages/abc', ['user_id' => 5, 'content' => 'edited'])
            ->assertStatus(401);
    }

    public function test_message_delete_and_history_with_only_identity_headers_get_401(): void
    {
        $headers = ['X-User-Id' => '5', 'X-User-Type' => 'employee'];

        $this->withHeaders($headers)->deleteJson('/api/tickets/1/messages/abc', ['user_id' => 5])->assertStatus(401);
        $this->withHeaders($headers)->getJson('/api/tickets/1/messages/abc/history?user_id=5')->assertStatus(401);
    }

    /**
     * Guard: controllers must never read client supplied identity again.
     */
    public function test_controllers_do_not_read_banned_identity_inputs(): void
    {
        $banned = 'X-Client-Id|X-User-Id|X-User-ID|X-User-Role|X-User-Type|X-User-Name|user_id|client_id|customer_id|emp_id|sender_id|created_by|user_role|user_type|user_name';
        $pattern = '/(?:->header|->input|->query|->get|->filled|->has|->post|->cookie)\(\s*[\'"](?:' . $banned . ')[\'"]|\$request->(?:user_id|client_id|customer_id|emp_id|sender_id|created_by|user_role)\b/i';

        // Trusted exception (spec 0034): storeInternal is gated by a valid X-Internal-Token.
        $allowlist = ["'sender_id' => \$request->input('sender_id'),"];

        $offenders = [];
        $dir = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(app_path('Http'), \FilesystemIterator::SKIP_DOTS));
        foreach ($dir as $file) {
            if ($file->getExtension() !== 'php') {
                continue;
            }
            foreach (file($file->getPathname()) as $i => $line) {
                if (preg_match($pattern, $line) && !$this->isAllowlisted($line, $allowlist)) {
                    $offenders[] = str_replace(base_path() . DIRECTORY_SEPARATOR, '', $file->getPathname()) . ':' . ($i + 1) . ' ' . trim($line);
                }
            }
        }

        $this->assertSame([], $offenders, "Banned identity inputs found:\n" . implode("\n", $offenders));
    }

    private function isAllowlisted(string $line, array $allowlist): bool
    {
        foreach ($allowlist as $allowed) {
            if (str_contains($line, str_replace('\$', '$', $allowed))) {
                return true;
            }
        }

        return false;
    }
}
