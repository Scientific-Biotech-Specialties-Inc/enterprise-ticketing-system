# 0037. Rationale

## Context

Four defects were reported together, and code reading shows they are linked.

- **SLA link lost.** `SLAService::resolveSlaPolicy` returns `branch_sla_policy_id` when a branch category policy matches, but `tickets` has no such column and `assignSlaToTicket` never writes it. So a ticket governed by a branch policy looks like it has no source. SLA assignment runs after the insert, in a `try/catch` that only logs a warning, so any failure silently leaves a ticket with no due dates. The CS `no_sla` filter queries `t.branch_sla_policy_id`, which fails because the column doesn't exist.
- **Files public.** attachment-service writes to the `public` disk. `docker-compose.yml` runs `storage:link --force`, and the service runs under `artisan serve`, which serves anything under `public/` directly without going through Laravel. The `/storage/{path}` and `/download/{path}` routes have no auth middleware, and both nginx configs proxy `/storage/` straight through. Anyone who knows or guesses a path can fetch a customer file.
- **Attachment messages editable.** `MessagingPage.jsx` is the single chat screen used by customer, employee, and CS routes. It offers Edit for any authored message inside the 15 minute window, and `MessageController::update` has no attachment check.
- **Breached and Paused filters empty.** The dropdown options exist, but rows rarely match. `computeTicketSlaMetrics` returns No SLA Configured before it checks On Hold. Breached depends on `resolution_due_at`, which is missing whenever the SLA write failed. Incoming hides assigned tickets, and On Hold tickets are nearly always assigned. Assigned loads only 100 rows from `/cs-incoming` and filters them in the browser, using a different rule than the summary cards.

Constraints: no service may read another's tables (AGENTS.md invariant 3). ClamAV must run before persistence (invariant 5). The frontend must keep both employee and customer modes working.

## Options considered

### SLA link storage
- **FK column per source (chosen).** It matches the existing `sla_rule_id` and `branch_priority_override_id` pattern. Pro: one additive nullable migration, real FK integrity. Con: four columns where one link would do.
- **Polymorphic `sla_source_type` plus `sla_source_id`.** Pro: one link. Con: no FK integrity, and every reader and dashboard query must change.
- **Due dates only.** Pro: no schema change. Con: you can't trace or recalculate which policy applied.

### SLA failure handling
- **Keep the ticket and flag it `SLA Unavailable` (chosen).** Pro: a customer never loses a ticket, and the backfill repairs it. Con: tickets can briefly exist without due dates.
- **One atomic transaction that fails the create.** Pro: never inconsistent. Con: a resolver bug blocks every ticket creation.

### Attachment access
- **Private disk plus an internal access endpoint in ticket-service (chosen).** Pro: ticket-service already owns tickets and verifies both token types, so the rule lives in one place. Con: one extra call per uncached view.
- **Forward the JWT to the ticket detail endpoint.** Pro: no new endpoint. Con: a heavy payload for a yes or no answer, and it ties file access to how the detail endpoint behaves.
- **Signed temporary URLs.** Pro: they work in a plain `<img>`. Con: anyone holding a leaked link can open the file until it expires, and the frontend already has a blob loader with a bearer token.
- **Role claims only.** Pro: cheap. Con: it can't check assignment or delegation.

### Edit lock
- **Lock any message with files (chosen).** Pro: simple and predictable, enforced in the UI and the API. Con: you can't fix a typo in a file's caption.
- **Caption only editable.** Pro: more flexible. Con: two edit modes to build and test.

### CS filtering
- **Server side with scope (chosen).** Pro: correct across pages, and one rule for cards and rows. Con: moves the tab predicates from JS into SQL.
- **Raise the limit or load all pages.** Pro: small change. Con: still wrong past the limit, or slow for big queues.

## Rationale

All four fixes are fixed in place. Each defect is a gap in an existing working path, not a design that needs replacing, so a rewrite would add risk without benefit.

The SLA column follows the pattern the table already uses, so dashboards and the existing `whereNull` checks just work. Flagging instead of failing protects customer ticket creation, which matters more than a perfect SLA write. The backfill closes the gap for old and failed tickets.

For files, ticket-service is the only service that both owns ticket participation and can verify employee JWTs and customer Passport tokens. Asking it through an internal endpoint respects the no direct DB rule, and needing the caller's bearer as well as the internal token keeps that endpoint from becoming an oracle (something anyone could query to find out who can see what). Returning 404 to non participants avoids confirming that a file exists. A 60 second cache keeps chat image loads cheap, at the cost of a short delay when access is revoked. Signed URLs were rejected because the frontend already fetches blobs with a bearer token, so their one advantage doesn't apply here.

For the filters, the real bug is two rules (browser and SQL) applied to partial data. One precedence used everywhere, run in SQL over the whole scope, makes the cards and rows agree by construction. Putting No SLA before Paused is honest: there is no clock to pause. After the backfill that case becomes rare. Incoming keeps its meaning, so Paused there can truthfully be 0, and Paused tickets show in Assigned.
