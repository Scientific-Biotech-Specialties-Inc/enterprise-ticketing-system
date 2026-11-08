<?php

namespace App\Http\Controllers;

use App\Repositories\SLARepositoryInterface;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class SLARuleController extends Controller
{
    protected $slaRepository;

    public function __construct(SLARepositoryInterface $slaRepository)
    {
        $this->slaRepository = $slaRepository;
    }

    private function checkSuperAdmin(Request $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }
        if (strtolower(str_replace(' ', '', $user->role ?? '')) !== 'superadmin') {
            return response()->json(['message' => 'Forbidden'], 403);
        }
        return null;
    }

    public function index(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $filters = [
            'department_id' => $request->query('department_id'),
            'priority' => $request->query('priority'),
        ];

        $rules = $this->slaRepository->all($filters);

        return response()->json([
            'sla_rules' => $rules,
        ]);
    }

    public function show(Request $request, int $id)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $rule = $this->slaRepository->find($id);

        if (!$rule) {
            return response()->json(['message' => 'SLA rule not found'], 404);
        }

        return response()->json(['sla_rule' => $rule]);
    }

    public function store(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $validated = $request->validate([
            'department_id' => 'required|integer|exists:departments,id',
            'category_id' => 'nullable|integer|exists:problem_categories,problem_category_ID',
            'priority' => 'required|string|max:100',
            'response_time_limit' => 'required|integer|min:1',
            'resolution_time_limit' => 'required|integer|min:1',
        ]);

        $rule = $this->slaRepository->create($validated);

        // Audit Log entry
        $user = $request->user();
        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => 'config_create',
            'action_by_ID' => $user->emp_id ?? 1,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'SLA Configuration',
                'target' => "Department ID {$rule->department_id} - Priority {$rule->priority}",
                'text' => "Created SLA Rule (ID: {$rule->id}) for Department {$rule->department_name}, Priority {$rule->priority} (Response: {$rule->response_time_limit}m, Resolution: {$rule->resolution_time_limit}m)",
            ]),
            'created_at' => now(),
        ]);

        event(new \App\Events\TicketChanged(['type' => 'config']));

        return response()->json([
            'message' => 'SLA rule created successfully.',
            'sla_rule' => $rule,
        ], 201);
    }

    public function update(Request $request, int $id)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $rule = $this->slaRepository->find($id);
        if (!$rule) {
            return response()->json(['message' => 'SLA rule not found'], 404);
        }

        $validated = $request->validate([
            'department_id' => 'required|integer|exists:departments,id',
            'category_id' => 'nullable|integer|exists:problem_categories,problem_category_ID',
            'priority' => 'required|string|max:100',
            'response_time_limit' => 'required|integer|min:1',
            'resolution_time_limit' => 'required|integer|min:1',
        ]);

        $updatedRule = $this->slaRepository->update($id, $validated);

        // Audit Log entry
        $user = $request->user();
        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => 'config_update',
            'action_by_ID' => $user->emp_id ?? 1,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'SLA Configuration',
                'target' => "SLA Rule ID {$id}",
                'text' => "Updated SLA Rule ID {$id} (Response: {$updatedRule->response_time_limit}m, Resolution: {$updatedRule->resolution_time_limit}m)",
            ]),
            'created_at' => now(),
        ]);

        event(new \App\Events\TicketChanged(['type' => 'config']));

        return response()->json([
            'message' => 'SLA rule updated successfully.',
            'sla_rule' => $updatedRule,
        ]);
    }

    public function destroy(Request $request, int $id)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $rule = $this->slaRepository->find($id);
        if (!$rule) {
            return response()->json(['message' => 'SLA rule not found'], 404);
        }

        $this->slaRepository->delete($id);

        // Audit Log entry
        $user = $request->user();
        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => 'config_delete',
            'action_by_ID' => $user->emp_id ?? 1,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'SLA Configuration',
                'target' => "SLA Rule ID {$id}",
                'text' => "Deleted SLA Rule ID {$id}",
            ]),
            'created_at' => now(),
        ]);

        event(new \App\Events\TicketChanged(['type' => 'config']));

        return response()->json(['message' => 'SLA rule deleted successfully.']);
    }

    /**
     * Recalculate SLA deadlines of all open tickets with the current rules and business hours.
     */
    public function recalculateOpenTickets(Request $request, \App\Services\SLAService $slaService)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        // Business hours may have just changed in configuration-service; read them fresh.
        \Illuminate\Support\Facades\Cache::forget('ticket:config:business_hours');

        $result = $slaService->recalculateOpenTickets();

        $user = $request->user();
        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => 'config_update',
            'action_by_ID' => $user->emp_id ?? 1,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'SLA Configuration',
                'target' => 'Open Tickets',
                'text' => "Recalculated SLA deadlines for {$result['recalculated']} open ticket(s) using the current SLA rules and business hours.",
            ]),
            'created_at' => now(),
        ]);

        event(new \App\Events\TicketChanged(['type' => 'sla']));

        return response()->json([
            'message' => "Recalculated SLA deadlines for {$result['recalculated']} open ticket(s).",
            'recalculated' => $result['recalculated'],
            'failed' => $result['failed'],
        ]);
    }

    public function saveDepartmentRules(Request $request, int $departmentId)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $dept = DB::table('departments')->where('id', $departmentId)->first();
        if (!$dept) {
            return response()->json(['message' => 'Department not found'], 404);
        }

        $validated = $request->validate([
            'rules' => 'required|array',
            'rules.*.priority' => 'required|string',
            'rules.*.response_time_limit' => 'required|integer|min:1',
            'rules.*.resolution_time_limit' => 'required|integer|min:1',
        ]);

        foreach ($validated['rules'] as $ruleData) {
            $priority = $ruleData['priority'];
            $respLimit = (int)$ruleData['response_time_limit'];
            $resLimit = (int)$ruleData['resolution_time_limit'];

            $existing = DB::table('sla_rules')
                ->where('department_id', $departmentId)
                ->whereNull('category_id')
                ->whereRaw('LOWER(priority) = ?', [strtolower($priority)])
                ->first();

            if ($existing) {
                // Update every matching row so duplicate department/priority rules stay in sync.
                DB::table('sla_rules')
                    ->where('department_id', $departmentId)
                    ->whereNull('category_id')
                    ->whereRaw('LOWER(priority) = ?', [strtolower($priority)])
                    ->update([
                        'response_time_limit' => $respLimit,
                        'resolution_time_limit' => $resLimit,
                        'updated_at' => now(),
                    ]);
            } else {
                DB::table('sla_rules')->insert([
                    'department_id' => $departmentId,
                    'category_id' => null,
                    'priority' => $priority,
                    'response_time_limit' => $respLimit,
                    'resolution_time_limit' => $resLimit,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
        }

        $user = $request->user();
        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => 'config_update',
            'action_by_ID' => $user->emp_id ?? 1,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'SLA Configuration',
                'target' => "Department: {$dept->name}",
                'text' => "Updated all priority SLA limits for Department '{$dept->name}'",
            ]),
            'created_at' => now(),
        ]);

        event(new \App\Events\TicketChanged(['type' => 'config']));

        $updatedRules = $this->slaRepository->all(['department_id' => $departmentId]);

        return response()->json([
            'message' => "SLA rules for {$dept->name} updated successfully.",
            'sla_rules' => $updatedRules,
        ]);
    }
}
