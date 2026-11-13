# 0040. Rationale: Replace Resend with Brevo for all transactional email

## Context

The platform sends email two ways today. configuration-service sends ticket notifications through Resend, using an API key the SuperAdmin manages in the Email Delivery tab. Other services post to its internal `/api/email/dispatch` and `/api/email/dispatch-event` endpoints. Separately, customer-service sends login codes (first login OTP, forgot password OTP) and account provisioning emails directly through Laravel Mail over Gmail SMTP. ticket-service and employee-service fall back to that same SMTP when configuration-service fails, and messaging-service has no fallback.

The team is moving to Brevo and wants every email on it, with the SuperAdmin keeping control of the provider settings. The Resend code is tied to Resend throughout: the `re_` key format, Bearer auth, the response shapes, the masks, and the UI text. Brevo uses an `api-key` header, `xkeysib-` keys, a different send body, and an account level IP allow list. It also issues separate SMTP keys (`xsmtpsib-`) that do not work on its REST API.

Two forces pull against each other. Auth emails are the most critical: if they fail, users cannot log in or reset a password. Central control wants one place to manage credentials and sender identity. The dispatch endpoint also guesses a notification channel from the subject, so auth mail sent through it unchanged could be silently skipped when a SuperAdmin sets a channel to in app only.

## Options considered

### Option 1: Env SMTP only

Every service sends through Laravel Mail straight to `smtp-relay.brevo.com`, and configuration-service keeps only the Brevo API swap for its own sends.

**Pros**: simplest change (mostly env); auth mail has no dependency on another service.
**Cons**: two credentials; the SuperAdmin cannot change the SMTP sender or key; ticket notifications keep two different paths.

### Option 2: configuration-service only

All mail goes through configuration-service and the Brevo API, with no SMTP anywhere.

**Pros**: one credential, fully SuperAdmin managed; one code path.
**Cons**: a configuration-service outage, bad deploy, or Brevo API incident blocks every login and password reset.

### Option 3: configuration-service first, Brevo SMTP backup (chosen)

All services send through configuration-service. Each keeps Brevo SMTP in env and uses it when that call fails. Auth mail carries `category: security` so channel settings never skip it.

**Pros**: SuperAdmin control for normal traffic; logins survive an outage; matches the fallback ticket-service already has.
**Cons**: two credentials; a small helper copied into three services; possible duplicate on timeout; up to 5s extra before the backup is used.

### Option 4: SuperAdmin managed SMTP credentials

Add SMTP login fields to the tab and have services fetch them at runtime.

**Pros**: everything editable in the UI.
**Cons**: new schema, UI and an inter service fetch on every send. The fetch itself depends on configuration-service, so it does not solve the outage case.

## Rationale

Option 3 is the only one that gives both central control and resilience for auth email. Option 2 puts login on the critical path of a service that does not own identity. Option 1 gives up the SuperAdmin control the team asked for. Option 4 adds the most code and still fails when configuration-service is down. The engineer first questioned the env only recommendation. Option 3 answers that by keeping configuration-service as the primary path, with env SMTP only as the safety net.

Brevo sits behind an `EmailProvider` interface rather than a renamed service class. The cost is one small file, and it keeps the controllers provider neutral if the provider changes again. A dropdown with several providers was rejected: the team chose Brevo only, and keeping Resend code around would mean testing and maintaining a path nobody uses.

Smaller calls made at write time:
- **`category: security` field over a separate endpoint**: one field on the existing internal route keeps one dispatch path and one set of tests. The runner up, `/api/email/dispatch-security`, would duplicate the controller logic.
- **Deactivate Resend rows instead of deleting them**: keeps configuration history and allows a manual rollback (the engineer confirmed this).
- **Auth email content stays in customer-service Blade views**: security emails are not exposed to SuperAdmin template editing, where a removed `{otp}` placeholder would break login (the engineer confirmed this).
- **Fall back on timeout too**: a missing OTP is worse than a duplicate, and the latest code stays valid (the engineer confirmed this).
- **Copy `ConfigServiceMailer` per service instead of a shared Composer package**: the repo has no shared PHP package setup, and about 40 lines do not justify one. Runner up: a path repository package, worth it if a fourth copy appears.
- **Auth mail timeout 5s with no retry**: keeps the user wait short before the backup kicks in. Notification mail keeps today's retries because nobody is waiting on it.
- **Two slices**: slice 1 stands alone (the existing SMTP fallbacks cover the gap), so the provider swap is reviewed and rolled back independently of the routing change.
- **Webhooks, SMTP status in the UI, and audit or in app alerts on fallback were left out** (the engineer chose warning logs only), keeping the change to what the switch requires.
