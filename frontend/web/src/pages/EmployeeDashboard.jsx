import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Filter,
  AlertTriangle,
  ShieldAlert,
  ArrowRight,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Inbox,
  ClipboardList,
  CheckCircle2,
  Clock,
  Send,
  PauseCircle,
  RefreshCw,
  ExternalLink,
  Briefcase,
  User,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import CustomerTicketDetailModal from '@/components/CustomerTicketDetailModal';
import TicketDetailModal from '@/components/employee/TicketDetailModal';
import TicketInfoModal from '@/components/employee/TicketInfoModal';
import ReassignmentModal from '@/components/employee/ReassignmentModal';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import {
  getEmployeeAssignedTickets,
  getTicketDetails,
  getInternalTickets,
  getEmployeeProfile,
  clearEmployeeTicketsCache,
  acceptTicket,
} from '@/services/ticketService';
import useRealtimeRefresh from '@/hooks/useRealtimeRefresh';
import { DashboardHeader } from '@/components/ui/page-header';
import { MetricCard } from '@/components/ui/metric-card';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { DataTableSkeleton } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { formatDisplayDate } from '@/utils/dateUtils';
import { cn } from '@/lib/utils';

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

  // Contextual Modal states
  const [pendingTicket, setPendingTicket] = useState(null);
  const [infoTicket, setInfoTicket] = useState(null);
  const [reassignTicket, setReassignTicket] = useState(null);
  const [requestorDetailTicket, setRequestorDetailTicket] = useState(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const toast = useToast();
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

  const openContextualTicketModal = useCallback(async (t) => {
    setModalLoading(true);
    let fullTicket = t;
    try {
      const ticketId = t.ticket_ID || parseInt(String(t.id || '').replace(/\D/g, ''), 10);
      const full = await getTicketDetails(ticketId);
      fullTicket = { ...t, ...full, description: full?.description || t.description || '' };
    } catch {
      // fallback
    } finally {
      setModalLoading(false);
    }

    if (!fullTicket.accepted) {
      setPendingTicket(fullTicket);
    } else {
      setInfoTicket(fullTicket);
    }
  }, []);

  const openRequestorModal = useCallback(async (t) => {
    setModalLoading(true);
    try {
      const ticketId = t.ticket_ID || parseInt(String(t.id || '').replace(/\D/g, ''), 10);
      const full = await getTicketDetails(ticketId);
      setRequestorDetailTicket({ ...t, ...full, description: full?.description || t.description || '' });
    } catch {
      setRequestorDetailTicket(t);
    } finally {
      setModalLoading(false);
    }
  }, []);

  const handleAcceptAssignment = useCallback(async (id) => {
    // `id` is the display number (e.g. INC-OPS-202611-00042); stripping its digits does not
    // give the database ID, so resolve the real ticket_ID from the ticket itself.
    const source = (pendingTicket && (pendingTicket.id === id || pendingTicket.ticket_ID === id))
      ? pendingTicket
      : assignedTickets.find((t) => t.id === id || t.ticket_ID === id);
    const numericId = source?.ticket_ID
      || (typeof id === 'number' ? id : Number(String(id || '').replace(/\D/g, '')));
    setIsAccepting(true);
    try {
      await acceptTicket({ ticketId: numericId });
      setIsAccepting(false);
      setPendingTicket(null);
      setAssignedTickets((prev) =>
        prev.map((t) => (t.id === id || t.ticket_ID === numericId ? { ...t, accepted: true, status: 'In Progress' } : t))
      );
      window.dispatchEvent(new Event('notifications:updated'));
      loadAssigned({ forceRefresh: true });
    } catch (err) {
      console.error('Failed to accept assignment:', err);
      setIsAccepting(false);
      toast.error(
        err?.response?.data?.message || 'Could not accept this assignment. It may have been reassigned or updated. Please refresh and try again.',
        'Accept failed'
      );
    }
  }, [loadAssigned, toast, pendingTicket, assignedTickets]);

  const handleReassignSuccess = useCallback((id, reason) => {
    setReassignTicket(null);
    setAssignedTickets((prev) =>
      prev.map((t) =>
        t.id === id || t.ticket_ID === id
          ? {
              ...t,
              reassignmentRequested: true,
              reassignmentStatus: 'Pending',
              reassignmentReason: reason,
              status: 'Pending Reassignment',
            }
          : t
      )
    );
    loadAssigned({ forceRefresh: true });
  }, [loadAssigned]);

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

      {/* Top Hero KPI Row (Industry standard 4-card maximum to eliminate metric clutter) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {activeSection === 'requestor' ? (
          <>
            <MetricCard
              title="Total Requests"
              value={requestorMetrics.total}
              subtitle="Submitted requests"
              icon={<Send className="w-4 h-4 text-accent" />}
              loading={loadingRequests}
              onClick={() => navigate('/employee/my-tickets')}
              className="cursor-pointer hover:shadow-md transition-shadow"
            />
            <MetricCard
              title="Under Service"
              value={requestorMetrics.open + requestorMetrics.inProgress}
              subtitle="Open & In Progress"
              icon={<Clock className="w-4 h-4 text-amber-600" />}
              variant="amber"
              loading={loadingRequests}
              onClick={() => navigate('/employee/my-tickets?status=Open')}
              className="cursor-pointer hover:shadow-md transition-shadow"
            />
            <MetricCard
              title="Action Needed"
              value={requestorAttentionItems.length}
              subtitle="Awaiting confirm / review"
              icon={<AlertCircle className="w-4 h-4 text-amber-600" />}
              variant="amber"
              loading={loadingRequests}
              onClick={() => navigate('/employee/my-tickets?status=Resolved')}
              className="cursor-pointer hover:shadow-md transition-shadow"
            />
            <MetricCard
              title="Closed Requests"
              value={requestorMetrics.closed}
              subtitle="Successfully closed"
              icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />}
              variant="emerald"
              loading={loadingRequests}
              onClick={() => navigate('/employee/my-tickets?status=Closed')}
              className="cursor-pointer hover:shadow-md transition-shadow"
            />
          </>
        ) : (
          <>
            <MetricCard
              title="Assigned Workload"
              value={assignedMetrics.totalActive}
              subtitle="Active technician tickets"
              icon={<Briefcase className="w-4 h-4 text-primary" />}
              loading={loadingAssigned}
              onClick={() => navigate('/employee/assigned')}
              className="cursor-pointer hover:shadow-md transition-shadow"
            />
            <MetricCard
              title="Awaiting Accept"
              value={assignedMetrics.awaitingAccept}
              subtitle="Pending acceptance"
              icon={<Inbox className="w-4 h-4 text-amber-600" />}
              variant="amber"
              loading={loadingAssigned}
              onClick={() => navigate('/employee/assigned?status=Open')}
              className="cursor-pointer hover:shadow-md transition-shadow"
            />
            <MetricCard
              title="Approaching SLA"
              value={assignedMetrics.atRisk}
              subtitle="Near threshold (warning)"
              icon={<Clock className="w-4 h-4 text-amber-600" />}
              variant="amber"
              loading={loadingAssigned}
              onClick={() => navigate('/employee/assigned?sla=At+Risk')}
              className="cursor-pointer hover:shadow-md transition-shadow"
            />
            <MetricCard
              title="SLA Breached"
              value={assignedMetrics.breached}
              subtitle="Resolution overdue"
              icon={<AlertTriangle className="w-4 h-4 text-rose-600" />}
              variant="crimson"
              loading={loadingAssigned}
              onClick={() => navigate('/employee/assigned?sla=Breached')}
              className="cursor-pointer hover:shadow-md transition-shadow"
            />
          </>
        )}
      </div>

      {/* Visual Navigation Pill Switcher */}
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
          <span>Assigned Tasks</span>
          <Badge variant="secondary" className="ml-1 text-[10px]">{assignedMetrics.totalActive}</Badge>
        </Button>
        <Button
          variant={activeSection === 'requestor' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveSection('requestor')}
          className="text-xs gap-1.5"
        >
          <Send className="w-3.5 h-3.5" />
          <span>My Request</span>
          <Badge variant="secondary" className="ml-1 text-[10px]">{requestorMetrics.total}</Badge>
        </Button>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 1: MY WORK                                                    */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {(activeSection === 'all' || activeSection === 'assigned') && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-6">
          {/* Section Banner Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary text-white flex items-center justify-center shrink-0">
                <Briefcase className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-foreground">My Work</h2>
                  <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary border-primary/20">
                    Technician Role
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Tickets assigned to you for diagnostics, field maintenance, and repair resolution.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
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
              {/* Compact Status Breakdown Filters */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {[
                  { label: 'All Status', count: assignedMetrics.totalActive },
                  { label: 'Open', count: assignedMetrics.open },
                  { label: 'In Progress', count: assignedMetrics.inProgress },
                  { label: 'On Hold', count: assignedMetrics.onHold },
                  { label: 'Resolved', count: assignedMetrics.resolved },
                ].map((tab) => (
                  <button
                    key={tab.label}
                    type="button"
                    onClick={() => setStatusFilter(tab.label)}
                    className={cn(
                      "px-2.5 py-1 text-xs font-medium rounded-lg transition-colors border",
                      statusFilter === tab.label
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted/40 hover:bg-muted text-muted-foreground border-border"
                    )}
                  >
                    {tab.label}
                    <span className={cn(
                      "ml-1.5 text-[10px] px-1.5 py-0.2 rounded-full",
                      statusFilter === tab.label
                        ? "bg-white/20 text-white"
                        : "bg-muted text-foreground"
                    )}>
                      {tab.count}
                    </span>
                  </button>
                ))}
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
                        onClick={() => openContextualTicketModal(t)}
                        className="bg-card border border-rose-200/80 rounded-xl p-3 flex items-center justify-between gap-3 shadow-xs cursor-pointer hover:bg-rose-50/50 transition-colors"
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
                          onClick={(e) => {
                            e.stopPropagation();
                            openContextualTicketModal(t);
                          }}
                          className="text-xs shrink-0"
                        >
                          {!t.accepted ? 'Accept / Review' : 'Update Ticket'}
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
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loadingAssigned ? (
                        <DataTableSkeleton columns={5} rows={3} />
                      ) : filteredAssigned.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                            No assigned tickets match the selected filters.
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredAssigned.slice(0, 5).map((t) => (
                          <TableRow
                            key={t.id}
                            onClick={() => openContextualTicketModal(t)}
                            className="hover:bg-muted/40 transition-colors cursor-pointer"
                          >
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
      {/* SECTION 2: MY REQUEST                                                 */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {(activeSection === 'all' || activeSection === 'requestor') && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-xs space-y-6">
          {/* Section Banner Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent text-white flex items-center justify-center shrink-0">
                <Send className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-foreground">My Request</h2>
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
              {/* Compact Status Breakdown Overview */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-muted-foreground">Requests Breakdown:</span>
                <span className="text-xs px-2.5 py-1 rounded-lg bg-muted/40 border border-border">
                  Open: <strong className="font-semibold text-foreground">{requestorMetrics.open}</strong>
                </span>
                <span className="text-xs px-2.5 py-1 rounded-lg bg-muted/40 border border-border">
                  In Progress: <strong className="font-semibold text-foreground">{requestorMetrics.inProgress}</strong>
                </span>
                <span className="text-xs px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200">
                  Resolved: <strong className="font-bold">{requestorMetrics.resolved}</strong>
                </span>
                <span className="text-xs px-2.5 py-1 rounded-lg bg-muted/40 border border-border">
                  Closed: <strong className="font-semibold text-foreground">{requestorMetrics.closed}</strong>
                </span>
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
                        onClick={() => openRequestorModal(t)}
                        className="bg-card border border-amber-200/80 rounded-xl p-3 flex items-center justify-between gap-3 shadow-xs cursor-pointer hover:bg-amber-50/50 transition-colors"
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
                          onClick={(e) => {
                            e.stopPropagation();
                            openRequestorModal(t);
                          }}
                          className="text-xs shrink-0"
                        >
                          Confirm / View
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
                    <span>View All</span>
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
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loadingRequests ? (
                        <DataTableSkeleton columns={4} rows={3} />
                      ) : myRequests.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="py-6 text-center text-xs text-muted-foreground">
                            You have not submitted any internal tickets yet.
                          </TableCell>
                        </TableRow>
                      ) : (
                        myRequests.slice(0, 5).map((t) => (
                          <TableRow
                            key={t.id}
                            onClick={() => openRequestorModal(t)}
                            className="hover:bg-muted/40 transition-colors cursor-pointer"
                          >
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

      {/* Modal: Unaccepted ticket (Accept / Request Reassignment) */}
      {pendingTicket && (
        <TicketDetailModal
          ticket={pendingTicket}
          onClose={() => setPendingTicket(null)}
          onAccept={handleAcceptAssignment}
          onRequestReassign={(t) => {
            setPendingTicket(null);
            setReassignTicket(t);
          }}
          isAccepting={isAccepting}
        />
      )}

      {/* Modal: Accepted active ticket (Progress / Update) */}
      {infoTicket && (
        <TicketInfoModal
          ticket={infoTicket}
          onClose={() => setInfoTicket(null)}
          onReassignSuccess={handleReassignSuccess}
        />
      )}

      {/* Modal: Reassignment Request */}
      {reassignTicket && (
        <ReassignmentModal
          ticket={reassignTicket}
          onClose={() => setReassignTicket(null)}
          onReassignSuccess={handleReassignSuccess}
        />
      )}

      {/* Modal: Requestor details inspection */}
      {requestorDetailTicket && (
        <CustomerTicketDetailModal
          ticket={requestorDetailTicket}
          onClose={() => setRequestorDetailTicket(null)}
          onDiscard={null}
          onReopen={null}
          onResolve={null}
          allowReopen={false}
          customerName={requestorDetailTicket.customer}
          onViewTicket={(t) => {
            setRequestorDetailTicket(null);
            navigate(`/employee/history/${t.ticket_ID || Number(String(t.id).replace(/\D/g, ''))}`);
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
