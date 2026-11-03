import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Filter, AlertTriangle, ShieldAlert, ArrowRight, ChevronRight, Inbox, ClipboardList, CheckCircle2, Eye } from 'lucide-react';
import {
  recentProgress,
  statusColors,
  priorityColors,
} from '@/constants/employeeTickets';
import CustomerTicketDetailModal from '@/components/CustomerTicketDetailModal';
import { useAuth } from '@/context/AuthContext';
import { getEmployeeAssignedTickets, acceptTicket, updateTicket, updateEmployeeTicketOverride, getTicketDetails, getInternalTickets, getEmployeeProfile, clearEmployeeTicketsCache } from '@/services/ticketService';
import useRealtimeRefresh from '@/hooks/useRealtimeRefresh';
import { DashboardHeader } from '@/components/ui/page-header';
import { MetricCard } from '@/components/ui/metric-card';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Button } from '@/components/ui/button';



const statusClass = (s) => statusColors[s] ?? (s?.includes('Discarded') ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700');

const getStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
};

export default function EmployeeDashboard() {
  const { user } = useAuth();
  const effectiveUser = user || getStoredUser();
  const navigate = useNavigate();
  const dateStr = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());

  const [tickets, setTickets] = useState([]);
  const [loadingTickets, setLoadingTickets] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All Status');
  const [categoryFilter, setCategoryFilter] = useState('All Category');
  const [priorityFilter, setPriorityFilter] = useState('All Priority');

  const [employeeName, setEmployeeName] = useState('');
  const [myRecentTickets, setMyRecentTickets] = useState([]);
  const [loadingMyTickets, setLoadingMyTickets] = useState(true);
  const [selectedMyTicket, setSelectedMyTicket] = useState(null);
  const [myTicketsModalLoading, setMyTicketsModalLoading] = useState(false);
  const [myTicketsLoadingText, setMyTicketsLoadingText] = useState('Loading...');
  const [selectedDashboardTicket, setSelectedDashboardTicket] = useState(null);
  const [dashboardModalLoading, setDashboardModalLoading] = useState(false);

  const visible = useMemo(() => tickets.filter((t) => !t.rejected), [tickets]);

  const loadTickets = useCallback(async ({ forceRefresh = false } = {}) => {
    const email = user?.email || 'frontend@example.com';
    setLoadingTickets(true);
    try {
      const list = await getEmployeeAssignedTickets({ employeeEmail: email, forceRefresh });
      setTickets(list.map((t) => ({ ...t, rejected: false })));
    } finally {
      setLoadingTickets(false);
    }
  }, [user?.email]);

  const loadMyTickets = useCallback(async () => {
    setLoadingMyTickets(true);
    try {
      const apiTickets = await getInternalTickets();
      if (apiTickets.length > 0) {
        const mapped = apiTickets.map((ticket) => ({
          ...ticket,
          date_created: ticket.date || ticket.created_at,
          last_updated: ticket.lastUpdate || ticket.updated_at || ticket.last_updated,
          is_internal: true,
          ticket_type: 'Internal',
          can_discard: ticket.status === 'Open' && !ticket.assigned_to,
        }));
        setMyRecentTickets(mapped.slice(0, 5));
        localStorage.setItem('employee_created_tickets', JSON.stringify(mapped));
      } else {
        const stored = JSON.parse(localStorage.getItem('employee_created_tickets') || '[]');
        const updated = await Promise.all(
          stored.slice(0, 5).map(async (t) => {
            const numericId = t.ticket_ID || parseInt(String(t.id || '').replace(/\D/g, ''), 10);
            if (!!t.isMock) return t;
            try {
              const detail = await getTicketDetails(numericId);
              return {
                ...t,
                ...detail,
                status: detail.status || t.status,
                last_updated: detail.last_updated || t.last_updated,
              };
            } catch {
              return t;
            }
          })
        );
        setMyRecentTickets(updated);

        const fullList = JSON.parse(localStorage.getItem('employee_created_tickets') || '[]');
        const updatedFullList = fullList.map((item) => {
          const found = updated.find((candidate) => candidate.id === item.id);
          return found ? { ...item, ...found } : item;
        });
        localStorage.setItem('employee_created_tickets', JSON.stringify(updatedFullList));
      }
    } catch (err) {
      console.error('Failed to load my tickets on dashboard:', err);
    } finally {
      setLoadingMyTickets(false);
    }
  }, []);

  const handleResolveMyTicket = async (ticketId) => {
    const isMock = selectedMyTicket ? !!selectedMyTicket.isMock : false;
    if (isMock) {
      const stored = JSON.parse(localStorage.getItem('employee_created_tickets') || '[]');
      const updatedList = stored.map(t => {
        if (t.id === ticketId || t.ticket_ID === ticketId) {
          const timestamp = new Date().toISOString();
          const timeline = t.timeline || [
            { id: 'creation', type: 'system', text: 'Ticket created.', timestamp: t.date_created }
          ];
          return {
            ...t,
            status: 'Resolved',
            resolved_at: timestamp,
            last_updated: timestamp,
            timeline: [
              ...timeline,
              {
                id: `status-resolved-${Date.now()}`,
                type: 'status',
                text: 'Ticket resolved by creator.',
                timestamp,
              }
            ]
          };
        }
        return t;
      });
      localStorage.setItem('employee_created_tickets', JSON.stringify(updatedList));
      await loadMyTickets();
      setSelectedMyTicket(null);
      window.alert('Ticket resolved successfully.');
      return;
    }
  };

  const handleReopenMyTicket = async (ticketId, reason) => {
    const isMock = selectedMyTicket ? !!selectedMyTicket.isMock : false;
    if (isMock) {
      const stored = JSON.parse(localStorage.getItem('employee_created_tickets') || '[]');
      const updatedList = stored.map(t => {
        if (t.id === ticketId || t.ticket_ID === ticketId) {
          const timestamp = new Date().toISOString();
          const timeline = t.timeline || [
            { id: 'creation', type: 'system', text: 'Ticket created.', timestamp: t.date_created }
          ];
          return {
            ...t,
            status: 'Reopened',
            last_updated: timestamp,
            timeline: [
              ...timeline,
              {
                id: `status-reopened-${Date.now()}`,
                type: 'status',
                text: `Ticket reopened. Reason: "${reason}"`,
                timestamp,
              }
            ]
          };
        }
        return t;
      });
      localStorage.setItem('employee_created_tickets', JSON.stringify(updatedList));
      await loadMyTickets();
      setSelectedMyTicket(null);
      window.alert('Ticket reopened successfully.');
      return;
    }

    setMyTicketsLoadingText('Reopening ticket...');
    setMyTicketsModalLoading(true);
    try {
      const numericId = Number(String(ticketId).replace(/\D/g, ''));
      await updateTicket({
        ticketId: numericId,
        statusId: 8, // Reopened
      });
      await loadMyTickets();
      setSelectedMyTicket(null);
      window.alert('Ticket reopened successfully.');
    } catch (err) {
      console.error('Failed to reopen ticket:', err);
      window.alert(err?.response?.data?.message || 'Failed to reopen ticket.');
    } finally {
      setMyTicketsModalLoading(false);
    }
  };

  const handleViewMyTicket = async (t) => {
    const numericId = t.ticket_ID || parseInt(String(t.id || '').replace(/\D/g, ''), 10);
    const isMock = !!t.isMock || [1001, 1002, 1003, 1004, 7545, 9091, 9092].includes(numericId) || String(t.id).startsWith('TKT-100');
    if (isMock) {
      setSelectedMyTicket({
        ...t,
        isMock: true,
        description: t.description || '',
        resolved_at: t.resolved_at || null,
        proofAttachments: t.proofAttachments || [],
        proofFiles: t.proofFiles || [],
        can_discard: t.status === 'Open' && !t.assigned_to,
      });
      return;
    }

    setMyTicketsLoadingText('Loading ticket details...');
    setMyTicketsModalLoading(true);
    try {
      const fullTicket = await getTicketDetails(numericId);
      setSelectedMyTicket({
        ...t,
        ...fullTicket,
        description: fullTicket.description || t.description || '',
        resolved_at: fullTicket.resolved_at || null,
        proofAttachments: fullTicket.proofAttachments || [],
        proofFiles: fullTicket.proofFiles || [],
        can_discard: (fullTicket.status || t.status) === 'Open' && !fullTicket.assigned_to,
      });
    } catch (err) {
      console.error('Failed to load ticket details:', err);
      setSelectedMyTicket(t);
    } finally {
      setMyTicketsModalLoading(false);
    }
  };

  useEffect(() => {
    loadTickets({ forceRefresh: false });
    loadMyTickets();
    getEmployeeProfile().then(p => setEmployeeName(p.name)).catch(() => {});
  }, [loadTickets, loadMyTickets]);

  const handleRefreshAll = useCallback(async () => {
    clearEmployeeTicketsCache();
    await loadTickets({ forceRefresh: true });
    await loadMyTickets();
  }, [loadTickets, loadMyTickets]);

  useRealtimeRefresh({
    refresh: handleRefreshAll,
    channels: [{ name: 'ticket-updates', event: 'ticket.changed' }],
    intervalMs: 30000,
    shouldRefresh: ({ source, payload }) => {
      if (source === 'websocket') {
        const myEmpId = Number(user?.emp_id ?? user?.id);
        const payloadTicketId = Number(
          payload?.ticket_id ||
          payload?.ticket_ID ||
          payload?.ticketId ||
          payload?.id ||
          payload?.ticket?.ticket_ID ||
          payload?.ticket?.id ||
          0
        );
        const isCurrentAssignee =
          payload && (
            Number(payload.assigned_to) === myEmpId ||
            Number(payload.employee_id) === myEmpId ||
            (Array.isArray(payload.employee_ids) && payload.employee_ids.map(Number).includes(myEmpId))
          );
        const isRemovedAssignee =
          payload && (
            (Array.isArray(payload.removed_employee_ids) && payload.removed_employee_ids.map(Number).includes(myEmpId)) ||
            (Array.isArray(payload.previous_employee_ids) && payload.previous_employee_ids.map(Number).includes(myEmpId))
          );
        const isHoldingTicket =
          Boolean(payloadTicketId) &&
          tickets.some((t) => Number(t.ticket_ID || String(t.id).replace(/\D/g, '')) === payloadTicketId);

        return Boolean(isCurrentAssignee || isRemovedAssignee || isHoldingTicket || !payloadTicketId);
      }
      return true;
    },
  });

  const handleStatusChange = useCallback(async (id, newStatus) => {
    // If status is 'Pending Evaluation', it has already been submitted to the backend via proof upload.
    // We only need to update the local ticket status and clear any proof rejection flags.
    if (newStatus === 'Pending Evaluation') {
      updateEmployeeTicketOverride(id, {
        status: newStatus,
        proofRejected: false,
        rejectionReason: null,
      });
      setTickets((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, status: newStatus, proofRejected: false, rejectionReason: null }
            : t
        )
      );
      return;
    }

    const statusMap = {
      'Open': 1,
      'In Progress': 2,
      'Resolved': 3,
      'Closed': 4,
      'Escalated': 5,
      'Pending Evaluation': 6,
      'Pending': 7,
      'Reopened': 8,
      'On Hold': 11,
    };
    const ticketObj = tickets.find((t) => t.id === id);
    if (!ticketObj) return;

    const numericId = ticketObj.ticket_ID || Number(String(id).replace(/\D/g, ''));
    try {
      await updateTicket({
        ticketId: numericId,
        statusId: statusMap[newStatus] ?? 2,
        assignedByEmail: user?.email,
      });
      updateEmployeeTicketOverride(id, {
        status: newStatus,
        proofRejected: false,
        rejectionReason: null,
      });
      setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t)));
    } catch (err) {
      console.error('Failed to update ticket status on backend:', err);
      // fallback to optimistic update
      updateEmployeeTicketOverride(id, {
        status: newStatus,
        proofRejected: false,
        rejectionReason: null,
      });
      setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t)));
    }
  }, [tickets, user]);

  const openTicketFlow = useCallback((t) => {
    if (t.accepted) {
      navigate('/employee/machine', { state: { focusTicketId: t.id } });
    } else {
      navigate('/employee/assigned', { state: { focusTicketId: t.id } });
    }
  }, [navigate]);

  const handleViewDashboardTicket = useCallback(async (t) => {
    const isMock = !!t.isMock;
    if (isMock) {
      setSelectedDashboardTicket({ ...t, description: t.description || '', resolved_at: t.resolved_at || null, proofAttachments: t.proofAttachments || [], proofFiles: t.proofFiles || [] });
      return;
    }
    setDashboardModalLoading(true);
    try {
      const ticketId = t.ticket_ID || parseInt(String(t.id || '').replace(/\D/g, ''), 10);
      const full = await getTicketDetails(ticketId);
      setSelectedDashboardTicket({ ...t, ...full, description: full.description || t.description || '', resolved_at: full.resolved_at || null, proofAttachments: full.proofAttachments || [], proofFiles: full.proofFiles || [], timeline: full.timeline || t.timeline });
    } catch {
      setSelectedDashboardTicket(t);
    } finally {
      setDashboardModalLoading(false);
    }
  }, []);

  const stats = useMemo(() => {
    const CLOSED_STATUSES = ['Closed', 'Resolved'];
    const incomingCount = visible.filter((t) => !t.accepted && !CLOSED_STATUSES.includes(t.status)).length;
    const assignedCount = visible.filter((t) => t.accepted && !CLOSED_STATUSES.includes(t.status)).length;
    const completedCount = visible.filter((t) => CLOSED_STATUSES.includes(t.status)).length;
    const isBreachedTicket = (t) => {
      if (CLOSED_STATUSES.includes(t.status)) return false;
      const s = String(t.sla_status || t.slaStatus || (t.sla?.resolution?.status) || '').toLowerCase().replace(/[\s_-]+/g, '');
      if (s === 'breached' || s === 'violated' || Boolean(t.sla_breached) || Boolean(t.is_breached)) return true;
      if (t.resolution_due_at && new Date(t.resolution_due_at) < new Date()) return true;
      if (t.due_at && new Date(t.due_at) < new Date()) return true;
      return false;
    };
    const slaBreachedCount = visible.filter(isBreachedTicket).length;
    const escalatedCount = visible.filter((t) => (t.status === 'Escalated' || t.escalated || t.priority === 'Critical' || t.priority === 'High') && !CLOSED_STATUSES.includes(t.status)).length;

    return [
      { label: 'Incoming Tickets', value: incomingCount, sub: 'Awaiting acceptance', icon: Inbox, variant: 'default' },
      { label: 'Assigned Tickets', value: assignedCount, sub: 'Active work in progress', icon: ClipboardList, variant: 'default' },
      { label: 'Completed Tickets', value: completedCount, sub: 'Resolved & closed history', icon: CheckCircle2, variant: 'default' },
      { label: 'SLA Breached', value: slaBreachedCount, sub: 'SLA violations detected', icon: AlertTriangle, variant: 'destructive' },
      { label: 'Escalated Tickets', value: escalatedCount, sub: 'Critical tickets requiring review', icon: ShieldAlert, variant: 'warning' },
    ];
  }, [visible]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visible.filter((t) => {
      if (q && !t.id?.toLowerCase().includes(q) && !t.title?.toLowerCase().includes(q) && !t.customer?.toLowerCase().includes(q)) return false;
      if (statusFilter !== 'All Status') {
        if (statusFilter === 'Pending Reassignment' || statusFilter === 'Pending Reassign') {
          if (!t.reassignmentRequested && t.status !== 'Pending Reassignment') return false;
        } else if (t.status !== statusFilter) {
          return false;
        }
      }
      if (categoryFilter !== 'All Category' && t.category !== categoryFilter) return false;
      if (priorityFilter !== 'All Priority' && t.priority !== priorityFilter) return false;
      return true;
    });
  }, [visible, search, statusFilter, categoryFilter, priorityFilter]);

  const activeTickets = useMemo(() => {
    const CLOSED_STATUSES = ['Closed', 'Resolved'];
    return visible.filter((t) => !CLOSED_STATUSES.includes(t.status));
  }, [visible]);

  const urgentTicket = visible.find((t) => t.status === 'Escalated');
  const escalatedTicket = visible.find((t) => t.priority === 'Critical' && t.status !== 'Resolved');

  const goMachine = () => navigate('/employee/machine');

  return (
    <div className="flex flex-col gap-6 font-sans text-dark-slate">
      <DashboardHeader
        greeting={(() => {
          const displayName = effectiveUser?.first_name
            ? `${effectiveUser.first_name}${effectiveUser.last_name ? ' ' + effectiveUser.last_name : ''}`
            : (effectiveUser?.name || 'General Employee');
          return `Welcome back, ${displayName}!`;
        })()}
        subtitle="Here's a real-time summary of your assigned equipment support tickets."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {stats.map((s) => (
          <MetricCard
            key={s.label}
            title={s.label}
            value={s.value}
            subtitle={s.sub}
            icon={s.icon}
            variant={s.variant}
            loading={loadingTickets}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-red-200 bg-red-50/50 p-6 shadow-level-1">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm font-bold text-red-800">Ventilator Pressure Alarm Fault</span>
          </div>
          <p className="text-xs text-red-600 mb-4 font-medium">Immediate action required</p>
          {urgentTicket && (
            <button
              type="button"
              onClick={() => openTicketFlow(urgentTicket)}
              className="w-full flex items-center justify-between rounded-xl border border-red-200 bg-surface px-4 py-3 shadow-xs hover:border-red-300 transition-colors text-left cursor-pointer"
            >
              <div>
                <p className="text-sm font-semibold text-dark-slate">SLA Breached</p>
                <p className="text-xs text-muted-slate">{urgentTicket.id} · {urgentTicket.facility || 'Facility #1'}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-slate" />
            </button>
          )}
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-6 shadow-level-1">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              <span className="text-sm font-bold text-amber-900">Escalated Tickets</span>
            </div>
            <button
              type="button"
              onClick={() => navigate('/employee/assigned')}
              className="text-amber-800 hover:text-amber-950 p-1 cursor-pointer"
              aria-label="Go to assigned"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs text-amber-700 mb-4 font-medium">Requires senior technical review</p>
          {escalatedTicket && (
            <button
              type="button"
              onClick={() => openTicketFlow(escalatedTicket)}
              className="w-full flex items-center justify-between rounded-xl border border-amber-200 bg-surface px-4 py-3 shadow-xs hover:border-amber-300 transition-colors text-left cursor-pointer"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-2 h-2 bg-red-500 rounded-full shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-dark-slate">{escalatedTicket.title}</p>
                  <p className="text-xs text-muted-slate">{escalatedTicket.id} · {escalatedTicket.facility || 'Facility #1'}</p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-slate" />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <div className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-xs flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-dark-slate">Active Assigned Tickets</h2>
              <p className="text-xs text-muted-slate mt-0.5">{activeTickets.length} tickets need attention</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={goMachine}
              icon={<ArrowRight className="h-3.5 w-3.5" />}
            >
              View All
            </Button>
          </div>

          <div className="w-full space-y-3 shrink-0">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-slate" />
              <input
                type="search"
                placeholder="Search ID, title, customer..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-surface pl-9 pr-4 py-2.5 text-sm text-dark-slate outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent placeholder:text-muted-slate/60"
              />
            </div>
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 w-full">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="flex-1 min-w-[130px] rounded-xl border border-gray-200 bg-surface px-3 py-2 text-sm text-dark-slate outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent"
              >
                {['All Status', 'Open', 'In Progress', 'Escalated', 'Pending', 'Pending Reassign', 'On Hold'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="flex-1 min-w-[130px] rounded-xl border border-gray-200 bg-surface px-3 py-2 text-sm text-dark-slate outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent"
              >
                {['All Category', 'MRI', 'CT Scan', 'Ultrasound', 'X-Ray', 'Ventilator', 'Defibrillator'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="flex-1 min-w-[130px] rounded-xl border border-gray-200 bg-surface px-3 py-2 text-sm text-dark-slate outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent"
              >
                {['All Priority', 'Critical', 'High', 'Medium', 'Low'].map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Ticket ID</TableHead>
                  <TableHead className="min-w-[260px]">Title</TableHead>
                  <TableHead className="min-w-[160px]">Customer</TableHead>
                  <TableHead className="w-[140px]">Status</TableHead>
                  <TableHead className="w-[120px]">Priority</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-xs text-muted-slate">
                      No tickets match the selected filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((t) => (
                    <TableRow
                      key={t.id}
                      className="cursor-pointer"
                      onClick={() => handleViewDashboardTicket(t)}
                    >
                      <TableCell className="font-semibold text-brand-primary">
                        <div className="flex flex-col">
                          <span>{t.id}</span>
                          {!t.accepted && (
                            <span className="text-[11px] text-amber-700 font-medium">Tap to review</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[300px]">
                        <span className="line-clamp-2 font-medium text-dark-slate">{t.title}</span>
                      </TableCell>
                      <TableCell className="text-muted-slate truncate">{t.customer}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant={getStatusBadgeVariant(t.proofRejected ? 'Rejected' : t.status)} dot>
                            {t.proofRejected ? 'Proof Rejected' : t.status}
                          </Badge>
                          {(() => {
                            const rawSla = t.sla_status || t.slaStatus || (t.sla?.resolution?.status) || (t.sla_breached ? 'Breached' : null);
                            const normalized = rawSla ? String(rawSla).toLowerCase().replace(/[\s_-]+/g, '') : '';
                            if (normalized === 'breached' || normalized === 'violated') {
                              return (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                                  <AlertTriangle className="h-2.5 w-2.5 text-rose-600 shrink-0" />
                                  <span>Breached</span>
                                </span>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs font-semibold text-muted-slate">{t.priority}</span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <div className="text-xs text-muted-slate">
            Showing {filtered.length} of {activeTickets.length} active tickets
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-xs">
          <div className="flex justify-between items-center mb-5">
            <div>
              <h2 className="text-lg font-bold text-dark-slate">My Recent Tickets</h2>
              <p className="text-xs text-muted-slate mt-0.5">Latest submitted support tickets</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/employee/my-tickets')}
              icon={<ArrowRight className="h-3.5 w-3.5" />}
            >
              View All
            </Button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Ticket ID</TableHead>
                  <TableHead className="min-w-[280px]">Title</TableHead>
                  <TableHead className="w-[160px]">Status</TableHead>
                  <TableHead className="w-[100px] text-center">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {myRecentTickets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-xs text-muted-slate">
                      {loadingMyTickets ? 'Loading recent tickets...' : 'No tickets yet.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  myRecentTickets.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-semibold text-brand-primary align-middle">
                        {t.id}
                      </TableCell>
                      <TableCell className="align-middle">
                        <div className="font-semibold text-dark-slate">{t.title}</div>
                        <div className="text-xs text-muted-slate mt-0.5">{t.equipment || 'General'}</div>
                      </TableCell>
                      <TableCell className="align-middle">
                        <Badge variant={getStatusBadgeVariant(t.status)} dot>
                          {t.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center align-middle">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewMyTicket(t)}
                          icon={<Eye className="h-3.5 w-3.5" />}
                        >
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
      </div>

      {selectedDashboardTicket && (
        <CustomerTicketDetailModal
          ticket={selectedDashboardTicket}
          onClose={() => setSelectedDashboardTicket(null)}
          onDiscard={null}
          onReopen={null}
          onResolve={null}
          allowReopen={false}
          customerName={selectedDashboardTicket.customer}
        />
      )}

      {selectedMyTicket && (
        <CustomerTicketDetailModal
          ticket={selectedMyTicket}
          onClose={() => setSelectedMyTicket(null)}
          onDiscard={null}
          onReopen={(ticketId, reason) => handleReopenMyTicket(ticketId, reason)}
          onResolve={null}
        />
      )}

      {(myTicketsModalLoading || dashboardModalLoading) && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-[1.5px] animate-in fade-in duration-200">
          <div className="bg-surface rounded-2xl p-6 shadow-level-4 flex flex-col items-center gap-4 max-w-xs w-full mx-4 border border-slate-200">
            <div className="w-10 h-10 border-4 border-brand-primary/10 border-t-brand-primary rounded-full animate-spin" />
            <p className="text-sm font-semibold text-brand-primary text-center font-sans">
              {myTicketsLoadingText}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
