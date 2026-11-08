<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * Decides whether a caller is a participant of a ticket (spec 0037).
 *
 * Mirrors the thread access rule in messaging-service MessageController so that
 * "who may read the chat" and "who may open the files" stay the same:
 * - a customer owns the ticket and it is not internal;
 * - an employee is the requester, the assignee, or a delegated (assignment row) employee;
 * - CS staff and admins (superadmin, admin, IT admin) always;
 * - a manager when the ticket's department matches the manager's department.
 *
 * Messaging policy switches (for example disabling delegated chat) are chat policy,
 * not ticket membership, so they do not apply here.
 */
class TicketAccessService
{
    public function __construct(private SLAService $slaService)
    {
    }

    /**
     * @param mixed $user  Authenticated principal (App\Models\Client or an employee principal).
     * @param object|int $ticket  A tickets row or a ticket id.
     */
    public function canView($user, $ticket): bool
    {
        if (!$user) {
            return false;
        }

        if (is_numeric($ticket)) {
            $ticket = DB::table('tickets')->where('ticket_ID', (int) $ticket)->first();
        }
        if (!$ticket) {
            return false;
        }

        if ($user instanceof \App\Models\Client) {
            return empty($ticket->is_internal)
                && !empty($ticket->created_by)
                && (int) $ticket->created_by === (int) $user->id;
        }

        $empId = (int) ($user->emp_id ?? $user->id ?? 0);
        if ($empId <= 0) {
            return false;
        }

        if ($this->isCsOrAdmin($user)) {
            return true;
        }

        if ((int) ($ticket->requested_by ?? 0) === $empId || (int) ($ticket->assigned_to ?? 0) === $empId) {
            return true;
        }

        $delegated = DB::table('ticket_assignments')
            ->where('ticket_ID', (int) $ticket->ticket_ID)
            ->where('employee_ID', $empId)
            ->exists();
        if ($delegated) {
            return true;
        }

        return $this->isManagerOfTicketDepartment($user, $ticket);
    }

    /**
     * Identity payload for the caller: ['user_id' => int, 'user_type' => 'customer'|'employee'].
     */
    public function identityOf($user): array
    {
        if ($user instanceof \App\Models\Client) {
            return ['user_id' => (int) $user->id, 'user_type' => 'customer'];
        }

        return ['user_id' => (int) ($user->emp_id ?? $user->id ?? 0), 'user_type' => 'employee'];
    }

    protected function isCsOrAdmin($user): bool
    {
        $dept = strtolower((string) ($user->department ?? ''));
        $role = strtolower((string) ($user->role ?? ''));
        $isCS = str_contains($dept, 'customer service') || str_contains($dept, 'support') || $dept === 'cs' || str_contains($role, 'cs');
        $cleanRole = str_replace([' ', '_', '-'], '', $role);
        $isAdmin = in_array($cleanRole, ['superadmin', 'admin', 'itadmin'], true);

        return $isCS || $isAdmin;
    }

    protected function isManagerOfTicketDepartment($user, object $ticket): bool
    {
        $role = strtolower((string) ($user->role ?? ''));
        if (!str_contains($role, 'manager')) {
            return false;
        }

        $managerDept = strtolower(trim((string) ($user->department ?? '')));
        if ($managerDept === '') {
            return false;
        }

        $deptId = $this->slaService->resolveDepartmentForTicket($ticket);
        $ticketDept = strtolower(trim((string) DB::table('departments')->where('id', $deptId)->value('name')));

        return $ticketDept !== '' && $ticketDept === $managerDept;
    }
}
