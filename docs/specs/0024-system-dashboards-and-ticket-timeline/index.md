# 0024. System Wide Dashboards, Employee Workload Hub, and Ticket Audit Timeline

**Date**: 2026-11-01
**Status**: Accepted

## Summary

This specification establishes three backend monitoring and auditing capabilities in ticket service: a Super Admin system wide dashboard with sortable branch comparisons and live operational metrics, an Employee dual role dashboard separating assigned technician workloads from submitted internal requests, and an immutable ticket audit timeline engine capturing all state transitions chronologically. All three endpoints route through the Nginx gateway under the ticket service prefix and reuse existing calculation services. Together, they give leadership complete visibility across all facilities, give employees a single screen to track tasks and requests, and guarantee transparent, unalterable accountability for every ticket event.

## Structure

This umbrella specification coordinates three child specifications:

1. [0024-superadmin-system-dashboard-and-branch-comparison.md](0024-superadmin-system-dashboard-and-branch-comparison.md): Super Admin system wide dashboard aggregating role counts, operational totals, SLA breaches, fixed current day creations, sortable branch comparisons, and a recent activity stream with Redis caching.
2. [0024-employee-dual-role-personal-dashboard.md](0024-employee-dual-role-personal-dashboard.md): Personal employee dashboard presenting assigned technician workloads with SLA risk buckets alongside submitted requests with auto close pending countdowns and graceful partial failure tolerance.
3. [0024-ticket-audit-timeline-engine.md](0024-ticket-audit-timeline-engine.md): Unified ticket audit logging engine capturing state transitions, assignments, reassignments, holds, internal notes, and attachments chronologically, with customer role redaction and permanent immutability.

## Requirements

**User stories**:
- As a Super Admin, I want a system wide dashboard displaying total users, total tickets, active and escalated tickets, SLA breaches, tickets created today, recent activity, branch comparisons, and system KPIs, so that I can monitor the entire organization support ecosystem.
- As an Employee, I want a personal dashboard that presents my assigned ticket workload when I act as an Assigned Employee, and the status of tickets I have submitted when acting as a Requestor, so that I can track both my work tasks and my internal requests in one place.
- As a Customer Service agent, I want every action taken on a ticket to be logged and viewable as a chronological timeline, so that I can trace exactly what happened and when.

**Acceptance criteria**:
- **AC-1**: The endpoint `GET /api/ticketing/ticket/superadmin/system-dashboard` returns aggregated counts for total users by role, total tickets, active tickets, escalated tickets, SLA breaches, tickets created today, recent activity feed, branch comparisons, and system wide KPIs.
- **AC-2**: Date range filters (`date_from`, `date_to`, `preset`) apply to ticket volume, SLA compliance, resolution times, and branch comparisons, while the metric `tickets_created_today` remains strictly anchored to the current calendar date regardless of active filters.
- **AC-3**: Branch comparison metrics calculate ticket totals, active tickets, escalated tickets, SLA compliance rate, average resolution hours, and average CSAT rating per physical branch, sortable by any metric in ascending or descending order.
- **AC-4**: Super Admin system wide dashboard requests require authenticated role `superadmin` or `system_admin`, returning HTTP 403 Forbidden for any other authenticated role.
- **AC-5**: Super Admin dashboard data is cached in Redis with a 60 second time to live, keyed by date range parameters, and supports immediate cache bypass when `force_refresh=true` is supplied.
- **AC-6**: The endpoint `GET /api/ticketing/ticket/employee/dashboard` returns two distinct workload sections: `assigned` (tickets where the requesting employee is assigned technician with status breakdown and SLA risk classification) and `requested` (tickets submitted by the employee with auto close pending flags and reopened indicators).
- **AC-7**: Server side scoping restricts employee dashboard queries so the `assigned` section only includes tickets where `assigned_to` equals the requesting employee identifier, and the `requested` section only includes tickets submitted by the user.
- **AC-8**: If one section of the employee dashboard encounters a query exception, the endpoint returns HTTP 200 with valid data for the healthy section and populates the `partial_errors` array with section failure details instead of returning a generic HTTP 500 error.
- **AC-9**: Every state changing ticket mutation (creation, status update, priority change, department reassignment, technician delegation, hold and resume, remarks, attachments, customer feedback, auto close, reopen, and SLA breach) writes an immutable structured record into `ticket_audit_logs`.
- **AC-10**: The endpoint `GET /api/ticketing/ticket/{id}/timeline` delivers a chronological event stream supporting page based pagination, filtering by `event_type`, and date bounding.
- **AC-11**: When a customer retrieves a ticket timeline, all timeline records marked with `is_internal = true` (internal technician remarks, private delegation reasons, internal reassignment notes) are stripped from the response.
- **AC-12**: Timeline entries are permanently immutable: no `UPDATE` or `DELETE` API endpoints exist, and direct database modification of historical records is blocked.
- **AC-13**: Timeline entries remain accessible across all ticket statuses, including archived, closed, and reopened states.

## Decision

**Chosen option**: Build a unified operations and timeline suite in `ticket-service` reusing `TicketDashboardService`, `SLAService`, and `TicketService`, backed by extended schema columns on `ticket_audit_logs`, composite performance indexes, and non blocking Redis caching.

**Implementation skills**: `laravel-microservice` (`services/ticket-service/`), `react-frontend` (`frontend/web/`), `api-testing` (`.agents/skills/api-testing/`), `docker-runbook` (`.agents/skills/docker-runbook/`).

## Shared Architecture and Contracts

### Gateway Routing Alignment

Under `nginx.conf` and `nginx.prod.conf`, FastCGI requests for ticketing microservices route through the pattern `^/api/ticketing/ticket(.*)$`. All endpoints in this specification strictly follow this gateway prefix:
- Super Admin Dashboard: `/api/ticketing/ticket/superadmin/system-dashboard`
- Employee Hub: `/api/ticketing/ticket/employee/dashboard`
- Ticket Timeline: `/api/ticketing/ticket/{id}/timeline`

### Service Ownership and Data Flow

Ticket service owns ticket state, assignments, SLA records, and timeline audit logs:
- For total user counts by role, `ticket-service` queries its local user replica table or issues an internal HTTP call to `customer-service` and `employee-service` with a 60 second Redis cache fallback.
- For CSAT scores in branch comparisons, `ticket-service` consumes ratings stored during ticket feedback submissions or queries `analytics-service` with a 2 second timeout and neutral fallback.
- For SLA risk and breach calculations, both the Super Admin dashboard and Employee dashboard invoke `SLAService` methods to prevent calculation divergence.

## Feature design

### Data model sketch

Existing table `ticket_audit_logs` is expanded with new columns:
- `log_ID`: big integer primary key, auto increment.
- `ticket_ID`: unsigned big integer, foreign key to `tickets.ticket_ID`, cascade on delete.
- `action_type`: string (for example `status_change`, `assignment`, `reassignment`, `hold`, `resume`, `internal_note`, `attachment`, `feedback`, `sla_breach`, `reopen`).
- `event_type`: string, normalized event identifier for UI badge rendering.
- `action_by_ID`: unsigned big integer, identifier of the actor.
- `actor_type`: string (`employee`, `customer`, `system`, `superadmin`, `admin`, `cs`).
- `actor_role`: string nullable, role held by the actor at the exact moment of execution.
- `before_state`: json nullable, structured snapshot of relevant properties prior to mutation.
- `after_state`: json nullable, structured snapshot of relevant properties after mutation.
- `details`: text nullable, human readable summary or message text.
- `is_system`: boolean, default `false`, set to `true` for automated worker and timer actions.
- `is_internal`: boolean, default `false`, set to `true` for staff notes and private remarks.
- `created_at`: date time, timestamp of event occurrence.

Indexes to add:
- `idx_tal_ticket_timeline`: composite index on `(ticket_ID, is_internal, created_at)`.
- `idx_tal_ticket_event`: composite index on `(ticket_ID, action_type, created_at)`.
- `idx_tickets_assigned_status`: composite index on `tickets (assigned_to, ticket_status_ID)`.
- `idx_tickets_created_by_status`: composite index on `tickets (created_by, ticket_status_ID)`.

### API surface

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/ticketing/ticket/superadmin/system-dashboard` | GET | `preset` (opt), `date_from` (opt), `date_to` (opt), `sort_by` (opt), `sort_dir` (opt), `activity_limit` (opt), `force_refresh` (opt) | `summary`, `kpis`, `branch_comparisons`, `recent_activity`, `meta` | Bearer Super Admin | 401 Unauthorized, 403 Forbidden |
| `/api/ticketing/ticket/employee/dashboard` | GET | `force_refresh` (opt) | `assigned`, `requested`, `partial_errors` | Bearer Employee | 401 Unauthorized, 403 Forbidden |
| `/api/ticketing/ticket/{id}/timeline` | GET | `id` in path (req), `page` (opt), `per_page` (opt), `event_type` (opt), `date_from` (opt), `date_to` (opt) | `data` array, `pagination` object | Bearer Any Valid Role | 401 Unauthorized, 403 Forbidden, 404 Not Found |

### Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| Load Super Admin Dashboard | Total users by role | Cached aggregate from local user replica and microservice directory |
| Load Super Admin Dashboard | Tickets created today | Real time count from `tickets` table where `created_at >= CURDATE()`, ignoring date filters |
| Load Super Admin Dashboard | Branch comparison metrics | Group by query on `tickets.branch_id` combined with `SLAService` compliance formulas |
| Load Super Admin Dashboard | Recent activity stream | Chronological query on `ticket_audit_logs` joined with `tickets` and actor names |
| Load Employee Dashboard | Assigned ticket status breakdown | Count query on `tickets` filtered by `assigned_to = employee_id` grouped by status |
| Load Employee Dashboard | Assigned SLA risk breakdown | `SLAService::classifyTicketRisk` applied to active tickets assigned to the employee |
| Load Employee Dashboard | Requested ticket status and auto close | Count query on `tickets` filtered by `created_by = user_id`, inspecting auto close timestamps |
| Load Ticket Timeline | Chronological event list | Ordered query on `ticket_audit_logs` filtered by `ticket_ID`, filtering `is_internal` by caller role |

### Key invariants

1. Absolute Immutability: The table `ticket_audit_logs` operates strictly as an append only ledger. No controller or service method may execute `UPDATE` or `DELETE` statements on this table.
2. Server Side Role Enforcement: Super Admin system wide metrics reject non superadmin callers with HTTP 403 Forbidden. Employee dashboards only read records tied to the authenticated caller.
3. Customer Boundary Protection: Timeline queries initiated by customer tokens automatically append `WHERE is_internal = 0` to prevent leaking private technician discussions.
4. Anchored Today Metric: The metric `tickets_created_today` never shifts when custom date range filters are applied; it always reflects the current calendar date in the local facility timezone.
5. Non Blocking Redis Invalidation: Ticket cache invalidation uses Redis `SCAN` chunking; blocking `KEYS *` commands are strictly forbidden.

### Critical test scenarios

- Happy path: Super Admin fetches system wide dashboard and receives complete organization totals, sortable branch comparisons, and recent activity, verifying AC-1, AC-2, AC-3.
- Failure case: Employee dashboard encounters database timeout while calculating SLA risk for assigned tickets, but still returns valid requested ticket counts with a structured error in `partial_errors`, verifying AC-8.
- Customer privacy verification: Customer retrieves ticket timeline and verifies internal technician notes and delegation remarks are completely excluded from response array, verifying AC-11.
- Authorization boundary: Standard branch Admin attempts to call Super Admin system dashboard and receives HTTP 403 Forbidden, verifying AC-4.
- Immutability verification: Verifying absence of update and delete routes and testing that database audit log records cannot be altered via API, verifying AC-12.

## Build plan

The build plan follows an end to end tracer bullet approach, establishing database schemas, service logic, controller endpoints, and verification tests for each capability:

1. Create database migration `2026_11_02_000003_expand_ticket_audit_logs_and_add_dashboard_indexes.php` adding `event_type`, `before_state`, `after_state`, `actor_role`, `is_system`, `is_internal` to `ticket_audit_logs` and adding composite indexes on `tickets` and `ticket_audit_logs` (satisfies AC-9, AC-12).
2. Create `AuditTimelineService.php` in `services/ticket-service/app/Services/` providing structured methods `logEvent()`, `getTicketTimeline()`, and customer role scoping (satisfies AC-9, AC-10, AC-11, AC-12, AC-13).
3. Update `TicketService.php` and ticket event flows to call `AuditTimelineService::logEvent()` on all state changes (satisfies AC-9).
4. Create `SuperAdminDashboardService.php` in `services/ticket-service/app/Services/` implementing organization user counts, fixed current day metrics, sortable branch comparisons, recent activity feeds, and 60 second Redis caching (satisfies AC-1, AC-2, AC-3, AC-5).
5. Create `EmployeeDashboardService.php` in `services/ticket-service/app/Services/` implementing dual capacity query aggregations, SLA risk classification, and graceful partial failure isolation (satisfies AC-6, AC-7, AC-8).
6. Register controllers and routes in `services/ticket-service/routes/api.php` under the `/api/ticketing/ticket/` gateway prefix with middleware protection (satisfies AC-1, AC-4, AC-6, AC-10).
7. Author automated integration tests in `services/ticket-service/tests/Feature/` covering Super Admin dashboard scoping, Employee dual capacity resilience, and Customer timeline privacy filters (satisfies AC-1 through AC-13).

## Consequences

- Super Admins gain unified organizational oversight without manual compilation across individual branches.
- Employees can manage their assigned support queue and monitor their internal submitted tickets in a single personal workspace.
- Complete operational accountability is preserved through an append only audit timeline that protects internal technician privacy.
- Query performance at scale is secured through composite database indexes and Redis caching.

## Follow up

- Update frontend web components in `frontend/web/` to consume the new system dashboard, employee personal hub, and timeline views.
- Coordinate with `notification-service` to broadcast real time timeline append events over WebSockets.

## Rationale

Reasoning and options: see rationale.md.
