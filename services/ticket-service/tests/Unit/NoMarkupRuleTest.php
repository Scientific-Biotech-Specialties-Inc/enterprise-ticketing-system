<?php

namespace Tests\Unit;

use App\Rules\NoMarkup;
use PHPUnit\Framework\TestCase;

class NoMarkupRuleTest extends TestCase
{
    public function test_rejects_markup(): void
    {
        foreach (['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<<b>script>x<</b>/script>', '<svg/onload=alert(1)>', '<!-- x -->', '</div>'] as $p) {
            $this->assertTrue(NoMarkup::contains($p), $p);
        }
    }

    public function test_allows_plain_text(): void
    {
        foreach (['Printer is broken', 'Temp < 5 and > 2', 'a < b', '', null] as $t) {
            $this->assertFalse(NoMarkup::contains($t), (string) $t);
        }
    }
}
