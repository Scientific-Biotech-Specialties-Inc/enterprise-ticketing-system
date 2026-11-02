# Verify: Admin Performance Metrics and Predictive Insights Backend · spec 0022 · updated 2026-11-01
_Steps derived from spec 0022 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

- [ ] Send `GET /api/ticketing/ticket/admin-reports/employees` with authenticated Admin token → returns employee list with resolution rate, average resolution hours, SLA compliance, approved reassignment rate, and CSAT → AC-1
- [ ] Inspect technician with approved reassignment requests → confirms reassignment rate equals approved requests divided by total assigned tickets multiplied by 100 → AC-2
- [ ] Verify employee who created internal requester tickets → confirms internal requester tickets do not inflate technician assignment count → AC-3
- [ ] Request metrics for employee with zero assigned tickets in period → returns null rates with `has_data: false` and `period_status: "no_data"` rather than zero → AC-4
- [ ] Send request with conflicting `branch_id` as regular Admin → returns HTTP 403 Forbidden blocking cross branch tampering → AC-5
- [ ] Send request as regular technician role → returns HTTP 403 Forbidden requiring Admin authorization → AC-5
- [ ] Send `GET /api/ticketing/ticket/admin-reports/departments` → returns department rollups with total handled, average resolution time, SLA compliance rate, open and overdue counts, and workload distribution → AC-7, AC-8
- [ ] Verify open and overdue counts in department summary → open tickets exclude resolved or closed items, overdue tickets match SLA resolution breach records → AC-9
- [ ] Check workload distribution per department → displays active ticket count and percentage share per staff member → AC-10
- [ ] Test server sorting with `sort_by=sla_compliance_rate&sort_dir=asc` → returns departments ordered by compliance ascending → AC-11
- [ ] Drill down into department staff with `department` query filter → returns individual metrics for staff in that department → AC-12
- [ ] Send `GET /api/ticketing/ticket/admin-reports/predictive-insights` on branch with under 14 days history → returns `status: "insufficient_data"` with days count → AC-13, AC-15
- [ ] Send `GET /api/ticketing/ticket/admin-reports/predictive-insights` on branch with 14 or more days history → returns daily projections with upper and lower bounds → AC-13, AC-14
- [ ] Inspect recurring issues in predictive insights payload → returns category and machine trend items with growth percentages and trend signals → AC-16
- [ ] Run daily batch forecast calculation → verifies database entries in `branch_ticket_forecasts`, `branch_recurring_issue_trends`, and `forecast_job_runs` → AC-17, AC-18

## Commands

- [ ] `docker exec ticket-service php artisan test tests/Feature/AdminReportsTest.php` → all 8 feature test scenarios pass with 183 assertions → AC-1 through AC-18
- [ ] `docker exec ticket-service php artisan tickets:calculate-forecasts` → command completes with status 0 and precomputes forecasts across branches → AC-14, AC-16, AC-17, AC-18
- [ ] `docker exec ticket-service php artisan migrate:status` → confirms migration `2026_11_01_000001_create_admin_performance_and_forecast_tables` status is Ran → AC-6, AC-17

## Acceptance-criteria coverage

- AC-1: covered by test `admin can view employee performance metrics` and endpoint `GET /api/ticketing/ticket/admin-reports/employees`
- AC-2: covered by test `admin can view employee performance metrics` (approved reassignment rate calculation verification)
- AC-3: covered by test `employee performance excludes requester only activity on internal tickets`
- AC-4: covered by test `employee with no tickets returns explicit null and no data`
- AC-5: covered by tests `server side branch scoping blocks cross branch access` and `regular technician role is denied access to admin reports`
- AC-6: covered by database migration composite indexes on `tickets` table
- AC-7: covered by test `admin can view department performance metrics and sort` and endpoint `GET /api/ticket/admin-reports/departments`
- AC-8: covered by test `admin can view department performance metrics and sort` with `SLAService` metrics rollup
- AC-9: covered by open and overdue ticket classifications in `AdminPerformanceService`
- AC-10: covered by department `workload_distribution` array in department performance endpoint
- AC-11: covered by `sort_by` and `sort_dir` in department performance endpoint
- AC-12: covered by `department` filter query parameter in employee performance endpoint
- AC-13: covered by endpoint `GET /api/ticketing/ticket/admin-reports/predictive-insights`
- AC-14: covered by test `predictive insights forecast calculation and job logging` (7 day weighted moving average with seasonality)
- AC-15: covered by test `predictive insights returns insufficient data when below 14 days`
- AC-16: covered by test `predictive insights forecast calculation and job logging` (category and machine trend detection)
- AC-17: covered by `CalculateTicketForecastsCommand` and daily scheduler entry in `Kernel.php`
- AC-18: covered by `ForecastJobRun` persistence and execution health logging in `TicketForecastService`

