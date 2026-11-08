<?php

namespace App\Http\Controllers;

use App\Events\LogLevelUpdated;
use App\Events\NotificationRoutingUpdated;
use App\Events\SystemStatusUpdated;
use App\Events\TicketWindowConfigUpdated;
use App\Models\TicketConfiguration;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

class TicketConfigurationController extends Controller
{
    /**
     * Default configurations baseline.
     */
    protected array $defaults = [
        'number_format' => [
            'prefix' => 'TKT',
            'includeDeptCode' => false,
            'deptCode' => '',
            'dateSegment' => 'none',
            'digitLength' => 4,
        ],
        'defaults' => [
            'status' => 'Open',
            'priority' => 'Low',
            'slaPolicy' => 'dynamic',
        ],
        'limits' => [
            'isUnlimited' => true,
            'limit' => 5,
        ],
        // Keys must match the backend TicketStateMachine states (ticket-service / employee-service).
        'transitions' => [
            'Open' => [
                'allowed' => ['In Progress (CS-owned)', 'Assigned', 'In Progress (Employee-owned)', 'Closed', 'Cancelled', 'Escalated'],
                'type' => 'editable',
                'description' => 'Initial ticket state upon customer or internal creation.',
            ],
            'In Progress (CS-owned)' => [
                'allowed' => ['On Hold/Pending', 'Assigned', 'Resolved', 'Closed', 'Escalated'],
                'type' => 'editable',
                'description' => 'Ticket being triaged or actively handled directly by Customer Service.',
            ],
            'Assigned' => [
                'allowed' => ['Reassigned', 'In Progress (Employee-owned)', 'On Hold/Pending', 'Escalated'],
                'type' => 'editable',
                'description' => 'Ticket dispatched to an engineer/technician and awaiting their acceptance.',
            ],
            'Reassigned' => [
                'allowed' => ['In Progress (Employee-owned)', 'Assigned', 'On Hold/Pending', 'Escalated'],
                'type' => 'editable',
                'description' => 'Ticket reassignment requested or approved for re-dispatch.',
            ],
            'In Progress (Employee-owned)' => [
                'allowed' => ['On Hold/Pending', 'Reassigned', 'Resolved', 'Assigned', 'Closed', 'Escalated'],
                'type' => 'editable',
                'description' => 'Service engineer has accepted the assignment and is actively working on the machine.',
            ],
            'Resolved' => [
                'allowed' => ['Closed', 'In Progress (Employee-owned)'],
                'type' => 'editable',
                'description' => 'Work is marked complete with proof of completion pending evaluation.',
            ],
            'Closed' => [
                'allowed' => ['Reopened'],
                'type' => 'editable',
                'caption' => 'Reopening is permitted only within the configured reopen window (e.g. 48h after resolution).',
                'description' => 'Final confirmed state. Can transition to Reopened within the allowed reopen window.',
            ],
            'Escalated' => [
                'allowed' => ['Assigned', 'In Progress (Employee-owned)', 'In Progress (CS-owned)', 'Resolved', 'Closed'],
                'type' => 'editable',
                'description' => 'Ticket escalated to supervisory or department leadership.',
            ],
            'Reopened' => [
                'allowed' => ['In Progress (CS-owned)'],
                'type' => 'fixed',
                'caption' => 'Automatic transition: Reopened tickets immediately route to Customer Service (CS-owned). This transition is system-automated and non-editable.',
                'description' => 'Ticket reopened by customer within window; routes automatically to CS.',
            ],
            'On Hold/Pending' => [
                'allowed' => [],
                'type' => 'contextual',
                'caption' => 'Contextual transition: Resumes back to whichever In Progress state it came from (CS-owned or Employee-owned). This is contextual rather than a fixed pair, so it is non-editable.',
                'description' => 'Ticket paused awaiting parts, customer feedback, or external dependency.',
            ],
            'Cancelled' => [
                'allowed' => [],
                'type' => 'terminal',
                'caption' => 'Terminal status: No further transitions permitted from Cancelled.',
                'description' => 'Ticket discarded or cancelled before assignment.',
            ],
        ],
        // Working hours used when counting SLA response/resolution limits.
        // workingDays uses ISO-8601 numbering: 1 = Monday ... 7 = Sunday.
        'business_hours' => [
            'enabled' => true,
            'timezone' => 'UTC',
            'startTime' => '08:00',
            'endTime' => '17:00',
            'workingDays' => [1, 2, 3, 4, 5],
        ],
        'windows' => [
            'reopenEnabled' => true,
            'reopenWindowDays' => 2,
            'autoCloseEnabled' => true,
            'autoCloseWindowDays' => 2,
        ],
        'file_limits' => [
            'maxFileSizeMB' => 15,
            'allowedFileTypes' => ['PDF', 'DOCX', 'DOC', 'JPG', 'JPEG', 'PNG'],
            'maxFileCount' => 5,
            'malwareScanningEnabled' => true,
        ],
        'routing' => [
            'new_ticket' => ['role_cs'],
            'new_message' => ['contextual_assigned'],
            'overdue_ticket' => ['role_cs'],
        ],
        'company_info' => [
            'address' => 'SBSI Building, 28 East Capitol Drive, Kapitolyo, Pasig City, Metro Manila, Philippines 1603',
            'contactNumber' => '+63 2 8635 9999',
            'contactEmail' => 'support@sbsi.com.ph',
            'socialLinks' => [
                ['id' => 'soc-1', 'platform' => 'LinkedIn', 'url' => 'https://www.linkedin.com/company/scientific-biotech-specialties-inc'],
                ['id' => 'soc-2', 'platform' => 'Facebook', 'url' => 'https://www.facebook.com/ScientificBiotechSpecialties'],
                ['id' => 'soc-3', 'platform' => 'Twitter / X', 'url' => 'https://x.com/sbsi_ph'],
            ],
        ],
        'system_status' => [
            'status' => 'Operational',
        ],
        'log_level' => [
            'level' => 'Info',
        ],
        'messaging' => [
            'default_participants' => 'customer_cs',
            'allow_delegated_employee' => true,
            'allow_full_history' => true,
            'notify_on_employee_join' => true,
            'internal' => [
                'mode' => 'requestor_cs_delegated',
                'allow_direct_assigned' => true,
                'allow_full_history' => true,
                'notify_on_activity' => true,
            ],
        ],
        'category_escalation_rules' => [
            'biomedical' => [
                'department' => ['Service', 'Biomedical Engineering', 'Radiology Maintenance', 'Facilities & Equipment'],
                'min_position_level' => 'Senior',
                'allowed_roles' => ['Biomedical Engineer', 'Senior Biomedical Engineer', 'Lead Service Engineer', 'Field Service Specialist', 'Hardware Specialist'],
                'allow_cross_branch' => false,
            ],
            'hardware' => [
                'department' => ['Service', 'Facilities & Equipment', 'Radiology Maintenance'],
                'min_position_level' => 'Mid',
                'allowed_roles' => ['Service Technician', 'Hardware Specialist', 'Biomedical Engineer', 'Field Service Specialist', 'Biomedical Technician'],
                'allow_cross_branch' => false,
            ],
            'network' => [
                'department' => ['IT', 'IT Support', 'Network Operations'],
                'min_position_level' => 'Mid',
                'allowed_roles' => ['Network Administrator', 'Systems Specialist', 'IT Support Specialist', 'Systems Administrator'],
                'allow_cross_branch' => false,
            ],
            'software' => [
                'department' => ['IT', 'IT Support', 'Network Operations'],
                'min_position_level' => 'Mid',
                'allowed_roles' => ['Software Specialist', 'Systems Specialist', 'Systems Administrator', 'IT Support Specialist'],
                'allow_cross_branch' => false,
            ],
            'general' => [
                'department' => ['Service', 'IT', 'Facilities & Equipment', 'Operations'],
                'min_position_level' => 'Junior',
                'allowed_roles' => [],
                'allow_cross_branch' => false,
            ],
        ],
        'department_managers' => [
            'service' => [
                'id' => 1028,
                'name' => 'Carlos Mendoza',
                'email' => 'carlos.mendoza@hospital.com',
                'phone' => '+63 917 123 4567',
                'department' => 'Service',
                'position_level' => 'Manager',
                'role' => 'Lead Service Engineer',
            ],
            'it' => [
                'id' => 1038,
                'name' => 'Michael Scott',
                'email' => 'michael.scott@hospital.com',
                'phone' => '+63 917 234 5678',
                'department' => 'IT Support',
                'position_level' => 'Manager',
                'role' => 'IT Systems Specialist',
            ],
            'cs' => [
                'id' => 1,
                'name' => 'Ava Santos',
                'email' => 'cs@gmail.com',
                'phone' => '+63 917 345 6789',
                'department' => 'Customer Support',
                'position_level' => 'Manager',
                'role' => 'Customer Support Lead',
            ],
        ],
        'system_alert_thresholds' => [
            'failed_logins' => [
                'threshold' => 5,
                'window_seconds' => 600,
                'burst_cooldown_seconds' => 300,
            ],
            'unusual_logins' => [
                'threshold' => 1,
                'window_seconds' => 3600,
                'detect_new_ip' => true,
                'detect_new_user_agent' => true,
            ],
            'sql_errors' => [
                'threshold' => 3,
                'window_seconds' => 60,
                'burst_cooldown_seconds' => 300,
            ],
            'unhandled_errors' => [
                'threshold' => 3,
                'window_seconds' => 60,
                'burst_cooldown_seconds' => 300,
            ],
        ],
    ];

    /**
     * Verify that the request is authorized to modify system configuration.
     *
     * Spec 0034: identity comes only from the verified token (set by the config.access middleware)
     * or a trusted internal service call. No X-User-* header, hand decoded token, cached token
     * lookup or development token can grant access.
     */
    protected function checkAuthorized(Request $request): ?JsonResponse
    {
        // 1. Trusted internal microservice call that presents the matching INTERNAL_TOKEN
        $expectedToken = (string) env('INTERNAL_TOKEN', '');
        $providedToken = (string) $request->header('X-Internal-Token', '');
        if (
            $expectedToken !== ''
            && $request->header('X-Internal-Call') === 'ticket-service'
            && hash_equals($expectedToken, $providedToken)
        ) {
            return null;
        }

        // 2. Verified admin or superadmin
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized: Authentication required.'], 401);
        }

        if (\App\Http\Middleware\ConfigAccess::isVerifiedAdmin($user)) {
            return null;
        }

        return response()->json(['message' => 'Forbidden: administrator access required.'], 403);
    }

    /**
     * Limit writes are accepted only from ticket-service after it has authenticated
     * and authorized the acting super administrator.
     */
    protected function checkTrustedTicketService(Request $request): ?JsonResponse
    {
        $expectedToken = (string) env('INTERNAL_TOKEN', '');
        $providedToken = (string) $request->header('X-Internal-Token', '');

        if (
            $expectedToken !== ''
            && $request->header('X-Internal-Call') === 'ticket-service'
            && hash_equals($expectedToken, $providedToken)
        ) {
            return null;
        }

        return response()->json(['message' => 'Unauthorized internal service request.'], 401);
    }

    /**
     * Helper to write configuration audit logs to ticket_audit_logs capturing acting super admin and before/after values.
     */
    protected function logAudit(?Request $request, string $actionType, string $module, string $target, string $text, mixed $before = null, mixed $after = null): void
    {
        try {
            // Spec 0034: the actor is the verified user, never a header the caller can set.
            $userId = $request?->user()?->emp_id
                ?? $request?->user()?->id
                ?? DB::table('employees')->where('role', 'superadmin')->value('emp_id')
                ?? DB::table('employees')->value('emp_id')
                ?? 1;

            $details = [
                'module' => $module,
                'target' => $target,
                'text'   => $text,
            ];

            if ($before !== null) {
                $details['before'] = $before;
            }
            if ($after !== null) {
                $details['after'] = $after;
            }

            DB::table('ticket_audit_logs')->insert([
                'ticket_ID'    => null,
                'action_type'  => $actionType,
                'action_by_ID' => $userId,
                'actor_type'   => 'superadmin',
                'details'      => json_encode($details),
                'created_at'   => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning("Failed to record configuration audit log: " . $e->getMessage());
        }
    }

    /**
     * Non-blocking Redis cache invalidation for arbitrary config key using SCAN chunking.
     */
    protected function clearConfigCache(string $key): void
    {
        try {
            Cache::forget("ticket:config:{$key}");
            Cache::forget("ticket_configuration:{$key}");
        } catch (\Throwable $e) {
            Log::warning("Redis cache clearing failed for {$key}: " . $e->getMessage());
        }

        $this->forgetSharedCacheEntries(["ticket:config:{$key}", "ticket_configuration:{$key}"]);
    }

    /**
     * Delete every service's cached copy of the given cache keys.
     *
     * ticket-service and employee-service cache configuration in the same Redis cache database,
     * each under its own prefix (e.g. "laravel_database_laravel_cache_:ticket:config:transitions").
     * Cache::forget() only reaches this service's own copy, so the cache connection is SCANned for
     * keys ending in "_cache_{key}" or "_cache_:{key}" and those are deleted. Matching the exact key suffix leaves
     * related keys alone (e.g. ticket-service's "ticket:config:limits:last-known-good" fallback).
     */
    protected function forgetSharedCacheEntries(array $cacheKeys): void
    {
        try {
            $client = Redis::connection('cache')->client();
            // phpredis returns full keys from SCAN but prefixes keys passed to DEL, so the
            // connection prefix is disabled while deleting other services' keys.
            $originalPrefix = $client->getOption(\Redis::OPT_PREFIX);
            $client->setOption(\Redis::OPT_PREFIX, '');

            try {
                foreach ($cacheKeys as $cacheKey) {
                    // Cache prefixes end in "_cache_" or "_cache_:" depending on the service.
                    foreach (['*_cache_' . $cacheKey, '*_cache_:' . $cacheKey] as $pattern) {
                        $iterator = null;
                        do {
                            $keys = $client->scan($iterator, $pattern, 100);
                            if (!empty($keys)) {
                                $client->del($keys);
                            }
                        } while ($iterator > 0);
                    }
                }
            } finally {
                $client->setOption(\Redis::OPT_PREFIX, $originalPrefix ?: '');
            }
        } catch (\Throwable $e) {
            Log::warning('Shared configuration cache clearing failed: ' . $e->getMessage());
        }
    }

    /**
     * Non-blocking Redis cache invalidation across services using SCAN chunking.
     */
    protected function clearWindowCache(): void
    {
        $this->clearConfigCache('windows');
    }

    /**
     * Non-blocking Redis cache invalidation for notification recipient routing using SCAN chunking.
     */
    protected function clearRoutingCache(): void
    {
        $this->clearConfigCache('routing');
    }

    /**
     * Get all ticket configuration sections.
     */
    public function index(): JsonResponse
    {
        $configs = TicketConfiguration::all()->pluck('value', 'key')->toArray();

        // Merge with defaults if any key is missing
        $result = [];
        foreach ($this->defaults as $key => $defaultVal) {
            $result[$key] = $configs[$key] ?? $defaultVal;
        }

        return response()->json($result);
    }

    /**
     * Dedicated endpoint to view reopen & auto-close windows configuration.
     */
    public function showWindows(): JsonResponse
    {
        $value = TicketConfiguration::getByKey('windows', $this->defaults['windows']);

        return response()->json(array_merge([
            'key' => 'windows',
            'value' => $value,
        ], $value));
    }

    /**
     * Dedicated endpoint to update reopen & auto-close windows configuration independently.
     */
    public function updateWindows(Request $request): JsonResponse
    {
        return $this->update($request, 'windows');
    }

    /**
     * Dedicated endpoint to view ticket messaging participation configuration.
     */
    public function showMessaging(): JsonResponse
    {
        $value = TicketConfiguration::getByKey('messaging', $this->defaults['messaging']);
        if (is_array($value)) {
            $defaultInternal = $this->defaults['messaging']['internal'] ?? [
                'mode' => 'requestor_cs_delegated',
                'allow_direct_assigned' => true,
                'allow_full_history' => true,
                'notify_on_activity' => true,
            ];
            $value['internal'] = isset($value['internal']) && is_array($value['internal'])
                ? array_merge($defaultInternal, $value['internal'])
                : $defaultInternal;
        }

        return response()->json(array_merge([
            'key' => 'messaging',
            'value' => $value,
        ], is_array($value) ? $value : []));
    }

    /**
     * Dedicated endpoint to update ticket messaging participation configuration independently.
     */
    public function updateMessaging(Request $request): JsonResponse
    {
        return $this->update($request, 'messaging');
    }

    /**
     * Dedicated endpoint to view active notification recipient routing.
     * Explicitly marks system_alert as non-configurable and hard-coded to Super Admin.
     */
    public function showRouting(): JsonResponse
    {
        $value = TicketConfiguration::getByKey('routing', $this->defaults['routing']);

        return response()->json([
            'key' => 'routing',
            'value' => $value,
            'immutable_scope' => [
                'system_alert' => [
                    'locked' => true,
                    'recipients' => ['role_superadmin'],
                    'description' => 'System alerts are strictly hard-coded to Super Admin at the dispatch level and cannot be modified.',
                ],
            ],
        ]);
    }

    /**
     * Dedicated endpoint to update notification recipient routing independently.
     */
    public function updateRouting(Request $request): JsonResponse
    {
        return $this->update($request, 'routing');
    }

    /**
     * Dedicated endpoint to view company information.
     */
    public function showCompanyInfo(): JsonResponse
    {
        $value = TicketConfiguration::getByKey('company_info', $this->defaults['company_info']);

        return response()->json([
            'key' => 'company_info',
            'value' => $value,
        ]);
    }

    /**
     * Dedicated endpoint to update company information independently.
     */
    public function updateCompanyInfo(Request $request): JsonResponse
    {
        return $this->update($request, 'company_info');
    }

    /**
     * Dedicated endpoint to view current system status.
     */
    public function showSystemStatus(): JsonResponse
    {
        $value = TicketConfiguration::getByKey('system_status', $this->defaults['system_status']);
        $status = is_array($value) ? ($value['status'] ?? 'Operational') : ($value ?: 'Operational');

        return response()->json([
            'key' => 'system_status',
            'value' => ['status' => $status],
            'status' => $status,
        ]);
    }

    /**
     * Dedicated endpoint to update system status independently.
     */
    public function updateSystemStatus(Request $request): JsonResponse
    {
        return $this->update($request, 'system_status');
    }

    /**
     * Dedicated endpoint to view current logging verbosity.
     */
    public function showLogLevel(): JsonResponse
    {
        $value = TicketConfiguration::getByKey('log_level', $this->defaults['log_level']);
        $level = is_array($value) ? ($value['level'] ?? 'Info') : ($value ?: 'Info');

        return response()->json([
            'key' => 'log_level',
            'value' => ['level' => $level],
            'level' => $level,
        ]);
    }

    /**
     * Dedicated endpoint to update logging verbosity independently.
     */
    public function updateLogLevel(Request $request): JsonResponse
    {
        return $this->update($request, 'log_level');
    }

    /**
     * Get a specific configuration section.
     */
    public function show(string $key): JsonResponse
    {
        $normalizedKey = str_replace('-', '_', $key);
        if ($normalizedKey === 'ticket_defaults') {
            $normalizedKey = 'defaults';
        }
        if ($normalizedKey === 'files') {
            $normalizedKey = 'file_limits';
        }
        $value = TicketConfiguration::getByKey($normalizedKey, $this->defaults[$normalizedKey] ?? null);

        if ($value === null) {
            return response()->json(['message' => "Configuration section '{$key}' not found."], 404);
        }

        return response()->json([
            'key' => $normalizedKey,
            'value' => $value,
        ]);
    }

    /**
     * Save/update a configuration section.
     */
    public function update(Request $request, string $key): JsonResponse
    {
        $normalizedKey = str_replace('-', '_', $key);
        if ($normalizedKey === 'ticket_defaults') {
            $normalizedKey = 'defaults';
        }
        if ($normalizedKey === 'files') {
            $normalizedKey = 'file_limits';
        }
        $authErr = $normalizedKey === 'limits'
            ? $this->checkTrustedTicketService($request)
            : $this->checkAuthorized($request);
        if ($authErr) {
            return $authErr;
        }

        if (!array_key_exists($normalizedKey, $this->defaults)) {
            return response()->json(['message' => "Invalid configuration section '{$key}'."], 422);
        }

        $payload = $request->input('value', $request->all());

        switch ($normalizedKey) {
            case 'windows':
                // Strict validation: reject non-numeric, zero, and negative window durations
                $rules = [
                    'reopenEnabled' => 'sometimes|boolean',
                    'reopenWindowDays' => [
                        'sometimes',
                        'required',
                        function ($attribute, $value, $fail) {
                            if (!is_numeric($value)) {
                                $fail('The reopen window duration must be a valid numeric value.');
                                return;
                            }
                            $num = (float) $value;
                            if ($num <= 0) {
                                $fail('The reopen window duration must be a positive number greater than zero.');
                                return;
                            }
                            if ((int) $value != $num) {
                                $fail('The reopen window duration must be a whole integer number of days.');
                            }
                        },
                    ],
                    'autoCloseEnabled' => 'sometimes|boolean',
                    'autoCloseWindowDays' => [
                        'sometimes',
                        'required',
                        function ($attribute, $value, $fail) {
                            if (!is_numeric($value)) {
                                $fail('The auto-close window duration must be a valid numeric value.');
                                return;
                            }
                            $num = (float) $value;
                            if ($num <= 0) {
                                $fail('The auto-close window duration must be a positive number greater than zero.');
                                return;
                            }
                            if ((int) $value != $num) {
                                $fail('The auto-close window duration must be a whole integer number of days.');
                            }
                        },
                    ],
                ];

                $validator = Validator::make($payload, $rules, [
                    'reopenEnabled.boolean' => 'The reopen enabled setting must be true or false.',
                    'autoCloseEnabled.boolean' => 'The auto-close enabled setting must be true or false.',
                ]);

                if ($validator->fails()) {
                    return response()->json([
                        'message' => 'Validation Error: Invalid window configuration values.',
                        'errors' => $validator->errors(),
                    ], 422);
                }

                $validated = $validator->validated();

                // Merge with existing configuration to support independent field updates
                $current = TicketConfiguration::getByKey('windows', $this->defaults['windows']);

                $reopenEnabled = array_key_exists('reopenEnabled', $validated)
                    ? (bool) $validated['reopenEnabled']
                    : (bool) ($current['reopenEnabled'] ?? true);

                $reopenWindowDays = array_key_exists('reopenWindowDays', $validated)
                    ? (int) $validated['reopenWindowDays']
                    : (int) ($current['reopenWindowDays'] ?? 2);

                $autoCloseEnabled = array_key_exists('autoCloseEnabled', $validated)
                    ? (bool) $validated['autoCloseEnabled']
                    : (bool) ($current['autoCloseEnabled'] ?? true);

                $autoCloseWindowDays = array_key_exists('autoCloseWindowDays', $validated)
                    ? (int) $validated['autoCloseWindowDays']
                    : (int) ($current['autoCloseWindowDays'] ?? 2);

                $value = [
                    'reopenEnabled' => $reopenEnabled,
                    'reopenWindowDays' => $reopenWindowDays,
                    'autoCloseEnabled' => $autoCloseEnabled,
                    'autoCloseWindowDays' => $autoCloseWindowDays,
                ];

                $record = TicketConfiguration::setByKey('windows', $value);

                // Non-blocking Redis cache invalidation across services
                $this->clearWindowCache();

                // Audit logging capturing the acting super admin
                $reopenText = $reopenEnabled ? "Enabled ({$reopenWindowDays} days)" : "Disabled";
                $autoCloseText = $autoCloseEnabled ? "Enabled ({$autoCloseWindowDays} days)" : "Disabled";
                $auditText = "Updated ticket lifecycle windows: Customer Reopen is {$reopenText}, Auto-Close is {$autoCloseText}. Changes apply only to subsequent lifecycle actions.";

                $this->logAudit(
                    $request,
                    'config_update',
                    'Lifecycle Window Configuration',
                    'Reopen & Auto-Close Windows',
                    $auditText
                );

                // Publish event to broadcast channel
                $actingUserId = $request->user()?->emp_id ?? $request->user()?->id ?? null;
                try {
                    event(new TicketWindowConfigUpdated($value, $actingUserId));
                } catch (\Throwable $e) {
                    Log::warning('Broadcasting TicketWindowConfigUpdated failed: ' . $e->getMessage());
                }

                return response()->json(array_merge([
                    'message' => "Configuration for 'windows' updated successfully.",
                    'key' => 'windows',
                    'value' => $record->value,
                ], $record->value));

            case 'number_format':
                $validator = Validator::make($payload, [
                    'prefix' => ['required', 'string', 'max:16', 'regex:/^[A-Za-z0-9_-]{1,16}$/'],
                    'includeDeptCode' => 'sometimes|boolean',
                    'deptCode' => [
                        'nullable',
                        'required_if:includeDeptCode,true,1',
                        function ($attribute, $value, $fail) use ($payload) {
                            $includeDept = filter_var($payload['includeDeptCode'] ?? false, FILTER_VALIDATE_BOOLEAN);
                            if ($includeDept) {
                                $trimmed = trim((string)$value);
                                if (empty($trimmed)) {
                                    $fail('A branch or department code is required when the department code segment is enabled.');
                                    return;
                                }
                                if (!preg_match('/^[A-Za-z0-9_-]{1,16}$/', $trimmed)) {
                                    $fail('Department code can only contain alphanumeric characters, hyphens, and underscores.');
                                }
                            }
                        },
                    ],
                    'dateSegment' => 'required|string|in:none,YYYY,YYYYMM,YYYYMMDD',
                    'digitLength' => 'required|integer|min:3|max:8',
                ], [
                    'prefix.required' => 'A ticket prefix is required.',
                    'prefix.regex' => 'Prefix can only contain alphanumeric characters, hyphens, and underscores.',
                    'dateSegment.required' => 'A date segment pattern option must be selected.',
                    'dateSegment.in' => 'Date segment must be one of: none, YYYY, YYYYMM, YYYYMMDD.',
                    'digitLength.required' => 'A sequential component is strictly required to guarantee unique ticket numbers.',
                    'digitLength.min' => 'Sequential digit length must be between 3 and 8 digits.',
                    'digitLength.max' => 'Sequential digit length must be between 3 and 8 digits.',
                ]);

                if ($validator->fails()) {
                    return response()->json([
                        'message' => 'Validation Error: Invalid ticket number format configuration.',
                        'errors' => $validator->errors(),
                    ], 422);
                }

                $validated = $validator->validated();
                $value = [
                    'prefix' => strtoupper(trim($validated['prefix'])),
                    'includeDeptCode' => (bool) ($validated['includeDeptCode'] ?? false),
                    'deptCode' => strtoupper(trim($validated['deptCode'] ?? '')),
                    'dateSegment' => $validated['dateSegment'],
                    'digitLength' => (int) $validated['digitLength'],
                ];
                break;

            case 'defaults':
                $validator = Validator::make($payload, [
                    'status' => [
                        'required',
                        'string',
                        'max:64',
                        function ($attribute, $value, $fail) {
                            $trimmed = trim((string)$value);
                            $validStartingStatuses = ['Open'];
                            $isValidStarting = false;
                            foreach ($validStartingStatuses as $startStatus) {
                                if (strcasecmp($trimmed, $startStatus) === 0) {
                                    $isValidStarting = true;
                                    break;
                                }
                            }
                            if (!$isValidStarting) {
                                $fail("The default status must be a valid starting status per the ticket state machine (e.g., 'Open'). Status '{$value}' is not a valid initial state.");
                            }
                        },
                    ],
                    'priority' => 'required|string|max:64',
                    'slaPolicy' => 'required|string|max:64',
                ], [
                    'status.required' => 'The default status is required.',
                    'priority.required' => 'The default priority is required.',
                    'slaPolicy.required' => 'The default SLA policy is required.',
                ]);

                if ($validator->fails()) {
                    return response()->json([
                        'message' => 'Validation Error: Invalid ticket defaults configuration.',
                        'errors' => $validator->errors(),
                    ], 422);
                }

                $validated = $validator->validated();
                $value = [
                    'status' => $validated['status'],
                    'priority' => $validated['priority'],
                    'slaPolicy' => $validated['slaPolicy'],
                ];
                break;

            case 'limits':
                $validated = $request->validate([
                    'isUnlimited' => 'required|boolean',
                    'limit' => 'nullable|integer|min:1|max:1000',
                ]);
                $value = [
                    'isUnlimited' => (bool) $validated['isUnlimited'],
                    'limit' => (int) ($validated['limit'] ?? 5),
                ];
                break;

            case 'file_limits':
                $validator = Validator::make($payload, [
                    'maxFileSizeMB' => 'required|numeric|min:1|max:500',
                    'allowedFileTypes' => 'required|array|min:1',
                    'allowedFileTypes.*' => 'string|max:16',
                    'maxFileCount' => 'required|integer|min:1|max:50',
                    'malwareScanningEnabled' => 'required|boolean',
                ], [
                    'maxFileSizeMB.required' => 'Maximum file size is required.',
                    'maxFileSizeMB.min' => 'Maximum file size must be at least 1 MB.',
                    'maxFileSizeMB.max' => 'Maximum file size cannot exceed 500 MB.',
                    'allowedFileTypes.required' => 'At least one allowed file type must be specified.',
                    'allowedFileTypes.min' => 'At least one allowed file type must be specified.',
                    'maxFileCount.required' => 'Maximum file count is required.',
                    'maxFileCount.min' => 'Maximum file count must be at least 1.',
                    'maxFileCount.max' => 'Maximum file count cannot exceed 50.',
                    'malwareScanningEnabled.required' => 'Malware scanning toggle must be specified.',
                ]);

                if ($validator->fails()) {
                    return response()->json([
                        'message' => 'Validation Error: Invalid file upload limits configuration.',
                        'errors' => $validator->errors(),
                    ], 422);
                }

                $validated = $validator->validated();
                $value = [
                    'maxFileSizeMB' => (float) $validated['maxFileSizeMB'],
                    'allowedFileTypes' => array_values(array_unique(array_map('strtoupper', $validated['allowedFileTypes']))),
                    'maxFileCount' => (int) $validated['maxFileCount'],
                    'malwareScanningEnabled' => (bool) $validated['malwareScanningEnabled'],
                ];
                break;

            case 'routing':
                $rawPayload = $request->all();
                $routingPayload = $request->input('routing', $request->input('value', $rawPayload));

                // 1. Explicitly exclude system_alert from configurable scope
                if (isset($routingPayload['system_alert']) || isset($rawPayload['system_alert'])) {
                    return response()->json([
                        'message' => 'Validation Error: system_alert cannot be configured. System alerts are strictly hard-coded to Super Admin at dispatch level.',
                        'errors' => [
                            'system_alert' => ['System alerts are restricted to Super Admin and cannot be customized via recipient routing.'],
                        ],
                    ], 422);
                }

                $titles = [
                    'new_ticket' => 'New Ticket Alert',
                    'new_message' => 'New Message Alert',
                    'overdue_ticket' => 'Overdue Ticket Alert',
                ];

                $validTokens = [
                    'contextual_assigned',
                    'contextual_requester',
                    'role_cs',
                    'role_service',
                    'role_it_admin',
                    'role_superadmin',
                ];

                $currentRouting = TicketConfiguration::getByKey('routing', $this->defaults['routing']);
                $errors = [];
                $sanitizedRouting = [];

                foreach (['new_ticket', 'new_message', 'overdue_ticket'] as $scopeKey) {
                    if (array_key_exists($scopeKey, $routingPayload)) {
                        $recipients = $routingPayload[$scopeKey];

                        // Reject save with 0 recipients
                        if (!is_array($recipients) || count($recipients) === 0) {
                            $errors[$scopeKey] = ["At least one recipient is required for {$titles[$scopeKey]}."];
                            continue;
                        }

                        $validList = [];
                        foreach ($recipients as $token) {
                            if (!is_string($token) || trim($token) === '') continue;
                            $token = trim($token);
                            if (in_array($token, $validTokens, true) || preg_match('/^dept_\d+$/', $token)) {
                                $validList[] = $token;
                            }
                        }

                        if (count($validList) === 0) {
                            $errors[$scopeKey] = ["At least one valid recipient is required for {$titles[$scopeKey]}."];
                        } else {
                            $sanitizedRouting[$scopeKey] = array_values(array_unique($validList));
                        }
                    } else {
                        // Preserve existing if omitted in partial update
                        $sanitizedRouting[$scopeKey] = $currentRouting[$scopeKey] ?? $this->defaults['routing'][$scopeKey];
                    }
                }

                if (!empty($errors)) {
                    return response()->json([
                        'message' => 'Validation Error: Invalid recipient routing configuration.',
                        'errors' => $errors,
                    ], 422);
                }

                $value = $sanitizedRouting;
                $record = TicketConfiguration::setByKey('routing', $value);
                $this->clearRoutingCache();

                $actingUserId = $request->user()?->emp_id ?? $request->user()?->id ?? 1;

                try {
                    event(new NotificationRoutingUpdated($value, $actingUserId));
                } catch (\Throwable $e) {
                    Log::warning('Failed to dispatch NotificationRoutingUpdated: ' . $e->getMessage());
                }

                $this->logAudit(
                    $request,
                    'config_update',
                    'Notification Recipient Routing',
                    'Recipient Routing Rules',
                    'Updated notification recipient routing for ' . implode(', ', array_keys($value))
                );

                return response()->json([
                    'message' => "Notification recipient routing updated successfully.",
                    'key' => 'routing',
                    'value' => $record->value,
                ]);

            case 'business_hours':
                $validator = Validator::make($payload, [
                    'enabled' => 'required|boolean',
                    'timezone' => ['required', 'string', \Illuminate\Validation\Rule::in(\DateTimeZone::listIdentifiers())],
                    'startTime' => ['required', 'string', 'regex:/^([01]\d|2[0-3]):[0-5]\d$/'],
                    'endTime' => ['required', 'string', 'regex:/^([01]\d|2[0-3]):[0-5]\d$/'],
                    'workingDays' => 'required|array|min:1',
                    'workingDays.*' => 'integer|between:1,7',
                ], [
                    'timezone.in' => 'Please choose a valid timezone.',
                    'startTime.regex' => 'Start time must use the HH:MM format.',
                    'endTime.regex' => 'End time must use the HH:MM format.',
                    'workingDays.min' => 'Select at least one working day.',
                ]);
                $validator->after(function ($v) use ($payload) {
                    if (($payload['startTime'] ?? '') >= ($payload['endTime'] ?? '')) {
                        $v->errors()->add('endTime', 'End time must be later than start time.');
                    }
                });
                if ($validator->fails()) {
                    return response()->json([
                        'message' => 'Validation Error: Invalid business hours configuration.',
                        'errors' => $validator->errors(),
                    ], 422);
                }
                $validated = $validator->validated();
                $days = array_values(array_unique(array_map('intval', $validated['workingDays'])));
                sort($days);
                $value = [
                    'enabled' => (bool) $validated['enabled'],
                    'timezone' => $validated['timezone'],
                    'startTime' => $validated['startTime'],
                    'endTime' => $validated['endTime'],
                    'workingDays' => $days,
                ];
                break;

            case 'transitions':
                $request->validate([
                    'transitions' => 'sometimes|array',
                ]);
                $value = $request->has('transitions') ? $request->input('transitions') : $payload;
                break;

            case 'company_info':
                $validator = Validator::make($payload, [
                    'address' => 'required|string|min:5|max:500',
                    'contactNumber' => [
                        'required',
                        'string',
                        'regex:/^[\+]?[(]?[0-9]{1,4}[)]?[-\s\.\/0-9]{6,25}$/'
                    ],
                    // Plain `email` accepts dotless domains such as user@localhost; `filter` plus the
                    // TLD regex rejects those, consecutive dots, commas, and other malformed input.
                    'contactEmail' => ['required', 'string', 'max:255', 'email:rfc,filter', 'regex:/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/'],
                    'socialLinks' => 'nullable|array',
                    'socialLinks.*.id' => 'sometimes|string|max:64',
                    'socialLinks.*.platform' => 'required|string|in:LinkedIn,Facebook,Twitter / X,Twitter,YouTube,Instagram,Other',
                    'socialLinks.*.url' => [
                        'required',
                        'string',
                        function ($attribute, $value, $fail) {
                            if (!filter_var($value, FILTER_VALIDATE_URL) || !preg_match('/^https?:\/\//i', $value)) {
                                $fail('Please provide a valid web URL starting with http:// or https://.');
                            }
                        }
                    ],
                ], [
                    'address.required' => 'Headquarters address is required.',
                    'address.min' => 'Headquarters address must be at least 5 characters.',
                    'contactNumber.required' => 'Contact phone number is required.',
                    'contactNumber.regex' => 'Please provide a valid phone number (e.g. +63 2 8635 9999).',
                    'contactEmail.required' => 'Contact email is required.',
                    'contactEmail.email' => 'Please provide a valid contact email address.',
                    'contactEmail.regex' => 'Please provide a valid contact email address.',
                    'socialLinks.*.platform.in' => 'Selected social platform is not supported.',
                ]);

                if ($validator->fails()) {
                    return response()->json([
                        'message' => 'Validation Error: Invalid company information values.',
                        'errors' => $validator->errors(),
                    ], 422);
                }

                $validated = $validator->validated();
                $before = TicketConfiguration::getByKey('company_info', $this->defaults['company_info']);

                $cleanSocial = [];
                if (!empty($validated['socialLinks'])) {
                    foreach ($validated['socialLinks'] as $idx => $link) {
                        $cleanSocial[] = [
                            'id' => $link['id'] ?? ('soc-' . ($idx + 1)),
                            'platform' => $link['platform'],
                            'url' => trim($link['url']),
                        ];
                    }
                }

                $value = [
                    'address' => trim($validated['address']),
                    'contactNumber' => trim($validated['contactNumber']),
                    'contactEmail' => trim($validated['contactEmail']),
                    'socialLinks' => $cleanSocial,
                ];

                $record = TicketConfiguration::setByKey('company_info', $value);
                $this->clearConfigCache('company_info');

                $this->logAudit(
                    $request,
                    'config_update',
                    'Company Information',
                    'Corporate Profile',
                    'Updated corporate profile, contact lines, and social links.',
                    $before,
                    $value
                );

                return response()->json([
                    'message' => "Company information updated successfully.",
                    'key' => 'company_info',
                    'value' => $record->value,
                ]);

            case 'system_status':
                $statusInput = is_array($payload) ? ($payload['status'] ?? null) : $payload;
                $validator = Validator::make(['status' => $statusInput], [
                    'status' => 'required|string|in:Operational,Under Maintenance',
                ], [
                    'status.in' => 'System status must be either Operational or Under Maintenance.',
                ]);

                if ($validator->fails()) {
                    return response()->json([
                        'message' => 'Validation Error: Invalid system status.',
                        'errors' => $validator->errors(),
                    ], 422);
                }

                $newStatus = $validator->validated()['status'];
                $before = TicketConfiguration::getByKey('system_status', $this->defaults['system_status']);
                $oldStatus = is_array($before) ? ($before['status'] ?? 'Operational') : ($before ?: 'Operational');

                $value = ['status' => $newStatus];
                $record = TicketConfiguration::setByKey('system_status', $value);

                // Set in Redis for instantaneous multi-service access
                try {
                    Cache::forever('system:config:status', $newStatus);
                    Redis::set('system:config:status', $newStatus);
                } catch (\Throwable $e) {
                    Log::warning('Failed setting Redis status: ' . $e->getMessage());
                }
                $this->clearConfigCache('system_status');

                // Broadcast event
                $actingUserId = $request->user()?->emp_id ?? $request->user()?->id ?? 1;
                try {
                    event(new SystemStatusUpdated($newStatus, $actingUserId));
                } catch (\Throwable $e) {
                    Log::warning('Broadcasting SystemStatusUpdated failed: ' . $e->getMessage());
                }

                $auditText = "Updated system status from '{$oldStatus}' to '{$newStatus}'. Advisory banners and login restrictions are now " . ($newStatus === 'Under Maintenance' ? 'active.' : 'cleared.');
                $this->logAudit(
                    $request,
                    'config_update',
                    'System Status',
                    'Platform Operating State',
                    $auditText,
                    ['status' => $oldStatus],
                    ['status' => $newStatus]
                );

                return response()->json([
                    'message' => "System status updated successfully to '{$newStatus}'.",
                    'key' => 'system_status',
                    'value' => $record->value,
                    'status' => $newStatus,
                ]);

            case 'log_level':
                $levelInput = is_array($payload) ? ($payload['level'] ?? null) : $payload;
                $normalizedInput = ucfirst(strtolower(trim($levelInput ?? '')));
                $validator = Validator::make(['level' => $normalizedInput], [
                    'level' => 'required|string|in:Error,Warning,Info,Debug',
                ], [
                    'level.in' => 'Log level must be one of: Error, Warning, Info, Debug.',
                ]);

                if ($validator->fails()) {
                    return response()->json([
                        'message' => 'Validation Error: Invalid log level.',
                        'errors' => $validator->errors(),
                    ], 422);
                }

                $newLevel = $validator->validated()['level'];
                $before = TicketConfiguration::getByKey('log_level', $this->defaults['log_level']);
                $oldLevel = is_array($before) ? ($before['level'] ?? 'Info') : ($before ?: 'Info');

                $value = ['level' => $newLevel];
                $record = TicketConfiguration::setByKey('log_level', $value);

                // Set in Redis for immediate dynamic runtime logging across services
                try {
                    Cache::forever('system:config:log_level', $newLevel);
                    Redis::set('system:config:log_level', $newLevel);
                } catch (\Throwable $e) {
                    Log::warning('Failed setting Redis log level: ' . $e->getMessage());
                }

                // Wire active request logging level dynamically without container restart
                $normLower = strtolower($newLevel);
                config([
                    'logging.channels.single.level' => $normLower,
                    'logging.channels.daily.level' => $normLower,
                ]);

                $this->clearConfigCache('log_level');

                // Broadcast event
                $actingUserId = $request->user()?->emp_id ?? $request->user()?->id ?? 1;
                try {
                    event(new LogLevelUpdated($newLevel, $actingUserId));
                } catch (\Throwable $e) {
                    Log::warning('Broadcasting LogLevelUpdated failed: ' . $e->getMessage());
                }

                $auditText = "Updated diagnostic log level from '{$oldLevel}' to '{$newLevel}'. Runtime HTTP requests adopt this verbosity immediately.";
                $this->logAudit(
                    $request,
                    'config_update',
                    'Log Level Configuration',
                    'Logging Verbosity',
                    $auditText,
                    ['level' => $oldLevel],
                    ['level' => $newLevel]
                );

                return response()->json([
                    'message' => "Log level updated successfully to '{$newLevel}'.",
                    'key' => 'log_level',
                    'value' => $record->value,
                    'level' => $newLevel,
                ]);

            case 'messaging':
                $validator = Validator::make($payload, [
                    'default_participants' => 'sometimes|string',
                    'allow_delegated_employee' => 'sometimes|boolean',
                    'allow_full_history' => 'sometimes|boolean',
                    'notify_on_employee_join' => 'sometimes|boolean',
                    'internal' => 'sometimes|array',
                    'internal.mode' => 'sometimes|string|in:requestor_cs_only,requestor_cs_delegated',
                    'internal.allow_direct_assigned' => 'sometimes|boolean',
                    'internal.allow_full_history' => 'sometimes|boolean',
                    'internal.notify_on_activity' => 'sometimes|boolean',
                ]);

                if ($validator->fails()) {
                    return response()->json([
                        'message' => 'Validation Error: Invalid messaging configuration values.',
                        'errors' => $validator->errors(),
                    ], 422);
                }

                $validated = $validator->validated();
                $current = TicketConfiguration::getByKey('messaging', $this->defaults['messaging']);
                if (!is_array($current)) {
                    $current = $this->defaults['messaging'];
                }

                $defaultInternal = $this->defaults['messaging']['internal'] ?? [
                    'mode' => 'requestor_cs_delegated',
                    'allow_direct_assigned' => true,
                    'allow_full_history' => true,
                    'notify_on_activity' => true,
                ];
                $currentInternal = isset($current['internal']) && is_array($current['internal'])
                    ? array_merge($defaultInternal, $current['internal'])
                    : $defaultInternal;

                $incomingInternal = $validated['internal'] ?? null;
                $mergedInternal = $incomingInternal !== null
                    ? array_merge($currentInternal, $incomingInternal)
                    : $currentInternal;

                $value = array_merge($current, $validated);
                $value['internal'] = $mergedInternal;
                $record = TicketConfiguration::setByKey('messaging', $value);
                $this->clearConfigCache('messaging');

                $internalMode = $value['internal']['mode'] ?? 'requestor_cs_delegated';
                $this->logAudit(
                    $request,
                    'config_update',
                    'Ticket Messaging Configuration',
                    'Messaging Participation',
                    'Updated ticket messaging participation rules (allow_delegated_employee: ' . (!empty($value['allow_delegated_employee']) ? 'true' : 'false') . ', internal_mode: ' . $internalMode . ')',
                    $current,
                    $value
                );

                return response()->json([
                    'message' => 'Ticket messaging configuration updated successfully.',
                    'key' => 'messaging',
                    'value' => $record->value,
                    'data' => $record->value,
                ]);

            default:
                $value = $payload;
                break;
        }

        $record = TicketConfiguration::setByKey($normalizedKey, $value);

        if ($normalizedKey === 'limits') {
            $this->clearConfigCache('limits');
        } elseif ($normalizedKey === 'transitions') {
            // ticket-service and employee-service cache the matrix; clear it so edits apply immediately.
            $this->clearConfigCache('transitions');
            $this->logAudit(
                $request,
                'config_update',
                'Ticket Configuration',
                'Transition Matrix',
                'Updated the ticket status transition matrix. New rules apply to the next status change.'
            );
        } elseif ($normalizedKey === 'business_hours') {
            $this->clearConfigCache('business_hours');
            $dayNames = [1 => 'Mon', 2 => 'Tue', 3 => 'Wed', 4 => 'Thu', 5 => 'Fri', 6 => 'Sat', 7 => 'Sun'];
            $daysText = implode(', ', array_map(fn ($d) => $dayNames[$d] ?? $d, $value['workingDays']));
            $this->logAudit(
                $request,
                'config_update',
                'SLA Configuration',
                'Business Hours',
                $value['enabled']
                    ? "SLA business hours set to {$value['startTime']} to {$value['endTime']} ({$value['timezone']}) on {$daysText}. Applies to SLA deadlines calculated from now on."
                    : 'SLA business hours disabled: SLA limits now count around the clock. Applies to SLA deadlines calculated from now on.'
            );
        } elseif ($normalizedKey === 'number_format') {
            $this->clearConfigCache('number_format');
            $this->logAudit(
                $request,
                'config_update',
                'Ticket Configuration',
                'Ticket Number Format',
                "Updated ticket number format configuration."
            );
        } elseif ($normalizedKey === 'defaults') {
            $this->clearConfigCache('defaults');
            $this->logAudit(
                $request,
                'config_update',
                'Ticket Configuration',
                'Ticket Defaults',
                "Updated ticket defaults configuration."
            );
        } elseif ($normalizedKey === 'file_limits') {
            $this->clearConfigCache('file_limits');
            try {
                Cache::forever('ticket:config:file_limits', $value);
                Redis::set('ticket:config:file_limits', json_encode($value));
            } catch (\Throwable $e) {}
            $this->logAudit(
                $request,
                'config_update',
                'Ticket Configuration',
                'File Upload & Security Limits',
                "Updated file upload limits: max file size {$value['maxFileSizeMB']}MB, max file count {$value['maxFileCount']}, malware scanning " . ($value['malwareScanningEnabled'] ? 'enabled' : 'disabled') . "."
            );
        } else {
            $this->logAudit(
                $request,
                'config_update',
                'Ticket Configuration',
                ucwords(str_replace('_', ' ', $normalizedKey)),
                "Updated configuration section '{$normalizedKey}'."
            );
        }

        return response()->json([
            'message' => "Configuration for '{$normalizedKey}' updated successfully.",
            'key' => $normalizedKey,
            'value' => $record->value,
        ]);
    }

    /**
     * Reset a configuration section to its default values.
     */
    public function reset(string $key): JsonResponse
    {
        $normalizedKey = str_replace('-', '_', $key);
        if ($normalizedKey === 'ticket_defaults') {
            $normalizedKey = 'defaults';
        }
        if ($normalizedKey === 'files') {
            $normalizedKey = 'file_limits';
        }
        $authErr = $normalizedKey === 'limits'
            ? $this->checkTrustedTicketService(request())
            : $this->checkAuthorized(request());
        if ($authErr) {
            return $authErr;
        }

        if (!array_key_exists($normalizedKey, $this->defaults)) {
            return response()->json(['message' => "Invalid configuration section '{$key}'."], 422);
        }

        $before = TicketConfiguration::getByKey($normalizedKey, $this->defaults[$normalizedKey]);
        $defaultValue = $this->defaults[$normalizedKey];
        $record = TicketConfiguration::setByKey($normalizedKey, $defaultValue);

        if (in_array($normalizedKey, ['transitions', 'business_hours'], true)) {
            $this->clearConfigCache($normalizedKey);
        }

        if ($normalizedKey === 'windows') {
            $this->clearWindowCache();

            try {
                event(new TicketWindowConfigUpdated($defaultValue, null));
            } catch (\Throwable $e) {}
        }

        if ($normalizedKey === 'routing') {
            $this->clearRoutingCache();

            try {
                event(new NotificationRoutingUpdated($defaultValue, null));
            } catch (\Throwable $e) {}
        }

        if ($normalizedKey === 'system_status') {
            try {
                Cache::forever('system:config:status', 'Operational');
                Redis::set('system:config:status', 'Operational');
                event(new SystemStatusUpdated('Operational', null));
            } catch (\Throwable $e) {}
            $this->clearConfigCache('system_status');
        }

        if ($normalizedKey === 'log_level') {
            try {
                Cache::forever('system:config:log_level', 'Info');
                Redis::set('system:config:log_level', 'Info');
                config([
                    'logging.channels.single.level' => 'info',
                    'logging.channels.daily.level' => 'info',
                ]);
                event(new LogLevelUpdated('Info', null));
            } catch (\Throwable $e) {}
            $this->clearConfigCache('log_level');
        }

        if ($normalizedKey === 'company_info') {
            $this->clearConfigCache('company_info');
        }

        if ($normalizedKey === 'number_format') {
            $this->clearConfigCache('number_format');
        }

        if ($normalizedKey === 'defaults') {
            $this->clearConfigCache('defaults');
        }

        if ($normalizedKey === 'file_limits') {
            $this->clearConfigCache('file_limits');
            try {
                Cache::forever('ticket:config:file_limits', $defaultValue);
                Redis::set('ticket:config:file_limits', json_encode($defaultValue));
            } catch (\Throwable $e) {}
        }

        if ($normalizedKey === 'limits') {
            $this->clearConfigCache('limits');
        } else {
            $this->logAudit(
                request(),
                'config_reset',
                ucwords(str_replace('_', ' ', $normalizedKey)),
                ucwords(str_replace('_', ' ', $normalizedKey)),
                "Reset configuration section '{$normalizedKey}' to system defaults.",
                $before,
                $defaultValue
            );
        }

        return response()->json([
            'message' => "Configuration for '{$normalizedKey}' reset to defaults.",
            'key' => $normalizedKey,
            'value' => $record->value,
        ]);
    }
}
