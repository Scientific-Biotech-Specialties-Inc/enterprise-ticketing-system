# 0022. Admin Performance Metrics and Predictive Insights Backend (Rationale)

## Context

Branch administrators require objective visibility into operational efficiency, departmental workloads, and upcoming demand. Currently, administrative views lack individual performance attribution, aggregated department metrics, and automated forecasting.

To evaluate staff objectively, individual metrics must reflect only tickets where an employee served as the designated technician (the Assigned Employee capacity). Internal tickets where an employee was merely the requester must never contaminate technician performance scores.

In addition, calculations must reuse existing Service Level Agreement classification logic from SLAService and customer ratings from analytics service rather than inventing divergent formulas. To prevent misleading charts, periods with no ticket activity must return an explicit indicator rather than a false zero percent or zero minute duration.

Finally, predictive forecasting calculations across ticket volume and recurring issue trends cannot run dynamically on every HTTP request as volume grows. The platform requires a daily scheduled background job that computes forecasts, evaluates historical sufficiency thresholds, and records job health for system monitoring.

## Options considered

### Option 1: Live On Demand Calculations on Every Request

Execute all employee aggregations, department rollups, and mathematical trend projections on the fly inside controller request threads without persistence tables.

Pros:
- Avoids creating new database tables or background jobs.
- Immediate reflection of new tickets without scheduled delays.

Cons:
- Unacceptable response latency for predictive regression and moving average loops over growing ticket tables.
- High database lock contention and CPU spikes during administrative shift changes.
- Cannot track historical forecast accuracy or calculation job health over time.

### Option 2: Dedicated Persistence Tables with Daily Batch Calculation and Internal Microservice Reuse

Host employee, department, and predictive metrics in Ticket Service where ticket, assignment, and SLA records live. Query Analytics Service for CSAT ratings over internal HTTP calls. Persist daily volume forecasts and recurring issue trends in dedicated MySQL tables populated by a scheduled background command.

Pros:
- Sub 100 millisecond response times for predictive insight endpoints.
- Reuses existing SLAService formulas, reassignment approval records, and ticket assignment tables directly.
- Full traceability of forecast job health, execution errors, and historical sample size thresholds.
- Adheres to repository rules regarding thin controllers, Redis caching, and microservice boundaries.

Cons:
- Requires database migrations for three reporting tables (`branch_ticket_forecasts`, `branch_recurring_issue_trends`, `forecast_job_runs`).
- Projections update on a daily batch cadence rather than instantaneous sub minute intervals.

## Rationale

Operational reporting and forecasting serve planning needs rather than instant millisecond state sync. Running time series math and historical baseline comparisons inside web worker requests risks database exhaustion as ticket counts climb. Precomputing daily forecast curves in dedicated storage guarantees fast administrative page rendering.

Furthermore, Ticket Service already owns tickets, technician assignments, physical branches, problem categories, machines, and SLAService. Reusing `SLAService::computeTicketSlaMetrics` guarantees complete mathematical consistency between technician alerts and executive reports.

## References

- Service Level Agreement engine: `app/Services/SLAService.php`
- Ticket dashboard metrics helper: `app/Services/TicketDashboardService.php`

