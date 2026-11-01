# 0014. Fix Ticket Escalation State Machine and IT Manager Visibility

**Date**: 2026-10-30
**Status**: Accepted

## Summary

This specification fixes the 422 Unprocessable Entity error encountered during ticket escalation and ensures the IT Department Manager is visible and selectable within Customer Service ticket management at `/ticketing/cs/assigned`.

## Context

Customer Service representatives managing tickets at `/ticketing/cs/assigned` experienced two blocking problems:

1. In the ticket summary and escalation surfaces, the Manager of the IT Department (`Ejay Detera`) is either missing from the escalation recipient list or shows incomplete contact information. In `EscalateTicketModal`, the target department was strictly inferred from the assigned technician department, locking escalation to Service rather than allowing escalation to IT or letting the representative choose the target department. In `CSAssigned.jsx`, employee email mapping dropped the email attribute, causing the manager contact card to display fallback text.

2. When the representative clicks confirm in `EscalateTicketModal`, `CSModals.jsx` dispatches `updateTicket({ ticketId, statusId: 5 })`. The `ticket-service` backend rejects this request with status code 422 (`INVALID_TICKET_TRANSITION`). The root cause is inside `TicketStateMachine.php` and `TicketConfigurationService.php`, where status ID 5 is incorrectly defined as `STATUS_ID_CANCELLED` and `STATUS_ID_ESCALATED` simultaneously. The state machine lacks an `Escalated` state in its transition matrix, does not resolve status ID 5 to an allowed escalation state, and falls back to `Open`, which active tickets cannot legally transition into.

## Requirements

**User stories**:
- As a Customer Service representative, I want to escalate tickets to the Manager of the IT Department so that software, network, and system issues reach technical leadership.
- As a Customer Service representative, I want the escalation submission to succeed cleanly without receiving a 422 transition error.
- As a department manager, I want tickets escalated to my department to transition into the Escalated status and assign to my leadership profile.

**Acceptance criteria**:
- **AC-1**: `TicketStateMachine.php` defines status ID 5 strictly as `STATUS_ID_ESCALATED` and removes the conflicting `STATUS_ID_CANCELLED` alias (status ID 9 is `STATUS_ID_DISCARDED` / cancelled).
- **AC-2**: `TicketStateMachine.php` introduces canonical state `STATE_ESCALATED = 'Escalated'`. Resolving state for status ID 5 returns `STATE_ESCALATED`.
- **AC-3**: `TicketStateMachine.php` and `TicketConfigurationService.php` permit transitions to `STATE_ESCALATED` from active states (`Open`, `Assigned`, `Reassigned`, `In Progress (CS-owned)`, `In Progress (Employee-owned)`, and `On Hold/Pending`).
- **AC-4**: `TicketService.php` update logic removes status ID 5 from the terminal closed or cancelled list (`$isClosedOrCancelled = in_array((int)$ticket->ticket_status_ID, [4, 9], true)`).
- **AC-5**: In `CSAssigned.jsx`, the employee status mapping retains the `email` property and `emp_id` so manager contact cards in `TicketSummary` display the IT Manager name and email address.
- **AC-6**: In `EscalateTicketModal.jsx`, Customer Service representatives can see and select the IT Department Manager (`Ejay Detera`), with support for selecting target department or viewing eligible managers across relevant departments.

## Options considered

### Option 1: Keep Status Unchanged and Only Reassign
Only execute employee reassignment without modifying the ticket status to Escalated (status ID 5).

**Pros**:
- Avoids modifying backend state machine rules.

**Cons**:
- Fails the core requirement where escalated tickets must show as Escalated in dashboards and reports.
- Breaks audit logging and SLA metrics expecting the formal Escalated status.

### Option 2: Full State Machine Integration and Department Selector
Add canonical `Escalated` state to the ticket state machine, fix the status ID collision, and enhance the frontend modal with department selection and complete employee property mapping.

**Pros**:
- Resolves the 422 transition error at its true architectural root cause.
- Allows seamless escalation to IT, Service, and Operations managers.
- Restores proper contact display (name, role, email) across all ticket modal views.

**Cons**:
- Requires coordinated edits across `ticket-service` and `frontend/web`.

## Decision

**Chosen option**: Option 2: Full State Machine Integration and Department Selector

**Implementation skills**: `laravel-microservice` (`services/ticket-service/`), `react-frontend` (`frontend/web/`)

## Rationale

Escalation is an essential lifecycle status in the ticketing platform. Aligning `TicketStateMachine`, `TicketConfigurationService`, and `TicketService` eliminates the 422 error, while updating the frontend models ensures Customer Service representatives can reliably view and select the IT Manager.

## Feature design

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/tickets/{id}` | PATCH | `ticket_status_ID: 5`, `assigned_by_email` | Updated ticket object with status Escalated | Bearer JWT | 401, 403, 404, 422 |
| `/api/employee-statuses` | GET | none | List of active employees including IT Manager with email and department | Bearer JWT | 401, 403 |

**Key invariants**:
- Status ID 5 always corresponds to `Escalated`.
- Terminal cancelled tickets use status ID 9 (`Discarded`). Status 5 is never treated as terminal cancelled.
- Transitioning from an active working state to status ID 5 is permitted for Customer Service and administrative staff.

## Build plan

1. In `services/ticket-service/app/Services/TicketStateMachine.php`:
   - Declare `public const STATE_ESCALATED = 'Escalated';`.
   - Remove `STATUS_ID_CANCELLED = 5;`. Keep `STATUS_ID_ESCALATED = 5;`.
   - In `resolveState()`: return `self::STATE_ESCALATED` when `statusId === self::STATUS_ID_ESCALATED` or when status name is `escalated`.
   - In `resolveTargetState()`: return `self::STATE_ESCALATED` when target ID is 5 or action string matches `escalate` / `escalated`.
   - In `canTransition()`: allow transition to `self::STATE_ESCALATED` from active states.

2. In `services/ticket-service/app/Services/TicketConfigurationService.php`:
   - Add `'Escalated'` entry to `DEFAULT_TRANSITIONS` with allowed next states (`['Assigned', 'In Progress (Employee-owned)', 'In Progress (CS-owned)', 'Resolved', 'Closed']`).
   - Add `'Escalated'` to allowed target arrays of active states.

3. In `services/ticket-service/app/Services/TicketService.php`:
   - Update line 1330: `$isClosedOrCancelled = in_array((int)$ticket->ticket_status_ID, [4, 9], true);`.

4. In `frontend/web/src/pages/CSAssigned.jsx`:
   - Preserve `email` on mapped employees: `email: row.email || ''`.

5. In `frontend/web/src/components/cs/EscalateTicketModal.jsx`:
   - Add department tabs or selector (e.g. IT, Service, Operations) defaulting to the ticket department or category, so the representative can view and select the IT Department Manager (`Ejay Detera`) or Service Department Manager as desired.

6. Verify and test the complete escalation flow.

