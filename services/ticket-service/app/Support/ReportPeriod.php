<?php

namespace App\Support;

use Carbon\Carbon;

/**
 * Resolves a reporting period request into a canonical label and date window.
 *
 * Accepts both display labels sent by the React app ("Last 7 Days") and the
 * slug form used by the API contract ("last_7_days", "today", "this_week",
 * "this_month"), so an unrecognised-looking preset is never silently replaced.
 */
class ReportPeriod
{
    /** Canonical label keyed by normalised preset text. */
    private const ALIASES = [
        'today' => 'Today',
        'this week' => 'This Week',
        'this month' => 'This Month',
        'last 7 days' => 'Last 7 Days',
        'last 30 days' => 'Last 30 Days',
        'last 90 days' => 'Last 90 Days',
        'custom' => 'Custom Range',
        'custom range' => 'Custom Range',
    ];

    /**
     * @return array{0: string, 1: Carbon, 2: Carbon} [label, dateFrom, dateTo]
     */
    public static function resolve(array $filters, string $defaultLabel = 'Last 7 Days'): array
    {
        $now = Carbon::now();
        $hasDates = !empty($filters['date_from']);

        // 'period' and 'date_range' are accepted so a caller using either name is never silently ignored.
        $raw = $filters['preset'] ?? $filters['filter'] ?? $filters['period'] ?? $filters['date_range'] ?? null;
        $key = strtolower(trim(str_replace(['_', '-'], ' ', (string) $raw)));
        $label = self::ALIASES[$key] ?? null;

        // Explicit dates win over a missing or "custom" preset so they are never ignored.
        if ($hasDates && ($label === null || $label === 'Custom Range')) {
            $label = 'Custom Range';
        }
        $label ??= $defaultLabel;

        switch ($label) {
            case 'Today':
                return [$label, $now->copy()->startOfDay(), $now->copy()->endOfDay()];
            case 'This Week':
                return [$label, $now->copy()->startOfWeek(), $now->copy()->endOfWeek()];
            case 'This Month':
                return [$label, $now->copy()->startOfMonth(), $now->copy()->endOfMonth()];
            case 'Last 30 Days':
                return [$label, $now->copy()->subDays(29)->startOfDay(), $now->copy()->endOfDay()];
            case 'Last 90 Days':
                return [$label, $now->copy()->subDays(89)->startOfDay(), $now->copy()->endOfDay()];
            case 'Custom Range':
                if ($hasDates) {
                    $from = Carbon::parse($filters['date_from'])->startOfDay();
                    $to = !empty($filters['date_to']) ? Carbon::parse($filters['date_to'])->endOfDay() : $now->copy()->endOfDay();
                    return [$label, $from, $to];
                }
                // "Custom Range" without dates has no window; use the default.
                return self::resolve([], $defaultLabel);
            case 'Last 7 Days':
            default:
                return ['Last 7 Days', $now->copy()->subDays(6)->startOfDay(), $now->copy()->endOfDay()];
        }
    }
}
