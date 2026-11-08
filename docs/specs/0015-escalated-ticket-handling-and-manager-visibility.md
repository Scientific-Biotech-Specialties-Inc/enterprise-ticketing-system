# 0015. Escalated Ticket Handling and Department Manager Visibility

**Date**: 2026-10-30
**Status**: Accepted

## Summary

This specification defines the complete lifecycle behavior for escalated support tickets. Once a ticket is escalated, Customer Service representatives cannot escalate it again. Escalated status badges display in red across all views. Escalation reassigns the ticket directly to the designated department manager, persists the escalation reason, presents the ticket with its reason in the manager account portal, and delivers an urgent notification alert to the manager matching SLA breach notifications.

## Context

In Customer Service ticket operations at `/ticketing/cs/assigned`, several gaps were identified in the escalation workflow:

1. Tickets that were already escalated continued to display the active Escalate action button. This allowed representatives to submit repeated escalations on tickets already elevated to leadership.
2. The status badge for Escalated tickets rendered in sky blue because `getStatusBadgeVariant()` in the UI badge component lacked a mapping for the escalated state. Escalations represent high priority elevated issues and require prominent red badge styling.
3. When Customer Service submitted an escalation, `CSModals.jsx` attempted to call `acceptTicket()` after `updateTicket()`. In `EmployeeAssignmentService.php`, `acceptTicket()` was designed to reset tickets to `Pending Assignment`, overwriting the Escalated status or failing validation. Furthermore, `tickets` table had no dedicated storage for `escalation_reason`, so the reason provided by Customer Service was never stored on the ticket or shown to the department manager.
4. When tickets breached their SLA deadlines, `SLAService.php` dispatched automated alerts to the department manager. However, manual ticket escalations did not dispatch a direct alert to the manager, leaving managers uninformed unless they manually refreshed their dashboards.

## Requirements

**User stories**:
- As a Customer Service representative, I want tickets that are already escalated to disable or hide the escalation action so that tickets are not repeatedly escalated.
- As a representative or manager, I want the status badge for Escalated tickets to display in red so that elevated tickets are immediately recognizable.
- As a department manager, I want escalated tickets to appear in my assigned tickets list with the full escalation reason visible so that I can promptly act on the issue.
- As a department manager, I want to receive an urgent notification whenever a ticket is escalated to my department, similar to SLA breach notifications.

**Acceptance criteria**:
- **AC-1**: In `CSAssigned.jsx` and `TicketSummary` (`CSModals.jsx`), if a ticket status is `Escalated` or its status ID is 5, the Escalate action button is disabled or hidden with an indicator that the ticket is already escalated.
- **AC-2**: In `getStatusBadgeVariant()` within `badge.jsx`, status `'escalated'` maps to the destructive red badge variant across all table rows and modals.
- **AC-3**: A database migration adds `escalation_reason` text column to the `tickets` table. `TicketService::updateTicket()` accepts `assigned_to` and `escalation_reason` when status ID is 5 (`Escalated`), updating `tickets.assigned_to`, recording the manager in `ticket_assignments`, and storing `escalation_reason`.
- **AC-4**: In `EmployeeAssignmentService.php` and `TicketService.php`, ticket listing and detail endpoints return `escalation_reason`. In the employee and manager portal (`EmployeeAssigned.jsx`, `TicketDetailModal.jsx`, `TicketInfoModal.jsx`), the ticket appears under the manager account and displays an escalation banner with the escalation reason.
- **AC-5**: In `TicketService.php`, when transitioning a ticket to `Escalated`, the service dispatches an urgent manager notification and email to the assigned department manager, including the escalation reason.
- **AC-6**: `TicketStateMachine.php` rejects transition from `STATE_ESCALATED` to `STATE_ESCALATED`.

## Options considered

### Option 1: UI Only Restrictions and Note Reading
Disable the Escalate button on the frontend when status is Escalated, keep relying on internal notes for the reason, and expect managers to read internal notes to understand why a ticket was escalated.

**Pros**:
- Requires fewer backend changes.

**Cons**:
- Fails to reliably assign the ticket to the manager in the database.
- Lacks a structured escalation reason on the ticket record.
- Does not notify the manager via push alerts or email.

### Option 2: Unified First Class Escalation Flow
Add `escalation_reason` to the `tickets` table, handle manager assignment and notification directly inside `TicketService::updateTicket()`, update badge variant tokens to red, disable re-escalation in both frontend and backend state machine, and render an escalation banner in the manager ticket detail modal.

**Pros**:
- Provides end to end data integrity and reliable manager assignment.
- Clear visual cues with red status badges across all employee and Customer Service views.
- Immediate real time notification to the department manager.
- Follows the established architectural pattern used for `hold_reason` and SLA breach notifications.

**Cons**:
- Requires synchronized updates to database schema, backend services, and frontend modals.

## Decision

**Chosen option**: Option 2: Unified First Class Escalation Flow

**Implementation skills**: `laravel-microservice` (`services/ticket-service/`, `services/employee-service/`), `react-frontend` (`frontend/web/`)

## Build plan

1. **Database migration**:
   - Create migration `2026_10_30_000001_add_escalation_reason_to_tickets_table.php` in `services/ticket-service`.
   - Add nullable text column `escalation_reason` to `tickets`.
   - Run migration in `ticket-service` container.

2. **Backend service logic (`services/ticket-service`)**:
   - In `TicketStateMachine.php`: ensure `canTransition('Escalated', 'Escalated')` evaluates to false.
   - In `TicketService.php`:
     - In `updateTicket()`: if `ticket_status_ID` is 5 (`Escalated`), prevent re-escalation if already status 5 with code `ALREADY_ESCALATED`.
     - Accept `assigned_to` and `escalation_reason` in `$validated`.
     - In the database transaction: update `tickets.assigned_to`, `tickets.escalation_reason`, and update or insert the primary assignee in `ticket_assignments` table with `assignment_status = 'assigned'`.
     - Dispatch notification and email to the assigned department manager with title `Ticket Escalated: {ticketRef}` and message explaining the escalation reason.
     - Include `t.escalation_reason` in `getTicketDetails()` and ticket listing queries.

3. **Backend employee service logic (`services/employee-service`)**:
   - In `EmployeeAssignmentService.php`: include `t.escalation_reason` in `getEmployeeTickets()` query.

4. **Frontend badge styling**:
   - In `frontend/web/src/components/ui/badge.jsx`: add `s === 'escalated'` to the destructive condition in `getStatusBadgeVariant()`.

5. **Frontend Customer Service views**:
   - In `frontend/web/src/components/CSModals.jsx`:
     - In `TicketSummary`: if `ticket.status === 'Escalated'` or `currentStatus === 'Escalated'`, replace the Escalate button with an "Already Escalated" disabled badge or button.
     - If escalated, display the escalation banner with `ticket.escalation_reason`.
     - In `handleConfirmEscalate`: pass `assigned_to: targetEmpId` and `escalation_reason: reason` directly to `updateTicket()`, removing the redundant call to `acceptTicket()`.
   - In `frontend/web/src/components/cs/EscalateTicketModal.jsx`:
     - Prevent opening or submission if ticket is already escalated.

6. **Frontend Employee and Manager views**:
   - In `frontend/web/src/components/employee/TicketDetailModal.jsx` and `TicketInfoModal.jsx`:
     - Display an Escalated banner with red styling when `ticket.status === 'Escalated'`, presenting the escalation reason.

7. **Verification**:
   - Run migration and clear Redis caches.
   - Run vitest frontend tests for `EscalateTicketModal` and badges.
   - Verify manager account receives the ticket and displays the escalation reason.
