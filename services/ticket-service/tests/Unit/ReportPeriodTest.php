<?php

namespace Tests\Unit;

use App\Support\ReportPeriod;
use Carbon\Carbon;
use PHPUnit\Framework\TestCase;

class ReportPeriodTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow(Carbon::parse('2026-11-04 10:00:00'));
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    /** @dataProvider presetProvider */
    public function test_presets_resolve_from_labels_and_slugs(string $input, string $label, string $from, string $to): void
    {
        [$resolved, $dateFrom, $dateTo] = ReportPeriod::resolve(['preset' => $input]);

        $this->assertSame($label, $resolved);
        $this->assertSame($from, $dateFrom->toDateString());
        $this->assertSame($to, $dateTo->toDateString());
    }

    public static function presetProvider(): array
    {
        return [
            'today slug' => ['today', 'Today', '2026-11-04', '2026-11-04'],
            'today label' => ['Today', 'Today', '2026-11-04', '2026-11-04'],
            'this week slug' => ['this_week', 'This Week', '2026-11-02', '2026-11-08'],
            'this month slug' => ['this_month', 'This Month', '2026-11-01', '2026-11-30'],
            'last 7 days slug' => ['last_7_days', 'Last 7 Days', '2026-10-29', '2026-11-04'],
            'last 30 days label' => ['Last 30 Days', 'Last 30 Days', '2026-10-06', '2026-11-04'],
        ];
    }

    public function test_explicit_dates_become_a_custom_range(): void
    {
        [$label, $from, $to] = ReportPeriod::resolve(['date_from' => '2026-01-01', 'date_to' => '2026-01-31']);

        $this->assertSame('Custom Range', $label);
        $this->assertSame('2026-01-01', $from->toDateString());
        $this->assertSame('2026-01-31', $to->toDateString());
    }

    public function test_unknown_preset_uses_the_caller_default(): void
    {
        [$label] = ReportPeriod::resolve(['preset' => 'nonsense'], 'Last 30 Days');

        $this->assertSame('Last 30 Days', $label);
    }

    public function test_period_and_date_range_names_are_accepted_as_preset_aliases(): void
    {
        [$a] = ReportPeriod::resolve(['period' => 'This Month']);
        [$b] = ReportPeriod::resolve(['date_range' => 'This Week']);

        $this->assertSame('This Month', $a);
        $this->assertSame('This Week', $b);
    }
}
