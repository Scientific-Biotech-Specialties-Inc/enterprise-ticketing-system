# 0010. Ticket Reassignment Escalation and Category Based Employee Eligibility

**Date**: 2026-10-25
**Status**: Accepted

## Summary

This specification establishes an escalation and reassignment architecture for tickets that operational employees cannot complete. It introduces category based employee eligibility filtering governed dynamically by the Configuration Service, displays designated department managers for Service, IT, and Customer Service on escalation requests, and broadcasts real time notifications to department managers whenever an SLA deadline is breached. The design ensures strict server side validation during employee assignment while providing clear guidance and empty state handling on the Customer Service interface.

## Context

Operational staff members (service engineers, technicians, and IT specialists) occasionally receive tickets that exceed their technical scope, require specialized diagnostic equipment, or demand cross department intervention. Previously, technicians had no formal in system mechanism to surrender or escalate a ticket, leading to stalled work orders or informal side channel handoffs.

When a technician requests reassignment or escalation, Customer Service (CS) representatives need immediate visibility into who manages each relevant department (Service, IT, and Customer Service) so they can consult leadership or escalate appropriately. Furthermore, when assigning an employee to a ticket, CS representatives need the system to filter candidates automatically according to the ticket category, physical branch assignment, position level, and technical role, preventing accidental misassignments.

To prevent service quality degradation, department managers must also receive immediate alerts whenever a ticket in their department breaches response or resolution SLA limits, allowing leadership to step in before customer relationships suffer.

## Requirements

**User stories**:
- As an assigned technician or engineer, I want to submit a ticket reassignment request with an explanatory reason so that my department or Customer Service can reassign or escalate the ticket without manual delays.
- As a Customer Service representative reviewing an escalation request, I want to see the designated manager for Service, IT, and Customer Service so that I can direct escalations to the proper departmental leader.
- As a Customer Service representative assigning a ticket, I want the system to filter candidate employees by department, branch, position level, and technical role based on the ticket category so that I only assign qualified personnel.
- As a department manager, I want to receive real time notifications whenever an active ticket belonging to my department breaches an SLA deadline so that I can intervene immediately.
- As the system, I want to enforce server side validation during employee assignment so that outdated or disqualified candidate selections are rejected with clear error feedback.

**Acceptance criteria**:
- **AC-1**: When an assigned technician cannot complete a ticket, they can submit a reassignment request with a mandatory reason, transitioning the reassignment state to pending and logging the request in the ticket timeline.
- **AC-2**: On the Customer Service ticket detail and reassignment views, the system displays the identified department managers for Service, IT, and Customer Service, drawing manager records from position levels or configuration defaults.
- **AC-3**: When querying eligible employees for a ticket (GET /api/tickets/{ticketId}/eligible-employees), the system queries category escalation rules from Configuration Service, filtering candidates by department, branch, minimum position level, and allowed technical roles.
- **AC-4**: Branch scoping is strictly enforced during eligibility filtering, matching the ticket branch unless the category escalation rule explicitly enables cross branch fallback.
- **AC-5**: The eligible employee query returns structured employee objects (id, name, email, department, branch, position level, technical role, availability status) and explicitly separates eligible candidates from ineligible employees with clear explanatory reasons.
- **AC-6**: When no eligible employees match the criteria, the response returns an empty eligible list with structured empty state guidance rather than an HTTP 500 error or unhandled exception.
- **AC-7**: Server side validation on the assignment endpoint (POST /api/tickets/{ticketId}/employee-update) verifies that the assigned employee exists within the valid eligible list for the ticket category, rejecting invalid assignments with HTTP 422 Unprocessable Entity.
- **AC-8**: Changing a ticket category dynamically triggers recalculation of employee eligibility on both the backend and the frontend user interface.
- **AC-9**: When an active ticket reaches an SLA breach state (response or resolution deadline exceeded), the system broadcasts a real time Reverb notification to the manager of the ticket department.
- **AC-10**: The frontend Customer Service assignment interface displays candidate position levels, technical roles, branch locations, and availability chips, rendering accessible empty state messaging and retry controls when network failures occur.

## Options considered

### Option 1: Hardcoded Category Rules and Static Manager Roles

Hardcode category to department and role mappings in local controller methods, and treat any user with role Manager as a department head.

**Pros**:
- Quick to write for an initial demo without external configuration calls.

**Cons**:
- Inflexible when organization titles or department hierarchies evolve.
- Fails to support branch based cross facility rules or dynamic escalation tiers.
- Violates microservice separation by duplicating rules across services.

### Option 2: Dynamic Configuration Service Rules with Database Position Levels and Reverb Alerts (Chosen)

Store category escalation rules and fallback manager identities centrally in Configuration Service. Extend the employees schema with position level and technical role columns, and dispatch real time breach notifications to managers via Reverb.

**Pros**:
- Centralizes business policies in Configuration Service where administrators can adjust minimum position levels, roles, and branch fallback flags without code deploys.
- Provides granular eligibility checks combining physical branch, position seniority (Junior, Mid, Senior, Lead, Manager), and technical specialty.
- Proactively notifies department managers through real time channels on SLA breaches.

**Cons**:
- Requires inter service HTTP lookups between Employee Service, Ticket Service, and Configuration Service, mitigated by Redis caching.

## Decision

**Chosen option**: Option 2: Dynamic Configuration Service Rules with Database Position Levels and Reverb Alerts.

The system will store dynamic category escalation rules in Configuration Service, enrich employee profiles with position levels and technical roles, enforce strict server side assignment validation, and notify department heads upon SLA breaches.

**Implementation skills**: `laravel-microservice` (`services/ticket-service/`, `services/employee-service/`), `react-frontend` (`frontend/web/`)

## Rationale

Decoupling escalation and eligibility rules into Configuration Service allows administrators to modify technical requirements per ticket category as equipment and hospital workflows change. Extending employee records with explicit position levels and technical roles avoids brittle string matching against free text role fields. Leveraging Laravel Reverb ensures department leaders are alerted to SLA breaches in real time without refreshing their browser.

## Feature design

**Data model sketch**:

`employees` table (in `employee-service` and mirrored in `ticket-service`):
- `emp_id`: bigint unsigned primary key
- `email`: varchar(255) unique
- `first_name`: varchar(100)
- `last_name`: varchar(100)
- `role`: varchar(50) (e.g. Engineer, Technician, Specialist, Staff)
- `department`: varchar(100) (e.g. Service, IT, Customer Service)
- `branch`: varchar(100) nullable
- `branch_id`: bigint unsigned nullable
- `position_level`: varchar(50) nullable (e.g. Junior, Mid, Senior, Lead, Manager)
- `technical_role`: varchar(100) nullable (e.g. Biomedical Engineer, Systems Specialist, Network Admin)
- `is_active`: boolean default true

`reassignment_requests` table (in `ticket-service`):
- `request_id`: bigint unsigned primary key auto increment
- `ticket_id`: bigint unsigned foreign key referencing tickets
- `employee_id`: bigint unsigned foreign key referencing employees
- `reason`: text
- `deny_reason`: text nullable
- `status`: enum('pending', 'approved', 'rejected') default 'pending'
- `requested_at`: timestamp
- `reviewed_at`: timestamp nullable

`configuration-service` JSON configurations:
- `category_escalation_rules`: JSON map of category names to rule definitions:
  - `department`: array of allowed departments (e.g. `["Service"]`)
  - `min_position_level`: minimum allowed level (`"Junior"`, `"Mid"`, `"Senior"`, `"Lead"`, `"Manager"`)
  - `allowed_roles`: array of allowed technical role strings
  - `allow_cross_branch`: boolean flag (default false)
- `department_managers`: JSON map of departments to manager identities (email, employee id, display name)

**State transitions**:
- Reassignment Lifecycle: `None` -> `Pending Review` (requested by employee) -> `Approved / Reassigned` (CS assigns new employee) OR `Rejected / Denied` (CS declines reassignment request).
- Ticket Assignment Lifecycle: `New / Unassigned` -> `Assigned` (verified against eligible employees) -> `In Progress` -> `Escalation Requested` -> `Reassigned`.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/tickets/{ticketId}/reassign-request | POST | reason: string | success: bool, message: string | Bearer token (assigned employee) | 400 not assigned, 409 already pending, 422 empty reason |
| /api/tickets/{ticketId}/eligible-employees | GET | ticketId: int, track: string (opt) | ticket_id, category, branch, department_managers, eligible_employees, ineligible_employees | Bearer token (CS or Admin) | 401 unauthenticated, 404 ticket missing |
| /api/tickets/{ticketId}/employee-update | POST | employee_id: int, note: string (opt) | success: bool, ticket: object | Bearer token (CS or Admin) | 403 unauthorized, 422 employee not eligible |
| /api/ticket-configurations/category_escalation_rules | GET | none | rules: object | Bearer or internal secret | 503 service unavailable |
| /api/ticket-configurations/department_managers | GET | none | managers: object | Bearer or internal secret | 503 service unavailable |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Request reassignment | reason and requesting employee | Request payload and authenticated employee JWT |
| View department managers | manager names, roles, and contacts | position_level = 'Manager' query with configuration-service fallback |
| List eligible employees | eligible candidates with display attributes | Employee directory filtered by Configuration Service category rules |
| Validate assignment | acceptance or rejection error | Verification against current eligible employee ids for ticket category |
| Notify SLA breach | in app alert delivered to department head | Reverb broadcast to channel `private-user.{managerId}` on SLA breach |

**Key invariants**:
- Only the currently assigned employee can request ticket reassignment.
- An employee cannot be assigned to a ticket unless they meet the category track, branch scope, minimum position level, and technical role rules.
- Operational staff members cannot be assigned tickets belonging to another branch unless cross branch fallback is enabled for that category.
- When an SLA breaches, the alert must route to the manager of the ticket department (Service Manager for Service tickets, IT Manager for IT tickets).
- Ticket category modifications immediately invalidate prior eligibility caches.

**Security model**:
- CS agents and Super Admins hold authorization to reassign tickets and override assignments.
- Operational employees may only request reassignment for tickets assigned to their own employee ID.
- Inter service communication between Ticket Service, Employee Service, and Configuration Service uses internal bearer tokens and secret headers.

**Critical test scenarios**:
- Happy path reassignment request: Assigned technician submits reassignment request with valid reason; ticket reflects pending escalation state, verifying **AC-1**.
- Department manager resolution: CS view displays designated managers for Service, IT, and CS with current contact details, verifying **AC-2**.
- Category eligibility filtering: Ticket with Biomedical Imaging category filters candidates to Service department engineers with Senior level or above, verifying **AC-3**.
- Branch isolation check: Technicians stationed at Cebu City Office cannot be assigned to Main Office tickets when cross branch fallback is disabled, verifying **AC-4**.
- Structured eligibility separation: Endpoint cleanly separates eligible candidates from ineligible candidates with distinct failure reasons, verifying **AC-5**.
- Safe empty state: When no candidate satisfies requirements, system returns an empty array with escalation guidance without throwing errors, verifying **AC-6**.
- Server side validation enforcement: Direct API call attempting to assign an ineligible technician is rejected with HTTP 422, verifying **AC-7**.
- Dynamic category recalculation: Changing category from IT Network to Medical Device refreshes eligible candidates to biomedical specialists, verifying **AC-8**.
- SLA breach manager alert: Triggering an SLA breach event dispatches a Reverb notification to the corresponding department manager, verifying **AC-9**.
- Frontend error resilience: Network interruption during employee fetching displays a clear retry alert without crashing the ticket detail modal, verifying **AC-10**.

## Build plan

1. Add database migration in `services/employee-service` adding `position_level` and `technical_role` columns to `employees`, seeding baseline managers and senior engineers, satisfying **AC-2**, **AC-3**.
2. Seed category escalation rules and department manager definitions in `services/configuration-service`, exposing them via API endpoints, satisfying **AC-2**, **AC-3**.
3. Extend `EmployeeDirectoryController` in `services/employee-service` to evaluate position level, technical role, branch scoping, and Configuration Service rules, satisfying **AC-3**, **AC-4**, **AC-5**, **AC-6**.
4. Update `TicketService` and `VerifyEmployeeJwt` in `services/ticket-service` to enforce server side validation against eligible employees during assignment, satisfying **AC-7**, **AC-8**.
5. Update `SLAService` and `TicketNotificationService` in `services/ticket-service` to broadcast SLA breach events to department managers via Reverb, satisfying **AC-9**.
6. Build and extend the CS ticket detail assignment component in `frontend/web/` to display eligible employees with position badges, manager escalation contacts, category refresh hooks, and accessible empty states, satisfying **AC-1**, **AC-2**, **AC-10**.
7. Write unit and feature tests in `services/ticket-service` and `frontend/web/` verifying reassignment workflows, eligibility validation, and manager breach alerts, satisfying **AC-1** through **AC-10**.

## Consequences

**Positive**:
- Eliminates manual guesswork and informal side channels when technicians encounter tickets they cannot complete.
- Guarantees that only qualified technicians with suitable position seniority and branch proximity receive complex tickets.
- Keeps department leaders informed of SLA breaches in real time so critical patient care or hospital hardware issues receive leadership attention.

**Negative**:
- Introduces additional inter service requests between Ticket Service, Employee Service, and Configuration Service, requiring Redis caching for performance.
