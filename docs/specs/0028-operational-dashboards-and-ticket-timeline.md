# 0028. Operational Dashboards and Ticket Activity Timeline

**Date**: 2026-11-03
**Status**: Accepted

## Summary

This specification establishes four operational role dashboards and a unified ticket activity timeline engine across ticket service and the web interface. Branch administrators receive a branch scoped operational cockpit, super administrators gain a system wide performance overview with sortable facility comparisons, customer service agents get an urgent traffic triage desk, and staff members receive a personal dual panel workload hub. Every action taken on any ticket records into an immutable event stream displayed in chronological order on ticket detail views. All views operate in read only mode, enforce server side authorization boundaries, and degrade gracefully when individual data calculations fail.

## Context

The enterprise ticketing system serves several operational user roles across multiple physical branches. Currently, team members in different roles face visibility and operational coordination hurdles:

Branch administrators need a dedicated operational view restricted to their assigned facility. Without this, administrators cannot accurately track active ticket volumes, status breakdowns, staff assignments, or recurring issue categories without risking cross branch data exposure.

Super administrators need global oversight across all branches. They require consolidated counts of users by role, active escalations, system wide service level agreement compliance, and a sortable facility comparison table to evaluate organizational performance without manual spreadsheet assembly.

Customer service agents manage high velocity incoming queues and escalating workloads throughout the day. They require a focused workspace summarizing unassigned triage queues, active monitored tickets, service level agreement risk flags, and pending reassignment approvals in one glance.

Staff employees frequently fulfill two distinct functions: resolving tickets assigned to them as technicians, and submitting internal requests as requestors. A unified dashboard must clearly separate these two capacities into distinct panels so employees never confuse work assignments with their personal support requests.

Finally, resolving disputes, auditing compliance, and performing root cause analysis requires an immutable chronological timeline on every ticket detail view. The timeline must record what happened, who did it, whether the action was human or system initiated, and exact before and after values for all state mutations.

## Requirements

**User stories**:

* As an Admin, I want to access a Branch Dashboard scoped strictly to my assigned branch, displaying total tickets, resolved counts, average resolution duration, service level agreement compliance, customer feedback ratings, status distribution, recurring issue trends, and employee workloads across configurable date ranges, so that I can manage branch operations effectively.
* As a Super Admin, I want to access a System Dashboard aggregated across all branches without scoping restrictions, displaying role user counts, system ticket volume, active escalations, service level agreement breaches, tickets created today, recent activity, and sortable branch comparisons, so that I can oversee organization wide service health.
* As a Customer Service agent, I want to access a personal CS Dashboard summarizing queued tickets awaiting review, assigned and monitored tickets by status, service level agreement risk counts, and urgent attention items, so that I can prioritize urgent customer demands throughout the day.
* As an Employee, I want to access a My Dashboard interface with two visually separated sections for My Work and My Requests, showing status breakdowns, service level agreement risk flags, and confirmation alerts, so that I can manage my assigned tasks and track my submitted requests independently.
* As a Customer Service agent or staff member, I want an immutable chronological Activity Timeline on every ticket detail view showing state transitions, assignments, reassignments, holds, internal notes, attachments, customer feedback, and service level agreement breach events with before and after values, so that ticket history is completely transparent and accountable.

**Acceptance criteria**:

* **AC-1**: The Admin can access a Branch Dashboard showing data scoped exclusively to their assigned branch, rejecting client parameter tampering and returning HTTP 403 Forbidden for unauthorized cross branch attempts.
* **AC-2**: The Branch Dashboard displays Total Tickets for the selected period, Resolved Tickets count, Average Resolution Time (excluding On Hold duration), SLA Compliance rate (percentage within SLA versus breached), Average CSAT (from customer feedback ratings), Open versus Closed ticket breakdown, Recurring Issues (top repeated categories and machine complaint types), and Employee Workload (tickets assigned per employee).
* **AC-3**: Ticket Volume is displayed as a visual trend chart of tickets created and resolved over time, and Status Distribution is displayed visually across Open, In Progress, On Hold, Resolved, and Closed statuses.
* **AC-4**: The Admin can select a reporting period (Today, This Week, This Month, Custom Range), and all KPIs and charts recalculate to reflect the selected window.
* **AC-5**: Each KPI card displays its definition and calculation basis on hover or nearby copy so metric figures are unambiguous.
* **AC-6**: Employee Workload displays each active technician assigned ticket count within the branch, and Recurring Issues highlights categories or machines with high frequency ranked by count.
* **AC-7**: Branch Dashboard data reflects near real time figures refreshed on page load or manual refresh, renders within 2 to 5 seconds under normal load, and handles partial query failure gracefully by rendering error state cards for affected sections while healthy sections still render.
* **AC-8**: The Super Admin can access a System Dashboard showing data aggregated across all branches without branch level scoping restrictions.
* **AC-9**: The System Dashboard displays Total Users broken down by role (Customer, Employee, CS, Admin, Super Admin), Total Tickets system wide, Active and Escalated Tickets count, SLA Breaches count system wide, Tickets Created Today (anchored to the current calendar date), a Recent Activity feed with direct ticket links, and broader System KPIs reusing branch calculation formulas.
* **AC-10**: The Super Admin can select a reporting period (Today, This Week, This Month, Custom Range), updating all applicable KPIs and charts while Tickets Created Today remains anchored to the current day.
* **AC-11**: The System Dashboard includes a sortable Branch Comparison table allowing sorting by ticket volume, SLA compliance, resolution time, and average CSAT.
* **AC-12**: CS agents can access a My Dashboard view showing summary metrics scoped strictly to their own activity and branch triage queue, displaying Queued Tickets awaiting review, Assigned and Monitored tickets with status breakdowns, and urgent attention items (At Risk, Breached, pending reassignments).
* **AC-13**: The Employee can access My Dashboard featuring two visually and logically separated sections: My Work for Assigned Employee capacity, and My Requests for submitted internal tickets.
* **AC-14**: In the Employee My Work section, the dashboard displays assigned tickets by status (Open, In Progress, On Hold, Resolved) and highlights At Risk, Breached, or pending action items. In the My Requests section, it displays submitted tickets by status (Open, In Progress, Resolved, Closed, Auto Closing Soon) and highlights items awaiting confirmation or reopened tickets.
* **AC-15**: The Employee dashboard strictly restricts data to the authenticated employee own records and displays clear section error states during partial query failures.
* **AC-16**: Authorized roles can view an Activity Timeline section on any ticket detail view displaying significant actions in chronological order: creation, status transitions, priority and category edits, assignments, escalations, delegations, reassignment requests and approvals, hold and resume events, messages sent, internal notes, attachments, customer feedback, auto close, reopen, and SLA breach events.
* **AC-17**: Each timeline entry displays a plain language description, actor name and role, event timestamp, before and after values for modified properties, and a clear distinction between human and system initiated actions.
* **AC-18**: The Activity Timeline is strictly read only and immutable: no update or delete API endpoints exist, and historical records remain fully visible across open, resolved, closed, and reopened ticket lifecycles.
* **AC-19**: The Activity Timeline supports pagination or lazy loading to prevent degradation on tickets with extensive event histories, loading within standard performance targets.
* **AC-20**: All five dashboard and timeline interfaces operate in strict read only mode: no inline mutations of ticket or employee data occur directly within dashboard summary cards, and all user interfaces degrade gracefully to accessible mobile layouts.

## Options considered

### Option 1: Integrated Microservice Dashboards with Isolated Query Aggregators and Reusable Timeline Engine (Recommended)

Consolidate operational dashboard aggregation endpoints in ticket service, enforce server side branch scoping inside dedicated service classes (`TicketDashboardService`, `SuperAdminDashboardService`, `EmployeeDashboardService`, `AuditTimelineService`), apply Redis caching with short time to live values (60 seconds), and expose an immutable timeline reader.

**Pros**:
* Keeps data retrieval fast because ticket service directly owns tickets, assignments, statuses, and audit records.
* Isolates query execution into independent try catch blocks, enabling graceful partial degradation when one section encounters an issue.
* Uses existing Redis caching infrastructure to avoid database connection spikes during date filter changes.
* Connects directly to existing React frontend views (`AdminDashboard.jsx`, `SuperAdminDashboard.jsx`, `CSDashboard.jsx`, `EmployeeDashboard.jsx`, `TicketActivityTimeline.jsx`).

**Cons**:
* Requires maintaining distinct query aggregators for each role to prevent permission leakage.

### Option 2: Monolithic Controller with Universal Payload

Serve all four roles through a single overloaded endpoint that inspects user roles and returns a gigantic composite JSON payload containing branch, system, CS, and employee sections together.

**Pros**:
* Only one API route to register in the gateway.

**Cons**:
* Leaks system wide metrics or cross branch metadata to lower privilege roles if filtering fails.
* Incurs high database overhead by calculating metrics that the requesting user will never view.
* Slows down response times and increases memory consumption.

### Option 3: Pure Client Side Aggregation with Raw Ticket Dumps

Return full unpaginated arrays of raw ticket records to the browser and let React JavaScript calculate totals, averages, SLA compliance, and timeline ordering on the client side.

**Pros**:
* Minimal backend calculation logic.

**Cons**:
* Serious security vulnerability: transfers unauthorized ticket records across the network.
* Crashes browser memory on mobile devices and large branches.
* Violates server side branch scoping invariants.

## Decision

**Chosen option**: Option 1: Integrated Microservice Dashboards with Isolated Query Aggregators and Reusable Timeline Engine.

This approach preserves strict service boundaries, enforces server side authorization, keeps response times under two seconds via Redis caching, and isolates failures so one section error never crashes an entire operational screen.

**Implementation skills**: `laravel-microservice` (`.agents/skills/laravel-microservice/`) · `react-frontend` (`.agents/skills/react-frontend/`) · `api-testing` (`.agents/skills/api-testing/`)

## Rationale

Operational dashboards are high frequency read surfaces used throughout the workday. Option 1 is chosen because it pairs domain co location in ticket service with robust security and performance safeguards. 

By calculating metrics on the server side inside specialized service classes, sensitive branch isolation and role boundaries remain impenetrable. Using independent query wrappers ensures that if a secondary calculation such as customer feedback ratings experiences transient delays, the primary ticket counters and attention queues still render immediately with clear warning badges. 

Short 60 second Redis caching on dashboard payloads eliminates repetitive database table scans during rapid date filter toggles while maintaining fresh operational visibility. Finally, storing timeline events in an append only audit log table guarantees permanent legal accountability and compliance without risks of accidental deletion.

## Feature design

**Data model sketch**:

Part 1 primarily leverages existing core schema tables in ticket service, with composite indexes ensuring rapid query responses:

Table `tickets`:
* `ticket_ID`: bigIncrements, unsigned, primary key
* `ticket_custom_id`: string(32), indexed, unique
* `branch_id`: unsignedBigInteger, indexed, foreign key to `branches.id`
* `status_id`: unsignedBigInteger, indexed, foreign key to `ticket_statuses.id`
* `priority_id`: unsignedBigInteger, indexed
* `category_id`: unsignedBigInteger, indexed
* `department_id`: unsignedBigInteger, indexed
* `assigned_to`: unsignedBigInteger, nullable, indexed
* `created_by`: unsignedBigInteger, indexed
* `requested_by`: unsignedBigInteger, nullable, indexed
* `is_internal`: boolean, default false
* `escalation_level`: integer, default 0
* `sla_breached`: boolean, default false
* `on_hold_duration_minutes`: integer, default 0
* `created_at`: timestamp, indexed
* `resolved_at`: timestamp, nullable, indexed

Table `ticket_audit_logs`:
* `id`: bigIncrements, unsigned, primary key
* `ticket_id`: unsignedBigInteger, indexed, foreign key to `tickets.ticket_ID`
* `actor_id`: unsignedBigInteger, indexed
* `actor_role`: string(50), indexed
* `actor_name`: string(100)
* `event_type`: string(50), indexed (e.g. status_change, priority_change, assignment, reassignment, hold, resume, note, feedback, auto_close, reopen, sla_breach)
* `old_value`: text, nullable
* `new_value`: text, nullable
* `remarks`: text, nullable
* `is_system_action`: boolean, default false
* `is_internal`: boolean, default false
* `created_at`: timestamp, indexed

Composite indexes for query optimization:
* `tickets (branch_id, status_id, created_at)`
* `tickets (assigned_to, status_id)`
* `tickets (requested_by, is_internal)`
* `ticket_audit_logs (ticket_id, created_at)`

**State transitions**:

Ticket lifecycle and timeline event transitions:
```
[Created] ──> [Open] ──> [In Progress] ──> [On Hold] ──> [In Progress] ──> [Resolved] ──> [Closed]
                │              │                                                 │
                └── Reassigned ┴────────────────── Breached ─────────────────────┴── Reopened
```

Each transition above writes an append only entry into `ticket_audit_logs` with actor details, timestamps, before and after values, and system action flags.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/ticketing/ticket/admin/dashboard` | GET | `preset`: string, `date_from`: date, `date_to`: date, `force_refresh`: bool | `kpis`, `trends`, `status_distribution`, `workload`, `recurring_issues`, `partial_errors` | Bearer (Admin, Super Admin) | 401 unauthenticated, 403 unauthorized branch |
| `/api/ticketing/ticket/superadmin/system-dashboard` | GET | `preset`: string, `date_from`: date, `date_to`: date, `sort_by`: string, `sort_dir`: string, `force_refresh`: bool | `user_counts`, `system_kpis`, `recent_activity`, `branch_comparisons`, `tickets_created_today` | Bearer (Super Admin) | 401 unauthenticated, 403 non superadmin |
| `/api/ticketing/ticket/cs-dashboard-summary` | GET | `limit`: int, `force_refresh`: bool | `queued_tickets`, `assigned_monitored`, `workload_metrics`, `needs_attention`, `partial_errors` | Bearer (CS, Admin) | 401 unauthenticated, 403 customer access |
| `/api/ticketing/ticket/employee/dashboard` | GET | `force_refresh`: bool | `assigned`: object, `requested`: object, `partial_errors`: array | Bearer (Employee) | 401 unauthenticated, 403 customer access |
| `/api/ticketing/ticket/tickets/{id}/timeline` | GET | `id`: int, `page`: int, `per_page`: int, `event_type`: string, `order`: string | `ticket_id`, `entries`: array, `pagination`: object | Bearer (All authenticated within scope) | 401 unauthenticated, 404 ticket not found, 403 unauthorized |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Admin Branch Dashboard | Total Tickets | Count of `tickets` where `branch_id = auth.branch_id` created within selected date range |
| Admin Branch Dashboard | Resolved Tickets | Count of `tickets` where `branch_id = auth.branch_id` and `status = Resolved` resolved within selected date range |
| Admin Branch Dashboard | Average Resolution Time | Average of `(resolved_at - created_at - on_hold_duration_minutes)` for resolved tickets in branch and period |
| Admin Branch Dashboard | SLA Compliance Rate | Percentage of resolved tickets in branch and period where `sla_breached = false` |
| Admin Branch Dashboard | Average CSAT | Internal HTTP fetch to analytics service (`GET /api/analytics/feedback/csat-export`) cached per branch |
| Admin Branch Dashboard | Status Distribution | Grouped count of active branch tickets by `status_id` |
| Admin Branch Dashboard | Employee Workload | Grouped count of open unresolved tickets by `assigned_to` within the branch |
| Admin Branch Dashboard | Recurring Issues | Top N grouped counts by `category_id` and `machine_id` within the branch and period |
| Super Admin System Dashboard | Total Users by Role | Internal HTTP fetch to customer and employee services (`/api/internal/users-by-roles`) |
| Super Admin System Dashboard | Tickets Created Today | Count of system wide tickets where `DATE(created_at) = CURRENT_DATE()` regardless of active date filter |
| Super Admin System Dashboard | Branch Comparisons | Aggregated ticket totals, active counts, SLA compliance percentage, and resolution hours grouped by `branch_id` |
| Super Admin System Dashboard | Recent Activity Feed | Latest 15 records from `ticket_audit_logs` with ticket identifiers, actor names, and event summaries |
| CS My Dashboard | Queued Tickets Summary | Count of unassigned branch tickets (`assigned_to IS NULL`) awaiting review |
| CS My Dashboard | Assigned and Monitored | Count of tickets where CS is assigned technician or active observer grouped by status |
| CS My Dashboard | Needs Attention Items | List of tickets where `sla_breached = true`, approaching breach within threshold, or pending reassignment |
| Employee My Dashboard | My Work Counts | Status breakdown of tickets where `assigned_to = auth.emp_id` |
| Employee My Dashboard | My Requests Counts | Status breakdown of tickets where `requested_by = auth.emp_id` and `is_internal = true` |
| Ticket Activity Timeline | Timeline Event Stream | Chronological records from `ticket_audit_logs` matching `ticket_id` with actor roles and before and after values |

**Key invariants**:

* Strict server side branch scoping: Admin requests automatically filter by authenticated token branch; attempts to specify a foreign branch return HTTP 403.
* Immutability of timeline records: `ticket_audit_logs` records cannot be updated or deleted through any public or internal API endpoint.
* Customer data privacy: When customer accounts view ticket timelines, records with `is_internal = true` (technician internal notes, private delegation details) are automatically stripped before response transmission.
* Resilient partial degradation: Independent dashboard query sections wrap in individual exception catch blocks, returning null values with descriptive error flags rather than failing the entire screen with an HTTP 500 error.
* Read only dashboard interaction: Summary cards, charts, and metrics never mutate ticket or employee records directly; clicking a ticket card opens its dedicated detail or triage modal.

**Security model**:

* Role based endpoint protection enforced by `VerifyEmployeeJwt` and route middleware.
* Branch Admins restricted to `auth.branch_id`.
* Super Admins granted global cross branch access and facility toggle capabilities.
* Employees restricted to their own `assigned_to` and `requested_by` records.
* Token authentication via Bearer JWT with RSA payload verification for credential exchanges.

**Configuration required**:

* `DASHBOARD_CACHE_TTL`: integer, default `60` (cache duration in seconds for dashboard aggregations)
* `ANALYTICS_SERVICE_URL`: string, default `http://analytics-service:8000` (internal URL for CSAT ratings)

**Critical test scenarios**:

* Happy path: Branch Admin requests `/api/ticketing/ticket/admin/dashboard` for This Month; endpoint returns branch scoped KPIs, trends, status distribution, and workload within 1.5 seconds, verifying **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-6**, **AC-7**.
* Cross branch security: Branch Admin attempts to supply `branch_id=999` for an unassigned branch; backend rejects the request with HTTP 403 Forbidden, verifying **AC-1**.
* Super Admin system overview: Super Admin requests `/api/ticketing/ticket/superadmin/system-dashboard`; response contains user role counts, global ticket volume, system SLA compliance, sortable branch comparison rows, and tickets created today anchored to the current calendar date, verifying **AC-8**, **AC-9**, **AC-10**, **AC-11**.
* Customer Service triage hub: CS agent requests `/api/ticketing/ticket/cs-dashboard-summary`; endpoint returns incoming unassigned queue, active workload, SLA risk items, and pending reassignment approvals, verifying **AC-12**.
* Employee dual panel separation: Technician employee requests `/api/ticketing/ticket/employee/dashboard`; endpoint returns distinct `assigned` and `requested` datasets strictly matching their employee identifier, verifying **AC-13**, **AC-14**, **AC-15**.
* Timeline event integrity: User opens ticket detail timeline; endpoint delivers chronological list of state mutations with actor names, system action indicators, and before and after property values, verifying **AC-16**, **AC-17**, **AC-18**, **AC-19**.
* Partial failure resilience: Analytics service is temporarily unreachable; Admin and Super Admin dashboards return null CSAT metrics with a section error notice while all ticket counters and charts render normally, verifying **AC-7**, **AC-15**.

## Build plan

Vertical implementation slices following the Tracer Bullet delivery approach:

1. Validate and optimize composite database indexes on `tickets` and `ticket_audit_logs` for branch, assignment, status, and creation timestamps, satisfying **AC-1**, **AC-6**, **AC-18**.
2. Enhance `TicketDashboardService` with strict server side branch scoping, definition tooltips metadata, status distributions, and partial failure isolation wrappers, satisfying **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-7**.
3. Enhance `SuperAdminDashboardService` to aggregate user role counts, current calendar day creation metrics, system wide KPIs, and sortable branch comparison metrics, satisfying **AC-8**, **AC-9**, **AC-10**, **AC-11**.
4. Align `TicketDashboardController::csDashboard` to return scoped triage queues, active monitored workloads, and SLA attention highlights with graceful error handling, satisfying **AC-12**.
5. Enhance `EmployeeDashboardService` to guarantee strict dual role data separation between `assigned` workload and `requested` internal tickets, satisfying **AC-13**, **AC-14**, **AC-15**.
6. Refine `AuditTimelineService` and `TicketTimelineController` with chronological event streaming, before and after value formatting, customer internal note redaction, and pagination, satisfying **AC-16**, **AC-17**, **AC-18**, **AC-19**.
7. Connect and verify React frontend components (`AdminDashboard.jsx`, `SuperAdminDashboard.jsx`, `CSDashboard.jsx`, `EmployeeDashboard.jsx`, `TicketActivityTimeline.jsx`) with date range controls, responsive charts, and empty error states, satisfying **AC-3**, **AC-4**, **AC-7**, **AC-20**.
8. Execute automated integration and feature test suites verifying branch isolation, role boundaries, timeline immutability, and partial failure tolerance across all five surfaces, satisfying **AC-1** through **AC-20**.

## Consequences

**Positive**:
* Eliminates confusion across all operational roles by delivering focused, role appropriate workspaces.
* Strict server side branch scoping prevents cross branch data leaks.
* Partial failure isolation ensures that external service hiccups never blank out entire operational dashboards.
* Permanent chronological audit logging provides complete accountability for every ticket event.
* Fast response times under two seconds achieved via 60 second Redis caching without blocking database table locks.

**Negative / tradeoffs**:
* Requires maintaining five distinct operational read paths and specialized service aggregators.
* High velocity audit logging increases database write volume on busy ticket threads.

**Neutral**:
* Internal service level agreement and customer satisfaction rating formulas are reused directly from existing service engines without introducing new dependencies.

## Follow-up

* Proceed to Part 2 specification covering Operational Reporting document exports, deep Employee and Department Performance analytics, Predictive Insights, and Super Admin Audit Log searching with automated retention purges.
* Coordinate with frontend team to confirm date range selector keyboard accessibility on mobile viewports.
