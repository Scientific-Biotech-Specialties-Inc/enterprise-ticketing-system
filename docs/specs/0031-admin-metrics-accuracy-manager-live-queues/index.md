# 0031. Admin Metrics Accuracy, Live Manager Queues, and Fast Dashboard Ranges

**Date**: 2026-11-05
**Status**: In Progress

## Summary

The admin dashboard shows numbers that are wrong or padded: departments that never handle tickets, a 100% SLA score for every employee, and slow loads when you switch between Last 7 Days and Last 30 Days. The manager dashboards (Service, IT, Customer Service) show made up breached tickets whenever their browser side filter comes back empty. This spec makes every one of those numbers come from the ticket database using one shared SLA rule, limits admin metrics to the two ticket handling departments (Service and IT), gives managers a real server endpoint for their breached queue, takes slow outside calls off the request path, and changes slosizante@gmail.com from Manager to Employee in the central auth module.

## Requirements

**User stories**:
- As an Admin, I want department and employee performance to cover only Service and IT, so the dashboard reflects the teams that actually handle tickets.
- As an Admin, I want each employee's SLA compliance to come from their real ticket outcomes, so I can see who is missing deadlines.
- As a Service, IT, or CS Manager, I want my breached tickets queue to list the real overdue tickets in my scope, so I can act on them.
- As an Admin, I want switching between date ranges to feel instant, so I can compare periods without waiting.
- As the organization, we want slosizante@gmail.com to work as a regular Customer Service employee, not a manager.

**Acceptance criteria**:
- **AC-1**: On `/ticketing/admin/dashboard`, the Department Performance tab lists exactly the departments in `config('ticketing.technical_departments')` (default `Service`, `IT`). Both always appear, with a "No data" state when they have no tickets in the period. No other department (Finance, Sales & Marketing, HR, Operations, Customer Service, and so on) appears.
- **AC-2**: The same department limit applies to every admin metric that groups by person or department: the Employee Performance list and chart, SLA by Department, Workload by Department, Department Performance, the `active_employees_count` KPI, and the admin reports endpoints (`/admin/reports/employees`, `/admin/reports/departments`, the tabular report). Ticket totals (total, open, resolved, and so on) still count every branch ticket.
- **AC-3**: A ticket's department is the department of its assigned employee (`tickets.assigned_to` joined to `employees.department`), matched case insensitively after trimming. A ticket with no assignee belongs to no department and is not attributed to any department figure (the current fallback to `Service` is removed).
- **AC-4**: SLA compliance (per employee, per department, overall KPI, SLA by Department, and the SLA compliance trend) is computed by one shared rule:
  - **Met**: the ticket is resolved or closed, and `resolved_at` (else `closed_at`) is on or before `resolution_due_at`.
  - **Breached**: the ticket is resolved or closed after `resolution_due_at`, OR it is still open (not resolved, closed, or discarded, and not on hold) and `resolution_due_at` is in the past.
  - **Excluded**: no SLA configured (per `SLAService::computeTicketSlaMetrics` returning `No SLA Configured`), on hold or paused, open and not yet due, and discarded.
  - Rate = met ÷ (met + breached) × 100, rounded to one decimal.
- **AC-5**: A ticket counts toward a period's SLA figures by its **outcome date**: `resolved_at` (else `closed_at`) for resolved or closed tickets, and `resolution_due_at` for open breached tickets. The window is the selected preset or custom range. Other KPIs keep using `created_at`.
- **AC-6**: An employee or department with zero met plus breached tickets in the period returns `sla_compliance_rate: null`, and the UI shows "No data" (or "—" in a table cell). No code path, backend or frontend, substitutes 100, 0, or any made up value for a missing rate. This includes the Cross Branch table's `?? 100` and the employee chart's `?? 0`.
- **AC-7**: A new endpoint `GET /manager/dashboard` (same route group and prefix as `/admin/dashboard`) returns the caller's scope, a summary (`total_open`, `unassigned`, `within_sla`, `breached`), and a `breached_queue` list sorted by `resolution_due_at` ascending (most overdue first). It uses the same breach rule as AC-4 (open and past due, not on hold).
- **AC-8**: Scope for AC-7 comes from the caller's own `employees` row (looked up from the authenticated user, never from a request parameter). A Service Manager sees tickets whose assignee's department is `Service`. An IT Manager sees tickets whose assignee's department is `IT`. A CS Manager sees every ticket in the branch, with each ticket's department (or "Unassigned") shown. All scopes are limited to the manager's branch.
- **AC-9**: A caller who is not a manager (their `employees.position_level` is not `Manager`) gets `403`. A manager whose department is not Service, IT, or Customer Service also gets `403`.
- **AC-10**: `ServiceManagerDashboard.jsx`, `ITManagerDashboard.jsx`, and `CSManagerDashboard.jsx` read their summary and breached queue from AC-7. `MOCK_SERVICE_TICKETS`, `MOCK_IT_TICKETS`, `MOCK_CS_TICKETS`, the hardcoded `formattedStaff` lists, and the hardcoded department name fallbacks are deleted. The assign modal's staff list comes only from `getAssignableEmployees`, filtered to the manager's department (CS Manager: no filter).
- **AC-11**: When the AC-7 request fails, the manager dashboard shows an error state with a Retry button. When it succeeds with no breaches, it shows the existing "Zero SLA Breaches" empty state. It never shows sample tickets.
- **AC-12**: Switching the admin dashboard between Today, Last 7 Days, Last 30 Days, and Last 90 Days completes the `/admin/dashboard` request in under 1 second on a cold cache in the local Docker stack, including when `analytics-service` is down or hanging. A warm cache hit stays under 200 ms.
- **AC-13**: No admin dashboard or admin report request makes a synchronous call to the auth module. Employee directory sync runs on the scheduler every minute through one shared sync service that sends the `X-Internal-Secret` header (the auth call no longer returns 403).
- **AC-14**: CSAT on the admin dashboard is fetched with a total time limit of 500 ms. After a failure, an "analytics unavailable" flag is cached for 60 seconds and no CSAT call is made while it is set. The dashboard then returns `csat_available: false` and the UI shows CSAT as unavailable, never an invented score.
- **AC-15**: When the admin switches range quickly, the dashboard shows the most recently selected range. An earlier request that finishes late never overwrites a newer range's data.
- **AC-16**: The root cause of `analytics-service` `/api/csat-stats` never answering (it timed out even with a 10 second limit on 2026-11-05) is found and fixed, so CSAT shows real values when the service is healthy.
- **AC-17**: slosizante@gmail.com has role `Employee` (role_id 25) in the central auth module, department still `Customer Service`. After the next scheduled sync, their ticket-service `employees` row has `position_level = Employee` and `role = customer service`. After they log in again they land on the CS agent experience, not the CS Manager dashboard.

## Decision

**Chosen option**: Fix in place, with one shared SLA outcome rule, a config based department allow list, a server owned manager endpoint, and outside calls moved off the request path.

You keep the existing endpoints and pages and correct what they compute. You add exactly one new endpoint (manager dashboard) and two small service classes, and remove the duplicated sync and CSAT code paths.

**Implementation skills**: `laravel-microservice` (`.claude/skills/laravel-microservice/`) · `react-frontend` (`.claude/skills/react-frontend/`) · `docker-runbook` (`.claude/skills/docker-runbook/`) for the timing checks and the auth data change · `debug` for AC-16

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**: no schema change. One new config file.

| Item | Where | Notes |
|---|---|---|
| `technical_departments` | new `services/ticket-service/config/ticketing.php` | Array, default `['Service', 'IT']`. Overridable with env `TICKETING_TECHNICAL_DEPARTMENTS` (comma separated). Compared case insensitively after trim. |
| `employees.department`, `employees.position_level`, `employees.branch_id` | existing ticket-service table | Read only here. Written only by the shared sync service. |
| `tickets.assigned_to`, `resolution_due_at`, `resolved_at`, `closed_at`, `ticket_status_ID`, `branch_id` | existing | Inputs to the SLA outcome rule and scoping. |
| auth module `user_profiles.role_id` for user_id 68 | central auth module DB (not this repo) | One time data change 21 → 25 (AC-17). |

**New service classes** (in `services/ticket-service/app/Services/`, keeping controllers thin):

| Class | Responsibility |
|---|---|
| `SlaOutcomeService` | `classify(object $ticket): ?string` returns `met`, `breached`, or `null` (excluded) per AC-4, delegating "No SLA Configured" and on hold detection to `SLAService::computeTicketSlaMetrics`. `outcomeDate(object $ticket): ?Carbon` per AC-5. `applyOutcomeWindow(Builder $q, Carbon $from, Carbon $to)` adds the SQL prefilter: `(resolved_at BETWEEN from AND to) OR (resolved_at IS NULL AND closed_at BETWEEN from AND to) OR (status open AND resolution_due_at BETWEEN from AND LEAST(to, NOW()))`. `rate(int $met, int $breached): ?float`. |
| `TechnicalDepartments` (small support class, or static helper in `App\Support`) | `list(): array`, `contains(?string $dept): bool`, `applyEmployeeFilter(Builder $q, string $alias = 'e')` (adds `LOWER(TRIM(e.department)) IN (...)`). |
| `EmployeeDirectorySyncService` | The single auth to ticket-service employee sync, moved out of `EmployeeDirectoryController` (its role mapping and `X-Internal-Secret` header are the ones kept). `TicketDashboardService::syncEmployeesFromAuthModule()` is deleted; the seeder email deactivation it did moves here. |
| `CsatSnapshotService` | `forTickets(array $ids, Carbon $from, Carbon $to): array` returns `['available' => bool, 'average_score' => ?float, 'satisfaction_percentage' => ?float, 'total_reviews' => int, 'ticket_ratings' => array]`. Uses `Http::withOptions(['timeout' => 0.5, 'connect_timeout' => 0.3])`. Success cached 120 s by key `csat_snapshot_{md5(sorted ids + from + to)}`. Failure sets `analytics_csat_unavailable` for 60 s and returns `available: false`. Replaces `AdminPerformanceService::fetchCsatByTicketIds` and the inline call in `computeAdminDashboardData`. |
| `ManagerDashboardService` | Builds the AC-7 payload from a resolved manager `employees` row. |

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/manager/dashboard` (new, ticket-service `routes/api.php`, same group as `/admin/dashboard`, `no-cache` middleware) | GET | `forceRefresh` (bool, optional) | `scope {department, branch_id, branch_name, mode: "department" or "branch"}`, `summary {total_open, unassigned, within_sla, breached}`, `breached_queue[] {ticket_ID, ticket_number, title, status_name, priority_name, department (assignee dept or null), assignee_id, assignee_name, resolution_due_at, overdue_minutes, created_at}`, `generated_at` | bearer (existing auth middleware) | 401 no user, 403 not a manager or unsupported department, 404 caller has no `employees` row |
| `/admin/dashboard` (existing) | GET | unchanged | unchanged shape; `departments`, `employee_performance.employees`, `sla.by_department`, `workload` now limited per AC-2; SLA fields per AC-4/5/6; `kpis.csat_available` per AC-14 | unchanged | unchanged |
| `/admin/reports/employees`, `/admin/reports/departments`, `/admin/reports` (existing) | GET | unchanged | limited per AC-2, SLA per AC-4/5/6 | unchanged | unchanged |

Frontend: add `getManagerDashboard({ forceRefresh })` in `frontend/web/src/services/ticketService.js` next to `getAdminDashboard`. No Nginx change: the route sits under the existing ticket-service prefix.

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Admin dept list | allowed departments | `config('ticketing.technical_departments')` |
| Admin dept list | a department's tickets | tickets whose `assigned_to` → `employees.department` matches (AC-3) |
| Any SLA figure | met / breached / excluded | `SlaOutcomeService::classify` over `tickets` columns plus `SLAService` |
| Any SLA figure | whether a ticket is in the period | `SlaOutcomeService::outcomeDate` vs `ReportPeriod::resolve($filters)` range |
| Any SLA figure | "now" for open breaches | server clock `now()` (app timezone) |
| Employee SLA | which tickets belong to the employee | `tickets.assigned_to` OR active `ticket_assignments.employee_ID` (existing rule, kept) |
| Manager dashboard | manager identity | authenticated user's email → `employees` row (`LOWER(email)` match), same lookup the existing controllers use |
| Manager dashboard | manager's department and branch | that row's `department`, `branch_id` |
| Manager dashboard | is manager | that row's `position_level = 'Manager'` (set by the sync mapping) |
| Manager dashboard | ticket department shown | assignee's `employees.department`, else null ("Unassigned") |
| Manager dashboard | `overdue_minutes` | `now() - resolution_due_at` in minutes |
| Manager dashboard | `within_sla` | open tickets in scope with an SLA, not on hold, not past due |
| Manager dashboard | `unassigned` | open tickets in scope with `assigned_to` null (always 0 for Service and IT scopes, since their scope is by assignee) |
| Manager assign modal | staff list | `getAssignableEmployees()` response filtered by `department` = manager's department |
| Admin CSAT | score or unavailable | `CsatSnapshotService` |
| Admin `active_employees_count` | count | active `employees` in branch and in technical departments |

**Key invariants**:
- One SLA rule. Every SLA number on the admin dashboard, admin reports, and manager dashboard goes through `SlaOutcomeService`. No other code path computes met or breached for these surfaces.
- No made up values. A missing rate is `null` end to end. No mock tickets, mock staff, or fallback department names ship in production pages.
- No request path calls the auth module synchronously. No request path waits more than 500 ms on `analytics-service`.
- Department scope for a manager is always derived on the server.
- Respect invariant 3 of AGENTS.md: the manager endpoint reads only ticket-service tables. CSAT stays a REST call to analytics-service.

**Security model**:
- `/manager/dashboard`: authenticated users only. Allowed when the caller's `employees.position_level` is `Manager` and their department is Service, IT, or Customer Service. Everyone else gets 403. Branch is always the caller's own branch (managers cannot pass `branch_id`).
- Admin endpoints keep their current allow list.
- The internal sync uses the existing `X-Internal-Secret` (env, already configured for `EmployeeDirectoryController`). No new secret.
- No PII beyond names and emails already exposed by existing dashboards.

**Configuration required**:
- `TICKETING_TECHNICAL_DEPARTMENTS` (optional): comma separated override of the default `Service,IT`.

**Caching**:

| What | Key | TTL | Invalidation | When stale |
|---|---|---|---|---|
| Admin dashboard payload | existing `admin_dashboard_metrics_*` | 60 s (unchanged) | existing `forceRefresh` and ticket cache clearing | up to 60 s old, same as today |
| Employee and department perf | existing `admin_emp_perf_*`, `admin_dept_perf_*` | 120 s (unchanged) | `forceRefresh` | same |
| Manager dashboard | `manager_dash_{dept or 'all'}_{branch_id}` | 30 s | `forceRefresh=true` from the Refresh button | a new breach may appear up to 30 s late |
| CSAT snapshot | `csat_snapshot_*` | 120 s | none | CSAT up to 2 minutes old |
| Analytics down flag | `analytics_csat_unavailable` | 60 s | expires | CSAT hidden up to 60 s after recovery |

Cache key versions: bump the prefix of `admin_dashboard_metrics_`, `admin_emp_perf_`, `admin_dept_perf_` (for example append `v2_`) so no pre deploy payload with the old SLA math is served.

**Critical test scenarios**:
- Happy path: seed a Service and an IT tech plus a Finance employee; tickets met, breached late, open overdue, open not due, no SLA. Assert the department list is exactly Service and IT, the Finance employee is absent, and the rates match AC-4 by hand count. Verifies **AC-1, AC-2, AC-4**.
- Outcome window: a ticket created 40 days ago, still open, due 3 days ago, counts as breached in Last 7 Days. A ticket created yesterday and resolved yesterday counts in Today only if resolved today. Verifies **AC-5**.
- No data: an employee with only open, not yet due tickets returns `sla_compliance_rate: null`; the UI renders "No data". Verifies **AC-6**.
- Unassigned ticket: an open overdue ticket with no assignee is absent from the Service and IT manager queues and from department figures, and present in the CS Manager queue as "Unassigned". Verifies **AC-3, AC-8**.
- Auth: an Employee, a CS agent, an Admin, and a Finance Manager each get 403 on `/manager/dashboard`. A Service Manager passing `branch_id=2` still gets their own branch. Verifies **AC-8, AC-9**.
- Manager UI: API returns `[]` → "Zero SLA Breaches", no mock rows; API rejects → error state with Retry. Verifies **AC-10, AC-11**.
- Slow analytics: fake `analytics-service` to hang; a cold `/admin/dashboard` returns in under 1 s with `csat_available: false`, and a second call within 60 s makes no HTTP call. Verifies **AC-12, AC-14**.
- No auth call on request: with `Http::fake()` asserting nothing is sent to the auth URL during `/admin/dashboard`. Verifies **AC-13**.
- Race: switch Last 7 Days → Last 30 Days with the first response delayed; the UI ends on Last 30 Days data. Verifies **AC-15**.

## Build plan

No build approach is recorded (no `docs/scope/`, nothing in AGENTS.md), so this uses end to end slices (Tracer Bullet). Each slice ships a visible fix on its own.

**Slice 1: Speed (the quickest win, and it makes testing the rest faster)**
1. Create `EmployeeDirectorySyncService` from the `EmployeeDirectoryController` sync (keeping its role mapping and `X-Internal-Secret`), fold in the seeder deactivation, and make the controller delegate to it. Register an Artisan command `employees:sync-directory` scheduled `everyMinute()->withoutOverlapping()` in `app/Console/Kernel.php`. Satisfies **AC-13**.
2. Delete `TicketDashboardService::syncEmployeesFromAuthModule()` and every call to it (`getBranchEmployees`, `computeEmployeePerformanceData`, `computeDepartmentPerformanceData`, `computeTabularReportData`). Satisfies **AC-13**.
3. Create `CsatSnapshotService` with the timeout, cache, and down flag, and replace both CSAT call sites. Satisfies **AC-14**.
4. Measure a cold `/admin/dashboard` per preset (same tinker timing as in rationale.md). If still over 1 s, reuse one ticket query across the dashboard, employee, and department computations instead of three. Satisfies **AC-12**.
5. In `AdminDashboard.jsx` `fetchAnalytics`, use an `AbortController` (or a request sequence ref) so only the latest range's response is applied. Satisfies **AC-15**.

**Slice 2: SLA truth**
6. Create `SlaOutcomeService` with unit tests for every AC-4 branch and the AC-5 outcome date. Satisfies **AC-4, AC-5**.
7. Route employee perf, department perf, overall KPI, SLA by Department, and the SLA trend buckets through it, using `applyOutcomeWindow` for the SLA ticket set (the created_at ticket set stays for the other KPIs). Return `null` for empty rates. Remove the `'Service'` fallback attribution in SLA by Department. Bump the cache key prefixes. Satisfies **AC-3, AC-4, AC-5, AC-6**.
8. Frontend: render `null` rates as "No data" or "—" in `AdminDashboard.jsx` (employee SLA chart, Cross Branch table `?? 100`), `EmployeePerformanceView.jsx`, and `DepartmentPerformanceView.jsx`. Satisfies **AC-6**.

**Slice 3: Service and IT only**
9. Add `config/ticketing.php` and the `TechnicalDepartments` helper. Apply the employee filter in `AdminPerformanceService` (both computations), `getBranchEmployees`, workload, and the tabular report. Make department performance iterate the configured list, not the employees' departments, so both always appear. Satisfies **AC-1, AC-2**.

**Slice 4: Live manager queues**
10. Create `ManagerDashboardService` and `ManagerDashboardController@dashboard` with the AC-9 check, the AC-8 scoping, and a 30 s cache. Add the route. Feature tests for each role. Satisfies **AC-7, AC-8, AC-9**.
11. Add `getManagerDashboard` to `ticketService.js`. Rewire the three manager dashboards to it. Delete the mocks, hardcoded staff, and department fallbacks. Add the error state with Retry, keeping skeleton loaders for the initial fetch and `Loader2` only on the Refresh button (DESIGN.md loading rule). Update their tests. Satisfies **AC-10, AC-11**.

**Slice 5: Root causes outside the hot path**
12. Run `/debug` on `analytics-service` `/api/csat-stats` hanging (start by checking whether the container serves with a single threaded `php artisan serve` and whether the endpoint calls back into ticket-service, which would deadlock). Fix it. Satisfies **AC-16**.
13. Data change, run by you in the auth module (its admin UI, or a one off tinker in the `auth-service` container): set `user_profiles.role_id = 25` where `user_id = 68`. Then run `php artisan employees:sync-directory` in ticket-service and confirm the `employees` row (emp_id 1096). Ask the user to log out and back in. Satisfies **AC-17**.

## Consequences

**Positive**:
- Every SLA figure on the admin and manager dashboards means the same thing and can be checked by hand against the database.
- Managers act on real overdue tickets. Today the real data has about 5 overdue Service tickets (due 2026-10-06) that the current pages can hide behind mock rows.
- Range switching stops paying for a hanging analytics call and an auth round trip on every cache miss.
- One employee sync instead of two that disagree on role mapping.

**Negative / tradeoffs**:
- Many employees will show "No data" for SLA in short ranges, because open tickets that are not yet due are excluded. That's accurate, but it will look emptier than today's 100%.
- Admin figures will change visibly after deploy (lower compliance, fewer departments). Tell the admins before release.
- Service and IT manager queues never show unassigned breached tickets (your choice of assignee department only). Only the CS Manager sees them, so CS must own triage of unassigned breaches.
- CSAT can be up to 2 minutes stale, and it stays hidden for up to 60 s after analytics recovers.
- Employee directory changes from auth now take up to a minute to appear (scheduler cadence), and the ticket-service scheduler must be running.
- The department allow list is config, so adding a third ticket handling department needs a config or env change and a deploy.

**Neutral**:
- No migration. One new config file, one new route, one new scheduled command.
- The KPI tooltip on the dashboard ("Tickets that met their SLA target divided by all tickets with an SLA outcome") now matches the code.

## Migration plan

**Strategy**: no schema migration. Ordered deploy by slice.
**Phases**:
1. Deploy slices 1 to 4 together or in order. Cache key prefix bumps make the switch clean.
2. After deploy, run `employees:sync-directory` once by hand, then confirm the scheduler is running it.
3. Apply the auth module data change (task 13) only after the shared sync works, so the new role flows through.

**Rollback**: revert the commits. The bumped cache keys expire on their own (60 to 120 s). The auth role change is reverted by setting `role_id` back to 21.
**Risks**: if the scheduler container (`ticket-scheduler`) is not running, the employee directory stops updating. Check it in the deploy runbook.

## Follow-up

- [ ] Announce the metric definition change to admins (SLA now by outcome date, Service and IT only) before release.
- [ ] Consider giving `tickets` an explicit department (for example from problem category at triage) so unassigned tickets can be scoped to Service or IT managers. This would need its own spec.
- [ ] `frontend/web/src/services/dashboardAnalyticsService.js` still holds seeded generators (`getEmployeePerformanceData`, `getDepartmentPerformanceData`, `BRANCH_EMPLOYEES`, `BRANCH_DEPARTMENTS`) used only by tests. Consider deleting them so nothing can wire them back in.
- [ ] `AuthContext.jsx` hardcodes manager emails (`carlos.mendoza@hospital.com`, `headofcs@gmail.com`). Consider removing them so role comes only from the auth payload.
- [ ] Specs 0020, 0023, and 0027 describe the earlier SLA, manager, and preset caching behavior. Run `/sync` after this ships to flag them as partly superseded.
