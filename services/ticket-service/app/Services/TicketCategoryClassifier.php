<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Spec 0043 (AC-6): the server decides a customer ticket's problem category by asking
 * AI-service `POST /classify-category` with the live active categories. Any timeout, error,
 * or low confidence answer means "unclassified" (null), never a guess.
 */
class TicketCategoryClassifier
{
    public const TIMEOUT_SECONDS = 3;
    public const MIN_CONFIDENCE = 0.6;

    /**
     * @param  string|null  $callerToken  the customer's own token, forwarded as spec 0034 requires
     */
    public function classify(string $title, string $description, ?string $callerToken): ?int
    {
        $categories = DB::table('problem_categories')
            ->where('is_active', true)
            ->orderBy('problem_category_ID')
            ->get(['problem_category_ID', 'category_name'])
            ->map(fn ($row) => ['id' => (int) $row->problem_category_ID, 'name' => (string) $row->category_name])
            ->values()
            ->all();

        if (empty($categories) || trim($description) === '') {
            return null;
        }

        try {
            $client = Http::timeout(self::TIMEOUT_SECONDS)->acceptJson();
            if (!empty($callerToken)) {
                $client = $client->withToken($callerToken);
            }

            $response = $client->post($this->endpoint(), [
                'title' => mb_substr($title, 0, 255),
                'description' => mb_substr($description, 0, 5000),
                'categories' => $categories,
            ]);

            if (!$response->successful()) {
                Log::info('Ticket category classification returned ' . $response->status() . '; storing unclassified.');
                return null;
            }

            $categoryId = $response->json('data.category_id');
            $confidence = (float) ($response->json('data.confidence') ?? 0);
            if ($categoryId === null || $confidence < self::MIN_CONFIDENCE) {
                return null;
            }

            $validIds = array_column($categories, 'id');
            return in_array((int) $categoryId, $validIds, true) ? (int) $categoryId : null;
        } catch (\Throwable $e) {
            Log::info('Ticket category classification failed; storing unclassified: ' . $e->getMessage());
            return null;
        }
    }

    protected function endpoint(): string
    {
        return rtrim((string) config('services.ai_service.url', 'http://AI-service:8000/api'), '/') . '/classify-category';
    }
}
