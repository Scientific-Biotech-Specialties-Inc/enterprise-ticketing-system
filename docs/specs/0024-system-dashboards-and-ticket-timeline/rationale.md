# Rationale: System Wide Dashboards, Employee Workload Hub, and Ticket Audit Timeline

## Context

The enterprise ticketing platform serves multiple physical facilities across different regions. Leadership needs high level operational metrics to evaluate overall support demand, compare branch efficiency, track SLA compliance, and monitor user counts. Previously, branch dashboards only presented single facility metrics or relied on client side mock structures. Super Admins lacked a single, authoritative endpoint capable of summarizing the whole support ecosystem with sortable comparisons across locations.

At the same time, staff members often operate in two distinct roles. An employee may be an assigned technician actively working to resolve customer hardware or software issues, while also acting as an internal requestor who submitted support tickets for their own office equipment or credentials. Previously, employees had to navigate between disparate screens to inspect their tasks and track their internal requests. They require a unified personal dashboard that clearly bifurcates assigned tickets with SLA risk indicators from submitted tickets with auto close warnings.

Finally, compliance and customer service operations demand absolute clarity regarding the history of every ticket. When disputes or delays arise, customer service agents and managers need an exact chronological account of who made each change, what values changed, whether an action was automated by a system timer, and what remarks were recorded. While some audit records were inserted into `ticket_audit_logs`, the schema lacked before and after state snapshots, system flags, and privacy controls to prevent customers from seeing internal technician discussions. Establishing a unified, immutable timeline solves this operational gap.

## Options considered

### Option 1: Unified Ticket Service Suite with Extended Audit Logs and Segmented Caching (Chosen)

Consolidate all three capabilities within `ticket-service`. Extend the existing `ticket_audit_logs` table with `before_state`, `after_state`, `actor_role`, `is_system`, and `is_internal` columns. Implement dedicated domain services for Super Admin system wide metrics, Employee personal workloads, and Audit timeline retrieval. Cache the heavy Super Admin system dashboard in Redis for 60 seconds, and isolate query failures in the Employee dashboard to return partial results gracefully.

**Pros**:
- Reuses existing `TicketDashboardService`, `SLAService`, and `TicketService` algorithms without code duplication.
- Extends the established `ticket_audit_logs` schema rather than introducing a redundant parallel table.
- Preserves high response speed through targeted composite indexes and non blocking Redis caching.
- Guarantees customer privacy through server side role filtering on `is_internal`.

**Cons**:
- Requires a database migration on `ticket_audit_logs` to add the new metadata columns and composite indexes.

### Option 2: Separate Microservice for Timeline Audit Ledger and Split Endpoint Architecture

Extract the audit timeline engine into an independent auditing microservice backed by MongoDB or an event sourcing store, and split the Super Admin dashboard into four separate HTTP endpoints (KPIs, branches, activity, and user counts).

**Pros**:
- Isolates audit storage from the primary transactional relational database.

**Cons**:
- Adds substantial operational complexity and network latency across microservice boundaries.
- Increases browser network overhead by requiring multiple simultaneous HTTP round trips to construct the Super Admin dashboard.
- Violates the repository goal of minimal moving parts and boring, proven technology.

## Rationale

We chose Option 1 because it builds directly on proven components already operational in the repository. The `ticket_audit_logs` table already captures core actions; adding structured state snapshots, system indicators, and privacy flags elevates it into a complete, immutable audit ledger without the cost of introducing new infrastructure.

For the Super Admin dashboard, returning the consolidated dataset from a single endpoint minimizes network latency and simplifies frontend state management. Anchoring the tickets created today metric to the current calendar date prevents misleading reports when administrators explore historic date windows.

For the Employee dashboard, returning a composite object with isolated failure handling ensures that a temporary hiccup in secondary calculations (such as real time SLA projection) never blocks employees from seeing their primary assigned ticket queue.

