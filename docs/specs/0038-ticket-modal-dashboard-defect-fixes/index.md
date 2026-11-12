# 0038. Ticket Modal, Dashboard, And AI Escalation Defect Fixes

**Date**: 2026-11-11
**Status**: In Progress

## Summary

This spec fixes thirteen defects you reported across the AI escalation flow, the CS and customer ticket modals, the customer and employee dashboards, customer message images, the employee ticket update page, ticket hold and status rules, proof approval, and customer feedback. Most are frontend fixes. The backend changes are small: per person reminders, customer dashboard status counting, a check that a ticket's machine belongs to the customer, resume to the held status, a recorded "proof viewed" gate before approval, and a lightweight ticket ownership check for feedback. The biggest one: an AI escalated ticket may only ever be linked to one of the customer's own registered machines. It is never linked to free text the customer typed, and never to a guessed machine.

## Rationale

Reasoning, root causes, and options: see [rationale.md](rationale.md).

## Requirements

**User stories**:
- As a customer, I want the AI escalated ticket to name the machine I actually own, so the technician goes to the right equipment.
- As a CS agent, I want to see every employee assigned to a ticket and message or remind each one, so I can chase the right person.
- As a customer, I want my dashboard cards to count every active ticket, so I can trust what I see.
- As a customer, I want images I send in messages to show up, so the conversation is useful.
- As a CS agent or customer, I want the message button in a ticket modal to open that ticket's conversation.
- As an employee, I want "needing immediate action" to list only SLA problems, so I know what is actually urgent.
- As an employee, I want the ticket update page to show the real machine, and to save a work log without the whole page reloading.
- As an employee, I want Pending and On Hold status changes to save when the transition rules allow them, and to be told clearly when they don't.
- As a CS agent, I want a held ticket to resume to the status it was in, so a submitted proof is not lost.
- As a CS lead, I want CS to always open the proof of completion before approving it, so no ticket is closed unchecked.
- As a customer, I want to submit feedback on my resolved ticket, and as staff I want to see it.

**Acceptance criteria**:

*Item 1 and 8, AI machine linking (machine always from the customer's registered machines)*
- **AC-1**: The AI escalation flow resolves the machine only from the signed in customer's registered machines (`ticketOptions.machines`, which are `machines` rows with `client_ID` = that customer). Match order: exact serial number found in the chat text (case insensitive), then exact model, then exact machine name. A brand alone never counts as a match.
- **AC-2**: When no registered machine matches, `machine_ID` stays empty and `machineModel` stays empty. There is no fallback to the customer's chat text, and no fallback to their first registered machine.
- **AC-3**: The escalation review modal (`TicketReviewModal`) replaces the free text machine input with a required select whose options are only the customer's registered machines, labelled `<machine_name> (<serial_number>)`. When AC-2 left it empty, the select starts on a placeholder ("Select your machine"), and submit is blocked with an inline message until the customer picks one. For a ticket the AI classified as IT, the select is optional, matching spec 0012.
- **AC-4**: The generated description no longer contains a `Machine:` line, and no longer repeats the problem details twice. The format is: `Customer reported an issue regarding "<title>". Problem details: <customer messages, de-duplicated, joined with ". ">. Automated troubleshooting was attempted but the issue persists. Ticket escalated to technical team for follow-up.`
- **AC-5**: `POST` ticket creation for an external (customer) ticket returns `422` with `machine_ID: "The selected machine is not registered to this customer."` when `machine_ID` is set and `machines.client_ID` does not equal the creating customer. Internal tickets keep today's rule.
- **AC-6**: On `/employee/ticket-update`, the Machine and Equipment Details card shows the values returned by `GET /tickets/{id}/customer-context`. When that request fails, the card shows "Machine details could not be loaded" with a Retry button. It never shows made up values (`Customer Site`, `—`, `Asset`).

*Item 2, multiple assignees*
- **AC-7**: The CS ticket modal (`TicketSummary` in `CSModals.jsx`) shows one assignee row per entry in `ticket.assigned_employees` that is still active (`completed_at` empty, status `assigned` or `accepted`), in assignment order. Each row shows the name, department, its own status ("Accepted" or "Awaiting acceptance"), and its own Message and Remind buttons.
- **AC-8**: Each row's Remind button sends `POST /tickets/{id}/reminders` with `employee_id` set to that assignee. The 60 minute cooldown is tracked per assignee, so reminding one person does not block reminding another. The cooldown countdown on each row reads from that assignee's own `last_reminder_sent_at`.
- **AC-9**: `POST /tickets/{id}/reminders` with an `employee_id` that is not an active assignee of the ticket returns `422`. Without `employee_id`, it keeps today's behaviour (it reminds the primary assignee), so older callers keep working.
- **AC-10**: The customer ticket modal (`CustomerTicketDetailModal.jsx`) also lists every active assignee (name and department). It has no Remind button, and its Message button opens the shared ticket conversation (AC-17).
- **AC-11**: When there are no active assignees, both modals show the single "None assigned" row as they do today.

*Item 3, customer dashboard*
- **AC-12**: The customer dashboard summary counts statuses into the four cards like this. Open: `Open`, `Pending`, `Pending Assignment`. In Progress: `In Progress`, `Escalated`, `Pending Evaluation`, `Reopened`, `On Hold`. Resolved: `Resolved`. Closed: `Closed`. `Discarded` is excluded. Every non discarded external ticket of the customer lands in exactly one card. (Customer 3 today: 1 Open, 2 In Progress.)
- **AC-13**: The recent tickets list returns each ticket once, even when it has several active assignees, so a ticket with two assignees no longer pushes another ticket out of the five row list. A status change or assignment change on a ticket clears that customer's `customer_dashboard_counts_{created_by}` cache key, using a direct key delete (never `KEYS *`).

*Item 4, customer message images*
- **AC-14**: In `MessagingPage.jsx`, image attachments in message bubbles render through the existing `AuthenticatedImage` component (bearer token fetch, then a blob URL, per spec 0037), for customers and staff alike. A customer sees their uploaded image in the thread right after sending, with no "Unauthenticated" error.
- **AC-15**: When the image fetch fails, the bubble shows the file name with a download link and a short "Preview unavailable" note instead of a broken image.

*Item 5, label*
- **AC-16**: In the shared `FieldGrid` ticket modal component, the equipment sub line reads `Serial ID: <serial_number>` instead of `Asset ID: <serial_number>`. This applies everywhere `FieldGrid` is used (CS, customer, and employee modals).

*Item 6, message buttons*
- **AC-17**: "Message the customer" and "Message <first name>" in the CS modal, and "Message Customer Support" and "Message the assigned employee" in the customer modal, close the modal, navigate to the messages route of the portal you are in, and open that ticket's conversation. This holds for the customer, cs, cs-manager, service-manager, it-manager, and employee portals.
- **AC-18**: The portal is detected from the router relative path (`useLocation().pathname`), not `window.location.pathname`, so the `/ticketing/` basename no longer breaks the match. One shared helper is used by both modals.
- **AC-19**: When the target ticket is not in the messaging list (for example it is archived), the messages page shows a notice ("This conversation is archived" or "Conversation not found") instead of silently showing nothing.

*Item 7, employee dashboard*
- **AC-20**: "Assigned Items Needing Immediate Action" on the employee dashboard lists only assigned tickets whose SLA risk is `breached` or `at_risk`, excluding `Resolved`, `Closed`, and `Discarded`. Tickets that are merely assigned, not yet accepted, or `Escalated` without an SLA risk no longer appear. The cap of 4 items and the count in the heading stay.

*Item 9, work log*
- **AC-21**: Saving a work log on `/employee/ticket-update` keeps the page on screen. Only the Save button shows the `Loader2` spinner, the new entry appears in the Work Log list, and no skeleton replaces the page.
- **AC-22**: The 30 second poll and the `ticket.changed` realtime refresh update the page in the background without showing skeletons. Skeletons show only on the first load of a ticket.
- **AC-23**: A background refresh applies fresh server values over the local ticket state (server wins), except for the local only reassignment fields that are kept today (`reassignmentDenyReason`, `disapprovalReason`, `reassignmentStatus`, `deniedReassignment`).

*Item 10, employee Pending and On Hold status changes (governed by the superadmin transition matrix)*
- **AC-24**: `POST /tickets/{id}/employee-update` (employee-service) accepts `On Hold` as a status value (today it's missing from the `in:` validation list, so the request is rejected). A `Pending` or `On Hold` change is checked against the superadmin transition matrix (`On Hold/Pending` target state). When allowed, it is saved, an audit row is written, and the page shows the new status after save.
- **AC-25**: When the matrix blocks the move, the endpoint returns `422` with `code: INVALID_TICKET_TRANSITION`, `from_status`, `to_status`, `allowed_statuses`. The employee page shows the existing `ActionErrorModal` with a message naming the blocked move (for example "Your administrator's transition rules don't allow In Progress to On Hold") and the allowed statuses. The status dropdown returns to the saved status. The employee is never left thinking it saved.
- **AC-26**: The `Pending` "doesn't save" case is reproduced in the browser before fixing, and its cause is recorded in this spec. After the fix, an allowed `In Progress` to `Pending` change by an assigned employee persists (status id 7) and survives a page refresh.
- **AC-27**: The existing rule stays: once a ticket is `On Hold`, only CS can resume it. The employee sees the existing `TICKET_ON_HOLD` message.

*Item 11, CS hold and resume keep the held status*
- **AC-28**: Resuming an `On Hold` ticket returns it to the status saved in `held_from_status_ID`, with the matching owner: `Pending Evaluation` (owner employee), `In Progress` (the previous owner), or `Pending Assignment` (as today). Proof attachments and `proof_rejected` are left untouched. When `held_from_status_ID` is empty (older holds), today's behaviour applies.
- **AC-29**: The same resume rule is applied in both state machines (`ticket-service` and `employee-service` `TicketStateMachine`), and the resume is audit logged with `from` On Hold and `to` the restored status.

*Item 12, CS must view the proof of completion before approving*
- **AC-30**: While a ticket is `Pending Evaluation`, the CS modal's "Approve & Resolve" button is disabled. A helper line reads "Open each proof of completion file to enable approval". It becomes enabled only after the current CS user has opened every proof file of the latest submission. A viewed check mark shows next to each opened file.
- **AC-31**: Opening a proof file in the CS modal calls `POST /tickets/{id}/proof-views` with `attachment_id`. ticket-service records a `ticket_audit_logs` row (`action_type: proof_viewed`, actor, `attachment_id`). This is allowed only for CS or admin, only while the ticket is `Pending Evaluation`, and only for an attachment that is a proof of this ticket's active assignment. Otherwise it returns `403` or `422`.
- **AC-32**: A CS move from `Pending Evaluation` to `Closed` or `Resolved` returns `422` with `code: PROOF_NOT_VIEWED` and the list of unviewed file names, unless the acting user has a `proof_viewed` row for every proof attachment of the latest submission (created after the latest employee `Pending Evaluation` status change). A new proof submission resets the requirement.
- **AC-33**: When a `Pending Evaluation` ticket has no proof file, "Approve & Resolve" stays disabled with "No proof of completion was uploaded", and CS can only reject the proof.

*Item 13, customer feedback*
- **AC-34**: A new `GET /tickets/{ticketId}/ownership` (ticket-service, bearer) returns `ticket_ID`, `ticket_number`, `client_ID`, `status_name`, `is_internal`. It reads only the `tickets` and `ticket_statuses` tables and makes no outbound HTTP calls. A customer caller gets `404` for a ticket that isn't theirs.
- **AC-35**: analytics-service `FeedbackController` uses that endpoint (5 second timeout) instead of the full ticket detail, for submit, update, and delete. A customer submitting feedback on their own `Resolved` or `Closed` ticket gets `201`, and a `customer_feedback` row is saved.
- **AC-36**: Saved feedback shows in the CS ticket modal and on the employee ticket update page (`TicketFeedbackSection`), read from `GET /feedback/ticket/{id}`. Nothing is read from browser storage.
- **AC-37**: When ticket-service is really unreachable, the `503` from spec 0034 stays. The customer sees "Feedback cannot be verified right now", and the feedback is not saved locally as if it succeeded.

## Decision

**Chosen option**: Option 1: Fix each defect in place, within the existing components and endpoints.

Each defect is fixed at its root cause in the code that owns it. One small, additive migration adds per assignee reminder tracking. Two small ticket-service endpoints are added (`proof-views`, `ownership`). No new services are added.

**Implementation skills**: `react-frontend` (`.claude/skills/react-frontend/`) · `laravel-microservice` (`.claude/skills/laravel-microservice/`) · `gemini-ai` (`.claude/skills/gemini-ai/`)

## Feature design

**Data model sketch** (one additive change):

| Table | Change | Type | Notes |
|---|---|---|---|
| `ticket_assignments` | add `last_reminder_sent_at` | `dateTime`, nullable | Per assignee cooldown source. No default, no backfill needed. |
| `tickets` | unchanged | | `last_reminder_sent_at` keeps being written with the latest reminder, so existing readers keep working. |
| `machines` | unchanged | | `client_ID` is the ownership source for AC-1 and AC-5. |
| `ticket_audit_logs` | unchanged (new `action_type` value `proof_viewed`, `attachment_id` stored in `details`) | | Foreign keys stay nullable and non cascading (coding standards). |
| `tickets` `held_from_status_ID` | unchanged | | Already written on hold. Now also read on resume (AC-28). |

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/tickets/{ticketId}/reminders` (ticket-service) | POST | `employee_id`: int (optional, new), `custom_message`: string (optional) | `employee_id`, `last_reminder_sent_at` | bearer, CS or admin (unchanged) | 422 not an active assignee or ticket closed, 429 per assignee cooldown with `cooldown_remaining_minutes` |
| `/tickets` create (ticket-service, `TicketController` store) | POST | `machine_ID` (unchanged) | unchanged | bearer (unchanged) | 422 machine not owned by customer (new, external only) |
| `/tickets/{id}` details and CS lists (ticket-service) | GET | unchanged | `assigned_employees[]` items gain `id`, `assignment_status`, `last_reminder_sent_at` where missing | unchanged | unchanged |
| `/customer/dashboard` summary (ticket-service, `TicketDashboardService::getCustomerDashboard`) | GET | unchanged | `summary.{open,in_progress,resolved,closed}` using the AC-12 mapping, `recent_tickets` deduplicated | unchanged | unchanged |
| `/tickets/{id}/customer-context` | GET | unchanged | unchanged | unchanged | unchanged (frontend handles failure per AC-6) |
| `/tickets/{ticketId}/employee-update` (employee-service) | POST | `status` now also accepts `On Hold` | unchanged | bearer, assigned employee (unchanged) | 422 `INVALID_TICKET_TRANSITION` with `from_status`, `to_status`, `allowed_statuses`; 422 `TICKET_ON_HOLD` |
| resume (ticket-service state machine `resume` action, existing CS endpoint) | POST | unchanged | status restored from `held_from_status_ID` | CS or admin (unchanged) | unchanged |
| `/tickets/{ticketId}/proof-views` (ticket-service, new) | POST | `attachment_id`: int (req) | `viewed_attachment_ids[]`, `all_viewed`: bool | bearer, CS or admin | 403 role, 422 not Pending Evaluation or not a proof of this ticket |
| CS status update to `Closed` or `Resolved` from `Pending Evaluation` (existing) | POST/PUT | unchanged | unchanged | unchanged | 422 `PROOF_NOT_VIEWED` with `unviewed_files[]` (new) |
| `/tickets/{ticketId}/ownership` (ticket-service, new) | GET | none | `ticket_ID`, `ticket_number`, `client_ID`, `status_name`, `is_internal` | bearer (customer sees only own) | 401, 404 |
| `/feedback`, `/feedback/ticket/{id}` (analytics-service) | POST, PUT, DELETE | unchanged | unchanged | unchanged | 503 only when ticket-service is unreachable |

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| AI escalation | matched `machine_ID`, machine label | `ticketOptions.machines` (customer's `machines` rows) matched against the chat text per AC-1 |
| AI escalation | description text | AC-4 template; `<title>` from the existing resolved title, problem details from the customer's chat messages |
| Review modal | machine options | `ticketOptions.machines` (`machine_ID`, `machine_name`, `serial_number`) |
| Review modal | IT vs Service requirement | the existing department classification from spec 0012 (`requires_equipment`) |
| Ticket create | ownership check | `machines.client_ID` compared with the authenticated customer id that becomes `tickets.created_by` |
| Assignee rows | name, department, status | `ticket.assigned_employees[]` from `TicketService` ticket payload |
| Assignee rows | per row cooldown | `assigned_employees[].last_reminder_sent_at` (new column), 60 minute rule unchanged |
| Reminder | target employee | `employee_id` input, validated against active `ticket_assignments` rows |
| Customer dashboard | card counts | `ticket_statuses.status_name` grouped per the AC-12 mapping |
| Messages redirect | portal prefix | router relative `useLocation().pathname` first segment (`cs`, `cs-manager`, `service-manager`, `it-manager`, `employee`, otherwise customer `/messages`) |
| Messages redirect | ticket to open | `ticket.ticket_ID` passed as `location.state.selectedTicketId` (existing contract read at `MessagingPage.jsx:127`) |
| Message image | image bytes | `AuthenticatedImage` with the attachment's `url` or `file_path` (spec 0037 helper `fetchAttachmentBlob`) |
| Immediate action list | SLA risk | existing `evaluateSlaRisk(t)` in `EmployeeDashboard.jsx` |
| Machine card | machine fields | `customer-context` response `machine` object |
| Work log list | new entry | refetched `details.worklogs` via a background refresh after `saveWorkLog` |
| Employee status change | allowed or blocked | superadmin transition matrix from configuration-service (`/api/ticket-configurations/transitions`, cached 300s), via `validateEmployeeStatusChange` |
| Blocked status modal | message and allowed list | `422` body `from_status`, `to_status`, `allowed_statuses` |
| Resume | restored status and owner | `tickets.held_from_status_ID` and `tickets.previous_in_progress_owner` |
| Proof gate | proof files of the latest submission | attachment-service `GET /api/attachments?assignment_id=<active assignment>` (existing call in `TicketService`) |
| Proof gate | latest submission time | latest `ticket_audit_logs` employee status change to `Pending Evaluation` |
| Proof gate | viewed files | `ticket_audit_logs` rows `proof_viewed` by the acting user after that time |
| Feedback ownership | owner and status | new `/tickets/{id}/ownership` (`tickets.created_by` as `client_ID`, `ticket_statuses.status_name`) |
| Feedback display | rating and comments | analytics-service `customer_feedback` via `GET /feedback/ticket/{id}` |

**Key invariants**:
- An external ticket's `machine_ID` is either null (IT only) or a machine whose `client_ID` is that customer. Enforced in the frontend (AC-1 to AC-3) and the backend (AC-5).
- Nothing typed by the customer is ever stored or shown as a machine name.
- Reminder cooldown is per active assignment row. `tickets.last_reminder_sent_at` is a summary (latest), not the gate.
- Cache invalidation uses direct key deletes or the existing `SCAN` chunking, never `KEYS *` (AGENTS.md invariant 6).
- Skeletons for data loading, `Loader2` only for button actions (AGENTS.md loading rule).
- Employee status changes are always decided by the superadmin transition matrix. The frontend never hides a blocked move silently; it reports it.
- Resume never changes a ticket to a status other than the one it was held from (when recorded).
- No CS approval of a proof without a recorded view of every proof file of the latest submission, by that same user.
- Feedback ownership is never skipped (spec 0034). Only the lookup gets lighter.

**Security model**:
- Reminders: unchanged roles (CS and admin). The new `employee_id` must belong to an active assignee of that ticket, so a caller cannot use the endpoint to notify arbitrary staff.
- Ticket create: the ownership check (AC-5) closes a gap where a customer could link another customer's machine id.
- Images: served only through the bearer token fetch; no public URL is introduced. The attachment-service access check stays authoritative.
- Customer modal shows assignee names and departments only (already visible today for the primary), no contact details.
- Proof views: only CS or admin can record one, and only for a proof of that ticket. The gate checks the acting user's own views, so one agent's view doesn't unlock another agent's approval.
- Ownership endpoint: returns no customer details beyond `client_ID`. Customers get `404` for tickets that aren't theirs, the same as spec 0034.

**Configuration required**: none.

**Critical test scenarios**:
- Happy path, AI: chat mentions `MON-500-A11`, so Philips VS-900 (machine 2) is preselected. Verifies **AC-1**.
- Failure, AI: chat mentions an unregistered "Mindray BC-5390", so the select is empty, submit is blocked until a pick, and the description has no `Machine:` line. Verifies **AC-2**, **AC-3**, **AC-4**.
- Brand only: chat says "Philips" only, so no machine is preselected. Verifies **AC-1**.
- Auth, create: customer 3 posts `machine_ID` of another client's machine and gets `422`. Verifies **AC-5**.
- Multi assignee: ticket 3 shows two rows (employee 4 Accepted, employee 1093 Awaiting acceptance). Remind employee 4, then employee 1093 succeeds immediately; reminding employee 4 again gets `429`. Verifies **AC-7**, **AC-8**.
- Bad assignee: `employee_id` of a non assignee gets `422`. Verifies **AC-9**.
- Dashboard: customer 3 shows Open 1, In Progress 2. Verifies **AC-12**.
- Image: a customer uploads a PNG in messages and it renders. Verifies **AC-14**.
- Redirect: from `/ticketing/cs-manager/...` the message button lands on `/cs-manager/messages` with the ticket open. Verifies **AC-17**, **AC-18**.
- Immediate action: an assigned, on track ticket is not listed; an at risk one is. Verifies **AC-20**.
- Work log: save keeps the page visible and adds the row. Verifies **AC-21**.
- Employee status allowed: `In Progress` to `Pending` and to `On Hold` save and survive a refresh. Verifies **AC-24**, **AC-26**.
- Employee status blocked: with `On Hold/Pending` removed from the matrix row, the save returns `422` and the modal names the blocked move. Verifies **AC-25**.
- Hold and resume: a `Pending Evaluation` ticket is held by CS, then resumed, and is `Pending Evaluation` again with its proof intact. Verifies **AC-28**.
- Proof gate: CS approves without opening the proof and gets `422 PROOF_NOT_VIEWED`. After opening every file, approve succeeds. A second CS user who opened nothing is still blocked. Verifies **AC-30**, **AC-31**, **AC-32**.
- Feedback: customer 3 submits feedback on a `Resolved` ticket and gets `201`. CS and the employee then see it. Another customer submitting for that ticket gets `404`. Verifies **AC-34**, **AC-35**, **AC-36**.

## Build plan

No build approach is recorded for this project, so this assumes end to end slices, one defect group at a time. Each slice can ship on its own. The order puts data integrity first.

1. **AI machine resolution**: in `AISupportPage.jsx`, rewrite the machine resolution in `generateRealReviewData` per AC-1 and AC-2 (serial, then model, then name; remove the brand only match, the chat text fallback, and the first machine fallback). Also resolve any Gemini `machineModel` against the catalog the same way. Remove the loose `includes` matching in `handleCreateTicket`. Satisfies **AC-1**, **AC-2**.
2. **Review modal select**: replace the datalist input in `TicketReviewModal` with a required select of the customer's machines, plus the IT optional rule. Satisfies **AC-3**.
3. **Description template**: replace the fallback `convSummary` template and de-duplicate the user messages. Satisfies **AC-4**.
4. **Backend ownership check**: in `TicketController` store (external path), add a rule that `machine_ID` exists in `machines` with `client_ID` = the authenticated customer. Add a feature test. Satisfies **AC-5**.
5. **Machine card failure state**: in `CustomerInfoPanel.jsx`, remove the synthesized fallback values and add the error plus Retry state. Satisfies **AC-6**.
6. **Migration**: timestamped migration adding nullable `ticket_assignments.last_reminder_sent_at`. Satisfies **AC-8**.
7. **Reminder endpoint**: extend `TicketReminderController::sendReminder` with optional `employee_id`, active assignee validation, a per assignment cooldown, writing both the assignment column and `tickets.last_reminder_sent_at`. Add feature tests for 200, 422, and 429. Satisfies **AC-8**, **AC-9**.
8. **Assignee payload**: make sure each `assigned_employees[]` item from `TicketService` and the CS list builders includes `id`, `name`, `department`, `assignment_status`, `last_reminder_sent_at`. Satisfies **AC-7**, **AC-8**.
9. **Assignee rows UI**: add `getAssigneeList(ticket)` beside `getAssigneeInfo` in `ticketModalUtils.js`. Render one `AssigneeRow` per active assignee in `CSModals.jsx` (with per row Remind state, cooldown, and `sendTicketReminder(ticketId, message, employeeId)`) and in `CustomerTicketDetailModal.jsx` (no Remind). Keep the "None assigned" row. Satisfies **AC-7**, **AC-8**, **AC-10**, **AC-11**.
10. **Customer dashboard counts**: in `TicketDashboardService::getCustomerDashboard`, map statuses per AC-12, deduplicate recent tickets (aggregate assignee names or pick the first active assignment in a subquery), and forget `customer_dashboard_counts_{created_by}` wherever ticket status or assignment changes. Add a service test. Satisfies **AC-12**, **AC-13**.
11. **Message images**: swap the raw `<img>` at `MessagingPage.jsx:1394` for `AuthenticatedImage`, with the download fallback. Check the customer bearer passes the attachment access check for message attachments; if it does not, fix that check in attachment-service. Satisfies **AC-14**, **AC-15**.
12. **Serial ID label**: change the label in `FieldGrid.jsx`. Satisfies **AC-16**.
13. **Message redirect**: reproduce "nothing happens" in the browser first (CS on `/ticketing/cs/incoming`, CS manager, customer on port 5006), and record the finding. Add `getMessagesPath(pathname)` to `ticketModalUtils.js` using the router path, use it in both modals, and fix any further cause the repro reveals. Add the not found or archived notice in `MessagingPage`. Satisfies **AC-17**, **AC-18**, **AC-19**.
14. **Immediate action filter**: change the `assignedAttentionItems` filter in `EmployeeDashboard.jsx` to breached or at risk only, and update `EmployeeDashboard.test.jsx`. Satisfies **AC-20**.
15. **Work log and refresh**: give `loadTicketData` a `{ background }` option that skips `setLoading(true)`. Use background mode after a work log save, for the poll, and for realtime refresh. Fix the merge order so server values win except the four local reassignment fields. Satisfies **AC-21**, **AC-22**, **AC-23**.
16. **Employee status repro and validation**: reproduce the `Pending` and `On Hold` saves in the browser and record the `Pending` cause. Add `On Hold` to the `in:` list in `EmployeeAssignmentController::employeeUpdate`. Fix the `Pending` cause found. Make the employee page show `ActionErrorModal` with `from_status`, `to_status`, `allowed_statuses` on a `422`, and reset the dropdown. Add employee-service feature tests (allowed and blocked). Satisfies **AC-24**, **AC-25**, **AC-26**, **AC-27**.
17. **Resume to held status**: in both `TicketStateMachine` classes, make `resume` restore `held_from_status_ID` (Pending Evaluation with owner employee, In Progress with the previous owner, Pending Assignment as today), writing the matching `ticket_status_ID`. Add tests for each. Satisfies **AC-28**, **AC-29**.
18. **Proof views endpoint and gate**: add `POST /tickets/{id}/proof-views` (a thin controller plus a `ProofReviewService` in `app/Services/`). Enforce `PROOF_NOT_VIEWED` in the CS transition from `Pending Evaluation` to `Closed` or `Resolved`. Add feature tests. Satisfies **AC-31**, **AC-32**.
19. **Proof gate UI**: in the CS modal's proof section, call `proof-views` when a proof file is opened (`FilePreviewModal` or open in new tab), show a viewed mark per file, keep "Approve & Resolve" disabled until all are viewed, and handle the no proof case. Satisfies **AC-30**, **AC-33**.
20. **Ownership endpoint**: add `GET /tickets/{id}/ownership` to ticket-service (no outbound calls). Satisfies **AC-34**.
21. **Feedback lookup**: switch `FeedbackController` submit, update, and delete to the ownership endpoint with a 5 second timeout. Check that the CS modal and `TicketFeedbackSection` read from the API, and remove any browser storage read for display. Add analytics feature tests (201, 404, 503). Satisfies **AC-35**, **AC-36**, **AC-37**.

## Consequences

**Positive**:
- Tickets can no longer point at the wrong machine, which fixes the technician's machine card at its source.
- CS can see and chase every assignee individually.
- Customer counts match reality, and images work again after the private disk change.

**Negative / tradeoffs**:
- A customer whose machine is not registered cannot submit a Service ticket through the AI flow until the machine is registered. That is deliberate (machines come only from their list), but it may create support calls. See Follow-up.
- The per assignee cooldown adds a column and a second source of reminder time. `tickets.last_reminder_sent_at` must keep being written, or older screens drift.
- Mapping `Escalated` and `Pending Evaluation` to "In Progress" hides those internal states from customers on the cards. That's intended, but staff and customers will see different words for the same ticket.
- The proof gate adds a click for CS on every approval and a call to attachment-service when checking. If attachment-service is down, approval is blocked (safer than approving unchecked).
- Two state machines must stay in sync for the resume rule. Drift between them is an existing risk that this change touches.

**Neutral**:
- Existing tickets already linked to a wrong machine (ticket 3 → machine 2) are not repaired automatically.
- One additive, nullable migration. Rollback is reverting the commit and dropping the column.

## Follow-up

- [ ] Decide how a customer gets an unregistered machine added (CS registers it, or a "my machine is not listed" request). Out of scope here.
- [ ] Review existing AI created tickets whose description contains `Machine:` with a chat message, and relink them through CS reclassify. Ticket `INC-OPS-202611-00003` is one.
- [ ] Record the item 6 repro finding in this spec once step 13 runs.
- [ ] Record the `Pending` save repro finding in this spec once step 16 runs.
- [ ] The CS "Approve & Resolve" button sets the status to `Closed`, not `Resolved`. Confirm that's intended (the label says Resolve).
- [ ] The uncommitted `PHP_CLI_SERVER_WORKERS` change on this branch reduces the service to service timeouts behind the feedback 503. Land it alongside or before this spec.
