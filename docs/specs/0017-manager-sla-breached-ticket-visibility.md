# 0017. Manager SLA Breached Ticket Visibility

**Date**: 2026-10-30
**Status**: Accepted

## Summary

This specification establishes complete visibility of SLA breached support tickets for department leadership across the employee portal. Department managers can view all SLA breached tickets within their department category on the dashboard and assigned tickets views, monitor overdue metrics in real time, and filter directly by SLA status.

## Context

In support desk operations, SLA compliance is a core supervisory responsibility of department managers.
- In `EmployeeAssignmentService.php`, the query returned tickets directly assigned to an employee or escalated tickets. However, tickets that breached their SLA deadlines within the department remained hidden from the department manager if those tickets were assigned to junior technicians or unassigned.
- In `EmployeeDashboard.jsx`, while metric cards and alert containers existed for SLA breaches, managers could not see their department breached tickets because the backend excluded them. Additionally, neither the dashboard nor the incoming tickets view provided an explicit SLA status filter dropdown.
- When an SLA breach occurs, `SLAService.php` dispatches departmental alerts. Enabling department managers to view these tickets immediately on their dashboard (`/ticketing/employee/dashboard`) and incoming list (`/ticketing/employee/assigned`) ensures rapid departmental intervention and resolution.

## Requirements

**User stories**:
- As a department manager, I want to see all SLA breached tickets belonging to my department on my dashboard and assigned tickets list so that I can immediately intervene on overdue issues.
- As a department manager, I want an SLA status filter dropdown on my dashboard and incoming tickets list so that I can easily isolate tickets that are Breached, At Risk, On Track, or Paused.
- As a department manager, I want clicking the SLA Breached metric card or alert banner to focus directly on breached tickets.

**Acceptance criteria**:
- **AC-1**: In `EmployeeAssignmentService.php`, `getEmployeeTickets()` queries both directly assigned tickets and departmental tickets. For department managers, the query returns all non closed and non resolved tickets within the manager department category that have breached their SLA (`sla_status = 'Breached'` or resolution deadline in the past or breach notification alert dispatched).
- **AC-2**: In `EmployeeDashboard.jsx`, the "SLA Breached" metric card and alert card dynamically display the count and details of breached tickets for the manager department.
- **AC-3**: In `EmployeeDashboard.jsx`, an SLA status filter dropdown is available with options: "All SLA", "Breached", "At Risk", "On Track", and "Paused". Clicking the "SLA Breached" metric card sets the filter to "Breached".
- **AC-4**: In `EmployeeAssigned.jsx`, an SLA status filter dropdown is added to the toolbar, allowing the manager to filter incoming and assigned tickets by SLA status.
- **AC-5**: In both views, SLA breached tickets render with the red destructive Breached badge token.

## Options considered

### Option 1: Manager Manual Ticket Search
Require managers to search for ticket identifiers manually or rely solely on email alerts.

**Pros**:
- No code changes.

**Cons**:
- Severe usability gap. Managers cannot track department wide SLA compliance at a glance.
- Fails the core user requirement.

### Option 2: Unified Departmental SLA Visibility in Employee Services
Extend the employee assignment query to automatically include departmental SLA breaches for managers, add SLA status filter dropdowns to the dashboard and incoming tickets view, and provide interactive metric card click filtering.

**Pros**:
- Delivers complete end to end visibility.
- Leverages existing SLA calculation logic in `EmployeeAssignmentService`.
- Complies strictly with ONE UI design tokens.

**Cons**:
- Requires coordinated backend query and frontend filter updates.

## Decision

**Chosen option**: Option 2: Unified Departmental SLA Visibility in Employee Services

**Implementation skills**: `laravel-microservice` (`services/employee-service/`), `react-frontend` (`frontend/web/`)

## Build plan

1. **Backend Employee Service (`services/employee-service`)**:
   - In `EmployeeAssignmentService.php`: update the manager condition in `getEmployeeTickets()` so that in addition to `t.ticket_status_ID = 5` (Escalated), it also includes non closed and non resolved tickets (`t.ticket_status_ID NOT IN (3, 4)`) where `t.sla_status = 'Breached'`, `t.resolution_due_at < NOW()`, or `t.sla_breach_notified_at IS NOT NULL` within the manager department category.

2. **Frontend Employee Dashboard (`frontend/web/src/pages/EmployeeDashboard.jsx`)**:
   - Add `slaFilter` state (`'All SLA'`).
   - Add SLA status dropdown to the filter toolbar.
   - Wire `MetricCard` for "SLA Breached" to filter by `slaFilter = 'Breached'`.
   - Update `filtered` memo to respect `slaFilter`.

3. **Frontend Employee Assigned View (`frontend/web/src/pages/EmployeeAssigned.jsx`)**:
   - Add `slaFilter` state (`'All SLA'`).
   - Add SLA status dropdown to the filter bar alongside status, category, and priority.
   - Update `filteredTickets` memo to filter by SLA status.
   - Handle `location.state?.initialSlaFilter` to automatically apply the filter when navigating from the dashboard alert card.

4. **Verification**:
   - Verify query with tinker for Service Manager and IT Manager.
   - Run vitest test suite.
   - Refresh application and Redis caches.
