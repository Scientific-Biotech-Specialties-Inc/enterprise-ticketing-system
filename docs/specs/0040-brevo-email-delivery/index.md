# 0040. Replace Resend with Brevo for all transactional email

**Date**: 2026-11-13
**Status**: In Progress

## Summary

All email the platform sends moves from Resend to Brevo. The SuperAdmin Email Delivery tab manages a Brevo API key and sender, and configuration-service sends through the Brevo REST API (Brevo's web interface for sending email). Every service, including customer-service for login codes, sends through configuration-service first, and falls back to the Brevo SMTP relay (Brevo's mail server, used through Laravel Mail) when that call fails. Resend code is removed, and existing Resend settings are turned off, but the rows are kept for history.

## Requirements

**User stories**:
- As a SuperAdmin, I want to configure Brevo as the email provider from the Email Delivery tab, so that I control the API key and sender identity without a redeploy.
- As a customer, I want login, password reset and account emails to arrive even when part of the platform is down, so that I am never locked out.
- As an operator, I want to see in the logs when the backup path was used, so that I notice a configuration-service or Brevo problem.

**Acceptance criteria**:
- **AC-1**: A SuperAdmin can save a Brevo API v3 key (starts `xkeysib-`) with a From Name and From Email. The key is verified live against `GET https://api.brevo.com/v3/account` before saving, stored with the existing `encrypted` cast, and always returned masked as `xkeysib-•••••••••`. The stored `provider` is `Brevo`.
- **AC-2**: The save, change key, and test endpoints reject a bad key with HTTP 422 and a specific message for each case: a wrong format, a Brevo SMTP key (starts `xsmtpsib-`, "this is an SMTP key, use an API v3 key"), a revoked or unknown key (Brevo 401), and a server IP blocked by Brevo's Authorised IPs setting (the message says to allow the server IP in Brevo).
- **AC-3**: Send Test Email delivers through `POST https://api.brevo.com/v3/smtp/email`, updates `last_tested_at`, and returns the Brevo `messageId` as `message_id`. The test email wording names Brevo.
- **AC-4**: `POST /api/email/dispatch` and `POST /api/email/dispatch-event` send through Brevo using the active configuration, and keep today's behaviour for notification channels (`in_app` skips), disabled templates (skip), and no active configuration (404 / 422).
- **AC-5**: `POST /api/email/dispatch` accepts an optional `category` field. When `category` is `security`, the notification channel lookup and the subject based alert key guess are skipped, so the email is always sent. The endpoint stays reachable only with a valid `X-Internal-Token` (unchanged `config.access` internal level).
- **AC-6**: customer-service sends the first login OTP, forgot password OTP, and customer provisioning emails by rendering its existing Blade mailable and posting the HTML to `POST /api/email/dispatch` with `category: security`.
- **AC-7**: In customer-service, ticket-service, employee-service and messaging-service, any failed configuration-service send (timeout, connection error, non 2xx response, or a 2xx with `status: error`) falls back to sending the same email through Laravel Mail over the Brevo SMTP relay. A rare duplicate on timeout is accepted. A `status: skipped` response is a deliberate outcome and does not fall back.
- **AC-8**: Every fallback writes one `Log::warning` with the service name, the recipient's domain only (not the full address), and the failure reason. No email HTML, subject containing a code, or OTP value is logged on any path.
- **AC-9**: When both the configuration-service path and the SMTP backup fail for an auth email, customer-service returns its existing failure response (the user sees an error, never a false "code sent").
- **AC-10**: All four sending services read Brevo SMTP settings from env: `MAIL_HOST=smtp-relay.brevo.com`, `MAIL_PORT=587`, `MAIL_ENCRYPTION=tls`, `MAIL_USERNAME` (Brevo SMTP login), `MAIL_PASSWORD` (Brevo SMTP key), `MAIL_FROM_ADDRESS` (a Brevo verified sender). customer-service also receives `CONFIGURATION_SERVICE_URL` and `INTERNAL_TOKEN`.
- **AC-11**: A new migration sets the `email_configurations.provider` default to `Brevo` and sets `is_active = false` on every row where `provider = 'Resend'`, keeping the rows. After deploy the Email Delivery tab shows "not configured" until a Brevo key is saved, and email keeps flowing through the SMTP backup meanwhile.
- **AC-12**: No Resend code, Resend strings, `re_` key checks, `api.resend.com` URLs, or `onboarding@resend.dev` defaults remain in configuration-service or the frontend. The words "resend code" / "resend OTP" in the login flows are unrelated and stay.

## Decision

**Chosen option**: Option 3: configuration-service first with Brevo SMTP backup.

Brevo replaces Resend behind a small `EmailProvider` interface in configuration-service, every service sends through configuration-service, and each service keeps a Brevo SMTP relay backup in env for when that call fails.

**Implementation skills**: `laravel-microservice` (`.claude/skills/laravel-microservice/`) · `react-frontend` (`.claude/skills/react-frontend/`) · `api-testing` (`.claude/skills/api-testing/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch** (no new tables):

| Table (service) | Change |
|---|---|
| `email_configurations` (configuration-service) | `provider` default `'Resend'` becomes `'Brevo'` (Laravel 11 native `->change()`). Data step: `UPDATE ... SET is_active = false WHERE provider = 'Resend'`. Rows are kept. `api_key` stays `text` with the `encrypted` cast. |

The migration is new and timestamped (for example `2026_11_13_000001_switch_email_provider_to_brevo.php`). The original create migration is not edited. `down()` restores the `'Resend'` default and does not reactivate rows.

**Provider abstraction** (configuration-service):

| Item | Definition |
|---|---|
| `App\Contracts\EmailProvider` | `verifyApiKey(string $apiKey): array{valid: bool, error: ?string}` · `sendTestEmail(string $apiKey, string $fromName, string $fromEmail, string $toEmail): array{success: bool, id: ?string, error: ?string}` · `sendRawEmail(string $apiKey, string $fromName, string $fromEmail, string $toEmail, string $subject, string $html): array{success: bool, id: ?string, error: ?string}` |
| `App\Services\BrevoService` | Implements `EmailProvider`. Base `https://api.brevo.com/v3`. Header `api-key: <key>`, `accept: application/json`. Timeouts: verify 8s, send 10s. |
| Binding | `AppServiceProvider::register()` binds `EmailProvider` to `BrevoService`. `EmailConfigurationController` and `EmailTemplateController` type hint `EmailProvider`. |
| Removed | `App\Services\ResendService` |

**Brevo request mapping**:

| Operation | Request | Success | Failure mapping |
|---|---|---|---|
| Verify key | `GET /v3/account` | 200 means valid | 401 with "unrecognised IP" in `message` gives the Authorised IPs error. Other 401 gives "invalid or revoked key". Network error gives "Unable to reach Brevo". |
| Send | `POST /v3/smtp/email` body `{sender:{name,email}, to:[{email}], subject, htmlContent}` | 201 `{messageId}` mapped to `id` | Brevo `{code, message}` mapped to `error`. 429 and 5xx are failures (the caller falls back). |

Key format checks before any HTTP call: empty, or starting `xsmtpsib-` (SMTP key error), or not starting `xkeysib-` (format error). Local environment bypass, matching today's pattern: in `local`, keys starting `xkeysib-test` or `xkeysib-dev` skip the ping and count as valid.

**Sending helper in each service** (`App\Services\Mail\ConfigServiceMailer`, a small class copied into customer-service, employee-service and messaging-service; ticket-service keeps its existing `dispatchEmail()` and gains the same rules):

```
send(string $to, Mailable $mailable, ?string $alertKey = null, ?string $category = null): bool
  1. html = $mailable->render(); subject = $mailable->envelope()->subject (or ->subject)
  2. POST {CONFIGURATION_SERVICE_URL}/api/email/dispatch with X-Internal-Token
     body: to, subject, html, alert_key, category
     security category: timeout 5s, no retry; other mail: timeout 6s, retry(2, 100)
  3. 2xx and status != error  -> return true (status skipped also returns true)
  4. otherwise -> Log::warning(service, recipient domain, reason); Mail::to($to)->send($mailable); return true
  5. Mail throws -> rethrow (the caller keeps its current error handling)
```

messaging-service posts raw HTML today. Its fallback uses `Mail::html($html, fn ($m) => $m->to($to)->subject($subject))`.

**API surface** (configuration-service, all existing routes, contract changes only):

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/email` | GET | none | `data.provider = 'Brevo'`, `apiKey = 'xkeysib-•••••••••'` | admin | none |
| `/api/email` | POST | `apiKey` (RSA encrypted), `fromName`, `fromEmail` | masked config | admin, `decrypt.rsa:apiKey` | 422 (AC-2) |
| `/api/email/api-key` | PUT | `apiKey` (RSA encrypted) | masked config | admin, `decrypt.rsa:apiKey` | 422, 404 |
| `/api/email` | PUT/PATCH | `fromName`, `fromEmail` | masked config | admin | 404 |
| `/api/email` | DELETE | none | message | admin | none |
| `/api/email/test` | POST | `recipientEmail`, optional `apiKey`/`fromName`/`fromEmail` | `message`, `message_id`, `last_tested` | admin, `decrypt.rsa:apiKey` | 422 |
| `/api/email/dispatch` | POST | `to`, `subject`, `html`, `alert_key?`, `event_key?`, **`category?` (`security` or `notification`)** | `id` or `status: skipped` | internal token | 404 no config, 502 Brevo failure |
| `/api/email/dispatch-event` | POST | `eventKey`, `to`, `data?` | `status`, `id` | internal token | 422 no config, 502 |
| `/api/email-templates/{eventKey}/test` | POST | unchanged | `message_id` | admin | 422, 502 |

`resend_id` is replaced by `message_id`. No frontend code reads `resend_id`, so no alias is kept.

**Value sourcing**:

| Action | Value | Source |
|---|---|---|
| Save / change key | key to verify | `apiKey` input, RSA decrypted by `decrypt.rsa` |
| Save / change key | provider name | constant `'Brevo'` in the controller |
| Masked response | `provider` | `email_configurations.provider` column |
| API dispatch | sender name, email | active `email_configurations.from_name`, `from_email` |
| API dispatch | Brevo key | active `email_configurations.api_key` (decrypted by cast) |
| Test email default sender | from email when none saved | `config('mail.from.address')` (replaces `onboarding@resend.dev`) |
| Auth email body | HTML | customer-service Blade mailable `render()` |
| Auth email category | `security` | constant passed by customer-service `AuthService` / `ProvisionController` |
| SMTP backup | host, port, login, key | `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD` env |
| SMTP backup | sender | `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME` env |
| Fallback log | recipient domain | substring after `@` of the `to` address |
| Brevo message id | `message_id` | Brevo response `messageId` |

**Key invariants**:
- Only one `email_configurations` row has `is_active = true` (unchanged save behaviour).
- The API key never leaves configuration-service in plaintext: RSA in transit from the browser, `encrypted` at rest, masked in responses, never logged.
- `category: security` mail is never skipped by notification channel settings.
- An auth email is never reported as sent unless one of the two paths accepted it.
- No service queries another service's tables to send mail (no change to boundaries).

**Security model**:
- Email configuration routes: verified admin or superadmin, or internal token (unchanged `config.access`).
- `/api/email/dispatch` and `/dispatch-event`: internal token only, so only services can use `category: security`.
- Credentials: Brevo API key in the configuration-service DB (encrypted). Brevo SMTP key in each sending service's env. Neither is committed. `.env.example` files carry empty placeholders.
- OTPs and HTML bodies are not logged. The existing customer-service `before_mail_send` log keeps the full email and is out of scope.

**Configuration required**:
- `MAIL_MAILER=smtp`, `MAIL_HOST=smtp-relay.brevo.com`, `MAIL_PORT=587`, `MAIL_ENCRYPTION=tls`: Brevo SMTP relay, in customer, ticket, employee and messaging services (`docker-compose.yml`, `docker-compose.prod.yml`, each `.env.example`, `.env.production.example`).
- `MAIL_USERNAME`: Brevo SMTP login (shown under SMTP & API > SMTP in Brevo).
- `MAIL_PASSWORD`: Brevo SMTP key (`xsmtpsib-...`).
- `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME`: a Brevo verified sender, ideally the same one the SuperAdmin saves.
- `CONFIGURATION_SERVICE_URL`, `INTERNAL_TOKEN`: newly added to customer-service in both compose files and its `.env.example`.
- Local development keeps `MAIL_HOST=mailpit` in `.env.example`, with the Brevo values shown as commented lines.

**UI** (`frontend/web/src/pages/SuperAdminTicketConfig.jsx`, Email Delivery tab, text and checks only):
- Key checks: must start `xkeysib-`. A key starting `xsmtpsib-` shows "This is a Brevo SMTP key. Paste an API v3 key instead."
- Default `provider: 'Brevo'`, masks `xkeysib-•••••••••`, badge "Brevo API v3", every "Resend" string becomes "Brevo" (about 20 strings, lines near 290, 1618, 1699, 1829, 4095 to 4345, 7320 to 7400).
- Helper text under From Email: "Must be a verified sender in your Brevo account."
- Follows `DESIGN.md` tokens and the 8px grid. Loader2 stays on Save / Test buttons only. Works in employee mode (the tab is employee only).

**Critical test scenarios**:
- Happy path: save a valid key (Brevo `GET /account` faked 200), then dispatch, and the faked `POST /smtp/email` receives `sender`, `to[0].email`, `htmlContent`. Verifies **AC-1**, **AC-4**.
- Bad keys: `xsmtpsib-` rejected without an HTTP call; faked 401 returns 422; faked 401 "unrecognised IP address" returns the Authorised IPs message. Verifies **AC-2**.
- Security category: with `new_ticket` channel set to `in_app`, a `category: security` dispatch still sends. Verifies **AC-5**.
- Internal only: `POST /api/email/dispatch` without `X-Internal-Token` returns 401. Verifies **AC-5**.
- Fallback: customer-service forgot password with configuration-service faked as 500 (and again as a connection exception) sends `ForgotPasswordOtpMail` through `Mail::fake()`, logs one warning with only the domain. Verifies **AC-6**, **AC-7**, **AC-8**.
- Double failure: configuration-service 500 and Mail throwing returns the existing failure response. Verifies **AC-9**.
- Migration: an active Resend row becomes inactive and stays in the table; `GET /api/email` returns `is_configured: false`. Verifies **AC-11**.
- Frontend: `SuperAdminTicketConfig.test.jsx` covers the `xkeysib-` and `xsmtpsib-` checks and the Brevo labels. Verifies **AC-1**, **AC-2**, **AC-12**.

## Build plan

Two slices, one PR each, on branches cut from `dev`. Slice 1 ships on its own: the SMTP backup already exists in ticket-service and employee-service, and customer-service keeps sending through its own SMTP until slice 2.

**Slice 1: Brevo in configuration-service and the SuperAdmin tab** (`feat/brevo-email-provider`)
1. [x] Add `App\Contracts\EmailProvider` and `App\Services\BrevoService` with the request and error mapping above, satisfies **AC-1**, **AC-2**, **AC-3**
2. [x] Bind the interface in `AppServiceProvider`. Switch both controllers to `EmailProvider`. Replace Resend strings, `resend_id` with `message_id`, and the `onboarding@resend.dev` default with `config('mail.from.address')`, satisfies **AC-3**, **AC-4**, **AC-12**
3. [x] Add the optional `category` field to `dispatchEmail()`. When `security`, skip channel lookup and alert key inference, satisfies **AC-5**
4. [x] Update `EmailConfiguration::toMaskedResponse()` to read `provider` from the column and mask as `xkeysib-•••••••••`, satisfies **AC-1**
5. [x] Add the migration (default `Brevo`, deactivate Resend rows), satisfies **AC-11**
6. [x] Delete `ResendService.php`, satisfies **AC-12**
7. [x] Update the Email Delivery tab in `SuperAdminTicketConfig.jsx` and the comment in `configurationService.js`, satisfies **AC-1**, **AC-2**, **AC-12**
8. [x] Tests: `tests/Feature/EmailConfigurationTest.php` in configuration-service with `Http::fake()` for `api.brevo.com/v3/*`, and the frontend test update, satisfies **AC-1** to **AC-5**, **AC-11**, **AC-12**
9. [x] Docs: configuration-service README, root README (also drop the nonexistent `ResendConfigController.php` reference), `.env.production.example` comment, satisfies **AC-12**

**Slice 2: every service through configuration-service, with Brevo SMTP backup** (`feat/brevo-smtp-backup`)
10. [x] Env: switch `MAIL_*` to Brevo SMTP relay in `docker-compose.yml`, `docker-compose.prod.yml`, the four `.env.example` files and `.env.production.example`; add `CONFIGURATION_SERVICE_URL` and `INTERNAL_TOKEN` to customer-service, satisfies **AC-10**
11. [x] Add `ConfigServiceMailer` to customer-service. Route `AuthService` (first login OTP, forgot password OTP) and `ProvisionController` through it with `category: security`, keeping their existing error responses, satisfies **AC-6**, **AC-7**, **AC-9**
12. [x] ticket-service `TicketNotificationService::dispatchEmail()`: treat `status: error` as a failure, apply the fallback log format, change "via Resend" log text, satisfies **AC-7**, **AC-8**
13. [x] employee-service: add `ConfigServiceMailer` for its direct mail paths and apply the fallback log format where `dispatch-event` falls back, satisfies **AC-7**, **AC-8**
14. [x] messaging-service `MessageController` chat email: add the `Mail::html` fallback and log format, satisfies **AC-7**, **AC-8**
15. [x] Tests: customer-service fallback and double failure tests (`Http::fake` + `Mail::fake`); a ticket-service test that a 500 from configuration-service falls back, satisfies **AC-6** to **AC-9**

## Migration plan

**Strategy**: direct replacement, sliced into two deploys.
**Phases**:
1. Before slice 1 deploys: in Brevo, verify the sender domain or address, create an API v3 key, create an SMTP key, and allow the server IPs if Authorised IPs is on.
2. Deploy slice 1, run `php artisan migrate` in configuration-service. The SuperAdmin saves the Brevo key and sender, then runs Send Test Email. Between deploy and save, API dispatch returns 404 and ticket-service and employee-service fall back to their SMTP.
3. Set the Brevo SMTP env values on all four services, then deploy slice 2.
**Rollback**: revert the slice PR. For slice 1 also run the migration `down()` and reactivate the previous Resend row by hand (`UPDATE email_configurations SET is_active = true WHERE id = <last Resend id>`), since its key was kept.
**Risks**: an unverified sender makes every Brevo send fail (both paths), so phase 1 must finish first. If Authorised IPs is on and the container egress IP is missing, verify returns 401 and saving fails (the AC-2 message explains it). Slice 2 before the SMTP env values are set breaks the backup path.

## Consequences

**Positive**:
- One provider for all email, managed by the SuperAdmin for normal traffic.
- Login and reset emails survive a configuration-service or Brevo API outage through the SMTP backup.
- Swapping provider later is one new class behind `EmailProvider`.

**Negative / tradeoffs**:
- Two Brevo credentials to manage: the API key in the UI and the SMTP key in env on four services. Rotating the SMTP key needs a redeploy.
- The SMTP sender (`MAIL_FROM_ADDRESS`) can drift from the SuperAdmin From address; the runbook must say to keep them equal.
- Auth emails now take a network hop to configuration-service first, adding up to 5s before the backup kicks in during an outage.
- On a timeout the user can occasionally receive the same email twice.
- `ConfigServiceMailer` is duplicated across three services, since no shared PHP package exists.

**Neutral**:
- `resend_id` becomes `message_id` in API responses.
- Existing Resend rows stay in the table, inactive.
- Bounce and complaint webhooks stay out of scope, as with Resend.

## Follow-up

- [ ] Optional: Brevo delivery webhooks (bounces, spam complaints, blocked contacts) as a separate spec.
- [ ] The customer-service `before_mail_send` log writes full email addresses; consider trimming to the domain in a separate change.
- [ ] messaging-service has copies of `AuthService` and `ProvisionController` that send auth mail; confirm whether they are live routes or dead code (they pick up Brevo SMTP through env either way).
- [ ] Brevo Agent Skills and MCP servers were reviewed and declined (only unverified community skills; the hosted MCP server is not needed for this build). Record under `Declined:` in root `AGENTS.md`.
- [ ] Update `AGENTS.md` line 18 ("Resend email delivery") to Brevo; `/sync` owns that edit.
