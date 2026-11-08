<?php

namespace App\Services;

use App\Support\TechnicalDepartments;
use Carbon\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class TicketDashboardService
{
    protected ?SLAService $slaService;

    public function __construct(?SLAService $slaService = null)
    {
        $this->slaService = $slaService ?? app(SLAService::class);
    }

    public function slaLabel($createdAt, $ticket = null): string
    {
        if ($ticket) {
            return $this->slaService->computeTicketSlaMetrics($ticket)['status'];
        }

        if (!$createdAt) {
            return 'On Track';
        }

        $createdAtObj = is_string($createdAt) ? Carbon::parse($createdAt) : $createdAt;
        $hours = now()->diffInHours($createdAtObj);
        if ($hours >= 48) {
            return 'Breached';
        }
        if ($hours >= 24) {
            return 'At Risk';
        }
        return 'On Track';
    }

    /**
     * Get summary metrics and recent tickets for the customer dashboard with optional combinable filters (TS021).
     */
    public function getCustomerDashboard(int $createdBy, int $limit, array $filters = []): array
    {
        $hasFilters = !empty(array_filter($filters, fn($v) => $v !== null && $v !== ''));
        $filterKey = $hasFilters ? md5(json_encode($filters)) : 'none';

        $summary = Cache::remember("customer_dashboard_counts_{$createdBy}", 60, function () use ($createdBy) {
            $statusCounts = DB::table('tickets as t')
                ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
                ->select('ts.status_name', DB::raw('COUNT(*) as total'))
                ->where('t.created_by', $createdBy)
                ->where('t.is_internal', false)
                ->where('t.ticket_status_ID', '!=', 9)
                ->where('ts.status_name', '!=', 'Discarded')
                ->groupBy('ts.status_name')
                ->get();

            $sum = [
                'open' => 0,
                'in_progress' => 0,
                'resolved' => 0,
                'closed' => 0,
            ];

            foreach ($statusCounts as $row) {
                $key = str_replace(' ', '_', strtolower($row->status_name));
                if (array_key_exists($key, $sum)) {
                    $sum[$key] = (int) $row->total;
                }
            }
            return $sum;
        });

        $fetchQuery = function () use ($createdBy, $limit, $filters) {
            $query = DB::table('tickets as t')
                ->leftJoin('machines as m', 'm.machine_ID', '=', 't.machine_ID')
                ->leftJoin('machine_categories as mc', 'mc.category_ID', '=', 'm.category_ID')
                ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
                ->join('problem_categories as pc', 'pc.problem_category_ID', '=', 't.problem_category_ID')
                ->leftJoin('ticket_priorities as tp', 'tp.priority_ID', '=', 't.priority_ID')
                ->leftJoin('employees as e', 'e.emp_id', '=', 't.assigned_to')
                ->leftJoin('ticket_assignments as ta', function ($join) {
                    $join->on('ta.ticket_ID', '=', 't.ticket_ID')
                         ->whereNull('ta.completed_at');
                })
                ->leftJoin('employees as e_ta', 'e_ta.emp_id', '=', 'ta.employee_ID')
                ->select(
                    't.ticket_ID',
                    't.ticket_number',
                    't.machine_ID',
                    't.title',
                    't.description',
                    'm.machine_name',
                    'm.serial_number',
                    'mc.category_name as equipment_type',
                    'ts.status_name',
                    't.created_at',
                    't.updated_at',
                    't.assigned_to',
                    'pc.category_name',
                    'tp.priority_name',
                    DB::raw("COALESCE(CONCAT(e.first_name, ' ', e.last_name), CONCAT(e_ta.first_name, ' ', e_ta.last_name)) as assigned_employee_name")
                )
                ->where('t.created_by', $createdBy)
                ->where('t.is_internal', false);

            // TS021: Combinable AND filters
            if (!empty($filters['search'])) {
                $term = '%' . trim($filters['search']) . '%';
                $query->where(function ($q) use ($term) {
                    $q->where('t.ticket_number', 'LIKE', $term)
                      ->orWhere('t.ticket_ID', 'LIKE', $term)
                      ->orWhere('t.title', 'LIKE', $term)
                      ->orWhere('t.description', 'LIKE', $term)
                      ->orWhere('m.machine_name', 'LIKE', $term)
                      ->orWhere('m.serial_number', 'LIKE', $term);
                });
            }

            if (!empty($filters['status'])) {
                $statusVal = trim($filters['status']);
                $query->where(function ($q) use ($statusVal) {
                    $q->where('ts.status_name', $statusVal)
                      ->orWhere('t.ticket_status_ID', $statusVal);
                });
            }

            if (!empty($filters['category_id'])) {
                $query->where('t.problem_category_ID', (int) $filters['category_id']);
            } elseif (!empty($filters['category'])) {
                $catVal = trim($filters['category']);
                $query->where('pc.category_name', $catVal);
            }

            if (!empty($filters['machine_id'])) {
                $query->where('t.machine_ID', (int) $filters['machine_id']);
            }

            if (!empty($filters['priority_id'])) {
                $query->where('t.priority_ID', (int) $filters['priority_id']);
            }

            if (!empty($filters['date_from'])) {
                $query->where('t.created_at', '>=', Carbon::parse($filters['date_from'])->startOfDay());
            }

            if (!empty($filters['date_to'])) {
                $query->where('t.created_at', '<=', Carbon::parse($filters['date_to'])->endOfDay());
            }

            return $query->orderByDesc('t.created_at')
                ->limit($limit * 2)
                ->get()
                ->unique('ticket_ID')
                ->take($limit)
                ->map(fn ($row) => [
                    'id' => TicketNumberGeneratorService::refFor($row->ticket_ID, $row->ticket_number ?? null),
                    'ticket_ID' => $row->ticket_ID,
                    'machine_ID' => $row->machine_ID,
                    'machine_name' => $row->machine_name,
                    'equipment_type' => $row->equipment_type ?: 'Medical Equipment',
                    'equipmentType' => $row->equipment_type ?: 'Medical Equipment',
                    'title' => $row->title,
                    'description' => $row->description,
                    'category' => $row->category_name,
                    'equipment' => $row->machine_name . ' - ' . $row->serial_number,
                    'status' => $row->status_name,
                    'priority' => $row->priority_name ?? 'Low',
                    'date_created' => $row->created_at ? Carbon::parse($row->created_at)->toIso8601String() : null,
                    'last_updated' => ($row->updated_at ?? $row->created_at) ? Carbon::parse($row->updated_at ?? $row->created_at)->toIso8601String() : null,
                    'created_at' => $row->created_at ? Carbon::parse($row->created_at)->toIso8601String() : null,
                    'updated_at' => $row->updated_at ? Carbon::parse($row->updated_at)->toIso8601String() : null,
                    'assigned_to' => $row->assigned_to,
                    'assigned_employee' => $row->assigned_employee_name,
                    'assigned_employee_name' => $row->assigned_employee_name,
                    'assigned_to_name' => $row->assigned_employee_name,
                ])
                ->values()
                ->toArray();
        };

        $recentTickets = $hasFilters
            ? $fetchQuery()
            : Cache::remember("customer_dashboard_recent_{$createdBy}_{$limit}", 60, $fetchQuery);

        return [
            'summary' => $summary,
            'recent_tickets' => $recentTickets,
        ];
    }

    /**
     * Get dynamic filter options for customer tickets (TS021).
     */
    public function getCustomerFilterOptions(int $createdBy): array
    {
        $machines = DB::table('tickets as t')
            ->join('machines as m', 'm.machine_ID', '=', 't.machine_ID')
            ->where('t.created_by', $createdBy)
            ->where('t.is_internal', false)
            ->select('m.machine_ID', 'm.machine_name', 'm.serial_number')
            ->distinct()
            ->get()
            ->map(fn($m) => [
                'machine_ID' => $m->machine_ID,
                'label' => "{$m->machine_name} - {$m->serial_number}",
            ]);

        $categories = DB::table('tickets as t')
            ->join('problem_categories as pc', 'pc.problem_category_ID', '=', 't.problem_category_ID')
            ->where('t.created_by', $createdBy)
            ->where('t.is_internal', false)
            ->select('pc.problem_category_ID', 'pc.category_name')
            ->distinct()
            ->get();

        $statuses = DB::table('ticket_statuses')
            ->where('status_name', '!=', 'Discarded')
            ->select('ticket_status_ID', 'status_name')
            ->get();

        $priorities = DB::table('ticket_priorities')
            ->select('priority_ID', 'priority_name')
            ->get();

        $employees = DB::table('employees')
            ->whereRaw('LOWER(COALESCE(role, "")) NOT IN (?, ?, ?, ?)', ['customer service', 'head of cs', 'head of customer service', 'superadmin'])
            ->select('emp_id as id', DB::raw("CONCAT(first_name, ' ', last_name) as name"))
            ->orderBy('first_name')
            ->get();

        return [
            'machines' => $machines,
            'categories' => $categories,
            'statuses' => $statuses,
            'priorities' => $priorities,
            'employees' => $employees,
        ];
    }

    /**
     * Get summary metrics and recent tickets for the customer service dashboard.
     */
    public function getCsDashboard(int $limit): array
    {
        $summary = Cache::remember('cs_dashboard_counts', 60, function () {
            $statusCounts = DB::table('tickets as t')
                ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
                ->where('ts.status_name', '!=', 'Discarded')
                ->select('ts.status_name', DB::raw('COUNT(*) as total'))
                ->groupBy('ts.status_name')
                ->get();

            $sum = [
                'open' => 0,
                'in_progress' => 0,
                'resolved' => 0,
                'closed' => 0,
                'sla_breached' => 0,
                'breached' => 0,
                'high_priority' => 0,
                'highPriority' => 0,
            ];

            foreach ($statusCounts as $row) {
                $key = str_replace(' ', '_', strtolower($row->status_name));
                if (array_key_exists($key, $sum)) {
                    $sum[$key] = (int) $row->total;
                }
            }

            // Real SLA Breached count across active unresolved tickets
            $slaBreachedCount = DB::table('tickets as t')
                ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
                ->whereNotIn('ts.status_name', ['Closed', 'Resolved', 'Discarded', 'Cancelled'])
                // Spec 0037 (AC-13): the shared SLA rule, so this matches the CS queue cards.
                ->whereRaw(...(function () {
                    [$sql, $bindings] = $this->slaService->slaStatusKeySql('t', 'ts');
                    return ["{$sql} = ?", array_merge($bindings, ['breached'])];
                })())
                ->count();
            $sum['sla_breached'] = $slaBreachedCount;
            $sum['breached'] = $slaBreachedCount;

            // High and Critical priority tickets across active unresolved tickets
            $highPriorityCount = DB::table('tickets as t')
                ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
                ->join('ticket_priorities as tp', 'tp.priority_ID', '=', 't.priority_ID')
                ->whereNotIn('ts.status_name', ['Closed', 'Resolved', 'Discarded', 'Cancelled'])
                ->whereIn(DB::raw('LOWER(tp.priority_name)'), ['high', 'critical', 'urgent'])
                ->count();
            $sum['high_priority'] = $highPriorityCount;
            $sum['highPriority'] = $highPriorityCount;

            return $sum;
        });

        $recentTickets = Cache::remember("cs_dashboard_recent_{$limit}", 60, function () use ($limit) {
            return DB::table('tickets as t')
                ->leftJoin('machines as m', 'm.machine_ID', '=', 't.machine_ID')
                ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
                ->leftJoin('ticket_priorities as tp', 'tp.priority_ID', '=', 't.priority_ID')
                ->leftJoin('clients as c', 'c.id', '=', 't.created_by')
                ->leftJoin('employees as req', 'req.emp_id', '=', 't.requested_by')
                ->where('ts.status_name', '!=', 'Discarded')
                ->select(
                    't.ticket_ID',
                    't.ticket_number',
                    't.title',
                    't.is_internal',
                    't.ticket_status_ID',
                    't.priority_ID',
                    't.resolution_due_at',
                    't.sla_status',
                    't.sla_rule_id',
                    't.sla_ID',
                    't.branch_sla_policy_id',
                    't.branch_priority_override_id',
                    't.resolved_at',
                    't.closed_at',
                    'm.machine_name',
                    'm.serial_number',
                    'ts.status_name',
                    'tp.priority_name',
                    't.created_at',
                    't.updated_at',
                    't.requested_by',
                    'c.client_name',
                    DB::raw("TRIM(CONCAT(COALESCE(req.first_name, ''), ' ', COALESCE(req.last_name, ''))) as requester_employee_name")
                )
                ->orderByDesc('t.created_at')
                ->limit($limit)
                ->get()
                ->map(function ($row) {
                    $slaMetrics = $this->slaService->computeTicketSlaMetrics($row);
                    return [
                        'id' => TicketNumberGeneratorService::refFor($row->ticket_ID, $row->ticket_number ?? null),
                        'ticket_ID' => $row->ticket_ID,
                        'title' => $row->title,
                        'customer' => (bool) $row->is_internal
                            ? (($row->requester_employee_name !== '' && $row->requester_employee_name !== null) ? $row->requester_employee_name : ($row->requested_by ? 'Employee #' . $row->requested_by : 'Internal Requester'))
                            : ($row->client_name ?: 'Unknown Customer'),
                        'equipment' => $row->machine_name . ' - ' . $row->serial_number,
                        'status' => $row->status_name,
                        'priority' => $row->priority_name,
                        'sla' => $slaMetrics['status'],
                        'sla_status' => $slaMetrics['status'],
                        'slaStatus' => $slaMetrics['status'],
                        'resolution_due_at' => $slaMetrics['due_at'],
                        'due_at' => $slaMetrics['due_at'],
                        'time_remaining_minutes' => $slaMetrics['time_remaining_minutes'],
                        'is_breached' => $slaMetrics['is_breached'],
                        'created_at' => $row->created_at ? Carbon::parse($row->created_at)->toIso8601String() : null,
                        'updated_at' => $row->updated_at ? Carbon::parse($row->updated_at)->toIso8601String() : null,
                        'requested_by' => $row->requested_by,
                    ];
                })
                ->values()
                ->toArray();
        });

        return [
            'summary' => $summary,
            'recent_tickets' => $recentTickets,
        ];
    }

    /**
     * Get paginated incoming tickets list for CS with filtering (TS023).
     */
    public function getCsIncoming(int $perPage, string $typeFilter, int $page, array $filters = [], bool $forceRefresh = false): array
    {
        $hasFilters = !empty(array_filter($filters, fn($v) => $v !== null && $v !== ''));
        $filterKey = $hasFilters ? md5(json_encode($filters)) : 'none';
        $cacheKey = "cs_incoming_tickets_{$perPage}_{$typeFilter}_{$page}_{$filterKey}";

        $fetchQuery = function () use ($perPage, $typeFilter, $page, $filters) {
            $query = DB::table('tickets as t')
                ->join('problem_categories as pc', 'pc.problem_category_ID', '=', 't.problem_category_ID')
                ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
                ->leftJoin('branches as b', 'b.id', '=', 't.branch_id')
                ->leftJoin('clients as c', 'c.id', '=', 't.created_by')
                ->leftJoin('employees as req', 'req.emp_id', '=', 't.requested_by')
                ->leftJoin('machines as m', 'm.machine_ID', '=', 't.machine_ID')
                ->leftJoin('machine_categories as mc', 'mc.category_ID', '=', 'm.category_ID')
                ->leftJoin('ticket_priorities as tp', 'tp.priority_ID', '=', 't.priority_ID')
                ->leftJoin('employees as e', 'e.emp_id', '=', 't.assigned_to')
                ->leftJoin('ticket_types as tt', 'tt.ticket_type_ID', '=', 't.ticket_type_ID')
                ->where('ts.status_name', '!=', 'Discarded')
                ->select(
                    't.ticket_ID',
                    't.ticket_number',
                    't.title',
                    't.description',
                    't.is_internal',
                    't.created_by',
                    't.requested_by',
                    't.ticket_status_ID',
                    't.resolution_due_at',
                    't.response_due_at',
                    't.resolved_at',
                    't.closed_at',
                    't.first_response_at',
                    't.resolution_sla_status',
                    't.response_sla_status',
                    // Spec 0037 (AC-12, AC-13): the SLA rule reads the source columns and stored status.
                    't.sla_status',
                    't.sla_rule_id',
                    't.sla_ID',
                    't.branch_sla_policy_id',
                    't.branch_priority_override_id',
                    'pc.category_name',
                    'ts.status_name',
                    'tp.priority_name',
                    'e.department',
                    't.created_at',
                    't.updated_at',
                    'c.client_name',
                    DB::raw("TRIM(CONCAT(COALESCE(req.first_name, ''), ' ', COALESCE(req.last_name, ''))) as requester_employee_name"),
                    'm.machine_name',
                    'm.serial_number',
                    'mc.category_name as equipment_type',
                    'tt.type_name as ticket_type',
                    't.proof_rejected',
                    't.rejection_reason',
                    't.last_reminder_sent_at',
                    't.hold_reason',
                    't.escalation_reason',
                    DB::raw("COALESCE(b.name, 'Main Branch') as branch"),
                    DB::raw("COALESCE(b.name, 'Main Branch') as branch_name")
                );

            if ($typeFilter === 'internal') {
                $query->where('t.is_internal', true);
            } elseif ($typeFilter === 'external') {
                $query->where('t.is_internal', false);
            }

            // Spec 0037 (AC-14, AC-16): the CS queue tabs. No scope keeps the old
            // behaviour (every ticket), which CS History, the manager pages, and
            // Messaging rely on.
            $scope = $filters['scope'] ?? null;
            if ($scope === 'incoming') {
                $this->applyIncomingScope($query);
            } elseif ($scope === 'assigned') {
                $this->applyAssignedScope($query);
            }

            // Tab counts cover the whole scope, before any filter, as the tabs always have.
            $tabCounts = $scope ? $this->csTabCounts(clone $query, $scope) : null;

            // TS023: Search and combinable filters. Every word must match some field.
            if (!empty($filters['search'])) {
                $tokens = preg_split('/[\s,]+/', trim((string) $filters['search']), -1, PREG_SPLIT_NO_EMPTY);
                foreach ($tokens as $token) {
                    $term = '%' . $token . '%';
                    $query->where(function ($q) use ($term) {
                        $q->where('t.ticket_number', 'LIKE', $term)
                          ->orWhere('t.ticket_ID', 'LIKE', $term)
                          ->orWhere('t.title', 'LIKE', $term)
                          ->orWhere('t.description', 'LIKE', $term)
                          ->orWhere('c.client_name', 'LIKE', $term)
                          ->orWhereRaw("TRIM(CONCAT(COALESCE(req.first_name, ''), ' ', COALESCE(req.last_name, ''))) LIKE ?", [$term])
                          ->orWhere('m.machine_name', 'LIKE', $term)
                          ->orWhere('m.serial_number', 'LIKE', $term)
                          ->orWhere('pc.category_name', 'LIKE', $term)
                          ->orWhere('ts.status_name', 'LIKE', $term)
                          ->orWhere('tp.priority_name', 'LIKE', $term)
                          ->orWhere('e.department', 'LIKE', $term);
                    });
                }
            }

            if (!empty($filters['status'])) {
                $stVal = trim($filters['status']);
                $query->where(function ($q) use ($stVal) {
                    $q->where('ts.status_name', $stVal)
                      ->orWhere('t.ticket_status_ID', $stVal);
                });
            }

            if (!empty($filters['department'])) {
                $query->where('e.department', trim($filters['department']));
            }

            if (!empty($filters['category'])) {
                $query->where('pc.category_name', trim($filters['category']));
            }

            if (!empty($filters['customer_id'])) {
                $query->where('t.created_by', (int) $filters['customer_id']);
            } elseif (!empty($filters['customer_name'])) {
                // Exact name, as shown in the queue: the client, or the requester of an internal ticket.
                $name = trim($filters['customer_name']);
                $query->where(function ($q) use ($name) {
                    $q->where(function ($ext) use ($name) {
                        $ext->where('t.is_internal', false)->where('c.client_name', $name);
                    })->orWhere(function ($int) use ($name) {
                        $int->where('t.is_internal', true)
                            ->whereRaw("TRIM(CONCAT(COALESCE(req.first_name, ''), ' ', COALESCE(req.last_name, ''))) = ?", [$name]);
                    });
                });
            } elseif (!empty($filters['customer'])) {
                $query->where('c.client_name', 'LIKE', '%' . trim($filters['customer']) . '%');
            }

            if (!empty($filters['machine_id'])) {
                $query->where('t.machine_ID', (int) $filters['machine_id']);
            } elseif (!empty($filters['machine'])) {
                $query->where(function ($q) use ($filters) {
                    $raw = trim($filters['machine']);
                    $mVal = '%' . $raw . '%';
                    $q->where('m.machine_name', 'LIKE', $mVal)
                      ->orWhere('m.serial_number', 'LIKE', $mVal)
                      // Dropdown labels read "Name - Serial".
                      ->orWhereRaw("CONCAT(COALESCE(m.machine_name, ''), ' - ', COALESCE(m.serial_number, '')) = ?", [$raw]);
                });
            }

            if (!empty($filters['assignment'])) {
                $this->applyAssignmentFilter($query, (string) $filters['assignment']);
            }

            if ($scope && !empty($filters['tab'])) {
                $this->applyCsTab($query, $scope, (string) $filters['tab']);
            }

            // Spec 0037 (AC-13): one SLA rule. The same CASE expression drives the summary
            // counts, the sla_status filter, and (through computeTicketSlaMetrics) the row badges.
            [$slaKeySql, $slaKeyBindings] = $this->slaService->slaStatusKeySql('t', 'ts');

            // Summary counts over the filtered scope, before the SLA filter and pagination.
            $summaryRows = DB::query()
                ->fromSub((clone $query)->select('t.ticket_ID')->selectRaw("{$slaKeySql} as sla_key", $slaKeyBindings), 'scoped')
                ->select('sla_key', DB::raw('COUNT(*) as aggregate'))
                ->groupBy('sla_key')
                ->pluck('aggregate', 'sla_key');

            $slaSummary = [
                'total' => (int) $summaryRows->sum(),
                'breached' => 0,
                'at_risk' => 0,
                'on_track' => 0,
                'paused' => 0,
                'compliant' => 0,
                'no_sla' => 0,
                'unavailable' => 0,
            ];
            foreach ($summaryRows as $key => $count) {
                if (array_key_exists($key, $slaSummary)) {
                    $slaSummary[$key] = (int) $count;
                }
            }

            // Filter by SLA status if requested (same rule, in SQL, so it covers every page).
            $slaFilterKey = SLAService::normalizeSlaFilterKey($filters['sla_status'] ?? null);
            if ($slaFilterKey !== null && $slaFilterKey !== 'invalid') {
                $query->whereRaw("{$slaKeySql} = ?", array_merge($slaKeyBindings, [$slaFilterKey]));
            }

            // Sorting
            $sortBy = $filters['sort_by'] ?? null;
            $sortDir = strtolower($filters['sort_dir'] ?? 'desc') === 'asc' ? 'asc' : 'desc';

            if ($sortBy === 'sla_urgent') {
                // Breached first, then At Risk, then everything else; soonest due date first within each.
                $query->orderByRaw("FIELD({$slaKeySql}, 'at_risk', 'breached') DESC", $slaKeyBindings)
                    ->orderByRaw('t.resolution_due_at IS NULL')
                    ->orderBy('t.resolution_due_at', 'asc');
            } elseif ($sortBy === 'sla_due_date' || $sortBy === 'resolution_due_at' || $sortBy === 'due_date') {
                // Tickets with no due date sort last (spec 0037: no guessed 48 hour deadline).
                $query->orderByRaw('t.resolution_due_at IS NULL')->orderBy('t.resolution_due_at', $sortDir);
            } elseif ($sortBy === 'sla_status') {
                $query->orderByRaw(
                    "FIELD({$slaKeySql}, 'breached', 'at_risk', 'on_track', 'paused', 'compliant', 'no_sla', 'unavailable') " . ($sortDir === 'asc' ? 'ASC' : 'DESC'),
                    $slaKeyBindings
                );
            } else {
                $query->orderByDesc(DB::raw('COALESCE(t.updated_at, t.created_at)'));
            }

            $paginated = $query->paginate($perPage, ['*'], 'page', $page);

            $rows = collect($paginated->items());
            $ticketIds = $rows->pluck('ticket_ID')->toArray();

            $assignments = collect();
            $pendingReassigns = collect();

            if (!empty($ticketIds)) {
                $assignments = DB::table('ticket_assignments as ta')
                    ->leftJoin('employees as e', 'e.emp_id', '=', 'ta.employee_ID')
                    ->whereIn('ta.ticket_ID', $ticketIds)
                    ->select(
                        'ta.*',
                        DB::raw("CONCAT(e.first_name, ' ', e.last_name) as employee_name"),
                        'e.department as employee_department'
                    )
                    ->get()
                    ->groupBy('ticket_ID');

                $pendingReassigns = DB::table('reassignment_requests as rr')
                    ->leftJoin('employees as e', 'e.emp_id', '=', 'rr.employee_id')
                    ->whereIn('rr.ticket_id', $ticketIds)
                    ->where('rr.status', 'pending')
                    ->select(
                        'rr.*',
                        DB::raw("CONCAT(e.first_name, ' ', e.last_name) as requesting_employee_name"),
                        'e.department as requesting_employee_department'
                    )
                    ->get()
                    ->groupBy('ticket_id')
                    ->map(fn($group) => $group->sortByDesc('request_id')->first());
            }

            $incomingTickets = $rows->map(function ($row) use ($assignments, $pendingReassigns) {
                $assignedList = isset($assignments[$row->ticket_ID]) ? $assignments[$row->ticket_ID] : collect();

                $assignedIds = $assignedList->pluck('employee_ID')->map(fn($id) => (int)$id)->all();

                $assignedNames = $assignedList->pluck('employee_name')->filter()->implode(', ') ?: null;

                $accepted = $assignedList->contains('assignment_status', 'accepted');

                $assignedEmployees = $assignedList->map(function ($a) {
                    return [
                        'id' => (int) $a->employee_ID,
                        'name' => $a->employee_name ?: ('Engineer #' . $a->employee_ID),
                        'department' => $a->employee_department ?? null,
                        'assignment_status' => $a->assignment_status ?: 'assigned',
                        'assigned_at' => $a->assigned_at ? Carbon::parse($a->assigned_at)->toIso8601String() : null,
                        'accepted_at' => $a->accepted_at ? Carbon::parse($a->accepted_at)->toIso8601String() : null,
                    ];
                })->values()->all();

                $pendingReassign = $pendingReassigns->get($row->ticket_ID);

                $createdAt = $row->created_at ?? null;
                $updatedAt = $row->updated_at ?? null;
                $createdAtObj = is_string($createdAt) ? Carbon::parse($createdAt) : $createdAt;
                $updatedAtObj = is_string($updatedAt) ? Carbon::parse($updatedAt) : $updatedAt;

                $equipment = $row->machine_name ? ($row->machine_name . ($row->serial_number ? ' - ' . $row->serial_number : '')) : ($row->serial_number ?: 'Not specified');

                $slaMetrics = $this->slaService->computeTicketSlaMetrics($row);

                return [
                    'id' => TicketNumberGeneratorService::refFor($row->ticket_ID, $row->ticket_number ?? null),
                    'ticket_ID' => (int) $row->ticket_ID,
                    // Customer id, so CS views (e.g. the AI Chat tab) can look up this customer's records.
                    'created_by' => (bool) $row->is_internal ? null : ($row->created_by !== null ? (int) $row->created_by : null),
                    'customer' => (bool) $row->is_internal
                        ? (($row->requester_employee_name !== '' && $row->requester_employee_name !== null) ? $row->requester_employee_name : ($row->requested_by ? 'Employee #' . $row->requested_by : 'Internal Requester'))
                        : ($row->client_name ?: 'Unknown Customer'),
                    'title' => $row->title,
                    'description' => $row->description ?? '',
                    'category' => $row->category_name,
                    'status' => $row->status_name,
                    'priority' => $row->priority_name,
                    'department' => $row->department,
                    'equipment' => $equipment,
                    'equipment_type' => $row->equipment_type ?: 'Medical Equipment',
                    'equipmentType' => $row->equipment_type ?: 'Medical Equipment',
                    'machine_name' => $row->machine_name,
                    'serial_number' => $row->serial_number,
                    'sla' => $slaMetrics['status'],
                    'sla_status' => $slaMetrics['status'],
                    'slaStatus' => $slaMetrics['status'],
                    'resolution_due_at' => $slaMetrics['due_at'],
                    'due_at' => $slaMetrics['due_at'],
                    'time_remaining_minutes' => $slaMetrics['time_remaining_minutes'],
                    'is_breached' => $slaMetrics['is_breached'],
                    'is_at_risk' => $slaMetrics['is_at_risk'],
                    'is_paused' => $slaMetrics['is_paused'],
                    'date' => $createdAtObj ? $createdAtObj->toIso8601String() : now()->toIso8601String(),
                    'created_at' => $createdAtObj ? $createdAtObj->toIso8601String() : null,
                    'updated_at' => $updatedAtObj ? $updatedAtObj->toIso8601String() : ($createdAtObj ? $createdAtObj->toIso8601String() : null),
                    'assigned' => $assignedIds,
                    'assigned_employee' => $assignedNames,
                    'assigned_employee_name' => $assignedNames,
                    'assigned_employees' => $assignedEmployees,
                    'accepted' => $accepted,
                    'reassignmentRequested' => !empty($pendingReassign),
                    'reassignmentReason' => $pendingReassign ? $pendingReassign->reason : null,
                    'reassignmentRequestedBy' => $pendingReassign ? ($pendingReassign->requesting_employee_name ?: 'Assigned Employee') : null,
                    'reassignmentDepartment' => $pendingReassign ? ($pendingReassign->requesting_employee_department ?: $row->department) : $row->department,
                    'reassignmentRequestedAt' => $pendingReassign ? ($pendingReassign->requested_at ? Carbon::parse($pendingReassign->requested_at)->toIso8601String() : ($pendingReassign->created_at ? Carbon::parse($pendingReassign->created_at)->toIso8601String() : null)) : null,
                    'reassignmentEmployeeId' => $pendingReassign ? (int)$pendingReassign->employee_id : null,
                    'proofRejected' => (bool)$row->proof_rejected,
                    'rejectionReason' => $row->rejection_reason,
                    'hold_reason' => $row->hold_reason ?? null,
                    'escalation_reason' => $row->escalation_reason ?? null,
                    'type' => $row->ticket_type ?? 'External',
                    'ticket_type' => $row->ticket_type ?? 'External',
                    'is_internal' => (bool)$row->is_internal,
                    'requested_by' => $row->requested_by,
                    'last_reminder_sent_at' => $row->last_reminder_sent_at ? Carbon::parse($row->last_reminder_sent_at)->toIso8601String() : null,
                ];
            })->values()->toArray();

            return [
                'incoming_tickets' => $incomingTickets,
                'sla_summary' => $slaSummary,
                'pagination' => [
                    'total' => $paginated->total(),
                    'per_page' => $paginated->perPage(),
                    'current_page' => $paginated->currentPage(),
                    'last_page' => $paginated->lastPage(),
                ],
                // Spec 0037 (AC-14) response fields. The keys above stay for existing callers.
                'data' => $incomingTickets,
                'total' => $paginated->total(),
                'page' => $paginated->currentPage(),
                'per_page' => $paginated->perPage(),
                'last_page' => $paginated->lastPage(),
                'slaSummary' => $slaSummary,
                'scope' => $scope,
                'tab_counts' => $tabCounts,
            ];
        };

        if ($forceRefresh) {
            \Illuminate\Support\Facades\Cache::forget($cacheKey);
            return $fetchQuery();
        }

        return $hasFilters
            ? $fetchQuery()
            : Cache::remember($cacheKey, 60, $fetchQuery);
    }

    /** A pending reassignment request exists for the ticket. */
    private function pendingReassignSql(): string
    {
        return "EXISTS (SELECT 1 FROM reassignment_requests rr WHERE rr.ticket_id = t.ticket_ID AND rr.status = 'pending')";
    }

    private function hasAssignmentSql(): string
    {
        return 'EXISTS (SELECT 1 FROM ticket_assignments ta WHERE ta.ticket_ID = t.ticket_ID)';
    }

    private function acceptedAssignmentSql(): string
    {
        return "EXISTS (SELECT 1 FROM ticket_assignments ta WHERE ta.ticket_ID = t.ticket_ID AND ta.assignment_status = 'accepted')";
    }

    /** Assigned to someone who has not accepted yet, or explicitly Pending Assignment. */
    private function pendingAssignmentSql(): string
    {
        return "(ts.status_name = 'Pending Assignment' OR ({$this->hasAssignmentSql()} AND NOT {$this->acceptedAssignmentSql()}))";
    }

    /**
     * Spec 0037: the Incoming tab's membership, formerly computed in CSIncoming.jsx.
     * Excludes tickets with a pending reassignment, accepted tickets unless Reopened,
     * and Pending Evaluation tickets unless Reopened.
     */
    public function applyIncomingScope($query): void
    {
        $query->whereRaw("NOT {$this->pendingReassignSql()}")
            ->whereRaw("NOT ({$this->acceptedAssignmentSql()} AND ts.status_name NOT IN ('Reopened', 'Reopen'))")
            ->where('ts.status_name', '!=', 'Pending Evaluation');
    }

    /**
     * Spec 0037: the Assigned tab's membership, formerly computed in CSAssigned.jsx.
     */
    public function applyAssignedScope($query): void
    {
        $query->where(function ($q) {
            $q->whereRaw($this->pendingReassignSql())
              ->orWhereIn('ts.status_name', ['Pending Assignment', 'In Progress', 'Pending Evaluation', 'Resolved', 'Pending', 'Closed', 'On Hold'])
              ->orWhereRaw($this->hasAssignmentSql());
        });
    }

    /** The assignment status dropdown on the Incoming tab. */
    private function applyAssignmentFilter($query, string $assignment): void
    {
        match (strtolower(str_replace([' ', '-'], '_', trim($assignment)))) {
            'pending_assignment' => $query->whereRaw($this->pendingAssignmentSql()),
            'pending_reassign' => $query->whereRaw($this->pendingReassignSql()),
            'pending_evaluation' => $query->where('ts.status_name', 'Pending Evaluation'),
            default => null,
        };
    }

    /** Sub tabs of each scope. */
    private function applyCsTab($query, string $scope, string $tab): void
    {
        if ($scope === 'incoming') {
            match ($tab) {
                'open' => $query->whereRaw("NOT {$this->pendingAssignmentSql()}"),
                'pending_assignment' => $query->whereRaw($this->pendingAssignmentSql()),
                default => null,
            };
            return;
        }

        match ($tab) {
            'in_progress' => $query->where('ts.status_name', 'In Progress'),
            'pending_evaluation' => $query->where('ts.status_name', 'Pending Evaluation'),
            'on_hold' => $query->where('ts.status_name', 'On Hold'),
            'reassigned' => $query->whereRaw($this->pendingReassignSql()),
            'resolved_closed' => $query->whereIn('ts.status_name', ['Resolved', 'Closed']),
            default => null,
        };
    }

    /** Tab badge counts over the whole scope. */
    private function csTabCounts($scopeQuery, string $scope): array
    {
        $count = fn (string $sql) => "SUM(CASE WHEN {$sql} THEN 1 ELSE 0 END)";
        $base = $scopeQuery->select([]);

        if ($scope === 'incoming') {
            $row = $base->selectRaw('COUNT(*) as all_count')
                ->selectRaw($count($this->pendingAssignmentSql()) . ' as pending_count')
                ->first();
            $all = (int) ($row->all_count ?? 0);
            $pending = (int) ($row->pending_count ?? 0);
            return ['all' => $all, 'pending' => $pending, 'open' => $all - $pending];
        }

        $row = $base->selectRaw('COUNT(*) as all_count')
            ->selectRaw($count("ts.status_name = 'In Progress'") . ' as in_progress')
            ->selectRaw($count("ts.status_name = 'Pending Evaluation'") . ' as pending_eval')
            ->selectRaw($count($this->pendingReassignSql()) . ' as reassigned')
            ->selectRaw($count("ts.status_name = 'On Hold'") . ' as on_hold')
            ->selectRaw($count("ts.status_name IN ('Resolved', 'Closed')") . ' as resolved_closed')
            ->first();

        return [
            'all' => (int) ($row->all_count ?? 0),
            'inProgress' => (int) ($row->in_progress ?? 0),
            'pendingEval' => (int) ($row->pending_eval ?? 0),
            'reassigned' => (int) ($row->reassigned ?? 0),
            'onHold' => (int) ($row->on_hold ?? 0),
            'resolvedClosed' => (int) ($row->resolved_closed ?? 0),
        ];
    }

    /**
     * Get dynamic filter options for CS queue (TS023).
     */
    public function getCsFilterOptions(): array
    {
        $departments = DB::table('departments')
            ->where('is_active', true)
            ->select('id', 'name')
            ->get();

        $statuses = DB::table('ticket_statuses')
            ->where('status_name', '!=', 'Discarded')
            ->select('ticket_status_ID', 'status_name')
            ->get();

        $machines = DB::table('machines')
            ->select('machine_ID', 'machine_name', 'serial_number')
            ->limit(100)
            ->get()
            ->map(fn($m) => [
                'machine_ID' => $m->machine_ID,
                'label' => "{$m->machine_name} - {$m->serial_number}",
            ]);

        // Spec 0037: the CS queue pages its rows on the server, so dropdown choices
        // come from here rather than from whichever tickets are on screen.
        $categories = DB::table('tickets as t')
            ->join('problem_categories as pc', 'pc.problem_category_ID', '=', 't.problem_category_ID')
            ->distinct()
            ->orderBy('pc.category_name')
            ->pluck('pc.category_name')
            ->filter()
            ->values();

        $customers = DB::table('tickets as t')
            ->leftJoin('clients as c', 'c.id', '=', 't.created_by')
            ->leftJoin('employees as req', 'req.emp_id', '=', 't.requested_by')
            ->selectRaw("DISTINCT CASE WHEN t.is_internal = 1 THEN TRIM(CONCAT(COALESCE(req.first_name, ''), ' ', COALESCE(req.last_name, ''))) ELSE c.client_name END as name")
            ->pluck('name')
            ->filter(fn ($n) => is_string($n) && trim($n) !== '')
            ->unique()
            ->sort()
            ->values();

        return [
            'departments' => $departments,
            'statuses' => $statuses,
            'machines' => $machines,
            'categories' => $categories,
            'customers' => $customers,
        ];
    }

    /**
     * Resolve branch record for the given user, enforcing server-side branch restriction for non-SuperAdmin.
     */
    public function resolveBranchScope($user, array $filters = []): object
    {
        $role = strtolower(trim((string) ($user->role ?? '')));
        $isSuperAdmin = in_array($role, ['superadmin', 'super admin'], true);

        $branch = null;

        if (!$isSuperAdmin && $user) {
            // Non-SuperAdmin Admin must be strictly locked to their branch
            if (!empty($user->branch_id)) {
                $branch = is_numeric($user->branch_id)
                    ? DB::table('branches')->where('id', (int) $user->branch_id)->first()
                    : DB::table('branches')->where('slug', (string) $user->branch_id)->first();
            }
            if (!$branch && !empty($user->branch)) {
                $branch = DB::table('branches')
                    ->where('slug', strtolower(trim($user->branch)))
                    ->orWhereRaw('LOWER(name) = ?', [strtolower(trim($user->branch))])
                    ->orWhereRaw('LOWER(code) = ?', [strtolower(trim($user->branch))])
                    ->first();
            }

            // Check if non-superadmin provided an explicit branch filter to attempt cross-branch access
            $target = trim((string) ($filters['branch'] ?? $filters['branch_id'] ?? ''));
            if ($target !== '' && strtolower($target) !== 'current' && strtolower($target) !== 'assigned') {
                $targetLower = strtolower($target);
                $userBranchId = (string) ($user->branch_id ?? '');
                $userBranchActualId = $branch ? (string) $branch->id : $userBranchId;
                $userBranchSlug = $branch ? strtolower((string) $branch->slug) : '';
                $userBranchCode = $branch ? strtolower((string) $branch->code) : '';
                $userBranchName = $branch ? strtolower((string) $branch->name) : strtolower(trim((string) ($user->branch ?? '')));

                $isMatch = (
                    $target === $userBranchId ||
                    $target === $userBranchActualId ||
                    $targetLower === $userBranchSlug ||
                    $targetLower === $userBranchCode ||
                    $targetLower === $userBranchName
                );

                if (!$isMatch) {
                    abort(403, 'Access denied: You are restricted to your assigned branch scope.');
                }
            }
        } else {
            // SuperAdmin can view 'all' (global scope) or a specified branch or default to 'all' or 'main'
            $target = trim((string) ($filters['branch'] ?? $filters['branch_id'] ?? ''));
            if (strtolower($target) === 'all') {
                return (object) [
                    'id' => 'all',
                    'slug' => 'all',
                    'name' => 'All Branches',
                    'code' => 'ALL',
                    'region' => 'Global',
                ];
            }
            if ($target !== '') {
                $branch = DB::table('branches')
                    ->where('slug', $target)
                    ->orWhere('id', is_numeric($target) ? (int)$target : -1)
                    ->orWhereRaw('LOWER(code) = ?', [strtolower($target)])
                    ->first();
            } elseif ($user && !empty($user->branch_id)) {
                $branch = is_numeric($user->branch_id)
                    ? DB::table('branches')->where('id', (int) $user->branch_id)->first()
                    : DB::table('branches')->where('slug', (string) $user->branch_id)->first();
            } else {
                return (object) [
                    'id' => 'all',
                    'slug' => 'all',
                    'name' => 'All Branches',
                    'code' => 'ALL',
                    'region' => 'Global',
                ];
            }
        }

        if (!$branch) {
            $branch = DB::table('branches')->where('slug', 'main')->orWhere('id', 1)->first();
        }

        if (!$branch) {
            $branch = (object) [
                'id' => 1,
                'slug' => 'main',
                'name' => 'Main Branch',
                'code' => 'MAIN',
                'region' => 'NCR',
            ];
        }

        return $branch;
    }

    /**
     * Apply server-side branch filter to tickets table query.
     */
    public function applyBranchTicketFilter($query, object $branch)
    {
        $branchId = (string) ($branch->id ?? '1');
        $branchSlug = (string) ($branch->slug ?? 'main');

        // AC-3: When SuperAdmin selects All Branches, do not apply branch filter
        if ($branchSlug === 'all' || $branchId === 'all') {
            return;
        }

        $branchCode = (string) ($branch->code ?? 'MAIN');
        $isMainBranch = ($branchId === '1' || $branchSlug === 'main' || $branchSlug === 'main-office' || $branchCode === 'MAIN');

        $query->where(function ($q) use ($branchId, $branchSlug, $branchCode, $isMainBranch) {
            $q->where('t.branch_id', $branchId)
              ->orWhere('t.branch_id', $branchSlug)
              ->orWhere('t.branch_id', $branchCode);

            if ($isMainBranch) {
                $q->orWhereNull('t.branch_id')
                  ->orWhere('t.branch_id', '')
                  ->orWhere('t.branch_id', 'main')
                  ->orWhere('t.branch_id', 'main-office')
                  ->orWhere('t.branch_id', '1');
            }
        });
    }

    /**
     * Get branch-scoped dashboard metrics and trends for Admin users.
     */
    public function getAdminDashboard($user, array $filters = [], bool $forceRefresh = false): array
    {
        $branch = $this->resolveBranchScope($user, $filters);
        $branchSlug = $branch->slug;

        // Parse date range
        [$preset, $dateFrom, $dateTo] = \App\Support\ReportPeriod::resolve($filters, 'Last 7 Days');

        $cacheKey = "admin_dashboard_metrics_v2_{$branchSlug}_" . md5(json_encode([
            'branch' => $branchSlug,
            'preset' => $preset,
            'from' => $dateFrom->format('Y-m-d H'),
            'to' => $dateTo->format('Y-m-d H'),
        ]));

        if ($forceRefresh) {
            Cache::forget($cacheKey);
        }

        return Cache::remember($cacheKey, 60, function () use ($branch, $preset, $dateFrom, $dateTo) {
            return $this->computeAdminDashboardData($branch, $preset, $dateFrom, $dateTo);
        });
    }

    /**
     * Compute full Admin dashboard dataset across KPIs, SLA, CSAT, workload, and trends.
     *
     * Spec 0031: ticket totals count every branch ticket; SLA figures use SlaOutcomeService by outcome date;
     * figures grouped by person or department cover only the technical departments; no auth module call.
     */
    protected function computeAdminDashboardData(object $branch, string $preset, Carbon $dateFrom, Carbon $dateTo): array
    {
        $slaOutcomes = app(SlaOutcomeService::class);
        $now = now();

        // 1. Fetch tickets in branch and date window
        $ticketQuery = DB::table('tickets as t')
            ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->leftJoin('problem_categories as pc', 'pc.problem_category_ID', '=', 't.problem_category_ID')
            ->leftJoin('ticket_priorities as tp', 'tp.priority_ID', '=', 't.priority_ID')
            ->leftJoin('machines as m', 'm.machine_ID', '=', 't.machine_ID')
            ->leftJoin('employees as e', 'e.emp_id', '=', 't.assigned_to')
            ->where('ts.status_name', '!=', 'Discarded');

        $this->applyBranchTicketFilter($ticketQuery, $branch);

        $tickets = (clone $ticketQuery)
            ->whereBetween('t.created_at', [$dateFrom, $dateTo])
            ->select(
                't.ticket_ID',
                't.ticket_number',
                't.title',
                't.is_internal',
                't.ticket_status_ID',
                'ts.status_name',
                't.priority_ID',
                'tp.priority_name',
                't.problem_category_ID',
                'pc.category_name',
                't.machine_ID',
                'm.machine_name',
                'm.serial_number',
                't.assigned_to',
                'e.first_name as assignee_first_name',
                'e.last_name as assignee_last_name',
                'e.department as assignee_department',
                't.resolution_due_at',
                't.response_due_at',
                't.resolved_at',
                't.closed_at',
                't.first_response_at',
                't.sla_status',
                't.created_at',
                't.updated_at'
            )
            ->get();

        $totalTickets = $tickets->count();

        // 2. Status distribution
        $statusCounts = [
            'open' => 0,
            'inProgress' => 0,
            'resolved' => 0,
            'closed' => 0,
            'onHold' => 0,
        ];
        $detailedStatusBreakdown = [];

        foreach ($tickets as $t) {
            $stName = strtolower(trim((string) $t->status_name));
            if ($stName === 'open' || $stName === 'pending') {
                $statusCounts['open']++;
            } elseif ($stName === 'in progress' || $stName === 'in-progress' || $stName === 'assigned') {
                $statusCounts['inProgress']++;
            } elseif ($stName === 'resolved') {
                $statusCounts['resolved']++;
            } elseif ($stName === 'closed') {
                $statusCounts['closed']++;
            } elseif ($stName === 'on hold' || $stName === 'paused') {
                $statusCounts['onHold']++;
            }
            $origName = $t->status_name ?: 'Other';
            $detailedStatusBreakdown[$origName] = ($detailedStatusBreakdown[$origName] ?? 0) + 1;
        }

        // 3. Average Resolution Time (null when nothing was resolved: never an invented value)
        $resolvedTickets = $tickets->filter(function ($t) {
            $st = strtolower(trim((string) $t->status_name));
            return in_array($st, ['resolved', 'closed']) && !empty($t->resolved_at ?? $t->closed_at);
        });

        $totalResolutionMinutes = 0;
        foreach ($resolvedTickets as $rt) {
            $created = Carbon::parse($rt->created_at);
            $ended = Carbon::parse($rt->resolved_at ?? $rt->closed_at);
            $totalResolutionMinutes += max(1, $ended->diffInMinutes($created));
        }
        $avgResolutionHours = $resolvedTickets->count() > 0
            ? round(($totalResolutionMinutes / $resolvedTickets->count()) / 60, 1)
            : null;

        // 4. SLA Compliance & Breaches by outcome date (spec 0031 AC-4, AC-5, AC-6)
        $slaTickets = $this->fetchSlaOutcomeTickets($branch, $dateFrom, $dateTo);
        $slaMet = 0;
        $slaBreached = 0;
        $slaByDepartment = [];
        foreach (TechnicalDepartments::list() as $deptName) {
            $slaByDepartment[$deptName] = [SlaOutcomeService::MET => 0, SlaOutcomeService::BREACHED => 0];
        }

        foreach ($slaTickets as $t) {
            $outcome = $slaOutcomes->classifyInWindow($t, $dateFrom, $dateTo, $now);
            if ($outcome === null) {
                continue;
            }
            $outcome === SlaOutcomeService::MET ? $slaMet++ : $slaBreached++;

            // AC-3: a ticket's department is its assignee's; unassigned tickets belong to no department.
            $deptName = TechnicalDepartments::canonical($t->assignee_department ?? null);
            if ($deptName !== null) {
                $slaByDepartment[$deptName][$outcome]++;
            }
        }

        $overallComplianceRate = $slaOutcomes->rate($slaMet, $slaBreached);

        $slaDeptList = [];
        foreach ($slaByDepartment as $dept => $data) {
            $met = $data[SlaOutcomeService::MET];
            $breached = $data[SlaOutcomeService::BREACHED];
            $slaDeptList[] = [
                'department' => $dept,
                'compliance_percentage' => $slaOutcomes->rate($met, $breached),
                'total' => $met + $breached,
                'met' => $met,
                'breached' => $breached,
            ];
        }

        // 5. Customer Satisfaction (CSAT): 500 ms budget, unavailable flag, never an invented score (AC-14)
        $csatData = app(CsatSnapshotService::class)->forTickets($tickets->pluck('ticket_ID')->all(), $dateFrom, $dateTo);

        // 6. Employee and department performance (technical departments only, AC-1, AC-2)
        $perfService = app(AdminPerformanceService::class);
        $perfFilters = [
            'branch_id' => $branch->id ?? $branch->slug ?? 'all',
            'preset' => $preset,
            'date_from' => $dateFrom->toDateString(),
            'date_to' => $dateTo->toDateString(),
        ];
        $empPerfMetrics = $perfService->getEmployeePerformanceMetrics((object) ['role' => 'superadmin'], $perfFilters);
        $deptPerfMetrics = $perfService->getDepartmentPerformanceMetrics((object) ['role' => 'superadmin'], $perfFilters);

        // Chart series reuse the per employee SLA rate so every SLA number shares one rule.
        $slaRateByEmp = [];
        foreach ($empPerfMetrics['employees'] ?? [] as $record) {
            $slaRateByEmp[$record['employee_id']] = $record['sla_compliance_rate'];
        }

        $branchEmployees = $this->getBranchEmployees($branch);
        $empWorkloads = $this->computeEmployeeWorkloads($branchEmployees, $dateFrom, $dateTo, $slaRateByEmp);

        $unifiedEmpPerf = $empWorkloads['performance'];
        $unifiedEmpPerf['employees'] = $empPerfMetrics['employees'] ?? [];

        // 7. Recurring issues (top categories & equipment)
        $recurringCategories = $this->computeRecurringCategories($branch, $dateFrom, $dateTo, $totalTickets);
        $recurringEquipment = $this->computeRecurringEquipment($branch, $dateFrom, $dateTo, $totalTickets);

        // 8. Trend series buckets matching preset
        $trendBuckets = $this->generateTrendBuckets($preset, $dateFrom, $dateTo, $tickets, $slaTickets);

        // 9. Cross-branch comparison table when viewing global All Branches scope
        $branchComparisons = [];
        if (($branch->slug ?? '') === 'all' || (string) ($branch->id ?? '') === 'all') {
            $branchComparisons = app(SuperAdminDashboardService::class)->getBranchComparisons($dateFrom, $dateTo, 'total_tickets', 'desc');
        }

        $csatScore = $csatData['average_score'] !== null ? round((float) $csatData['average_score'], 2) : null;

        return [
            'status' => 'success',
            'has_data' => ($totalTickets > 0),
            'branch' => [
                'id' => $branch->id ?? 1,
                'slug' => $branch->slug ?? 'main',
                'name' => $branch->name ?? 'Main Branch',
                'code' => $branch->code ?? 'MAIN',
                'region' => $branch->region ?? 'NCR',
            ],
            'period' => [
                'preset' => $preset,
                'date_from' => $dateFrom->toIso8601String(),
                'date_to' => $dateTo->toIso8601String(),
            ],
            'kpis' => [
                'total_tickets' => $totalTickets,
                // A closed ticket was resolved first, so Resolved Tickets counts both final states.
                'resolved_tickets' => $statusCounts['resolved'] + $statusCounts['closed'],
                'closed_tickets' => $statusCounts['closed'],
                'open_tickets' => $statusCounts['open'],
                'in_progress_tickets' => $statusCounts['inProgress'],
                'on_hold_tickets' => $statusCounts['onHold'],
                'active_tickets' => $statusCounts['open'] + $statusCounts['inProgress'],
                'avg_resolution_hours' => $avgResolutionHours,
                'sla_compliance_rate' => $overallComplianceRate,
                'sla_met_count' => $slaMet,
                'sla_breached_count' => $slaBreached,
                'csat_score' => $csatScore,
                'csat_available' => (bool) $csatData['available'],
                'satisfaction_percentage' => $csatData['satisfaction_percentage'],
                'total_csat_reviews' => $csatData['total_reviews'],
                'active_employees_count' => count($branchEmployees),
                'open_vs_closed' => [
                    'open' => $statusCounts['open'] + $statusCounts['inProgress'],
                    'closed' => $statusCounts['resolved'] + $statusCounts['closed'],
                ],
            ],
            'trends' => $trendBuckets['trends'],
            'status_distribution' => [
                'open' => $statusCounts['open'],
                'inProgress' => $statusCounts['inProgress'],
                'resolved' => $statusCounts['resolved'],
                'closed' => $statusCounts['closed'],
                'onHold' => $statusCounts['onHold'],
                'active_total' => $statusCounts['open'] + $statusCounts['inProgress'],
                'breakdown' => $detailedStatusBreakdown,
            ],
            'sla' => [
                'overall_compliance' => $overallComplianceRate,
                'sla_met' => $slaMet,
                'sla_breached' => $slaBreached,
                'compliance_trend' => $trendBuckets['sla_compliance'],
                'breaches_trend' => $trendBuckets['sla_breaches'],
                'resolution_time_trend' => $trendBuckets['resolution_time'],
                'by_department' => $slaDeptList,
            ],
            'employee_performance' => $unifiedEmpPerf,
            'departments' => $deptPerfMetrics['departments'] ?? [],
            'branch_comparisons' => $branchComparisons,
            'csat' => [
                'average_score' => $csatScore,
                'available' => (bool) $csatData['available'],
                'total_reviews' => $csatData['total_reviews'],
                'satisfaction_percentage' => $csatData['satisfaction_percentage'],
                'labels' => $trendBuckets['labels'],
                'trend' => $trendBuckets['csat'],
            ],
            'workload' => $empWorkloads['workload'],
            'recurring_issues' => [
                'top_categories' => $recurringCategories,
                'top_equipment' => $recurringEquipment,
            ],
        ];
    }

    /**
     * Branch tickets whose SLA outcome may fall in [from, to] (spec 0031 AC-5), with the assignee's department.
     * Callers still run SlaOutcomeService::classifyInWindow on each row.
     */
    protected function fetchSlaOutcomeTickets(object $branch, Carbon $dateFrom, Carbon $dateTo)
    {
        $query = DB::table('tickets as t')
            ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->leftJoin('employees as e', 'e.emp_id', '=', 't.assigned_to')
            ->where('ts.status_name', '!=', 'Discarded')
            ->whereNotNull('t.resolution_due_at');

        $this->applyBranchTicketFilter($query, $branch);
        app(SlaOutcomeService::class)->applyOutcomeWindow($query, $dateFrom, $dateTo);

        return $query->select(
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
    }

    /**
     * Get active technical department employees (Service and IT by default) belonging to the target branch.
     */
    protected function getBranchEmployees(object $branch): array
    {
        $branchId = (string) ($branch->id ?? '1');
        $branchSlug = (string) ($branch->slug ?? 'main');
        $branchName = (string) ($branch->name ?? 'Main Branch');
        $isMainBranch = ($branchId === '1' || $branchSlug === 'main' || $branchSlug === 'main-office');

        $query = DB::table('employees as e')
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

        TechnicalDepartments::applyEmployeeFilter($query, 'e');

        if ($branchSlug !== 'all' && $branchId !== 'all') {
            $query->where(function ($q) use ($branchId, $branchSlug, $branchName, $isMainBranch) {
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

        return $query->select('e.emp_id', 'e.first_name', 'e.last_name', 'e.email', 'e.department', 'e.role')->get()->all();
    }

    /**
     * Compute workload and performance chart series for branch employees.
     *
     * @param array<int, ?float> $slaRateByEmp per employee SLA rate from AdminPerformanceService (one shared rule)
     */
    protected function computeEmployeeWorkloads(array $branchEmployees, Carbon $dateFrom, Carbon $dateTo, array $slaRateByEmp = []): array
    {
        $deptWorkload = [];
        foreach (TechnicalDepartments::list() as $deptName) {
            $deptWorkload[$deptName] = 0;
        }

        $empIds = array_map(fn($e) => $e->emp_id, $branchEmployees);
        if (empty($empIds)) {
            return [
                'performance' => [
                    'labels' => [],
                    'resolved' => [],
                    'response_time' => [],
                    'resolution_time' => [],
                    'sla_compliance' => [],
                    'list' => [],
                    'employees' => [],
                ],
                'workload' => [
                    'by_employee' => [
                        'labels' => [],
                        'data' => [],
                    ],
                    'by_department' => [
                        'labels' => array_keys($deptWorkload),
                        'data' => array_values($deptWorkload),
                    ],
                    'details' => [],
                ],
            ];
        }

        // Active unresolved assigned tickets
        $activeAssigned = DB::table('tickets as t')
            ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->whereNotIn('ts.status_name', ['Closed', 'Resolved', 'Discarded', 'Cancelled'])
            ->whereIn('t.assigned_to', $empIds)
            ->select('t.assigned_to', DB::raw('COUNT(*) as total'))
            ->groupBy('t.assigned_to')
            ->pluck('total', 't.assigned_to')
            ->all();

        // Also check ticket_assignments for multi-assignee tickets
        $activeAssignments = DB::table('ticket_assignments as ta')
            ->join('tickets as t', 't.ticket_ID', '=', 'ta.ticket_ID')
            ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->whereNotIn('ts.status_name', ['Closed', 'Resolved', 'Discarded', 'Cancelled'])
            ->whereNull('ta.completed_at')
            ->whereIn('ta.employee_ID', $empIds)
            ->select('ta.employee_ID', DB::raw('COUNT(DISTINCT ta.ticket_ID) as total'))
            ->groupBy('ta.employee_ID')
            ->pluck('total', 'ta.employee_ID')
            ->all();

        // Period tickets assigned to these employees for real resolution and response times
        $periodTickets = DB::table('tickets as t')
            ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->where('ts.status_name', '!=', 'Discarded')
            ->whereIn('t.assigned_to', $empIds)
            ->whereBetween('t.created_at', [$dateFrom, $dateTo])
            ->select(
                't.ticket_ID',
                't.assigned_to',
                'ts.status_name',
                't.created_at',
                't.first_response_at',
                't.resolved_at',
                't.closed_at'
            )
            ->get()
            ->groupBy('assigned_to');

        $empLabels = [];
        $resolvedSeries = [];
        $responseSeries = [];
        $resolutionSeries = [];
        $slaSeries = [];
        $workloadEmpData = [];
        $details = [];

        foreach ($branchEmployees as $emp) {
            $name = trim("{$emp->first_name} {$emp->last_name}");
            if ($name === '') {
                $emailPrefix = explode('@', (string) ($emp->email ?? ''))[0] ?? '';
                $name = $emailPrefix !== ''
                    ? ucwords(str_replace(['.', '_', '-'], ' ', $emailPrefix))
                    : 'Employee #' . $emp->emp_id;
            }
            $empLabels[] = $name;
            $activeCount = max($activeAssigned[$emp->emp_id] ?? 0, $activeAssignments[$emp->emp_id] ?? 0);

            $empTickets = $periodTickets->get($emp->emp_id, collect());
            $resolvedTickets = $empTickets->filter(function ($t) {
                $st = strtolower(trim((string) $t->status_name));
                return in_array($st, ['resolved', 'closed'], true) || !empty($t->resolved_at);
            });
            $resolvedCount = $resolvedTickets->count();

            $resSecSum = 0;
            $resSample = 0;
            foreach ($resolvedTickets as $rt) {
                $endAt = $rt->resolved_at ?? $rt->closed_at;
                if (!empty($endAt) && !empty($rt->created_at)) {
                    $cAt = Carbon::parse($rt->created_at);
                    $rAt = Carbon::parse($endAt);
                    if ($rAt->gte($cAt)) {
                        $resSecSum += $rAt->diffInSeconds($cAt);
                        $resSample++;
                    }
                }
            }
            $avgResHours = $resSample > 0 ? round(($resSecSum / $resSample) / 3600, 1) : null;

            $respSecSum = 0;
            $respSample = 0;
            foreach ($empTickets as $et) {
                if (!empty($et->first_response_at) && !empty($et->created_at)) {
                    $cAt = Carbon::parse($et->created_at);
                    $fAt = Carbon::parse($et->first_response_at);
                    if ($fAt->gte($cAt)) {
                        $respSecSum += $fAt->diffInSeconds($cAt);
                        $respSample++;
                    }
                }
            }
            $avgRespMins = $respSample > 0 ? round(($respSecSum / $respSample) / 60, 1) : null;
            $empSlaRate = $slaRateByEmp[$emp->emp_id] ?? null;

            $workloadEmpData[] = $activeCount;
            $resolvedSeries[] = $resolvedCount;
            $responseSeries[] = $avgRespMins;
            $resolutionSeries[] = $avgResHours;
            $slaSeries[] = $empSlaRate;

            $dept = TechnicalDepartments::canonical($emp->department) ?? trim((string) $emp->department);
            $deptWorkload[$dept] = ($deptWorkload[$dept] ?? 0) + $activeCount;

            $details[] = [
                'emp_id' => $emp->emp_id,
                'name' => $name,
                'department' => $dept,
                'role' => $emp->role,
                'active_tickets' => $activeCount,
                'resolved_tickets' => $resolvedCount,
                'avg_response_minutes' => $avgRespMins,
                'avg_resolution_hours' => $avgResHours,
                'sla_compliance_rate' => $empSlaRate,
            ];
        }

        return [
            'performance' => [
                'labels' => $empLabels,
                'resolved' => $resolvedSeries,
                'response_time' => $responseSeries,
                'resolution_time' => $resolutionSeries,
                'sla_compliance' => $slaSeries,
                'list' => $details,
            ],
            'workload' => [
                'by_employee' => [
                    'labels' => $empLabels,
                    'data' => $workloadEmpData,
                ],
                'by_department' => [
                    'labels' => array_keys($deptWorkload),
                    'data' => array_values($deptWorkload),
                ],
                'details' => $details,
            ],
        ];
    }

    /**
     * Compute top recurring problem categories in branch and date period.
     */
    protected function computeRecurringCategories(object $branch, Carbon $dateFrom, Carbon $dateTo, int $totalTickets): array
    {
        $query = DB::table('tickets as t')
            ->join('problem_categories as pc', 'pc.problem_category_ID', '=', 't.problem_category_ID')
            ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->where('ts.status_name', '!=', 'Discarded')
            ->whereBetween('t.created_at', [$dateFrom, $dateTo]);

        $this->applyBranchTicketFilter($query, $branch);

        $results = $query
            ->select('pc.category_name as name', DB::raw('COUNT(*) as count'))
            ->groupBy('pc.category_name')
            ->orderByDesc('count')
            ->limit(6)
            ->get();

        return $results->map(function ($row) use ($totalTickets) {
            return [
                'name' => $row->name,
                'count' => (int) $row->count,
                'percentage' => $totalTickets > 0 ? round(((int)$row->count / $totalTickets) * 100, 1) : 0,
            ];
        })->all();
    }

    /**
     * Compute top recurring machine equipment issues in branch and date period.
     */
    protected function computeRecurringEquipment(object $branch, Carbon $dateFrom, Carbon $dateTo, int $totalTickets): array
    {
        $query = DB::table('tickets as t')
            ->join('machines as m', 'm.machine_ID', '=', 't.machine_ID')
            ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->where('ts.status_name', '!=', 'Discarded')
            ->whereBetween('t.created_at', [$dateFrom, $dateTo]);

        $this->applyBranchTicketFilter($query, $branch);

        $results = $query
            ->select('m.machine_name as name', 'm.serial_number', DB::raw('COUNT(*) as count'))
            ->groupBy('m.machine_name', 'm.serial_number')
            ->orderByDesc('count')
            ->limit(6)
            ->get();

        return $results->map(function ($row) use ($totalTickets) {
            $label = $row->name . ($row->serial_number ? " ({$row->serial_number})" : '');
            return [
                'name' => $row->name,
                'serial_number' => $row->serial_number,
                'label' => $label,
                'count' => (int) $row->count,
                'percentage' => $totalTickets > 0 ? round(((int)$row->count / $totalTickets) * 100, 1) : 0,
            ];
        })->all();
    }

    /**
     * Trend series for the selected reporting window (spec 0028 AC-3 and AC-4, spec 0031 AC-4 and AC-5).
     *
     * The window is split by its real length, so the chart always covers the period the Admin picked:
     *   one day            -> 2 hour buckets
     *   up to 14 days      -> daily buckets
     *   up to 62 days      -> weekly buckets
     *   longer             -> monthly buckets
     * Every value comes from tickets in that bucket. A bucket with nothing to measure is null (a gap in the
     * chart), never an estimate. Volume and resolution series use $tickets (created in the window); the SLA
     * series use $slaTickets placed in the bucket of their SLA outcome date through SlaOutcomeService.
     */
    protected function generateTrendBuckets(
        string $preset,
        Carbon $dateFrom,
        Carbon $dateTo,
        $tickets,
        $slaTickets = null
    ): array {
        $buckets = $this->buildTrendBuckets($dateFrom, $dateTo);
        $slaOutcomes = app(SlaOutcomeService::class);
        $now = now();

        // Classify each SLA ticket once, not once per bucket: [outcome date, met|breached].
        $outcomes = [];
        foreach ($slaTickets ?? [] as $t) {
            $outcome = $slaOutcomes->classifyInWindow($t, $dateFrom, $dateTo, $now);
            if ($outcome !== null) {
                $outcomes[] = [$slaOutcomes->outcomeDate($t, $now), $outcome];
            }
        }

        $labels = [];
        $newSeries = [];
        $resolvedSeries = [];
        $slaComplianceSeries = [];
        $slaBreachesSeries = [];
        $resTimeSeries = [];
        $csatSeries = [];

        foreach ($buckets as [$bStart, $bEnd, $label]) {
            $created = $tickets->filter(function ($t) use ($bStart, $bEnd) {
                $c = Carbon::parse($t->created_at);
                return $c >= $bStart && $c < $bEnd;
            });

            $resolvedHere = $tickets->filter(function ($t) use ($bStart, $bEnd) {
                $st = strtolower(trim((string) $t->status_name));
                $endAt = !empty($t->resolved_at ?? $t->closed_at) ? Carbon::parse($t->resolved_at ?? $t->closed_at) : null;
                return in_array($st, ['resolved', 'closed'], true) && $endAt && $endAt >= $bStart && $endAt < $bEnd;
            });

            $met = 0;
            $breached = 0;
            foreach ($outcomes as [$outcomeAt, $outcome]) {
                if ($outcomeAt >= $bStart && $outcomeAt < $bEnd) {
                    $outcome === SlaOutcomeService::MET ? $met++ : $breached++;
                }
            }

            $hours = [];
            foreach ($resolvedHere as $t) {
                if (!empty($t->resolved_at) && !empty($t->created_at)) {
                    $diff = Carbon::parse($t->created_at)->diffInMinutes(Carbon::parse($t->resolved_at), false);
                    if ($diff >= 0) {
                        $hours[] = $diff / 60;
                    }
                }
            }

            $labels[] = $label;
            $newSeries[] = $created->count();
            $resolvedSeries[] = $resolvedHere->count();
            $slaBreachesSeries[] = $breached;
            $slaComplianceSeries[] = $slaOutcomes->rate($met, $breached);
            $resTimeSeries[] = count($hours) > 0 ? round(array_sum($hours) / count($hours), 1) : null;
            // Customer ratings are not stored per day in this service, so there is no honest per bucket value.
            $csatSeries[] = null;
        }

        return [
            'labels' => $labels,
            'trends' => [
                'labels' => $labels,
                'new' => $newSeries,
                'resolved' => $resolvedSeries,
            ],
            'sla_compliance' => $slaComplianceSeries,
            'sla_breaches' => $slaBreachesSeries,
            'resolution_time' => $resTimeSeries,
            'csat' => $csatSeries,
        ];
    }

    /**
     * Split a reporting window into chart buckets: [start, exclusive end, label].
     *
     * @return array<int, array{0: Carbon, 1: Carbon, 2: string}>
     */
    protected function buildTrendBuckets(Carbon $dateFrom, Carbon $dateTo): array
    {
        $from = $dateFrom->copy();
        $to = $dateTo->copy();
        // First instant after the window. endOfDay() carries microseconds, so snap to the whole second.
        $windowEnd = $to->copy()->addSecond()->startOfSecond();
        $days = $from->copy()->startOfDay()->diffInDays($to->copy()->startOfDay()) + 1;

        $buckets = [];

        if ($days <= 1) {
            $cursor = $from->copy()->startOfDay();
            for ($i = 0; $i < 12; $i++) {
                $buckets[] = [$cursor->copy(), $cursor->copy()->addHours(2), $cursor->format('gA')];
                $cursor->addHours(2);
            }
            return $buckets;
        }

        if ($days <= 14) {
            $cursor = $from->copy()->startOfDay();
            $format = $days <= 7 ? 'D' : 'M j';
            while ($cursor < $windowEnd) {
                $buckets[] = [$cursor->copy(), $cursor->copy()->addDay(), $cursor->format($format)];
                $cursor->addDay();
            }
            return $buckets;
        }

        if ($days <= 62) {
            $cursor = $from->copy()->startOfDay();
            while ($cursor < $windowEnd) {
                $next = $cursor->copy()->addDays(7);
                $buckets[] = [$cursor->copy(), $next->copy(), $cursor->format('M j')];
                $cursor = $next;
            }
            return $buckets;
        }

        $cursor = $from->copy()->startOfMonth();
        $guard = 0;
        while ($cursor < $windowEnd && $guard++ < 36) {
            $next = $cursor->copy()->addMonth();
            $buckets[] = [$cursor->copy(), $next->copy(), $cursor->format('M Y')];
            $cursor = $next;
        }

        return $buckets;
    }

    /**
     * Get branch-scoped operational report dataset for Admin and SuperAdmin users.
     */
    public function getAdminReports($user, array $filters = [], bool $forceRefresh = false): array
    {
        $reportType = trim((string) ($filters['report_type'] ?? ''));
        if ($reportType === '') {
            return $this->getAdminDashboard($user, $filters, $forceRefresh);
        }

        $branch = $this->resolveBranchScope($user, $filters);

        // Parse date range
        [$preset, $dateFrom, $dateTo] = \App\Support\ReportPeriod::resolve($filters, 'Last 30 Days');

        $departmentFilter = trim((string) ($filters['department'] ?? ''));
        if ($departmentFilter === '' || strtolower($departmentFilter) === 'all' || strtolower($departmentFilter) === 'all departments') {
            $departmentFilter = null;
        }

        $priorityFilter = trim((string) ($filters['priority'] ?? ''));
        if ($priorityFilter === '' || strtolower($priorityFilter) === 'all' || strtolower($priorityFilter) === 'all priorities') {
            $priorityFilter = null;
        }

        $cacheKey = "admin_operational_report_v2_{$branch->slug}_" . md5(json_encode([
            'branch' => $branch->slug,
            'type' => $reportType,
            'preset' => $preset,
            'from' => $dateFrom->toDateString(),
            'to' => $dateTo->toDateString(),
            'dept' => $departmentFilter,
            'prio' => $priorityFilter,
        ]));

        if ($forceRefresh) {
            Cache::forget($cacheKey);
        }

        return Cache::remember($cacheKey, 60, function () use (
            $branch,
            $reportType,
            $preset,
            $dateFrom,
            $dateTo,
            $departmentFilter,
            $priorityFilter
        ) {
            return $this->computeTabularReportData(
                $branch,
                $reportType,
                $preset,
                $dateFrom,
                $dateTo,
                $departmentFilter,
                $priorityFilter
            );
        });
    }

    /**
     * Compute structured tabular report rows for the 6 operational report types.
     */
    protected function computeTabularReportData(
        object $branch,
        string $reportType,
        string $preset,
        Carbon $dateFrom,
        Carbon $dateTo,
        ?string $departmentFilter,
        ?string $priorityFilter
    ): array {
        $headers = [];
        $rows = [];
        $summary = [];

        if ($reportType === 'department_performance') {
            $headers = [
                'Department',
                'Staff Count',
                'Total Tickets',
                'Resolved Tickets',
                'Open Tickets',
                'Overdue Tickets',
                'Avg Resolution (hrs)',
                'SLA Compliance (%)',
                'CSAT Score',
            ];

            $perfService = app(AdminPerformanceService::class);
            $deptMetrics = $perfService->getDepartmentPerformanceMetrics(
                (object) ['role' => 'superadmin'],
                [
                    'branch_id' => $branch->id ?? $branch->slug ?? 'all',
                    'preset' => $preset,
                    'date_from' => $dateFrom->toDateString(),
                    'date_to' => $dateTo->toDateString(),
                ]
            );

            $departments = $deptMetrics['departments'] ?? [];
            if ($departmentFilter) {
                $departments = array_values(array_filter($departments, function ($d) use ($departmentFilter) {
                    return strtolower(trim((string) ($d['department'] ?? ''))) === strtolower($departmentFilter);
                }));
            }

            foreach ($departments as $d) {
                $rows[] = [
                    'Department' => $d['department'],
                    'Staff Count' => (int) ($d['staff_count'] ?? 0),
                    'Total Tickets' => (int) ($d['total_tickets'] ?? 0),
                    'Resolved Tickets' => (int) ($d['resolved_tickets'] ?? 0),
                    'Open Tickets' => (int) ($d['open_tickets_count'] ?? 0),
                    'Overdue Tickets' => (int) ($d['overdue_tickets_count'] ?? 0),
                    'Avg Resolution (hrs)' => $d['avg_resolution_hours'] !== null ? round((float) $d['avg_resolution_hours'], 1) . 'h' : '—',
                    'SLA Compliance (%)' => $d['sla_compliance_rate'] !== null ? round((float) $d['sla_compliance_rate'], 1) . '%' : '—',
                    'CSAT Score' => $d['csat_score'] !== null ? number_format((float) $d['csat_score'], 2) . ' / 5.0' : '—',
                ];
            }

            $summary = [
                'total_departments' => count($rows),
                'total_tickets' => array_sum(array_column($departments, 'total_tickets')),
                'resolved_tickets' => array_sum(array_column($departments, 'resolved_tickets')),
            ];
        } elseif ($reportType === 'equipment_maintenance') {
            $headers = [
                'Equipment / Model',
                'Serial Number',
                'Category',
                'Incident Count',
                'Active Issues',
                'Avg Resolution (hrs)',
                'Last Incident Date',
                'Reliability Status',
            ];

            $eqQuery = DB::table('tickets as t')
                ->join('machines as m', 'm.machine_ID', '=', 't.machine_ID')
                ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
                ->leftJoin('problem_categories as pc', 'pc.problem_category_ID', '=', 't.problem_category_ID')
                ->leftJoin('ticket_priorities as tp', 'tp.priority_ID', '=', 't.priority_ID')
                ->leftJoin('employees as e', 'e.emp_id', '=', 't.assigned_to')
                ->where('ts.status_name', '!=', 'Discarded')
                ->whereBetween('t.created_at', [$dateFrom, $dateTo]);

            $this->applyBranchTicketFilter($eqQuery, $branch);

            if ($departmentFilter) {
                $eqQuery->where('e.department', $departmentFilter);
            }
            if ($priorityFilter) {
                $eqQuery->whereRaw('LOWER(tp.priority_name) = ?', [strtolower($priorityFilter)]);
            }

            $eqTickets = $eqQuery->select(
                'm.machine_ID',
                'm.machine_name',
                'm.serial_number',
                'pc.category_name',
                'ts.status_name',
                't.created_at',
                't.resolved_at',
                't.closed_at'
            )->get();

            $grouped = $eqTickets->groupBy(fn($item) => ($item->machine_name ?? 'Equipment') . '|' . ($item->serial_number ?? 'N/A'));
            foreach ($grouped as $group) {
                $first = $group->first();
                $incidentCount = $group->count();
                $activeIssues = $group->filter(function ($item) {
                    $st = strtolower(trim((string) $item->status_name));
                    return !in_array($st, ['resolved', 'closed', 'discarded', 'cancelled'], true);
                })->count();

                $resSec = 0;
                $resCnt = 0;
                foreach ($group as $g) {
                    $end = $g->resolved_at ?? $g->closed_at;
                    if (!empty($end) && !empty($g->created_at)) {
                        $c = Carbon::parse($g->created_at);
                        $r = Carbon::parse($end);
                        if ($r->gte($c)) {
                            $resSec += $r->diffInSeconds($c);
                            $resCnt++;
                        }
                    }
                }
                $avgRes = $resCnt > 0 ? round(($resSec / $resCnt) / 3600, 1) . 'h' : '—';
                $lastDate = $group->max('created_at');

                $rows[] = [
                    'Equipment / Model' => $first->machine_name ?: 'Unspecified Equipment',
                    'Serial Number' => $first->serial_number ?: 'N/A',
                    'Category' => $first->category_name ?: 'General Hardware',
                    'Incident Count' => $incidentCount,
                    'Active Issues' => $activeIssues,
                    'Avg Resolution (hrs)' => $avgRes,
                    'Last Incident Date' => $lastDate ? Carbon::parse($lastDate)->format('Y-m-d') : '—',
                    'Reliability Status' => $incidentCount >= 5 ? 'High Risk' : ($incidentCount >= 3 ? 'Monitor' : 'Normal'),
                ];
            }

            usort($rows, fn($a, $b) => ($b['Incident Count'] ?? 0) <=> ($a['Incident Count'] ?? 0));
            $summary = [
                'total_equipment_models' => count($rows),
                'total_incidents' => $eqTickets->count(),
            ];
        } elseif ($reportType === 'predictive_risk') {
            $headers = [
                'Target Scope',
                'Metric Type',
                'Forecast Date / Period',
                'Predicted Value',
                'Confidence / Risk Level',
                'Alert Triggered',
                'Recommended Action',
            ];

            $forecastService = app(TicketForecastService::class);
            $insights = $forecastService->getPredictiveInsights(
                (object) ['role' => 'superadmin'],
                [
                    'branch_id' => $branch->id ?? $branch->slug ?? 'all',
                    'horizon_days' => 7,
                ]
            );

            $volList = $insights['volume_forecast']['daily_predictions'] ?? $insights['volume_forecast'] ?? [];
            if (is_array($volList)) {
                foreach ($volList as $pred) {
                    if (!is_array($pred)) {
                        continue;
                    }
                    $predVol = (int) ($pred['predicted_tickets'] ?? $pred['predicted_volume'] ?? 0);
                    $rows[] = [
                        'Target Scope' => $branch->name ?? 'Branch',
                        'Metric Type' => 'Ticket Volume Forecast',
                        'Forecast Date / Period' => ($pred['date'] ?? 'Upcoming') . (!empty($pred['day_of_week']) ? " ({$pred['day_of_week']})" : ''),
                        'Predicted Value' => $predVol . ' tickets',
                        'Confidence / Risk Level' => $predVol >= 15 ? 'High' : 'Normal',
                        'Alert Triggered' => $predVol >= 15 ? 'Yes' : 'No',
                        'Recommended Action' => 'Monitor daily technician queue capacity',
                    ];
                }
            }

            $machineTrends = $insights['recurring_issues']['machines'] ?? [];
            foreach ($machineTrends as $mTrend) {
                $item = is_object($mTrend) ? (array) $mTrend : $mTrend;
                $changePct = round((float) ($item['change_percentage'] ?? 0), 1);
                $rows[] = [
                    'Target Scope' => $item['item_name'] ?? 'Equipment',
                    'Metric Type' => 'Equipment Recurring Trend',
                    'Forecast Date / Period' => 'Next 7 Days',
                    'Predicted Value' => ($item['recent_count'] ?? 0) . ' recent incidents (' . ($changePct >= 0 ? "+{$changePct}%" : "{$changePct}%") . ')',
                    'Confidence / Risk Level' => $changePct >= 25 ? 'High' : 'Medium',
                    'Alert Triggered' => $changePct >= 25 ? 'Yes' : 'No',
                    'Recommended Action' => 'Schedule preventive calibration',
                ];
            }

            $summary = [
                'total_forecasts' => count($rows),
                'status' => $insights['status'] ?? 'success',
            ];
        } else {
            // ticket_volume, sla_compliance, or csat_satisfaction
            $allBranches = DB::table('branches')->get();
            $branchNameMap = [];
            foreach ($allBranches as $bRow) {
                $branchNameMap[(string) $bRow->id] = $bRow->name;
                if (!empty($bRow->slug)) {
                    $branchNameMap[strtolower((string) $bRow->slug)] = $bRow->name;
                }
                if (!empty($bRow->code)) {
                    $branchNameMap[strtolower((string) $bRow->code)] = $bRow->name;
                }
            }

            $tQuery = DB::table('tickets as t')
                ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
                ->leftJoin('problem_categories as pc', 'pc.problem_category_ID', '=', 't.problem_category_ID')
                ->leftJoin('ticket_priorities as tp', 'tp.priority_ID', '=', 't.priority_ID')
                ->leftJoin('machines as m', 'm.machine_ID', '=', 't.machine_ID')
                ->leftJoin('employees as e', 'e.emp_id', '=', 't.assigned_to')
                ->leftJoin('clients as c', 'c.id', '=', 't.created_by')
                ->where('ts.status_name', '!=', 'Discarded');

            if ($reportType === 'sla_compliance') {
                // SLA rows count by their outcome date, not their creation date (spec 0031 AC-5).
                app(SlaOutcomeService::class)->applyOutcomeWindow($tQuery, $dateFrom, $dateTo);
            } else {
                $tQuery->whereBetween('t.created_at', [$dateFrom, $dateTo]);
            }

            $this->applyBranchTicketFilter($tQuery, $branch);

            if ($departmentFilter) {
                $tQuery->where('e.department', $departmentFilter);
            }
            if ($priorityFilter) {
                $tQuery->whereRaw('LOWER(tp.priority_name) = ?', [strtolower($priorityFilter)]);
            }

            $tickets = $tQuery->select(
                't.ticket_ID',
                't.ticket_number',
                't.title',
                't.is_internal',
                't.branch_id',
                't.ticket_status_ID',
                'ts.status_name',
                't.priority_ID',
                'tp.priority_name',
                't.problem_category_ID',
                'pc.category_name',
                't.machine_ID',
                'm.machine_name',
                'm.serial_number',
                't.assigned_to',
                'e.emp_id as assignee_id',
                'e.first_name as assignee_first_name',
                'e.last_name as assignee_last_name',
                'e.email as assignee_email',
                'e.department as assignee_department',
                'c.client_name as customer_name',
                't.resolution_due_at',
                't.response_due_at',
                't.first_response_at',
                't.resolved_at',
                't.closed_at',
                't.sla_status',
                't.created_at',
                't.updated_at'
            )
            ->orderByDesc('t.created_at')
            ->limit(250)
            ->get()
            ->map(function ($t) use ($branchNameMap, $branch) {
                $bKey = strtolower(trim((string) ($t->branch_id ?? '')));
                $t->branch_name = $branchNameMap[(string) ($t->branch_id ?? '')]
                    ?? $branchNameMap[$bKey]
                    ?? ($branch->slug === 'all' ? 'Main Branch' : ($branch->name ?? 'Main Branch'));
                return $t;
            });

            if ($reportType === 'sla_compliance') {
                $headers = [
                    'Ticket ID',
                    'Subject',
                    'Branch',
                    'Department',
                    'Assigned Technician',
                    'Priority',
                    'Response Time (mins)',
                    'Resolution Time (hrs)',
                    'SLA Status',
                    'Created Date',
                ];

                $metCount = 0;
                $breachedCount = 0;
                $slaOutcomes = app(SlaOutcomeService::class);
                $now = now();

                foreach ($tickets as $t) {
                    $outcome = $slaOutcomes->classifyInWindow($t, $dateFrom, $dateTo, $now);
                    if ($outcome === null) {
                        continue;
                    }

                    $ref = TicketNumberGeneratorService::refFor($t->ticket_ID, $t->ticket_number ?? null);
                    $techName = trim("{$t->assignee_first_name} {$t->assignee_last_name}");
                    if ($techName === '' && !empty($t->assignee_email)) {
                        $techName = ucwords(str_replace(['.', '_', '-'], ' ', explode('@', $t->assignee_email)[0]));
                    }
                    if ($techName === '') {
                        $techName = 'Unassigned';
                    }

                    $respMins = '—';
                    if (!empty($t->first_response_at) && !empty($t->created_at)) {
                        $respMins = round(max(0, Carbon::parse($t->created_at)->diffInSeconds(Carbon::parse($t->first_response_at)) / 60), 1) . 'm';
                    }

                    $resHrs = '—';
                    $endAt = $t->resolved_at ?? $t->closed_at;
                    if (!empty($endAt) && !empty($t->created_at)) {
                        $resHrs = round(max(0, Carbon::parse($t->created_at)->diffInSeconds(Carbon::parse($endAt)) / 3600), 1) . 'h';
                    }

                    $isBreached = $outcome === SlaOutcomeService::BREACHED;
                    if ($isBreached) {
                        $breachedCount++;
                    } else {
                        $metCount++;
                    }

                    $rows[] = [
                        'Ticket ID' => $ref,
                        'Subject' => $t->title ?: 'Untitled Ticket',
                        'Branch' => $t->branch_name ?: ($branch->name ?? 'Main Branch'),
                        'Department' => $t->assignee_department ?: 'Unassigned',
                        'Assigned Technician' => $techName,
                        'Priority' => $t->priority_name ?: 'Medium',
                        'Response Time (mins)' => $respMins,
                        'Resolution Time (hrs)' => $resHrs,
                        'SLA Status' => $isBreached ? 'Breached' : 'Met',
                        'Created Date' => $t->created_at ? Carbon::parse($t->created_at)->format('Y-m-d H:i') : '—',
                    ];
                }

                $summary = [
                    'total_tickets' => count($rows),
                    'sla_met' => $metCount,
                    'sla_breached' => $breachedCount,
                    'compliance_rate' => $slaOutcomes->rate($metCount, $breachedCount),
                ];
            } elseif ($reportType === 'csat_satisfaction') {
                $headers = [
                    'Ticket ID',
                    'Subject',
                    'Customer',
                    'Assigned Technician',
                    'Department',
                    'CSAT Rating',
                    'Status',
                    'Resolved Date',
                ];

                $csatSnapshot = app(CsatSnapshotService::class)->forTickets($tickets->pluck('ticket_ID')->all(), $dateFrom, $dateTo);
                $csatMap = $csatSnapshot['ticket_ratings'];

                foreach ($tickets as $t) {
                    $ref = TicketNumberGeneratorService::refFor($t->ticket_ID, $t->ticket_number ?? null);
                    $techName = trim("{$t->assignee_first_name} {$t->assignee_last_name}");
                    if ($techName === '' && !empty($t->assignee_email)) {
                        $techName = ucwords(str_replace(['.', '_', '-'], ' ', explode('@', $t->assignee_email)[0]));
                    }
                    if ($techName === '') {
                        $techName = 'Unassigned';
                    }

                    $ratingVal = $csatMap[$t->ticket_ID] ?? null;
                    $endAt = $t->resolved_at ?? $t->closed_at;

                    $rows[] = [
                        'Ticket ID' => $ref,
                        'Subject' => $t->title ?: 'Untitled Ticket',
                        'Customer' => $t->customer_name ?: 'Client',
                        'Assigned Technician' => $techName,
                        'Department' => $t->assignee_department ?: 'Unassigned',
                        'CSAT Rating' => $ratingVal !== null ? number_format((float) $ratingVal, 1) . ' / 5.0' : 'Pending Feedback',
                        'Status' => $t->status_name ?: 'Open',
                        'Resolved Date' => $endAt ? Carbon::parse($endAt)->format('Y-m-d') : '—',
                    ];
                }

                $summary = [
                    'total_tickets' => count($rows),
                    'rated_tickets' => count($csatMap),
                    'csat_available' => $csatSnapshot['available'],
                ];
            } else {
                // Default: ticket_volume
                $headers = [
                    'Ticket ID',
                    'Subject',
                    'Category',
                    'Equipment',
                    'Branch',
                    'Department',
                    'Assigned Technician',
                    'Priority',
                    'Status',
                    'Created Date',
                ];

                foreach ($tickets as $t) {
                    $ref = TicketNumberGeneratorService::refFor($t->ticket_ID, $t->ticket_number ?? null);
                    $techName = trim("{$t->assignee_first_name} {$t->assignee_last_name}");
                    if ($techName === '' && !empty($t->assignee_email)) {
                        $techName = ucwords(str_replace(['.', '_', '-'], ' ', explode('@', $t->assignee_email)[0]));
                    }
                    if ($techName === '') {
                        $techName = 'Unassigned';
                    }

                    $equipmentLabel = $t->machine_name
                        ? ($t->machine_name . ($t->serial_number ? " ({$t->serial_number})" : ''))
                        : 'General Support';

                    $rows[] = [
                        'Ticket ID' => $ref,
                        'Subject' => $t->title ?: 'Untitled Ticket',
                        'Category' => $t->category_name ?: 'General',
                        'Equipment' => $equipmentLabel,
                        'Branch' => $t->branch_name ?: ($branch->name ?? 'Main Branch'),
                        'Department' => $t->assignee_department ?: 'Unassigned',
                        'Assigned Technician' => $techName,
                        'Priority' => $t->priority_name ?: 'Medium',
                        'Status' => $t->status_name ?: 'Open',
                        'Created Date' => $t->created_at ? Carbon::parse($t->created_at)->format('Y-m-d H:i') : '—',
                    ];
                }

                $summary = [
                    'total_tickets' => count($rows),
                ];
            }
        }

        return [
            'status' => 'success',
            'has_data' => count($rows) > 0,
            'count' => count($rows),
            'report_type' => $reportType,
            'branch' => [
                'id' => $branch->id ?? 1,
                'slug' => $branch->slug ?? 'main',
                'name' => $branch->name ?? 'Main Branch',
                'code' => $branch->code ?? 'MAIN',
                'region' => $branch->region ?? 'NCR',
            ],
            'period' => [
                'preset' => $preset,
                'date_from' => $dateFrom->toDateString(),
                'date_to' => $dateTo->toDateString(),
            ],
            'headers' => $headers,
            'rows' => $rows,
            'summary' => $summary,
            'message' => count($rows) > 0 ? null : 'No records match the selected report filters for this period.',
        ];
    }
}
