# 0022. Operational Reporting, Audit Log Filtering, and CS Workload Dashboard

**Date**: 2026-11-01
**Status**: Accepted

## Summary

This umbrella specification coordinates three core operational backend capabilities in ticket service: multi format operational report generation with synchronous cursor streaming and asynchronous export, immutable audit log searching and dynamic filtering for Super Admins, and a customer service agent workload dashboard with SLA risk metrics and partial failure resilience. All three capabilities enforce strict server side branch scoping and reuse existing data models and SLA calculation engines. All routes route through the Nginx gateway under the ticket service prefix. Together, they eliminate mock state from Admin Reports, replace unpaginated memory heavy audit log queries, and provide customer service agents with real time operational visibility.

## Structure

This umbrella decision splits into three focused child specifications:

1. [0022-admin-reports-preview-and-export.md](0022-admin-reports-preview-and-export.md): Admin report preview endpoint, synchronous cursor streaming for CSV and Excel up to 5000 rows, queued background generation with Reverb notifications for PDF exports over 500 rows, and multi format generation from identical data snapshots.
2. [0022-superadmin-audit-log-search-and-immutability.md](0022-superadmin-audit-log-search-and-immutability.md): Super Admin audit log searching and filtering API with dynamic filter options, strict immutability without update or delete routes, database indexing, and cursor or offset pagination.
3. [0022-cs-agent-workload-dashboard.md](0022-cs-agent-workload-dashboard.md): Customer service agent dashboard aggregating queued tickets in the agent branch, assigned tickets across statuses, workload SLA risk and breach counts, a highlighted needs attention subset, and graceful degradation returning null metrics with section errors during partial query failure.

## Requirements

**User stories**:
- As an Admin in the reports view, I want to preview filtered operational data and export it to PDF, Excel, or CSV with asynchronous notifications for large exports so that I can analyze performance without browser timeouts.
- As a Super Admin in the audit logs view, I want to search and filter immutable system logs by actor, action type, affected entity, branch, and keyword so that security audits are fast and reliable.
- As a Customer Service agent, I want a dashboard summarizing my queued tickets, assigned workloads, SLA risk items, and pending reassignments so that I can prioritize urgent customer demands.

**Acceptance criteria**:
- **AC-1**: Report preview endpoint returns structured dataset with total counts, headers, and filter summary within 800 milliseconds for standard date ranges.
- **AC-2**: Report preview and all export formats (PDF, Excel, CSV) execute the exact same underlying query snapshot logic for identical filter parameters.
- **AC-3**: CSV and XML Excel exports stream synchronously up to 5000 rows; PDF exports exceeding 500 rows or 30 days trigger background queued generation with private disk storage, Reverb alerts, and a maximum PDF ceiling of 1000 rows.
- **AC-4**: When a report filter produces zero records, the API returns a structured HTTP 200 response with zero count and distinct informational message rather than a 404 or 500 error.
- **AC-5**: Server side branch scoping is enforced on all report data queries according to the requesting Admin branch, preventing cross branch leakage.
- **AC-6**: Super Admin audit log endpoint supports filtering by date range, actor, action type, entity, branch, and free text keyword search, with paginated output and gateway prefix alignment.
- **AC-7**: Audit logs remain strictly immutable: no individual record update or delete endpoints exist, and bulk purge routes are disabled.
- **AC-8**: Dynamic filter options endpoint provides distinct lists of recorded action types, modules, actor roles, and branches from database records and registered system modules.
- **AC-9**: Database migration adds composite indexes to ticket audit logs on timestamp, action type, actor, and ticket ID to maintain high performance.
- **AC-10**: CS agent dashboard aggregates queued ticket counts by status for unassigned branch tickets, assigned ticket counts by status, and SLA risk metrics reusing official SLA rules.
- **AC-11**: CS agent dashboard includes a highlighted needs attention subset containing tickets at SLA risk, breached tickets, and pending reassignments.
- **AC-12**: CS agent dashboard handles partial query failure gracefully: if secondary metric calculation fails, that section returns null with a section error flag rather than a false zero count, and remaining sections still return valid data.

## Decision

**Chosen option**: Integrated modular operational suite in ticket service with synchronous streaming for spreadsheets, asynchronous queue for heavy PDF rendering, gateway route prefix alignment, dedicated audit query indexes, and resilient dashboard aggregators.

**Implementation skills**: `laravel-microservice` (`.agents/skills/laravel-microservice/`) · `react-frontend` (`.agents/skills/react-frontend/`) · `api-testing` (`.agents/skills/api-testing/`)

## Architecture and Shared Contracts

### Gateway Routing Alignment

Under `nginx.conf`, ticket service FastCGI traffic is routed via location pattern `^/api/ticketing/ticket(.*)$`. To guarantee routing through the gateway without 404 errors, all endpoints in this suite adopt the `/api/ticketing/ticket/` URL path prefix:
- Reports: `/api/ticketing/ticket/admin/reports/...`
- Audit Logs: `/api/ticketing/ticket/superadmin/audit-logs/...`
- CS Dashboard: `/api/ticketing/ticket/cs-dashboard-summary`

### Service Ownership and Boundaries

Ticket service owns the transactional domain for tickets, ticket statuses, ticket priorities, assignments, SLA rules, and audit logs. Secondary communication occurs over internal REST calls:
- Ticket service calls `analytics-service` over internal HTTP (`GET /api/analytics/feedback/csat-export`) for CSAT survey metrics with a 2 second timeout and neutral fallback. Direct database queries into analytics service tables are strictly avoided.
- Ticket service dispatches asynchronous export events to `notification-service` and Reverb WebSockets so Admins receive real time toast alerts when files are ready.

### Shared Security and Scoping Invariants

1. Branch Scoping: Admin users are locked to their assigned branch extracted from their authenticated session token. Only Super Admins may specify an optional `branch_id` query parameter.
2. Immutability: Audit log records can only be created via append only inserts. No update or delete operations are permitted.
3. Cryptographic and Token Protection: File downloads generated by background export jobs are accessed via single use or time limited download tokens expiring in 24 hours.

## Build plan

### Slicing Strategy (Tracer Bullet Approach)

The umbrella implementation follows a vertical tracer bullet sequence, building end to end capabilities layer by layer across database, backend service, API controller, and frontend wiring:

- **Slice 1: Database and Schema Foundation**
  - Create migration for `report_exports` table in `services/ticket-service` with nullable `requested_by` (satisfies AC-3).
  - Create migration adding composite indexes to `ticket_audit_logs` and `tickets` (satisfies AC-9).
  - Verify database performance with simulated record volumes.

- **Slice 2: Admin Reports Preview and Multi Format Export**
  - Implement `ReportDataQueryService` with unified data extraction for preview and exports, including internal HTTP fetch for CSAT data (satisfies AC-1, AC-2, AC-4, AC-5).
  - Implement synchronous cursor streaming for CSV and XML Excel up to 5000 rows (satisfies AC-2, AC-3).
  - Implement `GenerateReportExportJob` queued job for heavy PDF generation with DomPDF and a 1000 row ceiling, dispatching Reverb broadcast on completion (satisfies AC-3).
  - Expose API endpoints in `ReportExportController` routed under `/api/ticketing/ticket/admin/reports/` (satisfies AC-1, AC-3).
  - Connect React frontend `AdminReports.jsx` to live API endpoints (satisfies AC-1, AC-2, AC-3).

- **Slice 3: Super Admin Audit Log Search and Dynamic Filters**
  - Implement `AuditLogFilterService` supporting full query parameters, keyword search with mandatory date filters, and pagination (satisfies AC-6).
  - Implement dynamic options endpoint `GET /api/ticketing/ticket/superadmin/audit-logs/filters` (satisfies AC-8).
  - Enforce immutability by removing or deprecating purge and delete routes (satisfies AC-7).
  - Update React frontend `SuperAdminAuditLogs.jsx` to query live filter endpoints with debounce (satisfies AC-6, AC-8).

- **Slice 4: Customer Service Workload Dashboard**
  - Implement CS agent scoped summary aggregation in `TicketDashboardService` with clear status mapping (satisfies AC-10).
  - Implement needs attention subset detection reusing `SLAService` risk thresholds (satisfies AC-11).
  - Implement independent try catch wrappers per metric section returning null metrics on failure for clear UI warning badges (satisfies AC-12).
  - Expose `GET /api/ticketing/ticket/cs-dashboard-summary` in `TicketDashboardController` (satisfies AC-10).
  - Connect React frontend `CSDashboard.jsx` to live scoped metrics (satisfies AC-10, AC-11).

- **Slice 5: End to End Verification and Integration Testing**
  - Write PHPUnit feature tests in `services/ticket-service/tests/Feature/` covering report exports, audit filtering, and CS dashboard metrics.
  - Verify zero data found responses, branch isolation, and partial failure responses.

## Consequences

**Positive**:
- Eliminates mock data across three major administrative surfaces.
- Large report exports no longer trigger HTTP 504 gateway timeouts.
- Super Admin audit log queries scale efficiently on large datasets without full table scans.
- CS agents gain clear prioritization with visibility into SLA risk items and pending reassignments.
- No new external dependencies required; DomPDF and native PHP CSV and XML formatting keep deployment simple.

**Tradeoffs and Mitigations**:
- Background job processing requires a working queue worker in Docker. Mitigation: docker compose configuration includes Laravel queue worker container.
- Export files take disk space. Mitigation: `report_exports` records and files expire after 24 hours, cleaned by a scheduled cleanup task.

## Follow-up

- Coordinate with notification service to ensure WebSocket event `report.export.completed` displays interactive download buttons on the employee top bar bell.
- Add an automated daily pruning command for files older than 24 hours in storage app private exports.

## Rationale

Reasoning, alternatives considered, and architectural tradeoffs: see [rationale.md](rationale.md).
