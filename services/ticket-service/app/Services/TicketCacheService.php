<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;

class TicketCacheService
{
    /**
     * Clear all cached ticket statistics, dashboard feeds, and form options.
     *
     * Pass the changed ticket's id to also delete that customer's dashboard counts key
     * directly (spec 0038 AC-13), which works on any cache driver, not only Redis SCAN.
     */
    public function clearTicketCaches(?int $ticketId = null): void
    {
        if ($ticketId !== null) {
            $this->forgetCustomerDashboardForTicket($ticketId);
        }

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
                '*ticket_attachments_data_*',
                '*admin_dashboard_metrics_*',
                '*admin_reports_metrics_*',
                '*admin_emp_perf_*',
                '*admin_dept_perf_*',
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
        } catch (\Exception $e) {
            Log::warning('Redis cache clearing failed: ' . $e->getMessage());
        }
    }

    /**
     * Direct key delete (never KEYS *) of the ticket owner's customer dashboard counts.
     */
    public function forgetCustomerDashboardForTicket(int $ticketId): void
    {
        try {
            $createdBy = \Illuminate\Support\Facades\DB::table('tickets')
                ->where('ticket_ID', $ticketId)
                ->where('is_internal', false)
                ->value('created_by');
            if ($createdBy) {
                Cache::forget("customer_dashboard_counts_{$createdBy}");
            }
        } catch (\Throwable $e) {
            Log::warning('Customer dashboard cache clear failed: ' . $e->getMessage());
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
