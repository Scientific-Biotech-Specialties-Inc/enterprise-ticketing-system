# Verify: Brevo email delivery · spec 0040 · updated 2026-11-13
_Steps derived from spec 0040 acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

Before you start: in Brevo, verify the sender, create an API v3 key and an SMTP key, and allow the server IP if Authorised IPs is on. Set `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM_ADDRESS` and `INTERNAL_TOKEN` in the root `.env`, then `docker compose up -d`.

## Commands
- [ ] `docker compose exec configuration-service php artisan migrate` → the `2026_11_13_000001_switch_email_provider_to_brevo` migration runs → AC-11
- [ ] `docker compose exec db mysql -uroot -p -e "SHOW COLUMNS FROM ticketing_system.email_configurations LIKE 'provider'"` → Default is `Brevo` → AC-11
- [ ] `SELECT id, provider, is_active FROM email_configurations` → every `Resend` row still exists with `is_active = 0` → AC-11
- [ ] `docker compose exec configuration-service php artisan test --filter=EmailConfigurationTest` → 12 passed → AC-1 to AC-5, AC-11
- [ ] `docker compose exec customer-service php artisan test --filter=ConfigServiceMailerTest` → 7 passed → AC-6 to AC-9
- [ ] `docker compose exec ticket-service php artisan test --filter=EmailDispatchFallbackTest` → 4 passed → AC-7, AC-8
- [ ] `cd frontend/web && npx vitest run src/utils/brevoApiKey.test.js src/pages/SuperAdminTicketConfig.test.jsx` → all pass → AC-1, AC-2, AC-12
- [ ] `docker compose config | grep -E "MAIL_HOST|CONFIGURATION_SERVICE_URL"` → customer, ticket, employee and messaging services show `smtp-relay.brevo.com`; customer-service shows `CONFIGURATION_SERVICE_URL` → AC-10

## UI / manual (SuperAdmin, employee mode at `/ticketing/`)
- [ ] Open Ticket Configuration, then Notifications, then Email Delivery, right after migrating → "not configured" state; no "Resend" text anywhere on the tab → AC-11, AC-12
- [ ] Add Email Configuration, paste an `xsmtpsib-...` key, click Save → "This is a Brevo SMTP key. Paste an API v3 key instead." → AC-2
- [ ] Paste a revoked or made up `xkeysib-...` key, click Save → 422 message says the key is invalid or revoked → AC-2
- [ ] (If Authorised IPs is on) remove the server IP in Brevo, save a valid key → message says to allow the server IP under Authorised IPs; add the IP back → AC-2
- [ ] Save a valid API v3 key with the verified sender → success; the key shows as `xkeysib-•••••••••`; `GET /api/email` returns `provider: "Brevo"` and never the real key → AC-1
- [ ] Send Test Email to your inbox → email arrives from the saved sender, subject mentions Brevo; response has `message_id`; "last tested" updates → AC-3
- [ ] Change the From Name in the tab, send another test → the new name appears on the received email (sender comes from the saved config) → AC-4, Value sourcing: sender
- [ ] Email Templates, send a template test → arrives through Brevo → AC-4

## Behaviour across services
- [ ] Create a ticket as a customer → the ticket created email arrives (Brevo dashboard shows it under Transactional logs) → AC-4
- [ ] Set the `new_ticket` notification channel to In app only, create another ticket → no email; then use forgot password on the customer portal → the reset code email still arrives → AC-5, AC-6
- [ ] Restore the channel. `curl -X POST http://localhost:8009/api/email/dispatch -d '{"to":"x@y.z","subject":"s","html":"h","category":"security"}' -H "Content-Type: application/json"` with no `X-Internal-Token` → 401 → AC-5
- [ ] `docker compose stop configuration-service`, then request a forgot password code → the code still arrives (through Brevo SMTP); customer-service log has one warning "Email sent through SMTP backup" with `recipient_domain` only, no full address and no code → AC-7, AC-8
- [ ] With configuration-service still stopped, send a chat message on a ticket → the recipient gets the message email through SMTP; the messaging-service log shows the same warning shape → AC-7, AC-8
- [ ] With configuration-service still stopped, set `MAIL_PASSWORD` to a wrong value and restart customer-service, request a forgot password code → the portal shows an error, not "code sent" → AC-9
- [ ] Put the right `MAIL_PASSWORD` back, then `docker compose start configuration-service` → normal sends go through the API again (no SMTP backup warnings) → AC-7
- [ ] `grep -rn "api.resend.com\|onboarding@resend.dev\|ResendService" services frontend/web/src` → no matches → AC-12

## Acceptance-criteria coverage
- AC-1: UI save valid key, vitest · AC-2: UI SMTP key, revoked key, blocked IP · AC-3: Send Test Email · AC-4: From Name change, template test, ticket created email · AC-5: in app channel plus forgot password, curl without token · AC-6: forgot password with channel off · AC-7: configuration-service stopped (customer, messaging), restart · AC-8: log shape checks · AC-9: both paths failing · AC-10: compose config grep · AC-11: migrate, column default, Resend rows, tab state · AC-12: tab text, grep sweep, vitest
