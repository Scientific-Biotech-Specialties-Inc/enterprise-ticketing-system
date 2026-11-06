<?php

namespace App\Http\Controllers;

use App\Models\Client;
use App\Models\Employee;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Http\Request;
use App\Services\AuthService;
use Illuminate\Support\Str;
use App\Models\RefreshToken;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use App\Services\SystemAlertDispatcher;

class AuthController extends Controller
{
    protected $authService;

    public function __construct(AuthService $authService)
    {
        $this->authService = $authService;
    }

    public function getEncryptionKey()
    {
        $config = [
            'private_key_bits' => 2048,
            'private_key_type' => OPENSSL_KEYTYPE_RSA,
        ];

        // Create the keypair
        $res = openssl_pkey_new($config);
        
        if (!$res) {
            return response()->json(['message' => 'Failed to generate encryption key'], 500);
        }

        // Extract private key
        openssl_pkey_export($res, $privateKey);

        // Extract public key
        $publicKey = openssl_pkey_get_details($res)['key'];

        $keyId = (string) Str::uuid();

        // Store private key in cache for 5 minutes
        Cache::put("rsa_key_{$keyId}", $privateKey, now()->addMinutes(5));

        return response()->json([
            'public_key' => $publicKey,
            'key_id' => $keyId
        ]);
    }

    public function login(Request $request)
    {
        Log::info('AuthController.login:entered');

        $request->validate([
            'email' => 'required|email',
            'password' => 'required|string',
            'mode' => 'nullable|in:customer,employee',
        ]);

        Log::info('AuthController.login:after_validation');

        if ($request->input('mode', 'customer') === 'employee') {
            return response()->json([
                'message' => 'Built-in employee login is disabled. Please use SSO.',
                'user' => null,
                'token' => null,
                'is_first_login' => false,
            ], 401);
        }

        $result = $this->authService->login(
            $request->email,
            $request->password,
            $request->input('mode', 'customer')
        );

        // Return 401 on failed authentication
        if (!$result['success']) {
            return response()->json([
                'message' => $result['message'],
                'user' => null,
                'token' => null,
                'is_first_login' => false,
                'remaining_attempts' => $result['remaining_attempts'] ?? null,
                'locked_until' => $result['locked_until'] ?? null,
            ], 401);
        }

        // System status check: if Under Maintenance, reject non-superadmin authenticated users
        try {
            $systemStatus = Cache::remember('system:config:status', 15, function () {
                $configUrl = env('CONFIGURATION_SERVICE_URL', 'http://configuration-service:8000');
                $response = \Illuminate\Support\Facades\Http::timeout(2)->get("{$configUrl}/api/ticket-configurations/system-status");
                if ($response->successful()) {
                    $data = $response->json();
                    return $data['value']['status'] ?? $data['status'] ?? 'Operational';
                }
                return 'Operational';
            });

            if ($systemStatus === 'Under Maintenance') {
                $authUser = $result['user'] ?? null;
                $isSuperAdmin = false;
                if ($authUser instanceof Employee && strtolower(str_replace(' ', '', $authUser->role ?? '')) === 'superadmin') {
                    $isSuperAdmin = true;
                }

                if (!$isSuperAdmin) {
                    return response()->json([
                        'message' => 'The system is currently undergoing scheduled maintenance. Regular access is temporarily suspended. Please try again later.',
                        'maintenance' => true,
                    ], 503);
                }
            }
        } catch (\Throwable $e) {
            Log::warning('System status maintenance check failed: ' . $e->getMessage());
        }

        $isFirstLogin = false;
        if ($result['user']) {
            if ($result['user'] instanceof Employee) {
                $isFirstLogin = $result['user']->password_change_at === null;
            } else {
                $isFirstLogin = \Illuminate\Support\Facades\DB::table('clients_credentials')
                    ->where('client_id', $result['user']->id)
                    ->whereNull('password_change_at')
                    ->exists();
            }
        }

        // Return 200 with user and token on success
        $resp = response()->json([
            'message' => $result['message'],
            'user' => $result['user'],
            'token' => $result['token'],
            'is_first_login' => $isFirstLogin,
        ], 200);

        // Set httpOnly refresh cookie scoped to customer API namespace
        if (!empty($result['refresh_token'])) {
            $minutes = 60 * 24 * 14; // 14 days
            $secure = config('app.env') !== 'local';
            $cookiePath = '/api/ticketing/customer';
            $resp->withCookie(cookie('refresh_token', $result['refresh_token'], $minutes, $cookiePath, null, $secure, true, false, 'Lax'));
        }

        return $resp;
    }

    public static function autoSyncWithAuthModule(): void
    {
        if (Cache::has('employees_synced_lock')) {
            return;
        }

        Cache::put('employees_synced_lock', true, 60);

        try {
            $authUrl = env('AUTH_SERVICE_INTERNAL_URL', 'http://auth-service:8000');
            $secret = env('CMS_INTERNAL_SECRET', 'cms-internal-secret-key-2026');

            $resp = Http::timeout(3)
                ->withHeaders(['X-Internal-Secret' => $secret])
                ->get("{$authUrl}/api/internal/users-by-roles", [
                    'roles' => 'Engineer,Manager,Employee,Supervisor',
                ]);

            if (!$resp->successful()) {
                return;
            }

            $authUsers = $resp->json('data') ?? [];
            if (empty($authUsers)) {
                return;
            }

            foreach ($authUsers as $u) {
                $email = strtolower(trim((string) ($u['email'] ?? '')));
                if (empty($email)) continue;

                $dept = trim((string) ($u['department'] ?? 'Service'));
                $roleName = trim((string) ($u['role'] ?? 'Employee'));
                $isManager = (stripos($roleName, 'manager') !== false);
                $isAdmin = (stripos($roleName, 'admin') !== false);
                $isEngineer = (stripos($roleName, 'engineer') !== false || stripos($roleName, 'supervisor') !== false);

                if ($isAdmin) {
                    $posLevel = 'Admin';
                    $role = 'admin';
                    $techRole = $roleName;
                } elseif ($isManager) {
                    $posLevel = 'Manager';
                    $role = ($dept === 'Customer Service') ? 'customer service' : 'service';
                    $techRole = $dept . ' Manager';
                } elseif ($isEngineer || strcasecmp($dept, 'Service') === 0) {
                    $posLevel = 'Engineer';
                    $role = 'service';
                    $techRole = 'Engineer';
                } elseif (strcasecmp($dept, 'IT') === 0) {
                    $posLevel = 'Employee';
                    $role = 'service';
                    $techRole = 'Employee';
                } elseif ($dept === 'Customer Service') {
                    $posLevel = 'Employee';
                    $role = 'customer service';
                    $techRole = 'Employee';
                } else {
                    $posLevel = 'Employee';
                    $role = 'service';
                    $techRole = 'Employee';
                }

                $branch = 'Main Branch';
                $branchId = 1;
                $branchName = $u['branch'] ?? ($u['branch_details']['name'] ?? '');
                if (!empty($branchName) && stripos($branchName, 'north') !== false) {
                    $branch = 'North Luzon Hub';
                    $branchId = 2;
                }

                $existing = DB::table('employees')->where('email', $email)->first();

                if ($existing) {
                    DB::table('employees')->where('emp_id', $existing->emp_id)->update([
                        'first_name' => $u['first_name'] ?: $existing->first_name,
                        'last_name' => $u['last_name'] ?: $existing->last_name,
                        'department' => $dept,
                        'position_level' => $posLevel,
                        'role' => $role,
                        'technical_role' => $techRole,
                        'branch' => $branch,
                        'branch_id' => $branchId,
                        'is_active' => (int) ($u['is_active'] ?? 1),
                        'last_synced_at' => now(),
                    ]);
                } else {
                    $newId = (isset($u['id']) && (int)$u['id'] > 0) ? (int)$u['id'] : ((int)DB::table('employees')->max('emp_id') + 1);
                    DB::table('employees')->insert([
                        'emp_id' => $newId,
                        'email' => $email,
                        'phone_number' => $u['phone'] ?? null,
                        'password_hash' => '',
                        'first_name' => $u['first_name'] ?? 'Staff',
                        'last_name' => $u['last_name'] ?? '',
                        'department' => $dept,
                        'position_level' => $posLevel,
                        'role' => $role,
                        'technical_role' => $techRole,
                        'branch' => $branch,
                        'branch_id' => $branchId,
                        'is_active' => (int) ($u['is_active'] ?? 1),
                        'failed_login_count' => 0,
                        'last_synced_at' => now(),
                        'password_change_at' => now(),
                    ]);
                }
            }
        } catch (\Throwable $e) {
            Log::warning('Customer service auto-sync with auth module failed: ' . $e->getMessage());
        }
    }

    public function employeeStatuses(Request $request)
    {
        self::autoSyncWithAuthModule();
        $user = $request->user();

        if (!$user instanceof Employee || !in_array($user->role, ['customer service', 'head of cs', 'head of customer service', 'cs'])) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $query = Employee::query()
            ->where('is_active', true)
            ->where('role', '!=', 'customer service')
            ->whereRaw('LOWER(COALESCE(role, "")) NOT IN (?, ?, ?, ?, ?)', ['superadmin', 'super admin', 'admin', 'system administrator', 'system admin'])
            ->whereRaw('LOWER(COALESCE(department, "")) NOT IN (?, ?)', ['admin', 'super admin'])
            ->whereRaw('LOWER(COALESCE(email, "")) NOT LIKE ?', ['%admin%'])
            ->whereRaw('LOWER(CONCAT(COALESCE(first_name, ""), " ", COALESCE(last_name, ""))) NOT LIKE ?', ['%administrator%']);

        if ($request->has('department') && !empty($request->query('department'))) {
            $query->where('department', $request->query('department'));
        }

        $employees = $query->orderBy('first_name')->get();

        $statusKeys = $employees->map(fn($emp) => 'employee:presence:' . $emp->emp_id)->all();
        $statusPresences = $employees->isNotEmpty() 
            ? Cache::store('redis')->many($statusKeys) 
            : [];

        $statuses = $employees->map(function (Employee $employee) use ($statusPresences) {
            $presenceKey = 'employee:presence:' . $employee->emp_id;
            $presence = $statusPresences[$presenceKey] ?? [];

            $role = $employee->role ?? 'service';
            $dept = $employee->department ?? 'Service';
            $defaultPos = (strcasecmp($dept, 'Service') === 0) ? 'Engineer' : 'Employee';
            $posLevel = $employee->position_level;
            if (empty($posLevel) || in_array(strtolower((string)$posLevel), ['senior', 'mid', 'junior'])) {
                $posLevel = (stripos($role, 'manager') !== false) ? 'Manager' : $defaultPos;
            }
            $techRole = $employee->technical_role;
            if (empty($techRole) || in_array(strtolower((string)$techRole), ['specialist', 'technician', 'service technician', 'it support specialist'])) {
                $techRole = $posLevel;
            }

            $isActive = (bool) data_get($presence, 'is_active', false);
            $availability = $isActive ? 'Available' : 'Unavailable';

            return [
                'id' => $employee->emp_id,
                'emp_id' => $employee->emp_id,
                'email' => $employee->email,
                'name' => trim($employee->first_name . ' ' . $employee->last_name),
                'first_name' => $employee->first_name,
                'last_name' => $employee->last_name,
                'role' => $role,
                'technical_role' => $techRole,
                'position_level' => $posLevel,
                'branch' => $employee->branch ?? 'Main Branch',
                'department' => $employee->department,
                'is_active' => $isActive,
                'availability' => $availability,
                'availability_status' => $availability,
                'last_seen_at' => data_get($presence, 'last_seen_at', optional($employee->last_seen_at)->toISOString()),
            ];
        });

        return response()->json([
            'employees' => $statuses,
        ]);
    }

    public function refresh(Request $request)
    {
        $raw = $request->cookie('refresh_token');
        if (!$raw) {
            return response()->json(['message' => 'No refresh token'], 401);
        }

        $hash = hash('sha256', $raw);
        $rt = \App\Models\RefreshToken::where('token_hash', $hash)->first();

        if (!$rt) {
            return response()->json(['message' => 'Invalid or expired refresh token'], 401);
        }

        // Token reuse detection (AC-5): If presented token is already revoked, purge all tokens & alert
        if ($rt->is_revoked) {
            Log::warning('Security breach detected: Revoked refresh token reuse attempt', [
                'token_id' => $rt->id,
                'client_id' => $rt->client_id,
                'employee_id' => $rt->employee_id,
                'ip' => $request->ip(),
                'user_agent' => $request->userAgent(),
            ]);

            SystemAlertDispatcher::dispatchIssue(
                category: 'token_reuse',
                severity: 'critical',
                service: 'customer-service',
                title: 'Refresh Token Reuse Detected',
                message: 'A revoked refresh token was replayed. All active sessions have been revoked for containment.',
                context: [
                    'client_id' => $rt->client_id,
                    'employee_id' => $rt->employee_id,
                    'token_id' => $rt->id,
                ],
                ip: $request->ip(),
                userAgent: $request->userAgent()
            );

            // Invalidate all active sessions, access tokens, and refresh tokens for this account
            if ($rt->client_id) {
                if ($rt->client) {
                    $rt->client->tokens()->delete();
                } else {
                    DB::table('oauth_access_tokens')->where('user_id', $rt->client_id)->delete();
                }
                RefreshToken::where('client_id', $rt->client_id)->delete();
            } elseif ($rt->employee_id) {
                if ($rt->employee) {
                    $rt->employee->tokens()->delete();
                } else {
                    DB::table('oauth_access_tokens')->where('user_id', $rt->employee_id)->delete();
                }
                RefreshToken::where('employee_id', $rt->employee_id)->delete();
            }

            $resp = response()->json([
                'message' => 'Token reuse detected. All active sessions have been revoked.',
            ], 401);

            $resp->withCookie(cookie()->forget('refresh_token', '/api/ticketing/customer'));
            $resp->withCookie(cookie()->forget('refresh_token', '/'));
            return $resp;
        }

        if ($rt->expires_at && $rt->expires_at->isPast()) {
            return response()->json(['message' => 'Invalid or expired refresh token'], 401);
        }

        $client = $rt->client;
        $employee = $rt->employee;
        if (!$client && !$employee) {
            return response()->json(['message' => 'Client not found'], 401);
        }

        $user = $client ?: $employee;

        // Rotate refresh token atomically (AC-4)
        $rawNew = Str::random(80);
        $hashNew = hash('sha256', $rawNew);

        DB::transaction(function () use ($rt, $hashNew) {
            // Mark current token as revoked
            $rt->update([
                'is_revoked' => true,
            ]);

            // Create new active child token
            RefreshToken::create([
                'client_id' => $rt->client_id,
                'employee_id' => $rt->employee_id,
                'token_hash' => $hashNew,
                'is_revoked' => false,
                'expires_at' => now()->addDays(14),
            ]);
        });

        // Issue new access token
        $accessToken = $user->createToken($user instanceof Employee ? 'employee' : 'client')->accessToken;

        $minutes = 60 * 24 * 14;
        $secure = config('app.env') !== 'local';
        $cookiePath = '/api/ticketing/customer';

        $resp = response()->json([
            'token' => $accessToken,
            'user' => $user,
            'is_first_login' => $user instanceof Employee
                ? $user->password_change_at === null
                : optional($user->credential)->password_change_at === null,
        ], 200);

        $resp->withCookie(cookie('refresh_token', $rawNew, $minutes, $cookiePath, null, $secure, true, false, 'Lax'));
        return $resp;
    }

    public function me(Request $request)
    {
        $user = $request->user();
        $isFirstLogin = false;

        if ($user) {
            if ($user instanceof Employee) {
                $isFirstLogin = $user->password_change_at === null;
            } elseif ($user instanceof \Ticketing\Auth\Dto\AuthenticatedUserDto) {
                $isFirstLogin = false;
            } elseif (isset($user->id)) {
                $isFirstLogin = \Illuminate\Support\Facades\DB::table('clients_credentials')
                    ->where('client_id', $user->id)
                    ->whereNull('password_change_at')
                    ->exists();
            }
        }

        $token = null;
        $authHeader = $request->header('Authorization');
        if ($authHeader && str_starts_with($authHeader, 'Bearer ')) {
            $token = substr($authHeader, 7);
        } elseif ($request->cookie('access_token')) {
            $token = $request->cookie('access_token');
        }

        return response()->json([
            'user' => $user,
            'is_first_login' => $isFirstLogin,
            'token' => $token,
        ]);
    }

    public function forgotPassword(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
        ]);

        $result = $this->authService->requestPasswordResetOtp($request->email);

        if (!$result['success']) {
            return response()->json([
                'message' => $result['message'],
            ], 500);
        }

        return response()->json([
            'message' => $result['message'],
            'expires_at' => $result['expires_at'] ?? null,
        ], 200);
    }

    public function verifyForgotPasswordOtp(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
            'otp' => 'required|digits:6',
        ]);

        $result = $this->authService->verifyPasswordResetOtp($request->email, $request->otp);

        return response()->json([
            'message' => $result['message'],
            'remaining_attempts' => $result['remaining_attempts'] ?? null,
        ], $result['success'] ? 200 : 422);
    }

    public function resetForgotPassword(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
            'otp' => 'required|digits:6',
            'password' => [
                'required',
                'string',
                'confirmed',
                'min:12',
                'regex:/[A-Z]/',
                'regex:/[0-9]/',
                'regex:/[^A-Za-z0-9]/',
            ],
        ]);

        $result = $this->authService->resetPasswordWithOtp($request->email, $request->otp, $request->password);

        return response()->json([
            'message' => $result['message'],
        ], $result['success'] ? 200 : 422);
    }

    public function changePassword(Request $request)
    {
        $user = $request->user();
        $isFirstLogin = $user instanceof Employee
            ? $user->password_change_at === null
            : optional($user->credential)->password_change_at === null;

        $rules = [
            'current_password' => 'required|string',
            'new_password' => [
                'required',
                'string',
                'confirmed',
                'min:12',
                'regex:/[A-Z]/',
                'regex:/[0-9]/',
                'regex:/[^A-Za-z0-9]/',
            ],
            'otp' => 'nullable|string',
        ];

        $request->validate($rules);

        $result = $this->authService->changePassword(
            $user,
            $request->current_password,
            $request->new_password,
            $request->otp ?? null
        );

        return response()->json([
            'message' => $result['message'],
        ], $result['success'] ? 200 : 422);
    }

    public function logout(Request $request)
    {
        $user = $request->user() ?: Auth::guard('api')->user();

        $rawRefresh = $request->cookie('refresh_token');
        if ($rawRefresh) {
            $hash = hash('sha256', $rawRefresh);
            $rt = RefreshToken::where('token_hash', $hash)->first();
            if ($rt && !$user) {
                $user = $rt->client ?: $rt->employee;
            }
            RefreshToken::where('token_hash', $hash)->delete();
        }

        if ($user) {
            if ($user instanceof Employee) {
                $this->authService->logoutEmployee($user);
            }

            if (method_exists($user, 'tokens')) {
                $user->tokens()->delete();
            }
            // remove refresh tokens
            if ($user instanceof Employee) {
                RefreshToken::where('employee_id', $user->emp_id)->delete();
            } else {
                RefreshToken::where('client_id', $user->id)->delete();
            }
        }

        if ($request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        $resp = response()->json([
            'message' => 'Logged out successfully',
        ]);

        $secure = config('app.env') !== 'local';
        // Explicitly expire and forget refresh cookie across all scopes
        $resp->withCookie(cookie('refresh_token', '', -2628000, '/api/ticketing/customer', null, $secure, true, false, 'Lax'));
        $resp->withCookie(cookie('refresh_token', '', -2628000, '/customer-ticketing', null, $secure, true, false, 'Lax'));
        $resp->withCookie(cookie('refresh_token', '', -2628000, '/', null, $secure, true, false, 'Lax'));
        $resp->withCookie(cookie()->forget('refresh_token', '/api/ticketing/customer'));
        $resp->withCookie(cookie()->forget('refresh_token', '/customer-ticketing'));
        $resp->withCookie(cookie()->forget('refresh_token', '/'));
        $resp->withCookie(cookie()->forget('refresh_token'));

        return $resp;
    }

    public function heartbeat(Request $request)
    {
        $user = $request->user();
        if (!$user || !($user instanceof Employee)) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $redisKey = 'employee:presence:' . $user->emp_id;
        $presence = [
            'is_active' => true,
            'last_seen_at' => now()->toISOString(),
        ];

        Cache::store('redis')->put($redisKey, $presence, 60);

        $wasInactive = !$user->is_active;

        $user->last_seen_at = now();
        $user->is_active = true;
        $user->save();

        if ($wasInactive) {
            \App\Events\EmployeeStatusChanged::dispatch($user->refresh());
        }

        return response()->json([
            'is_active' => true,
            'last_seen_at' => $user->last_seen_at->toISOString(),
        ]);
    }

    public function resendFirstLoginOtp(Request $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $cooldownKey = "first_login_otp_cooldown:{$user->id}";
        if (Cache::has($cooldownKey)) {
            $remaining = Cache::get($cooldownKey) - time();
            if ($remaining > 0) {
                return response()->json([
                    'message' => "Please wait {$remaining} seconds before requesting another code.",
                    'retry_after' => $remaining,
                ], 429);
            }
        }

        $email = $user->email;
        $name = $user instanceof Employee ? trim($user->first_name . ' ' . $user->last_name) : ($user->client_name ?? 'Customer');
        $success = $this->authService->sendFirstLoginOtp($email, $name);
        if (!$success) {
            return response()->json([
                'message' => 'Unable to send OTP email. Please try again.',
            ], 500);
        }

        Cache::put($cooldownKey, time() + 60, 60);
        Log::info("First-login OTP resent for user {$email}");

        return response()->json([
            'message' => 'A new verification code has been sent to your email.',
            'cooldown_seconds' => 60,
        ], 200);
    }

    public function verifyFirstLoginOtp(Request $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $request->validate([
            'otp' => 'required|digits:6',
        ]);

        $result = $this->authService->verifyPasswordResetOtp($user->email, $request->otp);

        return response()->json([
            'message' => $result['message'],
            'remaining_attempts' => $result['remaining_attempts'] ?? null,
        ], $result['success'] ? 200 : 422);
    }

    public function getProfile(Request $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        if ($user instanceof Employee) {
            return response()->json([
                'user' => [
                    'id' => $user->emp_id,
                    'emp_id' => $user->emp_id,
                    'email' => $user->email,
                    'first_name' => $user->first_name,
                    'last_name' => $user->last_name,
                    'name' => trim($user->first_name . ' ' . $user->last_name),
                    'role' => $user->role,
                    'department' => $user->department,
                    'is_readonly_cms' => true,
                    'created_at' => $user->created_at,
                    'updated_at' => $user->updated_at,
                ],
                'is_first_login' => $user->password_change_at === null,
            ]);
        }

        $parts = explode(' ', $user->client_name ?? '');
        $firstName = $parts[0] ?? '';
        $lastName = implode(' ', array_slice($parts, 1));

        return response()->json([
            'user' => [
                'id' => $user->id,
                'client_name' => $user->client_name,
                'first_name' => $firstName,
                'last_name' => $lastName,
                'name' => $user->client_name,
                'email' => $user->email,
                'contact_number' => $user->contact_number,
                'phone' => $user->contact_number,
                'address' => $user->address,
                'status' => (bool)$user->status,
                'role' => 'customer',
                'is_readonly_cms' => true,
                'created_at' => $user->created_at,
                'updated_at' => $user->updated_at,
            ],
            'is_first_login' => optional($user->credential)->password_change_at === null,
        ]);
    }

    public function updateProfile(Request $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        if ($user instanceof Employee) {
            return response()->json(['message' => 'SSO users cannot edit profile details locally.'], 403);
        }

        $request->validate([
            'firstName' => 'sometimes|nullable|string|max:255',
            'lastName' => 'sometimes|nullable|string|max:255',
            'name' => 'sometimes|nullable|string|max:255',
            'email' => 'required|string|email|max:255',
            'phone' => 'required|string|min:7|max:20|regex:/^[0-9+\-\s()]+$/',
            'address' => 'required|string|min:3|max:500',
        ], [
            'email.required' => 'Email address is required and cannot be empty.',
            'email.email' => 'Enter a valid email address.',
            'phone.required' => 'Phone number is required.',
            'phone.regex' => 'Enter a valid phone number.',
            'phone.min' => 'Phone number must be at least 7 characters.',
            'address.required' => 'Mailing / contact address is required.',
            'address.min' => 'Address must be at least 3 characters.',
        ]);

        $newEmail = strtolower(trim($request->email));

        // Enforce duplicate-email check
        $existing = Client::where('email', $newEmail)->where('id', '!=', $user->id)->first();
        if ($existing) {
            return response()->json([
                'error' => 'EMAIL_ALREADY_EXISTS',
                'message' => 'This email address is already associated with another account.',
            ], 409);
        }

        // Email change verification / confirmation
        $oldEmail = strtolower(trim($user->email));
        $emailChanged = ($newEmail !== $oldEmail);
        if ($emailChanged) {
            Log::info("Customer email change for client {$user->id} from {$oldEmail} to {$newEmail}");
        }

        if ($request->has('firstName') || $request->has('lastName')) {
            $firstName = $request->input('firstName', '');
            $lastName = $request->input('lastName', '');
            $user->client_name = trim("{$firstName} {$lastName}");
        } elseif ($request->filled('name')) {
            $user->client_name = trim($request->name);
        }

        $user->email = $newEmail;

        if ($request->has('phone')) {
            $user->contact_number = $request->phone ?? '';
        } elseif ($request->has('contact_number')) {
            $user->contact_number = $request->contact_number ?? '';
        }

        if ($request->has('address')) {
            $user->address = $request->address ?? '';
        }

        $user->save();

        Log::info("Customer profile updated for client ID {$user->id}", [
            'client_id' => $user->id,
            'email' => $user->email,
            'contact_number' => $user->contact_number,
            'address' => $user->address,
        ]);

        $parts = explode(' ', $user->client_name ?? '');
        $firstName = $parts[0] ?? '';
        $lastName = implode(' ', array_slice($parts, 1));

        return response()->json([
            'message' => 'Your profile has been updated',
            'user' => [
                'id' => $user->id,
                'client_name' => $user->client_name,
                'first_name' => $firstName,
                'last_name' => $lastName,
                'name' => $user->client_name,
                'email' => $user->email,
                'contact_number' => $user->contact_number,
                'phone' => $user->contact_number,
                'address' => $user->address,
                'status' => (bool)$user->status,
                'role' => 'customer',
                'is_readonly_cms' => true,
                'created_at' => $user->created_at,
                'updated_at' => $user->updated_at,
            ],
        ], 200);
    }

    public function getNotificationPreferences(Request $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $key = "client:notification_preferences:{$user->id}";
        try {
            $prefs = Cache::store('redis')->get($key);
        } catch (\Throwable $e) {
            $prefs = Cache::get($key);
        }
        if (!$prefs) {
            $prefs = [
                'in_app' => true,
                'email' => true,
            ];
        }

        return response()->json([
            'preferences' => $prefs,
            'in_app' => (bool) ($prefs['in_app'] ?? true),
            'email' => (bool) ($prefs['email'] ?? true),
        ], 200);
    }

    public function updateNotificationPreferences(Request $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $request->validate([
            'in_app' => 'required|boolean',
            'email' => 'required|boolean',
        ]);

        $inApp = $request->boolean('in_app');
        $email = $request->boolean('email');

        if (!$inApp && !$email) {
            return response()->json([
                'error' => 'AT_LEAST_ONE_CHANNEL_REQUIRED',
                'message' => 'At least one notification channel must stay enabled so you don\'t miss updates',
            ], 422);
        }

        $prefs = [
            'in_app' => $inApp,
            'email' => $email,
            'updated_at' => now()->toISOString(),
        ];

        $key = "client:notification_preferences:{$user->id}";
        try {
            Cache::store('redis')->put($key, $prefs, now()->addDays(365));
        } catch (\Throwable $e) {
            Cache::put($key, $prefs, 3600);
        }

        Log::info("Notification preferences updated for client ID {$user->id}", [
            'client_id' => $user->id,
            'preferences' => $prefs,
        ]);

        return response()->json([
            'message' => 'Notification preferences updated successfully',
            'preferences' => $prefs,
            'in_app' => $inApp,
            'email' => $email,
        ], 200);
    }
}