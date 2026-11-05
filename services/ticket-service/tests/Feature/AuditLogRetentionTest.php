<?php

namespace Tests\Feature;

use App\Console\Kernel;
use App\Exceptions\PurgeExecutionFailedException;
use App\Models\AuditPurgeRun;
use App\Models\AuditRetentionSetting;
use App\Models\Employee;
use App\Services\AuditRetentionService;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request as HttpClientRequest;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Schema;
use InvalidArgumentException;
use RuntimeException;
use Tests\TestCase;

/**
 * Spec 0030: Audit Log Retention Rules and Scheduled Purge Engine.
 *
 * AC traceability for the original tests (the newer tests carry their own `covers:` tag):
 *   fetches_and_updates_retention_configuration ........ AC-1, AC-2
 *   safety_floor_rejects_retention_days_below_thirty ... AC-1, AC-9
 *   unauthorized_and_non_superadmin_requests ........... AC-9
 *   pre_purge_impact_calculation ....................... AC-2, AC-9
 *   scheduled_console_command_deletes_2500 ............. AC-3, AC-7, AC-8
 *   concurrency_mutex_lock_rejects_overlapping_purge ... AC-4, AC-9
 *   transient_database_failures_recover ................ AC-5
 *   exhausted_retries_mid_purge ........................ AC-5, AC-6, AC-7, AC-9
 *   strict_table_isolation ............................. AC-7, AC-8
 *   purge_history_endpoint ............................. AC-3, AC-10
 */
class AuditLogRetentionTest extends TestCase
{
    use DatabaseTransactions;

    protected string $privateKey = '';
    protected ?string $originalPublicKey = null;
    protected object $statefulRedis;

    protected function setUp(): void
    {
        parent::setUp();

        $this->statefulRedis = new class {
            public array $store = [];
            public array $ttls = [];

            public function client(): self
            {
                return $this;
            }

            public function scan(&$iterator = 0, $options = [])
            {
                $iterator = 0;
                return [0, []];
            }

            public function set(string $key, mixed $val, ...$args): bool
            {
                $upperArgs = array_map(fn ($a) => is_string($a) ? strtoupper($a) : $a, $args);
                $isNx = in_array('NX', $upperArgs, true);

                if ($isNx && array_key_exists($key, $this->store)) {
                    return false;
                }

                $exIndex = array_search('EX', $upperArgs, true);
                if ($exIndex !== false && isset($args[$exIndex + 1])) {
                    $this->ttls[$key] = (int) $args[$exIndex + 1];
                }

                $this->store[$key] = (string) $val;
                return true;
            }

            public function get(string $key): ?string
            {
                return $this->store[$key] ?? null;
            }

            public function del(string|array $key): int
            {
                $keys = is_array($key) ? $key : [$key];
                $deleted = 0;
                foreach ($keys as $k) {
                    if (array_key_exists($k, $this->store)) {
                        unset($this->store[$k], $this->ttls[$k]);
                        $deleted++;
                    }
                }
                return $deleted;
            }

            public function eval(string $script, int $numKeys, string $key, string $token): int
            {
                if (($this->store[$key] ?? null) === $token) {
                    unset($this->store[$key], $this->ttls[$key]);
                    return 1;
                }
                return 0;
            }
        };

        Redis::shouldReceive('connection')
            ->andReturn($this->statefulRedis);

        $keyPath = storage_path('auth-module-public.key');
        if (file_exists($keyPath)) {
            $this->originalPublicKey = file_get_contents($keyPath);
        }

        $res = openssl_pkey_new([
            'digest_alg' => 'sha256',
            'private_key_bits' => 2048,
            'private_key_type' => OPENSSL_KEYTYPE_RSA,
        ]);
        openssl_pkey_export($res, $this->privateKey);
        $details = openssl_pkey_get_details($res);
        file_put_contents($keyPath, $details['key']);

        $this->ensureTestTablesExist();

        $this->statefulRedis->del((string) config('audit.lock_key', 'audit_purge_in_progress'));
        config(['audit.retry_base_delay_ms' => 5]);

        DB::table('audit_purge_runs')->delete();
        DB::table('audit_retention_settings')->delete();
        DB::table('ticket_audit_logs')->delete();

        DB::table('audit_retention_settings')->insert([
            'retention_days' => 365,
            'is_auto_purge_enabled' => true,
            'purge_schedule' => '0 2 * * *',
            'chunk_size' => 1000,
            'updated_by_id' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Employee::updateOrInsert(
            ['emp_id' => 99981],
            [
                'first_name' => 'Super',
                'last_name' => 'Admin',
                'email' => 'superadmin@example.com',
                'role' => 'superadmin',
                'department' => 'superadmin',
                'is_active' => true,
                'password_hash' => 'secret',
                'branch' => null,
                'branch_id' => null,
            ]
        );

        Employee::updateOrInsert(
            ['emp_id' => 99982],
            [
                'first_name' => 'Regular',
                'last_name' => 'Staff',
                'email' => 'staff.retention@example.com',
                'role' => 'employee',
                'department' => 'Service',
                'is_active' => true,
                'password_hash' => 'secret',
                'branch' => 'Main Office',
                'branch_id' => 1,
            ]
        );
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        $keyPath = storage_path('auth-module-public.key');
        if ($this->originalPublicKey !== null) {
            file_put_contents($keyPath, $this->originalPublicKey);
        }

        parent::tearDown();
    }

    private function ensureTestTablesExist(): void
    {
        if (!Schema::hasTable('branches')) {
            Schema::create('branches', function ($table) {
                $table->id();
                $table->string('slug')->nullable();
                $table->string('name');
                $table->string('code')->unique();
                $table->boolean('is_active')->default(true);
                $table->timestamps();
            });
        }

        DB::table('branches')->updateOrInsert(
            ['id' => 1],
            ['slug' => 'main-office', 'name' => 'Main Office', 'code' => 'MAIN', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]
        );

        if (!Schema::hasTable('employees')) {
            Schema::create('employees', function ($table) {
                $table->id('emp_id');
                $table->string('first_name')->nullable();
                $table->string('last_name')->nullable();
                $table->string('name')->nullable();
                $table->string('email')->unique();
                $table->string('role');
                $table->string('department')->nullable();
                $table->string('branch')->nullable();
                $table->unsignedBigInteger('branch_id')->nullable();
                $table->boolean('is_active')->default(true);
                $table->string('password_hash')->nullable();
                $table->timestamp('password_change_at')->nullable();
                $table->timestamp('last_synced_at')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('ticket_audit_logs')) {
            Schema::create('ticket_audit_logs', function ($table) {
                $table->id('log_ID');
                $table->unsignedBigInteger('ticket_ID')->nullable();
                $table->string('action_type');
                $table->unsignedBigInteger('action_by_ID')->default(0);
                $table->string('actor_type')->default('system');
                $table->text('details')->nullable();
                $table->dateTime('created_at');
            });
        }

        if (!Schema::hasTable('audit_retention_settings') || !Schema::hasTable('audit_purge_runs')) {
            $migration = require base_path('database/migrations/2026_11_03_000001_create_audit_retention_and_purge_runs_tables.php');
            $migration->up();
        }

        if (!Schema::hasTable('tickets')) {
            Schema::create('tickets', function ($table) {
                $table->id('ticket_ID');
                $table->string('title')->default('Sample Ticket');
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('ticket_messages')) {
            Schema::create('ticket_messages', function ($table) {
                $table->id();
                $table->unsignedBigInteger('ticket_ID')->nullable();
                $table->text('message')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('clients')) {
            Schema::create('clients', function ($table) {
                $table->id();
                $table->string('client_name')->default('Sample Client');
                $table->timestamps();
            });
        }
    }

    private function superAdminToken(): string
    {
        return $this->generateJwt([
            'sub' => 99981,
            'id' => 99981,
            'email' => 'superadmin@example.com',
            'role' => 'superadmin',
            'department' => 'superadmin',
            'branch' => null,
            'branch_id' => null,
        ]);
    }

    private function staffToken(): string
    {
        return $this->generateJwt([
            'sub' => 99982,
            'id' => 99982,
            'email' => 'staff.retention@example.com',
            'role' => 'employee',
            'department' => 'Service',
            'branch' => 'Main Office',
            'branch_id' => 1,
        ]);
    }

    private function generateJwt(array $claims): string
    {
        $payload = array_merge([
            'iss' => 'auth-service',
            'iat' => time(),
            'exp' => time() + 3600,
            'jti' => uniqid('jwt_', true),
        ], $claims);

        return JWT::encode($payload, $this->privateKey, 'RS256');
    }

    private function seedAuditLogs(int $count, Carbon $createdAt): void
    {
        $rows = [];
        $formatted = $createdAt->format('Y-m-d H:i:s');

        for ($i = 1; $i <= $count; $i++) {
            $rows[] = [
                'ticket_ID' => null,
                'action_type' => 'status_change',
                'action_by_ID' => 99981,
                'actor_type' => 'superadmin',
                'details' => json_encode(['seq' => $i]),
                'created_at' => $formatted,
            ];

            if (count($rows) === 500) {
                DB::table('ticket_audit_logs')->insert($rows);
                $rows = [];
            }
        }

        if (!empty($rows)) {
            DB::table('ticket_audit_logs')->insert($rows);
        }
    }

    public function test_superadmin_fetches_and_updates_retention_configuration(): void
    {
        $this->seedAuditLogs(4, Carbon::now()->subDays(400));
        $this->seedAuditLogs(2, Carbon::now()->subDays(10));

        $response = $this->withHeader('Authorization', 'Bearer ' . $this->superAdminToken())
            ->getJson('/api/ticketing/ticket/superadmin/audit-logs/retention');

        $response->assertStatus(200)
            ->assertJsonPath('retention_days', 365)
            ->assertJsonPath('is_auto_purge_enabled', true)
            ->assertJsonPath('purge_schedule', '0 2 * * *')
            ->assertJsonPath('pending_purge_estimate', 4);

        $this->assertNotEmpty($response->json('next_run_at'));

        $updateResponse = $this->withHeader('Authorization', 'Bearer ' . $this->superAdminToken())
            ->putJson('/api/ticketing/ticket/superadmin/audit-logs/retention', [
                'retention_days' => 90,
                'is_auto_purge_enabled' => true,
                'purge_schedule' => '30 3 * * *',
            ]);

        $updateResponse->assertStatus(200)
            ->assertJsonPath('status', 'success')
            ->assertJsonPath('settings.retention_days', 90)
            ->assertJsonPath('settings.purge_schedule', '30 3 * * *')
            ->assertJsonPath('settings.updated_by_id', 99981);

        $this->assertDatabaseHas('audit_retention_settings', [
            'retention_days' => 90,
            'is_auto_purge_enabled' => 1,
            'purge_schedule' => '30 3 * * *',
            'updated_by_id' => 99981,
        ]);
    }

    public function test_safety_floor_rejects_retention_days_below_thirty(): void
    {
        $response = $this->withHeader('Authorization', 'Bearer ' . $this->superAdminToken())
            ->putJson('/api/ticketing/ticket/superadmin/audit-logs/retention', [
                'retention_days' => 15,
            ]);

        $response->assertStatus(422)
            ->assertJsonPath('status', 'error')
            ->assertJsonPath('code', 'INVALID_RETENTION_POLICY')
            ->assertJsonValidationErrors(['retention_days']);

        $this->assertDatabaseHas('audit_retention_settings', [
            'retention_days' => 365,
        ]);

        $this->expectException(InvalidArgumentException::class);
        $setting = AuditRetentionSetting::current();
        $setting->retention_days = 29;
        $setting->save();
    }

    public function test_unauthorized_and_non_superadmin_requests_are_rejected(): void
    {
        $this->getJson('/api/ticketing/ticket/superadmin/audit-logs/retention')
            ->assertStatus(401);

        $this->withHeader('Authorization', 'Bearer ' . $this->staffToken())
            ->getJson('/api/ticketing/ticket/superadmin/audit-logs/retention')
            ->assertStatus(403)
            ->assertJsonPath('code', 'FORBIDDEN');

        $this->withHeader('Authorization', 'Bearer ' . $this->staffToken())
            ->postJson('/api/ticketing/ticket/superadmin/audit-logs/retention/purge')
            ->assertStatus(403);
    }

    public function test_pre_purge_impact_calculation_is_accurate_and_read_only(): void
    {
        $this->seedAuditLogs(7, Carbon::now()->subDays(90));
        $this->seedAuditLogs(5, Carbon::now()->subDays(45));
        $this->seedAuditLogs(3, Carbon::now()->subDays(10));

        $beforeTotal = DB::table('ticket_audit_logs')->count();

        $response = $this->withHeader('Authorization', 'Bearer ' . $this->superAdminToken())
            ->getJson('/api/ticketing/ticket/superadmin/audit-logs/retention/impact?preview_days=60');

        $response->assertStatus(200)
            ->assertJsonPath('retention_days', 60)
            ->assertJsonPath('affected_records_count', 7)
            ->assertJsonStructure(['retention_days', 'cutoff_timestamp', 'affected_records_count']);

        $this->assertSame($beforeTotal, DB::table('ticket_audit_logs')->count());
        $this->assertDatabaseHas('audit_retention_settings', ['retention_days' => 365]);

        $this->withHeader('Authorization', 'Bearer ' . $this->superAdminToken())
            ->getJson('/api/ticketing/ticket/superadmin/audit-logs/retention/impact?preview_days=15')
            ->assertStatus(422)
            ->assertJsonPath('code', 'INVALID_RETENTION_DAYS');
    }

    public function test_scheduled_console_command_deletes_2500_expired_logs_in_three_keyset_chunks(): void
    {
        $this->seedAuditLogs(2500, Carbon::now()->subDays(400));
        $this->seedAuditLogs(25, Carbon::now()->subDays(5));

        DB::flushQueryLog();
        DB::enableQueryLog();

        $exitCode = Artisan::call('tickets:purge-expired-audit-logs');

        $queries = DB::getQueryLog();
        DB::disableQueryLog();

        $this->assertSame(0, $exitCode);
        $this->assertSame(25, DB::table('ticket_audit_logs')->count());

        $deleteQueries = array_values(array_filter($queries, function (array $entry): bool {
            $sql = strtolower($entry['query'] ?? '');
            return str_starts_with($sql, 'delete from') && str_contains($sql, 'ticket_audit_logs');
        }));

        $this->assertCount(3, $deleteQueries, 'Expected 2,500 records to be deleted in 3 keyset chunks (1000, 1000, 500).');

        $run = AuditPurgeRun::query()->latest('id')->first();
        $this->assertNotNull($run);
        $this->assertSame('scheduled', $run->trigger_source);
        $this->assertSame('success', $run->status);
        $this->assertSame(2500, $run->records_identified);
        $this->assertSame(2500, $run->records_deleted);
        $this->assertNull($run->executed_by_id);
        $this->assertNull(Redis::connection()->get('audit_purge_in_progress'));
    }

    public function test_concurrency_mutex_lock_rejects_overlapping_purge_with_409_conflict(): void
    {
        $this->seedAuditLogs(10, Carbon::now()->subDays(400));

        Redis::connection()->set('audit_purge_in_progress', 'active-worker-lock', 'EX', 1800, 'NX');

        $response = $this->withHeader('Authorization', 'Bearer ' . $this->superAdminToken())
            ->postJson('/api/ticketing/ticket/superadmin/audit-logs/retention/purge');

        $response->assertStatus(409)
            ->assertJsonPath('code', 'PURGE_ALREADY_IN_PROGRESS')
            ->assertJsonPath('message', 'PURGE_ALREADY_IN_PROGRESS');

        $exitCode = Artisan::call('tickets:purge-expired-audit-logs');
        $this->assertSame(1, $exitCode);

        $this->assertSame(10, DB::table('ticket_audit_logs')->count());
        $this->assertSame('active-worker-lock', Redis::connection()->get('audit_purge_in_progress'));
    }

    public function test_transient_database_failures_recover_within_three_retries(): void
    {
        $this->seedAuditLogs(120, Carbon::now()->subDays(400));
        AuditRetentionSetting::current()->update(['chunk_size' => 100]);

        $flakyService = new class extends AuditRetentionService {
            public int $injectedFailures = 0;

            protected function deleteKeysetBatch(Carbon $cutoff, int $lastSeenId, int $chunkSize): array
            {
                if ($this->injectedFailures < 2) {
                    $this->injectedFailures++;
                    throw new RuntimeException('Deadlock found when trying to get lock; try restarting transaction');
                }

                return parent::deleteKeysetBatch($cutoff, $lastSeenId, $chunkSize);
            }
        };

        $run = $flakyService->executePurge('scheduled', null);

        $this->assertSame(2, $flakyService->getLastRetryCount());
        $this->assertSame('success', $run->status);
        $this->assertSame(120, $run->records_deleted);
        $this->assertSame(0, DB::table('ticket_audit_logs')->count());
    }

    public function test_exhausted_retries_mid_purge_record_failed_run_and_dispatch_emergency_alert(): void
    {
        Http::fake([
            '*/api/internal/system-alerts' => Http::response(['success' => true, 'status' => 'alerted'], 201),
        ]);

        $this->seedAuditLogs(1500, Carbon::now()->subDays(400));

        $failingMidPurgeService = new class extends AuditRetentionService {
            public int $chunkTwoAttempts = 0;

            protected function deleteKeysetBatch(Carbon $cutoff, int $lastSeenId, int $chunkSize): array
            {
                if ($lastSeenId > 0) {
                    $this->chunkTwoAttempts++;
                    throw new RuntimeException('Lost connection to mysql://root:SuperSecretPass123@db:3306/ticketing');
                }

                return parent::deleteKeysetBatch($cutoff, $lastSeenId, $chunkSize);
            }
        };

        $this->app->instance(AuditRetentionService::class, $failingMidPurgeService);

        $response = $this->withHeader('Authorization', 'Bearer ' . $this->superAdminToken())
            ->postJson('/api/ticketing/ticket/superadmin/audit-logs/retention/purge');

        $response->assertStatus(500)
            ->assertJsonPath('code', 'PURGE_EXECUTION_FAILED');

        // 1 initial attempt + 3 retries = 4 total attempts on the failing second batch
        $this->assertSame(4, $failingMidPurgeService->chunkTwoAttempts);
        $this->assertSame(3, $failingMidPurgeService->getLastRetryCount());

        // Lock must be released even after fatal failure
        $this->assertNull(Redis::connection()->get('audit_purge_in_progress'));

        $run = AuditPurgeRun::query()->latest('id')->first();
        $this->assertNotNull($run);
        $this->assertSame('manual', $run->trigger_source);
        $this->assertSame('failed', $run->status);
        $this->assertSame(1500, $run->records_identified);
        $this->assertSame(1000, $run->records_deleted);
        $this->assertSame(99981, $run->executed_by_id);
        $this->assertStringNotContainsString('SuperSecretPass123', (string) $run->error_message);
        $this->assertStringContainsString('[REDACTED]', (string) $run->error_message);

        Http::assertSent(function (HttpClientRequest $request) use ($run): bool {
            $data = $request->data();
            return str_ends_with($request->url(), '/api/internal/system-alerts')
                && $request->hasHeader('Authorization')
                && ($data['category'] ?? null) === 'audit_purge_failure'
                && ($data['severity'] ?? null) === 'critical'
                && ($data['run_id'] ?? null) === $run->id
                && !empty($data['timestamp'])
                && !str_contains((string) ($data['message'] ?? ''), 'SuperSecretPass123');
        });
    }

    public function test_strict_table_isolation_preserves_operational_tables_and_meta_logs_are_immutable(): void
    {
        $ancientDate = Carbon::now()->subYears(5)->format('Y-m-d H:i:s');

        $ticketsBefore = DB::table('tickets')->count();
        $messagesBefore = DB::table('ticket_messages')->count();
        $clientsBefore = DB::table('clients')->count();
        $employeesBefore = DB::table('employees')->count();

        DB::table('ticket_messages')->insert([
            'ticket_ID' => null,
            'message' => 'Historical message that must never be purged',
            'created_at' => $ancientDate,
            'updated_at' => $ancientDate,
        ]);

        $this->seedAuditLogs(15, Carbon::now()->subYears(5));

        $response = $this->withHeader('Authorization', 'Bearer ' . $this->superAdminToken())
            ->postJson('/api/ticketing/ticket/superadmin/audit-logs/retention/purge');

        $response->assertStatus(200)
            ->assertJsonPath('status', 'success')
            ->assertJsonPath('records_deleted', 15);

        $this->assertSame($ticketsBefore, DB::table('tickets')->count());
        $this->assertSame($messagesBefore + 1, DB::table('ticket_messages')->count());
        $this->assertSame($clientsBefore, DB::table('clients')->count());
        $this->assertSame($employeesBefore, DB::table('employees')->count());

        $run = AuditPurgeRun::query()->findOrFail($response->json('run_id'));

        try {
            $run->update(['status' => 'failed']);
            $this->fail('Expected RuntimeException when mutating an immutable AuditPurgeRun.');
        } catch (RuntimeException $expected) {
            $this->assertStringContainsString('immutable', $expected->getMessage());
        }

        $this->expectException(RuntimeException::class);
        $run->delete();
    }

    public function test_purge_history_endpoint_returns_paginated_runs_and_schedule_is_registered(): void
    {
        for ($i = 1; $i <= 3; $i++) {
            AuditPurgeRun::query()->create([
                'trigger_source' => $i % 2 === 0 ? 'manual' : 'scheduled',
                'retention_days' => 365,
                'cutoff_timestamp' => Carbon::now()->subDays(365),
                'records_identified' => $i * 10,
                'records_deleted' => $i * 10,
                'duration_ms' => 45,
                'status' => 'success',
                'error_message' => null,
                'executed_by_id' => $i % 2 === 0 ? 99981 : null,
                'created_at' => Carbon::now()->subMinutes(10 - $i),
            ]);
        }

        $response = $this->withHeader('Authorization', 'Bearer ' . $this->superAdminToken())
            ->getJson('/api/ticketing/ticket/superadmin/audit-logs/retention/history?page=1&per_page=2');

        $response->assertStatus(200)
            ->assertJsonCount(2, 'runs')
            ->assertJsonPath('pagination.current_page', 1)
            ->assertJsonPath('pagination.per_page', 2)
            ->assertJsonPath('pagination.total', 3)
            ->assertJsonPath('pagination.last_page', 2);

        /** @var Kernel $kernel */
        $kernel = $this->app->make(Kernel::class);
        $schedule = $this->app->make(\Illuminate\Console\Scheduling\Schedule::class);
        $events = collect($schedule->events())->filter(function ($event): bool {
            return str_contains((string) $event->command, 'tickets:purge-expired-audit-logs');
        });

        $this->assertNotEmpty($events, 'Expected tickets:purge-expired-audit-logs to be registered in Console Kernel schedule.');
    }

    // ------------------------------------------------------------------
    // Extended coverage for spec 0030 (added by /test)
    // ------------------------------------------------------------------

    /** covers: AC-1 */
    public function test_current_settings_seed_safe_defaults_when_table_is_empty(): void
    {
        DB::table('audit_retention_settings')->delete();

        $first = AuditRetentionSetting::current();
        $second = AuditRetentionSetting::current();

        $this->assertSame(365, $first->retention_days);
        $this->assertTrue($first->is_auto_purge_enabled);
        $this->assertSame('0 2 * * *', $first->purge_schedule);
        $this->assertSame(1000, $first->chunk_size);
        $this->assertSame($first->id, $second->id);
        $this->assertSame(1, DB::table('audit_retention_settings')->count());
    }

    /** covers: AC-1, AC-9 */
    public function test_retention_floor_accepts_exactly_thirty_days_and_rejects_twenty_nine(): void
    {
        $token = $this->superAdminToken();

        $this->withHeader('Authorization', 'Bearer ' . $token)
            ->putJson('/api/ticketing/ticket/superadmin/audit-logs/retention', ['retention_days' => 30])
            ->assertStatus(200)
            ->assertJsonPath('settings.retention_days', 30);

        $this->withHeader('Authorization', 'Bearer ' . $token)
            ->putJson('/api/ticketing/ticket/superadmin/audit-logs/retention', ['retention_days' => 29])
            ->assertStatus(422)
            ->assertJsonPath('code', 'INVALID_RETENTION_POLICY');

        $this->assertDatabaseHas('audit_retention_settings', ['retention_days' => 30]);
    }

    /** covers: AC-1, AC-9 */
    public function test_update_requires_retention_days_and_rejects_invalid_cron_schedule(): void
    {
        $token = $this->superAdminToken();

        $this->withHeader('Authorization', 'Bearer ' . $token)
            ->putJson('/api/ticketing/ticket/superadmin/audit-logs/retention', ['is_auto_purge_enabled' => false])
            ->assertStatus(422)
            ->assertJsonPath('code', 'INVALID_RETENTION_POLICY')
            ->assertJsonValidationErrors(['retention_days']);

        $this->withHeader('Authorization', 'Bearer ' . $token)
            ->putJson('/api/ticketing/ticket/superadmin/audit-logs/retention', [
                'retention_days' => 90,
                'purge_schedule' => 'every night please',
            ])
            ->assertStatus(422)
            ->assertJsonPath('code', 'INVALID_RETENTION_POLICY')
            ->assertJsonValidationErrors(['purge_schedule']);

        $this->assertDatabaseHas('audit_retention_settings', [
            'retention_days' => 365,
            'is_auto_purge_enabled' => 1,
            'purge_schedule' => '0 2 * * *',
        ]);
    }

    /** covers: AC-1 */
    public function test_next_run_follows_the_saved_schedule_and_is_null_when_auto_purge_is_disabled(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-11-04 12:00:00'));
        $token = $this->superAdminToken();

        $this->withHeader('Authorization', 'Bearer ' . $token)
            ->putJson('/api/ticketing/ticket/superadmin/audit-logs/retention', [
                'retention_days' => 90,
                'purge_schedule' => '30 3 * * *',
            ])
            ->assertStatus(200);

        $this->withHeader('Authorization', 'Bearer ' . $token)
            ->getJson('/api/ticketing/ticket/superadmin/audit-logs/retention')
            ->assertStatus(200)
            ->assertJsonPath('next_run_at', Carbon::parse('2026-11-05 03:30:00')->toIso8601String());

        $this->withHeader('Authorization', 'Bearer ' . $token)
            ->putJson('/api/ticketing/ticket/superadmin/audit-logs/retention', [
                'retention_days' => 90,
                'is_auto_purge_enabled' => false,
            ])
            ->assertStatus(200)
            ->assertJsonPath('settings.is_auto_purge_enabled', false);

        $this->withHeader('Authorization', 'Bearer ' . $token)
            ->getJson('/api/ticketing/ticket/superadmin/audit-logs/retention')
            ->assertStatus(200)
            ->assertJsonPath('is_auto_purge_enabled', false)
            ->assertJsonPath('next_run_at', null);
    }

    /** covers: AC-2 */
    public function test_impact_uses_active_retention_period_when_preview_days_is_omitted(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-11-04 12:00:00'));
        AuditRetentionSetting::current()->update(['retention_days' => 60]);

        $this->seedAuditLogs(3, Carbon::now()->subDays(90));
        $this->seedAuditLogs(2, Carbon::now()->subDays(30));

        $this->withHeader('Authorization', 'Bearer ' . $this->superAdminToken())
            ->getJson('/api/ticketing/ticket/superadmin/audit-logs/retention/impact')
            ->assertStatus(200)
            ->assertJsonPath('retention_days', 60)
            ->assertJsonPath('cutoff_timestamp', Carbon::now()->subDays(60)->toIso8601String())
            ->assertJsonPath('affected_records_count', 3);

        $this->assertSame(5, DB::table('ticket_audit_logs')->count());
    }

    /** covers: AC-7 */
    public function test_manual_purge_returns_run_metrics_and_records_operator_identity(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-11-04 12:00:00'));
        $this->seedAuditLogs(5, Carbon::now()->subDays(400));
        $this->seedAuditLogs(2, Carbon::now()->subDays(10));

        $response = $this->withHeader('Authorization', 'Bearer ' . $this->superAdminToken())
            ->postJson('/api/ticketing/ticket/superadmin/audit-logs/retention/purge');

        $response->assertStatus(200)
            ->assertJsonStructure(['status', 'message', 'run_id', 'records_deleted', 'cutoff_timestamp', 'duration_ms'])
            ->assertJsonPath('status', 'success')
            ->assertJsonPath('records_deleted', 5)
            ->assertJsonPath('cutoff_timestamp', Carbon::now()->subDays(365)->toIso8601String());

        $this->assertIsInt($response->json('duration_ms'));
        $this->assertSame(2, DB::table('ticket_audit_logs')->count());

        $run = AuditPurgeRun::query()->findOrFail($response->json('run_id'));
        $this->assertSame('manual', $run->trigger_source);
        $this->assertSame(99981, $run->executed_by_id);
        $this->assertSame(365, $run->retention_days);
        $this->assertSame(5, $run->records_identified);
        $this->assertSame(5, $run->records_deleted);
        $this->assertNull($run->error_message);
        $this->assertNull(Redis::connection()->get('audit_purge_in_progress'));
    }

    /** covers: AC-3, AC-7 */
    public function test_purge_with_nothing_expired_succeeds_and_still_records_a_run(): void
    {
        $this->seedAuditLogs(4, Carbon::now()->subDays(10));

        $this->withHeader('Authorization', 'Bearer ' . $this->superAdminToken())
            ->postJson('/api/ticketing/ticket/superadmin/audit-logs/retention/purge')
            ->assertStatus(200)
            ->assertJsonPath('status', 'success')
            ->assertJsonPath('records_deleted', 0);

        $this->assertSame(4, DB::table('ticket_audit_logs')->count());

        $run = AuditPurgeRun::query()->latest('id')->firstOrFail();
        $this->assertSame(0, $run->records_identified);
        $this->assertSame(0, $run->records_deleted);
        $this->assertSame('success', $run->status);
    }

    /** covers: AC-3, AC-8 */
    public function test_keyset_purge_deletes_only_expired_rows_when_ids_interleave_with_recent_rows(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-11-04 12:00:00'));
        AuditRetentionSetting::current()->update(['chunk_size' => 2]);

        // Alternate expired and recent rows so expired ids are not contiguous.
        for ($i = 0; $i < 5; $i++) {
            $this->seedAuditLogs(1, Carbon::now()->subDays(400));
            $this->seedAuditLogs(1, Carbon::now()->subDays(5));
        }
        // Boundary rows: one just inside the window (kept), one just outside (deleted).
        $this->seedAuditLogs(1, Carbon::now()->subDays(364));
        $this->seedAuditLogs(1, Carbon::now()->subDays(366));

        $run = (new AuditRetentionService())->executePurge('scheduled', null);

        $this->assertSame(6, $run->records_identified);
        $this->assertSame(6, $run->records_deleted);
        $this->assertSame('success', $run->status);

        $cutoff = Carbon::now()->subDays(365);
        $this->assertSame(6, DB::table('ticket_audit_logs')->count());
        $this->assertSame(0, DB::table('ticket_audit_logs')->where('created_at', '<', $cutoff)->count());
    }

    /** covers: AC-3 */
    public function test_console_command_skips_when_auto_purge_is_disabled_unless_forced(): void
    {
        AuditRetentionSetting::current()->update(['is_auto_purge_enabled' => false]);
        $this->seedAuditLogs(6, Carbon::now()->subDays(400));

        $this->assertSame(0, Artisan::call('tickets:purge-expired-audit-logs'));
        $this->assertSame(6, DB::table('ticket_audit_logs')->count());
        $this->assertSame(0, AuditPurgeRun::query()->count());

        $this->assertSame(0, Artisan::call('tickets:purge-expired-audit-logs', ['--force' => true]));
        $this->assertSame(0, DB::table('ticket_audit_logs')->count());

        $run = AuditPurgeRun::query()->latest('id')->firstOrFail();
        $this->assertSame('scheduled', $run->trigger_source);
        $this->assertNull($run->executed_by_id);
    }

    /** covers: AC-4 */
    public function test_purge_holds_the_redis_lock_with_a_thirty_minute_ttl_and_releases_it(): void
    {
        $this->seedAuditLogs(3, Carbon::now()->subDays(400));

        $probe = new class extends AuditRetentionService {
            public ?string $lockSeen = null;
            public ?int $ttlSeen = null;

            protected function deleteKeysetBatch(Carbon $cutoff, int $lastSeenId, int $chunkSize): array
            {
                if ($this->lockSeen === null) {
                    $redis = Redis::connection();
                    $this->lockSeen = $redis->get('audit_purge_in_progress');
                    $this->ttlSeen = $redis->ttls['audit_purge_in_progress'] ?? null;
                }

                return parent::deleteKeysetBatch($cutoff, $lastSeenId, $chunkSize);
            }
        };

        $probe->executePurge('manual', 99981);

        $this->assertNotNull($probe->lockSeen, 'Lock must be held while batches are deleted.');
        $this->assertSame(1800, $probe->ttlSeen);
        $this->assertNull(Redis::connection()->get('audit_purge_in_progress'));
    }

    /** covers: AC-5, AC-6 */
    public function test_retry_delays_grow_exponentially_and_alert_reports_retry_count(): void
    {
        Http::fake(['*/api/internal/system-alerts' => Http::response(['success' => true], 201)]);
        config(['audit.retry_base_delay_ms' => 20]);
        $this->seedAuditLogs(3, Carbon::now()->subDays(400));

        $alwaysFailing = new class extends AuditRetentionService {
            protected function deleteKeysetBatch(Carbon $cutoff, int $lastSeenId, int $chunkSize): array
            {
                throw new RuntimeException('SQLSTATE[HY000]: General error: 2006 MySQL server has gone away');
            }
        };

        $startNs = hrtime(true);
        try {
            $alwaysFailing->executePurge('scheduled', null);
            $this->fail('Expected PurgeExecutionFailedException after exhausted retries.');
        } catch (PurgeExecutionFailedException $e) {
            $elapsedMs = (hrtime(true) - $startNs) / 1_000_000;

            // Backoff of 20ms, 40ms, 80ms means at least 140ms of waiting in total.
            $this->assertGreaterThanOrEqual(140, $elapsedMs);
            $this->assertSame(3, $alwaysFailing->getLastRetryCount());
            $this->assertSame('failed', $e->getPurgeRun()?->status);
            $this->assertSame('scheduled', $e->getPurgeRun()?->trigger_source);
        }

        $this->assertSame(3, DB::table('ticket_audit_logs')->count());

        Http::assertSent(function (HttpClientRequest $request): bool {
            $data = $request->data();
            return ($data['context']['retries_attempted'] ?? null) === 3
                && ($data['context']['trigger_source'] ?? null) === 'scheduled'
                && ($data['context']['records_identified'] ?? null) === 3
                && ($data['context']['records_deleted'] ?? null) === 0;
        });
    }

    /** covers: AC-5, AC-7 */
    public function test_run_is_recorded_as_partial_when_retries_recover_but_fewer_rows_are_deleted_than_identified(): void
    {
        $this->seedAuditLogs(5, Carbon::now()->subDays(400));

        // Simulates another process removing one expired row during a transient failure.
        $racingService = new class extends AuditRetentionService {
            public bool $failedOnce = false;

            protected function deleteKeysetBatch(Carbon $cutoff, int $lastSeenId, int $chunkSize): array
            {
                if (!$this->failedOnce) {
                    $this->failedOnce = true;
                    $firstId = DB::table('ticket_audit_logs')->orderBy('log_ID')->value('log_ID');
                    DB::table('ticket_audit_logs')->where('log_ID', $firstId)->delete();
                    throw new RuntimeException('Lock wait timeout exceeded; try restarting transaction');
                }

                return parent::deleteKeysetBatch($cutoff, $lastSeenId, $chunkSize);
            }
        };

        $run = $racingService->executePurge('scheduled', null);

        $this->assertSame('partial', $run->status);
        $this->assertSame(5, $run->records_identified);
        $this->assertSame(4, $run->records_deleted);
        $this->assertSame(0, DB::table('ticket_audit_logs')->count());
    }

    /** covers: AC-6, AC-9 */
    public function test_unreachable_notification_service_does_not_hide_the_failure_or_leak_secrets(): void
    {
        Http::fake(function () {
            throw new ConnectionException('notification-service unreachable');
        });
        $this->seedAuditLogs(2, Carbon::now()->subDays(400));

        $failing = new class extends AuditRetentionService {
            protected function deleteKeysetBatch(Carbon $cutoff, int $lastSeenId, int $chunkSize): array
            {
                throw new RuntimeException('Access denied for mysql://root:SuperSecretPass123@db:3306/ticketing');
            }
        };
        $this->app->instance(AuditRetentionService::class, $failing);

        $response = $this->withHeader('Authorization', 'Bearer ' . $this->superAdminToken())
            ->postJson('/api/ticketing/ticket/superadmin/audit-logs/retention/purge');

        $response->assertStatus(500)
            ->assertJsonPath('status', 'error')
            ->assertJsonPath('code', 'PURGE_EXECUTION_FAILED');

        $this->assertStringNotContainsString('SuperSecretPass123', $response->getContent());
        $this->assertNotNull($response->json('run_id'));
        $this->assertSame('failed', AuditPurgeRun::query()->findOrFail($response->json('run_id'))->status);
        $this->assertNull(Redis::connection()->get('audit_purge_in_progress'));
    }

    /** covers: AC-8 */
    public function test_engine_rejects_unknown_trigger_sources_without_touching_data_or_the_lock(): void
    {
        $this->seedAuditLogs(3, Carbon::now()->subDays(400));

        try {
            (new AuditRetentionService())->executePurge('tickets', null);
            $this->fail('Expected InvalidArgumentException for an unknown trigger source.');
        } catch (InvalidArgumentException $expected) {
            $this->assertStringContainsString('trigger source', $expected->getMessage());
        }

        $this->assertSame(3, DB::table('ticket_audit_logs')->count());
        $this->assertSame(0, AuditPurgeRun::query()->count());
        $this->assertNull(Redis::connection()->get('audit_purge_in_progress'));
    }

    /** covers: AC-9 */
    public function test_manual_purge_rejects_override_below_safety_floor_without_deleting(): void
    {
        $this->seedAuditLogs(3, Carbon::now()->subDays(400));

        $this->withHeader('Authorization', 'Bearer ' . $this->superAdminToken())
            ->postJson('/api/ticketing/ticket/superadmin/audit-logs/retention/purge', ['retention_days' => 10])
            ->assertStatus(422)
            ->assertJsonPath('code', 'INVALID_RETENTION_DAYS');

        $this->assertSame(3, DB::table('ticket_audit_logs')->count());
        $this->assertSame(0, AuditPurgeRun::query()->count());
    }

    /** covers: AC-9 */
    public function test_every_retention_endpoint_rejects_missing_and_non_superadmin_tokens(): void
    {
        $base = '/api/ticketing/ticket/superadmin/audit-logs/retention';
        $staff = $this->staffToken();

        $this->postJson($base . '/purge')->assertStatus(401);
        $this->getJson($base . '/history')->assertStatus(401);
        $this->getJson($base . '/impact')->assertStatus(401);

        $this->withHeader('Authorization', 'Bearer ' . $staff)
            ->putJson($base, ['retention_days' => 90])
            ->assertStatus(403)
            ->assertJsonPath('code', 'FORBIDDEN');

        $this->withHeader('Authorization', 'Bearer ' . $staff)
            ->getJson($base . '/impact')
            ->assertStatus(403);

        $this->withHeader('Authorization', 'Bearer ' . $staff)
            ->getJson($base . '/history')
            ->assertStatus(403);

        $this->assertDatabaseHas('audit_retention_settings', ['retention_days' => 365]);
    }

    /** covers: AC-9 */
    public function test_expired_or_forged_superadmin_tokens_are_rejected(): void
    {
        $base = '/api/ticketing/ticket/superadmin/audit-logs/retention';

        $expired = $this->generateJwt([
            'sub' => 99981,
            'id' => 99981,
            'email' => 'superadmin@example.com',
            'role' => 'superadmin',
            'department' => 'superadmin',
            'iat' => time() - 7200,
            'exp' => time() - 3600,
        ]);

        $this->withHeader('Authorization', 'Bearer ' . $expired)
            ->getJson($base)
            ->assertStatus(401);

        $otherKey = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        openssl_pkey_export($otherKey, $forgingKey);
        $forged = JWT::encode([
            'iss' => 'auth-service',
            'iat' => time(),
            'exp' => time() + 3600,
            'jti' => uniqid('jwt_', true),
            'sub' => 99981,
            'id' => 99981,
            'email' => 'superadmin@example.com',
            'role' => 'superadmin',
        ], $forgingKey, 'RS256');

        $this->withHeader('Authorization', 'Bearer ' . $forged)
            ->postJson($base . '/purge')
            ->assertStatus(401);
    }

    /** covers: AC-9, AC-10 */
    public function test_history_rejects_out_of_range_pagination(): void
    {
        $base = '/api/ticketing/ticket/superadmin/audit-logs/retention/history';
        $token = $this->superAdminToken();

        $this->withHeader('Authorization', 'Bearer ' . $token)
            ->getJson($base . '?per_page=101')
            ->assertStatus(422)
            ->assertJsonPath('code', 'INVALID_PAGINATION_PARAMETERS');

        $this->withHeader('Authorization', 'Bearer ' . $token)
            ->getJson($base . '?page=0')
            ->assertStatus(422)
            ->assertJsonPath('code', 'INVALID_PAGINATION_PARAMETERS');
    }

    /** covers: AC-10 */
    public function test_history_lists_newest_runs_first_across_pages(): void
    {
        foreach ([1 => 30, 2 => 20, 3 => 10] as $identified => $minutesAgo) {
            AuditPurgeRun::query()->create([
                'trigger_source' => 'scheduled',
                'retention_days' => 365,
                'cutoff_timestamp' => Carbon::now()->subDays(365),
                'records_identified' => $identified,
                'records_deleted' => $identified,
                'duration_ms' => 10,
                'status' => 'success',
                'executed_by_id' => null,
                'created_at' => Carbon::now()->subMinutes($minutesAgo),
            ]);
        }

        $token = $this->superAdminToken();
        $base = '/api/ticketing/ticket/superadmin/audit-logs/retention/history';

        $this->withHeader('Authorization', 'Bearer ' . $token)
            ->getJson($base . '?page=1&per_page=2')
            ->assertStatus(200)
            ->assertJsonPath('runs.0.records_identified', 3)
            ->assertJsonPath('runs.1.records_identified', 2);

        $this->withHeader('Authorization', 'Bearer ' . $token)
            ->getJson($base . '?page=2&per_page=2')
            ->assertStatus(200)
            ->assertJsonCount(1, 'runs')
            ->assertJsonPath('runs.0.records_identified', 1)
            ->assertJsonPath('pagination.current_page', 2);
    }

    /** covers: AC-7 */
    public function test_no_route_can_update_or_delete_purge_run_history(): void
    {
        $run = AuditPurgeRun::query()->create([
            'trigger_source' => 'manual',
            'retention_days' => 365,
            'cutoff_timestamp' => Carbon::now()->subDays(365),
            'records_identified' => 1,
            'records_deleted' => 1,
            'duration_ms' => 5,
            'status' => 'success',
            'executed_by_id' => 99981,
        ]);

        $token = $this->superAdminToken();
        $base = '/api/ticketing/ticket/superadmin/audit-logs/retention/history';

        $deleteStatus = $this->withHeader('Authorization', 'Bearer ' . $token)
            ->deleteJson($base)->getStatusCode();
        $putStatus = $this->withHeader('Authorization', 'Bearer ' . $token)
            ->putJson($base . '/' . $run->id, ['status' => 'failed'])->getStatusCode();

        $this->assertContains($deleteStatus, [404, 405]);
        $this->assertContains($putStatus, [404, 405]);
        $this->assertDatabaseHas('audit_purge_runs', ['id' => $run->id, 'status' => 'success']);
    }
}
