<?php

namespace App\Services;

use App\Support\TechnicalDepartments;
use Carbon\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Employee and department performance for the admin dashboard and admin reports.
 *
 * Spec 0031: only technical departments (config ticketing.technical_departments) are listed; department SLA
 * compliance comes from SlaOutcomeService by outcome date; a missing rate is null; CSAT comes from
 * CsatSnapshotService; nothing here calls the auth module.
 * Spec 0039: employee figures are computed from ticket_assignment_periods (see AssignmentPeriodMetrics).
 */
class AdminPerformanceService
{
    protected ?SLAService $slaService;
    protected TicketDashboardService $dashboardService;
    protected SlaOutcomeService $slaOutcomes;
    protected CsatSnapshotService $csatSnapshots;

    public function __construct(
        ?SLAService $slaService = null,
        ?TicketDashboardService $dashboardService = null,
        ?SlaOutcomeService $slaOutcomes = null,
        ?CsatSnapshotService $csatSnapshots = null
    ) {
        $this->slaService = $slaService ?? app(SLAService::class);
        $this->dashboardService = $dashboardService ?? app(TicketDashboardService::class);
        $this->slaOutcomes = $slaOutcomes ?? app(SlaOutcomeService::class);
        $this->csatSnapshots = $csatSnapshots ?? app(CsatSnapshotService::class);
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
     * Spec 0039: figures come from ticket_assignment_periods (each person's own holding periods), not from
     * ticket creation dates. Default order is Performance Score high to low, not_enough_data last.
     */
    public function getEmployeePerformanceMetrics($user, array $filters = [], bool $forceRefresh = false): array
    {
        $branch = $this->dashboardService->resolveBranchScope($user, $filters);
        [$preset, $dateFrom, $dateTo] = $this->resolveDateRange($filters);

        $departmentFilter = $filters['department'] ?? null;
        $employeeIdFilter = !empty($filters['employee_id']) ? (int) $filters['employee_id'] : null;

        $cacheKey = "admin_emp_perf_v3_{$branch->slug}_" . md5(json_encode([
            'branch' => $branch->slug,
            'preset' => $preset,
            'from' => $dateFrom->toDateString(),
            'to' => $dateTo->toDateString(),
            'dept' => $departmentFilter,
            'emp_id' => $employeeIdFilter,
            'tech' => TechnicalDepartments::normalizedList(),
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
        'performance_score',
        'pending_count',
        'tickets_assigned',
        'tickets_resolved',
        'resolution_rate',
        'average_resolution_hours',
        'sla_compliance_rate',
        'response_sla_rate',
        'average_response_minutes',
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
     * Active technical department employees of a branch (spec 0031 AC-1, AC-2).
     */
    protected function branchTechnicalEmployeesQuery(object $branch)
    {
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
            ]);

        TechnicalDepartments::applyEmployeeFilter($empQuery, 'e');

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

        return $empQuery;
    }

    /**
     * Compute employee performance dataset.
     */
    protected function computeEmployeePerformanceData(object $branch, string $preset, Carbon $dateFrom, Carbon $dateTo, ?string $departmentFilter, ?int $employeeIdFilter): array
    {
        $now = now();

        // 1. Fetch branch employees (active technical department staff only)
        $empQuery = $this->branchTechnicalEmployeesQuery($branch)
            ->select('e.emp_id', 'e.first_name', 'e.last_name', 'e.email', 'e.department', 'e.role', 'e.position_level', 'e.branch_id', 'e.branch');

        if ($departmentFilter) {
            $empQuery->whereRaw('LOWER(TRIM(e.department)) = ?', [strtolower(trim($departmentFilter))]);
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

        // 2. Holding periods of these employees that started in the window (spec 0039 AC-6). Tickets with
        // no period rows (assigned before tracking began) count for no employee.
        $periodColumns = [
            'p.id', 'p.ticket_ID', 'p.employee_ID', 'p.assigned_at', 'p.ack_due_at', 'p.accepted_at', 'p.paused_at',
            'p.paused_seconds', 'p.ack_paused_seconds', 'p.released_at', 'p.release_reason',
        ];
        $periodsQuery = DB::table(AssignmentPeriodRecorder::TABLE . ' as p')
            ->join('tickets as t', 't.ticket_ID', '=', 'p.ticket_ID')
            ->whereIn('p.employee_ID', $empIds)
            ->whereBetween('p.assigned_at', [$dateFrom, $dateTo]);
        $this->dashboardService->applyBranchTicketFilter($periodsQuery, $branch);
        $windowPeriods = $periodsQuery->select($periodColumns)->get();

        // 3. Every period and the SLA fields of those tickets, for resolution attribution (AC-11)
        $ticketIds = $windowPeriods->pluck('ticket_ID')->unique()->values()->all();
        $allPeriods = empty($ticketIds) ? collect() : DB::table(AssignmentPeriodRecorder::TABLE . ' as p')
            ->whereIn('p.ticket_ID', $ticketIds)
            ->select($periodColumns)
            ->get();
        $ticketsById = empty($ticketIds) ? [] : DB::table('tickets as t')
            ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->whereIn('t.ticket_ID', $ticketIds)
            ->select('t.ticket_ID', 't.ticket_status_ID', 'ts.status_name', 't.resolution_due_at', 't.resolved_at', 't.closed_at', 't.sla_status', 't.created_at')
            ->get()
            ->keyBy('ticket_ID')
            ->all();

        $periodMetrics = new AssignmentPeriodMetrics($this->slaOutcomes);
        $resolutionOutcomes = $periodMetrics->attributeResolutionOutcomes($allPeriods, $ticketsById, $now);

        // 4. CSAT per ticket (500 ms budget; empty when analytics is unavailable), credited to the
        // period that finished the ticket (AC-15)
        $csatScoresByTicket = $this->csatSnapshots->forTickets($ticketIds, $dateFrom, $dateTo)['ticket_ratings'];
        $ratingByPeriod = [];
        foreach ($allPeriods->groupBy('ticket_ID') as $ticketId => $ticketPeriods) {
            if (!isset($csatScoresByTicket[$ticketId])) {
                continue;
            }
            foreach ($periodMetrics->finishingPeriods($ticketPeriods->all()) as $period) {
                $ratingByPeriod[(int) $period->id] = (float) $csatScoresByTicket[$ticketId];
            }
        }

        // 5. Approved reassignment requests originating from these employees
        $approvedReassigns = DB::table('reassignment_requests')
            ->whereIn('employee_id', $empIds)
            ->where('status', 'approved')
            ->whereBetween('requested_at', [$dateFrom, $dateTo])
            ->select('employee_id', DB::raw('COUNT(*) as total'))
            ->groupBy('employee_id')
            ->pluck('total', 'employee_id')
            ->all();

        // 6. Per employee metrics
        $periodsByEmp = $windowPeriods->groupBy('employee_ID');
        $empRecords = [];
        $activeEmployeesCount = 0;

        foreach ($employees as $emp) {
            $empId = (int) $emp->emp_id;
            $empPeriods = ($periodsByEmp[$empId] ?? collect())->all();
            $figures = $periodMetrics->summarize($empPeriods, $resolutionOutcomes, $ratingByPeriod, $now);

            // Distinguish "no data for this period" from a zero value
            $hasData = !empty($empPeriods);
            if ($hasData) {
                $activeEmployeesCount++;
            }

            $approvedReassignCount = (int) ($approvedReassigns[$empId] ?? 0);
            $totalAssigned = $figures['tickets_assigned'];

            $empRecords[] = [
                'employee_id' => $empId,
                'name' => $this->displayName($emp),
                'department' => TechnicalDepartments::canonical($emp->department) ?? $emp->department,
                'role' => $emp->role,
                'position_level' => $emp->position_level,
                'has_data' => $hasData,
                'period_status' => $hasData ? 'active' : 'no_data',
            ] + $figures + [
                'reassignments_approved' => $approvedReassignCount,
                'reassignment_rate' => $totalAssigned > 0 ? round(($approvedReassignCount / $totalAssigned) * 100, 1) : null,
            ];
        }

        // Default order (AC-18): Performance Score high to low, not_enough_data last.
        $empRecords = $this->sortEmployeeRecords($empRecords, 'performance_score', 'desc');

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

        $cacheKey = "admin_dept_perf_v2_{$branch->slug}_" . md5(json_encode([
            'branch' => $branch->slug,
            'preset' => $preset,
            'from' => $dateFrom->toDateString(),
            'to' => $dateTo->toDateString(),
            'sort_by' => $sortBy,
            'sort_dir' => $sortDir,
            'tech' => TechnicalDepartments::normalizedList(),
        ]));

        if ($forceRefresh) {
            Cache::forget($cacheKey);
        }

        return Cache::remember($cacheKey, 120, function () use ($branch, $preset, $dateFrom, $dateTo, $sortBy, $sortDir) {
            return $this->computeDepartmentPerformanceData($branch, $preset, $dateFrom, $dateTo, $sortBy, $sortDir);
        });
    }

    /**
     * Compute department performance dataset. Lists exactly the configured technical departments,
     * each always present (spec 0031 AC-1). A ticket belongs to its assignee's department (AC-3).
     */
    protected function computeDepartmentPerformanceData(object $branch, string $preset, Carbon $dateFrom, Carbon $dateTo, string $sortBy, string $sortDir): array
    {
        $now = now();

        // 1. Technical department staff of the branch, grouped by configured department
        $employees = $this->branchTechnicalEmployeesQuery($branch)
            ->select('e.emp_id', 'e.first_name', 'e.last_name', 'e.email', 'e.department', 'e.role')
            ->get();

        $departmentsMap = [];
        foreach (TechnicalDepartments::list() as $deptName) {
            $departmentsMap[$deptName] = [];
        }
        foreach ($employees as $emp) {
            $deptName = TechnicalDepartments::canonical($emp->department);
            if ($deptName !== null) {
                $departmentsMap[$deptName][] = $emp;
            }
        }

        // 2. Branch tickets created in the window, with the assignee's department
        $ticketQuery = DB::table('tickets as t')
            ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->join('employees as e', 'e.emp_id', '=', 't.assigned_to')
            ->where('ts.status_name', '!=', 'Discarded')
            ->whereBetween('t.created_at', [$dateFrom, $dateTo]);
        TechnicalDepartments::applyEmployeeFilter($ticketQuery, 'e');
        $this->dashboardService->applyBranchTicketFilter($ticketQuery, $branch);

        $tickets = $ticketQuery->select(
            't.ticket_ID',
            't.assigned_to',
            'e.department as assignee_department',
            't.ticket_status_ID',
            'ts.status_name',
            't.resolution_due_at',
            't.resolved_at',
            't.closed_at',
            't.sla_status',
            't.created_at'
        )->get();

        // 3. SLA ticket set by outcome date (AC-4, AC-5)
        $slaQuery = DB::table('tickets as t')
            ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->join('employees as e', 'e.emp_id', '=', 't.assigned_to')
            ->where('ts.status_name', '!=', 'Discarded');
        TechnicalDepartments::applyEmployeeFilter($slaQuery, 'e');
        $this->dashboardService->applyBranchTicketFilter($slaQuery, $branch);
        $this->slaOutcomes->applyOutcomeWindow($slaQuery, $dateFrom, $dateTo);

        $slaTickets = $slaQuery->select(
            't.ticket_ID',
            'e.department as assignee_department',
            't.ticket_status_ID',
            'ts.status_name',
            't.resolution_due_at',
            't.resolved_at',
            't.closed_at',
            't.sla_status',
            't.created_at'
        )->get();

        $ticketsByDept = $tickets->groupBy(fn ($t) => TechnicalDepartments::canonical($t->assignee_department));
        $slaTicketsByDept = $slaTickets->groupBy(fn ($t) => TechnicalDepartments::canonical($t->assignee_department));

        // 4. CSAT per ticket
        $csatScoresByTicket = $this->csatSnapshots
            ->forTickets($tickets->pluck('ticket_ID')->all(), $dateFrom, $dateTo)['ticket_ratings'];

        // 5. Metrics per department
        $departmentSummaries = [];

        foreach ($departmentsMap as $deptName => $deptEmployees) {
            $deptTickets = $ticketsByDept->get($deptName, collect());
            $sla = $this->slaOutcomes->tally($slaTicketsByDept->get($deptName, collect()), $dateFrom, $dateTo, $now);
            $totalHandled = $deptTickets->count();

            if ($totalHandled === 0 && ($sla['met'] + $sla['breached']) === 0) {
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
                    'sla_met_count' => 0,
                    'sla_breached_count' => 0,
                    'csat_score' => null,
                    'open_tickets_count' => 0,
                    'overdue_tickets_count' => 0,
                    'unclosed_tickets_count' => 0,
                    'workload_distribution' => [],
                ];
                continue;
            }

            // Unclosed tickets split into still within SLA (open) and past due (overdue), same breach rule as AC-4.
            $openTickets = $deptTickets->filter(function ($t) {
                $st = strtolower(trim((string) $t->status_name));
                return !in_array($st, ['closed', 'resolved', 'discarded', 'cancelled'], true) && empty($t->resolved_at);
            });
            $openCount = $openTickets->count();
            $overdueCount = $openTickets->filter(fn ($t) => $this->slaOutcomes->isOpenBreach($t, $now))->count();

            $resolvedTickets = $deptTickets->filter(function ($t) {
                $st = strtolower(trim((string) $t->status_name));
                return in_array($st, ['resolved', 'closed'], true) || !empty($t->resolved_at);
            });
            $resolvedCount = $resolvedTickets->count();

            $ratings = [];
            foreach ($deptTickets->pluck('ticket_ID')->all() as $tId) {
                if (isset($csatScoresByTicket[$tId])) {
                    $ratings[] = $csatScoresByTicket[$tId];
                }
            }

            // Workload distribution: open tickets per employee within the department
            $activeAssignedCounts = $openTickets->groupBy('assigned_to')->map->count();
            $workloadDist = [];
            foreach ($deptEmployees as $de) {
                $count = $activeAssignedCounts[$de->emp_id] ?? 0;
                $workloadDist[] = [
                    'employee_id' => $de->emp_id,
                    'name' => $this->displayName($de),
                    'active_tickets_count' => $count,
                    'share_percentage' => $openCount > 0 ? round(($count / $openCount) * 100, 1) : 0.0,
                ];
            }

            $departmentSummaries[] = [
                'department' => $deptName,
                'staff_count' => count($deptEmployees),
                'has_data' => true,
                'period_status' => 'active',
                'total_tickets' => $totalHandled,
                'resolved_tickets' => $resolvedCount,
                'resolution_rate' => $totalHandled > 0 ? round(($resolvedCount / $totalHandled) * 100, 1) : null,
                'avg_resolution_hours' => $this->averageHours($resolvedTickets, 'resolved_at'),
                'sla_compliance_rate' => $sla['rate'],
                'sla_met_count' => $sla['met'],
                'sla_breached_count' => $sla['breached'],
                'csat_score' => !empty($ratings) ? round(array_sum($ratings) / count($ratings), 2) : null,
                // Open means unclosed and still within SLA; overdue means unclosed and already breached.
                'open_tickets_count' => max(0, $openCount - $overdueCount),
                'overdue_tickets_count' => $overdueCount,
                'unclosed_tickets_count' => $openCount,
                'workload_distribution' => $workloadDist,
            ];
        }

        // 6. Server-side sorting; departments without data sort last
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

    protected function averageHours($rows, string $endColumn): ?float
    {
        [$seconds, $samples] = $this->elapsed($rows, $endColumn);

        return $samples > 0 ? round(($seconds / $samples) / 3600, 1) : null;
    }

    /**
     * @return array{0: int, 1: int} [total seconds from created_at to $endColumn, sample count]
     */
    protected function elapsed($rows, string $endColumn): array
    {
        $seconds = 0;
        $samples = 0;
        foreach ($rows as $row) {
            if (!empty($row->{$endColumn}) && !empty($row->created_at)) {
                $start = Carbon::parse($row->created_at);
                $end = Carbon::parse($row->{$endColumn});
                if ($end->gte($start)) {
                    $seconds += $end->diffInSeconds($start);
                    $samples++;
                }
            }
        }

        return [$seconds, $samples];
    }

    protected function displayName(object $emp): string
    {
        $fullName = trim("{$emp->first_name} {$emp->last_name}");
        if ($fullName !== '') {
            return $fullName;
        }

        $emailPrefix = explode('@', (string) ($emp->email ?? ''))[0] ?? '';

        return $emailPrefix !== ''
            ? ucwords(str_replace(['.', '_', '-'], ' ', $emailPrefix))
            : 'Employee #' . $emp->emp_id;
    }
}
