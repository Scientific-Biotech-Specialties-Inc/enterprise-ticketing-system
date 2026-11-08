# 0022. Child 3: Customer Service Agent Workload Dashboard

**Date**: 2026-11-01

## Summary

This specification establishes a customer service agent scoped workload and queue dashboard endpoint in ticket service. All routes are routed under `/api/ticketing/ticket/cs-dashboard-summary` to conform to Nginx gateway rules. It delivers aggregated counts for unassigned queued tickets within the agent branch, assigned tickets across statuses, official SLA risk and breach metrics, and a highlighted needs attention subset containing imminent breaches and pending reassignments. The endpoint is resilient to partial failures, returning null metrics with section error flags if a calculation fails so the user interface can display appropriate warning badges rather than misleading zero counts.

## Requirements

**User stories**:
- As a Customer Service agent, I want to see summary counts of unassigned queued tickets in my branch grouped by status so that I can pull incoming work efficiently.
- As a Customer Service agent, I want to see my directly assigned and monitored ticket counts grouped by status so that I can track my active daily workload.
- As a Customer Service agent, I want clear SLA risk metrics (At Risk and Breached counts) calculated using official SLA rules so that I never miss an urgent ticket deadline.
- As a Customer Service agent, I want a highlighted needs attention list showing my urgent tickets and pending reassignments so that I know what to act on first.
- As a Customer Service agent, I want the dashboard to load reliably even if one secondary metric calculation experiences a temporary failure.

**Acceptance criteria**:
- **AC-3.1**: The endpoint `GET /api/ticketing/ticket/cs-dashboard-summary` accepts optional parameters `limit` (default 5, max 20) and `force_refresh` (bool).
- **AC-3.2**: Queued ticket aggregation returns counts grouped by status (`open`, `pending`, `escalated`, `total_queued`) for all unassigned tickets located within the requesting CS agent branch, excluding discarded and cancelled tickets.
- **AC-3.3**: Status mappings:
  - `open`: Maps to status 'Open'.
  - `pending`: Combines statuses 'Pending', 'Pending Assignment', and 'Pending Evaluation'.
  - `pending_approval`: Maps to tickets with pending reassignment requests in `ticket_reassignments` or pending approval workflow states.
  - `escalated`: Maps to tickets with `is_escalated = 1` or status 'Escalated'.
- **AC-3.4**: Assigned ticket aggregation returns counts grouped by status (`open`, `in_progress`, `pending_approval`, `resolved`, `closed`, `total_active_assigned`) where the requesting agent is either primary assignee (`tickets.assigned_to`) or recorded collaborator in `ticket_assignments`.
- **AC-3.5**: SLA risk metrics reuse `SLAService::computeTicketSlaMetrics` and standard database queries to return:
  - `at_risk_count`: unresolved assigned tickets with resolution deadlines within 4 hours.
  - `breached_count`: unresolved assigned tickets whose resolution deadline has passed.
  - `high_priority_count`: unresolved assigned tickets with High or Critical priority.
- **AC-3.6**: The response includes a highlighted `needs_attention` subset containing up to 10 prioritized tickets matching any of the following criteria:
  1. Priority 1: Assigned ticket with SLA status 'Breached' or past `resolution_due_at`.
  2. Priority 2: Assigned ticket with SLA status 'At Risk' (less than 4 hours remaining).
  3. Priority 3: Ticket with pending reassignment or escalation awaiting action.
- **AC-3.7**: Queries are optimized with composite indexes on `tickets` table:
  - `idx_tickets_cs_assigned` on (`assigned_to`, `ticket_status_ID`, `sla_status`)
  - `idx_tickets_cs_queued` on (`branch_id`, `assigned_to`, `ticket_status_ID`)
- **AC-3.8**: Partial failure resilience: each metric aggregation (queued counts, assigned counts, SLA metrics, needs attention list) executes inside its own try catch block. If any section fails, that specific section returns `null` in the response body alongside an error description in `section_errors`, allowing the frontend to display an alert badge while still rendering all successful sections with HTTP 200.
- **AC-3.9**: Responses are cached in Redis under key `cs_dash_summary_{emp_id}` with a 60 second time to live, invalidated automatically when tickets assigned to the agent change status.

## Feature design

### Database Index Migration

Migration: `2026_11_02_000003_add_cs_dashboard_indexes_to_tickets.php`
```php
Schema::table('tickets', function (Blueprint $table) {
    $table->index(['assigned_to', 'ticket_status_ID', 'sla_status'], 'idx_tickets_cs_assigned');
    $table->index(['branch_id', 'assigned_to', 'ticket_status_ID'], 'idx_tickets_cs_queued');
});
```

### API Surface

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/ticketing/ticket/cs-dashboard-summary | GET | limit (int), force_refresh (bool) | queued_summary: object, assigned_summary: object, sla_metrics: object, needs_attention: array, section_errors: object | bearer employee (CS) | 401, 403, 500 |

### Response Structure

```json
{
  "agent_id": 14,
  "branch_id": 2,
  "queued_summary": {
    "open": 8,
    "pending": 3,
    "escalated": 1,
    "total_queued": 12
  },
  "assigned_summary": {
    "open": 4,
    "in_progress": 9,
    "pending_approval": 1,
    "resolved": 15,
    "closed": 42,
    "total_active_assigned": 14
  },
  "sla_metrics": {
    "at_risk_count": 2,
    "breached_count": 1,
    "high_priority_count": 3
  },
  "needs_attention": [
    {
      "ticket_id": 1043,
      "ticket_number": "TKT-1043",
      "title": "CT Tube High Temp Warning",
      "priority": "Critical",
      "status": "In Progress",
      "sla_status": "Breached",
      "time_remaining_formatted": "Overdue by 45m",
      "reason": "SLA Breached"
    }
  ],
  "section_errors": {
    "queued": null,
    "assigned": null,
    "sla_metrics": null,
    "needs_attention": null
  }
}
```

### Value Sourcing

| Action | Value produced / displayed | Source |
|---|---|---|
| Agent scoping | Employee ID and branch ID | Authenticated user (`$request->user()->emp_id`, `$request->user()->branch_id`) |
| Queued ticket count | Unassigned branch tickets | `tickets` table filtered by `branch_id = :branch_id` and `assigned_to IS NULL` |
| Assigned ticket count | Active agent tickets | `tickets` table filtered by `assigned_to = :emp_id` and `ticket_assignments` |
| SLA risk and breach | At Risk and Breached counts | Reused `SLAService::computeTicketSlaMetrics` and `resolution_due_at` comparison |
| Needs attention list | Prioritized urgent tickets | Sorted union of breached, at risk, and pending approval tickets assigned to agent |

### Key Invariants

1. Strict Agent Isolation: A Customer Service agent sees their own assigned workloads and unassigned tickets from their branch. They do not see individual workloads of agents in other branches unless granted Super Admin role.
2. Official SLA Logic: Risk calculation must use the project standard: a ticket is At Risk when less than 4 hours remain before `resolution_due_at`, and Breached when current time exceeds `resolution_due_at`.
3. Resilience Guarantee: The endpoint must never return HTTP 500 when only one query block encounters an error. Partial data with null flags is always preferred over total dashboard failure.
4. Total Active Workload: `total_active_assigned` reflects active unresolved tickets (open, in progress, and pending approval), keeping it distinct from historical resolved or closed counts.

## Build plan

1. Create migration `2026_11_02_000003_add_cs_dashboard_indexes_to_tickets.php`.
2. Add `getCsDashboardSummary(Employee $agent, int $limit = 5, bool $forceRefresh = false): array` in `services/ticket-service/app/Services/TicketDashboardService.php`:
   - Implement queued summary aggregation with status mapping.
   - Implement assigned summary aggregation including collaborator queries.
   - Implement SLA risk aggregation reusing `SLAService`.
   - Implement needs attention prioritized ticket extraction.
   - Wrap each section in isolated try catch blocks with `section_errors` reporting and null returns on error.
   - Cache results in Redis for 60 seconds with employee specific cache key.
3. Add `csDashboardSummary(Request $request)` in `TicketDashboardController.php`.
4. Register `GET /ticket/cs-dashboard-summary` in `routes/api.php` under `auth.subsystem`.
5. Update `frontend/web/src/pages/CSDashboard.jsx` to fetch live summary and render skeleton loaders during loading.
6. Write feature tests in `services/ticket-service/tests/Feature/CsDashboardSummaryTest.php`.

## Inline Rationale

Prior CS dashboard queries mixed global counts with unindexed scans. By separating queued branch tickets from directly assigned agent tickets and indexing on `(assigned_to, ticket_status_ID, sla_status)`, database query times drop below 20 milliseconds. Isolating each aggregation into independent try catch blocks ensures that an unexpected failure in one secondary calculation returns null rather than false zero breach counts, keeping customer service operations honest and reliable.
