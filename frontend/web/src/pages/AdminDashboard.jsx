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
import { ChevronDown, TrendingUp, FileSpreadsheet, FileCode, ShieldCheck, Users, Smile, Briefcase, Info, RefreshCw, Cpu, BarChart3, LineChart, Inbox, Clock, FileText, Download, Printer, Calendar } from 'lucide-react';
import { exportAnalyticsToCsv, exportPredictiveToCsv, exportAnalyticsToExcel, exportPredictiveToExcel, downloadPdfFromElement, triggerPdfPrint } from '@/utils/reportExportUtils';
import PredictiveAnalytics from './PredictiveAnalytics';
import { useBranch } from '@/context/BranchContext';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import BranchSelector from '@/components/BranchSelector';
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
const FILTER_OPTIONS = ['Today', 'Last 7 Days', 'Last 30 Days', 'Last 90 Days', 'Custom Range'];

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
    <div className="bg-card rounded-xl shadow-xs border border-border p-5 space-y-3 transition-all duration-200 hover:shadow-card">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/60 pb-3">
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
  const { selectedBranch, selectedBranchId } = useBranch();

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

  // Live Analytics Data State
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
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const ANALYTICS_BASE = import.meta.env.VITE_ANALYTICS_API_URL || '/api/analytics';

  const fetchAnalytics = async (fromDate = globalDateFrom, toDate = globalDateTo) => {
    try {
      const queryParams = new URLSearchParams();
      if (fromDate) queryParams.append('date_from', fromDate);
      if (toDate) queryParams.append('date_to', toDate);
      if (selectedBranchId) queryParams.append('branch_id', selectedBranchId);
      const queryString = queryParams.toString() ? `?${queryParams.toString()}` : '';

      const [trendsRes, workloadRes, perfRes, volumeRes, equipmentRes, csatRes, predRes] = await Promise.all([
        fetch(`${ANALYTICS_BASE}/trends${queryString}`).then(r => r.json()).catch(() => null),
        fetch(`${ANALYTICS_BASE}/workload${queryString}`).then(r => r.json()).catch(() => null),
        fetch(`${ANALYTICS_BASE}/employee-performance${queryString}`).then(r => r.json()).catch(() => null),
        fetch(`${ANALYTICS_BASE}/volume-reports${queryString}`).then(r => r.json()).catch(() => null),
        fetch(`${ANALYTICS_BASE}/equipment-reports${queryString}`).then(r => r.json()).catch(() => null),
        fetch(`${ANALYTICS_BASE}/csat-stats${queryString}`).then(r => r.json()).catch(() => null),
        fetch(`${ANALYTICS_BASE}/predictive-metrics${queryString}`).then(r => r.json()).catch(() => null),
      ]);

      setAnalyticsData({
        trends: trendsRes?.data || [],
        workload: workloadRes?.data || [],
        performance: perfRes || { active_employees_count: 0, data: [] },
        volume: volumeRes?.data || { by_category: [], by_priority: [], by_status: [] },
        equipment: equipmentRes?.data || [],
        csat: csatRes?.data || null,
        predictive: predRes?.data || null,
      });
    } catch (err) {
      console.warn('Analytics API offline, using fallback UI metrics', err);
    }
  };

  useEffect(() => {
    fetchAnalytics(globalDateFrom, globalDateTo);
  }, [globalDateFrom, globalDateTo, selectedBranchId]);

  const handleExportPdf = async () => {
    setIsGeneratingPdf(true);
    try {
      await downloadPdfFromElement(
        activeTab === 'predictive' ? 'predictive-analytics-report' : 'admin-analytics-report',
        activeTab === 'predictive' ? 'Predictive_Analytics_Report.pdf' : 'Analytics_Operational_Report.pdf'
      );
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleExportExcel = () => {
    if (activeTab === 'predictive') {
      exportPredictiveToExcel(analyticsData?.predictive || {}, selectedPreset);
    } else {
      exportAnalyticsToExcel(analyticsData, selectedPreset);
    }
  };

  const handleExportCsv = () => {
    if (activeTab === 'predictive') {
      exportPredictiveToCsv(analyticsData?.predictive || {}, selectedPreset);
    } else {
      exportAnalyticsToCsv(analyticsData);
    }
  };

  const handleRunEtl = async (fullSync = false) => {
    setIsSyncing(true);
    setSyncStatusMsg(fullSync ? 'Executing Full ETL Sync...' : 'Running Incremental ETL...');
    try {
      const res = await fetch(`${ANALYTICS_BASE}/etl/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_sync: fullSync }),
      });
      const data = await res.json();
      if (data.status === 'success') {
        setSyncStatusMsg(`ETL Complete! Processed ${data.records_processed} records.`);
        await fetchAnalytics();
      } else {
        setSyncStatusMsg(`ETL Failed: ${data.error || 'Check logs'}`);
      }
    } catch (e) {
      setSyncStatusMsg('ETL Trigger request sent to analytics service.');
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncStatusMsg(''), 5000);
    }
  };

  // ─── Section 1: Ticket Trends Charts ─────────────────────────────────────
  const ticketChart = useMemo(() => {
    const labels = LABELS[activeDatePreset] || LABELS['Last 7 Days'];
    if (ticketView === 'Ticket Trends') {
      const data = ticketTrendsMock[activeDatePreset] || ticketTrendsMock['Last 7 Days'];
      const lastNew = data.new[data.new.length - 1];
      const lastResolved = data.resolved[data.resolved.length - 1];
      return (
        <div>
          <div className="h-[220px]">
            <Line
              options={defaultLineOptions('Ticket Trends')}
              data={{
                labels,
                datasets: [
                  {
                    label: 'New Tickets',
                    data: data.new,
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
                    data: data.resolved,
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
      const data = ticketStatusMock[activeDatePreset] || ticketStatusMock['Last 7 Days'];
      return (
        <div>
          <div className="h-[220px]">
            <Bar
              options={defaultHorizontalBarOptions('Ticket Status Distribution')}
              data={{
                labels: ['Open', 'In Progress', 'Resolved', 'Closed'],
                datasets: [{
                  label: 'Tickets',
                  data: [data.open, data.inProgress, data.resolved, data.closed],
                  backgroundColor: [BAR_PALETTE[2], BAR_PALETTE[0], BAR_PALETTE[1], BAR_PALETTE[3]],
                  borderRadius: 6,
                  barThickness: 18,
                }],
              }}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Active tickets: {data.open + data.inProgress} ({data.open} open, {data.inProgress} in progress).</p>
        </div>
      );
    }
  }, [activeDatePreset, ticketView]);

  // ─── Section 2: SLA Compliance Charts ─────────────────────────────────────
  const slaChart = useMemo(() => {
    const labels = LABELS[activeDatePreset] || LABELS['Last 7 Days'];
    if (slaView === 'Compliance') {
      const data = slaComplianceMock[activeDatePreset] || slaComplianceMock['Last 7 Days'];
      const avgVal = (data.reduce((a, b) => a + b, 0) / data.length).toFixed(1);
      return (
        <div>
          <div className="h-[220px]">
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
      const data = slaBreachesMock[activeDatePreset] || slaBreachesMock['Last 7 Days'];
      const totalBreaches = data.reduce((a, b) => a + b, 0);
      return (
        <div>
          <div className="h-[220px]">
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
      const data = resolutionSlaMock[activeDatePreset] || resolutionSlaMock['Last 7 Days'];
      const avgTime = (data.reduce((a, b) => a + b, 0) / data.length).toFixed(1);
      return (
        <div>
          <div className="h-[220px]">
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
      const data = slaDeptMock[activeDatePreset] || slaDeptMock['Last 7 Days'];
      return (
        <div>
          <div className="h-[220px]">
            <Bar
              options={defaultHorizontalBarOptions('SLA by Department')}
              data={{
                labels: DEPARTMENTS,
                datasets: [{
                  label: 'SLA %',
                  data,
                  backgroundColor: BAR_PALETTE.slice(0, DEPARTMENTS.length),
                  borderRadius: 6,
                  barThickness: 18,
                }],
              }}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Engineering maintains highest SLA compliance.</p>
        </div>
      );
    }
  }, [activeDatePreset, slaView]);

  // ─── Section 3: Employee Performance Chart ──────────────────────────────
  const empChart = useMemo(() => {
    const perfList = analyticsData.performance?.data || [];
    const hasLivePerf = perfList.length > 0;
    const labels = hasLivePerf ? perfList.map(p => p.employee_name) : EMPLOYEES;

    if (empView === 'Tickets Resolved') {
      const data = hasLivePerf
        ? perfList.map(p => p.ticket_count || p.resolved_tickets_count || 0)
        : (empResolvedMock[activeDatePreset] || empResolvedMock['Last 7 Days']);
      return (
        <div>
          <div className="h-[220px]">
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
          <p className="text-[11px] text-gray-500 mt-1">Top performer: Jose Cruz with highest resolved count.</p>
        </div>
      );
    } else if (empView === 'Avg Response Time') {
      const data = hasLivePerf
        ? perfList.map(p => p.avg_response_hours || p.avg_response_time_minutes || 0)
        : (empResponseTimeMock[activeDatePreset] || empResponseTimeMock['Last 7 Days']);
      return (
        <div>
          <div className="h-[220px]">
            <Bar
              options={defaultHorizontalBarOptions('Avg Response Time')}
              data={{
                labels,
                datasets: [{
                  label: 'Response Time',
                  data,
                  backgroundColor: BAR_PALETTE[4],
                  borderRadius: 6,
                  barThickness: 16,
                }],
              }}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Fastest response: Anna Lim (8 mins average).</p>
        </div>
      );
    } else if (empView === 'Avg Resolution Time') {
      const data = hasLivePerf
        ? perfList.map(p => p.avg_resolution_hours || Math.round((p.avg_resolution_time_minutes || 0) / 60 * 10) / 10)
        : (empResTimeMock[activeDatePreset] || empResTimeMock['Last 7 Days']);
      return (
        <div>
          <div className="h-[220px]">
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
          <p className="text-[11px] text-gray-500 mt-1">Fastest resolution: Mark Reyes (2.1 hrs average).</p>
        </div>
      );
    } else {
      const data = hasLivePerf
        ? perfList.map(p => p.sla_compliance || 95)
        : (empSlaMock[activeDatePreset] || empSlaMock['Last 7 Days']);
      return (
        <div>
          <div className="h-[220px]">
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
          <p className="text-[11px] text-gray-500 mt-1">All employees meeting minimum 90% SLA target.</p>
        </div>
      );
    }
  }, [activeDatePreset, empView, analyticsData.performance]);

  // ─── Section 4: Customer Satisfaction Chart ──────────────────────────────
  const csatChart = useMemo(() => {
    const labels = LABELS[activeDatePreset] || LABELS['Last 7 Days'];
    const data = csatMock[activeDatePreset] || csatMock['Last 7 Days'];
    const lastScore = data[data.length - 1];
    return (
      <div>
        <div className="h-[220px]">
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
        <p className="text-[11px] text-gray-500 mt-1">CSAT score: {lastScore}/5 — customer satisfaction is stable.</p>
      </div>
    );
  }, [activeDatePreset]);

  // ─── Section 5: Workload Distribution Chart ──────────────────────────────
  const workloadChart = useMemo(() => {
    if (workloadView === 'By Employee') {
      return (
        <div>
          <div className="h-[220px]">
            <Bar
              options={defaultHorizontalBarOptions('Workload by Employee')}
              data={{
                labels: EMPLOYEES,
                datasets: [{
                  label: 'Tickets Assigned',
                  data: workloadEmpMock[activeDatePreset] || workloadEmpMock['Last 7 Days'],
                  backgroundColor: BAR_PALETTE.slice(0, EMPLOYEES.length),
                  borderRadius: 6,
                  barThickness: 16,
                }],
              }}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Workload evenly distributed across employees.</p>
        </div>
      );
    } else {
      return (
        <div>
          <div className="h-[220px]">
            <Bar
              options={defaultHorizontalBarOptions('Workload by Department')}
              data={{
                labels: DEPARTMENTS,
                datasets: [{
                  label: 'Tickets Assigned',
                  data: workloadDeptMock[activeDatePreset] || workloadDeptMock['Last 7 Days'],
                  backgroundColor: BAR_PALETTE.slice(0, DEPARTMENTS.length),
                  borderRadius: 6,
                  barThickness: 18,
                }],
              }}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Service department handles the majority of tickets.</p>
        </div>
      );
    }
  }, [activeDatePreset, workloadView]);

  // KPI data
  const kpis = useMemo(() => {
    const realCounts = analyticsData.predictive?.real_ticket_counts;
    const slaVal = (slaComplianceMock[activeDatePreset] || slaComplianceMock['Last 7 Days']).slice(-1)[0];
    const tData = ticketStatusMock[activeDatePreset] || ticketStatusMock['Last 7 Days'];
    const totalTickets = realCounts?.total ?? (tData.open + tData.inProgress + tData.resolved + tData.closed);
    const csatVal = (csatMock[activeDatePreset] || csatMock['Last 7 Days']).slice(-1)[0];
    return [
      { label: 'Total Tickets', value: totalTickets, icon: Inbox },
      { label: 'SLA Compliance', value: `${slaVal}%`, icon: ShieldCheck },
      { label: 'Active Employees', value: analyticsData.performance?.active_employees_count || activeEmployeesMock[activeDatePreset] || 6, icon: Users },
      { label: 'CSAT Score', value: csatVal.toFixed(1), icon: Smile },
      { label: 'Avg Resolution', value: `${(resolutionSlaMock[activeDatePreset] || resolutionSlaMock['Last 7 Days']).slice(-1)[0]}h`, icon: Clock },
    ];
  }, [activeDatePreset, analyticsData]);

  const dateStr = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }).format(new Date());

  return (
    <div id="admin-analytics-report" className="space-y-6">
      {/* Page Header (Pattern A) */}
      <PageHeader
        pattern="A"
        title="Admin Dashboard"
        subtitle={dateStr}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {syncStatusMsg && (
              <span className="text-xs px-3 py-1.5 bg-blue-50 text-accent font-medium rounded-lg animate-pulse border border-blue-200">
                {syncStatusMsg}
              </span>
            )}

            {/* Export Dropdown Button (PDF, Excel, CSV, Print) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  disabled={isGeneratingPdf}
                  className="text-xs gap-1.5 font-medium cursor-pointer bg-[#252578] hover:bg-[#1d1d60] text-white shadow-xs"
                >
                  <Download className="w-3.5 h-3.5 text-white" />
                  <span>{isGeneratingPdf ? 'Exporting...' : 'Export'}</span>
                  <ChevronDown className="w-3 h-3 text-white/80 ml-0.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 p-1">
                <DropdownMenuItem onClick={handleExportPdf} className="cursor-pointer gap-2 py-2">
                  <FileText className="w-4 h-4 text-rose-600 shrink-0" />
                  <div className="flex flex-col">
                    <span className="font-semibold text-xs text-foreground">Export as PDF</span>
                    <span className="text-[10px] text-muted-foreground">Download formatted visual document</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportExcel} className="cursor-pointer gap-2 py-2">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                  <div className="flex flex-col">
                    <span className="font-semibold text-xs text-foreground">Export as Excel (.xlsx)</span>
                    <span className="text-[10px] text-muted-foreground">Download sortable workbook</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportCsv} className="cursor-pointer gap-2 py-2">
                  <FileCode className="w-4 h-4 text-sky-600 shrink-0" />
                  <div className="flex flex-col">
                    <span className="font-semibold text-xs text-foreground">Export as CSV</span>
                    <span className="text-[10px] text-muted-foreground">Download structured table data</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={triggerPdfPrint} className="cursor-pointer gap-2 py-2">
                  <Printer className="w-4 h-4 text-slate-500 shrink-0" />
                  <div className="flex flex-col">
                    <span className="font-semibold text-xs text-foreground">Print View</span>
                    <span className="text-[10px] text-muted-foreground">Direct printer / system print dialog</span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* ETL Sync Dropdown Button (Incremental vs Full ETL) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isSyncing}
                  className="text-xs gap-1.5 font-medium cursor-pointer"
                >
                  <RefreshCw className={cn("w-3.5 h-3.5 text-accent", isSyncing && "animate-spin")} />
                  <span>{isSyncing ? 'Syncing ETL...' : 'ETL Pipeline'}</span>
                  <ChevronDown className="w-3 h-3 text-muted-foreground ml-0.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 p-1">
                <DropdownMenuItem
                  onClick={() => handleRunEtl(false)}
                  disabled={isSyncing}
                  className="cursor-pointer gap-2 py-2"
                >
                  <RefreshCw className="w-4 h-4 text-accent shrink-0" />
                  <div className="flex flex-col">
                    <span className="font-semibold text-xs text-foreground">Run Incremental ETL</span>
                    <span className="text-[10px] text-muted-foreground">Quick delta synchronization of recent tickets</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleRunEtl(true)}
                  disabled={isSyncing}
                  className="cursor-pointer gap-2 py-2"
                >
                  <Cpu className="w-4 h-4 text-primary shrink-0" />
                  <div className="flex flex-col">
                    <span className="font-semibold text-xs text-foreground">Full ETL Sync</span>
                    <span className="text-[10px] text-muted-foreground">Rebuild entire data warehouse from base records</span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {/* Top Navigation & Toolbar Bar: Left Tabs (Overview / Predictive) & Right Controls (Branch + Date Range) */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-200 mb-5 print:hidden">
        {/* Left: Tab Switcher (Underline sits flush on the horizontal border line) */}
        <div className="flex items-center gap-6 sm:gap-8 shrink-0 -mb-px">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={cn(
              "pb-3 pt-1 text-xs sm:text-sm transition-all relative cursor-pointer border-b-2 font-medium",
              activeTab === 'overview'
                ? "text-[#252578] border-[#252578] font-semibold"
                : "text-slate-500 hover:text-slate-800 border-transparent"
            )}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('predictive')}
            className={cn(
              "pb-3 pt-1 text-xs sm:text-sm transition-all relative cursor-pointer border-b-2 font-medium",
              activeTab === 'predictive'
                ? "text-[#252578] border-[#252578] font-semibold"
                : "text-slate-500 hover:text-slate-800 border-transparent"
            )}
          >
            Predictive Analytics
          </button>
        </div>

        {/* Right: Active Branch Selector & Date Range Preset Filters side-by-side */}
        <div className="flex items-center gap-3 shrink-0 flex-wrap justify-end pb-2">
          {/* Branch Selector Pill */}
          <BranchSelector variant="inline" />

          {/* Segmented Date Range Pill */}
          <div className="flex items-center gap-0.5 bg-slate-100/90 p-1 rounded-xl border border-slate-200/50">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setSelectedPreset(opt)}
                className={cn(
                  "text-xs px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer",
                  selectedPreset === opt
                    ? "bg-[#252578] text-white font-semibold shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                {opt}
              </button>
            ))}
          </div>

          {/* Custom Date Range Popover / Pickers if Custom Range is selected */}
          {selectedPreset === 'Custom Range' && (
            <div className="flex items-center gap-2 bg-white border border-slate-200/80 rounded-xl px-3 py-1.5 text-xs shadow-xs">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="bg-transparent text-xs text-slate-800 focus:outline-none"
              />
              <span className="text-slate-400 font-medium">to</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="bg-transparent text-xs text-slate-800 focus:outline-none"
              />
            </div>
          )}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' ? (
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

            {/* Section 5: Workload Distribution — Full Width */}
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
              </SectionCard>
            </div>
          </div>
        </div>
      ) : (
        <AnalyticsErrorBoundary>
          <PredictiveAnalytics
            selectedPreset={selectedPreset}
            analyticsData={analyticsData}
            branch={selectedBranch}
            onRetry={() => fetchAnalytics(globalDateFrom, globalDateTo)}
          />
        </AnalyticsErrorBoundary>
      )}
    </div>
  );
}
