<?php

namespace App\Http\Controllers;

use App\Models\Client;
use App\Models\Employee;
use Illuminate\Support\Facades\Cache;
use Illuminate\Http\Request;
use App\Services\AuthService;
use Illuminate\Support\Str;
use App\Models\RefreshToken;
use Illuminate\Support\Facades\Log;

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

        // Set httpOnly refresh cookie
        if (!empty($result['refresh_token'])) {
            $minutes = 60 * 24 * 14; // 14 days
            $secure = config('app.env') !== 'local';
            $resp->withCookie(cookie('refresh_token', $result['refresh_token'], $minutes, '/', null, $secure, true, false, 'Lax'));
        }

        return $resp;
    }

    public function employeeStatuses(Request $request)
    {
        $user = $request->user();

        if (!$user instanceof Employee || !in_array($user->role, ['customer service', 'head of cs', 'head of customer service', 'cs'])) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $query = Employee::query()
            ->where('is_active', true)
            ->whereNotIn('role', ['customer service', 'head of cs', 'head of customer service', 'cs'])
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

            return [
                'id' => $employee->emp_id,
                'emp_id' => $employee->emp_id,
                'email' => $employee->email,
                'name' => trim($employee->first_name . ' ' . $employee->last_name),
                'first_name' => $employee->first_name,
                'last_name' => $employee->last_name,
                'role' => $employee->role,
                'department' => $employee->department,
                'is_active' => (bool) $employee->is_active,
                'presence' => \App\Support\Presence::state((bool) $employee->is_active, $employee->last_seen_at ?: data_get($presence, 'last_seen_at')),
                'last_seen_at' => ($employee->last_seen_at ?: data_get($presence, 'last_seen_at')) ? \Carbon\Carbon::parse($employee->last_seen_at ?: data_get($presence, 'last_seen_at'))->toISOString() : null,
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

        if (!$rt || ($rt->expires_at && $rt->expires_at->isPast())) {
            return response()->json(['message' => 'Invalid or expired refresh token'], 401);
        }

        $client = $rt->client;
        $employee = $rt->employee;
        if (!$client && !$employee) {
            return response()->json(['message' => 'Client not found'], 401);
        }

        $user = $client ?: $employee;

        // issue new access token
        $accessToken = $user->createToken($user instanceof Employee ? 'employee' : 'client')->accessToken;

        // rotate refresh token
        $rawNew = Str::random(80);
        $hashNew = hash('sha256', $rawNew);
        $rt->token_hash = $hashNew;
        $rt->expires_at = now()->addDays(14);
        $rt->save();

        $minutes = 60 * 24 * 14;
        $secure = config('app.env') !== 'local';

        $resp = response()->json([
            'token' => $accessToken,
            'user' => $user,
            'is_first_login' => $user instanceof Employee
                ? $user->password_change_at === null
                : optional($user->credential)->password_change_at === null,
        ], 200);
        $resp->withCookie(cookie('refresh_token', $rawNew, $minutes, '/', null, $secure, true, false, 'Lax'));
        return $resp;
    }

    public function me(Request $request)
    {
        $user = $request->user();
        $isFirstLogin = false;

        if ($user) {
            if ($user instanceof Employee) {
                $isFirstLogin = $user->password_change_at === null;
            } else {
                $isFirstLogin = \Illuminate\Support\Facades\DB::table('clients_credentials')
                    ->where('client_id', $user->id)
                    ->whereNull('password_change_at')
                    ->exists();
            }
        }

        return response()->json([
            'user' => $user,
            'is_first_login' => $isFirstLogin,
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
        ];

        $request->validate($rules);

        $result = $this->authService->changePassword(
            $user,
            $request->current_password,
            $request->new_password,
            null // OTP flow disabled
        );

        return response()->json([
            'message' => $result['message'],
        ], $result['success'] ? 200 : 422);
    }

    public function logout(Request $request)
    {
        $rawRefresh = $request->cookie('refresh_token');
        if ($rawRefresh) {
            RefreshToken::where('token_hash', hash('sha256', $rawRefresh))->delete();
        }

        $user = $request->user();

        if ($user) {
            if ($user instanceof Employee) {
                $this->authService->logoutEmployee($user);
            }

            $user->tokens()->delete();
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

        // clear refresh cookie
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

        // Only dispatch when the employee was not already Online, so a steady heartbeat does not spam the channel.
        $wasOffline = !\App\Support\Presence::isOnline($user->last_seen_at);

        // Heartbeat records presence only; it never changes the is_active account flag.
        $user->last_seen_at = now();
        $user->save();

        if ($wasOffline) {
            \App\Events\EmployeeStatusChanged::dispatch($user->refresh());
        }

        return response()->json([
            'is_active' => (bool) $user->is_active,
            'presence' => \App\Support\Presence::ONLINE,
            'last_seen_at' => $user->last_seen_at->toISOString(),
        ]);
    }
}