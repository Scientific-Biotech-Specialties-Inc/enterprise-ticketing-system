<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;

class TicketCacheService
{
    /**
     * Clear all cached ticket statistics, dashboard feeds, and form options.
     */
    public function clearTicketCaches(): void
    {
        try {
            Cache::forget('cs_dashboard_counts');
            Cache::forget('ticket_form_options_cache');

            $redis = Redis::connection('cache');
            $prefix = config('cache.prefix') ?? 'laravel_cache';

            $patterns = [
                '*cs_incoming_tickets_*',
                '*cs_dashboard_recent_*',
                '*customer_dashboard_recent_*',
                '*customer_dashboard_counts_*',
            ];

            $driver = config('database.redis.client', 'phpredis');

            foreach ($patterns as $pattern) {
                if ($driver === 'phpredis') {
                    $client = $redis->client();
                    $iterator = null;
                    $loopCount = 0;
                    do {
                        $keys = $client->scan($iterator, $pattern, 100);
                        if ($keys === false) {
                            break;
                        }
                        if (!empty($keys)) {
                            foreach ($keys as $key) {
                                try {
                                    $client->del($key);
                                } catch (\Throwable $e) {}
                                $this->forgetCleanKey($key, $prefix);
                            }
                        }
                        $loopCount++;
                    } while ($iterator > 0 && $loopCount < 1000);
                } else {
                    $iterator = 0;
                    $loopCount = 0;
                    do {
                        $response = $redis->scan($iterator, ['match' => $pattern, 'count' => 100]);
                        $iterator = $response[0];
                        $keys = $response[1];
                        if (!empty($keys)) {
                            foreach ($keys as $key) {
                                try {
                                    $redis->del($key);
                                } catch (\Throwable $e) {}
                                $this->forgetCleanKey($key, $prefix);
                            }
                        }
                        $loopCount++;
                    } while ($iterator != 0 && $loopCount < 1000);
                }
            }

            // Cross-service Redis key invalidation without Laravel prefix
            try {
                $rawHost = config('database.redis.cache.host', config('database.redis.default.host', 'redis'));
                $rawPort = (int) config('database.redis.cache.port', config('database.redis.default.port', 6379));
                $rawPassword = config('database.redis.cache.password', config('database.redis.default.password'));

                $rawClient = new \Redis();
                if (@$rawClient->connect($rawHost, $rawPort, 1.5)) {
                    if ($rawPassword) {
                        $rawClient->auth($rawPassword);
                    }
                    foreach ($patterns as $pattern) {
                        $it = null;
                        $loops = 0;
                        do {
                            $rawKeys = $rawClient->scan($it, $pattern, 100);
                            if ($rawKeys === false) break;
                            if (!empty($rawKeys)) {
                                foreach ($rawKeys as $rk) {
                                    try {
                                        $rawClient->del($rk);
                                    } catch (\Throwable $e) {}
                                }
                            }
                            $loops++;
                        } while ($it > 0 && $loops < 500);
                    }
                    $rawClient->close();
                }
            } catch (\Throwable $e) {
                // Non-blocking fallback
            }
        } catch (\Exception $e) {
            Log::warning('Redis cache clearing failed: ' . $e->getMessage());
        }
    }

    /**
     * Clean cache key prefix and forget it from the Laravel cache store.
     */
    public function forgetCleanKey(string $key, string $prefix): void
    {
        $cleanKey = $key;
        if (strpos($key, ':') !== false) {
            $parts = explode(':', $key);
            $cleanKey = end($parts);
        } else {
            if (str_starts_with($key, $prefix)) {
                $cleanKey = substr($key, strlen($prefix));
            }
        }
        Cache::forget($cleanKey);
    }
}
