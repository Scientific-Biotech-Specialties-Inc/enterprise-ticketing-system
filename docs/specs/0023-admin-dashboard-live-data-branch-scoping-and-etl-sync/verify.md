# Verify: Admin Dashboard Live Data Integration Branch Scoping and Synchronous ETL Pipeline · spec 0023 · updated 2026-11-01
_Steps derived from spec 0023 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

- [ ] Log in as SuperAdmin and view the inline branch selector → confirms All Branches (Global Scope) appears as the primary choice alongside physical facilities → AC-1
- [ ] Log in as regular Admin assigned to Branch A → confirms branch selector shows Branch A as a static or locked facility pill with no ability to switch facilities → AC-2
- [ ] Select All Branches as SuperAdmin → confirms dashboard aggregates tickets across all physical facilities without branch filters → AC-3
- [ ] Review Ticket Trends, Status Distribution, SLA Compliance, Employee Performance, and Workload Distribution cards → confirms live data loads from `/api/ticketing/ticket/admin/dashboard` and reports endpoints → AC-4
- [ ] Search `AdminDashboard.jsx` source code → confirms zero occurrences of `ticketTrendsMock`, `ticketStatusMock`, `slaComplianceMock`, `slaBreachesMock`, `empResolvedMock`, `csatScoresMock`, `workloadByDeptMock`, `EMPLOYEES`, or `DEPARTMENTS` → AC-5
- [ ] Select a branch and date range with zero tickets → confirms explicit empty state card renders stating no ticket activity recorded rather than broken zero lines → AC-6
- [ ] Click Run Incremental ETL or Full ETL Sync in Admin Dashboard toolbar → confirms button shows spinning progress indicator and displays processed record count and execution duration in milliseconds → AC-7, AC-8
- [ ] Click ETL Sync in SuperAdminDashboard toolbar → confirms request invokes `/api/ticketing/ticket/etl/trigger` synchronously and updates timestamp → AC-8

## Commands

- [ ] `docker exec ticket-service php artisan test tests/Feature/AdminReportsTest.php` → all 12 feature test scenarios pass with 206 assertions → AC-1, AC-2, AC-3, AC-7
- [ ] `npm --prefix frontend/web test src/pages/AdminDashboard.test.jsx` → all 4 component tests pass covering live data, empty states, branch locking, and synchronous ETL sync → AC-2, AC-4, AC-5, AC-6, AC-7, AC-8
- [ ] `npm --prefix frontend/web test src/context/BranchContext.test.jsx` → all 3 context tests pass verifying global branch selection and operational employee branch locking → AC-1, AC-2
- [ ] `npm --prefix frontend/web run build` → production bundle builds cleanly with zero compilation errors → AC-4, AC-5

## Acceptance criteria coverage

- AC-1: covered by test `superadmin can query all branches scope` in `AdminReportsTest.php` and `BranchSelector.jsx` inline mapping over `branchList`
- AC-2: covered by test `admin branch isolation blocks cross branch query and all branches` in `AdminReportsTest.php` and component test `locks regular non superadmin Admin users to their assigned facility`
- AC-3: covered by test `superadmin can query all branches scope` in `AdminReportsTest.php` and `applyBranchTicketFilter` bypass for `slug === 'all'`
- AC-4: covered by component test `renders live KPI metrics and trend charts without static mock constants` and API wiring to `/api/ticketing/ticket/admin/dashboard`
- AC-5: covered by source inspection and component test verifying total elimination of mock arrays from `AdminDashboard.jsx`
- AC-6: covered by component test `renders informative empty state cards when has_data is false` and `computeAdminDashboardData` payload property `has_data`
- AC-7: covered by test `synchronous etl trigger endpoint executes and invalidates cache` in `AdminReportsTest.php` and `POST /api/ticketing/ticket/etl/trigger`
- AC-8: covered by component test `triggers synchronous ETL sync and reports processed records` in `AdminDashboard.test.jsx`

