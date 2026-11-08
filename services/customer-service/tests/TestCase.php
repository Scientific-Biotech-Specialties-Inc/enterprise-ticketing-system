<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    use CreatesApplication;

    protected function setUp(): void
    {
        parent::setUp();

        if (\Illuminate\Support\Facades\DB::connection()->getDatabaseName() === 'ticketing_system') {
            throw new \RuntimeException("Refusing to run tests against production/development database 'ticketing_system'");
        }

        $mockRedis = new class {
            private $data = [];
            public function get($key) { return $this->data[$key] ?? null; }
            public function set($key, $val) { $this->data[$key] = $val; return true; }
            public function setex($key, $ttl, $val) { $this->data[$key] = $val; return true; }
            public function del($key) { unset($this->data[$key]); return 1; }
            public function exists($key) { return isset($this->data[$key]); }
        };

        \Illuminate\Support\Facades\Redis::shouldReceive('connection')->byDefault()->andReturn($mockRedis);
        \Illuminate\Support\Facades\Redis::shouldReceive('get')->byDefault()->andReturnUsing(function($k) use ($mockRedis) { return $mockRedis->get($k); });
        \Illuminate\Support\Facades\Redis::shouldReceive('set')->byDefault()->andReturnUsing(function($k, $v) use ($mockRedis) { return $mockRedis->set($k, $v); });
        \Illuminate\Support\Facades\Redis::shouldReceive('setex')->byDefault()->andReturnUsing(function($k, $ttl, $v) use ($mockRedis) { return $mockRedis->setex($k, $ttl, $v); });
        \Illuminate\Support\Facades\Redis::shouldReceive('del')->byDefault()->andReturnUsing(function($k) use ($mockRedis) { return $mockRedis->del($k); });
    }
}
