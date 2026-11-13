# 0039. Employee Performance Measured From Each Person's Assignment

**Date**: 2026-11-12
**Status**: Accepted

## Summary

Employee Performance today blames technicians for things they did not do: it counts tickets they never accepted, it starts the response clock when the customer created the ticket (so time spent waiting in the CS queue counts against them), and after a reassignment nobody can tell who held the ticket when it breached. This spec adds a small history table that records each stretch of time one person held one ticket, and rebuilds the per person numbers from it: a Pending count, a Response SLA % (did they accept within the priority's time limit), resolution SLA charged to whoever held the ticket at the breach, and one Performance Score that ranks people with its parts shown. Branch totals and department figures from spec 0031 do not change. Tracking starts at deploy, so expect a few quiet days before the numbers fill in.

## Requirements

**User stories**:
- As an Admin, I want each technician's numbers to reflect only the tickets they actually received and accepted, so that I can judge them fairly.
- As an Admin, I want to see work that is assigned but not yet accepted, so that I can chase it before it breaches.
- As a Superadmin, I want the same fair numbers across all branches, so that I can compare branches.
- As a technician, I want the clock to start when a ticket reaches me, not when the customer opened it.

**Acceptance criteria**:

*History recording*
- **AC-1**: Every time a ticket is assigned to an employee (all assignment paths in `ticket-service` and `employee-service`), one row is added to `ticket_assignment_periods` with `assigned_at`, `assigned_by`, and `ack_due_at` = `SLAService::addBusinessHours(assigned_at, response_time_limit)`, where `response_time_limit` comes from the same rule chain that sets `tickets.response_due_at` (branch category policy, then branch override, then `sla_rules`). When no rule applies, `ack_due_at` is null.
- **AC-2**: When the employee accepts the ticket, `accepted_at` is set on their open period (the one with `released_at` null). Accepting twice never moves `accepted_at`.
- **AC-3**: When an employee stops holding a ticket, their open period gets `released_at` and a `release_reason`: `reassigned` (approved reassignment or CS reassign to another person), `returned_to_cs` (ticket goes back to CS with no new assignee), `resolved`, `closed`, or `discarded`. This happens at all 5 places that delete `ticket_assignments` rows today and wherever a ticket becomes Resolved, Closed, or Discarded. `ticket_assignments` keeps its current behavior exactly.
- **AC-4**: While a ticket is On Hold, every open period on it is paused: `SLAService::pauseClock` sets `paused_at`; `resumeClock` adds the elapsed seconds to `paused_seconds`, and also to `ack_paused_seconds` if the period was not yet accepted. A period released while paused closes the pause first.
- **AC-5**: A period's **accept by** time is `ack_due_at + ack_paused_seconds`, plus the current pause length when the period is paused and not accepted.

*Which tickets count*
- **AC-6**: Employee metrics are built only from periods whose `assigned_at` falls inside the selected period (preset or custom range). Tickets with no period rows (assigned before deploy) count for no employee. Branch ticket totals are unchanged.
- **AC-7**: A period is **Pending** when it is open, not accepted, and the accept by time has not passed (or the period is paused). Each employee gets `pending_count`. Pending periods are left out of every other employee figure.
- **AC-8**: `tickets_assigned` = periods in the window that are not Pending.

*Response*
- **AC-9**: Response outcome per period: **met** when `accepted_at` ≤ accept by; **breached** when `accepted_at` > accept by, or when not accepted and the accept by time has passed. Periods with null `ack_due_at` get no response outcome. `response_met_count`, `response_breached_count`, and `response_sla_rate` = met ÷ (met + breached) × 100, rounded to 1 decimal, null when met + breached is 0.
- **AC-10**: `average_response_minutes` = average of (`accepted_at` − `assigned_at` − `ack_paused_seconds`) over accepted periods in the window, in minutes, 1 decimal, null when none.

*Resolution*
- **AC-11**: A ticket's resolution outcome comes from `SlaOutcomeService::classify` (spec 0031 rule). A **breached** outcome is charged to the period that held the ticket at `resolution_due_at` (`assigned_at` ≤ due, and `released_at` null or after due). If no period held it then, no employee is charged. A **met** outcome is credited to the period released with reason `resolved` or `closed`.
- **AC-12**: `sla_met_count`, `sla_breached_count`, and `sla_compliance_rate` (null when both are 0) count only outcomes attributed under AC-11 to periods in the window.
- **AC-13**: `tickets_resolved` = periods in the window released as `resolved` or `closed`. A ticket resolved after breaching counts in `tickets_resolved` and in `sla_breached_count`. `resolution_rate` = `tickets_resolved` ÷ `tickets_assigned` × 100, null when `tickets_assigned` is 0.
- **AC-14**: `average_resolution_hours` = average of (`released_at` − `accepted_at` − (`paused_seconds` − `ack_paused_seconds`)) over periods released as `resolved` or `closed` that have `accepted_at`, in hours, 1 decimal, null when none.

*CSAT and score*
- **AC-15**: A ticket's CSAT rating (from `CsatSnapshotService`) is credited to the period released as `resolved` or `closed` on that ticket. `csat_score` = average rating, `csat_reviews_count` = number of ratings.
- **AC-16**: `performance_score` (0 to 100, 1 decimal) = weighted average of the parts that exist: resolution `sla_compliance_rate` (weight 50), `response_sla_rate` (weight 30), `csat_score` ÷ 5 × 100 (weight 20). Missing parts are dropped and the remaining weights are scaled to add up to 100. Weights come from config.
- **AC-17**: When an employee has fewer than 3 judged periods in the window (periods with a response or resolution outcome), `performance_score` is null and `score_status` is `not_enough_data`; otherwise `score_status` is `scored`. The minimum comes from config.

*Surfaces*
- **AC-18**: The Admin dashboard (`/ticketing/admin/dashboard`, branch scoped) and Superadmin dashboard (all branches or one) Employee Performance table show, per person: Performance Score, Pending, Tickets Assigned, Resolved, Resolution SLA %, Response SLA %, Avg Response, Avg Resolution, CSAT. Default sort is Performance Score high to low with `not_enough_data` last; every column stays sortable. Null values show "No data" (or "—" in a cell), never 0 or 100.
- **AC-19**: The admin employees report (`/admin/reports/employees`, the tabular report) and its PDF, Excel, and CSV exports carry the same fields and values as AC-18 for the same filters.
- **AC-20**: Access is unchanged: a branch Admin only sees their branch and gets 403 for another branch or `all` (spec 0025 AC-13); a Superadmin may choose any branch or all.

*Integrity and scope*
- **AC-21**: A period write happens in the same database transaction as the assignment change it records. If the period write fails, the assignment change rolls back and the caller gets the existing error response; there is never an assignment without its history.
- **AC-22**: Department Performance, SLA by Department, the overall SLA KPI, and branch totals keep the spec 0031 rules unchanged.

## Decision

**Chosen option**: Option 1: Append only assignment history table.

Record each holding period in a new `ticket_assignment_periods` table written at every assign, accept, hold, and release point, and compute all per person metrics from it, leaving `ticket_assignments` and the department figures untouched.

**Implementation skills**: `laravel-microservice` (`.agents/skills/laravel-microservice/`) · `react-frontend` (`.agents/skills/react-frontend/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model** (new table, `ticket-service` migration, shared MySQL database):

| Field | Type | Null | Notes |
|---|---|---|---|
| `id` | bigint unsigned, PK | no | |
| `ticket_ID` | FK → `tickets.ticket_ID` | no | cascade on ticket delete |
| `employee_ID` | FK → `employees.emp_id` | no | the holder |
| `assigned_by` | FK → `employees.emp_id` | yes | set null on delete |
| `assigned_at` | timestamp | no | |
| `ack_due_at` | timestamp | yes | accept by deadline, saved at assignment (AC-1) |
| `accepted_at` | timestamp | yes | |
| `paused_at` | timestamp | yes | set while On Hold (AC-4) |
| `paused_seconds` | unsigned int, default 0 | no | all hold time during the period |
| `ack_paused_seconds` | unsigned int, default 0 | no | hold time before acceptance |
| `released_at` | timestamp | yes | null = still holding |
| `release_reason` | varchar(20) | yes | `reassigned` · `returned_to_cs` · `resolved` · `closed` · `discarded` |
| `created_at`, `updated_at` | timestamps | yes | |

Indexes: (`employee_ID`, `assigned_at`), (`ticket_ID`, `released_at`). Relationships: ticket 1:N periods, employee 1:N periods. `paused_at`, `paused_seconds`, and `ack_paused_seconds` were added after the data model review to support "pause the accept by clock while On Hold".

**State per period**: open and not accepted → (accept) open and accepted → (release) closed. Open periods can be paused and resumed in either open state. Pending, response met, and response breached are derived, not stored.

**Write points** (one `AssignmentPeriodRecorder` service per writing service, `ticket-service/app/Services/` and `employee-service/app/Services/`, same methods: `open`, `accept`, `pause`, `resume`, `release`):

| Event | Where today | Recorder call |
|---|---|---|
| CS assigns or reassigns | `TicketService.php:1653`/`:1694`, `EmployeeAssignmentService.php:237`/`:733` (delete then insert) | `release(old, 'reassigned')` then `open(new)`; `release(old, 'returned_to_cs')` when no new assignee |
| Reassignment approved | `EmployeeReassignmentService.php:219` | `release(old, 'reassigned' or 'returned_to_cs')`, then `open(new)` if any |
| First assignment inserts | `EmployeeAssignmentService.php:241`, `:519`, `:737`, `EmployeeReassignmentService.php:243`, `TicketService.php:1654` | `open` |
| Employee accepts | `EmployeeAssignmentService::acceptTicket` (sets `ticket_assignments.accepted_at`) | `accept` |
| On Hold / resume | `SLAService::pauseClock` / `resumeClock` (each service that has them) | `pause` / `resume` |
| Resolved / Closed / Discarded | `TicketStateMachine` transitions, `TicketService::updateTicket` status changes | `release(holder, reason)` |

**API surface** (shapes extended, no new endpoints):

| Endpoint | Method | Key inputs | Key outputs (per employee, added or redefined) | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/ticketing/ticket/admin/dashboard` | GET | `preset`, `date_from`, `date_to`, `branch_id` | `employee_performance.employees[]`: `performance_score`, `score_status`, `pending_count`, `tickets_assigned`, `tickets_resolved`, `resolution_rate`, `sla_compliance_rate`, `sla_met_count`, `sla_breached_count`, `response_sla_rate`, `response_met_count`, `response_breached_count`, `average_response_minutes`, `average_resolution_hours`, `csat_score`, `csat_reviews_count` | staff JWT, admin or superadmin | 403 cross branch |
| `/admin/reports/employees` (and tabular `/admin/reports`) | GET | same + `sort_by`, `sort_dir` | same fields as rows | same | 403 |
| report exports (PDF, Excel, CSV) | GET | same | same columns | same | 403 |

`sort_by` accepts the existing keys plus `performance_score`, `pending_count`, `response_sla_rate`. Default `performance_score` desc, nulls last.

**Value sourcing**:

| Action | Value | Source |
|---|---|---|
| open period | `ack_due_at` | `SLAService::addBusinessHours(assigned_at, limit)`; `limit` from the existing rule resolution used for `response_due_at` |
| open period | `assigned_by` | the acting CS employee id already passed to each assignment path |
| accept | `accepted_at` | `now()` at `acceptTicket` |
| release | `release_reason` | the event in the write points table |
| metrics | period window | `AdminPerformanceService::resolveDateRange` (existing presets) |
| metrics | accept by | `ack_due_at` + `ack_paused_seconds` (+ live pause) |
| metrics | resolution outcome, due time | `SlaOutcomeService::classify`, `tickets.resolution_due_at` |
| metrics | CSAT per ticket | `CsatSnapshotService::forTickets()['ticket_ratings']` |
| metrics | weights, minimum judged | `config('ticketing.performance.score_weights')` (`resolution_sla` 50, `response_sla` 30, `csat` 20), `config('ticketing.performance.min_judged_periods')` (3) |
| metrics | branch scope | existing `branchTechnicalEmployeesQuery` + caller's branch (spec 0025) |

**Key invariants**:
- At most one open period per (`ticket_ID`, `employee_ID`); `open` on an existing open period is a no op. Enforced in the recorder (MySQL has no partial unique index).
- `accepted_at` and `released_at` are never earlier than `assigned_at`; `accepted_at` is set once.
- Rows are never deleted or rewritten except the fields named in AC-2 to AC-4.
- No employee metric reads `ticket_assignments` or `tickets.first_response_at` any more.

**Security model**: No new endpoints or roles. Branch scoping per spec 0025 AC-13 and spec 0029. The table holds operational timestamps only, no personal data beyond existing employee ids.

**Configuration required**: no new environment variables. New keys in `ticket-service/config/ticketing.php` under `performance`.

**Critical test scenarios**:
- Happy path: High ticket assigned 09:00, accepted 09:20, resolved in time → response met, resolution met, counted assigned and resolved, response 20 min, verifies **AC-1**, **AC-2**, **AC-9**, **AC-10**, **AC-11**, **AC-13**
- Pending: assigned 09:00, not accepted, checked 09:15 → Pending, not in assigned or SLA figures; checked 09:40 → response breached, verifies **AC-7**, **AC-8**, **AC-9**
- Reassignment: Mark holds 09:00 to 13:00, Ana from 13:00, resolution due 12:00 breaches → breach charged to Mark; Ana gets the resolved count, verifies **AC-3**, **AC-11**, **AC-13**
- Returned to CS at due time → breach charged to nobody, verifies **AC-11**
- On Hold before accept: assigned 09:00, held 09:10 to 10:10, accepted 10:25 → accept by 10:30, response met, response time 25 min, verifies **AC-4**, **AC-5**, **AC-10**
- Breached then resolved → in resolved and breached counts, verifies **AC-13**
- Score: no CSAT, resolution 80, response 100 → 87.5; only 2 judged periods → `not_enough_data`, verifies **AC-16**, **AC-17**
- Pre deploy ticket with no period → absent from employee metrics, present in branch totals, verifies **AC-6**, **AC-22**
- Transaction: period insert forced to fail → assignment unchanged, error returned, verifies **AC-21**
- Branch admin requests `branch_id=all` → 403, verifies **AC-20**
- Report export values equal dashboard values for the same filters, verifies **AC-19**

## Build plan

Build approach: none recorded in `AGENTS.md` and no scope row; assumed end to end thin slices (Tracer Bullet).

1. Migration for `ticket_assignment_periods` and the `performance` config keys, satisfies **AC-1**
2. `AssignmentPeriodRecorder` in `ticket-service` with unit tests (open, accept, pause, resume, release, invariants), satisfies **AC-1** to **AC-5**, **AC-21**
3. Thin thread: wire `open` and `accept` on the main CS assign path and `acceptTicket`, compute `pending_count`, `response_*`, and `average_response_minutes` in `AdminPerformanceService`, show Pending and Response SLA % on the Admin dashboard, satisfies **AC-6** to **AC-10**, **AC-18**
4. Mirror the recorder in `employee-service` and wire every remaining write point (all 5 delete sites, all insert sites, reassignment approval), each inside the existing transaction, satisfies **AC-1**, **AC-3**, **AC-21**
5. Wire release on Resolved, Closed, Discarded transitions and pause/resume in each `SLAService`, satisfies **AC-3**, **AC-4**, **AC-5**
6. Resolution attribution, resolved count, resolution time, and CSAT crediting from periods in `AdminPerformanceService`, satisfies **AC-11** to **AC-15**
7. Performance Score, `score_status`, default sort and new sort keys, satisfies **AC-16**, **AC-17**, **AC-18**
8. Superadmin dashboard columns and sort (shared payload from `TicketDashboardService`), satisfies **AC-18**, **AC-20**
9. Employees report and PDF / Excel / CSV export columns, satisfies **AC-19**, **AC-20**
10. Regression tests proving department, overall SLA, and branch totals are unchanged, satisfies **AC-22**

## Migration plan

**Strategy**: additive, no backfill. Deploy the migration and code together.
**Phases**:
1. Create the table (empty). Recorder starts writing on deploy.
2. Metrics read periods immediately; employee figures are sparse until new assignments accumulate.
**Rollback**: revert the code; the table can stay (unused) or be dropped by the migration's `down()`. No existing data is changed.
**Risks**: a write point missed in step 4 leaves gaps in history (caught by tests per write point); a quiet metrics period right after deploy that admins may read as a bug (announce it).

## Consequences

**Positive**:
- Technicians are judged only on time that was theirs; CS queue time and other people's holding time no longer count against them.
- Admins see waiting work (Pending) before it breaches.
- Reassignment no longer loses who was responsible for a breach.

**Negative / tradeoffs**:
- Employee figures restart at deploy; old tickets never count for anyone.
- Seven to ten write points across two services must call the recorder; any future assignment path must too, or history goes silently wrong.
- `employee-service` writes a table owned by `ticket-service` through the shared database, the same coupling `ticket_assignments` already has (spec 0026), not removed by this spec.
- Employee SLA counts by assignment date while department SLA (spec 0031) counts by outcome date, so the two can differ for the same period.

**Neutral**:
- `tickets.first_response_at` and `response_sla_status` stay as ticket level fields for other screens; employee metrics stop using them.

## Follow-up

- [ ] Announce the metrics reset and quiet period to admins at deploy.
- [ ] Consider moving `AssignmentPeriodRecorder` into a shared package so the two copies cannot drift.
- [ ] Revisit whether department SLA should also move to assignment periods once employee figures have a few weeks of data.
