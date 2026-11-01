# 0020. Manager Dashboard Department SLA Metrics

Date: 2026-10-30
Status: Accepted

## Summary

This specification defines how department managers monitor Service Level Agreement breach metrics on their employee dashboard. Department managers must see their department SLA breach count and breach alert card accurately populated on the dashboard, while ticket assignments remain strictly with the working technicians rather than transferring to the manager. In addition, real time events trigger dynamic dashboard updates for department managers so that metric cards refresh automatically when ticket statuses change.

## Context

In an IT service desk, department managers supervise department performance, monitor escalations, and oversee Service Level Agreement targets.
Previously, when tickets breached their resolution targets, technicians kept ticket ownership, but the manager dashboard calculated SLA breach counts solely from the manager personal assigned ticket queue. Because breached tickets remained assigned to the technicians, the manager personal queue held zero breached tickets. As a result, the manager dashboard displayed zero SLA breached tickets and showed an inactive compliance banner.
Managers require department wide operational awareness. The manager dashboard needs to present the departmental SLA breached ticket volume and provide a quick view of breached items, without cluttering the manager personal workbench or reassigning tickets away from technicians.

## Requirements

User stories:
- As a department manager, I want my employee dashboard to display the total number of breached tickets across my department so that I have immediate visibility into overdue work.
- As a department manager, I want to see an urgent alert banner highlighting breached department tickets so that I can inspect the situation quickly.
- As a technician, I want tickets that breach deadline targets to remain assigned to me so that I retain ownership of my ongoing tasks.
- As a department manager, I want the dashboard metrics to update in real time when tickets breach or change status without requiring a manual browser refresh.

Acceptance criteria:
- AC 1: In EmployeeAssignmentService and EmployeeAssignmentController, the employee tickets API returns a department summary payload for department managers. This payload includes the department SLA breached count and the latest department breached ticket summary.
- AC 2: In frontend ticketService, getEmployeeAssignedTickets preserves the department summary metadata on the returned ticket collection.
- AC 3: In EmployeeDashboard, when a department manager views the dashboard, the SLA Breached metric card displays the department SLA breach count instead of zero.
- AC 4: In EmployeeDashboard, the SLA Breached alert banner displays the active department breached ticket details and allows the manager to open the detailed ticket view directly.
- AC 5: In EmployeeDashboard, the real time refresh listener triggers automatic dashboard metric updates for managers when ticket update events arrive.
- AC 6: Technicians retain their assigned tickets in their personal workbenches. The manager personal assigned ticket feed contains only tickets directly assigned to the manager or tickets in status Escalated.

## Options considered

### Option 1: Reassign Breached Tickets to the Department Manager
Automatically assign all breached tickets to the department manager so they show up in visible tickets.

Pros:
- Uses existing visible ticket filters without modifying backend responses.

Cons:
- Violates explicit user requirements.
- Technicians lose assignment ownership of their in flight work.
- Creates confusion in assignment history and accountability.

### Option 2: Provide Department Summary in Employee Tickets Endpoint
Keep personal tickets strictly scoped to direct assignments and escalated tickets. Provide a department summary section with department breach count and a representative breached ticket when the requesting user is a department manager.

Pros:
- Clean separation between personal assigned tasks and departmental supervisory metrics.
- Technicians retain complete ticket ownership.
- Gives managers real time supervisory figures directly on their dashboard metric cards and alert containers.
- Backward compatible with all existing frontend components consuming employee tickets.

## Decision

We adopt Option 2.
1. In EmployeeAssignmentService, create a helper method to compute department statistics for managers. When the authenticated employee is a department manager, count active non closed tickets in their department that are SLA breached, and identify a representative breached ticket.
2. In EmployeeAssignmentController, attach department_summary to the JSON response of /api/employee-tickets.
3. In frontend ticketService getEmployeeAssignedTickets, preserve department_summary on the ticket array object.
4. In EmployeeDashboard, detect when the user is a manager and use the department SLA breached count for the SLA Breached metric card and the alert banner.
5. In EmployeeDashboard useRealtimeRefresh, enable real time refreshes for department managers upon ticket change events.

## Build plan

1. In services/employee-service/app/Services/EmployeeAssignmentService.php, add getDepartmentSummaryForEmployee to compute department SLA breach counts and sample breached ticket details.
2. In services/employee-service/app/Http/Controllers/EmployeeAssignmentController.php, include department_summary in the /api/employee-tickets response.
3. In frontend/web/src/services/ticketService.js, retain department_summary in fetchEmployeeAssignedTickets and getEmployeeAssignedTickets.
4. In frontend/web/src/pages/EmployeeDashboard.jsx, consume department_summary for manager SLA breached metric cards, update banner clicks to open ticket detail modal, and broaden useRealtimeRefresh for managers.
5. Clear caches and verify behavior across microservices and tests.

