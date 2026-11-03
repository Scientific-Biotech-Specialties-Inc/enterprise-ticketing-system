import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import {
  Inbox,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Eye,
  Loader2,
} from 'lucide-react';
import {
  getCSDashboard,
  getTicketDetails,
  getInternalTickets,
  getAssignableEmployees,
  getDepartments,
  prefetchTicketFormOptions,
  acceptTicket,
} from '@/services/ticketService';
import { useAuth } from '@/context/AuthContext';
import useRealtimeRefresh from '@/hooks/useRealtimeRefresh';
import { formatDisplayDate } from '@/utils/dateUtils';
import CustomerTicketDetailModal from '@/components/CustomerTicketDetailModal';
import { AssignModal } from '@/components/CSModals';
import SlaStatusBadge from '@/components/sla/SlaStatusBadge';
import { DashboardHeader } from '@/components/ui/page-header';
import { MetricCard } from '@/components/ui/metric-card';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { DataTableSkeleton } from '@/components/ui/data-table';

const MOCK_STATS = {
  unassigned: 7,
  pending: 3,
  assigned: 9,
  highPriority: 11,
  slaBreached: 2,
  escalated: 4,
};

const MOCK_TICKETS = [
  { id: 'TKT-1006', customer: 'QC General Hospital', title: 'X-Ray Machine Failure', status: 'New', priority: 'Low', updated: '1 hr ago' },
  { id: 'TKT-1016', customer: 'St Lukes Taguig', title: 'Ultrasound Equipment Malfunction', status: 'New', priority: 'High', updated: '3 hrs ago' },
  { id: 'TKT-1007', customer: 'Philippine General Hospital', title: 'CT Scan Machine Error', status: 'Ongoing', priority: 'Medium', updated: '5 hrs ago' },
  { id: 'TKT-1017', customer: 'The Medical City', title: 'X-Ray Calibration Issue', status: 'New', priority: 'High', updated: '2 hrs ago' },
];

export default function CSDashboard() {
  const { refreshKey = 0 } = useOutletContext() || {};
  const navigate = useNavigate();
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newTicketId, setNewTicketId] = useState(null);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [myRecentTickets, setMyRecentTickets] = useState([]);
  const [loadingMyTickets, setLoadingMyTickets] = useState(true);
  const [selectedMyTicket, setSelectedMyTicket] = useState(null);
  const [myTicketsModalLoading, setMyTicketsModalLoading] = useState(false);
  const [assignModalTicket, setAssignModalTicket] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [priorityOptions, setPriorityOptions] = useState(['Low', 'Medium', 'High', 'Critical']);
  const newTicketTimerRef = useRef(null);

  const displayName = user?.first_name
    ? `${user.first_name}${user.last_name ? ' ' + user.last_name : ''}`
    : user?.name || 'Customer Service';

  const loadDashboard = useCallback(async ({ forceRefresh = false } = {}) => {
    setLoading(true);
    setError(null);

    try {
      const payload = await getCSDashboard({ limit: 10, forceRefresh: forceRefresh || refreshKey > 0 });
      const recentTickets = (payload.recent_tickets || MOCK_TICKETS).map((t) => ({
        ...t,
        updated: t.updated_at ? formatDisplayDate(t.updated_at) : t.updated || 'Just now',
        priority: t.priority || 'Unassigned',
      }));
      const isBreachedTicket = (t) => {
        if (['Resolved', 'Closed', 'Discarded'].includes(t.status)) return false;
        const s = String(t.sla_status || t.slaStatus || (t.sla?.resolution?.status) || '').toLowerCase().replace(/[\s_-]+/g, '');
        if (s === 'breached' || s === 'violated' || Boolean(t.sla_breached) || Boolean(t.is_breached)) return true;
        if (t.resolution_due_at && new Date(t.resolution_due_at) < new Date()) return true;
        if (t.due_at && new Date(t.due_at) < new Date()) return true;
        return false;
      };
      const slaBreachedCount = payload.summary?.sla_breached ?? payload.summary?.breached ?? recentTickets.filter(isBreachedTicket).length;
      const highPriorityCount = payload.summary?.high_priority ?? payload.summary?.highPriority ?? recentTickets.filter(
        (t) => (t.priority === 'Critical' || t.priority === 'High') && t.status !== 'Resolved' && t.status !== 'Closed'
      ).length;
      const escalatedCount = recentTickets.filter(
        (t) => (t.priority === 'Critical' || t.priority === 'High') && t.status !== 'Resolved' && t.status !== 'Closed'
      ).length;
      setStats({
        unassigned: payload.summary?.open ?? MOCK_STATS.unassigned,
        pending: payload.summary?.in_progress ?? MOCK_STATS.pending,
        assigned: payload.summary?.resolved ?? MOCK_STATS.assigned,
        highPriority: highPriorityCount,
        slaBreached: slaBreachedCount,
        escalated: escalatedCount,
      });
      setTickets(recentTickets);
    } catch {
      setError('Unable to load data from API — using local mock data.');
      setStats(MOCK_STATS);
      setTickets(MOCK_TICKETS);
    } finally {
      setLoading(false);
    }
  }, [refreshKey]);

  const handleRealtimeUpdate = useCallback((context) => {
    if (context && context.source === 'websocket') {
      const payload = context.payload;
      if (!payload) return;

      const { action, ticket } = payload;
      if (!ticket) return;

      if (action === 'created') {
        setTickets((prev) => {
          const exists = prev.some((t) => t.id === ticket.id || t.ticket_ID === ticket.ticket_ID);
          if (exists) return prev;
          const formatted = {
            ...ticket,
            id: ticket.id || `TKT-${ticket.ticket_ID}`,
            updated: 'Just now',
            priority: ticket.priority || 'Unassigned',
          };
          return [formatted, ...prev].slice(0, 10);
        });

        const tid = ticket.id || ticket.ticket_ID;
        setNewTicketId(tid);
        if (newTicketTimerRef.current) clearTimeout(newTicketTimerRef.current);
        newTicketTimerRef.current = setTimeout(() => {
          setNewTicketId(null);
        }, 15000);

        setStats((prev) => {
          if (!prev) return prev;
          const isHigh = ticket.priority === 'High' || ticket.priority === 'Critical';
          return {
            ...prev,
            unassigned: prev.unassigned + 1,
            highPriority: isHigh ? prev.highPriority + 1 : prev.highPriority,
          };
        });
      } else if (action === 'updated') {
        setTickets((prev) =>
          prev.map((t) => {
            if (t.id === ticket.id || t.ticket_ID === ticket.ticket_ID) {
              return {
                ...t,
                ...ticket,
                updated: 'Just now',
              };
            }
            return t;
          })
        );
      }
    }
  }, []);

  const handleViewTicket = useCallback(async (t) => {
    const isMock = !!t.isMock;
    if (isMock) {
      setSelectedTicket({ ...t, description: t.description || '', resolved_at: t.resolved_at || null, proofAttachments: t.proofAttachments || [], proofFiles: t.proofFiles || [] });
      return;
    }
    setModalLoading(true);
    try {
      const ticketId = t.ticket_ID || parseInt(String(t.id || '').replace(/\D/g, ''), 10);
      const full = await getTicketDetails(ticketId);
      setSelectedTicket({ ...t, ...full, description: full.description || t.description || '', resolved_at: full.resolved_at || null, proofAttachments: full.proofAttachments || [], proofFiles: full.proofFiles || [] });
    } catch {
      setSelectedTicket(t);
    } finally {
      setModalLoading(false);
    }
  }, []);

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
        localStorage.setItem('cs_created_tickets', JSON.stringify(mapped));
      } else {
        const stored = JSON.parse(localStorage.getItem('cs_created_tickets') || '[]');
        setMyRecentTickets(stored.slice(0, 5));
      }
    } catch {
      const stored = JSON.parse(localStorage.getItem('cs_created_tickets') || '[]');
      setMyRecentTickets(stored.slice(0, 5));
    } finally {
      setLoadingMyTickets(false);
    }
  }, []);

  const handleViewMyTicket = useCallback(async (t) => {
    const isMock = !!t.isMock;
    if (isMock) {
      setSelectedMyTicket({ ...t, description: t.description || '', resolved_at: t.resolved_at || null, proofAttachments: t.proofAttachments || [], proofFiles: t.proofFiles || [], can_discard: t.status === 'Open' && !t.assigned_to });
      return;
    }
    setMyTicketsModalLoading(true);
    try {
      const ticketId = t.ticket_ID || parseInt(String(t.id || '').replace(/\D/g, ''), 10);
      const full = await getTicketDetails(ticketId);
      setSelectedMyTicket({ ...t, ...full, description: full.description || t.description || '', resolved_at: full.resolved_at || null, proofAttachments: full.proofAttachments || [], proofFiles: full.proofFiles || [], can_discard: (full.status || t.status) === 'Open' && !full.assigned_to });
    } catch {
      setSelectedMyTicket(t);
    } finally {
      setMyTicketsModalLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard({ forceRefresh: false });
    loadMyTickets();
  }, [loadDashboard, loadMyTickets]);

  useEffect(() => {
    let isMounted = true;
    const preloadAssignData = async () => {
      try {
        const [empRes, depRes, optRes] = await Promise.allSettled([
          getAssignableEmployees(),
          getDepartments(),
          prefetchTicketFormOptions(),
        ]);
        if (!isMounted) return;
        if (empRes.status === 'fulfilled') setEmployees(empRes.value || []);
        if (depRes.status === 'fulfilled') setDepartments((depRes.value || []).map((d) => d.name || d));
        if (optRes.status === 'fulfilled') {
          const prioList = optRes.value?.ticket_priorities?.map((p) => p.priority_name);
          if (prioList && prioList.length) setPriorityOptions(prioList);
        }
      } catch (err) {
        console.warn('Failed to preload assign data:', err);
      }
    };
    preloadAssignData();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleOpenAssignModal = useCallback(async (ticket) => {
    setSelectedTicket(null);
    setSelectedMyTicket(null);
    if (employees.length === 0) {
      try {
        const [empList, deptList] = await Promise.all([
          getAssignableEmployees(),
          getDepartments(),
        ]);
        if (empList) setEmployees(empList);
        if (deptList) setDepartments((deptList || []).map((d) => d.name || d));
      } catch (err) {
        console.warn('Failed to fetch assign data on demand:', err);
      }
    }
    setAssignModalTicket(ticket);
  }, [employees.length]);

  const handleNavigateTicketHistory = useCallback((ticket) => {
    setSelectedTicket(null);
    setSelectedMyTicket(null);
    const ticketId = ticket.ticket_ID || Number(String(ticket.id).replace(/\D/g, ''));
    navigate(`/cs/history/${ticketId}`, { state: { ticket, backPath: '/cs/dashboard' } });
  }, [navigate]);

  const handleSaveAssignment = async (updated) => {
    const priorityMap = {
      Low: 1,
      Medium: 2,
      High: 3,
      Critical: 4,
    };

    const isMock = !!updated.isMock;
    if (isMock) {
      const refreshed = {
        ...updated,
        status: 'Pending Assignment',
      };
      setTickets((prev) => prev.map((t) => (t.ticket_ID === updated.ticket_ID || t.id === updated.id ? refreshed : t)));
      setAssignModalTicket(null);
      return true;
    }

    try {
      const targetTicketId = updated.ticket_ID || Number(String(updated.id || '').replace(/\D/g, ''));
      await acceptTicket({
        ticketId: targetTicketId,
        employeeIds: updated.assigned,
        assignedByEmail: user?.email,
        priorityId: priorityMap[updated.priority] ?? 1,
      });

      window.dispatchEvent(new Event('notifications:updated'));
      setAssignModalTicket(null);
      await loadDashboard({ forceRefresh: true });
      return true;
    } catch (err) {
      console.error('Failed to assign ticket:', err);
      window.alert('Failed to assign ticket. Please try again.');
      return false;
    }
  };

  useRealtimeRefresh({
    refresh: handleRealtimeUpdate,
    channels: [{ name: 'ticket-updates', event: 'ticket.changed' }],
    intervalMs: 30000,
    deferRefresh: false,
  });

  return (
    <div className="space-y-6 w-full min-w-0 max-w-full">
      {/* Pattern A Header */}
      <DashboardHeader
        greeting="Welcome back"
        userName={displayName}
        subtitle="Monitor incoming tickets, assignments, and service queue status."
        badgeText="Active"
        badgeVariant="emerald"
      />

      {error && (
        <div className="rounded-lg bg-warning/10 border border-warning/20 text-warning-foreground px-4 py-3 text-sm font-medium">
          {error}
        </div>
      )}

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <MetricCard
          title="Unassigned Tickets"
          value={stats?.unassigned ?? 0}
          icon={<Inbox className="w-5 h-5" />}
          loading={loading}
        />
        <MetricCard
          title="Pending Tickets"
          value={stats?.pending ?? 0}
          icon={<Clock className="w-5 h-5" />}
          loading={loading}
        />
        <MetricCard
          title="Assigned Tickets"
          value={stats?.assigned ?? 0}
          icon={<CheckCircle2 className="w-5 h-5" />}
          loading={loading}
        />
        <MetricCard
          title="High Priority"
          value={stats?.highPriority ?? 0}
          icon={<AlertTriangle className="w-5 h-5" />}
          loading={loading}
        />
        <MetricCard
          title="SLA Breached"
          value={stats?.slaBreached ?? 0}
          icon={<AlertTriangle className="w-5 h-5 text-rose-600" />}
          variant="crimson"
          loading={loading}
          onClick={() => navigate('/ticketing/cs/incoming?sla=Breached')}
          className="cursor-pointer hover:shadow-md transition-shadow"
        />
        <MetricCard
          title="Escalated Tickets"
          value={stats?.escalated ?? 0}
          icon={<AlertTriangle className="w-5 h-5 text-amber-600" />}
          variant="amber"
          loading={loading}
        />
      </div>

      {/* Recent Ticket Activities */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-foreground">Recent Ticket Activities</h2>
            <p className="text-xs text-muted-foreground">Showing {tickets.length} recent tickets</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">Ticket ID</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[150px]">SLA Target</TableHead>
                <TableHead>Priority</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <DataTableSkeleton columns={6} rows={4} />
              ) : tickets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground text-sm">
                    No tickets found.
                  </TableCell>
                </TableRow>
              ) : (
                tickets.map((r, idx) => {
                  const isNew = r.id === newTicketId || r.ticket_ID === newTicketId;
                  return (
                    <TableRow
                      key={r.id + '-' + idx}
                      onClick={() => handleViewTicket(r)}
                      className={`cursor-pointer hover:bg-muted/50 transition-colors ${
                        isNew ? 'bg-primary/5' : idx === 0 ? 'bg-muted/20' : ''
                      }`}
                    >
                      <TableCell className="font-semibold text-primary text-sm whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span>{r.id}</span>
                          {isNew && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-semibold">
                              New
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-foreground max-w-[20rem] truncate">
                        {r.title}
                      </TableCell>
                      <TableCell className="text-muted-foreground truncate max-w-[14rem]">
                        {r.customer}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(r.status)}>
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <SlaStatusBadge ticket={r} />
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            r.priority?.toLowerCase() === 'critical'
                              ? 'destructive'
                              : r.priority?.toLowerCase() === 'high'
                              ? 'warning'
                              : 'secondary'
                          }
                        >
                          {r.priority}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* My Recent Tickets */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-xs space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-base font-bold text-foreground">My Recent Tickets</h2>
            <p className="text-xs text-muted-foreground">Latest submitted internal support tickets</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/cs/my-tickets')}
            className="text-primary hover:text-primary gap-1"
          >
            <span>View All</span>
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">Ticket ID</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[80px] text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingMyTickets ? (
                <DataTableSkeleton columns={4} rows={3} />
              ) : myRecentTickets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground text-sm">
                    No tickets yet.
                  </TableCell>
                </TableRow>
              ) : (
                myRecentTickets.map((t) => (
                  <TableRow key={t.id} className="hover:bg-muted/50 transition-colors">
                    <TableCell className="font-semibold text-primary whitespace-nowrap">
                      {t.id}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-foreground text-sm">{t.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{t.equipment || 'General'}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(t.status)}>
                        {t.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleViewMyTicket(t)}
                        aria-label={`View ${t.id}`}
                        className="text-muted-foreground hover:text-primary h-8 w-8"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {selectedTicket && (
        <CustomerTicketDetailModal
          ticket={selectedTicket}
          onClose={() => setSelectedTicket(null)}
          onDiscard={null}
          onReopen={null}
          onResolve={null}
          allowReopen={false}
          customerName={selectedTicket.customer}
          onAssign={handleOpenAssignModal}
          onViewTicket={handleNavigateTicketHistory}
        />
      )}

      {selectedMyTicket && (
        <CustomerTicketDetailModal
          ticket={selectedMyTicket}
          onClose={() => setSelectedMyTicket(null)}
          onDiscard={null}
          onReopen={null}
          onResolve={null}
          allowReopen={false}
          customerName={selectedMyTicket.customer}
          onAssign={handleOpenAssignModal}
          onViewTicket={handleNavigateTicketHistory}
        />
      )}

      {assignModalTicket && (
        <AssignModal
          ticket={assignModalTicket}
          employees={employees.filter((e) => e.id !== assignModalTicket?.requested_by)}
          departments={departments}
          priorityOptions={priorityOptions}
          onClose={() => setAssignModalTicket(null)}
          onSave={handleSaveAssignment}
        />
      )}

      {(modalLoading || myTicketsModalLoading) && (
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
