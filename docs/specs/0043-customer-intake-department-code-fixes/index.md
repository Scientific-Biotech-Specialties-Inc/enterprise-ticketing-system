# 0043. Customer ticket intake, department codes, and queue display fixes

**Date**: 2026-11-14
**Status**: In Progress

## Summary

This spec fixes nine defects reported against the customer ticket flow, the superadmin ticket number settings, feedback, and the CS queues. The biggest change: the AI now decides a ticket's problem category on the server (customers see it read only). If the AI cannot decide, the ticket arrives unclassified and CS must classify it before assigning. Departments get their own unique, editable code that goes into new ticket numbers. Smaller fixes cover the read only serial number, ticket titles built from machine plus problem, the missing live update for submitted drafts, customer edit, multi assignee display, and a new Closed tab on My Tickets.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Requirements

**User stories**:
- As a customer, I want the serial number of the machine I pick shown automatically so that I know I picked the right unit.
- As a customer, I want a clear ticket title built from my machine and my problem so that I and support can recognize the ticket at a glance.
- As a superadmin, I want each department to get a unique code automatically, which I can edit, so that ticket numbers show which department owns them.
- As a customer, I want closed tickets in their own tab so that my active work is easy to find.
- As a CS agent, I want submitted drafts to appear live in Incoming, every assignee shown on Pending Assignment, and unclassified tickets clearly flagged, so that nothing slips past me.

**Acceptance criteria**:

*Machine, serial, and loading*
- **AC-1**: In the AI chat `TicketReviewModal` and on `/create-ticket`, a read only **Serial Number** field sits beside Machine / Equipment. It shows the selected registered machine's `serial_number`, updates when the machine changes, shows the placeholder `Select a machine` when none is selected, and is never editable or submitted.
- **AC-2**: Ticket form options (machines and problem categories) load before the AI review data is built or the create page prefill is applied. The AI modal's open action shows a `Loader2` spinner until options resolve, then opens with the machine and serial already resolved. A resolved `machine_ID` (from AI prefill, a draft, or the customer's pick) is never reset to null when categories or the classification preview finish loading. If options fail to load, the modal shows an error with a Retry action and an empty machine.

*Title*
- **AC-3**: The auto generated title is `<machine_name> - <Problem>`, where `machine_name` comes from the matched registered machine and `Problem` is, in order: the Gemini escalation `title`/`problemSummary` (cleaned of greetings and list markers), then the `IntakeTitleBuilder` symptom, then `Technical Support Request`. It never uses the customer's first chat message as the title on its own. With no machine (Software), the title is `<Problem>` only. Title Case is applied. If longer than 70 characters, the Problem part is shortened with `...` and the machine name is kept whole.
- **AC-4**: A title the customer edits by hand is kept as typed (subject to the existing proper casing prompt), and is never regenerated afterwards.

*Category decided by AI, CS fallback*
- **AC-5**: In customer surfaces (create page, AI modal, edit dialog) the problem category is read only. It shows the AI classification preview from the live active problem categories (today Software and Service), or `Pending classification` while loading or if the AI cannot decide. The hardcoded `Hardware / Software / Network / Consumables / Other` list in the AI modal is removed. The equipment requirement follows the preview: Service means a machine is required, Software means the equipment field is hidden.
- **AC-6**: On customer `POST /tickets`, ticket-service ignores any client sent `problem_category_ID` and `department_id`. It calls AI-service `POST /classify-category` itself (forwarding the customer's token, 3 second timeout) with the title, description, and live active categories, then stores the result. Timeout, error, or no confident match stores `problem_category_ID = NULL` and no department. A Software result stores `machine_ID = NULL`. A Service result with no machine is stored unclassified, so the CS gate (AC-20) collects the machine.
- **AC-7**: When the number format's department segment is on, a new ticket's number uses its department's `departments.code` (Software leads to the IT department, Service leads to the Service department). An unclassified ticket leaves out the department segment (for example `TKT-0042`). A ticket number never changes after creation, whether through reclassify or a code edit.

*Department codes*
- **AC-8**: Superadmin Ticket Config, **Prefix & Department** section: the single global department code input is removed. A departments table lists each department's name, code, and active state. The `includeDeptCode` toggle stays, and the live preview uses a department picked from the table.
- **AC-9**: **Add Department**: typing a name fills the code field with a server suggestion (debounced 300 ms). The rule is initials for multi word names (`Field Service` gives `FS`), the first 3 letters for one word (`Biomedical` gives `BIO`), uppercase letters and digits only, and a number suffix if taken (`BIO2`, `BIO3`). The superadmin may edit the code before saving. Codes must match `^[A-Z0-9_-]{2,16}$` after uppercasing.
- **AC-10**: Codes are unique ignoring case. Saving a duplicate code on create or edit is rejected with `Code SVC is already used by Service.` (client check plus server 422; a database race returns 409 with the same message). Editing a code affects only tickets created afterwards.
- **AC-11**: The migration backfills existing departments: `IT` gets `IT`, `Service` gets `SVC`, and any other department gets a code from the AC-9 rule.

*Feedback categories*
- **AC-12**: The feedback modal and the external feedback page load questions for the ticket's live problem category name. A null or unknown category loads the `Others` general set. `IT` is never used as a fallback or requested. The superadmin feedback question editor lists the live problem categories plus `Others` instead of the hardcoded `IT / Service / Others`.
- **AC-13**: A data migration renames `feedback_questions.category` from `IT` to `Software`. Submitted feedback keeps its frozen question snapshot. configuration-service no longer normalizes any category to `IT`.

*Drafts*
- **AC-14**: A ticket submitted from a draft, from either path (a draft reopened on `/create-ticket`, or a draft saved from the AI modal and submitted later), appears in CS Incoming live within 5 seconds without a manual refresh, exactly like a ticket created without a draft, and the draft is deleted after success. The build starts by reproducing both paths and recording the root cause in the PR.

*Customer edit*
- **AC-15**: In the customer edit dialog for an Open, unassigned ticket, the category is read only (AC-5). For a Software ticket the equipment field is hidden and `machine_ID` is saved as null. For a Service ticket, equipment is required and lists only the customer's registered machines.
- **AC-16**: **Save Changes** persists title, description, and machine through `PATCH /tickets/{id}`, shows a success toast, and refreshes the row from the server response. Any failure shows the server's message. The save never silently does nothing. The build starts by reproducing the current failure and recording the root cause in the PR.
- **AC-17**: On a customer `PATCH /tickets/{id}`, the server rejects with 422: a `machine_ID` not registered to the customer, any `machine_ID` on a Software ticket, a missing machine on a Service ticket, and any `problem_category_ID` change (`Only support staff can change the category.`).

*Multi assignee display*
- **AC-18**: A Pending Assignment ticket assigned to several employees shows every assignee as a chip, with an `X of N Accepted` count when N > 1. This applies in the CS Incoming row and in the ticket summary modal, read from `assigned_employees`. The optimistic update right after a multi assign shows all chosen employees. Single assignee tickets look as they do today.

*My Tickets tabs*
- **AC-19**: Customer My Tickets (`/customer-ticketing/my-tickets`) has the tabs **Active**, **Closed**, and **Drafts**, each with a count. Closed holds status `Closed` only, including closed tickets still awaiting feedback, which show a **Give Feedback** action. Active holds every other status except Discarded (Resolved stays in Active). Discarded tickets keep going to History. Each tab's status filter lists only the statuses that tab holds. Employee mode screens are unchanged.

*CS classification gate*
- **AC-20**: CS Incoming shows a `Needs Classification` badge on tickets with a null category. The Assign action is disabled, with the tooltip `Classify this ticket before assigning.`, until CS reclassifies it. Picking Service in the reclassify modal requires choosing one of the customer's registered machines if the ticket has none. Picking Software clears the machine. Reclassify sets the department but never changes the ticket number.
- **AC-21**: Every reader of `problem_category_ID` handles null: SLA resolution falls back to the default rule that does not depend on category, and dashboards, reports, and exports label it `Unclassified`. Nothing errors on a null category.

## Decision

**Chosen option**: fix in place, one spec, with the AI as the server side source of truth for category, and a per department code stored on `departments`.

The fixes stay in the existing components and services. Two structural changes ride along: `tickets.problem_category_ID` becomes nullable so unclassified tickets can exist, and `departments.code` becomes the ticket number's department segment.

**Implementation skills**: `laravel-microservice` (`.claude/skills/laravel-microservice/`) · `react-frontend` (`.claude/skills/react-frontend/`) · `gemini-ai` (`.claude/skills/gemini-ai/`)

**Decided by the architect (RECOMMEND items)**:
- Title separator is ` - ` (a spaced hyphen), not an en dash. It is plain ASCII, passes `validateProperCasing` and `rejectMarkup`, and matches the existing combine code. Runner up: an en dash.
- Code suggestions come from one server rule (`DepartmentCodeGenerator` in employee-service) behind a suggest endpoint, not a JS mirror, so there is one rule and one source of truth. Runner up: a JS copy tested against shared fixtures.
- Department endpoints live in employee-service (it owns `departments`) behind `auth.subsystem` plus a superadmin role check. ticket-service keeps reading `departments.code` from the shared table, as it reads `departments.name` today (spec 0026 shared database governance).
- Category to department mapping uses one ticket-service resolver (`CategoryDepartmentResolver`): Software goes to the IT department, Service goes to the Service department, by name, as the create page does today. A configurable mapping goes in Follow-up.
- Shared `AssigneeChips` component extracted from `CSAssigned.jsx` and reused in CS Incoming and the summary modal. No new renderer.
- Feedback question categories stay a free string in configuration-service. The frontend passes the live category names it already has from `getTicketFormOptions`, so configuration-service never queries ticket-service tables.

## Feature design

**Data model sketch**:

| Table (owner) | Change | Rule |
|---|---|---|
| `departments` (employee-service) | add `code` `string(16)` | added nullable, backfilled (AC-11), then made NOT NULL with a unique index. Stored uppercase |
| `tickets` (ticket-service) | `problem_category_ID` becomes nullable | foreign key kept, `restrictOnDelete`. NULL means Needs Classification |
| `feedback_questions` (configuration-service) | data only | `category 'IT'` becomes `'Software'` |
| number format config (ticket-service) | `deptCode` retired | `includeDeptCode` stays. Old `deptCode` values are ignored on read and dropped on the next save |

No new tables. Department names stay unique (existing index).

**State transitions** (classification):
`Unclassified (category NULL)` goes to `Classified (Software or Service)` only through CS reclassify. Assignment is allowed only from Classified. Customers cannot change category in any state.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| employee-service `/departments` | GET | none | `departments[]` with `id, name, code, is_active` | public (unchanged) | none |
| employee-service `/departments/code-suggestion` | GET | `name` (req), `exclude_id` (opt) | `{ code }` | auth.subsystem, superadmin | 422 empty name |
| employee-service `/departments` | POST | `name` (req), `code` (opt; generated if absent), `description` | created department | auth.subsystem, superadmin | 409 race duplicate, 422 duplicate or invalid code or name |
| employee-service `/departments/{id}` | PUT | `name`, `code`, `is_active` | updated department | auth.subsystem, superadmin | 404, 409, 422 |
| ticket-service `/tickets` | POST | as today. `problem_category_ID` and `department_id` ignored for customers | ticket with `ticket_number`, `problem_category_ID` (nullable) | customer token | 422 machine not owned, 422 limit |
| ticket-service `/tickets/{id}` | PATCH | `title`, `description`, `machine_ID` | updated ticket | customer token (owner) or staff | 403 not owner, 422 per AC-17 |
| ticket-service `/tickets/{id}/classification` | PATCH | `problem_category_ID` (req), `machine_ID` (req when Service and ticket has none), `priority_ID` | updated ticket, `department_id` | CS or admin | 422 machine missing or not owned by ticket's customer, 422 closed |
| ticket-service `/superadmin/number-format` | GET, PUT | `prefix`, `includeDeptCode`, `dateSegment`, `digitLength` (no `deptCode`) | config | superadmin | 422 |
| AI-service `/classify-category` | POST | `title`, `description`, `categories[]` | `{ category_id, confidence }` | forwarded customer token | timeout leads to unclassified |
| configuration-service `/feedback-questions/category/{category}` | GET | any category name | questions, or the `Others` set if none | as today | none |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Serial field (AC-1) | serial number | `machines.serial_number` of the selected `machine_ID`, from `getTicketFormOptions().machines` |
| Title (AC-3) | machine name | matched registered machine's `machine_name` (`resolveRegisteredMachine`) |
| Title (AC-3) | problem | Gemini `escalation_data.title`/`problemSummary`, else `IntakeTitleBuilder`, else the literal fallback |
| Category preview (AC-5) | category name | AI-service `/classify-category` with `getTicketFormOptions().problem_categories` |
| Create (AC-6) | stored category | server call to `/classify-category`. Confidence below 0.6 counts as no match |
| Create (AC-6, AC-7) | department | `CategoryDepartmentResolver(category)`. NULL when unclassified |
| Ticket number (AC-7) | department code | `departments.code` of the resolved department, read at creation |
| Code suggestion (AC-9) | code | `DepartmentCodeGenerator(name, existing codes in departments)` |
| Feedback (AC-12) | question set key | ticket's `category_name` from the ticket payload, else `Others` |
| Incoming badge (AC-20) | Needs Classification | `tickets.problem_category_ID IS NULL` |
| Reclassify machine list (AC-20) | machines | `machines WHERE client_ID = ticket.client_ID` (from the ticket detail payload) |
| Assignee chips (AC-18) | names, accepted state | `assigned_employees[].name`, `.assignment_status` on the ticket list and detail payloads |
| Tab counts (AC-19) | counts | client side counts of the loaded customer ticket list per tab rule |

**Key invariants**:
- Customers can never set or change `problem_category_ID` (create or edit). Only the server classifier or CS reclassify writes it.
- Software tickets have `machine_ID = NULL`. Classified Service tickets have a `machine_ID` owned by the ticket's customer.
- No ticket in `Unclassified` can be assigned (enforced in the assign endpoint, not only the UI).
- `departments.code` is unique ignoring case (unique index on the uppercased value).
- A ticket number is immutable after creation.
- Ticket cache invalidation after reclassify keeps using `clearTicketCaches()` with `SCAN` chunking. Every create and reclassify still dispatches `TicketChanged`.

**Security model**:
- Department create and edit: superadmin only (role check in employee-service, behind `auth.subsystem`).
- Classification: the server call forwards the customer's own token (spec 0034 pattern). Customer supplied category and department are ignored on create and rejected on edit.
- Machine ownership is checked on create (existing), on customer edit (new), and on reclassify against the ticket's customer (new). This closes the update path that today accepts any `machine_ID`.
- No new PII. No change to RSA or credential handling.

**Configuration required**: none. AI-service URL and internal settings already exist in ticket-service.

**Critical test scenarios**:
- Happy path: the customer picks a machine in the AI modal, the serial appears, the title reads `Mindray BC-5390 - Results Not Reaching LIS`, submit stores the Service category and `TKT-SVC-0043`, and CS Incoming shows it live. Verifies **AC-1**, **AC-3**, **AC-6**, **AC-7**
- Loading race: the AI modal is opened while options are still loading. The machine stays resolved after the categories load. Verifies **AC-2**
- Classifier timeout: the ticket is created unclassified with number `TKT-0044`, CS sees the badge, Assign is disabled (server returns 422 if called directly), and reclassify to Service requires a machine. Verifies **AC-6**, **AC-7**, **AC-20**
- Duplicate code: two superadmins save `BIO` at the same time; one wins, the other gets 409 with the friendly message. Verifies **AC-10**
- Customer edit: a Software ticket save drops the machine. A PATCH with someone else's machine returns 422. A PATCH with `problem_category_ID` returns 422. Verifies **AC-15**, **AC-17**
- Draft submit from each path appears live in Incoming. Verifies **AC-14**
- Feedback on a Software ticket loads the Software questions (formerly IT). A null category loads `Others`. Verifies **AC-12**, **AC-13**
- Closed ticket awaiting feedback appears under Closed with Give Feedback. A Resolved ticket stays under Active. Verifies **AC-19**
- Null category in SLA, dashboards, and reports renders `Unclassified` without errors. Verifies **AC-21**

## Build plan

Build approach: none recorded in `AGENTS.md` or a scope file, so this assumes end to end Tracer Bullet slices. Each slice ships one user visible fix through every layer it touches.

1. Slice A, reproduce first: reproduce the draft live update gap (both paths) and the customer Save Changes failure. Record each root cause in the PR description before fixing. Satisfies **AC-14**, **AC-16**
2. Slice B, customer form loading and serial: load options before building review data and prefill, guard the effects so a resolved `machine_ID` is never overwritten, add the read only Serial Number field to `TicketReviewModal` and `TicketCreation.jsx`. Satisfies **AC-1**, **AC-2**
3. Slice C, title: rebuild `generateRealReviewData` title logic as `<machine_name> - <Problem>` with the fallback order. Keep manual edits. Unit tests for each fallback and for truncation. Satisfies **AC-3**, **AC-4**
4. Slice D, migration: make `tickets.problem_category_ID` nullable. Audit every reader (SLA service, dashboards, reports, exports, customer and CS pages) and add null handling and `Unclassified` labels. Satisfies **AC-21**
5. Slice E, server classification: `CategoryDepartmentResolver`. `POST /tickets` ignores client category and department, calls `/classify-category` (3s timeout, 0.6 confidence), and applies the Software and Service machine rules. Customer surfaces show the read only preview and drop the hardcoded category list. Satisfies **AC-5**, **AC-6**
6. Slice F, CS gate: `Needs Classification` badge, Assign disabled in the UI, and a server side 422 on assign while unclassified. Reclassify accepts and requires `machine_ID` for Service, checks ownership, clears it for Software, sets the department, and dispatches `TicketChanged`. Satisfies **AC-20**
7. Slice G, department codes backend: employee-service migration (add nullable `code`, backfill per AC-11, then NOT NULL and unique), `DepartmentCodeGenerator`, suggestion, create, and update endpoints. Satisfies **AC-9**, **AC-10**, **AC-11**
8. Slice H, ticket numbers: `TicketNumberGeneratorService` takes the department code from `departments.code` via the resolved department. Remove the hardcoded IT and SVC mapping from `CreateTicketAction` and `TicketService`. Leave out the segment when unclassified. Retire `deptCode` from number format validation and storage. Satisfies **AC-7**
9. Slice I, Prefix & Department UI: departments table, Add Department with debounced suggestion, inline code edit, duplicate messages, preview from the selected department. Satisfies **AC-8**, **AC-9**, **AC-10**
10. Slice J, feedback: data migration `IT` to `Software`, remove `IT` normalization and defaults in `FeedbackQuestionController`, remove the `'IT'` fallbacks in `FeedbackModal.jsx` and `ExternalFeedbackPage.jsx`, and drive the editor list from live categories plus `Others`. Satisfies **AC-12**, **AC-13**
11. Slice K, customer edit: read only category, Software hides and clears equipment, Service requires an owned machine. Server side PATCH rules for customers. Fix the Save Changes root cause from step 1. Satisfies **AC-15**, **AC-16**, **AC-17**
12. Slice L, drafts: fix the root cause from step 1 so both draft paths broadcast `created` and show live in Incoming. Satisfies **AC-14**
13. Slice M, multi assignee: extract `AssigneeChips` from `CSAssigned.jsx`, use it in the CS Incoming row and the summary modal, and make the optimistic multi assign update carry every chosen employee. Satisfies **AC-18**
14. Slice N, My Tickets tabs: rename All Tickets to Active, add Closed, add per tab counts and per tab status filters, and add Give Feedback on closed tickets awaiting feedback. Satisfies **AC-19**

## Consequences

**Positive**:
- Category is now trustworthy: customers cannot pick or tamper with it, so routing, SLA, and department codes rest on one source.
- Ticket numbers carry a real per department code with guaranteed uniqueness, set up without editing code.
- The update path's missing machine ownership check is closed.

**Negative / tradeoffs**:
- Ticket creation now depends on an AI-service call. Slow or failed calls add up to 3 seconds and produce unclassified tickets, which adds CS work.
- A nullable category ripples into every reader (SLA, analytics, exports). Slice D must be thorough or reports break.
- Customers lose the ability to correct a wrong AI category. They must ask CS.
- Ticket numbers become mixed in format (with and without a department segment), which some customers may find inconsistent.

**Neutral**:
- Three migrations across three services (employee, ticket, configuration). The department code uses the safe sequence: add nullable, backfill, then constrain.
- The global `deptCode` setting disappears from the superadmin UI.
- Category to department mapping stays name based for now.

## Migration plan

**Strategy**: no feature flag. Each migration is additive or a safe sequence.
**Phases**:
1. employee-service: add nullable `departments.code`, backfill (IT gets IT, Service gets SVC, others generated), then add NOT NULL and the unique index.
2. ticket-service: make `tickets.problem_category_ID` nullable (deploy the null safe readers from Slice D in the same release).
3. configuration-service: update `feedback_questions` from `IT` to `Software`.
**Rollback**: phase 1 down drops the column (numbers already issued keep their text). Phase 2 down is only safe if no NULL rows exist. The down migration first sets NULLs to the Service category and logs the count. Phase 3 down renames `Software` back to `IT`.
**Risks**: a department name that produces an empty code (all symbols) falls back to `DEPT` plus a suffix. Unclassified tickets created before rollback need CS attention.

## Follow-up

- [ ] Replace the name based `CategoryDepartmentResolver` with a superadmin configured category to department mapping if more categories or departments are added.
- [ ] Decide whether an AI classification confidence threshold of 0.6 needs tuning after a week of real data (track the unclassified rate).
- [ ] The editor showed `docs/specs/0042-customer-equipment-contract-integration/index.md`, which does not exist on any branch. If it is in progress elsewhere, check it does not conflict with the machine and category rules here. This spec took 0043 to avoid a number clash.
- [ ] Spec 0041 exists only on `fix/security-hardening-and-category-cleanup` (not on `dev`). Make sure it gets merged so numbering stays consistent.
