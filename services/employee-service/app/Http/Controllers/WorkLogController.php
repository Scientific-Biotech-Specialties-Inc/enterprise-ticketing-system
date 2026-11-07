<?php

namespace App\Http\Controllers;

use App\Services\WorkLogService;
use Illuminate\Http\Request;

class WorkLogController extends Controller
{
    public function __construct(
        private readonly WorkLogService $workLogService
    ) {}

    public function index(Request $request)
    {
        $user = $request->user();

        if (!$user || $user instanceof \App\Models\Client) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $validated = $request->validate([
            'date_from' => 'nullable|date',
            'date_to' => 'nullable|date',
            'status' => 'nullable|string|in:pending,approved,rejected',
            'per_page' => 'nullable|integer|min:1|max:100',
        ]);

        $workLogs = $this->workLogService->getWorkLogs(
            $user->emp_id,
            $validated['date_from'] ?? null,
            $validated['date_to'] ?? null,
            $validated['status'] ?? null,
            $validated['per_page'] ?? 15,
        );

        return response()->json($workLogs);
    }

    public function store(Request $request)
    {
        $user = $request->user();

        if (!$user || $user instanceof \App\Models\Client) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $validated = $request->validate([
            'ticket_id'        => 'nullable|integer|exists:tickets,ticket_ID',
            'task_description' => ['required', 'string', 'max:1000', new \App\Rules\NoMarkup()],
            'hours_spent'      => 'required|numeric|min:0.1|max:24',
            'log_date'         => 'required|date|before_or_equal:today',
        ]);

        $log = \App\Models\WorkLog::create([
            'employee_id'      => $user->emp_id,
            'ticket_id'        => $validated['ticket_id'] ?? null,
            'task_description' => $validated['task_description'],
            'hours_spent'      => $validated['hours_spent'],
            'log_date'         => $validated['log_date'],
            'status'           => 'pending',
        ]);

        return response()->json(['message' => 'Work log saved successfully.', 'work_log' => $log], 201);
    }

    public function export(Request $request)
    {
        $user = $request->user();

        if (!$user || $user instanceof \App\Models\Client) {
            return response()->json(['message' => 'Unauthorized'], 401);
        }

        $validated = $request->validate([
            'date_from' => 'nullable|date',
            'date_to' => 'nullable|date',
            'status' => 'nullable|string|in:pending,approved,rejected',
            'format' => 'required|string|in:csv,pdf',
        ]);

        $workLogs = $this->workLogService->getFilteredWorkLogsForExport(
            $user->emp_id,
            $validated['date_from'] ?? null,
            $validated['date_to'] ?? null,
            $validated['status'] ?? null,
        );

        if ($workLogs->isEmpty()) {
            return response()->json(['message' => 'No work logs found for the given filters.'], 404);
        }

        $filename = 'work_logs_' . now()->format('Y_m_d_His');

        if ($validated['format'] === 'csv') {
            $csv = $this->workLogService->generateCsv($workLogs);

            return response($csv, 200, [
                'Content-Type' => 'text/csv',
                'Content-Disposition' => 'attachment; filename="' . $filename . '.csv"',
            ]);
        }

        $pdfOutput = $this->workLogService->generatePdf($workLogs);

        return response($pdfOutput, 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'attachment; filename="' . $filename . '.pdf"',
        ]);
    }
}
