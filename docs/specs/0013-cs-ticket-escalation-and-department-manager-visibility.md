# 0013. Customer Service Ticket Escalation to Department Managers

**Date**: 2026-10-29
**Status**: Proposed

## Summary

This specification establishes that ticket escalation within the Customer Service interface strictly targets designated Department Managers. When escalating a ticket, the recipient candidate pool is filtered exclusively to active employees holding the Manager role within the ticket's department. It also binds department leadership contacts dynamically across all ticket modal surfaces and keeps the directory current via automatic synchronization with the central authentication module.

## Context

Customer Service representatives managing tickets at `/ticketing/cs/assigned` use the escalation workflow when a ticket requires administrative intervention, leadership oversight, or resource reassignment that operational staff cannot authorize on their own.

Previously, escalation filters permitted operational technicians, leads, and engineers to appear as escalation recipients alongside managers. However, operational handoffs to peers belong to standard reassignment, whereas formal escalation represents an elevation of responsibility directly to departmental leadership. Customer Service representatives need the escalation modal to present only those individuals who hold the Manager role within the specific department responsible for the ticket (such as the Service Manager for Service tickets, or the IT Manager for IT tickets).

## Requirements

**User stories**:
- As a Customer Service representative, I want to escalate an unresolved ticket strictly to the manager of that ticket's department so that departmental leadership assumes direct oversight.
- As a Department Manager, I want only formal managerial escalations routed to my queue rather than routine peer transfers so that leadership attention focuses on critical issues.
- As an administrator, I want newly registered manager accounts in the authentication module to sync automatically into ticketing services so that they become immediately eligible for managerial escalation.

**Acceptance criteria**:
- **AC-1**: When opening the ticket escalation modal, the system filters eligible escalation recipients strictly to active employees who hold the Manager role in the ticket's department.
- **AC-2**: Non manager employees (including engineers, technicians, and specialists) are strictly excluded from the escalation candidate list.
- **AC-3**: For a Service department ticket, eligible escalation recipients include only active Service Managers. For an IT department ticket, eligible escalation recipients include only active IT Managers.
- **AC-4**: If a department has multiple active managers, all managers for that department are listed for selection. If no manager is active in the department, the modal displays a clear notice informing the representative that no manager is configured for that department.
- **AC-5**: On the ticket summary and reassignment interface, the designated department managers card displays dynamic data for Service, IT, and Customer Service leadership without hardcoded names or email strings.
- **AC-6**: Automated test suites verify that escalation candidate lists contain only department managers and exclude non manager engineers and staff.

## Options considered

### Option 1: Multi Tier Escalation Including Senior Staff and Engineers

Allow both senior technical staff and department managers in the escalation candidate pool.

**Pros**:
- Provides a wider list of potential assignees.

**Cons**:
- Conflates regular work reassignment with formal management escalation.
- Leaves representatives uncertain whether an issue has been brought to leadership attention or merely transferred to another technician.

### Option 2: Strict Department Manager Escalation

Filter escalation recipients exclusively to employees with the Manager role within the ticket's department. Standard peer transfers remain in the separate Reassign workflow.

**Pros**:
- Clean separation of concerns: Reassign is for operational peer handoffs, while Escalate is strictly for leadership elevation.
- Guarantees accountability at the departmental management tier.
- Prevents accidental escalation to non management personnel.

**Cons**:
- Requires at least one active manager record per department in the directory.

## Decision

**Chosen option**: Option 2: Strict Department Manager Escalation

We adopt Option 2 to enforce clear escalation boundaries and ensure escalations route directly to departmental management.

**Implementation skills**: `react-frontend` (`frontend/web/`), `laravel-microservice` (`services/customer-service/`, `services/ticket-service/`)

## Rationale

Restricting escalation to department managers aligns with standard enterprise IT service desk practices. Operational delegation between engineers is handled by the Reassign modal, whereas Escalate explicitly elevates the incident to departmental leadership.

## Feature design

**Data model sketch**:
Managerial eligibility relies on existing organizational metadata:
- `department`: Normalized department name (e.g. 'Service', 'IT', 'Customer Service')
- `position_level`: Checked for 'Manager'
- `role`: Checked for 'manager' or 'head of cs'
- `technical_role`: Checked for 'Manager'
- `is_active`: Must be active (true or 1)

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/employee-statuses` | GET | department (optional query) | employees array with position level and availability | Bearer JWT | 401, 403 |
| `/api/tickets/{id}/eligible-employees` | GET | ticket id, track (optional query) | eligible employees, ineligible employees, department managers | Bearer JWT | 401, 404 |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Escalation recipient list | Array of eligible managers | Filtered from `employees` prop where `emp.department` matches ticket department and `emp.position_level` is Manager |
| Escalation banner | Department name and leadership rule | Computed from ticket department and category |

**Key invariants**:
- Only employees holding the Manager role in the ticket's department can be selected during escalation.
- No engineer, technician, or general staff member may appear in the escalation dropdown or recipient cards.

**Security model**:
- Only authenticated Customer Service staff or department managers can submit ticket escalations.

**Critical test scenarios**:
- Service ticket escalation: Displays only Service Manager(s), excludes Service Engineers, verifies **AC-1**, **AC-2**, **AC-3**.
- IT ticket escalation: Displays only IT Manager(s), excludes IT Specialists, verifies **AC-1**, **AC-2**, **AC-3**.
- Empty department managers: Shows clear notice when no manager is assigned to the department, verifies **AC-4**.

## Build plan

1. In `EscalateTicketModal.jsx`, update the candidate filter to match candidate department with ticket department and require the Manager role, satisfying **AC-1**, **AC-2**, **AC-3**, **AC-4**.
2. Update the modal header and information banner to clearly indicate that escalation is directed to the Department Manager, satisfying **AC-1**.
3. Update `EscalateTicketModal.test.jsx` to verify that only department managers qualify as escalation targets, satisfying **AC-6**.
4. Run the automated test suite and confirm clean frontend compilation.

## Consequences

**Positive**:
- Customer Service representatives have absolute clarity on who receives the escalation.
- Tickets are never misdirected to non managerial operational staff during escalation.

**Negative**:
- If a newly formed department has no manager assigned yet, escalation requires assigning a manager first in the directory.

**Neutral**:
- Peer technician reassignments remain available via the Reassign action.

## Follow up

Confirm in user acceptance testing that Customer Service representatives find the separation between Reassign and Escalate intuitive.
