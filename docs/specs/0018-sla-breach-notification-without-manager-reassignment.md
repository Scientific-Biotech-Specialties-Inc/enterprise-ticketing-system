# 0018. SLA Breach Notification Without Manager Reassignment

Date: 2026-10-30
Status: Accepted

## Summary

This specification establishes that when a support ticket breaches its Service Level Agreement deadline, the ticket must not move or be reassigned to the department manager. The ticket remains assigned to the employee who is working on it. The department manager receives an immediate alert notification, keeping leadership informed without displacing the technician or transferring ticket ownership.

## Context

In ticket desk workflows, an SLA breach represents a deadline violation.
Previously, the system added all departmental SLA breached tickets into the personal assigned tickets feed of the department manager in EmployeeAssignmentService. Because of that inclusion, breached tickets appeared in the manager personal incoming acceptance queue and active assigned ticket lists. This created the false impression that the ticket had moved away from the technician to the manager.
The desired behavior is straightforward. Ticket ownership and assignment must remain with the assigned technician. When an SLA breach occurs, the system dispatches an alert notification to the department leadership so they can monitor and supervise, but the ticket itself remains assigned to the employee.

## Requirements

User stories:
- As a service technician, I want tickets that breach SLA to remain assigned to me so that I can finish the repair or service without having my assignment stripped or transferred.
- As a department manager, I want to receive an alert notification when a ticket in my department breaches SLA so that I can provide oversight without having the ticket dumped into my personal work queue.
- As a customer service specialist, I want ticket assignees to remain unchanged upon SLA breach so that accountability stays with the working technician.

Acceptance criteria:
- AC 1: In EmployeeAssignmentService getEmployeeTickets query, departmental tickets that are SLA breached are not included in the personal assigned ticket feed of the manager. Only tickets directly assigned to the manager or escalated tickets with status Escalated (ticket status ID 5) appear in the manager personal ticket feed.
- AC 2: When an SLA deadline is breached, the ticket assigned to field and ticket assignments table remain intact with the designated technician.
- AC 3: In SLAService dispatchSlaBreachAlert, the department manager receives an in app notification and an alert email for the breached ticket. If multiple managers exist for that department, notifications are dispatched to department leadership.
- AC 4: In the manager employee portal, the manager views the breach alert under notifications with ticket reference and overdue duration. Opening the ticket from the notification displays the ticket details with the original employee still assigned.
- AC 5: In EmployeeDashboard and EmployeeAssigned, the personal assigned ticket lists accurately reflect only tickets assigned to the active user.

## Options considered

### Option 1: Reassign Ticket to Department Manager on SLA Breach
Automatically change assigned to and ticket assignments to point to the department manager whenever a resolution deadline passes.

Pros:
- Forces direct manager handling.

Cons:
- Disrupts technician workflow.
- Destroys assignment history and accountability.
- Directly violates the user requirement.

### Option 2: Notify Manager While Preserving Technician Assignment
Keep the ticket assigned to the technician. Remove the automatic query injection of departmental breached tickets into the manager personal ticket queue. Dispatch real time and in app notifications to the department manager when a breach occurs.

Pros:
- Technicians maintain ownership and continue working on their assigned tickets.
- Managers receive timely supervisory alerts via the notification center and email.
- Fully aligns with standard IT service desk best practices and user requirements.

## Decision

We adopt Option 2.
1. In EmployeeAssignmentService.php, restrict getEmployeeTickets for department managers to directly assigned tickets and status 5 Escalated tickets only. Remove the departmental SLA breached ticket subclause.
2. In SLAService.php, ensure dispatchSlaBreachAlert resolves all department managers for the ticket department and notifies them with the Department SLA Breach Alert.
3. Keep the frontend filter and badge displays clean and consistent with ONE UI design standards.

## Build plan

1. Update services/employee-service/app/Services/EmployeeAssignmentService.php to remove the SLA breach inclusion from getEmployeeTickets for managers, leaving only direct assignments and status 5 Escalated tickets.
2. Update services/ticket-service/app/Services/SLAService.php so resolveDepartmentManagerForTicket and dispatchSlaBreachAlert notify all managers in the target department (including Reymie Gonzaga, employee ID 1097, and Carlos Mendoza, employee ID 1028).
3. Clear caches across microservices and Redis.
4. Run automated tests to verify zero regressions.

