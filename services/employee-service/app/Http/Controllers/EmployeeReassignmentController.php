<?php

namespace App\Http\Controllers;

use App\Services\EmployeeReassignmentService;
use Illuminate\Http\Request;

class EmployeeReassignmentController extends Controller
{
    protected EmployeeReassignmentService $reassignmentService;

    public function __construct(EmployeeReassignmentService $reassignmentService)
    {
        $this->reassignmentService = $reassignmentService;
    }

    public function reassignRequest(Request $request, int $ticketId)
    {
        $validated = $request->validate([
            'reason' => ['required', 'string', new \App\Rules\NoMarkup()],
        ]);

        $rawReason = trim($validated['reason']);
        $reason = mb_strtoupper(mb_substr($rawReason, 0, 1)) . mb_substr($rawReason, 1);

        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $result = $this->reassignmentService->submitRequest($ticketId, $user->emp_id, $reason);
        return response()->json($result['data'], $result['status']);
    }

    public function reassignRespond(Request $request, int $ticketId)
    {
        $rules = [
            'action' => ['required', 'string', 'in:approve,deny'],
        ];

        $user = $request->user();
        $role = strtolower(trim((string) ($user->role ?? '')));
        $isCS = in_array($role, ['customer service', 'customer support', 'cs', 'admin', 'superadmin', 'super admin']);
        if (!$user || !$isCS) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        if ($request->input('action') === 'approve') {
            $rules['new_employee_id'] = ['nullable', 'integer', 'exists:employees,emp_id'];
        } else {
            $rules['reason'] = ['nullable', 'string'];
        }

        $validated = $request->validate($rules);

        $result = $this->reassignmentService->respondToRequest($ticketId, $validated, $user->emp_id);
        return response()->json($result['data'], $result['status']);
    }

    public function reassignmentRequests(Request $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated'], 401);
        }

        $status = $request->query('status');
        $requests = $this->reassignmentService->listRequests($user, $status);

        return response()->json([
            'requests' => $requests,
        ]);
    }

    public function getReassignmentRequests(Request $request)
    {
        return $this->reassignmentRequests($request);
    }
}
