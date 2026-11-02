# 0025. Real Employee Names, Fast Date Filters, Live Operational Reports, and SuperAdmin Global Views

**Date**: 2026-11-01
**Status**: Implemented

## Summary

This specification fixes four connected operational gaps across the Admin and SuperAdmin analytics and reporting views. First, it synchronizes real employee names from the central Auth Module (authentication service) and removes all seeded or placeholder technician names from Employee Performance charts. Second, it speeds up dashboard date filtering (`Today`, `Last 7 Days`, `Last 30 Days`, `Last 90 Days`, and `Custom Range`) by returning unified employee and department metrics inside a single dashboard payload, fixing a broken internal port timeout to `analytics-service`, and decoupling predictive forecasts from historical date changes. Third, it connects the Reports tab (`AdminReports.jsx`) to live database records for all six operational report types and adds dedicated SuperAdmin Dashboard (`/superadmin/dashboard`) and Reports (`/superadmin/reports`) routes with global `All Branches` visibility and cross branch comparison.

## Requirements

**User stories**:
* As an Admin or SuperAdmin, I want the Employee Performance chart to display the real names of active assignable technicians synced from the central Auth Module, so that performance evaluations reflect actual staff rather than seeded or blank accounts.
* As an Admin or SuperAdmin, I want switching date filters such as `Today` or `Last 7 Days` on the dashboard to complete quickly in a single request without waiting on internal network timeouts, so that I can inspect operational windows without lag.
* As an Admin or SuperAdmin, I want the Reports tab to preview and export live database records across all six operational report types (`ticket_volume`, `sla_compliance`, `department_performance`, `equipment_maintenance`, `csat_satisfaction`, and `predictive_risk`), so that exported CSV, Excel, and PDF files contain real facility data instead of mock rows.
* As a SuperAdmin, I want dedicated Dashboard (`/superadmin/dashboard`) and Reports (`/superadmin/reports`) views in the SuperAdmin portal that default to `All Branches` (`GLOBAL_BRANCH`), include a sortable cross branch comparison table, and let me filter down to any individual branch.

**Acceptance criteria**:
* **AC-1**: `VerifyEmployeeJwt` in both `ticket-service` and `employee-service` preserves existing `first_name` and `last_name` values when JWT (JSON Web Token) claims omit name fields, and parses full `name` claims when `first_name` is absent, preventing blank name overwrites.
* **AC-2**: Before computing employee performance or dashboard workloads, `ticket-service` synchronizes staff profiles from the central Auth Module (`/api/internal/users-by-roles`) using a 60 second Redis lock (`employees_synced_lock`), marking unauthenticated seeded rows inactive (`is_active = 0`).
* **AC-3**: Employee Performance and Workload queries in `TicketDashboardService` and `AdminPerformanceService` strictly filter to `is_active = 1` and exclude non assignable roles (`superadmin`, `super admin`, `admin`, `it admin`, `customer service`, `head of cs`, `head of customer service`). All hardcoded fallback name arrays (`Mark Reyes`, `Ava Santos`, `Jose Cruz`, `Maria Dela Cruz`, `Carlo Tan`, `Anna Lim`) are removed.
* **AC-4**: When no active technicians or assigned tickets exist for the selected branch and period, the Employee Performance section renders the `EmptyStateCard` component rather than synthetic names or `Emp #ID` placeholders.
* **AC-5**: `GET /api/ticketing/ticket/admin/dashboard` returns unified `employee_performance` and `departments` arrays alongside `kpis`, `trends`, `status_distribution`, `sla`, `csat`, `workload`, and (when `branch_id=all`) `branch_comparisons`, allowing `AdminDashboard.jsx` to update all historical charts in 1 HTTP request per date filter change instead of 4.
* **AC-6**: Changing the historical date preset (`Today`, `Last 7 Days`, `Last 30 Days`, `Last 90 Days`, `Custom Range`) in `AdminDashboard.jsx` does not fetch `getAdminPredictiveInsights` again, which only reloads on initial mount, branch change, or ETL sync.
* **AC-7**: All internal CSAT (Customer Satisfaction) HTTP requests in `TicketDashboardService` and `AdminPerformanceService` use `env('ANALYTICS_SERVICE_URL', 'http://analytics-service:8000')` with a 1.5 second timeout and a 60 second Redis cache per branch and date window, eliminating the 2 second connection timeout against port `8004`.
* **AC-8**: `GET /api/ticketing/ticket/admin/reports` (and alias `/api/ticketing/ticket/admin-reports`) accepts `report_type` (`ticket_volume`, `sla_compliance`, `department_performance`, `equipment_maintenance`, `csat_satisfaction`, `predictive_risk`), `preset`, `date_from`, `date_to`, `department`, `priority`, and `branch_id`, returning live `headers`, `rows`, `summary`, `count`, and `has_data` within branch security boundaries.
* **AC-9**: `AdminReports.jsx` removes the `setTimeout(600)` simulation and all hardcoded mock rows (`TKT-1042`, `Carlos Tan`, `Maria Santos`, etc.), calling `getAdminReports` on preview generation and passing the live rows to CSV, Excel, and PDF export utilities.
* **AC-10**: When a report query matches 0 records, `AdminReports.jsx` displays a clear empty state message and disables export buttons until a query with data is generated.
* **AC-11**: `SidebarSuperAdmin.jsx` and `App.jsx` add `Dashboard` (`/superadmin/dashboard`) and `Reports` (`/superadmin/reports`) at the top of the SuperAdmin navigation, and `EmployeePortalGate` in `App.jsx` redirects authenticated SuperAdmin users to `/superadmin/dashboard` by default.
* **AC-12**: When a SuperAdmin views `/superadmin/dashboard` or `/superadmin/reports`, the view defaults to `All Branches` (`branch_id=all`) to show the whole organization, permits switching to any single branch via `BranchSelector`, and renders a sortable cross branch comparison table on `/superadmin/dashboard` when `All Branches` is selected.
* **AC-13**: Regular branch Admin users remain locked to their assigned branch on both `/admin/dashboard` and `/admin/reports`, receiving HTTP 403 Forbidden if a cross branch `branch_id` or `branch=all` parameter is supplied.

## Decision

**Chosen option**: Option 1: Fix in place by unifying the dashboard date filter payload, syncing real employee profiles from the central Auth Module with a 60 second Redis lock, wiring `AdminReports.jsx` to live report query builders in `ticket-service`, and mounting shared role aware Dashboard and Reports views under `/superadmin/dashboard` and `/superadmin/reports`.

**Implementation skills**: `laravel-microservice` (`local/laravel-microservice`, `.agents/skills/laravel-microservice/`) · `react-frontend` (`local/react-frontend`, `.agents/skills/react-frontend/`) · `api-testing` (`local/api-testing`, `.agents/skills/api-testing/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**:
No new database tables are required. The enhancement reuses existing tables in `ticket-service`:
* `employees`: `emp_id` (int PK), `first_name` (varchar, required), `last_name` (varchar, required), `email` (varchar, unique), `role` (varchar), `department` (varchar), `position_level` (varchar, nullable), `branch_id` (int, nullable, FK to `branches.id`), `branch` (varchar, nullable), `is_active` (boolean, default true), `last_synced_at` (timestamp, nullable).
* `branches`: `id` (int PK), `name` (varchar), `code` (varchar), `slug` (varchar, unique), `region` (varchar), `is_active` (boolean).
* `tickets`: `ticket_ID` (int PK), `ticket_number` (varchar, unique), `title` (varchar), `branch_id` (int, FK), `assigned_to` (int, nullable, FK to `employees.emp_id`), `requested_by` (int, nullable), `is_internal` (boolean), `ticket_status_ID` (int, FK), `priority_ID` (int, FK), `problem_category_ID` (int, FK), `machine_ID` (int, nullable, FK), `resolution_due_at` (timestamp, nullable), `resolved_at` (timestamp, nullable), `closed_at` (timestamp, nullable), `sla_status` (varchar, nullable), `created_at` (timestamp).
* `ticket_assignments`: `assignment_ID` (int PK), `ticket_ID` (int, FK), `employee_ID` (int, FK to `employees.emp_id`), `assigned_at` (timestamp), `completed_at` (timestamp, nullable).
* `branch_ticket_forecasts`: `id` (bigint PK), `branch_id` (int), `forecast_date` (date), `horizon_days` (int), `predicted_volume` (decimal), `lower_bound` (decimal), `upper_bound` (decimal), `calculation_status` (varchar).
* `branch_recurring_issue_trends`: `id` (bigint PK), `branch_id` (int), `issue_type` (varchar), `issue_id` (int), `issue_name` (varchar), `recent_count` (int), `baseline_count` (int), `growth_rate_pct` (decimal), `trend_direction` (varchar).

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/ticketing/ticket/admin/dashboard` | GET | `branch_id` (opt), `preset` (opt), `date_from` (opt), `date_to` (opt), `force_refresh` (opt) | `has_data`, `branch`, `period`, `kpis`, `trends`, `status_distribution`, `sla`, `employee_performance`, `departments`, `csat`, `workload`, `recurring_issues`, `branch_comparisons` (when SuperAdmin) | Bearer (`admin`, `superadmin`) | 401, 403 |
| `/api/ticketing/ticket/admin/reports` | GET | `report_type` (req), `branch_id` (opt), `preset` (opt), `date_from` (opt), `date_to` (opt), `department` (opt), `priority` (opt), `force_refresh` (opt) | `status`, `has_data`, `count`, `report_type`, `branch`, `period`, `headers`, `rows`, `summary`, `message` | Bearer (`admin`, `superadmin`) | 401, 403, 422 |
| `/api/ticketing/ticket/admin-reports/employees` | GET | `branch_id` (opt), `preset` (opt), `date_from` (opt), `date_to` (opt), `department` (opt), `employee_id` (opt) | `status`, `branch`, `employees`, `total_employees`, `active_employees` | Bearer (`admin`, `superadmin`) | 401, 403 |
| `/api/ticketing/ticket/admin-reports/departments` | GET | `branch_id` (opt), `preset` (opt), `date_from` (opt), `date_to` (opt), `sort_by` (opt), `sort_dir` (opt) | `status`, `branch`, `departments`, `total_departments` | Bearer (`admin`, `superadmin`) | 401, 403 |
| `/api/ticketing/ticket/admin-reports/predictive-insights` | GET | `branch_id` (opt), `horizon_days` (opt), `force_refresh` (opt) | `status`, `branch`, `volume_forecast`, `recurring_issues` | Bearer (`admin`, `superadmin`) | 401, 403 |

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| Render Employee Performance chart | Real technician full name (`first_name` + `last_name`) | `employees.first_name` and `employees.last_name` in `ticket-service`, synced from `auth-service` (`GET /api/internal/users-by-roles`) with 60s Redis lock and preserved by `VerifyEmployeeJwt` |
| Render Employee Performance chart | Active assignable technician list | `employees` table filtered by `is_active = 1`, branch scope, and role exclusion (`NOT IN ('superadmin', 'super admin', 'admin', 'it admin', 'customer service', 'head of cs', 'head of customer service')`) |
| Render Employee Performance chart | Tickets Resolved, Avg Response Time, Avg Resolution Time, SLA % per employee | Computed in `AdminPerformanceService::computeEmployeePerformanceData` from `tickets` (`assigned_to`) and `ticket_assignments` (`employee_ID`) within `[date_from, date_to]` |
| Change Dashboard Date Filter (`Today`, `Last 7 Days`, etc.) | Updated KPIs, trends, status distribution, SLA, employee performance, and department metrics | Single `GET /api/ticketing/ticket/admin/dashboard` response cached in Redis for 60s by `(branch_slug, preset, date_from, date_to)` |
| Fetch CSAT scores during dashboard or report load | Average CSAT score and per ticket ratings | Internal HTTP `GET http://analytics-service:8000/api/csat-stats` cached in Redis for 60s with 1.5s timeout fallback |
| Generate Report Preview in `AdminReports.jsx` | Tabular `headers`, `rows`, `summary`, and `count` for selected `report_type` | `TicketDashboardService::getAdminReports` querying live `tickets`, `employees`, `machines`, `problem_categories`, `branch_ticket_forecasts`, and `analytics-service` CSAT records |
| View SuperAdmin Dashboard (`/superadmin/dashboard`) | Whole organization metrics plus sortable cross branch comparison table | `AdminDashboard.jsx` defaulting via `BranchContext` to `GLOBAL_BRANCH` (`branch_id=all`) and rendering `branch_comparisons` returned by `TicketDashboardService` |
| View SuperAdmin Reports (`/superadmin/reports`) | Whole organization or per branch operational report preview and export | `AdminReports.jsx` mounted at `/superadmin/reports` with inline `BranchSelector` passing `branch_id` (`all` or branch ID) to `GET /api/ticketing/ticket/admin/reports` |

**Key invariants**:
* `VerifyEmployeeJwt` must never overwrite a non empty `employees.first_name` or `employees.last_name` with an empty string when the incoming JWT payload omits name claims.
* Seeded demo accounts (`cs@gmail.com`, `headofcs@gmail.com`, `employee@gmail.com`, `tech1@example.com`, `slosinada@gmail.com`) and hardcoded fallback arrays must never appear in Employee Performance or Workload charts once real Auth Module users are synced, and must be deactivated if not present in the Auth Module response.
* If the Auth Module internal sync endpoint is unreachable, `ticket-service` preserves existing active employee records in the local `employees` table rather than wiping or replacing them.
* Switching date presets on the dashboard triggers exactly 1 HTTP request (`GET /api/ticketing/ticket/admin/dashboard`), never 4 parallel requests, and never blocks on an uncached port `8004` timeout.
* Regular branch Admins are strictly locked to their assigned `user.branch_id` on the server side; only `superadmin` users may pass `branch_id=all` or inspect another branch.

**Security model**:
* All dashboard and report endpoints require `auth.subsystem` middleware and role verification (`admin` or `superadmin`).
* Regular `admin` callers are restricted to their own facility (`user.branch_id` / `user.branch`). Any request from a regular `admin` with `branch_id=all` or a foreign `branch_id` returns HTTP 403 Forbidden.
* `superadmin` callers are authorized to query `branch_id=all` (global system view) or any specific `branch_id` across both `/superadmin/dashboard` and `/superadmin/reports`.
* Internal employee synchronization with `auth-service` authenticates using the `X-Internal-Secret` header (`CMS_INTERNAL_SECRET` / `INTERNAL_SERVICE_SECRET`).

**Configuration required**:
* `ANALYTICS_SERVICE_URL`: internal Docker URL for `analytics-service`, defaulting to `http://analytics-service:8000`.
* `AUTH_SERVICE_INTERNAL_URL`: internal Docker URL for central Auth Module user sync, defaulting to `http://auth-service:8000`.

**Critical test scenarios**:
* Employee name preservation and sync: Authenticating with a JWT that omits `first_name` preserves the employee's real name in `employees`, and running the employee performance query after Auth Module sync returns only active assignable technicians with real names, verifying **AC-1**, **AC-2**, **AC-3**, and **AC-4**.
* Fast single request date filter: Switching the dashboard preset from `Last 7 Days` to `Today` in `AdminDashboard.jsx` issues a single `GET /api/ticketing/ticket/admin/dashboard` call that returns KPIs, trends, employee performance, and department metrics without fetching predictive insights again or timing out on port `8004`, verifying **AC-5**, **AC-6**, and **AC-7**.
* Live operational report preview and export: Selecting each of the 6 report types in `AdminReports.jsx` (`ticket_volume`, `sla_compliance`, `department_performance`, `equipment_maintenance`, `csat_satisfaction`, `predictive_risk`) fetches live database rows via `GET /api/ticketing/ticket/admin/reports` and handles 0 row periods with an empty state, verifying **AC-8**, **AC-9**, and **AC-10**.
* SuperAdmin global dashboard and reports: Logging in as `superadmin` redirects to `/superadmin/dashboard`, displays `Dashboard` and `Reports` in `SidebarSuperAdmin`, defaults to `All Branches` with a cross branch comparison table, and allows filtering by any branch on both `/superadmin/dashboard` and `/superadmin/reports`, verifying **AC-11** and **AC-12**.
* Branch isolation enforcement: A regular branch Admin requesting `GET /api/ticketing/ticket/admin/reports?branch_id=all` or another branch ID receives HTTP 403 Forbidden, verifying **AC-13**.

## Build plan

The build follows an end to end Tracer Bullet approach across backend identity sync, unified dashboard speed, live reports, and SuperAdmin portal views:

1. [x] Update `VerifyEmployeeJwt.php` in `services/ticket-service/app/Http/Middleware/` and `services/employee-service/app/Http/Middleware/` so existing `first_name` and `last_name` columns are never overwritten by empty strings and full `name` claims are split into first and last names when needed, satisfies **AC-1**.
2. [x] Add `syncEmployeesFromAuthModule()` helper in `services/ticket-service/app/Services/TicketDashboardService.php` (using a 60s Redis lock `employees_synced_lock` against `http://auth-service:8000/api/internal/users-by-roles`, parsing `first_name`, `last_name`, `name`, `department`, `role`, and `branch`, and deactivating seeded demo emails not in Auth Module), and invoke it before employee performance and workload queries, satisfies **AC-2**, **AC-3**.
3. [x] Update `AdminPerformanceService.php` and `TicketDashboardService.php` to filter employees strictly by `is_active = 1` and assignable technician roles, compute real average response and resolution times from ticket timestamps instead of `rand()`, remove the hardcoded `$defaultNames` fallback array, and fix `fetchCsatByTicketIds` to use `http://analytics-service:8000` with a 1.5s timeout and 60s Redis cache, satisfies **AC-3**, **AC-4**, **AC-7**.
4. [x] Enhance `TicketDashboardService::getAdminDashboard` to embed the live `employee_performance` records, `departments` summary, and (when `branch->slug === 'all'` or caller is SuperAdmin) `branch_comparisons` table in a single response, and update `AdminDashboard.jsx` so changing date filters (`Today`, `Last 7 Days`, etc.) makes 1 request to `getAdminDashboard` while `getAdminPredictiveInsights` is decoupled into its own effect tied only to branch changes, satisfies **AC-5**, **AC-6**, **AC-12**.
5. [x] Implement live report dataset extraction in `TicketDashboardService::getAdminReports` and `TicketDashboardController::adminReports` for all 6 report types (`ticket_volume`, `sla_compliance`, `department_performance`, `equipment_maintenance`, `csat_satisfaction`, `predictive_risk`) with `department`, `priority`, `preset`, `date_from`, `date_to`, and server side `branch_id` scoping, satisfies **AC-8**, **AC-13**.
6. [x] Refactor `frontend/web/src/pages/AdminReports.jsx` and `frontend/web/src/services/ticketService.js` to call `GET /api/ticketing/ticket/admin/reports` when generating previews, remove all mock arrays and `setTimeout` delays, add an inline `BranchSelector` so SuperAdmin can switch between `All Branches` and any specific facility, and wire CSV, Excel, and PDF export actions to the live preview dataset, satisfies **AC-9**, **AC-10**, **AC-12**.
7. [x] Update `frontend/web/src/components/SidebarSuperAdmin.jsx`, `frontend/web/src/App.jsx`, and `frontend/web/src/pages/AdminDashboard.jsx` to register `/superadmin/dashboard` and `/superadmin/reports`, set `/superadmin/dashboard` as the default SuperAdmin landing route in `EmployeePortalGate`, and render the sortable cross branch comparison table when SuperAdmin views `All Branches`, satisfies **AC-11**, **AC-12**.
8. [x] Add and run automated backend feature tests in `services/ticket-service/tests/Feature/AdminReportsTest.php` and frontend unit tests in `frontend/web/src/pages/AdminDashboard.test.jsx` covering real employee name filtering, single request date filter updates, live report previews across all 6 report types, SuperAdmin global views, and HTTP 403 branch isolation, satisfies **AC-1** through **AC-13**.

## Consequences

**Positive**:
* Both Admin and SuperAdmin dashboards display real technician names synced from the central Auth Module instead of fake seeded names or `Emp #ID` labels.
* Switching date filters (`Today`, `Last 7 Days`, `Last 30 Days`, `Last 90 Days`) completes in a single fast request without 2 second internal HTTP timeouts or redundant forecast queries.
* The Reports tab produces genuine operational previews and exports across all six report categories for both single branches and the entire organization.
* SuperAdmin has dedicated Dashboard and Reports views in their own sidebar with global `All Branches` visibility and branch level comparison.

**Negative / tradeoffs**:
* Embedding `employee_performance`, `departments`, and `branch_comparisons` into `GET /api/ticketing/ticket/admin/dashboard` slightly increases the JSON payload size of that endpoint (mitigated by 60 second Redis caching and eliminating 3 extra HTTP round trips).
* When the central Auth Module sync lock expires every 60 seconds, the first dashboard request performs a lightweight internal HTTP fetch to `auth-service` (capped at a 2 second timeout with immediate fallback to existing database rows).

**Neutral**:
* Existing standalone endpoints (`/api/ticketing/ticket/admin-reports/employees` and `/api/ticketing/ticket/admin-reports/departments`) remain available for direct API callers and drill down views.

## Follow-up

* [ ] Verify that all branches configured in the central Auth Module have matching `slug` or `name` entries in the `ticket-service` `branches` table so synced employees map cleanly to their facility `branch_id`.
