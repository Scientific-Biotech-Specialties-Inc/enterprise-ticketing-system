import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Filter,
  AlertTriangle,
  ShieldAlert,
  ArrowRight,
  ChevronRight,
  Inbox,
  ClipboardList,
  CheckCircle2,
  Eye,
  Clock,
  Send,
  PauseCircle,
  RefreshCw,
  ExternalLink,
  Briefcase,
  User,
  AlertCircle,
} from 'lucide-react';
import CustomerTicketDetailModal from '@/components/CustomerTicketDetailModal';
import { useAuth } from '@/context/AuthContext';
import {
  getEmployeeAssignedTickets,
  getTicketDetails,
  getInternalTickets,
  getEmployeeProfile,
  clearEmployeeTicketsCache,
} from '@/services/ticketService';
import useRealtimeRefresh from '@/hooks/useRealtimeRefresh';
import { DashboardHeader } from '@/components/ui/page-header';
import { MetricCard } from '@/components/ui/metric-card';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { DataTableSkeleton } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { formatDisplayDate } from '@/utils/dateUtils';

export default function EmployeeDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Active view toggle: 'all' (Unified), 'assigned' (My Work), 'requestor' (My Requests)
  const [activeSection, setActiveSection] = useState('all');

  // Assigned Workload state
  const [assignedTickets, setAssignedTickets] = useState([]);
  const [loadingAssigned, setLoadingAssigned] = useState(true);
  const [assignedError, setAssignedError] = useState(null);

  // Requestor Activity state
  const [myRequests, setMyRequests] = useState([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [requestorError, setRequestorError] = useState(null);

  // Filters for Assigned tickets
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All Status');
  const [priorityFilter, setPriorityFilter] = useState('All Priority');

  // Read-only Modal state
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);

  const displayName = user?.first_name
    ? `${user.first_name}${user.last_name ? ' ' + user.last_name : ''}`
    : user?.name || 'Employee';

  // ─── SLA Risk Classifier ──────────────────────────────────────────────────
  const evaluateSlaRisk = useCallback((ticket) => {
    if (['Resolved', 'Closed', 'Discarded'].includes(ticket.status)) return 'normal';
    const s = String(ticket.sla_status || ticket.slaStatus || (ticket.sla?.resolution?.status) || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (s === 'breached' || s === 'violated' || Boolean(ticket.sla_breached) || Boolean(ticket.is_breached)) {
      return 'breached';
    }
    if (s.includes('risk') || s.includes('warning')) {
      return 'at_risk';
    }
    const due = ticket.resolution_due_at || ticket.due_at;
    if (due) {
      const msLeft = new Date(due).getTime() - Date.now();
      if (msLeft < 0) return 'breached';
      if (msLeft < 2 * 60 * 60 * 1000) return 'at_risk';
    }
    return 'normal';
  }, []);

  // ─── 1. Load Assigned Workload (My Work) ──────────────────────────────────
  const loadAssigned = useCallback(async ({ forceRefresh = false } = {}) => {
    setLoadingAssigned(true);
    setAssignedError(null);
    try {
      const email = user?.email || 'frontend@example.com';
      const list = await getEmployeeAssignedTickets({ employeeEmail: email, forceRefresh });
      setAssignedTickets(list.map((t) => ({ ...t, rejected: false })));
    } catch {
      setAssignedError('Unable to load assigned workload tickets.');
    } finally {
      setLoadingAssigned(false);
    }
  }, [user?.email]);

  // ─── 2. Load Requestor Activity (My Requests) ─────────────────────────────
  const loadRequests = useCallback(async () => {
    setLoadingRequests(true);
    setRequestorError(null);
    try {
      const apiTickets = await getInternalTickets();
      if (apiTickets && apiTickets.length > 0) {
        const mapped = apiTickets.map((t) => ({
          ...t,
          date_created: t.date || t.created_at,
          last_updated: t.lastUpdate || t.updated_at || t.last_updated,
          is_internal: true,
          ticket_type: 'Internal',
        }));
        setMyRequests(mapped);
      } else {
        const stored = JSON.parse(localStorage.getItem('employee_created_tickets') || '[]');
        setMyRequests(stored);
      }
    } catch {
      setRequestorError('Unable to load your submitted internal tickets.');
    } finally {
      setLoadingRequests(false);
    }
  }, []);

  useEffect(() => {
    loadAssigned({ forceRefresh: false });
    loadRequests();
  }, [loadAssigned, loadRequests]);

  // ─── Near-Real-Time Refresh ───────────────────────────────────────────────
  const handleRefreshAll = useCallback(async () => {
    clearEmployeeTicketsCache();
    await Promise.all([loadAssigned({ forceRefresh: true }), loadRequests()]);
  }, [loadAssigned, loadRequests]);

  useRealtimeRefresh({
    refresh: handleRefreshAll,
    channels: [{ name: 'ticket-updates', event: 'ticket.changed' }],
    intervalMs: 30000,
    deferRefresh: false,
  });

  // ─── Assigned Workload Metrics (TS060 Criteria) ───────────────────────────
  const assignedMetrics = useMemo(() => {
    let openCount = 0;
    let inProgressCount = 0;
    let onHoldCount = 0;
    let resolvedCount = 0;
    let atRiskCount = 0;
    let breachedCount = 0;
    let awaitingAcceptCount = 0;

    assignedTickets.forEach((t) => {
      if (t.status === 'Open') openCount++;
      if (t.status === 'In Progress') inProgressCount++;
      if (t.status === 'On Hold') onHoldCount++;
      if (t.status === 'Resolved' || t.status === 'Closed') resolvedCount++;
      if (!t.accepted && t.status !== 'Resolved' && t.status !== 'Closed') awaitingAcceptCount++;

      const risk = evaluateSlaRisk(t);
      if (risk === 'breached') breachedCount++;
      if (risk === 'at_risk') atRiskCount++;
    });

    return {
      open: openCount,
      inProgress: inProgressCount,
      onHold: onHoldCount,
      resolved: resolvedCount,
      atRisk: atRiskCount,
      breached: breachedCount,
      awaitingAccept: awaitingAcceptCount,
      totalActive: assignedTickets.filter((t) => !['Resolved', 'Closed'].includes(t.status)).length,
    };
  }, [assignedTickets, evaluateSlaRisk]);

  // ─── Requestor Activity Metrics (TS060 Criteria) ──────────────────────────
  const requestorMetrics = useMemo(() => {
    let openCount = 0;
    let inProgressCount = 0;
    let resolvedCount = 0;
    let closedCount = 0;
    let autoClosingSoonCount = 0;
    let reopenedCount = 0;

    myRequests.forEach((t) => {
      const s = t.status;
      if (s === 'Open') openCount++;
      if (s === 'In Progress') inProgressCount++;
      if (s === 'Resolved') {
        resolvedCount++;
        // Check if auto-closing soon (e.g. resolved within window)
        autoClosingSoonCount++;
      }
      if (s === 'Closed') closedCount++;
      if (s === 'Reopened') reopenedCount++;
    });

    return {
      open: openCount,
      inProgress: inProgressCount,
      resolved: resolvedCount,
      closed: closedCount,
      autoClosingSoon: autoClosingSoonCount,
      reopened: reopenedCount,
      total: myRequests.length,
    };
  }, [myRequests]);

  // Filtered assigned tickets
  const filteredAssigned = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assignedTickets.filter((t) => {
      if (q && !t.id?.toLowerCase().includes(q) && !t.title?.toLowerCase().includes(q) && !t.customer?.toLowerCase().includes(q)) return false;
      if (statusFilter !== 'All Status' && t.status !== statusFilter) return false;
      if (priorityFilter !== 'All Priority' && t.priority !== priorityFilter) return false;
      return true;
    });
  }, [assignedTickets, search, statusFilter, priorityFilter]);

  // Attention-needed items for Assigned section
  const assignedAttentionItems = useMemo(() => {
    return assignedTickets.filter((t) => {
      const risk = evaluateSlaRisk(t);
      const isUrgent = risk === 'breached' || risk === 'at_risk' || !t.accepted || t.status === 'Escalated';
      return isUrgent && !['Resolved', 'Closed'].includes(t.status);
    }).slice(0, 4);
  }, [assignedTickets, evaluateSlaRisk]);

  // Attention-needed items for Requestor section
  const requestorAttentionItems = useMemo(() => {
    return myRequests.filter((t) => {
      return t.status === 'Resolved' || t.status === 'Reopened';
    }).slice(0, 4);
  }, [myRequests]);

  // Read-only modal viewer (Strict Read-Only Enforcement)
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
      {/* Header */}
      <DashboardHeader
        greeting="Personal Workspace Dashboard"
        userName={displayName}
        subtitle="Manage your assigned technician work and track your submitted internal support tickets in one place."
        badgeText="Employee Active"
        badgeVariant="emerald"
      />

      {/* Visual Navigation Pill Switcher (Clearly separating the two roles) */}
      <div className="flex items-center gap-1 bg-muted/40 p-1.5 rounded-xl border border-border w-fit">
        <Button
          variant={activeSection === 'all' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveSection('all')}
          className="text-xs gap-1.5"
        >
          <span>All Overview</span>
        </Button>
        <Button
          variant={activeSection === 'assigned' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveSection('assigned')}
          className="text-xs gap-1.5"
        >
          <Briefcase className="w-3.5 h-3.5" />
          <span>My Work (Assigned Workload)</span>
          <Badge variant="secondary" className="ml-1 text-[10px]">{assignedMetrics.totalActive}</Badge>
        </Button>
        <Button
          variant={activeSection === 'requestor' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveSection('requestor')}
          className="text-xs gap-1.5"
        >
          <Send className="w-3.5 h-3.5" />
          <span>My Requests (Requestor Activity)</span>
          <Badge variant="secondary" className="ml-1 text-[10px]">{requestorMetrics.total}</Badge>
        </Button>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 1: ASSIGNED EMPLOYEE WORKLOAD ("MY WORK")                     */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {(activeSection === 'all' || activeSection === 'assigned') && (
        <div className="rounded-2xl border-2 border-primary/20 bg-card p-6 shadow-xs space-y-6">
          {/* Section Banner Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center shrink-0">
                <Briefcase className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-foreground">Section I: Assigned Workload (My Work)</h2>
                  <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary border-primary/20">
                    Technician Role
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Tickets assigned to you for diagnostics, field maintenance, and repair resolution.
                </p>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/employee/assigned')}
              className="text-xs gap-1.5 shrink-0"
            >
              <span>Go to Work Log</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Assigned Section Partial-Failure State */}
          {assignedError ? (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-xs text-destructive flex items-center justify-between">
              <span>{assignedError}</span>
              <Button variant="outline" size="sm" onClick={() => loadAssigned({ forceRefresh: true })} className="h-7 text-xs">
                <RefreshCw className="w-3.5 h-3.5 mr-1" /> Retry
              </Button>
            </div>
          ) : (
            <>
              {/* Summary Cards by Status + SLA Risk Highlights (TS060 Criteria) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <MetricCard
                  title="Open Work"
                  value={assignedMetrics.open}
                  subtitle="Awaiting start"
                  icon={<Inbox className="w-4 h-4 text-primary" />}
                  loading={loadingAssigned}
                  onClick={() => navigate('/employee/assigned?status=Open')}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                />
                <MetricCard
                  title="In Progress"
                  value={assignedMetrics.inProgress}
                  subtitle="Active work"
                  icon={<ClipboardList className="w-4 h-4 text-amber-600" />}
                  loading={loadingAssigned}
                  onClick={() => navigate('/employee/assigned?status=In+Progress')}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                />
                <MetricCard
                  title="On Hold"
                  value={assignedMetrics.onHold}
                  subtitle="Paused tickets"
                  icon={<PauseCircle className="w-4 h-4 text-slate-600" />}
                  loading={loadingAssigned}
                  onClick={() => navigate('/employee/assigned?status=On+Hold')}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                />
                <MetricCard
                  title="Completed / Resolved"
                  value={assignedMetrics.resolved}
                  subtitle="Successfully serviced"
                  icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                  loading={loadingAssigned}
                  onClick={() => navigate('/employee/assigned?status=Resolved')}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                />
                <MetricCard
                  title="Approaching SLA"
                  value={assignedMetrics.atRisk}
                  subtitle="At Risk (warning)"
                  icon={<Clock className="w-4 h-4 text-amber-600" />}
                  variant="amber"
                  loading={loadingAssigned}
                  onClick={() => navigate('/employee/assigned?sla=At+Risk')}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                />
                <MetricCard
                  title="SLA Breached"
                  value={assignedMetrics.breached}
                  subtitle="SLA exceeded"
                  icon={<AlertTriangle className="w-4 h-4 text-rose-600" />}
                  variant="crimson"
                  loading={loadingAssigned}
                  onClick={() => navigate('/employee/assigned?sla=Breached')}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                />
              </div>

              {/* Assigned Attention Highlights (TS060 Criteria) */}
              {assignedAttentionItems.length > 0 && (
                <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    <h3 className="text-xs font-bold text-rose-900 uppercase tracking-wider">
                      Assigned Items Needing Immediate Action ({assignedAttentionItems.length})
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {assignedAttentionItems.map((t) => (
                      <div
                        key={t.id}
                        className="bg-card border border-rose-200/80 rounded-xl p-3 flex items-center justify-between gap-3 shadow-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-primary">{t.id}</span>
                            {!t.accepted ? (
                              <Badge variant="warning" className="text-[10px]">Awaiting Review &amp; Accept</Badge>
                            ) : (
                              <Badge variant="destructive" className="text-[10px]">SLA Critical</Badge>
                            )}
                          </div>
                          <p className="text-xs font-medium text-foreground truncate mt-1">{t.title}</p>
                          <p className="text-[11px] text-muted-foreground">{t.customer} • {t.priority}</p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate('/employee/assigned', { state: { focusTicketId: t.id } })}
                          className="text-xs shrink-0"
                        >
                          Review in Work Log
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Active Assigned Tickets Table */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
                    Active Assigned Work Tickets ({filteredAssigned.length})
                  </h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="search"
                        placeholder="Search assigned..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="h-8 pl-8 pr-3 text-xs bg-muted/30 border border-border rounded-lg outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="h-8 px-2.5 text-xs bg-muted/30 border border-border rounded-lg outline-none"
                    >
                      {['All Status', 'Open', 'In Progress', 'On Hold', 'Resolved'].map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="overflow-hidden rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[130px]">Ticket ID</TableHead>
                        <TableHead>Title</TableHead>
                        <TableHead>Customer / Facility</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Priority</TableHead>
                        <TableHead className="w-[100px] text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loadingAssigned ? (
                        <DataTableSkeleton columns={6} rows={3} />
                      ) : filteredAssigned.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="py-6 text-center text-xs text-muted-foreground">
                            No assigned tickets match the selected filters.
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredAssigned.slice(0, 5).map((t) => (
                          <TableRow key={t.id} className="hover:bg-muted/40 transition-colors">
                            <TableCell className="font-semibold text-primary text-xs">
                              {t.id}
                            </TableCell>
                            <TableCell className="font-medium text-foreground text-xs max-w-xs truncate">
                              {t.title}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-xs truncate">
                              {t.customer || 'Hospital Facility'}
                            </TableCell>
                            <TableCell>
                              <Badge variant={getStatusBadgeVariant(t.status)}>{t.status}</Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={t.priority === 'Critical' ? 'destructive' : t.priority === 'High' ? 'warning' : 'secondary'}>
                                {t.priority}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleViewTicketReadOnly(t)}
                                className="text-xs text-primary hover:text-primary gap-1"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                View
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 2: REQUESTOR ACTIVITY ("MY REQUESTS")                         */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {(activeSection === 'all' || activeSection === 'requestor') && (
        <div className="rounded-2xl border-2 border-accent/20 bg-card p-6 shadow-xs space-y-6">
          {/* Section Banner Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent text-white flex items-center justify-center shrink-0">
                <Send className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-foreground">Section II: Requestor Activity (My Requests)</h2>
                  <Badge variant="outline" className="text-[10px] bg-accent/5 text-accent border-accent/20">
                    Requestor Role
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Internal support requests you submitted for internal tools, facility issues, or peer technical assistance.
                </p>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/employee/my-tickets')}
              className="text-xs gap-1.5 shrink-0"
            >
              <span>View All Requests</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Requestor Section Partial-Failure State */}
          {requestorError ? (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-xs text-destructive flex items-center justify-between">
              <span>{requestorError}</span>
              <Button variant="outline" size="sm" onClick={() => loadRequests()} className="h-7 text-xs">
                <RefreshCw className="w-3.5 h-3.5 mr-1" /> Retry
              </Button>
            </div>
          ) : (
            <>
              {/* Summary Cards by Status (TS060 Criteria) */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <MetricCard
                  title="Open Requests"
                  value={requestorMetrics.open}
                  subtitle="Awaiting triage"
                  icon={<Inbox className="w-4 h-4 text-accent" />}
                  loading={loadingRequests}
                  onClick={() => navigate('/employee/my-tickets?status=Open')}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                />
                <MetricCard
                  title="In Progress"
                  value={requestorMetrics.inProgress}
                  subtitle="Being serviced"
                  icon={<Clock className="w-4 h-4 text-amber-600" />}
                  loading={loadingRequests}
                  onClick={() => navigate('/employee/my-tickets?status=In+Progress')}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                />
                <MetricCard
                  title="Resolved (Awaiting Close)"
                  value={requestorMetrics.resolved}
                  subtitle="Awaiting your confirm"
                  icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                  variant="emerald"
                  loading={loadingRequests}
                  onClick={() => navigate('/employee/my-tickets?status=Resolved')}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                />
                <MetricCard
                  title="Auto-Closing Soon"
                  value={requestorMetrics.autoClosingSoon}
                  subtitle="Resolution window active"
                  icon={<Clock className="w-4 h-4 text-primary" />}
                  loading={loadingRequests}
                  onClick={() => navigate('/employee/my-tickets?status=Resolved')}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                />
                <MetricCard
                  title="Closed Requests"
                  value={requestorMetrics.closed}
                  subtitle="Past request history"
                  icon={<CheckCircle2 className="w-4 h-4 text-slate-500" />}
                  loading={loadingRequests}
                  onClick={() => navigate('/employee/my-tickets?status=Closed')}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                />
              </div>

              {/* Requestor Attention Highlights (TS060 Criteria: Resolved awaiting confirm or reopened) */}
              {requestorAttentionItems.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-700" />
                    <h3 className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                      Requests Requiring Your Confirmation or Feedback ({requestorAttentionItems.length})
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {requestorAttentionItems.map((t) => (
                      <div
                        key={t.id}
                        className="bg-card border border-amber-200/80 rounded-xl p-3 flex items-center justify-between gap-3 shadow-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-primary">{t.id}</span>
                            <Badge variant={getStatusBadgeVariant(t.status)}>{t.status}</Badge>
                          </div>
                          <p className="text-xs font-medium text-foreground truncate mt-1">{t.title}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {t.status === 'Resolved' ? 'Technician resolved this. Confirm or reopen before auto-close.' : 'Ticket reopened.'}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate('/employee/my-tickets', { state: { focusTicketId: t.id } })}
                          className="text-xs shrink-0"
                        >
                          Confirm in My Requests
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent Requests Table */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
                    Recent Submitted Internal Requests ({myRequests.length})
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/employee/my-tickets')}
                    className="text-xs text-primary hover:text-primary gap-1"
                  >
                    <span>View All ({myRequests.length})</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </div>

                <div className="overflow-hidden rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[130px]">Ticket ID</TableHead>
                        <TableHead>Title</TableHead>
                        <TableHead>Target Equipment</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-[100px] text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loadingRequests ? (
                        <DataTableSkeleton columns={5} rows={3} />
                      ) : myRequests.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                            You have not submitted any internal tickets yet.
                          </TableCell>
                        </TableRow>
                      ) : (
                        myRequests.slice(0, 5).map((t) => (
                          <TableRow key={t.id} className="hover:bg-muted/40 transition-colors">
                            <TableCell className="font-semibold text-primary text-xs">
                              {t.id}
                            </TableCell>
                            <TableCell className="font-medium text-foreground text-xs max-w-xs truncate">
                              {t.title}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-xs truncate">
                              {t.equipment || 'General System'}
                            </TableCell>
                            <TableCell>
                              <Badge variant={getStatusBadgeVariant(t.status)}>{t.status}</Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleViewTicketReadOnly(t)}
                                className="text-xs text-primary hover:text-primary gap-1"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                View
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ─── READ-ONLY TICKET DETAILS MODAL ────────────────────────────────── */}
      {selectedTicket && (
        <CustomerTicketDetailModal
          ticket={selectedTicket}
          onClose={() => setSelectedTicket(null)}
          onDiscard={null}
          onReopen={null}
          onResolve={null}
          allowReopen={false}
          customerName={selectedTicket.customer}
          onViewTicket={(t) => {
            setSelectedTicket(null);
            navigate(`/employee/history/${t.ticket_ID || Number(String(t.id).replace(/\D/g, ''))}`);
          }}
        />
      )}

      {modalLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs">
          <div className="bg-card border border-border rounded-xl p-6 shadow-xl flex flex-col items-center gap-3 max-w-xs w-full mx-4">
            <div className="w-8 h-8 border-3 border-primary/20 border-t-primary rounded-full animate-spin" />
            <p className="text-sm font-semibold text-foreground">Loading ticket details...</p>
          </div>
        </div>
      )}
    </div>
  );
}
