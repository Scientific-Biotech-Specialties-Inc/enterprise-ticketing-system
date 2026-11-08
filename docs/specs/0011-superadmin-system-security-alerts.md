# 0011. Super Admin System and Security Issue Alerting with Log Deep Linking

**Date**: 2026-10-25
**Status**: Accepted

## Summary

This specification establishes an automated system and security alerting pipeline that notifies Super Admins of unhandled application exceptions, database and SQL errors, brute force failed login spikes, and unusual login anomalies. It introduces sliding window burst grouping to prevent alert fatigue, enforces emission time credential scrubbing, writes every event to the security audit log, and adds deep link click through from notification alerts to an incident detail modal within the Super Admin audit logs interface.

## Context

Platform administrators and Super Admins currently lack an automated in system channel for receiving immediate alerts when critical stability or security incidents happen. When an unhandled 500 error cascade occurs, when repeated failed authentication attempts indicate a credential stuffing attack, or when an unexpected database query failure disrupts operations, administrators only discover the problem after users complain or by manually checking server logs.

Alerting must be fast without flooding administrator inboxes or notification centers during high volume outages. A burst of one hundred identical database connection errors in sixty seconds must trigger one prompt alert with a count summary rather than one hundred individual notifications. Furthermore, error traces and alert bodies must never leak sensitive authentication credentials, passwords, cryptographic keys, or customer data into notification databases or browser screens.

Customer Service and Employee services also need a unified, lightweight interface to report operational failures to the Notification Service without circular dependencies or blocking primary request workflows. Super Admins reviewing an alert in the web portal must be able to click directly from the notification item to inspect the complete sanitized technical incident context, including client IP, timestamp, module, error classification, and sanitized backtrace.

## Requirements

**User stories**:
- As a Super Admin, I want to receive immediate in app and real time notifications whenever high severity system errors, database failures, or authentication anomalies happen so that I can respond to platform instability and security threats quickly.
- As a Super Admin, I want repeated errors in a short burst window to be grouped into a single notification summary so that my notification list does not get overwhelmed during outages.
- As a Super Admin, I want to click any system alert notification to view the full technical incident context, including request path, client IP address, and sanitized error traces, inside the Audit Logs view.
- As a security officer, I want all sensitive credentials, passwords, tokens, and private connection strings scrubbed from alert payloads and logs so that diagnostic notifications never leak secrets.

**Acceptance criteria**:
- **AC-1**: Monitoring triggers capture unhandled 500 exceptions, SQL and database errors, failed login attempts crossing configured thresholds, and unusual login events across backend microservices.
- **AC-2**: Alerts are routed to Notification Service through an authenticated internal endpoint (POST /api/internal/system-alerts), restricting notification delivery exclusively to Super Admin recipients.
- **AC-3**: Threshold parameters for failed logins (default 5 attempts in 10 minutes), SQL error spikes, and unusual logins are maintained dynamically in Configuration Service without requiring server redeployment.
- **AC-4**: A sliding window burst rate limiter aggregates repeat incidents within a five minute window into a single notification banner with an event counter, while recording every underlying event in the audit log.
- **AC-5**: Monitored system and security events are persisted into the shared audit logs database table with event category, severity level, sanitized message, user agent, IP address, and incident reference code.
- **AC-6**: Alert dispatch failures automatically retry up to three times with exponential backoff before recording a pipeline failure notice in the alert health log.
- **AC-7**: The system provides a dedicated security incident detail endpoint (GET /api/superadmin/security-incidents/{incidentId}) allowing Super Admins to query full diagnostic details.
- **AC-8**: All alert payloads and notification messages pass through a sanitization filter that strips passwords, authorization tokens, database connection strings, and variable values prior to persistence and broadcasting.
- **AC-9**: The alerting pipeline tracks its own operational health, recording an emergency fallback notice in system logs whenever alert delivery or Reverb broadcasting encounters an unexpected failure.
- **AC-10**: The Super Admin notification list renders system alerts with distinctive severity icons and styling, supporting one click navigation that opens a rich incident inspection modal within the Audit Logs page.

## Options considered

### Option 1: Client Side Error Boundary Reporting to Super Admin

Capture errors solely on the frontend client side via React Error Boundaries and report them via Axios to the notification table.

**Pros**:
- Catches frontend rendering bugs directly as seen by users.

**Cons**:
- Completely misses backend crashes, SQL query deadlocks, failed API logins, and background job failures.
- Can be blocked by client ad blockers, browser network disconnections, or malicious client tampering.

### Option 2: Direct Database Insertion by Each Microservice

Have each microservice directly insert alert records into the shared notifications and audit logs database tables.

**Pros**:
- Avoids an extra HTTP request between services.

**Cons**:
- Violates microservice boundary isolation standards.
- Duplicates rate limiting, burst grouping, Reverb broadcasting, and email dispatch logic across every microservice.
- Increases connection pressure on the shared database.

### Option 3: Centralized Alert Pipeline via Notification Service with Redis Sliding Window Burst Aggregation (Chosen)

Microservices catch uncaught exceptions, SQL errors, and authentication failures, scrubbing credentials locally and dispatching a standardized payload to the Notification Service over an internal REST endpoint. Notification Service applies Redis sliding window aggregation, resolves Super Admin recipients, broadcasts real time alerts over Reverb, and writes audit records.

**Pros**:
- Adheres strictly to microservice separation and non blocking architecture.
- Centralizes burst grouping, rate limiting, and notification retries in a single specialized service.
- Reuses established Reverb WebSocket channels and notification rendering components.
- Guarantees consistent credential scrubbing and audit persistence.

## Decision

**Chosen option**: Option 3: Centralized Alert Pipeline via Notification Service with Redis Sliding Window Burst Aggregation.

The platform will route all system and security events to Notification Service over an internal endpoint, using Redis sliding windows for burst control and Reverb for instant delivery to Super Admins.

**Implementation skills**: `laravel-microservice`, `react-frontend`, `api-testing`, `security-audit`.

## Rationale

Decoupling error detection from alert delivery ensures that individual microservice failures cannot compromise the alerting system. Notification Service already owns Reverb broadcasting, recipient resolution, and email delivery. By introducing Redis based sliding window aggregation, the system handles heavy crash storms gracefully without spamming Super Admins, while the Audit Logs view continues to provide complete forensic traceability for every single event.

## Feature design

**Data model sketch**:

Table: `system_security_alerts` (or stored within `ticket_audit_logs` with module `Security & System`):
- `id` (bigint, primary key)
- `incident_id` (varchar, unique, e.g. `INC-SYS-20261025-ABCD`)
- `category` (enum: `unhandled_error`, `sql_error`, `failed_login_spike`, `unusual_login`, `pipeline_health`)
- `severity` (enum: `low`, `medium`, `high`, `critical`)
- `service` (varchar, e.g. `ticket-service`, `customer-service`, `employee-service`)
- `title` (varchar)
- `message` (text, sanitized)
- `context_data` (json, contains scrubbed stack trace, route, client IP, user agent, burst count)
- `burst_count` (unsigned int, default 1)
- `first_seen_at` (timestamp)
- `last_seen_at` (timestamp)
- `resolved_at` (timestamp, nullable)
- `resolved_by` (foreign key to employees, nullable)
- `created_at` (timestamp)
- `updated_at` (timestamp)

**State transitions**:
- Incident status: `New / Triggered` -> `Acknowledged` -> `Investigating` -> `Resolved` (optional resolution tracking).

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/internal/system-alerts | POST | category, severity, service, title, message, context:json | incident_id, status, grouped:bool | internal_secret / bearer | 400, 422 |
| /api/superadmin/security-incidents | GET | page, limit, category, severity, q | data:array, pagination | superadmin | 401, 403 |
| /api/superadmin/security-incidents/{incidentId} | GET | incidentId | incident:object, context:object | superadmin | 401, 403, 404 |
| /api/ticket-configurations/system_alert_thresholds | GET | none | thresholds:object | superadmin / internal | 401, 403 |
| /api/ticket-configurations/system_alert_thresholds | PUT | thresholds:object | message, thresholds:object | superadmin | 401, 403, 422 |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Trigger alert | Incident reference ID | Generated UUID with category prefix e.g. `INC-SYS-YYYYMMDD-XXXX` |
| Group burst | Burst count and last seen timestamp | Redis sliding window counter keyed by `alert:burst:{category}:{hash}` |
| Scrub trace | Sanitized stack trace | Regex filter removing password, token, authorization, and secret values |
| Deep link | Navigation to Audit Logs incident detail | URL parameter `?incidentId=INC-SYS-...` parsed by `SuperAdminAuditLogs.jsx` |
| Super Admin recipient | Notification recipient user ID | Queried from `employees` where `role` in `superadmin`, `super admin` |

**Key invariants**:
- Plain text passwords, bearer tokens, encryption keys, and database connection strings must never appear in alert titles, notification messages, or stored context data.
- The first occurrence of any issue always dispatches an immediate notification; subsequent identical errors within the 5 minute window increment the Redis burst counter without sending repetitive individual alerts.
- Every monitored issue must be recorded in the audit log regardless of whether its delivery notification was aggregated.
- Non Super Admin users must never receive or view system level security alerts.

**Security model**:
- All incident inspection endpoints are guarded by Super Admin role verification.
- Inter service alert ingestion endpoint (`/api/internal/system-alerts`) requires subsystem authentication token or internal gateway routing protection.
- Stack trace file paths outside the project root are truncated to avoid disclosing host operating system directory hierarchies.

**Configuration required**:
- Dynamic Configuration Service key: `system_alert_thresholds` specifying failed login limits, window durations, and burst cooldowns.

**Critical test scenarios**:
- Happy path: An unhandled exception or SQL error in ticket service triggers a sanitized alert, notifies Super Admin over Reverb, and appears in the notification list, verifying **AC-1**, **AC-2**, **AC-5**.
- Burst grouping: Twenty database errors generated within ten seconds produce exactly one immediate notification with a burst count indicator, verifying **AC-4**.
- Failed login threshold: Five consecutive incorrect passwords for the same email or IP within ten minutes trigger a security alert, while fewer attempts remain below notification threshold, verifying **AC-1**, **AC-3**.
- Credential scrubbing: An alert containing a mock payload with `password=SuperSecret123` and `Authorization: Bearer test-token` is sanitized to `password=[REDACTED]` before storage, verifying **AC-8**.
- Deep link navigation: Clicking a system alert in the frontend notification drawer navigates to `/superadmin/audit-logs` and opens the incident modal showing complete technical context, verifying **AC-10**.
- Pipeline resilience: When Reverb broadcasting is temporarily down, the alert is stored in audit logs and retried without crashing the originating service, verifying **AC-6**, **AC-9**.

## Build plan

1. Create database migration in `services/ticket-service/database/migrations` for `system_security_alerts` table and audit log category indexes, satisfies **AC-5**.
2. Add dynamic `system_alert_thresholds` baseline configurations in `services/configuration-service/app/Http/Controllers/TicketConfigurationController.php`, satisfies **AC-3**.
3. Implement `SystemAlertSanitizer` utility service in backend services to scrub passwords, tokens, connection strings, and deep stack variables, satisfies **AC-8**.
4. Build `POST /api/internal/system-alerts` endpoint in `services/notification-service` with Redis sliding window burst grouping, Super Admin recipient resolution, and Reverb broadcasting, satisfies **AC-2**, **AC-4**, **AC-6**, **AC-9**.
5. Implement error and SQL monitoring hooks in `ticket-service` and `customer-service` exception handlers and authentication services, satisfies **AC-1**.
6. Build `GET /api/superadmin/security-incidents` and `GET /api/superadmin/security-incidents/{incidentId}` endpoints in `services/ticket-service`, satisfies **AC-7**.
7. Update Nginx gateway configurations to route internal and superadmin security incident endpoints, satisfies **AC-2**, **AC-7**.
8. Enhance frontend `Notifications.jsx` to render system level alerts with severity badges and direct click through routing, satisfies **AC-10**.
9. Extend `SuperAdminAuditLogs.jsx` with a dedicated Security & System Incidents tab and integrate `SecurityIncidentModal` with incident payload details, satisfies **AC-10**.
10. Write unit and feature tests covering threshold detection, burst rate limiting, scrubbing, and frontend modal interactions, satisfies **AC-1**, **AC-4**, **AC-8**, **AC-10**.

## Consequences

**Positive**:
- Provides instantaneous operational awareness to Super Admins during outages and cyber attacks.
- Eliminates notification spam through intelligent burst aggregation while retaining complete diagnostic logs.
- Guarantees strict data privacy by stripping secrets from traces before broadcast and storage.

**Negative / tradeoffs**:
- Slightly increases Redis usage for tracking short lived sliding window counters.
- Adds an internal HTTP hop between originating service and Notification Service during unhandled errors.

**Neutral**:
- Reuses existing Reverb WebSocket channels and the Super Admin Audit Logs interface without introducing new standalone menus.

## Follow-up

- [ ] Review alert burst window durations in staging under simulated load to tune default threshold intervals.
