<?php

namespace App\Http\Controllers;

use App\Models\Client;
use App\Models\Employee;
use App\Services\EmployeeDashboardService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class EmployeeDashboardController extends Controller
{
    protected EmployeeDashboardService $dashboardService;

    public function __construct(EmployeeDashboardService $dashboardService)
    {
        $this->dashboardService = $dashboardService;
    }

    /**
     * Personal Employee dual role dashboard: assigned technician queue and requested tickets.
     */
    public function dashboard(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['status' => 'error', 'message' => 'Unauthenticated.'], 401);
        }

        // Strict customer exclusion: must be an employee
        if ($user instanceof Client) {
            return response()->json([
                'status' => 'error',
                'message' => 'Access denied: Employee role required to view the employee workload dashboard.',
            ], 403);
        }

        $role = strtolower(trim((string) ($user->role ?? '')));
        if ($role === 'customer' || $role === 'client') {
            return response()->json([
                'status' => 'error',
                'message' => 'Access denied: Employee role required to view the employee workload dashboard.',
            ], 403);
        }

        $employeeId = (int) ($user->emp_id ?? $user->id);
        $userId = (int) ($user->id ?? $user->emp_id);
        $forceRefresh = filter_var($request->query('force_refresh', false), FILTER_VALIDATE_BOOLEAN);

        $payload = $this->dashboardService->getEmployeeDashboard($employeeId, $userId, $forceRefresh);

        return response()->json(array_merge([
            'status' => 'success',
        ], $payload), 200);
    }
}

