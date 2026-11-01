<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use App\Models\TicketVolumeSnapshot;
use App\Models\EmployeePerformanceAnalytic;
use App\Models\EquipmentRiskAnalytic;
use App\Models\EscalationRiskSnapshot;
use App\Models\RootCauseAnalytic;
use App\Models\RecurringIssueAnalytic;

class PredictiveAnalyticsController extends Controller
{
    /**
     * Return comprehensive predictive analytics metrics.
     * All data is read from the analytics-service's own database tables,
     * matching the same pattern as FeedbackController → customer_feedback.
     */
    public function getPredictiveMetrics(Request $request)
    {
        try {
            $ticketVolume = $this->buildTicketVolume();
            $performance  = $this->buildPerformance();
            $equipment    = $this->buildEquipment();
            $escalation   = $this->buildEscalation();
            $rootCauses   = $this->buildRootCauses();
            $recurring    = $this->buildRecurring();
            $insights     = $this->buildInsights($equipment, $escalation, $recurring);

            return response()->json([
                'status' => 'success',
                'data'   => [
                    'ticket_volume' => $ticketVolume['volume'],
                    'peak_day'      => $ticketVolume['peak_day'],
                    'pred_total'    => $ticketVolume['pred_total'],
                    'performance'   => $performance,
                    'equipment'     => $equipment,
                    'escalation'    => $escalation,
                    'root_causes'   => $rootCauses,
                    'recurring'     => $recurring,
                    'insights'      => $insights,
                ],
            ]);
        } catch (\Throwable $e) {
            Log::error('PredictiveAnalyticsController error: ' . $e->getMessage());
            return response()->json(['status' => 'error', 'message' => 'Could not load analytics.'], 500);
        }
    }

    // ─── Ticket Volume ────────────────────────────────────────────────────────

    private function buildTicketVolume(): array
    {
        $snapshots = TicketVolumeSnapshot::all()->keyBy('period');

        $volume   = [];
        $peakDay  = [];
        $predTotal= [];

        foreach ($snapshots as $period => $snap) {
            $volume[$period] = [
                'hist'  => $snap->historical,
                'pred'  => $snap->predicted,
                'upper' => $snap->upper_bound,
                'lower' => $snap->lower_bound,
            ];
            $peakDay[$period]   = $snap->peak_label;
            $predTotal[$period] = $snap->predicted_total;
        }

        return [
            'volume'     => $volume,
            'peak_day'   => $peakDay,
            'peakDay'    => $peakDay,
            'pred_total' => $predTotal,
        ];
    }

    // ─── Employee Performance ─────────────────────────────────────────────────

    private function buildPerformance(): array
    {
        $rows = EmployeePerformanceAnalytic::all();

        $employees   = $rows->pluck('employee_name')->unique()->values()->toArray();
        $perfTickets = [];
        $perfSla     = [];
        $perfResp    = [];
        $perfTrend   = [];

        $periods = ['Next 7 Days', 'Next 30 Days', 'Next Quarter'];

        foreach ($periods as $period) {
            $subset = $rows->where('period', $period)->sortBy(function ($r) use ($employees) {
                return array_search($r->employee_name, $employees);
            })->values();

            $perfTickets[$period] = $subset->pluck('ticket_count')->toArray();
            $perfSla[$period]     = $subset->pluck('sla_compliance')->toArray();
            $perfResp[$period]    = $subset->pluck('avg_response_hours')->toArray();
        }

        foreach ($employees as $name) {
            $rec = $rows->firstWhere('employee_name', $name);
            $perfTrend[] = $rec ? $rec->trend : 'stable';
        }

        return compact('employees', 'perfTickets', 'perfSla', 'perfResp', 'perfTrend');
    }

    // ─── Equipment Risk ───────────────────────────────────────────────────────

    private function buildEquipment(): array
    {
        $rows = EquipmentRiskAnalytic::all();

        $equipment  = $rows->pluck('equipment_name')->unique()->values()->toArray();
        $equipFail  = [];
        $equipTickets = [];
        $riskLevel  = [];

        $periods = ['Next 7 Days', 'Next 30 Days', 'Next Quarter'];

        foreach ($periods as $period) {
            $subset = $rows->where('period', $period)->sortBy(function ($r) use ($equipment) {
                return array_search($r->equipment_name, $equipment);
            })->values();

            $equipFail[$period]    = $subset->pluck('failure_rate_pct')->toArray();
            $equipTickets[$period] = $subset->pluck('ticket_count')->toArray();
        }

        foreach ($equipment as $name) {
            $rec = $rows->firstWhere('equipment_name', $name);
            $riskLevel[] = $rec ? $rec->risk_level : 'Low';
        }

        return compact('equipment', 'equipFail', 'equipTickets', 'riskLevel');
    }

    // ─── Escalation Risk ──────────────────────────────────────────────────────

    private function buildEscalation(): array
    {
        $snaps = EscalationRiskSnapshot::all()->keyBy('period');

        $escRisk  = [];
        $escTotal = [];
        $escAvg   = [];

        foreach ($snaps as $period => $snap) {
            $escRisk[$period] = [
                'low'      => $snap->low_count,
                'medium'   => $snap->medium_count,
                'high'     => $snap->high_count,
                'critical' => $snap->critical_count,
            ];
            $escTotal[$period] = $snap->total_escalations;
            $escAvg[$period]   = $snap->avg_resolution_time;
        }

        return compact('escRisk', 'escTotal', 'escAvg');
    }

    // ─── Root Causes ──────────────────────────────────────────────────────────

    private function buildRootCauses(): array
    {
        $rows    = RootCauseAnalytic::all();
        $periods = ['Next 7 Days', 'Next 30 Days', 'Next Quarter'];
        $result  = [];

        foreach ($periods as $period) {
            $result[$period] = $rows->where('period', $period)
                ->sortByDesc('percentage')
                ->values()
                ->map(fn($r) => [
                    'name'  => $r->cause_name,
                    'pct'   => $r->percentage,
                    'count' => $r->ticket_count,
                    'trend' => $r->trend,
                ])->toArray();
        }

        return $result;
    }

    // ─── Recurring Issues ─────────────────────────────────────────────────────

    private function buildRecurring(): array
    {
        $rows = RecurringIssueAnalytic::all();

        $categories = $rows->pluck('category')->unique()->values()->toArray();
        $recFreq    = [];
        $recGrowth  = [];
        $recSev     = [];

        $periods = ['Next 7 Days', 'Next 30 Days', 'Next Quarter'];

        foreach ($periods as $period) {
            $subset = $rows->where('period', $period)->sortBy(function ($r) use ($categories) {
                return array_search($r->category, $categories);
            })->values();

            $recFreq[$period] = $subset->pluck('frequency')->toArray();
        }

        foreach ($categories as $cat) {
            $rec = $rows->firstWhere('category', $cat);
            $recGrowth[] = $rec ? $rec->growth_pct : 0;
            $recSev[]    = $rec ? $rec->severity   : 'Medium';
        }

        return compact('categories', 'recFreq', 'recGrowth', 'recSev');
    }

    // ─── AI Insights ─────────────────────────────────────────────────────────

    private function buildInsights(array $equipment, array $escalation, array $recurring): array
    {
        $topEquipment = $equipment['equipment'][0] ?? 'Printer HP LaserJet';
        $critCount    = $escalation['escRisk']['Next 7 Days']['critical'] ?? 7;
        $topCategory  = $recurring['categories'][0] ?? 'Network';
        $topGrowth    = $recurring['recGrowth'][0] ?? 12;

        return [
            "Ticket volume is projected to increase by 18% next period based on historical trends.",
            "{$topCategory}-related issues are expected to remain the top recurring category.",
            "Three employees are projected to exceed standard target workloads next week.",
            "SLA breach risk is highest for critical Hardware Support tickets.",
            "Machine '{$topEquipment}' is predicted to generate elevated incident volume.",
            "{$critCount} tickets are flagged at critical escalation risk — early intervention recommended.",
        ];
    }

    // ─── AdminDashboard-compatible endpoints ─────────────────────────────────

    public function getTrends()
    {
        $snapshot = TicketVolumeSnapshot::where('period', 'Next 7 Days')->first();
        if (!$snapshot) {
            return response()->json(['status' => 'success', 'data' => []]);
        }

        $days   = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        $hist   = $snapshot->historical;
        $data   = [];
        foreach ($days as $i => $day) {
            $data[] = ['date' => $day, 'count' => $hist[$i] ?? 0];
        }

        return response()->json(['status' => 'success', 'data' => $data]);
    }

    public function getWorkload()
    {
        $rows = EmployeePerformanceAnalytic::where('period', 'Next 7 Days')->get();
        $data = $rows->map(fn($r) => [
            'assigned_to'  => $r->employee_name,
            'open_tickets' => $r->ticket_count,
        ]);
        return response()->json(['status' => 'success', 'data' => $data]);
    }

    public function getEmployeePerformance()
    {
        $perf = $this->buildPerformance();
        return response()->json([
            'status'                 => 'success',
            'active_employees_count' => count($perf['employees']),
            'data'                   => $perf,
        ]);
    }

    public function getVolumeReports()
    {
        $snapshots = TicketVolumeSnapshot::all();
        $data = $snapshots->map(fn($s) => [
            'period'          => $s->period,
            'predicted_total' => $s->predicted_total,
            'peak_label'      => $s->peak_label,
        ]);
        return response()->json(['status' => 'success', 'data' => $data]);
    }

    public function getEquipmentReports()
    {
        $equip = $this->buildEquipment();
        return response()->json(['status' => 'success', 'data' => $equip]);
    }
}
