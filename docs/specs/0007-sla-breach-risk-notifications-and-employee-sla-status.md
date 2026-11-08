# 0007. Automated SLA Breach and At Risk Notifications to Customer Service and Employees with Machine Workbench SLA Status Display

**Date**: 2026-10-23  
**Status**: Accepted  

## Summary

This specification delivers automated Service Level Agreement breach and at risk notifications alongside comprehensive breach indicators across queues and ticket detail views. When an unresolved ticket passes its deadline or reaches an at risk threshold, the platform detects the transition and dispatches structured alert payloads across configured channels to Customer Service and assigned employees with deduplication. The system supports re alerts on configurable cadences, re triggers alerts upon reassignment of an already breached ticket, writes immutable audit history records, and displays prominent urgent visual styling across notification feeds, queue views, detail modals, and reporting dashboards.

## Context

Customer Service representatives and assigned technical employees collaborate to resolve customer incidents before contractual deadlines expire. When tickets near expiration or breach their resolution time limits without automatic alerts, both representatives and engineers remain unaware of impending violations unless they proactively inspect individual ticket details or filter queue tables.

Furthermore, when an incident breaches its SLA and is subsequently reassigned to another engineer, the incoming engineer needs immediate clarity on the existing breach state and an alert respecting their personal notification preferences. The background monitoring job must operate reliably with retry mechanisms, error logging, and alerts to Super Administrators if the monitoring cycle encounters critical failures.

Finally, across the user interface, representatives and technicians require unified visibility into breached incidents. Notification lists must distinguish urgent SLA alerts from routine messages using recognizable styling, provide one click navigation into the ticket detail modal, and show consistent breached counts and status flags across Customer Service queues, employee work logs, detail modals, and overview dashboards.

## Requirements

**User stories**:
- As Customer Service or an assigned employee, I want to be alerted immediately when a ticket breaches its SLA, so that I can prioritize it or intervene accordingly.
- As an assigned employee, I want automatic notifications when my assigned ticket is at risk or breached, so that I can expedite resolution or coordinate help.
- As Customer Service or an assigned employee, I want to receive alerts through my configured notification channels respecting my preferences.
- As an engineer receiving a reassigned ticket that is already breached, I want to receive an immediate breach alert and see the breached status surfaced in my work log.
- As a user reviewing notifications, I want breach alerts to display urgent styling with direct click through to the ticket detail view.
- As an administrator or team lead, I want queue views and dashboards to reflect consistent breached counts and statuses.

**Acceptance criteria**:
- AC 1: The SLA monitoring job runs regularly and evaluates active unresolved tickets (status not in Closed, Resolved, Cancelled, or Discarded) against their resolution SLA deadline.
- AC 2: When an active ticket reaches at risk status (four hours or twenty five percent remaining time), in app notifications and web socket events are dispatched to the Customer Service team and all assigned employees.
- AC 3: When an active ticket breaches its resolution deadline (remaining time less than zero), its SLA status transitions to Breached, and breach alerts are generated and dispatched immediately to Customer Service and assigned employees.
- AC 4: The breach alert payload contains Ticket ID, summary title, customer name, category, priority, overdue duration text, and deep link URL.
- AC 5: Alert delivery integrates with per recipient notification preferences (in app and email channels), skipping disabled channels accordingly.
- AC 6: Delivery logic implements per channel retry mechanisms and logs detection and delivery outcomes for monitoring.
- AC 7: Every breach event is written to `ticket_audit_logs` independently of notification delivery outcomes.
- AC 8: Reassignment of an already breached ticket resolves the new assigned employee, surfaces the current breach status, and dispatches a breach alert directly to them respecting their preferences.
- AC 9: The background monitoring command includes automated retry on transient failures and issues a Super Admin critical alert if execution fails.
- AC 10: In app notifications render breach alerts with distinguishable urgent styling (red accents, warning icon, and clear tag) in both the header notification menu and the main notification feed.
- AC 11: Clicking a breach notification navigates directly to or opens the ticket detail modal for the breached ticket.
- AC 12: Visual Breached status badges display on CS queues, Employee machine workbench and work logs, and ticket detail views across desktop and mobile screens.
- AC 13: Dashboards (CS dashboard, Employee dashboard) compute and display breached ticket counts consistent with queue and list views.

## Options considered

### Option 1: Centralized Server Evaluation with Preference Routing and UI Integration (Recommended)

1. **Automated Notification Engine**:
   - In `ticket-service`, extend `SLAService::checkAndNotifySlaAlerts()`:
     - Detects tickets where `resolution_due_at` has passed and marks `sla_status = 'Breached'`.
     - Builds rich alert payload with Ticket ID, title summary, customer name, category, priority, overdue duration string, and deep link.
     - Checks recipient notification preferences (cached in Redis / Cache for client and employee).
     - Dispatches in app notification, email with retry logic, and Reverb web socket broadcasts.
     - Inserts audit log entry in `ticket_audit_logs` with action type `sla_breached`.
     - Supports re alert cadence using `last_sla_breach_alert_at` and configurable interval.
   - On ticket assignment and reassignment in `EmployeeAssignmentService` and `EmployeeReassignmentService`:
     - If the ticket has already breached (`sla_status === 'Breached'` or overdue), trigger a breach notification to the newly assigned employee.
   - Background command `tickets:check-sla-alerts`:
     - Retries execution up to three times on failure.
     - Dispatches a system alert to Super Admin if fatal errors occur.
     - Logs all detection and dispatch metrics.

2. **Frontend Styling and Deep Linking**:
   - Update `NotificationItem.jsx` and `Notifications.jsx` to render distinctive urgent styling (red border, red background tint, warning icon, Breached SLA badge).
   - In `Notifications.jsx`, enhance click handling to open the ticket detail modal or navigate to ticket views.
   - Update `CustomerTicketDetailModal.jsx`, `TicketInfoModal.jsx`, and `CSModals.jsx` to prominently display the Breached SLA indicator badge when a ticket is breached.
   - Update dashboard calculations in `CSDashboard.jsx` and `EmployeeDashboard.jsx` to filter by genuine `sla_status === 'Breached'` rather than workflow status.

**Pros**:
- Comprehensive end to end reliability and single source of truth.
- Respects individual channel preferences while ensuring delivery retries.
- Consistent visual presentation across desktop and mobile.

**Cons**:
- Touches multiple notification and display components.

## Decision

Adopt Option 1. Centralize alert dispatching, recipient preference evaluation, and audit logging in `ticket-service`, propagate breach awareness on reassignment in `employee-service`, and provide unified urgent indicators in the React frontend.

## Implementation details

### 1. Database Schema
In `services/ticket-service/database/migrations/`:
- Add nullable datetime columns `sla_risk_notified_at`, `sla_breach_notified_at`, and `last_sla_breach_alert_at` to `tickets` table.

### 2. Backend Ticket Service (`services/ticket-service`)
- In `SLAService.php`:
  - Enhance `checkAndNotifySlaAlerts()` with complete payload (Ticket ID, summary, customer, category, priority, overdue duration, link).
  - Implement re alert interval check from configuration service.
  - Record audit log entry in `ticket_audit_logs`.
- In `TicketNotificationService.php`:
  - Check employee notification preferences in `notifyRecipient()` and `sendTicketEmail()`.
  - Add retry mechanism (`Http::retry()`) for external email dispatch.
- In `CheckSlaAlertsCommand.php`:
  - Add try catch with retry loops.
  - Alert Super Admin via `notifySuperAdmin()` or `system_alert` on catastrophic failure.
  - Log outcomes with `Log::info()` and `Log::error()`.

### 3. Backend Employee Service (`services/employee-service`)
- In `EmployeeAssignmentService.php` and `EmployeeReassignmentService.php`:
  - When assigning or reassigning an existing breached ticket, dispatch a breach alert to the new employee.

### 4. Frontend Web Interface (`frontend/web/src`)
- `components/notifications/NotificationItem.jsx`:
  - Urgent red styling and AlertTriangle icon for breach alerts.
- `pages/Notifications.jsx`:
  - Urgent styling for breach cards and smooth click through to ticket detail view.
- `components/CustomerTicketDetailModal.jsx`, `components/employee/TicketInfoModal.jsx`, and `components/CSModals.jsx`:
  - Prominent Breached badge and deadline text.
- `pages/CSDashboard.jsx` and `pages/EmployeeDashboard.jsx`:
  - Fix breached count calculation to use `sla_status === 'Breached'`.

## Build plan

1. Run database migration for SLA notification timestamps in `ticket-service`.
2. Enhance `SLAService.php` alert payload, re alert cadence, and audit logging.
3. Enhance `TicketNotificationService.php` with employee preference checks and retry logic.
4. Enhance `CheckSlaAlertsCommand.php` with reliability retries and failure alerting.
5. Update `EmployeeAssignmentService.php` and `EmployeeReassignmentService.php` for breach notification on reassignment.
6. Update frontend `NotificationItem.jsx` and `Notifications.jsx` with urgent red styling and click through.
7. Update ticket detail modals (`CustomerTicketDetailModal.jsx`, `TicketInfoModal.jsx`, `CSModals.jsx`) with Breached visual badges.
8. Update dashboard count logic in `CSDashboard.jsx` and `EmployeeDashboard.jsx`.
9. Verify with automated tests across frontend and backend.
