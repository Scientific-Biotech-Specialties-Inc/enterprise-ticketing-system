# 0031. Rationale: Admin Metrics Accuracy, Live Manager Queues, and Fast Dashboard Ranges

## Context

The admin dashboard at `/ticketing/admin/dashboard` and the Service, IT, and CS manager dashboards are the surfaces leadership uses to judge team performance. Five problems were reported, and investigation on 2026-11-05 found a concrete cause for each.

**Department list.** Admin department figures group active employees by their `employees.department` value. That value is copied from the central auth module, which holds every company department (Finance, Sales & Marketing, HR, Operations, Executive, RA/QA, Admin, and more). Only Service and IT staff handle tickets, so most of the listed departments are noise. The ticket-service `departments` table has Service, IT, and Customer Service.

**100% SLA for everyone.** `AdminPerformanceService` counts every assigned ticket that is not breached as "met". That includes tickets with no SLA configured, tickets on hold, and open tickets that are not yet due. Period filtering is by `created_at`, so the old tickets that actually breached (tickets 1 to 5, due 2026-10-06) fall outside Last 7 and Last 30 Days, and the tickets that remain in the window are all open and not yet due. The result is a 100% figure that reflects no completed work. Department figures have the same flaw, and SLA by Department attributes unassigned tickets to `Service`. On the frontend, the Cross Branch table defaults a missing rate to 100.

**Seeded manager queue.** All three manager dashboards fetch the CS incoming list, guess each ticket's department in the browser from keywords in the department and category text, and when that guess yields nothing, substitute hardcoded `MOCK_*_TICKETS`. They also prepend a hardcoded staff list to the assign modal. Tickets have no department column. The only reliable signal is the assignee's department.

**slosizante@gmail.com.** In the auth module (`user_profiles` user_id 68) this user has role Manager (21) in Customer Service (17). The ticket-service sync maps that to `position_level = Manager`, `technical_role = Customer Service Manager`, so the frontend routes them to the CS Manager dashboard. Any local edit is overwritten by the next sync.

**Slow range switching.** Timings taken inside the `ticket-service` container with 16 tickets in the database:

| Run | Last 30 Days | Last 90 Days |
|---|---|---|
| Cold cache plus employee sync | 4.35 s | 4.34 s |
| Cold cache | 2.02 s | 2.02 s |
| Warm cache | 0 s | 0 s |

A direct call to `analytics-service` `/api/csat-stats` with a 10 second limit returned nothing and timed out. The dashboard waits the full 2 s (dashboard CSAT) plus the CSAT timeout in `AdminPerformanceService` on each cold load. The auth module call in `TicketDashboardService::syncEmployeesFromAuthModule()` returns **403** because, unlike the copy in `EmployeeDirectoryController`, it omits the `X-Internal-Secret` header. That sync also runs inside the request whenever its 60 s lock has expired. With so little data, almost all of the latency is waiting on outside services, not computing.

Not fixing this leaves leadership making staffing and SLA decisions on numbers that are invented or padded, and managers unable to tell real breaches from sample rows.

## Options considered

### Option 1: Fix in place with shared rules and a server manager endpoint (chosen)

Correct the existing computations through one shared SLA outcome service and a config based department list, add one manager endpoint, and move the auth sync and CSAT off the request path with tight limits.

**Pros**:
- Smallest blast radius: existing endpoints and response shapes stay. The frontend changes are mostly removals.
- One definition of SLA compliance across admin and manager surfaces.
- Fixes the latency at its measured cause, not by layering more caches.

**Cons**:
- Touches the 2300 line `TicketDashboardService` and two other services at once, so regressions are possible in figures this spec doesn't change.
- Department scope is config, not data, so it needs a deploy to change.

### Option 2: Move admin and manager metrics to analytics-service (strangler)

Build new metric endpoints in `analytics-service`, fed by ticket events, and switch the dashboards over one panel at a time.

**Pros**:
- Puts reporting where AGENTS.md says it belongs, and gives precomputed figures that are fast at any data size.

**Cons**:
- `analytics-service` is the component currently hanging. Building on it before fixing it adds risk.
- Needs an event pipeline and backfill for 16 tickets of data. That's large effort for a correctness bug, and weeks before anything visible changes.

### Option 3: Patch the frontend only

Filter departments, hide 100% values, drop the mock fallback, and prefetch all presets in the browser.

**Pros**:
- No backend deploy. Quickest to ship.

**Cons**:
- The backend still returns wrong SLA figures, so reports and exports stay wrong.
- Department guessing and SLA math stay in the browser, which is the source of the manager page problem.
- Prefetching four presets multiplies the slow outside calls instead of removing them.

## Rationale

The forces here are correctness first, then speed, on a small dataset (16 tickets). Every wrong number traces to a specific line of computation, and every second of latency traces to a blocking outside call. That points to fixing in place: the defects are local, the endpoints are sound, and rewriting into another service (Option 2) would rebuild on the one component that is currently broken. Option 3 hides symptoms in one client while the API, the reports, and the PDF exports keep serving wrong data.

Within Option 1, these choices are yours:
- **Departments from config, not a table flag.** Only two departments exist and that rarely changes. A migration and admin UI would be extra machinery to maintain.
- **SLA by outcome date, counting only tickets with a real outcome.** This is what the existing KPI tooltip already promises, and it lets an old ticket that breaches this week show up this week.
- **Ticket department from the assignee only.** Accepted tradeoff: unassigned breaches appear only for the CS Manager, who owns triage.
- **The role change goes through the auth module,** since it is the source of truth and the sync would overwrite anything local.

These calls were mine (recommended, not asked):
- **Move the sync to the scheduler instead of fixing the header in place.** A sync inside a read request makes dashboard latency depend on the auth module's health. The runner up, adding the header and keeping the in request sync, fixes the 403 but keeps the coupling.
- **CSAT: a 500 ms limit, a 60 s down flag, and a 120 s snapshot cache.** A down flag answers "what happens when it's stale" clearly: CSAT shows as unavailable, never invented. The runner up was a separate CSAT request from the browser (the user did not pick it). It would also work, but it adds a second loading state to a page that already has many.
- **Manager endpoint cached for 30 s with a Refresh override.** It's short enough for an operational queue and keeps repeated loads cheap. The runner up, no cache, is fine at today's volume but grows linearly.
- **Manager identity from the caller's `employees.position_level`.** That is the field the sync already derives from the auth role, so it changes automatically when AC-17 is applied. The runner up, reading the JWT role string, would duplicate the frontend's fuzzy `includes('manager')` checks on the server.
- **A request sequence guard on the admin page.** Without it, a slow Last 7 Days response can land after a fast Last 30 Days response and show the wrong range. That would look like the "slow" bug even after the backend is fixed.

### Evidence: data checked on 2026-11-05

| Check | Result |
|---|---|
| Active employees by department (ticket-service) | Admin 1, Customer Service 4, Executive 1, Finance 4, HR 2, IT 5, Operations 6, RA/QA 1, Sales & Marketing 9, Service 10 |
| `departments` table | Service, IT, Customer Service |
| slosizante@gmail.com, ticket-service `employees` | emp_id 1096, role `customer service`, position_level `Manager`, technical_role `Customer Service Manager`, department `Customer Service`, branch 1 |
| slosizante@gmail.com, auth module | users.id 68, user_profiles role_id 21 (Manager), department_id 17 (Customer Service), branch_id 12 |
| Auth roles | 25 Employee, 21 Manager (among others) |
| Tickets | 16 total; tickets 1 to 5 open with `resolution_due_at` 2026-10-06 (breached, Service assignees except ticket 4 unassigned); 9 to 16 due 2026-11-09 |
| `/api/csat-stats` direct call, 10 s limit | timed out, 0 bytes |
| Auth `/api/internal/users-by-roles` without secret | 403 in 0.51 s |
