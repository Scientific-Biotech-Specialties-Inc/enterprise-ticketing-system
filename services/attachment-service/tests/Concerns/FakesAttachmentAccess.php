<?php

namespace Tests\Concerns;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/**
 * Spec 0037: attachment-service asks ticket-service who the caller is and whether
 * they belong to a ticket. Tests fake that internal endpoint instead of calling it.
 */
trait FakesAttachmentAccess
{
    protected string $callerBearer = 'test-caller-bearer';
    protected array $attachmentAccessFake = [];
    protected bool $attachmentAccessFakeRegistered = false;

    /**
     * Fake GET /api/internal/attachment-access.
     *
     * @param array<int|string, bool> $allowedByTicket  ticket id => allowed (also used for assignment ids with an "a" prefix)
     */
    protected function fakeAttachmentAccess(
        int $userId = 501,
        string $userType = 'customer',
        array $allowedByTicket = [],
        int $status = 200
    ): void {
        putenv('INTERNAL_TOKEN=test-internal-token');
        $_ENV['INTERNAL_TOKEN'] = 'test-internal-token';
        $_SERVER['INTERNAL_TOKEN'] = 'test-internal-token';

        try {
            Cache::flush();
        } catch (\Throwable $e) {
        }

        // Http::fake stubs are matched in the order registered, so register one stub
        // and let it read the latest settings. Calling this again re-points the fake.
        $this->attachmentAccessFake = compact('userId', 'userType', 'allowedByTicket', 'status');
        if ($this->attachmentAccessFakeRegistered) {
            return;
        }
        $this->attachmentAccessFakeRegistered = true;

        Http::fake([
            '*/api/internal/attachment-access*' => function ($request) {
                ['userId' => $userId, 'userType' => $userType, 'allowedByTicket' => $allowedByTicket, 'status' => $status] = $this->attachmentAccessFake;
                if ($status !== 200) {
                    return Http::response(['message' => 'error'], $status);
                }
                parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $query);
                $allowed = true;
                if (isset($query['ticket_id'])) {
                    $allowed = $allowedByTicket[(int) $query['ticket_id']] ?? false;
                } elseif (isset($query['assignment_id'])) {
                    $allowed = $allowedByTicket['a' . (int) $query['assignment_id']] ?? false;
                }
                return Http::response(['allowed' => $allowed, 'user_id' => $userId, 'user_type' => $userType], 200);
            },
        ]);
    }
}
