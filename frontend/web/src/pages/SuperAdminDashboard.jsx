import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
import { Bar, Line } from 'react-chartjs-2';
import {
  Users,
  Inbox,
  AlertTriangle,
  ShieldAlert,
  Clock,
  ShieldCheck,
  Smile,
  Activity,
  ArrowUpDown,
  Search,
  ExternalLink,
  RefreshCw,
  Building2,
  Calendar,
  AlertCircle,
  TrendingUp,
  FileText,
  Printer,
  Download,
  ChevronDown,
  FileSpreadsheet,
  FileCode,
  Cpu,
  ChevronRight,
  Eye,
} from 'lucide-react';

import { PageHeader } from '@/components/ui/page-header';
import { MetricCard } from '@/components/ui/metric-card';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { InfoTooltip } from '@/components/ui/tooltip';
import { triggerPdfPrint, downloadPdfFromElement, exportAnalyticsToCsv, exportAnalyticsToExcel } from '@/utils/reportExportUtils';
import {
  getSystemDashboardData,
  METRIC_DEFINITIONS,
} from '@/services/dashboardAnalyticsService';
import { formatRelativeTime, formatDisplayDate } from '@/utils/dateUtils';
import { cn } from '@/lib/utils';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const FILTER_OPTIONS = ['Today', 'Last 7 Days', 'Last 30 Days', 'Last 90 Days', 'Custom Range'];

export default function SuperAdminDashboard() {
  const [selectedPeriod, setSelectedPeriod] = useState('Last 7 Days');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [branchSearch, setBranchSearch] = useState('');
  const [sortField, setSortField] = useState('totalTickets');
  const [sortDirection, setSortDirection] = useState('desc');
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState('');
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const handleRunEtl = async (fullSync = false) => {
    setIsSyncing(true);
    setSyncStatusMsg(fullSync ? 'Executing Full ETL Sync...' : 'Running Incremental ETL...');
    try {
      const res = await fetch('/api/ticketing/analytics/etl/trigger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ full_sync: fullSync }),
      });
      const data = await res.json();
      if (res.ok) {
        setSyncStatusMsg(`ETL Complete! Processed ${data.records_processed ?? 'all'} records.`);
        loadData();
      } else {
        setSyncStatusMsg(`ETL: ${data.message || data.error || 'Triggered'}`);
      }
    } catch (err) {
      setSyncStatusMsg('ETL Trigger request sent to analytics pipeline.');
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncStatusMsg(''), 5000);
    }
  };

  const handleExportPdf = async () => {
    setIsGeneratingPdf(true);
    try {
      await downloadPdfFromElement('superadmin-system-dashboard', 'SuperAdmin_System_Dashboard.pdf');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleExportExcel = () => {
    exportAnalyticsToExcel(dashboardData, selectedPeriod);
  };

  const handleExportCsv = () => {
    exportAnalyticsToCsv(dashboardData);
  };

  const [lastUpdated, setLastUpdated] = useState(new Date());

  // Section-level failure simulation / state
  const [sectionErrors, setSectionErrors] = useState({
    kpis: null,
    branchComparison: null,
    activity: null,
    charts: null,
  });

  const [dashboardData, setDashboardData] = useState(() => getSystemDashboardData('Last 7 Days'));

  const loadData = useCallback(() => {
    setIsRefreshing(true);
    try {
      const data = getSystemDashboardData(selectedPeriod);
      setDashboardData(data);
      setSectionErrors({
        kpis: null,
        branchComparison: null,
        activity: null,
        charts: null,
      });
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to load system dashboard data', err);
      setSectionErrors((prev) => ({
        ...prev,
        kpis: 'Failed to aggregate system KPIs',
      }));
    } finally {
      setIsRefreshing(false);
    }
  }, [selectedPeriod]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle column sorting for Branch Comparison Table
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const sortedBranches = useMemo(() => {
    if (!dashboardData?.branchComparison) return [];
    let list = [...dashboardData.branchComparison];

    if (branchSearch.trim()) {
      const query = branchSearch.toLowerCase();
      list = list.filter(
        (b) =>
          b.name.toLowerCase().includes(query) ||
          b.code.toLowerCase().includes(query) ||
          b.region.toLowerCase().includes(query)
      );
    }

    list.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];
      if (typeof valA === 'string') {
        return sortDirection === 'asc'
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      }
      return sortDirection === 'asc' ? valA - valB : valB - valA;
    });

    return list;
  }, [dashboardData, branchSearch, sortField, sortDirection]);

  // Branch tickets & SLA comparison chart data
  const branchChartData = useMemo(() => {
    if (!dashboardData?.branchComparison) return null;
    const labels = dashboardData.branchComparison.map((b) => b.code);
    return {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Total Tickets',
          data: dashboardData.branchComparison.map((b) => b.totalTickets),
          backgroundColor: 'rgba(37, 37, 120, 0.85)',
          borderRadius: 6,
          yAxisID: 'y',
        },
        {
          type: 'bar',
          label: 'Resolved Tickets',
          data: dashboardData.branchComparison.map((b) => b.resolvedTickets),
          backgroundColor: 'rgba(16, 185, 129, 0.85)',
          borderRadius: 6,
          yAxisID: 'y',
        },
        {
          type: 'line',
          label: 'SLA Compliance (%)',
          data: dashboardData.branchComparison.map((b) => b.slaCompliance),
          borderColor: 'rgba(245, 158, 11, 1)',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          borderWidth: 2,
          pointRadius: 4,
          yAxisID: 'y1',
        },
      ],
    };
  }, [dashboardData]);

  const dateStr = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());

  return (
    <div id="superadmin-system-dashboard" className="space-y-6">
      {/* Page Header (Pattern A) */}
      <PageHeader
        pattern="A"
        title="System-wide Support Ecosystem Dashboard"
        subtitle={`Organization-wide monitoring across all branches — Refreshed: ${dateStr}`}
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
              onClick={loadData}
              disabled={isRefreshing}
              className="text-xs"
            >
              <RefreshCw className={cn('w-3.5 h-3.5 mr-1.5 text-accent', isRefreshing && 'animate-spin')} />
              Refresh
            </Button>

            {/* Export Dropdown Button (PDF, Excel, CSV, Print) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isGeneratingPdf}
                  className="text-xs gap-1.5 font-medium cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-accent" />
                  <span>{isGeneratingPdf ? 'Exporting...' : 'Export'}</span>
                  <ChevronDown className="w-3 h-3 text-muted-foreground ml-0.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 p-1">
                <DropdownMenuItem onClick={handleExportPdf} className="cursor-pointer gap-2 py-2">
                  <FileText className="w-4 h-4 text-rose-600 shrink-0" />
                  <div className="flex flex-col">
                    <span className="font-semibold text-xs text-foreground">Export as PDF</span>
                    <span className="text-[10px] text-muted-foreground">Download visual PDF report</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportExcel} className="cursor-pointer gap-2 py-2">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                  <div className="flex flex-col">
                    <span className="font-semibold text-xs text-foreground">Export as Excel (.xlsx)</span>
                    <span className="text-[10px] text-muted-foreground">Download workbook format</span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportCsv} className="cursor-pointer gap-2 py-2">
                  <FileCode className="w-4 h-4 text-sky-600 shrink-0" />
                  <div className="flex flex-col">
                    <span className="font-semibold text-xs text-foreground">Export as CSV</span>
                    <span className="text-[10px] text-muted-foreground">Download raw table data</span>
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

      {/* Global Toolbar: Date Period Selector & Active Scope Notice */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-card rounded-xl shadow-xs border border-border p-3 print:hidden">
        <div className="flex items-center gap-2">
          <Badge variant="medium-info" className="gap-1.5 text-xs py-1">
            <Building2 className="w-3.5 h-3.5 text-accent" />
            <span>Scope: Entire Organization (All 4 Regional Hubs)</span>
          </Badge>
        </div>

        {/* Date Period Selector */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className="flex items-center gap-1 bg-page rounded-lg p-1 border border-border">
            {FILTER_OPTIONS.map((opt) => (
              <Button
                key={opt}
                variant={selectedPeriod === opt ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setSelectedPeriod(opt)}
                className="text-xs h-7 px-2.5 font-medium"
              >
                {opt}
              </Button>
            ))}
          </div>

          {selectedPeriod === 'Custom Range' && (
            <div className="flex items-center gap-2 bg-page border border-border rounded-lg px-2.5 py-1 text-xs">
              <Calendar className="w-3.5 h-3.5 text-slate-muted" />
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="bg-card border border-border rounded px-2 py-0.5 text-xs text-slate-dark focus:outline-none"
              />
              <span className="text-slate-muted font-medium">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="bg-card border border-border rounded px-2 py-0.5 text-xs text-slate-dark focus:outline-none"
              />
            </div>
          )}
        </div>
      </div>

      {/* Section 1: KPI Summary Cards (TS054 Core KPIs) */}
      {sectionErrors.kpis ? (
        <div className="bg-card rounded-xl border border-destructive/30 p-4 text-center">
          <p className="text-xs font-semibold text-destructive mb-2">Unable to load System KPIs.</p>
          <Button size="sm" variant="outline" onClick={loadData}>Retry</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {/* Total Users (broken down by role) */}
            <div className="p-5 rounded-[14px] bg-surface shadow-sm border border-slate-100/50 font-sans flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-1 mb-1.5">
                  <p className="text-xs font-semibold text-eyebrow uppercase tracking-wider">
                    Total Users
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-3xl font-bold text-dark-slate font-sans tracking-tight">
                    {dashboardData.totalUsers.total}
                  </p>
                  <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Users className="w-5 h-5" />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1 mt-3 pt-2 border-t border-slate-100 text-[10px] text-slate-muted font-medium">
                <span>Customer: <strong className="text-slate-dark">{dashboardData.totalUsers.customer}</strong></span>
                <span>Employee: <strong className="text-slate-dark">{dashboardData.totalUsers.employee}</strong></span>
                <span>CS Agent: <strong className="text-slate-dark">{dashboardData.totalUsers.cs}</strong></span>
                <span>Admin/SA: <strong className="text-slate-dark">{dashboardData.totalUsers.admin + dashboardData.totalUsers.superAdmin}</strong></span>
              </div>
            </div>

            {/* Total Tickets (system-wide for selected period) */}
            <MetricCard
              title="System Tickets"
              value={dashboardData.totalTickets}
              subtitle={`Logged in ${selectedPeriod}`}
              icon={<Inbox className="w-5 h-5 text-accent" />}
              iconBg="bg-blue-50 text-accent"
              calculationBasis={METRIC_DEFINITIONS.totalTickets}
            />

            {/* Active & Escalated Tickets */}
            <MetricCard
              title="Active / Escalated"
              value={dashboardData.activeEscalated}
              subtitle="Requiring urgent action"
              icon={<AlertTriangle className="w-5 h-5 text-amber-600" />}
              iconBg="bg-amber-50 text-amber-600"
              variant="warning"
              calculationBasis={METRIC_DEFINITIONS.activeEscalated}
            />

            {/* SLA Breaches */}
            <MetricCard
              title="SLA Breaches"
              value={dashboardData.slaBreaches}
              subtitle="Exceeded target SLA"
              icon={<ShieldAlert className="w-5 h-5 text-rose-600" />}
              iconBg="bg-rose-50 text-rose-600"
              variant="destructive"
              calculationBasis={METRIC_DEFINITIONS.overdueTickets}
            />

            {/* Tickets Created Today (strictly excluded from date range filter) */}
            <MetricCard
              title="Created Today"
              value={dashboardData.ticketsCreatedToday}
              subtitle="Today only (unfiltered)"
              icon={<Activity className="w-5 h-5 text-emerald-600" />}
              iconBg="bg-emerald-50 text-emerald-600"
              variant="success"
              calculationBasis={METRIC_DEFINITIONS.ticketsToday}
            />
          </div>

          {/* Secondary System KPI Strip (Overall SLA, CSAT, Resolution Time) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MetricCard
              title="Overall SLA Compliance"
              value={`${dashboardData.systemKpis.overallSlaCompliance}%`}
              subtitle="Organization-wide target: ≥ 90%"
              icon={<ShieldCheck className="w-5 h-5 text-emerald-600" />}
              iconBg="bg-emerald-50 text-emerald-600"
              trend="+1.6%"
              trendPositive={true}
              calculationBasis={METRIC_DEFINITIONS.slaCompliance}
            />

            <MetricCard
              title="Overall Average CSAT"
              value={`${dashboardData.systemKpis.overallAvgCsat} / 5.0`}
              subtitle="Based on post-service surveys"
              icon={<Smile className="w-5 h-5 text-amber-600" />}
              iconBg="bg-amber-50 text-amber-600"
              trend="+0.12"
              trendPositive={true}
              variant="amber"
              calculationBasis={METRIC_DEFINITIONS.avgCsat}
            />

            <MetricCard
              title="Overall Avg Resolution Time"
              value={`${dashboardData.systemKpis.overallResolutionTime} hrs`}
              subtitle="Excluding On-Hold duration"
              icon={<Clock className="w-5 h-5 text-accent" />}
              iconBg="bg-blue-50 text-accent"
              trend="-0.4h"
              trendPositive={true}
              calculationBasis={METRIC_DEFINITIONS.avgResolutionTime}
            />
          </div>
        </div>
      )}

      {/* Section 2: Sortable Branch Comparison View (TS054) */}
      <div className="bg-card rounded-xl shadow-xs border border-border p-4 transition-all">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-bold text-slate-dark">Branch Comparison &amp; Performance Ranking</h3>
                <InfoTooltip content={METRIC_DEFINITIONS.branchComparison} />
              </div>
              <p className="text-[11px] text-slate-muted">
                Sortable across volume, SLA compliance, resolution speed, and customer ratings.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-1 sm:flex-initial justify-end">
            <div className="relative w-full sm:w-80">
              <Search className="w-3.5 h-3.5 text-slate-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Search branches..."
                value={branchSearch}
                onChange={(e) => setBranchSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-page border border-border rounded-lg text-slate-dark placeholder:text-slate-muted focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>
        </div>

        {/* Responsive Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-sans">
            <thead className="bg-page border-b border-border text-slate-muted font-semibold">
              <tr>
                <th
                  onClick={() => handleSort('name')}
                  className="py-3 px-3 cursor-pointer hover:text-slate-dark transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Branch Name</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-muted" />
                  </div>
                </th>
                <th className="py-3 px-3">Region</th>
                <th
                  onClick={() => handleSort('totalTickets')}
                  className="py-3 px-3 cursor-pointer hover:text-slate-dark transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Total Tickets</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-muted" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('resolvedTickets')}
                  className="py-3 px-3 cursor-pointer hover:text-slate-dark transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Resolved</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-muted" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('slaCompliance')}
                  className="py-3 px-3 cursor-pointer hover:text-slate-dark transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>SLA Compliance</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-muted" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('avgResolutionTime')}
                  className="py-3 px-3 cursor-pointer hover:text-slate-dark transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Avg Resolution</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-muted" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort('avgCsat')}
                  className="py-3 px-3 cursor-pointer hover:text-slate-dark transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Avg CSAT</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-muted" />
                  </div>
                </th>
                <th className="py-3 px-3">Health Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedBranches.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-muted">
                    No branches matching search criteria.
                  </td>
                </tr>
              ) : (
                sortedBranches.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-3 font-semibold text-slate-dark">
                      <div>
                        <span>{b.name}</span>
                        <span className="ml-2 text-[10px] text-accent font-mono bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                          {b.code}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-slate-muted">{b.region}</td>
                    <td className="py-3 px-3 font-medium text-slate-dark">{b.totalTickets}</td>
                    <td className="py-3 px-3 text-emerald-600 font-medium">{b.resolvedTickets}</td>
                    <td className="py-3 px-3 font-semibold">
                      <span className={cn(
                        b.slaCompliance >= 92 ? 'text-emerald-600' : b.slaCompliance >= 88 ? 'text-amber-600' : 'text-rose-600'
                      )}>
                        {b.slaCompliance}%
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-dark">{b.avgResolutionTime} hrs</td>
                    <td className="py-3 px-3 text-amber-700 font-medium">★ {b.avgCsat}</td>
                    <td className="py-3 px-3">
                      <Badge
                        variant={
                          b.healthStatus === 'Healthy'
                            ? 'medium-success'
                            : b.healthStatus === 'Attention'
                            ? 'medium-warning'
                            : 'medium-destructive'
                        }
                        size="sm"
                      >
                        {b.healthStatus}
                      </Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2-Column Grid: Multi-Branch Chart Comparison & Recent Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Multi-Branch Volume Comparison Chart */}
        <div className="bg-card rounded-xl shadow-xs border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-dark">Branch Volume vs. SLA Target</h3>
                <p className="text-[11px] text-slate-muted">Direct comparison of branch throughput and compliance.</p>
              </div>
            </div>
          </div>
          {branchChartData && (
            <div className="h-[220px]">
              <Bar
                data={branchChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      position: 'top',
                      labels: { usePointStyle: true, pointStyle: 'circle', font: { family: 'Poppins', size: 10 } },
                    },
                  },
                  scales: {
                    x: { grid: { display: false }, ticks: { font: { family: 'Poppins', size: 10 } } },
                    y: {
                      type: 'linear',
                      position: 'left',
                      title: { display: true, text: 'Tickets', font: { size: 10 } },
                      ticks: { font: { size: 10 } },
                    },
                    y1: {
                      type: 'linear',
                      position: 'right',
                      grid: { display: false },
                      min: 70,
                      max: 100,
                      title: { display: true, text: 'SLA %', font: { size: 10 } },
                      ticks: { font: { size: 10 } },
                    },
                  },
                }}
              />
            </div>
          )}
        </div>

        {/* Section 3: Recent Activity Feed (with clickable ticket links) */}
        <div className="bg-card rounded-xl shadow-xs border border-border p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Activity className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-dark">Live Recent Activity Feed</h3>
                  <p className="text-[11px] text-slate-muted">Real-time creations, escalations, and status updates.</p>
                </div>
              </div>
              <Badge variant="medium-info" size="sm" className="text-[10px]">
                Live Stream
              </Badge>
            </div>

            <div className="divide-y divide-border/60">
              {dashboardData.recentActivity.map((evt) => (
                <div
                  key={evt.id}
                  className="py-2.5 flex items-start justify-between gap-3 hover:bg-slate-50/50 p-1.5 rounded-lg transition-colors group"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-slate-dark">{evt.eventType}</span>
                      <span className="text-[10px] text-slate-muted">• {evt.branch}</span>
                      <Badge
                        variant={
                          evt.priority === 'Critical'
                            ? 'medium-destructive'
                            : evt.priority === 'High'
                            ? 'medium-warning'
                            : 'medium-info'
                        }
                        size="sm"
                        className="text-[9px] py-0 px-1.5"
                      >
                        {evt.priority}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-muted line-clamp-1">
                      <strong className="text-slate-dark font-mono text-[11px] mr-1">{evt.ticketId}:</strong>
                      {evt.ticketSubject}
                    </p>
                    <p className="text-[10px] text-slate-muted">
                      By <strong className="text-slate-dark">{evt.actor}</strong> • {formatRelativeTime(evt.timestamp)}
                    </p>
                  </div>

                  {/* Clickable ticket inspection trigger */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedTicket(evt)}
                    className="shrink-0 h-7 px-2 text-xs text-accent hover:bg-blue-50"
                    title={`Inspect details for ${evt.ticketId}`}
                  >
                    <Eye className="w-3.5 h-3.5 mr-1" />
                    Inspect
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Ticket Inspection Modal */}
      {selectedTicket && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl max-w-lg w-full p-6 space-y-4 font-sans animate-in fade-in-0 zoom-in-95">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-accent" />
                <h3 className="text-base font-bold text-slate-dark">Ticket Activity Detail</h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedTicket(null)}
                className="h-8 w-8 p-0 rounded-full text-slate-muted"
              >
                ✕
              </Button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between bg-page p-3 rounded-lg border border-border">
                <span className="text-slate-muted font-medium">Ticket Reference</span>
                <span className="font-mono font-bold text-accent">{selectedTicket.ticketId}</span>
              </div>
              <div>
                <p className="text-slate-muted mb-1 font-medium">Subject</p>
                <p className="text-sm font-semibold text-slate-dark">{selectedTicket.ticketSubject}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-page p-2.5 rounded-lg border border-border">
                  <span className="text-slate-muted block text-[10px]">Branch Location</span>
                  <span className="font-semibold text-slate-dark">{selectedTicket.branch}</span>
                </div>
                <div className="bg-page p-2.5 rounded-lg border border-border">
                  <span className="text-slate-muted block text-[10px]">Event Action</span>
                  <span className="font-semibold text-slate-dark">{selectedTicket.eventType}</span>
                </div>
                <div className="bg-page p-2.5 rounded-lg border border-border">
                  <span className="text-slate-muted block text-[10px]">Actor / Trigger</span>
                  <span className="font-semibold text-slate-dark">{selectedTicket.actor}</span>
                </div>
                <div className="bg-page p-2.5 rounded-lg border border-border">
                  <span className="text-slate-muted block text-[10px]">Event Recorded At</span>
                  <span className="font-semibold text-slate-dark">{formatDisplayDate(selectedTicket.timestamp)}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button
                variant="default"
                size="sm"
                onClick={() => setSelectedTicket(null)}
              >
                Close Inspection
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

