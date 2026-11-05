# 0023. Admin Dashboard Live Data Integration Branch Scoping and Synchronous ETL Pipeline

**Date**: 2026-11-01
**Status**: In Progress

## Summary

This specification establishes full live data integration for the Admin Dashboard, enforces role based branch selection scoping, and introduces a dedicated synchronous ETL sync endpoint. It replaces all hardcoded and seeded mock arrays across charts and metric cards with live feeds from ticket service. SuperAdmins can evaluate all facilities combined or isolate any specific branch, while regular branch Admins are locked strictly to their assigned facility. Clicking the Sync ETL button now triggers a live recalculation of forecasts and cached aggregations, returning processed counts and duration immediately.

## Requirements

**User stories**:
- As a SuperAdmin, I want to toggle between All Branches and any specific physical branch in the Admin Dashboard, so that I can evaluate global organizational performance or drill down into one facility.
- As a branch Admin, I want my dashboard automatically restricted to my assigned branch without access to other facilities, so that data privacy and organizational boundaries are preserved.
- As an Admin, I want all dashboard charts, status distribution bars, SLA percentages, and employee workload distributions populated from real database records, so that management decisions rely on verified facts.
- As an Admin, I want an explicit empty state when my branch has no recorded tickets in a date range, so that I am never misled by zero duration or false compliance figures.
- As an Admin, I want to trigger a synchronous ETL sync by clicking the toolbar button, so that forecasting models and dashboard aggregates recalculate immediately without waiting for overnight batch schedules.

**Acceptance criteria**:
- **AC-1**: SuperAdmin users see All Branches as the primary option in the inline branch selector alongside all active physical branches.
- **AC-2**: Non superadmin Admin users are locked strictly to their assigned branch. The branch selector displays their facility name as static text or a disabled single option pill, rejecting attempts to query other branches.
- **AC-3**: When SuperAdmin selects All Branches, the dashboard queries tickets across all facilities combined without applying branch filters, displaying system wide counts and rates.
- **AC-4**: All chart components (Ticket Trends, Status Distribution, SLA Compliance, SLA Breaches, Resolution Times, Technician Performance, Department Workload) render live data fetched from `/api/ticketing/ticket/admin/dashboard` and `/api/ticketing/ticket/admin-reports/*`.
- **AC-5**: All static mock datasets (ticketTrendsMock, ticketStatusMock, slaComplianceMock, slaBreachesMock, empResolvedMock, csatScoresMock, workloadByDeptMock, EMPLOYEES, DEPARTMENTS) are completely removed from the Admin Dashboard codebase.
- **AC-6**: When a branch has zero tickets recorded in the selected date range, the dashboard displays a clear empty state card stating that no ticket activity is recorded for this period, disabling misleading chart curves.
- **AC-7**: A dedicated `POST /api/ticketing/ticket/etl/trigger` endpoint in ticket service executes synchronous recalculation of forecasts and cached dashboard aggregations.
- **AC-8**: Clicking Run Incremental ETL or Full ETL Sync in the frontend triggers `POST /api/ticketing/ticket/etl/trigger`, displaying a progress indicator and reporting processed records and execution duration upon completion.

## Decision

**Chosen option**: Option 1: Fix in place with live endpoint wiring, role based branch scoping, and synchronous ETL route.

**Implementation skills**: `laravel-microservice` (`.agents/skills/laravel-microservice/`), `react-frontend` (`.agents/skills/react-frontend/`), `docker-runbook` (`.agents/skills/docker-runbook/`).

## Feature design

### Data model sketch

No new database tables are required. The feature leverages existing tables:
- `branches`: `id`, `name`, `code`, `slug`, `region`, `is_active`
- `tickets`: `ticket_ID`, `branch_id`, `created_at`, `resolved_at`, `ticket_status_ID`, `assigned_to`
- `branch_ticket_forecasts`: `branch_id`, `forecast_date`, `predicted_volume`, `calculation_status`
- `forecast_job_runs`: `job_name`, `branch_id`, `status`, `records_processed`, `duration_ms`

### API surface

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/ticketing/ticket/admin/dashboard` | GET | `branch_id` (opt), `preset`, `date_from`, `date_to`, `force_refresh` | `kpis`, `status_distribution`, `sla`, `trends`, `workload` | Bearer Token (Admin, SuperAdmin) | 401, 403 |
| `/api/ticketing/ticket/admin-reports/employees` | GET | `branch_id` (opt), `preset`, `department`, `employee_id` | `employees` list, `summary`, `has_data`, `period_status` | Bearer Token (Admin, SuperAdmin) | 401, 403 |
| `/api/ticketing/ticket/admin-reports/departments` | GET | `branch_id` (opt), `preset`, `sort_by`, `sort_dir` | `departments` list, `summary`, `workload_distribution` | Bearer Token (Admin, SuperAdmin) | 401, 403 |
| `/api/ticketing/ticket/admin-reports/predictive-insights` | GET | `branch_id` (opt), `horizon_days`, `force_refresh` | `volume_forecast`, `recurring_issues`, `status` | Bearer Token (Admin, SuperAdmin) | 401, 403 |
| `/api/ticketing/ticket/etl/trigger` | POST | `full_sync` (bool), `branch_id` (opt) | `status`, `message`, `records_processed`, `duration_ms`, `timestamp` | Bearer Token (Admin, SuperAdmin) | 401, 403 |

### Value sourcing

| Action | Value produced / displayed | Source |
|---|---|---|
| Load Admin Dashboard | Ticket Trend lines (New, Resolved) | Computed from `tickets` table grouped by date slice in TicketDashboardService |
| Load Admin Dashboard | Ticket Status horizontal bar | Grouped counts of `tickets.ticket_status_ID` in TicketDashboardService |
| Load Admin Dashboard | SLA Compliance and Breaches | Evaluated by SLAService against each ticket in the period |
| Load Admin Dashboard | Technician performance cards | Aggregated Assigned Employee capacity records in AdminPerformanceService |
| Load Admin Dashboard | Department workload bars | Tickets per active technician rollup in AdminPerformanceService |
| Select Branch | Allowed branch scope list | SuperAdmin receives `GLOBAL_BRANCH` plus all active branches; Admin receives only assigned branch |
| Run Sync ETL | Processed records and duration | Output of `TicketForecastService::calculateAndPersistAllBranches` and Redis cache clearance |

### Key invariants

- SuperAdmin can request any specific branch or `branch_id=all` (global system scope).
- Regular Admin requests are strictly scoped to their assigned `user.branch_id`. Any query parameter attempting to set another branch is overridden by the server, or rejected with HTTP 403.
- When `branch_id=all` is active, `applyBranchTicketFilter` does not add `where branch_id = ...`, allowing cross branch aggregation.
- If a date range contains zero ticket records, the response explicitly sets `has_data: false`, and the UI renders an informative empty card rather than zeroed line plots.
- The ETL trigger executes synchronously, invalidates the dashboard Redis cache keys, precomputes forecasts, and returns in under 500 milliseconds.

### Security model

- Endpoints are protected by `auth.subsystem` and require role `admin` or `superadmin`.
- SuperAdmin authorization permits unrestricted facility switching.
- Admin authorization restricts data reads and ETL scopes to the user branch. Cross branch tampering attempts return 403 Forbidden.

### Critical test scenarios

- Happy path: SuperAdmin selects All Branches and receives aggregate ticket trends, department rollups, and system wide forecasts, verifying **AC-1**, **AC-3**, and **AC-4**.
- Branch isolation: Regular Admin assigned to Branch A attempts to query Branch B; the server returns HTTP 403 Forbidden, and the UI displays only Branch A, verifying **AC-2**.
- Empty period: Querying a date window with no tickets returns an explicit empty state with no broken charts or deceptive zero duration, verifying **AC-6**.
- Synchronous ETL: Triggering `POST /api/ticketing/ticket/etl/trigger` returns HTTP 200 with record count and duration, refreshing dashboard caches, verifying **AC-7** and **AC-8**.
- Mock data elimination: Verifying that searching for `ticketTrendsMock` or `EMPLOYEES` in `AdminDashboard.jsx` yields zero occurrences, verifying **AC-5**.

## Build plan

- [x] 1. Implement `POST /api/ticketing/ticket/etl/trigger` in `TicketDashboardController.php` and register route in `services/ticket-service/routes/api.php`, satisfies **AC-7**.
- [x] 2. Enhance `resolveBranchScope` and `applyBranchTicketFilter` in `TicketDashboardService.php` and `AdminPerformanceService.php` to support `slug === 'all'` for SuperAdmins and enforce branch locking for regular Admins, satisfies **AC-1**, **AC-2**, **AC-3**.
- [x] 3. Update `BranchSelector.jsx` inline variant to map over `branchList` (including `GLOBAL_BRANCH`) for SuperAdmin, and display a locked single facility indicator for regular Admins, satisfies **AC-1**, **AC-2**.
- [x] 4. Wire `AdminDashboard.jsx` to live endpoints (`/api/ticketing/ticket/admin/dashboard`, `/api/ticketing/ticket/admin-reports/*`), replacing all mock arrays with live data transformers, satisfies **AC-4**, **AC-5**.
- [x] 5. Add explicit empty state rendering across dashboard sections when `has_data` is false or ticket count is zero, satisfies **AC-6**.
- [x] 6. Wire the ETL Sync dropdown buttons in `AdminDashboard.jsx` and `SuperAdminDashboard.jsx` to call `/api/ticketing/ticket/etl/trigger` synchronously, satisfies **AC-8**.
- [x] 7. Write automated feature tests in `services/ticket-service/tests/Feature/AdminReportsTest.php` and component tests to verify All Branches scope, branch locking, live ETL trigger, and empty state contracts, satisfies **AC-1**, **AC-2**, **AC-7**.

## Consequences

**Positive**:
- Admin and SuperAdmin users see accurate, verified operational figures instead of fabricated placeholder data.
- System wide visibility is unlocked for SuperAdmins while maintaining strict data boundaries for local facility managers.
- Administrators can trigger an immediate ETL recalculation without encountering 404 errors or waiting for midnight cron jobs.

**Negative / tradeoffs**:
- Live chart rendering depends on microservice responsiveness. Initial page load requires fetching real database queries rather than instant in memory constants (mitigated by 60 to 120 second Redis caching).

**Neutral**:
- Older cached keys in Redis will be invalidated upon first ETL trigger.

## Follow-up

- [ ] Verify Nginx reverse proxy configuration ensures `/api/ticketing/ticket/etl/trigger` passes cleanly to FastCGI socket.
- [ ] Align Excel and PDF export routines in `reportExportUtils.js` to format live dataset rows rather than mock properties.

