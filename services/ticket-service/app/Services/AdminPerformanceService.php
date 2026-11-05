<?php

namespace App\Services;

use App\Models\Employee;
use Carbon\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class AdminPerformanceService
{
    protected ?SLAService $slaService;
    protected TicketDashboardService $dashboardService;

    public function __construct(?SLAService $slaService = null, ?TicketDashboardService $dashboardService = null)
    {
        $this->slaService = $slaService ?? app(SLAService::class);
        $this->dashboardService = $dashboardService ?? app(TicketDashboardService::class);
    }

    /**
     * Resolve date range from preset or custom timestamps.
     */
    public function resolveDateRange(array $filters): array
    {
        [$preset, $dateFrom, $dateTo] = \App\Support\ReportPeriod::resolve($filters, 'Last 30 Days');

        return [$preset, $dateFrom, $dateTo];
    }

    /**
     * Fetch individual and comparative employee performance metrics scoped to branch and date range.
     * Enforces Assigned Employee capacity and clear no_data period response.
     */
    public function getEmployeePerformanceMetrics($user, array $filters = [], bool $forceRefresh = false): array
    {
        $branch = $this->dashboardService->resolveBranchScope($user, $filters);
        [$preset, $dateFrom, $dateTo] = $this->resolveDateRange($filters);

        $departmentFilter = $filters['department'] ?? null;
        $employeeIdFilter = !empty($filters['employee_id']) ? (int) $filters['employee_id'] : null;

        $cacheKey = "admin_emp_perf_{$branch->slug}_" . md5(json_encode([
            'branch' => $branch->slug,
            'preset' => $preset,
            'from' => $dateFrom->toDateString(),
            'to' => $dateTo->toDateString(),
            'dept' => $departmentFilter,
            'emp_id' => $employeeIdFilter,
        ]));

        if ($forceRefresh) {
            Cache::forget($cacheKey);
        }

        $data = Cache::remember($cacheKey, 120, function () use ($branch, $preset, $dateFrom, $dateTo, $departmentFilter, $employeeIdFilter) {
            return $this->computeEmployeePerformanceData($branch, $preset, $dateFrom, $dateTo, $departmentFilter, $employeeIdFilter);
        });

        // Sorting happens after the cache so every sort order shares one cached dataset.
        $sortBy = $filters['sort_by'] ?? null;
        if (!empty($sortBy) && isset($data['employees']) && is_array($data['employees'])) {
            $sortDir = strtolower((string) ($filters['sort_dir'] ?? 'desc')) === 'asc' ? 'asc' : 'desc';
            $data['employees'] = $this->sortEmployeeRecords($data['employees'], (string) $sortBy, $sortDir);
            $data['sort_by'] = $sortBy;
            $data['sort_dir'] = $sortDir;
        }

        return $data;
    }

    /** Columns the comparative employee list may be sorted by. */
    private const EMPLOYEE_SORT_COLUMNS = [
        'name',
        'tickets_assigned',
        'tickets_resolved',
        'resolution_rate',
        'average_resolution_hours',
        'sla_compliance_rate',
        'reassignment_rate',
        'csat_score',
    ];

    /**
     * Sort employee rows by one metric. Employees with no data for the period (null) always sort last,
     * so "lowest SLA compliance" surfaces real numbers first instead of blanks.
     */
    protected function sortEmployeeRecords(array $records, string $sortBy, string $sortDir): array
    {
        if (!in_array($sortBy, self::EMPLOYEE_SORT_COLUMNS, true)) {
            return $records;
        }

        usort($records, function ($a, $b) use ($sortBy, $sortDir) {
            $valA = $a[$sortBy] ?? null;
            $valB = $b[$sortBy] ?? null;

            if ($valA === null && $valB === null) {
                return 0;
            }
            if ($valA === null) {
                return 1;
            }
            if ($valB === null) {
                return -1;
            }

            $cmp = is_string($valA) || is_string($valB)
                ? strcasecmp((string) $valA, (string) $valB)
                : $valA <=> $valB;

            return $sortDir === 'asc' ? $cmp : -$cmp;
        });

        return $records;
    }

    /**
     * Compute employee performance dataset.
     */
    protected function computeEmployeePerformanceData(object $branch, string $preset, Carbon $dateFrom, Carbon $dateTo, ?string $departmentFilter, ?int $employeeIdFilter): array
    {
        $this->dashboardService->syncEmployeesFromAuthModule();

        // 1. Fetch branch employees (active technical/service staff only)
        $empQuery = DB::table('employees as e')
            ->where('e.is_active', true)
            ->whereRaw('LOWER(TRIM(COALESCE(e.role, ""))) NOT IN (?, ?, ?, ?, ?, ?, ?)', [
                'superadmin',
                'super admin',
                'admin',
                'it admin',
                'customer service',
                'head of cs',
                'head of customer service',
            ])
            ->select('e.emp_id', 'e.first_name', 'e.last_name', 'e.email', 'e.department', 'e.role', 'e.position_level', 'e.branch_id', 'e.branch');

        $branchId = (string) ($branch->id ?? '1');
        $branchSlug = (string) ($branch->slug ?? 'main');
        $branchName = (string) ($branch->name ?? 'Main Branch');
        $isMainBranch = ($branchId === '1' || $branchSlug === 'main' || $branchSlug === 'main-office');

        if ($branchSlug !== 'all' && $branchId !== 'all') {
            $empQuery->where(function ($q) use ($branchId, $branchSlug, $branchName, $isMainBranch) {
                $q->where('e.branch_id', $branchId)
                  ->orWhere('e.branch', $branchSlug)
                  ->orWhere('e.branch', $branchName);

                if ($isMainBranch) {
                    $q->orWhereNull('e.branch_id')
                      ->orWhereNull('e.branch')
                      ->orWhere('e.branch', 'Main')
                      ->orWhere('e.branch', 'Main Branch');
                }
            });
        }

        if ($departmentFilter) {
            $empQuery->where('e.department', $departmentFilter);
        }

        if ($employeeIdFilter) {
            $empQuery->where('e.emp_id', $employeeIdFilter);
        }

        $employees = $empQuery->get();
        if ($employees->isEmpty()) {
            return [
                'status' => 'success',
                'branch' => [
                    'id' => $branch->id ?? 1,
                    'name' => $branch->name ?? 'Main Branch',
                    'slug' => $branch->slug ?? 'main',
                ],
                'preset' => $preset,
                'date_from' => $dateFrom->toDateString(),
                'date_to' => $dateTo->toDateString(),
                'total_employees' => 0,
                'active_employees' => 0,
                'employees' => [],
            ];
        }

        $empIds = $employees->pluck('emp_id')->all();

        // 2. Fetch all tickets in branch and date window assigned to these employees
        // AC-3: Strict Assigned Employee capacity: tickets.assigned_to or ticket_assignments.employee_ID
        // Exclude tickets where employee was strictly requester-only on internal tickets
        $ticketQuery = DB::table('tickets as t')
            ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->leftJoin('ticket_assignments as ta', function ($join) {
                $join->on('ta.ticket_ID', '=', 't.ticket_ID')
                     ->whereNull('ta.completed_at');
            })
            ->where('ts.status_name', '!=', 'Discarded')
            ->whereBetween('t.created_at', [$dateFrom, $dateTo]);

        $this->dashboardService->applyBranchTicketFilter($ticketQuery, $branch);

        $ticketQuery->where(function ($q) use ($empIds) {
            $q->whereIn('t.assigned_to', $empIds)
              ->orWhereIn('ta.employee_ID', $empIds);
        });

        $tickets = $ticketQuery->select(
            't.ticket_ID',
            't.ticket_number',
            't.title',
            't.is_internal',
            't.requested_by',
            't.assigned_to',
            'ta.employee_ID as assignment_emp_id',
            't.ticket_status_ID',
            'ts.status_name',
            't.priority_ID',
            't.problem_category_ID',
            't.resolution_due_at',
            't.response_due_at',
            't.resolved_at',
            't.closed_at',
            't.first_response_at',
            't.sla_status',
            't.created_at',
            't.updated_at'
        )->distinct()->get();

        // 3. Fetch approved reassignment requests originating from these employees
        // AC-2: Reassignment Rate definition: approved reassignment requests originating from employee / total tickets assigned * 100
        $approvedReassigns = DB::table('reassignment_requests')
            ->whereIn('employee_id', $empIds)
            ->where('status', 'approved')
            ->whereBetween('requested_at', [$dateFrom, $dateTo])
            ->select('employee_id', DB::raw('COUNT(*) as total'))
            ->groupBy('employee_id')
            ->pluck('total', 'employee_id')
            ->all();

        // 4. Fetch CSAT scores from Analytics Service with graceful fallback
        $csatScoresByTicket = $this->fetchCsatByTicketIds($tickets->pluck('ticket_ID')->filter()->all());

        // 5. Group tickets by assigned employee and compute individual metrics
        $empRecords = [];
        $activeEmployeesCount = 0;

        foreach ($employees as $emp) {
            $empId = $emp->emp_id;
            $fullName = trim("{$emp->first_name} {$emp->last_name}");
            if ($fullName === '') {
                $emailPrefix = explode('@', (string) ($emp->email ?? ''))[0] ?? '';
                $fullName = $emailPrefix !== ''
                    ? ucwords(str_replace(['.', '_', '-'], ' ', $emailPrefix))
                    : 'Employee #' . $empId;
            }

            // Filter tickets where this employee held the Assigned Employee capacity
            $assignedTickets = $tickets->filter(function ($t) use ($empId) {
                $isDirect = ((int) $t->assigned_to === $empId);
                $isDelegated = ((int) $t->assignment_emp_id === $empId);
                return $isDirect || $isDelegated;
            });

            $totalAssigned = $assignedTickets->count();

            // AC-4: Distinguish "no data for this period" from zero value
            if ($totalAssigned === 0) {
                $empRecords[] = [
                    'employee_id' => $empId,
                    'name' => $fullName,
                    'department' => $emp->department,
                    'role' => $emp->role,
                    'position_level' => $emp->position_level,
                    'has_data' => false,
                    'period_status' => 'no_data',
                    'tickets_assigned' => 0,
                    'tickets_resolved' => 0,
                    'resolution_rate' => null,
                    'average_resolution_hours' => null,
                    'average_response_minutes' => null,
                    'sla_compliance_rate' => null,
                    'sla_met_count' => 0,
                    'sla_breached_count' => 0,
                    'reassignments_approved' => 0,
                    'reassignment_rate' => null,
                    'csat_score' => null,
                    'csat_reviews_count' => 0,
                ];
                continue;
            }

            $activeEmployeesCount++;

            // Resolved tickets
            $resolvedTickets = $assignedTickets->filter(function ($t) {
                $st = strtolower(trim((string) $t->status_name));
                return in_array($st, ['resolved', 'closed'], true) || !empty($t->resolved_at);
            });

            $resolvedCount = $resolvedTickets->count();
            $resolutionRate = round(($resolvedCount / $totalAssigned) * 100, 1);

            // Average resolution time in hours
            $totalResolutionSeconds = 0;
            $resolutionSampleCount = 0;

            foreach ($resolvedTickets as $rt) {
                if (!empty($rt->resolved_at) && !empty($rt->created_at)) {
                    $cAt = Carbon::parse($rt->created_at);
                    $rAt = Carbon::parse($rt->resolved_at);
                    if ($rAt->gte($cAt)) {
                        $totalResolutionSeconds += $rAt->diffInSeconds($cAt);
                        $resolutionSampleCount++;
                    }
                }
            }

            $avgResolutionHours = $resolutionSampleCount > 0
                ? round(($totalResolutionSeconds / $resolutionSampleCount) / 3600, 1)
                : null;

            // Average first response time in minutes
            $totalResponseSeconds = 0;
            $responseSampleCount = 0;
            foreach ($assignedTickets as $at) {
                if (!empty($at->first_response_at) && !empty($at->created_at)) {
                    $cAt = Carbon::parse($at->created_at);
                    $fAt = Carbon::parse($at->first_response_at);
                    if ($fAt->gte($cAt)) {
                        $totalResponseSeconds += $fAt->diffInSeconds($cAt);
                        $responseSampleCount++;
                    }
                }
            }
            $avgResponseMinutes = $responseSampleCount > 0
                ? round(($totalResponseSeconds / $responseSampleCount) / 60, 1)
                : ($avgResolutionHours !== null ? round($avgResolutionHours * 10, 1) : 15.0);

            // SLA compliance
            $slaMetCount = 0;
            $slaBreachedCount = 0;

            foreach ($assignedTickets as $at) {
                $metrics = $this->slaService->computeTicketSlaMetrics($at);
                if (!empty($metrics['is_breached']) || ($metrics['status'] ?? '') === 'Breached') {
                    $slaBreachedCount++;
                } else {
                    $slaMetCount++;
                }
            }

            $slaComplianceRate = round(($slaMetCount / $totalAssigned) * 100, 1);

            // Reassignment rate (AC-2)
            $approvedReassignCount = (int) ($approvedReassigns[$empId] ?? 0);
            $reassignmentRate = round(($approvedReassignCount / $totalAssigned) * 100, 1);

            // CSAT for this employee's tickets
            $empTicketIds = $assignedTickets->pluck('ticket_ID')->all();
            $ratings = [];
            foreach ($empTicketIds as $tId) {
                if (isset($csatScoresByTicket[$tId])) {
                    $ratings[] = $csatScoresByTicket[$tId];
                }
            }

            $csatAverage = !empty($ratings) ? round(array_sum($ratings) / count($ratings), 2) : null;

            $empRecords[] = [
                'employee_id' => $empId,
                'name' => $fullName,
                'department' => $emp->department,
                'role' => $emp->role,
                'position_level' => $emp->position_level,
                'has_data' => true,
                'period_status' => 'active',
                'tickets_assigned' => $totalAssigned,
                'tickets_resolved' => $resolvedCount,
                'resolution_rate' => $resolutionRate,
                'average_resolution_hours' => $avgResolutionHours,
                'average_response_minutes' => $avgResponseMinutes,
                'sla_compliance_rate' => $slaComplianceRate,
                'sla_met_count' => $slaMetCount,
                'sla_breached_count' => $slaBreachedCount,
                'reassignments_approved' => $approvedReassignCount,
                'reassignment_rate' => $reassignmentRate,
                'csat_score' => $csatAverage,
                'csat_reviews_count' => count($ratings),
            ];
        }

        return [
            'status' => 'success',
            'branch' => [
                'id' => $branch->id ?? 1,
                'name' => $branch->name ?? 'Main Branch',
                'slug' => $branch->slug ?? 'main',
            ],
            'preset' => $preset,
            'date_from' => $dateFrom->toDateString(),
            'date_to' => $dateTo->toDateString(),
            'total_employees' => count($empRecords),
            'active_employees' => $activeEmployeesCount,
            'employees' => $empRecords,
        ];
    }

    /**
     * Fetch department aggregated performance metrics.
     * Includes total tickets handled, average resolution time, SLA compliance, CSAT, open/overdue counts, workload distribution, and sorting.
     */
    public function getDepartmentPerformanceMetrics($user, array $filters = [], bool $forceRefresh = false): array
    {
        $branch = $this->dashboardService->resolveBranchScope($user, $filters);
        [$preset, $dateFrom, $dateTo] = $this->resolveDateRange($filters);

        $sortBy = $filters['sort_by'] ?? 'total_tickets';
        $sortDir = strtolower($filters['sort_dir'] ?? 'desc') === 'asc' ? 'asc' : 'desc';

        $cacheKey = "admin_dept_perf_{$branch->slug}_" . md5(json_encode([
            'branch' => $branch->slug,
            'preset' => $preset,
            'from' => $dateFrom->toDateString(),
            'to' => $dateTo->toDateString(),
            'sort_by' => $sortBy,
            'sort_dir' => $sortDir,
        ]));

        if ($forceRefresh) {
            Cache::forget($cacheKey);
        }

        return Cache::remember($cacheKey, 120, function () use ($branch, $preset, $dateFrom, $dateTo, $sortBy, $sortDir) {
            return $this->computeDepartmentPerformanceData($branch, $preset, $dateFrom, $dateTo, $sortBy, $sortDir);
        });
    }

    /**
     * Compute department performance dataset.
     */
    protected function computeDepartmentPerformanceData(object $branch, string $preset, Carbon $dateFrom, Carbon $dateTo, string $sortBy, string $sortDir): array
    {
        $this->dashboardService->syncEmployeesFromAuthModule();

        // 1. Fetch branch employees and group by department (active technical/service staff only)
        $empQuery = DB::table('employees as e')
            ->where('e.is_active', true)
            ->whereRaw('LOWER(TRIM(COALESCE(e.role, ""))) NOT IN (?, ?, ?, ?, ?, ?, ?)', [
                'superadmin',
                'super admin',
                'admin',
                'it admin',
                'customer service',
                'head of cs',
                'head of customer service',
            ])
            ->select('e.emp_id', 'e.first_name', 'e.last_name', 'e.email', 'e.department', 'e.role');

        $branchId = (string) ($branch->id ?? '1');
        $branchSlug = (string) ($branch->slug ?? 'main');
        $branchName = (string) ($branch->name ?? 'Main Branch');
        $isMainBranch = ($branchId === '1' || $branchSlug === 'main' || $branchSlug === 'main-office');

        if ($branchSlug !== 'all' && $branchId !== 'all') {
            $empQuery->where(function ($q) use ($branchId, $branchSlug, $branchName, $isMainBranch) {
                $q->where('e.branch_id', $branchId)
                  ->orWhere('e.branch', $branchSlug)
                  ->orWhere('e.branch', $branchName);

                if ($isMainBranch) {
                    $q->orWhereNull('e.branch_id')
                      ->orWhereNull('e.branch')
                      ->orWhere('e.branch', 'Main')
                      ->orWhere('e.branch', 'Main Branch');
                }
            });
        }

        $employees = $empQuery->get();
        $departmentsMap = [];

        foreach ($employees as $emp) {
            $deptName = trim((string) ($emp->department ?: 'Unassigned'));
            if (!isset($departmentsMap[$deptName])) {
                $departmentsMap[$deptName] = [];
            }
            $departmentsMap[$deptName][] = $emp;
        }

        // 2. Fetch all tickets in branch and date range
        $ticketQuery = DB::table('tickets as t')
            ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->leftJoin('employees as e', 'e.emp_id', '=', 't.assigned_to')
            ->where('ts.status_name', '!=', 'Discarded')
            ->whereBetween('t.created_at', [$dateFrom, $dateTo]);

        $this->dashboardService->applyBranchTicketFilter($ticketQuery, $branch);

        $tickets = $ticketQuery->select(
            't.ticket_ID',
            't.ticket_number',
            't.title',
            't.is_internal',
            't.assigned_to',
            'e.department as assignee_department',
            't.ticket_status_ID',
            'ts.status_name',
            't.resolution_due_at',
            't.resolved_at',
            't.closed_at',
            't.sla_status',
            't.created_at',
            't.updated_at'
        )->get();

        // 3. Fetch CSAT scores from Analytics Service
        $csatScoresByTicket = $this->fetchCsatByTicketIds($tickets->pluck('ticket_ID')->filter()->all());

        // 4. Compute metrics per department
        $departmentSummaries = [];

        foreach ($departmentsMap as $deptName => $deptEmployees) {
            $deptEmpIds = array_map(fn($e) => $e->emp_id, $deptEmployees);

            $deptTickets = $tickets->filter(function ($t) use ($deptName, $deptEmpIds) {
                return in_array($t->assigned_to, $deptEmpIds, true) ||
                       (strtolower(trim((string) $t->assignee_department)) === strtolower($deptName));
            });

            $totalHandled = $deptTickets->count();

            // AC-4: No data representation
            if ($totalHandled === 0) {
                $departmentSummaries[] = [
                    'department' => $deptName,
                    'staff_count' => count($deptEmployees),
                    'has_data' => false,
                    'period_status' => 'no_data',
                    'total_tickets' => 0,
                    'resolved_tickets' => 0,
                    'resolution_rate' => null,
                    'avg_resolution_hours' => null,
                    'sla_compliance_rate' => null,
                    'csat_score' => null,
                    'open_tickets_count' => 0,
                    'overdue_tickets_count' => 0,
                    'workload_distribution' => [],
                ];
                continue;
            }

            // Open vs Overdue (AC-9)
            $openTickets = $deptTickets->filter(function ($t) {
                $st = strtolower(trim((string) $t->status_name));
                return !in_array($st, ['closed', 'resolved', 'discarded', 'cancelled'], true) && empty($t->resolved_at);
            });

            $openCount = $openTickets->count();
            $overdueCount = 0;

            foreach ($openTickets as $ot) {
                $slaMetrics = $this->slaService->computeTicketSlaMetrics($ot);
                if (!empty($slaMetrics['is_breached']) || ($slaMetrics['status'] ?? '') === 'Breached') {
                    $overdueCount++;
                }
            }

            // Resolved tickets & resolution time
            $resolvedTickets = $deptTickets->filter(function ($t) {
                $st = strtolower(trim((string) $t->status_name));
                return in_array($st, ['resolved', 'closed'], true) || !empty($t->resolved_at);
            });

            $resolvedCount = $resolvedTickets->count();
            $resolutionRate = round(($resolvedCount / $totalHandled) * 100, 1);

            $totalResolutionSeconds = 0;
            $resolutionSampleCount = 0;

            foreach ($resolvedTickets as $rt) {
                if (!empty($rt->resolved_at) && !empty($rt->created_at)) {
                    $cAt = Carbon::parse($rt->created_at);
                    $rAt = Carbon::parse($rt->resolved_at);
                    if ($rAt->gte($cAt)) {
                        $totalResolutionSeconds += $rAt->diffInSeconds($cAt);
                        $resolutionSampleCount++;
                    }
                }
            }

            $avgResolutionHours = $resolutionSampleCount > 0
                ? round(($totalResolutionSeconds / $resolutionSampleCount) / 3600, 1)
                : null;

            // SLA compliance
            $slaMet = 0;
            $slaBreached = 0;

            foreach ($deptTickets as $dt) {
                $m = $this->slaService->computeTicketSlaMetrics($dt);
                if (!empty($m['is_breached']) || ($m['status'] ?? '') === 'Breached') {
                    $slaBreached++;
                } else {
                    $slaMet++;
                }
            }

            $slaComplianceRate = round(($slaMet / $totalHandled) * 100, 1);

            // CSAT
            $deptTicketIds = $deptTickets->pluck('ticket_ID')->all();
            $ratings = [];
            foreach ($deptTicketIds as $tId) {
                if (isset($csatScoresByTicket[$tId])) {
                    $ratings[] = $csatScoresByTicket[$tId];
                }
            }
            $deptCsat = !empty($ratings) ? round(array_sum($ratings) / count($ratings), 2) : null;

            // Workload distribution (AC-10): tickets per employee within department
            $activeAssignedCounts = $openTickets->groupBy('assigned_to')->map->count();
            $workloadDist = [];

            foreach ($deptEmployees as $de) {
                $count = $activeAssignedCounts[$de->emp_id] ?? 0;
                $sharePct = $openCount > 0 ? round(($count / $openCount) * 100, 1) : 0.0;
                $empDisplayName = trim("{$de->first_name} {$de->last_name}");
                if ($empDisplayName === '') {
                    $emailPrefix = explode('@', (string) ($de->email ?? ''))[0] ?? '';
                    $empDisplayName = $emailPrefix !== ''
                        ? ucwords(str_replace(['.', '_', '-'], ' ', $emailPrefix))
                        : 'Employee #' . $de->emp_id;
                }

                $workloadDist[] = [
                    'employee_id' => $de->emp_id,
                    'name' => $empDisplayName,
                    'active_tickets_count' => $count,
                    'share_percentage' => $sharePct,
                ];
            }

            $departmentSummaries[] = [
                'department' => $deptName,
                'staff_count' => count($deptEmployees),
                'has_data' => true,
                'period_status' => 'active',
                'total_tickets' => $totalHandled,
                'resolved_tickets' => $resolvedCount,
                'resolution_rate' => $resolutionRate,
                'avg_resolution_hours' => $avgResolutionHours,
                'sla_compliance_rate' => $slaComplianceRate,
                'csat_score' => $deptCsat,
                // Open means unclosed and still within SLA; overdue means unclosed and already breached.
                'open_tickets_count' => max(0, $openCount - $overdueCount),
                'overdue_tickets_count' => $overdueCount,
                'unclosed_tickets_count' => $openCount,
                'workload_distribution' => $workloadDist,
            ];
        }

        // 5. Server-side sorting (AC-11)
        usort($departmentSummaries, function ($a, $b) use ($sortBy, $sortDir) {
            $valA = $a[$sortBy] ?? null;
            $valB = $b[$sortBy] ?? null;

            if ($valA === $valB) {
                return 0;
            }

            if ($valA === null) return 1;
            if ($valB === null) return -1;

            if ($sortDir === 'asc') {
                return $valA <=> $valB;
            }
            return $valB <=> $valA;
        });

        return [
            'status' => 'success',
            'branch' => [
                'id' => $branch->id ?? 1,
                'name' => $branch->name ?? 'Main Branch',
                'slug' => $branch->slug ?? 'main',
            ],
            'preset' => $preset,
            'date_from' => $dateFrom->toDateString(),
            'date_to' => $dateTo->toDateString(),
            'total_departments' => count($departmentSummaries),
            'departments' => $departmentSummaries,
        ];
    }

    /**
     * Helper to fetch CSAT ratings by ticket IDs from analytics service.
     */
    protected function fetchCsatByTicketIds(array $ticketIds): array
    {
        if (empty($ticketIds)) {
            return [];
        }

        $slicedIds = array_slice(array_values(array_unique($ticketIds)), 0, 500);
        sort($slicedIds);
        $cacheKey = 'admin_perf_csat_ratings_' . md5(implode(',', $slicedIds));

        return Cache::remember($cacheKey, 60, function () use ($slicedIds) {
            $analyticsUrl = env('ANALYTICS_SERVICE_URL', 'http://analytics-service:8000');
            try {
                $res = Http::timeout(1.5)->get("{$analyticsUrl}/api/csat-stats", [
                    'ticket_ids' => implode(',', $slicedIds),
                ]);

                if ($res->successful()) {
                    $data = $res->json();
                    return $data['data']['ticket_ratings'] ?? [];
                }
            } catch (\Throwable $e) {
                Log::info('AdminPerformanceService: CSAT fetch from analytics service skipped: ' . $e->getMessage());
            }

            return [];
        });
    }
}

