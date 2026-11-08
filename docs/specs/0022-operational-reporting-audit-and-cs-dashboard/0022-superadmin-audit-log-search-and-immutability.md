# 0022. Child 2: Super Admin Audit Log Search and Immutability

**Date**: 2026-11-01

## Summary

This specification establishes a high performance search, filter, and pagination API for the Super Admin audit log viewer at `/ticketing/superadmin/audit-logs`. All routes are prefixed with `/api/ticketing/ticket/superadmin/audit-logs` to route correctly through the Nginx gateway. The system enforces strict immutability by completely disallowing individual log modifications and deletions, adds composite database indexes across search dimensions, provides dynamic dropdown filter metadata, and returns clean structured error responses.

## Requirements

**User stories**:
- As a Super Admin, I want to filter audit logs by date range, actor, action type, affected entity, branch, and free text keywords so that I can quickly investigate incidents.
- As a Super Admin, I want dynamic filter dropdowns populated with currently existing actions, entities, and branches so that I never have to guess valid filter values.
- As a Super Admin, I want audit log entries to remain permanently immutable so that regulatory integrity and security compliance are never compromised.
- As a Super Admin, I want queries to paginate smoothly without memory exhaustion or database timeouts.

**Acceptance criteria**:
- **AC-2.1**: The endpoint `GET /api/ticketing/ticket/superadmin/audit-logs` supports query parameters: `start_date`, `end_date`, `actor_id`, `actor_type`, `action_type`, `entity_type`, `ticket_id`, `branch_id`, `search` (free text), `page` (default 1), and `per_page` (default 25, max 100).
- **AC-2.2**: Free text search queries scan across `details`, actor full names (`employees.first_name`, `employees.last_name`, `clients.client_name`), and ticket identifiers. Keyword searches require a maximum date window of 90 days to prevent full table sequential scans.
- **AC-2.3**: Database migration creates composite indexes on `ticket_audit_logs`:
  - `idx_tal_created_at` on (`created_at`)
  - `idx_tal_action_type` on (`action_type`)
  - `idx_tal_actor` on (`action_by_ID`, `actor_type`)
  - `idx_tal_ticket` on (`ticket_ID`)
- **AC-2.4**: Immutability guarantee: no individual audit record update or delete routes exist. Existing bulk purge routes are deprecated and return HTTP 403 Forbidden.
- **AC-2.5**: Branch filtering logic: when `branch_id` is specified, the query matches tickets associated with that branch via left join on `tickets`. When `branch_id` is omitted or set to 'All', both ticket specific logs and system wide records (where `ticket_ID` is null) are included.
- **AC-2.6**: The endpoint `GET /api/ticketing/ticket/superadmin/audit-logs/filters` returns available filter values:
  - `action_types`: distinct action strings from database records (for example: `create`, `update`, `delete`, `reassign`, `sla_breach_alert`, `status_change`).
  - `modules`: registered system modules (Tickets, Knowledge Base, Configuration, SLA, Auth, Hardware).
  - `actor_roles`: distinct roles (Super Admin, Admin, Customer Service, Employee, Customer, System).
  - `branches`: list of active branches with `id` and `name`.
- **AC-2.7**: Filter metadata endpoint caches responses in Redis with a 300 second time to live, supporting force refresh parameter.
- **AC-2.8**: Query responses return standard pagination metadata (`current_page`, `last_page`, `per_page`, `total`, `from`, `to`).
- **AC-2.9**: If an invalid query parameter is provided (for example malformed dates or invalid page bounds), the endpoint returns HTTP 422 with structured field error messages.

## Feature design

### Database Index Migration

Migration: `2026_11_02_000002_add_performance_indexes_to_ticket_audit_logs.php`
```php
Schema::table('ticket_audit_logs', function (Blueprint $table) {
    $table->index('created_at', 'idx_tal_created_at');
    $table->index('action_type', 'idx_tal_action_type');
    $table->index(['action_by_ID', 'actor_type'], 'idx_tal_actor');
    $table->index('ticket_ID', 'idx_tal_ticket');
});
```

### API Surface

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/ticketing/ticket/superadmin/audit-logs | GET | page (int), per_page (int), start_date (date), end_date (date), actor_id (int), action_type (string), branch_id (int), search (string) | data: array, pagination: object | bearer superadmin | 401, 403, 422, 500 |
| /api/ticketing/ticket/superadmin/audit-logs/filters | GET | force_refresh (bool) | action_types: array, modules: array, actor_roles: array, branches: array | bearer superadmin | 401, 403, 500 |

### Value Sourcing

| Action | Value produced / displayed | Source |
|---|---|---|
| Filter options | Distinct actions, modules, roles, branches | Cached database query on `ticket_audit_logs`, `branches`, and system module registry |
| Actor name resolution | Actor label and role | Left joins on `employees` (first name and last name) and `clients` (client name) |
| Pagination envelope | Total matching count and page boundaries | SQL query builder `paginate($perPage)` |
| Search matching | Highlighted matching logs | SQL `LIKE` clauses on `tal.details`, employee names, and ticket numbers bounded by date range |

### Key Invariants

1. Absolute Immutability: No route, controller action, or repository method may issue `UPDATE` or `DELETE` statements against `ticket_audit_logs`. The table operates as an append only event ledger.
2. Super Admin Authorization: Only users with authenticated role `superadmin` or `system_admin` may execute these endpoints. Other roles receive HTTP 403 Forbidden.
3. Pagination Cap: Maximum allowed `per_page` value is 100 to protect server memory.
4. Gateway Alignment: Routes use the `/ticket/` path segment to ensure FastCGI routing under Nginx gateway configuration.

## Build plan

1. Create migration `2026_11_02_000002_add_performance_indexes_to_ticket_audit_logs.php`.
2. Implement `AuditLogFilterService.php` in `services/ticket-service/app/Services/`:
   - Method `getFilteredLogs(array $criteria, int $perPage, int $page)`.
   - Method `getFilterOptions(bool $forceRefresh = false)`.
3. Update `SuperAdminConfigController.php`:
   - Refactor `getSuperAdminAuditLogs(Request $request)` to call `AuditLogFilterService`.
   - Add `getAuditLogFilters(Request $request)` action.
   - Disable or remove individual and bulk delete actions.
4. Register routes in `services/ticket-service/routes/api.php` under Super Admin middleware group with `/ticket/superadmin/` prefix.
5. Update `frontend/web/src/pages/SuperAdminAuditLogs.jsx`:
   - Fetch dynamic filter options from `/api/ticketing/ticket/superadmin/audit-logs/filters`.
   - Connect table search, date picker, and dropdown filters to backend query parameters.
   - Remove any client side purge triggers.
6. Write feature tests in `services/ticket-service/tests/Feature/SuperAdminAuditLogFilteringTest.php`.

## Inline Rationale

Prior code loaded all audit rows into PHP memory and performed filtering in memory or in React state. That approach breaks once log volume grows beyond a few thousand rows. By moving date filtering, keyword matching, and pagination into indexed database queries, response times remain under 150 milliseconds regardless of total log volume. Disabling all delete and update operations guarantees audit integrity required for enterprise regulatory audits.
