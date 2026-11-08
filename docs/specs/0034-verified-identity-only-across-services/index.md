# 0034. Verified identity only across backend services

**Date**: 2026-11-06
**Status**: In Progress
**Mode**: ENHANCEMENT
**Related**: 0021 (security hardening), 0033 (customer auth and token hardening), 0032 (defect remediation)

## Summary

Several backend services decide who is calling by reading an id, role or name that the browser sends, instead of reading it from the verified login token. Anyone can change those values by hand, so a customer could read another customer's drafts, rate a ticket they do not own, or read someone else's AI chats. This decision makes the verified token the only source of identity in every service, closes the routes that had no login check at all, and then removes the identity headers from the frontend. Customer and employee screens keep working because they already send the token.

## Requirements

**User stories**:
- As a customer, I want my drafts, feedback and AI chats to be reachable only by me so that nobody can read or change them by guessing an id.
- As a security engineer, I want every service to take identity from the verified token only so that a changed header or body field can never grant access or a role.
- As a CS agent or admin, I want reminders and feedback reads to work from my real role so that my daily work does not change.

**Acceptance criteria** (the contract, each one is checkable on its own):
- **AC-1**: Every ticket draft route (save, list, get, delete) requires a valid token. A request with no token or a bad token returns 401. The draft owner id comes only from the verified user.
- **AC-2**: A customer asking for another customer's draft gets 404, even when the request carries `X-Client-Id`, `X-User-Id` or a body id for the other customer. A staff token on a draft route gets 403.
- **AC-3**: No service builds identity by decoding a token by hand or by looking up a token record by its id. Only `AuthenticateSubsystem` (or the local Passport guard it wraps) establishes the user.
- **AC-4**: Every feedback route requires a valid token. The customer id saved on feedback is the verified user id. A `customer_id` in the body is ignored.
- **AC-5**: A customer can create feedback only for their own ticket, and only when it is Resolved or Closed. The ownership check always runs. If the ticket lookup fails, the request is refused with 503, never skipped.
- **AC-6**: Feedback read is allowed for the owner and for staff. Another customer gets 404. Update is allowed for the owner inside the existing 48 hour window. Delete is allowed for admin and superadmin only, with no time window. A customer delete returns 403.
- **AC-7**: `csat-stats` and `predictive-metrics` require a valid staff token. A customer token gets 403.
- **AC-8**: Ticket reminders take the sender id and role from the verified user. A customer who sends `X-User-Role: admin` gets 403. There is no default sender id.
- **AC-9**: Message update and delete ignore `X-User-Id`, `X-User-Type`, `X-User-Name` and body `user_id`. With no token they return 401.
- **AC-10**: AI service chat, classify, conversation, escalate handoff and ticket link routes require either a valid token or a valid `X-Internal-Token`. A token caller cannot pick the owner with `user_id`. Customer A asking for customer B's conversation gets 404.
- **AC-11**: The frontend no longer sends `X-Client-Id`, `X-User-Id` or `X-User-Role`. Creating a ticket, drafts, feedback, messaging, reminders and AI chat still work in both customer mode and employee mode.
- **AC-12**: The customer portal no longer shows a delete feedback action. The customer `user` object in sessionStorage keeps its email (no code change, decision recorded).
- **AC-13**: Each changed service has automated tests with two users that prove AC-2, AC-6, AC-8, AC-9 and AC-10, plus a guard test that fails if controllers read the banned identity inputs again.

## Decision

**Chosen option**: Option 1: Token only identity, enforced in each service with a small shared pattern.

Each service reads who is calling from the verified user that `AuthenticateSubsystem` sets, through one small helper (a trait named `ResolvesVerifiedPrincipal`) that returns id, type (customer or staff) and role. Controllers never read client supplied identity again.

**Rules that apply everywhere**:
- Banned identity inputs: headers `X-Client-Id`, `X-User-Id`, `X-User-ID`, `X-User-Role`, `X-User-Type`, `X-User-Name`; body or query keys `user_id`, `client_id`, `customer_id`, `emp_id`, `sender_id`, `created_by`, `user_role`; hand decoded tokens; token record lookups by id.
- One trusted exception: a call that carries a valid `X-Internal-Token` (compared with `hash_equals` against `INTERNAL_TOKEN`) may name the user in the body. Only the AI service uses this today, and it stays limited to that service.
- Principal type is staff when the verified user has an `emp_id`, otherwise customer. This is the split the draft code already uses. Confirm against the middleware at build time.
- Someone else's record is always reported as 404, not 403, so ids cannot be probed. Wrong role on a route stays 403.

## Design

**What changes per endpoint**:

| Service | Endpoint | Auth after change | Identity source | Key errors |
|---|---|---|---|---|
| ticket-service | POST `/tickets/draft`, GET `/tickets/drafts`, GET and DELETE `/tickets/drafts/{id}` | `auth.subsystem`, customer only | verified user id | 401, 403 staff, 404 not yours |
| ticket-service | POST `/tickets/{id}/reminders` and `/reminder` | `auth.subsystem` (already expected), CS, admin, superadmin | verified user role and `emp_id` | 401, 403, 422 |
| analytics-service | POST `/feedback` | new `AuthenticateSubsystem`, customer only | verified user id, ticket owner from ticket-service | 401, 403, 404, 422, 503 |
| analytics-service | GET `/feedback/ticket/{id}` | same, owner or staff | verified user | 401, 404 |
| analytics-service | PUT `/feedback/ticket/{id}` | same, owner only, 48 hours | verified user id | 401, 404, 422 |
| analytics-service | DELETE `/feedback/ticket/{id}` | same, admin or superadmin | verified role | 401, 403, 404 |
| analytics-service | GET `/csat-stats`, `/predictive-metrics` | same, staff only | verified user type | 401, 403 |
| messaging-service | PUT and DELETE `/tickets/{id}/messages/{messageId}` | `auth.subsystem` (already), fallback removed | verified user | 401 |
| AI-service | `/chat`, `/classify-department`, `/conversations*`, `/escalate-handoff*`, `/tickets` | token or `X-Internal-Token` | verified user id, or body `user_id` for internal calls | 401, 404 |

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| Save, list, get, delete draft | draft owner id | verified user id, customer principal only |
| Create feedback | `customer_id` stored | verified user id |
| Create, update, read feedback | ticket owner for the ownership check | ticket-service ticket record (`client_ID`), read by ticket id |
| Create feedback | ticket status gate (Resolved or Closed) | ticket-service ticket record |
| Update feedback | 48 hour window | `created_at` on the feedback row |
| Send reminder | sender id and role | verified user `emp_id` and role |
| AI chat | conversation owner | verified user id, or body `user_id` when `X-Internal-Token` is valid |
| Staff only routes | staff or customer | verified user has `emp_id` |

**Key invariants**:
- A controller never reads a banned identity input (see Decision). A guard test enforces this per service.
- A request that cannot be authenticated is stopped before any controller code runs.
- Failing to reach ticket-service during a feedback check refuses the request. It never skips the check.

**Security model**:
- Customers act only on their own drafts, feedback and AI conversations.
- Staff read feedback and stats. Admin and superadmin delete feedback. CS, admin and superadmin send reminders.
- Passwords stay protected by the client side RSA rule from 0033 and the repository standards. This decision adds no new secrets. `INTERNAL_TOKEN` already exists in the AI service.

**Configuration required**:
- analytics-service: the shared public key at `storage/oauth-public.key` and the same JWT verification settings the ticket service uses (copy `AuthenticateSubsystem` and `VerifyEmployeeJwt`, register the `auth.subsystem` alias).
- Gateways: confirm `Authorization` and `Cookie` are forwarded to the analytics and AI upstreams in both `nginx.conf` and `nginx.prod.conf`.

**Critical test scenarios** (each maps to an acceptance criterion):
- Happy path: customer saves, lists and deletes own draft with only a token, verifies **AC-1**.
- Auth: customer A sends `X-Client-Id` of customer B and gets 404 on B's draft, verifies **AC-2**.
- Auth: a forged unsigned JWT and a `"1|anything"` bearer both return 401 on drafts, verifies **AC-3**.
- Happy path: customer creates feedback for own Resolved ticket, verifies **AC-4**, **AC-5**.
- Failure case: ticket-service is down during feedback create, gets 503 and nothing saved, verifies **AC-5**.
- Auth: customer B reads, edits or deletes A's feedback and gets 404, a customer delete gets 403, admin delete succeeds, verifies **AC-6**.
- Auth: customer token on `csat-stats` gets 403, verifies **AC-7**.
- Auth: customer sends `X-User-Role: admin` to the reminder route and gets 403, verifies **AC-8**.
- Auth: message edit with only `X-User-Id` and no token gets 401, verifies **AC-9**.
- Auth: AI `/conversations/{id}` with another user's `user_id` returns 404, an internal token call still works, verifies **AC-10**.
- Regression: the guard test fails when a controller reads `X-User-Id`, verifies **AC-13**.

## Build plan

Approach: no build approach is recorded in `AGENTS.md`, so this uses thin end to end slices (Tracer Bullet): the first slice proves the pattern on the worst hole, later slices repeat it, and the frontend change goes last so nothing is cut off early.

1. Inventory callers: list every caller of the draft, feedback, stats, reminder and AI routes (frontend, other services, schedulers) and note any that send no token, satisfies **AC-1**, **AC-4**, **AC-10**
2. Tracer slice in ticket-service: add `ResolvesVerifiedPrincipal`, move the four draft routes into `auth.subsystem`, rewrite `resolveClientId` to use the verified user only (delete the body, header, hand decoded JWT and token id lookups), customer only with 403 for staff, 404 for others, plus tests, satisfies **AC-1**, **AC-2**, **AC-3**
3. analytics-service: add `AuthenticateSubsystem` and `VerifyEmployeeJwt`, register the alias, protect all feedback and stats routes, rewrite store, update, delete and read rules, fail closed on ticket lookup errors, plus tests, satisfies **AC-4**, **AC-5**, **AC-6**, **AC-7**
4. ticket-service reminders: read role and `emp_id` from the verified user, remove the header, `user_role`, `emp_id`, `sender_id` inputs and the default of 1, plus tests, satisfies **AC-8**
5. messaging-service: remove the `X-User-Id`, `X-User-Type`, `X-User-Name` and `user_id` fallbacks in update and destroy, plus tests, satisfies **AC-9**
6. AI-service: put the routes behind token or `X-Internal-Token`, remove the `user_id` fallbacks (including the ones after an authenticated user at the conversation endpoints), plus tests, satisfies **AC-10**
7. Guard test per changed service that scans `app/Http` for the banned inputs, with an allowlist for outbound calls such as `TicketConfigurationService`, satisfies **AC-13**
8. Frontend: remove the `X-Client-Id` and `X-User-Id` block and `getStoredClientId` from `ticketService.js`, remove `X-User-Role` from `configurationService.js`, hide the customer delete feedback action in `TicketFeedbackSection.jsx`, update frontend tests, run both customer and employee modes, satisfies **AC-11**, **AC-12**
9. Gateway parity check in `nginx.conf` and `nginx.prod.conf` for the `Authorization` and `Cookie` headers on the analytics and AI routes, satisfies **AC-4**, **AC-10**

## Migration plan

**Strategy**: no data migration. Deploy backend slices first (steps 2 to 7), then the frontend (step 8). The frontend already sends the token, so it keeps working while the backend ignores the headers.
**Phases**:
1. Services one at a time, each with its tests green before the next.
2. Frontend header removal and the delete feedback change.
3. Gateway check, then a manual run as a customer and as an employee.
**Rollback**: revert the commit for the service that misbehaves. No schema change is involved.
**Risks**:
- An unknown caller with no token (a scheduler, an ETL job, another service) starts getting 401. Step 1 finds these before enforcement. Internal callers can use `X-Internal-Token` only where the service already supports it.
- The analytics service needs the public key and middleware set up correctly, or every feedback call returns 401.
- Customers lose the delete feedback button. This follows your rule choice (admin deletes).

## Consequences

**Positive**:
- A changed header or body id can no longer open someone else's data or raise a role.
- One pattern in every service, with a guard test that keeps it that way.
- The stored id and email in the browser stop being an identity claim.

**Negative / tradeoffs**:
- Customers can no longer delete their own feedback.
- Staff can no longer use customer draft routes (403), which could surprise anyone testing with a staff token.
- Each service gets its own copy of the helper and the analytics middleware, so fixes must be repeated until a shared package exists.

**Neutral**:
- No schema change, no new secrets, no new service.
- Email stays in the customer sessionStorage `user` object by decision. Real protection against theft is the backend rules here, plus the follow ups below.

## Follow-up

- [ ] Open trigger routes without a login: ticket-service `/tickets/check-sla-alerts` and messaging `/internal/tickets/{id}/messages`. Design a shared internal secret for them in a separate spec (the AI service `INTERNAL_TOKEN` pattern is a good start)
- [ ] configuration-service reads `X-User-Id` to name the actor in audit entries. It is only safe if the service is never reachable directly, so verify or replace it
- [ ] Check where the access token lives (memory, cookie or storage) and prefer an httpOnly cookie or memory only
- [ ] Add a Content Security Policy in `nginx.conf` and `nginx.prod.conf`, report only first
- [ ] Add the rule "identity comes only from the verified token" to `AGENTS.md` and `.claude/rules/coding-standards.md` (run `/sync`)
- [ ] Tighten the staff only analytics routes to specific roles if reports should be limited further

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
