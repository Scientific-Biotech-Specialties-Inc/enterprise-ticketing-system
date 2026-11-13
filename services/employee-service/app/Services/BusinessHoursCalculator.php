<?php

namespace App\Services;

use Carbon\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Spec 0039: business hours arithmetic for assignment period accept by deadlines.
 *
 * Ported from ticket-service SLAService::addBusinessHours() and
 * TicketConfigurationService::getBusinessHoursConfig() so both services compute the same
 * ack_due_at. Keep the two in step.
 */
class BusinessHoursCalculator
{
    public const DEFAULT_BUSINESS_HOURS = [
        'enabled' => true,
        'timezone' => 'UTC',
        'startTime' => '08:00',
        'endTime' => '17:00',
        'workingDays' => [1, 2, 3, 4, 5],
    ];

    /**
     * Add $minutes of business time to $start, counted in the business timezone.
     * When business hours are disabled the limit is counted around the clock.
     */
    public function addBusinessHours(Carbon $start, int $minutes, array $config = []): Carbon
    {
        if ($minutes <= 0) {
            return $start->copy();
        }

        $hours = $this->normalize(!empty($config) ? $config : $this->config());

        if (!$hours['enabled']) {
            return $start->copy()->addMinutes($minutes);
        }

        $originalTimezone = $start->getTimezone();
        $current = $this->advanceToNextBusinessWindow($start->copy()->setTimezone($hours['timezone']), $hours);
        $remainingMinutes = $minutes;

        while ($remainingMinutes > 0) {
            $endOfDay = $current->copy()->setTime($hours['endHour'], $hours['endMinute'], 0);
            $availableToday = intdiv(max(0, $endOfDay->getTimestamp() - $current->getTimestamp()), 60);

            if ($remainingMinutes <= $availableToday) {
                return $current->addMinutes($remainingMinutes)->setTimezone($originalTimezone);
            }

            $remainingMinutes -= $availableToday;
            $current = $this->advanceToNextBusinessWindow(
                $current->addDay()->setTime($hours['startHour'], $hours['startMinute'], 0),
                $hours
            );
        }

        return $current->setTimezone($originalTimezone);
    }

    /**
     * Business hours config from configuration-service, cached for 5 minutes, defaults on failure.
     */
    public function config(): array
    {
        try {
            return Cache::remember('employee:config:business_hours', 300, function () {
                $configUrl = env('CONFIGURATION_SERVICE_URL', 'http://configuration-service:8000');
                $response = Http::timeout(5)->get("{$configUrl}/api/ticket-configurations/business_hours");

                if (!$response->successful()) {
                    return self::DEFAULT_BUSINESS_HOURS;
                }

                $json = $response->json();
                $val = (array) ($json['value'] ?? $json);
                $timezone = (string) ($val['timezone'] ?? 'UTC');
                if (!in_array($timezone, \DateTimeZone::listIdentifiers(), true)) {
                    $timezone = 'UTC';
                }
                $days = array_values(array_filter(
                    array_map('intval', (array) ($val['workingDays'] ?? [1, 2, 3, 4, 5])),
                    fn ($d) => $d >= 1 && $d <= 7
                ));

                return [
                    'enabled' => (bool) ($val['enabled'] ?? true),
                    'timezone' => $timezone,
                    'startTime' => (string) ($val['startTime'] ?? '08:00'),
                    'endTime' => (string) ($val['endTime'] ?? '17:00'),
                    'workingDays' => $days ?: [1, 2, 3, 4, 5],
                ];
            });
        } catch (\Throwable $e) {
            Log::warning('Failed to fetch business hours configuration from configuration-service: ' . $e->getMessage());
            return self::DEFAULT_BUSINESS_HOURS;
        }
    }

    protected function advanceToNextBusinessWindow(Carbon $time, array $hours): Carbon
    {
        $current = $time->copy();

        // Bounded loop: skipping at most two weeks guarantees termination.
        for ($i = 0; $i < 15; $i++) {
            $startOfDay = $current->copy()->setTime($hours['startHour'], $hours['startMinute'], 0);
            $endOfDay = $current->copy()->setTime($hours['endHour'], $hours['endMinute'], 0);

            if (!in_array($current->dayOfWeekIso, $hours['workingDays'], true) || $current->gte($endOfDay)) {
                $current = $current->addDay()->setTime($hours['startHour'], $hours['startMinute'], 0);
                continue;
            }

            return $current->lt($startOfDay) ? $startOfDay : $current;
        }

        return $current;
    }

    protected function normalize(array $config): array
    {
        $defaults = self::DEFAULT_BUSINESS_HOURS;
        $enabled = array_key_exists('enabled', $config)
            ? (bool) $config['enabled']
            : (bool) ($config['businessHoursEnabled'] ?? $defaults['enabled']);

        $timezone = (string) ($config['timezone'] ?? $defaults['timezone']);
        if (!in_array($timezone, \DateTimeZone::listIdentifiers(), true)) {
            $timezone = 'UTC';
        }

        [$startHour, $startMinute] = array_map('intval', explode(':', (string) ($config['startTime'] ?? $defaults['startTime'])) + [0, 0]);
        [$endHour, $endMinute] = array_map('intval', explode(':', (string) ($config['endTime'] ?? $defaults['endTime'])) + [0, 0]);
        if ($endHour * 60 + $endMinute <= $startHour * 60 + $startMinute) {
            [$startHour, $startMinute, $endHour, $endMinute] = [8, 0, 17, 0];
        }

        $days = array_values(array_filter(
            array_map('intval', (array) ($config['workingDays'] ?? $defaults['workingDays'])),
            fn ($d) => $d >= 1 && $d <= 7
        ));

        return [
            'enabled' => $enabled,
            'timezone' => $timezone,
            'startHour' => $startHour,
            'startMinute' => $startMinute,
            'endHour' => $endHour,
            'endMinute' => $endMinute,
            'workingDays' => $days ?: [1, 2, 3, 4, 5],
        ];
    }
}
