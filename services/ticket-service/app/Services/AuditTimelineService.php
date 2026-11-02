<?php

namespace App\Services;

use App\Models\Client;
use App\Models\Employee;
use App\Models\TicketAuditLog;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

class AuditTimelineService
{
    /**
     * Record an immutable audit log entry for a ticket state change or action.
     */
    public function recordEvent(
        int $ticketId,
        string $actionType,
        string $eventType,
        ?int $actorId,
        string $actorType,
        ?string $actorRole = null,
        ?array $before = null,
        ?array $after = null,
        ?string $details = null,
        bool $isSystem = false,
        bool $isInternal = false
    ): int {
        $actorIdValue = $actorId !== null ? (int) $actorId : 0;

        // If actorRole is not provided, infer role from actor model if possible
        if (empty($actorRole)) {
            if ($isSystem) {
                $actorRole = 'system';
            } elseif ($actorType === 'customer') {
                $actorRole = 'customer';
            } elseif (in_array($actorType, ['employee', 'superadmin', 'admin', 'cs'], true)) {
                $actorRole = $actorType;
            }
        }

        $now = Carbon::now();

        $logId = DB::table('ticket_audit_logs')->insertGetId([
            'ticket_ID' => $ticketId,
            'action_type' => $actionType,
            'event_type' => $eventType,
            'action_by_ID' => $actorIdValue,
            'actor_type' => $actorType,
            'actor_role' => $actorRole ? strtolower(trim($actorRole)) : null,
            'before_state' => $before !== null ? json_encode($before) : null,
            'after_state' => $after !== null ? json_encode($after) : null,
            'details' => $details,
            'is_system' => $isSystem ? 1 : 0,
            'is_internal' => $isInternal ? 1 : 0,
            'created_at' => $now,
        ]);

        return (int) $logId;
    }

    /**
     * Retrieve the chronological event timeline for a ticket with role based privacy filters.
     *
     * @param int $ticketId
     * @param array $filters
     * @param mixed $user
     * @param int $perPage
     * @return array
     */
    public function getTicketTimeline(int $ticketId, array $filters, $user, int $perPage = 30): array
    {
        // 1. Verify ticket existence
        $ticket = DB::table('tickets')->where('ticket_ID', $ticketId)->first();
        if (!$ticket) {
            throw new NotFoundHttpException("Ticket with identifier {$ticketId} not found.");
        }

        // 2. Determine caller identity and role
        $isCustomer = false;
        $userRole = 'customer';

        if ($user instanceof Client) {
            $isCustomer = true;
            $userRole = 'customer';
        } elseif ($user instanceof Employee) {
            $userRole = strtolower(trim((string) ($user->role ?? '')));
            if ($userRole === 'customer') {
                $isCustomer = true;
            }
        } elseif (is_object($user)) {
            $userRole = strtolower(trim((string) ($user->role ?? '')));
            if (in_array($userRole, ['customer', 'client'], true)) {
                $isCustomer = true;
            }
        }

        // 3. Customer scoping: enforce ticket ownership & redact internal technician logs
        if ($isCustomer) {
            $clientUserId = (int) ($user->id ?? $user->client_id ?? 0);
            if ((int) $ticket->created_by !== $clientUserId) {
                throw new AccessDeniedHttpException('Access denied: You do not have permission to view this ticket timeline.');
            }
        }

        // 4. Construct query on ticket_audit_logs joined with actor name sources
        $query = DB::table('ticket_audit_logs as tal')
            ->leftJoin('employees as e', function ($join) {
                $join->on('e.emp_id', '=', 'tal.action_by_ID')
                    ->whereIn('tal.actor_type', ['employee', 'superadmin', 'admin', 'cs', 'systemadministrator', 'itadmin']);
            })
            ->leftJoin('clients as c', function ($join) {
                $join->on('c.id', '=', 'tal.action_by_ID')
                    ->where('tal.actor_type', '=', 'customer');
            })
            ->leftJoin('tickets as t', 't.ticket_ID', '=', 'tal.ticket_ID')
            ->select(
                'tal.log_ID as log_id',
                'tal.ticket_ID as ticket_id',
                't.ticket_number',
                'tal.action_type',
                'tal.event_type',
                'tal.action_by_ID as actor_id',
                'tal.actor_type',
                'tal.actor_role',
                'tal.before_state',
                'tal.after_state',
                'tal.details',
                'tal.is_system',
                'tal.is_internal',
                'tal.created_at',
                DB::raw("TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, ''))) as employee_name"),
                'c.client_name as customer_name'
            )
            ->where('tal.ticket_ID', $ticketId);

        // Strict privacy filter: redact internal staff entries for customer users (AC-11, AC-3.5)
        if ($isCustomer) {
            $query->where(function ($sub) {
                $sub->where('tal.is_internal', false)
                    ->orWhere('tal.is_internal', 0)
                    ->orWhereNull('tal.is_internal');
            });
        }

        // Optional filtering by event type or action type
        if (!empty($filters['event_type'])) {
            $requestedEventType = trim((string) $filters['event_type']);
            $query->where(function ($sub) use ($requestedEventType) {
                $sub->where('tal.event_type', $requestedEventType)
                    ->orWhere('tal.action_type', $requestedEventType);
            });
        }

        // Date range bounding
        if (!empty($filters['date_from'])) {
            $query->where('tal.created_at', '>=', Carbon::parse($filters['date_from'])->startOfDay());
        }
        if (!empty($filters['date_to'])) {
            $query->where('tal.created_at', '<=', Carbon::parse($filters['date_to'])->endOfDay());
        }

        // Ordering (default desc)
        $order = strtolower(trim((string) ($filters['order'] ?? 'desc')));
        $order = in_array($order, ['asc', 'desc'], true) ? $order : 'desc';
        $query->orderBy('tal.created_at', $order)->orderBy('tal.log_ID', $order);

        // Pagination
        $page = max(1, (int) ($filters['page'] ?? 1));
        $effectivePerPage = min(100, max(1, (int) ($filters['per_page'] ?? $perPage)));

        $total = $query->count();
        $records = $query->forPage($page, $effectivePerPage)->get();

        $formatted = $records->map(function ($row) use ($ticket) {
            $actorName = 'System';
            if ((bool) $row->is_system) {
                $actorName = 'System';
            } elseif ($row->actor_type === 'customer' && !empty($row->customer_name)) {
                $actorName = $row->customer_name;
            } elseif (!empty($row->employee_name)) {
                $actorName = $row->employee_name;
            } elseif ($row->actor_id > 0) {
                $actorName = 'User #' . $row->actor_id;
            }

            $beforeState = null;
            if (!empty($row->before_state)) {
                $beforeState = is_string($row->before_state) ? json_decode($row->before_state, true) : $row->before_state;
            }

            $afterState = null;
            if (!empty($row->after_state)) {
                $afterState = is_string($row->after_state) ? json_decode($row->after_state, true) : $row->after_state;
            }

            return [
                'log_id' => (int) $row->log_id,
                'ticket_id' => (int) $row->ticket_id,
                'ticket_number' => $row->ticket_number ?? ($ticket->ticket_number ?? null),
                'action_type' => $row->action_type,
                'event_type' => $row->event_type ?: $row->action_type,
                'actor' => [
                    'id' => (int) $row->actor_id,
                    'name' => $actorName,
                    'type' => $row->actor_type,
                    'role' => $row->actor_role ?: $row->actor_type,
                ],
                'before_state' => $beforeState,
                'after_state' => $afterState,
                'details' => $row->details,
                'is_system' => (bool) $row->is_system,
                'is_internal' => (bool) $row->is_internal,
                'created_at' => Carbon::parse($row->created_at)->toIso8601String(),
            ];
        });

        $lastPage = (int) ceil($total / max(1, $effectivePerPage));

        return [
            'status' => 'success',
            'data' => $formatted->values()->all(),
            'pagination' => [
                'current_page' => $page,
                'per_page' => $effectivePerPage,
                'total' => $total,
                'last_page' => $lastPage,
                'from' => $total > 0 ? (($page - 1) * $effectivePerPage) + 1 : null,
                'to' => $total > 0 ? min($total, $page * $effectivePerPage) : null,
            ],
        ];
    }
}

