<?php

namespace Tests;

use App\Events\TicketChanged;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;

abstract class TestCase extends BaseTestCase
{
    use CreatesApplication;

    protected function setUp(): void
    {
        parent::setUp();

        if (\Illuminate\Support\Facades\DB::connection()->getDatabaseName() === 'ticketing_system') {
            throw new \RuntimeException("Refusing to run tests against production/development database 'ticketing_system'");
        }

        $this->assertSame('log', config('broadcasting.default'), "Expected broadcast driver 'log', got " . config('broadcasting.default'));
        $this->assertSame('array', config('cache.default'), "Expected cache driver 'array', got " . config('cache.default'));

        $mockClient = new class {
            public function scan(&$iterator, $pattern = null, $count = 100) {
                return false;
            }
            public function del($key) {
                return 1;
            }
            public function get($key) {
                return null;
            }
            public function set($key, $val, ...$args) {
                return true;
            }
        };

        $mockRedisConn = new class($mockClient) {
            private $client;
            public function __construct($client) {
                $this->client = $client;
            }
            public function client() {
                return $this->client;
            }
            public function scan($iterator = 0, $options = []) {
                return [0, []];
            }
            public function del($key) {
                return 1;
            }
            public function get($key) {
                return null;
            }
            public function set($key, $val, ...$args) {
                return true;
            }
        };

        \Illuminate\Support\Facades\Redis::shouldReceive('connection')
            ->byDefault()
            ->andReturn($mockRedisConn);

        \Illuminate\Support\Facades\Redis::shouldReceive('scan')
            ->byDefault()
            ->andReturn([0, []]);

        \Illuminate\Support\Facades\Redis::shouldReceive('del')
            ->byDefault()
            ->andReturn(0);

        Event::fake([TicketChanged::class]);

        Http::preventStrayRequests();

        \Illuminate\Support\Facades\Cache::forever(
            'ticket:config:limits:last-known-good',
            \App\Services\TicketConfigurationService::DEFAULT_LIMITS
        );
        \Illuminate\Support\Facades\Cache::put(
            'ticket:config:limits',
            \App\Services\TicketConfigurationService::DEFAULT_LIMITS,
            300
        );

        Http::fake([
            '*/api/internal/tickets/*/messages' => Http::response([], 200),
            '*/api/email/dispatch-event' => Http::response(['status' => 'success'], 200),
        ]);
    }

    /**
     * Make sure an active branch with this slug exists. The shared test database can get its
     * branches table from another service, which skips this service's seeded branches.
     */
    protected function seedBranch(string $slug, string $name, ?string $code = null): void
    {
        \Illuminate\Support\Facades\DB::table('branches')->updateOrInsert(
            ['slug' => $slug],
            ['name' => $name, 'code' => $code, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]
        );
    }

    /**
     * Insert or update a machine fixture that satisfies the real schema:
     * machines.category_ID -> machine_categories and machines.client_ID -> users are both required.
     */
    protected function seedMachine(int $machineId, array $attributes = []): int
    {
        $db = \Illuminate\Support\Facades\DB::class;

        $categoryId = $attributes['category_ID']
            ?? $db::table('machine_categories')->value('category_ID')
            ?? $db::table('machine_categories')->insertGetId([
                'category_name' => 'Imaging',
                'created_at' => now(),
                'updated_at' => now(),
            ]);

        $clientId = $attributes['client_ID'] ?? $db::table('users')->value('id');
        if ($clientId === null || $db::table('users')->where('id', $clientId)->doesntExist()) {
            $userRow = [
                'name' => 'Fixture User',
                'email' => 'fixture_user_' . uniqid() . '@example.test',
                'password' => 'secret',
                'created_at' => now(),
                'updated_at' => now(),
            ];
            if ($clientId !== null) {
                $userRow['id'] = $clientId;
                $db::table('users')->insert($userRow);
            } else {
                $clientId = $db::table('users')->insertGetId($userRow);
            }
        }

        $db::table('machines')->updateOrInsert(
            ['machine_ID' => $machineId],
            array_merge([
                'machine_name' => 'Test Machine ' . $machineId,
                'serial_number' => 'SN-FIXTURE-' . $machineId,
                'created_at' => now(),
                'updated_at' => now(),
            ], $attributes, [
                'category_ID' => $categoryId,
                'client_ID' => $clientId,
            ])
        );

        return $machineId;
    }
}
