<?php

namespace Tests\Unit;

use App\Services\GeminiService;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class ClassifyCategoryTest extends TestCase
{
    private array $categories = [
        ['id' => 3, 'name' => 'Network Connectivity'],
        ['id' => 7, 'name' => 'Calibration'],
    ];

    private function service(string $key = 'test-key'): GeminiService
    {
        config(['services.gemini.api_key' => $key]);

        return new GeminiService();
    }

    private function fakeGemini(string $json): void
    {
        Http::fake(['*' => Http::response([
            'candidates' => [['content' => ['parts' => [['text' => $json]]]]],
        ])]);
    }

    public function test_returns_the_category_gemini_picked_from_the_list(): void
    {
        $this->fakeGemini('{"category_id": 7, "confidence": 0.92, "reasoning": "Calibration drift."}');

        $result = $this->service()->classifyCategory('Analyzer drift', 'Results are off', $this->categories);

        $this->assertSame(7, $result['category_id']);
        $this->assertSame('gemini', $result['source']);
    }

    public function test_rejects_an_id_that_is_not_in_the_supplied_list(): void
    {
        $this->fakeGemini('{"category_id": 99, "confidence": 0.99, "reasoning": "Invented."}');

        $result = $this->service()->classifyCategory('x', 'y', $this->categories);

        $this->assertNull($result['category_id']);
    }

    public function test_low_confidence_leaves_the_category_empty(): void
    {
        $this->fakeGemini('{"category_id": 3, "confidence": 0.3, "reasoning": "Unsure."}');

        $this->assertNull($this->service()->classifyCategory('x', 'y', $this->categories)['category_id']);
    }

    public function test_gemini_failure_degrades_to_manual_selection(): void
    {
        Http::fake(['*' => Http::response('boom', 500)]);

        $this->assertNull($this->service()->classifyCategory('x', 'y', $this->categories)['category_id']);
    }

    public function test_no_api_key_means_no_suggestion_and_no_http_call(): void
    {
        Http::fake();

        $this->assertNull($this->service('')->classifyCategory('x', 'y', $this->categories)['category_id']);
        Http::assertNothingSent();
    }
}
