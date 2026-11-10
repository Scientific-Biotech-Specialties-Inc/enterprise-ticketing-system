<?php

namespace App\Http\Controllers;

use App\Services\SuperAdminDashboardService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class SuperAdminDashboardController extends Controller
{
    protected SuperAdminDashboardService $dashboardService;

    public function __construct(SuperAdminDashboardService $dashboardService)
    {
        $this->dashboardService = $dashboardService;
    }

    /**
     * Super Admin system wide dashboard and sortable branch comparison.
     */
    public function systemDashboard(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['status' => 'error', 'message' => 'Unauthenticated.'], 401);
        }

        // Server side Super Admin role enforcement (AC-4, AC-1.8)
        $role = strtolower(str_replace([' ', '_', '-'], '', (string) ($user->role ?? '')));
        $allowedRoles = ['superadmin', 'systemadmin', 'systemadministrator', 'itadmin'];
        if (!in_array($role, $allowedRoles, true)) {
            return response()->json([
                'status' => 'error',
                'message' => 'Access denied: Super Admin role required to access the system wide dashboard.',
            ], 403);
        }

        $filters = [
            'preset' => $request->query('preset') ?? $request->query('period') ?? $request->query('date_range'),
            'date_from' => $request->query('date_from'),
            'date_to' => $request->query('date_to'),
        ];

        if ($dateErr = $this->validateDateRange($filters['date_from'], $filters['date_to'])) {
            return $dateErr;
        }

        $sortBy = (string) $request->query('sort_by', 'total_tickets');
        $sortDir = (string) $request->query('sort_dir', 'desc');
        $activityLimit = (int) $request->query('activity_limit', 15);
        $forceRefresh = filter_var($request->query('force_refresh', false), FILTER_VALIDATE_BOOLEAN);

        try {
            $data = $this->dashboardService->getSystemDashboard(
                $filters,
                $sortBy,
                $sortDir,
                $activityLimit,
                $forceRefresh
            );

            return response()->json(array_merge([
                'status' => 'success',
            ], $data));
        } catch (ValidationException $e) {
            return response()->json([
                'status' => 'error',
                'message' => 'Validation error',
                'errors' => $e->errors(),
            ], 422);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error("SuperAdminDashboardController error: " . $e->getMessage() . " at " . $e->getFile() . ":" . $e->getLine());
            return response()->json([
                'status' => 'error',
                'message' => 'Failed to load system dashboard. Please check service logs.',
            ], 500);
        }
    }
}
