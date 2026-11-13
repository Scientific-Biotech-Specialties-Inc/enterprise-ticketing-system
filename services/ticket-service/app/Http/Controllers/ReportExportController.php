<?php

namespace App\Http\Controllers;

use App\Services\ReportExportService;
use App\Services\TicketDashboardService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class ReportExportController extends Controller
{
    public function __construct(
        protected TicketDashboardService $dashboardService,
        protected ReportExportService $exports
    ) {
    }

    /**
     * POST /admin/reports/export: render the same snapshot the preview shows as csv, xlsx or pdf.
     */
    public function export(Request $request): JsonResponse|Response
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $role = strtolower(trim((string) ($user->role ?? '')));
        if (!in_array($role, ['superadmin', 'super admin', 'admin', 'systemadministrator', 'itadmin', 'it admin'], true)) {
            return response()->json([
                'status' => 'error',
                'message' => 'Access denied: Admin role required to export operational reports.',
            ], 403);
        }

        $validated = $request->validate([
            'report_type' => ['required', 'string', 'in:' . implode(',', ReportExportService::REPORT_TYPES)],
            'format' => ['required', 'string', 'in:' . implode(',', ReportExportService::FORMATS)],
            'filters' => ['sometimes', 'nullable', 'array'],
        ]);

        $input = $validated['filters'] ?? [];
        $filters = [
            'report_type' => $validated['report_type'],
            'department' => $input['department'] ?? null,
            'priority' => $input['priority'] ?? null,
            'preset' => $input['preset'] ?? null,
            'date_from' => $input['date_from'] ?? null,
            'date_to' => $input['date_to'] ?? null,
            'branch' => $input['branch'] ?? null,
            'branch_id' => $input['branch_id'] ?? null,
            'sort_by' => $input['sort_by'] ?? null,
            'sort_dir' => $input['sort_dir'] ?? null,
        ];

        // Same call the preview makes, so branch scoping (403) and the row snapshot are identical.
        $report = $this->dashboardService->getAdminReports($user, $filters, true);

        [, $rows] = $this->exports->tabulate($report);
        $format = $validated['format'];
        $syncMax = (int) env('REPORT_MAX_SYNC_ROWS', 5000);
        $pdfMax = (int) env('PDF_MAX_ROWS', 1000);

        if (count($rows) > ($format === 'pdf' ? $pdfMax : $syncMax)) {
            return response()->json([
                'status' => 'error',
                'message' => 'This report has too many rows for a ' . strtoupper($format) . ' export. Narrow the filters and try again.',
                'row_count' => count($rows),
            ], 422);
        }

        [$body, $mime] = match ($format) {
            'csv' => [$this->exports->toCsv($report), 'text/csv; charset=UTF-8'],
            'xlsx' => [$this->exports->toXlsx($report), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
            'pdf' => [$this->exports->toPdf($report), 'application/pdf'],
        };

        return response($body, 200, [
            'Content-Type' => $mime,
            'Content-Disposition' => 'attachment; filename="' . $this->exports->filename($report, $format) . '"',
            'X-Report-Row-Count' => (string) count($rows),
            'Cache-Control' => 'no-store',
        ]);
    }
}
