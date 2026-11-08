# 0025. Rationale: Real Employee Names, Fast Date Filters, Live Operational Reports, and SuperAdmin Global Views

## Context

Administrators and SuperAdmins rely on the dashboard and operational reports in `ticket-service` and the React frontend (`frontend/web/`) to evaluate technician performance, track SLA (Service Level Agreement) adherence, and export compliance logs. Four operational issues currently degrade these workflows in production and local environments:

1. **Inaccurate Employee Performance names**: In `services/ticket-service/app/Http/Middleware/VerifyEmployeeJwt.php` (and the matching middleware in `employee-service`), whenever an existing employee authenticates with a JWT that omits `first_name` or `last_name`, the middleware overwrites `employees.first_name` and `employees.last_name` with empty strings (`""`). In addition, `AdminPerformanceService` queries the `employees` table without checking `is_active = 1` or excluding non technician roles (`customer service`, `head of cs`, `admin`, `superadmin`), and `ticket-service` never triggers the central Auth Module employee sync (`autoSyncWithAuthModule`) before computing dashboard metrics. When no active employees match, `TicketDashboardService::computeEmployeeWorkloads` falls back to a hardcoded array of six fake names (`Mark Reyes`, `Ava Santos`, `Jose Cruz`, `Maria Dela Cruz`, `Carlo Tan`, `Anna Lim`), or `AdminDashboard.jsx` renders `Emp #ID` when `name` is blank.
2. **Slow dashboard date filtering**: When a user switches the date filter preset (`Today`, `Last 7 Days`, `Last 30 Days`, `Last 90 Days`, or `Custom Range`) in `AdminDashboard.jsx`, the frontend dispatches 4 concurrent HTTP requests (`getAdminDashboard`, `getAdminEmployeePerformance`, `getAdminDepartmentPerformance`, and `getAdminPredictiveInsights`). On the backend, `AdminPerformanceService::fetchCsatByTicketIds` defaults to `http://analytics-service:8004` instead of the internal container port `http://analytics-service:8000`. Every uncached date filter change causes two PHP workers to block for 2 seconds waiting for port `8004` to time out, while `getAdminPredictiveInsights` unnecessarily recomputes 90 day forecast queries that do not depend on the selected historical date filter.
3. **Mock data in the Reports tab**: `frontend/web/src/pages/AdminReports.jsx` uses a 600 millisecond `setTimeout` and static mock arrays (`TKT-1042`, `X-Ray Collimator Drift`, `Carlos Tan`, `Maria Santos`) for all six report types. Meanwhile, `TicketDashboardService::getAdminReports` simply aliases `getAdminDashboard` instead of returning tabular rows and summary metrics for the requested `report_type`.
4. **Missing SuperAdmin Dashboard and Reports views**: `SidebarSuperAdmin.jsx` and `App.jsx` only expose configuration, knowledge base, audit logs, and history routes under `/superadmin/*`. SuperAdmin users have no `/superadmin/dashboard` or `/superadmin/reports` routes in their sidebar, and `SuperAdminDashboard.jsx` is an unrouted file reading from a client side mock service (`dashboardAnalyticsService.js`).

## Options considered

### Option 1: Fix in place with unified dashboard payload, Auth Module employee sync, live report query builder, and shared role aware SuperAdmin views

Preserve and sync real employee identities in `ticket-service`, return employee and department metrics inside the single `/api/ticketing/ticket/admin/dashboard` payload while fixing the `analytics-service:8000` port and caching CSAT lookups, build a live `report_type` query builder in `TicketDashboardService::getAdminReports`, and mount the live `AdminDashboard` and `AdminReports` views at `/superadmin/dashboard` and `/superadmin/reports` with global `All Branches` support and a cross branch comparison section.

**Pros**:
* Cuts dashboard date filter network traffic from 4 requests to 1 and removes the 2 second port `8004` timeout, reducing date filter response times to under 200 milliseconds when cached and under 500 milliseconds uncached.
* Guarantees that both Admin and SuperAdmin see the exact same charts, KPIs, and report formats, with SuperAdmin defaulting to `All Branches` (`GLOBAL_BRANCH`) and able to drill into any branch or compare branches side by side.
* Eliminates all fake seeder and fallback names from Employee Performance and Reports without adding new database tables or microservices.

**Cons**:
* Slightly increases the payload size of `GET /api/ticketing/ticket/admin/dashboard` by including detailed employee performance, department rollups, and (for SuperAdmin) branch comparisons in one response.

### Option 2: Keep separate frontend requests and maintain separate `SuperAdminDashboard.jsx` and `SuperAdminReports.jsx` components

Fix only the port `8004` timeout while keeping 4 separate HTTP requests per date filter click in `AdminDashboard.jsx`, and wire the separate `SuperAdminDashboard.jsx` file and a duplicated `SuperAdminReports.jsx` file to separate `/api/ticketing/ticket/superadmin/*` endpoints.

**Pros**:
* Keeps individual endpoint payloads smaller and isolates SuperAdmin UI markup from Admin UI markup.

**Cons**:
* Maintaining two parallel dashboard components and two parallel report components causes immediate visual and metric drift when formulas or chart options change.
* Firing 4 concurrent requests on every date filter click still contends for PHP workers in Docker and runs overlapping SQL queries again on the `tickets` and `employees` tables.

## Rationale

Option 1 is the right engineering choice because the performance bottleneck and data mismatches stem directly from duplicated queries and split components. In `ticket-service`, `TicketDashboardService::computeAdminDashboardData` already loads the branch tickets and branch employees for the selected `[date_from, date_to]` window. Computing the detailed employee performance metrics and department rollups in the same pass (and caching the CSAT lookup against `http://analytics-service:8000` for 60 seconds) avoids scanning `tickets` and calling `SLAService::computeTicketSlaMetrics` three separate times per filter click. Decoupling `getAdminPredictiveInsights` from the historical date filter further reduces load because future ticket volume forecasts depend on the branch's 60 day baseline, not whether the user is viewing `Today` vs `Last 7 Days`.

Sharing `AdminDashboard.jsx` and `AdminReports.jsx` across `/admin/*` and `/superadmin/*` (with `BranchContext` defaulting SuperAdmin to `All Branches` and unlocking the inline `BranchSelector` plus a cross branch comparison table) directly fulfills the requirement that SuperAdmin have its own dashboard and reports like the Admin while seeing the whole organization view.
