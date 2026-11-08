<?php

namespace Tests\Unit;

use App\Services\SLAService;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * SLA limits count only the superadmin's configured working hours, in the
 * configured local timezone (previously hardcoded to 08:00 to 17:00 UTC).
 */
class SlaBusinessHoursTest extends TestCase
{
    private array $manila = [
        'enabled' => true,
        'timezone' => 'Asia/Manila',
        'startTime' => '08:00',
        'endTime' => '17:00',
        'workingDays' => [1, 2, 3, 4, 5],
    ];

    private function due(string $utcStart, int $minutes, array $config): string
    {
        return app(SLAService::class)
            ->addBusinessHours(Carbon::parse($utcStart, 'UTC'), $minutes, $config)
            ->setTimezone($config['timezone'] ?? 'UTC')
            ->format('Y-m-d H:i');
    }

    public function test_counts_within_the_same_local_working_day(): void
    {
        // Monday 09:00 Manila + 2h
        $this->assertSame('2026-11-09 11:00', $this->due('2026-11-09 01:00:00', 120, $this->manila));
    }

    public function test_rolls_remaining_minutes_into_the_next_working_day(): void
    {
        // Monday 16:00 Manila + 2h => 1h today, 1h from Tuesday 08:00
        $this->assertSame('2026-11-10 09:00', $this->due('2026-11-09 08:00:00', 120, $this->manila));
    }

    public function test_ticket_created_on_weekend_starts_counting_monday_morning_local_time(): void
    {
        // Sunday 05:22 Manila + 4h => Monday 12:00 Manila
        $this->assertSame('2026-11-09 12:00', $this->due('2026-11-07 21:22:00', 240, $this->manila));
    }

    public function test_custom_working_days_and_hours_are_respected(): void
    {
        $config = ['enabled' => true, 'timezone' => 'Asia/Manila', 'startTime' => '09:00', 'endTime' => '12:00', 'workingDays' => [6]];
        // Monday 10:00 Manila, only Saturdays 09:00 to 12:00 count, 4h => Sat 3h + next Sat 1h
        $this->assertSame('2026-11-21 10:00', $this->due('2026-11-09 02:00:00', 240, $config));
    }

    public function test_disabled_business_hours_count_around_the_clock(): void
    {
        $this->assertSame('2026-11-08 01:22', $this->due('2026-11-07 21:22:00', 240, ['enabled' => false]));
    }
}
