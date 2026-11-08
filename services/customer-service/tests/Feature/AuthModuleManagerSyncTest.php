<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class AuthModuleManagerSyncTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Cache::forget('employees_synced_lock');

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
    }

    public function test_new_manager_account_from_auth_module_syncs_into_employees_table(): void
    {
        $testEmail = 'new.it.manager.' . uniqid() . '@example.com';

        // Mock the internal users-by-roles REST API from capstone-auth-module
        Http::fake([
            '*/api/internal/users-by-roles*' => Http::response([
                'success' => true,
                'data' => [
                    [
                        'id' => 9999,
                        'email' => $testEmail,
                        'first_name' => 'Alexander',
                        'last_name' => 'Wright',
                        'role' => 'Manager',
                        'department' => 'IT',
                        'phone' => '+63 917 555 1234',
                        'branch' => 'Main Office',
                        'is_active' => 1,
                    ],
                ],
            ], 200),
        ]);

        Cache::forget('employees_synced_lock');
        AuthController::autoSyncWithAuthModule();

        // Verify the newly created manager is stored in the database with accurate position and roles
        $manager = DB::table('employees')->where('email', $testEmail)->first();

        $this->assertNotNull($manager, 'New manager from auth module should be inserted into employees table');
        $this->assertEquals('Alexander', $manager->first_name);
        $this->assertEquals('Wright', $manager->last_name);
        $this->assertEquals('Manager', $manager->position_level);
        $this->assertEquals('IT', $manager->department);
        $this->assertEquals('service', $manager->role);
        $this->assertEquals('IT Manager', $manager->technical_role);
        $this->assertEquals(1, $manager->is_active);

        // Clean up
        DB::table('employees')->where('email', $testEmail)->delete();
    }

    public function test_service_manager_role_assignment(): void
    {
        $testEmail = 'new.service.manager.' . uniqid() . '@example.com';

        Http::fake([
            '*/api/internal/users-by-roles*' => Http::response([
                'success' => true,
                'data' => [
                    [
                        'id' => 9998,
                        'email' => $testEmail,
                        'first_name' => 'Clara',
                        'last_name' => 'Oswald',
                        'role' => 'Manager',
                        'department' => 'Service',
                        'phone' => '+63 917 555 9876',
                        'branch' => 'Main Office',
                        'is_active' => 1,
                    ],
                ],
            ], 200),
        ]);

        Cache::forget('employees_synced_lock');
        AuthController::autoSyncWithAuthModule();

        $manager = DB::table('employees')->where('email', $testEmail)->first();

        $this->assertNotNull($manager);
        $this->assertEquals('Manager', $manager->position_level);
        $this->assertEquals('Service', $manager->department);
        $this->assertEquals('service', $manager->role);
        $this->assertEquals('Service Manager', $manager->technical_role);

        // Clean up
        DB::table('employees')->where('email', $testEmail)->delete();
    }
}
