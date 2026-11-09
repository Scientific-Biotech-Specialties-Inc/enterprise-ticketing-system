import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldAlert,
  Clock,
  CheckCircle2,
  CheckCircle,
  AlertTriangle,
  Users,
  RefreshCw,
  UserCheck,
  Layers,
  Inbox,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { MetricCard } from '@/components/ui/metric-card';
import { Button } from '@/components/ui/button';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { PersistentBanner } from '@/components/ui/alert-banner';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { DataTableSkeleton } from '@/components/ui/data-table';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/context/AuthContext';
import { AssignModal } from '@/components/CSModals';
import CustomerTicketDetailModal from '@/components/CustomerTicketDetailModal';
import {
  getManagerDashboard,
  getAssignableEmployees,
  assignTicketToEmployees,
  getDepartments,
} from '@/services/ticketService';
import { cn } from '@/lib/utils';

const PRIORITY_IDS = { Low: 1, Medium: 2, High: 3, Critical: 4 };

/** "Overdue by 2d 3h" from the server computed overdue minutes. */
export function formatOverdueMinutes(minutes) {
  const total = Math.max(0, Math.floor(Number(minutes) || 0));
  const days = Math.floor(total / (60 * 24));
  const hours = Math.floor((total % (60 * 24)) / 60);
  const mins = total % 60;

  if (days > 0) return `Overdue by ${days}d ${hours}h`;
  if (hours > 0) return `Overdue by ${hours}h ${mins}m`;
  return `Overdue by ${mins}m`;
}

/** Map an assignable employees API row to the shape AssignModal expects. */
function toStaff(e) {
  const id = Number(e.id ?? e.emp_id);
  const name = e.name || `${e.first_name || ''} ${e.last_name || ''}`.trim() || e.email || `Employee #${id}`;
  return { id, name, email: e.email, role: e.technical_role || e.position_level || e.role, department: e.department };
}

/** Map a breached queue row to the ticket shape AssignModal and the detail modal read. */
function toTicket(row) {
  return {
    id: row.ticket_number,
    ticket_ID: row.ticket_ID,
    title: row.title,
    priority: row.priority_name,
    status: row.status_name,
    department: row.department || '',
    category: row.department || '',
    assigned: row.assignee_id ? [row.assignee_id] : [],
    assigned_names: row.assignee_name ? [row.assignee_name] : [],
  };
}

/**
 * Live SLA dashboard shared by the Service, IT and Customer Service manager pages (spec 0031 AC-10, AC-11).
 *
 * Summary and breached queue come only from GET /manager/dashboard, scoped by the server to the signed in
 * manager. Assignable staff come only from getAssignableEmployees, filtered to the manager's department
 * (the Customer Service manager sees every assignable employee). Nothing on this page is sample data.
 */
export default function ManagerSlaDashboard({
  title,
  subtitle,
  queueRoute,
  queueLabel,
  totalLabel,
  staffLabel,
  breachedDescription,
  emptyDescription,
}) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  const [staff, setStaff] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [assignModalTicket, setAssignModalTicket] = useState(null);
  const [detailModalTicket, setDetailModalTicket] = useState(null);

  const requestSeq = useRef(0);

  const loadData = useCallback(async ({ forceRefresh = false } = {}) => {
    const seq = ++requestSeq.current;
    setIsRefreshing(true);
    setError(null);
    try {
      const data = await getManagerDashboard({ forceRefresh });
      if (seq !== requestSeq.current) return;
      setDashboard(data);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      const status = err?.response?.status;
      setError(
        status === 403
          ? 'Your account is not set up as a Service, IT, or Customer Service manager.'
          : 'We could not load the live SLA queue. Check your connection and try again.'
      );
    } finally {
      if (seq === requestSeq.current) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const scope = dashboard?.scope || null;
  const isBranchMode = scope?.mode === 'branch';
  const scopeDepartment = scope?.department || null;

  // Assignable staff: the manager's department only; the CS manager sees everyone assignable.
  useEffect(() => {
    if (!scopeDepartment) return;
    const department = isBranchMode ? undefined : scopeDepartment;
    let cancelled = false;

    Promise.all([
      getAssignableEmployees({ department }).catch(() => []),
      getDepartments().catch(() => []),
    ]).then(([emps, deps]) => {
      if (cancelled) return;
      const list = (Array.isArray(emps) ? emps : emps?.employees || [])
        .map(toStaff)
        .filter((e) => isBranchMode || String(e.department || '').trim().toLowerCase() === String(department).toLowerCase());
      setStaff(list);
      setDepartments((Array.isArray(deps) ? deps : []).map((d) => d?.name || d).filter(Boolean));
    });

    return () => {
      cancelled = true;
    };
  }, [scopeDepartment, isBranchMode]);

  const summary = dashboard?.summary || { total_open: 0, unassigned: 0, within_sla: 0, breached: 0 };
  const breachedQueue = useMemo(() => dashboard?.breached_queue || [], [dashboard]);

  // Live compliance among open tickets that have an SLA outcome so far; null when there is nothing to measure.
  const liveCompliance = useMemo(() => {
    const measured = (summary.within_sla || 0) + (summary.breached || 0);
    return measured > 0 ? Math.round((summary.within_sla / measured) * 100) : null;
  }, [summary.within_sla, summary.breached]);

  const breachesByAssignee = useMemo(() => {
    const counts = {};
    breachedQueue.forEach((row) => {
      if (row.assignee_id) counts[row.assignee_id] = (counts[row.assignee_id] || 0) + 1;
    });
    return counts;
  }, [breachedQueue]);

  const staffRows = useMemo(
    () =>
      [...staff]
        .map((s) => ({ ...s, breached: breachesByAssignee[s.id] || 0 }))
        .sort((a, b) => b.breached - a.breached || a.name.localeCompare(b.name))
        .slice(0, 8),
    [staff, breachesByAssignee]
  );

  const showToast = (type, text) => {
    setToastMessage({ type, text });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleAssignSave = useCallback(
    async (updated) => {
      try {
        await assignTicketToEmployees({
          ticketId: updated.ticket_ID,
          employeeIds: updated.assigned,
          assignedByEmail: user?.email,
          priorityId: PRIORITY_IDS[updated.priority] ?? undefined,
        });
        const names = staff.filter((s) => (updated.assigned || []).includes(s.id)).map((s) => s.name);
        showToast('success', `Ticket reassigned to ${names.join(', ') || 'the selected staff'}.`);
        loadData({ forceRefresh: true });
        return true;
      } catch (err) {
        showToast('error', 'Failed to reassign the ticket. Please try again.');
        return false;
      }
    },
    [user?.email, staff, loadData]
  );

  const dateStr = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());

  const refreshButton = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => loadData({ forceRefresh: true })}
      disabled={isRefreshing}
      className="text-xs gap-2 cursor-pointer"
    >
      {isRefreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" /> : <RefreshCw className="w-3.5 h-3.5 text-accent" />}
      <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
    </Button>
  );

  const showSkeleton = loading && !dashboard;
  const colSpan = isBranchMode ? 8 : 7;

  return (
    <div className="w-full max-w-full space-y-6">
      {toastMessage && (
        <div
          role="status"
          className={cn(
            'fixed top-20 right-6 z-50 flex items-center gap-2 px-4 py-2 border rounded-xl shadow-lg animate-in fade-in slide-in-from-top-2',
            toastMessage.type === 'error'
              ? 'bg-rose-50 text-rose-800 border-rose-200'
              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
          )}
        >
          {toastMessage.type === 'error' ? (
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          ) : (
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
          )}
          <span className="text-xs font-semibold">{toastMessage.text}</span>
        </div>
      )}

      <PageHeader
        pattern="B"
        title={title}
        subtitle={`${subtitle}${scope?.branch_name ? ` · ${scope.branch_name}` : ''} — ${dateStr}`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={() => navigate(queueRoute)}
              className="text-xs bg-[#252578] hover:bg-[#1d1d60] text-white font-semibold gap-2 shadow-xs cursor-pointer"
            >
              <Inbox className="w-3.5 h-3.5" />
              <span>{queueLabel}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
            {refreshButton}
          </div>
        }
      />

      {error && (
        <PersistentBanner
          variant="error"
          title="Live SLA data unavailable"
          message={error}
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setLoading(!dashboard);
                loadData({ forceRefresh: true });
              }}
              disabled={isRefreshing}
              className="text-xs gap-2 cursor-pointer"
            >
              {isRefreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Retry
            </Button>
          }
        />
      )}

      {!(error && !dashboard) && (
        <>
          {/* SECTION 1: SLA OVERVIEW SUMMARY CARDS */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title={totalLabel}
              value={summary.total_open}
              loading={showSkeleton}
              icon={<Layers className="w-5 h-5 text-accent" />}
              iconBg="bg-blue-50 text-accent"
            />
            <MetricCard
              title="Unassigned Tickets"
              value={summary.unassigned}
              loading={showSkeleton}
              icon={<Inbox className="w-5 h-5 text-amber-600" />}
              iconBg="bg-amber-50 text-amber-600"
              variant="amber"
            />
            <MetricCard
              title="Within SLA"
              value={summary.within_sla}
              loading={showSkeleton}
              icon={<CheckCircle2 className="w-5 h-5 text-emerald-600" />}
              iconBg="bg-emerald-50 text-emerald-600"
            />
            <MetricCard
              title="Breached Tickets"
              value={summary.breached}
              loading={showSkeleton}
              icon={<ShieldAlert className="w-5 h-5 text-rose-600" />}
              iconBg="bg-rose-50 text-rose-600"
              variant="crimson"
            />
          </div>

          {/* SECTION 2: SLA HEALTH & STAFF */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-card rounded-xl border border-border p-6 space-y-4 shadow-xs">
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-bold text-foreground">SLA Health Overview</h3>
                </div>
                <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary">
                  Live
                </Badge>
              </div>

              {showSkeleton ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : (
                <div className="space-y-2">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-muted-foreground font-medium">Open tickets within SLA</span>
                      <span className="font-bold text-foreground">
                        {liveCompliance === null ? 'No data' : `${liveCompliance}%`}
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
                        style={{ width: `${liveCompliance ?? 0}%` }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2">
                    <div className="p-2 bg-emerald-50/60 rounded-xl border border-emerald-100 text-center">
                      <p className="text-[10px] font-semibold text-emerald-800">On Track</p>
                      <p className="text-lg font-bold text-emerald-900">{summary.within_sla}</p>
                    </div>
                    <div className="p-2 bg-rose-50/60 rounded-xl border border-rose-100 text-center">
                      <p className="text-[10px] font-semibold text-rose-800">Breached</p>
                      <p className="text-lg font-bold text-rose-900">{summary.breached}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="lg:col-span-2 bg-card rounded-xl border border-border p-6 space-y-4 shadow-xs">
              <div className="flex items-center justify-between border-b border-border/60 pb-2">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-bold text-foreground">{staffLabel} SLA Breaches</h3>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate(queueRoute)}
                  className="text-xs text-accent hover:text-primary p-0 h-auto cursor-pointer"
                >
                  Manage Assignments →
                </Button>
              </div>

              {showSkeleton ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-12 w-full rounded-xl" />
                  ))}
                </div>
              ) : staffRows.length === 0 ? (
                <p className="text-xs text-muted-foreground">No assignable staff found for this team.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {staffRows.map((s) => (
                    <div
                      key={s.id}
                      className="p-2 rounded-xl border border-border bg-slate-50/50 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-foreground truncate">{s.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {[s.role, isBranchMode ? s.department : null].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      {s.breached > 0 ? (
                        <span className="text-[10px] font-bold px-2 py-1 rounded-md bg-rose-100 text-rose-700 shrink-0">
                          {s.breached} Breached
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold px-2 py-1 rounded-md bg-white border border-slate-200 text-slate-700 shrink-0">
                          On Track
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {isBranchMode && summary.unassigned > 0 && (
                <div className="p-2 bg-amber-50/60 rounded-xl border border-amber-100 text-xs text-amber-900 flex items-center justify-between gap-2">
                  <span>
                    <strong>{summary.unassigned}</strong> open tickets in this branch have no assignee.
                  </span>
                  <Button
                    size="sm"
                    onClick={() => navigate(queueRoute)}
                    className="text-xs bg-[#252578] hover:bg-[#1d1d60] text-white shrink-0 h-8 cursor-pointer"
                  >
                    Assign Tickets
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* SECTION 3: BREACHED TICKETS QUEUE */}
          <div className="space-y-2">
            <div className="p-4 rounded-xl border border-rose-200 bg-rose-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-rose-900">Breached Tickets Queue</h3>
                    <Badge variant="destructive" size="sm" className="text-[10px]">
                      {breachedQueue.length} Overdue
                    </Badge>
                  </div>
                  <p className="text-xs text-rose-700">{breachedDescription}</p>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-xl border border-border shadow-xs overflow-hidden">
              <div className="overflow-x-auto min-h-[300px]">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 border-b border-border">
                      <TableHead className="w-32 font-semibold text-xs">Ticket ID</TableHead>
                      <TableHead className="min-w-[240px] font-semibold text-xs">Subject</TableHead>
                      <TableHead className="w-28 font-semibold text-xs">Priority</TableHead>
                      {isBranchMode && <TableHead className="w-32 font-semibold text-xs">Department</TableHead>}
                      <TableHead className="min-w-[160px] font-semibold text-xs">Assigned To</TableHead>
                      <TableHead className="w-44 font-semibold text-xs text-rose-700">Overdue Duration</TableHead>
                      <TableHead className="w-40 font-semibold text-xs">SLA Due</TableHead>
                      <TableHead className="w-32 text-right font-semibold text-xs">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {showSkeleton ? (
                      <DataTableSkeleton columns={colSpan} rows={4} />
                    ) : breachedQueue.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={colSpan} className="h-48 text-center">
                          <div className="flex flex-col items-center justify-center space-y-2">
                            <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                              <CheckCircle2 className="w-5 h-5" />
                            </div>
                            <p className="text-sm font-bold text-foreground">Zero SLA Breaches!</p>
                            <p className="text-xs text-muted-foreground">{emptyDescription}</p>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      breachedQueue.map((row) => (
                        <TableRow
                          key={row.ticket_ID}
                          onClick={() => setDetailModalTicket(toTicket(row))}
                          className="cursor-pointer hover:bg-slate-50/80 transition-colors duration-150"
                        >
                          <TableCell className="font-mono text-xs font-bold text-rose-700">{row.ticket_number}</TableCell>

                          <TableCell>
                            <div className="space-y-1">
                              <p
                                onClick={() => setDetailModalTicket(toTicket(row))}
                                className="text-xs font-bold text-foreground hover:text-rose-700 cursor-pointer transition-colors line-clamp-1"
                                title={row.title}
                              >
                                {row.title}
                              </p>
                              {row.status_name && (
                                <p className="text-[11px] text-muted-foreground line-clamp-1">{row.status_name}</p>
                              )}
                            </div>
                          </TableCell>

                          <TableCell>
                            {row.priority_name ? (
                              <Badge variant={getStatusBadgeVariant(row.priority_name)} className="text-[10px]">
                                {row.priority_name}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>

                          {isBranchMode && (
                            <TableCell className="text-xs text-foreground">{row.department || 'Unassigned'}</TableCell>
                          )}

                          <TableCell>
                            {row.assignee_name ? (
                              <div className="flex items-center gap-2">
                                <div className="w-5 h-5 rounded-full bg-[#252578]/10 text-[#252578] font-bold text-[10px] flex items-center justify-center shrink-0">
                                  {row.assignee_name.charAt(0)}
                                </div>
                                <span className="text-xs font-semibold text-foreground truncate max-w-[140px]">
                                  {row.assignee_name}
                                </span>
                              </div>
                            ) : (
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                                Unassigned
                              </span>
                            )}
                          </TableCell>

                          <TableCell>
                            <span className="inline-flex items-center gap-2 px-2 py-1 rounded-lg text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200">
                              <Clock className="w-3.5 h-3.5 text-rose-600" />
                              {formatOverdueMinutes(row.overdue_minutes)}
                            </span>
                          </TableCell>

                          <TableCell className="text-xs text-muted-foreground font-mono">
                            {row.resolution_due_at ? new Date(row.resolution_due_at).toLocaleString() : '—'}
                          </TableCell>

                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAssignModalTicket(toTicket(row));
                                }}
                                className="text-xs h-8 px-2 bg-[#252578] hover:bg-[#1d1d60] text-white font-medium gap-1 cursor-pointer"
                              >
                                <UserCheck className="w-3 h-3" />
                                <span>{row.assignee_id ? 'Reassign' : 'Assign'}</span>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </>
      )}

      {assignModalTicket && (
        <AssignModal
          ticket={assignModalTicket}
          employees={staff}
          departments={departments}
          priorityOptions={['Low', 'Medium', 'High', 'Critical']}
          onClose={() => setAssignModalTicket(null)}
          onSave={handleAssignSave}
        />
      )}

      {detailModalTicket && (
        <CustomerTicketDetailModal
          ticket={detailModalTicket}
          isOpen={Boolean(detailModalTicket)}
          onClose={() => setDetailModalTicket(null)}
        />
      )}
    </div>
  );
}
