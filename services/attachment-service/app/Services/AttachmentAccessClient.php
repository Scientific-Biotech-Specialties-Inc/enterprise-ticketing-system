<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Asks ticket-service whether the caller may open a ticket's files (spec 0037).
 *
 * attachment-service never reads ticket-service tables (AGENTS.md invariant 3), so
 * the participant rule lives behind ticket-service GET /api/internal/attachment-access.
 * The caller's bearer is forwarded so ticket-service verifies the identity itself.
 *
 * Successful answers are cached for 60 seconds under
 * att_access:{sha256(bearer)}:{t<ticket_id>|a<assignment_id>|none}.
 */
class AttachmentAccessClient
{
    public const CACHE_TTL_SECONDS = 60;

    /** The caller presented no usable identity, or ticket-service rejected it. */
    public const UNAUTHENTICATED = 'unauthenticated';
    /** The ticket or assignment does not exist. */
    public const NOT_FOUND = 'not_found';
    /** ticket-service could not be reached or answered badly. Fails closed. */
    public const UNAVAILABLE = 'unavailable';

    /**
     * @return array{allowed: bool, user_id: int, user_type: string}|string
     *         The decision, or one of the UNAUTHENTICATED / NOT_FOUND / UNAVAILABLE constants.
     */
    public function check(?string $bearer, ?int $ticketId = null, ?int $assignmentId = null)
    {
        if ($bearer === null || $bearer === '') {
            return self::UNAUTHENTICATED;
        }

        $scope = $ticketId !== null ? "t{$ticketId}" : ($assignmentId !== null ? "a{$assignmentId}" : 'none');
        $cacheKey = 'att_access:' . hash('sha256', $bearer) . ':' . $scope;

        try {
            $cached = Cache::get($cacheKey);
        } catch (\Throwable $e) {
            $cached = null;
        }
        if (is_array($cached)) {
            return $cached;
        }

        $query = array_filter([
            'ticket_id' => $ticketId,
            'assignment_id' => $assignmentId,
        ], fn ($v) => $v !== null);

        try {
            $response = Http::timeout(5)
                ->acceptJson()
                ->withToken($bearer)
                ->withHeaders(['X-Internal-Token' => (string) env('INTERNAL_TOKEN', '')])
                ->get(rtrim((string) env('TICKET_SERVICE_URL', 'http://ticket-service:8000'), '/') . '/api/internal/attachment-access', $query);
        } catch (\Throwable $e) {
            Log::error('Attachment access check failed: ticket-service unreachable: ' . $e->getMessage());
            return self::UNAVAILABLE;
        }

        if ($response->status() === 401) {
            return self::UNAUTHENTICATED;
        }
        if ($response->status() === 404) {
            return self::NOT_FOUND;
        }
        if (!$response->successful()) {
            Log::error('Attachment access check failed: ticket-service answered HTTP ' . $response->status());
            return self::UNAVAILABLE;
        }

        $json = $response->json();
        if (!is_array($json) || !array_key_exists('allowed', $json) || empty($json['user_type'])) {
            Log::error('Attachment access check failed: malformed answer from ticket-service.');
            return self::UNAVAILABLE;
        }

        $decision = [
            'allowed' => (bool) $json['allowed'],
            'user_id' => (int) ($json['user_id'] ?? 0),
            'user_type' => (string) $json['user_type'],
        ];

        try {
            Cache::put($cacheKey, $decision, self::CACHE_TTL_SECONDS);
        } catch (\Throwable $e) {
            // Cache is an optimisation only.
        }

        return $decision;
    }
}
