# 0024. Child 2: Employee Dual Role Personal Dashboard API

**Date**: 2026-11-01

## Summary

This specification defines the Employee personal dashboard API endpoint at `GET /api/ticketing/ticket/employee/dashboard`. It serves employees who operate in two concurrent roles: an assigned technician resolving customer issues, and an internal requestor who submitted internal support tickets. The endpoint returns two clearly separated result sets: `assigned` (workload status breakdown, SLA risk levels, and recent ticket assignments) and `requested` (submitted ticket statuses, auto close pending alerts, and reopened indicators). It enforces strict server side scoping, reuses `SLAService` risk classification, and handles partial query failures gracefully by returning valid section data alongside structured section errors.

## Requirements

**User stories**:
- As an Employee, I want a personal dashboard displaying my assigned ticket workload when acting as an Assigned Employee, so that I can prioritize urgent customer tasks and avoid SLA breaches.
- As an Employee, I want to view the status of tickets I have submitted when acting as a Requestor, so that I can track my internal hardware and service requests.
- As an Employee, I want to see which of my submitted tickets are pending auto close, so that I can confirm resolution or reopen the ticket before it closes permanently.
- As an Employee, I want the dashboard to load reliably even if secondary metrics encounter an issue, so that I am never locked out of my work queue.

**Acceptance criteria**:
- **AC-2.1**: The endpoint `GET /api/ticketing/ticket/employee/dashboard` returns a structured JSON payload containing top level objects `assigned`, `requested`, and array `partial_errors`.
- **AC-2.2**: The `assigned` section scopes queries to `tickets.assigned_to = employee_id` for the authenticated employee, aggregating counts by status (`open`, `in_progress`, `on_hold`, `resolved`, `closed`).
- **AC-2.3**: The `assigned` section classifies active tickets by SLA risk using `SLAService::classifyTicketRisk`: `within_sla`, `near_breach` (at risk), and `breached`.
- **AC-2.4**: The `assigned` section includes a list of recent assigned tickets (up to 10 records) with ticket number, subject, priority, status, due date, and SLA indicator badge.
- **AC-2.5**: The `requested` section scopes queries to tickets submitted by the authenticated user (`tickets.created_by = user_id`), aggregating counts by status and highlighting `auto_close_pending_count` and `reopened_count`.
- **AC-2.6**: The `requested` section includes a list of recent submitted tickets (up to 10 records) showing ticket number, title, current status, assigned technician name, auto close expiration countdown where applicable, and reopened flag.
- **AC-2.7**: Server side scoping strictly prevents an employee from seeing tickets assigned to other staff members or requests submitted by other employees.
- **AC-2.8**: Graceful partial failure isolation: if query execution for the `assigned` or `requested` section throws an exception, the healthy section returns complete data, the affected section returns null, and `partial_errors` captures the section name and error message, returning HTTP 200.
- **AC-2.9**: Query performance is optimized via composite indexes on `tickets (assigned_to, ticket_status_ID)` and `tickets (created_by, ticket_status_ID)`.

## Decision

**Chosen option**: Build `EmployeeDashboardService.php` in `ticket-service` executing parallel or isolated queries for assigned and requested workloads, wrapping each section in a try catch block to populate `partial_errors` on failure.

**Implementation skills**: `laravel-microservice` (`services/ticket-service/`), `react-frontend` (`frontend/web/`), `api-testing` (`.agents/skills/api-testing/`).

## Feature design

### API surface

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/ticketing/ticket/employee/dashboard` | GET | `force_refresh` (opt) | `assigned`: object nullable, `requested`: object nullable, `partial_errors`: array | Bearer Employee Role | 401 Unauthorized, 403 Forbidden |

### Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| Load employee dashboard | Assigned status counts | SQL count on `tickets` where `assigned_to = employee_id` grouped by `ticket_status_ID` |
| Load employee dashboard | SLA risk breakdown | `SLAService::classifyTicketRisk` evaluated against active assigned tickets |
| Load employee dashboard | Requested status counts | SQL count on `tickets` where `created_by = user_id` grouped by `ticket_status_ID` |
| Load employee dashboard | Auto close countdown | Difference between `tickets.auto_close_at` and current timestamp |
| Load employee dashboard | Reopened flag | Inspecting `tickets.reopened_at` or `ticket_statuses.slug = 'reopened'` |
| Load employee dashboard | Assigned technician name | Left join on `employees` matching `tickets.assigned_to` |

### Key invariants

1. Identity Isolation: Authenticated `employee_id` is derived securely from the authenticated token and user profile; client provided employee identifiers are strictly ignored.
2. Resilience Guarantee: A failure in SLA classification or request tracking must never trigger a whole page HTTP 500 error. The partial error envelope must inform the client which subsection failed.
3. SLA Consistency: Workload SLA risk calculations must match the exact thresholds applied across CS and Admin dashboards.

## Build plan

1. Implement `EmployeeDashboardService.php` in `services/ticket-service/app/Services/` with methods:
   - `getEmployeeDashboard(int $employeeId, int $userId, bool $forceRefresh)`.
   - `getAssignedWorkload(int $employeeId)`.
   - `getRequestedWorkload(int $userId)`.
2. Add controller endpoint in `TicketDashboardController.php` or dedicated `EmployeeDashboardController.php`.
3. Add route `GET /api/ticketing/ticket/employee/dashboard` in `routes/api.php` with employee authentication middleware.
4. Add feature test `services/ticket-service/tests/Feature/EmployeeDashboardTest.php` testing:
   - Correct scoping of assigned tickets and SLA risk breakdown.
   - Correct scoping of requested tickets, auto close alerts, and reopened counts.
   - Graceful partial error handling when one section throws an exception.

