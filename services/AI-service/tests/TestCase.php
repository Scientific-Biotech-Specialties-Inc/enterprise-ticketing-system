<?php

namespace Tests;

use Illuminate\Auth\GenericUser;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\Http;

abstract class TestCase extends BaseTestCase
{
    use CreatesApplication;

    /**
     * Spec 0036: tests never reach the real embedding API. Set this to a callable
     * (HttpRequest $request) => response to simulate failures; null means healthy fake vectors.
     *
     * @var callable|null
     */
    protected $embeddingResponder = null;

    protected function setUp(): void
    {
        parent::setUp();

        if (empty(config('services.gemini.api_key'))) {
            config(['services.gemini.api_key' => 'test-key']);
        }

        Http::fake([
            '*:batchEmbedContents' => function (HttpRequest $request) {
                if ($this->embeddingResponder !== null) {
                    return ($this->embeddingResponder)($request);
                }

                $dims = (int) ($request->data()['requests'][0]['outputDimensionality'] ?? 768);
                $embeddings = array_map(
                    fn ($r) => ['values' => self::fakeEmbedding((string) ($r['content']['parts'][0]['text'] ?? ''), $dims)],
                    $request->data()['requests'] ?? []
                );

                return Http::response(['embeddings' => $embeddings], 200);
            },
        ]);
    }

    /**
     * Make the fake embedding API fail with this HTTP status from now on.
     */
    protected function failEmbeddingsWith(int $status = 404): void
    {
        $this->embeddingResponder = fn () => Http::response(['error' => ['code' => $status, 'status' => 'NOT_FOUND', 'message' => 'models/x is not found']], $status);
    }

    protected function restoreEmbeddings(): void
    {
        $this->embeddingResponder = null;
    }

    /**
     * Number of requests sent to the embedding endpoint so far.
     */
    protected function embeddingCallCount(): int
    {
        return count(Http::recorded(fn (HttpRequest $request) => str_contains($request->url(), ':batchEmbedContents')));
    }

    /**
     * Deterministic, word based stand in for a real embedding. It lives only in the test suite:
     * the application never produces or stores vectors like this (spec 0036, AC-1).
     */
    public static function fakeEmbedding(string $text, int $dims = 768): array
    {
        $vec = array_fill(0, $dims, 0.0);
        $words = preg_split('/[\s\p{P}]+/u', mb_strtolower($text), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        foreach ($words as $word) {
            $vec[abs(crc32($word)) % $dims] += 1.0;
            $vec[abs(crc32($word . '_salt')) % $dims] += 0.5;
        }
        $norm = sqrt(array_sum(array_map(fn ($v) => $v * $v, $vec)));
        if ($norm > 0) {
            $vec = array_map(fn ($v) => $v / $norm, $vec);
        } else {
            $vec[0] = 1.0;
        }

        return $vec;
    }

    /**
     * Act as a verified superadmin (what auth.token_or_internal accepts after signature checks).
     */
    protected function actingAsSuperAdmin(string $name = 'Super Admin'): static
    {
        return $this->actingAs(new GenericUser(['id' => 1, 'emp_id' => 1, 'name' => $name, 'role' => 'superadmin', 'department' => 'Super Admin']), 'api');
    }

    /**
     * Act as a verified employee who is not a superadmin.
     */
    protected function actingAsEmployee(string $name = 'Regular Employee'): static
    {
        return $this->actingAs(new GenericUser(['id' => 99, 'emp_id' => 99, 'name' => $name, 'role' => 'technician', 'department' => 'Support']), 'api');
    }
}
