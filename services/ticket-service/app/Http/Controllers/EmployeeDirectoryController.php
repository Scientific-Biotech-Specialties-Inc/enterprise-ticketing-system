<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class EmployeeDirectoryController extends Controller
{
    /**
     * Synchronize employees from the Auth Module if not synced in the last 60s.
     * Delegates to the single shared sync (spec 0031 AC-13); the scheduler runs it every minute.
     */
    public static function autoSyncWithAuthModule(): void
    {
        app(\App\Services\EmployeeDirectorySyncService::class)->sync();
    }

    /**
     * Resolve category track (Service, IT, Others) for a ticket (TS110).
     */
    public static function resolveCategoryTrack($ticket): string
    {
        if (!$ticket) {
            return 'service';
        }

        $categoryName = '';
        if (!empty($ticket->problem_category_ID)) {
            $categoryName = DB::table('problem_categories')
                ->where('problem_category_ID', $ticket->problem_category_ID)
                ->value('category_name') ?? '';
        }

        $deptName = '';
        if (!empty($ticket->department_id)) {
            $deptName = DB::table('departments')
                ->where('id', $ticket->department_id)
                ->value('name') ?? '';
        }

        // Pull category-track rules from Configuration Service if available (TS110)
        try {
            $configuredTrack = \Illuminate\Support\Facades\Cache::remember('config:track:' . ($ticket->problem_category_ID ?? 0), 60, function () use ($categoryName) {
                $configUrl = env('CONFIGURATION_SERVICE_URL', 'http://configuration-service:8000');
                $res = \Illuminate\Support\Facades\Http::timeout(2)->get("{$configUrl}/api/ticket-configurations/category_track_rules");
                if ($res->successful()) {
                    $rules = $res->json('value') ?? $res->json();
                    if (is_array($rules)) {
                        $key = strtolower(trim($categoryName));
                        return $rules[$key] ?? null;
                    }
                }
                return null;
            });
            if ($configuredTrack && in_array(strtolower($configuredTrack), ['service', 'it', 'others'], true)) {
                return strtolower($configuredTrack);
            }
        } catch (\Throwable $e) {}

        $combined = strtolower($categoryName . ' ' . $deptName . ' ' . ($ticket->title ?? '') . ' ' . ($ticket->description ?? ''));

        if (preg_match('/\b(it|information technology|software|network|system|server|database|computer|login|password|wifi|bug|api)\b/i', $combined)) {
            return 'it';
        }

        if (preg_match('/\b(service|biomedical|machine|hardware|device|calibration|repair|equipment|imaging|clinical|maintenance|failure)\b/i', $combined)) {
            return 'service';
        }

        return 'others';
    }

    /**
     * Check if an employee qualifies for a category track and branch (TS110).
     */
    public static function checkEligibility($emp, $ticket = null, string $track = 'service', bool $isEscalation = false): array
    {
        $dept = strtolower(trim((string) ($emp->department ?? '')));
        $role = strtolower(trim((string) ($emp->role ?? '')));
        $pos = strtolower(trim((string) ($emp->position_level ?? '')));
        $tech = strtolower(trim((string) ($emp->technical_role ?? '')));

        // Admins, SuperAdmins, Customer Service cannot be assigned to tickets
        if (str_contains($role, 'admin') || str_contains($pos, 'admin') || str_contains($tech, 'admin') ||
            in_array($role, ['customer service', 'customer support', 'cs', 'head of cs', 'head of customer service', 'customer', 'superadmin', 'super admin'], true)) {
            return [
                'eligible' => false,
                'reason' => 'Administrative and Customer Support staff cannot be assigned to tickets.',
            ];
        }

        // Both Service and IT are technical operational departments eligible for tickets
        if (!in_array($dept, ['service', 'it', 'it support'], true)) {
            return [
                'eligible' => false,
                'reason' => "Employee department '{$emp->department}' does not qualify. Required: Service or IT.",
            ];
        }

        if ($ticket) {
            $hasBranchCol = \Illuminate\Support\Facades\Schema::hasColumn('employees', 'branch');
            $hasBranchIdCol = \Illuminate\Support\Facades\Schema::hasColumn('employees', 'branch_id');
            $empBranch = null;
            if ($hasBranchCol && isset($emp->branch)) {
                $empBranch = $emp->branch;
            } elseif ($hasBranchIdCol && isset($emp->branch_id)) {
                $empBranch = $emp->branch_id;
            }

            $ticketBranchName = null;
            if (!empty($ticket->branch_id)) {
                $ticketBranchName = DB::table('branches')->where('id', $ticket->branch_id)->value('name');
            }
            if (!$ticketBranchName && !empty($ticket->branch)) {
                $ticketBranchName = $ticket->branch;
            }
            if (!$ticketBranchName) {
                $ticketBranchName = 'Main Branch';
            }

            if ($empBranch && strtolower((string)$empBranch) !== 'all' && strtolower((string)$ticketBranchName) !== 'all') {
                $normEmp = trim(preg_replace('/\b(branch|office)\b/i', '', strtolower((string)$empBranch)));
                $normTicket = trim(preg_replace('/\b(branch|office)\b/i', '', strtolower((string)$ticketBranchName)));

                $matched = ($normEmp === $normTicket)
                    || (strtolower((string)$empBranch) === strtolower((string)$ticketBranchName))
                    || ($normEmp === 'main' || $normTicket === 'main');

                if (!$matched) {
                    return [
                        'eligible' => false,
                        'reason' => "Branch mismatch: employee belongs to {$empBranch}, but ticket is designated for {$ticketBranchName}.",
                    ];
                }
            }
        }

        return [
            'eligible' => true,
            'reason' => null,
        ];
    }

    /**
     * Get list of assignable employees filtered by department, track, and exclude requested_by (TS110).
     */
    public function assignableEmployees(Request $request)
    {
        self::autoSyncWithAuthModule();
        $department = $request->query('department');
        $ticketId = $request->query('ticket_id');
        $track = $request->query('track');

        $query = DB::table('employees')
            ->select('emp_id as id', DB::raw("CONCAT(first_name, ' ', last_name) as name"), 'email', 'role', 'department', 'position_level', 'technical_role', 'is_active')
            ->where('is_active', 1)
            ->whereIn('department', ['Service', 'IT'])
            ->whereNotIn(DB::raw('LOWER(COALESCE(role, ""))'), [
                'admin', 'it admin', 'superadmin', 'super admin', 'administrator', 'system administrator',
                'customer service', 'head of cs', 'head of customer service', 'cs', 'customer'
            ])
            ->whereNotIn(DB::raw('LOWER(COALESCE(position_level, ""))'), ['admin', 'superadmin'])
            ->whereNotIn(DB::raw('LOWER(COALESCE(technical_role, ""))'), [
                'admin', 'it admin', 'superadmin', 'super admin', 'administrator', 'system administrator'
            ]);

        if (\Illuminate\Support\Facades\Schema::hasColumn('employees', 'branch')) {
            $query->addSelect('branch');
        } elseif (\Illuminate\Support\Facades\Schema::hasColumn('employees', 'branch_id')) {
            $query->addSelect('branch_id as branch');
        }

        if ($department) {
            $query->where('department', $department);
        }

        $ticket = null;
        if ($ticketId) {
            $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
            if ($ticket && !empty($ticket->requested_by)) {
                $query->where('emp_id', '!=', $ticket->requested_by);
            }
        }

        $isEscalation = $request->boolean('is_escalation') || $request->query('context') === 'escalate';
        $resolvedTrack = $track ? strtolower($track) : ($ticket ? self::resolveCategoryTrack($ticket) : null);

        $employees = $query
            ->orderByDesc('is_active')
            ->orderBy(DB::raw("CONCAT(first_name, ' ', last_name)"))
            ->get();

        if ($resolvedTrack) {
            $employees = $employees->filter(function ($emp) use ($ticket, $resolvedTrack) {
                $res = self::checkEligibility($emp, $ticket, $resolvedTrack, $isEscalation);
                return $res['eligible'];
            })->values();
        }

        return response()->json([
            'employees' => $employees,
            'track' => $resolvedTrack,
        ]);
    }

    /**
     * Filter employee eligibility based on ticket category tracks (TS110).
     */
    public function eligibleEmployees(Request $request, int $ticketId)
    {
        self::autoSyncWithAuthModule();
        $ticket = null;
        if ($ticketId > 0) {
            $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        }

        if (!$ticket) {
            $ticket = (object) [
                'ticket_ID' => $ticketId,
                'ticket_number' => null,
                'branch_id' => $request->query('branch_id', 1),
                'problem_category_ID' => $request->query('category_id'),
                'requested_by' => null,
            ];
        }

        $isEscalation = $request->boolean('is_escalation') || $request->query('context') === 'escalate';
        $trackOverride = $request->query('track');
        $track = $trackOverride ? strtolower(trim($trackOverride)) : self::resolveCategoryTrack($ticket);

        $query = DB::table('employees')
            ->select('emp_id as id', DB::raw("CONCAT(first_name, ' ', last_name) as name"), 'email', 'role', 'department', 'position_level', 'technical_role', 'is_active')
            ->where('is_active', 1)
            ->whereIn('department', ['Service', 'IT'])
            ->whereNotIn(DB::raw('LOWER(COALESCE(role, ""))'), [
                'admin', 'it admin', 'superadmin', 'super admin', 'administrator', 'system administrator',
                'customer service', 'head of cs', 'head of customer service', 'cs', 'customer'
            ])
            ->whereNotIn(DB::raw('LOWER(COALESCE(position_level, ""))'), ['admin', 'superadmin'])
            ->whereNotIn(DB::raw('LOWER(COALESCE(technical_role, ""))'), [
                'admin', 'it admin', 'superadmin', 'super admin', 'administrator', 'system administrator'
            ]);

        if (\Illuminate\Support\Facades\Schema::hasColumn('employees', 'branch')) {
            $query->addSelect('branch');
        } elseif (\Illuminate\Support\Facades\Schema::hasColumn('employees', 'branch_id')) {
            $query->addSelect('branch_id as branch');
        }

        $requestedBy = $ticket->requested_by ?? null;
        if ($requestedBy) {
            $query->where('emp_id', '!=', $requestedBy);
        }

        $employees = $query->orderByDesc('is_active')->orderBy('first_name')->get();

        $eligible = [];
        $ineligible = [];

        foreach ($employees as $emp) {
            $eligibility = self::checkEligibility($emp, $ticket, $track, $isEscalation);
            $defaultPos = (strcasecmp((string)$emp->department, 'Service') === 0) ? 'Engineer' : 'Employee';
            $empPosLevel = $emp->position_level;
            if (empty($empPosLevel) || in_array(strtolower($empPosLevel), ['senior', 'mid', 'junior'])) {
                $empPosLevel = (stripos((string)$emp->role, 'manager') !== false) ? 'Manager' : $defaultPos;
            }
            $empTechRole = $emp->technical_role;
            if (empty($empTechRole) || in_array(strtolower($empTechRole), ['specialist', 'technician', 'service technician', 'it support specialist'])) {
                $empTechRole = $empPosLevel;
            }

            $item = [
                'id' => (int) $emp->id,
                'name' => $emp->name,
                'email' => $emp->email,
                'role' => $emp->role,
                'department' => $emp->department,
                'branch' => $emp->branch ?? 'Main',
                'position_level' => $empPosLevel,
                'technical_role' => $empTechRole,
                'availability_status' => (bool) $emp->is_active ? 'available' : 'unavailable',
                'is_active' => (bool) $emp->is_active,
                'eligible' => $eligibility['eligible'],
                'ineligibility_reason' => $eligibility['reason'],
            ];

            if ($eligibility['eligible']) {
                $eligible[] = $item;
            } else {
                $ineligible[] = $item;
            }
        }

        $departmentManagers = self::fetchDepartmentManagers();

        return response()->json([
            'ticket_id' => (int) $ticketId,
            'ticket_number' => $ticket->ticket_number ?? null,
            'track' => $track,
            'branch' => (!empty($ticket->branch_id) ? (DB::table('branches')->where('id', $ticket->branch_id)->value('name') ?? 'Main Branch') : 'Main Branch'),
            'eligible_count' => count($eligible),
            'ineligible_count' => count($ineligible),
            'eligible_employees' => $eligible,
            'ineligible_employees' => $ineligible,
            'department_managers' => $departmentManagers,
        ]);
    }

    /**
     * Fetch designated department escalation managers.
     */
    public static function fetchDepartmentManagers(): array
    {
        return \Illuminate\Support\Facades\Cache::remember('department_managers:cache', 60, function () {
            $managerEmps = DB::table('employees')
                ->where(function ($q) {
                    $q->whereRaw('LOWER(COALESCE(position_level, "")) = ?', ['manager'])
                      ->orWhereRaw('LOWER(COALESCE(role, "")) LIKE ?', ['%manager%']);
                })
                ->where('is_active', 1)
                ->orderByDesc('last_synced_at')
                ->orderByDesc('emp_id')
                ->select(
                    'emp_id as id',
                    DB::raw("CONCAT(first_name, ' ', last_name) as name"),
                    'email',
                    'phone_number',
                    'role',
                    'department',
                    'position_level',
                    'technical_role',
                    'branch'
                )
                ->get();

            $serviceMgr = null;
            $itMgr = null;
            $csMgr = null;

            foreach ($managerEmps as $m) {
                $deptLower = strtolower(trim((string) $m->department));

                if (!$serviceMgr && $deptLower === 'service') {
                    $serviceMgr = [
                        'id' => (int) $m->id,
                        'name' => $m->name,
                        'email' => $m->email,
                        'phone' => $m->phone_number ?? '+63 917 123 4567',
                        'department' => 'Service',
                        'position_level' => 'Manager',
                        'role' => $m->role ?: 'Lead Service Engineer',
                        'technical_role' => $m->technical_role ?: 'Lead Service Engineer',
                        'branch' => $m->branch ?: 'Main Branch',
                    ];
                } elseif (!$itMgr && ($deptLower === 'it' || $deptLower === 'it support')) {
                    $itMgr = [
                        'id' => (int) $m->id,
                        'name' => $m->name,
                        'email' => $m->email,
                        'phone' => $m->phone_number ?? '+63 917 234 5678',
                        'department' => 'IT',
                        'position_level' => 'Manager',
                        'role' => $m->role ?: 'IT Systems Specialist',
                        'technical_role' => $m->technical_role ?: 'IT Systems Specialist',
                        'branch' => $m->branch ?: 'Main Branch',
                    ];
                } elseif (!$csMgr && ($deptLower === 'customer service' || $deptLower === 'cs')) {
                    $csMgr = [
                        'id' => (int) $m->id,
                        'name' => $m->name,
                        'email' => $m->email,
                        'phone' => $m->phone_number ?? '+63 917 345 6789',
                        'department' => 'Customer Service',
                        'position_level' => 'Manager',
                        'role' => $m->role ?: 'Customer Support Manager',
                        'technical_role' => $m->technical_role ?: 'Customer Support Manager',
                        'branch' => $m->branch ?: 'Main Branch',
                    ];
                }
            }

            return [
                'service' => $serviceMgr,
                'it' => $itMgr,
                'cs' => $csMgr,
            ];
        });
    }

    /**
     * Get all active departments.
     */
    public function getDepartments(Request $request)
    {
        $rows = DB::table('departments')
            ->where('is_active', true)
            ->orderBy('name')
            ->get(['id', 'name']);

        return response()->json([
            'departments' => $rows,
        ]);
    }

    /**
     * Get the authenticated employee's profile info as synced from the Auth system (TS105).
     * Includes last synced timestamp, read-only field metadata, and graceful fallback to cached record.
     */
    public function employeeProfile(Request $request)
    {
        $user = $request->user();
        if (!$user || $user instanceof \App\Models\Client) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
        }

        $empId = $user->emp_id ?? $user->id;
        $employee = DB::table('employees')->where('emp_id', $empId)->first();
        if (!$employee) {
            return response()->json(['success' => false, 'message' => 'Employee profile not found'], 404);
        }

        $authSyncStatus = 'synced';
        $syncNote = null;
        $authServiceUrl = env('CUSTOMER_SERVICE_URL', 'http://customer-service:8000');
        $token = $request->bearerToken();

        // Attempt live sync from central Auth system
        try {
            $client = \Illuminate\Support\Facades\Http::timeout(3);
            if ($token) {
                $client = $client->withToken($token);
            }
            $res = $client->get("{$authServiceUrl}/api/auth/me");
            if ($res->successful()) {
                $authData = $res->json('user') ?? $res->json('data') ?? $res->json();
                if (is_array($authData)) {
                    $updates = [];
                    if (\Illuminate\Support\Facades\Schema::hasColumn('employees', 'last_synced_at')) {
                        $updates['last_synced_at'] = now();
                    }
                    if (!empty($authData['first_name'])) $updates['first_name'] = $authData['first_name'];
                    if (!empty($authData['last_name'])) $updates['last_name'] = $authData['last_name'];
                    if (!empty($authData['email'])) $updates['email'] = $authData['email'];
                    if (!empty($authData['role'])) $updates['role'] = $authData['role'];
                    if (!empty($authData['department'])) $updates['department'] = $authData['department'];
                    $authBranch = $authData['branch'] ?? ($authData['branch_details']['name'] ?? null);
                    $authBranchId = $authData['branch_id'] ?? ($authData['branch_details']['id'] ?? null);
                    if ($authBranch !== null && \Illuminate\Support\Facades\Schema::hasColumn('employees', 'branch')) {
                        $updates['branch'] = $authBranch;
                    }
                    if ($authBranchId !== null && \Illuminate\Support\Facades\Schema::hasColumn('employees', 'branch_id')) {
                        $updates['branch_id'] = is_numeric($authBranchId) ? (int) $authBranchId : null;
                    }

                    if (!empty($updates)) {
                        DB::table('employees')->where('emp_id', $empId)->update($updates);
                        $employee = DB::table('employees')->where('emp_id', $empId)->first();
                    }
                }
            } else {
                $authSyncStatus = 'cached';
                $syncNote = 'Central Auth service responded with error; displaying last known synced profile data.';
            }
        } catch (\Throwable $e) {
            // Graceful degradation when Auth service is temporarily unavailable (TS105)
            $authSyncStatus = 'cached';
            $syncNote = 'Central Auth service is temporarily unavailable; displaying last known cached profile data.';
        }

        $empRoleNorm = strtolower(trim((string) ($employee->role ?? '')));
        $empEmailNorm = strtolower(trim((string) ($employee->email ?? '')));
        $isAdminOrSuperAdmin = in_array($empEmailNorm, ['admin@example.com', 'superadmin@example.com'], true)
            || in_array($empRoleNorm, ['superadmin', 'super admin', 'admin', 'it admin'], true);

        $hasBranch = \Illuminate\Support\Facades\Schema::hasColumn('employees', 'branch');
        $hasBranchId = \Illuminate\Support\Facades\Schema::hasColumn('employees', 'branch_id');
        $branchValue = $hasBranch ? $employee->branch : null;
        $branchIdValue = $hasBranchId ? $employee->branch_id : null;
        $lastSynced = $employee->last_synced_at ?? $employee->last_seen_at ?? null;

        return response()->json([
            'success' => true,
            'data' => [
                'emp_id' => (int) $employee->emp_id,
                'employee_id' => (string) $employee->emp_id,
                'name' => trim(($employee->first_name ?? '') . ' ' . ($employee->last_name ?? '')),
                'first_name' => $employee->first_name,
                'last_name' => $employee->last_name,
                'email' => $employee->email,
                'department' => $employee->department,
                'role' => $employee->role,
                'branch' => $branchValue,
                'branch_id' => $branchIdValue,
                'phone_number' => $employee->phone_number ?? null,
                'is_active' => (bool) $employee->is_active,
                'last_synced_at' => $lastSynced,
                'auth_sync_status' => $authSyncStatus,
                'sync_note' => $syncNote,
                'auth_sourced_fields' => [
                    'emp_id' => ['label' => 'Employee ID', 'read_only' => true],
                    'name' => ['label' => 'Full Name', 'read_only' => true],
                    'first_name' => ['label' => 'First Name', 'read_only' => true],
                    'last_name' => ['label' => 'Last Name', 'read_only' => true],
                    'email' => ['label' => 'Email Address', 'read_only' => true],
                    'department' => ['label' => 'Department', 'read_only' => true],
                    'role' => ['label' => 'Role / Job Title', 'read_only' => true],
                    'branch' => ['label' => 'Branch Assignment', 'read_only' => true],
                ],
                'editable_fields' => [
                    'phone_number' => ['label' => 'Contact / Phone Number', 'read_only' => false],
                ],
            ],
            // Backwards-compatible root keys
            'emp_id' => $employee->emp_id,
            'name' => trim(($employee->first_name ?? '') . ' ' . ($employee->last_name ?? '')),
            'first_name' => $employee->first_name,
            'last_name' => $employee->last_name,
            'email' => $employee->email,
            'department' => $employee->department,
            'role' => $employee->role,
            'branch' => $branchValue,
            'branch_id' => $branchIdValue,
            'last_synced_at' => $lastSynced,
        ]);
    }

    /**
     * Update employee profile (TS105).
     * Rejects any attempt to modify central Auth-sourced fields server-side with 403 Forbidden.
     */
    public function updateProfile(Request $request)
    {
        $user = $request->user();
        if (!$user || $user instanceof \App\Models\Client) {
            return response()->json(['success' => false, 'message' => 'Unauthorized'], 401);
        }

        $empId = $user->emp_id ?? $user->id;
        $employee = DB::table('employees')->where('emp_id', $empId)->first();
        if (!$employee) {
            return response()->json(['success' => false, 'message' => 'Employee not found'], 404);
        }

        $authSourcedFields = ['emp_id', 'employee_id', 'first_name', 'last_name', 'name', 'email', 'department', 'role', 'branch'];
        $attemptedAuthFields = [];

        foreach ($authSourcedFields as $field) {
            if ($request->has($field)) {
                $incomingVal = trim((string) $request->input($field));
                $currentVal = trim((string) ($employee->$field ?? ''));
                if ($incomingVal !== '' && $incomingVal !== $currentVal) {
                    $attemptedAuthFields[] = $field;
                }
            }
        }

        if (!empty($attemptedAuthFields)) {
            return response()->json([
                'success' => false,
                'message' => 'Forbidden: Central identity and role fields are synced from the central Auth system and are read-only.',
                'error_code' => 'AUTH_SOURCED_FIELD_READ_ONLY',
                'rejected_fields' => $attemptedAuthFields,
            ], 403);
        }

        // Allow update of local non-auth fields (e.g. phone_number)
        $updates = [];
        if ($request->has('phone_number') && \Illuminate\Support\Facades\Schema::hasColumn('employees', 'phone_number')) {
            $updates['phone_number'] = $request->input('phone_number');
        }

        if (!empty($updates)) {
            DB::table('employees')->where('emp_id', $empId)->update($updates);
        }

        return $this->employeeProfile($request);
    }

    /**
     * Search and filter employees by name, department, branch, or role (TS107).
     * Supports combinable filters, pagination, and strictly enforces Admin branch scope.
     */
    public function searchEmployees(Request $request)
    {
        $user = $request->user();
        $queryText = trim((string) ($request->query('q') ?? $request->query('name') ?? $request->query('search') ?? ''));
        $department = trim((string) $request->query('department', ''));
        $branch = trim((string) $request->query('branch', ''));
        $role = trim((string) $request->query('role', ''));
        $status = trim((string) $request->query('status', ''));
        $page = max(1, (int) $request->query('page', 1));
        $perPage = max(1, min(100, (int) $request->query('per_page', 15)));

        $isSqlite = DB::getDriverName() === 'sqlite';
        $concatNameRaw = $isSqlite ? "(first_name || ' ' || last_name)" : "CONCAT(first_name, ' ', last_name)";

        $query = DB::table('employees')
            ->select(
                'emp_id as id',
                'first_name',
                'last_name',
                DB::raw("{$concatNameRaw} as name"),
                'email',
                'role',
                'department',
                'is_active',
                'last_seen_at'
            )
            ->whereRaw('LOWER(COALESCE(role, "")) != ?', ['customer']);

        $hasBranch = \Illuminate\Support\Facades\Schema::hasColumn('employees', 'branch');
        $hasBranchId = \Illuminate\Support\Facades\Schema::hasColumn('employees', 'branch_id');
        $branchCol = $hasBranch ? 'branch' : ($hasBranchId ? 'branch_id' : null);

        if ($branchCol) {
            $query->addSelect("{$branchCol} as branch");
        }

        // 1. Partial Name/Email search
        if ($queryText !== '') {
            $query->where(function ($q) use ($queryText, $concatNameRaw) {
                $q->where('first_name', 'like', "%{$queryText}%")
                  ->orWhere('last_name', 'like', "%{$queryText}%")
                  ->orWhere(DB::raw($concatNameRaw), 'like', "%{$queryText}%")
                  ->orWhere('email', 'like', "%{$queryText}%");
            });
        }

        // 2. Department filter
        if ($department !== '' && strtolower($department) !== 'all') {
            $query->whereRaw('LOWER(department) = ?', [strtolower($department)]);
        }

        // 3. Role filter
        if ($role !== '' && strtolower($role) !== 'all') {
            $query->whereRaw('LOWER(role) = ?', [strtolower($role)]);
        }

        // 4. Status filter
        if ($status !== '' && strtolower($status) !== 'all') {
            if (in_array(strtolower($status), ['active', '1', 'true'], true)) {
                $query->where('is_active', true);
            } elseif (in_array(strtolower($status), ['inactive', '0', 'false'], true)) {
                $query->where('is_active', false);
            }
        }

        // 5. Branch scoping & filtering (TS107)
        if ($branchCol) {
            $isAdminScoped = $user && isset($user->role) && !in_array(strtolower(trim($user->role)), ['superadmin', 'super admin', 'system administrator'], true);
            $userBranch = $user->branch ?? $user->branch_id ?? null;

            if ($isAdminScoped && !empty($userBranch) && strtolower($userBranch) !== 'all') {
                // Strictly lock to Admin's authorized branch scope regardless of submitted filter
                $query->whereRaw('LOWER(' . $branchCol . ') = ?', [strtolower($userBranch)]);
            } elseif ($branch !== '' && strtolower($branch) !== 'all') {
                $query->whereRaw('LOWER(' . $branchCol . ') = ?', [strtolower($branch)]);
            }
        }

        $total = $query->count();
        $employees = $query
            ->orderByDesc('is_active')
            ->orderBy('first_name')
            ->orderBy('last_name')
            ->forPage($page, $perPage)
            ->get();

        $formatted = $employees->map(function ($emp) {
            return [
                'id' => (int) $emp->id,
                'name' => $emp->name,
                'first_name' => $emp->first_name,
                'last_name' => $emp->last_name,
                'email' => $emp->email,
                'role' => $emp->role,
                'department' => $emp->department,
                'branch' => $emp->branch ?? 'Main',
                'is_active' => (bool) $emp->is_active,
                'status' => $emp->is_active ? 'Active' : 'Inactive',
                'last_seen_at' => $emp->last_seen_at ?? null,
            ];
        });

        return response()->json([
            'success' => true,
            'data' => $formatted,
            'total' => $total,
            'count' => $formatted->count(),
            'per_page' => $perPage,
            'current_page' => $page,
            'last_page' => (int) ceil($total / max(1, $perPage)),
            'message' => $formatted->isEmpty() ? 'No employees match your search — try adjusting your filters.' : 'Employees retrieved successfully.',
        ]);
    }

    /**
     * Get dynamic filter options (departments, branches, roles) for Admin search (TS107).
     * Scoped to the Admin's permitted branch authority.
     */
    public function filterOptions(Request $request)
    {
        $user = $request->user();

        // Departments from departments table or distinct from employees
        $departments = [];
        if (\Illuminate\Support\Facades\Schema::hasTable('departments')) {
            $departments = DB::table('departments')
                ->where('is_active', true)
                ->orderBy('name')
                ->pluck('name')
                ->toArray();
        }
        if (empty($departments)) {
            $departments = DB::table('employees')
                ->whereNotNull('department')
                ->where('department', '!=', '')
                ->distinct()
                ->orderBy('department')
                ->pluck('department')
                ->toArray();
        }

        // Distinct roles from employees
        $roles = DB::table('employees')
            ->whereNotNull('role')
            ->where('role', '!=', '')
            ->whereRaw('LOWER(role) != ?', ['customer'])
            ->distinct()
            ->orderBy('role')
            ->pluck('role')
            ->toArray();

        // Branches from branches table or default options
        $branches = [];
        if (\Illuminate\Support\Facades\Schema::hasTable('branches')) {
            $branchesQuery = DB::table('branches')->where('is_active', true)->orderBy('name');
            $branches = $branchesQuery->select('slug', 'name', 'code')->get()->toArray();
        } else {
            $branches = [
                ['slug' => 'main', 'name' => 'Main Branch', 'code' => 'MAIN'],
                ['slug' => 'luzon', 'name' => 'Luzon Regional Center', 'code' => 'LUZ'],
                ['slug' => 'visayas', 'name' => 'Visayas Medical Hub', 'code' => 'VIS'],
                ['slug' => 'mindanao', 'name' => 'Mindanao Regional Branch', 'code' => 'MIN'],
            ];
        }

        // Scope branches to Admin's branch if non-superadmin
        if ($user && isset($user->role) && !in_array(strtolower(trim($user->role)), ['superadmin', 'super admin', 'system administrator'], true)) {
            $userBranch = $user->branch ?? $user->branch_id ?? null;
            if ($userBranch && strtolower($userBranch) !== 'all') {
                $branches = array_values(array_filter($branches, function ($b) use ($userBranch) {
                    $slug = is_array($b) ? ($b['slug'] ?? '') : ($b->slug ?? '');
                    return strtolower($slug) === strtolower($userBranch);
                }));
            }
        }

        return response()->json([
            'success' => true,
            'departments' => array_values(array_unique($departments)),
            'roles' => array_values(array_unique($roles)),
            'branches' => $branches,
        ]);
    }
}
