import React, { useState, useEffect, useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import { ChevronDown, TrendingUp, ShieldCheck, Users, Smile, Briefcase, Info, RefreshCw, Cpu, BarChart3, LineChart, Inbox, Clock, FileText, Download, Printer, Calendar, Building2, AlertTriangle, Wrench, CheckCircle2 } from 'lucide-react';
import axiosInstance from '@/api/axiosInstance';
import { Skeleton } from '@/components/ui/skeleton';
import { exportAnalyticsToCsv, exportPredictiveToCsv, downloadPdfFromElement, triggerPdfPrint } from '@/utils/reportExportUtils';
import PredictiveAnalytics from './PredictiveAnalytics';
import { PageHeader } from '@/components/ui/page-header';
import { MetricCard } from '@/components/ui/metric-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Custom plugin to show data labels at bar ends (no external dependency)
const barLabelsPlugin = {
  id: 'barLabels',
  afterDraw(chart) {
    const { ctx, data, scales } = chart;
    if (!data || !data.datasets || chart.options?.indexAxis !== 'y') return;
    ctx.save();
    ctx.font = '600 10px Poppins, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    data.datasets.forEach((dataset, i) => {
      const meta = chart.getDatasetMeta(i);
      meta.data.forEach((bar, j) => {
        const val = dataset.data[j];
        if (val === undefined || val === null) return;
        const x = bar.x + 6;
        const y = bar.y;
        ctx.fillStyle = '#475569';
        ctx.fillText(String(val), x, y);
      });
    });
    ctx.restore();
  },
};

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler, barLabelsPlugin);

// ─── Filter Options ──────────────────────────────────────────────────────────
const FILTER_OPTIONS = ['Today', 'Last 7 Days', 'Last 30 Days', 'Last 90 Days'];

// ─── Chart Color Palette ─────────────────────────────────────────────────────
const COLORS = {
  blue: { bg: 'rgba(37, 37, 120, 0.12)', border: 'rgb(37, 37, 120)' },
  emerald: { bg: 'rgba(16, 185, 129, 0.15)', border: 'rgb(16, 185, 129)' },
  rose: { bg: 'rgba(244, 63, 94, 0.15)', border: 'rgb(244, 63, 94)' },
  amber: { bg: 'rgba(245, 158, 11, 0.15)', border: 'rgb(245, 158, 11)' },
  sky: { bg: 'rgba(14, 165, 233, 0.15)', border: 'rgb(14, 165, 233)' },
  violet: { bg: 'rgba(59, 130, 246, 0.12)', border: 'rgb(59, 130, 246)' },
  teal: { bg: 'rgba(20, 184, 166, 0.15)', border: 'rgb(20, 184, 166)' },
};

const BAR_PALETTE = [
  'rgba(37, 37, 120, 0.75)',
  'rgba(16, 185, 129, 0.75)',
  'rgba(245, 158, 11, 0.75)',
  'rgba(244, 63, 94, 0.75)',
  'rgba(14, 165, 233, 0.75)',
  'rgba(139, 92, 246, 0.75)',
  'rgba(20, 184, 166, 0.75)',
  'rgba(251, 146, 60, 0.75)',
];

// ─── Mock Data Generator ─────────────────────────────────────────────────────
const LABELS = {
  'Today': ['6AM', '8AM', '10AM', '12PM', '2PM', '4PM', '6PM', '8PM'],
  'Last 7 Days': ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  'Last 30 Days': ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
  'Last 90 Days': ['Jan', 'Feb', 'Mar'],
};

const EMPLOYEES = ['Mark Reyes', 'Ava Santos', 'Jose Cruz', 'Maria Dela Cruz', 'Carlo Tan', 'Anna Lim'];
const DEPARTMENTS = ['Service', 'Customer Service', 'Engineering', 'Quality Assurance', 'Admin'];

// ─── Section 1: Ticket Trends Mock Data ──────────────────────────────────────
const ticketTrendsMock = {
  'Today': { new: [3, 5, 8, 12, 9, 6, 4, 2], resolved: [1, 3, 6, 10, 11, 8, 5, 3] },
  'Last 7 Days': { new: [12, 19, 15, 22, 18, 8, 5], resolved: [10, 14, 13, 20, 16, 7, 4] },
  'Last 30 Days': { new: [45, 62, 58, 71], resolved: [38, 55, 52, 68] },
  'Last 90 Days': { new: [180, 210, 195], resolved: [165, 198, 188] },
};

const ticketStatusMock = {
  'Today': { open: 14, inProgress: 8, resolved: 22, closed: 31 },
  'Last 7 Days': { open: 42, inProgress: 28, resolved: 85, closed: 120 },
  'Last 30 Days': { open: 78, inProgress: 45, resolved: 236, closed: 410 },
  'Last 90 Days': { open: 95, inProgress: 62, resolved: 583, closed: 1240 },
};

// ─── Section 2: SLA Compliance Mock Data ─────────────────────────────────────
const slaComplianceMock = {
  'Today': [95, 92, 88, 91, 93, 90, 94, 96],
  'Last 7 Days': [91, 89, 93, 87, 94, 92, 90],
  'Last 30 Days': [88, 91, 85, 93],
  'Last 90 Days': [89, 91, 93],
};

const slaBreachesMock = {
  'Today': [1, 2, 3, 2, 1, 2, 1, 0],
  'Last 7 Days': [3, 5, 2, 6, 3, 1, 2],
  'Last 30 Days': [12, 8, 15, 6],
  'Last 90 Days': [35, 28, 22],
};

const resolutionSlaMock = {
  'Today': [2.1, 1.8, 2.5, 1.9, 2.3, 2.0, 1.7, 1.5],
  'Last 7 Days': [2.4, 2.1, 2.8, 1.9, 2.2, 3.1, 2.5],
  'Last 30 Days': [2.5, 2.2, 2.8, 2.0],
  'Last 90 Days': [2.6, 2.3, 2.1],
};

const slaDeptMock = {
  'Today': [96, 88, 92, 85, 98],
  'Last 7 Days': [93, 86, 90, 82, 95],
  'Last 30 Days': [91, 84, 88, 80, 94],
  'Last 90 Days': [90, 83, 87, 79, 93],
};

// ─── Section 3: Employee Performance Mock Data ───────────────────────────────
const empResolvedMock = {
  'Today': [5, 3, 7, 4, 6, 2],
  'Last 7 Days': [28, 22, 35, 18, 31, 14],
  'Last 30 Days': [112, 95, 140, 78, 125, 62],
  'Last 90 Days': [340, 290, 420, 235, 380, 190],
};

const empResponseTimeMock = {
  'Today': [12, 18, 8, 22, 10, 25],
  'Last 7 Days': [15, 20, 10, 25, 13, 28],
  'Last 30 Days': [14, 19, 11, 23, 12, 26],
  'Last 90 Days': [13, 18, 10, 22, 11, 24],
};

const empResTimeMock = {
  'Today': [1.8, 2.4, 1.2, 2.8, 1.5, 3.2],
  'Last 7 Days': [2.1, 2.8, 1.5, 3.1, 1.8, 3.5],
  'Last 30 Days': [2.0, 2.6, 1.4, 2.9, 1.7, 3.3],
  'Last 90 Days': [1.9, 2.5, 1.3, 2.7, 1.6, 3.1],
};

const empSlaMock = {
  'Today': [96, 88, 98, 82, 94, 78],
  'Last 7 Days': [93, 85, 96, 80, 91, 75],
  'Last 30 Days': [91, 83, 95, 78, 89, 73],
  'Last 90 Days': [92, 84, 94, 79, 90, 74],
};

const activeEmployeesMock = {
  'Today': 6,
  'Last 7 Days': 6,
  'Last 30 Days': 6,
  'Last 90 Days': 6,
};

// ─── Section 4: Customer Satisfaction Mock Data ──────────────────────────────
const csatMock = {
  'Today': [4.2, 4.5, 4.1, 4.6, 4.3, 4.7, 4.4, 4.8],
  'Last 7 Days': [4.3, 4.1, 4.5, 4.2, 4.6, 4.4, 4.7],
  'Last 30 Days': [4.1, 4.3, 4.4, 4.6],
  'Last 90 Days': [4.2, 4.4, 4.5],
};

// ─── Section 5: Workload Distribution Mock Data ──────────────────────────────
const workloadEmpMock = {
  'Today': [8, 5, 10, 6, 9, 3],
  'Last 7 Days': [35, 28, 45, 22, 38, 15],
  'Last 30 Days': [140, 110, 180, 90, 155, 65],
  'Last 90 Days': [420, 330, 540, 270, 465, 195],
};

const workloadDeptMock = {
  'Today': [18, 12, 8, 5, 2],
  'Last 7 Days': [75, 52, 35, 20, 8],
  'Last 30 Days': [300, 210, 140, 80, 30],
  'Last 90 Days': [900, 630, 420, 240, 90],
};

// ─── Chart Configuration Defaults ────────────────────────────────────────────
const defaultLineOptions = (title, yLabel = '') => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { position: 'top', labels: { usePointStyle: true, pointStyle: 'circle', padding: 12, font: { family: 'Poppins', size: 11 } } },
    tooltip: {
      backgroundColor: 'rgba(30, 30, 60, 0.92)',
      titleFont: { family: 'Poppins', size: 13 },
      bodyFont: { family: 'Poppins', size: 12 },
      padding: 12,
      cornerRadius: 10,
      boxPadding: 6,
    },
  },
  scales: {
    x: { grid: { display: false }, ticks: { font: { family: 'Poppins', size: 10 }, color: '#94a3b8' } },
    y: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { family: 'Poppins', size: 10 }, color: '#94a3b8' }, title: yLabel ? { display: true, text: yLabel, font: { family: 'Poppins', size: 11 }, color: '#64748b' } : undefined },
  },
});

const defaultHorizontalBarOptions = (title) => ({
  indexAxis: 'y',
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: 'rgba(30, 30, 60, 0.92)',
      titleFont: { family: 'Poppins', size: 13 },
      bodyFont: { family: 'Poppins', size: 12 },
      padding: 12,
      cornerRadius: 10,
      boxPadding: 6,
    },
  },
  scales: {
    x: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { family: 'Poppins', size: 11 }, color: '#94a3b8' } },
    y: { grid: { display: false }, ticks: { font: { family: 'Poppins', size: 11 }, color: '#475569' } },
  },
});

const defaultBarOptions = (title) => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: 'rgba(30, 30, 60, 0.92)',
      titleFont: { family: 'Poppins', size: 13 },
      bodyFont: { family: 'Poppins', size: 12 },
      padding: 12,
      cornerRadius: 10,
      boxPadding: 6,
    },
  },
  scales: {
    x: { grid: { display: false }, ticks: { font: { family: 'Poppins', size: 11 }, color: '#94a3b8' } },
    y: { grid: { color: 'rgba(0,0,0,0.04)' }, ticks: { font: { family: 'Poppins', size: 11 }, color: '#94a3b8' } },
  },
});

// ─── Reusable Components ─────────────────────────────────────────────────────
function FilterDropdown({ value, onChange }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 pr-7 text-[11px] font-medium text-gray-600 cursor-pointer hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-200"
      >
        {FILTER_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
    </div>
  );
}

function ChartViewDropdown({ value, onChange, options }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-1.5 pr-7 text-[11px] font-semibold text-blue-700 cursor-pointer hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-200"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-blue-400 pointer-events-none" />
    </div>
  );
}

function SectionCard({ icon, title, instruction, subInstruction, children, viewOptions, currentView, onViewChange }) {
  return (
    <div className="bg-card rounded-xl shadow-xs border border-border p-4 transition-all duration-200 hover:shadow-card">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            {icon}
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-dark leading-tight truncate">{title}</h3>
            {instruction && (
              <p className="text-[11px] text-slate-muted leading-tight">{instruction}</p>
            )}
            {subInstruction && (
              <p className="text-[11px] text-slate-muted leading-tight">{subInstruction}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {viewOptions && (
            <ChartViewDropdown value={currentView} onChange={onViewChange} options={viewOptions} />
          )}
        </div>
      </div>
      {/* Chart Content */}
      <div className="relative">{children}</div>
    </div>
  );
}

class AnalyticsErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, errorInfo) {
    console.error("PredictiveAnalytics error caught by ErrorBoundary:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-card rounded-xl border border-destructive/20 p-6 text-center space-y-3">
          <p className="text-sm font-semibold text-destructive">Unable to load Predictive Analytics view.</p>
          <Button
            variant="default"
            size="sm"
            onClick={() => this.setState({ hasError: false })}
          >
            Retry Analytics View
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

function StatCard({ label, value, icon, color }) {
  const colorMap = {
    blue: 'from-[#252578] to-[#3b82f6]',
    emerald: 'from-emerald-500 to-emerald-600',
    rose: 'from-rose-500 to-rose-600',
    amber: 'from-amber-500 to-amber-600',
  };
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex items-center gap-4 hover:shadow-md transition-all duration-200">
      <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${colorMap[color] || colorMap.blue} flex items-center justify-center flex-shrink-0`}>
        {icon}
      </div>
      <div>
        <p className="text-sm text-gray-500 font-medium">{label}</p>
        <p className="text-2xl font-bold text-gray-800">{value}</p>
      </div>
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('overview');

  // Filter Options
  const FILTER_OPTIONS = ['Today', 'Last 7 Days', 'Last 30 Days', 'Last 90 Days', 'Custom Range'];

  // Global Date Range State
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const default7DaysAgo = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0];
  }, []);

  const [selectedPreset, setSelectedPreset] = useState('Last 7 Days');
  const [customStartDate, setCustomStartDate] = useState(default7DaysAgo);
  const [customEndDate, setCustomEndDate] = useState(todayStr);

  // Active Date Preset fallback for mock lookups
  const activeDatePreset = useMemo(() => {
    if (selectedPreset !== 'Custom Range') return selectedPreset;
    return 'Last 7 Days';
  }, [selectedPreset]);

  const globalDateFrom = useMemo(() => {
    if (selectedPreset === 'Custom Range') return customStartDate;
    const now = new Date();
    if (selectedPreset === 'Today') return now.toISOString().split('T')[0];
    if (selectedPreset === 'Last 7 Days') {
      const d = new Date(now); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0];
    }
    if (selectedPreset === 'Last 30 Days') {
      const d = new Date(now); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0];
    }
    if (selectedPreset === 'Last 90 Days') {
      const d = new Date(now); d.setDate(d.getDate() - 90); return d.toISOString().split('T')[0];
    }
    return '';
  }, [selectedPreset, customStartDate]);

  const globalDateTo = useMemo(() => {
    if (selectedPreset === 'Custom Range') return customEndDate;
    return new Date().toISOString().split('T')[0];
  }, [selectedPreset, customEndDate]);

  // Section view toggles
  const [ticketView, setTicketView] = useState('Ticket Trends');
  const [slaView, setSlaView] = useState('Compliance');
  const [empView, setEmpView] = useState('Tickets Resolved');
  const [workloadView, setWorkloadView] = useState('By Employee');

  // Live Branch Dashboard & Analytics State
  const [dashboardData, setDashboardData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [analyticsData, setAnalyticsData] = useState({
    trends: [],
    workload: [],
    performance: { active_employees_count: 0, data: [] },
    volume: { by_category: [], by_priority: [], by_status: [] },
    equipment: [],
    predictive: null,
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState('');

  const fetchAnalytics = async (fromDate = globalDateFrom, toDate = globalDateTo, forceRefresh = false) => {
    setIsLoading(true);
    try {
      const queryParams = new URLSearchParams();
      if (selectedPreset !== 'Custom Range') {
        queryParams.append('preset', selectedPreset);
      }
      if (fromDate) queryParams.append('date_from', fromDate);
      if (toDate) queryParams.append('date_to', toDate);
      if (forceRefresh) queryParams.append('force_refresh', 'true');
      const queryString = queryParams.toString() ? `?${queryParams.toString()}` : '';

      const [dashRes, predRes] = await Promise.all([
        axiosInstance.get(`/api/ticketing/ticket/admin-dashboard${queryString}`).catch(() => null),
        axiosInstance.get(`/api/ticketing/analytics/predictive-metrics${queryString}`).catch(() => null),
      ]);

      if (dashRes?.data?.status === 'success') {
        setDashboardData(dashRes.data);
      }
      if (predRes?.data?.status === 'success') {
        setAnalyticsData(prev => ({ ...prev, predictive: predRes.data.data }));
      }
    } catch (err) {
      console.warn('Dashboard API error, using standard fallback UI metrics', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics(globalDateFrom, globalDateTo);
  }, [globalDateFrom, globalDateTo, selectedPreset]);

  const handleRunEtl = async (fullSync = false) => {
    setIsSyncing(true);
    setSyncStatusMsg(fullSync ? 'Executing Full Refresh & Sync...' : 'Refreshing Branch Metrics...');
    try {
      await fetchAnalytics(globalDateFrom, globalDateTo, true);
      setSyncStatusMsg('Branch metrics updated successfully!');
    } catch (e) {
      setSyncStatusMsg('Refresh complete.');
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncStatusMsg(''), 4000);
    }
  };

  // ─── Section 1: Ticket Trends Charts ─────────────────────────────────────
  const ticketChart = useMemo(() => {
    const liveTrends = dashboardData?.trends;
    const labels = liveTrends?.labels || LABELS[activeDatePreset] || LABELS['Last 7 Days'];

    if (ticketView === 'Ticket Trends') {
      const dataNew = liveTrends?.new || ticketTrendsMock[activeDatePreset]?.new || ticketTrendsMock['Last 7 Days'].new;
      const dataResolved = liveTrends?.resolved || ticketTrendsMock[activeDatePreset]?.resolved || ticketTrendsMock['Last 7 Days'].resolved;
      const lastNew = dataNew[dataNew.length - 1] ?? 0;
      const lastResolved = dataResolved[dataResolved.length - 1] ?? 0;

      return (
        <div>
          <div className="h-[150px]">
            <Line
              options={defaultLineOptions('Ticket Trends')}
              data={{
                labels,
                datasets: [
                  {
                    label: 'New Tickets',
                    data: dataNew,
                    borderColor: COLORS.blue.border,
                    backgroundColor: COLORS.blue.bg,
                    fill: true,
                    tension: 0.4,
                    borderWidth: 2,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#fff',
                    pointBorderWidth: 2,
                  },
                  {
                    label: 'Resolved Tickets',
                    data: dataResolved,
                    borderColor: COLORS.emerald.border,
                    backgroundColor: COLORS.emerald.bg,
                    fill: true,
                    tension: 0.4,
                    borderWidth: 2,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    pointBackgroundColor: '#fff',
                    pointBorderWidth: 2,
                  },
                ],
              }}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Latest Period: {lastNew} new, {lastResolved} resolved tickets.</p>
        </div>
      );
    } else {
      const st = dashboardData?.status_distribution;
      const openVal = st ? st.open : (ticketStatusMock[activeDatePreset]?.open ?? 14);
      const inProgressVal = st ? st.inProgress : (ticketStatusMock[activeDatePreset]?.inProgress ?? 8);
      const resolvedVal = st ? st.resolved : (ticketStatusMock[activeDatePreset]?.resolved ?? 22);
      const closedVal = st ? st.closed : (ticketStatusMock[activeDatePreset]?.closed ?? 31);

      return (
        <div>
          <div className="h-[150px]">
            <Bar
              options={defaultHorizontalBarOptions('Ticket Status Distribution')}
              data={{
                labels: ['Open', 'In Progress', 'Resolved', 'Closed'],
                datasets: [{
                  label: 'Tickets',
                  data: [openVal, inProgressVal, resolvedVal, closedVal],
                  backgroundColor: [BAR_PALETTE[2], BAR_PALETTE[0], BAR_PALETTE[1], BAR_PALETTE[3]],
                  borderRadius: 6,
                  barThickness: 18,
                }],
              }}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Active tickets: {openVal + inProgressVal} ({openVal} open, {inProgressVal} in progress).</p>
        </div>
      );
    }
  }, [activeDatePreset, ticketView, dashboardData]);

  // ─── Section 2: SLA Compliance Charts ─────────────────────────────────────
  const slaChart = useMemo(() => {
    const liveTrends = dashboardData?.trends;
    const labels = liveTrends?.labels || LABELS[activeDatePreset] || LABELS['Last 7 Days'];

    if (slaView === 'Compliance') {
      const liveCompliance = dashboardData?.sla?.compliance_trend;
      const data = liveCompliance || slaComplianceMock[activeDatePreset] || slaComplianceMock['Last 7 Days'];
      const avgVal = dashboardData?.sla?.overall_compliance ?? (data.reduce((a, b) => a + b, 0) / data.length).toFixed(1);

      return (
        <div>
          <div className="h-[150px]">
            <Line
              options={defaultLineOptions('SLA Compliance Rate (%)')}
              data={{
                labels,
                datasets: [{
                  label: 'Compliance %',
                  data,
                  borderColor: COLORS.emerald.border,
                  backgroundColor: COLORS.emerald.bg,
                  fill: true,
                  tension: 0.4,
                  borderWidth: 2,
                  pointRadius: 3,
                  pointHoverRadius: 6,
                  pointBackgroundColor: '#fff',
                  pointBorderWidth: 2,
                }],
              }}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Average SLA compliance is {avgVal}% for selected period.</p>
        </div>
      );
    } else if (slaView === 'Breaches') {
      const liveBreaches = dashboardData?.sla?.breaches_trend;
      const data = liveBreaches || slaBreachesMock[activeDatePreset] || slaBreachesMock['Last 7 Days'];
      const totalBreaches = dashboardData?.sla?.sla_breached ?? data.reduce((a, b) => a + b, 0);

      return (
        <div>
          <div className="h-[150px]">
            <Bar
              options={defaultBarOptions('SLA Breaches')}
              data={{
                labels,
                datasets: [{
                  label: 'Breaches',
                  data,
                  backgroundColor: BAR_PALETTE[3],
                  borderRadius: 4,
                  barThickness: 16,
                }],
              }}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Total SLA breaches: {totalBreaches} in selected period.</p>
        </div>
      );
    } else if (slaView === 'Resolution SLA') {
      const liveRes = dashboardData?.sla?.resolution_time_trend;
      const data = liveRes || resolutionSlaMock[activeDatePreset] || resolutionSlaMock['Last 7 Days'];
      const avgTime = dashboardData?.kpis?.avg_resolution_hours ?? (data.reduce((a, b) => a + b, 0) / data.length).toFixed(1);

      return (
        <div>
          <div className="h-[150px]">
            <Line
              options={defaultLineOptions('Avg Resolution Time (hrs)')}
              data={{
                labels,
                datasets: [{
                  label: 'Resolution Time (h)',
                  data,
                  borderColor: COLORS.amber.border,
                  backgroundColor: COLORS.amber.bg,
                  fill: true,
                  tension: 0.4,
                  borderWidth: 2,
                  pointRadius: 3,
                  pointHoverRadius: 6,
                  pointBackgroundColor: '#fff',
                  pointBorderWidth: 2,
                }],
              }}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Average resolution time: {avgTime} hours.</p>
        </div>
      );
    } else {
      const liveDept = dashboardData?.sla?.by_department;
      const deptLabels = liveDept && liveDept.length > 0 ? liveDept.map(d => d.department) : DEPARTMENTS;
      const deptData = liveDept && liveDept.length > 0
        ? liveDept.map(d => d.compliance_percentage)
        : (slaDeptMock[activeDatePreset] || slaDeptMock['Last 7 Days']);

      return (
        <div>
          <div className="h-[150px]">
            <Bar
              options={defaultHorizontalBarOptions('SLA by Department')}
              data={{
                labels: deptLabels,
                datasets: [{
                  label: 'SLA %',
                  data: deptData,
                  backgroundColor: BAR_PALETTE.slice(0, deptLabels.length),
                  borderRadius: 6,
                  barThickness: 18,
                }],
              }}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Departmental SLA compliance tracked by service rules.</p>
        </div>
      );
    }
  }, [activeDatePreset, slaView, dashboardData]);

  // ─── Section 3: Employee Performance Chart ──────────────────────────────
  const empChart = useMemo(() => {
    const liveEmpPerf = dashboardData?.employee_performance;
    const labels = liveEmpPerf?.labels && liveEmpPerf.labels.length > 0 ? liveEmpPerf.labels : EMPLOYEES;

    if (empView === 'Tickets Resolved') {
      const data = liveEmpPerf?.resolved && liveEmpPerf.resolved.length > 0
        ? liveEmpPerf.resolved
        : (empResolvedMock[activeDatePreset] || empResolvedMock['Last 7 Days']);

      return (
        <div>
          <div className="h-[150px]">
            <Bar
              options={defaultHorizontalBarOptions('Tickets Resolved by Employee')}
              data={{
                labels,
                datasets: [{
                  label: 'Tickets',
                  data,
                  backgroundColor: BAR_PALETTE.slice(0, labels.length),
                  borderRadius: 6,
                  barThickness: 16,
                }],
              }}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Total resolved tickets by active branch staff.</p>
        </div>
      );
    } else if (empView === 'Avg Response Time') {
      const data = liveEmpPerf?.response_time && liveEmpPerf.response_time.length > 0
        ? liveEmpPerf.response_time
        : (empResponseTimeMock[activeDatePreset] || empResponseTimeMock['Last 7 Days']);

      return (
        <div>
          <div className="h-[150px]">
            <Bar
              options={defaultHorizontalBarOptions('Avg Response Time (mins)')}
              data={{
                labels,
                datasets: [{
                  label: 'Response Time (mins)',
                  data,
                  backgroundColor: BAR_PALETTE[4],
                  borderRadius: 6,
                  barThickness: 16,
                }],
              }}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Average initial response time in minutes.</p>
        </div>
      );
    } else if (empView === 'Avg Resolution Time') {
      const data = liveEmpPerf?.resolution_time && liveEmpPerf.resolution_time.length > 0
        ? liveEmpPerf.resolution_time
        : (empResTimeMock[activeDatePreset] || empResTimeMock['Last 7 Days']);

      return (
        <div>
          <div className="h-[150px]">
            <Bar
              options={defaultHorizontalBarOptions('Avg Resolution Time (hrs)')}
              data={{
                labels,
                datasets: [{
                  label: 'Resolution Time (h)',
                  data,
                  backgroundColor: BAR_PALETTE[2],
                  borderRadius: 6,
                  barThickness: 16,
                }],
              }}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Average ticket resolution duration in hours.</p>
        </div>
      );
    } else {
      const data = liveEmpPerf?.sla_compliance && liveEmpPerf.sla_compliance.length > 0
        ? liveEmpPerf.sla_compliance
        : (empSlaMock[activeDatePreset] || empSlaMock['Last 7 Days']);

      return (
        <div>
          <div className="h-[150px]">
            <Bar
              options={defaultHorizontalBarOptions('SLA Compliance by Employee')}
              data={{
                labels,
                datasets: [{
                  label: 'SLA %',
                  data,
                  backgroundColor: BAR_PALETTE[1],
                  borderRadius: 6,
                  barThickness: 16,
                }],
              }}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">SLA compliance score across assigned tickets.</p>
        </div>
      );
    }
  }, [activeDatePreset, empView, dashboardData]);

  // ─── Section 4: Customer Satisfaction Chart ──────────────────────────────
  const csatChart = useMemo(() => {
    const liveCsat = dashboardData?.csat;
    const labels = liveCsat?.labels || LABELS[activeDatePreset] || LABELS['Last 7 Days'];
    const data = liveCsat?.trend || csatMock[activeDatePreset] || csatMock['Last 7 Days'];
    const avgScore = liveCsat?.average_score ?? (data[data.length - 1] || 4.7);

    return (
      <div>
        <div className="h-[150px]">
          <Line
            options={defaultLineOptions('CSAT Rating Trend (1-5)')}
            data={{
              labels,
              datasets: [{
                label: 'CSAT Score',
                data,
                borderColor: COLORS.amber.border,
                backgroundColor: COLORS.amber.bg,
                fill: true,
                tension: 0.4,
                borderWidth: 2,
                pointRadius: 3,
                pointHoverRadius: 6,
                pointBackgroundColor: '#fff',
                pointBorderWidth: 2,
              }],
            }}
          />
        </div>
        <p className="text-[11px] text-gray-500 mt-1">Average CSAT score: {avgScore}/5 based on customer ratings.</p>
      </div>
    );
  }, [activeDatePreset, dashboardData]);

  // ─── Section 5: Workload Distribution Chart ──────────────────────────────
  const workloadChart = useMemo(() => {
    const liveWorkload = dashboardData?.workload;

    if (workloadView === 'By Employee') {
      const labels = liveWorkload?.by_employee?.labels && liveWorkload.by_employee.labels.length > 0
        ? liveWorkload.by_employee.labels
        : EMPLOYEES;
      const data = liveWorkload?.by_employee?.data && liveWorkload.by_employee.data.length > 0
        ? liveWorkload.by_employee.data
        : (workloadEmpMock[activeDatePreset] || workloadEmpMock['Last 7 Days']);

      return (
        <div>
          <div className="h-[150px]">
            <Bar
              options={defaultHorizontalBarOptions('Workload by Employee')}
              data={{
                labels,
                datasets: [{
                  label: 'Tickets Assigned',
                  data,
                  backgroundColor: BAR_PALETTE.slice(0, labels.length),
                  borderRadius: 6,
                  barThickness: 16,
                }],
              }}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Active assigned tickets currently distributed across branch employees.</p>
        </div>
      );
    } else {
      const labels = liveWorkload?.by_department?.labels && liveWorkload.by_department.labels.length > 0
        ? liveWorkload.by_department.labels
        : DEPARTMENTS;
      const data = liveWorkload?.by_department?.data && liveWorkload.by_department.data.length > 0
        ? liveWorkload.by_department.data
        : (workloadDeptMock[activeDatePreset] || workloadDeptMock['Last 7 Days']);

      return (
        <div>
          <div className="h-[150px]">
            <Bar
              options={defaultHorizontalBarOptions('Workload by Department')}
              data={{
                labels,
                datasets: [{
                  label: 'Tickets Assigned',
                  data,
                  backgroundColor: BAR_PALETTE.slice(0, labels.length),
                  borderRadius: 6,
                  barThickness: 18,
                }],
              }}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Active tickets by department in this branch.</p>
        </div>
      );
    }
  }, [activeDatePreset, workloadView, dashboardData]);

  // KPI data from live dashboard
  const kpis = useMemo(() => {
    const k = dashboardData?.kpis;
    const slaVal = k?.sla_compliance_rate ?? (slaComplianceMock[activeDatePreset] || slaComplianceMock['Last 7 Days']).slice(-1)[0];
    const totalTickets = k?.total_tickets ?? (ticketStatusMock[activeDatePreset] ? (ticketStatusMock[activeDatePreset].open + ticketStatusMock[activeDatePreset].inProgress + ticketStatusMock[activeDatePreset].resolved + ticketStatusMock[activeDatePreset].closed) : 0);
    const csatVal = k?.csat_score ?? 4.67;
    const avgRes = k?.avg_resolution_hours ?? 2.1;
    const activeStaff = k?.active_employees_count ?? 6;

    return [
      { label: 'Total Tickets', value: totalTickets, icon: Inbox },
      { label: 'SLA Compliance', value: `${slaVal}%`, icon: ShieldCheck },
      { label: 'Active Staff', value: activeStaff, icon: Users },
      { label: 'CSAT Score', value: `${Number(csatVal).toFixed(1)} / 5`, icon: Smile },
      { label: 'Avg Resolution', value: `${avgRes}h`, icon: Clock },
    ];
  }, [activeDatePreset, dashboardData]);

  const dateStr = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date());

  const branchTitle = dashboardData?.branch?.name
    ? `${dashboardData.branch.name} (${dashboardData.branch.code || 'MAIN'})`
    : 'Main Branch';

  const masterExportPayload = useMemo(() => {
    return {
      trends: {
        open: dashboardData?.status_distribution?.open ?? 12,
        inProgress: dashboardData?.status_distribution?.inProgress ?? 18,
        resolved: dashboardData?.status_distribution?.resolved ?? 15,
        closed: dashboardData?.status_distribution?.closed ?? 5,
      },
      sla: {
        overall_compliance: dashboardData?.sla?.overall_compliance ?? 92.5,
        sla_met: dashboardData?.sla?.sla_met ?? 45,
        sla_breached: dashboardData?.sla?.sla_breached ?? 4,
      },
      csat: dashboardData?.csat ?? { average_score: 4.67, satisfaction_percentage: 100, total_reviews: 3 },
      predictive: analyticsData?.predictive || {},
      period: selectedPreset,
      branch: dashboardData?.branch,
    };
  }, [dashboardData, analyticsData, selectedPreset]);

  return (
    <div id="admin-analytics-report" className="space-y-6">
      {/* Page Header (Pattern A) */}
      <PageHeader
        pattern="A"
        title="Admin Dashboard"
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2 mt-1">
            <span>{dateStr}</span>
            <span className="text-slate-muted">•</span>
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 font-semibold text-xs inline-flex items-center gap-1.5 py-0.5 px-2">
              <Building2 className="w-3.5 h-3.5 text-accent" />
              Branch: {branchTitle}
            </Badge>
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {syncStatusMsg && (
              <span className="text-xs px-3 py-1.5 bg-blue-50 text-accent font-medium rounded-lg animate-pulse border border-blue-200">
                {syncStatusMsg}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadPdfFromElement(activeTab === 'predictive' ? 'predictive-analytics-report' : 'admin-analytics-report', activeTab === 'predictive' ? 'Predictive_Analytics_Report.pdf' : 'Analytics_Operational_Report.pdf')}
              className="bg-emerald-600 hover:bg-emerald-700 text-white border-transparent"
              title="Download PDF report file directly"
            >
              <FileText className="w-3.5 h-3.5 mr-1 text-white" />
              Export to PDF
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => activeTab === 'predictive' ? exportPredictiveToCsv(analyticsData?.predictive || {}) : exportAnalyticsToCsv(masterExportPayload)}
              className="bg-emerald-50 hover:bg-emerald-100 border-emerald-300 text-emerald-800"
              title="Export metrics to Excel / CSV"
            >
              <Download className="w-3.5 h-3.5 mr-1 text-emerald-600" />
              Export Excel / CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={triggerPdfPrint}
              title="Print report"
            >
              <Printer className="w-3.5 h-3.5 mr-1 text-slate-muted" />
              Print
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleRunEtl(false)}
              disabled={isSyncing}
            >
              <RefreshCw className={cn("w-3.5 h-3.5 mr-1 text-accent", isSyncing && "animate-spin")} />
              Refresh Metrics
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => handleRunEtl(true)}
              disabled={isSyncing}
            >
              <Cpu className="w-3.5 h-3.5 mr-1" />
              Full Sync
            </Button>
          </div>
        }
      />

      {/* Single-Line Toolbar: Tab Navigation & Global Date Range Filters */}
      <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3 bg-card rounded-xl shadow-xs border border-border p-2 print:hidden">
        {/* Left: Tab Switcher */}
        <div className="flex items-center gap-1 bg-page rounded-lg p-1 shrink-0 border border-border">
          <Button
            variant={activeTab === 'overview' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('overview')}
            className="text-xs"
          >
            <BarChart3 className="w-4 h-4 mr-1.5" />
            Overview
          </Button>
          <Button
            variant={activeTab === 'predictive' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('predictive')}
            className="text-xs"
          >
            <LineChart className="w-4 h-4 mr-1.5" />
            Predictive Analytics
          </Button>
        </div>

        {/* Right: Date Range Preset Filters */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className="flex items-center gap-1 bg-page rounded-lg p-1 border border-border">
            {FILTER_OPTIONS.map((opt) => (
              <Button
                key={opt}
                variant={selectedPreset === opt ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setSelectedPreset(opt)}
                className="text-xs h-7 px-2.5"
              >
                {opt}
              </Button>
            ))}
          </div>

          {selectedPreset === 'Custom Range' && (
            <div className="flex items-center gap-2 bg-page border border-border rounded-lg px-3 py-1 text-xs">
              <Calendar className="w-3.5 h-3.5 text-slate-muted" />
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="bg-card border border-border rounded px-2 py-0.5 text-xs text-slate-dark focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <span className="text-slate-muted font-medium">to</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="bg-card border border-border rounded px-2 py-0.5 text-xs text-slate-dark focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          )}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' ? (
        isLoading && !dashboardData ? (
          <div className="space-y-6 animate-pulse">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-24 bg-card rounded-xl border border-border p-4 flex flex-col justify-between">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-16" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-60 bg-card rounded-xl border border-border p-4 space-y-3">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-44 w-full" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* KPI Cards Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {kpis.map((k) => {
                const Icon = k.icon;
                return (
                  <MetricCard
                    key={k.label}
                    title={k.label}
                    value={k.value}
                    icon={<Icon className="w-5 h-5" />}
                    iconBg="bg-primary/10 text-primary"
                  />
                );
              })}
            </div>

            {/* 2-Column Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              {/* Section 1: SLA Compliance */}
              <SectionCard
                icon={<ShieldCheck className="w-4 h-4 text-white" />}
                title="SLA Compliance"
                instruction="Adherence, breaches, resolution times"
                subInstruction="and per-department performance"
                viewOptions={['Compliance', 'Breaches', 'Resolution SLA', 'SLA by Dept']}
                currentView={slaView}
                onViewChange={setSlaView}
              >
                {slaChart}
              </SectionCard>

              {/* Section 2: Employee Performance */}
              <SectionCard
                icon={<Users className="w-4 h-4 text-white" />}
                title="Employee Performance"
                instruction="Metrics across tickets, response times, and SLA."
                viewOptions={['Tickets Resolved', 'Avg Response Time', 'Avg Resolution Time', 'SLA Compliance']}
                currentView={empView}
                onViewChange={setEmpView}
              >
                {empChart}
              </SectionCard>

              {/* Section 3: Ticket Trends */}
              <SectionCard
                icon={<TrendingUp className="w-4 h-4 text-white" />}
                title="Ticket Trends"
                instruction="New vs resolved tickets and status distribution."
                viewOptions={['Ticket Trends', 'Ticket Status']}
                currentView={ticketView}
                onViewChange={setTicketView}
              >
                {ticketChart}
              </SectionCard>

              {/* Section 4: Customer Satisfaction */}
              <SectionCard
                icon={<Smile className="w-4 h-4 text-white" />}
                title="Customer Satisfaction"
                instruction="CSAT score trends over time."
              >
                {csatChart}
              </SectionCard>

              {/* Section 5: Recurring Issues (Categories & Equipment) */}
              <div className="lg:col-span-2">
                <SectionCard
                  icon={<AlertTriangle className="w-4 h-4 text-white" />}
                  title="Branch Recurring Issues & Equipment Faults"
                  instruction="Top problem categories and machine failure frequencies within selected date range."
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-1">
                    {/* Top Problem Categories */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-dark flex items-center gap-1.5">
                          <Wrench className="w-3.5 h-3.5 text-accent" />
                          Top Problem Categories
                        </span>
                        <span className="text-[11px] text-slate-muted">Volume & Frequency</span>
                      </div>
                      <div className="space-y-2">
                        {dashboardData?.recurring_issues?.top_categories?.length > 0 ? (
                          dashboardData.recurring_issues.top_categories.map((cat, idx) => (
                            <div key={cat.name || idx} className="p-2.5 bg-page rounded-lg border border-border flex items-center justify-between text-xs">
                              <span className="font-medium text-slate-dark truncate max-w-[200px]">{cat.name}</span>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-primary">{cat.count} tickets</span>
                                <Badge variant="outline" className="text-[10px] bg-blue-50 text-accent border-blue-200">
                                  {cat.percentage}%
                                </Badge>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="p-3 text-center text-xs text-slate-muted border border-dashed rounded-lg">
                            No recurring problem categories in selected period.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Top Equipment / Machines */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-dark flex items-center gap-1.5">
                          <Cpu className="w-3.5 h-3.5 text-rose-600" />
                          Frequent Equipment Issues
                        </span>
                        <span className="text-[11px] text-slate-muted">Machine Failures</span>
                      </div>
                      <div className="space-y-2">
                        {dashboardData?.recurring_issues?.top_equipment?.length > 0 ? (
                          dashboardData.recurring_issues.top_equipment.map((eq, idx) => (
                            <div key={eq.label || idx} className="p-2.5 bg-page rounded-lg border border-border flex items-center justify-between text-xs">
                              <div className="truncate max-w-[220px]">
                                <span className="font-medium text-slate-dark">{eq.name}</span>
                                {eq.serial_number && (
                                  <p className="text-[10px] text-slate-muted font-mono">{eq.serial_number}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-rose-600">{eq.count} issues</span>
                                <Badge variant="outline" className="text-[10px] bg-rose-50 text-rose-700 border-rose-200">
                                  {eq.percentage}%
                                </Badge>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="p-3 text-center text-xs text-slate-muted border border-dashed rounded-lg">
                            No machine failure reports in selected period.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </SectionCard>
              </div>

              {/* Section 6: Workload Distribution — Full Width */}
              <div className="lg:col-span-2">
                <SectionCard
                  icon={<Briefcase className="w-4 h-4 text-white" />}
                  title="Workload Distribution"
                  instruction="Ticket assignments across employees and departments."
                  viewOptions={['By Employee', 'By Department']}
                  currentView={workloadView}
                  onViewChange={setWorkloadView}
                >
                  {workloadChart}
                  {dashboardData?.workload?.details?.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-border">
                      <h4 className="text-xs font-semibold text-slate-muted mb-2">Branch Employee Assignment Breakdown</h4>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                        {dashboardData.workload.details.map((emp) => (
                          <div key={emp.emp_id} className="p-2 bg-page rounded-lg border border-border text-xs">
                            <p className="font-medium text-slate-dark truncate" title={emp.name}>{emp.name}</p>
                            <p className="text-[10px] text-slate-muted truncate">{emp.department || 'Service'}</p>
                            <div className="mt-1 flex items-center justify-between">
                              <span className="text-[10px] text-slate-muted">Active:</span>
                              <Badge variant="outline" className="h-4 px-1.5 text-[10px] bg-blue-50 text-accent font-bold">
                                {emp.active_tickets}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </SectionCard>
              </div>
            </div>
          </div>
        )
      ) : (
        <AnalyticsErrorBoundary>
          <PredictiveAnalytics selectedPreset={selectedPreset} analyticsData={analyticsData} />
        </AnalyticsErrorBoundary>
      )}
    </div>
  );
}
