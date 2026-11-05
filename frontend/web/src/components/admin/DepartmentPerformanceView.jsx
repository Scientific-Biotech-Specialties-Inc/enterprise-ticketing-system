import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Building2,
  Users,
  Clock,
  ShieldCheck,
  Smile,
  AlertTriangle,
  ArrowUpDown,
  Search,
  ChevronRight,
  UserCheck,
  AlertCircle,
  BarChart3,
  TrendingUp,
  RefreshCw,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Bar } from 'react-chartjs-2';
import { MetricCard } from '@/components/ui/metric-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { InfoTooltip } from '@/components/ui/tooltip';
import { adaptDepartmentPerformance, METRIC_DEFINITIONS } from '@/services/dashboardAnalyticsService';
import { getAdminDepartmentPerformance } from '@/services/ticketService';
import { cn } from '@/lib/utils';

export default function DepartmentPerformanceView({
  branchName = 'your branch',
  selectedPeriod = 'Last 7 Days',
  dateFrom = null,
  dateTo = null,
}) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('totalTicketsHandled');
  const [sortDirection, setSortDirection] = useState('desc');
  const [selectedDeptDetail, setSelectedDeptDetail] = useState(null);

  const [deptData, setDeptData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Real, branch scoped figures from the ticket service. Read only: nothing here edits a department.
  const loadDepartments = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = { preset: selectedPeriod };
      if (selectedPeriod === 'Custom Range') {
        params.preset = 'custom';
        if (dateFrom) params.date_from = dateFrom;
        if (dateTo) params.date_to = dateTo;
      }
      const api = await getAdminDepartmentPerformance(params);
      setDeptData(adaptDepartmentPerformance(api));
    } catch (err) {
      console.error('Failed to load department performance:', err);
      setLoadError(err?.response?.data?.message || 'Department performance data is unavailable right now.');
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod, dateFrom, dateTo]);

  useEffect(() => {
    loadDepartments();
  }, [loadDepartments]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const sortedDepartments = useMemo(() => {
    if (!deptData?.departments) return [];
    let list = [...deptData.departments];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((d) => d.name.toLowerCase().includes(q));
    }

    list.sort((a, b) => {
      if (!a.hasData && b.hasData) return 1;
      if (a.hasData && !b.hasData) return -1;
      if (!a.hasData && !b.hasData) return 0;

      let valA = a[sortField];
      let valB = b[sortField];
      if (typeof valA === 'string') {
        return sortDirection === 'asc'
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      }
      return sortDirection === 'asc' ? (valA || 0) - (valB || 0) : (valB || 0) - (valA || 0);
    });

    return list;
  }, [deptData, searchQuery, sortField, sortDirection]);

  // Workload imbalance comparison chart
  const workloadChartData = useMemo(() => {
    if (!deptData?.departments) return null;
    const activeDepts = deptData.departments.filter((d) => d.hasData);
    return {
      labels: activeDepts.map((d) => d.name),
      datasets: [
        {
          label: 'Tickets per Employee',
          data: activeDepts.map((d) => d.workloadPerEmployee),
          backgroundColor: activeDepts.map((d) =>
            d.imbalanceLevel === 'High Imbalance'
              ? 'rgba(244, 63, 94, 0.8)'
              : d.imbalanceLevel === 'Moderate'
              ? 'rgba(245, 158, 11, 0.8)'
              : 'rgba(37, 37, 120, 0.8)'
          ),
          borderRadius: 6,
          barThickness: 22,
        },
      ],
    };
  }, [deptData]);

  const branchSummary = useMemo(() => {
    const list = deptData?.departments?.filter((d) => d.hasData) || [];
    if (list.length === 0) return { totalHandled: 0, avgSla: null, totalOverdue: 0, highImbalanceCount: 0 };
    const totalHandled = list.reduce((acc, d) => acc + d.totalTicketsHandled, 0);
    // Weighted by tickets handled, so a tiny department cannot swing the branch figure.
    const avgSla = totalHandled > 0
      ? (list.reduce((acc, d) => acc + (d.slaCompliance || 0) * d.totalTicketsHandled, 0) / totalHandled).toFixed(1)
      : null;
    const totalOverdue = list.reduce((acc, d) => acc + d.overdueCount, 0);
    const highImbalanceCount = list.filter((d) => d.imbalanceLevel === 'High Imbalance').length;
    return { totalHandled, avgSla, totalOverdue, highImbalanceCount };
  }, [deptData]);

  if (loading && !deptData) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading department performance">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[96px] rounded-xl bg-slate-100 animate-pulse" />
          ))}
        </div>
        <div className="h-[220px] rounded-xl bg-slate-100 animate-pulse" />
      </div>
    );
  }

  if (loadError && !deptData) {
    return (
      <div role="alert" className="rounded-xl border border-destructive/30 bg-card p-6 text-center space-y-3">
        <p className="text-sm font-semibold text-destructive">Data unavailable</p>
        <p className="text-xs text-slate-muted">{loadError}</p>
        <Button size="sm" variant="outline" onClick={loadDepartments}>
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {loadError && (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <span>{loadError} Showing the last loaded figures.</span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={loadDepartments}>Retry</Button>
        </div>
      )}
      {/* Top Department Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard
          title="Total Handled"
          value={branchSummary.totalHandled}
          subtitle={`Across departments (${selectedPeriod})`}
          icon={<BarChart3 className="w-4 h-4 text-accent" />}
          iconBg="bg-blue-50 text-accent"
          calculationBasis={METRIC_DEFINITIONS.totalTickets}
        />
        <MetricCard
          title="Dept SLA Compliance"
          value={branchSummary.avgSla != null ? `${branchSummary.avgSla}%` : 'No data'}
          subtitle="Department adherence target ≥ 90%"
          icon={<ShieldCheck className="w-4 h-4 text-emerald-600" />}
          iconBg="bg-emerald-50 text-emerald-600"
          calculationBasis={METRIC_DEFINITIONS.slaCompliance}
        />
        <MetricCard
          title="Overdue / Breached"
          value={branchSummary.totalOverdue}
          subtitle="Distinguished from open tickets"
          icon={<AlertTriangle className="w-4 h-4 text-rose-600" />}
          iconBg="bg-rose-50 text-rose-600"
          variant="destructive"
          calculationBasis={METRIC_DEFINITIONS.overdueTickets}
        />
        <MetricCard
          title="Staff Imbalance"
          value={`${branchSummary.highImbalanceCount} Teams`}
          subtitle="Tickets-per-employee overload"
          icon={<Users className="w-4 h-4 text-amber-600" />}
          iconBg="bg-amber-50 text-amber-600"
          variant="amber"
          calculationBasis={METRIC_DEFINITIONS.employeeWorkload}
        />
      </div>

      {/* Workload Distribution Chart: Spotting Team Imbalance */}
      <div className="bg-card rounded-xl shadow-xs border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-bold text-slate-dark">Workload Distribution &amp; Team Imbalance</h3>
                <InfoTooltip content="Open tickets divided by staff in the department. The imbalance badge flags departments where one person carries 1.5x (Moderate) or 2x (High) the department average." />
              </div>
              <p className="text-[11px] text-slate-muted">
                Imbalance compares the busiest employee with the department average: red is 2x or more, amber is 1.5x or more.
              </p>
            </div>
          </div>
        </div>

        {workloadChartData && (
          <div className="h-[180px]">
            <Bar
              data={workloadChartData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    callbacks: {
                      label: (ctx) => `${ctx.raw} tickets per active employee`,
                    },
                  },
                },
                scales: {
                  x: { grid: { display: false }, ticks: { font: { family: 'Poppins', size: 10 } } },
                  y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Tickets / Staff', font: { size: 10 } },
                    ticks: { font: { size: 10 } },
                  },
                },
              }}
            />
          </div>
        )}
      </div>

      {/* Comparative Department Table */}
      <div className="bg-card rounded-xl shadow-xs border border-border p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-dark">Department Performance Comparison</h3>
            <p className="text-[11px] text-slate-muted">
              Aggregated operational quality and productivity metrics for {branchName}.
            </p>
          </div>
          <div className="relative w-full sm:w-80">
            <Search className="w-3.5 h-3.5 text-slate-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Filter department by name or lead..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-page border border-border rounded-lg text-slate-dark placeholder:text-slate-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-sans">
            <thead className="bg-page border-b border-border text-slate-muted font-semibold">
              <tr>
                <th
                  onClick={() => handleSort('name')}
                  className="py-3 px-3 cursor-pointer hover:text-slate-dark transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Department</span>
                    <ArrowUpDown className="w-3 h-3 text-slate-muted" />
                  </div>
                </th>
                <th className="py-3 px-3">Staff</th>
                <th
                  onClick={() => handleSort('totalTicketsHandled')}
                  className="py-3 px-3 cursor-pointer hover:text-slate-dark transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Handled</span>
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
                  onClick={() => handleSort('slaCompliance')}
                  className="py-3 px-3 cursor-pointer hover:text-slate-dark transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>SLA Compliance</span>
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
                <th className="py-3 px-3">Open / Overdue</th>
                <th className="py-3 px-3">Imbalance Level</th>
                <th className="py-3 px-3 text-right">Drill Down</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedDepartments.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-slate-muted">
                    No departments found.
                  </td>
                </tr>
              ) : (
                sortedDepartments.map((dept) => (
                  <tr key={dept.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3 px-3 font-semibold text-slate-dark">
                      <div>
                        <span>{dept.name}</span>
                        <span className="block text-[11px] text-slate-muted font-normal">{dept.employeeCount} staff</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-slate-dark font-medium">{dept.employeeCount}</td>

                    {!dept.hasData ? (
                      <td colSpan={6} className="py-3 px-3">
                        <Badge variant="medium-muted" size="sm">No data for this period</Badge>
                      </td>
                    ) : (
                      <>
                        <td className="py-3 px-3 font-medium text-slate-dark">{dept.totalTicketsHandled}</td>
                        <td className="py-3 px-3 text-slate-dark">{dept.avgResolutionTime != null ? `${dept.avgResolutionTime} hrs` : '—'}</td>
                        <td className="py-3 px-3 font-semibold">
                          <span
                            className={cn(
                              dept.slaCompliance >= 92
                                ? 'text-emerald-600'
                                : dept.slaCompliance >= 85
                                ? 'text-amber-600'
                                : 'text-rose-600'
                            )}
                          >
                            {dept.slaCompliance != null ? `${dept.slaCompliance}%` : '—'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-amber-700 font-medium">{dept.avgCsat != null ? `★ ${dept.avgCsat}` : '—'}</td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-dark font-medium">{dept.openCount} Open</span>
                            <span className="text-slate-muted">/</span>
                            <span
                              className={cn(
                                'font-semibold',
                                dept.overdueCount > 0 ? 'text-rose-600' : 'text-emerald-600'
                              )}
                            >
                              {dept.overdueCount} Overdue
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <Badge
                            variant={
                              dept.imbalanceLevel === 'High Imbalance'
                                ? 'medium-destructive'
                                : dept.imbalanceLevel === 'Moderate'
                                ? 'medium-warning'
                                : 'medium-success'
                            }
                            size="sm"
                          >
                            {dept.workloadPerEmployee}/person • {dept.imbalanceLevel}
                          </Badge>
                        </td>
                      </>
                    )}

                    <td className="py-3 px-3 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedDeptDetail(dept)}
                        className="h-7 px-2.5 text-xs text-accent hover:bg-blue-50 border-blue-200"
                        title={`Inspect staff breakdown for ${dept.name}`}
                      >
                        <Users className="w-3.5 h-3.5 mr-1" />
                        Drill Down
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Department Team Drill-down Modal */}
      {selectedDeptDetail && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl border border-border shadow-2xl max-w-lg w-full p-6 space-y-4 font-sans animate-in fade-in-0 zoom-in-95">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-dark">{selectedDeptDetail.name} Team Drill-Down</h3>
                <p className="text-xs text-slate-muted">Individual technician assignments and workload contribution.</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedDeptDetail(null)}
                className="h-8 w-8 p-0 rounded-full text-slate-muted"
              >
                ✕
              </Button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-3 gap-2 bg-page p-3 rounded-xl border border-border text-center">
                <div>
                  <span className="text-slate-muted block text-[10px]">Total Handled</span>
                  <strong className="text-slate-dark text-sm">{selectedDeptDetail.totalTicketsHandled}</strong>
                </div>
                <div>
                  <span className="text-slate-muted block text-[10px]">SLA Adherence</span>
                  <strong className="text-emerald-600 text-sm">
                    {selectedDeptDetail.slaCompliance != null ? `${selectedDeptDetail.slaCompliance}%` : '—'}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-muted block text-[10px]">Overdue Breached</span>
                  <strong className="text-rose-600 text-sm">{selectedDeptDetail.overdueCount}</strong>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-slate-dark mb-2">Open Tickets per Employee ({selectedDeptDetail.employees.length})</h4>
                <div className="divide-y divide-border/60 border border-border rounded-xl overflow-hidden bg-surface">
                  {selectedDeptDetail.employees.length === 0 && (
                    <p className="p-3 text-slate-muted">No staff are registered in this department.</p>
                  )}
                  {selectedDeptDetail.employees.map((emp) => (
                    <div key={emp.id} className="p-2.5 flex items-center justify-between hover:bg-slate-50/60">
                      <div className="min-w-0 flex-1 pr-3">
                        <p className="font-semibold text-slate-dark">{emp.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden" aria-hidden="true">
                            <div className="h-full bg-primary" style={{ width: `${Math.min(100, emp.share)}%` }} />
                          </div>
                          <span className="text-[11px] text-slate-muted shrink-0">
                            {emp.activeTickets} open • {emp.share}%
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedDeptDetail(null);
                          navigate('/admin/employees');
                        }}
                        className="h-6 px-2 text-[11px] text-accent hover:bg-blue-50"
                      >
                        Performance Record →
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-border">
              <span className="text-[11px] text-slate-muted">Scoped to {branchName}</span>
              <Button
                variant="default"
                size="sm"
                onClick={() => setSelectedDeptDetail(null)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

