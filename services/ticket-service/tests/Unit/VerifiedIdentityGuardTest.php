<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * Spec 0034 (AC-13): controllers must never read caller supplied identity again.
 *
 * Identity comes only from the verified user (see ResolvesVerifiedPrincipal). This guard fails
 * when a controller reads a banned header or body key to decide who is calling.
 */
class VerifiedIdentityGuardTest extends TestCase
{
    public function test_controllers_do_not_read_banned_identity_inputs(): void
    {
        $banned = 'X-Client-Id|X-User-Id|X-User-ID|X-User-Role|X-User-Type|X-User-Name|user_id|client_id|customer_id|emp_id|sender_id|created_by|user_role';
        $pattern = '/(?:->header|->input|->query|->get|->filled|->has|->post|->cookie)\(\s*[\'"](?:' . $banned . ')[\'"]|\$request->(?:user_id|client_id|customer_id|emp_id|sender_id|created_by|user_role)\b/i';

        // Allowed: a staff dashboard filter named customer_id. It narrows a report and is not the caller's identity.
        $allowlist = ["'customer_id' => \$request->query('customer_id'),"];

        $offenders = [];
        $root = dirname(__DIR__, 2) . '/app/Http';
        $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS));
        foreach ($files as $file) {
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
                $offenders[] = $file->getFilename() . ':' . ($i + 1) . ' ' . trim($line);
            }
        }

        $this->assertSame([], $offenders, "Banned identity inputs found:\n" . implode("\n", $offenders));
    }

    public function test_draft_controller_has_no_hand_decoded_tokens_or_token_record_lookups(): void
    {
        $source = file_get_contents(dirname(__DIR__, 2) . '/app/Http/Controllers/TicketDraftController.php');

        $this->assertStringNotContainsString('personal_access_tokens', $source);
        $this->assertStringNotContainsString('base64_decode', $source);
        $this->assertStringNotContainsString('bearerToken', $source);
    }
}
