# 0026. Shared Database Microservices Stabilization and Boundary Governance

**Date**: 2026-11-02
**Status**: In Progress

## Summary

This architectural plan stabilizes the enterprise ticketing microservices while preserving the existing single MySQL database and leaving the external capstone auth module completely untouched. It eliminates system breakage caused by conflicting database migrations, drifting authentication middleware copies, and tangled gateway routing. By establishing strict table ownership, a unified authentication core library, and clean gateway routing paths, developers can safely patch individual microservices without breaking adjacent domains.

## Context

The enterprise ticketing system is currently designed as a multi container microservices platform running across eight Laravel containers, one Nginx reverse proxy gateway, Redis, and MongoDB. The project thesis and capstone paper explicitly specify a microservice architecture. However, all relational microservices share a single MySQL database instance with administrative credentials.

Every time a developer attempts to patch a defect or implement a feature, unexpected breakages occur across the application. An architectural investigation revealed three core failure points:

First, multiple services hold migrations that mutate the same database tables. Both customer service and ticket service define migrations for client records and employee fields. Because migration execution order across containers is non deterministic, schema migrations collide, overwrite indexes, or fail on missing columns. Developers have introduced defensive schema checks directly into HTTP request lifecycles, causing metadata lock contention.

Second, authentication logic is duplicated across four microservices. Each service maintains its own drifting copy of VerifyEmployeeJwt.php with differing role normalization and branch scoping rules. Patching security or branch assignment logic in one service leaves the remaining services out of sync, producing intermittent authorization failures.

Third, the Nginx gateway relies on complex regular expressions to split ticket requests between employee service and ticket service. Concurrently, ticket service acts as a secondary proxy to employee service, leading to double proxying, slow response times, and routing failures.

The system must remain a microservice architecture to satisfy the submitted capstone documentation. The external capstone auth module located in another folder must not be modified. The single shared MySQL database must remain in place.

## Requirements

**User stories**:
- As a developer, I want each database table to be owned by exactly one microservice so that running migrations never causes table collisions or unexpected schema drift.
- As a security lead, I want all microservices to validate RS256 Single Sign On tokens through one uniform authentication core so that token revocation and branch scoping behave consistently without touching the external auth module.
- As an API client, I want unambiguous gateway routing prefixes so that requests reach the intended microservice directly without complex regular expressions or internal double proxying.
- As an engineer, I want large ticket service god classes decomposed into single responsibility action classes so that patching one feature cannot trigger regressions in unrelated workflows.

**Acceptance criteria**:
- **AC-1**: Every relational database table is assigned to exactly one microservice owner; all conflicting duplicate migrations in non owner services are safely retired.
- **AC-2**: Dynamic table checks like Schema hasColumn are completely removed from the HTTP request lifecycle and handled cleanly at deployment migration time.
- **AC-3**: A single canonical VerifyEmployeeJwt middleware is established and shared across customer service, employee service, messaging service, and ticket service, leaving the external capstone auth module untouched.
- **AC-4**: Insecure token caching that bypasses token expiration or blacklist revocation is replaced with a safe cache pattern that checks revocation status before granting access.
- **AC-5**: The broken object authorization flaw on the customer dashboard is resolved by deriving customer identity strictly from the authenticated token rather than unverified query parameters.
- **AC-6**: Gateway routing in nginx gateway conf uses explicit, non overlapping route prefixes for each microservice, completely eliminating double proxying through ticket service.
- **AC-7**: High risk ticket operations (such as assigning tickets, updating status, and calculating SLA breaches) are isolated into dedicated single responsibility action classes with isolated unit and feature tests.

## Options considered

### Option 1: Ad Hoc Patching (Status Quo)
Continue adding defensive conditional checks (such as Schema hasTable and try catch blocks around migrations) and copying middleware updates across all four service folders manually.

**Pros**:
- Requires no structural reorganization.

**Cons**:
- Does not fix the root causes; system breakages continue to escalate as the codebase grows.
- High risk of database deadlocks and silent data corruption.
- Duplicated authentication middleware will continue to drift.

### Option 2: Database per Service with Distributed Sagas
Migrate to pure textbook microservices where each service runs its own isolated MySQL database instance, communicating strictly via asynchronous message queues and Saga orchestrators.

**Pros**:
- Provides absolute physical database isolation.

**Cons**:
- Contradicts the project constraint of keeping the existing single MySQL database.
- Massively increases operational overhead on development machines (running eight separate database engines).
- Introduces eventual consistency lag into SLA monitoring and requires complex Saga orchestrators for simple ticket reassignments.

### Option 3: Shared Database with Strict Table Ownership and Shared Core (Recommended)
Retain the microservice architecture and the single shared MySQL database, but govern it with clear bounded contexts. Assign exclusive ownership of each database table to one microservice, share a common authentication core across services, and streamline gateway routing.

**Pros**:
- Keeps the exact microservice architecture documented in the capstone paper.
- Retains the single shared MySQL database and keeps the external capstone auth module completely untouched.
- Eliminates migration collisions permanently by giving each table a single master service.
- Stops authentication drift by centralizing the RS256 token verification middleware.
- Retains native database transactions (DB transaction) for critical ticket workflows.

**Cons**:
- Requires an initial one time cleanup to retire duplicate migrations and align table ownership.

## Decision

**Chosen option**: Option 3: Shared Database with Strict Table Ownership and Shared Core.

The enterprise ticketing system retains its multi container microservice structure and single shared MySQL database, governed by strict table ownership boundaries, a unified authentication core, and clean gateway routing paths.

**Implementation skills**: `laravel-microservice`, `api-testing`, `security-audit`, `docker-runbook`

## Rationale

Option 3 is the ideal architectural path because it directly resolves the fragility of the codebase while honoring every technical and academic constraint. It keeps the capstone paper 100 percent valid, maintains the single database infrastructure, and requires zero modifications to the external capstone auth module.

By establishing strict table ownership, we eliminate the root cause of migration collisions. By sharing one canonical authentication middleware, we eliminate authorization drift across services. By isolating large service methods into single responsibility action classes, we ensure that patching a bug in one workflow cannot cause collateral damage to another.

## Architecture Blueprint and Standard Definition

### 1. Bounded Context Table Ownership Matrix

Under this standard, each relational table in the shared MySQL database is owned exclusively by one microservice. Only the owning service may contain migration files that create, alter, or index that table. Other services may read tables through Eloquent models or views, but must never run migrations against them.

| Microservice | Exclusively Owned Tables | Non Owning Tables (Read Only Access) |
|---|---|---|
| **`ticket-service`** | `tickets`, `ticket_statuses`, `ticket_priorities`, `slas`, `sla_rules`, `sla_trackings`, `ticket_sequences`, `ticket_drafts`, `ticket_audit_logs`, `ticket_attachments`, `problem_categories`, `branch_categories_sla_policies`, `branch_priority_overrides` | `employees` (read only for assignee data), `departments` (read only for routing) |
| **`employee-service`** | `employees`, `departments`, `reassignment_requests`, `work_logs` | `tickets` (read only for employee ticket lists) |
| **`customer-service`** | `clients`, `client_credentials`, `password_reset_otps`, `refresh_tokens` | None |
| **`analytics-service`** | `feedbacks`, `category_feedback_questions`, `category_feedback_answers`, `analytics_metrics`, `branch_ticket_forecasts`, `daily_employee_performances` | `tickets` (read only aggregate queries) |
| **`configuration-service`** | `system_configurations`, `super_admin_configs`, `system_security_alerts` | None |
| **`attachment-service`** | `attachment_quarantine_logs` | Reads storage disk path |
| **`messaging-service`** | Owns MongoDB collections (`messages`, `conversations`) | `tickets` (read only validation) |

### 2. Canonical Authentication Core (`packages/ticketing-auth`)

To stop authentication drift without touching the external `capstone-auth-module`, a shared core package is placed in `packages/ticketing-auth` and symlinked into each microservice.

```
STRUCTURE:
  enterprise-ticketing-system/
  +-- packages/
  |   +-- ticketing-auth/
  |       +-- src/
  |           +-- Middleware/
  |           |   +-- VerifyEmployeeJwt.php     <-- Single canonical source
  |           +-- Security/
  |           |   +-- TokenRevocationChecker.php
  |           +-- Dto/
  |               +-- AuthenticatedUserDto.php
  +-- services/
      +-- ticket-service/      (links packages/ticketing-auth)
      +-- employee-service/    (links packages/ticketing-auth)
      +-- customer-service/    (links packages/ticketing-auth)
      +-- messaging-service/   (links packages/ticketing-auth)
```

**Security Rules for the Canonical Middleware:**
1. The middleware reads the RS256 public key from storage and verifies token signatures on every request.
2. If token caching is enabled, the cache stores only the validated `AuthenticatedUserDto`. Before returning the cached user, the middleware validates that the token ID (`jti`) is not present in the Redis blacklist.
3. Remove all dynamic `Schema::hasColumn` database queries from the middleware. Database columns are guaranteed by deployment migrations.
4. Auto provisioning of missing employee records is delegated to an asynchronous background job or an explicit domain service rather than executing synchronous database mutations on every HTTP request.

### 3. Streamlined Gateway Routing Contract

In `nginx.gateway.conf`, remove overlapping regular expressions. Every microservice receives a clean, deterministic path prefix:

```
GATEWAY ROUTING MAP:

  Client Request                  Nginx Gateway Target
  ----------------------------    ---------------------------------------
  /api/ticket/*            -->    http://ticket-service:8000/api/*
  /api/employee/*          -->    http://employee-service:8000/api/*
  /api/customer/*          -->    http://customer-service:8000/api/*
  /api/analytics/*         -->    http://analytics-service:8000/api/*
  /api/attachment/*        -->    http://attachment-service:8000/api/*
  /api/messaging/*         -->    http://messaging-service:8000/api/*
  /api/configuration/*     -->    http://configuration-service:8000/api/*
  /api/ai/*                -->    http://ai-service:8000/api/*
```

Remove internal proxy endpoints in `ticket-service/routes/api.php` that forward calls to `employee-service:8000`. The frontend client calls `/api/employee/departments` directly through the Nginx gateway.

### 4. Single Responsibility Action Classes for `ticket-service`

Decompose the massive 2,786 line `TicketService.php` and 2,307 line `TicketDashboardService.php` into focused Action classes:

* `App\Actions\Tickets\CreateTicketAction`
* `App\Actions\Tickets\AssignTicketAction`
* `App\Actions\Tickets\TransitionTicketStatusAction`
* `App\Actions\Tickets\CalculateTicketSlaAction`
* `App\Actions\Dashboards\GetCustomerDashboardMetricsAction`
* `App\Actions\Dashboards\GetCsDashboardMetricsAction`
* `App\Actions\Dashboards\GetAdminDashboardMetricsAction`

Each action class has one public `execute(...)` method, wraps its database mutations inside a `DB::transaction(...)`, and has an independent unit test.

### 5. Critical Cybersecurity Remediations

1. **Customer Dashboard IDOR Remediation:**
   In `ticket-service/routes/api.php`, move `/customer-dashboard` inside the `auth.subsystem` middleware group. In `TicketDashboardController.php`, enforce:
   ```php
   $authenticatedUser = $request->user();
   $customerId = (int) ($authenticatedUser->emp_id ?? $authenticatedUser->id);
   ```
   Completely ignore any `created_by` parameter supplied in the query string.
2. **Container Network Hardening:**
   In `docker-compose.yml`, remove host port bindings for backend microservices (`8001:8000`, `8002:8000`, etc.) and the MySQL database (`33061:3306`) in production configurations. Only the Nginx Gateway port 8080 and frontend development ports should be accessible from the host.

## Build plan

The build plan follows an end to end tracer bullet approach, addressing root cause infrastructure and security first, followed by table ownership and domain decomposition.

### Phase 1: Security and Gateway Routing Baseline
- **Task 1.1**: Close the customer dashboard IDOR vulnerability by enforcing authenticated token user identification (Satisfies AC-5).
- **Task 1.2**: Harden token revocation in `VerifyEmployeeJwt.php` by checking Redis blacklist prior to serving cached sessions (Satisfies AC-4).
- **Task 1.3**: Clean up `nginx.gateway.conf` by establishing strict, non overlapping microservice route prefixes and removing fragile regular expressions (Satisfies AC-6).
- **Task 1.4**: Remove internal HTTP proxy routes inside `ticket-service/routes/api.php` that duplicate employee service routing (Satisfies AC-6).

### Phase 2: Table Ownership and Migration Boundary Cleanup
- **Task 2.1**: Audit and reconcile database migrations according to the Table Ownership Matrix (Satisfies AC-1).
- **Task 2.2**: Remove duplicate migrations for `clients` and `employees` in non owning service directories (Satisfies AC-1).
- **Task 2.3**: Eliminate dynamic `Schema::hasColumn` and `Schema::hasTable` checks from HTTP middleware and request controllers (Satisfies AC-2).

### Phase 3: Unified Authentication Core Package
- **Task 3.1**: Create `packages/ticketing-auth` containing the canonical `VerifyEmployeeJwt.php` and user DTOs (Satisfies AC-3).
- **Task 3.2**: Symlink or register the shared package across `ticket-service`, `employee-service`, `customer-service`, and `messaging-service` (Satisfies AC-3).
- **Task 3.3**: Verify end to end Single Sign On compatibility with `capstone-auth-module` using RS256 token verification (Satisfies AC-3).

### Phase 4: Ticket Service Action Class Decomposition
- **Task 4.1**: Extract ticket assignment and state transition logic from `TicketService.php` into dedicated action classes (Satisfies AC-7).
- **Task 4.2**: Extract dashboard aggregate queries from `TicketDashboardService.php` into dedicated dashboard query actions (Satisfies AC-7).
- **Task 4.3**: Author targeted unit and feature tests for each extracted action class (Satisfies AC-7).

## Consequences

### Positive Consequences
- **Safe Patching:** Developers can modify ticket workflows or employee routing in isolation without triggering unintended regressions across the system.
- **Zero Academic Friction:** The capstone thesis and architecture paper remain 100 percent accurate and aligned with the running code.
- **SSO Stability:** The external `capstone-auth-module` is completely untouched, while authentication behavior across the ticketing microservices becomes uniform.
- **Immediate Consistency:** Critical SLA timers, ticket assignments, and audit logs continue to benefit from atomic relational database transactions.
- **Fast Troubleshooting:** With clean routing and single responsibility action classes, error logs point directly to the failing action rather than a monolithic 2,500 line service file.

### Tradeoffs Accepted
- **Shared Relational Engine:** All microservices continue to depend on the availability of the single MySQL database instance. A database outage impacts all relational services.
- **Discipline Required:** Developers must adhere to the Table Ownership Matrix and never introduce migrations for tables owned by another service.

## Follow-up

1. Share this architectural specification with your capstone team members and project advisor.
2. Use the `/develop` skill to execute Phase 1 (Security and Gateway Routing Baseline) as the first safe implementation slice.
3. Document the Table Ownership Matrix in Chapter 3 of your capstone documentation under Database Architecture and Bounded Contexts.

