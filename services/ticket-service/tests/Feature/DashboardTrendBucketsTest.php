<?php

namespace Tests\Feature;

use App\Services\TicketDashboardService;
use Carbon\Carbon;
use ReflectionMethod;
use Tests\TestCase;

/**
 * Spec 0028 AC-3 and AC-4: trend charts follow the selected reporting window and use real ticket data.
 */
class DashboardTrendBucketsTest extends TestCase
{
    private TicketDashboardService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = app(TicketDashboardService::class);
    }

    private function invoke(string $method, array $args)
    {
        $m = new ReflectionMethod(TicketDashboardService::class, $method);
        $m->setAccessible(true);

        return $m->invoke($this->service, ...$args);
    }

    private function buckets(string $from, string $to): array
    {
        return $this->invoke('buildTrendBuckets', [Carbon::parse($from)->startOfDay(), Carbon::parse($to)->endOfDay()]);
    }

    private function labels(array $buckets): array
    {
        return array_map(fn ($b) => $b[2], $buckets);
    }

    public function test_one_day_window_uses_two_hour_buckets(): void
    {
        $buckets = $this->buckets('2026-11-03', '2026-11-03');

        $this->assertCount(12, $buckets);
        $this->assertSame('12AM', $buckets[0][2]);
        $this->assertSame('10PM', $buckets[11][2]);
    }

    public function test_this_week_has_exactly_seven_daily_buckets(): void
    {
        $labels = $this->labels($this->buckets('2026-11-02', '2026-11-08'));

        $this->assertSame(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], $labels);
    }

    public function test_a_month_uses_weekly_buckets_that_stay_inside_the_window(): void
    {
        $labels = $this->labels($this->buckets('2026-11-01', '2026-11-30'));

        $this->assertSame(['Nov 1', 'Nov 8', 'Nov 15', 'Nov 22', 'Nov 29'], $labels);
    }

    public function test_a_custom_year_uses_twelve_monthly_buckets_not_thirteen(): void
    {
        $labels = $this->labels($this->buckets('2026-01-01', '2026-12-31'));

        $this->assertCount(12, $labels);
        $this->assertSame('Jan 2026', $labels[0]);
        $this->assertSame('Dec 2026', $labels[11]);
    }

    public function test_ten_day_custom_range_is_daily_with_dates(): void
    {
        $labels = $this->labels($this->buckets('2026-11-01', '2026-11-10'));

        $this->assertCount(10, $labels);
        $this->assertSame('Nov 1', $labels[0]);
        $this->assertSame('Nov 10', $labels[9]);
    }

    public function test_series_come_from_real_tickets_and_empty_buckets_are_null(): void
    {
        $ticket = fn (int $id, string $created, ?string $resolved, string $status) => (object) [
            'ticket_ID' => $id,
            'created_at' => $created,
            'resolved_at' => $resolved,
            'closed_at' => null,
            'status_name' => $status,
            'resolution_due_at' => null,
            'sla_status' => null,
            'ticket_status_ID' => $status === 'Open' ? 1 : 3,
        ];

        $tickets = collect([
            $ticket(1, '2026-11-02 09:00:00', '2026-11-02 12:00:00', 'Resolved'), // Monday, 3 hours to resolve
            $ticket(2, '2026-11-02 10:00:00', null, 'Open'),                       // Monday, still open
            $ticket(3, '2026-11-04 08:00:00', '2026-11-04 10:00:00', 'Resolved'), // Wednesday, 2 hours
        ]);

        $out = $this->invoke('generateTrendBuckets', [
            'This Week',
            Carbon::parse('2026-11-02')->startOfDay(),
            Carbon::parse('2026-11-08')->endOfDay(),
            $tickets,
            collect(),
        ]);

        $this->assertSame(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], $out['labels']);
        $this->assertSame([2, 0, 1, 0, 0, 0, 0], $out['trends']['new']);
        $this->assertSame([1, 0, 1, 0, 0, 0, 0], $out['trends']['resolved']);

        // Hours to resolve are measured, and days with nothing resolved are gaps, not zeros or guesses.
        $this->assertSame(3.0, $out['resolution_time'][0]);
        $this->assertNull($out['resolution_time'][1]);
        $this->assertSame(2.0, $out['resolution_time'][2]);

        // No per day customer ratings exist, so the series is empty rather than invented.
        $this->assertSame([null, null, null, null, null, null, null], $out['csat']);
        $this->assertSame(array_fill(0, 7, null), array_map(fn ($v) => $v === null ? null : $v, array_slice($out['csat'], 0, 7)));
    }
}
