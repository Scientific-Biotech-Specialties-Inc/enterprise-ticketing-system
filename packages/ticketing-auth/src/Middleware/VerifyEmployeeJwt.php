<?php

namespace Ticketing\Auth\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Ticketing\Auth\Dto\AuthenticatedUserDto;
use Ticketing\Auth\Security\TokenRevocationChecker;

class VerifyEmployeeJwt
{
    /**
     * Handle an incoming request.
     *
     * @param  \Illuminate\Http\Request  $request
     * @param  \Closure  $next
     * @return mixed
     */
    public function handle(Request $request, Closure $next)
    {
        $token = null;
        $authHeader = $request->header('Authorization');
        if ($authHeader && str_starts_with($authHeader, 'Bearer ')) {
            $token = substr($authHeader, 7);
        } elseif ($request->cookie('access_token')) {
            $token = $request->cookie('access_token');
        }

        if (!$token) {
            Log::info('VerifyEmployeeJwt: Missing or invalid token format header: ' . ($authHeader ?: 'none'));
            return response()->json(['message' => 'Unauthorized: Missing or invalid token format'], 401);
        }

        $tokenHash = hash('sha256', $token);

        // 1. Safe Token Cache Check (Checks expiration and revocation before serving cached user)
        $cachedSession = Cache::get('sso_auth_cache:' . $tokenHash);
        if ($cachedSession && is_array($cachedSession)) {
            $exp = $cachedSession['exp'] ?? 0;
            $jti = $cachedSession['jti'] ?? null;

            if ($exp <= time()) {
                Cache::forget('sso_auth_cache:' . $tokenHash);
                return response()->json(['message' => 'Unauthorized: Token expired'], 401);
            }

            if ($jti && TokenRevocationChecker::isRevoked($jti)) {
                Cache::forget('sso_auth_cache:' . $tokenHash);
                Log::warning('VerifyEmployeeJwt: Cached token was revoked in Redis blacklist', ['jti' => $jti]);
                return response()->json(['message' => 'Unauthorized: Token has been revoked'], 401);
            }

            $user = $this->resolveCachedUser($cachedSession);
            if ($user) {
                Auth::setUser($user);
                $request->setUserResolver(function () use ($user) {
                    return $user;
                });
                return $next($request);
            }
        }

        // 2. Local environment development token bypass
        if (app()->environment('local') && $token === 'frontend-dev-token') {
            $user = $this->resolveDevUser();
            Auth::setUser($user);
            $request->setUserResolver(function () use ($user) {
                return $user;
            });
            Cache::put('sso_auth_cache:' . $tokenHash, [
                'jti' => 'frontend-dev-token',
                'exp' => time() + 7200,
                'user' => $user instanceof AuthenticatedUserDto ? $user->toArray() : [
                    'emp_id' => $user->emp_id ?? 1,
                    'email' => $user->email ?? 'superadmin@hospital.com',
                    'role' => 'superadmin',
                ],
                'emp_id' => $user->emp_id ?? 1,
            ], now()->addHours(2));
            return $next($request);
        }

        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            Log::info('VerifyEmployeeJwt: Token does not have 3 parts: ' . count($parts));
            return response()->json(['message' => 'Unauthorized: Invalid token format'], 401);
        }

        list($headerB64, $payloadB64, $sigB64) = $parts;

        $base64UrlDecode = function ($input) {
            $remainder = strlen($input) % 4;
            if ($remainder) {
                $padlen = 4 - $remainder;
                $input .= str_repeat('=', $padlen);
            }
            return base64_decode(strtr($input, '-_', '+/'));
        };

        // 3. Verify RS256 signature using central public key or remote verification
        $data = "$headerB64.$payloadB64";
        $signature = $base64UrlDecode($sigB64);

        $publicKey = null;
        $publicKeyPath = storage_path('auth-module-public.key');
        if (file_exists($publicKeyPath)) {
            $publicKey = file_get_contents($publicKeyPath);
        } elseif (!empty(env('AUTH_PUBLIC_KEY'))) {
            $rawKey = env('AUTH_PUBLIC_KEY');
            if (str_starts_with(trim($rawKey), '-----BEGIN')) {
                $publicKey = str_replace(['\r\n', '\n'], "\n", $rawKey);
            } elseif (base64_decode($rawKey, true) !== false && str_contains(base64_decode($rawKey), '-----BEGIN')) {
                $publicKey = base64_decode($rawKey);
            } else {
                $publicKey = $rawKey;
            }
        }

        $verified = false;
        if (!empty($publicKey)) {
            $res = openssl_verify($data, $signature, $publicKey, OPENSSL_ALGO_SHA256);
            if ($res === 1) {
                $verified = true;
            } else {
                Log::warning('VerifyEmployeeJwt: Local signature verification status: ' . $res);
            }
        }

        // If local public key verification was not successful, attempt remote verification via auth-service
        $remotePayload = null;
        if (!$verified) {
            $authUrl = env('AUTH_SERVICE_URL', env('CUSTOMER_SERVICE_URL', 'http://auth-service:8000'));
            $secret = env('INTERNAL_SERVICE_SECRET', env('INTERNAL_TOKEN', ''));
            if (!empty($authUrl) && !empty($secret)) {
                try {
                    $client = \Illuminate\Support\Facades\Http::timeout(5)
                        ->withHeaders([
                            'X-Internal-Secret' => $secret,
                            'Accept' => 'application/json',
                        ]);
                    $resp = $client->post("{$authUrl}/api/internal/verify-token", [
                        'token' => $token,
                    ]);
                    if ($resp->successful() && $resp->json('valid') === true) {
                        $remotePayload = $resp->json('user');
                        $verified = true;
                    }
                } catch (\Throwable $e) {
                    Log::warning('VerifyEmployeeJwt: Remote verification failed', ['error' => $e->getMessage()]);
                }
            }
        }

        if (!$verified) {
            Log::warning('VerifyEmployeeJwt: Signature verification failed (local and remote verify exhausted)');
            return response()->json(['message' => 'Unauthorized: Invalid signature'], 401);
        }

        // 4. Decode payload & verify expiry
        $payload = json_decode($base64UrlDecode($payloadB64), true);
        if (!$payload && $remotePayload) {
            $payload = $remotePayload;
        }
        if (!$payload) {
            Log::info('VerifyEmployeeJwt: Failed to decode token payload JSON');
            return response()->json(['message' => 'Unauthorized: Invalid token payload'], 401);
        }

        if ($remotePayload && is_array($remotePayload)) {
            $payload = array_merge($remotePayload, $payload);
        }

        if (!isset($payload['exp']) || time() >= $payload['exp']) {
            if (!isset($payload['exp']) && $remotePayload) {
                $payload['exp'] = time() + 7200;
            } else {
                Log::info('VerifyEmployeeJwt: Token expired. Expiry: ' . ($payload['exp'] ?? 'unset') . ', Current: ' . time());
                return response()->json(['message' => 'Unauthorized: Token expired'], 401);
            }
        }

        // 5. Verify Redis blacklist status
        $jti = $payload['jti'] ?? ($remotePayload ? 'central-' . ($payload['id'] ?? md5($token)) : null);
        if (!$jti) {
            Log::info('VerifyEmployeeJwt: Missing token ID (jti)');
            return response()->json(['message' => 'Unauthorized: Missing token ID (jti)'], 401);
        }

        if (TokenRevocationChecker::isRevoked($jti)) {
            Log::warning('VerifyEmployeeJwt: Token blacklisted', ['jti' => $jti]);
            return response()->json(['message' => 'Unauthorized: Token has been revoked'], 401);
        }

        // 6. Normalize role, department, and branch claims
        $email = $payload['email'] ?? null;
        if (!$email) {
            Log::info('VerifyEmployeeJwt: Missing email claim in token payload');
            return response()->json(['message' => 'Unauthorized: Missing email claim'], 401);
        }

        $payloadRole = $payload['role'] ?? '';
        $payloadDept = $payload['department'] ?? '';
        $normDept = strtolower($payloadDept);
        $normRole = strtolower($payloadRole);

        if (str_contains($normDept, 'customer service') || str_contains($normDept, 'customer support') || $normDept === 'cs' ||
            str_contains($normRole, 'customer service') || str_contains($normRole, 'customer-service') ||
            str_contains($normRole, 'head of cs') || str_contains($normRole, 'head of customer service') || $normRole === 'cs') {
            $mappedRole = 'customer service';
        } elseif ($normRole === 'superadmin' || $normRole === 'super admin' || $normDept === 'superadmin' || $normDept === 'super admin') {
            $mappedRole = 'superadmin';
        } elseif ($normRole === 'it admin' || $normRole === 'admin' || ($normDept === 'admin' && $normRole !== 'superadmin')) {
            $mappedRole = 'admin';
        } elseif (str_contains($normDept, 'service') || str_contains($normDept, 'engineer') ||
                  str_contains($normRole, 'service') || str_contains($normRole, 'engineer') || $normRole === 'employee') {
            $mappedRole = 'service';
        } else {
            $mappedRole = $payloadRole ?: 'service';
        }

        $payloadBranch = $payload['branch'] ?? $payload['branch_name'] ?? ($payload['branch_details']['name'] ?? null);
        $payloadBranchId = $payload['branch_id'] ?? ($payload['branch_details']['id'] ?? null);
        if ($payloadBranchId !== null && !is_numeric($payloadBranchId)) {
            $payloadBranch = $payloadBranch ?: (string) $payloadBranchId;
        }

        $isAdminOrSuperAdmin = in_array(strtolower($email), ['admin@example.com', 'superadmin@example.com'], true)
            || in_array($normRole, ['superadmin', 'super admin', 'admin', 'it admin'], true)
            || in_array($normDept, ['superadmin', 'super admin', 'admin'], true);

        if (!$isAdminOrSuperAdmin && empty($payloadBranch) && empty($payloadBranchId)) {
            $userId = $payload['sub'] ?? null;
            if ($userId) {
                try {
                    $authUrl = env('AUTH_SERVICE_URL', env('CUSTOMER_SERVICE_URL', 'http://auth-service:8000'));
                    $secret = env('INTERNAL_SERVICE_SECRET', env('INTERNAL_TOKEN', ''));
                    $client = \Illuminate\Support\Facades\Http::timeout(3);
                    if (!empty($secret)) {
                        $client = $client->withHeaders(['X-Internal-Secret' => $secret]);
                    }
                    $res = $client->get("{$authUrl}/api/internal/users/{$userId}");
                    if ($res->successful()) {
                        $userData = $res->json();
                        $payloadBranch = $userData['branch'] ?? ($userData['branch_details']['name'] ?? null);
                        $payloadBranchId = $userData['branch_id'] ?? ($userData['branch_details']['id'] ?? null);
                        if (!empty($userData['first_name']) && empty($payload['first_name'])) {
                            $payload['first_name'] = $userData['first_name'];
                        }
                        if (!empty($userData['last_name']) && empty($payload['last_name'])) {
                            $payload['last_name'] = $userData['last_name'];
                        }
                    }
                } catch (\Throwable $e) {
                    Log::warning('VerifyEmployeeJwt: Failed to query internal user branch from auth-service', ['error' => $e->getMessage()]);
                }
            }
        }

        $existingEmployee = class_exists('App\Models\Employee')
            ? \App\Models\Employee::where('email', $email)->first()
            : null;

        if (!$existingEmployee && !$isAdminOrSuperAdmin && empty($payloadBranch) && empty($payloadBranchId)) {
            Log::warning('VerifyEmployeeJwt: Branch required for new operational account', ['email' => $email, 'role' => $mappedRole]);
            return response()->json([
                'message' => 'Unprocessable Entity: Branch assignment is required for new operational accounts.',
                'error_code' => 'BRANCH_REQUIRED_FOR_NEW_ACCOUNT'
            ], 422);
        }

        $resolvedFirstName = trim((string) ($payload['first_name'] ?? ''));
        $resolvedLastName = trim((string) ($payload['last_name'] ?? ''));
        if ($resolvedFirstName === '' && !empty($payload['name'] ?? $payload['full_name'] ?? null)) {
            $parts = preg_split('/\s+/', trim((string) ($payload['name'] ?? $payload['full_name'])), 2);
            $resolvedFirstName = $parts[0] ?? '';
            $resolvedLastName = $parts[1] ?? '';
        }

        // 7. Resolve user entity or DTO without dynamic Schema queries
        $user = $this->resolveUserEntity($email, [
            'first_name' => $resolvedFirstName,
            'last_name' => $resolvedLastName,
            'role' => $mappedRole,
            'department' => $payloadDept,
            'branch' => $payloadBranch,
            'branch_id' => is_numeric($payloadBranchId) ? (int) $payloadBranchId : null,
            'jti' => $jti,
            'exp' => $payload['exp'],
        ]);

        // 8. Authenticate and cache
        Auth::setUser($user);
        $request->setUserResolver(function () use ($user) {
            return $user;
        });

        $ttlSeconds = min(7200, max(60, $payload['exp'] - time()));
        Cache::put('sso_auth_cache:' . $tokenHash, [
            'jti' => $jti,
            'exp' => $payload['exp'],
            'emp_id' => $user->emp_id ?? $user->id ?? null,
            'user' => $user instanceof AuthenticatedUserDto ? $user->toArray() : [
                'emp_id' => $user->emp_id ?? null,
                'id' => $user->id ?? $user->emp_id ?? null,
                'email' => $user->email,
                'first_name' => $user->first_name ?? $resolvedFirstName,
                'last_name' => $user->last_name ?? $resolvedLastName,
                'role' => $user->role ?? $mappedRole,
                'department' => $user->department ?? $payloadDept,
                'branch' => $user->branch ?? $payloadBranch,
                'branch_id' => $user->branch_id ?? (is_numeric($payloadBranchId) ? (int) $payloadBranchId : null),
                'jti' => $jti,
                'exp' => $payload['exp'],
            ],
        ], $ttlSeconds);

        return $next($request);
    }

    /**
     * Resolve cached session user into an Authenticatable model or DTO.
     */
    protected function resolveCachedUser(array $cachedSession)
    {
        $empId = $cachedSession['emp_id'] ?? null;
        if ($empId && class_exists('App\Models\Employee')) {
            try {
                $employee = \App\Models\Employee::find($empId);
                if ($employee) {
                    return $employee;
                }
            } catch (\Throwable $e) {
                // Fall back to DTO
            }
        }

        $userData = $cachedSession['user'] ?? [];
        return new AuthenticatedUserDto($userData);
    }

    /**
     * Resolve user from database (read only lookup) or instantiate AuthenticatedUserDto.
     */
    protected function resolveUserEntity(string $email, array $claims)
    {
        if (class_exists('App\Models\Employee')) {
            try {
                $employee = \App\Models\Employee::where('email', $email)->first();
                if ($employee) {
                    $updated = false;
                    if (!empty($claims['branch']) && $employee->branch !== $claims['branch']) {
                        $employee->branch = $claims['branch'];
                        $updated = true;
                    }
                    if (!empty($claims['branch_id']) && (int)$employee->branch_id !== (int)$claims['branch_id']) {
                        $employee->branch_id = (int)$claims['branch_id'];
                        $updated = true;
                    }
                    if ($updated) {
                        $employee->save();
                    }
                    return $employee;
                }

                $newEmp = new \App\Models\Employee();
                $newEmp->email = $email;
                $newEmp->first_name = $claims['first_name'] ?? '';
                $newEmp->last_name = $claims['last_name'] ?? '';
                $newEmp->role = $claims['role'] ?? 'service';
                $newEmp->department = $claims['department'] ?? null;
                $newEmp->branch = $claims['branch'] ?? null;
                $newEmp->branch_id = is_numeric($claims['branch_id'] ?? null) ? (int)$claims['branch_id'] : null;
                $newEmp->is_active = true;
                $newEmp->password_hash = '';
                $newEmp->password_change_at = now();
                $newEmp->last_synced_at = now();
                $newEmp->save();
                return $newEmp;
            } catch (\Throwable $e) {
                // If database query fails, fall back to DTO
            }
        }

        // Return pure DTO when model does not exist or record is not in database
        return new AuthenticatedUserDto(array_merge($claims, [
            'email' => $email,
            'is_active' => true,
        ]));
    }

    /**
     * Local dev user fallback.
     */
    protected function resolveDevUser()
    {
        if (class_exists('App\Models\Employee')) {
            try {
                $employee = \App\Models\Employee::where('role', 'superadmin')->first();
                if ($employee) {
                    return $employee;
                }
            } catch (\Throwable $e) {
                // Fall back to DTO
            }
        }

        return new AuthenticatedUserDto([
            'emp_id' => 1,
            'id' => 1,
            'email' => 'superadmin@hospital.com',
            'first_name' => 'Super',
            'last_name' => 'Admin',
            'name' => 'Super Admin',
            'role' => 'superadmin',
            'department' => 'superadmin',
            'is_active' => true,
        ]);
    }
}

