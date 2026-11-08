# Rationale: Operational Reporting, Audit Log Filtering, and CS Workload Dashboard

**Date**: 2026-11-01
**Status**: Proposed

## Context

The enterprise ticketing system currently has three key operational operational surfaces in the React interface that require complete backend support:

1. **Admin Reports (`/ticketing/admin/reports`)**: The frontend currently displays simulated hardcoded rows for previewing and client side exports via canvas capture and raw client scripts. Because actual operational reports query large tables (tickets, assignments, equipment, customer ratings) across wide date windows, running ad hoc client exports risks inconsistent snapshots and browser memory crashes. Furthermore, heavy queries spanning thousands of tickets can easily exceed Nginx fastcgi gateway timeouts (usually 30 or 60 seconds). A server side solution with preview capabilities, multi format exports, identical underlying snapshots, and background queueing for large files is required.

2. **Super Admin Audit Logs (`/ticketing/superadmin/audit-logs`)**: The current backend implementation in `SuperAdminConfigController::getSuperAdminAuditLogs` executes an unpaginated query with multiple left joins, retrieving all database logs into memory at once. At scale, this crashes memory limits and freezes the browser. In addition, existing routes contain a purge endpoint, which compromises audit immutability principles. A properly indexed, filtered, paginated, and immutable query architecture is required.

3. **Customer Service Agent Dashboard (`/ticketing/admin/cs/dashboard`)**: The current CS dashboard endpoint returns a global system wide ticket summary rather than metrics scoped to the requesting agent. Customer service agents lack quick visibility into their branch unassigned ticket queue, their directly assigned active tickets, urgent SLA risk items, and pending reassignments. When secondary systems (such as feedback ratings) experience downtime, the dashboard should degrade gracefully rather than failing completely.

## Options considered

### Option 1: Modular Microservice Expansion in Ticket Service (Recommended)

Consolidate all operational reporting queries, audit log query optimizations, and CS agent workload metrics inside `ticket-service`, leveraging Redis caching, Laravel queues, DomPDF, native CSV and XML streaming, and composite database indexes.

**Pros**:
- Ticket service already owns tickets, branches, categories, machines, employees, SLA calculations, and audit logs.
- Direct database access eliminates unnecessary network hops for high volume reporting queries.
- Reuses existing `SLAService` and `TicketDashboardService` calculation logic directly.
- Leverages existing Redis cache infrastructure and Laravel queue worker.
- Requires no additional third party cloud dependencies or heavy Composer packages.

**Cons**:
- Heavy exports run on the ticket service worker pool, requiring sensible queue prioritization.

### Option 2: Dedicated Reporting and Analytics Microservice

Offload all report generation and audit querying to a new standalone reporting microservice or to `analytics-service`, replicating ticket data through event broadcasts.

**Pros**:
- Isolates analytical workloads from transactional ticket operations.

**Cons**:
- High architectural complexity with data replication delays and eventual consistency gaps.
- Duplicates SLA rules and classification logic across multiple microservices.
- Violates the repository rule of boring, simple architecture without unnecessary microservice sprawl.

### Option 3: Pure Client Side Generation with Raw API Dumps

Dump raw ticket records to the React frontend over REST and generate previews, CSV, Excel, and PDF entirely within the browser via JavaScript.

**Pros**:
- Minimal backend export logic.

**Cons**:
- Leaks excess data across the network.
- Memory intensive and fragile on mobile or low power client devices.
- Fails completely for large datasets with thousands of tickets.
- Discrepancies between preview tables and exported files occur easily.

## Rationale

Option 1 is selected because it preserves service boundaries while keeping infrastructure boring and dependable. Ticket service is the authoritative source of truth for tickets and audit logs. By introducing a dedicated `report_exports` table and background queue job, large reports run without blocking HTTP connections. Small reports download immediately without queue overhead. Adding composite database indexes on `ticket_audit_logs` ensures that multi parameter filtering runs efficiently even as millions of log records accumulate. Finally, wrapping independent dashboard calculations in try catch blocks ensures that customer service agents retain access to critical ticket queues even if secondary analytics queries experience transient latency.

