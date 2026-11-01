<?php

namespace App\Http\Controllers;

use App\Services\EmployeeAssignmentService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class EmployeeAssignmentController extends Controller
{
    protected EmployeeAssignmentService $assignmentService;

    public function __construct(EmployeeAssignmentService $assignmentService)
    {
        $this->assignmentService = $assignmentService;
    }

    public function assignTicket(Request $request, int $ticketId)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized. Please log in.'], 401);
        }

        $validated = $request->validate([
            'employee_ids' => ['required', 'array', 'min:1'],
            'employee_ids.*' => ['integer', 'exists:employees,emp_id'],
            'assigned_by_email' => ['nullable', 'email'],
            'priority_ID' => ['nullable', 'integer', 'exists:ticket_priorities,priority_ID'],
            'override_track' => ['nullable', 'boolean'],
            'override_reason' => ['nullable', 'string', 'max:500'],
        ]);

        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket) {
            return response()->json(['message' => 'Ticket not found.'], 404);
        }

        $query = DB::table('employees')
            ->whereIn('emp_id', $validated['employee_ids'])
            ->select('emp_id as id', 'first_name', 'last_name', 'role', 'department', 'position_level', 'technical_role');
        if (\Illuminate\Support\Facades\Schema::hasColumn('employees', 'branch')) {
            $query->addSelect('branch');
        } elseif (\Illuminate\Support\Facades\Schema::hasColumn('employees', 'branch_id')) {
            $query->addSelect('branch_id as branch');
        }
        $employees = $query->get();

        $invalid = $employees->contains(function ($row) {
            $r = strtolower(trim((string) $row->role));
            return in_array($r, ['customer service', 'customer support', 'cs', 'customer']);
        });

        if ($invalid) {
            return response()->json([
                'message' => 'Customer-service users cannot be assignees.',
            ], 422);
        }

        // Server-side category track eligibility check (TS110)
        $track = EmployeeDirectoryController::resolveCategoryTrack($ticket);
        $role = strtolower(trim((string) ($user->role ?? '')));
        $isAdmin = in_array($role, ['admin', 'superadmin', 'super admin'], true);
        $overrideTrack = filter_var($request->input('override_track', false), FILTER_VALIDATE_BOOLEAN);
        $overrideReason = trim((string) $request->input('override_reason', ''));

        foreach ($employees as $row) {
            $eligibility = EmployeeDirectoryController::checkEligibility($row, $ticket, $track);
            if (!$eligibility['eligible']) {
                if ($isAdmin && $overrideTrack) {
                    if (empty($overrideReason)) {
                        return response()->json([
                            'message' => 'Override reason is required when assigning an employee outside their category track.',
                            'code' => 'OVERRIDE_REASON_REQUIRED',
                        ], 422);
                    }
                    \Illuminate\Support\Facades\Log::warning("Admin [{$user->email}] bypassed track eligibility for ticket #{$ticketId} (Assignee: {$row->id}). Reason: {$overrideReason}");
                } else {
                    return response()->json([
                        'message' => 'Selected employee is not eligible for this ticket category track.',
                        'code' => 'INELIGIBLE_EMPLOYEE',
                        'track' => $track,
                        'reason' => $eligibility['reason'],
                    ], 422);
                }
            }
        }

        $assignedBy = DB::table('employees')
            ->where('email', $validated['assigned_by_email'] ?? '')
            ->value('emp_id') ?? ($user ? $user->emp_id : 2);

        $result = $this->assignmentService->assignTicket($ticketId, $validated, $assignedBy);
        return response()->json($result['data'], $result['status']);
    }

    public function acceptTicket(Request $request, int $ticketId)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized. Please log in.'], 401);
        }

        $role = strtolower(trim((string) ($user->role ?? '')));
        $isCS = in_array($role, ['customer service', 'customer support', 'cs', 'admin', 'superadmin', 'super admin']);

        // Only CS / Admin performing ticket assignment/reassignment uses the validated employee_ids branch
        if ($isCS && $request->has('employee_ids')) {
            $validated = $request->validate([
                'employee_ids' => ['required', 'array', 'min:1'],
                'employee_ids.*' => ['integer', 'exists:employees,emp_id'],
                'assigned_by_email' => ['nullable', 'email'],
                'priority_ID' => ['nullable', 'integer', 'exists:ticket_priorities,priority_ID'],
            ]);

            $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
            if ($ticket) {
                $track = EmployeeDirectoryController::resolveCategoryTrack($ticket);
                $assignees = DB::table('employees')
                    ->whereIn('emp_id', $validated['employee_ids'])
                    ->select('emp_id as id', 'first_name', 'last_name', 'role', 'department', 'position_level', 'technical_role', 'branch')
                    ->get();

                foreach ($assignees as $row) {
                    $eligibility = EmployeeDirectoryController::checkEligibility($row, $ticket, $track);
                    if (!$eligibility['eligible']) {
                        return response()->json([
                            'message' => 'Selected employee is not eligible for this ticket category.',
                            'code' => 'INELIGIBLE_EMPLOYEE',
                            'track' => $track,
                            'reason' => $eligibility['reason'],
                        ], 422);
                    }
                }
            }

            $result = $this->assignmentService->acceptTicket($ticketId, $user, $validated);
            return response()->json($result['data'], $result['status']);
        }

        // Engineer self-accepting their assigned ticket
        $result = $this->assignmentService->acceptTicket($ticketId, $user);
        return response()->json($result['data'], $result['status']);
    }

    public function employeeUpdate(Request $request, int $ticketId)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $validated = $request->validate([
            'status' => ['nullable', 'string', 'in:In Progress,Pending,Resolved,Pending Assignment,Pending Evaluation,Closed,Open'],
            'remarks' => ['nullable', 'string', 'max:250'],
            'internal_note' => ['nullable', 'string'],
            'attachments' => ['nullable', 'array'],
            'attachments.*' => ['integer'],
            'is_proof' => ['nullable'],
        ]);

        $isProof = filter_var($request->input('is_proof', false), FILTER_VALIDATE_BOOLEAN);

        $result = $this->assignmentService->employeeUpdate($ticketId, $user->emp_id, $validated, $isProof);
        return response()->json($result['data'], $result['status']);
    }

    public function employeeTickets(Request $request)
    {
        $employeeEmail = (string) $request->query('employee_email', '');
        if ($employeeEmail === '') {
            return response()->json(['message' => 'employee_email is required'], 422);
        }

        $tickets = $this->assignmentService->getEmployeeTickets($employeeEmail);
        $departmentSummary = $this->assignmentService->getDepartmentSummaryForEmployee($employeeEmail);

        return response()->json([
            'tickets' => $tickets,
            'department_summary' => $departmentSummary,
        ]);
    }

    public function internalTickets(Request $request)
    {
        $user = $request->user();
        if (!$user || $user instanceof \App\Models\Client) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $tickets = $this->assignmentService->getInternalTickets($user->emp_id);
        return response()->json(['tickets' => $tickets]);
    }
}
