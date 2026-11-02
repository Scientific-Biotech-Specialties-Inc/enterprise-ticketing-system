<?php

namespace App\Services;

use App\Models\BranchTicketForecast;
use App\Models\BranchRecurringIssueTrend;
use App\Models\ForecastJobRun;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class TicketForecastService
{
    const MINIMUM_HISTORICAL_DAYS = 14;

    protected TicketDashboardService $dashboardService;

    public function __construct(?TicketDashboardService $dashboardService = null)
    {
        $this->dashboardService = $dashboardService ?? app(TicketDashboardService::class);
    }

    /**
     * Get predictive insights for branch (volume forecast and recurring issue trends).
     */
    public function getPredictiveInsights($user, array $filters = [], bool $forceRefresh = false): array
    {
        $branch = $this->dashboardService->resolveBranchScope($user, $filters);
        $horizonDays = max(1, min((int) ($filters['horizon_days'] ?? 7), 30));

        $isAllBranches = ($branch->slug === 'all' || (string)($branch->id ?? '') === 'all');
        if ($isAllBranches) {
            $existingForecasts = BranchTicketForecast::where('forecast_date', '>=', Carbon::today()->toDateString())
                ->select(
                    'forecast_date',
                    DB::raw('SUM(predicted_volume) as predicted_volume'),
                    DB::raw('SUM(lower_bound) as lower_bound'),
                    DB::raw('SUM(upper_bound) as upper_bound'),
                    DB::raw('MAX(calculation_status) as calculation_status')
                )
                ->groupBy('forecast_date')
                ->orderBy('forecast_date', 'asc')
                ->limit($horizonDays)
                ->get();

            if ($forceRefresh || $existingForecasts->isEmpty()) {
                $this->calculateAndPersistAllBranches($horizonDays);
                $existingForecasts = BranchTicketForecast::where('forecast_date', '>=', Carbon::today()->toDateString())
                    ->select(
                        'forecast_date',
                        DB::raw('SUM(predicted_volume) as predicted_volume'),
                        DB::raw('SUM(lower_bound) as lower_bound'),
                        DB::raw('SUM(upper_bound) as upper_bound'),
                        DB::raw('MAX(calculation_status) as calculation_status')
                    )
                    ->groupBy('forecast_date')
                    ->orderBy('forecast_date', 'asc')
                    ->limit($horizonDays)
                    ->get();
            }

            $trends = BranchRecurringIssueTrend::select(
                    'issue_type',
                    'item_id',
                    'item_name',
                    DB::raw('AVG(change_percentage) as change_percentage'),
                    DB::raw('SUM(recent_frequency) as recent_frequency'),
                    DB::raw('SUM(baseline_frequency) as baseline_frequency')
                )
                ->groupBy('issue_type', 'item_id', 'item_name')
                ->orderBy('change_percentage', 'desc')
                ->get();

            $categoryTrends = $trends->where('issue_type', 'category')->values();
            $machineTrends = $trends->where('issue_type', 'machine')->values();

            $forecastList = $existingForecasts->map(function ($f) {
                $fDate = Carbon::parse($f->forecast_date);
                return [
                    'date' => $fDate->toDateString(),
                    'day_of_week' => $fDate->format('D'),
                    'predicted_volume' => (int) $f->predicted_volume,
                    'lower_bound' => (int) $f->lower_bound,
                    'upper_bound' => (int) $f->upper_bound,
                ];
            })->all();

            return [
                'status' => 'success',
                'branch' => [
                    'id' => 'all',
                    'name' => 'All Branches',
                    'slug' => 'all',
                ],
                'historical_basis' => [
                    'days_used' => 60,
                    'minimum_days_required' => self::MINIMUM_HISTORICAL_DAYS,
                    'model' => '7-day Weighted Moving Average with Day-of-Week Seasonality (Global)',
                ],
                'volume_forecast' => $forecastList,
                'recurring_issues' => [
                    'categories' => $categoryTrends,
                    'machines' => $machineTrends,
                ],
            ];
        }

        $branchId = (int) ($branch->id ?? 1);

        // Check if cached/persisted forecasts exist
        $existingForecasts = BranchTicketForecast::where('branch_id', $branchId)
            ->where('forecast_date', '>=', Carbon::today()->toDateString())
            ->orderBy('forecast_date', 'asc')
            ->limit($horizonDays)
            ->get();

        if ($forceRefresh || $existingForecasts->isEmpty()) {
            $this->calculateAndPersistBranchForecasts($branch, $horizonDays);
            $existingForecasts = BranchTicketForecast::where('branch_id', $branchId)
                ->where('forecast_date', '>=', Carbon::today()->toDateString())
                ->orderBy('forecast_date', 'asc')
                ->limit($horizonDays)
                ->get();
        }

        // Check if historical data was insufficient
        $firstRecord = $existingForecasts->first();
        if ($firstRecord && $firstRecord->calculation_status === 'insufficient_data') {
            return [
                'status' => 'insufficient_data',
                'branch' => [
                    'id' => $branch->id ?? 1,
                    'name' => $branch->name ?? 'Main Branch',
                    'slug' => $branch->slug ?? 'main',
                ],
                'historical_basis' => [
                    'days_used' => $firstRecord->historical_days_used,
                    'minimum_days_required' => self::MINIMUM_HISTORICAL_DAYS,
                ],
                'message' => 'Insufficient historical data for reliable projection. Minimum ' . self::MINIMUM_HISTORICAL_DAYS . ' days required.',
                'volume_forecast' => [],
                'recurring_issues' => [
                    'categories' => [],
                    'machines' => [],
                ],
            ];
        }

        // Fetch recurring issue trends
        $trends = BranchRecurringIssueTrend::where('branch_id', $branchId)
            ->orderBy('change_percentage', 'desc')
            ->get();

        $categoryTrends = $trends->where('issue_type', 'category')->values();
        $machineTrends = $trends->where('issue_type', 'machine')->values();

        $forecastList = $existingForecasts->map(function ($f) {
            $fDate = Carbon::parse($f->forecast_date);
            return [
                'date' => $f->forecast_date->toDateString(),
                'day_of_week' => $fDate->format('D'),
                'predicted_volume' => (int) $f->predicted_volume,
                'lower_bound' => (int) $f->lower_bound,
                'upper_bound' => (int) $f->upper_bound,
            ];
        })->all();

        return [
            'status' => 'success',
            'branch' => [
                'id' => $branch->id ?? 1,
                'name' => $branch->name ?? 'Main Branch',
                'slug' => $branch->slug ?? 'main',
            ],
            'historical_basis' => [
                'days_used' => $firstRecord->historical_days_used ?? 14,
                'minimum_days_required' => self::MINIMUM_HISTORICAL_DAYS,
                'model' => '7-day Weighted Moving Average with Day-of-Week Seasonality',
            ],
            'volume_forecast' => $forecastList,
            'recurring_issues' => [
                'categories' => $categoryTrends,
                'machines' => $machineTrends,
            ],
        ];
    }

    /**
     * Calculate and persist daily forecasts and recurring trends for a branch.
     * Records execution timing and errors into forecast_job_runs table.
     */
    public function calculateAndPersistBranchForecasts(object $branch, int $horizonDays = 7): array
    {
        $startTime = microtime(true);
        $branchId = (int) ($branch->id ?? 1);
        $now = Carbon::now();

        try {
            // 1. Fetch historical ticket volume per day for the last 60 days
            $lookbackDays = 60;
            $historyStart = $now->copy()->subDays($lookbackDays)->startOfDay();

            $ticketQuery = DB::table('tickets as t')
                ->join('ticket_statuses as ts', 'ts.ticket_status_ID', '=', 't.ticket_status_ID')
                ->where('ts.status_name', '!=', 'Discarded')
                ->where('t.created_at', '>=', $historyStart);

            $this->dashboardService->applyBranchTicketFilter($ticketQuery, $branch);

            $dailyCounts = $ticketQuery->select(
                DB::raw('DATE(t.created_at) as ticket_date'),
                DB::raw('COUNT(*) as total')
            )
            ->groupBy('ticket_date')
            ->pluck('total', 'ticket_date')
            ->all();

            $distinctDaysCount = count($dailyCounts);

            // AC-15: Minimum historical threshold check
            if ($distinctDaysCount < self::MINIMUM_HISTORICAL_DAYS) {
                // Persist insufficient data placeholder
                for ($d = 0; $d < $horizonDays; $d++) {
                    $targetDate = $now->copy()->addDays($d)->toDateString();
                    BranchTicketForecast::updateOrCreate(
                        ['branch_id' => $branchId, 'forecast_date' => $targetDate],
                        [
                            'predicted_volume' => 0,
                            'lower_bound' => 0,
                            'upper_bound' => 0,
                            'historical_days_used' => $distinctDaysCount,
                            'calculation_status' => 'insufficient_data',
                            'calculated_at' => $now,
                        ]
                    );
                }

                $durationMs = (int) round((microtime(true) - $startTime) * 1000);

                ForecastJobRun::create([
                    'job_name' => 'tickets:calculate-forecasts',
                    'branch_id' => $branchId,
                    'status' => 'insufficient_data',
                    'records_processed' => $distinctDaysCount,
                    'duration_ms' => $durationMs,
                    'error_message' => "Insufficient historical ticket data ({$distinctDaysCount} days available, minimum 14 required).",
                    'completed_at' => $now,
                ]);

                return ['status' => 'insufficient_data', 'days_available' => $distinctDaysCount];
            }

            // 2. Compute 7-day weighted moving average and day-of-week seasonality factors
            // Weight recent 7 days: day 1 ago = 7, day 2 ago = 6, ..., day 7 ago = 1
            $weights = [7, 6, 5, 4, 3, 2, 1];
            $weightSum = array_sum($weights);
            $weightedSum = 0;

            for ($i = 0; $i < 7; $i++) {
                $checkDate = $now->copy()->subDays($i + 1)->toDateString();
                $count = (int) ($dailyCounts[$checkDate] ?? 0);
                $weightedSum += ($count * $weights[$i]);
            }

            $wmaBase = max(1.0, $weightedSum / $weightSum);

            // Compute day of week seasonality
            $dayOfWeekCounts = [1 => [], 2 => [], 3 => [], 4 => [], 5 => [], 6 => [], 7 => []];
            foreach ($dailyCounts as $dateStr => $cnt) {
                $dow = Carbon::parse($dateStr)->dayOfWeekIso; // 1 = Mon, 7 = Sun
                $dayOfWeekCounts[$dow][] = (int) $cnt;
            }

            $overallAvg = max(1.0, array_sum($dailyCounts) / count($dailyCounts));
            $dowFactors = [];

            for ($dow = 1; $dow <= 7; $dow++) {
                if (!empty($dayOfWeekCounts[$dow])) {
                    $dowAvg = array_sum($dayOfWeekCounts[$dow]) / count($dayOfWeekCounts[$dow]);
                    $dowFactors[$dow] = min(2.0, max(0.5, $dowAvg / $overallAvg));
                } else {
                    $dowFactors[$dow] = 1.0;
                }
            }

            // Persist projected horizon days (AC-14)
            for ($d = 0; $d < $horizonDays; $d++) {
                $targetCarbon = $now->copy()->addDays($d);
                $targetDate = $targetCarbon->toDateString();
                $targetDow = $targetCarbon->dayOfWeekIso;

                $seasonality = $dowFactors[$targetDow] ?? 1.0;
                $projected = max(1, (int) round($wmaBase * $seasonality));
                $lowerBound = max(0, (int) round($projected * 0.85 - 1));
                $upperBound = (int) round($projected * 1.15 + 1);

                BranchTicketForecast::updateOrCreate(
                    ['branch_id' => $branchId, 'forecast_date' => $targetDate],
                    [
                        'predicted_volume' => $projected,
                        'lower_bound' => $lowerBound,
                        'upper_bound' => $upperBound,
                        'historical_days_used' => $distinctDaysCount,
                        'calculation_status' => 'success',
                        'calculated_at' => $now,
                    ]
                );
            }

            // 3. Compute recurring issue trends (AC-16)
            $this->computeAndPersistRecurringTrends($branch, $now);

            $durationMs = (int) round((microtime(true) - $startTime) * 1000);

            // AC-18: Log execution health
            ForecastJobRun::create([
                'job_name' => 'tickets:calculate-forecasts',
                'branch_id' => $branchId,
                'status' => 'success',
                'records_processed' => $distinctDaysCount,
                'duration_ms' => $durationMs,
                'error_message' => null,
                'completed_at' => $now,
            ]);

            return ['status' => 'success', 'records_processed' => $distinctDaysCount];

        } catch (\Throwable $e) {
            $durationMs = (int) round((microtime(true) - $startTime) * 1000);
            Log::error("TicketForecastService calculation failed for branch {$branchId}: " . $e->getMessage());

            ForecastJobRun::create([
                'job_name' => 'tickets:calculate-forecasts',
                'branch_id' => $branchId,
                'status' => 'failed',
                'records_processed' => 0,
                'duration_ms' => $durationMs,
                'error_message' => $e->getMessage(),
                'completed_at' => $now,
            ]);

            throw $e;
        }
    }

    /**
     * Compute and persist recurring issue trends comparing recent 14 days vs baseline 30 days.
     */
    protected function computeAndPersistRecurringTrends(object $branch, Carbon $now): void
    {
        $branchId = (int) ($branch->id ?? 1);

        $recentStart = $now->copy()->subDays(14)->startOfDay();
        $recentEnd = $now->copy()->endOfDay();

        $baselineStart = $now->copy()->subDays(44)->startOfDay();
        $baselineEnd = $now->copy()->subDays(14)->endOfDay();

        // 1. Problem Categories
        $recentCategoriesQuery = DB::table('tickets as t')
            ->join('problem_categories as pc', 'pc.problem_category_ID', '=', 't.problem_category_ID')
            ->whereBetween('t.created_at', [$recentStart, $recentEnd]);
        $this->dashboardService->applyBranchTicketFilter($recentCategoriesQuery, $branch);
        $recentCategories = $recentCategoriesQuery
            ->select('pc.problem_category_ID as id', 'pc.category_name as name', DB::raw('COUNT(*) as total'))
            ->groupBy('pc.problem_category_ID', 'pc.category_name')
            ->get();

        $baselineCategoriesQuery = DB::table('tickets as t')
            ->join('problem_categories as pc', 'pc.problem_category_ID', '=', 't.problem_category_ID')
            ->whereBetween('t.created_at', [$baselineStart, $baselineEnd]);
        $this->dashboardService->applyBranchTicketFilter($baselineCategoriesQuery, $branch);
        $baselineCategories = $baselineCategoriesQuery
            ->select('pc.problem_category_ID as id', DB::raw('COUNT(*) as total'))
            ->groupBy('pc.problem_category_ID')
            ->pluck('total', 'id')
            ->all();

        // Clear existing trends for this branch
        BranchRecurringIssueTrend::where('branch_id', $branchId)->delete();

        foreach ($recentCategories as $rc) {
            $catId = (int) $rc->id;
            $recentFreq = (int) $rc->total;

            // Baseline normalized to 14 days (baseline period is 30 days, so * 14/30)
            $rawBaseline = (float) ($baselineCategories[$catId] ?? 0);
            $normalizedBaseline = round($rawBaseline * (14.0 / 30.0), 2);

            $changePct = 0.0;
            if ($normalizedBaseline > 0) {
                $changePct = round((($recentFreq - $normalizedBaseline) / $normalizedBaseline) * 100, 2);
            } elseif ($recentFreq > 0) {
                $changePct = 100.0;
            }

            $signal = 'stable';
            if ($changePct >= 20.0) {
                $signal = 'increasing';
            } elseif ($changePct <= -20.0) {
                $signal = 'decreasing';
            }

            BranchRecurringIssueTrend::create([
                'branch_id' => $branchId,
                'issue_type' => 'category',
                'item_id' => $catId,
                'item_name' => $rc->name,
                'recent_frequency' => $recentFreq,
                'baseline_frequency' => $normalizedBaseline,
                'change_percentage' => $changePct,
                'trend_signal' => $signal,
                'calculated_at' => $now,
            ]);
        }

        // 2. Equipment Machines
        $recentMachinesQuery = DB::table('tickets as t')
            ->join('machines as m', 'm.machine_ID', '=', 't.machine_ID')
            ->whereBetween('t.created_at', [$recentStart, $recentEnd]);
        $this->dashboardService->applyBranchTicketFilter($recentMachinesQuery, $branch);
        $recentMachines = $recentMachinesQuery
            ->select('m.machine_ID as id', 'm.machine_name as name', DB::raw('COUNT(*) as total'))
            ->groupBy('m.machine_ID', 'm.machine_name')
            ->get();

        $baselineMachinesQuery = DB::table('tickets as t')
            ->join('machines as m', 'm.machine_ID', '=', 't.machine_ID')
            ->whereBetween('t.created_at', [$baselineStart, $baselineEnd]);
        $this->dashboardService->applyBranchTicketFilter($baselineMachinesQuery, $branch);
        $baselineMachines = $baselineMachinesQuery
            ->select('m.machine_ID as id', DB::raw('COUNT(*) as total'))
            ->groupBy('m.machine_ID')
            ->pluck('total', 'id')
            ->all();

        foreach ($recentMachines as $rm) {
            $machId = (int) $rm->id;
            $recentFreq = (int) $rm->total;

            $rawBaseline = (float) ($baselineMachines[$machId] ?? 0);
            $normalizedBaseline = round($rawBaseline * (14.0 / 30.0), 2);

            $changePct = 0.0;
            if ($normalizedBaseline > 0) {
                $changePct = round((($recentFreq - $normalizedBaseline) / $normalizedBaseline) * 100, 2);
            } elseif ($recentFreq > 0) {
                $changePct = 100.0;
            }

            $signal = 'stable';
            if ($changePct >= 20.0) {
                $signal = 'increasing';
            } elseif ($changePct <= -20.0) {
                $signal = 'decreasing';
            }

            BranchRecurringIssueTrend::create([
                'branch_id' => $branchId,
                'issue_type' => 'machine',
                'item_id' => $machId,
                'item_name' => $rm->name,
                'recent_frequency' => $recentFreq,
                'baseline_frequency' => $normalizedBaseline,
                'change_percentage' => $changePct,
                'trend_signal' => $signal,
                'calculated_at' => $now,
            ]);
        }
    }

    /**
     * Calculate forecasts for all active branches in system.
     */
    public function calculateAndPersistAllBranches(int $horizonDays = 7): array
    {
        $branches = DB::table('branches')->get();
        if ($branches->isEmpty()) {
            $branches = collect([(object) ['id' => 1, 'slug' => 'main', 'name' => 'Main Branch', 'code' => 'MAIN']]);
        }

        $results = [];
        foreach ($branches as $branch) {
            $results[$branch->slug ?? $branch->id] = $this->calculateAndPersistBranchForecasts($branch, $horizonDays);
        }

        return $results;
    }
}

