<?php

namespace App\Services;

use App\Exceptions\PurgeAlreadyInProgressException;
use App\Exceptions\PurgeExecutionFailedException;
use App\Models\AuditPurgeRun;
use App\Models\AuditRetentionSetting;
use Cron\CronExpression;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;
use InvalidArgumentException;
use Throwable;

class AuditRetentionService
{
    /**
     * Strict hardcoded table isolation barrier (AC-8).
     * Deletions are permanently restricted to ticket_audit_logs.
     */
    private const TARGET_TABLE = 'ticket_audit_logs';

    /**
     * Primary key column of ticket_audit_logs used for keyset chunk ordering.
     */
    private const TARGET_PRIMARY_KEY = 'log_ID';

    /**
     * Track cumulative retry attempts from the most recent purge execution.
     */
    protected int $lastRetryCount = 0;

    /**
     * Return active retention settings, next scheduled run, pre-purge impact estimate, and last run.
     */
    public function getRetentionConfiguration(): array
    {
        $settings = AuditRetentionSetting::current();
        $impact = $this->calculateImpact($settings->retention_days);
        $nextRunAt = $this->calculateNextRunAt($settings->purge_schedule, $settings->is_auto_purge_enabled);
        $lastRun = AuditPurgeRun::query()
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->first();

        return [
            'retention_days' => (int) $settings->retention_days,
            'is_auto_purge_enabled' => (bool) $settings->is_auto_purge_enabled,
            'purge_schedule' => (string) $settings->purge_schedule,
            'chunk_size' => (int) $settings->chunk_size,
            'next_run_at' => $nextRunAt,
            'pending_purge_estimate' => $impact['affected_records_count'],
            'last_run' => $lastRun?->toApiArray(),
            'threshold_date' => $impact['cutoff_timestamp'],
            'affected_records_count' => $impact['affected_records_count'],
            'schedule' => (string) $settings->purge_schedule,
            'last_purged_at' => $lastRun?->created_at?->toIso8601String(),
        ];
    }

    /**
     * Persist updated retention policy settings while enforcing the 30-day safety floor (AC-1).
     */
    public function updateRetentionConfiguration(array $payload, ?int $updatedById = null): AuditRetentionSetting
    {
        $floor = $this->getSafetyFloorDays();
        $retentionDays = (int) ($payload['retention_days'] ?? 0);

        if ($retentionDays < $floor) {
            throw new InvalidArgumentException(
                "Retention period must be at least {$floor} days."
            );
        }

        $settings = AuditRetentionSetting::current();
        $settings->retention_days = $retentionDays;

        if (array_key_exists('is_auto_purge_enabled', $payload) && $payload['is_auto_purge_enabled'] !== null) {
            $settings->is_auto_purge_enabled = (bool) $payload['is_auto_purge_enabled'];
        }

        if (array_key_exists('purge_schedule', $payload) && $payload['purge_schedule'] !== null) {
            $schedule = trim((string) $payload['purge_schedule']);
            if (!CronExpression::isValidExpression($schedule)) {
                throw new InvalidArgumentException('Invalid cron schedule expression.');
            }
            $settings->purge_schedule = $schedule;
        }

        $settings->updated_by_id = $updatedById;
        $settings->save();

        return $settings->fresh();
    }

    /**
     * Calculate exact expired record count without mutating any database state (AC-2).
     */
    public function calculateImpact(?int $previewDays = null): array
    {
        $floor = $this->getSafetyFloorDays();
        $days = $previewDays !== null
            ? $previewDays
            : (int) AuditRetentionSetting::current()->retention_days;

        if ($days < $floor) {
            throw new InvalidArgumentException(
                "Retention period must be at least {$floor} days."
            );
        }

        $cutoff = Carbon::now()->subDays($days);
        $affectedCount = DB::table(self::TARGET_TABLE)
            ->where('created_at', '<', $cutoff)
            ->count();

        return [
            'retention_days' => $days,
            'cutoff_timestamp' => $cutoff->toIso8601String(),
            'affected_records_count' => (int) $affectedCount,
        ];
    }

    /**
     * Execute keyset-chunked audit log purge protected by Redis mutex lock, retries, and alerting (AC-3..AC-8).
     */
    public function executePurge(string $triggerSource = 'scheduled', ?int $executedById = null): AuditPurgeRun
    {
        if (!in_array($triggerSource, ['scheduled', 'manual'], true)) {
            throw new InvalidArgumentException("Invalid trigger source '{$triggerSource}'.");
        }

        $lockToken = $this->acquireLock();
        $this->lastRetryCount = 0;

        $startNs = hrtime(true);
        $settings = AuditRetentionSetting::current();
        $floor = $this->getSafetyFloorDays();
        $retentionDays = max($floor, (int) $settings->retention_days);
        $chunkSize = max(1, (int) ($settings->chunk_size ?: config('audit.purge_chunk_size', 1000)));
        $cutoff = Carbon::now()->subDays($retentionDays);

        $recordsIdentified = 0;
        $recordsDeleted = 0;
        $lastSeenId = 0;

        try {
            $recordsIdentified = (int) $this->executeWithRetry(function () use ($cutoff): int {
                return $this->countExpiredRecords($cutoff);
            });

            while (true) {
                [$deletedInBatch, $batchMaxId, $fetchedCount] = $this->executeWithRetry(
                    function () use ($cutoff, $lastSeenId, $chunkSize): array {
                        return $this->deleteKeysetBatch($cutoff, $lastSeenId, $chunkSize);
                    }
                );

                if ($fetchedCount === 0) {
                    break;
                }

                $recordsDeleted += $deletedInBatch;
                $lastSeenId = $batchMaxId;

                if ($fetchedCount < $chunkSize) {
                    break;
                }
            }

            $durationMs = $this->elapsedMilliseconds($startNs);

            $status = ($this->lastRetryCount > 0 && $recordsDeleted < $recordsIdentified)
                ? 'partial'
                : 'success';

            return $this->recordPurgeRun([
                'trigger_source' => $triggerSource,
                'retention_days' => $retentionDays,
                'cutoff_timestamp' => $cutoff,
                'records_identified' => $recordsIdentified,
                'records_deleted' => $recordsDeleted,
                'duration_ms' => $durationMs,
                'status' => $status,
                'error_message' => null,
                'executed_by_id' => $executedById,
            ]);
        } catch (Throwable $e) {
            $durationMs = $this->elapsedMilliseconds($startNs);
            $sanitizedError = SystemAlertSanitizer::scrubString($e->getMessage());

            $failedRun = $this->recordPurgeRunSafely([
                'trigger_source' => $triggerSource,
                'retention_days' => $retentionDays,
                'cutoff_timestamp' => $cutoff,
                'records_identified' => $recordsIdentified,
                'records_deleted' => $recordsDeleted,
                'duration_ms' => $durationMs,
                'status' => 'failed',
                'error_message' => $sanitizedError,
                'executed_by_id' => $executedById,
            ]);

            $this->dispatchEmergencyAlert(
                run: $failedRun,
                sanitizedError: $sanitizedError,
                triggerSource: $triggerSource,
                retentionDays: $retentionDays,
                cutoff: $cutoff,
                recordsIdentified: $recordsIdentified,
                recordsDeleted: $recordsDeleted
            );

            throw new PurgeExecutionFailedException($sanitizedError, $failedRun, $e);
        } finally {
            $this->releaseLock($lockToken);
        }
    }

    /**
     * Retrieve paginated historical purge run records (AC-10).
     */
    public function getPurgeHistory(int $page = 1, int $perPage = 15): array
    {
        $paginator = AuditPurgeRun::query()
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->paginate($perPage, ['*'], 'page', $page);

        return [
            'runs' => collect($paginator->items())
                ->map(fn (AuditPurgeRun $run): array => $run->toApiArray())
                ->values()
                ->all(),
            'pagination' => [
                'current_page' => $paginator->currentPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
                'last_page' => $paginator->lastPage(),
                'from' => $paginator->firstItem(),
                'to' => $paginator->lastItem(),
            ],
        ];
    }

    /**
     * Return the number of retry attempts triggered in the most recent run.
     */
    public function getLastRetryCount(): int
    {
        return $this->lastRetryCount;
    }

    /**
     * Count expired records strictly within ticket_audit_logs.
     */
    protected function countExpiredRecords(Carbon $cutoff): int
    {
        return (int) DB::table(self::TARGET_TABLE)
            ->where('created_at', '<', $cutoff)
            ->count();
    }

    /**
     * Identify and delete a single keyset-ordered batch strictly from ticket_audit_logs (AC-3, AC-8).
     *
     * @return array{0: int, 1: int, 2: int} [deletedCount, maxPrimaryKeySeen, fetchedIdsCount]
     */
    protected function deleteKeysetBatch(Carbon $cutoff, int $lastSeenId, int $chunkSize): array
    {
        $ids = DB::table(self::TARGET_TABLE)
            ->where('created_at', '<', $cutoff)
            ->where(self::TARGET_PRIMARY_KEY, '>', $lastSeenId)
            ->orderBy(self::TARGET_PRIMARY_KEY, 'asc')
            ->limit($chunkSize)
            ->pluck(self::TARGET_PRIMARY_KEY)
            ->all();

        if (empty($ids)) {
            return [0, $lastSeenId, 0];
        }

        $deleted = DB::table(self::TARGET_TABLE)
            ->whereIn(self::TARGET_PRIMARY_KEY, $ids)
            ->where('created_at', '<', $cutoff)
            ->delete();

        $maxId = (int) end($ids);

        return [(int) $deleted, $maxId, count($ids)];
    }

    /**
     * Execute a database callback with up to 3 automatic retries and exponential backoff (AC-5).
     */
    protected function executeWithRetry(callable $operation): mixed
    {
        $maxRetries = max(0, (int) config('audit.max_retries', 3));
        $baseDelayMs = max(0, (int) config('audit.retry_base_delay_ms', 100));
        $attempt = 0;

        while (true) {
            try {
                return $operation();
            } catch (Throwable $e) {
                if ($attempt >= $maxRetries) {
                    throw $e;
                }

                $attempt++;
                $this->lastRetryCount++;

                $delayMs = $baseDelayMs * (2 ** ($attempt - 1));
                if ($delayMs > 0) {
                    usleep($delayMs * 1000);
                }

                try {
                    if (DB::transactionLevel() === 0) {
                        DB::reconnect();
                    }
                } catch (Throwable $reconnectError) {
                    Log::warning('AuditRetentionService DB reconnect attempt failed: ' . $reconnectError->getMessage());
                }
            }
        }
    }

    /**
     * Acquire atomic Redis concurrency mutex lock with 30-minute TTL (AC-4).
     */
    protected function acquireLock(): string
    {
        $lockKey = (string) config('audit.lock_key', 'audit_purge_in_progress');
        $ttlMinutes = max(1, (int) config('audit.purge_lock_ttl_minutes', 30));
        $ttlSeconds = $ttlMinutes * 60;
        $lockToken = (string) Str::uuid();

        $redis = Redis::connection();
        $acquired = $redis->set($lockKey, $lockToken, 'EX', $ttlSeconds, 'NX');
        if (!$acquired) {
            throw new PurgeAlreadyInProgressException('PURGE_ALREADY_IN_PROGRESS');
        }

        return $lockToken;
    }

    /**
     * Atomically release the Redis mutex lock if still owned by this execution.
     */
    protected function releaseLock(string $lockToken): void
    {
        $lockKey = (string) config('audit.lock_key', 'audit_purge_in_progress');
        $lua = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

        try {
            $redis = Redis::connection();
            if (method_exists($redis, 'eval')) {
                $redis->eval($lua, 1, $lockKey, $lockToken);
                return;
            }

            if ((string) $redis->get($lockKey) === $lockToken) {
                $redis->del($lockKey);
            }
        } catch (Throwable $e) {
            try {
                $redis = Redis::connection();
                if ((string) $redis->get($lockKey) === $lockToken) {
                    $redis->del($lockKey);
                }
            } catch (Throwable $fallbackError) {
                Log::warning('Failed to release audit_purge_in_progress Redis lock: ' . $fallbackError->getMessage());
            }
        }
    }

    /**
     * Persist an immutable AuditPurgeRun record (AC-7).
     */
    protected function recordPurgeRun(array $attributes): AuditPurgeRun
    {
        return AuditPurgeRun::query()->create(array_merge($attributes, [
            'created_at' => now(),
        ]));
    }

    /**
     * Best-effort write of a failed AuditPurgeRun record even after database disruptions.
     */
    protected function recordPurgeRunSafely(array $attributes): ?AuditPurgeRun
    {
        try {
            try {
                if (DB::transactionLevel() === 0) {
                    DB::reconnect();
                }
            } catch (Throwable $ignore) {
            }

            return $this->recordPurgeRun($attributes);
        } catch (Throwable $e) {
            Log::error('Failed to persist failed AuditPurgeRun meta-log: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Dispatch emergency system alert payload to notification-service on fatal purge failure (AC-6).
     */
    protected function dispatchEmergencyAlert(
        ?AuditPurgeRun $run,
        string $sanitizedError,
        string $triggerSource,
        int $retentionDays,
        Carbon $cutoff,
        int $recordsIdentified,
        int $recordsDeleted
    ): void {
        try {
            $notificationUrl = rtrim(
                (string) config('audit.notification_service_url', 'http://notification-service:8000'),
                '/'
            );
            $serviceToken = (string) config('audit.internal_service_token', 'internal-service-token');
            $timestamp = Carbon::now()->toIso8601String();

            $payload = [
                'category' => 'audit_purge_failure',
                'severity' => 'critical',
                'service' => 'ticket-service',
                'title' => 'Emergency Alert: Audit Log Purge Failed',
                'message' => $sanitizedError,
                'run_id' => $run?->id,
                'timestamp' => $timestamp,
                'context' => [
                    'run_id' => $run?->id,
                    'timestamp' => $timestamp,
                    'trigger_source' => $triggerSource,
                    'retention_days' => $retentionDays,
                    'cutoff_timestamp' => $cutoff->toIso8601String(),
                    'records_identified' => $recordsIdentified,
                    'records_deleted' => $recordsDeleted,
                    'retries_attempted' => $this->lastRetryCount,
                    'error' => $sanitizedError,
                ],
            ];

            Http::timeout(5)
                ->withToken($serviceToken !== '' ? $serviceToken : 'internal-service-token')
                ->withHeaders([
                    'X-Internal-Call' => 'system-monitoring',
                    'Accept' => 'application/json',
                ])
                ->post("{$notificationUrl}/api/internal/system-alerts", $payload);
        } catch (Throwable $e) {
            Log::error('Emergency alert dispatch to notification-service failed: ' . $e->getMessage());
        }
    }

    /**
     * Compute next scheduled run timestamp from cron expression in server timezone.
     */
    public function calculateNextRunAt(string $cronExpression, bool $isEnabled = true): ?string
    {
        if (!$isEnabled) {
            return null;
        }

        try {
            $cron = new CronExpression($cronExpression);
            return Carbon::instance($cron->getNextRunDate(Carbon::now()))->toIso8601String();
        } catch (Throwable $e) {
            return null;
        }
    }

    public function getSafetyFloorDays(): int
    {
        return max(30, (int) config('audit.safety_floor_days', AuditRetentionSetting::MIN_RETENTION_DAYS));
    }

    private function elapsedMilliseconds(int $startNs): int
    {
        return max(0, (int) round((hrtime(true) - $startNs) / 1_000_000));
    }
}
