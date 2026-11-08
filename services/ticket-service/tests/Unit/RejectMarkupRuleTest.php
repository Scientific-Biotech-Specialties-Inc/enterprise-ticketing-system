<?php

namespace Tests\Unit;

use App\Services\TicketService;
use PHPUnit\Framework\TestCase;

class RejectMarkupRuleTest extends TestCase
{
    private function fails(string $value): bool
    {
        $service = (new \ReflectionClass(TicketService::class))->newInstanceWithoutConstructor();
        $failed = false;
        $service->rejectMarkup()('description', $value, function () use (&$failed) {
            $failed = true;
        });
        return $failed;
    }

    public function test_markup_payloads_are_rejected(): void
    {
        foreach ([
            '<script>alert(1)</script>',
            '<img src=x onerror=alert(1)>',
            '<<b>script>alert(1)<</b>/script>',
            '<svg/onload=alert(1)>',
            '<!-- x -->',
        ] as $payload) {
            $this->assertTrue($this->fails($payload), "Should reject: {$payload}");
        }
    }

    public function test_plain_text_is_accepted(): void
    {
        foreach (['Printer is broken', 'Temp < 5 and > 2 degrees', 'Error: a < b'] as $text) {
            $this->assertFalse($this->fails($text), "Should accept: {$text}");
        }
    }
}
