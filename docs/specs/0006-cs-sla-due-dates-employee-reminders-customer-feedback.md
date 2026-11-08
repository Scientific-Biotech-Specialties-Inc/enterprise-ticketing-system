# 0006. Automated SLA Due Dates, CS Employee Reminders, and Customer Feedback Lifecycle

**Date**: 2026-10-23  
**Status**: Accepted  

## Summary

This decision defines three integrated operational capabilities for the enterprise service desk platform. First, it automates ticket Service Level Agreement due date calculation based on ticket category, priority, and branch policies from the configuration service, incorporating working calendar business hours (Monday to Friday, 8:00 AM to 5:00 PM) when enabled, with recalculation on creation, reclassification, and on hold transitions, and uniform status classification (On Track, At Risk, Breached, Paused, or No SLA Configured) cached for list, detail, and queue performance. Second, it delivers a Customer Service manual employee reminder mechanism for unresolved tickets with an assigned employee, enforcing role authorization, a one hour anti spam cooldown, ticket audit logging, and payload routing across in app and email channels. Third, it implements the complete customer feedback lifecycle on resolved or closed tickets, providing submission, retrieval, a 48 hour edit and deletion window, single submission enforcement per ticket, dismissible prompts, and administrative reporting access.

## Context

Customer Service representatives manage high volumes of active tickets and must maintain strict compliance with customer contracts. When SLA resolution due dates are missing, approximated, or calculated inconsistently across the system, representatives cannot determine how much time remains without manual calculation, risking service breaches. While `SLAService` contains foundational calculation methods, it lacks full business hours working calendar awareness, structured error fallback states, and persistent cached indicators for queue sorting and filtering.

Furthermore, when tickets approach critical resolution thresholds or stall with an assigned technician, Customer Service representatives lack a governed tool to prompt the technician directly from the ticket view. Representatives need an authorized reminder trigger that sends a contextual alert without spamming the technician, while permanently recording the reminder event in the ticket audit trail.

Finally, after a ticket is resolved or closed, customers need an intuitive, optional way to rate their service experience and submit feedback. Currently, feedback handling in `analytics-service` supports creation and retrieval but lacks customer ownership validation, server side status checks (resolved or closed only), pre filled editing, and deletion within a defined window. The frontend requires a unified, dismissible feedback experience on the ticket detail page that respects customer permissions and keeps feedback accurate.

## Requirements

**User stories**:
- As Customer Service, I want the system to automatically compute a ticket's SLA due date and compliance status using category, priority, and business hours, so that I know exactly how much time is left to resolve it without calculating manually.
- As Customer Service, I want to manually send a reminder for an unresolved ticket, so that I can prompt the assigned employee to act before it becomes overdue.
- As a customer, I want to submit, edit, or delete optional feedback and a rating after my ticket is resolved, so that I can share and manage my experience.

**Acceptance criteria**:
- **AC-1**: SLA due dates are automatically calculated at ticket creation and recalculation events using matching SLA rules or branch policies, with fallback flagging (`is_fallback = true`) when no specific rule matches.
- **AC-2**: When business hours are enabled in configuration, SLA due date calculations skip non working hours and weekends (Monday through Friday, 8:00 AM to 5:00 PM), and default to a continuous 24/7 calendar if business hours enforcement is disabled.
- **AC-3**: Recalculation triggers fire automatically on ticket category or priority updates and on hold pause or resume transitions, immediately updating resolution due dates.
- **AC-4**: SLA status is evaluated uniformly as `On Track`, `At Risk` (less than or equal to 4 hours or 25 percent remaining time), `Breached` (deadline surpassed), `Paused` (on hold status), or `No SLA Configured`, cached in the ticket record and Redis for high performance list queries, sorting, and filtering.
- **AC-5**: If SLA calculation encounters missing or corrupted configuration, calculation failure is logged with a clean `SLA Unavailable` state surfaced to the frontend rather than an incorrect date.
- **AC-6**: Customer Service and Admin users can trigger a manual reminder endpoint (`POST /api/tickets/{id}/reminders`) for unresolved tickets with an active assigned employee, subject to a one hour anti spam cooldown between reminders per ticket.
- **AC-7**: The reminder notification payload includes ticket ID, subject summary, customer name, current SLA due date, SLA status, and optional custom message, routed to the assigned employee via in app and email channels.
- **AC-8**: Every reminder event records an entry in `ticket_audit_logs` (`action_type = reminder_sent`) with sender identity, timestamp, and message preview, updating `last_reminder_sent_at` on the ticket.
- **AC-9**: Customer feedback can only be submitted for tickets in `Resolved` or `Closed` status, strictly scoped to the ticket owning customer, with a unique constraint preventing duplicate submissions.
- **AC-10**: Existing feedback is retrievable by the owning customer and privileged staff (CS, Admin, Super Admin), with pre filled values in the form.
- **AC-11**: Customers can update or delete their submitted feedback within a 48 hour edit window; attempts after window expiration return a clear error response.
- **AC-12**: The feedback prompt on the ticket detail view is dismissible, and all controls (SLA badges, reminder modals, feedback inputs) are responsive and accessible across desktop and mobile viewports.

## Options considered

### Option 1: Coordinated Service Enhancements with Business Calendar Engine (Recommended)

1. **SLA Calculation and Caching**:
   - Enhance `SLAService` in `ticket-service` with business calendar math. When computing minutes addition, iterate business time windows (08:00 to 17:00, Monday through Friday) if business hours are active in `configuration-service`.
   - Store `resolution_due_at` and `sla_status` directly on the `tickets` table and cache in Redis, invalidating on ticket lifecycle events so list and queue queries require zero runtime recalculations.
   - Provide sorting by `resolution_due_at` and filtering by `sla_status` (`on_track`, `at_risk`, `breached`, `paused`, `no_sla`) on CS queue and ticket list endpoints.

2. **CS Manual Employee Reminders**:
   - Implement `TicketReminderController::sendReminder` in `ticket-service` protected by role checks (CS, Admin, Super Admin).
   - Verify ticket is not resolved or closed and has an `assigned_to` technician.
   - Enforce a 60 minute cooldown using `last_reminder_sent_at` on the ticket.
   - Write an audit log entry in `ticket_audit_logs` and dispatch notifications through `notification-service` and `configuration-service`.

3. **Customer Feedback Lifecycle**:
   - In `analytics-service`, extend `FeedbackController` with `update` and `destroy` endpoints.
   - Validate customer ownership by comparing authenticated client ID against the ticket requester in `ticket-service`.
   - Verify ticket status is `Resolved` or `Closed`.
   - Enforce the 48 hour edit window by checking `created_at` against `now()->subHours(48)`.
   - In `frontend/web`, provide dismissible rating prompt, edit mode, delete confirmation modal, and immediate state updates.

**Pros**:
- Authoritative calculation ensures list, detail, and queue views present identical SLA states.
- Working calendar awareness prevents false breach flags over weekends or overnight periods.
- Controlled reminders avoid technician spam while establishing complete audit accountability.
- Full feedback lifecycle empowers customers while preserving review integrity via the 48 hour window.

**Cons**:
- Requires coordinated endpoints across `ticket-service`, `analytics-service`, and the React frontend.

### Option 2: Client Side SLA Math and Unrestricted Feedback Editing

Perform business hours arithmetic on the client and permit unconstrained feedback edits at any time without audit logging or reminder cooldowns.

**Pros**:
- Fewer backend service changes.

**Cons**:
- Client math produces discrepancies across browsers and timezones.
- Lack of reminder cooldown leads to notification spamming.
- Unrestricted feedback editing allows retroactive rating tampering months after service delivery.

## Decision

**Chosen option**: Option 1: Coordinated Service Enhancements with Business Calendar Engine.

### Data Model and Schema Adjustments

1. **`tickets` table (`ticket-service`)**:
   - `resolution_due_at`: datetime nullable (existing).
   - `sla_status`: varchar(32) default 'On Track' index.
   - `last_reminder_sent_at`: datetime nullable index.

2. **`ticket_audit_logs` table (`ticket-service`)**:
   - Existing table capturing `action_type = 'reminder_sent'`, `action_by_ID`, `actor_type = 'employee'`, and JSON details with custom message and recipient.

3. **`customer_feedback` table (`analytics-service`)**:
   - `ticket_id`: string index.
   - `customer_id`: string nullable index.
   - `overall_rating`: decimal(3,2).
   - `overall_comment`: text nullable.
   - `employee_ratings`: json nullable.
   - `question_answers`: json nullable.
   - `category_questions_snapshot`: json nullable.
   - `created_at`, `updated_at`: datetime timestamps.

## Build plan

1. **Backend (`ticket-service`)**:
   - Add business hours calculation helper in `SLAService.php` to calculate deadlines considering working calendar.
   - Ensure `recalculateForReclassification`, `assignSlaToTicket`, and `pauseClock` / `resumeClock` keep `sla_status` updated.
   - Add `last_reminder_sent_at` column migration to `tickets` if not present.
   - Build `POST /api/tickets/{id}/reminders` in `TicketReminderController.php` with 1 hour cooldown, audit logging, and notification dispatch.
   - Expose SLA filtering and sorting in `TicketDashboardService.php` and ticket list endpoints.

2. **Backend (`analytics-service`)**:
   - Add `PUT /api/feedback/ticket/{ticketId}` and `DELETE /api/feedback/ticket/{ticketId}` in `FeedbackController.php`.
   - Enforce ticket resolved or closed status check and 48 hour window validation.
   - Enforce customer ownership authorization.

3. **Frontend (`frontend/web`)**:
   - In `ticketService.js`, add `sendTicketReminder`, `updateTicketFeedback`, and `deleteTicketFeedback`.
   - Update `CSAssigned.jsx` and `EmployeeTicketDetailModal.jsx` / `TicketDetail.jsx` with SLA badges, due dates, and "Send Reminder" button with confirmation modal and cooldown display.
   - Update `CustomerTicketDetailModal.jsx` with dismissible "Rate Your Experience" prompt, 5 star rating, comment, edit mode, and delete confirmation modal.

## Consequences

- Consistent SLA visibility across all employee and CS screens.
- Controlled reminder mechanism keeps technicians responsive without overwhelming notification volume.
- Customers have complete autonomy over feedback within the governed 48 hour window.
