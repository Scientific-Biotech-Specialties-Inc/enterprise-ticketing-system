# 0030. Audit Log Retention Rules and Scheduled Purge Engine

**Date**: 2026-11-03
**Status**: Accepted

## Summary

This specification establishes an automated audit log retention and purge engine for the ticket service. It provides Super Admins with policy configuration, pre purge record count calculations, and a scheduled background purge worker. The worker deletes expired logs in chunked batches, protects against concurrent executions, retries transient failures, sends emergency alerts on fatal errors, and records every run in an immutable meta log table.

## Requirements

**User stories**:
* As a Super Admin, I want to configure log retention thresholds with safety floors, so that historical log storage does not grow unmanageable while protecting recent audit trails.
* As a Super Admin, I want to calculate the pre purge record impact before saving or triggering a deletion, so that I can anticipate data volume changes accurately.
* As a Super Admin, I want scheduled background purging with chunked deletions, concurrency protection, failure retries, and emergency alerts, so that routine maintenance runs reliably without table locks.
* As a Super Admin, I want immutable meta log records of every purge run, so that regulatory compliance and audit traceability are maintained.

**Acceptance criteria**:
* **AC-1**: Super Admins can configure audit log retention periods with an enforced minimum 30 days safety floor, persisted in the `audit_retention_settings` table.
* **AC-2**: The system provides a pre purge impact calculation endpoint that calculates exact expired record counts using active or optional preview retention thresholds without mutating data.
* **AC-3**: A scheduled Artisan console command (`tickets:purge-expired-audit-logs`) runs on a nightly schedule, identifying and permanently deleting expired logs in keyset chunked batches of 1,000 records.
* **AC-4**: An atomic Redis mutex lock (`audit_purge_in_progress`) prevents concurrent manual and scheduled executions, returning structured HTTP 409 Conflict if another purge is active.
* **AC-5**: Background purge operations automatically retry up to three times with exponential backoff on transient database failures.
* **AC-6**: On fatal purge execution failure or after three exhausted retries, the engine dispatches an emergency system alert payload to `notification-service` to notify Super Admins immediately.
* **AC-7**: Each purge run permanently records an immutable execution record in `audit_purge_runs` capturing cutoff timestamp, records identified, records deleted, duration in milliseconds, trigger source (`scheduled` or `manual`), status (`success`, `failed`, `partial`), error message, and operator identity.
* **AC-8**: The purge engine operates with strict table isolation, executing deletions exclusively on `ticket_audit_logs` without touching tickets, messages, customer profiles, or staff records.
* **AC-9**: Clear, structured error responses are returned for unauthorized requests, invalid retention periods below the safety floor, concurrent purge collisions, or database execution failures.
* **AC-10**: Super Admins can query paginated historical purge run records through a dedicated administrative endpoint.

## Decision

**Chosen option**: Option 1: Dedicated Database Configuration and Keyset Chunked Console Worker.

The system manages log retention through dedicated database configuration, executes deletions using keyset chunked Artisan console commands, prevents overlapping runs with Redis mutex locks, alerts Super Admins on failure via `notification-service`, and records complete audit metrics in `audit_purge_runs`.

**Implementation skills**: `laravel-microservice` (`agents/skills`, `.agents/skills/laravel-microservice/`) · `docker-runbook` (`agents/skills`, `.agents/skills/docker-runbook/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**:

```
Table: audit_retention_settings
+------------------------+------------------+------+-----+---------+----------------+
| Field                  | Type             | Null | Key | Default | Extra          |
+------------------------+------------------+------+-----+---------+----------------+
| id                     | int unsigned     | NO   | PRI | NULL    | auto_increment |
| retention_days         | int unsigned     | NO   |     | 365     |                |
| is_auto_purge_enabled  | tinyint(1)       | NO   |     | 1       |                |
| purge_schedule         | varchar(64)      | NO   |     | 0 2 * * *|               |
| chunk_size             | int unsigned     | NO   |     | 1000    |                |
| updated_by_id          | int unsigned     | YES  |     | NULL    |                |
| created_at             | timestamp        | YES  |     | NULL    |                |
| updated_at             | timestamp        | YES  |     | NULL    |                |
+------------------------+------------------+------+-----+---------+----------------+

Table: audit_purge_runs
+------------------------+------------------+------+-----+---------+----------------+
| Field                  | Type             | Null | Key | Default | Extra          |
+------------------------+------------------+------+-----+---------+----------------+
| id                     | bigint unsigned  | NO   | PRI | NULL    | auto_increment |
| trigger_source         | enum             | NO   |     | NULL    | scheduled/manual|
| retention_days         | int unsigned     | NO   |     | NULL    |                |
| cutoff_timestamp       | datetime         | NO   |     | NULL    |                |
| records_identified     | int unsigned     | NO   |     | 0       |                |
| records_deleted        | int unsigned     | NO   |     | 0       |                |
| duration_ms            | int unsigned     | NO   |     | 0       |                |
| status                 | enum             | NO   |     | NULL    | success/failed/partial |
| error_message          | text             | YES  |     | NULL    |                |
| executed_by_id         | int unsigned     | YES  |     | NULL    |                |
| created_at             | timestamp        | YES  |     | NULL    |                |
+------------------------+------------------+------+-----+---------+----------------+

Table: ticket_audit_logs (Target table, existing)
Protected by strict hardcoded query builder isolation.
```

**State transitions**:

```
Purge Run Execution Lifecycle:
[Trigger: Cron or Manual API]
           |
           v
    Check Redis Lock
     /           \
[Lock Exists]   [Lock Acquired]
     |                 |
HTTP 409 Conflict      v
                  Count Expired Records
                       |
                       v
                 Chunked Keyset Loop (1,000 rows / batch)
                  /                      \
        [All Chunks Deleted]         [Exception Caught]
                 |                            |
                 v                            v
          Release Lock                 Retry Loop (Up to 3x)
                 |                     /                   \
        Record 'success' in       [Recovered]         [Max Retries Exceeded]
         audit_purge_runs              |                       |
                               Record 'partial'        Record 'failed'
                               Release Lock            Release Lock
                                                       Dispatch Alert to
                                                       notification-service
```

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/ticketing/ticket/superadmin/audit-logs/retention` | GET | None | `retention_days`, `is_auto_purge_enabled`, `purge_schedule`, `next_run_at`, `pending_purge_estimate`, `last_run` | Bearer (Super Admin) | 401 unauthenticated, 403 non superadmin |
| `/api/ticketing/ticket/superadmin/audit-logs/retention` | PUT | `retention_days`: int (required, min 30), `is_auto_purge_enabled`: bool, `purge_schedule`: string | `status`, `message`, `settings` | Bearer (Super Admin) | 401 unauthenticated, 403 non superadmin, 422 below 30 days floor |
| `/api/ticketing/ticket/superadmin/audit-logs/retention/impact` | GET | `preview_days`: int (optional, min 30) | `retention_days`, `cutoff_timestamp`, `affected_records_count` | Bearer (Super Admin) | 401 unauthenticated, 403 non superadmin, 422 invalid days |
| `/api/ticketing/ticket/superadmin/audit-logs/retention/purge` | POST | None | `status`, `message`, `run_id`, `records_deleted`, `cutoff_timestamp`, `duration_ms` | Bearer (Super Admin) | 401 unauthenticated, 403 non superadmin, 409 purge in progress, 500 execution failed |
| `/api/ticketing/ticket/superadmin/audit-logs/retention/history` | GET | `page`: int, `per_page`: int | `runs`: array, `pagination`: object | Bearer (Super Admin) | 401 unauthenticated, 403 non superadmin |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Retention Config Display | Active Retention Period | `audit_retention_settings.retention_days` (default 365) |
| Retention Config Display | Auto Purge Schedule | `audit_retention_settings.purge_schedule` |
| Retention Config Display | Next Run Timestamp | Calculated from `purge_schedule` cron expression using server timezone |
| Impact Calculation | Cutoff Date | `Carbon::now()->subDays(preview_days ?? retention_days)` |
| Impact Calculation | Affected Records Count | `DB::table('ticket_audit_logs')->where('created_at', '<', cutoff)->count()` |
| Purge Execution | Records Identified | Initial count of logs where `created_at < cutoff` at execution start |
| Purge Execution | Records Deleted | Cumulative count of rows deleted across all keyset batches |
| Purge Execution | Execution Duration | Elapsed wall clock time from start to finish in milliseconds |
| Purge Execution | Operator Identity | `auth()->user()->emp_id` for manual runs, `null` for scheduled cron runs |
| Failure Alert | Alert Details Payload | Sanitized exception message, run ID, and timestamp dispatched to `notification-service` |

**Key invariants**:

* Safety floor: The retention period cannot be configured below 30 days under any circumstance.
* Table isolation barrier: Deletion queries are strictly hardcoded to `ticket_audit_logs`. The purge engine cannot accept arbitrary table names and can never delete from `tickets`, `ticket_messages`, `customers`, or `employees`.
* Keyset chunking: Deletions operate in batches of 1,000 records using primary key ordering (`audit_ID`) to avoid database locking.
* Single concurrency execution: An atomic Redis mutex key (`audit_purge_in_progress`) with a 30 minute expiration prevents concurrent manual and scheduled purges.
* Immutability of meta log: Records in `audit_purge_runs` can never be updated or deleted by any administrative route.

**Security model**:

* Role based access control: All retention endpoints require a verified Super Admin token verified through `VerifyEmployeeJwt`. Non Super Admin requests receive HTTP 403 Forbidden.
* Password and credential encryption: Configuration changes and administrative logins pass through client side RSA cryptography.
* Service communication: Failure alerts to `notification-service` pass via internal API with shared service bearer tokens.

**Configuration required**:

* `AUDIT_PURGE_DEFAULT_DAYS`: integer, default `365` (initial retention threshold for new deployments)
* `AUDIT_PURGE_CHUNK_SIZE`: integer, default `1000` (batch size per keyset deletion iteration)
* `AUDIT_PURGE_LOCK_TTL_MINUTES`: integer, default `30` (maximum timeout for the Redis concurrency mutex lock)

**Critical test scenarios**:

* Happy path: Super Admin fetches retention configuration; endpoint returns active settings, next scheduled run, and pre purge impact count, verifying **AC-1**, **AC-2**.
* Safety floor validation: Super Admin submits `retention_days: 15`; endpoint returns HTTP 422 with structured validation error, verifying **AC-1**, **AC-9**.
* Pre purge impact calculation: Super Admin queries `/impact?preview_days=60`; endpoint returns exact count of records older than 60 days without mutating database, verifying **AC-2**.
* Chunked background purge: Scheduled console command executes on test database with 2,500 expired records; logs are deleted in three chunks (1000, 1000, 500) and run record logs `success`, verifying **AC-3**, **AC-7**, **AC-8**.
* Concurrency mutex lock: Manual purge request is submitted while a purge is running; endpoint immediately rejects with HTTP 409 Conflict and message `PURGE_ALREADY_IN_PROGRESS`, verifying **AC-4**, **AC-9**.
* Failure retry and alerting: Database connection is artificially dropped mid purge; worker retries three times and dispatches emergency alert payload to `notification-service`, verifying **AC-5**, **AC-6**, **AC-7**.
* Strict table isolation: Purge execution runs to completion; assertion confirms count of `tickets`, `ticket_messages`, and `employees` remains completely unchanged, verifying **AC-8**.
* Purge history retrieval: Super Admin requests history endpoint; returns paginated array of past purge runs matching database records, verifying **AC-10**.

## Build plan

Vertical implementation slices following the Tracer Bullet delivery approach:

1. Create database migration for `audit_retention_settings` and `audit_purge_runs` tables with indexes and initial default seed record, satisfies **AC-1**, **AC-7**, **AC-8**.
2. Implement Eloquent models `AuditRetentionSetting` and `AuditPurgeRun` in `ticket-service` with strict fillable protection and type casting, satisfies **AC-1**, **AC-7**.
3. Implement `AuditRetentionService` in `ticket-service` containing pre purge impact calculation, keyset chunked deletion logic, and meta log recording, satisfies **AC-2**, **AC-3**, **AC-7**, **AC-8**.
4. Implement Redis mutex concurrency locking and three step exponential backoff retry handler with alert dispatch to `notification-service`, satisfies **AC-4**, **AC-5**, **AC-6**.
5. Implement Artisan console command `tickets:purge-expired-audit-logs` and register the daily schedule in `app/Console/Kernel.php`, satisfies **AC-3**, **AC-5**, **AC-7**.
6. Update `SuperAdminConfigController` and `routes/api.php` with retention settings, impact calculation, manual purge trigger, and history endpoints with structured error responses, satisfies **AC-1**, **AC-2**, **AC-4**, **AC-7**, **AC-9**, **AC-10**.
7. Author automated PHPUnit feature tests in `tests/Feature/AuditLogRetentionTest.php` verifying safety floors, chunking, concurrency locks, emergency alert dispatches, and table isolation, satisfies **AC-1** through **AC-10**.

## Consequences

**Positive**:
* Prevents runaway database storage growth and keeps audit queries fast.
* Eliminates database table locking and replication lag through keyset chunking.
* Enforced 30 day safety floor protects against catastrophic accidental log deletion.
* Redis mutex lock eliminates race conditions between automated and manual purges.
* Immutable meta log records provide complete audit compliance for enterprise inspections.

**Negative / tradeoffs**:
* Requires running Laravel scheduler cron continuously in container environments.
* Once purged, deleted audit logs cannot be recovered unless restored from cold database backups.

**Neutral**:
* Alerting relies on existing inter service HTTP communication to `notification-service`.

## Follow-up

* [ ] Verify Laravel Scheduler cron is active in `ticket-service` Docker container for scheduled purge command execution.
* [ ] Connect React frontend `SuperAdminAuditLogs.jsx` retention tab to the new impact preview calculation and purge history endpoints.

## Migration plan

**Strategy**: Additive schema migration with seed defaults.

**Phases**:
1. Execute database migration creating `audit_retention_settings` and `audit_purge_runs` tables.
2. Seed initial default retention record (365 days, auto purge enabled, daily at 02:00 UTC).
3. Deploy updated `AuditRetentionService` and controller endpoints.
4. Enable scheduled Artisan console command in `Kernel.php`.

**Rollback**:
Revert console command registration and drop newly created tables (`audit_retention_settings`, `audit_purge_runs`). Existing `ticket_audit_logs` table remains completely unaffected.

**Risks**:
Low risk. All migrations are purely additive and do not alter existing table structures or modify active ticket records.

