# 0019. Branch Admin Dashboard and Operational Reports

Date: 2026-10-30
Status: Accepted

## Summary

This specification establishes a dedicated branch scoped administrative dashboard and operational reporting API suite in ticket service, connecting the React frontend at /ticketing/admin/dashboard and /ticketing/admin/reports to real backend data. It aggregates total tickets, resolved counts, average resolution times, SLA compliance rates, customer satisfaction scores, open against closed breakdowns, recurring issues, and employee workloads with server side branch scoping, date range filtering, query optimization, non blocking caching, and graceful fallback handling.

## Context

Administrators need real time visibility into their branch operational health. Currently, the AdminDashboard and AdminReports components rely on mock datasets and unconnected placeholder state.
To deliver genuine operational insights without cross branch data leakage, all metric calculations must enforce branch scoping on the server side regardless of any user supplied query parameters.
In addition, calculations must reuse established SLA metrics from SLAService and customer ratings from analytics service, gracefully degrade when secondary services are unavailable, and cache aggregated metrics so database load remains minimal.

## Requirements

User stories:
- As a branch Admin, I want to see my branch ticket volume, status breakdown, and key operational metrics for today, the last 7 days, the last 30 days, or a custom date range so that I can evaluate service efficiency.
- As a branch Admin, I want to view SLA compliance rates and average resolution times calculated using the official SLA rules so that performance metrics are accurate and trustworthy.
- As a branch Admin, I want to inspect top recurring problem categories and equipment failure frequencies within my branch so that preventative maintenance can be prioritized.
- As a branch Admin, I want to observe the current ticket workload distribution across all staff in my branch so that tasks can be balanced effectively.
- As a branch Admin, I want the dashboard to load reliably even if customer feedback or predictive analytics systems encounter temporary downtime.

Acceptance criteria:
- AC 1: The system provides a branch scoped dashboard API endpoint at GET /api/ticketing/ticket/admin-dashboard and reporting endpoint at GET /api/ticketing/ticket/admin-reports (or unified /admin-dashboard) returning:
  1. Key KPIs: total tickets, resolved count, open count, in progress count, closed count, average resolution time in hours, SLA compliance percentage, average CSAT rating, active staff count.
  2. Status distribution: breakdown across all ticket statuses for the period.
  3. Ticket trends: time series of created versus resolved tickets matching the selected date preset or range.
  4. SLA performance: overall compliance rate, SLA met count, SLA breached count, and resolution time averages.
  5. Recurring issues: top problem categories and top equipment machines ranked by ticket volume.
  6. Employee workload: active unresolved assigned ticket counts per employee belonging to the branch.
- AC 2: Server side branch scoping is strictly enforced. For branch Admin users, the branch is resolved directly from the authenticated employee record (branch or branch id) and cannot be overridden by query parameters. SuperAdmin users can inspect a specific branch via query parameter or default to their home branch.
- AC 3: SLA compliance calculation reuses SLAService computeTicketSlaMetrics to determine whether each ticket in the period is compliant or breached.
- AC 4: Customer satisfaction metrics reuse feedback ratings from analytics service via internal REST HTTP calls, falling back gracefully to neutral defaults if analytics service is unreachable.
- AC 5: Recurring issue aggregation groups tickets by problem category and machine equipment, returning counts, names, and proportions.
- AC 6: Employee workload aggregation queries tickets assigned to active branch employees, returning names, departments, and active ticket counts.
- AC 7: Date range filtering supports standard presets (Today, Last 7 Days, Last 30 Days, Last 90 Days) and explicit date from and date to timestamps.
- AC 8: Dashboard caching uses Redis or Laravel Cache with a short TTL (60 seconds) keyed by branch and date parameters, supporting on demand refresh via force refresh.
- AC 9: The React frontend AdminDashboard.jsx and AdminReports.jsx components are updated to fetch from the live endpoints via axiosInstance, rendering real data with bifurcated loading skeletons.

## Options considered

### Option 1: Direct SQL Aggregation with Single Microservice Endpoint
Build a dedicated TicketDashboardService method getAdminDashboard in ticket service that queries ticket service tables for tickets, assignments, categories, and machines, while calling analytics service over HTTP for CSAT data.

Pros:
- Ticket service already owns tickets, branches, categories, machines, employees, and SLAService.
- Avoids cross database queries while maintaining microservice separation of concerns.
- Easy to wrap secondary REST calls in try catch blocks for graceful degradation.
- Fast execution with Redis cache keys.

Cons:
- Requires an internal HTTP request to analytics service for CSAT ratings.

### Option 2: Build Reporting Layer in Analytics Service
Duplicate ticket data or run an ETL process to mirror all ticket lifecycle events into analytics service and query analytics service for the dashboard.

Pros:
- Offloads heavy analytical queries from ticket service.

Cons:
- High architectural complexity and eventual consistency delay.
- Duplicates SLA rules and classification logic.
- Real time dashboard requirements would lag behind transactional state.

## Decision

We adopt Option 1. Ticket service is the authoritative source for tickets, assignments, SLA rules, and branch boundaries.
1. Add getAdminDashboard and getAdminReports methods in TicketDashboardService in ticket service.
2. Expose GET /admin-dashboard and GET /admin-reports in TicketDashboardController, routed under auth.subsystem.
3. Query analytics service via HTTP client for customer feedback statistics with a 2 second timeout and fallback.
4. Calculate SLA metrics via SLAService.
5. Apply Redis caching with 60 second expiration.
6. Connect frontend AdminDashboard.jsx and AdminReports.jsx to live data.

## Build plan

1. In services/ticket-service/app/Services/TicketDashboardService.php:
   - Implement getAdminDashboard(Employee $user, array $filters, bool $forceRefresh = false)
   - Implement branch resolution and server side scoping
   - Implement KPI aggregation, trend series, SLA compliance, recurring issues, and employee workload
   - Implement CSAT fetching from analytics service with graceful fallback
   - Implement Redis caching
2. In services/ticket-service/app/Http/Controllers/TicketDashboardController.php:
   - Add adminDashboard(Request $request) and adminReports(Request $request)
3. In services/ticket-service/routes/api.php:
   - Register GET /admin-dashboard and GET /admin-reports under auth.subsystem
4. In services/analytics-service/app/Http/Controllers/FeedbackController.php:
   - Enhance csatStats to accept optional date from, date to, and branch id or ticket ids
5. In frontend/web/src/pages/AdminDashboard.jsx:
   - Replace mock data structures with live API data fetched through axiosInstance
   - Wire date range filter and preset selectors to backend query parameters
   - Maintain ONE UI standard styles and Chart.js visualizations
6. In frontend/web/src/pages/AdminReports.jsx:
   - Connect operational metrics and charts to live API data
   - Update export payloads for CSV and PDF generation
7. Test end to end with curl / browser and verify response accuracy and branch isolation.
