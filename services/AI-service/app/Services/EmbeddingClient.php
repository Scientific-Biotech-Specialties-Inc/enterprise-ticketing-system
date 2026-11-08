<?php

namespace App\Services;

use App\Exceptions\EmbeddingFailedException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Spec 0036: the single place that turns text into embedding vectors.
 *
 * Calls Gemini `batchEmbedContents` (up to 100 texts per request) with the API key in the
 * `x-goog-api-key` header. Any failure (no key, non 2xx, timeout, empty or wrong sized
 * vectors) throws EmbeddingFailedException. There is no fallback vector: a vector from a
 * different model is not comparable, so storing or comparing one would make scores meaningless.
 */
class EmbeddingClient
{
    public const TASK_DOCUMENT = 'RETRIEVAL_DOCUMENT';
    public const TASK_QUERY = 'RETRIEVAL_QUERY';

    protected const BATCH_SIZE = 100;
    protected const MAX_INPUT_CHARS = 8000;
    protected const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

    protected string $apiKey;
    protected string $model;
    protected int $dimensions;
    protected int $timeout;

    /** How many times to wait and retry on HTTP 429. Zero inside interactive requests. */
    protected int $rateLimitRetries = 0;

    public function __construct()
    {
        $this->apiKey = (string) (config('services.gemini.api_key') ?? '');
        $this->model = (string) config('services.kb.embedding_model', 'gemini-embedding-001');
        $this->dimensions = (int) config('services.kb.embedding_dims', 768);
        $this->timeout = max(1, (int) config('services.kb.embedding_timeout', 20));
    }

    public function model(): string
    {
        return $this->model;
    }

    public function dimensions(): int
    {
        return $this->dimensions;
    }

    /**
     * Allow waiting and retrying on HTTP 429 (used by kb:reembed, which runs offline).
     */
    public function withRateLimitRetries(int $retries): static
    {
        $clone = clone $this;
        $clone->rateLimitRetries = max(0, $retries);

        return $clone;
    }

    /**
     * Embed one text and return its vector.
     */
    public function embedOne(string $text, string $taskType = self::TASK_QUERY): array
    {
        return $this->embedMany([$text], $taskType)[0];
    }

    /**
     * Embed many texts, in order. Returns one vector per input text.
     *
     * @param  string[]  $texts
     * @return array<int, float[]>
     *
     * @throws EmbeddingFailedException
     */
    public function embedMany(array $texts, string $taskType = self::TASK_DOCUMENT, ?string $title = null): array
    {
        $texts = array_values($texts);
        if (empty($texts)) {
            return [];
        }

        if ($this->apiKey === '') {
            throw new EmbeddingFailedException('Embedding API key is not configured (GEMINI_API_KEY).');
        }

        $vectors = [];
        foreach (array_chunk($texts, self::BATCH_SIZE) as $batch) {
            foreach ($this->requestBatch($batch, $taskType, $title) as $vector) {
                $vectors[] = $vector;
            }
        }

        return $vectors;
    }

    /**
     * @return array<int, float[]>
     */
    protected function requestBatch(array $batch, string $taskType, ?string $title): array
    {
        $modelPath = "models/{$this->model}";
        $requests = [];
        foreach ($batch as $text) {
            $text = trim((string) $text);
            if ($text === '') {
                throw new EmbeddingFailedException('Embedding input was empty.');
            }

            $request = [
                'model' => $modelPath,
                'content' => ['parts' => [['text' => mb_substr($text, 0, self::MAX_INPUT_CHARS)]]],
                'taskType' => $taskType,
                'outputDimensionality' => $this->dimensions,
            ];
            // Gemini only accepts a title for document embeddings.
            if ($taskType === self::TASK_DOCUMENT && $title !== null && trim($title) !== '') {
                $request['title'] = mb_substr(trim($title), 0, 255);
            }
            $requests[] = $request;
        }

        $url = self::BASE_URL . "/{$this->model}:batchEmbedContents";
        $attempt = 0;

        while (true) {
            try {
                $response = Http::withHeaders([
                    'Content-Type' => 'application/json',
                    'x-goog-api-key' => $this->apiKey,
                ])->connectTimeout(5)->timeout($this->timeout)->post($url, ['requests' => $requests]);
            } catch (ConnectionException $e) {
                $this->logFailure('timeout or connection error', null, $e);
                throw new EmbeddingFailedException('Embedding API request timed out or could not connect (' . class_basename($e) . ').');
            } catch (\Throwable $e) {
                $this->logFailure('request error', null, $e);
                throw new EmbeddingFailedException('Embedding API request failed (' . class_basename($e) . ').');
            }

            if ($response->status() === 429 && $attempt < $this->rateLimitRetries) {
                $attempt++;
                $wait = min(60, (int) ($response->header('Retry-After') ?: 5 * $attempt));
                Log::warning('Embedding API rate limited, waiting before retry.', ['attempt' => $attempt, 'wait_seconds' => $wait]);
                sleep($wait);
                continue;
            }

            if (!$response->successful()) {
                $apiStatus = (string) ($response->json('error.status') ?? '');
                $this->logFailure('non 2xx response', $response->status());
                throw new EmbeddingFailedException(
                    'Embedding API returned HTTP ' . $response->status() . ($apiStatus !== '' ? " ({$apiStatus})" : '') . " for model {$this->model}.",
                    $response->status()
                );
            }

            $embeddings = $response->json('embeddings');
            if (!is_array($embeddings) || count($embeddings) !== count($requests)) {
                $this->logFailure('wrong number of vectors', $response->status());
                throw new EmbeddingFailedException('Embedding API returned ' . (is_array($embeddings) ? count($embeddings) : 0) . ' vectors for ' . count($requests) . ' inputs.');
            }

            $vectors = [];
            foreach ($embeddings as $embedding) {
                $values = $embedding['values'] ?? null;
                if (!is_array($values) || count($values) === 0) {
                    $this->logFailure('empty vector', $response->status());
                    throw new EmbeddingFailedException('Embedding API returned an empty vector.');
                }
                if (count($values) !== $this->dimensions) {
                    $this->logFailure('dimension mismatch', $response->status());
                    throw new EmbeddingFailedException('Embedding API returned ' . count($values) . " dimensions, expected {$this->dimensions}.");
                }
                $vectors[] = array_map('floatval', $values);
            }

            return $vectors;
        }
    }

    /**
     * Log a failure without the URL, headers, or body, so the API key can never leak.
     */
    protected function logFailure(string $category, ?int $status, ?\Throwable $e = null): void
    {
        Log::warning('Gemini embedding request failed.', array_filter([
            'category' => $category,
            'http_status' => $status,
            'exception' => $e ? get_class($e) : null,
            'model' => $this->model,
        ], fn ($v) => $v !== null));
    }
}
