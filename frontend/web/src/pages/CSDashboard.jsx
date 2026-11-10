import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import {
  Inbox,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  SlidersHorizontal,
  Loader2,
  ShieldAlert,
  PauseCircle,
  RefreshCw,
  ExternalLink,
  UserCheck,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getCSDashboardSummary,
  getTicketDetails,
  getAssignableEmployees,
  getDepartments,
  acceptTicket,
} from '@/services/ticketService';
import { AssignModal } from '@/components/CSModals';
import { useAuth } from '@/context/AuthContext';
import useRealtimeRefresh from '@/hooks/useRealtimeRefresh';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';
import { formatDisplayDate } from '@/utils/dateUtils';
import CustomerTicketDetailModal from '@/components/CustomerTicketDetailModal';
import SlaStatusBadge from '@/components/sla/SlaStatusBadge';
import { DashboardHeader } from '@/components/ui/page-header';
import { MetricCard } from '@/components/ui/metric-card';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { DataTableSkeleton } from '@/components/ui/data-table';

export default function CSDashboard() {
  const { refreshKey = 0 } = useOutletContext() || {};
  const navigate = useNavigate();
  const { user } = useAuth();

  // Section states & bifurcated loading
  const [loadingWorkload, setLoadingWorkload] = useState(true);
  const [workloadError, setWorkloadError] = useState(null);

  const [loadingQueued, setLoadingQueued] = useState(true);
  const [queuedError, setQueuedError] = useState(null);
  const [queuedTickets, setQueuedTickets] = useState([]);

  const [loadingAttention, setLoadingAttention] = useState(true);
  const [attentionError, setAttentionError] = useState(null);
  const [attentionTickets, setAttentionTickets] = useState([]);

  const [assignedStatusCounts, setAssignedStatusCounts] = useState({
    open: 0,
    inProgress: 0,
    onHold: 0,
    resolved: 0,
  });

  const [workloadMetrics, setWorkloadMetrics] = useState({
    queuedCount: 0,
    assignedCount: 0,
    atRiskCount: 0,
    breachedCount: 0,
    pendingReassignCount: 0,
    escalatedCount: 0,
  });

  const [selectedTicket, setSelectedTicket] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  useLockBodyScroll(modalLoading);
  const [newTicketId, setNewTicketId] = useState(null);
  const [assignModalTicket, setAssignModalTicket] = useState(null);
  const [assignEmployees, setAssignEmployees] = useState([]);
  const [assignDepartments, setAssignDepartments] = useState([]);

  useEffect(() => {
    let isMounted = true;
    Promise.all([
      getAssignableEmployees({ forceRefresh: false }).catch(() => []),
      getDepartments({ forceRefresh: false }).catch(() => []),
    ]).then(([emps, deps]) => {
      if (!isMounted) return;
      setAssignEmployees(Array.isArray(emps) ? emps : (emps?.data || []));
      setAssignDepartments(Array.isArray(deps) ? deps : (deps?.data || ['Service', 'IT Department', 'Customer Service']));
    });
    return () => {
      isMounted = false;
    };
  }, []);
  const newTicketTimerRef = useRef(null);

  const displayName = user?.first_name
    ? `${user.first_name}${user.last_name ? ' ' + user.last_name : ''}`
    : user?.name || 'Customer Service Representative';

  // Active view toggle: 'all' (Overview), 'attention' (Immediate Attention), 'queued' (Incoming Queue), 'assigned' (Assigned & Monitored)
  const [activeSection, setActiveSection] = useState('all');

  // ─── SLA helper ───────────────────────────────────────────────────────────
  // ─── Load the signed in agent's own summary ─────────────────────────────────
  // One call returns queue, monitored tickets, workload and attention items for this agent only.
  // Sections the server could not compute come back in partial_errors and show their own error state.
  const loadDashboardData = useCallback(async () => {
    setLoadingWorkload(true);
    setLoadingQueued(true);
    setLoadingAttention(true);
    setWorkloadError(null);
    setQueuedError(null);
    setAttentionError(null);

    try {
      const summary = await getCSDashboardSummary({ limit: 20 });
      const failed = new Set((summary?.partial_errors || []).map((e) => e.section));

      if (failed.has('queued_tickets')) {
        setQueuedError('Incoming queued tickets failed to load.');
      } else {
        setQueuedTickets(
          (summary?.queued_tickets?.items || []).slice(0, 6).map((t) => ({
            ...t,
            id: t.ref || `TKT-${t.ticket_ID}`,
            updated: t.created_at ? formatDisplayDate(t.created_at) : 'Recently',
          }))
        );
      }

      if (failed.has('assigned_monitored') || failed.has('workload_metrics')) {
        setWorkloadError('Workload summary data is temporarily unavailable.');
      } else {
        const byStatus = summary?.assigned_monitored?.by_status || {};
        setAssignedStatusCounts({
          open: byStatus['Open'] ?? 0,
          inProgress: byStatus['In Progress'] ?? 0,
          onHold: byStatus['On Hold'] ?? 0,
          resolved: byStatus['Resolved'] ?? 0,
        });
        setWorkloadMetrics({
          queuedCount: summary?.queued_tickets?.count ?? 0,
          assignedCount: summary?.workload_metrics?.active_tickets ?? 0,
          atRiskCount: summary?.workload_metrics?.at_risk ?? 0,
          breachedCount: summary?.workload_metrics?.breached ?? 0,
          pendingReassignCount: summary?.workload_metrics?.pending_reassignments ?? 0,
          escalatedCount: byStatus['Escalated'] ?? 0,
        });
      }

      if (failed.has('needs_attention') || failed.has('pending_reassignments')) {
        setAttentionError('Tickets needing immediate attention could not be fetched.');
      } else {
        setAttentionTickets(
          (summary?.needs_attention?.items || []).slice(0, 5).map((t) => ({
            ...t,
            id: t.ref || `TKT-${t.ticket_ID}`,
            attentionType: t.reason === 'Breached' ? 'breached' : t.reason === 'At Risk' ? 'at_risk' : 'reassign',
            updated: t.requested_at || t.created_at ? formatDisplayDate(t.requested_at || t.created_at) : 'Recently',
          }))
        );
      }
    } catch {
      setQueuedError('Incoming queued tickets failed to load.');
      setWorkloadError('Workload summary data is temporarily unavailable.');
      setAttentionError('Tickets needing immediate attention could not be fetched.');
    } finally {
      setLoadingWorkload(false);
      setLoadingQueued(false);
      setLoadingAttention(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData, refreshKey]);

  // Real-time listener for near-real-time updates
  const handleRealtimeUpdate = useCallback((context) => {
    if (context && context.source === 'websocket') {
      const payload = context.payload;
      if (!payload) return;
      const { action, ticket } = payload;
      if (!ticket) return;

      if (action === 'created') {
        setQueuedTickets((prev) => {
          const exists = prev.some((t) => t.id === ticket.id || t.ticket_ID === ticket.ticket_ID);
          if (exists) return prev;
          const formatted = {
            ...ticket,
            id: ticket.id || `TKT-${ticket.ticket_ID}`,
            updated: 'Just now',
          };
          return [formatted, ...prev].slice(0, 6);
        });

        const tid = ticket.id || ticket.ticket_ID;
        setNewTicketId(tid);
        if (newTicketTimerRef.current) clearTimeout(newTicketTimerRef.current);
        newTicketTimerRef.current = setTimeout(() => setNewTicketId(null), 15000);

        setWorkloadMetrics((prev) => ({
          ...prev,
          queuedCount: prev.queuedCount + 1,
        }));
      }
    }
  }, []);

  useRealtimeRefresh({
    refresh: handleRealtimeUpdate,
    channels: [{ name: 'ticket-updates', event: 'ticket.changed' }],
    intervalMs: 30000,
    deferRefresh: false,
  });

  // Contextual ticket details modal viewer with assignment dispatch
  const handleViewTicket = useCallback(async (t) => {
    setModalLoading(true);
    try {
      const ticketId = t.ticket_ID || parseInt(String(t.id || '').replace(/\D/g, ''), 10);
      const full = await getTicketDetails(ticketId);
      setSelectedTicket({ ...t, ...full, description: full?.description || t.description || '' });
    } catch {
      setSelectedTicket(t);
    } finally {
      setModalLoading(false);
    }
  }, []);

  // Assign employees to a ticket from the dashboard. Resolves true on success so
  // AssignModal can close itself, or throws so the modal can show the error.
  const handleAssignSave = useCallback(async (updated) => {
    const priorityMap = { Low: 1, Medium: 2, High: 3, Critical: 4 };
    const targetTicketId = updated.ticket_ID || Number(String(updated.id || '').replace(/\D/g, ''));

    await acceptTicket({
      ticketId: targetTicketId,
      employeeIds: updated.assigned,
      assignedByEmail: user?.email,
      priorityId: priorityMap[updated.priority] ?? 1,
    });

    window.dispatchEvent(new Event('notifications:updated'));
    loadDashboardData();
    return true;
  }, [user?.email, loadDashboardData]);

  return (
    <div className="space-y-6 w-full min-w-0 max-w-full">
      {/* Pattern A Header */}
      <DashboardHeader
        greeting="Customer Service Traffic Dashboard"
        userName={displayName}
        subtitle="Manage incoming ticket queues, monitor assigned workload, and triage SLA risks."
        badgeText="Active Service"
        badgeVariant="emerald"
      />

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* CONSOLIDATED HERO KPI ROW (4 MACRO OPERATIONAL CARDS)                 */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          title="Queued Tickets"
          value={workloadMetrics.queuedCount}
          subtitle="Awaiting CS review"
          icon={<Inbox className="w-4 h-4 text-accent" />}
          loading={loadingQueued}
          onClick={() => navigate('/cs/incoming')}
          className="cursor-pointer hover:shadow-md transition-shadow"
        />
        <MetricCard
          title="Assigned Workload"
          value={workloadMetrics.assignedCount}
          subtitle="Technicians actively assigned"
          icon={<UserCheck className="w-4 h-4 text-primary" />}
          loading={loadingWorkload}
          onClick={() => navigate('/cs/assigned')}
          className="cursor-pointer hover:shadow-md transition-shadow"
        />
        <MetricCard
          title="Approaching SLA"
          value={workloadMetrics.atRiskCount}
          subtitle="Near threshold (warning)"
          icon={<Clock className="w-4 h-4 text-amber-600" />}
          variant="amber"
          loading={loadingWorkload}
          onClick={() => navigate('/cs/incoming?sla=At+Risk')}
          className="cursor-pointer hover:shadow-md transition-shadow"
        />
        <MetricCard
          title="SLA Breached"
          value={workloadMetrics.breachedCount}
          subtitle="Resolution overdue"
          icon={<AlertTriangle className="w-4 h-4 text-rose-600" />}
          variant="crimson"
          loading={loadingWorkload}
          onClick={() => navigate('/cs/incoming?sla=Breached')}
          className="cursor-pointer hover:shadow-md transition-shadow"
        />
      </div>

      {/* Visual Navigation Pill Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-muted/40 p-1.5 rounded-xl border border-border w-fit flex-wrap">
          <Button
            variant={activeSection === 'all' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveSection('all')}
            className="text-xs gap-1.5"
          >
            <span>All Overview</span>
          </Button>
          <Button
            variant={activeSection === 'attention' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveSection('attention')}
            className="text-xs gap-1.5"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
            <span>Immediate Attention</span>
            <Badge variant="destructive" className="ml-1 text-[10px]">{attentionTickets.length}</Badge>
          </Button>
          <Button
            variant={activeSection === 'queued' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveSection('queued')}
            className="text-xs gap-1.5"
          >
            <Inbox className="w-3.5 h-3.5 text-accent" />
            <span>Incoming Queue</span>
            <Badge variant="secondary" className="ml-1 text-[10px]">{workloadMetrics.queuedCount}</Badge>
          </Button>
          <Button
            variant={activeSection === 'assigned' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveSection('assigned')}
            className="text-xs gap-1.5"
          >
            <UserCheck className="w-3.5 h-3.5 text-primary" />
            <span>Assigned &amp; Monitored</span>
            <Badge variant="secondary" className="ml-1 text-[10px]">{workloadMetrics.assignedCount}</Badge>
          </Button>
        </div>

        <span className="text-[11px] text-muted-foreground bg-muted/40 px-2.5 py-1 rounded-md border border-border w-fit">
          Read-Only Summary
        </span>
      </div>

      {workloadError && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-xs text-destructive flex items-center justify-between">
          <span>{workloadError}</span>
          <Button variant="outline" size="sm" onClick={() => loadDashboardData()} className="h-7 text-xs">
            <RefreshCw className="w-3.5 h-3.5 mr-1" /> Retry
          </Button>
        </div>
      )}

      {/* SECTION 1: TICKETS NEEDING IMMEDIATE ATTENTION */}
      {(activeSection === 'all' || activeSection === 'attention') && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-foreground">Section I: Immediate Attention</h2>
                  {attentionTickets.length > 0 ? (
                    <Badge variant="destructive" className="text-[10px]">{attentionTickets.length} Urgent</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">All Clear</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  SLA breached, approaching breach, and pending technician reassignment tickets requiring prompt CS traffic handling.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/cs/incoming?sla=Breached')}
              className="text-xs gap-1.5 shrink-0"
            >
              <span>Open Incoming Queue</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>

          {attentionError ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-xs text-destructive flex items-center justify-between">
              <span>{attentionError}</span>
              <Button variant="outline" size="sm" onClick={() => loadDashboardData()} className="h-7 text-xs">
                <RefreshCw className="w-3.5 h-3.5 mr-1" /> Retry
              </Button>
            </div>
          ) : loadingAttention ? (
            <div className="overflow-hidden rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[130px]">Ticket ID</TableHead>
                    <TableHead>Issue / Subject</TableHead>
                    <TableHead>Attention Reason</TableHead>
                    <TableHead>Current SLA</TableHead>
                    <TableHead className="w-[100px] text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <DataTableSkeleton columns={5} rows={3} />
                </TableBody>
              </Table>
            </div>
          ) : attentionTickets.length === 0 ? (
            <div className="rounded-lg border border-border/60 bg-muted/20 py-8 text-center text-xs text-muted-foreground">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
              <p className="font-semibold text-foreground">No urgent tickets pending attention</p>
              <p className="mt-0.5">All tickets are currently within acceptable SLA thresholds with zero pending reassignments.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[130px]">Ticket ID</TableHead>
                    <TableHead>Issue / Subject</TableHead>
                    <TableHead>Attention Reason</TableHead>
                    <TableHead>Current SLA</TableHead>
                    <TableHead className="w-[100px] text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attentionTickets.map((t) => (
                    <TableRow
                      key={t.id}
                      onClick={() => handleViewTicket(t)}
                      className="hover:bg-muted/40 transition-colors cursor-pointer"
                    >
                      <TableCell className="font-semibold text-primary text-xs whitespace-nowrap">
                        {t.id}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-foreground text-xs truncate max-w-xs">{t.title}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{t.customer}</div>
                      </TableCell>
                      <TableCell>
                        {t.attentionType === 'reassign' ? (
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-md inline-flex">
                            <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            <span>Reassignment Pending</span>
                          </div>
                        ) : t.attentionType === 'breached' ? (
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-md inline-flex">
                            <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                            <span>SLA Breached</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-md inline-flex">
                            <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            <span>Approaching Breach</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <SlaStatusBadge ticket={t} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleViewTicket(t);
                          }}
                          className="h-7 text-xs px-2.5"
                        >
                          Triage
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* SECTION 2: INCOMING QUEUED TICKETS */}
      {(activeSection === 'all' || activeSection === 'queued') && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/20 text-accent flex items-center justify-center shrink-0">
                <Inbox className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-foreground">Section II: Incoming Queued Tickets</h2>
                  <Badge variant="outline" className="text-[10px] bg-accent/5 text-accent border-accent/20">
                    Unassigned Queue ({workloadMetrics.queuedCount})
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Tickets awaiting initial CS validation, category triage, and technician dispatch.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/cs/incoming')}
              className="text-xs gap-1.5 shrink-0"
            >
              <span>View Queue</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
                Queued Tickets Awaiting Triage ({queuedTickets.length})
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/cs/incoming')}
                className="text-xs text-primary hover:text-primary gap-1"
              >
                <span>View All</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </div>

            {queuedError ? (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-xs text-destructive flex items-center justify-between">
                <span>{queuedError}</span>
                <Button variant="outline" size="sm" onClick={() => loadDashboardData()} className="h-7 text-xs">
                  <RefreshCw className="w-3.5 h-3.5 mr-1" /> Retry
                </Button>
              </div>
            ) : loadingQueued ? (
              <div className="overflow-hidden rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[130px]">Ticket ID</TableHead>
                      <TableHead>Title / Subject</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead className="w-[130px]">Received</TableHead>
                      <TableHead className="w-[100px] text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <DataTableSkeleton columns={7} rows={3} />
                  </TableBody>
                </Table>
              </div>
            ) : queuedTickets.length === 0 ? (
              <div className="rounded-lg border border-border/60 bg-muted/20 py-8 text-center text-xs text-muted-foreground">
                <Inbox className="w-8 h-8 text-muted-foreground/60 mx-auto mb-2" />
                <p className="font-semibold text-foreground">Queue is clear</p>
                <p className="mt-0.5">No unassigned incoming tickets currently awaiting triage.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[130px]">Ticket ID</TableHead>
                      <TableHead>Title / Subject</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead className="w-[130px]">Received</TableHead>
                      <TableHead className="w-[100px] text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {queuedTickets.map((t) => (
                      <TableRow
                        key={t.id}
                        onClick={() => handleViewTicket(t)}
                        className="hover:bg-muted/40 transition-colors cursor-pointer"
                      >
                        <TableCell className="font-semibold text-primary text-xs whitespace-nowrap">
                          {t.id}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-foreground text-xs truncate max-w-xs">{t.title}</div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs truncate">
                          {t.customer || 'Customer'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={getStatusBadgeVariant(t.status)}>{t.status}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={t.priority === 'Critical' ? 'destructive' : t.priority === 'High' ? 'warning' : 'secondary'}>
                            {t.priority}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {t.updated}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleViewTicket(t);
                            }}
                            className="h-7 text-xs px-2.5"
                          >
                            Triage
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECTION 3: ASSIGNED & MONITORED TICKETS */}
      {(activeSection === 'all' || activeSection === 'assigned') && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                <UserCheck className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-foreground">Section III: Assigned &amp; Monitored Tickets</h2>
                  <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary border-primary/20">
                    Active Workload ({workloadMetrics.assignedCount})
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Summary of active tickets delegated to technicians under continuous CS SLA monitoring.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/cs/assigned')}
              className="text-xs gap-1.5 shrink-0"
            >
              <span>View Assigned</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Status Breakdown Filter Pills */}
          <div className="flex items-center gap-2 flex-wrap bg-muted/20 p-3 rounded-xl border border-border/80">
            <span className="text-xs font-semibold text-foreground mr-1">Status Breakdown:</span>
            <button
              onClick={() => navigate('/cs/assigned?status=Open')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-card hover:bg-muted/60 text-foreground border border-border shadow-2xs transition-colors cursor-pointer"
            >
              <span className="text-muted-foreground">Open</span>
              <span className="font-bold text-primary">{assignedStatusCounts.open}</span>
            </button>
            <button
              onClick={() => navigate('/cs/assigned?status=In+Progress')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-card hover:bg-muted/60 text-foreground border border-border shadow-2xs transition-colors cursor-pointer"
            >
              <span className="text-muted-foreground">In Progress</span>
              <span className="font-bold text-amber-600">{assignedStatusCounts.inProgress}</span>
            </button>
            <button
              onClick={() => navigate('/cs/assigned?status=On+Hold')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-card hover:bg-muted/60 text-foreground border border-border shadow-2xs transition-colors cursor-pointer"
            >
              <PauseCircle className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">On Hold</span>
              <span className="font-bold text-slate-700">{assignedStatusCounts.onHold}</span>
            </button>
            <button
              onClick={() => navigate('/cs/assigned?status=Resolved')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-card hover:bg-muted/60 text-foreground border border-border shadow-2xs transition-colors cursor-pointer"
            >
              <span className="text-muted-foreground">Resolved</span>
              <span className="font-bold text-emerald-600">{assignedStatusCounts.resolved}</span>
            </button>
          </div>

          <div className="p-4 rounded-xl border border-border/80 bg-muted/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <span>Traffic Routing &amp; Monitoring Rules</span>
                <Badge variant="outline" className="text-[10px]">Active</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
                Assigned tickets undergo continuous SLA tracking. Action triggers (assignment, hold, resolve, reassign) are managed from the dedicated Queue views.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/cs/assigned')}
              className="text-xs text-primary hover:text-primary gap-1 shrink-0 self-start sm:self-auto"
            >
              <span>Navigate to Assigned List</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* ─── TICKET DETAILS MODAL WITH ACTIVE ASSIGNMENT DISPATCH ────────────── */}
      {selectedTicket && (
        <CustomerTicketDetailModal
          ticket={selectedTicket}
          onClose={() => setSelectedTicket(null)}
          onDiscard={null}
          onReopen={null}
          onResolve={null}
          allowReopen={false}
          customerName={selectedTicket.customer}
          onAssign={(t) => {
            const ticketToAssign = t || selectedTicket;
            setSelectedTicket(null);
            setAssignModalTicket(ticketToAssign);
          }}
          onViewTicket={(t) => {
            setSelectedTicket(null);
            navigate(`/cs/history/${t.ticket_ID || Number(String(t.id).replace(/\D/g, ''))}`);
          }}
        />
      )}

      {assignModalTicket && (
        <AssignModal
          ticket={assignModalTicket}
          employees={assignEmployees}
          departments={assignDepartments}
          priorityOptions={['Low', 'Medium', 'High', 'Critical']}
          onClose={() => setAssignModalTicket(null)}
          onSave={handleAssignSave}
        />
      )}

      {modalLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs">
          <div className="bg-card border border-border rounded-xl p-6 shadow-xl flex flex-col items-center gap-3 max-w-xs w-full mx-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-semibold text-foreground">Loading ticket details...</p>
          </div>
        </div>
      )}
    </div>
  );
}
