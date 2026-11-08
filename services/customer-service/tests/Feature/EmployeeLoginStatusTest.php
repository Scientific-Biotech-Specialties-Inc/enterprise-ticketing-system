<?php

namespace Tests\Feature;

use App\Events\EmployeeStatusChanged;
use App\Models\Employee;
use App\Services\AuthService;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class EmployeeLoginStatusTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

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

        if (!Schema::hasTable('oauth_personal_access_clients')) {
            Schema::create('oauth_personal_access_clients', function ($table) {
                $table->id();
                $table->unsignedBigInteger('client_id');
                $table->timestamps();
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

        if (\Illuminate\Support\Facades\DB::table('oauth_personal_access_clients')->count() === 0) {
            $passportClient = \Laravel\Passport\Client::create([
                'name' => 'Test Personal Access Client',
                'secret' => \Illuminate\Support\Str::random(40),
                'redirect' => 'http://localhost',
                'personal_access_client' => true,
                'password_client' => false,
                'revoked' => false,
            ]);
            \Illuminate\Support\Facades\DB::table('oauth_personal_access_clients')->insert([
                'client_id' => $passportClient->id,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }
    public function test_employee_login_automatically_sets_status_to_active()
    {
        Event::fake([EmployeeStatusChanged::class]);

        $employee = Employee::updateOrCreate(
            ['email' => 'tech_test_active@example.com'],
            [
                'password_hash' => Hash::make('password123'),
                'first_name' => 'Active',
                'last_name' => 'Tech',
                'role' => 'technician',
                'department' => 'Service',
                'is_active' => false,
                'password_change_at' => now(),
            ]
        );

        $this->assertFalse((bool) $employee->fresh()->is_active);

        $authService = app(AuthService::class);
        $result = $authService->login('tech_test_active@example.com', 'password123', 'employee');

        $this->assertTrue($result['success']);
        $this->assertTrue((bool) $employee->fresh()->is_active);
        Event::assertDispatched(EmployeeStatusChanged::class);
    }
}
