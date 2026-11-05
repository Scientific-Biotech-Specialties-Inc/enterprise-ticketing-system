# Verify: Audit Log Retention Rules and Scheduled Purge Engine · spec 0030 · updated 2026-11-04
_Steps derived from spec 0030 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Request `GET /api/ticketing/ticket/superadmin/audit-logs/retention` with a Super Admin bearer token → response returns `retention_days` from `audit_retention_settings.retention_days` (default `365`), `is_auto_purge_enabled`, `purge_schedule` from `audit_retention_settings.purge_schedule`, `next_run_at` computed from the cron expression in the server timezone, `pending_purge_estimate`, and `last_run` → AC-1, AC-2
- [ ] Request `PUT /api/ticketing/ticket/superadmin/audit-logs/retention` with `{"retention_days": 90, "is_auto_purge_enabled": true, "purge_schedule": "30 3 * * *"}` → response returns HTTP 200, persists row in `audit_retention_settings` with `updated_by_id`, and subsequent `GET` updates `next_run_at` to the 03:30 schedule → AC-1
- [ ] Request `PUT /api/ticketing/ticket/superadmin/audit-logs/retention` with `{"retention_days": 15}` (below the 30 day floor) → response returns HTTP 422 structured error (`code: INVALID_RETENTION_POLICY`) and leaves `audit_retention_settings` unchanged → AC-1, AC-9
- [ ] Request `GET /api/ticketing/ticket/superadmin/audit-logs/retention` without a token and with a regular staff token → responses return HTTP 401 and HTTP 403 (`code: FORBIDDEN`) respectively → AC-9
- [ ] Seed audit logs at 90, 45, and 10 days old, then request `GET /api/ticketing/ticket/superadmin/audit-logs/retention/impact?preview_days=60` → response returns `cutoff_timestamp` matching `Carbon::now()->subDays(60)` and exact `affected_records_count` from `ticket_audit_logs` without mutating any rows → AC-2
- [ ] Set Redis key `audit_purge_in_progress` and request `POST /api/ticketing/ticket/superadmin/audit-logs/retention/purge` → response returns HTTP 409 Conflict with `message: PURGE_ALREADY_IN_PROGRESS` → AC-4, AC-9
- [ ] Clear the lock and request `POST /api/ticketing/ticket/superadmin/audit-logs/retention/purge` as Super Admin → response returns HTTP 200 with `run_id`, `records_deleted`, `cutoff_timestamp`, and `duration_ms`, and `audit_purge_runs` records `trigger_source` as `manual` with `executed_by_id` matching the authenticated Super Admin `emp_id` → AC-7
- [ ] Request `GET /api/ticketing/ticket/superadmin/audit-logs/retention/history?page=1&per_page=10` → response returns HTTP 200 with paginated `runs` array and `pagination` metadata → AC-10

## Commands
- [ ] `docker compose exec -T ticket-service php artisan schedule:list` → lists `php artisan tickets:purge-expired-audit-logs` on cron `0 2 * * *` (or active `purge_schedule`) → AC-3
- [ ] `docker compose exec -T ticket-service php artisan tickets:purge-expired-audit-logs` → deletes expired rows strictly from `ticket_audit_logs` in keyset batches of 1,000 ordered by `log_ID`, leaves `tickets`, `ticket_messages`, `clients`, and `employees` untouched, and inserts an immutable `audit_purge_runs` record with `trigger_source` set to `scheduled`, `executed_by_id` set to `null`, `records_identified`, `records_deleted`, and `duration_ms` → AC-3, AC-7, AC-8
- [ ] `docker compose exec -T ticket-service php artisan test --filter=AuditLogRetentionTest` → all 10 feature tests pass, including three retry exponential backoff recovery, mid purge connection drop exhausting three retries, sanitized emergency alert dispatch with `run_id` and `timestamp` to `notification-service`, table isolation, and `AuditPurgeRun` immutability guards → AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10

## Acceptance-criteria coverage
- AC-1 covered by UI steps 1, 2, 3 and Command step 3 · AC-2 covered by UI steps 1, 5 and Command step 3 · AC-3 covered by Command steps 1, 2, 3 · AC-4 covered by UI step 6 and Command step 3 · AC-5 covered by Command step 3 · AC-6 covered by Command step 3 · AC-7 covered by UI step 7 and Command steps 2, 3 · AC-8 covered by Command steps 2, 3 · AC-9 covered by UI steps 3, 4, 6 and Command step 3 · AC-10 covered by UI step 8 and Command step 3

