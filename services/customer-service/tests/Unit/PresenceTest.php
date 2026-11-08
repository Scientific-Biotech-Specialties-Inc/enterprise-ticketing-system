<?php

namespace Tests\Unit;

use App\Support\Presence;
use Carbon\Carbon;
use Illuminate\Config\Repository;
use Illuminate\Container\Container;
use Illuminate\Support\Facades\Facade;
use PHPUnit\Framework\TestCase;

/**
 * Presence is derived from heartbeat freshness (spec 0035, AC-2 and AC-3).
 * Runs without a database: only the config repository and a frozen clock are needed.
 */
class PresenceTest extends TestCase
{
    private const NOW = '2026-11-06 12:00:00';

    protected function setUp(): void
    {
        parent::setUp();

        $container = new Container();
        $container->instance('config', new Repository(['presence' => ['online_window_seconds' => 90]]));
        Container::setInstance($container);
        Facade::setFacadeApplication($container);
        Facade::clearResolvedInstances();

        Carbon::setTestNow(Carbon::parse(self::NOW));
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        Facade::setFacadeApplication(null);
        Container::setInstance(null);
        parent::tearDown();
    }

    public function test_heartbeat_30_seconds_ago_is_online(): void
    {
        $this->assertSame(Presence::ONLINE, Presence::state(true, Carbon::parse(self::NOW)->subSeconds(30)));
    }

    public function test_heartbeat_exactly_at_the_window_edge_is_still_online(): void
    {
        $this->assertSame(Presence::ONLINE, Presence::state(true, Carbon::parse(self::NOW)->subSeconds(90)));
    }

    public function test_heartbeat_120_seconds_ago_is_offline(): void
    {
        $this->assertSame(Presence::OFFLINE, Presence::state(true, Carbon::parse(self::NOW)->subSeconds(120)));
    }

    public function test_cleared_last_seen_after_logout_is_offline(): void
    {
        $this->assertSame(Presence::OFFLINE, Presence::state(true, null));
    }

    public function test_inactive_account_is_inactive_even_with_a_fresh_heartbeat(): void
    {
        $this->assertSame(Presence::INACTIVE, Presence::state(false, Carbon::parse(self::NOW)->subSeconds(5)));
    }

    public function test_string_timestamps_are_accepted(): void
    {
        $this->assertTrue(Presence::isOnline('2026-11-06 11:59:00'));
        $this->assertFalse(Presence::isOnline('2026-11-06 11:50:00'));
    }

    public function test_window_follows_configuration(): void
    {
        Container::getInstance()->make('config')->set('presence.online_window_seconds', 10);

        $this->assertFalse(Presence::isOnline(Carbon::parse(self::NOW)->subSeconds(30)));
    }
}
