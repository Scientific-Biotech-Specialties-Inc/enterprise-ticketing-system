<?php

namespace App\Services;

use App\Support\TechnicalDepartments;
use Carbon\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Employee and department performance for the admin dashboard and admin reports.
 *
 * Spec 0031: only technical departments (config ticketing.technical_departments) are listed; SLA compliance
 * comes from SlaOutcomeService by outcome date; a missing rate is null; CSAT comes from CsatSnapshotService;
 * nothing here calls the auth module.
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
     * Enforces Assigned Employee capacity and clear no_data period response.
     */
    public function getEmployeePerformanceMetrics($user, array $filters = [], bool $forceRefresh = false): array
    {
        $branch = $this->dashboardService->resolveBranchScope($user, $filters);
        [$preset, $dateFrom, $dateTo] = $this->resolveDateRange($filters);

        $departmentFilter = $filters['department'] ?? null;
        $employeeIdFilter = !empty($filters['employee_id']) ? (int) $filters['employee_id'] : null;

        $cacheKey = "admin_emp_perf_v2_{$branch->slug}_" . md5(json_encode([
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

        // 2. Tickets created in the window that these employees held as Assigned Employee
        // (tickets.assigned_to or an active ticket_assignments row). Requester-only activity never counts.
        $tickets = $this->assignedTicketsQuery($branch, $empIds)
            ->whereBetween('t.created_at', [$dateFrom, $dateTo])
            ->select(
                't.ticket_ID',
                't.assigned_to',
                'ta.employee_ID as assignment_emp_id',
                't.ticket_status_ID',
                'ts.status_name',
                't.resolution_due_at',
                't.resolved_at',
                't.closed_at',
                't.first_response_at',
                't.sla_status',
                't.created_at'
            )->distinct()->get();

        // 3. SLA ticket set by outcome date (spec 0031 AC-4, AC-5), same assignment rule
        $slaQuery = $this->assignedTicketsQuery($branch, $empIds);
        $this->slaOutcomes->applyOutcomeWindow($slaQuery, $dateFrom, $dateTo);
        $slaTickets = $slaQuery->select(
            't.ticket_ID',
            't.assigned_to',
            'ta.employee_ID as assignment_emp_id',
            't.ticket_status_ID',
            'ts.status_name',
            't.resolution_due_at',
            't.resolved_at',
            't.closed_at',
            't.sla_status',
            't.created_at'
        )->distinct()->get();

        $ticketsByEmp = $this->indexByAssignee($tickets);
        $slaOutcomesByEmp = [];
        foreach ($this->indexByAssignee($slaTickets) as $empId => $rows) {
            $slaOutcomesByEmp[$empId] = $this->slaOutcomes->tally($rows, $dateFrom, $dateTo, $now);
        }

        // 4. Approved reassignment requests originating from these employees
        $approvedReassigns = DB::table('reassignment_requests')
            ->whereIn('employee_id', $empIds)
            ->where('status', 'approved')
            ->whereBetween('requested_at', [$dateFrom, $dateTo])
            ->select('employee_id', DB::raw('COUNT(*) as total'))
            ->groupBy('employee_id')
            ->pluck('total', 'employee_id')
            ->all();

        // 5. CSAT per ticket (500 ms budget; empty when analytics is unavailable)
        $csatScoresByTicket = $this->csatSnapshots
            ->forTickets($tickets->pluck('ticket_ID')->all(), $dateFrom, $dateTo)['ticket_ratings'];

        // 6. Per employee metrics
        $empRecords = [];
        $activeEmployeesCount = 0;

        foreach ($employees as $emp) {
            $empId = (int) $emp->emp_id;
            $fullName = $this->displayName($emp);

            $assignedTickets = collect($ticketsByEmp[$empId] ?? []);
            $totalAssigned = $assignedTickets->count();

            $sla = $slaOutcomesByEmp[$empId] ?? ['met' => 0, 'breached' => 0, 'rate' => null];
            $hasSlaOutcomes = ($sla['met'] + $sla['breached']) > 0;

            // Distinguish "no data for this period" from a zero value
            if ($totalAssigned === 0 && !$hasSlaOutcomes) {
                $empRecords[] = [
                    'employee_id' => $empId,
                    'name' => $fullName,
                    'department' => TechnicalDepartments::canonical($emp->department) ?? $emp->department,
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

            $resolvedTickets = $assignedTickets->filter(function ($t) {
                $st = strtolower(trim((string) $t->status_name));
                return in_array($st, ['resolved', 'closed'], true) || !empty($t->resolved_at);
            });
            $resolvedCount = $resolvedTickets->count();

            $avgResolutionHours = $this->averageHours($resolvedTickets, 'resolved_at');
            $avgResponseMinutes = $this->averageMinutes($assignedTickets, 'first_response_at');

            $approvedReassignCount = (int) ($approvedReassigns[$empId] ?? 0);

            $ratings = [];
            foreach ($assignedTickets->pluck('ticket_ID')->all() as $tId) {
                if (isset($csatScoresByTicket[$tId])) {
                    $ratings[] = $csatScoresByTicket[$tId];
                }
            }

            $empRecords[] = [
                'employee_id' => $empId,
                'name' => $fullName,
                'department' => TechnicalDepartments::canonical($emp->department) ?? $emp->department,
                'role' => $emp->role,
                'position_level' => $emp->position_level,
                'has_data' => true,
                'period_status' => 'active',
                'tickets_assigned' => $totalAssigned,
                'tickets_resolved' => $resolvedCount,
                'resolution_rate' => $totalAssigned > 0 ? round(($resolvedCount / $totalAssigned) * 100, 1) : null,
                'average_resolution_hours' => $avgResolutionHours,
                'average_response_minutes' => $avgResponseMinutes,
                'sla_compliance_rate' => $sla['rate'],
                'sla_met_count' => $sla['met'],
                'sla_breached_count' => $sla['breached'],
                'reassignments_approved' => $approvedReassignCount,
                'reassignment_rate' => $totalAssigned > 0 ? round(($approvedReassignCount / $totalAssigned) * 100, 1) : null,
                'csat_score' => !empty($ratings) ? round(array_sum($ratings) / count($ratings), 2) : null,
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

    /**
     * Branch tickets these employees held as Assigned Employee: tickets.assigned_to or an active ticket_assignments row.
     */
    protected function assignedTicketsQuery(object $branch, array $empIds)
    {
        $query = DB::table('tickets as t')
            ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->leftJoin('ticket_assignments as ta', function ($join) {
                $join->on('ta.ticket_ID', '=', 't.ticket_ID')
                     ->whereNull('ta.completed_at');
            })
            ->where('ts.status_name', '!=', 'Discarded');

        $this->dashboardService->applyBranchTicketFilter($query, $branch);

        return $query->where(function ($q) use ($empIds) {
            $q->whereIn('t.assigned_to', $empIds)
              ->orWhereIn('ta.employee_ID', $empIds);
        });
    }

    /**
     * Group ticket rows under every employee who held them (direct assignee or active delegate), once per ticket.
     *
     * @return array<int, array<int, object>>
     */
    protected function indexByAssignee($rows): array
    {
        $byEmp = [];
        foreach ($rows as $row) {
            foreach (array_unique(array_filter([(int) ($row->assigned_to ?? 0), (int) ($row->assignment_emp_id ?? 0)])) as $empId) {
                $byEmp[$empId][$row->ticket_ID] = $row;
            }
        }

        return array_map('array_values', $byEmp);
    }

    protected function averageHours($rows, string $endColumn): ?float
    {
        [$seconds, $samples] = $this->elapsed($rows, $endColumn);

        return $samples > 0 ? round(($seconds / $samples) / 3600, 1) : null;
    }

    protected function averageMinutes($rows, string $endColumn): ?float
    {
        [$seconds, $samples] = $this->elapsed($rows, $endColumn);

        return $samples > 0 ? round(($seconds / $samples) / 60, 1) : null;
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
