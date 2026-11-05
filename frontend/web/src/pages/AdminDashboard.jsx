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
import {
  ChevronDown,
  TrendingUp,
  FileSpreadsheet,
  FileCode,
  ShieldCheck,
  Users,
  Smile,
  Briefcase,
  RefreshCw,
  Cpu,
  Inbox,
  Clock,
  FileText,
  Download,
  Printer,
  Calendar,
} from 'lucide-react';
import {
  exportAnalyticsToCsv,
  exportPredictiveToCsv,
  exportAnalyticsToExcel,
  exportPredictiveToExcel,
  downloadPdfFromElement,
  triggerPdfPrint,
} from '@/utils/reportExportUtils';
import PredictiveAnalytics from './PredictiveAnalytics';
import DepartmentPerformanceView from '@/components/admin/DepartmentPerformanceView';
import EmployeePerformanceView from '@/components/admin/EmployeePerformanceView';
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
import { cn } from '@/lib/utils';
import {
  getAdminDashboard,
  getAdminEmployeePerformance,
  getAdminDepartmentPerformance,
  getAdminPredictiveInsights,
  triggerEtlSync,
} from '@/services/ticketService';

// Custom plugin to show data labels at bar ends (no external dependency)
const barLabelsPlugin = {
  id: 'barLabels',
  afterDraw(chart) {
    const { ctx, data } = chart;
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

// ─── Chart Configuration Defaults ────────────────────────────────────────────
const defaultLineOptions = (title, yLabel = '') => ({
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
    y: {
      grid: { color: 'rgba(0,0,0,0.04)' },
      ticks: { font: { family: 'Poppins', size: 11 }, color: '#94a3b8' },
      title: yLabel ? { display: true, text: yLabel, font: { family: 'Poppins', size: 11 } } : undefined,
    },
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

function EmptyStateCard({
  title = 'No ticket activity recorded for this period',
  description = 'There are no ticket logs matching the selected branch and date window.',
}) {
  return (
    <div className="h-[220px] flex flex-col items-center justify-center text-center p-6 bg-slate-50/60 rounded-xl border border-dashed border-slate-200">
      <Inbox className="w-8 h-8 text-slate-400 mb-2 stroke-1" />
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      <p className="text-xs text-slate-500 mt-1 max-w-sm">{description}</p>
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
    console.error('PredictiveAnalytics error caught by ErrorBoundary:', error, errorInfo);
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

// ─── Main Dashboard ──────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  const { selectedBranch, selectedBranchId, selectBranch, isSuperAdmin } = useBranch();
  const [branchSortBy, setBranchSortBy] = useState('total_tickets');
  const [branchSortDir, setBranchSortDir] = useState('desc');

  // Global Date Range State
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const default7DaysAgo = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0];
  }, []);

  const [selectedPreset, setSelectedPreset] = useState('Last 7 Days');
  const [customStartDate, setCustomStartDate] = useState(default7DaysAgo);
  const [customEndDate, setCustomEndDate] = useState(todayStr);

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

  // Live Analytics Data State (AC-4, AC-5)
  const [dashboardData, setDashboardData] = useState(null);
  const [analyticsData, setAnalyticsData] = useState({
    dashboard: null,
    performance: { active_employees_count: 0, employees: [] },
    departments: { departments: [] },
    predictive: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState('');
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  // Fetch live operational and performance records in a single unified request
  const fetchAnalytics = async (fromDate = globalDateFrom, toDate = globalDateTo) => {
    setIsLoading(true);
    try {
      const params = {};
      if (fromDate) params.date_from = fromDate;
      if (toDate) params.date_to = toDate;
      if (selectedPreset && selectedPreset !== 'Custom Range') params.preset = selectedPreset;
      if (isSuperAdmin && selectedBranchId !== null && selectedBranchId !== undefined) {
        params.branch_id = selectedBranchId;
      }

      const dashRes = await getAdminDashboard(params).catch((err) => {
        console.warn('Admin dashboard live fetch error:', err);
        return null;
      });

      const unifiedEmployees = dashRes?.employee_performance?.employees
        || dashRes?.employee_performance?.list
        || (Array.isArray(dashRes?.employee_performance) ? dashRes.employee_performance : []);
      const unifiedDepartments = Array.isArray(dashRes?.departments)
        ? dashRes.departments
        : (dashRes?.departments?.departments || []);

      setDashboardData(dashRes || null);
      setAnalyticsData((prev) => ({
        ...prev,
        dashboard: dashRes || null,
        performance: {
          active_employees_count: dashRes?.kpis?.active_employees_count ?? unifiedEmployees.length,
          employees: unifiedEmployees,
        },
        departments: {
          departments: unifiedDepartments,
        },
      }));
    } catch (err) {
      console.warn('Operational data fetch failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Decoupled predictive insights fetch (only re-runs on branch scope changes or ETL sync)
  const fetchPredictiveInsights = async () => {
    try {
      const predRes = await getAdminPredictiveInsights(
        isSuperAdmin && selectedBranchId ? { branch_id: selectedBranchId } : {}
      ).catch((err) => {
        console.warn('Admin predictive insights live fetch error:', err);
        return null;
      });
      setAnalyticsData((prev) => ({
        ...prev,
        predictive: predRes || null,
      }));
    } catch (err) {
      console.warn('Predictive insights fetch failed:', err);
    }
  };

  const effectiveBranchKey = isSuperAdmin ? String(selectedBranchId || 'all') : 'locked';

  useEffect(() => {
    fetchAnalytics(globalDateFrom, globalDateTo);
  }, [globalDateFrom, globalDateTo, effectiveBranchKey, selectedPreset]);

  useEffect(() => {
    fetchPredictiveInsights();
  }, [effectiveBranchKey, isSuperAdmin]);

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
      exportPredictiveToExcel(analyticsData?.predictive, selectedPreset);
    } else {
      exportAnalyticsToExcel(dashboardData || analyticsData, selectedPreset);
    }
  };

  const handleExportCsv = () => {
    if (activeTab === 'predictive') {
      exportPredictiveToCsv(analyticsData?.predictive, selectedPreset);
    } else {
      exportAnalyticsToCsv(dashboardData || analyticsData, selectedPreset);
    }
  };

  // Synchronous ETL Trigger (AC-7, AC-8)
  const handleRunEtl = async (fullSync = false) => {
    setIsSyncing(true);
    setSyncStatusMsg(fullSync ? 'Executing Full ETL Sync...' : 'Running Incremental ETL...');
    try {
      const payload = {
        full_sync: fullSync,
        branch_id: isSuperAdmin ? (selectedBranchId || 'all') : 'current',
      };
      const data = await triggerEtlSync(payload);
      if (data?.status === 'success') {
        const count = data.records_processed ?? 0;
        const duration = data.duration_ms ?? 0;
        setSyncStatusMsg(`ETL Complete! Processed ${count} records (${duration}ms).`);
        await Promise.all([fetchAnalytics(), fetchPredictiveInsights()]);
      } else {
        setSyncStatusMsg(`ETL: ${data?.message || 'Sync failed'}`);
      }
    } catch (e) {
      const errMsg = e?.response?.data?.message || e.message || 'Error executing ETL pipeline';
      setSyncStatusMsg(`ETL Failed: ${errMsg}`);
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncStatusMsg(''), 5000);
    }
  };

  // AC-6: Explicit empty state evaluation
  const hasData = useMemo(() => {
    if (!dashboardData) return false;
    if (dashboardData.has_data === false) return false;
    const total = dashboardData.kpis?.total_tickets ?? 0;
    return total > 0;
  }, [dashboardData]);

  // ─── Section 1: Ticket Trends Charts ─────────────────────────────────────
  const ticketChart = useMemo(() => {
    if (!hasData) {
      return <EmptyStateCard />;
    }

    const trends = dashboardData?.trends || {};
    const labels = trends.labels || [];

    if (ticketView === 'Ticket Trends') {
      const newSeries = trends.new || [];
      const resSeries = trends.resolved || [];
      const lastNew = newSeries.length > 0 ? newSeries[newSeries.length - 1] : 0;
      const lastResolved = resSeries.length > 0 ? resSeries[resSeries.length - 1] : 0;

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
                    data: newSeries,
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
                    data: resSeries,
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
      const st = dashboardData?.status_distribution || {};
      const openCount = st.open || 0;
      const inProgressCount = st.inProgress || 0;
      const resolvedCount = st.resolved || 0;
      const closedCount = st.closed || 0;

      return (
        <div>
          <div className="h-[220px]">
            <Bar
              options={defaultHorizontalBarOptions('Ticket Status Distribution')}
              data={{
                labels: ['Open', 'In Progress', 'Resolved', 'Closed'],
                datasets: [{
                  label: 'Tickets',
                  data: [openCount, inProgressCount, resolvedCount, closedCount],
                  backgroundColor: [BAR_PALETTE[2], BAR_PALETTE[0], BAR_PALETTE[1], BAR_PALETTE[3]],
                  borderRadius: 6,
                  barThickness: 18,
                }],
              }}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            Active tickets: {openCount + inProgressCount} ({openCount} open, {inProgressCount} in progress).
          </p>
        </div>
      );
    }
  }, [hasData, dashboardData, ticketView]);

  // ─── Section 2: SLA Compliance Charts ─────────────────────────────────────
  const slaChart = useMemo(() => {
    if (!hasData) {
      return <EmptyStateCard title="No SLA records available" description="No tickets were evaluated for SLA compliance in this period." />;
    }

    const sla = dashboardData?.sla || {};
    const labels = dashboardData?.trends?.labels || [];

    if (slaView === 'Compliance') {
      const data = sla.compliance_trend || [];
      const overallRate = dashboardData?.kpis?.sla_compliance_rate ?? 0;
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
          <p className="text-[11px] text-gray-500 mt-1">Average SLA compliance is {overallRate}% for selected period.</p>
        </div>
      );
    } else if (slaView === 'Breaches') {
      const data = sla.breaches_trend || [];
      const totalBreaches = sla.sla_breached ?? 0;
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
      const data = sla.resolution_time_trend || [];
      const avgTime = dashboardData?.kpis?.avg_resolution_hours ?? 0;
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
      const deptList = Array.isArray(sla.by_department) ? sla.by_department : [];
      const labelsDept = deptList.map(d => d.name || d.department || 'General');
      const dataDept = deptList.map(d => d.compliance_rate ?? d.compliance_percentage ?? 0);

      return (
        <div>
          <div className="h-[220px]">
            <Bar
              options={defaultHorizontalBarOptions('SLA by Department')}
              data={{
                labels: labelsDept.length > 0 ? labelsDept : ['Service'],
                datasets: [{
                  label: 'SLA %',
                  data: dataDept.length > 0 ? dataDept : [0],
                  backgroundColor: BAR_PALETTE.slice(0, Math.max(1, labelsDept.length)),
                  borderRadius: 6,
                  barThickness: 18,
                }],
              }}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Operational department SLA adherence breakdown.</p>
        </div>
      );
    }
  }, [hasData, dashboardData, slaView]);

  // ─── Section 3: Employee Performance Chart ──────────────────────────────
  const empChart = useMemo(() => {
    const perfEmployees = Array.isArray(analyticsData.performance?.employees) && analyticsData.performance.employees.length > 0
      ? analyticsData.performance.employees
      : Array.isArray(analyticsData.performance?.data) && analyticsData.performance.data.length > 0
        ? analyticsData.performance.data
        : null;

    const dashPerf = dashboardData?.employee_performance;
    let rawList = [];

    if (perfEmployees) {
      rawList = perfEmployees;
    } else if (Array.isArray(dashPerf)) {
      rawList = dashPerf;
    } else if (dashPerf && Array.isArray(dashPerf.list) && dashPerf.list.length > 0) {
      rawList = dashPerf.list.map((item, idx) => ({
        ...item,
        tickets_resolved: item.resolved_tickets ?? item.tickets_resolved ?? (Array.isArray(dashPerf.resolved) ? dashPerf.resolved[idx] : 0),
        avg_response_time_minutes: item.avg_response_time_minutes ?? (Array.isArray(dashPerf.response_time) ? dashPerf.response_time[idx] : 0),
        avg_resolution_hours: item.avg_resolution_hours ?? (Array.isArray(dashPerf.resolution_time) ? dashPerf.resolution_time[idx] : 0),
        sla_compliance_rate: item.sla_compliance_rate ?? (Array.isArray(dashPerf.sla_compliance) ? dashPerf.sla_compliance[idx] : 0),
      }));
    } else if (dashPerf && Array.isArray(dashPerf.labels) && dashPerf.labels.length > 0) {
      rawList = dashPerf.labels.map((name, idx) => ({
        name,
        tickets_resolved: Array.isArray(dashPerf.resolved) ? dashPerf.resolved[idx] : 0,
        avg_response_time_minutes: Array.isArray(dashPerf.response_time) ? dashPerf.response_time[idx] : 0,
        avg_resolution_hours: Array.isArray(dashPerf.resolution_time) ? dashPerf.resolution_time[idx] : 0,
        sla_compliance_rate: Array.isArray(dashPerf.sla_compliance) ? dashPerf.sla_compliance[idx] : 0,
      }));
    }

    if (!hasData || !Array.isArray(rawList) || rawList.length === 0) {
      return <EmptyStateCard title="No technician activity" description="No technicians have tickets assigned or resolved in this period." />;
    }

    const labels = rawList.map(p => p.employee_name || p.name || `Emp #${p.emp_id || p.employee_id}`);

    if (empView === 'Tickets Resolved') {
      const data = rawList.map(p => p.resolved_tickets_count ?? p.tickets_resolved ?? p.resolved_tickets ?? p.ticket_count ?? 0);
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
          <p className="text-[11px] text-gray-500 mt-1">Resolved tickets across active facility technicians.</p>
        </div>
      );
    } else if (empView === 'Avg Response Time') {
      const data = rawList.map(p => {
        if (p.avg_response_hours !== undefined && p.avg_response_hours !== null) return p.avg_response_hours;
        const mins = p.average_response_minutes ?? p.avg_response_minutes ?? p.avg_response_time_minutes ?? 0;
        return mins ? Math.round((mins / 60) * 10) / 10 : 0;
      });
      return (
        <div>
          <div className="h-[220px]">
            <Bar
              options={defaultHorizontalBarOptions('Avg Response Time (hrs)')}
              data={{
                labels,
                datasets: [{
                  label: 'Response Time (h)',
                  data,
                  backgroundColor: BAR_PALETTE[4],
                  borderRadius: 6,
                  barThickness: 16,
                }],
              }}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Average first response time per technician.</p>
        </div>
      );
    } else if (empView === 'Avg Resolution Time') {
      const data = rawList.map(p => p.avg_resolution_hours ?? p.average_resolution_hours ?? (p.avg_resolution_time_minutes ? Math.round((p.avg_resolution_time_minutes / 60) * 10) / 10 : 0));
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
          <p className="text-[11px] text-gray-500 mt-1">Average duration to resolve assigned tickets.</p>
        </div>
      );
    } else {
      const data = rawList.map(p => p.sla_compliance_rate ?? p.sla_compliance ?? 0);
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
          <p className="text-[11px] text-gray-500 mt-1">Individual SLA compliance rates against 90% target.</p>
        </div>
      );
    }
  }, [hasData, analyticsData.performance, dashboardData, empView]);

  // ─── Section 4: Customer Satisfaction Chart ──────────────────────────────
  const csatChart = useMemo(() => {
    if (!hasData) {
      return <EmptyStateCard title="No CSAT feedback recorded" description="No customer reviews were submitted in this period." />;
    }

    const csat = dashboardData?.csat || {};
    if (csat.available === false || (csat.average_score ?? dashboardData?.kpis?.csat_score) == null) {
      return <EmptyStateCard title="CSAT data unavailable" description="Customer satisfaction ratings could not be loaded right now, so no score is shown." />;
    }
    const labels = Array.isArray(csat.labels) ? csat.labels : (Array.isArray(dashboardData?.trends?.labels) ? dashboardData.trends.labels : []);
    const data = Array.isArray(csat.trend) ? csat.trend : (Array.isArray(csat.trends) ? csat.trends : []);
    const avgScore = Number(csat.average_score ?? dashboardData?.kpis?.csat_score ?? 0).toFixed(1);
    const totalReviews = csat.total_reviews ?? dashboardData?.kpis?.total_csat_reviews ?? 0;

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
        <p className="text-[11px] text-gray-500 mt-1">CSAT score: {avgScore}/5 across {totalReviews} reviews.</p>
      </div>
    );
  }, [hasData, dashboardData]);

  // ─── Section 5: Workload Distribution Chart ──────────────────────────────
  const workloadChart = useMemo(() => {
    if (!hasData) {
      return <EmptyStateCard title="No workload data" description="No open or assigned tickets for this period." />;
    }

    const workload = dashboardData?.workload || {};

    if (workloadView === 'By Employee') {
      const empWorkload = workload.by_employee;
      let labels = [];
      let data = [];

      if (Array.isArray(empWorkload)) {
        labels = empWorkload.map(e => e.name || e.employee_name || 'Staff');
        data = empWorkload.map(e => e.active_tickets ?? e.ticket_count ?? 0);
      } else if (empWorkload && Array.isArray(empWorkload.labels)) {
        labels = empWorkload.labels;
        data = Array.isArray(empWorkload.data) ? empWorkload.data : [];
      } else if (Array.isArray(workload.details)) {
        labels = workload.details.map(e => e.name || e.employee_name || 'Staff');
        data = workload.details.map(e => e.active_tickets ?? e.ticket_count ?? 0);
      }

      return (
        <div>
          <div className="h-[220px]">
            <Bar
              options={defaultHorizontalBarOptions('Workload by Employee')}
              data={{
                labels: labels.length > 0 ? labels : ['Technicians'],
                datasets: [{
                  label: 'Tickets Assigned',
                  data: data.length > 0 ? data : [0],
                  backgroundColor: BAR_PALETTE.slice(0, Math.max(1, labels.length)),
                  borderRadius: 6,
                  barThickness: 16,
                }],
              }}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Active ticket distribution across branch technicians.</p>
        </div>
      );
    } else {
      const deptWorkload = workload.by_department;
      let labels = [];
      let data = [];

      if (Array.isArray(deptWorkload)) {
        labels = deptWorkload.map(d => d.name || d.department || 'General');
        data = deptWorkload.map(d => d.active_tickets ?? d.total_tickets ?? 0);
      } else if (deptWorkload && Array.isArray(deptWorkload.labels)) {
        labels = deptWorkload.labels;
        data = Array.isArray(deptWorkload.data) ? deptWorkload.data : [];
      } else if (Array.isArray(analyticsData.departments?.departments)) {
        const deptArr = analyticsData.departments.departments;
        labels = deptArr.map(d => d.name || d.department || 'General');
        data = deptArr.map(d => d.active_tickets ?? d.total_tickets ?? 0);
      }

      return (
        <div>
          <div className="h-[220px]">
            <Bar
              options={defaultHorizontalBarOptions('Workload by Department')}
              data={{
                labels: labels.length > 0 ? labels : ['Service'],
                datasets: [{
                  label: 'Tickets Assigned',
                  data: data.length > 0 ? data : [0],
                  backgroundColor: BAR_PALETTE.slice(0, Math.max(1, labels.length)),
                  borderRadius: 6,
                  barThickness: 18,
                }],
              }}
            />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Active tickets distributed by operational department.</p>
        </div>
      );
    }
  }, [hasData, dashboardData, analyticsData.departments, workloadView]);

  // KPI cards
  const kpis = useMemo(() => {
    const k = dashboardData?.kpis || {};
    return [
      { label: 'Total Tickets', value: k.total_tickets ?? 0, icon: Inbox, definition: 'Tickets created in the selected period for the branch in view.' },
      { label: 'SLA Compliance', value: k.sla_compliance_rate == null ? 'Unavailable' : `${k.sla_compliance_rate}%`, icon: ShieldCheck, definition: 'Tickets that met their SLA target divided by all tickets with an SLA outcome in the selected period.' },
      { label: 'Active Employees', value: k.active_employees_count ?? analyticsData.performance?.active_employees_count ?? 0, icon: Users, definition: 'Active staff members in the branch directory. This count does not change with the period.' },
      { label: 'CSAT Score', value: k.csat_score != null ? Number(k.csat_score).toFixed(1) : 'Unavailable', icon: Smile, definition: 'Average customer rating from feedback on tickets in the selected period, out of 5.' },
      { label: 'Avg Resolution', value: `${k.avg_resolution_hours ?? 0}h`, icon: Clock, definition: 'Average hours from ticket creation to resolution, not counting time on hold, for tickets resolved in the selected period.' },
    ];
  }, [dashboardData, analyticsData.performance]);

  const sortedBranchComparisons = useMemo(() => {
    const list = Array.isArray(dashboardData?.branch_comparisons) ? [...dashboardData.branch_comparisons] : [];
    list.sort((a, b) => {
      const valA = a[branchSortBy] ?? 0;
      const valB = b[branchSortBy] ?? 0;
      if (valA === valB) return 0;
      if (branchSortDir === 'asc') return valA > valB ? 1 : -1;
      return valA < valB ? 1 : -1;
    });
    return list;
  }, [dashboardData?.branch_comparisons, branchSortBy, branchSortDir]);

  const handleBranchSort = (column) => {
    if (branchSortBy === column) {
      setBranchSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setBranchSortBy(column);
      setBranchSortDir('desc');
    }
  };

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
        {/* Left: Tab Switcher */}
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
          <button
            type="button"
            onClick={() => setActiveTab('departments')}
            className={cn(
              "pb-3 pt-1 text-xs sm:text-sm transition-all relative cursor-pointer border-b-2 font-medium",
              activeTab === 'departments'
                ? "text-[#252578] border-[#252578] font-semibold"
                : "text-slate-500 hover:text-slate-800 border-transparent"
            )}
          >
            Departments
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('employees')}
            className={cn(
              "pb-3 pt-1 text-xs sm:text-sm transition-all relative cursor-pointer border-b-2 font-medium",
              activeTab === 'employees'
                ? "text-[#252578] border-[#252578] font-semibold"
                : "text-slate-500 hover:text-slate-800 border-transparent"
            )}
          >
            Employees
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
                  definition={k.definition}
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

            {/* Section 6: Cross-Branch Performance Comparison (SuperAdmin Global View) */}
            {isSuperAdmin && sortedBranchComparisons.length > 0 && (
              <div className="lg:col-span-2">
                <div className="p-4 bg-white border border-gray-200 rounded-xl shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-800">Cross-Branch Performance Comparison</h3>
                      <p className="text-xs text-gray-500">
                        Organization-wide comparison across all active facilities. Click any column header to sort or select a branch to inspect.
                      </p>
                    </div>
                    <span className="text-xs font-medium text-[#252578] bg-[#252578]/10 px-2.5 py-1 rounded-md">
                      {sortedBranchComparisons.length} Active Branches
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-gray-200 bg-[#F8F9FA]">
                          {[
                            { key: 'branch_name', label: 'Branch' },
                            { key: 'total_tickets', label: 'Total Tickets' },
                            { key: 'active_tickets', label: 'Active' },
                            { key: 'escalated_tickets', label: 'Escalated' },
                            { key: 'sla_breaches', label: 'SLA Breaches' },
                            { key: 'sla_compliance_rate', label: 'SLA Compliance' },
                            { key: 'avg_resolution_hours', label: 'Avg Resolution' },
                            { key: 'csat_score', label: 'CSAT Score' },
                          ].map((col) => (
                            <th
                              key={col.key}
                              onClick={() => handleBranchSort(col.key)}
                              className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8] cursor-pointer hover:text-[#1E293B] select-none"
                            >
                              {col.label}
                              {branchSortBy === col.key ? (branchSortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {sortedBranchComparisons.map((b) => (
                          <tr
                            key={b.branch_id}
                            onClick={() => selectBranch && selectBranch(b.branch_id)}
                            className="hover:bg-slate-50 transition-colors cursor-pointer"
                          >
                            <td className="px-3 py-2.5 text-xs font-semibold text-[#1E293B]">
                              {b.branch_name}
                              {b.branch_code && (
                                <span className="ml-1.5 text-[10px] font-medium text-[#8D8B8F]">({b.branch_code})</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-xs font-medium text-[#1E293B]">{b.total_tickets ?? 0}</td>
                            <td className="px-3 py-2.5 text-xs text-[#8D8B8F]">{b.active_tickets ?? 0}</td>
                            <td className="px-3 py-2.5 text-xs text-[#8D8B8F]">{b.escalated_tickets ?? 0}</td>
                            <td className="px-3 py-2.5 text-xs font-medium text-rose-600">{b.sla_breaches ?? 0}</td>
                            <td className="px-3 py-2.5 text-xs font-semibold text-emerald-700">{b.sla_compliance_rate ?? 100}%</td>
                            <td className="px-3 py-2.5 text-xs text-[#8D8B8F]">{b.avg_resolution_hours ?? 0}h</td>
                            <td className="px-3 py-2.5 text-xs font-medium text-[#1E293B]">{b.csat_score != null ? `${b.csat_score} / 5.0` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : activeTab === 'employees' ? (
        <EmployeePerformanceView
          selectedPeriod={selectedPreset}
          dateFrom={globalDateFrom}
          dateTo={globalDateTo}
        />
      ) : activeTab === 'departments' ? (
        <DepartmentPerformanceView
          branchName={selectedBranch?.name || 'your branch'}
          selectedPeriod={selectedPreset}
          dateFrom={globalDateFrom}
          dateTo={globalDateTo}
        />
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
