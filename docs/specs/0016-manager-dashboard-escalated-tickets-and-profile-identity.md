# 0016. Manager Dashboard Escalated Tickets and Profile Identity Display

**Date**: 2026-10-30
**Status**: Accepted

## Summary

This specification addresses two key problems experienced by department managers accessing `/ticketing/employee/dashboard`:
1. Escalated tickets are not visible on the manager dashboard because the query strictly filtered by assignment records without department level manager visibility, the dashboard cards were configured with hardcoded text and mismatched priority logic, and metric counts inflated with non escalated tickets.
2. The upper right header failed to display the manager full name and displayed generic role label "service" instead of "Manager" because user normalization lacked name concatenation, the employee model lacked a name accessor and position level serialization, and the header lacked priority fallback to position level and technical role.

## Context

In employee operations at `/ticketing/employee/dashboard`:
- Department leadership accounts (such as Service Manager Reymie Gonzaga or IT Manager Ejay Detera) oversee escalated tickets for their departments.
- In `EmployeeAssignmentService.php`, `getEmployeeTickets()` joined exclusively on `ticket_assignments.employee_ID`. When a ticket was escalated, if the assignment record was incomplete or if tickets in the manager department were elevated to leadership, they did not appear in the manager listing.
- In `EmployeeDashboard.jsx`, the "Escalated Tickets" card queried `visible.find(t => t.priority === 'Critical')` rather than checking `t.status === 'Escalated'`. The adjacent card contained hardcoded text ("Ventilator Pressure Alarm Fault" and "SLA Breached"), while checking `t.status === 'Escalated'`.
- In `Header.jsx`, lines 341 to 342 directly rendered `{user?.name || 'User'}` and `{user?.role || ''}`. In the database, the `employees.role` column contains the legacy authorization token `"service"`, while the user actual managerial designation is stored in `position_level: "Manager"` and `technical_role: "Service Manager"` or `"IT Manager"`. Because `name` was not generated from `first_name` and `last_name`, the header displayed "User" and "Service" instead of the manager full name and title.

## Requirements

**User stories**:
- As a department manager, I want to see escalated tickets for my department prominently on my dashboard so that I can immediately act on issues escalated to leadership.
- As a department manager, I want my full name and managerial title ("Manager" or "Department Manager") displayed in the upper right header rather than a generic role string.

**Acceptance criteria**:
- **AC-1**: In `EmployeeAssignmentService.php`, `getEmployeeTickets()` checks for department managers (`position_level === 'Manager'`). For managers, the query returns all tickets assigned to them in `ticket_assignments` or `tickets.assigned_to`, plus all escalated tickets (`ticket_status_ID = 5`) within their department category.
- **AC-2**: In `EmployeeDashboard.jsx`, the "Escalated Tickets" card dynamically finds tickets where `status === 'Escalated'` or `escalated === true`. It displays the real ticket title, red status badge, and escalation reason. The left card dynamically renders SLA breached tickets.
- **AC-3**: In `EmployeeDashboard.jsx`, the "Escalated Tickets" metric card counts tickets with `status === 'Escalated'` or `escalated === true`, styling with the red destructive variant.
- **AC-4**: In `Employee.php` (`services/customer-service`), `getNameAttribute()` returns the concatenated `first_name` and `last_name`, with `name` added to `$appends`. `position_level`, `technical_role`, `branch`, and `branch_id` are included in `$fillable`.
- **AC-5**: In `AuthContext.jsx`, `normalizeUser()` sets `name` from `first_name` and `last_name`, preserving `position_level` and `technical_role`.
- **AC-6**: In `Header.jsx`, `displayName` resolves from `user.name`, `first_name`, and `last_name`. `displayRole` checks if `position_level` or `role` is `Manager`, displaying the manager title rather than "service".

## Options considered

### Option 1: UI Only Overrides with Local Storage Patching
Patch the frontend header to look up mock values or hardcoded email mappings, and leave backend queries unchanged.

**Pros**:
- Small frontend only touch.

**Cons**:
- Brittle and breaks for new employees or role updates.
- Leaves database serialization incomplete.
- Fails to show escalated tickets in the manager account backend API.

### Option 2: Full Stack Identity Resolution and Department Manager Query Extension
Update the backend employee query to include department escalated tickets for managers, add name accessors and position level attributes to `Employee.php`, normalize the user object in `AuthContext.jsx`, and update `Header.jsx` and `EmployeeDashboard.jsx` to render dynamic titles, names, and reasons.

**Pros**:
- Fixes the root cause on both backend and frontend.
- Works across all current and future managers in Service, IT, Operations, and Customer Support.
- Accurately aligns with ONE UI design standards.

**Cons**:
- Touches `customer-service`, `employee-service`, and frontend components.

## Decision

**Chosen option**: Option 2: Full Stack Identity Resolution and Department Manager Query Extension

**Implementation skills**: `laravel-microservice` (`customer-service`, `employee-service`), `react-frontend` (`frontend/web/`)

## Build plan

1. **Backend Model & Auth (`services/customer-service`)**:
   - In `Employee.php`: add `$appends = ['name']`, `getNameAttribute()`, and add `position_level`, `technical_role`, `branch`, `branch_id` to `$fillable`.
   - In `AuthController.php`: verify `me()` returns the decorated employee attributes.

2. **Backend Query Extension (`services/employee-service`)**:
   - In `EmployeeAssignmentService.php`: update `getEmployeeTickets()` query so that if the employee is a Manager, all escalated tickets (`t.ticket_status_ID = 5`) in their department category are returned alongside directly assigned tickets.

3. **Frontend Auth Normalization (`frontend/web/src/context/AuthContext.jsx`)**:
   - In `normalizeUser()`: compute `name` from `first_name` and `last_name`, and retain `position_level` and `technical_role`.

4. **Frontend Header (`frontend/web/src/components/Header.jsx`)**:
   - Compute `displayName` from `user.name` or `first_name` and `last_name`.
   - Compute `displayRole` prioritizing `position_level === 'Manager'` to display "Manager" or "Department Manager" instead of "service".

5. **Frontend Dashboard (`frontend/web/src/pages/EmployeeDashboard.jsx`)**:
   - Fix `escalatedTicket` to find tickets with `status === 'Escalated'` or `escalated === true`.
   - Fix `urgentTicket` / `slaBreachedTicket` to find tickets breaching SLA.
   - Remove hardcoded "Ventilator Pressure Alarm Fault" card title, replacing with dynamic ticket information.
   - Refine `escalatedCount` in metrics summary to count only escalated tickets with the red destructive badge.

6. **Verification**:
   - Run tinker tests on `Employee` model and `EmployeeAssignmentService`.
   - Clear Redis and application caches.
   - Run vitest frontend tests.
