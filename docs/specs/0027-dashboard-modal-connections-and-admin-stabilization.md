# 0027. Dashboard Modal Connections and Admin Stabilization

**Date**: 2026-11-03  
**Status**: In Progress  

## Summary

This specification establishes in place interactive modals across both the Customer Service traffic dashboard and the Employee dashboard, while resolving the admin login role display flicker and eliminating filter preset delay. It enables Customer Service agents and employees to triage, view, accept, and update tickets directly from dashboard summaries without losing their page context. It also isolates session state handling to prevent stale role hydration and repairs backend preset cache detection so date filter clicks respond immediately.

## Context

The enterprise ticketing system serves multiple operational roles across unified customer, employee, customer service, and administrative workflows. During active operations, three distinct friction points emerged across the primary interfaces:

First, on the Customer Service Traffic Dashboard at `/ticketing/cs/dashboard` and the Employee Dashboard at `/ticketing/employee/dashboard`, tickets listed under attention and queued summaries either navigated away to full queue tables or operated in strict read only viewports. When customer service agents triage incoming breached or reassigned tickets, navigating away destroys their high level traffic monitoring context. Similarly, employees viewing assigned tickets could not trigger the contextual acceptance or update modal directly from their dashboard cards.

Second, when an administrator logs in, the user interface momentarily flashes the employee navigation layout before transitioning to the administrator dashboard. This occurs because previous user session data in browser local storage is not cleared across role switches to protect the central single sign on token. During application bootstrap, the client synchronously hydratates the user from stale local storage records while the asynchronous session verification request to the backend is in flight.

Third, clicking date preset filters such as Last 7 Days on the Administrator Dashboard incurs noticeable latency, whereas the neighboring Predictive Analytics view reacts smoothly. Investigation showed that predictive insights compute once in memory on the client side, while the operational dashboard issues fresh backend calls. In the ticket service backend, the preset parser evaluated manual date parameters before the Last 7 Days preset check, misclassifying the preset as a custom range, causing cache key misses, and triggering expensive synchronous loops and inter service analytics requests.

## Requirements

**User stories**:
- As a Customer Service agent on the traffic dashboard, I want to open ticket inspection and assignment modals directly from attention and queued cards so that I can dispatch and triage urgent tickets without navigating away.
- As an employee on the technician dashboard, I want to click any assigned or requested ticket to open its contextual detail modal so that I can accept, update, or request reassignment immediately.
- As a system administrator logging into the ticketing platform, I want the interface to maintain a neutral loading state until my verified role is hydrated so that I never see an incorrect employee layout flash.
- As a branch or system administrator filtering dashboard analytics, I want preset buttons like Last 7 Days to return cached metrics rapidly without unnecessary computation delays.

**Acceptance criteria**:
- **AC-1**: Clicking any ticket row in the Customer Service dashboard Attention Required table opens `CustomerTicketDetailModal` with full ticket details and an active action trigger to open `AssignModal` for delegation.
- **AC-2**: Clicking any ticket item in the Customer Service dashboard Queued Tickets section opens the dual action detail modal with triage dispatch capabilities.
- **AC-3**: Clicking an unaccepted ticket on the Employee Dashboard Attention section opens `TicketDetailModal` with Accept and Request Reassignment capabilities, while clicking an active ticket opens `TicketInfoModal` with update triggers.
- **AC-4**: Local storage user serialization is safely scoped so stale non admin records are invalidated upon new session authentication, eliminating the intermediate employee navigation flash.
- **AC-5**: The route guards and layout wrappers (`PrivateRoute` and `AuthGate`) hold visual layout rendering in a clean skeleton state until backend session revalidation confirms the active user role.
- **AC-6**: In the ticket service backend (`TicketDashboardService.php`), the `Last 7 Days` preset is evaluated correctly before the general date filter fallback, ensuring identical cache keys for presets.
- **AC-7**: Action submissions within dashboard modals (such as assigning a technician or submitting an update) update local dashboard state optimistically and trigger non blocking background metric recalculations.

## Options considered

### Option 1: In place dashboard modal triggers, isolated session auth storage, and backend preset cache alignment (Recommended)

Connect the existing modal primitives directly into both dashboards, refine authentication local storage hydration to clear obsolete role records, and adjust backend preset logic to restore 60 second caching.

**Pros**:
- Reuses existing proven modal components (`CustomerTicketDetailModal`, `CSModals`, `TicketDetailModal`, and `TicketInfoModal`).
- Eliminates navigation round trips for high frequency triage tasks.
- Directly fixes the root causes of both the authentication flash and backend metric latency.

**Cons**:
- Requires coordinating modal state and callbacks across several summary sections in both dashboard components.

### Option 2: Full page queue redirects and separate authentication subdomains

Retain navigation from dashboards into dedicated incoming and assigned queue pages for all ticket actions, and isolate employee and admin portals into strictly separated subdomains.

**Pros**:
- Keeps dashboard components strictly stateless without local modal overlays.

**Cons**:
- Disrupts customer service and technician workflow by requiring multiple page transitions.
- Multi subdomain infrastructure adds substantial deployment and cookie management complexity.

## Decision

**Chosen option**: Option 1: In place dashboard modal triggers, isolated session auth storage, and backend preset cache alignment.

Connect contextual modals into the Customer Service and Employee dashboards, resolve authentication storage hydration to eliminate role flash, and fix backend preset cache evaluation.

**Implementation skills**: `react-frontend` (`.agents/skills/react-frontend/`), `laravel-microservice` (`.agents/skills/laravel-microservice/`).

## Rationale

Customer service operators and technicians prioritize rapid assessment and triage. Forcing navigation away from the traffic dashboard to take simple actions degrades operator efficiency. By attaching `CustomerTicketDetailModal` with assign triggers on the Customer Service dashboard and `TicketDetailModal` or `TicketInfoModal` on the Employee dashboard, users can inspect, assign, or accept tickets while keeping their operational context intact.

For the administrator login experience, the flash of the employee sidebar occurs because local storage preserves previous role information while session storage is refreshed. Enforcing consistent role clearing and ensuring `AuthGate` delays layout rendering until role resolution settles guarantees a clean transition directly into the administrator dashboard.

For filter performance, adjusting the preset matching order in `TicketDashboardService.php` ensures that requests containing preset parameters leverage existing Redis cache entries rather than generating distinct keys that execute full recalculations.

## Feature design

### Component Integration Map

```
+------------------------------------------------------------------------+
| Customer Service Dashboard (CSDashboard.jsx)                           |
|  - Attention Table Click   --> Opens CustomerTicketDetailModal         |
|  - Queued List Click       --> Opens CustomerTicketDetailModal         |
|  - Modal Action (Assign)   --> Switches to AssignModal in place        |
+------------------------------------------------------------------------+

+------------------------------------------------------------------------+
| Employee Dashboard (EmployeeDashboard.jsx)                             |
|  - Attention Unaccepted   --> Opens TicketDetailModal (Accept/Reassign)|
|  - Active Assigned Row    --> Opens TicketInfoModal (Progress/Update)  |
|  - Requestor Row Click    --> Opens CustomerTicketDetailModal (Status) |
+------------------------------------------------------------------------+
```

### Value Sourcing

| Action | Value produced / displayed | Source |
|---|---|---|
| View Ticket Modal (CS) | Detailed ticket description and attachments | API endpoint `/api/ticketing/ticket/{id}` |
| Assign from Dashboard | Updated ticket status and technician assignee | API endpoint `/api/ticketing/ticket/{id}/assign` |
| View Ticket Modal (Employee) | Assigned machine, problem category, SLA status | API endpoint `/api/ticketing/ticket/{id}` |
| Preset Filter Query | Dashboard trend metrics and employee workload | API endpoint `/api/ticketing/ticket/admin/dashboard` |

### Key Invariants

- Dashboard modal actions must preserve read only security enforcement when viewed by unauthorized roles.
- Customer service dashboard triage actions from modals must sync dashboard queued counts without requiring a browser page refresh.
- Local storage must never hold conflicting role identities from prior employee sessions when an administrator authenticates.
- The backend cache key for `Last 7 Days` preset must produce identical hashes whether queried via preset name or explicit date range.

### Security Model

- Customer service agents may view and delegate incoming and assigned tickets, but cannot bypass assignment eligibility or workload limits.
- Technicians can only accept or request reassignment for tickets where `assigned_to` matches their authenticated employee identifier.
- Administrators accessing `/admin/dashboard` must possess verified administrator roles validated by backend session tokens before administrative metric endpoints respond.

### Critical Test Scenarios

- Happy path: A customer service agent clicks an Attention Required ticket, views details in `CustomerTicketDetailModal`, clicks assign, chooses a technician, and the card updates in place, verifies **AC-1** and **AC-7**.
- Happy path: An employee clicks an incoming ticket card on the employee dashboard, accepts the assignment inside `TicketDetailModal`, and the card moves to active status, verifies **AC-3**.
- Auth verification: An administrator logs in with previous employee session data in browser storage; the interface displays the neutral loading state and directly presents the administrator dashboard with no employee layout flash, verifies **AC-4** and **AC-5**.
- Performance verification: An administrator clicks the Last 7 Days preset filter, and the dashboard renders in under 200 milliseconds from the warm backend cache, verifies **AC-6**.

## Build plan

- [x] In `services/ticket-service/app/Services/TicketDashboardService.php`, fix the preset evaluation order so that `Last 7 Days` is checked before fallback date range parsing, ensuring valid cache hits, satisfies **AC-6**.
- [x] In `frontend/web/src/context/AuthContext.jsx`, update user storage synchronization to ensure cross role logins purge obsolete user profiles from local storage, satisfies **AC-4**.
- [x] In `frontend/web/src/routes/AuthGate.jsx` and `frontend/web/src/App.jsx`, ensure layout shells do not mount until user role verification completes, satisfies **AC-5**.
- [x] In `frontend/web/src/pages/CSDashboard.jsx`, connect row clicks in the Attention Required table and Queued list to `CustomerTicketDetailModal` with delegation triggers to `AssignModal`, satisfies **AC-1**, **AC-2**, and **AC-7**.
- [x] In `frontend/web/src/pages/EmployeeDashboard.jsx`, connect Attention and Assigned cards to contextual `TicketDetailModal` and `TicketInfoModal` instances, satisfies **AC-3** and **AC-7**.
- [x] Validate all dashboard modal flows, authentication role transitions, and date filter response times across microservices, satisfies **AC-1**, **AC-3**, **AC-4**, and **AC-6**.

## Consequences

**Positive**:
- Customer service agents and technicians gain smooth in place triage and update abilities without losing their dashboard overview.
- Eliminates the jarring visual flicker of employee navigation when administrators log in.
- Restores sub second response times to administrator analytics filters.

**Negative / tradeoffs**:
- Dashboard components manage additional modal states and callback handoffs, slightly increasing frontend state surface.

**Neutral**:
- No database migrations or schema adjustments are required.

## Follow-up

- [ ] Verify real time WebSocket updates refresh modal status if a ticket is updated concurrently by another user while the modal is open.

## Migration plan

**Strategy**: feature-flagged or direct incremental code deployment.  
**Phases**:
1. Deploy ticket service backend preset cache logic fix.
2. Deploy frontend authentication hydration and dashboard modal integration updates.  
**Rollback**: Revert frontend and backend commits cleanly with zero database rollback risk.  
**Risks**: Low risk since changes operate within existing component primitives and caching layers.

