# 0038. Rationale: Ticket Modal, Dashboard, And AI Escalation Defect Fixes

## Context

You reported nine defects across the customer portal (port 5006) and the employee portal (`/ticketing/`). They touch the AI escalation flow, the shared ticket modal components, two dashboards, messaging, and the employee ticket update page. Each was traced to its root cause in the current code and, where useful, checked against the live database.

The most serious defect is data integrity. AI escalated tickets can be linked to a machine the customer never reported, or labelled with free text typed by the customer. Ticket `INC-OPS-202611-00003` shows both problems. The customer reported a Mindray BC-5390 (`SN-TEST-00417`), which is not registered to them. The ticket is linked to machine 2, a Philips VS-900 bedside monitor. The description reads `Machine: it doesnt solve it! ...`. The technician then sees the Philips monitor on the ticket update page, which looks like mock data.

Spec 0012 requires a machine for Service (hardware) tickets and makes it optional for IT. Spec 0037 moved attachments to a private disk that answers only bearer token requests. Both constrain the fixes here.

### Root cause inventory

| # | Defect | Root cause |
|---|---|---|
| 1 | Machine shows the customer's words | `AISupportPage.jsx` `generateRealReviewData`: when no catalog match is found, it uses `userMsgs[1] + userMsgs[0]` (if short) as the machine name. If that fails, it falls back to `ticketOptions.machines[0]`. The brand only match picks any machine of that brand. `handleCreateTicket` then fuzzy matches with loose `includes`. The review modal input is free text. |
| 2 | One assignee shown | The backend already returns `assigned_employees[]` (ticket 3 has employees 4 and 1093 active). `getAssigneeInfo` in `ticketModalUtils.js` reads only index 0. `TicketReminderController` reminds one employee, with a cooldown on `tickets.last_reminder_sent_at` (per ticket). |
| 3 | Customer dashboard misses tickets | `TicketDashboardService::getCustomerDashboard` counts only status names that literally equal `open`, `in_progress`, `resolved`, `closed`. Customer 3's tickets are `Escalated`, `Pending Evaluation`, `Pending Assignment`, so all count as zero. The recent list joins `ticket_assignments` without dedup, so multi assignee tickets repeat. Counts are cached for 60 seconds. |
| 4 | Customer image "Unauthenticated" | `MessagingPage.jsx` renders `<img src={fileUrl}>`. A browser image request carries no bearer token, so the private file route returns 401. `AuthenticatedImage` already exists (spec 0037) but isn't used here. |
| 5 | "Asset ID" label | Label in `FieldGrid.jsx`. The value is already `serial_number`. |
| 6 | Message button does nothing | Both modals pick the route by testing `window.location.pathname.startsWith('/cs-manager')` and similar. The employee app runs under the `/ticketing` basename, so the real path is `/ticketing/cs-manager/...` and no test matches. Managers and employees are sent to the wrong portal route, and the role guard bounces them. The customer modal's `/cs` and `/employee` checks have the same flaw. The CS path looks correct statically, so a browser repro is required to confirm whether there's a second cause. |
| 7 | Immediate action too broad | `EmployeeDashboard.jsx` includes `needsAccept` and `status === 'Escalated'` in addition to SLA breached or at risk. |
| 8 | Machine card looks fake | The card reads the real `customer-context` endpoint, but the ticket links the wrong machine (defect 1). When the request fails, the panel invents `Customer Site`, `—`, and `Asset`. |
| 9 | Work log reloads page | After save, `loadTicketData()` calls `setLoading(true)`, so the page swaps to skeletons. The 30 second poll and realtime refresh do the same. The merge `{ ...details, ...prev }` lets stale local state override fresh server data. |

### Added items (same day update)

| # | Defect | Root cause |
|---|---|---|
| 10 | Employee Pending and On Hold don't save | `EmployeeAssignmentController::employeeUpdate` validates `status` with `in:In Progress,Pending,Resolved,Pending Assignment,Pending Evaluation,Closed,Open`. `On Hold` is missing, so the request is rejected even though the page offers it. `Pending` passes validation, and the live matrix allows `In Progress (Employee-owned)` to `On Hold/Pending`, so its cause is not visible statically. No employee status change to Pending or On Hold exists in `ticket_audit_logs`, so the save never lands. A browser repro is required. The page also merges stale state over fresh data (defect 9), which can make a successful save look like it reverted. |
| 11 | CS hold returns to In Progress | `TicketStateMachine::resolveTargetState('resume')` uses `held_from_status_ID` only for `Pending Assignment`. Every other hold resumes to `In Progress` (status 2), so a held `Pending Evaluation` ticket loses its proof review state. |
| 12 | Approve without viewing proof | The CS modal's "Approve & Resolve" is always enabled, and the backend accepts the move from `Pending Evaluation` with no evidence that the proof was opened. |
| 13 | Feedback 503, nothing shown | analytics `FeedbackController` verifies ownership by calling ticket-service `GET /api/tickets/{id}` with a 3 second timeout. That detail endpoint calls attachment-service with up to a 5 second wait, so the analytics logs show `cURL error 28 ... 3001 milliseconds`, and the result is a 503. The detail payload also has no `client_ID`, so ownership would fail next with 404. No feedback row was ever saved (`customer_feedback` count is 0), which is why CS and employees see nothing. The single threaded `artisan serve` (fixed by the uncommitted `PHP_CLI_SERVER_WORKERS` change) makes service to service calls slower still. |

For item 10, you chose to let the superadmin transition matrix decide, with a clear message when a move is blocked. For item 11, resume restores the held status. For item 12, you chose backend enforcement: a recorded view per proof file per user, so the rule can't be bypassed by a direct API call and it leaves an audit trail. For item 13, you chose a lightweight ownership endpoint. It removes the slow attachment call from the check entirely, instead of just waiting longer.

## Options considered

### Option 1: Fix each defect in place

Targeted changes in the components and endpoints that own each defect. One additive column for per assignee reminders.

**Pros**:
- Smallest blast radius. Each fix can ship and be reverted on its own.
- Reuses existing pieces (`assigned_employees[]`, `AuthenticatedImage`, `evaluateSlaRisk`, the reminder endpoint).

**Cons**:
- Leaves some broader smells untouched (the large `CSModals.jsx`, duplicated portal detection elsewhere in the app).

### Option 2: Rebuild the shared ticket modal and the AI escalation review as new components

Replace `TicketSummary`, `CustomerTicketDetailModal`, and `TicketReviewModal` with a unified modal that natively supports multiple assignees, portal aware navigation, and catalog only machine selection.

**Pros**:
- Removes duplication between the CS and customer modals.
- A cleaner home for future features.

**Cons**:
- A big bang rewrite of the most used screens to fix defects. It risks regressions in flows that work today (escalation, reassignment, hold, reclassify).
- Much longer time to fix urgent data integrity issues.

### Option 3: Server side machine resolution in the AI service

Move machine matching into `AI-service` (Gemini returns a `machine_ID` chosen from the customer's machines, passed in the prompt), with the frontend only displaying it.

**Pros**:
- One authoritative matcher. Better at fuzzy descriptions.

**Cons**:
- The AI service would need the customer's machine list, which means a new call into ticket-service data, and it adds latency and model nondeterminism to a value that must be exact.
- Still needs the customer pick fallback and the backend ownership check anyway.

## Rationale

Option 1 fits because every defect has a clear, local root cause, and most of the needed infrastructure already exists. The data already supports multiple assignees and private images. The frontend just isn't using it. Rebuilding the modals (Option 2) would delay the integrity fix and put working escalation and reassignment flows at risk for no defect level gain.

For machine linking, you set the rule: the machine must only come from the customer's own machines. A deterministic match on serial, model, or name (in that order) is exact and explainable. When it fails, asking the customer to pick from their list is safer than any guess. Option 3's model driven matching would add nondeterminism exactly where you need exactness. The backend ownership check (AC-5) is required no matter which frontend path is used, because the frontend is not a trust boundary.

For reminders, you chose a row per person. A per assignment cooldown column is the smallest correct model: the cooldown belongs to the person reminded, not the ticket. The ticket level column keeps being written so existing readers don't break, and `employee_id` stays optional so old callers keep working. For the customer dashboard, you chose the customer view mapping. It guarantees every active ticket lands in exactly one card without exposing internal state names as separate cards.
