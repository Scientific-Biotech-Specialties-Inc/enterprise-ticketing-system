<?php

namespace App\Http\Controllers;

use App\Services\TicketDashboardService;
use App\Services\TicketForecastService;
use App\Services\TicketCacheService;
use Carbon\Carbon;
use Illuminate\Http\Request;

class TicketDashboardController extends Controller
{
    protected TicketDashboardService $dashboardService;

    public function __construct(TicketDashboardService $dashboardService)
    {
        $this->dashboardService = $dashboardService;
    }

    public function customerDashboard(Request $request)
    {
        $authenticatedUser = $request->user();
        $createdBy = (int) ($authenticatedUser->client_ID ?? $authenticatedUser->client_id ?? $authenticatedUser->emp_id ?? $authenticatedUser->id ?? 0);
        if ($createdBy <= 0) {
            return response()->json(['message' => 'Unauthorized: Invalid customer identity'], 401);
        }
        $limit = max(1, min((int) $request->query('limit', 5), 200));

        $filters = [
            'search' => $request->query('search'),
            'status' => $request->query('status'),
            'category' => $request->query('category'),
            'category_id' => $request->query('category_id'),
            'machine_id' => $request->query('machine_id'),
            'priority_id' => $request->query('priority_id'),
            'date_from' => $request->query('date_from'),
            'date_to' => $request->query('date_to'),
        ];

        $data = $this->dashboardService->getCustomerDashboard($createdBy, $limit, $filters);
        return response()->json($data);
    }

    public function customerFilterOptions(Request $request)
    {
        $authenticatedUser = $request->user();
        $createdBy = (int) ($authenticatedUser->client_ID ?? $authenticatedUser->client_id ?? $authenticatedUser->emp_id ?? $authenticatedUser->id ?? 0);
        $data = $this->dashboardService->getCustomerFilterOptions($createdBy);
        return response()->json($data);
    }

    public function csDashboard(Request $request)
    {
        $limit = max(1, min((int) $request->query('limit', 10), 50));

        $data = $this->dashboardService->getCsDashboard($limit);
        return response()->json($data);
    }

    public function csIncoming(Request $request)
    {
        $perPage = max(1, min((int) $request->query('limit', 50), 200));
        $typeFilter = $request->query('type') ?? 'all';
        $page = (int) $request->query('page', 1);

        $filters = [
            'search' => $request->query('search'),
            'status' => $request->query('status'),
            'department' => $request->query('department'),
            'department_id' => $request->query('department_id'),
            'machine' => $request->query('machine'),
            'machine_id' => $request->query('machine_id'),
            'customer' => $request->query('customer'),
            'customer_id' => $request->query('customer_id'),
            'sla_status' => $request->query('sla_status') ?? $request->query('sla'),
            'sort_by' => $request->query('sort_by'),
            'sort_dir' => $request->query('sort_dir', 'desc'),
        ];

        $forceRefresh = filter_var($request->query('forceRefresh', $request->query('force_refresh', false)), FILTER_VALIDATE_BOOLEAN);

        $data = $this->dashboardService->getCsIncoming($perPage, $typeFilter, $page, $filters, $forceRefresh);
        return response()->json($data);
    }

    public function csFilterOptions(Request $request)
    {
        $data = $this->dashboardService->getCsFilterOptions();
        return response()->json($data);
    }

    public function adminDashboard(Request $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $filters = [
            'preset' => $request->query('preset') ?? $request->query('filter'),
            'date_from' => $request->query('date_from'),
            'date_to' => $request->query('date_to'),
            'branch' => $request->query('branch'),
            'branch_id' => $request->query('branch_id'),
        ];

        $forceRefresh = filter_var($request->query('forceRefresh', $request->query('force_refresh', false)), FILTER_VALIDATE_BOOLEAN);

        $data = $this->dashboardService->getAdminDashboard($user, $filters, $forceRefresh);
        return response()->json($data);
    }

    public function adminReports(Request $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $role = strtolower(trim((string) ($user->role ?? '')));
        $allowedRoles = ['superadmin', 'super admin', 'admin', 'systemadministrator', 'itadmin', 'it admin'];
        if (!in_array($role, $allowedRoles, true)) {
            return response()->json([
                'status' => 'error',
                'message' => 'Access denied: Admin role required to view operational reports.',
            ], 403);
        }

        $filters = [
            'report_type' => $request->query('report_type'),
            'department' => $request->query('department'),
            'priority' => $request->query('priority'),
            'preset' => $request->query('preset') ?? $request->query('filter'),
            'date_from' => $request->query('date_from'),
            'date_to' => $request->query('date_to'),
            'branch' => $request->query('branch'),
            'branch_id' => $request->query('branch_id'),
        ];

        $forceRefresh = filter_var($request->query('forceRefresh', $request->query('force_refresh', false)), FILTER_VALIDATE_BOOLEAN);

        $data = $this->dashboardService->getAdminReports($user, $filters, $forceRefresh);
        return response()->json($data);
    }

    public function triggerEtl(
        Request $request,
        TicketForecastService $forecastService,
        TicketCacheService $cacheService
    ) {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $role = strtolower(trim((string) ($user->role ?? '')));
        if (!in_array($role, ['admin', 'superadmin', 'super admin'], true)) {
            return response()->json(['message' => 'Access denied: Admin or SuperAdmin role required.'], 403);
        }

        $isSuperAdmin = in_array($role, ['superadmin', 'super admin'], true);
        $fullSync = filter_var($request->input('full_sync', false), FILTER_VALIDATE_BOOLEAN);
        $requestedBranchId = $request->input('branch_id');

        // Non-superadmin cannot trigger ETL for other branches
        if (!$isSuperAdmin && !empty($requestedBranchId)) {
            $userBranchId = (string) ($user->branch_id ?? '');
            if ((string) $requestedBranchId !== $userBranchId && strtolower((string) $requestedBranchId) !== 'current' && strtolower((string) $requestedBranchId) !== 'assigned') {
                return response()->json(['message' => 'Access denied: You are restricted to your assigned branch scope.'], 403);
            }
        }

        $startTime = microtime(true);

        $recordsProcessed = 0;
        if ($isSuperAdmin && ($fullSync || empty($requestedBranchId) || strtolower((string) $requestedBranchId) === 'all')) {
            $forecastResults = $forecastService->calculateAndPersistAllBranches(7);
            foreach ($forecastResults as $branchResult) {
                $recordsProcessed += (int) ($branchResult['records_processed'] ?? 0);
            }
        } else {
            $branch = $this->dashboardService->resolveBranchScope($user, ['branch_id' => $requestedBranchId]);
            $forecastResult = $forecastService->calculateAndPersistBranchForecasts($branch, 7);
            $recordsProcessed = (int) ($forecastResult['records_processed'] ?? 0);
        }

        // Invalidate dashboard and analytics caches
        $cacheService->clearTicketCaches();

        $durationMs = (int) round((microtime(true) - $startTime) * 1000);

        return response()->json([
            'status' => 'success',
            'message' => 'ETL synchronization completed successfully.',
            'records_processed' => $recordsProcessed,
            'duration_ms' => $durationMs,
            'timestamp' => Carbon::now()->toIso8601String(),
        ]);
    }
}
