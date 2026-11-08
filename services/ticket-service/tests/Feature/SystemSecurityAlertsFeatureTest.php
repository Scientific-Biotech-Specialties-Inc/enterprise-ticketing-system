<?php

namespace Tests\Feature;

use App\Models\Employee;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class SystemSecurityAlertsFeatureTest extends TestCase
{
    use DatabaseTransactions;

    protected string $privateKey = '';
    protected ?string $originalPublicKey = null;

    protected function setUp(): void
    {
        parent::setUp();

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

        if (!Schema::hasTable('branches')) {
            Schema::create('branches', function ($table) {
                $table->id();
                $table->string('name');
                $table->string('code')->unique();
                $table->string('region')->nullable();
                $table->text('address')->nullable();
                $table->boolean('is_active')->default(true);
                $table->timestamps();
            });
        }

        DB::table('branches')->updateOrInsert(
            ['id' => 1],
            ['slug' => 'main-office', 'name' => 'Main Office', 'code' => 'MAIN', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]
        );

        if (!Schema::hasTable('system_security_alerts')) {
            Schema::create('system_security_alerts', function ($table) {
                $table->bigIncrements('id');
                $table->string('incident_id', 64)->unique();
                $table->string('category', 64);
                $table->string('severity', 32)->default('medium');
                $table->string('service', 64);
                $table->string('title');
                $table->text('message');
                $table->longText('context_data')->nullable();
                $table->unsignedInteger('burst_count')->default(1);
                $table->string('ip_address', 45)->nullable();
                $table->string('client_ip', 45)->nullable();
                $table->string('endpoint', 255)->nullable();
                $table->string('http_method', 16)->nullable();
                $table->text('user_agent')->nullable();
                $table->string('status', 32)->default('active');
                $table->timestamp('first_seen_at')->nullable();
                $table->timestamp('last_seen_at')->nullable();
                $table->timestamp('resolved_at')->nullable();
                $table->unsignedBigInteger('resolved_by')->nullable();
                $table->timestamps();
            });
        }

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
                $table->string('phone_number')->nullable();
                $table->boolean('is_active')->default(true);
                $table->string('password_hash')->nullable();
                $table->timestamp('password_change_at')->nullable();
                $table->timestamp('last_synced_at')->nullable();
                $table->timestamps();
            });
        }

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

        if (!Schema::hasTable('ticket_audit_logs')) {
            Schema::create('ticket_audit_logs', function ($table) {
                $table->id('log_ID');
                $table->unsignedBigInteger('ticket_ID')->nullable();
                $table->string('action_type');
                $table->unsignedBigInteger('action_by_ID')->default(0);
                $table->string('actor_type')->default('system');
                $table->text('details')->nullable();
                $table->timestamps();
            });
        }
    }

    protected function tearDown(): void
    {
        $keyPath = storage_path('auth-module-public.key');
        if ($this->originalPublicKey !== null) {
            file_put_contents($keyPath, $this->originalPublicKey);
        }
        parent::tearDown();
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

    public function test_superadmin_can_retrieve_security_incidents_list(): void
    {
        $incidentId = 'INC-TEST-' . uniqid();
        DB::table('system_security_alerts')->insert([
            'incident_id' => $incidentId,
            'category' => 'sql_error',
            'severity' => 'critical',
            'title' => 'Test SQL Error',
            'message' => 'Table not found during query execution',
            'service' => 'ticket-service',
            'ip_address' => '127.0.0.1',
            'burst_count' => 1,
            'first_seen_at' => now(),
            'last_seen_at' => now(),
            'context_data' => json_encode(['sanitized_sql' => 'SELECT * FROM test_table']),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $token = $this->generateJwt([
            'sub' => 99981,
            'id' => 99981,
            'email' => 'superadmin@example.com',
            'role' => 'superadmin',
            'branch' => null,
            'branch_id' => null,
        ]);

        $response = $this->withHeader('Authorization', "Bearer {$token}")
            ->getJson('/api/superadmin/security-incidents');

        $response->assertStatus(200);
        $response->assertJsonFragment(['incident_id' => $incidentId]);
    }

    public function test_superadmin_can_retrieve_security_incident_detail(): void
    {
        $incidentId = 'INC-DETAIL-' . uniqid();
        DB::table('system_security_alerts')->insert([
            'incident_id' => $incidentId,
            'category' => 'unhandled_error',
            'severity' => 'high',
            'title' => 'Unhandled Exception in Service',
            'message' => 'Call to undefined function in controller',
            'service' => 'ticket-service',
            'ip_address' => '10.0.0.1',
            'burst_count' => 2,
            'first_seen_at' => now(),
            'last_seen_at' => now(),
            'context_data' => json_encode([
                'sanitized_trace' => ['App/Controller.php:32'],
                'sanitized_snippet' => 'execute()',
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $token = $this->generateJwt([
            'sub' => 99981,
            'id' => 99981,
            'email' => 'superadmin@example.com',
            'role' => 'superadmin',
            'branch' => null,
            'branch_id' => null,
        ]);

        $response = $this->withHeader('Authorization', "Bearer {$token}")
            ->getJson("/api/superadmin/security-incidents/{$incidentId}");

        $response->assertStatus(200);
        $response->assertJsonPath('incident.incident_id', $incidentId);
        $response->assertJsonPath('context.sanitized_trace.0', 'App/Controller.php:32');
    }

    public function test_non_superadmin_cannot_access_security_incidents(): void
    {
        DB::table('employees')->updateOrInsert(
            ['emp_id' => 50],
            [
                'first_name' => 'Staff',
                'last_name' => 'User',
                'email' => 'staff@company.com',
                'role' => 'employee',
                'department' => 'Staff',
                'password_hash' => 'secret',
                'branch_id' => 1,
                'branch' => 'Main Office',
                'is_active' => true,
            ]
        );

        $token = $this->generateJwt([
            'sub' => 50,
            'email' => 'staff@company.com',
            'role' => 'employee',
            'branch_id' => 1,
            'branch' => 'Main Office',
        ]);

        $response = $this->withHeader('Authorization', "Bearer {$token}")
            ->getJson('/api/superadmin/security-incidents');

        $response->assertStatus(403);
    }
}
