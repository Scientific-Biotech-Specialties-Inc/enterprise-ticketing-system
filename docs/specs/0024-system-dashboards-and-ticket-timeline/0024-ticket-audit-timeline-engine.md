# 0024. Child 3: Ticket Chronological Audit Timeline Engine and Action Logging

**Date**: 2026-11-01

## Summary

This specification establishes an immutable chronological audit timeline engine for support tickets. Every state changing action across the system (status modifications, category and priority changes, technician assignments and delegations, reassignment requests, hold and resume events, internal notes, attachments, customer feedback, auto close triggers, reopens, and SLA breaches) writes an immediate, structured audit log entry to `ticket_audit_logs`. The engine exposes `GET /api/ticketing/ticket/{id}/timeline`, featuring page based pagination, event type filtering, before and after state snapshots, and automatic redaction of internal staff entries for customer users. The audit ledger is permanently append only, with zero update or delete endpoints.

## Requirements

**User stories**:
- As a Customer Service agent, I want every action taken on a ticket to be logged and viewable as a chronological timeline, so that I can trace exactly what happened and when.
- As a Manager or Auditor, I want to see the actor, their role at that moment, before and after values, and whether the action was automated by the system, so that accountability is indisputable.
- As a Customer, I want to view the chronological progression of my ticket while internal technician notes remain completely hidden from my view, so that staff privacy and internal deliberations are protected.
- As a Technician, I want the full timeline preserved across status changes and reopens, so that historical context is never lost.

**Acceptance criteria**:
- **AC-3.1**: Every state mutating ticket operation writes an immediate structured entry to `ticket_audit_logs` capturing `ticket_ID`, `action_type`, `event_type`, `action_by_ID`, `actor_type`, `actor_role`, `before_state`, `after_state`, `details`, `is_system`, `is_internal`, and `created_at`.
- **AC-3.2**: Event entries are created at the point of action execution within database transactions, rather than being reconstructed after the fact from disparate tables.
- **AC-3.3**: The endpoint `GET /api/ticketing/ticket/{id}/timeline` returns chronological timeline records sorted from newest to oldest (or oldest to newest via query parameter `order=asc|desc`, defaulting to `desc`), with pagination (`page`, `per_page` default 30, max 100).
- **AC-3.4**: The timeline endpoint supports optional query parameters `event_type`, `date_from`, and `date_to` to filter specific event types (such as `assignment`, `status_change`, `internal_note`, `attachment`).
- **AC-3.5**: Server side customer scoping: when an authenticated customer requests a ticket timeline, the query enforces ticket ownership and automatically adds `WHERE is_internal = 0`, ensuring private technician remarks and internal reassignment notes never reach the client.
- **AC-3.6**: Staff roles (Employee, CS, Admin, Super Admin) with appropriate branch access can see all timeline records, with an explicit `is_internal: true` badge on private entries.
- **AC-3.7**: Permanent immutability: no `UPDATE` or `DELETE` API endpoints exist for audit logs or timeline records. Controller code and database privileges strictly prohibit altering existing records.
- **AC-3.8**: Timeline records remain accessible regardless of ticket status (draft, open, in progress, resolved, closed, archived, or reopened).
- **AC-3.9**: High performance is maintained via composite index `idx_tal_ticket_timeline` on `(ticket_ID, is_internal, created_at)` and `idx_tal_ticket_event` on `(ticket_ID, action_type, created_at)`.
- **AC-3.10**: If an invalid ticket identifier or non existent ticket is requested, the endpoint returns HTTP 404 with a structured error payload.

## Decision

**Chosen option**: Centralize audit event creation in `AuditTimelineService.php` in `ticket-service`, extending `ticket_audit_logs` with state snapshots and privacy flags, and exposing `GET /api/ticketing/ticket/{id}/timeline`.

**Implementation skills**: `laravel-microservice` (`services/ticket-service/`), `react-frontend` (`frontend/web/`), `api-testing` (`.agents/skills/api-testing/`).

## Feature design

### Schema extension and indexes

Migration `2026_11_02_000003_expand_ticket_audit_logs_and_add_dashboard_indexes.php`:
```php
Schema::table('ticket_audit_logs', function (Blueprint $table) {
    if (!Schema::hasColumn('ticket_audit_logs', 'event_type')) {
        $table->string('event_type')->nullable()->after('action_type');
    }
    if (!Schema::hasColumn('ticket_audit_logs', 'actor_role')) {
        $table->string('actor_role')->nullable()->after('actor_type');
    }
    if (!Schema::hasColumn('ticket_audit_logs', 'before_state')) {
        $table->json('before_state')->nullable()->after('actor_role');
    }
    if (!Schema::hasColumn('ticket_audit_logs', 'after_state')) {
        $table->json('after_state')->nullable()->after('before_state');
    }
    if (!Schema::hasColumn('ticket_audit_logs', 'is_system')) {
        $table->boolean('is_system')->default(false)->after('details');
    }
    if (!Schema::hasColumn('ticket_audit_logs', 'is_internal')) {
        $table->boolean('is_internal')->default(false)->after('is_system');
    }

    $table->index(['ticket_ID', 'is_internal', 'created_at'], 'idx_tal_ticket_timeline');
    $table->index(['ticket_ID', 'action_type', 'created_at'], 'idx_tal_ticket_event');
});
```

### API surface

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/ticketing/ticket/{id}/timeline` | GET | `id` in path (req), `page` (opt), `per_page` (opt), `event_type` (opt), `order` (opt: `asc`, `desc`), `date_from` (opt), `date_to` (opt) | `data`: array of timeline events, `pagination`: object | Bearer Valid User | 401 Unauthorized, 403 Forbidden, 404 Not Found, 422 Invalid |

### Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| Record state change | `before_state` and `after_state` | Serialized model attributes before and after transaction execution |
| Record event actor | `actor_role` | Authenticated user active role at execution time (`superadmin`, `cs`, `employee`, `customer`, `system`) |
| Record system automation | `is_system: true` | Explicit parameter passed by scheduled console commands (auto close worker, SLA monitor) |
| Redact internal records | Filtered timeline data | SQL condition `is_internal = false` injected when caller token role is `customer` |
| Actor display names | `actor_name` | Resolved from `employees` (first name, last name) or `clients` (client name) via left join |

### Key invariants

1. Immediate Point of Mutation: Audit events must be inserted in the exact database transaction where the ticket mutation succeeds. If the transaction rolls back, the audit record rolls back.
2. Immutability Ledger: `ticket_audit_logs` has no update or delete routes. The application repository provides no mutation interface.
3. Strict Customer Redaction: Customers can never see records where `is_internal = 1`. This rule is enforced at the repository query builder level, not client side.
4. Historical Integrity: Reopening or reassigning a ticket never deletes or mutates previous timeline entries.

## Build plan

1. Run migration `2026_11_02_000003_expand_ticket_audit_logs_and_add_dashboard_indexes.php`.
2. Implement `AuditTimelineService.php` in `services/ticket-service/app/Services/` with methods:
   - `recordEvent(int $ticketId, string $actionType, string $eventType, ?int $actorId, string $actorType, ?string $actorRole, ?array $before, ?array $after, ?string $details, bool $isSystem = false, bool $isInternal = false)`.
   - `getTicketTimeline(int $ticketId, array $filters, $user, int $perPage = 30)`.
3. Hook `AuditTimelineService::recordEvent()` into:
   - `TicketService::createTicket()`
   - `TicketService::updateStatus()`
   - `TicketService::assignTicket()`
   - `TicketService::reassignTicket()`
   - `TicketService::holdTicket()` and `resumeTicket()`
   - `TicketService::addInternalNote()`
   - `TicketService::addAttachment()`
   - `TicketService::recordFeedback()`
   - Auto close console commands and SLA breach listeners.
4. Add controller method in `TicketController.php` or dedicated `TicketTimelineController.php`.
5. Register route `GET /api/ticketing/ticket/{id}/timeline` in `routes/api.php`.
6. Add feature tests in `services/ticket-service/tests/Feature/TicketTimelineTest.php` testing:
   - Recording events on status change, assignment, and internal notes.
   - Customer token redaction of `is_internal = true` records.
   - Immutability check ensuring no delete or update paths exist.
   - Ordering and pagination across ticket statuses.

