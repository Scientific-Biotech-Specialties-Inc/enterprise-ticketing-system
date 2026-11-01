<?php

namespace App\Http\Controllers;

use App\Services\TicketDashboardService;
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
        $createdBy = (int) ($request->query('created_by', 1));
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
        $createdBy = (int) ($request->query('created_by', 1));
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

        $filters = [
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
}
