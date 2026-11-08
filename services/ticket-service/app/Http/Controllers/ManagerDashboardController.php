<?php

namespace App\Http\Controllers;

use App\Services\ManagerDashboardService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Live manager dashboard for Service, IT and Customer Service managers (spec 0031 AC-7, AC-8, AC-9).
 */
class ManagerDashboardController extends Controller
{
    public function __construct(protected ManagerDashboardService $managerDashboard)
    {
    }

    public function dashboard(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['status' => 'error', 'message' => 'Unauthenticated.'], 401);
        }

        // Scope comes only from the caller's own employees row (AC-8), never from request parameters.
        $email = strtolower(trim((string) ($user->email ?? '')));
        $employee = $email !== ''
            ? DB::table('employees')->whereRaw('LOWER(email) = ?', [$email])->first()
            : null;

        if (!$employee) {
            return response()->json([
                'status' => 'error',
                'message' => 'No employee record found for the signed in user.',
            ], 404);
        }

        if (!ManagerDashboardService::isManager($employee)
            || ManagerDashboardService::supportedDepartment($employee->department ?? null) === null) {
            return response()->json([
                'status' => 'error',
                'message' => 'Access denied: Service, IT, or Customer Service manager role required.',
            ], 403);
        }

        $forceRefresh = filter_var($request->query('forceRefresh', $request->query('force_refresh', false)), FILTER_VALIDATE_BOOLEAN);

        return response()->json(array_merge(
            ['status' => 'success'],
            $this->managerDashboard->forManager($employee, $forceRefresh)
        ));
    }
}
