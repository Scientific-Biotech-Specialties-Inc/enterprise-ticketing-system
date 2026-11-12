<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\ResolvesVerifiedPrincipal;
use App\Services\SLAService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class TicketReminderController extends Controller
{
    use ResolvesVerifiedPrincipal;

    protected SLAService $slaService;

    public function __construct(SLAService $slaService)
    {
        $this->slaService = $slaService;
    }

    /**
     * Send a manual reminder to the assigned employee for an unresolved ticket.
     * Restricted to Customer Service and Admin roles.
     * Enforces a 60-minute anti-spam cooldown per ticket.
     */
    public function sendReminder(Request $request, int $ticketId): JsonResponse
    {
        // 1. Authorize: CS, Admin, Super Admin. Spec 0034: sender id and role come only from
        // the verified user, never from headers or the request body.
        $principal = $this->verifiedPrincipal($request);
        if (!$principal) {
            return response()->json(['status' => 'error', 'message' => 'Unauthenticated.'], 401);
        }

        $userRole = strtolower(trim((string) ($principal['role'] ?? '')));
        $isCsOrAdmin = $principal['type'] === 'staff'
            && in_array(str_replace([' ', '_', '-'], '', $userRole), ['cs', 'customersupport', 'customerservice', 'admin', 'superadmin'], true);

        if (!$isCsOrAdmin) {
            return response()->json([
                'status' => 'error',
                'message' => 'Unauthorized. Only Customer Service and Administrators can send ticket reminders.',
            ], 403);
        }

        $empId = $principal['id'];

        // 2. Fetch ticket with status and assigned employee
        $ticket = DB::table('tickets as t')
            ->leftJoin('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
            ->leftJoin('clients as c', 'c.id', '=', 't.created_by')
            ->where('t.ticket_ID', $ticketId)
            ->select('t.*', 'ts.status_name', 'c.client_name')
            ->first();

        if (!$ticket) {
            return response()->json([
                'status' => 'error',
                'message' => 'Ticket not found.',
            ], 404);
        }

        // 3. Validate ticket status: must not be resolved or closed
        $statusName = strtolower(trim((string) ($ticket->status_name ?? '')));
        if (in_array($statusName, ['resolved', 'closed', 'discarded', 'cancelled'])) {
            return response()->json([
                'status' => 'error',
                'message' => "Cannot send reminders for tickets in '{$ticket->status_name}' status.",
            ], 422);
        }

        // 4. Resolve the employee to remind (spec 0038 AC-8 / AC-9).
        // With employee_id: it must be an active assignee of this ticket. Without it:
        // today's behaviour, the primary assignee (older callers keep working).
        $requestedEmpId = $request->input('employee_id');
        $assignment = null;
        if ($requestedEmpId !== null && $requestedEmpId !== '') {
            if (!is_numeric($requestedEmpId) || (int) $requestedEmpId <= 0) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'The employee_id must be a valid employee id.',
                ], 422);
            }
            $assignment = $this->activeAssignment($ticketId, (int) $requestedEmpId);
            if (!$assignment) {
                return response()->json([
                    'status' => 'error',
                    'message' => 'Cannot send reminder: that employee is not an active assignee of this ticket.',
                ], 422);
            }
            $assignedEmpId = (int) $requestedEmpId;
        } else {
            $assignedEmpId = (int) ($ticket->assigned_to ?? 0);
            if (!$assignedEmpId) {
                // Check active ticket_assignments as fallback
                $assignedEmpId = (int) DB::table('ticket_assignments')
                    ->where('ticket_ID', $ticketId)
                    ->whereNull('completed_at')
                    ->orderBy('assigned_at')
                    ->orderBy('assignment_ID')
                    ->value('employee_ID');
            }
            if ($assignedEmpId) {
                $assignment = $this->activeAssignment($ticketId, $assignedEmpId);
            }
        }

        if (!$assignedEmpId) {
            return response()->json([
                'status' => 'error',
                'message' => 'Cannot send reminder: No active employee is currently assigned to this ticket.',
            ], 422);
        }

        // 5. Anti-spam cooldown check: 60 minutes per assignee. The assignment row is
        // the gate; tickets.last_reminder_sent_at is only used when there is no row.
        $now = now();
        $hasAssignmentColumn = $assignment !== null && property_exists($assignment, 'last_reminder_sent_at');
        $lastSentRaw = $hasAssignmentColumn ? $assignment->last_reminder_sent_at : ($assignment === null ? $ticket->last_reminder_sent_at : null);
        if (!empty($lastSentRaw)) {
            $lastSent = Carbon::parse($lastSentRaw);
            $minutesSinceLast = $now->diffInMinutes($lastSent);
            if ($minutesSinceLast < 60) {
                $minutesRemaining = 60 - $minutesSinceLast;
                return response()->json([
                    'status' => 'error',
                    'message' => "A reminder was sent recently to this employee. Please wait {$minutesRemaining} more minute(s) before sending another.",
                    'cooldown_remaining_minutes' => $minutesRemaining,
                    'employee_id' => $assignedEmpId,
                    'last_reminder_sent_at' => $lastSent->toIso8601String(),
                ], 429);
            }
        }

        // 6. Build reminder payload
        $customMessage = trim((string) ($request->input('custom_message') ?? $request->input('message', '')));
        $slaMetrics = $this->slaService->computeTicketSlaMetrics($ticket);
        $slaStatus = $slaMetrics['status'] ?? 'On Track';
        $dueAt = $slaMetrics['due_at'] ?? $ticket->resolution_due_at;

        $ticketTitle = $ticket->title ?: 'Ticket #' . $ticketId;
        $customerName = $ticket->client_name ?: 'Customer';

        // 7. Insert in-app notification in MySQL notifications table
        $senderName = DB::table('employees')->where('emp_id', $empId)->select(DB::raw("CONCAT(first_name, ' ', last_name) as name"))->value('name') ?? 'Customer Service';

        $notificationTitle = "Urgent Reminder: Action required on Ticket #{$ticketId}";
        $notificationDesc = $customMessage !== ''
            ? "{$senderName}: \"{$customMessage}\" (SLA: {$slaStatus})"
            : "{$senderName} prompted an update on Ticket #{$ticketId} (SLA: {$slaStatus}).";

        $notificationData = json_encode([
            'type' => 'ticket_reminder',
            'ticket_id' => $ticketId,
            'sla_status' => $slaStatus,
            'due_at' => $dueAt,
            'custom_message' => $customMessage,
            'sender_id' => $empId,
            'sender_name' => $senderName,
            'link' => "/employee/history/{$ticketId}",
        ]);

        try {
            DB::table('notifications')->insert([
                'recipient_id'   => $assignedEmpId,
                'recipient_type' => 'employee',
                'title'          => $notificationTitle,
                'message'        => $notificationDesc,
                'ticket_id'      => $ticketId,
                'data'           => $notificationData,
                'is_read'        => false,
                'created_at'     => $now,
                'updated_at'     => $now,
            ]);
        } catch (\Throwable $e) {
            Log::warning("Failed to insert in-app reminder notification for employee {$assignedEmpId}: " . $e->getMessage());
        }

        // 8. Attempt email dispatch via configuration-service / notification-service
        try {
            $assignedEmp = DB::table('employees')->where('emp_id', $assignedEmpId)->first();
            if ($assignedEmp && !empty($assignedEmp->email)) {
                $configServiceUrl = env('CONFIGURATION_SERVICE_URL', 'http://configuration-service:8000');
                Http::timeout(5)->withHeaders(['X-Internal-Token' => (string) env('INTERNAL_TOKEN', '')])->post("{$configServiceUrl}/api/email/dispatch", [
                    'to' => $assignedEmp->email,
                    'subject' => "[Reminder] Action Pending: Ticket #{$ticketId} - {$ticketTitle}",
                    'html' => "<p>Hello {$assignedEmp->first_name},</p><p>Customer Service has sent a reminder regarding <strong>Ticket #{$ticketId}: {$ticketTitle}</strong>.</p><p><strong>Current SLA Status:</strong> {$slaStatus}</p>" . ($dueAt ? "<p><strong>Due Date:</strong> {$dueAt}</p>" : "") . ($customMessage !== '' ? "<p><strong>Message:</strong> \"{$customMessage}\"</p>" : "") . "<p><a href=\"" . env('APP_URL', 'http://localhost:5006') . "/employee/history/{$ticketId}\">Click here to view the ticket</a>.</p>",
                ]);
            }
        } catch (\Throwable $e) {
            Log::info("Email reminder dispatch bypassed or failed: " . $e->getMessage());
        }

        // 9. Record event in ticket_audit_logs
        try {
            DB::table('ticket_audit_logs')->insert([
                'ticket_ID' => $ticketId,
                'action_type' => 'reminder_sent',
                'action_by_ID' => $empId,
                'actor_type' => 'employee',
                'details' => json_encode([
                    'message' => $customMessage,
                    'recipient_id' => $assignedEmpId,
                    'recipient_name' => $assignedEmp->first_name ?? ('Employee #' . $assignedEmpId),
                    'sla_status' => $slaStatus,
                    'due_at' => $dueAt,
                ]),
                'created_at' => $now,
            ]);
        } catch (\Throwable $e) {
            Log::warning("Failed to record reminder_sent in ticket_audit_logs: " . $e->getMessage());
        }

        // 10. Update last_reminder_sent_at: per assignment (the cooldown gate), and the
        // ticket summary (latest reminder) that existing readers use.
        if ($hasAssignmentColumn) {
            DB::table('ticket_assignments')
                ->where('assignment_ID', $assignment->assignment_ID)
                ->update(['last_reminder_sent_at' => $now]);
        }
        DB::table('tickets')->where('ticket_ID', $ticketId)->update([
            'last_reminder_sent_at' => $now,
            'updated_at' => $now,
        ]);

        // Invalidate caches and broadcast update
        try {
            app(\App\Services\TicketCacheService::class)->clearTicketCaches();
        } catch (\Throwable $e) {
            Log::warning("Failed to clear ticket caches after reminder: " . $e->getMessage());
        }

        try {
            \App\Events\TicketChanged::dispatch([
                'action' => 'reminder_sent',
                'ticket_id' => $ticketId,
                'last_reminder_sent_at' => $now->toIso8601String(),
                'assigned_to' => $assignedEmpId,
            ]);
        } catch (\Throwable $e) {
            Log::info("Broadcast reminder_sent bypassed: " . $e->getMessage());
        }

        return response()->json([
            'status' => 'success',
            'message' => 'Reminder sent successfully to the assigned technician.',
            'data' => [
                'ticket_id' => $ticketId,
                'assigned_to' => $assignedEmpId,
                'employee_id' => $assignedEmpId,
                'last_reminder_sent_at' => $now->toIso8601String(),
                'sla_status' => $slaStatus,
            ],
        ]);
    }

    /**
     * The active assignment row for an employee on a ticket: not completed, and
     * status assigned or accepted (spec 0038 AC-9).
     */
    private function activeAssignment(int $ticketId, int $empId): ?object
    {
        return DB::table('ticket_assignments')
            ->where('ticket_ID', $ticketId)
            ->where('employee_ID', $empId)
            ->whereNull('completed_at')
            ->whereIn('assignment_status', ['assigned', 'accepted'])
            ->orderByDesc('assignment_ID')
            ->first();
    }
}
