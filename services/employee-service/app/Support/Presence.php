<?php

namespace App\Support;

use Carbon\Carbon;
use Carbon\CarbonInterface;

/**
 * Derives an employee's presence from heartbeat freshness (spec 0035).
 *
 * Presence is derived, never stored, and never touches the `is_active` account flag.
 */
class Presence
{
    public const ONLINE = 'online';
    public const OFFLINE = 'offline';
    public const INACTIVE = 'inactive';

    public static function windowSeconds(): int
    {
        return max(1, (int) config('presence.online_window_seconds', 90));
    }

    public static function isOnline($lastSeenAt): bool
    {
        if (empty($lastSeenAt)) {
            return false;
        }

        $seen = $lastSeenAt instanceof CarbonInterface ? $lastSeenAt : Carbon::parse($lastSeenAt);

        return $seen->greaterThanOrEqualTo(now()->subSeconds(self::windowSeconds()));
    }

    public static function state(bool $isActive, $lastSeenAt): string
    {
        if (!$isActive) {
            return self::INACTIVE;
        }

        return self::isOnline($lastSeenAt) ? self::ONLINE : self::OFFLINE;
    }
}
