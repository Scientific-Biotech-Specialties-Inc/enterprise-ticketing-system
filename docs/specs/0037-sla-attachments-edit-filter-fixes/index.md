# 0037. Ticket SLA link persistence, private attachments, attachment message edit lock, and CS SLA filters

**Date**: 2026-11-08
**Status**: In Progress

## Summary

This spec fixes four connected defects. Tickets will always save which SLA policy applies to them (including branch category policies, which are lost today). Uploaded files move to private storage and open only for people who belong to the ticket. Chat messages that carry files can no longer be edited in any role. The CS Incoming and Assigned tabs filter SLA status on the server with one shared rule, so Breached and Paused tickets actually appear.

## Requirements

**User stories**:
- As CS staff, I want every ticket to carry its SLA policy and due dates so that breach tracking and filters are accurate.
- As a customer, I want my uploaded files visible only to people working my ticket so that my data is not exposed to the public.
- As any chat participant, I want messages with files to stay exactly as sent so that the record of what was shared cannot change.
- As CS staff, I want the Breached and Paused filters on Incoming and Assigned to show every matching ticket so that I can act on SLA risk.

**Acceptance criteria**:

*Slice A: private attachments*
- **AC-1**: `GET /storage/{path}` and `GET /download/{path}` (direct and through `/api/ticketing/attachment/...`) return **401** with no bearer token, in both `nginx.conf` and `nginx.prod.conf`. No file byte is served without passing through `AttachmentController`. `public/storage` no longer exists in attachment-service and `docker-compose.yml` no longer runs `storage:link`.
- **AC-2**: An authenticated caller who is not a participant of the file's ticket gets **404** (not 403, so the file's existence is not revealed).
- **AC-3**: A participant gets **200** with the file bytes, the stored MIME type, and headers `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`.
- **AC-4**: A pending file (`ticket_id` null, or a proof with `assignment_ID` null) returns 200 only to the user who uploaded it (matching `uploaded_by_id` and `uploaded_by_type`); everyone else gets 404.
- **AC-5**: New uploads are written to the private `attachments` disk (`storage/app/attachments`). ClamAV scanning order is unchanged (scan, then persist).
- **AC-6**: `php artisan attachments:move-to-private` moves every existing file from the public disk to the `attachments` disk with the same relative `file_path`. It skips files already moved and supports `--dry-run`, so you can rerun it safely.
- **AC-7**: Every frontend place that shows or downloads a file (`FilePreviewModal.jsx`, `EmployeeHistoryDetail.jsx` image previews, `InternalTicketMessageThread.jsx` links, `CSModals.jsx` file links, `MessagingPage.jsx` attachments) loads it through an authenticated fetch into a blob URL. None of them falls back to a bare `/storage/` URL.

*Slice B: SLA link persistence*
- **AC-8**: On every ticket creation path (`CreateTicketAction`, `TicketService::store`, `TicketService::storeInternalTicket`), the resolved SLA source is saved to its column: `branch_sla_policy_id`, `branch_priority_override_id`, `sla_rule_id`, or `sla_ID`. Exactly one is non null, together with `sla_started_at`, `response_due_at`, `resolution_due_at`, and `sla_status`. When nothing resolves, all four are null and `sla_status = 'No SLA Configured'`.
- **AC-9**: SLA recalculation (reclassify, priority change, the internal recalculate endpoint) writes the newly resolved source column and sets the other three source columns to null.
- **AC-10**: If SLA assignment throws during creation, the ticket is still created. `sla_status` is set to `'SLA Unavailable'`, and an **error** level log includes `ticket_ID` and the exception message.
- **AC-11**: `php artisan tickets:backfill-sla` selects tickets whose status is not Closed, Resolved, or Discarded and that have no source column set, no `resolution_due_at`, or `sla_status = 'SLA Unavailable'`. It resolves each one using the ticket's own `created_at`, department, category, priority, and `branch_id`, and writes the result. It runs in chunks of 200, supports `--dry-run`, and a second run changes nothing.
- **AC-12**: `GET /cs-incoming?sla_status=no_sla` returns 200 (today it queries a column that does not exist).

*Slice C: CS SLA filters*
- **AC-13**: `SLAService::computeTicketSlaMetrics` applies one precedence, used everywhere: (1) `'SLA Unavailable'` stays Unavailable; (2) **No SLA Configured** when no source column and no `resolution_due_at`; (3) **Paused** when the status is On Hold; (4) Closed or Resolved gives **Breached** if resolved after `resolution_due_at`, else **Compliant**; (5) **Breached** when now is past `resolution_due_at`; (6) **At Risk** within 4 hours of `resolution_due_at`; (7) **On Track**. The 24 hour and 48 hour heuristics for tickets with no due date are removed.
- **AC-14**: `GET /cs-incoming` accepts `scope=incoming|assigned`. Scope membership and the `sla_status` filter run in SQL, using predicates equivalent to AC-13. Results are paginated, and the response includes `total` and an `slaSummary` counted over the whole scope (ignoring the SLA filter and the page).
- **AC-15**: `CSIncoming.jsx` and `CSAssigned.jsx` send `scope`, `sla_status`, and `page` to the server and render the returned rows as they are (no browser side SLA filtering). Picking Breached or Paused shows every matching ticket in that scope across pages, and each summary card's count equals the row total you get when you click it.
- **AC-16**: Incoming keeps its scope (unassigned, pending assignment, reopened, pending reassign). Its Paused count and filter reflect only tickets in that scope, which may honestly be 0.

*Slice D: attachment message edit lock*
- **AC-17**: In `MessagingPage.jsx`, for customer, employee, and CS routes alike, a message with one or more attachments shows no Edit option. Delete behaviour is unchanged.
- **AC-18**: `PUT /tickets/{ticket_id}/messages/{message_id}` on a message with one or more attachments returns **422** `{"message": "Messages with attachments cannot be edited."}` and saves nothing. This check runs before the edit window check.

## Decision

**Chosen option**: Fix in place across all four areas. Add a `branch_sla_policy_id` FK column and flag SLA failures for a backfill. Put attachments on a private disk behind a participant check owned by ticket-service. Lock attachment messages in both the UI and the API. Move CS SLA filtering to the server with one precedence rule.

**Implementation skills**: `laravel-microservice` (`.claude/skills/laravel-microservice/`) · `react-frontend` (`.claude/skills/react-frontend/`) · `docker-runbook` (`.claude/skills/docker-runbook/`) · `api-testing` (`.claude/skills/api-testing/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch** (all changes nullable and additive, safe on a running system):

| Table (owner) | Change | Type | Notes |
|---|---|---|---|
| `tickets` (ticket-service) | add `branch_sla_policy_id` | unsigned bigint, nullable, indexed | FK to `branch_sla_policies.id`, `nullOnDelete`, placed after `branch_priority_override_id` |
| `tickets` | `sla_status` gains value `'SLA Unavailable'` | existing `string(32)` | no schema change, fits 32 chars |
| `ticket_attachments` (attachment-service) | add `uploaded_by_id` | unsigned bigint, nullable | verified caller id at upload |
| `ticket_attachments` | add `uploaded_by_type` | string(20), nullable | `customer` or `employee` |
| `proof_of_completion` (attachment-service) | add `uploaded_by_id`, `uploaded_by_type` | same as above | same rule for pending proofs |

Relationships: `tickets` N:1 `branch_sla_policies` (new), alongside the existing N:1 to `sla_rules`, `branch_priority_overrides`, and `slas`. Invariant: at most one of the four source columns is non null per ticket.

Filesystem: a new disk `attachments` in attachment-service `config/filesystems.php` (driver `local`, root `storage_path('app/attachments')`, visibility `private`, no `url`). The `public` disk stays defined only for the move command and the phase 1 read fallback.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| ticket-service `/api/internal/attachment-access` | GET | query `ticket_id` (int, opt), `assignment_id` (int, opt); header `Authorization` (caller bearer, forwarded); header `X-Internal-Token` | `{allowed: bool, user_id: int, user_type: "customer"\|"employee"}` | `X-Internal-Token` (hash_equals against `INTERNAL_TOKEN`) **and** `auth.subsystem` on the forwarded bearer | 401 caller unauthenticated, 403 bad internal token, 404 ticket or assignment not found |
| attachment-service `/storage/{path}` (web) and `/api/storage/{path}` | GET | path; bearer | file stream inline | bearer, checked through the access endpoint | 401, 404 |
| attachment-service `/download/{path}` (web and api) | GET | path; bearer | file stream as attachment | same | 401, 404 |
| attachment-service `/api/upload` | POST | existing multipart; bearer (forwarded by messaging-service and ticket-service, or sent by the SPA) | existing payload; `url` becomes `/api/ticketing/attachment/download/{file_path}` | bearer resolves the uploader | 401 when no identity can be resolved |
| ticket-service `/cs-incoming` | GET | existing filters plus `scope` (`incoming`\|`assigned`, default `incoming`), `sla_status`, `page`, `limit` | `{data: [...], total, page, per_page, slaSummary: {breached, at_risk, on_track, paused, compliant, no_sla}}` | `auth.subsystem` (unchanged) | 422 bad scope |
| messaging-service `/tickets/{ticket_id}/messages/{message_id}` | PUT | existing | existing | existing | **422** when the message has attachments |

**Value sourcing**:

| Action | Value | Source |
|---|---|---|
| assignSlaToTicket | `branch_sla_policy_id` | `resolveSlaPolicy()['branch_sla_policy_id']` (already returned, now written) |
| assignSlaToTicket | other source ids, due dates | `resolveSlaPolicy()` result plus `addBusinessHours(created_at, limits)` (unchanged) |
| creation failure | `sla_status = 'SLA Unavailable'` | set in each creation path's `catch` block by a separate `DB::table('tickets')->update` |
| backfill | department, category, priority, branch, created_at | ticket row columns: `problem_category_ID`, `priority_ID` mapped to `priority_name`, `branch_id`, `created_at`; department through the same resolver `CreateTicketAction` uses (category to department, fallback 2) |
| attachment access | caller identity | ticket-service `auth.subsystem` on the forwarded bearer (employee JWT or customer Passport) |
| attachment access | `ticket_id` of a file | `ticket_attachments.ticket_id`; for proofs, `proof_of_completion.assignment_ID`, sent as `assignment_id` and resolved to a ticket inside ticket-service |
| attachment access | is participant | new `App\Services\TicketAccessService::canView($user, $ticket)` in ticket-service, which mirrors the thread access rules in messaging-service `MessageController` (customer owns a non internal ticket; employee is the requester, assigned, or delegated; CS and superadmin always; manager when the ticket department matches) |
| attachment access | cache | attachment-service Redis key `att_access:{sha256(bearer)}:{ticket_id\|assignment_id\|none}`, TTL 60 seconds |
| pending file | uploader | `uploaded_by_id` and `uploaded_by_type`, filled at upload from the access endpoint called with no ticket |
| cs-incoming scope `incoming` | membership | the existing browser predicate in `CSIncoming.jsx` (excludes `reassignmentRequested`, assigned and accepted unless Reopened, Pending Evaluation unless Reopened), moved into SQL |
| cs-incoming scope `assigned` | membership | the existing browser predicate in `CSAssigned.jsx` (reassignment requested, status in Pending Assignment, In Progress, Pending Evaluation, Resolved, Pending, Closed, On Hold, or has an assignee), moved into SQL |
| cs-incoming | `sla_status` per row and `slaSummary` | `computeTicketSlaMetrics` (AC-13) on rows that select `sla_status`, `sla_rule_id`, `sla_ID`, `branch_sla_policy_id`, `branch_priority_override_id` (add these to the list query select) |
| message edit lock | has attachments | MongoDB message `attachments` array, `count > 0` |

**Key invariants**:
- At most one SLA source column is non null per ticket; recalculation clears the others.
- No attachment byte leaves attachment-service without a successful access check, or without being the uploader's own pending file.
- The ClamAV scan still runs before any write to the `attachments` disk.
- One SLA status rule (AC-13) is shared by the row badges, the summary cards, and the SQL filter.
- A message with attachments never changes after it is sent.
- attachment-service never reads ticket-service tables. It asks the access endpoint (AGENTS.md invariant 3).

**Security model**:
- Unauthenticated callers: 401 on every file route.
- Authenticated callers who are not participants: 404.
- Pending files: uploader only.
- The access endpoint is internal only. It needs both `X-Internal-Token` and a valid caller bearer, so a leaked internal token alone cannot enumerate access.
- Access is cached for up to 60 seconds, so losing ticket access takes up to 60 seconds to apply to files (accepted).
- Responses are `Cache-Control: private, no-store`, so shared proxies never keep a copy.
- Path traversal: keep the existing `cleanPath` normalisation and reject any path containing `..`.
- The `file_path` must match a row in `ticket_attachments` or `proof_of_completion`. Paths with no row return 404.

**Configuration required**:
- `INTERNAL_TOKEN` in attachment-service `.env` (the same value ticket-service already uses).
- `TICKET_SERVICE_URL` in attachment-service `.env` (for example `http://ticket-service:8000`).

**Critical test scenarios** (backend feature tests):
- Branch category policy match saves `branch_sla_policy_id` with due dates, and each other source type saves its own column. Verifies **AC-8**.
- Reclassify from a rule to a branch policy clears `sla_rule_id`. Verifies **AC-9**.
- A resolver that throws leaves the ticket with `'SLA Unavailable'` and an error log. Verifies **AC-10**.
- Backfill dry run changes no rows, a real run fixes them, and a rerun changes 0. Verifies **AC-11**.
- `cs-incoming?sla_status=no_sla` returns 200. Verifies **AC-12**.
- File route with no token returns 401, a non participant gets 404, a participant gets 200 with no-store headers, and a pending file opens only for its uploader. Verifies **AC-1** to **AC-4**.
- Move command dry run and rerun are idempotent. Verifies **AC-6**.
- An On Hold ticket with an SLA is Paused; an On Hold ticket with no SLA is No SLA Configured; an overdue ticket is Breached; a ticket with no due date is never Breached. Verifies **AC-13**.
- `cs-incoming?scope=assigned&sla_status=breached` returns breached tickets beyond the first 100, and `slaSummary.breached` equals `total`. Verifies **AC-14**.
- PUT on an attachment message returns 422 and leaves the message unchanged. Verifies **AC-18**.

## Build plan

Build approach: none recorded in AGENTS.md, so this assumes Tracer Bullet slices (each slice is end to end and shippable on its own). Slice A comes first because it closes a live data exposure. Slice C depends on Slice B.

**Slice A: private attachments**
1. Migration in attachment-service adding `uploaded_by_id` and `uploaded_by_type` to `ticket_attachments` and `proof_of_completion`. Satisfies **AC-4**.
2. ticket-service: add `TicketAccessService::canView` (extract the rules from messaging-service `MessageController` thread access) and `GET /api/internal/attachment-access` (internal token plus `auth.subsystem`). Satisfies **AC-2**, **AC-3**.
3. attachment-service: add the `attachments` disk. Add an `AttachmentAccessClient` that forwards the bearer and caches for 60 seconds. Add a `ResolveFileAccess` step in `serve` and `download` that looks up the row by `file_path` and returns 401 or 404 as specified. Send `Cache-Control: private, no-store` and `nosniff`. Satisfies **AC-1** to **AC-4**.
4. attachment-service `upload`: write to the `attachments` disk after the ClamAV scan, record the uploader, and return `url` as `/api/ticketing/attachment/download/{file_path}`. Update the `bind` moves and `destroy` deletes to use the `attachments` disk. Phase 1 reads try `attachments` first, then `public`. Satisfies **AC-5**.
5. `php artisan attachments:move-to-private` (`--dry-run`, `--reverse`). Satisfies **AC-6**.
6. Remove `php artisan storage:link --force` from `docker-compose.yml:508` and delete `services/attachment-service/public/storage`. Keep the `/storage/` location in both nginx files, since it still proxies to the controller, which now enforces auth. Satisfies **AC-1**.
7. Frontend: route every file view or download through the authenticated blob fetch in `FilePreviewModal`. Replace direct `<img src>` in `EmployeeHistoryDetail.jsx` and direct `href` in `InternalTicketMessageThread.jsx` and `CSModals.jsx` with that loader. Drop the bare `/storage/` fallback in `FilePreviewModal.jsx:123`. Satisfies **AC-7**.
8. Feature tests for AC-1 to AC-6.

**Slice B: SLA link persistence**
9. Migration in ticket-service adding `tickets.branch_sla_policy_id` (nullable, indexed, FK `nullOnDelete`). Satisfies **AC-8**.
10. `SLAService::assignSlaToTicket` and both recalculation methods write all four source columns, setting the unused ones to null. Satisfies **AC-8**, **AC-9**.
11. In the three creation paths, the `catch` block sets `sla_status = 'SLA Unavailable'` and logs at error level. Satisfies **AC-10**.
12. `php artisan tickets:backfill-sla` (chunked, `--dry-run`, idempotent). Satisfies **AC-11**.
13. Add `branch_sla_policy_id` and the other source columns to the list query select in `TicketDashboardService`, which fixes the `no_sla` filter crash. Satisfies **AC-12**.
14. Feature tests for AC-8 to AC-12.

**Slice C: CS SLA filters**
15. Reorder `computeTicketSlaMetrics` to the AC-13 precedence and remove the no due date heuristics, both in PHP and in the SQL filter branches of `getCsIncoming`. Satisfies **AC-13**.
16. Add `scope` to `csIncoming` and `getCsIncoming`. Move both tab predicates into SQL. Return `total`, pagination fields, and a scope wide `slaSummary`. Satisfies **AC-14**, **AC-16**.
17. Frontend: `getCSIncomingTickets` passes `scope`, `sla_status`, and `page`. `CSIncoming.jsx` and `CSAssigned.jsx` drop browser side SLA filtering and summary counting, and use the server `slaSummary` and `total`. Map the dropdown labels to `breached`, `at_risk`, `on_track`, `paused`, and `no_sla`. Keep both employee and customer dual mode builds working. Satisfies **AC-15**, **AC-16**.
18. Feature tests for AC-13 and AC-14.

**Slice D: attachment message edit lock**
19. `MessageController::update`: return 422 when `count($message->attachments) > 0`, before the edit window check. Satisfies **AC-18**.
20. `MessagingPage.jsx`: show Edit only when `isAuthor && isWithinEditWindow(msg) && !(msg.attachments?.length > 0)`. Satisfies **AC-17**.
21. Feature test for AC-18.

## Migration plan

**Strategy**: phased, with a read fallback (a small strangler: old file location still readable while files move).
**Phases**:
1. Deploy Slices A and B code and migrations. New uploads go to the private disk. Reads try private, then public. The auth check applies to both. The symlink and `storage:link` are gone, so the public root no longer exposes files.
2. Run `attachments:move-to-private --dry-run`, then for real. Run `tickets:backfill-sla --dry-run`, then for real.
3. In a later release, once the dry run reports 0 files left, remove the public disk read fallback.

**Rollback**: revert the code commit. `attachments:move-to-private --reverse` moves files back. The new columns are nullable and can stay.
**Risks**: a file missed by the move returns 404 after phase 3 (the dry run must report 0 first). Old chat messages in MongoDB store `/storage/...` URLs, but they still work because the `/storage/` route is kept, now with auth. The extra access call adds latency to each file view (a cache hit avoids it).

## Consequences

**Positive**:
- Files are no longer reachable without signing in and belonging to the ticket.
- Every ticket records which policy set its SLA, including branch category policies.
- CS filters and summary cards agree with each other and cover the whole queue, not just the first 100 rows.
- The shared chat record cannot be changed for messages that carry files.

**Negative / tradeoffs**:
- Each uncached file view costs one service to service call to ticket-service, and it fails closed: if ticket-service is down, files can't be opened.
- Removing access takes up to 60 seconds to reach files because of the cache.
- `<img>` and plain links can't open files directly anymore. Every viewer must use the blob loader, which adds frontend work and a little memory.
- Tickets with no due date stop showing heuristic Breached or At Risk. They show No SLA Configured until the backfill runs.

**Neutral**:
- Two operational commands to run once at deploy.
- `TicketAccessService` duplicates messaging-service's thread rule until messaging also calls it (see Follow-up).

## Follow-up

- [ ] attachment-service `upload`, `bind`, `index`, and `destroy` routes also have no auth middleware, and `index` returns file URLs. A separate spec should put them behind `auth.subsystem` or the internal token.
- [ ] `AttachmentController` can skip ClamAV when "malware scanning disabled by system configuration" is set, which conflicts with AGENTS.md invariant 5. Decide whether that switch should exist.
- [ ] Have messaging-service call `TicketAccessService` (through the internal endpoint) instead of keeping its own copy of the thread access rule.
- [ ] Frontend Vitest coverage for AC-7, AC-15, and AC-17 was not chosen. Consider it later.
- [ ] Related specs to check for staleness after build: 0003 (message attachments), 0004, 0006, 0007, 0017 (SLA status and visibility).
