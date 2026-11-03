# 0029. Operational Reporting Exports, Performance Analytics, and Audit Governance

**Date**: 2026-11-03
**Status**: Accepted

## Summary

This specification establishes operational report document generation, deep employee and department performance analytics, predictive ticket volume forecasting, and immutable system wide audit log search with automated retention purging. Administrators can evaluate individual technician efficiency metrics, assess department workload balance, inspect projected volume trends, and export formatted reports in PDF, Excel, and CSV with complete preview parity. Super administrators gain global audit log filtering across multiple parameters and can configure automated retention periods that purge historical records safely. All metrics enforce strict branch scoping, distinguish inactivity from zero values, and protect audit trail immutability.

## Context

Operational leaders and system administrators need deep analytical tools and regulatory governance mechanisms that extend beyond daily real time dashboards:

Evaluating staff performance requires objective, capacity isolated metrics. When an employee acts as an assigned technician, their resolution rate, average resolution duration, service level agreement compliance, reassignment rate, and customer satisfaction ratings must be calculated exclusively against tickets where they held the technician capacity. Tickets where the staff member was merely a requester on an internal request must be strictly excluded. Furthermore, when staff members or entire departments have zero recorded tickets in a date window, the system must display an explicit notice stating no data is recorded for the period rather than misleading zero durations or compliance figures.

Department heads require workload visibility to spot team imbalances. Aggregating active tickets, overdue breaches, and tickets per technician across departments allows administrators to rebalance staffing before service level agreement breaches occur. Administrators also need predictive foresight: forecasting daily ticket volumes across future horizons and detecting recurring category or machine complaint trends from historical patterns, backed by transparent explanation copy stating the data basis.

Operational reporting requires formal document generation separate from on screen views. Administrators must be able to configure filters, view an interactive preview of exact rows, and export identical snapshots to formatted PDF documents, sortable Excel spreadsheets, or clean comma separated value files without browser crashes.

Finally, enterprise compliance requires an immutable system wide audit trail for Super Administrators, combined with automated log retention management. Super Administrators must be able to filter millions of log records across combined criteria such as action types, actors, branches, and date ranges without full table scans. Over time, historical log storage must be managed through configurable retention windows that execute scheduled purges safely with confirmation warnings, record count previews, and permanent deletion of expired logs without ever touching operational tickets or active system data.

## Requirements

**User stories**:

* As an Admin, I want an Employee Performance view scoped to my branch displaying resolution rate, average resolution time, service level agreement compliance, reassignment rate, and customer feedback ratings for tickets where staff held the Assigned Employee capacity, so that technician productivity is evaluated accurately.
* As an Admin, I want a Department Performance view scoped to my branch showing team rollups, open versus overdue counts, workload distributions across staff, and employee drill downs, so that I can identify overloaded teams and rebalance assignments.
* As an Admin, I want a Predictive Insights view displaying forecasted ticket volume trends across upcoming 7 and 30 day periods with recurring issue trend detections and plain language calculation explanations, so that I can plan staffing proactively.
* As an Admin, I want a Generate Report screen allowing custom filter configuration, an exact live preview, and multi format exports to PDF, Excel, and CSV within branch security boundaries, so that I can share reliable operational documents.
* As a Super Admin, I want an Audit Logs search view showing system wide event records with multi criteria filters, dynamic dropdowns, and pagination, so that I can conduct fast and reliable security audits.
* As a Super Admin, I want a Log Retention Settings screen where I can configure retention periods, preview purge counts, and automate scheduled background log pruning with confirmation safeguards, so that log storage growth remains under control without risking active operational data.

**Acceptance criteria**:

* **AC-1**: The Admin can access an Employee Performance view scoped strictly to active technicians within their assigned branch, rejecting unauthorized cross branch requests with HTTP 403 Forbidden.
* **AC-2**: For each employee, the view displays Resolution Rate (percentage of assigned tickets resolved out of total assigned in period), Average Resolution Time (excluding On Hold duration), SLA Compliance Rate (percentage resolved within SLA versus breached), Reassignment Rate, and Average CSAT (from customer feedback on tickets they resolved).
* **AC-3**: All individual employee metrics evaluate tickets strictly where the employee held the Assigned Employee capacity (`tickets.assigned_to`), excluding tickets where the employee was solely the requester or creator on internal tickets.
* **AC-4**: Reassignment Rate is calculated consistently as approved reassignment requests originating from that employee divided by total tickets assigned to them in the period, multiplied by 100.
* **AC-5**: When an employee or department has zero ticket activity within the selected date window, the interface displays an explicit notice stating no data is recorded for this period rather than a misleading zero or blank value.
* **AC-6**: The comparative employee list is sortable by each metric column (resolution rate, resolution duration, SLA compliance, reassignment rate, CSAT).
* **AC-7**: The Admin can access a Department Performance view scoped to departments in their branch, showing total tickets handled, average resolution duration, SLA compliance, average CSAT, open counts, and overdue counts.
* **AC-8**: Open counts clearly distinguish unresolved tickets from overdue breached tickets, and workload distribution highlights imbalance by displaying tickets assigned per employee within the department.
* **AC-9**: The Admin can drill down from a department summary into individual employees within that department and their contribution.
* **AC-10**: The Admin can access a Predictive Insights section scoped to their branch, displaying a forecasted ticket volume trend for upcoming 7 day and 30 day periods based on historical ticket creation patterns.
* **AC-11**: The forecast trend line is visually distinguished from actual historical data (rendered as a dashed or distinct colored projected curve), and recurring issue patterns identify categories and machines with statistically notable frequency increases.
* **AC-12**: Each predictive insight includes a plain language explanation of its historical basis (such as stating the calculation is based on the last 60 days of ticket volume), and forecasts recalculate daily through a background scheduled task.
* **AC-13**: Predictive insights and forecasts are strictly read only and do not trigger automatic routing or staffing mutations.
* **AC-14**: The Admin can access a Generate Report screen separate from live dashboard views, configure filters for report type, date range, department, and branch, and generate an interactive report preview reflecting exact records before final export.
* **AC-15**: The report preview displays the applied filter summary alongside the data table, distinguishing empty search results from actual backend query errors.
* **AC-16**: The Admin can export reports in three distinct formats: PDF (formatted for readability with headers, titles, filter summaries, timestamps, and pagination), Excel (.xlsx with structured sortable columns), and CSV (plain delimited data with header row).
* **AC-17**: Exported files accurately match the preview snapshot exactly for identical filter parameters, and standard reports generate within 30 seconds.
* **AC-18**: Super Admins can access an Audit Logs view showing system wide records with combined filters across date and time range, action and event types, and branch.
* **AC-19**: Filter dropdown options for action types and branches are populated dynamically from recorded database values, and search queries execute within 2 to 5 seconds with pagination.
* **AC-20**: Each audit log entry displays timestamp, actor name and role, action event type, affected entity, and relevant before and after details.
* **AC-21**: Super Admins can access a Log Retention Settings screen to configure an audit log retention threshold (such as 365 days), view a preview summary of records that will be purged before the first automated run, and must confirm through a modal before saving a reduced retention window.
* **AC-22**: The automated log purge runs on a background schedule (nightly or weekly), permanently deleting expired historical logs while strictly preserving unexpired logs, active tickets, user profiles, and operational tables, with automatic retries and alerts upon job failure.

## Options considered

### Option 1: Dedicated Reporting and Analytics Engines in Ticket Service with Composite Indexes and Scheduled Pruning (Recommended)

Consolidate operational report preview and streaming, employee and department performance calculators, moving average forecasting tables, and paginated audit query builders directly inside `ticket-service`. Leverage native CSV and XML Excel streaming for spreadsheets, DomPDF for readable documents, composite database indexes for multi parameter audit searches, and a scheduled background command for automated log pruning.

**Pros**:
* Keeps all operational data queries local to the ticket service database, avoiding expensive inter service data replication.
* Reuses existing `SLAService` and `TicketDashboardService` calculation logic directly.
* Composite database indexes on `tickets` and `ticket_audit_logs` keep audit queries and report previews under 2 to 5 seconds even with millions of rows.
* Generates CSV and Excel files instantly through memory efficient cursor streaming without queue delays.
* Scheduled console commands provide reliable, auditable background log retention purges with job run tracking.

**Cons**:
* Heavy PDF exports over 500 rows require background queue worker execution.

### Option 2: Standalone Microservice Sprawl for Reporting and Auditing

Create two brand new microservices: a dedicated Reporting Service and a dedicated Audit Logging Service, replicating all ticket mutations across message buses.

**Pros**:
* Completely isolates analytical CPU loads from transactional ticket dispatching.

**Cons**:
* Introduces massive distributed complexity and eventual consistency delays.
* Duplicates business rules and SLA calculations across multiple services.
* Requires coordinating cross service distributed transactions.
* Violates repository architecture invariants against unnecessary microservice sprawl.

### Option 3: Pure Client Side Report Generation and In Memory Filtering

Fetch raw ticket arrays over REST and perform all metric calculations, forecast curves, Excel generation, and audit log filtering in the browser.

**Pros**:
* Minimal backend code required.

**Cons**:
* Severe security vulnerability: leaks cross branch data across the network.
* Crashes browser memory when querying months of tickets or thousands of audit logs.
* Produces discrepancies between preview tables and exported files.

## Decision

**Chosen option**: Option 1: Dedicated Reporting and Analytics Engines in Ticket Service with Composite Indexes and Scheduled Pruning.

This approach maintains architectural simplicity, keeps queries fast through dedicated composite indexes, ensures export snapshot parity, and guarantees safe audit retention management through scheduled background tasks.

**Implementation skills**: `laravel-microservice` (`.agents/skills/laravel-microservice/`) · `react-frontend` (`.agents/skills/react-frontend/`) · `api-testing` (`.agents/skills/api-testing/`)

## Rationale

Operational reporting and audit governance require high data fidelity, reliable performance, and strict regulatory compliance. Option 1 is chosen because ticket service is the authoritative source of truth for tickets, assignments, statuses, and audit records. 

By calculating individual employee performance metrics directly in `AdminPerformanceService`, capacity isolation is enforced at the database level: only tickets where staff held the Assigned Employee capacity are evaluated, preventing internal ticket submissions from skewing technician productivity ratings. Explicit null returns accompanied by explanatory status flags prevent zero ticket periods from displaying misleading 0 percent compliance or false durations.

For document generation, streaming CSV and Excel exports synchronously via database cursors delivers instant downloads up to 5000 rows without memory bloat, while queuing heavier PDF exports through DomPDF guarantees that gateway timeouts never occur. Both preview and exports share identical query builders, guaranteeing complete snapshot parity.

For audit trail governance, composite database indexes on `(ticket_id, event_type, created_at)` ensure multi filter searches respond within 2 to 5 seconds. Providing a preview count before automated scheduled purges run, combined with a mandatory confirmation modal when reducing retention windows, prevents accidental data loss while keeping storage volume managed.

## Feature design

**Data model sketch**:

Table `report_exports`:
* `id`: bigIncrements, unsigned, primary key
* `requested_by`: unsignedBigInteger, nullable, indexed
* `branch_id`: unsignedBigInteger, indexed, foreign key to `branches.id`
* `report_type`: string(50), indexed
* `format`: string(10) (pdf, xlsx, csv)
* `filters`: json
* `row_count`: integer, default 0
* `file_path`: string(255), nullable
* `download_token`: string(64), nullable, indexed
* `status`: string(20), default 'pending' (pending, processing, completed, failed)
* `error_message`: text, nullable
* `expires_at`: timestamp, nullable
* `created_at`: timestamp, indexed

Table `branch_ticket_forecasts`:
* `id`: bigIncrements, unsigned, primary key
* `branch_id`: unsignedBigInteger, indexed, foreign key to `branches.id`
* `forecast_date`: date, indexed
* `projected_volume`: integer, default 0
* `historical_basis_days`: integer, default 60
* `confidence_level`: string(20), default 'standard'
* `calculation_status`: string(30), default 'calculated'
* `created_at`: timestamp
* Unique composite index: `(branch_id, forecast_date)`

Table `branch_recurring_issue_trends`:
* `id`: bigIncrements, unsigned, primary key
* `branch_id`: unsignedBigInteger, indexed, foreign key to `branches.id`
* `issue_type`: string(20) (category, machine, complaint)
* `item_id`: unsignedBigInteger, indexed
* `item_name`: string(150)
* `recent_count`: integer, default 0
* `baseline_count`: integer, default 0
* `percentage_growth`: decimal(8, 2), default 0.00
* `trend_direction`: string(20) (increasing, stable, decreasing)
* `updated_at`: timestamp

Table `audit_retention_settings`:
* `id`: bigIncrements, unsigned, primary key
* `retention_days`: integer, default 365
* `is_auto_purge_enabled`: boolean, default true
* `purge_frequency`: string(20), default 'weekly' (nightly, weekly)
* `last_purged_at`: timestamp, nullable
* `last_purged_count`: integer, default 0
* `updated_by`: unsignedBigInteger, nullable
* `updated_at`: timestamp

Table `forecast_job_runs`:
* `id`: bigIncrements, unsigned, primary key
* `job_name`: string(100), indexed
* `status`: string(20) (running, completed, failed)
* `records_processed`: integer, default 0
* `duration_seconds`: decimal(8, 2), default 0.00
* `error_details`: text, nullable
* `created_at`: timestamp, indexed

**State transitions**:

Report Export Lifecycle:
```
[Requested] ──> [Processing] ──> [Completed] ──> [Downloaded] ──> [Expired (24h)]
                      │
                      └──> [Failed]
```

Audit Log Retention Lifecycle:
```
[Configured] ──> [Purge Scheduled] ──> [Preview Generated] ──> [Purge Executed] ──> [Permanent Delete]
       │                                                               ▲
       └── [Retention Reduced] ──> [Confirmation Modal Verified] ─────┘
```

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/ticketing/ticket/admin-reports/employees` | GET | `preset`: string, `date_from`: date, `date_to`: date, `sort_by`: string, `sort_dir`: string | `employees`: array, `summary`: object, `has_data`: bool | Bearer (Admin, Super Admin) | 401 unauthenticated, 403 unauthorized branch |
| `/api/ticketing/ticket/admin-reports/departments` | GET | `preset`: string, `date_from`: date, `date_to`: date, `sort_by`: string, `sort_dir`: string | `departments`: array, `summary`: object, `has_data`: bool | Bearer (Admin, Super Admin) | 401 unauthenticated, 403 unauthorized branch |
| `/api/ticketing/ticket/admin-reports/predictive-insights` | GET | `horizon_days`: int (7 or 30) | `forecast_trend`: array, `recurring_issues`: array, `basis_explanation`: string, `calculation_status`: string | Bearer (Admin, Super Admin) | 401 unauthenticated, 403 unauthorized branch |
| `/api/ticketing/ticket/admin/reports` | GET | `report_type`: string, `preset`: string, `date_from`: date, `date_to`: date, `department`: int, `branch_id`: int | `headers`: array, `rows`: array, `summary`: object, `count`: int, `has_data`: bool | Bearer (Admin, Super Admin) | 401 unauthenticated, 403 unauthorized branch, 422 invalid filter |
| `/api/ticketing/ticket/admin/reports/export` | POST | `report_type`: string, `format`: string (pdf, xlsx, csv), `filters`: object | Streamed file response or `export_id`, `status`, `download_url` | Bearer (Admin, Super Admin) | 401 unauthenticated, 403 unauthorized branch, 422 invalid format |
| `/api/ticketing/ticket/superadmin/audit-logs` | GET | `date_from`: date, `date_to`: date, `event_type`: string, `branch_id`: int, `actor`: string, `search`: string, `page`: int, `per_page`: int | `entries`: array, `pagination`: object, `count`: int | Bearer (Super Admin) | 401 unauthenticated, 403 non superadmin |
| `/api/ticketing/ticket/superadmin/audit-logs/filters` | GET | None | `action_types`: array, `branches`: array, `actor_roles`: array | Bearer (Super Admin) | 401 unauthenticated, 403 non superadmin |
| `/api/ticketing/ticket/superadmin/audit-logs/retention` | GET | None | `retention_days`: int, `is_auto_purge_enabled`: bool, `purge_frequency`: string, `pending_purge_estimate`: int, `next_purge_date`: string | Bearer (Super Admin) | 401 unauthenticated, 403 non superadmin |
| `/api/ticketing/ticket/superadmin/audit-logs/retention` | PUT | `retention_days`: int (required, min 30), `is_auto_purge_enabled`: bool, `purge_frequency`: string | `status`: string, `message`: string, `settings`: object | Bearer (Super Admin) | 401 unauthenticated, 403 non superadmin, 422 invalid days |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Employee Performance | Resolution Rate | Count of tickets resolved by employee divided by total tickets assigned to employee in period multiplied by 100 |
| Employee Performance | Average Resolution Time | Average of `(resolved_at - created_at - on_hold_duration_minutes)` where `assigned_to = employee_id` |
| Employee Performance | SLA Compliance Rate | Percentage of tickets resolved by employee where `sla_breached = false` |
| Employee Performance | Reassignment Rate | Approved reassignment requests originating from employee divided by total assigned tickets multiplied by 100 |
| Employee Performance | Average CSAT | Internal HTTP fetch to analytics service filtered by resolved technician identifier |
| Department Performance | Workload Distribution | Percentage share of active unclosed tickets assigned to each employee within that department |
| Department Performance | Open vs Overdue Counts | Count of unclosed tickets where `sla_breached = false` versus unclosed tickets where `sla_breached = true` |
| Predictive Insights | Projected Volume | Precomputed 7 day weighted moving average with day of week seasonality persisted in `branch_ticket_forecasts` |
| Predictive Insights | Recurring Issue Growth | Comparison of category and machine frequencies in recent 14 days versus preceding 30 to 60 days baseline |
| Predictive Insights | Basis Explanation | Dynamic string formatted as "Based on the last N days of ticket volume and seasonality in your branch" |
| Generate Report | Preview Rows and Summary | Unified query builder in `ReportDataQueryService` executing identical SQL snapshot across preview and exports |
| Audit Logs | Dynamic Filter Options | Distinct `event_type` from `ticket_audit_logs`, active branches from `branches`, and registered actor roles |
| Log Retention | Pending Purge Estimate | Count of records in `ticket_audit_logs` where `created_at < NOW() - INTERVAL retention_days DAY` |

**Key invariants**:

* Capacity isolation: Employee performance metrics strictly evaluate tickets where the employee held Assigned Employee capacity; internal requester tickets are completely excluded.
* True inactivity versus zero values: When an employee or department has zero ticket activity in a date range, metrics return explicit null values with `period_status: "no_data"` rather than false zero durations or compliance figures.
* Export snapshot parity: The report preview and all three export formats (PDF, Excel, CSV) execute the exact same query snapshot logic for identical filter parameters.
* Immutability and purge restriction: No individual audit log record can ever be modified or deleted through any route; only scheduled background jobs can purge logs older than the confirmed retention threshold.
* Super Admin retention protection: Reducing an audit log retention window requires explicit confirmation in the interface before settings save, preventing accidental bulk data loss.

**Security model**:

* Role based access control enforced via `VerifyEmployeeJwt` and gate middleware.
* Branch Admins restricted to `auth.branch_id` across reports, employee performance, department performance, and predictive insights.
* Super Admins granted global audit log search, dynamic filter extraction, and exclusive retention configuration privileges.
* All credential transmissions use RSA client side cryptography.

**Configuration required**:

* `DEFAULT_AUDIT_RETENTION_DAYS`: integer, default `365` (initial audit log retention period in days)
* `REPORT_MAX_SYNC_ROWS`: integer, default `5000` (row ceiling for synchronous CSV and Excel downloads)
* `PDF_MAX_ROWS`: integer, default `1000` (row ceiling for PDF document generation)

**Critical test scenarios**:

* Happy path: Admin requests employee performance metrics for This Month; endpoint returns individual technician resolution rates, reassignment rates, SLA percentages, and CSAT scores, verifying **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-6**.
* Inactivity distinction: Admin requests metrics for an employee with zero assigned tickets in the period; endpoint returns `has_data: false` and `period_status: "no_data"` with null metric fields rather than zero values, verifying **AC-5**.
* Department drill down and workload balance: Admin views department performance, observes tickets per employee distribution, and drills down into individual employee contributions, verifying **AC-7**, **AC-8**, **AC-9**.
* Predictive volume forecasting: Admin opens predictive insights; view renders projected 7 day and 30 day trend curves with distinct visual styling, recurring issue category growth flags, and plain language explanation copy, verifying **AC-10**, **AC-11**, **AC-12**, **AC-13**.
* Report preview and multi format export: Admin configures custom date filters, generates preview, and downloads PDF, Excel, and CSV; all three files contain identical row counts and summary figures matching the preview, verifying **AC-14**, **AC-15**, **AC-16**, **AC-17**.
* Super Admin audit search and dynamic dropdowns: Super Admin filters audit logs by action type, branch, and date range; dynamic dropdowns show valid database values and results return paginated within 2 to 5 seconds, verifying **AC-18**, **AC-19**, **AC-20**.
* Retention settings and automated purge: Super Admin reduces retention period from 365 to 90 days; confirmation modal warns of affected records, preview count matches expired records, and scheduled background purge job permanently removes expired logs without touching active tickets, verifying **AC-21**, **AC-22**.

## Build plan

Vertical implementation slices following the Tracer Bullet delivery approach:

1. Create database migration for `report_exports`, `branch_ticket_forecasts`, `branch_recurring_issue_trends`, `audit_retention_settings`, and `forecast_job_runs` tables with composite indexes, satisfying **AC-10**, **AC-14**, **AC-21**.
2. Implement `AdminPerformanceService` delivering capacity isolated employee performance metrics with reassignment rate calculations and explicit empty period notices, satisfying **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-6**.
3. Implement department performance rollup logic with workload distribution calculations, open versus overdue classification, and staff drill down endpoints, satisfying **AC-7**, **AC-8**, **AC-9**.
4. Implement `TicketForecastService` with 7 day moving average volume forecasting, recurring issue trend detection, and daily console command `tickets:calculate-forecasts`, satisfying **AC-10**, **AC-11**, **AC-12**, **AC-13**.
5. Implement `ReportDataQueryService` and `ReportExportController` delivering live previews, synchronous CSV and XML Excel streaming up to 5000 rows, and queued DomPDF generation up to 1000 rows with complete snapshot parity, satisfying **AC-14**, **AC-15**, **AC-16**, **AC-17**.
6. Implement `AuditLogFilterService` and dynamic filter options endpoint in `SuperAdminConfigController` supporting multi criteria search with sub 2 to 5 second indexed queries, satisfying **AC-18**, **AC-19**, **AC-20**.
7. Implement `AuditRetentionService` and scheduled console command `audit:purge-expired-logs` with preview record count calculations and confirmation modal safeguards, satisfying **AC-21**, **AC-22**.
8. Connect and verify React frontend components (`AdminReports.jsx`, `PredictiveAnalytics.jsx`, `SuperAdminAuditLogs.jsx`, `AdminEmployees.jsx`) with live preview tables, export triggers, and retention settings modals, satisfying **AC-6**, **AC-14**, **AC-18**, **AC-21**.
9. Execute automated PHPUnit and frontend integration test suites verifying capacity isolation, export parity, predictive fallback states, and safe retention purging, satisfying **AC-1** through **AC-22**.

## Consequences

**Positive**:
* Guarantees capacity isolation so internal employee requests never distort technician performance figures.
* Explicit empty period states prevent leadership from misinterpreting inactive staff or departments as failing compliance.
* Eliminates browser crashes and gateway timeouts on large operational report exports via streaming and queueing.
* Predictive insights give administrators clear operational foresight with transparent calculation explanations.
* Automated audit retention purges keep database disk growth managed while protecting active operational data.

**Negative / tradeoffs**:
* Scheduled daily forecasting and weekly log purges require active Laravel Scheduler execution in container environments.
* Large PDF exports require asynchronous worker queue processing.

**Neutral**:
* Excel exports leverage structured XML and native CSV streaming to avoid heavy external spreadsheet libraries.

## Follow-up

* Confirm Laravel Scheduler cron is active in Docker Compose environment for daily forecast recalculations and weekly log purging.
* Ensure browser file download permissions function smoothly across mobile and tablet viewports during report exports.

