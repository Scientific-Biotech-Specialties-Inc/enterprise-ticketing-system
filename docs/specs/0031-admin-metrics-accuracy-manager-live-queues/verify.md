# Verify: Admin metrics accuracy and live manager queues · spec 0031 · updated 2026-11-05
_Steps derived from spec 0031 acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Sign in as an Admin, open `/ticketing/admin/dashboard`, Department Performance tab → exactly Service and IT are listed; IT shows "No data" if it has no tickets → AC-1
- [ ] Same dashboard → Employee Performance list, SLA by Department, and Workload by Department show only Service and IT staff and departments; no Finance, Operations, HR, Sales, or Customer Service → AC-2
- [ ] Assign an overdue ticket to nobody → it is counted in the overall SLA KPI but not in any department bar → AC-3
- [ ] Pick an employee with only open, not yet due tickets → their SLA shows "—" in the table and appears under "No data" below the SLA chart, never 100% → AC-6
- [ ] As a SuperAdmin on All Branches, a branch with no SLA outcomes shows "—" in the Cross Branch table, not 100% → AC-6
- [ ] Click Today, Last 7 Days, Last 30 Days, Last 90 Days quickly → the dashboard ends on the last range you clicked → AC-15
- [ ] Stop analytics-service (`docker stop analytics-service`), reload the dashboard → it loads in under 1 s and CSAT shows "Unavailable"; start it again and after about 60 s CSAT shows a real value or "No data" → AC-12, AC-14
- [ ] Sign in as a Service Manager (for example manager.service@sbsi.com) → dashboard shows real breached tickets (about 5 due 2026-10-06), no TICK-SRV sample rows → AC-10
- [ ] Same as an IT Manager → only tickets assigned to IT staff appear → AC-8, AC-10
- [ ] Same as a CS Manager → branch wide queue with a Department column; unassigned breaches show "Unassigned" → AC-8
- [ ] As a Service Manager, open Reassign on a breached ticket → only Service staff are offered → AC-10
- [ ] Block `/api/ticketing/manager/dashboard` in the browser devtools and reload a manager dashboard → error banner with Retry, no sample tickets; unblock and click Retry → data loads → AC-11
- [ ] With no breaches in scope → "Zero SLA Breaches!" empty state → AC-11
- [ ] After the auth module change (below), slosizante@gmail.com logs out and in → lands on the CS agent experience → AC-17

## Commands
- [ ] `docker exec ticket-service php artisan test --filter AdminMetricsAccuracyTest` → 11 passed → AC-1 to AC-9, AC-13, AC-14
- [ ] `docker exec ticket-service php artisan test --filter "AdminReportsTest|DashboardTrendBucketsTest"` → all pass → AC-2, AC-4, AC-5
- [ ] `cd frontend/web && npx vitest run src/components/manager src/pages/AdminDashboard.test.jsx src/components/admin` → all pass → AC-6, AC-10, AC-11, AC-15
- [ ] `docker exec ticket-service sh -lc 'for p in Today "Last%207%20Days" "Last%2030%20Days" "Last%2090%20Days"; do curl -s -o /dev/null -H "Authorization: Bearer frontend-dev-token" -w "%{time_total}s\n" "http://localhost:8000/api/admin/dashboard?preset=$p&forceRefresh=true"; done'` → each under 1 s; repeat without forceRefresh → each under 0.2 s → AC-12
- [ ] `docker exec ticket-service php artisan schedule:list | grep employees:sync-directory` → runs every minute → AC-13
- [ ] `docker exec ticket-service php artisan employees:sync-directory` → "Employee directory sync ok: N synced" (not failed / 403) → AC-13
- [ ] `docker exec ticket-service curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" "http://analytics-service:8000/api/csat-stats?ticket_ids=1,2,3"` → 200 in well under 0.5 s → AC-16
- [ ] In the auth module: set `user_profiles.role_id = 25` where `user_id = 68`, then `docker exec ticket-service php artisan employees:sync-directory` → employees row for slosizante@gmail.com has `position_level = Employee`, `role = customer service`, department `Customer Service` → AC-17

## Value sourcing checks
- [ ] Allowed departments: set `TICKETING_TECHNICAL_DEPARTMENTS=Service,IT,Finance`, restart ticket-service, refresh → Finance appears; remove it → Finance disappears → config source
- [ ] Department of a ticket: reassign a ticket from a Service tech to an IT tech → it moves from the Service to the IT figures (by assignee, not category) → assignee department source
- [ ] Department name matching: change an employee's department to ` it ` (spaces, lowercase) → still counted under IT → case insensitive trim
- [ ] Met / breached: resolve a ticket one minute after its deadline → counts as breached; on the deadline exactly → met → SlaOutcomeService rule
- [ ] Period by outcome date: a ticket created 40 days ago, open, due 3 days ago → breached in Last 7 Days, absent from Today → outcome date source
- [ ] "Now" for open breaches: a ticket due in 5 minutes is not breached; after 5 minutes (and the 30 s / 60 s caches) it is → server clock
- [ ] Employee ticket set: a ticket where the employee is only an active `ticket_assignments` delegate still counts for them → assignment rule
- [ ] Manager identity and scope: call `/api/manager/dashboard?branch_id=2` as a branch 1 Service Manager → scope.branch_id stays 1 → caller's employees row
- [ ] Is manager: an Admin, a CS agent, and a Finance Manager each get 403 → position_level and department check
- [ ] overdue_minutes: compare a queue row's overdue time with now minus its resolution_due_at → match within a minute
- [ ] within_sla: an open ticket on hold and past due is counted in neither within_sla nor breached → on hold excluded
- [ ] unassigned: always 0 for Service and IT managers; equals open tickets with no assignee for the CS manager
- [ ] Admin CSAT: with analytics up, a ticket with feedback shows its rating in the employee CSAT column → CsatSnapshotService ticket_ratings
- [ ] active_employees_count: deactivate one Service tech → KPI drops by one; activate a Finance employee → KPI unchanged

## Acceptance-criteria coverage
- AC-1 UI 1, Commands 1 · AC-2 UI 2, Commands 1–2 · AC-3 UI 3, value checks 2 · AC-4 Commands 1–2, value checks 4 · AC-5 value checks 5 · AC-6 UI 4–5 · AC-7 Commands 1, value checks 10–12 · AC-8 UI 9–10, value checks 8 · AC-9 value checks 9 · AC-10 UI 8–11 · AC-11 UI 12–13 · AC-12 UI 7, Commands 4 · AC-13 Commands 5–6 · AC-14 UI 7, Commands 1 · AC-15 UI 6, Commands 3 · AC-16 Commands 7 · AC-17 UI 14, Commands 8
