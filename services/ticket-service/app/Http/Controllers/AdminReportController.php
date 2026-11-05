<?php

namespace App\Http\Controllers;

use App\Services\AdminPerformanceService;
use App\Services\TicketForecastService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AdminReportController extends Controller
{
    protected AdminPerformanceService $performanceService;
    protected TicketForecastService $forecastService;

    public function __construct(AdminPerformanceService $performanceService, TicketForecastService $forecastService)
    {
        $this->performanceService = $performanceService;
        $this->forecastService = $forecastService;
    }

    /**
     * Verify that the authenticated user holds an Admin or SuperAdmin role.
     */
    protected function authorizeAdminRole($user): ?JsonResponse
    {
        if (!$user) {
            return response()->json(['status' => 'error', 'message' => 'Unauthenticated.'], 401);
        }

        $role = strtolower(trim((string) ($user->role ?? '')));
        $allowedRoles = ['superadmin', 'super admin', 'admin', 'systemadministrator', 'itadmin'];

        if (!in_array($role, $allowedRoles, true)) {
            return response()->json([
                'status' => 'error',
                'message' => 'Access denied: Admin role required to view operational reports.',
            ], 403);
        }

        return null;
    }

    /**
     * Enforce server-side branch security.
     * Prevents non-superadmin users from querying other branches.
     */
    protected function validateBranchAccess($user, Request $request): ?JsonResponse
    {
        $role = strtolower(trim((string) ($user->role ?? '')));
        $isSuperAdmin = in_array($role, ['superadmin', 'super admin'], true);

        if ($isSuperAdmin) {
            return null; // SuperAdmins may inspect any branch
        }

        // If client specified an explicit branch or branch_id parameter, verify it matches the user's branch
        $requestedBranchId = $request->query('branch_id');
        $requestedBranchSlug = $request->query('branch');

        $userBranchId = (string) ($user->branch_id ?? '');
        $userBranch = strtolower(trim((string) ($user->branch ?? '')));

        if ($requestedBranchId !== null && $requestedBranchId !== '') {
            $reqId = strtolower(trim((string) $requestedBranchId));
            if ($reqId === 'all' || ($reqId !== $userBranchId && $reqId !== $userBranch)) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Access denied: Cross-branch reporting access is prohibited.',
                ], 403);
            }
        }

        if ($requestedBranchSlug !== null && $requestedBranchSlug !== '') {
            $reqSlug = strtolower(trim((string) $requestedBranchSlug));
            if ($reqSlug === 'all' || ($reqSlug !== $userBranch && $reqSlug !== $userBranchId)) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Access denied: Cross-branch reporting access is prohibited.',
                ], 403);
            }
        }

        return null;
    }

    /**
     * GET /api/ticketing/ticket/admin-reports/employees
     * Return individual and comparative employee performance metrics scoped to branch and date range.
     */
    public function employeePerformance(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($authError = $this->authorizeAdminRole($user)) {
            return $authError;
        }

        if ($branchError = $this->validateBranchAccess($user, $request)) {
            return $branchError;
        }

        $filters = [
            'preset' => $request->query('preset') ?? $request->query('filter') ?? $request->query('period') ?? $request->query('date_range'),
            'date_from' => $request->query('date_from'),
            'date_to' => $request->query('date_to'),
            'department' => $request->query('department'),
            'employee_id' => $request->query('employee_id'),
            'sort_by' => $request->query('sort_by'),
            'sort_dir' => $request->query('sort_dir', 'desc'),
            'branch' => $request->query('branch'),
            'branch_id' => $request->query('branch_id'),
        ];

        $forceRefresh = filter_var($request->query('forceRefresh', $request->query('force_refresh', false)), FILTER_VALIDATE_BOOLEAN);

        $data = $this->performanceService->getEmployeePerformanceMetrics($user, $filters, $forceRefresh);
        return response()->json($data);
    }

    /**
     * GET /api/ticketing/ticket/admin-reports/departments
     * Return department aggregated performance metrics, SLA compliance, open/overdue counts, and workload distribution.
     */
    public function departmentPerformance(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($authError = $this->authorizeAdminRole($user)) {
            return $authError;
        }

        if ($branchError = $this->validateBranchAccess($user, $request)) {
            return $branchError;
        }

        $filters = [
            'preset' => $request->query('preset') ?? $request->query('filter') ?? $request->query('period') ?? $request->query('date_range'),
            'date_from' => $request->query('date_from'),
            'date_to' => $request->query('date_to'),
            'sort_by' => $request->query('sort_by', 'total_tickets'),
            'sort_dir' => $request->query('sort_dir', 'desc'),
            'branch' => $request->query('branch'),
            'branch_id' => $request->query('branch_id'),
        ];

        $forceRefresh = filter_var($request->query('forceRefresh', $request->query('force_refresh', false)), FILTER_VALIDATE_BOOLEAN);

        $data = $this->performanceService->getDepartmentPerformanceMetrics($user, $filters, $forceRefresh);
        return response()->json($data);
    }

    /**
     * GET /api/ticketing/ticket/admin-reports/predictive-insights
     * Return forecasted ticket volume and recurring issue trends.
     */
    public function predictiveInsights(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($authError = $this->authorizeAdminRole($user)) {
            return $authError;
        }

        if ($branchError = $this->validateBranchAccess($user, $request)) {
            return $branchError;
        }

        $filters = [
            'horizon_days' => $request->query('horizon_days', 7),
            'branch' => $request->query('branch'),
            'branch_id' => $request->query('branch_id'),
        ];

        $forceRefresh = filter_var($request->query('forceRefresh', $request->query('force_refresh', false)), FILTER_VALIDATE_BOOLEAN);

        $data = $this->forecastService->getPredictiveInsights($user, $filters, $forceRefresh);
        return response()->json($data);
    }
}

