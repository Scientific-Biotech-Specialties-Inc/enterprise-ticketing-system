<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\ClientCredential;
use App\Models\RefreshToken;
use App\Services\AuthService;
use App\Services\SystemAlertDispatcher;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Laravel\Passport\Client as PassportClient;
use Laravel\Passport\Passport;
use Tests\TestCase;

class CustomerAuthSecurityHardeningTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Http::fake([
            '*' => Http::response(['status' => 'success'], 200),
        ]);

        $this->ensureTablesExist();
    }

    private function ensureTablesExist(): void
    {
        if (!Schema::hasTable('clients')) {
            Schema::create('clients', function ($table) {
                $table->id();
                $table->string('client_name');
                $table->string('address')->nullable();
                $table->string('contact_number')->nullable();
                $table->string('email')->unique();
                $table->boolean('status')->default(true);
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('clients_credentials')) {
            Schema::create('clients_credentials', function ($table) {
                $table->unsignedBigInteger('client_id')->primary();
                $table->string('password_hash');
                $table->integer('failed_login_count')->default(0);
                $table->timestamp('locked_until')->nullable();
                $table->timestamp('last_login_at')->nullable();
                $table->timestamp('password_change_at')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('refresh_tokens')) {
            Schema::create('refresh_tokens', function ($table) {
                $table->id();
                $table->unsignedBigInteger('client_id')->nullable();
                $table->unsignedBigInteger('employee_id')->nullable();
                $table->string('token_hash', 64)->unique();
                $table->boolean('is_revoked')->default(false)->index();
                $table->timestamp('expires_at')->nullable();
                $table->timestamps();
            });
        } elseif (!Schema::hasColumn('refresh_tokens', 'is_revoked')) {
            Schema::table('refresh_tokens', function ($table) {
                $table->boolean('is_revoked')->default(false)->index();
            });
        }

        if (!Schema::hasTable('oauth_access_tokens')) {
            Schema::create('oauth_access_tokens', function ($table) {
                $table->string('id', 100)->primary();
                $table->unsignedBigInteger('user_id')->nullable()->index();
                $table->unsignedBigInteger('client_id');
                $table->string('name')->nullable();
                $table->text('scopes')->nullable();
                $table->boolean('revoked');
                $table->timestamps();
                $table->dateTime('expires_at')->nullable();
            });
        }

        if (!Schema::hasTable('oauth_clients')) {
            Schema::create('oauth_clients', function ($table) {
                $table->id();
                $table->unsignedBigInteger('user_id')->nullable()->index();
                $table->string('name');
                $table->string('secret', 100)->nullable();
                $table->string('provider')->nullable();
                $table->text('redirect');
                $table->boolean('personal_access_client');
                $table->boolean('password_client');
                $table->boolean('revoked');
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('oauth_personal_access_clients')) {
            Schema::create('oauth_personal_access_clients', function ($table) {
                $table->id();
                $table->unsignedBigInteger('client_id');
                $table->timestamps();
            });
        }

        // Ensure personal access client exists for token creation
        if (DB::table('oauth_personal_access_clients')->count() === 0) {
            $passportClient = PassportClient::create([
                'name' => 'Test Personal Access Client',
                'secret' => Str::random(40),
                'redirect' => 'http://localhost',
                'personal_access_client' => true,
                'password_client' => false,
                'revoked' => false,
            ]);
            DB::table('oauth_personal_access_clients')->insert([
                'client_id' => $passportClient->id,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    /**
     * AC-1: Customer model serialization and profile responses must never include the credential relation.
     */
    public function test_ac1_customer_model_serialization_hides_credential_relation(): void
    {
        $client = Client::create([
            'client_name' => 'Ac1 Test Customer',
            'email' => 'ac1_' . uniqid() . '@example.com',
            'contact_number' => '1234567890',
            'address' => '123 Security Blvd',
        ]);

        ClientCredential::create([
            'client_id' => $client->id,
            'password_hash' => Hash::make('Secret123!'),
            'failed_login_count' => 3,
            'locked_until' => Carbon::now()->addMinutes(15),
            'password_change_at' => Carbon::now(),
        ]);

        // Eager load relation explicitly
        $loadedClient = Client::with('credential')->find($client->id);
        $this->assertNotNull($loadedClient->credential);

        // Serialization must hide the credential relation
        $array = $loadedClient->toArray();
        $this->assertArrayNotHasKey('credential', $array, 'Client::toArray() must hide credential relation');

        $json = json_decode(json_encode($loadedClient), true);
        $this->assertArrayNotHasKey('credential', $json, 'Client json_encode must hide credential relation');
        $this->assertArrayNotHasKey('failed_login_count', $json);
        $this->assertArrayNotHasKey('locked_until', $json);

        // Direct profile endpoint must not expose credential
        $response = $this->actingAs($client, 'api')->getJson('/api/profile');
        $response->assertStatus(200);
        $this->assertArrayNotHasKey('credential', $response->json('user'));
        $this->assertArrayNotHasKey('failed_login_count', $response->json('user'));
        $this->assertArrayNotHasKey('locked_until', $response->json('user'));
    }

    /**
     * AC-2: Refresh token cookie must be scoped exclusively to /api/ticketing/customer.
     */
    public function test_ac2_refresh_cookie_is_scoped_to_customer_namespace(): void
    {
        $password = 'ValidPassword123!';
        $client = Client::create([
            'client_name' => 'Cookie Scope Customer',
            'email' => 'cookie_scope_' . uniqid() . '@example.com',
            'contact_number' => '1234567890',
            'address' => '456 Cookie Lane',
        ]);

        ClientCredential::create([
            'client_id' => $client->id,
            'password_hash' => Hash::make($password),
            'password_change_at' => Carbon::now(),
        ]);

        $response = $this->postJson('/api/login', [
            'email' => $client->email,
            'password' => $password,
        ]);

        $response->assertStatus(200);

        $cookies = $response->headers->getCookies();
        $refreshCookie = null;
        foreach ($cookies as $cookie) {
            if ($cookie->getName() === 'refresh_token') {
                $refreshCookie = $cookie;
                break;
            }
        }

        $this->assertNotNull($refreshCookie, 'refresh_token cookie must be present on login');
        $this->assertEquals('/api/ticketing/customer', $refreshCookie->getPath(), 'refresh_token cookie path must be /api/ticketing/customer');
        $this->assertTrue($refreshCookie->isHttpOnly());
        $this->assertEquals('lax', strtolower($refreshCookie->getSameSite()));
    }

    /**
     * AC-3: Refresh token schema tracks revocation status using is_revoked boolean column.
     */
    public function test_ac3_refresh_token_schema_tracks_is_revoked_status(): void
    {
        $client = Client::create([
            'client_name' => 'Schema Test Customer',
            'email' => 'schema_' . uniqid() . '@example.com',
        ]);

        $rt = RefreshToken::create([
            'client_id' => $client->id,
            'token_hash' => hash('sha256', Str::random(80)),
            'is_revoked' => false,
            'expires_at' => Carbon::now()->addDays(14),
        ]);

        $this->assertFalse($rt->is_revoked);
        $this->assertIsBool($rt->is_revoked);

        $rt->update(['is_revoked' => true]);
        $this->assertTrue($rt->fresh()->is_revoked);
    }

    /**
     * AC-4: When a refresh token exchange occurs, the old token must be marked as revoked
     * while the new token is issued with rotation.
     */
    public function test_ac4_refresh_token_rotation_revokes_old_token_and_issues_new_token(): void
    {
        $client = Client::create([
            'client_name' => 'Rotation Test Customer',
            'email' => 'rotation_' . uniqid() . '@example.com',
            'contact_number' => '1234567890',
            'address' => '789 Rotate Ave',
        ]);

        $rawOldToken = Str::random(80);
        $oldHash = hash('sha256', $rawOldToken);

        $oldRecord = RefreshToken::create([
            'client_id' => $client->id,
            'token_hash' => $oldHash,
            'is_revoked' => false,
            'expires_at' => Carbon::now()->addDays(14),
        ]);

        $response = $this->call('POST', '/api/auth/refresh', [], ['refresh_token' => $rawOldToken], [], ['HTTP_ACCEPT' => 'application/json']);

        $response->assertStatus(200);
        $response->assertJsonStructure(['token', 'user']);

        // Old token must now be marked as revoked
        $this->assertTrue($oldRecord->fresh()->is_revoked, 'Old refresh token must be revoked');

        // A new active child token must exist for the client
        $activeToken = RefreshToken::where('client_id', $client->id)
            ->where('is_revoked', false)
            ->first();
        $this->assertNotNull($activeToken, 'New active refresh token must exist');
        $this->assertNotEquals($oldHash, $activeToken->token_hash);

        // Check new cookie scoping
        $refreshCookie = null;
        foreach ($response->headers->getCookies() as $cookie) {
            if ($cookie->getName() === 'refresh_token') {
                $refreshCookie = $cookie;
                break;
            }
        }
        $this->assertNotNull($refreshCookie);
        $this->assertEquals('/api/ticketing/customer', $refreshCookie->getPath());
    }

    /**
     * AC-5: If any request submits an already revoked refresh token, the service must detect reuse,
     * purge all active refresh tokens and access tokens for that customer, dispatch a security alert,
     * and reject the request with a 401 response.
     */
    public function test_ac5_replaying_revoked_token_triggers_reuse_detection_and_purges_sessions(): void
    {
        $client = Client::create([
            'client_name' => 'Breach Test Customer',
            'email' => 'breach_' . uniqid() . '@example.com',
            'contact_number' => '1234567890',
            'address' => '999 Breach Way',
        ]);

        // Revoked token (stolen from a previous rotation)
        $rawStolenToken = Str::random(80);
        $stolenHash = hash('sha256', $rawStolenToken);
        RefreshToken::create([
            'client_id' => $client->id,
            'token_hash' => $stolenHash,
            'is_revoked' => true,
            'expires_at' => Carbon::now()->addDays(14),
        ]);

        // Legitimate active token currently in use
        $rawActiveToken = Str::random(80);
        RefreshToken::create([
            'client_id' => $client->id,
            'token_hash' => hash('sha256', $rawActiveToken),
            'is_revoked' => false,
            'expires_at' => Carbon::now()->addDays(14),
        ]);

        // Active access token
        $client->createToken('client');
        $this->assertGreaterThan(0, DB::table('oauth_access_tokens')->where('user_id', $client->id)->count());

        // Attacker replays the stolen revoked token
        $response = $this->call('POST', '/api/auth/refresh', [], ['refresh_token' => $rawStolenToken], [], ['HTTP_ACCEPT' => 'application/json']);

        // Endpoint must reject with 401
        $response->assertStatus(401);
        $this->assertStringContainsString('Token reuse detected', $response->json('message'));

        // All refresh tokens for this client must be purged
        $remainingRefreshTokens = RefreshToken::where('client_id', $client->id)->count();
        $this->assertEquals(0, $remainingRefreshTokens, 'All refresh tokens must be purged upon reuse detection');

        // All Passport access tokens for this client must be purged
        $remainingAccessTokens = DB::table('oauth_access_tokens')->where('user_id', $client->id)->count();
        $this->assertEquals(0, $remainingAccessTokens, 'All access tokens must be purged upon reuse detection');
    }

    /**
     * AC-6: When a customer logs out, their refresh token record must be deleted
     * and the refresh cookie must be cleared using the restricted path.
     */
    public function test_ac6_logout_deletes_refresh_token_and_clears_cookie_on_restricted_path(): void
    {
        $client = Client::create([
            'client_name' => 'Logout Test Customer',
            'email' => 'logout_' . uniqid() . '@example.com',
            'contact_number' => '1234567890',
            'address' => '111 Logout Rd',
        ]);

        $rawToken = Str::random(80);
        RefreshToken::create([
            'client_id' => $client->id,
            'token_hash' => hash('sha256', $rawToken),
            'is_revoked' => false,
            'expires_at' => Carbon::now()->addDays(14),
        ]);

        $response = $this->actingAs($client, 'api')
            ->withUnencryptedCookie('refresh_token', $rawToken)
            ->postJson('/api/logout');

        $response->assertStatus(200);

        // Token must be purged from database
        $this->assertEquals(0, RefreshToken::where('client_id', $client->id)->count());

        // Cookie must be cleared with restricted path /api/ticketing/customer
        $clearedCookie = null;
        foreach ($response->headers->getCookies() as $cookie) {
            if ($cookie->getName() === 'refresh_token' && $cookie->getPath() === '/api/ticketing/customer') {
                $clearedCookie = $cookie;
                break;
            }
        }
        $this->assertNotNull($clearedCookie, 'Must clear refresh_token cookie on path /api/ticketing/customer');
        $this->assertLessThan(time(), $clearedCookie->getExpiresTime(), 'Cookie must have an expiration in the past');
    }

    /**
     * Regression test: When a customer's 30-minute access token has expired (no actingAs / no valid Bearer token),
     * calling /api/logout with the refresh_token cookie must still return 200, purge all refresh and access tokens
     * for that customer, and expire the refresh_token cookie on /api/ticketing/customer.
     */
    public function test_ac6_logout_succeeds_and_purges_tokens_when_access_token_is_expired_or_absent(): void
    {
        $client = Client::create([
            'client_name' => 'Expired Access Logout Customer',
            'email' => 'expired_logout_' . uniqid() . '@example.com',
            'contact_number' => '1234567890',
            'address' => '222 Logout Rd',
        ]);

        $rawToken = Str::random(80);
        RefreshToken::create([
            'client_id' => $client->id,
            'token_hash' => hash('sha256', $rawToken),
            'is_revoked' => false,
            'expires_at' => Carbon::now()->addDays(14),
        ]);

        $client->createToken('client');
        $this->assertGreaterThan(0, DB::table('oauth_access_tokens')->where('user_id', $client->id)->count());

        $response = $this->call('POST', '/api/logout', [], ['refresh_token' => $rawToken], [], ['HTTP_ACCEPT' => 'application/json']);

        $response->assertStatus(200);
        $this->assertEquals(0, RefreshToken::where('client_id', $client->id)->count());
        $this->assertEquals(0, DB::table('oauth_access_tokens')->where('user_id', $client->id)->count());

        $clearedCookie = null;
        foreach ($response->headers->getCookies() as $cookie) {
            if ($cookie->getName() === 'refresh_token' && $cookie->getPath() === '/api/ticketing/customer') {
                $clearedCookie = $cookie;
                break;
            }
        }
        $this->assertNotNull($clearedCookie);
        $this->assertLessThan(time(), $clearedCookie->getExpiresTime());
    }

    /**
     * Edge case: Refresh request with no cookie provided returns 401.
     */
    public function test_refresh_fails_when_no_cookie_provided(): void
    {
        $response = $this->call('POST', '/api/auth/refresh', [], [], [], ['HTTP_ACCEPT' => 'application/json']);
        $response->assertStatus(401);
        $this->assertEquals('No refresh token', $response->json('message'));
    }

    /**
     * Edge case: Refresh request with expired token returns 401.
     */
    public function test_refresh_fails_when_token_is_expired(): void
    {
        $client = Client::create([
            'client_name' => 'Expired Token Customer',
            'email' => 'expired_' . uniqid() . '@example.com',
        ]);

        $rawToken = Str::random(80);
        RefreshToken::create([
            'client_id' => $client->id,
            'token_hash' => hash('sha256', $rawToken),
            'is_revoked' => false,
            'expires_at' => Carbon::now()->subHour(),
        ]);

        $response = $this->call('POST', '/api/auth/refresh', [], ['refresh_token' => $rawToken], [], ['HTTP_ACCEPT' => 'application/json']);
        $response->assertStatus(401);
        $this->assertEquals('Invalid or expired refresh token', $response->json('message'));
    }

    /**
     * Edge case: Refresh request with unknown token hash returns 401.
     */
    public function test_refresh_fails_when_token_hash_is_unknown(): void
    {
        $rawRandom = Str::random(80);
        $response = $this->call('POST', '/api/auth/refresh', [], ['refresh_token' => $rawRandom], [], ['HTTP_ACCEPT' => 'application/json']);
        $response->assertStatus(401);
        $this->assertEquals('Invalid or expired refresh token', $response->json('message'));
    }

    /**
     * Edge case: Employee login initializes is_revoked to false on RefreshToken.
     */
    public function test_auth_service_initializes_is_revoked_false_for_employee(): void
    {
        if (!Schema::hasTable('employees')) {
            Schema::create('employees', function ($table) {
                $table->increments('emp_id');
                $table->string('email')->unique();
                $table->string('phone_number')->nullable();
                $table->string('password_hash')->default('');
                $table->string('first_name')->nullable();
                $table->string('last_name')->nullable();
                $table->string('role')->nullable();
                $table->string('position_level')->nullable();
                $table->string('technical_role')->nullable();
                $table->string('department')->nullable();
                $table->string('branch')->default('Main Branch');
                $table->integer('branch_id')->default(1);
                $table->boolean('is_active')->default(true);
                $table->integer('failed_login_count')->default(0);
                $table->timestamp('locked_until')->nullable();
                $table->timestamp('last_login_at')->nullable();
                $table->timestamp('last_seen_at')->nullable();
                $table->timestamp('last_synced_at')->nullable();
                $table->timestamp('password_change_at')->nullable();
            });
        }

        $password = 'EmployeePass123!';
        $employee = \App\Models\Employee::create([
            'email' => 'emp_test_' . uniqid() . '@example.com',
            'password_hash' => Hash::make($password),
            'first_name' => 'Emp',
            'last_name' => 'Test',
            'role' => 'technician',
            'department' => 'Service',
            'is_active' => true,
            'password_change_at' => now(),
        ]);

        $authService = app(AuthService::class);
        $result = $authService->login($employee->email, $password, 'employee');

        $this->assertTrue($result['success']);
        $tokenRecord = RefreshToken::where('employee_id', $employee->emp_id)->first();
        $this->assertNotNull($tokenRecord);
        $this->assertFalse($tokenRecord->is_revoked);
    }

    /**
     * Defense in depth: ClientCredential model serialization hides lockout counters and password hash.
     */
    public function test_client_credential_model_serialization_hides_lockout_counters_and_password_hash(): void
    {
        $credential = new ClientCredential([
            'client_id' => 999,
            'password_hash' => '$2y$10$abcdefghijklmnopqrstuvwxyz123456',
            'failed_login_count' => 5,
            'locked_until' => now()->addMinutes(15),
            'last_login_at' => now(),
            'password_change_at' => now(),
        ]);

        $serialized = $credential->toArray();

        $this->assertArrayNotHasKey('password_hash', $serialized);
        $this->assertArrayNotHasKey('failed_login_count', $serialized);
        $this->assertArrayNotHasKey('locked_until', $serialized);
        $this->assertArrayHasKey('client_id', $serialized);
    }
}
