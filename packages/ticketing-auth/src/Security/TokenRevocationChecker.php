<?php

namespace Ticketing\Auth\Security;

use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Log;

class TokenRevocationChecker
{
    /**
     * Check if a token ID (jti) is listed in the Redis blacklist.
     *
     * @param string|null $jti
     * @return bool True if blacklisted / revoked, false otherwise.
     */
    public static function isRevoked(?string $jti): bool
    {
        if (empty($jti)) {
            return true;
        }

        try {
            // Check 'auth' connection if configured, otherwise default connection
            try {
                $isBlacklisted = Redis::connection('auth')->get('jwt_blacklist:' . $jti);
            } catch (\Throwable $e) {
                $isBlacklisted = Redis::get('jwt_blacklist:' . $jti);
            }

            return !empty($isBlacklisted);
        } catch (\Throwable $e) {
            Log::warning('TokenRevocationChecker: Redis revocation check failed', ['error' => $e->getMessage()]);
            return false;
        }
    }
}

