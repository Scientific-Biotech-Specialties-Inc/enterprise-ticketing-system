<?php

namespace Tests\Unit;

use Tests\TestCase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Redis;
use Ticketing\Auth\Dto\AuthenticatedUserDto;
use Ticketing\Auth\Security\TokenRevocationChecker;
use Ticketing\Auth\Middleware\VerifyEmployeeJwt;

class TicketingAuthTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
    }

    /**
     * covers: AC-3
     */
    public function test_authenticated_user_dto_initializes_with_default_and_custom_attributes(): void
    {
        $dto = new AuthenticatedUserDto([
            'emp_id' => 42,
            'email' => 'tech@hospital.com',
            'first_name' => 'John',
            'last_name' => 'Doe',
            'role' => 'service',
            'branch' => 'Main Hospital',
            'branch_id' => 101,
            'jti' => 'jwt-test-uuid-1',
            'exp' => time() + 3600,
        ]);

        $this->assertEquals(42, $dto->emp_id);
        $this->assertEquals(42, $dto->id);
        $this->assertEquals('tech@hospital.com', $dto->email);
        $this->assertEquals('John Doe', $dto->name);
        $this->assertEquals('service', $dto->role);
        $this->assertEquals(101, $dto->branch_id);
        $this->assertTrue($dto->is_active);
        $this->assertEquals('jwt-test-uuid-1', $dto->jti);
    }

    /**
     * covers: AC-3
     */
    public function test_authenticated_user_dto_array_access_and_json_serialization(): void
    {
        $dto = new AuthenticatedUserDto([
            'emp_id' => 7,
            'email' => 'admin@hospital.com',
            'role' => 'admin',
        ]);

        $this->assertTrue(isset($dto['email']));
        $this->assertEquals('admin@hospital.com', $dto['email']);

        $serialized = $dto->jsonSerialize();
        $this->assertIsArray($serialized);
        $this->assertEquals(7, $serialized['emp_id']);
        $this->assertEquals('admin', $serialized['role']);
    }

    /**
     * covers: AC-3
     */
    public function test_authenticated_user_dto_satisfies_authenticatable_contract(): void
    {
        $dto = new AuthenticatedUserDto([
            'emp_id' => 15,
            'email' => 'nurse@hospital.com',
        ]);

        $this->assertEquals('emp_id', $dto->getAuthIdentifierName());
        $this->assertEquals(15, $dto->getAuthIdentifier());
    }

    /**
     * covers: AC-4
     */
    public function test_token_revocation_checker_returns_true_for_empty_or_null_jti(): void
    {
        $this->assertTrue(TokenRevocationChecker::isRevoked(null));
        $this->assertTrue(TokenRevocationChecker::isRevoked(''));
    }

    /**
     * covers: AC-4
     */
    public function test_token_revocation_checker_checks_redis_blacklist(): void
    {
        $jtiActive = 'valid-active-token-' . uniqid();
        $jtiRevoked = 'blacklisted-token-' . uniqid();

        Redis::shouldReceive('connection')->with('auth')->andReturnSelf();
        Redis::shouldReceive('get')->with('jwt_blacklist:' . $jtiActive)->andReturn(null);
        Redis::shouldReceive('get')->with('jwt_blacklist:' . $jtiRevoked)->andReturn('revoked_at_timestamp');

        $this->assertFalse(TokenRevocationChecker::isRevoked($jtiActive));
        $this->assertTrue(TokenRevocationChecker::isRevoked($jtiRevoked));
    }

    /**
     * covers: AC-3
     */
    public function test_verify_employee_jwt_blocks_request_without_token(): void
    {
        $middleware = new VerifyEmployeeJwt();
        $request = Request::create('/api/tickets', 'GET');

        $response = $middleware->handle($request, function () {
            return response()->json(['status' => 'passed']);
        });

        $this->assertEquals(401, $response->getStatusCode());
        $this->assertStringContainsString('Missing or invalid token format', (string) $response->getContent());
    }

    /**
     * covers: AC-4
     */
    public function test_verify_employee_jwt_rejects_expired_cached_token(): void
    {
        $middleware = new VerifyEmployeeJwt();
        $token = 'expired-cache-test-token';
        $tokenHash = hash('sha256', $token);

        Cache::put('sso_auth_cache:' . $tokenHash, [
            'exp' => time() - 60,
            'jti' => 'expired-jti',
            'emp_id' => 1,
            'user' => ['emp_id' => 1, 'email' => 'old@example.com'],
        ], 3600);

        $request = Request::create('/api/tickets', 'GET');
        $request->headers->set('Authorization', 'Bearer ' . $token);

        $response = $middleware->handle($request, function () {
            return response()->json(['status' => 'passed']);
        });

        $this->assertEquals(401, $response->getStatusCode());
        $this->assertStringContainsString('Token expired', (string) $response->getContent());
        $this->assertNull(Cache::get('sso_auth_cache:' . $tokenHash));
    }

    /**
     * covers: AC-4
     */
    public function test_verify_employee_jwt_invalidates_cached_session_when_jti_is_revoked(): void
    {
        $middleware = new VerifyEmployeeJwt();
        $token = 'revoked-cache-test-token';
        $tokenHash = hash('sha256', $token);
        $revokedJti = 'revoked-jti-123';

        Cache::put('sso_auth_cache:' . $tokenHash, [
            'exp' => time() + 3600,
            'jti' => $revokedJti,
            'emp_id' => 1,
            'user' => ['emp_id' => 1, 'email' => 'revoked@example.com'],
        ], 3600);

        Redis::shouldReceive('connection')->with('auth')->andReturnSelf();
        Redis::shouldReceive('get')->with('jwt_blacklist:' . $revokedJti)->andReturn('1');

        $request = Request::create('/api/tickets', 'GET');
        $request->headers->set('Authorization', 'Bearer ' . $token);

        $response = $middleware->handle($request, function () {
            return response()->json(['status' => 'passed']);
        });

        $this->assertEquals(401, $response->getStatusCode());
        $this->assertStringContainsString('Token has been revoked', (string) $response->getContent());
        $this->assertNull(Cache::get('sso_auth_cache:' . $tokenHash));
    }
}

