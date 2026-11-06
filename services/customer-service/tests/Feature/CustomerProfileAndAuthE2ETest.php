<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\ClientCredential;
use App\Services\AuthService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class CustomerProfileAndAuthE2ETest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        echo "Database: " . DB::connection()->getDatabaseName() . PHP_EOL;
        Http::fake([
            '*' => Http::response(['status' => 'success'], 200),
        ]);
        Mail::fake();

        $this->ensureTablesExist();
    }

    private function ensureTablesExist(): void
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

        if (!Schema::hasTable('password_reset_otps')) {
            Schema::create('password_reset_otps', function ($table) {
                $table->id();
                $table->string('email')->unique();
                $table->string('otp_hash');
                $table->unsignedTinyInteger('attempts')->default(0);
                $table->timestamp('expires_at');
                $table->timestamp('used_at')->nullable();
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

        if (DB::table('oauth_personal_access_clients')->count() === 0) {
            $passportClient = \Laravel\Passport\Client::create([
                'name' => 'Test Personal Access Client',
                'secret' => \Illuminate\Support\Str::random(40),
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

    public function test_ts002_fetch_and_update_customer_profile()
    {
        $client = Client::create([
            'client_name' => 'John Doe',
            'email' => 'ts002_test_' . uniqid() . '@example.com',
            'contact_number' => '1234567890',
            'address' => '123 Initial St',
        ]);

        ClientCredential::create([
            'client_id' => $client->id,
            'password_hash' => Hash::make('P@ssword123!'),
            'password_change_at' => now(),
        ]);

        // 1. Fetch profile
        $response = $this->actingAs($client, 'api')
            ->getJson('/api/profile');

        echo "STATUS: " . $response->status() . " MSG: " . json_encode($response->json()) . PHP_EOL;

        $response->assertStatus(200)
            ->assertJsonPath('user.email', $client->email)
            ->assertJsonPath('user.phone', '1234567890')
            ->assertJsonPath('user.address', '123 Initial St')
            ->assertJsonPath('user.is_readonly_cms', true);

        // 2. Update editable fields
        $newEmail = 'ts002_updated_' . uniqid() . '@example.com';
        $updateResponse = $this->actingAs($client, 'api')
            ->putJson('/api/profile', [
                'email' => $newEmail,
                'phone' => '+1 (555) 234-5678',
                'address' => '456 Updated Ave',
                'firstName' => 'HackedName', // Client name is read-only
            ]);

        $updateResponse->assertStatus(200)
            ->assertJsonPath('user.email', $newEmail)
            ->assertJsonPath('user.phone', '+1 (555) 234-5678')
            ->assertJsonPath('user.address', '456 Updated Ave');

        $refreshed = $client->fresh();
        $this->assertSame($newEmail, $refreshed->email);
        $this->assertSame('+1 (555) 234-5678', $refreshed->contact_number);
        $this->assertSame('456 Updated Ave', $refreshed->address);
    }

    public function test_ts002_profile_validation_and_duplicate_email()
    {
        $existing = Client::create([
            'client_name' => 'Jane Existing',
            'email' => 'ts002_existing_' . uniqid() . '@example.com',
            'contact_number' => '1234567890',
            'address' => '789 Old Way',
        ]);

        $client = Client::create([
            'client_name' => 'Bob Smith',
            'email' => 'ts002_bob_' . uniqid() . '@example.com',
            'contact_number' => '1234567890',
            'address' => '101 New Way',
        ]);

        // Invalid phone number
        $phoneFail = $this->actingAs($client, 'api')
            ->putJson('/api/profile', [
                'email' => $client->email,
                'phone' => 'invalid-abc',
            ]);
        $phoneFail->assertStatus(422)
            ->assertJsonValidationErrors(['phone']);

        // Duplicate email
        $dupFail = $this->actingAs($client, 'api')
            ->putJson('/api/profile', [
                'email' => $existing->email,
                'phone' => '0987654321',
                'address' => '789 Old Way',
            ]);
        $dupFail->assertStatus(409)
            ->assertJsonPath('error', 'EMAIL_ALREADY_EXISTS');
    }

    public function test_ts005_notification_preferences_lifecycle()
    {
        $client = Client::create([
            'client_name' => 'Pref User',
            'email' => 'ts005_pref_' . uniqid() . '@example.com',
            'contact_number' => '1234567890',
            'address' => '222 Pref St',
        ]);

        // Default preferences
        $getResp = $this->actingAs($client, 'api')
            ->getJson('/api/notification-preferences');

        $getResp->assertStatus(200)
            ->assertJsonPath('preferences.in_app', true)
            ->assertJsonPath('preferences.email', true);

        // Update preferences
        $updateResp = $this->actingAs($client, 'api')
            ->putJson('/api/notification-preferences', [
                'in_app' => true,
                'email' => false,
            ]);

        $updateResp->assertStatus(200)
            ->assertJsonPath('preferences.in_app', true)
            ->assertJsonPath('preferences.email', false);

        // Attempt to disable all channels -> 422
        $failResp = $this->actingAs($client, 'api')
            ->putJson('/api/notification-preferences', [
                'in_app' => false,
                'email' => false,
            ]);

        $failResp->assertStatus(422)
            ->assertJsonPath('error', 'AT_LEAST_ONE_CHANNEL_REQUIRED');
    }

    public function test_ts009_first_login_otp_and_password_change_flow()
    {
        $defaultPassword = 'DefaultPassword123!';
        $client = Client::create([
            'client_name' => 'FirstLogin Customer',
            'email' => 'ts009_otp_' . uniqid() . '@example.com',
            'contact_number' => '1234567890',
            'address' => '333 First St',
        ]);

        ClientCredential::create([
            'client_id' => $client->id,
            'password_hash' => Hash::make($defaultPassword),
            'password_change_at' => null, // First login condition
        ]);

        $authService = app(AuthService::class);
        $loginRes = $authService->login($client->email, $defaultPassword, 'customer');

        $this->assertTrue($loginRes['success']);
        $this->assertTrue($loginRes['is_first_login']);

        // 1. Resend OTP endpoint
        $resendResp = $this->actingAs($client, 'api')
            ->postJson('/api/first-login/resend-otp');
        $resendResp->assertStatus(200)
            ->assertJsonPath('cooldown_seconds', 60);

        // Cooldown active immediately after
        $cooldownResp = $this->actingAs($client, 'api')
            ->postJson('/api/first-login/resend-otp');
        $cooldownResp->assertStatus(429);

        // 2. Failed OTP attempts tracking (5 attempts limit)
        $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class);
        for ($i = 0; $i < 5; $i++) {
            $verifyFail = $this->actingAs($client, 'api')
                ->postJson('/api/first-login/verify-otp', ['otp' => '000000']);
            $this->assertFalse($verifyFail->json('success') ?? false);
        }
        $lockoutResp = $this->actingAs($client, 'api')
            ->postJson('/api/first-login/verify-otp', ['otp' => '000000']);
        $lockoutResp->assertStatus(422);

        // Reset lockout for testing password change
        $client->credential()->update(['locked_until' => null, 'failed_login_count' => 0]);
        \App\Models\PasswordResetOtp::where('email', $client->email)->update(['attempts' => 0]);

        // 3. Password change rejecting default password
        $reuseFail = $authService->changePassword($client, $defaultPassword, $defaultPassword);
        $this->assertFalse($reuseFail['success']);
        $this->assertStringContainsString('cannot be the same', $reuseFail['message']);

        // 4. Password change with valid new password
        $newPassword = 'BrandNewP@ssword2026!';
        $changeSuccess = $authService->changePassword($client, $defaultPassword, $newPassword);
        $this->assertTrue($changeSuccess['success']);

        $refreshedCred = ClientCredential::where('client_id', $client->id)->first();
        $this->assertNotNull($refreshedCred->password_change_at);
        $this->assertTrue(Hash::check($newPassword, $refreshedCred->password_hash));
    }
}
