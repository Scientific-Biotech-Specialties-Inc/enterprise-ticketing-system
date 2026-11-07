# 0035. Presence, customer privacy, CSP header and internal ticket form fixes

**Date**: 2026-11-06
**Status**: In Progress

## Summary

Five small defects found while testing login, CS assignment and internal tickets. The browser warns about a security header set in the wrong place. Every employee shows "Available" even when logged out. Customers can see an employee's reassignment request and the CSR's reason. The internal ticket form fixes the title casing too early. The same form always demands equipment, even for IT tickets. This spec fixes all five in place, with no new services and no new tables.

## Context

Mode: ENHANCEMENT on the existing React 19 frontend, `employee-service`, `ticket-service` and `messaging-service`. Related specs: 0010 (reassignment and eligibility), 0012 (optional equipment, AI triage), 0033 and 0034 (customer security, verified identity).

Findings from the code:

- `frontend/web/index.html:15` sets `frame-ancestors` inside a `<meta>` CSP tag. Browsers ignore that directive in a meta tag, so the console warns on every page. `nginx.conf:14` already sends it as a real header for production. Vite dev servers (5173, 5005, 5006) send no header.
- `EmployeeDirectoryController.php:567` sets `availability_status` from `is_active`, which is the account flag. It never reflects whether someone is logged in. `messaging-service` already has `AuthController::heartbeat` (Redis key `employee:presence:{emp_id}`, 60 second TTL, writes `employees.last_seen_at`) and an `EmployeeStatusChanged` event. Nothing marks an employee offline when the heartbeat stops. The CS Assigned page already listens for `employee.status.changed`.
- `CustomerTicketDetailModal.jsx:666` renders `ReassignmentDisapprovalBanner`, including the CSR's reason. The ticket API also returns reassignment fields and timeline events to customers, so hiding the banner alone would still leak the data.
- `TicketModal.jsx:317` opens the title casing confirmation on blur of the title field. Clicking any dropdown blurs the title, so the prompt appears early. `handleSubmit` (line 191) already runs the same check at submit time.
- `TicketModal.jsx:186` requires `machine_ID` for every ticket and has no Service/IT choice. `TicketCreation.jsx` already treats equipment as optional for IT (department_id 1 Service, 2 IT).

## Requirements

**User stories**:
- As a CS coordinator, I want to see who is really online so that I assign tickets knowingly.
- As a customer, I should never see internal reassignment requests or reasons, so that internal handling stays internal.
- As an employee, I want the title casing prompt only when I submit so that picking a dropdown does not interrupt me.
- As an employee filing an IT ticket, I want equipment to be optional because many IT issues have no device.

**Acceptance criteria**:
- **AC-1**: No page in any mode logs the "frame-ancestors ignored in meta" warning. `frame-ancestors 'self'` is delivered as an HTTP header in dev (Vite) and production (Nginx), and is absent from the meta tag.
- **AC-2**: The CS Assigned page shows an employee as Online only when their last heartbeat is within 90 seconds. Otherwise Offline. Inactive accounts show Inactive.
- **AC-3**: Logging out or closing the app turns an employee Offline within 90 seconds at most (immediately on explicit logout), and the CS Assigned page updates live through `employee.status.changed`.
- **AC-4**: Offline employees remain selectable in the assign modal, with an "Offline" badge and a short warning. Online employees sort first.
- **AC-5**: A customer calling the ticket list, ticket detail, timeline or notifications endpoints never receives reassignment request fields, reasons, disapproval data or reassignment events. Customer UI never renders the reassignment banner or badge.
- **AC-6**: Employee, CS and manager views of reassignment are unchanged.
- **AC-7**: In the internal ticket modal, blurring the title field or using any dropdown shows no casing prompt. The prompt appears only after Submit when the title needs casing.
- **AC-8**: The internal ticket modal has a Service/IT department selector. Equipment is required for Service and optional for IT (label "Optional for IT"). An IT ticket submits with no `machine_ID` and is accepted by the API.

## Options considered

### Option 1: Fix each defect in place (reuse existing presence, add redaction)

Use the existing heartbeat and `last_seen_at` for presence, redact in the API and UI for customers, move the casing check to submit, add the department rule to the modal.

**Pros**:
- Reuses existing infrastructure and events, small change surface.
- Privacy fix is enforced server side.

**Cons**:
- Presence relies on the frontend sending heartbeats reliably.

### Option 2: New presence service or websocket presence channel

A dedicated presence channel on Reverb, tracking connect and disconnect.

**Pros**:
- Instant offline detection.

**Cons**:
- New moving parts for a status badge, more failure modes, and disconnect events are unreliable on mobile and sleep.

### Option 3: Hide the reassignment banner in the UI only

**Pros**:
- One line change.

**Cons**:
- The data still reaches the customer's browser and timeline. Not acceptable for a privacy requirement.

## Decision

**Chosen option**: Option 1: Fix each defect in place.

Presence comes from heartbeat freshness, customer reassignment data is removed in the API response and the UI, the casing prompt moves to submit only, and the internal ticket modal gets the department aware equipment rule.

**Implementation skills**: `react-frontend` (`.agents/skills/react-frontend/`) · `laravel-microservice` (`.agents/skills/laravel-microservice/`)

## Rationale

Messaging-service already writes a heartbeat with a 60 second TTL, so presence only needs a freshness check and an expiry rule, which is far cheaper than a new channel (Option 2). A 90 second window tolerates one missed 30 second heartbeat. The customer data must be removed at the API because AGENTS.md invariant 3 and spec 0034 treat the browser as untrusted, so Option 3 is rejected. Choosing "offline stays assignable with a warning" avoids leaving tickets unassignable outside working hours.

## Feature design

**Data model sketch**: no schema change. Uses existing `employees.last_seen_at` and `employees.is_active`.

**State transitions** (presence, derived, not stored):
- Online: `is_active` true and `now - last_seen_at <= 90s`
- Offline: `is_active` true and (`last_seen_at` null or older than 90s)
- Inactive: `is_active` false

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| messaging `/heartbeat` (existing) | POST | none | last_seen_at | employee bearer | 401 |
| messaging logout (existing) | POST | none | 204 | employee bearer | 401 |
| employee-service directory listing (existing) | GET | filters | each employee gains `presence` (`online`, `offline`, `inactive`) and `last_seen_at`; `availability_status` kept for compatibility | employee bearer | 401, 403 |
| ticket-service customer ticket list, detail, timeline | GET | ticket id | same payload with reassignment fields and events removed | customer bearer | 401, 403, 404 |
| ticket-service create ticket (existing) | POST | `department_id` (1 Service, 2 IT), `machine_ID` nullable for IT | ticket | employee bearer | 422 if Service and no machine |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| CS Assigned row | Online / Offline / Inactive | derived from `employees.last_seen_at` and `is_active`, window from `PRESENCE_ONLINE_WINDOW_SECONDS` |
| Heartbeat | `last_seen_at` | server clock at request time |
| Logout | Offline | logout clears `last_seen_at` (set to null) |
| Live update | new presence | `employee.status.changed` event (existing) plus a 30 second client refresh so a silent expiry is also shown |
| Customer timeline | list of events | audit events filtered by an allowlist of customer visible types; every reassignment event type is excluded |
| Internal ticket | `department_id` | the new Service/IT selector in `TicketModal` (1 or 2) |
| Casing prompt | formatted title | `formatProperTitleCase` on submit (existing util) |

**Key invariants**:
- Customers never receive reassignment request, reason, disapproval or event data from any endpoint.
- Presence never changes `is_active` (the account flag).
- The CSP header is the only place `frame-ancestors` is set.

**Security model**: customer endpoints use the verified customer token (spec 0034) and a response allowlist. Presence is readable by CS, managers and admins only, as today.

**Configuration required**:
- `PRESENCE_ONLINE_WINDOW_SECONDS` (default 90): how fresh a heartbeat must be to count as Online.

**Critical test scenarios**:
- Heartbeat 30s ago shows Online; 120s ago shows Offline; after logout shows Offline, verifies **AC-2**, **AC-3**
- Offline employee can still be assigned and shows the badge, verifies **AC-4**
- Customer detail and timeline responses for a ticket with a disapproved request contain no reassignment keys or events, verifies **AC-5**
- Employee view of the same ticket still shows the banner, verifies **AC-6**
- Typing a lowercase title then opening a dropdown shows no prompt; Submit shows it, verifies **AC-7**
- IT ticket with no equipment submits; Service ticket without equipment is blocked, verifies **AC-8**
- Dev server response includes the CSP header and `index.html` meta lacks `frame-ancestors`, verifies **AC-1**

## Build plan

Approach: no build approach is recorded in `AGENTS.md`, so end to end slices by defect, smallest first.

1. [x] Remove `frame-ancestors` from the meta tag in `frontend/web/index.html` and add it to `server.headers` in `frontend/web/vite.config.js`; confirm `nginx.conf` and `nginx.prod.conf` both keep the header, satisfies **AC-1**
2. [x] Move the title casing check in `TicketModal.jsx` to submit only (delete the blur handler body, keep `touch('title')`), satisfies **AC-7**
3. [x] Add the Service/IT selector to `TicketModal.jsx`, make equipment required for Service only, send `department_id`, confirm the ticket API accepts a null `machine_ID` for IT (spec 0012 path), satisfies **AC-8**
4. [x] Redact reassignment data for customers in ticket-service (list, detail, timeline, notifications) with an allowlist, and remove the banner from `CustomerTicketDetailModal.jsx`, satisfies **AC-5**, **AC-6**
5. [x] Presence backend: add `presence` to the employee-service directory response using `last_seen_at` and the window config; make logout clear `last_seen_at` and dispatch `EmployeeStatusChanged`, satisfies **AC-2**, **AC-3**
6. [x] Make sure the employee frontend sends a heartbeat every 30 seconds while signed in (add it to `AuthContext` if missing), stop it on logout, satisfies **AC-3**
7. [x] CS Assigned and the assign modal: show Online/Offline/Inactive badge, sort online first, offline warning, 30 second refresh plus the existing live event, satisfies **AC-2**, **AC-3**, **AC-4**
8. Tests: backend feature tests for redaction and presence; frontend tests for casing, department rule and badges (hand to `/test`), satisfies all ACs

## Consequences

**Positive**:
- CS sees truthful availability and assigns with eyes open.
- Customer privacy is enforced on the server.
- Console warning gone, form behaves as expected.

**Negative / tradeoffs**:
- Presence is approximate (up to 90 seconds stale) and depends on heartbeats from an open tab.
- Redaction allowlist must be maintained when new timeline event types are added.

**Neutral**:
- `availability_status` stays in the response for older consumers until they move to `presence`.
- No migration needed.

## Follow-up

- [ ] Confirm during build whether the frontend already sends heartbeats; if employee-service and messaging-service use different `employees` tables, expose presence through the REST API rather than a shared table read (invariant 3).
- [ ] Decide later whether an "Away" state is wanted.
