<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\Employee;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Ticketing\Auth\Dto\AuthenticatedUserDto;

class AuthModuleSsoTest extends TestCase
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
    }

    public function test_auth_module_sso_request_resolves_me_endpoint_with_status_200(): void
    {
        $dto = new AuthenticatedUserDto([
            'emp_id' => 1096,
            'email' => 'sso.user.' . uniqid() . '@hospital.com',
            'first_name' => 'Shelley',
            'last_name' => 'Sesante',
            'role' => 'customer service',
            'department' => 'Customer Service',
        ]);

        $response = $this->actingAs($dto)->getJson('/api/me');

        $response->assertStatus(200);
        $data = $response->json();
        $this->assertArrayHasKey('user', $data);
        $this->assertEquals('Shelley', $data['user']['first_name']);
        $this->assertFalse($data['is_first_login']);
    }

    public function test_unauthenticated_request_to_me_returns_unauthorized(): void
    {
        $response = $this->getJson('/api/me');
        $response->assertStatus(401);
    }
}

