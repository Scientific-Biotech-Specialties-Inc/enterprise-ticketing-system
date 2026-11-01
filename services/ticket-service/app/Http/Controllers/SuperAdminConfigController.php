<?php

namespace App\Http\Controllers;

use App\Events\TicketChanged;
use App\Events\TicketLimitsUpdated;
use App\Services\TicketCacheService;
use App\Services\TicketConfigurationService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class SuperAdminConfigController extends Controller
{
    protected TicketCacheService $cacheService;

    public function __construct(TicketCacheService $cacheService)
    {
        $this->cacheService = $cacheService;
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

    public function getSuperAdminConfig(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $equipment = DB::table('machine_categories')
            ->select('category_ID as id', 'category_name as name')
            ->orderBy('category_name')
            ->get();

        $priorities = DB::table('ticket_priorities')
            ->select('priority_ID as id', 'priority_name as name', 'color_code as color')
            ->orderBy('priority_ID')
            ->get();

        $ticketCategories = DB::table('problem_categories')
            ->select('problem_category_ID as id', 'category_name as name', 'description', 'is_active', 'is_system_default')
            ->orderBy('problem_category_ID')
            ->get();

        return response()->json([
            'equipment' => $equipment,
            'priorities' => $priorities,
            'ticket_categories' => $ticketCategories,
        ]);
    }

    public function createSuperAdminTicketCategory(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }
        $user = $request->user();

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'description' => 'nullable|string|max:500',
        ]);

        $name = trim($validated['name']);
        $exists = DB::table('problem_categories')->where('category_name', $name)->exists();
        if ($exists) {
            return response()->json(['message' => "Ticket category '{$name}' already exists."], 422);
        }

        $id = DB::table('problem_categories')->insertGetId([
            'category_name' => $name,
            'description' => $validated['description'] ?? null,
            'is_active' => true,
            'is_system_default' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => 'config_create',
            'action_by_ID' => $user->emp_id ?? 1,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'Ticket Categories',
                'target' => $name,
                'text' => "Created ticket category '{$name}'",
            ]),
            'created_at' => now(),
        ]);

        $this->cacheService->clearTicketCaches();

        return response()->json([
            'message' => 'Ticket category created successfully.',
            'category' => [
                'id' => $id,
                'name' => $name,
                'description' => $validated['description'] ?? null,
                'is_active' => true,
                'is_system_default' => false,
            ],
        ], 201);
    }

    public function updateSuperAdminTicketCategory(Request $request, int $id)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }
        $user = $request->user();

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'description' => 'nullable|string|max:500',
            'is_active' => 'nullable|boolean',
        ]);

        $category = DB::table('problem_categories')->where('problem_category_ID', $id)->first();
        if (!$category) {
            return response()->json(['message' => 'Ticket category not found.'], 404);
        }

        $name = trim($validated['name']);
        $dup = DB::table('problem_categories')
            ->where('category_name', $name)
            ->where('problem_category_ID', '!=', $id)
            ->exists();
        if ($dup) {
            return response()->json(['message' => "Another ticket category named '{$name}' already exists."], 422);
        }

        $updateData = [
            'category_name' => $name,
            'updated_at' => now(),
        ];
        if (array_key_exists('description', $validated)) {
            $updateData['description'] = $validated['description'];
        }
        if (array_key_exists('is_active', $validated)) {
            $updateData['is_active'] = $validated['is_active'];
        }

        DB::table('problem_categories')
            ->where('problem_category_ID', $id)
            ->update($updateData);

        if ($category->category_name !== $name) {
            DB::table('feedback_questions')
                ->where('category', $category->category_name)
                ->update(['category' => $name, 'updated_at' => now()]);
        }

        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => 'config_update',
            'action_by_ID' => $user->emp_id ?? 1,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'Ticket Categories',
                'target' => $name,
                'text' => "Updated ticket category from '{$category->category_name}' to '{$name}'",
            ]),
            'created_at' => now(),
        ]);

        $this->cacheService->clearTicketCaches();

        return response()->json(['message' => 'Ticket category updated successfully.']);
    }

    public function deleteSuperAdminTicketCategory(Request $request, int $id)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }
        $user = $request->user();

        $category = DB::table('problem_categories')->where('problem_category_ID', $id)->first();
        if (!$category) {
            return response()->json(['message' => 'Ticket category not found.'], 404);
        }

        if ($category->is_system_default) {
            return response()->json(['message' => 'System default ticket categories cannot be deleted.'], 422);
        }

        $inUse = DB::table('tickets')->where('problem_category_ID', $id)->exists();
        if ($inUse) {
            DB::table('problem_categories')->where('problem_category_ID', $id)->update(['is_active' => false, 'updated_at' => now()]);
            return response()->json(['message' => "Category is referenced by existing tickets. It has been deactivated instead of deleted."]);
        }

        DB::table('problem_categories')->where('problem_category_ID', $id)->delete();

        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => 'config_delete',
            'action_by_ID' => $user->emp_id ?? 1,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'Ticket Categories',
                'target' => $category->category_name,
                'text' => "Deleted ticket category '{$category->category_name}'",
            ]),
            'created_at' => now(),
        ]);

        $this->cacheService->clearTicketCaches();

        return response()->json(['message' => 'Ticket category deleted successfully.']);
    }

    public function createSuperAdminEquipment(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }
        $user = $request->user();

        $validated = $request->validate([
            'name' => 'required|string|max:255',
        ]);

        $id = DB::table('machine_categories')->insertGetId([
            'category_name' => $validated['name'],
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Keep problem_categories in sync!
        $exists = DB::table('problem_categories')->where('category_name', $validated['name'])->exists();
        if (!$exists) {
            DB::table('problem_categories')->insert([
                'category_name' => $validated['name'],
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        // Audit Log entry
        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => 'config_create',
            'action_by_ID' => $user->emp_id,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'Equipment Configuration',
                'target' => $validated['name'],
                'text' => "Created equipment category '{$validated['name']}'",
            ]),
            'created_at' => now(),
        ]);

        event(new TicketChanged(['type' => 'config']));
        $this->cacheService->clearTicketCaches();

        return response()->json([
            'message' => 'Equipment category created successfully.',
            'id' => $id,
        ], 201);
    }

    public function updateSuperAdminEquipment(Request $request, int $id)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }
        $user = $request->user();

        $validated = $request->validate([
            'name' => 'required|string|max:255',
        ]);

        $category = DB::table('machine_categories')->where('category_ID', $id)->first();
        if (!$category) {
            return response()->json(['message' => 'Equipment category not found'], 404);
        }

        DB::table('machine_categories')
            ->where('category_ID', $id)
            ->update([
                'category_name' => $validated['name'],
                'updated_at' => now(),
            ]);

        DB::table('problem_categories')
            ->where('category_name', $category->category_name)
            ->update([
                'category_name' => $validated['name'],
                'updated_at' => now(),
            ]);

        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => 'config_update',
            'action_by_ID' => $user->emp_id,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'Equipment Configuration',
                'target' => $validated['name'],
                'text' => "Updated equipment category from '{$category->category_name}' to '{$validated['name']}'",
            ]),
            'created_at' => now(),
        ]);

        event(new TicketChanged(['type' => 'config']));
        $this->cacheService->clearTicketCaches();

        return response()->json(['message' => 'Equipment category updated successfully.']);
    }

    public function deleteSuperAdminEquipment(Request $request, int $id)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }
        $user = $request->user();

        $category = DB::table('machine_categories')->where('category_ID', $id)->first();
        if (!$category) {
            return response()->json(['message' => 'Equipment category not found'], 404);
        }

        DB::table('machine_categories')->where('category_ID', $id)->delete();
        DB::table('problem_categories')->where('category_name', $category->category_name)->delete();

        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => 'config_delete',
            'action_by_ID' => $user->emp_id,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'Equipment Configuration',
                'target' => $category->category_name,
                'text' => "Deleted equipment category '{$category->category_name}'",
            ]),
            'created_at' => now(),
        ]);

        event(new TicketChanged(['type' => 'config']));
        $this->cacheService->clearTicketCaches();

        return response()->json(['message' => 'Equipment category deleted successfully.']);
    }

    public function createSuperAdminPriority(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }
        $user = $request->user();

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'color' => 'required|string|max:255',
        ]);

        $id = DB::table('ticket_priorities')->insertGetId([
            'priority_name' => $validated['name'],
            'color_code' => $validated['color'],
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => 'config_create',
            'action_by_ID' => $user->emp_id,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'Priority Configuration',
                'target' => $validated['name'],
                'text' => "Created priority level '{$validated['name']}' with color '{$validated['color']}'",
            ]),
            'created_at' => now(),
        ]);

        event(new TicketChanged(['type' => 'config']));
        $this->cacheService->clearTicketCaches();

        return response()->json([
            'message' => 'Priority level created successfully.',
            'id' => $id,
        ], 201);
    }

    public function updateSuperAdminPriority(Request $request, int $id)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }
        $user = $request->user();

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'color' => 'required|string|max:255',
        ]);

        $priority = DB::table('ticket_priorities')->where('priority_ID', $id)->first();
        if (!$priority) {
            return response()->json(['message' => 'Priority level not found'], 404);
        }

        DB::table('ticket_priorities')
            ->where('priority_ID', $id)
            ->update([
                'priority_name' => $validated['name'],
                'color_code' => $validated['color'],
                'updated_at' => now(),
            ]);

        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => 'config_update',
            'action_by_ID' => $user->emp_id,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'Priority Configuration',
                'target' => $validated['name'],
                'text' => "Updated priority level from '{$priority->priority_name}' to '{$validated['name']}' (color: '{$validated['color']}')",
            ]),
            'created_at' => now(),
        ]);

        event(new TicketChanged(['type' => 'config']));
        $this->cacheService->clearTicketCaches();

        return response()->json(['message' => 'Priority level updated successfully.']);
    }

    public function deleteSuperAdminPriority(Request $request, int $id)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }
        $user = $request->user();

        $priority = DB::table('ticket_priorities')->where('priority_ID', $id)->first();
        if (!$priority) {
            return response()->json(['message' => 'Priority level not found'], 404);
        }

        $activeTicketsCount = DB::table('tickets')->where('priority_ID', $id)->count();
        if ($activeTicketsCount > 0) {
            return response()->json([
                'message' => "Cannot remove priority '{$priority->priority_name}' because {$activeTicketsCount} ticket(s) are currently using it. Please reassign those tickets to another priority level first."
            ], 422);
        }

        try {
            DB::table('ticket_priorities')->where('priority_ID', $id)->delete();
        } catch (\Throwable $e) {
            return response()->json([
                'message' => "Failed to delete priority '{$priority->priority_name}': it is referenced by existing ticket records or configurations."
            ], 422);
        }

        $adminId = $user?->emp_id ?? $user?->id ?? 1;

        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => 'config_delete',
            'action_by_ID' => $adminId,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'Priority Configuration',
                'target' => $priority->priority_name,
                'text' => "Deleted priority level '{$priority->priority_name}'",
            ]),
            'created_at' => now(),
        ]);

        event(new TicketChanged(['type' => 'config']));
        $this->cacheService->clearTicketCaches();

        return response()->json(['message' => 'Priority level deleted successfully.']);
    }

    public function getSuperAdminAuditLogs(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $logs = DB::table('ticket_audit_logs as tal')
            ->leftJoin('employees as e', function ($join) {
                $join->on('e.emp_id', '=', 'tal.action_by_ID')
                    ->whereIn('tal.actor_type', ['employee', 'superadmin', 'admin', 'cs', 'customerservice']);
            })
            ->leftJoin('clients as c', function ($join) {
                $join->on('c.id', '=', 'tal.action_by_ID')
                    ->where('tal.actor_type', '=', 'customer');
            })
            ->leftJoin('tickets as t', 't.ticket_ID', '=', 'tal.ticket_ID')
            ->select('tal.*', 'e.first_name', 'e.last_name', 'e.role', 'c.client_name')
            ->orderBy('tal.created_at', 'desc')
            ->get();

        $formattedLogs = $logs->map(function ($log) {
            $userFullName = 'System';
            $role = 'System';

            if ($log->actor_type === 'customer') {
                $role = 'Customer';
                $userFullName = $log->client_name ?? 'Customer';
            } elseif ($log->actor_type === 'system' || (int)$log->action_by_ID === 0) {
                $userFullName = 'System';
                $role = 'System';
            } elseif ($log->actor_type === 'superadmin') {
                $role = 'Super Admin';
                $userFullName = trim(($log->first_name ?? '') . ' ' . ($log->last_name ?? '')) ?: 'Super Admin';
            } else {
                $userFullName = trim(($log->first_name ?? '') . ' ' . ($log->last_name ?? '')) ?: 'Staff';
                $role = $log->role ? ucwords($log->role) : 'Employee';
            }

            $action = 'Updated';
            $module = 'Tickets';
            $target = $log->ticket_ID ? 'TKT-' . str_pad((string) $log->ticket_ID, 4, '0', STR_PAD_LEFT) : 'System';
            $details = $log->details;

            $detailsDecoded = json_decode($log->details, true);
            if ($log->actor_type === 'superadmin' && $detailsDecoded) {
                $module = $detailsDecoded['module'] ?? 'System';
                $target = $detailsDecoded['target'] ?? 'System';
                $details = $detailsDecoded['text'] ?? '';
                
                if (str_contains($log->action_type, 'create')) {
                    $action = 'Created';
                } elseif (str_contains($log->action_type, 'delete')) {
                    $action = 'Deleted';
                } else {
                    $action = 'Updated';
                }
            } else {
                if ($log->action_type === 'create') {
                    $action = 'Created';
                    if ($detailsDecoded && isset($detailsDecoded['title'])) {
                        $details = "Created ticket \"" . $detailsDecoded['title'] . "\"";
                    }
                } elseif ($log->action_type === 'accept') {
                    $action = 'Accepted';
                } elseif ($log->action_type === 'reassign_request') {
                    $action = 'Reassign Requested';
                } elseif ($log->action_type === 'reassign_approve') {
                    $action = 'Reassign Approved';
                } elseif ($log->action_type === 'reassign_reject') {
                    $action = 'Reassign Rejected';
                } elseif ($log->action_type === 'internal_note') {
                    $action = 'Internal Note Added';
                } elseif ($log->action_type === 'employee_update') {
                    $action = 'Employee Updated';
                } elseif ($log->action_type === 'system_alert') {
                    $action = 'System Alert';
                    $module = 'Security & System';
                    $target = $detailsDecoded['incident_id'] ?? $detailsDecoded['target'] ?? 'System';
                    $details = $detailsDecoded['text'] ?? $detailsDecoded['message'] ?? 'System Issue Detected';
                } elseif ($log->action_type === 'system_alert_burst') {
                    $action = 'Alert Burst';
                    $module = 'Security & System';
                    $target = $detailsDecoded['incident_id'] ?? $detailsDecoded['target'] ?? 'System';
                    $details = $detailsDecoded['text'] ?? $detailsDecoded['message'] ?? 'Repeat Alert Burst Grouped';
                }

                if ($log->action_type !== 'create' && $detailsDecoded && !str_starts_with((string)$log->action_type, 'system_alert')) {
                    if (isset($detailsDecoded['field'])) {
                        $field = $detailsDecoded['field'];
                        $oldVal = is_array($detailsDecoded['old']) ? json_encode($detailsDecoded['old']) : ($detailsDecoded['old'] ?? 'null');
                        $newVal = is_array($detailsDecoded['new']) ? json_encode($detailsDecoded['new']) : ($detailsDecoded['new'] ?? 'null');
                        $details = "Changed field '{$field}' from '{$oldVal}' to '{$newVal}'";
                    } elseif (isset($detailsDecoded['message'])) {
                        $details = $detailsDecoded['message'];
                    } elseif (isset($detailsDecoded['reason'])) {
                        $details = "Reason: " . $detailsDecoded['reason'];
                    } elseif (isset($detailsDecoded['note'])) {
                        $details = "Note: " . $detailsDecoded['note'];
                    }
                }
            }

            return [
                'id' => $log->log_ID,
                'timestamp' => $log->created_at,
                'user' => $userFullName,
                'role' => $role,
                'action' => $action,
                'module' => $module,
                'target' => $target,
                'details' => $details,
                'incident_id' => $detailsDecoded['incident_id'] ?? null,
                'severity' => $detailsDecoded['severity'] ?? null,
                'burst_count' => $detailsDecoded['burst_count'] ?? 1,
            ];
        });

        return response()->json($formattedLogs);
    }

    /**
     * Retrieve paginated security and system incident alerts.
     */
    public function getSecurityIncidents(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $query = DB::table('system_security_alerts');

        if ($request->filled('category')) {
            $query->where('category', $request->query('category'));
        }
        if ($request->filled('severity')) {
            $query->where('severity', $request->query('severity'));
        }
        if ($request->filled('q')) {
            $q = '%' . $request->query('q') . '%';
            $query->where(function ($sub) use ($q) {
                $sub->where('incident_id', 'like', $q)
                    ->orWhere('title', 'like', $q)
                    ->orWhere('message', 'like', $q)
                    ->orWhere('service', 'like', $q);
            });
        }

        $incidents = $query->orderBy('last_seen_at', 'desc')->paginate((int) $request->query('limit', 25));

        return response()->json($incidents);
    }

    /**
     * Retrieve technical context for a specific security incident.
     */
    public function getSecurityIncidentDetail(Request $request, string $incidentId)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $incident = DB::table('system_security_alerts')->where('incident_id', $incidentId)->first();
        if (!$incident) {
            return response()->json(['message' => 'Security incident not found.'], 404);
        }

        $decodedContext = json_decode($incident->context_data ?? '{}', true) ?: [];

        return response()->json([
            'incident' => $incident,
            'context' => $decodedContext,
        ]);
    }

    /**
     * TS088: Get log retention policy configuration.
     */
    public function getLogRetentionConfig(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $retentionDays = (int) \Illuminate\Support\Facades\Cache::get('superadmin_log_retention_days', 365);
        $threshold = \Illuminate\Support\Carbon::now()->subDays($retentionDays);
        $affectedCount = DB::table('ticket_audit_logs')
            ->where('created_at', '<', $threshold)
            ->count();

        return response()->json([
            'retention_days' => $retentionDays,
            'threshold_date' => $threshold->toIso8601String(),
            'affected_records_count' => $affectedCount,
            'schedule' => 'Nightly at 02:00 UTC',
            'last_purged_at' => \Illuminate\Support\Facades\Cache::get('superadmin_last_log_purge_at'),
        ]);
    }

    /**
     * TS088: Update log retention policy configuration.
     */
    public function updateLogRetentionConfig(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $validated = $request->validate([
            'retention_days' => 'required|integer|min:7|max:1825',
        ]);

        \Illuminate\Support\Facades\Cache::forever('superadmin_log_retention_days', $validated['retention_days']);

        return response()->json([
            'message' => 'Log retention policy updated successfully.',
            'retention_days' => $validated['retention_days'],
        ]);
    }

    /**
     * TS088: Permanently purge audit logs older than retention threshold.
     */
    public function purgeAuditLogs(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $retentionDays = (int) ($request->input('retention_days') ?? \Illuminate\Support\Facades\Cache::get('superadmin_log_retention_days', 365));
        $threshold = \Illuminate\Support\Carbon::now()->subDays($retentionDays);

        $deletedCount = DB::table('ticket_audit_logs')
            ->where('created_at', '<', $threshold)
            ->delete();

        \Illuminate\Support\Facades\Cache::forever('superadmin_last_log_purge_at', \Illuminate\Support\Carbon::now()->toIso8601String());

        // Write an audit log entry for the purge action itself
        try {
            DB::table('ticket_audit_logs')->insert([
                'action_type' => 'config_purge',
                'action_by_ID' => $request->user()->emp_id ?? 0,
                'actor_type' => 'superadmin',
                'details' => json_encode([
                    'module' => 'System',
                    'target' => 'Audit Logs',
                    'text' => "Permanently purged {$deletedCount} historical audit log records older than {$retentionDays} days.",
                ]),
                'created_at' => \Illuminate\Support\Carbon::now(),
            ]);
        } catch (\Exception $e) {
            // Ignore if insert fails
        }

        return response()->json([
            'message' => "Successfully purged {$deletedCount} expired audit log records.",
            'purged_count' => $deletedCount,
            'threshold_date' => $threshold->toIso8601String(),
            'purged_at' => \Illuminate\Support\Carbon::now()->toIso8601String(),
        ]);
    });

        return response()->json($formattedLogs);
    }


    /**
     * Retrieve the system-wide max-open-ticket configuration.
     */
    public function getTicketLimit(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $config = TicketConfigurationService::getLimitConfig();

        return response()->json([
            'key' => 'limits',
            'value' => $config,
        ]);
    }

    /**
     * Update the max-open-ticket policy and record the authenticated actor.
     */
    public function updateTicketLimit(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $payload = $request->input('value', $request->all());
        $validator = \Illuminate\Support\Facades\Validator::make($payload, [
            'isUnlimited' => ['required', 'boolean'],
            'limit' => ['required', 'integer', 'min:1', 'max:1000'],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'message' => 'Validation Error: Invalid max open tickets configuration.',
                'errors' => $validator->errors(),
            ], 422);
        }

        $user = $request->user();
        $before = TicketConfigurationService::getLimitConfig();

        try {
            $updated = TicketConfigurationService::updateLimitConfig($validator->validated(), $user);
        } catch (\Throwable $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        $this->recordTicketLimitChange($user, $before, $updated, 'config_update');

        return response()->json([
            'message' => 'Max open tickets configuration updated successfully.',
            'key' => 'limits',
            'value' => $updated,
        ]);
    }

    /**
     * Reset the max-open-ticket policy to Unlimited.
     */
    public function resetTicketLimit(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $user = $request->user();
        $before = TicketConfigurationService::getLimitConfig();

        try {
            $updated = TicketConfigurationService::resetLimitConfig($user);
        } catch (\Throwable $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        $this->recordTicketLimitChange($user, $before, $updated, 'config_reset');

        return response()->json([
            'message' => 'Max open tickets configuration reset to Unlimited.',
            'key' => 'limits',
            'value' => $updated,
        ]);
    }

    private function recordTicketLimitChange($user, array $before, array $after, string $actionType): void
    {
        if ($before === $after) {
            return;
        }

        $changedAt = now();
        $actorId = (int) ($user->emp_id ?? $user->id);
        $previousLimit = $before['isUnlimited'] ? 'unlimited' : (int) $before['limit'];
        $newLimit = $after['isUnlimited'] ? 'unlimited' : (int) $after['limit'];

        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => $actionType,
            'action_by_ID' => $actorId,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'Ticket Limit Configuration',
                'target' => 'Max Open Tickets per Requester',
                'text' => "Changed max open tickets from {$previousLimit} to {$newLimit}.",
                'previous_limit' => $previousLimit,
                'new_limit' => $newLimit,
                'previous_value' => $before,
                'new_value' => $after,
                'changed_at' => $changedAt->toIso8601String(),
            ]),
            'created_at' => $changedAt,
        ]);

        try {
            event(new TicketLimitsUpdated(
                $before,
                $after,
                $actorId,
                $changedAt->toIso8601String()
            ));
        } catch (\Throwable $e) {
            Log::warning('Broadcasting TicketLimitsUpdated failed: ' . $e->getMessage());
        }
    }

    /**
     * Retrieve the ticket lifecycle window configuration (reopen & auto-close).
     */
    public function getWindowConfig(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $config = \App\Services\TicketConfigurationService::getWindowConfig();

        return response()->json(array_merge([
            'key' => 'windows',
            'value' => $config,
        ], $config));
    }

    /**
     * Update the ticket lifecycle window configuration independently with strict validation.
     */
    public function updateWindowConfig(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }
        $user = $request->user();

        $payload = $request->input('value', $request->all());

        $validator = \Illuminate\Support\Facades\Validator::make($payload, [
            'reopenEnabled' => 'sometimes|boolean',
            'reopenWindowDays' => [
                'sometimes',
                'required',
                function ($attribute, $value, $fail) {
                    if (!is_numeric($value)) {
                        $fail('The reopen window duration must be a valid numeric value.');
                        return;
                    }
                    $num = (float) $value;
                    if ($num <= 0) {
                        $fail('The reopen window duration must be a positive number greater than zero.');
                        return;
                    }
                    if ((int) $value != $num) {
                        $fail('The reopen window duration must be a whole integer number of days.');
                    }
                },
            ],
            'autoCloseEnabled' => 'sometimes|boolean',
            'autoCloseWindowDays' => [
                'sometimes',
                'required',
                function ($attribute, $value, $fail) {
                    if (!is_numeric($value)) {
                        $fail('The auto-close window duration must be a valid numeric value.');
                        return;
                    }
                    $num = (float) $value;
                    if ($num <= 0) {
                        $fail('The auto-close window duration must be a positive number greater than zero.');
                        return;
                    }
                    if ((int) $value != $num) {
                        $fail('The auto-close window duration must be a whole integer number of days.');
                    }
                },
            ],
        ], [
            'reopenEnabled.boolean' => 'The reopen enabled setting must be true or false.',
            'autoCloseEnabled.boolean' => 'The auto-close enabled setting must be true or false.',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'message' => 'Validation Error: Invalid window configuration values.',
                'errors' => $validator->errors(),
            ], 422);
        }

        $validated = $validator->validated();

        try {
            $updated = \App\Services\TicketConfigurationService::updateWindowConfig($validated, $user);
        } catch (\Throwable $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        $reopenText = ($updated['reopenEnabled'] ?? true)
            ? "Enabled ({$updated['reopenWindowDays']} days)"
            : "Disabled";
        $autoCloseText = ($updated['autoCloseEnabled'] ?? true)
            ? "Enabled ({$updated['autoCloseWindowDays']} days)"
            : "Disabled";

        // Audit Log entry in ticket-service
        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => 'config_update',
            'action_by_ID' => $user->emp_id ?? $user->id ?? 1,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'Lifecycle Window Configuration',
                'target' => 'Reopen & Auto-Close Windows',
                'text' => "Updated ticket lifecycle windows: Customer Reopen is {$reopenText}, Auto-Close is {$autoCloseText}. Changes apply only to subsequent lifecycle actions.",
            ]),
            'created_at' => now(),
        ]);

        event(new TicketChanged([
            'type' => 'config',
            'section' => 'windows',
            'data' => $updated,
        ]));

        $this->cacheService->clearTicketCaches();

        return response()->json(array_merge([
            'message' => 'Ticket lifecycle window configuration updated successfully.',
            'key' => 'windows',
            'value' => $updated,
        ], $updated));
    }

    /**
     * View active notification recipient routing.
     */
    public function getNotificationRouting(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $routing = \App\Services\TicketConfigurationService::getRoutingConfig();

        return response()->json([
            'key' => 'routing',
            'value' => $routing,
            'immutable_scope' => [
                'system_alert' => [
                    'locked' => true,
                    'recipients' => ['role_superadmin'],
                    'description' => 'System alerts are strictly hard-coded to Super Admin at dispatch level and cannot be modified.',
                ],
            ],
        ]);
    }

    /**
     * Update notification recipient routing with strict validation:
     * - Rejects any save with 0 recipients in a configurable scope
     * - Explicitly excludes and rejects system_alert modification
     * - Dispatches TicketChanged broadcast and writes audit log
     */
    public function updateNotificationRouting(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }
        $user = $request->user();

        $rawPayload = $request->all();
        $routingPayload = $request->input('routing', $request->input('value', $rawPayload));

        // 1. Explicitly reject system_alert from configurable scope
        if (isset($routingPayload['system_alert']) || isset($rawPayload['system_alert'])) {
            return response()->json([
                'message' => 'Validation Error: system_alert cannot be configured. System alerts are strictly hard-coded to Super Admin at dispatch level.',
                'errors' => [
                    'system_alert' => ['System alerts are restricted to Super Admin and cannot be customized via recipient routing.'],
                ],
            ], 422);
        }

        $titles = [
            'new_ticket' => 'New Ticket Alert',
            'new_message' => 'New Message Alert',
            'overdue_ticket' => 'Overdue Ticket Alert',
        ];

        // 2. Reject zero recipients for any configurable scope
        $errors = [];
        foreach (['new_ticket', 'new_message', 'overdue_ticket'] as $scopeKey) {
            if (array_key_exists($scopeKey, $routingPayload)) {
                $recipients = $routingPayload[$scopeKey];
                if (!is_array($recipients) || count($recipients) === 0) {
                    $errors[$scopeKey] = ["At least one recipient is required for {$titles[$scopeKey]}."];
                }
            }
        }

        if (!empty($errors)) {
            return response()->json([
                'message' => 'Validation Error: Invalid recipient routing configuration.',
                'errors' => $errors,
            ], 422);
        }

        try {
            $updated = \App\Services\TicketConfigurationService::updateRoutingConfig($routingPayload, $user);
        } catch (\Throwable $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        // Audit Log entry in ticket-service
        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => 'config_update',
            'action_by_ID' => $user->emp_id ?? $user->id ?? 1,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'Notification Recipient Routing',
                'target' => 'Recipient Routing Rules',
                'text' => "Updated notification recipient routing for: " . implode(', ', array_keys($updated)),
            ]),
            'created_at' => now(),
        ]);

        $this->cacheService->clearTicketCaches();

        return response()->json([
            'message' => 'Notification recipient routing updated successfully.',
            'key' => 'routing',
            'value' => $updated,
        ]);
    }

    /**
     * Reset notification recipient routing to factory defaults.
     */
    public function resetNotificationRouting(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }
        $user = $request->user();

        $defaults = \App\Services\TicketConfigurationService::resetRoutingConfig($user);

        // Audit Log entry in ticket-service
        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => 'config_reset',
            'action_by_ID' => $user->emp_id ?? $user->id ?? 1,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'Notification Recipient Routing',
                'target' => 'Recipient Routing Rules',
                'text' => "Reset notification recipient routing to system defaults.",
            ]),
            'created_at' => now(),
        ]);

        $this->cacheService->clearTicketCaches();

        return response()->json([
            'message' => 'Notification recipient routing reset to defaults.',
            'key' => 'routing',
            'value' => $defaults,
        ]);
    }

    public function getCompanyInfo(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }
        $info = \App\Services\TicketConfigurationService::getCompanyInfo();
        return response()->json([
            'key' => 'company_info',
            'value' => $info,
        ]);
    }

    public function updateCompanyInfo(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }
        $user = $request->user();
        $payload = $request->input('value', $request->all());
        try {
            $updated = \App\Services\TicketConfigurationService::updateCompanyInfo($payload, $user);
        } catch (\Throwable $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }
        return response()->json([
            'message' => 'Company information updated successfully.',
            'key' => 'company_info',
            'value' => $updated,
        ]);
    }

    public function getSystemStatus(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }
        $status = \App\Services\TicketConfigurationService::getSystemStatus();
        return response()->json([
            'key' => 'system_status',
            'status' => $status,
            'value' => ['status' => $status],
        ]);
    }

    public function updateSystemStatus(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }
        $user = $request->user();
        $status = $request->input('status', $request->input('value.status', 'Operational'));
        try {
            $updated = \App\Services\TicketConfigurationService::updateSystemStatus($status, $user);
        } catch (\Throwable $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }
        return response()->json([
            'message' => "System status updated successfully to '{$updated}'.",
            'key' => 'system_status',
            'status' => $updated,
            'value' => ['status' => $updated],
        ]);
    }

    public function getLogLevel(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }
        $level = \App\Services\TicketConfigurationService::getLogLevel();
        return response()->json([
            'key' => 'log_level',
            'level' => $level,
            'value' => ['level' => $level],
        ]);
    }

    public function updateLogLevel(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }
        $user = $request->user();
        $level = $request->input('level', $request->input('value.level', 'Info'));
        try {
            $updated = \App\Services\TicketConfigurationService::updateLogLevel($level, $user);
        } catch (\Throwable $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }
        return response()->json([
            'message' => "Log level updated successfully to '{$updated}'.",
            'key' => 'log_level',
            'level' => $updated,
            'value' => ['level' => $updated],
        ]);
    }

    /**
     * Retrieve the ticket number format configuration.
     */
    public function getNumberFormatConfig(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $config = \App\Services\TicketConfigurationService::getNumberFormatConfig();

        return response()->json(array_merge([
            'key' => 'number_format',
            'value' => $config,
        ], $config));
    }

    /**
     * Update the ticket number format configuration with strict validation.
     * Rejects configurations missing a sequential component or with invalid structures.
     */
    public function updateNumberFormatConfig(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }
        $user = $request->user();

        $payload = $request->input('value', $request->all());

        $validator = \Illuminate\Support\Facades\Validator::make($payload, [
            'prefix' => [
                'required',
                'string',
                'max:16',
                'regex:/^[A-Za-z0-9_-]{1,16}$/',
            ],
            'includeDeptCode' => 'sometimes|boolean',
            'deptCode' => [
                'nullable',
                'required_if:includeDeptCode,true,1',
                function ($attribute, $value, $fail) use ($payload) {
                    $includeDept = filter_var($payload['includeDeptCode'] ?? false, FILTER_VALIDATE_BOOLEAN);
                    if ($includeDept) {
                        $trimmed = trim((string)$value);
                        if (empty($trimmed)) {
                            $fail('A branch or department code is required when the department code segment is enabled.');
                            return;
                        }
                        if (!preg_match('/^[A-Za-z0-9_-]{1,16}$/', $trimmed)) {
                            $fail('Department code can only contain alphanumeric characters, hyphens, and underscores.');
                        }
                    }
                },
            ],
            'dateSegment' => 'required|string|in:none,YYYY,YYYYMM,YYYYMMDD',
            'digitLength' => [
                'required',
                function ($attribute, $value, $fail) {
                    if ($value === null || $value === '' || !is_numeric($value)) {
                        $fail('A sequential component is strictly required to guarantee unique ticket numbers.');
                        return;
                    }
                    $intVal = (int) $value;
                    if ((string) $intVal !== (string) (int)$value || (float)$value != $intVal) {
                        $fail('Sequential digit length must be a whole integer number.');
                        return;
                    }
                    if ($intVal < 3 || $intVal > 8) {
                        $fail('Sequential digit length must be between 3 and 8 digits.');
                    }
                },
            ],
        ], [
            'prefix.required' => 'A ticket prefix is required.',
            'prefix.regex' => 'Prefix can only contain alphanumeric characters, hyphens, and underscores.',
            'dateSegment.required' => 'A valid date segment option must be selected.',
            'dateSegment.in' => 'Date segment must be one of: none, YYYY, YYYYMM, YYYYMMDD.',
            'digitLength.required' => 'A sequential component is strictly required to guarantee unique ticket numbers.',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'message' => 'Validation Error: Invalid ticket number format configuration.',
                'errors' => $validator->errors(),
            ], 422);
        }

        $validated = $validator->validated();
        $sanitized = [
            'prefix' => strtoupper(trim($validated['prefix'])),
            'includeDeptCode' => (bool) ($validated['includeDeptCode'] ?? false),
            'deptCode' => strtoupper(trim($validated['deptCode'] ?? '')),
            'dateSegment' => $validated['dateSegment'],
            'digitLength' => (int) $validated['digitLength'],
        ];

        $previousFormat = \App\Services\TicketConfigurationService::getNumberFormatConfig();

        try {
            $updated = \App\Services\TicketConfigurationService::updateNumberFormatConfig($sanitized, $user);
        } catch (\Throwable $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        $adminName = $user ? trim(($user->first_name ?? '') . ' ' . ($user->last_name ?? '')) : 'Super Admin';
        if (empty($adminName)) {
            $adminName = (string) ($user->emp_id ?? $user->id ?? 'Super Admin');
        }

        $auditText = sprintf(
            "Updated ticket number format: prefix '%s', digits %d, date segment '%s'%s. Applies only to newly created tickets.",
            $updated['prefix'],
            $updated['digitLength'],
            $updated['dateSegment'],
            $updated['includeDeptCode'] ? ", dept code '{$updated['deptCode']}'" : ''
        );

        // Audit Log entry in ticket-service
        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => 'config_update',
            'action_by_ID' => $user->emp_id ?? $user->id ?? 1,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'Ticket Number Format',
                'target' => 'Format Definition',
                'text' => $auditText,
                'super_admin' => $adminName,
                'previous_format' => $previousFormat,
                'new_format' => $updated,
                'timestamp' => now()->toIso8601String(),
            ]),
            'created_at' => now(),
        ]);

        // Broadcast events
        event(new \App\Events\TicketNumberFormatUpdated(
            $previousFormat,
            $updated,
            now()->toIso8601String()
        ));

        event(new TicketChanged([
            'type' => 'config',
            'section' => 'number_format',
            'data' => $updated,
        ]));

        $this->cacheService->clearTicketCaches();

        return response()->json(array_merge([
            'message' => 'Ticket number format configuration updated successfully.',
            'key' => 'number_format',
            'value' => $updated,
        ], $updated));
    }

    /**
     * Reset the ticket number format configuration to system defaults.
     */
    public function resetNumberFormatConfig(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }
        $user = $request->user();

        $previousFormat = \App\Services\TicketConfigurationService::getNumberFormatConfig();

        try {
            $reset = \App\Services\TicketConfigurationService::resetNumberFormatConfig($user);
        } catch (\Throwable $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        $adminName = $user ? trim(($user->first_name ?? '') . ' ' . ($user->last_name ?? '')) : 'Super Admin';
        if (empty($adminName)) {
            $adminName = (string) ($user->emp_id ?? $user->id ?? 'Super Admin');
        }

        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => 'config_reset',
            'action_by_ID' => $user->emp_id ?? $user->id ?? 1,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'Ticket Number Format',
                'target' => 'Format Definition',
                'text' => 'Reset ticket number format to default (TKT-0001). Applies only to newly created tickets.',
                'super_admin' => $adminName,
                'previous_format' => $previousFormat,
                'new_format' => $reset,
                'timestamp' => now()->toIso8601String(),
            ]),
            'created_at' => now(),
        ]);

        event(new \App\Events\TicketNumberFormatUpdated(
            $previousFormat,
            $reset,
            now()->toIso8601String()
        ));

        event(new TicketChanged([
            'type' => 'config',
            'section' => 'number_format',
            'data' => $reset,
        ]));

        $this->cacheService->clearTicketCaches();

        return response()->json(array_merge([
            'message' => 'Ticket number format configuration reset to default successfully.',
            'key' => 'number_format',
            'value' => $reset,
        ], $reset));
    }

    /**
     * Retrieve the ticket default values configuration (default status, priority, SLA policy).
     */
    public function getTicketDefaultsConfig(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $config = \App\Services\TicketConfigurationService::getDefaultsConfig();

        $priorities = DB::table('ticket_priorities')
            ->select('priority_ID as id', 'priority_name as name', 'color_code as color')
            ->orderBy('priority_ID')
            ->get();

        $slas = DB::table('slas')
            ->where('is_active', true)
            ->select('sla_ID as id', 'sla_name as name', 'response_time_minutes', 'resolution_time_minutes')
            ->orderBy('sla_ID')
            ->get();

        return response()->json([
            'key' => 'defaults',
            'value' => $config,
            'status' => $config['status'],
            'priority' => $config['priority'],
            'slaPolicy' => $config['slaPolicy'],
            'available_starting_statuses' => ['Open'],
            'available_priorities' => $priorities,
            'available_slas' => $slas,
        ]);
    }

    /**
     * Update the default ticket values with strict validation:
     * - Default status must be a valid starting status per the ticket state machine.
     * - Default priority must be an existing, currently configured priority level.
     * - Role-based access control enforces super admin only.
     * - Dispatches broadcast event and writes audit log.
     * - Changes apply only to new tickets and do not alter existing tickets.
     */
    public function updateTicketDefaultsConfig(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }
        $user = $request->user();

        $payload = $request->input('value', $request->all());

        $validator = \Illuminate\Support\Facades\Validator::make($payload, [
            'status' => [
                'required',
                'string',
                'max:64',
                function ($attribute, $value, $fail) {
                    $trimmed = trim((string) $value);
                    $validStartingStatuses = ['Open'];
                    $isValidStarting = false;
                    foreach ($validStartingStatuses as $startStatus) {
                        if (strcasecmp($trimmed, $startStatus) === 0) {
                            $isValidStarting = true;
                            break;
                        }
                    }
                    if (!$isValidStarting) {
                        $fail("The default status must be a valid starting status per the ticket state machine (e.g., 'Open'). Status '{$value}' is not a valid initial state.");
                        return;
                    }
                    $exists = DB::table('ticket_statuses')
                        ->whereRaw('LOWER(status_name) = ?', [strtolower($trimmed)])
                        ->exists();
                    if (!$exists) {
                        $fail("The default status '{$value}' does not exist in the configured ticket statuses.");
                    }
                },
            ],
            'priority' => [
                'required',
                'string',
                'max:64',
                function ($attribute, $value, $fail) {
                    $trimmed = trim((string) $value);
                    $exists = DB::table('ticket_priorities')
                        ->whereRaw('LOWER(priority_name) = ?', [strtolower($trimmed)])
                        ->exists();
                    if (!$exists) {
                        $fail("The default priority must be an existing, currently configured priority level. Priority '{$value}' is not recognized.");
                    }
                },
            ],
            'slaPolicy' => [
                'required',
                'string',
                'max:64',
                function ($attribute, $value, $fail) {
                    $trimmed = trim((string) $value);
                    if (strtolower($trimmed) === 'dynamic') {
                        return;
                    }
                    $exists = DB::table('slas')
                        ->where('is_active', true)
                        ->where(function ($q) use ($trimmed) {
                            $q->where('sla_ID', $trimmed)
                              ->orWhereRaw('LOWER(sla_name) = ?', [strtolower($trimmed)]);
                        })
                        ->exists();
                    if (!$exists) {
                        $fail("The default SLA policy must be either 'dynamic' or an active configured SLA policy.");
                    }
                },
            ],
        ], [
            'status.required' => 'The default status is required.',
            'priority.required' => 'The default priority is required.',
            'slaPolicy.required' => 'The default SLA policy is required.',
        ]);

        if ($validator->fails()) {
            return response()->json([
                'message' => 'Validation Error: Invalid ticket defaults configuration.',
                'errors' => $validator->errors(),
            ], 422);
        }

        $validated = $validator->validated();

        // Canonical names from DB
        $canonicalStatus = DB::table('ticket_statuses')
            ->whereRaw('LOWER(status_name) = ?', [strtolower(trim($validated['status']))])
            ->value('status_name') ?? trim($validated['status']);

        $canonicalPriority = DB::table('ticket_priorities')
            ->whereRaw('LOWER(priority_name) = ?', [strtolower(trim($validated['priority']))])
            ->value('priority_name') ?? trim($validated['priority']);

        $sanitizedSla = trim($validated['slaPolicy']);
        if (strtolower($sanitizedSla) === 'dynamic') {
            $sanitizedSla = 'dynamic';
        }

        $sanitized = [
            'status' => $canonicalStatus,
            'priority' => $canonicalPriority,
            'slaPolicy' => $sanitizedSla,
        ];

        $previousDefaults = \App\Services\TicketConfigurationService::getDefaultsConfig();

        try {
            $updated = \App\Services\TicketConfigurationService::updateDefaultsConfig($sanitized, $user);
        } catch (\Throwable $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        $adminName = $user ? trim(($user->first_name ?? '') . ' ' . ($user->last_name ?? '')) : 'Super Admin';
        if (empty($adminName)) {
            $adminName = (string) ($user->emp_id ?? $user->id ?? 'Super Admin');
        }

        $auditText = sprintf(
            "Updated ticket defaults: status '%s', priority '%s', SLA policy '%s'. Applies only to newly created tickets.",
            $updated['status'],
            $updated['priority'],
            $updated['slaPolicy']
        );

        // Audit Log entry in ticket-service
        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => 'config_update',
            'action_by_ID' => $user->emp_id ?? $user->id ?? 1,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'Ticket Defaults Configuration',
                'target' => 'Default Starting Values',
                'text' => $auditText,
                'super_admin' => $adminName,
                'previous_defaults' => $previousDefaults,
                'new_defaults' => $updated,
                'timestamp' => now()->toIso8601String(),
            ]),
            'created_at' => now(),
        ]);

        // Broadcast events
        event(new \App\Events\TicketDefaultsUpdated(
            $previousDefaults,
            $updated,
            (int) ($user->emp_id ?? $user->id ?? 1),
            now()->toIso8601String()
        ));

        event(new TicketChanged([
            'type' => 'config',
            'section' => 'defaults',
            'data' => $updated,
        ]));

        $this->cacheService->clearTicketCaches();

        return response()->json([
            'message' => 'Ticket defaults configuration updated successfully.',
            'key' => 'defaults',
            'value' => $updated,
            'status' => $updated['status'],
            'priority' => $updated['priority'],
            'slaPolicy' => $updated['slaPolicy'],
        ]);
    }

    /**
     * Reset the ticket defaults configuration to system baseline.
     */
    public function resetTicketDefaultsConfig(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }
        $user = $request->user();

        $previousDefaults = \App\Services\TicketConfigurationService::getDefaultsConfig();

        try {
            $reset = \App\Services\TicketConfigurationService::resetDefaultsConfig($user);
        } catch (\Throwable $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        $adminName = $user ? trim(($user->first_name ?? '') . ' ' . ($user->last_name ?? '')) : 'Super Admin';
        if (empty($adminName)) {
            $adminName = (string) ($user->emp_id ?? $user->id ?? 'Super Admin');
        }

        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => 'config_reset',
            'action_by_ID' => $user->emp_id ?? $user->id ?? 1,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'Ticket Defaults Configuration',
                'target' => 'Default Starting Values',
                'text' => 'Reset ticket defaults to system baseline (Open status, Low priority, dynamic SLA policy). Applies only to newly created tickets.',
                'super_admin' => $adminName,
                'previous_defaults' => $previousDefaults,
                'new_defaults' => $reset,
                'timestamp' => now()->toIso8601String(),
            ]),
            'created_at' => now(),
        ]);

        event(new \App\Events\TicketDefaultsUpdated(
            $previousDefaults,
            $reset,
            (int) ($user->emp_id ?? $user->id ?? 1),
            now()->toIso8601String()
        ));

        event(new TicketChanged([
            'type' => 'config',
            'section' => 'defaults',
            'data' => $reset,
        ]));

        $this->cacheService->clearTicketCaches();

        return response()->json([
            'message' => 'Ticket defaults configuration reset to system baseline successfully.',
            'key' => 'defaults',
            'value' => $reset,
            'status' => $reset['status'],
            'priority' => $reset['priority'],
            'slaPolicy' => $reset['slaPolicy'],
        ]);
    }

    /**
     * Retrieve the ticket state transition rules configuration.
     */
    public function getTransitionRules(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }

        $rules = \App\Services\TicketConfigurationService::getTransitionsConfig();

        return response()->json([
            'key' => 'transitions',
            'value' => $rules,
            'transitions' => $rules,
        ]);
    }

    /**
     * Update the ticket state transition rules configuration.
     */
    public function updateTransitionRules(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }
        $user = $request->user();

        $payload = $request->input('transitions', $request->input('value', $request->all()));
        if (!is_array($payload) || empty($payload)) {
            return response()->json(['message' => 'The transitions payload must be a non-empty array.'], 422);
        }

        try {
            $updated = \App\Services\TicketConfigurationService::updateTransitionsConfig($payload, $user);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        } catch (\Throwable $e) {
            return response()->json(['message' => 'Failed to persist transition rules to configuration service.'], 500);
        }

        $adminName = $user ? trim(($user->first_name ?? '') . ' ' . ($user->last_name ?? '')) : 'SuperAdmin';
        if (empty($adminName) && $user) {
            $adminName = $user->email ?? 'SuperAdmin';
        }

        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => 'config_update',
            'action_by_ID' => $user->emp_id ?? $user->id ?? 1,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'Ticket Lifecycle State Machine',
                'target' => 'Transition Rules',
                'text' => 'Updated permitted status transitions and state machine guardrails.',
                'super_admin' => $adminName,
                'timestamp' => now()->toIso8601String(),
            ]),
            'created_at' => now(),
        ]);

        return response()->json([
            'message' => 'Transition rules updated successfully.',
            'key' => 'transitions',
            'value' => $updated,
            'transitions' => $updated,
        ]);
    }

    /**
     * Reset ticket state transition rules configuration to system defaults.
     */
    public function resetTransitionRules(Request $request)
    {
        if ($err = $this->checkSuperAdmin($request)) {
            return $err;
        }
        $user = $request->user();

        try {
            $reset = \App\Services\TicketConfigurationService::resetTransitionsConfig($user);
        } catch (\Throwable $e) {
            return response()->json(['message' => 'Failed to reset transition rules.'], 500);
        }

        $adminName = $user ? trim(($user->first_name ?? '') . ' ' . ($user->last_name ?? '')) : 'SuperAdmin';
        if (empty($adminName) && $user) {
            $adminName = $user->email ?? 'SuperAdmin';
        }

        DB::table('ticket_audit_logs')->insert([
            'ticket_ID' => null,
            'action_type' => 'config_reset',
            'action_by_ID' => $user->emp_id ?? $user->id ?? 1,
            'actor_type' => 'superadmin',
            'details' => json_encode([
                'module' => 'Ticket Lifecycle State Machine',
                'target' => 'Transition Rules',
                'text' => 'Reset transition rules to system defaults.',
                'super_admin' => $adminName,
                'timestamp' => now()->toIso8601String(),
            ]),
            'created_at' => now(),
        ]);

        return response()->json([
            'message' => 'Transition rules reset to defaults successfully.',
            'key' => 'transitions',
            'value' => $reset,
            'transitions' => $reset,
        ]);
    }
}
