<?php

namespace App\Services;

use Carbon\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class SuperAdminDashboardService
{
    protected SLAService $slaService;
    protected TicketCacheService $cacheService;

    public const ALLOWED_SORT_COLUMNS = [
        'total_tickets',
        'active_tickets',
        'escalated_tickets',
        'sla_breaches',
        'sla_compliance_rate',
        'avg_resolution_hours',
        'csat_score',
        'branch_name',
    ];

    public function __construct(SLAService $slaService, TicketCacheService $cacheService)
    {
        $this->slaService = $slaService;
        $this->cacheService = $cacheService;
    }

    /**
     * Retrieve complete system wide dashboard payload with Redis caching and branch comparisons.
     */
    public function getSystemDashboard(
        array $filters = [],
        string $sortBy = 'total_tickets',
        string $sortDir = 'desc',
        int $activityLimit = 15,
        bool $forceRefresh = false
    ): array {
        // Validate sort parameters
        $sortBy = strtolower(trim($sortBy));
        if (!in_array($sortBy, self::ALLOWED_SORT_COLUMNS, true)) {
            throw ValidationException::withMessages([
                'sort_by' => 'Invalid sort field. Allowed values: ' . implode(', ', self::ALLOWED_SORT_COLUMNS),
            ]);
        }

        $sortDir = strtolower(trim($sortDir));
        $sortDir = in_array($sortDir, ['asc', 'desc'], true) ? $sortDir : 'desc';

        $activityLimit = min(50, max(1, $activityLimit));

        // Resolve date boundaries
        [$dateFrom, $dateTo, $presetName] = $this->resolveDateRange($filters);

        // Redis cache key (60 second TTL)
        $cacheKey = 'system_dashboard_' . md5(json_encode([
            'from' => $dateFrom ? $dateFrom->format('Y-m-d H:i:s') : 'all',
            'to' => $dateTo ? $dateTo->format('Y-m-d H:i:s') : 'all',
            'preset' => $presetName,
            'sort_by' => $sortBy,
            'sort_dir' => $sortDir,
            'activity_limit' => $activityLimit,
        ]));

        if ($forceRefresh) {
            Cache::forget($cacheKey);
        }

        return Cache::remember($cacheKey, 60, function () use (
            $dateFrom,
            $dateTo,
            $presetName,
            $sortBy,
            $sortDir,
            $activityLimit
        ) {
            return $this->computeSystemDashboardData(
                $dateFrom,
                $dateTo,
                $presetName,
                $sortBy,
                $sortDir,
                $activityLimit
            );
        });
    }

    /**
     * Compute system dashboard dataset.
     */
    protected function computeSystemDashboardData(
        ?Carbon $dateFrom,
        ?Carbon $dateTo,
        string $presetName,
        string $sortBy,
        string $sortDir,
        int $activityLimit
    ): array {
        $now = Carbon::now();

        // 1. User counts by role (cached aggregate from user replica)
        $userCounts = $this->getUserCountsByRole();

        // 2. Base tickets query bounded by date range
        $ticketsQuery = DB::table('tickets');
        if ($dateFrom) {
            $ticketsQuery->where('created_at', '>=', $dateFrom);
        }
        if ($dateTo) {
            $ticketsQuery->where('created_at', '<=', $dateTo);
        }

        $totalTickets = (clone $ticketsQuery)->count();

        // Active tickets (open, in progress, on hold)
        $activeTickets = DB::table('tickets')
            ->whereNotIn('ticket_status_ID', [3, 4, 10, 12]) // resolved, closed, cancelled, discarded
            ->whereNull('resolved_at')
            ->count();

        // Escalated tickets
        $escalatedTickets = DB::table('tickets')
            ->where(function ($q) {
                $hasEscCheck = false;
                if (\Illuminate\Support\Facades\Schema::hasColumn('tickets', 'is_escalated')) {
                    $q->where('is_escalated', 1);
                    $hasEscCheck = true;
                }
                if (\Illuminate\Support\Facades\Schema::hasColumn('tickets', 'escalation_reason')) {
                    if ($hasEscCheck) {
                        $q->orWhereNotNull('escalation_reason');
                    } else {
                        $q->whereNotNull('escalation_reason');
                    }
                }
            })
            ->whereNotIn('ticket_status_ID', [4, 10, 12])
            ->count();

        // SLA breaches in range
        $slaBreachesCount = (clone $ticketsQuery)
            ->where(function ($q) {
                $q->where('sla_status', 'Breached');
                if (\Illuminate\Support\Facades\Schema::hasColumn('tickets', 'is_sla_breached')) {
                    $q->orWhere('is_sla_breached', 1);
                }
                $q->orWhere(function ($sub) {
                    $sub->whereNotNull('resolution_due_at')
                        ->where('resolution_due_at', '<', now())
                        ->whereNull('resolved_at');
                });
            })
            ->count();

        // Invariant: tickets_created_today strictly anchored to current calendar date, ignoring date filters
        $todayStart = Carbon::today()->startOfDay();
        $todayEnd = Carbon::today()->endOfDay();
        $ticketsCreatedToday = DB::table('tickets')
            ->whereBetween('created_at', [$todayStart, $todayEnd])
            ->count();

        // 3. System wide KPIs
        // SLA compliance rate: percentage of resolved tickets meeting resolution_due_at + active tickets on track
        $compliantTickets = (clone $ticketsQuery)
            ->where(function ($q) {
                $q->where(function ($sub) {
                    $sub->whereNotNull('resolved_at')
                        ->whereNotNull('resolution_due_at')
                        ->whereColumn('resolved_at', '<=', 'resolution_due_at');
                })->orWhere(function ($sub) {
                    $sub->whereNull('resolved_at')
                        ->where(function ($track) {
                            $track->whereNull('resolution_due_at')
                                ->orWhere('resolution_due_at', '>=', now());
                        });
                });
            })
            ->count();

        $slaComplianceRate = $totalTickets > 0 ? round(($compliantTickets / $totalTickets) * 100, 1) : 100.0;

        // Average resolution time in hours
        $resolvedRows = (clone $ticketsQuery)
            ->whereNotNull('resolved_at')
            ->select('created_at', 'resolved_at')
            ->get();

        $totalResHours = 0;
        $resolvedCount = $resolvedRows->count();
        foreach ($resolvedRows as $r) {
            $c = Carbon::parse($r->created_at);
            $res = Carbon::parse($r->resolved_at);
            $totalResHours += max(0, $c->diffInMinutes($res) / 60);
        }
        $avgResolutionHours = $resolvedCount > 0 ? round($totalResHours / $resolvedCount, 1) : 0.0;

        // CSAT score from ticket_feedback or default 4.8
        $avgCsat = 0.0;
        if (DB::getSchemaBuilder()->hasTable('ticket_feedback')) {
            $csatVal = DB::table('ticket_feedback')->avg('rating');
            $avgCsat = $csatVal ? round((float) $csatVal, 1) : 4.8;
        } else {
            $avgCsat = 4.8;
        }

        // 4. Branch Comparisons
        $branchComparisons = $this->getBranchComparisons($dateFrom, $dateTo, $sortBy, $sortDir);

        // 5. Recent Activity Feed from ticket_audit_logs
        $recentActivity = $this->getRecentActivity($activityLimit);

        return [
            'summary' => [
                'total_tickets' => (int) $totalTickets,
                'active_tickets' => (int) $activeTickets,
                'escalated_tickets' => (int) $escalatedTickets,
                'sla_breaches' => (int) $slaBreachesCount,
                'tickets_created_today' => (int) $ticketsCreatedToday,
                'users_by_role' => $userCounts,
            ],
            'kpis' => [
                'sla_compliance_rate' => $slaComplianceRate,
                'avg_resolution_hours' => $avgResolutionHours,
                'csat_score' => $avgCsat,
            ],
            'branch_comparisons' => $branchComparisons,
            'recent_activity' => $recentActivity,
            'meta' => [
                'cached' => true,
                'generated_at' => $now->toIso8601String(),
                'filters_applied' => [
                    'preset' => $presetName,
                    'date_from' => $dateFrom ? $dateFrom->toDateString() : null,
                    'date_to' => $dateTo ? $dateTo->toDateString() : null,
                    'sort_by' => $sortBy,
                    'sort_dir' => $sortDir,
                    'activity_limit' => $activityLimit,
                ],
            ],
        ];
    }

    /**
     * Aggregate total active users by role across employees and clients.
     */
    public function getUserCountsByRole(): array
    {
        return Cache::remember('system_dashboard_user_counts', 60, function () {
            $empRoles = DB::table('employees')
                ->where('is_active', 1)
                ->select('role', DB::raw('COUNT(*) as count'))
                ->groupBy('role')
                ->get();

            $superadminCount = 0;
            $adminCount = 0;
            $csCount = 0;
            $employeeCount = 0;

            foreach ($empRoles as $row) {
                $roleNorm = strtolower(str_replace([' ', '_', '-'], '', (string) $row->role));
                $count = (int) $row->count;

                if (str_contains($roleNorm, 'superadmin')) {
                    $superadminCount += $count;
                } elseif (str_contains($roleNorm, 'admin')) {
                    $adminCount += $count;
                } elseif (str_contains($roleNorm, 'customer') || str_contains($roleNorm, 'cs')) {
                    $csCount += $count;
                } else {
                    $employeeCount += $count;
                }
            }

            $customerCount = DB::table('clients')->count();
            $totalUsers = $superadminCount + $adminCount + $csCount + $employeeCount + $customerCount;

            return [
                'superadmin' => $superadminCount,
                'admin' => $adminCount,
                'cs' => $csCount,
                'employee' => $employeeCount,
                'customer' => $customerCount,
                'total' => $totalUsers,
            ];
        });
    }

    /**
     * Compute sortable branch comparison metrics.
     */
    public function getBranchComparisons(
        ?Carbon $dateFrom,
        ?Carbon $dateTo,
        string $sortBy = 'total_tickets',
        string $sortDir = 'desc'
    ): array {
        $branches = DB::table('branches')
            ->where('is_active', 1)
            ->get();

        $results = [];

        foreach ($branches as $branch) {
            $branchId = (int) $branch->id;
            $branchSlug = $branch->slug ?? (string) $branchId;

            // Tickets query for this branch (matching branch_id or branch slug)
            $bQuery = DB::table('tickets')
                ->where(function ($q) use ($branchId, $branchSlug) {
                    $q->where('branch_id', $branchId)
                        ->orWhere('branch_id', $branchSlug);
                });

            if ($dateFrom) {
                $bQuery->where('created_at', '>=', $dateFrom);
            }
            if ($dateTo) {
                $bQuery->where('created_at', '<=', $dateTo);
            }

            $bTickets = (clone $bQuery)->get();
            $bTotal = $bTickets->count();

            // Active tickets
            $bActive = $bTickets->filter(function ($t) {
                return !in_array((int) ($t->ticket_status_ID ?? 0), [3, 4, 10, 12], true) && empty($t->resolved_at);
            })->count();

            // Escalated tickets
            $bEscalated = $bTickets->filter(function ($t) {
                return (!empty($t->is_escalated) || !empty($t->escalation_reason)) && !in_array((int) ($t->ticket_status_ID ?? 0), [4, 10, 12], true);
            })->count();

            // SLA breaches
            $bBreaches = $bTickets->filter(function ($t) {
                if (($t->sla_status ?? '') === 'Breached' || !empty($t->is_sla_breached)) {
                    return true;
                }
                if (!empty($t->resolution_due_at) && empty($t->resolved_at)) {
                    return Carbon::parse($t->resolution_due_at)->isPast();
                }
                return false;
            })->count();

            // SLA compliance rate
            $bCompliant = $bTickets->filter(function ($t) {
                if (!empty($t->resolved_at) && !empty($t->resolution_due_at)) {
                    return Carbon::parse($t->resolved_at)->lte(Carbon::parse($t->resolution_due_at));
                }
                if (empty($t->resolved_at)) {
                    return empty($t->resolution_due_at) || Carbon::parse($t->resolution_due_at)->gte(now());
                }
                return true;
            })->count();

            $bComplianceRate = $bTotal > 0 ? round(($bCompliant / $bTotal) * 100, 1) : 100.0;

            // Resolution hours
            $resTickets = $bTickets->filter(fn ($t) => !empty($t->resolved_at));
            $resHoursSum = 0;
            foreach ($resTickets as $rt) {
                $resHoursSum += max(0, Carbon::parse($rt->created_at)->diffInMinutes(Carbon::parse($rt->resolved_at)) / 60);
            }
            $bAvgResHours = $resTickets->count() > 0 ? round($resHoursSum / $resTickets->count(), 1) : 0.0;

            // Branch CSAT score
            $bCsat = 4.8;

            $results[] = [
                'branch_id' => $branchId,
                'branch_name' => $branch->name,
                'branch_code' => $branch->code ?? strtoupper(substr($branch->name, 0, 3)),
                'total_tickets' => (int) $bTotal,
                'active_tickets' => (int) $bActive,
                'escalated_tickets' => (int) $bEscalated,
                'sla_breaches' => (int) $bBreaches,
                'sla_compliance_rate' => $bComplianceRate,
                'avg_resolution_hours' => $bAvgResHours,
                'csat_score' => $bCsat,
            ];
        }

        // Sort branch comparisons collection
        usort($results, function ($a, $b) use ($sortBy, $sortDir) {
            $valA = $a[$sortBy] ?? 0;
            $valB = $b[$sortBy] ?? 0;

            if ($valA == $valB) {
                return 0;
            }

            if ($sortDir === 'asc') {
                return ($valA < $valB) ? -1 : 1;
            }
            return ($valA > $valB) ? -1 : 1;
        });

        return $results;
    }

    /**
     * Fetch recent activity feed from ticket_audit_logs.
     */
    public function getRecentActivity(int $limit = 15): array
    {
        $records = DB::table('ticket_audit_logs as tal')
            ->leftJoin('employees as e', function ($join) {
                $join->on('e.emp_id', '=', 'tal.action_by_ID')
                    ->whereIn('tal.actor_type', ['employee', 'superadmin', 'admin', 'cs', 'systemadministrator', 'itadmin']);
            })
            ->leftJoin('clients as c', function ($join) {
                $join->on('c.id', '=', 'tal.action_by_ID')
                    ->where('tal.actor_type', '=', 'customer');
            })
            ->leftJoin('tickets as t', 't.ticket_ID', '=', 'tal.ticket_ID')
            ->select(
                'tal.log_ID as log_id',
                'tal.ticket_ID as ticket_id',
                't.ticket_number',
                'tal.action_type',
                'tal.event_type',
                'tal.action_by_ID as actor_id',
                'tal.actor_type',
                'tal.actor_role',
                'tal.details',
                'tal.is_system',
                'tal.is_internal',
                'tal.created_at',
                DB::raw("TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))) as employee_name"),
                'c.client_name as customer_name'
            )
            ->orderByDesc('tal.created_at')
            ->orderByDesc('tal.log_ID')
            ->limit($limit)
            ->get();

        return $records->map(function ($row) {
            $actorName = 'System';
            if ((bool) $row->is_system) {
                $actorName = 'System';
            } elseif ($row->actor_type === 'customer' && !empty($row->customer_name)) {
                $actorName = $row->customer_name;
            } elseif (!empty($row->employee_name)) {
                $actorName = $row->employee_name;
            } elseif ($row->actor_id > 0) {
                $actorName = 'User #' . $row->actor_id;
            }

            return [
                'log_id' => (int) $row->log_id,
                'ticket_id' => (int) $row->ticket_id,
                'ticket_number' => $row->ticket_number,
                'action_type' => $row->action_type,
                'event_type' => $row->event_type ?: $row->action_type,
                'actor_id' => (int) $row->actor_id,
                'actor_name' => $actorName,
                'actor_role' => $row->actor_role ?: $row->actor_type,
                'details' => $row->details,
                'is_system' => (bool) $row->is_system,
                'is_internal' => (bool) $row->is_internal,
                'created_at' => Carbon::parse($row->created_at)->toIso8601String(),
            ];
        })->values()->all();
    }

    /**
     * Resolve date range from preset or custom date filters.
     */
    protected function resolveDateRange(array $filters): array
    {
        $now = Carbon::now();
        $preset = $filters['preset'] ?? null;

        if (!empty($filters['date_from']) || !empty($filters['date_to'])) {
            $from = !empty($filters['date_from']) ? Carbon::parse($filters['date_from'])->startOfDay() : null;
            $to = !empty($filters['date_to']) ? Carbon::parse($filters['date_to'])->endOfDay() : $now->copy()->endOfDay();
            return [$from, $to, 'custom'];
        }

        if (empty($preset)) {
            $preset = 'last_7_days';
        }

        $presetLower = strtolower(str_replace([' ', '-'], '_', $preset));

        switch ($presetLower) {
            case 'today':
                return [$now->copy()->startOfDay(), $now->copy()->endOfDay(), 'today'];
            case 'yesterday':
                return [$now->copy()->subDay()->startOfDay(), $now->copy()->subDay()->endOfDay(), 'yesterday'];
            case 'this_week':
                return [$now->copy()->startOfWeek(), $now->copy()->endOfWeek(), 'this_week'];
            case 'last_7_days':
                return [$now->copy()->subDays(6)->startOfDay(), $now->copy()->endOfDay(), 'last_7_days'];
            case 'this_month':
                return [$now->copy()->startOfMonth(), $now->copy()->endOfMonth(), 'this_month'];
            case 'last_30_days':
                return [$now->copy()->subDays(29)->startOfDay(), $now->copy()->endOfDay(), 'last_30_days'];
            case 'all_time':
            case 'all':
                return [null, null, 'all_time'];
            default:
                return [$now->copy()->subDays(6)->startOfDay(), $now->copy()->endOfDay(), 'last_7_days'];
        }
    }
}
