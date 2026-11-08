# 0023. Admin Dashboard Live Data Integration Branch Scoping and Synchronous ETL Pipeline (Rationale)

## Context

The Admin Dashboard operated previously on client side mock collections including static trend dictionaries, synthetic status counts, hardcoded technician rosters, and fake customer satisfaction numbers. While ticket service already provided live aggregation algorithms in TicketDashboardService and AdminReportController, the user interface never consumed them. Administrators saw placeholder records instead of verified database counts and genuine resolution times.

In addition, branch scoping in the header toolbar exhibited inconsistencies. The inline facility selector dropdown omitted the global All Branches choice, preventing SuperAdmins from reviewing system wide metrics. At the same time, the backend allowed callers to pass arbitrary facility identifiers without verifying whether non superadmin operators held authorization to view other locations.

Finally, attempting to trigger either an Incremental or Full ETL sync produced an HTTP 404 Not Found error in the browser console. The frontend directed requests to a nonexistent route under analytics service rather than invoking ticket service where ticket snapshots and predictive models reside. Administrators required an on demand, synchronous trigger that refreshes cached aggregates and reports record counts immediately.

## Options considered

### Option 1: Fix in place with live endpoint wiring, role based branch scoping, and synchronous ETL route (Recommended)

Wire the React dashboard directly to ticket service live endpoints (`/api/ticketing/ticket/admin/dashboard` and `/api/ticketing/ticket/admin-reports/*`), adjust BranchSelector to respect SuperAdmin vs Admin role rules, and register `POST /api/ticketing/ticket/etl/trigger` in ticket service to execute forecast and cache refresh synchronously.

Pros:
- Reuses all recently built services without duplicate calculation logic.
- Eliminates fake data completely, ensuring operational figures match database reality.
- Provides immediate user confirmation on ETL button clicks within 200 to 400 milliseconds.
- Enforces branch boundaries on both client interface and server controller layers.

Cons:
- Requires updating chart transformers in AdminDashboard.jsx to format live backend structures into ChartJS datasets.

### Option 2: Mock fallback with background Redis queue worker

Retain the mock data generator as an offline fallback when live endpoints return empty arrays, and dispatch the ETL trigger to a background Redis queue worker with client polling.

Pros:
- Avoids modifying the frontend when microservices drop offline during local demonstrations.

Cons:
- Masks genuine backend errors by silently swapping in fictional figures.
- Adds polling complexity and state management for an operation that finishes in under half a second.
- Violates user requirements demanding complete removal of seeded and hardcoded records.

## Decision

Chosen option: Option 1: Fix in place with live endpoint wiring, role based branch scoping, and synchronous ETL route.

## Rationale

The ticketing platform already maintains comprehensive calculations for ticket volume, SLA tracking, employee capacities, and trend projections in ticket service. Maintaining parallel mock data in the frontend introduces confusing discrepancies and conceals integration flaws. Replacing the mocks with live API feeds establishes a single source of truth.

Restricting regular Admins to their designated branch while granting SuperAdmins global and per branch switching honors the security model established across the enterprise. Furthermore, running the ETL sync synchronously within the HTTP handler gives the administrator instant confirmation of completion and refreshes the view without the overhead of polling loops or Redis queue delays.

## References

- Ticket dashboard aggregation service: `services/ticket-service/app/Services/TicketDashboardService.php`
- Admin report controller: `services/ticket-service/app/Http/Controllers/AdminReportController.php`
- Ticket forecast service: `services/ticket-service/app/Services/TicketForecastService.php`

