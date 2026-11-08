# 0030. Rationale: Audit Log Retention Rules and Scheduled Purge Engine

## Context

Enterprise audit logging generates thousands of records daily across customer interactions, status changes, employee reassignments, and system updates. In high volume production environments, the `ticket_audit_logs` table expands rapidly, increasing storage overhead and slowing query execution. Without an automated retention mechanism, database disk usage grows without bound, presenting long term maintenance risks for the platform.

Purging historical logs introduces critical operational challenges that require architectural protection. First, bulk deletions executed as a single query lock the database table, causing connection timeouts and cascading 500 errors for active users. Second, an erroneous or unconstrained retention policy could accidentally purge recent audit logs, destroying evidence needed for active security investigations or regulatory compliance audits. Third, concurrent purge triggers (such as a Super Admin clicking manual purge while a nightly background cron job runs) risk deadlocks, duplicate deletions, and corrupted execution statistics.

Furthermore, background workers operating on cron schedules can fail silently due to transient network drops, database disconnections, or memory exhaustion. When a purge process halts mid execution, administrators must be notified promptly rather than discovering unmanaged storage weeks later. Finally, every purge event must be fully traceable through immutable meta log records, while maintaining an impermeable security boundary that guarantees operational tables (such as tickets, customer accounts, and technician records) can never be modified or deleted by the purge engine.

## Options considered

### Option 1: Dedicated Database Configuration and Keyset Chunked Console Worker (Recommended)

Persist retention rules in an ACID compliant `audit_retention_settings` table, run background pruning through an Artisan console command (`tickets:purge-expired-audit-logs`), delete records in keyset chunks of 1,000 rows by primary key, protect runs with an atomic Redis mutex lock, dispatch emergency alerts to `notification-service` on failure, and log execution metrics to `audit_purge_runs`.

**Pros**:
* Keeps retention policy and purge history transactionally consistent with database state.
* Keyset chunking deletes records in small batches, preventing table locks and MySQL replication lag.
* Redis mutex lock eliminates race conditions between automated schedules and manual triggers.
* Integrates directly with existing system alert pipelines for administrator alerting.

**Cons**:
* Requires two new database tables in `ticket-service` for settings and execution history.

### Option 2: Pure Redis Cache Policy with Asynchronous Worker Queue Dispatches

Store the retention days threshold solely in Redis cache and dispatch purge jobs to the default Redis queue worker.

**Pros**:
* Avoids database schema migrations for configuration settings.

**Cons**:
* Cache volatility risks losing configured retention periods on Redis restart or eviction.
* Long running chunked deletions on shared queues can delay time critical customer notification jobs.
* Does not provide persistent historical records for compliance audits.

### Option 3: Synchronous Single Statement HTTP Triggered SQL Deletion

Execute a direct `DELETE FROM ticket_audit_logs WHERE created_at < cutoff` query synchronously during HTTP request handling.

**Pros**:
* Minimal code footprint with zero background worker orchestration.

**Cons**:
* Causes long database table locks on large tables, causing timeouts and blocking active ticket operations.
* HTTP connection timeouts abort deletions halfway through without clean recovery or retries.
* Lacks automated background scheduling, forcing administrators to initiate purges manually.

## Rationale

Log pruning operates directly on historical compliance data in a high concurrency microservice. Storing retention rules in Redis alone is unacceptable because cache evictions would silently revert policies to defaults. Synchronous single statement deletions risk locking the `ticket_audit_logs` table for minutes, degrading platform performance.

Option 1 provides maximum reliability. Keyset chunking (`WHERE created_at < cutoff AND audit_ID > last_seen ORDER BY audit_ID ASC LIMIT 1000`) isolates deletions to tiny transaction blocks, keeping CPU and lock durations negligible. The Redis mutex lock guarantees mutual exclusion between cron schedules and manual triggers. Recording every run in `audit_purge_runs` provides complete visibility for regulatory compliance. When unexpected database crashes occur, the automated three step retry and emergency dispatch to `notification-service` alert administrators before storage expansion causes outages.

