<?php

namespace App\Http\Controllers;

use App\Models\WorkflowStatus;
use App\Models\EscalationRule;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class WorkflowEscalationController extends Controller
{
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

    // ─── Workflow Statuses ───────────────────────────────────────────────────

    public static function ensureCanonicalStatuses(): void
    {
        $canonical = [
            [
                'name' => 'New',
                'description' => 'Ticket has been submitted and is awaiting review',
                'bg_color' => '#DBEAFE',
                'text_color' => '#1D4ED8',
                'order_position' => 1,
                'is_system' => true,
                'requires_previous_fulfilled' => false,
                'prerequisite_name' => null,
            ],
            [
                'name' => 'Assigned',
                'description' => 'Ticket has been assigned to a technician',
                'bg_color' => '#FFEDD5',
                'text_color' => '#C2410C',
                'order_position' => 2,
                'is_system' => true,
                'requires_previous_fulfilled' => true,
                'prerequisite_name' => 'New',
            ],
            [
                'name' => 'Pending Reassignment',
                'description' => 'Technician requested ticket reassignment, awaiting review',
                'bg_color' => '#FEF9C3',
                'text_color' => '#A16207',
                'order_position' => 3,
                'is_system' => true,
                'requires_previous_fulfilled' => false,
                'prerequisite_name' => null,
            ],
            [
                'name' => 'In Progress',
                'description' => 'Technician is actively working on the ticket',
                'bg_color' => '#FEE2E2',
                'text_color' => '#B91C1C',
                'order_position' => 4,
                'is_system' => true,
                'requires_previous_fulfilled' => true,
                'prerequisite_name' => 'Assigned',
            ],
            [
                'name' => 'Pending Parts',
                'description' => 'Waiting for replacement parts to arrive',
                'bg_color' => '#F3E8FF',
                'text_color' => '#7E22CE',
                'order_position' => 5,
                'is_system' => true,
                'requires_previous_fulfilled' => false,
                'prerequisite_name' => null,
            ],
            [
                'name' => 'Pending Evaluation',
                'description' => 'Work completed and proof submitted, awaiting CS or customer evaluation',
                'bg_color' => '#CCFBF1',
                'text_color' => '#0F766E',
                'order_position' => 6,
                'is_system' => true,
                'requires_previous_fulfilled' => true,
                'prerequisite_name' => 'In Progress',
            ],
            [
                'name' => 'Resolved',
                'description' => 'Issue has been resolved pending confirmation',
                'bg_color' => '#DCFCE7',
                'text_color' => '#15803D',
                'order_position' => 7,
                'is_system' => true,
                'requires_previous_fulfilled' => true,
                'prerequisite_name' => 'Pending Evaluation',
            ],
            [
                'name' => 'Closed',
                'description' => 'Ticket has been closed and confirmed by the requester',
                'bg_color' => '#F3F4F6',
                'text_color' => '#4B5563',
                'order_position' => 8,
                'is_system' => true,
                'requires_previous_fulfilled' => true,
                'prerequisite_name' => 'Resolved',
            ],
        ];

        foreach ($canonical as $item) {
            $status = WorkflowStatus::where('name', $item['name'])->first();
            if (!$status) {
                WorkflowStatus::create([
                    'name' => $item['name'],
                    'description' => $item['description'],
                    'bg_color' => $item['bg_color'],
                    'text_color' => $item['text_color'],
                    'order_position' => $item['order_position'],
                    'is_system' => true,
                    'requires_previous_fulfilled' => $item['requires_previous_fulfilled'],
                ]);
            } else {
                $status->update([
                    'is_system' => true,
                ]);
            }
        }

        // Link prerequisite foreign keys
        foreach ($canonical as $item) {
            if (!empty($item['prerequisite_name'])) {
                $prereq = WorkflowStatus::where('name', $item['prerequisite_name'])->first();
                if ($prereq) {
                    WorkflowStatus::where('name', $item['name'])
                        ->whereNull('prerequisite_status_id')
                        ->update(['prerequisite_status_id' => $prereq->id]);
                }
            }
        }
    }

    public function getWorkflowStatuses(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        self::ensureCanonicalStatuses();

        $statuses = WorkflowStatus::with('prerequisite:id,name,order_position')
            ->orderBy('order_position', 'asc')
            ->get();
        return response()->json(['workflow_statuses' => $statuses]);
    }

    public function resetDefaultWorkflowStatuses(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        self::ensureCanonicalStatuses();

        $statuses = WorkflowStatus::with('prerequisite:id,name,order_position')
            ->orderBy('order_position', 'asc')
            ->get();

        event(new \App\Events\TicketChanged(['type' => 'config']));

        return response()->json([
            'message' => 'Canonical workflow statuses restored successfully.',
            'workflow_statuses' => $statuses,
        ]);
    }

    public function storeWorkflowStatus(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'description' => 'nullable|string',
            'bg_color' => 'nullable|string|max:50',
            'text_color' => 'nullable|string|max:50',
            'order_position' => 'nullable|integer|min:1',
            'requires_previous_fulfilled' => 'nullable|boolean',
            'prerequisite_status_id' => 'nullable|integer|exists:workflow_statuses,id',
        ]);

        if (empty($validated['order_position'])) {
            $maxOrder = WorkflowStatus::max('order_position') ?? 0;
            $validated['order_position'] = $maxOrder + 1;
        }

        $validated['is_system'] = false;
        $validated['requires_previous_fulfilled'] = $request->boolean('requires_previous_fulfilled');

        $status = WorkflowStatus::create($validated);
        $status->load('prerequisite:id,name,order_position');

        event(new \App\Events\TicketChanged(['type' => 'config']));

        return response()->json(['message' => 'Workflow status created successfully.', 'workflow_status' => $status], 201);
    }

    public function updateWorkflowStatus(Request $request, int $id)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $status = WorkflowStatus::find($id);
        if (!$status) {
            return response()->json(['message' => 'Workflow status not found'], 404);
        }

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'description' => 'nullable|string',
            'bg_color' => 'nullable|string|max:50',
            'text_color' => 'nullable|string|max:50',
            'order_position' => 'nullable|integer|min:1',
            'requires_previous_fulfilled' => 'nullable|boolean',
            'prerequisite_status_id' => 'nullable|integer|exists:workflow_statuses,id',
        ]);

        if (!empty($validated['prerequisite_status_id']) && (int) $validated['prerequisite_status_id'] === $id) {
            return response()->json(['message' => 'A status cannot have itself as a prerequisite.'], 422);
        }

        unset($validated['is_system']);
        $validated['requires_previous_fulfilled'] = $request->boolean('requires_previous_fulfilled');

        $status->update($validated);
        $status->load('prerequisite:id,name,order_position');

        event(new \App\Events\TicketChanged(['type' => 'config']));

        return response()->json(['message' => 'Workflow status updated successfully.', 'workflow_status' => $status]);
    }

    public function destroyWorkflowStatus(Request $request, int $id)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $status = WorkflowStatus::find($id);
        if (!$status) {
            return response()->json(['message' => 'Workflow status not found'], 404);
        }

        if ($status->is_system) {
            return response()->json([
                'message' => 'Core system workflow statuses cannot be deleted.'
            ], 422);
        }

        $dependent = WorkflowStatus::where('prerequisite_status_id', $status->id)->first();
        if ($dependent) {
            return response()->json([
                'message' => "Cannot delete status '{$status->name}' because status '{$dependent->name}' requires it as a prerequisite."
            ], 422);
        }

        $status->delete();

        event(new \App\Events\TicketChanged(['type' => 'config']));

        return response()->json(['message' => 'Workflow status deleted successfully.']);
    }

    // ─── Escalation Rules ───────────────────────────────────────────────────

    public function getEscalationRules(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $rules = EscalationRule::orderBy('id', 'asc')->get();
        return response()->json(['escalation_rules' => $rules]);
    }

    public function storeEscalationRule(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'is_active' => 'nullable|boolean',
            'trigger' => 'required|string|max:255',
            'condition_text' => 'required|string|max:255',
            'condition_highlight' => 'nullable|string|max:255',
            'action' => 'required|string|max:255',
            'notify' => 'required|string|max:255',
        ]);

        $rule = EscalationRule::create($validated);

        event(new \App\Events\TicketChanged(['type' => 'config']));

        return response()->json(['message' => 'Escalation rule created successfully.', 'escalation_rule' => $rule], 201);
    }

    public function updateEscalationRule(Request $request, int $id)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $rule = EscalationRule::find($id);
        if (!$rule) {
            return response()->json(['message' => 'Escalation rule not found'], 404);
        }

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'is_active' => 'nullable|boolean',
            'trigger' => 'required|string|max:255',
            'condition_text' => 'required|string|max:255',
            'condition_highlight' => 'nullable|string|max:255',
            'action' => 'required|string|max:255',
            'notify' => 'required|string|max:255',
        ]);

        $rule->update($validated);

        event(new \App\Events\TicketChanged(['type' => 'config']));

        return response()->json(['message' => 'Escalation rule updated successfully.', 'escalation_rule' => $rule]);
    }

    public function toggleEscalationRule(Request $request, int $id)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $rule = EscalationRule::find($id);
        if (!$rule) {
            return response()->json(['message' => 'Escalation rule not found'], 404);
        }

        $rule->is_active = !$rule->is_active;
        $rule->save();

        event(new \App\Events\TicketChanged(['type' => 'config']));

        return response()->json(['message' => 'Escalation rule status updated successfully.', 'escalation_rule' => $rule]);
    }

    public function destroyEscalationRule(Request $request, int $id)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $rule = EscalationRule::find($id);
        if (!$rule) {
            return response()->json(['message' => 'Escalation rule not found'], 404);
        }

        $rule->delete();

        event(new \App\Events\TicketChanged(['type' => 'config']));

        return response()->json(['message' => 'Escalation rule deleted successfully.']);
    }
}
