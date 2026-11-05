<?php

namespace App\Services;

use Carbon\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * CSAT from analytics-service for admin metrics, with a hard time budget (spec 0031 AC-14).
 *
 * One call waits at most 500 ms. A success is cached for 120 s. A failure raises an
 * "analytics unavailable" flag for 60 s, and while it is up no call is made at all.
 * When CSAT is unavailable the result says so; it never carries an invented score.
 */
class CsatSnapshotService
{
    public const DOWN_FLAG_KEY = 'analytics_csat_unavailable';
    public const SUCCESS_TTL = 120;
    public const DOWN_TTL = 60;
    private const MAX_TICKET_IDS = 500;

    /**
     * @param array<int, int|string> $ticketIds
     * @return array{available: bool, average_score: ?float, satisfaction_percentage: ?float, total_reviews: int, ticket_ratings: array<int|string, float>}
     */
    public function forTickets(array $ticketIds, Carbon $from, Carbon $to): array
    {
        if (Cache::has(self::DOWN_FLAG_KEY)) {
            return $this->unavailable();
        }

        $ids = array_values(array_unique(array_filter(array_map('intval', $ticketIds))));
        sort($ids);
        $ids = array_slice($ids, 0, self::MAX_TICKET_IDS);

        // Nothing to rate in this scope: CSAT is known to be empty, not unavailable.
        if ($ids === []) {
            return $this->empty();
        }

        $cacheKey = 'csat_snapshot_' . md5(implode(',', $ids) . '|' . $from->toDateString() . '|' . $to->toDateString());
        $cached = Cache::get($cacheKey);
        if (is_array($cached)) {
            return $cached;
        }

        $analyticsUrl = rtrim((string) env('ANALYTICS_SERVICE_URL', 'http://analytics-service:8000'), '/');

        try {
            $response = Http::withOptions(['timeout' => 0.5, 'connect_timeout' => 0.3])
                ->acceptJson()
                ->get("{$analyticsUrl}/api/csat-stats", [
                    'ticket_ids' => implode(',', $ids),
                    'date_from' => $from->toDateString(),
                    'date_to' => $to->toDateString(),
                ]);

            if (!$response->successful()) {
                throw new \RuntimeException('analytics-service answered HTTP ' . $response->status());
            }

            $data = (array) ($response->json('data') ?? []);
            $ratings = [];
            foreach ((array) ($data['ticket_ratings'] ?? []) as $ticketId => $score) {
                if (is_numeric($score)) {
                    $ratings[(int) $ticketId] = (float) $score;
                }
            }

            $totalReviews = (int) ($data['total_reviews'] ?? 0);
            $snapshot = [
                'available' => true,
                'average_score' => ($totalReviews > 0 && isset($data['average_score']) && is_numeric($data['average_score']))
                    ? round((float) $data['average_score'], 2)
                    : null,
                'satisfaction_percentage' => ($totalReviews > 0 && isset($data['satisfaction_percentage']) && is_numeric($data['satisfaction_percentage']))
                    ? round((float) $data['satisfaction_percentage'], 1)
                    : null,
                'total_reviews' => $totalReviews,
                'ticket_ratings' => $ratings,
            ];

            Cache::put($cacheKey, $snapshot, self::SUCCESS_TTL);

            return $snapshot;
        } catch (\Throwable $e) {
            Cache::put(self::DOWN_FLAG_KEY, true, self::DOWN_TTL);
            Log::info('CsatSnapshotService: analytics-service unavailable, CSAT hidden for ' . self::DOWN_TTL . 's: ' . $e->getMessage());

            return $this->unavailable();
        }
    }

    protected function unavailable(): array
    {
        return [
            'available' => false,
            'average_score' => null,
            'satisfaction_percentage' => null,
            'total_reviews' => 0,
            'ticket_ratings' => [],
        ];
    }

    protected function empty(): array
    {
        return array_merge($this->unavailable(), ['available' => true]);
    }
}
