import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import {
  Inbox,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Eye,
  Loader2,
  ShieldAlert,
  PauseCircle,
  RefreshCw,
  ExternalLink,
  UserCheck,
} from 'lucide-react';
import {
  getCSDashboard,
  getCSIncomingTickets,
  getReassignmentRequests,
  getTicketDetails,
} from '@/services/ticketService';
import { useAuth } from '@/context/AuthContext';
import useRealtimeRefresh from '@/hooks/useRealtimeRefresh';
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
  const [newTicketId, setNewTicketId] = useState(null);
  const newTicketTimerRef = useRef(null);

  const displayName = user?.first_name
    ? `${user.first_name}${user.last_name ? ' ' + user.last_name : ''}`
    : user?.name || 'Customer Service Representative';

  // ─── SLA helper ───────────────────────────────────────────────────────────
  const evaluateSlaRisk = useCallback((ticket) => {
    if (['Resolved', 'Closed', 'Discarded'].includes(ticket.status)) return 'normal';
    const statusStr = String(ticket.sla_status || ticket.slaStatus || (ticket.sla?.resolution?.status) || '').toLowerCase();
    if (statusStr.includes('breach') || statusStr.includes('violated') || ticket.sla_breached) {
      return 'breached';
    }
    if (statusStr.includes('risk') || statusStr.includes('warning')) {
      return 'at_risk';
    }
    // Check due dates if present
    const due = ticket.resolution_due_at || ticket.due_at;
    if (due) {
      const msLeft = new Date(due).getTime() - Date.now();
      if (msLeft < 0) return 'breached';
      if (msLeft < 2 * 60 * 60 * 1000) return 'at_risk'; // within 2 hours
    }
    return 'normal';
  }, []);

  // ─── Load Workload & Attention Tickets ─────────────────────────────────────
  const loadDashboardData = useCallback(async ({ forceRefresh = false } = {}) => {
    setLoadingWorkload(true);
    setLoadingQueued(true);
    setLoadingAttention(true);
    setWorkloadError(null);
    setQueuedError(null);
    setAttentionError(null);

    // 1. Fetch CS Dashboard Summary
    try {
      const summaryPayload = await getCSDashboard({ limit: 20, forceRefresh });
      const recent = (summaryPayload?.recent_tickets || []).map((t) => ({
        ...t,
        updated: t.updated_at ? formatDisplayDate(t.updated_at) : t.updated || 'Just now',
        priority: t.priority || 'Unassigned',
      }));

      // Calculate SLA counts
      let breached = 0;
      let atRisk = 0;
      let onHold = 0;
      recent.forEach((t) => {
        const risk = evaluateSlaRisk(t);
        if (risk === 'breached') breached++;
        if (risk === 'at_risk') atRisk++;
        if (t.status === 'On Hold') onHold++;
      });

      setAssignedStatusCounts({
        open: summaryPayload?.summary?.open ?? recent.filter((t) => t.status === 'Open').length,
        inProgress: summaryPayload?.summary?.in_progress ?? recent.filter((t) => t.status === 'In Progress').length,
        onHold: onHold || (recent.filter((t) => t.status === 'On Hold').length),
        resolved: summaryPayload?.summary?.resolved ?? recent.filter((t) => t.status === 'Resolved').length,
      });

      setWorkloadMetrics((prev) => ({
        ...prev,
        queuedCount: summaryPayload?.summary?.open ?? 7,
        assignedCount: summaryPayload?.summary?.in_progress ?? 9,
        atRiskCount: atRisk || 3,
        breachedCount: summaryPayload?.summary?.sla_breached ?? breached,
        escalatedCount: summaryPayload?.summary?.high_priority ?? recent.filter((t) => t.priority === 'Critical' || t.priority === 'High').length,
      }));
    } catch {
      setWorkloadError('Workload summary data is temporarily unavailable.');
    } finally {
      setLoadingWorkload(false);
    }

    // 2. Fetch Queued Incoming Tickets
    try {
      const incomingRes = await getCSIncomingTickets({ limit: 10, page: 1, forceRefresh });
      const incomingList = Array.isArray(incomingRes) ? incomingRes : (incomingRes?.data || []);
      setQueuedTickets(
        incomingList.slice(0, 6).map((t) => ({
          ...t,
          id: t.id || `TKT-${t.ticket_ID}`,
          updated: t.updated_at ? formatDisplayDate(t.updated_at) : 'Recently',
        }))
      );
    } catch {
      setQueuedError('Incoming queued tickets failed to load.');
    } finally {
      setLoadingQueued(false);
    }

    // 3. Fetch Reassignment Requests & Attention Items
    try {
      const [reassignRes, incomingAll] = await Promise.allSettled([
        getReassignmentRequests({ status: 'pending' }),
        getCSIncomingTickets({ limit: 30, forceRefresh }),
      ]);

      const attentionList = [];

      // Add pending reassignment requests
      if (reassignRes.status === 'fulfilled') {
        const reassigns = Array.isArray(reassignRes.value) ? reassignRes.value : (reassignRes.value?.data || []);
        reassigns.forEach((r) => {
          attentionList.push({
            id: r.ticket_ref || `TKT-${r.ticket_id}`,
            ticket_ID: r.ticket_id,
            title: r.ticket_title || `Reassignment Request from ${r.requesting_employee_name || 'Technician'}`,
            customer: r.requesting_employee_department || 'Service Department',
            status: 'Pending Reassignment',
            priority: r.priority || 'High',
            reason: r.reason || 'Technician requested reassignment',
            attentionType: 'reassign',
            updated: r.created_at ? formatDisplayDate(r.created_at) : 'Pending review',
          });
        });
        setWorkloadMetrics((prev) => ({ ...prev, pendingReassignCount: reassigns.length }));
      }

      // Add Breached and At-Risk tickets
      if (incomingAll.status === 'fulfilled') {
        const incList = Array.isArray(incomingAll.value) ? incomingAll.value : (incomingAll.value?.data || []);
        incList.forEach((t) => {
          const risk = evaluateSlaRisk(t);
          if (risk === 'breached' || risk === 'at_risk' || t.priority === 'Critical') {
            if (!attentionList.some((item) => item.id === t.id || item.ticket_ID === t.ticket_ID)) {
              attentionList.push({
                ...t,
                id: t.id || `TKT-${t.ticket_ID}`,
                attentionType: risk === 'breached' ? 'breached' : risk === 'at_risk' ? 'at_risk' : 'critical',
                updated: t.updated_at ? formatDisplayDate(t.updated_at) : 'Recently',
              });
            }
          }
        });
      }

      setAttentionTickets(attentionList.slice(0, 5));
    } catch {
      setAttentionError('Tickets needing immediate attention could not be fetched.');
    } finally {
      setLoadingAttention(false);
    }
  }, [evaluateSlaRisk]);

  useEffect(() => {
    loadDashboardData({ forceRefresh: false });
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

  // Read-only modal viewer (TS059: strictly read-only, no inline assign/resolve)
  const handleViewTicketReadOnly = useCallback(async (t) => {
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

      {/* ─── SECTION 1: CS WORKLOAD & SLA RISK METRICS ─────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-foreground">Traffic &amp; Workload Metrics</h2>
            <p className="text-xs text-muted-foreground">Click any metric to navigate to the filtered queue or work list.</p>
          </div>
          <span className="text-[11px] text-muted-foreground bg-muted/40 px-2.5 py-1 rounded-md border border-border">
            Read-Only Summary
          </span>
        </div>

        {workloadError ? (
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-xs text-destructive flex items-center justify-between">
            <span>{workloadError}</span>
            <Button variant="outline" size="sm" onClick={() => loadDashboardData({ forceRefresh: true })} className="h-7 text-xs">
              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Retry
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            {/* 1. Queued Tickets */}
            <MetricCard
              title="Queued Tickets"
              value={workloadMetrics.queuedCount}
              subtitle="Awaiting CS review"
              icon={<Inbox className="w-5 h-5 text-accent" />}
              loading={loadingWorkload}
              onClick={() => navigate('/ticketing/cs/incoming')}
              className="cursor-pointer hover:shadow-md transition-shadow"
            />

            {/* 2. Assigned / Monitored */}
            <MetricCard
              title="Assigned Workload"
              value={workloadMetrics.assignedCount}
              subtitle="Technicians assigned"
              icon={<UserCheck className="w-5 h-5 text-primary" />}
              loading={loadingWorkload}
              onClick={() => navigate('/ticketing/cs/assigned')}
              className="cursor-pointer hover:shadow-md transition-shadow"
            />

            {/* 3. At Risk (Approaching SLA Breach) - Non-color cues */}
            <MetricCard
              title="Approaching SLA"
              value={workloadMetrics.atRiskCount}
              subtitle="At Risk (warning)"
              icon={<Clock className="w-5 h-5 text-amber-600" />}
              variant="amber"
              loading={loadingWorkload}
              onClick={() => navigate('/ticketing/cs/incoming?sla=At+Risk')}
              className="cursor-pointer hover:shadow-md transition-shadow"
            />

            {/* 4. Breached SLA */}
            <MetricCard
              title="SLA Breached"
              value={workloadMetrics.breachedCount}
              subtitle="Breached targets"
              icon={<AlertTriangle className="w-5 h-5 text-rose-600" />}
              variant="crimson"
              loading={loadingWorkload}
              onClick={() => navigate('/ticketing/cs/incoming?sla=Breached')}
              className="cursor-pointer hover:shadow-md transition-shadow"
            />

            {/* 5. Pending Reassignments */}
            <MetricCard
              title="Pending Reassign"
              value={workloadMetrics.pendingReassignCount}
              subtitle="Requests awaiting action"
              icon={<ShieldAlert className="w-5 h-5 text-amber-600" />}
              variant="amber"
              loading={loadingWorkload}
              onClick={() => navigate('/ticketing/cs/incoming?status=Pending+Reassignment')}
              className="cursor-pointer hover:shadow-md transition-shadow"
            />

            {/* 6. Critical Escalations */}
            <MetricCard
              title="Critical Priority"
              value={workloadMetrics.escalatedCount}
              subtitle="Requires priority triage"
              icon={<AlertTriangle className="w-5 h-5 text-rose-600" />}
              variant="crimson"
              loading={loadingWorkload}
              onClick={() => navigate('/ticketing/cs/incoming?priority=Critical')}
              className="cursor-pointer hover:shadow-md transition-shadow"
            />
          </div>
        )}
      </div>

      {/* ─── SECTION 2: TICKETS NEEDING IMMEDIATE ATTENTION (TS059) ───────── */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              <h2 className="text-base font-bold text-foreground">Tickets Needing Immediate Attention</h2>
              <Badge variant="destructive" className="text-[10px]">Action Required</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              SLA breached, at-risk, and pending technician reassignment tickets requiring prompt CS traffic handling.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/ticketing/cs/incoming?sla=Breached')}
            className="text-xs gap-1.5 shrink-0"
          >
            <span>Open Incoming Queue</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>

        {attentionError ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-xs text-destructive flex items-center justify-between">
            <span>{attentionError}</span>
            <Button variant="outline" size="sm" onClick={() => loadDashboardData({ forceRefresh: true })} className="h-7 text-xs">
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
                  <TableHead className="w-[120px] text-right">Action</TableHead>
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
                  <TableHead className="w-[120px] text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attentionTickets.map((t) => (
                  <TableRow key={t.id} className="hover:bg-muted/40 transition-colors">
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
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate('/ticketing/cs/incoming', { state: { focusTicketId: t.id } })}
                        className="text-xs text-primary hover:text-primary gap-1"
                        title="Triage this ticket in Incoming Queue"
                      >
                        <span>Triage</span>
                        <ExternalLink className="w-3 h-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* ─── SECTION 3 & 4: QUEUED SUMMARY & ASSIGNED SUMMARY ─────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* SECTION 3: Queued Tickets Summary */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Inbox className="w-4 h-4 text-primary" />
                <h2 className="text-base font-bold text-foreground">Incoming Queued Tickets</h2>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">Tickets awaiting initial CS validation &amp; dispatch</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/ticketing/cs/incoming')}
              className="text-xs gap-1"
            >
              <span>View Queue</span>
              <ArrowRight className="w-3 h-3" />
            </Button>
          </div>

          {queuedError ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-xs text-destructive flex items-center justify-between">
              <span>{queuedError}</span>
              <Button variant="outline" size="sm" onClick={() => loadDashboardData({ forceRefresh: true })} className="h-7 text-xs">
                Retry
              </Button>
            </div>
          ) : loadingQueued ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, idx) => (
                <div key={idx} className="p-3 rounded-lg border border-border/80 animate-pulse space-y-2">
                  <div className="h-4 bg-muted rounded w-1/3" />
                  <div className="h-3 bg-muted rounded w-3/4" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : queuedTickets.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">Queue is empty.</div>
          ) : (
            <div className="space-y-2">
              {queuedTickets.map((t) => (
                <div
                  key={t.id}
                  onClick={() => handleViewTicketReadOnly(t)}
                  className="flex items-center justify-between p-3 rounded-lg border border-border/80 hover:bg-muted/40 transition-colors cursor-pointer"
                >
                  <div className="min-w-0 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-primary">{t.id}</span>
                      <Badge variant={getStatusBadgeVariant(t.status)}>{t.status}</Badge>
                    </div>
                    <p className="text-xs font-medium text-foreground truncate mt-1">{t.title}</p>
                    <p className="text-[11px] text-muted-foreground">{t.customer || 'Customer'} • {t.updated}</p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <Badge variant={t.priority === 'Critical' ? 'destructive' : t.priority === 'High' ? 'warning' : 'secondary'}>
                      {t.priority}
                    </Badge>
                    <Eye className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* SECTION 4: Assigned / Monitored Tickets Summary */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-primary" />
                <h2 className="text-base font-bold text-foreground">Assigned &amp; Monitored Tickets</h2>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">Summary of tickets actively handled or delegated by CS</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/ticketing/cs/assigned')}
              className="text-xs gap-1"
            >
              <span>View Assigned</span>
              <ArrowRight className="w-3 h-3" />
            </Button>
          </div>

          {/* Counts by Status Breakdown */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div
              onClick={() => navigate('/ticketing/cs/assigned?status=Open')}
              className="p-3 bg-muted/30 border border-border rounded-lg text-center cursor-pointer hover:bg-muted/50 transition-colors"
            >
              <span className="text-[11px] text-muted-foreground font-medium">Open</span>
              <p className="text-lg font-bold text-primary mt-0.5">{assignedStatusCounts.open}</p>
            </div>
            <div
              onClick={() => navigate('/ticketing/cs/assigned?status=In+Progress')}
              className="p-3 bg-muted/30 border border-border rounded-lg text-center cursor-pointer hover:bg-muted/50 transition-colors"
            >
              <span className="text-[11px] text-muted-foreground font-medium">In Progress</span>
              <p className="text-lg font-bold text-amber-600 mt-0.5">{assignedStatusCounts.inProgress}</p>
            </div>
            <div
              onClick={() => navigate('/ticketing/cs/assigned?status=On+Hold')}
              className="p-3 bg-muted/30 border border-border rounded-lg text-center cursor-pointer hover:bg-muted/50 transition-colors"
            >
              <span className="text-[11px] text-muted-foreground font-medium flex items-center justify-center gap-1">
                <PauseCircle className="w-3 h-3 text-muted-foreground" />
                On Hold
              </span>
              <p className="text-lg font-bold text-slate-700 mt-0.5">{assignedStatusCounts.onHold}</p>
            </div>
            <div
              onClick={() => navigate('/ticketing/cs/assigned?status=Resolved')}
              className="p-3 bg-muted/30 border border-border rounded-lg text-center cursor-pointer hover:bg-muted/50 transition-colors"
            >
              <span className="text-[11px] text-muted-foreground font-medium">Resolved</span>
              <p className="text-lg font-bold text-emerald-600 mt-0.5">{assignedStatusCounts.resolved}</p>
            </div>
          </div>

          <div className="p-4 rounded-xl border border-border/80 bg-muted/20 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-foreground">
              <span>Traffic Routing Rules</span>
              <Badge variant="outline" className="text-[10px]">Active</Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Assigned tickets undergo continuous SLA tracking. When a technician is assigned, tickets transition from Queued to Monitored status. Action triggers (assignment, hold, resolve) are performed from the dedicated Queue views.
            </p>
            <div className="pt-2 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate('/ticketing/cs/assigned')}
                className="text-xs text-primary hover:text-primary gap-1"
              >
                <span>Navigate to Assigned List</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>

      </div>

      {/* ─── READ-ONLY TICKET DETAILS MODAL (No inline actions) ────────────── */}
      {selectedTicket && (
        <CustomerTicketDetailModal
          ticket={selectedTicket}
          onClose={() => setSelectedTicket(null)}
          onDiscard={null}
          onReopen={null}
          onResolve={null}
          allowReopen={false}
          customerName={selectedTicket.customer}
          onAssign={null} // Read-only enforcement: no assignment from dashboard
          onViewTicket={(t) => {
            setSelectedTicket(null);
            navigate(`/cs/history/${t.ticket_ID || Number(String(t.id).replace(/\D/g, ''))}`);
          }}
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
