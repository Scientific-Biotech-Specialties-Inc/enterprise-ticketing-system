# 0039. Rationale: Employee Performance Measured From Each Person's Assignment

## Context

`AdminPerformanceService::computeEmployeePerformanceData` builds each technician's numbers from tickets created in the period where they are `tickets.assigned_to` or have a `ticket_assignments` row. Three things make the result unfair:

- **Untouched work counts.** A ticket CS assigned five minutes ago, which the technician has not seen, counts in `tickets_assigned` and drags `resolution_rate` down.
- **The response clock starts too early.** Response time is `tickets.first_response_at − tickets.created_at`. Time the ticket waited in the CS queue counts against the technician, and `first_response_at` is written only once, so after a reassignment the second person has no response time at all.
- **History is deleted.** When a reassignment is approved, or CS reassigns directly, the previous holder's `ticket_assignments` row is deleted (5 places across `ticket-service` and `employee-service`). Nobody can tell who held the ticket when its SLA breached.

Constraints: about 14 files read `ticket_assignments` as "the current assignee"; SLA deadlines use business hours and a three level rule chain (branch category policy, branch override, `sla_rules`); department and overall SLA rules were just fixed in spec 0031 and must not move; admins are branch scoped (spec 0025). Leaving it as is keeps rankings that punish technicians for CS delays and for breaches that happened under someone else.

## Options considered

### Option 1: Append only history table
Add `ticket_assignment_periods`, one row per holding stretch, written at every assign, accept, hold, and release point; compute employee metrics from it.
**Pros**: `ticket_assignments` and its 14 readers untouched; full per person history; accept by deadline saved at assignment so rule edits never rewrite the past.
**Cons**: a new write at every assignment path in two services; history starts at deploy.

### Option 2: Keep released rows in `ticket_assignments`
Stop deleting; add `released_at` and a `released` status.
**Pros**: one table, no duplication.
**Cons**: every one of the ~14 readers must filter released rows or show past assignees as current; a missed filter is a visible bug in queues and access checks.

### Option 3: Rebuild history from `ticket_audit_logs`
Read assign and reassign entries from the audit log.
**Pros**: no schema change.
**Cons**: log entries vary in shape, carry no accept by deadline or hold time, and are purged by the retention job (spec 0030), so history disappears.

### Option 4: Fix the formulas only
Keep today's data; exclude unaccepted tickets and use `ticket_assignments.assigned_at`/`accepted_at` for response.
**Pros**: smallest change.
**Cons**: still loses who held a ticket at breach after reassignment, so resolution SLA stays unfair, which was a core complaint.

## Rationale

Option 1 is the only one that answers "who held it when it breached" without touching the readers that treat `ticket_assignments` as current state. That matters because those readers drive queues, access checks, and notifications, where a wrong filter is a production bug, while a gap in a new metrics table is only a reporting gap. Saving `ack_due_at` at assignment reuses `SLAService::addBusinessHours` and the existing rule chain, so the accept by time follows the same clock as the ticket's own deadlines. Running every period write inside the existing assignment transaction keeps history and assignments from drifting apart.

Decisions made on the engineer's behalf (with full design context):
- **Same transaction for period writes** (runner up: log and continue). A silent gap would make metrics wrong without anyone noticing; failing the assignment is visible and the table write is trivial.
- **One recorder service per writing service** (runner up: a shared package now). Matches how `SLAService` is already duplicated in both services; extraction is a follow-up.
- **Breach charged to the holder at `resolution_due_at`, met credited to the resolving holder** (runner up: charge final assignee). Follows the engineer's choice "charge whoever held it at the breach"; due time is the breach moment and already reflects SLA pauses.
- **Judged period count for the score minimum** = periods with a response or resolution outcome (runner up: count each outcome separately, which double counts one ticket).
- **Response time minus hold before acceptance only**, resolution time minus hold after acceptance only, so no hold second is subtracted twice.

The engineer chose "start from deploy" over copying current assignments, accepting a quiet period in exchange for not mixing two rules in one table.
