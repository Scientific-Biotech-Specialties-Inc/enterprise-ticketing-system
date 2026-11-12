<?php

namespace Tests\Feature;

use App\Http\Middleware\VerifyEmployeeJwt;
use App\Models\Branch;
use App\Models\Employee;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class CentralAuthBranchPayloadTest extends TestCase
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

        $this->setUpDatabaseSchema();

        Http::fake([
            '*/api/internal/branches' => Http::response([
                'branches' => [
                    [
                        'id' => 1,
                        'name' => 'Cebu Testing Branch',
                        'code' => 'TEST_CEB',
                        'region' => 'Visayas',
                        'address' => 'Test Cebu Blvd',
                        'is_active' => true,
                    ],
                ],
            ], 200),
            '*/api/internal/users/71' => Http::response([
                'id' => 71,
                'email' => 'slosinada@gmail.com',
                'first_name' => 'Jasmine',
                'last_name' => 'Aninion',
                'role' => 'Engineer',
                'department' => 'Service',
                // Auth Module id: deliberately not a local branch id (resolved by name instead).
                'branch_id' => 9912,
                'branch' => 'Test Makati Branch',
                'branch_details' => [
                    'id' => 9912,
                    'name' => 'Test Makati Branch',
                    'address' => 'Makati City, Metro Manila',
                ],
            ], 200),
            '*' => Http::response(['status' => 'success'], 200),
        ]);

        Branch::updateOrInsert(
            ['code' => 'TEST_CEB'],
            [
                'slug' => 'test-ceb',
                'name' => 'Cebu Testing Branch',
                'region' => 'Visayas',
                'address' => 'Test Cebu Blvd',
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
    }

    protected function tearDown(): void
    {
        $keyPath = storage_path('auth-module-public.key');
        if ($this->originalPublicKey !== null) {
            file_put_contents($keyPath, $this->originalPublicKey);
        }
        parent::tearDown();
    }

    protected function setUpDatabaseSchema(): void
    {
        if (DB::getDriverName() === 'sqlite') {
            DB::statement('PRAGMA foreign_keys = OFF');
        }

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

    public function test_public_branches_endpoint_returns_branches_list(): void
    {
        $response = $this->getJson('/api/branches');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'branches' => [
                '*' => ['id', 'name', 'code', 'region', 'address', 'is_active'],
            ],
            'count',
        ]);
    }

    public function test_superadmin_branches_endpoint_accessible_by_superadmin(): void
    {
        $superAdmin = Employee::where('role', 'superadmin')->first()
            ?? Employee::create([
                'emp_id' => 99981,
                'first_name' => 'Super',
                'last_name' => 'Admin',
                'email' => 'superadmin@example.com',
                'role' => 'superadmin',
                'department' => 'Executive',
                'is_active' => true,
                'password_hash' => 'secret',
                'branch' => null,
                'branch_id' => null,
            ]);

        $token = $this->generateJwt([
            'sub' => $superAdmin->emp_id,
            'id' => $superAdmin->emp_id,
            'email' => $superAdmin->email,
            'role' => 'superadmin',
            'branch' => null,
            'branch_id' => null,
        ]);

        $response = $this->withHeader('Authorization', "Bearer {$token}")
            ->getJson('/api/superadmin/branches');

        $response->assertStatus(200);
        $response->assertJsonStructure(['branches', 'count']);
    }

    public function test_verify_employee_jwt_allows_superadmin_with_null_branch(): void
    {
        $middleware = new VerifyEmployeeJwt();
        $token = $this->generateJwt([
            'sub' => 99982,
            'id' => 99982,
            'email' => 'superadmin@example.com',
            'role' => 'superadmin',
            'branch' => null,
            'branch_id' => null,
        ]);

        $request = Request::create('/api/employee/tickets', 'GET');
        $request->headers->set('Authorization', "Bearer {$token}");

        $response = $middleware->handle($request, function ($req) {
            return new Response('OK', 200);
        });

        $this->assertEquals(200, $response->getStatusCode());
        $employee = Employee::where('email', 'superadmin@example.com')->first();
        $this->assertNotNull($employee);
        $this->assertNull($employee->branch);
    }

    public function test_verify_employee_jwt_allows_admin_with_null_branch(): void
    {
        $middleware = new VerifyEmployeeJwt();
        $token = $this->generateJwt([
            'sub' => 99983,
            'id' => 99983,
            'email' => 'admin@example.com',
            'role' => 'admin',
            'branch' => null,
            'branch_id' => null,
        ]);

        $request = Request::create('/api/employee/tickets', 'GET');
        $request->headers->set('Authorization', "Bearer {$token}");

        $response = $middleware->handle($request, function ($req) {
            return new Response('OK', 200);
        });

        $this->assertEquals(200, $response->getStatusCode());
        $employee = Employee::where('email', 'admin@example.com')->first();
        $this->assertNotNull($employee);
        $this->assertNull($employee->branch);
    }

    public function test_verify_employee_jwt_allows_existing_operational_staff_with_null_branch(): void
    {
        // Pre-create existing employee in DB with null branch
        $legacyStaff = Employee::create([
            'emp_id' => 99984,
            'first_name' => 'Legacy',
            'last_name' => 'Agent',
            'email' => 'legacy_agent@example.com',
            'role' => 'customer_service',
            'department' => 'Support',
            'is_active' => true,
            'password_hash' => 'secret',
            'branch' => null,
            'branch_id' => null,
        ]);

        $middleware = new VerifyEmployeeJwt();
        $token = $this->generateJwt([
            'sub' => $legacyStaff->emp_id,
            'id' => $legacyStaff->emp_id,
            'email' => $legacyStaff->email,
            'role' => 'customer_service',
            'branch' => null,
            'branch_id' => null,
        ]);

        $request = Request::create('/api/employee/tickets', 'GET');
        $request->headers->set('Authorization', "Bearer {$token}");

        $response = $middleware->handle($request, function ($req) {
            return new Response('OK', 200);
        });

        $this->assertEquals(200, $response->getStatusCode());
    }

    public function test_verify_employee_jwt_rejects_new_operational_staff_with_null_branch(): void
    {
        // New email not existing in database
        $middleware = new VerifyEmployeeJwt();
        $token = $this->generateJwt([
            'sub' => 99985,
            'id' => 99985,
            'email' => 'new_agent_no_branch@example.com',
            'role' => 'customer_service',
            'branch' => null,
            'branch_id' => null,
        ]);

        $request = Request::create('/api/employee/tickets', 'GET');
        $request->headers->set('Authorization', "Bearer {$token}");

        $response = $middleware->handle($request, function ($req) {
            return new Response('OK', 200);
        });

        $this->assertEquals(422, $response->getStatusCode());
        $content = json_decode($response->getContent(), true);
        $this->assertEquals('BRANCH_REQUIRED_FOR_NEW_ACCOUNT', $content['error_code']);
    }

    public function test_verify_employee_jwt_accepts_new_operational_staff_with_valid_branch(): void
    {
        $branch = Branch::first();

        $middleware = new VerifyEmployeeJwt();
        $token = $this->generateJwt([
            'sub' => 99986,
            'id' => 99986,
            'email' => 'new_agent_with_branch@example.com',
            'role' => 'service',
            'branch' => $branch->name,
            'branch_id' => $branch->id,
        ]);

        $request = Request::create('/api/employee/tickets', 'GET');
        $request->headers->set('Authorization', "Bearer {$token}");

        $response = $middleware->handle($request, function ($req) {
            return new Response('OK', 200);
        });

        $this->assertEquals(200, $response->getStatusCode());
        $employee = Employee::where('email', 'new_agent_with_branch@example.com')->first();
        $this->assertNotNull($employee);
        $this->assertEquals($branch->name, $employee->branch);
        $this->assertEquals($branch->id, $employee->branch_id);
    }

    public function test_verify_employee_jwt_fetches_branch_from_auth_service_when_missing_from_jwt(): void
    {
        // Auth Module numbers branches independently: Auth id 9912 must resolve to the LOCAL row by name.
        Branch::updateOrInsert(
            ['code' => 'TEST_MKT'],
            [
                'slug' => 'test-makati-branch',
                'name' => 'Test Makati Branch',
                'region' => 'NCR',
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
        $localBranch = Branch::where('code', 'TEST_MKT')->first();
        // The /api/internal/users/71 stub (setUp) answers with Auth branch id 9912 named "Test Makati Branch".

        $middleware = new VerifyEmployeeJwt();
        $token = $this->generateJwt([
            'sub' => 71,
            'id' => 71,
            'email' => 'slosinada@gmail.com',
            'role' => 'Engineer',
            'department' => 'Service',
            'first_name' => 'Jasmine',
            'last_name' => 'Aninion',
        ]);

        $request = Request::create('/api/employee/tickets', 'GET');
        $request->headers->set('Authorization', "Bearer {$token}");

        $response = $middleware->handle($request, function ($req) {
            return new Response('OK', 200);
        });

        $this->assertEquals(200, $response->getStatusCode(), (string) $response->getContent());
        $employee = Employee::where('email', 'slosinada@gmail.com')->first();
        $this->assertNotNull($employee);
        $this->assertEquals('Test Makati Branch', $employee->branch);
        $this->assertEquals($localBranch->id, $employee->branch_id);
    }

    public function test_unknown_auth_branch_name_never_stores_the_foreign_branch_id(): void
    {
        $middleware = new VerifyEmployeeJwt();
        $token = $this->generateJwt([
            'sub' => 99970,
            'email' => 'foreign_branch_agent@example.com',
            'role' => 'Engineer',
            'department' => 'Service',
            'branch' => 'Branch Unknown To Ticketing',
            'branch_id' => 9913,
        ]);

        $request = Request::create('/api/employee/tickets', 'GET');
        $request->headers->set('Authorization', "Bearer {$token}");

        $response = $middleware->handle($request, fn () => new Response('OK', 200));

        $this->assertEquals(200, $response->getStatusCode());
        $employee = Employee::where('email', 'foreign_branch_agent@example.com')->first();
        $this->assertNotNull($employee);
        $this->assertEquals('Branch Unknown To Ticketing', $employee->branch);
        $this->assertNotEquals(9913, $employee->branch_id);
    }

    /**
     * Auth Module "IT Admin" is the Ticketing superadmin; "Branch Admin" is the branch-scoped admin.
     * The email address grants nothing: superadmin@example.com with role Branch Admin is an admin.
     */
    public function test_auth_roles_map_to_ticketing_roles_without_email_privileges(): void
    {
        $cases = [
            ['admin@example.com', 'IT Admin', 'superadmin'],
            ['superadmin@example.com', 'Branch Admin', 'admin'],
        ];

        foreach ($cases as [$email, $authRole, $expectedRole]) {
            Employee::where('email', $email)->delete();

            $middleware = new VerifyEmployeeJwt();
            $token = $this->generateJwt([
                'sub' => crc32($email),
                'email' => $email,
                'role' => $authRole,
                'department' => 'IT',
                'branch' => 'Cebu Testing Branch',
            ]);

            $request = Request::create('/api/employee/tickets', 'GET');
            $request->headers->set('Authorization', "Bearer {$token}");

            $response = $middleware->handle($request, fn () => new Response('OK', 200));

            $this->assertEquals(200, $response->getStatusCode(), "{$email} ({$authRole})");
            $employee = Employee::where('email', $email)->first();
            $this->assertNotNull($employee);
            $this->assertEquals($expectedRole, $employee->role, "{$email} ({$authRole})");
        }
    }
}
