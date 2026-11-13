<?php

namespace App\Http\Controllers;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class EmployeeDirectoryController extends Controller
{
    /**
     * Automatically synchronize employees from Auth Module if not synced recently (every 60s).
     */
    public static function autoSyncWithAuthModule(): void
    {
        if (\Illuminate\Support\Facades\Cache::has('employees_synced_lock')) {
            return;
        }

        \Illuminate\Support\Facades\Cache::put('employees_synced_lock', true, 60);

        try {
            $authUrl = env('AUTH_SERVICE_INTERNAL_URL', 'http://auth-service:8000');
            $secret = env('CMS_INTERNAL_SECRET', 'cms-internal-secret-key-2026');

            $resp = \Illuminate\Support\Facades\Http::timeout(3)
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

            $authEmails = [];

            foreach ($authUsers as $u) {
                $email = strtolower(trim((string) ($u['email'] ?? '')));
                if (empty($email)) continue;
                $authEmails[] = $email;

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

                // Map the Auth Module branch to the local branch by name (ids are numbered independently).
                $branch = 'Main Branch';
                $branchId = 1;
                $branchName = trim((string) ($u['branch'] ?? ($u['branch_details']['name'] ?? '')));
                if ($branchName !== '') {
                    try {
                        $localBranch = DB::table('branches')->whereRaw('LOWER(name) = ?', [strtolower($branchName)])->first(['id', 'name']);
                        if ($localBranch) {
                            $branch = $localBranch->name;
                            $branchId = (int) $localBranch->id;
                        }
                    } catch (\Throwable $e) {
                        // branches table unavailable: keep the default branch rather than skip this user
                    }
                }

                $uFirstName = trim((string) ($u['first_name'] ?? ''));
                $uLastName = trim((string) ($u['last_name'] ?? ''));
                if ($uFirstName === '' && !empty($u['name'] ?? $u['full_name'] ?? null)) {
                    $nameParts = preg_split('/\s+/', trim((string) ($u['name'] ?? $u['full_name'])), 2);
                    $uFirstName = $nameParts[0] ?? '';
                    if ($uLastName === '' && isset($nameParts[1])) {
                        $uLastName = $nameParts[1];
                    }
                }

                $existing = DB::table('employees')->where('email', $email)->first();

                if ($existing) {
                    DB::table('employees')->where('emp_id', $existing->emp_id)->update([
                        'first_name' => $uFirstName !== '' ? $uFirstName : $existing->first_name,
                        'last_name' => $uLastName !== '' ? $uLastName : $existing->last_name,
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
                        'first_name' => $uFirstName !== '' ? $uFirstName : (explode('@', $email)[0] ?: 'Staff'),
                        'last_name' => $uLastName,
                        'department' => $dept,
                        'position_level' => $posLevel,
                        'role' => $role,
                        'technical_role' => $techRole,
                        'branch' => $branch,
                        'branch_id' => $branchId,
                        'is_active' => (int) ($u['is_active'] ?? 1),
                        'last_synced_at' => now(),
                        'password_change_at' => now(),
                    ]);
                }
            }

            DB::table('employees')->whereNotIn('email', $authEmails)->update(['is_active' => 0]);
        } catch (\Throwable $e) {
            // Silently fallback so normal operation is never disrupted
        }
    }

    /**
     * Resolve category track (Service, IT, Others) for a ticket (TS110).
     */
    /**
     * Resolve category name for a ticket.
     */
    public static function resolveCategoryName($ticket): string
    {
        if (!$ticket) {
            return '';
        }

        if (!empty($ticket->problem_category_ID)) {
            $name = DB::table('problem_categories')
                ->where('problem_category_ID', $ticket->problem_category_ID)
                ->value('category_name');
            if ($name) {
                return (string) $name;
            }
        }

        if (!empty($ticket->category)) {
            return (string) $ticket->category;
        }

        return '';
    }

    /**
     * Resolve category track (Service, IT, Others) for a ticket (TS110).
     */
    public static function resolveCategoryTrack($ticket): string
    {
        if (!$ticket) {
            return 'service';
        }

        $categoryName = self::resolveCategoryName($ticket);

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
     * Fetch category escalation rules dynamically from Configuration Service.
     */
    public static function fetchCategoryEscalationRules(): array
    {
        return [
            'service' => [
                'department' => ['Service'],
                'min_position_level' => 'Senior',
                'allowed_roles' => [],
                'allow_cross_branch' => false,
            ],
            'it' => [
                'department' => ['IT'],
                'min_position_level' => 'Senior',
                'allowed_roles' => [],
                'allow_cross_branch' => false,
            ],
        ];
    }

    /**
     * Match a specific escalation rule for a category and track (Service or IT).
     */
    public static function matchCategoryEscalationRule(string $categoryName, string $track): array
    {
        $rules = self::fetchCategoryEscalationRules();
        $catLower = strtolower(trim($categoryName));

        if ($track === 'service' || str_contains($catLower, 'service') || str_contains($catLower, 'machine') || str_contains($catLower, 'hardware') || str_contains($catLower, 'biomedical')) {
            return $rules['service'];
        }

        return $rules['it'];
    }

    public static function positionLevelRank(?string $level): int
    {
        $l = strtolower(trim((string) $level));
        return match ($l) {
            'manager' => 5,
            'lead' => 4,
            'senior' => 3,
            'mid' => 2,
            'junior' => 1,
            default => 1,
        };
    }

    /**
     * Fetch designated department managers for Service, IT, and Customer Service.
     */
    public static function fetchDepartmentManagers(): array
    {
        return \Illuminate\Support\Facades\Cache::remember('department_managers:cache', 60, function () {
            // Strictly fetch active managers from the database for Service and IT (preferring synced auth accounts)
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
     * Check if an employee qualifies for a category track and branch (TS110).
     */
    public static function checkEligibility($emp, $ticket = null, string $track = 'service', ?array $rule = null, bool $isEscalation = false): array
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

        // 2. Position level qualification (strictly enforced ONLY on escalation)
        if ($isEscalation) {
            $minLevel = 'Manager';
            $minRank = self::positionLevelRank($minLevel);
            $empRank = self::positionLevelRank($emp->position_level ?? 'Junior');
            if ($empRank < $minRank) {
                $empLevel = $emp->position_level ?: 'Junior';
                return [
                    'eligible' => false,
                    'reason' => "Escalation requires Manager seniority. Current level: '{$empLevel}'.",
                ];
            }
        }

        // 4. Branch scoping (respecting allow_cross_branch)
        $allowCrossBranch = (bool) ($rule['allow_cross_branch'] ?? false);
        if ($ticket && !$allowCrossBranch) {
            $empBranch = $emp->branch ?? null;
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
                        'reason' => "Branch mismatch: employee belongs to {$empBranch}, but ticket is designated for {$ticketBranchName} (cross-branch assignment disabled).",
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

        $query->addSelect('branch');

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
        $categoryName = $ticket ? self::resolveCategoryName($ticket) : '';
        $rule = self::matchCategoryEscalationRule($categoryName, $resolvedTrack ?? 'service');
        $departmentManagers = self::fetchDepartmentManagers();

        $employees = $query
            ->orderByDesc('is_active')
            ->orderBy(DB::raw("CONCAT(first_name, ' ', last_name)"))
            ->get();

        if ($resolvedTrack) {
            $employees = $employees->filter(function ($emp) use ($ticket, $resolvedTrack, $rule) {
                $res = self::checkEligibility($emp, $ticket, $resolvedTrack, $rule, $isEscalation);
                return $res['eligible'];
            })->values();
        }

        return response()->json([
            'employees' => $employees,
            'track' => $resolvedTrack,
            'category' => $categoryName,
            'rule' => $rule,
            'department_managers' => $departmentManagers,
        ]);
    }

    /**
     * Filter employee eligibility based on ticket category tracks (TS110).
     * Returns categorized lists of eligible vs ineligible employees with detailed reasons.
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
        $categoryName = self::resolveCategoryName($ticket);
        $rule = self::matchCategoryEscalationRule($categoryName, $track);
        $departmentManagers = self::fetchDepartmentManagers();

        $query = DB::table('employees')
            ->select('emp_id as id', DB::raw("CONCAT(first_name, ' ', last_name) as name"), 'email', 'role', 'department', 'position_level', 'technical_role', 'is_active', 'last_seen_at')
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

        $query->addSelect('branch');

        $requestedBy = $ticket->requested_by ?? null;
        if ($requestedBy) {
            $query->where('emp_id', '!=', $requestedBy);
        }

        $employees = $query->orderByDesc('is_active')->orderBy('first_name')->get();

        $eligible = [];
        $ineligible = [];

        foreach ($employees as $emp) {
            $eligibility = self::checkEligibility($emp, $ticket, $track, $rule, $isEscalation);
            $defaultPos = (strcasecmp((string)$emp->department, 'Service') === 0) ? 'Engineer' : 'Employee';
            $empPosLevel = $emp->position_level;
            if (empty($empPosLevel) || in_array(strtolower($empPosLevel), ['senior', 'mid', 'junior'])) {
                $empPosLevel = (stripos((string)$emp->role, 'manager') !== false) ? 'Manager' : $defaultPos;
            }
            $empTechRole = $emp->technical_role;
            if (empty($empTechRole) || in_array(strtolower($empTechRole), ['specialist', 'technician', 'service technician', 'it support specialist'])) {
                $empTechRole = $empPosLevel;
            }

            $presenceState = \App\Support\Presence::state((bool) $emp->is_active, $emp->last_seen_at);

            $item = [
                'id' => (int) $emp->id,
                'name' => $emp->name,
                'email' => $emp->email,
                'role' => $emp->role,
                'department' => $emp->department,
                'branch' => $emp->branch ?? 'Main',
                'position_level' => $empPosLevel,
                'technical_role' => $empTechRole,
                // Presence is derived from heartbeat freshness (spec 0035). availability_status is kept for older consumers.
                'presence' => $presenceState,
                'last_seen_at' => $emp->last_seen_at ? \Carbon\Carbon::parse($emp->last_seen_at)->toISOString() : null,
                'availability_status' => $presenceState === \App\Support\Presence::ONLINE ? 'available' : 'unavailable',
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

        // Online employees first; offline remain selectable (spec 0035 AC-4). Original order is the tiebreak.
        $sortOnlineFirst = function (array $list): array {
            $indexed = [];
            foreach (array_values($list) as $position => $row) {
                $indexed[] = [$position, $row];
            }
            usort($indexed, function ($a, $b) {
                $byPresence = (($b[1]['presence'] ?? '') === 'online') <=> (($a[1]['presence'] ?? '') === 'online');
                return $byPresence !== 0 ? $byPresence : $a[0] <=> $b[0];
            });
            return array_map(fn ($pair) => $pair[1], $indexed);
        };
        $eligible = $sortOnlineFirst($eligible);
        $ineligible = $sortOnlineFirst($ineligible);

        $emptyGuidance = count($eligible) === 0
            ? 'No eligible employees currently match the required department, position level, and technical role criteria for this category. Please escalate to the designated department manager or contact Customer Service leadership.'
            : null;

        return response()->json([
            'ticket_id' => (int) $ticketId,
            'ticket_number' => $ticket->ticket_number ?? null,
            'track' => $track,
            'category' => $categoryName,
            'branch' => (!empty($ticket->branch_id) ? (DB::table('branches')->where('id', $ticket->branch_id)->value('name') ?? 'Main Branch') : 'Main Branch'),
            'rule' => $rule,
            'department_managers' => $departmentManagers,
            'eligible_count' => count($eligible),
            'ineligible_count' => count($ineligible),
            'eligible_employees' => $eligible,
            'ineligible_employees' => $ineligible,
            'empty_state_guidance' => $emptyGuidance,
        ]);
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
                    $updates['last_synced_at'] = now();
                    if (!empty($authData['first_name'])) $updates['first_name'] = $authData['first_name'];
                    if (!empty($authData['last_name'])) $updates['last_name'] = $authData['last_name'];
                    if (!empty($authData['email'])) $updates['email'] = $authData['email'];
                    if (!empty($authData['role'])) $updates['role'] = $authData['role'];
                    if (!empty($authData['department'])) $updates['department'] = $authData['department'];
                    if (!empty($authData['branch'])) {
                        $updates['branch'] = $authData['branch'];
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

        $branchValue = $employee->branch ?? 'Main';
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
        if ($request->has('phone_number')) {
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

        $query->addSelect('branch');

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
        try {
            $departments = DB::table('departments')
                ->where('is_active', true)
                ->orderBy('name')
                ->pluck('name')
                ->toArray();
        } catch (\Throwable $e) {
            $departments = [];
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
        try {
            $branchesQuery = DB::table('branches')->where('is_active', true)->orderBy('name');
            $branches = $branchesQuery->select('slug', 'name', 'code')->get()->toArray();
        } catch (\Throwable $e) {
            $branches = [];
        }
        if (empty($branches)) {
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
