<?php
    namespace App\Services;

    use App\Events\EmployeeStatusChanged;
    use App\Models\Employee;
    use App\Models\Client;
    use App\Models\ClientCredential;
    use App\Models\PasswordResetOtp;
    use App\Models\RefreshToken;
    use App\Mail\ForgotPasswordOtpMail;
    use App\Mail\FirstLoginOtpMail;
    use Illuminate\Support\Facades\Hash;
    use Illuminate\Support\Facades\Mail;
    use Illuminate\Support\Facades\Log;
    use Illuminate\Support\Facades\DB;
    use Illuminate\Support\Facades\Cache;
    use Illuminate\Support\Carbon;
    use Illuminate\Support\Str;

    class AuthService {
        const MAX_FAILED_LOGIN = 5;
        const LOCK_MINUTES = 5;
        const PASSWORD_RESET_OTP_MINUTES = 10;
        const PASSWORD_RESET_MAX_ATTEMPTS = 5;

        public function login($email, $password, $mode = 'customer'){
            $start = microtime(true);
            Log::info('AuthService.login:start', ['email' => $email]);

            if ($mode === 'employee') {
                return $this->loginEmployee($email, $password, $start);
            }

            return $this->loginCustomer($email, $password, $start);
        }

        private function loginCustomer($email, $password, $start)
        {

            $client = Client::with('credential')->where('email', $email)->first();
            Log::info('AuthService.login:after_client_lookup', ['duration_ms' => (microtime(true)-$start)*1000]);

            if (!$client) {
                return [
                    'success' => false,
                    'message' => 'Wrong username or password',
                    'user' => null,
                    'token' => null,
                ];
            }

            $credential = $client->credential;

            if (!$credential) {
                return [
                    'success' => false,
                    'message' => 'Wrong username or password',
                    'user' => null,
                    'token' => null,
                ];
            }

            $afterCredential = microtime(true);
            Log::info('AuthService.login:after_credential_check', ['duration_ms' => ($afterCredential-$start)*1000]);

            if ($credential->locked_until && $credential->locked_until->isFuture()) {
                return [
                    'success' => false,
                    'message' => 'Wrong username or password',
                    'user' => null,
                    'token' => null,
                    'locked_until' => $credential->locked_until,
                ];
            }

            if (!Hash::check($password, $credential->password_hash)) {
                $failedLoginCount = $credential->failed_login_count + 1;
                $credential->failed_login_count = $failedLoginCount;

                if ($failedLoginCount >= self::MAX_FAILED_LOGIN) {
                    $credential->locked_until = Carbon::now()->addMinutes(self::LOCK_MINUTES);
                    // Dispatch security alert on failed login threshold breach (AC-1, AC-3)
                    SystemAlertDispatcher::dispatchIssue(
                        category: 'failed_login_spike',
                        severity: 'high',
                        service: 'customer-service',
                        title: "Failed Login Spike ({$email})",
                        message: "Repeated failed login attempts ({$failedLoginCount}) detected for customer {$email}.",
                        context: [
                            'email' => $email,
                            'failed_count' => $failedLoginCount,
                            'account_locked' => true,
                        ],
                        ip: request()?->ip(),
                        userAgent: request()?->userAgent()
                    );
                }

                $credential->save();

                Log::info('AuthService.login:after_failed_password', ['duration_ms' => (microtime(true)-$start)*1000, 'failed_count' => $failedLoginCount]);

                return [
                    'success' => false,
                    'message' => 'Wrong username or password',
                    'user' => null,
                    'token' => null,
                    'remaining_attempts' => max(0, 5 - $failedLoginCount),
                    'locked_until' => $credential->locked_until,
                ];
            }

            $isFirstLogin = $credential->password_change_at === null;
            $clientIp = request()?->ip() ?? '127.0.0.1';
            $ipCacheKey = "auth:known_ip:" . md5($email . ':' . $clientIp);

            // Detect unusual login from unfamiliar IP address (AC-1)
            if ($credential->last_login_at && !Cache::has($ipCacheKey)) {
                SystemAlertDispatcher::dispatchIssue(
                    category: 'unusual_login',
                    severity: 'medium',
                    service: 'customer-service',
                    title: "Unusual Login Detected ({$email})",
                    message: "Customer {$email} logged in from a new IP address ({$clientIp}).",
                    context: [
                        'email' => $email,
                        'ip_address' => $clientIp,
                        'previous_login' => $credential->last_login_at?->toIso8601String(),
                    ],
                    ip: $clientIp,
                    userAgent: request()?->userAgent()
                );
            }
            Cache::put($ipCacheKey, true, 86400 * 30);

            $credential->failed_login_count = 0;
            $credential->locked_until = null;
            $credential->last_login_at = Carbon::now();
            $credential->save();

            // TS009: When first login, send OTP to customer's email
            if ($isFirstLogin) {
                try {
                    $this->sendFirstLoginOtp($client->email, $client->client_name);
                    Log::info('AuthService.login:first_login_otp_dispatched', ['email' => $client->email]);
                } catch (\Throwable $e) {
                    Log::warning('AuthService.login:first_login_otp_failed: ' . $e->getMessage());
                }
            }

            Log::info('AuthService.login:after_credential_save', ['duration_ms' => (microtime(true)-$start)*1000]);

            // create access token (short-lived)
            $accessToken = $client->createToken('client')->accessToken;
            Log::info('AuthService.login:after_access_token', ['duration_ms' => (microtime(true)-$start)*1000]);

            // create refresh token record (store hash)
            $rawRefresh = Str::random(80);
            $hash = hash('sha256', $rawRefresh);
            $expiresAt = Carbon::now()->addDays(14);

            RefreshToken::create([
                'client_id' => $client->id,
                'token_hash' => $hash,
                'is_revoked' => false,
                'expires_at' => $expiresAt,
            ]);

            Log::info('AuthService.login:after_refresh_token_create', ['duration_ms' => (microtime(true)-$start)*1000]);

            return [
                'success' => true,
                'message' => 'Login successful',
                'user' => $client,
                'token' => $accessToken,
                'is_first_login' => $isFirstLogin,
                'refresh_token' => $rawRefresh,
                'refresh_expires_at' => $expiresAt,
            ];
        }

        private function loginEmployee($email, $password, $start)
        {
            $employee = Employee::where('email', $email)->first();
            Log::info('AuthService.login:after_employee_lookup', ['duration_ms' => (microtime(true) - $start) * 1000]);

            if (!$employee) {
                return [
                    'success' => false,
                    'message' => 'Wrong username or password',
                    'user' => null,
                    'token' => null,
                ];
            }

            if ($employee->locked_until && $employee->locked_until->isFuture()) {
                return [
                    'success' => false,
                    'message' => 'Wrong username or password',
                    'user' => null,
                    'token' => null,
                    'locked_until' => $employee->locked_until,
                ];
            }

            if (!Hash::check($password, $employee->password_hash)) {
                $failedLoginCount = $employee->failed_login_count + 1;
                $employee->failed_login_count = $failedLoginCount;

                if ($failedLoginCount >= self::MAX_FAILED_LOGIN) {
                    $employee->locked_until = Carbon::now()->addMinutes(self::LOCK_MINUTES);
                    // Dispatch security alert on failed login threshold breach (AC-1, AC-3)
                    SystemAlertDispatcher::dispatchIssue(
                        category: 'failed_login_spike',
                        severity: 'high',
                        service: 'customer-service',
                        title: "Failed Login Spike ({$email})",
                        message: "Repeated failed login attempts ({$failedLoginCount}) detected for staff account {$email}.",
                        context: [
                            'email' => $email,
                            'failed_count' => $failedLoginCount,
                            'role' => $employee->role,
                            'account_locked' => true,
                        ],
                        ip: request()?->ip(),
                        userAgent: request()?->userAgent()
                    );
                }

                $employee->save();

                return [
                    'success' => false,
                    'message' => 'Wrong username or password',
                    'user' => null,
                    'token' => null,
                    'remaining_attempts' => max(0, 5 - $failedLoginCount),
                    'locked_until' => $employee->locked_until,
                ];
            }

            $isFirstLogin = $employee->password_change_at === null;
            $empIp = request()?->ip() ?? '127.0.0.1';
            $empIpKey = "auth:known_ip:emp:" . md5($email . ':' . $empIp);

            // Detect unusual employee login from unfamiliar IP address (AC-1)
            if ($employee->last_login_at && !Cache::has($empIpKey)) {
                SystemAlertDispatcher::dispatchIssue(
                    category: 'unusual_login',
                    severity: 'medium',
                    service: 'customer-service',
                    title: "Unusual Staff Login Detected ({$email})",
                    message: "Staff member {$email} ({$employee->role}) logged in from a new IP address ({$empIp}).",
                    context: [
                        'email' => $email,
                        'role' => $employee->role,
                        'ip_address' => $empIp,
                        'previous_login' => $employee->last_login_at?->toIso8601String(),
                    ],
                    ip: $empIp,
                    userAgent: request()?->userAgent()
                );
            }
            Cache::put($empIpKey, true, 86400 * 30);

            $employee->failed_login_count = 0;
            $employee->locked_until = null;
            $employee->last_login_at = Carbon::now();
            // TS106: Automatically set availability status to Active upon login (non-blocking best-effort)
            try {
                $employee->is_active = true;
                $employee->save();
                Log::info("Employee status automatically set to Active upon login (TS106)", [
                    'emp_id' => $employee->emp_id,
                    'email' => $employee->email,
                    'role' => $employee->role,
                ]);
            } catch (\Throwable $e) {
                Log::error("Failed to set employee active status on login (best-effort): " . $e->getMessage(), [
                    'emp_id' => $employee->emp_id,
                ]);
            }

            // Non-blocking presence sync & real-time status event broadcast
            try {
                $this->syncEmployeePresence($employee);
            } catch (\Throwable $e) {
                Log::warning("Failed to sync employee presence on login: " . $e->getMessage());
            }

            $accessToken = $employee->createToken('employee')->accessToken;
            $rawRefresh = Str::random(80);
            $hash = hash('sha256', $rawRefresh);
            $expiresAt = Carbon::now()->addDays(14);

            RefreshToken::create([
                'employee_id' => $employee->emp_id,
                'token_hash' => $hash,
                'is_revoked' => false,
                'expires_at' => $expiresAt,
            ]);

            return [
                'success' => true,
                'message' => 'Login successful',
                'user' => $employee,
                'token' => $accessToken,
                'is_first_login' => $isFirstLogin,
                'refresh_token' => $rawRefresh,
                'refresh_expires_at' => $expiresAt,
            ];
        }

        public function logoutEmployee(Employee $employee): void
        {
            if (in_array($employee->role, ['customer service', 'head of cs', 'head of customer service', 'cs'])) {
                return;
            }

            // Logout clears presence only (spec 0035); is_active is the account flag and is left untouched.
            $employee->last_seen_at = null;
            $employee->save();

            Cache::store('redis')->forget($this->employeePresenceKey($employee->emp_id));

            EmployeeStatusChanged::dispatch($employee->refresh());
        }

        public function requestPasswordResetOtp($email)
        {
            $client = Client::where('email', $email)->first();

            if (!$client) {
                return [
                    'success' => true,
                    'message' => 'If the email exists, a reset code has been sent.',
                ];
            }

            $otp = (string) random_int(100000, 999999);
            $expiresAt = Carbon::now()->addMinutes(self::PASSWORD_RESET_OTP_MINUTES);

            PasswordResetOtp::updateOrCreate(
                ['email' => $email],
                [
                    'otp_hash' => Hash::make($otp),
                    'attempts' => 0,
                    'expires_at' => $expiresAt,
                    'used_at' => null,
                ]
            );

            try {
                Log::info('AuthService.requestPasswordResetOtp:before_mail_send', [
                    'email' => $email,
                    'mail_mailer' => config('mail.default'),
                    'mail_host' => config('mail.mailers.smtp.host'),
                ]);

                $result = Mail::to($email)->send(new ForgotPasswordOtpMail($client, $otp, self::PASSWORD_RESET_OTP_MINUTES));
                
                Log::info('AuthService.requestPasswordResetOtp:after_mail_send', [
                    'email' => $email,
                    'result' => $result,
                ]);
            } catch (\Throwable $throwable) {
                Log::error('AuthService.requestPasswordResetOtp:mail_failed', [
                    'email' => $email,
                    'message' => $throwable->getMessage(),
                    'code' => $throwable->getCode(),
                    'class' => get_class($throwable),
                ]);

                return [
                    'success' => false,
                    'message' => 'Unable to send the OTP email. Please check SMTP settings.',
                ];
            }

            return [
                'success' => true,
                'message' => 'If the email exists, a reset code has been sent.',
                'expires_at' => $expiresAt,
            ];
        }

        private function syncEmployeePresence(Employee $employee): void
        {
            try {
                Cache::store('redis')->put(
                    $this->employeePresenceKey($employee->emp_id),
                    [
                        'is_active' => true,
                        'last_seen_at' => Carbon::now()->toISOString(),
                    ],
                    now()->addDay()
                );

                EmployeeStatusChanged::dispatch($employee->refresh());
            } catch (\Throwable $e) {
                Log::warning("Failed to sync employee presence to Redis: " . $e->getMessage());
            }
        }

        private function employeePresenceKey(int $employeeId): string
        {
            return 'employee:presence:' . $employeeId;
        }

        public function verifyPasswordResetOtp($email, $otp)
        {
            $client = Client::with('credential')->where('email', $email)->first();
            $employee = Employee::where('email', $email)->first();

            if ($employee && $employee->locked_until && $employee->locked_until->isFuture()) {
                return [
                    'success' => false,
                    'message' => 'Account is temporarily locked. Please try again later.',
                ];
            }
            if ($client && $client->credential && $client->credential->locked_until && $client->credential->locked_until->isFuture()) {
                return [
                    'success' => false,
                    'message' => 'Account is temporarily locked. Please try again later.',
                ];
            }

            $record = PasswordResetOtp::where('email', $email)->first();

            if (!$record || $record->used_at || $record->expires_at->isPast()) {
                return [
                    'success' => false,
                    'message' => 'Invalid or expired verification code.',
                ];
            }

            if ($record->attempts >= self::PASSWORD_RESET_MAX_ATTEMPTS) {
                return [
                    'success' => false,
                    'message' => 'Too many invalid attempts. Please request a new code.',
                    'locked' => true,
                ];
            }

            if (!Hash::check($otp, $record->otp_hash)) {
                $record->attempts += 1;
                $record->save();

                if ($record->attempts >= 5) {
                    if ($employee) {
                        $employee->locked_until = Carbon::now()->addMinutes(5);
                        $employee->save();
                    }
                    if ($client && $client->credential) {
                        $client->credential->locked_until = Carbon::now()->addMinutes(5);
                        $client->credential->save();
                    }
                    return [
                        'success' => false,
                        'message' => 'Too many invalid attempts. Account has been temporarily locked for 5 minutes.',
                        'locked' => true,
                    ];
                }

                return [
                    'success' => false,
                    'message' => 'Invalid or expired verification code.',
                    'remaining_attempts' => max(0, self::PASSWORD_RESET_MAX_ATTEMPTS - $record->attempts),
                ];
            }

            return [
                'success' => true,
                'message' => 'Code verified successfully.',
            ];
        }

        public function resetPasswordWithOtp($email, $otp, $password)
        {
            $client = Client::with('credential')->where('email', $email)->first();

            if (!$client || !$client->credential) {
                return [
                    'success' => false,
                    'message' => 'Invalid or expired verification code.',
                ];
            }

            $record = PasswordResetOtp::where('email', $email)->first();

            if (!$record || $record->used_at || $record->expires_at->isPast() || !Hash::check($otp, $record->otp_hash)) {
                return [
                    'success' => false,
                    'message' => 'Invalid or expired verification code.',
                ];
            }

            DB::transaction(function () use ($client, $password, $record) {
                $client->credential->password_hash = Hash::make($password);
                $client->credential->password_change_at = Carbon::now();
                $client->credential->failed_login_count = 0;
                $client->credential->locked_until = null;
                $client->credential->save();

                $record->used_at = Carbon::now();
                $record->save();
            });

            return [
                'success' => true,
                'message' => 'Password reset successfully.',
            ];
        }

        public function sendFirstLoginOtp($email, $name)
        {
            $otp = (string) random_int(100000, 999999);
            $expiresAt = Carbon::now()->addMinutes(self::PASSWORD_RESET_OTP_MINUTES);

            PasswordResetOtp::updateOrCreate(
                ['email' => $email],
                [
                    'otp_hash' => Hash::make($otp),
                    'attempts' => 0,
                    'expires_at' => $expiresAt,
                    'used_at' => null,
                ]
            );

            try {
                Log::info('AuthService.sendFirstLoginOtp:before_mail_send', [
                    'email' => $email,
                    'mail_mailer' => config('mail.default'),
                    'mail_host' => config('mail.mailers.smtp.host'),
                ]);

                Mail::to($email)->send(new FirstLoginOtpMail($name, $otp, self::PASSWORD_RESET_OTP_MINUTES));
                
                Log::info('AuthService.sendFirstLoginOtp:after_mail_send', [
                    'email' => $email,
                ]);

                return true;
            } catch (\Throwable $throwable) {
                Log::error('AuthService.sendFirstLoginOtp:mail_failed', [
                    'email' => $email,
                    'message' => $throwable->getMessage(),
                ]);

                return false;
            }
        }

        public function changePassword($user, $currentPassword, $newPassword, $otp = null)
        {
            if ($user instanceof Employee) {
                if ($user->locked_until && $user->locked_until->isFuture()) {
                    return [
                        'success' => false,
                        'message' => 'Account is temporarily locked. Please try again later.',
                    ];
                }
            } else {
                if ($user->credential && $user->credential->locked_until && $user->credential->locked_until->isFuture()) {
                    return [
                        'success' => false,
                        'message' => 'Account is temporarily locked. Please try again later.',
                    ];
                }
            }

            $isFirstLogin = $user instanceof Employee
                ? $user->password_change_at === null
                : optional($user->credential)->password_change_at === null;

            // TS009: Verify OTP on first login if code is provided
            if ($isFirstLogin && !empty($otp)) {
                $verifyResult = $this->verifyPasswordResetOtp($user->email, $otp);
                if (!$verifyResult['success']) {
                    return $verifyResult;
                }
            }

            $currentPasswordHash = $user instanceof Employee
                ? $user->password_hash
                : $user->credential->password_hash;

            if (!Hash::check($currentPassword, $currentPasswordHash)) {
                return [
                    'success' => false,
                    'message' => 'Current password is incorrect.',
                ];
            }

            // TS009: Reject reuse of default credential
            if (Hash::check($newPassword, $currentPasswordHash)) {
                return [
                    'success' => false,
                    'message' => 'New password cannot be the same as the current password.',
                ];
            }

            DB::transaction(function () use ($user, $newPassword, $isFirstLogin) {
                if ($user instanceof Employee) {
                    $user->password_hash = Hash::make($newPassword);
                    $user->password_change_at = Carbon::now();
                    $user->failed_login_count = 0;
                    $user->locked_until = null;
                    $user->save();
                } else {
                    $user->credential->password_hash = Hash::make($newPassword);
                    $user->credential->password_change_at = Carbon::now();
                    $user->credential->failed_login_count = 0;
                    $user->credential->locked_until = null;
                    $user->credential->save();
                }

                if ($isFirstLogin) {
                    PasswordResetOtp::where('email', $user->email)->update(['used_at' => Carbon::now()]);
                }
            });

            Log::info("Password successfully changed for user {$user->email}" . ($isFirstLogin ? ' (first login completed)' : ''));

            return [
                'success' => true,
                'message' => 'Password changed successfully.',
            ];
        }
    }
