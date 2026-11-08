# 0022. Child 1: Admin Reports Preview and Multi Format Export

**Date**: 2026-11-01

## Summary

This specification defines the backend preview and export engine for Admin Reports in ticket service. It delivers a unified query pipeline so preview data, PDF exports, Excel exports, and CSV exports draw from the exact same underlying data snapshot. CSV and Excel spreadsheets stream synchronously via database cursors up to 5000 rows. PDF requests exceeding 500 rows or 30 days trigger background queued generation with Reverb WebSocket notifications and time limited download tokens, subject to a 1000 row PDF ceiling. All endpoints are routed under `/api/ticketing/ticket/admin/reports/` to conform to Nginx gateway rules, and server side branch scoping is strictly enforced.

## Requirements

**User stories**:
- As a branch Admin, I want to preview operational report data using configurable filters (report type, date presets, custom ranges, department, priority) before exporting.
- As a branch Admin, I want to export reports to formatted PDF, structured Excel, and delimited CSV formats with clean headers, filter summaries, and timestamps.
- As a branch Admin, I want large PDF exports to generate in the background and notify me when ready so that my browser session never times out.
- As a branch Admin, I want to see a clear no records found message when filters match no data, distinct from a system error.

**Acceptance criteria**:
- **AC-1.1**: The endpoint `POST /api/ticketing/ticket/admin/reports/preview` returns a structured preview response with column headers, summary metrics, row count, and up to 100 preview rows within 800 milliseconds for standard queries.
- **AC-1.2**: If a query returns 0 rows, the preview endpoint returns HTTP 200 with `count: 0`, `data: []`, and `message: "No records found matching the specified filters."`
- **AC-1.3**: The endpoint `POST /api/ticketing/ticket/admin/reports/export` accepts report type, export format ('pdf', 'excel', 'csv'), filter parameters, and optional `force_sync` boolean.
- **AC-1.4**: CSV and Excel exports stream directly to the client response using database chunking cursors for datasets up to 5000 rows, returning immediate binary downloads with appropriate `Content-Disposition` headers.
- **AC-1.5**: PDF export requests exceeding 500 rows or 30 days trigger background queued generation via `GenerateReportExportJob`. The endpoint returns HTTP 202 with `status: 'queued'` and `export_uuid`.
- **AC-1.6**: PDF exports enforce a hard ceiling of 1000 rows to prevent DomPDF memory exhaustion. When a PDF query exceeds 1000 rows, the export includes a notification note indicating truncation.
- **AC-1.7**: When background generation finishes, the job stores the file in `storage/app/private/reports/`, generates a 24 hour secure download token, and broadcasts a `report.export.completed` event over the private employee WebSocket channel `private-employee.{emp_id}`.
- **AC-1.8**: The endpoint `GET /api/ticketing/ticket/admin/reports/download/{token}` streams the file. It allows access via Bearer header or via `?token=` query parameter to support direct browser link clicks.
- **AC-1.9**: PDF exports use DomPDF and include official branch title, report name, generation timestamp, applied filter summary, and tabular data with alternating row highlights.
- **AC-1.10**: Excel exports format as structured XML spreadsheets with designated column data types, bold headers, and filter metadata sheets.
- **AC-1.11**: CSV exports provide RFC 4180 compliant comma delimited streams with standard header rows.
- **AC-1.12**: Server side branch scoping is enforced on every query based on the authenticated employee branch, ignoring any conflicting client submitted branch parameter.
- **AC-1.13**: Customer satisfaction report rows are retrieved from analytics service via internal HTTP call (`GET /api/analytics/feedback/csat-export`), falling back to empty records if analytics service is temporarily unreachable.

## Feature design

### Data model additions

Table: `report_exports`
```sql
CREATE TABLE report_exports (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    export_uuid VARCHAR(36) NOT NULL UNIQUE,
    requested_by BIGINT UNSIGNED NULL,
    branch_id INT UNSIGNED NOT NULL,
    report_type VARCHAR(64) NOT NULL,
    format ENUM('pdf', 'excel', 'csv') NOT NULL,
    filters_applied JSON NOT NULL,
    status ENUM('pending', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'pending',
    row_count INT UNSIGNED NOT NULL DEFAULT 0,
    file_path VARCHAR(255) NULL,
    file_size_bytes BIGINT UNSIGNED NULL,
    download_token VARCHAR(64) NULL UNIQUE,
    expires_at TIMESTAMP NULL,
    error_message TEXT NULL,
    created_at TIMESTAMP NULL,
    updated_at TIMESTAMP NULL,
    INDEX idx_rep_exp_user (requested_by, status),
    INDEX idx_rep_exp_branch (branch_id),
    INDEX idx_rep_exp_token (download_token)
);
```
Note: `requested_by` is nullable and omits a restrictive foreign key constraint to safely support Super Admin system actions where user ID is 0 or external.

### Supported Report Types and Summary Metrics

1. `ticket_volume`: Ticket count, status breakdown, priorities, and creation dates. Summary metrics: Total tickets, percentage resolved, open backlog.
2. `sla_compliance`: Ticket subjects, assigned staff, SLA targets, actual resolution hours, and compliance status. Summary metrics: SLA compliance rate, average resolution time in hours.
3. `department_performance`: Department name, active technician count, open tickets, resolved count, breach count, and average resolution time. Summary metrics: Top performing department, total active staff.
4. `equipment_maintenance`: Equipment name, serial number, department, incident count, downtime hours (computed from ticket creation to resolution), and risk classification. Summary metrics: Total incidents, average downtime hours.
5. `csat_satisfaction`: Ticket identifier, customer facility, rating score (1 to 5), category, feedback comment, and submission date (fetched via analytics service HTTP client). Summary metrics: Average CSAT score, total responses.
6. `predictive_risk`: Forecast periods, projected influx counts, peak days, recurring issue flags, and escalation risks (queried from `admin_performance_and_forecast_tables`). Summary metrics: Projected peak day, average escalation risk percentage.

### API Surface

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /api/ticketing/ticket/admin/reports/preview | POST | report_type (string, req), filters (object, req) | count: int, data: array, headers: array, summary: object, message: string | bearer employee | 400, 401, 403, 422 |
| /api/ticketing/ticket/admin/reports/export | POST | report_type (string, req), format (string, req), filters (object, req), force_sync (bool) | file stream OR { status: 'queued', export_uuid: string } | bearer employee | 400, 401, 403, 422 |
| /api/ticketing/ticket/admin/reports/download/{token} | GET | token (string, in path or query) | file stream download | bearer or token query | 401, 403, 404, 410 |
| /api/ticketing/ticket/admin/reports/jobs | GET | page (int), limit (int) | jobs: array, pagination: object | bearer employee | 401, 403 |

### Value Sourcing

| Action | Value produced / displayed | Source |
|---|---|---|
| Preview query | Tabular dataset rows and columns | Database queries on tickets, machines, and employees in ticket service |
| CSAT report rows | Ratings, surveys, and comments | Internal HTTP GET to `analytics-service` with branch filter |
| Server side scoping | Branch ID constraint | Authenticated employee record (`$request->user()->branch_id`) |
| Asynchronous notification | Download link and completion status | Generated download token and `report_exports` record |
| PDF and Excel metadata | Filter summary block | JSON payload decoded from `filters_applied` |
| No data condition | Distinct message | Checked row count equal to zero |

### Key Invariants

1. Single Data Pipeline: Preview generation and export file builders must call the exact same `ReportDataQueryService::extractReportDataset()` method. No independent SQL query may be written for exports.
2. File Cleanup: Completed export files expire after 24 hours. A scheduled command `php artisan reports:cleanup-expired` runs daily to delete physical files and mark records expired.
3. Secure Download: The download token must be a high entropy cryptographically secure random string (64 characters).
4. Memory Protection: DomPDF rendering is capped at 1000 rows. CSV and Excel spreadsheet streaming handles up to 5000 rows synchronously using cursor chunking to maintain low memory usage.

## Build plan

1. Create migration `2026_11_02_000001_create_report_exports_table.php` in `services/ticket-service/database/migrations/` (avoiding timestamp collision).
2. Create model `ReportExport.php` in `services/ticket-service/app/Models/`.
3. Implement `ReportDataQueryService.php` in `services/ticket-service/app/Services/`:
   - Methods: `extractReportDataset(string $reportType, array $filters, int $branchId, bool $isSuperAdmin)`.
   - Implement queries for all 6 report types, reusing `SLAService` and HTTP client for analytics service CSAT data.
4. Implement `ReportExportRendererService.php`:
   - `renderPdf(string $title, array $headers, array $rows, array $filters)` via DomPDF with 1000 row cap.
   - `renderExcel(string $title, array $headers, array $rows, array $filters)` via structured XML spreadsheet streaming.
   - `renderCsv(array $headers, array $rows)` via PHP memory stream and `fputcsv`.
5. Implement `GenerateReportExportJob.php` queued job dispatching Reverb broadcast on completion to `private-employee.{emp_id}`.
6. Implement `ReportExportController.php` with `preview`, `export`, `download`, and `jobs` actions.
7. Register routes in `services/ticket-service/routes/api.php` under `auth.subsystem` with `/ticket/admin/reports/` prefix.
8. Update `frontend/web/src/pages/AdminReports.jsx` to fetch previews from `/api/ticketing/ticket/admin/reports/preview` and download from `/api/ticketing/ticket/admin/reports/export`.
9. Add unit and feature tests in `services/ticket-service/tests/Feature/AdminReportsExportTest.php`.

## Inline Rationale

Reusing a single data extraction method guarantees that what an Admin sees on the screen during preview matches character for character what downloads in the PDF or Excel spreadsheet. Using native PHP XML and CSV cursor streaming handles standard operational exports in under two seconds without queue latency. DomPDF is already installed in the microservice and delivers clean PDFs, with a 1000 row safety ceiling protecting against memory exhaustion.
