# 0034 Rationale: Verified identity only across backend services

## Context

> ⚠️ Premise note: the first question was whether the stored id and email in the browser were a problem. They are low risk on their own. The real problem is that some backend code treats a client supplied id, role or name as proof of who is calling. Hiding values in the browser would not fix that, because anyone can send a header by hand. The right framing is "who is allowed to say who I am", and the answer must be the verified token only.

**How identity flows today**
- The frontend reads the customer `id` from sessionStorage and sends it as `X-Client-Id` and `X-User-Id` on every ticket service request. `configurationService.js` also sends `X-User-Role`.
- The gateway does not set identity headers, so whatever the browser sends reaches the service.
- `AuthenticateSubsystem` exists in the ticket, messaging, customer and employee services and sets the real user from a JWT or a Passport token. The analytics service has no copy.

**What the code review found**

| # | Service and place | What it trusts | Effect |
|---|---|---|---|
| F1 | ticket-service drafts (`routes/api.php` lines 34 to 36, `TicketDraftController::resolveClientId`) | Routes have no login check. Id comes from body keys, `X-Client-Id`, `X-User-Id`, an unsigned JWT payload, or a token record looked up by id with no secret check | Anyone can read, create or delete another customer's drafts. A forged token works. Customer and employee ids share one number space |
| F2 | analytics-service feedback (`FeedbackController`) | Routes have no login check. `customer_id` from the body. Ownership check runs only if an `X-User-Role` header says customer. Errors in the ticket lookup are logged and the checks are skipped | Rate any ticket, edit or delete any rating by leaving out the role header. `csat-stats` and `predictive-metrics` are also open |
| F3 | ticket-service reminders (`TicketReminderController`) | Role from `X-User-Role` or `user_role`. Sender id from `X-User-ID`, `emp_id` or `sender_id`, default 1 | Any logged in user can claim to be an admin |
| F4 | messaging-service update and destroy | Falls back to `X-User-Id`, `X-User-Type`, `X-User-Name` when no user is set | Likely unreachable because the routes are behind `auth.subsystem`, but the pattern is dangerous |
| F5 | AI-service (`AiChatController::getAuthenticatedUser`) | Routes have no login check. Falls back to a bare `user_id` request value | Read or write any user's AI conversations without a token |

Not deciding leaves the system with login checks that look strong but can be skipped by editing a request. The customer and employee screens already send the token, so the safer rules can be added without changing how they work.

## Options considered

### Option 1: Token only identity in each service, with one shared pattern (chosen)

Each service reads the verified user set by `AuthenticateSubsystem` through a small helper trait. Client identity inputs are banned and a guard test enforces it.

**Pros**:
- Smallest change, uses middleware that already exists in the repo.
- No new infrastructure and each service is safe even if reached directly.
- Easy to test with two users.

**Cons**:
- The helper and the analytics middleware are copied into several services, so a later fix needs repeating.
- Needs the public key set up in analytics-service.

### Option 2: Gateway verifies the token and sets trusted identity headers

nginx runs an auth check and passes a verified id and role to each service.

**Pros**:
- One place to verify, services stay simple.

**Cons**:
- Services become unsafe the moment they are reached around the gateway, and there are several direct ports in development and docker setups.
- Adds an auth subrequest service and a new failure point on every call.
- Needs nginx changes in two files and breaks the existing pattern of services verifying tokens themselves.

### Option 3: A shared Composer package for the middleware and helper

One package used by all services.

**Pros**:
- One copy of the code, fixes land once.

**Cons**:
- The repo has no shared package today, so this adds versioning and release work.
- Slows the urgent fix, since the package must exist before any service can use it.

### Option 4: Keep the headers but sign them (HMAC)

The frontend or gateway signs identity headers and services check the signature.

**Pros**:
- Keeps the current header flow.

**Cons**:
- The browser would need a signing secret, which is not safe, or the gateway signs, which is Option 2 with more steps.
- Duplicates what the JWT already proves.

## Rationale

Option 1 fits the forces in Context. The token already proves identity and the middleware already exists in four services, so the fix is mostly removing code that trusts the wrong input and adding the middleware where it is missing. It also keeps the repository rule that each downstream service verifies the caller itself, so a service stays safe if someone reaches it without going through nginx.

Option 2 is attractive for its single check point, but the repo uses direct service ports in several environments, so it would leave services exposed. Option 3 is the better long term home for the code, and it is listed implicitly by the "copies" tradeoff, but it should not block closing live holes. Option 4 adds secret handling to the browser or repeats Option 2.

Smaller calls I settled while writing:
- **Helper per service (trait)**, runner up shared package. Fast and matches the current layout.
- **Drafts are customer only**, runner up staff drafts keyed by type and id. Customer ids and employee ids are different tables but the same numbers, so a staff token could otherwise reach a customer's draft with the same id. Staff create tickets through the internal flow, which does not use drafts.
- **404 for someone else's record**, runner up 403. It hides that the record exists.
- **Feedback lookup failure returns 503**, runner up allow the request. Today a lookup error silently skips both the status and the owner check, which is the exact gap this decision closes.
- **Admin delete has no 48 hour window**, runner up keep the window. The window protects the owner's edit right, and admin deletion is a moderation action.
- **Analytics stats staff only**, runner up leave open. They show business data and customers never need them.
- **Internal token stays in the AI service only**, runner up spread it everywhere now. Other services have no internal caller on these routes, and the open trigger routes get their own design.

The engineer also chose to keep the email in the customer sessionStorage object. That is sound: the object has no token or password, the AI sidebar and the profile fallback use the email, and the real defense is the backend rules plus a Content Security Policy.

One consequence needs a conscious accept: with "admin deletes", the customer portal's delete feedback action must be hidden. `TicketFeedbackSection.jsx` and `deleteTicketFeedback` currently let a customer try it.
