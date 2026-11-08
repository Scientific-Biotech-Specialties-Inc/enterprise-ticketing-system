# 0024. Child 1: Super Admin System Wide Dashboard and Branch Comparison API

**Date**: 2026-11-01

## Summary

This specification defines the Super Admin system wide dashboard API endpoint at `GET /api/ticketing/ticket/superadmin/system-dashboard`. It aggregates total users by role, total tickets, active and escalated ticket counts, SLA breach totals, tickets created today, a recent activity feed, sortable branch comparison metrics, and overall system KPIs in a single network call. The endpoint enforces strict server side authorization for Super Admins, preserves the current day anchor for tickets created today regardless of date range filters, reuses proven calculation formulas from `SLAService` and `TicketDashboardService`, and implements a 60 second Redis caching strategy with on demand bypass.

## Requirements

**User stories**:
- As a Super Admin, I want a system wide dashboard displaying total users by role, total tickets, active and escalated tickets, SLA breaches, tickets created today, recent activity, branch comparisons, and system KPIs, so that I can monitor the entire organization support ecosystem.
- As a Super Admin, I want to compare performance metrics across branches and sort by any metric, so that I can identify high performing teams and facilities requiring operational support.
- As a Super Admin, I want date range filters to adjust historic KPIs while keeping tickets created today pinned to the current date, so that I never lose immediate operational context.

**Acceptance criteria**:
- **AC-1.1**: The endpoint `GET /api/ticketing/ticket/superadmin/system-dashboard` returns a consolidated JSON response containing `summary`, `kpis`, `branch_comparisons`, `recent_activity`, and `meta`.
- **AC-1.2**: User counts by role are aggregated across active roles (`superadmin`, `admin`, `cs`, `employee`, `customer`), sourced from the user replica with internal microservice fallback and cached in Redis.
- **AC-1.3**: The metric `tickets_created_today` calculates all tickets created since 00:00:00 of the current calendar date in the local facility timezone, remaining unchanged when historic date range filters are applied.
- **AC-1.4**: Date range filters (`date_from`, `date_to`, `preset`) filter total tickets, SLA compliance rate, resolution time, and branch comparison data.
- **AC-1.5**: Branch comparisons list every active branch with: `branch_id`, `branch_name`, `branch_code`, `total_tickets`, `active_tickets`, `escalated_tickets`, `sla_breaches`, `sla_compliance_rate`, `avg_resolution_hours`, and `csat_score`.
- **AC-1.6**: Query parameters `sort_by` and `sort_dir` sort the `branch_comparisons` array on any numeric or text metric in ascending or descending order (default: `total_tickets` descending).
- **AC-1.7**: The `recent_activity` list returns the latest system events from `ticket_audit_logs`, bounded by query parameter `activity_limit` (default 15, maximum 50), including ticket number, action type, actor name, actor role, timestamp, and summary.
- **AC-1.8**: Only users with authenticated role `superadmin` or `system_admin` may access this endpoint. Non superadmins receive HTTP 403 Forbidden.
- **AC-1.9**: Dashboard results are cached in Redis with a 60 second time to live, partitioned by date filter parameters, and immediately recalculated when `force_refresh=true` is provided.

## Decision

**Chosen option**: Single composite endpoint `GET /api/ticketing/ticket/superadmin/system-dashboard` powered by a dedicated `SuperAdminDashboardService` in `ticket-service`, utilizing Redis caching and existing SLA and CSAT aggregation helpers.

**Implementation skills**: `laravel-microservice` (`services/ticket-service/`), `react-frontend` (`frontend/web/`), `api-testing` (`.agents/skills/api-testing/`).

## Feature design

### API surface

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/ticketing/ticket/superadmin/system-dashboard` | GET | `preset` (opt), `date_from` (opt), `date_to` (opt), `sort_by` (opt), `sort_dir` (opt), `activity_limit` (opt), `force_refresh` (opt) | `summary`: object, `kpis`: object, `branch_comparisons`: array, `recent_activity`: array, `meta`: object | Bearer Super Admin | 401 Unauthorized, 403 Forbidden, 422 Invalid |

### Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| Fetch system dashboard | User counts by role | Local user replica table in `ticket-service`, with 60 second Redis cache |
| Fetch system dashboard | Tickets created today | SQL query `COUNT(*) FROM tickets WHERE created_at >= CURDATE()`, ignoring filter dates |
| Fetch system dashboard | SLA compliance rate | Computed via `SLAService` formulas dividing compliant tickets by eligible tickets |
| Fetch system dashboard | Average resolution time | Average difference in hours between `tickets.created_at` and `tickets.resolved_at` |
| Fetch system dashboard | CSAT average rating | Average score from ticket feedback submissions or internal analytics service bridge |
| Fetch system dashboard | Branch comparisons | Grouped aggregation on `tickets` grouped by `branch_id`, joined with `branches` |
| Fetch system dashboard | Recent activity feed | Latest records from `ticket_audit_logs` joined with `tickets`, `employees`, and `clients` |

### Key invariants

1. Super Admin Authorization: Only callers with authenticated role `superadmin` or `system_admin` may call this endpoint.
2. Current Day Isolation: The `tickets_created_today` metric must never be overwritten or recalculated by the date filter inputs.
3. Sorting Safety: Only recognized metric columns may be used for `sort_by` (`total_tickets`, `active_tickets`, `escalated_tickets`, `sla_breaches`, `sla_compliance_rate`, `avg_resolution_hours`, `csat_score`, `branch_name`). Arbitrary SQL injection strings are rejected with HTTP 422.
4. Non Blocking Redis Cache: Cache keys use prefix `system_dashboard:`, tagged with timestamp and cleared using Redis `SCAN` or TTL expiration.

## Build plan

1. Implement `SuperAdminDashboardService.php` in `services/ticket-service/app/Services/` with methods:
   - `getSystemDashboard(array $filters, string $sortBy, string $sortDir, int $activityLimit, bool $forceRefresh)`.
   - `getUserCountsByRole()`.
   - `getBranchComparisons(array $dateRange, string $sortBy, string $sortDir)`.
   - `getRecentActivity(int $limit)`.
2. Register controller method in `SuperAdminConfigController.php` or dedicated `SuperAdminDashboardController.php`.
3. Add route `GET /api/ticketing/ticket/superadmin/system-dashboard` in `routes/api.php` behind `auth:sanctum` and role verification middleware.
4. Add feature test in `services/ticket-service/tests/Feature/SuperAdminDashboardTest.php` verifying authorization boundaries, date filtering, fixed today counts, branch sorting, and Redis caching.

