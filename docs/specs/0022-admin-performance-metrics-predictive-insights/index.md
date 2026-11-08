# 0022. Admin Performance Metrics and Predictive Insights Backend

**Date**: 2026-11-01
**Status**: Accepted

## Summary

This specification establishes an administrative reporting and predictive analytics backend in ticket service. It delivers individual employee performance metrics, aggregated department productivity figures, and predictive ticket volume forecasts with recurring issue trend detection. All data queries enforce strict server side branch scoping, reuse established service level agreement and customer satisfaction calculations, persist daily batch forecasts for sub second queries, and cleanly distinguish no recorded activity from zero values.

## Requirements

**User stories**:
- As an Admin, I want to view individual performance metrics for the Assigned Employee capacity (Resolution Rate, Average Resolution Time, SLA Compliance Rate, Reassignment Rate, and CSAT), so that performance can be tracked and evaluated objectively.
- As an Admin, I want to see aggregated department level performance metrics (total tickets handled, average resolution time, SLA compliance, average CSAT, open and overdue counts, workload distribution), so that I can assess team productivity and service quality.
- As an Admin, I want predictive insights on future ticket volume and recurring issue patterns, so that I can proactively plan staffing and address systemic problems.

**Acceptance criteria**:
- **AC-1**: The system exposes a branch scoped API endpoint at GET `/api/ticketing/ticket/admin-reports/employees` returning individual and comparative employee performance metrics (resolution rate, average resolution time in hours, SLA compliance rate, reassignment rate, and average CSAT rating).
- **AC-2**: The reassignment rate for an assigned employee is calculated as total approved reassignment requests originating from that employee divided by total tickets assigned to that employee during the period, multiplied by 100.
- **AC-3**: All individual performance metrics strictly evaluate tickets where the employee held the Assigned Employee capacity (`tickets.assigned_to` or active `ticket_assignments.employee_ID`), excluding tickets where the employee was solely the requester or creator on internal tickets (`tickets.requested_by` or `created_by` with `is_internal = true`).
- **AC-4**: When an employee or department has zero ticket activity within the selected date window, the API returns explicit null metric values accompanied by `has_data: false` and `period_status: "no_data"`, distinguishing inactivity from a true zero value.
- **AC-5**: Server side branch scoping is strictly enforced on all queries using the authenticated employee branch record (`branch_id` or `branch`), rejecting client parameter tampering and returning HTTP 403 for unauthorized cross branch attempts.
- **AC-6**: Underneath all reporting queries, composite database indexes on tickets and assignments optimize filtering by branch, assigned employee, status, and creation timestamps.
- **AC-7**: The system exposes a branch scoped API endpoint at GET `/api/ticketing/ticket/admin-reports/departments` returning department level aggregated metrics (total tickets handled, average resolution time, SLA compliance rate, average CSAT, open count, overdue count, and workload distribution).
- **AC-8**: Department level aggregations roll up ticket and employee data accurately, reusing `SLAService::computeTicketSlaMetrics` and CSAT ratings fetched from analytics service.
- **AC-9**: Open tickets are classified as non closed and non resolved tickets, while overdue tickets are classified as open tickets whose resolution deadline has breached according to `SLAService`.
- **AC-10**: Department workload distribution calculates the count and percentage share of active unresolved tickets assigned to each employee within that department.
- **AC-11**: The department list supports server side sorting across all aggregated metric columns (`sort_by` and `sort_dir`).
- **AC-12**: Department drill down into individual employee metrics reuses the employee performance endpoint logic filtered by department name or identifier.
- **AC-13**: The system exposes a branch scoped API endpoint at GET `/api/ticketing/ticket/admin-reports/predictive-insights` returning forecasted daily ticket volume trends and recurring issue trend detections with historical data basis transparency.
- **AC-14**: Volume forecasting computes daily projections using a 7 day weighted moving average with day of week seasonality adjustment across future horizons.
- **AC-15**: A minimum historical threshold of 14 days of ticket records in the branch is required before generating a forecast. If historical data falls below 14 days, the endpoint returns an informative fallback response with `calculation_status: "insufficient_data"` and the count of available historical days.
- **AC-16**: Recurring issue trend detection compares category and machine frequencies in the recent period (past 14 days) against a historical baseline period (preceding 30 to 60 days), calculating percentage growth and direction signals (increasing, stable, decreasing).
- **AC-17**: A scheduled console command (`tickets:calculate-forecasts`) executes daily via Laravel Scheduler, precomputing and persisting forecasts in `branch_ticket_forecasts` and `branch_recurring_issue_trends` tables.
- **AC-18**: Forecast calculation job execution health is logged in the `forecast_job_runs` table, capturing start time, duration, status, records processed, and error messages, alerting on failure.

## Decision

**Chosen option**: Option 2: Dedicated Persistence Tables with Daily Batch Calculation and Internal Microservice Reuse. See [rationale.md](rationale.md) for full context and options considered.

**Implementation skills**: `laravel-microservice` (`antigravity/laravel-microservice`, `.agents/skills/laravel-microservice/`)

## Feature design

**Data model sketch**:

Table `branch_ticket_forecasts`:
- `id`: bigIncrements, unsigned, primary key
- `branch_id`: foreignId constrained to `branches.id`, indexed
- `forecast_date`: date, indexed with `branch_id` (unique composite index)
- `predicted_volume`: integer, non negative
- `lower_bound`: integer, non negative
- `upper_bound`: integer, non negative
- `historical_days_used`: integer
- `calculation_status`: string (`success`, `insufficient_data`)
- `calculated_at`: timestamp
- `created_at`, `updated_at`: timestamps

Table `branch_recurring_issue_trends`:
- `id`: bigIncrements, unsigned, primary key
- `branch_id`: foreignId constrained to `branches.id`, indexed
- `issue_type`: string (`category`, `machine`), indexed
- `item_id`: unsignedBigInteger, reference identifier
- `item_name`: string
- `recent_frequency`: integer
- `baseline_frequency`: decimal(8, 2)
- `change_percentage`: decimal(8, 2)
- `trend_signal`: string (`increasing`, `stable`, `decreasing`)
- `calculated_at`: timestamp
- `created_at`, `updated_at`: timestamps

Table `forecast_job_runs`:
- `id`: bigIncrements, unsigned, primary key
- `job_name`: string
- `branch_id`: unsignedBigInteger, nullable, indexed
- `status`: string (`success`, `failed`, `insufficient_data`)
- `records_processed`: integer
- `duration_ms`: integer
- `error_message`: text, nullable
- `completed_at`: timestamp
- `created_at`, `updated_at`: timestamps

Optimizing composite indexes on `tickets`:
- `idx_tickets_branch_assigned_created`: `(branch_id, assigned_to, created_at)`
- `idx_tickets_branch_cat_created`: `(branch_id, problem_category_ID, created_at)`
- `idx_tickets_branch_mach_created`: `(branch_id, machine_ID, created_at)`

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/ticketing/ticket/admin-reports/employees` | GET | `preset`: string (opt), `date_from`: date (opt), `date_to`: date (opt), `department`: string (opt), `employee_id`: int (opt) | `employees`: array of employee metric records, `branch`: object, `summary`: object | `auth.subsystem` (role: admin, superadmin) | 401 Unauthorized, 403 Forbidden |
| `/api/ticketing/ticket/admin-reports/departments` | GET | `preset`: string (opt), `date_from`: date (opt), `date_to`: date (opt), `sort_by`: string (opt), `sort_dir`: string (opt) | `departments`: array of department records, `workload_distribution`: object, `branch`: object | `auth.subsystem` (role: admin, superadmin) | 401 Unauthorized, 403 Forbidden |
| `/api/ticketing/ticket/admin-reports/predictive-insights` | GET | `preset`: string (opt), `horizon_days`: int (opt, default 7) | `volume_forecast`: array of daily projections, `recurring_issues`: array of trends, `historical_basis`: object, `status`: string | `auth.subsystem` (role: admin, superadmin) | 401 Unauthorized, 403 Forbidden |

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| Fetch employee metrics | Resolution Rate | `(resolved tickets / assigned tickets) * 100`, or null if assigned tickets = 0 |
| Fetch employee metrics | Average Resolution Time | Average of `resolved_at - created_at` in hours for resolved tickets where `assigned_to = employee_id` |
| Fetch employee metrics | SLA Compliance Rate | `SLAService::computeTicketSlaMetrics` applied to assigned tickets, percent compliant |
| Fetch employee metrics | Reassignment Rate | `(approved reassignment requests / assigned tickets) * 100` from `reassignment_requests` |
| Fetch employee metrics | CSAT Average | Analytics service `/api/csat-stats` filtered by ticket identifiers, or null if no ratings |
| Fetch department metrics | Total Tickets Handled | Count of distinct tickets assigned to staff in department during date range |
| Fetch department metrics | Open Count | Tickets in department where status not in `Closed`, `Resolved`, `Discarded`, `Cancelled` |
| Fetch department metrics | Overdue Count | Open department tickets where resolution deadline passed per `SLAService` |
| Fetch department metrics | Workload Distribution | Active assigned tickets per employee in department divided by total active department tickets |
| Fetch predictive insights | Daily Predicted Volume | 7 day weighted moving average with day of week seasonality from `branch_ticket_forecasts` |
| Fetch predictive insights | Recurring Issue Growth | `(recent_frequency - baseline_frequency) / baseline_frequency * 100` from `branch_recurring_issue_trends` |
| Fetch predictive insights | Historical Days Basis | Count of distinct past calendar days with recorded tickets in branch |

**Key invariants**:
- Branch scoping is immutable: the server resolves branch boundaries directly from `$user->branch_id` or `$user->branch`. SuperAdmin users may supply an explicit `branch_id`, but regular Admins cannot query outside their branch.
- Reassignment Rate counts only approved requests originating from the employee (`status = 'approved'` and `employee_id = emp_id`). Denied or pending requests do not count as surrendered tickets.
- Internal ticket creator activity (`is_internal = true` and `requested_by = emp_id`) is strictly excluded from technician performance metrics.
- A period with no tickets returns `has_data: false`, `period_status: "no_data"`, and `null` for numerical rate fields. It must never return `0.0`.
- Forecast calculations abort gracefully with `calculation_status: "insufficient_data"` whenever historical ticket span is under 14 days.

**Security model**:
- Role authorization requires `admin`, `superadmin`, or `systemadministrator` tokens validated through `auth.subsystem` middleware.
- Unauthorized roles (such as standard technicians or external clients) receive HTTP 403 Forbidden.
- Cross branch query tampering is blocked server side: if a non superadmin supplies a conflicting `branch_id`, the system ignores it and binds strictly to the authenticated employee branch.

**Configuration required**:
- `ANALYTICS_SERVICE_URL`: URL of the analytics microservice for CSAT ratings (default: `http://analytics-service:8004`).
- No new external secrets or third party API keys required.

## Build plan

- [x] Create database migration in `services/ticket-service/database/migrations` for tables `branch_ticket_forecasts`, `branch_recurring_issue_trends`, `forecast_job_runs`, and composite query performance indexes on `tickets`, satisfies **AC-6**, **AC-17**, **AC-18**.
- [x] Create Eloquent models `BranchTicketForecast`, `BranchRecurringIssueTrend`, and `ForecastJobRun` in `services/ticket-service/app/Models`, satisfies **AC-17**, **AC-18**.
- [x] Implement `AdminPerformanceService` in `services/ticket-service/app/Services/AdminPerformanceService.php`:
  - [x] Implement `getEmployeePerformanceMetrics` with Assigned Employee capacity filter, approved reassignment rate, SLAService reuse, CSAT HTTP fetch, and null no data response, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-5**.
  - [x] Implement `getDepartmentPerformanceMetrics` with aggregation rollup, Open vs Overdue classification, workload distribution, and sorting support, satisfies **AC-7**, **AC-8**, **AC-9**, **AC-10**, **AC-11**, **AC-12**.
- [x] Implement `TicketForecastService` in `services/ticket-service/app/Services/TicketForecastService.php`:
  - [x] Implement 7 day weighted moving average with seasonality adjustment, satisfies **AC-14**.
  - [x] Implement minimum historical data threshold check (14 days) and insufficient data response, satisfies **AC-15**.
  - [x] Implement recurring issue trend calculation comparing recent 14 day frequency to baseline, satisfies **AC-16**.
  - [x] Implement `calculateAndPersistBranchForecasts` with execution timing and error capture to `forecast_job_runs`, satisfies **AC-17**, **AC-18**.
  - [x] Implement `getPredictiveInsights` to serve persisted forecast data with sub second response times, satisfies **AC-13**, **AC-15**.
- [x] Create Artisan console command `CalculateTicketForecastsCommand` in `services/ticket-service/app/Console/Commands/CalculateTicketForecastsCommand.php` and schedule it daily in `app/Console/Kernel.php`, satisfies **AC-17**, **AC-18**.
- [x] Implement `AdminReportController` in `services/ticket-service/app/Http/Controllers/AdminReportController.php` with actions `employeePerformance`, `departmentPerformance`, and `predictiveInsights`, satisfies **AC-1**, **AC-7**, **AC-13**.
- [x] Register routes in `services/ticket-service/routes/api.php` under `auth.subsystem` with strict role verification for Admin and SuperAdmin, satisfies **AC-1**, **AC-5**, **AC-7**, **AC-13**.
- [x] Write comprehensive automated test suite in `services/ticket-service/tests/Feature/AdminReportsTest.php` covering happy paths, security branch scoping, empty periods, reassignment rates, department rollups, and forecast thresholds, satisfies **AC-1** through **AC-18**.

## Consequences

**Positive**:
- Objective, fair evaluation of employee technical capacity without contamination from internal requester tickets.
- Fast, sub 100 millisecond response times for complex predictive insights and historical trends.
- Complete mathematical alignment with operational SLA alerts through SLAService reuse.
- Explicit `no_data` representation prevents misleading zero percent or zero minute metric displays on frontend charts.
- Resilient background job execution tracking with failure alerts in `forecast_job_runs`.

**Negative and tradeoffs**:
- New database tables require running migrations across environments.
- Projections reflect the latest daily batch run; real time intraday shifts are not modeled dynamically until the next scheduled batch or manual trigger.

**Neutral**:
- Analytics service must remain reachable over internal HTTP network for real time CSAT score aggregation, falling back gracefully to neutral defaults if unreachable.

## Follow-up

- [x] Execute `php artisan migrate` in ticket service to establish forecast tables and composite query indexes.
- [ ] Verify that cron daemon or task runner executes `php artisan schedule:run` daily in production environments.

