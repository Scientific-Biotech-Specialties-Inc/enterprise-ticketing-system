import React, { useState, useMemo } from 'react';
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
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Bar } from 'react-chartjs-2';
import { MetricCard } from '@/components/ui/metric-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { InfoTooltip } from '@/components/ui/tooltip';
import {
  getDepartmentPerformanceData,
  METRIC_DEFINITIONS,
} from '@/services/dashboardAnalyticsService';
import { cn } from '@/lib/utils';

export default function DepartmentPerformanceView({
  branchId = 'main',
  branchName = 'Main Branch',
  selectedPeriod = 'Last 7 Days',
}) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('totalTicketsHandled');
  const [sortDirection, setSortDirection] = useState('desc');
  const [selectedDeptDetail, setSelectedDeptDetail] = useState(null);

  const deptData = useMemo(() => {
    return getDepartmentPerformanceData(branchId, selectedPeriod);
  }, [branchId, selectedPeriod]);

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
      list = list.filter((d) => d.name.toLowerCase().includes(q) || d.head.toLowerCase().includes(q));
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
    if (list.length === 0) return { totalHandled: 0, avgSla: 0, totalOverdue: 0, highImbalanceCount: 0 };
    const totalHandled = list.reduce((acc, d) => acc + d.totalTicketsHandled, 0);
    const avgSla = (list.reduce((acc, d) => acc + (d.slaCompliance || 0), 0) / list.length).toFixed(1);
    const totalOverdue = list.reduce((acc, d) => acc + d.overdueCount, 0);
    const highImbalanceCount = list.filter((d) => d.imbalanceLevel === 'High Imbalance').length;
    return { totalHandled, avgSla, totalOverdue, highImbalanceCount };
  }, [deptData]);

  return (
    <div className="space-y-6">
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
          value={`${branchSummary.avgSla}%`}
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
                <InfoTooltip content="Calculates average assigned tickets per technician within each department to detect understaffed teams." />
              </div>
              <p className="text-[11px] text-slate-muted">
                Red indicates severe load (&gt; 24 tickets/technician); Amber indicates moderate load (&gt; 16).
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
                        <span className="block text-[11px] text-slate-muted font-normal">Lead: {dept.head}</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-slate-dark font-medium">{dept.employeeCount} staff</td>

                    {!dept.hasData ? (
                      <td colSpan={6} className="py-3 px-3">
                        <Badge variant="medium-muted" size="sm">No data for this period</Badge>
                      </td>
                    ) : (
                      <>
                        <td className="py-3 px-3 font-medium text-slate-dark">{dept.totalTicketsHandled}</td>
                        <td className="py-3 px-3 text-slate-dark">{dept.avgResolutionTime} hrs</td>
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
                            {dept.slaCompliance}%
                          </span>
                        </td>
                        <td className="py-3 px-3 text-amber-700 font-medium">★ {dept.avgCsat}</td>
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
                            {dept.workloadPerEmployee}/tech • {dept.imbalanceLevel}
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
                  <strong className="text-emerald-600 text-sm">{selectedDeptDetail.slaCompliance}%</strong>
                </div>
                <div>
                  <span className="text-slate-muted block text-[10px]">Overdue Breached</span>
                  <strong className="text-rose-600 text-sm">{selectedDeptDetail.overdueCount}</strong>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-slate-dark mb-2">Assigned Staff ({selectedDeptDetail.employees.length})</h4>
                <div className="divide-y divide-border/60 border border-border rounded-xl overflow-hidden bg-surface">
                  {selectedDeptDetail.employees.map((emp) => (
                    <div key={emp.id} className="p-2.5 flex items-center justify-between hover:bg-slate-50/60">
                      <div>
                        <p className="font-semibold text-slate-dark">{emp.name}</p>
                        <p className="text-[11px] text-slate-muted">{emp.role}</p>
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

