import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search, AlertTriangle, Clock, CheckCircle2, PauseCircle, HelpCircle } from 'lucide-react';
import { sortTicketsByPriority } from '@/constants/employeeTickets';
import TicketInfoModal from '@/components/employee/TicketInfoModal';
import ReassignmentModal from '@/components/employee/ReassignmentModal';
import CustomerTicketDetailModal from '@/components/CustomerTicketDetailModal';
import { formatDisplayDate } from '@/utils/dateUtils';
import { useAuth } from '@/context/AuthContext';
import { getEmployeeAssignedTickets, clearEmployeeTicketsCache } from '@/services/ticketService';
import useRealtimeRefresh from '@/hooks/useRealtimeRefresh';
import { hasPendingReassignment } from '@/utils/reassignmentUtils';
import { PageHeader } from '@/components/ui/page-header';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { DataTableSkeleton, DataTableEmptyState } from '@/components/ui/data-table';

const CLOSED_STATUSES = ['Closed', 'Resolved'];

const isPendingEvaluationTicket = (ticket) => {
  if (!ticket) return false;
  return (
    ticket.status === 'Pending Evaluation' ||
    Number(ticket.ticket_status_ID) === 6 ||
    ticket.proofStatus === 'pending' ||
    (Boolean(ticket.proofSubmitted) && ticket.status !== 'Resolved' && ticket.status !== 'Closed')
  );
};

const getDisplayStatus = (ticket) => (
  ticket.proofRejected
    ? 'Proof Rejected'
    : ticket.status
);

const isInternalTicket = (ticket) => (
  ticket?.title?.startsWith('[Internal]')
  || ticket?.is_internal
  || ticket?.ticket_type === 'Internal'
  || ticket?.type === 'Internal'
);

const getTicketTypeLabel = (ticket) => (isInternalTicket(ticket) ? 'Internal' : 'External');

const renderSlaBadge = (ticket) => {
  const rawStatus = ticket.sla_status || ticket.slaStatus || (ticket.sla?.resolution?.status) || null;
  const status = rawStatus ? String(rawStatus).toLowerCase().replace(/[\s_-]+/g, '') : null;
  const dueAt = ticket.resolution_due_at || ticket.due_at || ticket.sla?.resolution?.target;
  const formattedDue = dueAt ? formatDisplayDate(dueAt) : null;
  const remainingMin = ticket.time_remaining_minutes !== undefined && ticket.time_remaining_minutes !== null
    ? ticket.time_remaining_minutes
    : null;

  if (status === 'breached') {
    return (
      <div className="flex flex-col gap-0.5">
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200 w-fit"
          title={formattedDue ? `Breached deadline: ${formattedDue}` : 'Resolution target breached'}
        >
          <AlertTriangle className="h-3 w-3 text-rose-600 shrink-0" />
          <span>Breached</span>
        </span>
        {formattedDue && (
          <span className="text-[10px] text-rose-600 font-medium truncate max-w-[130px]">
            Due: {formattedDue}
          </span>
        )}
      </div>
    );
  }

  if (status === 'atrisk') {
    return (
      <div className="flex flex-col gap-0.5">
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 w-fit"
          title={formattedDue ? `Deadline: ${formattedDue}` : 'SLA resolution near breach'}
        >
          <Clock className="h-3 w-3 text-amber-600 shrink-0" />
          <span>At Risk</span>
        </span>
        {remainingMin !== null && remainingMin > 0 ? (
          <span className="text-[10px] text-amber-600 font-medium">
            {remainingMin > 60 ? `${Math.round(remainingMin / 60)}h left` : `${remainingMin}m left`}
          </span>
        ) : formattedDue ? (
          <span className="text-[10px] text-amber-600 font-medium truncate max-w-[130px]">
            Due: {formattedDue}
          </span>
        ) : null}
      </div>
    );
  }

  if (status === 'paused') {
    return (
      <div className="flex flex-col gap-0.5">
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 w-fit"
          title="SLA calculation clock paused while on hold"
        >
          <PauseCircle className="h-3 w-3 text-blue-600 shrink-0" />
          <span>Paused</span>
        </span>
        <span className="text-[10px] text-muted-foreground font-medium">
          On Hold
        </span>
      </div>
    );
  }

  if (status === 'ontrack' || status === 'compliant') {
    return (
      <div className="flex flex-col gap-0.5">
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 w-fit"
          title={formattedDue ? `Target: ${formattedDue}` : 'Compliant with SLA targets'}
        >
          <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
          <span>{status === 'compliant' ? 'Compliant' : 'On Track'}</span>
        </span>
        {formattedDue && (
          <span className="text-[10px] text-muted-foreground font-medium truncate max-w-[130px]">
            Due: {formattedDue}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-gray-50 text-gray-500 border border-gray-200 w-fit"
        title="No active SLA configuration applied"
      >
        <HelpCircle className="h-3 w-3 text-gray-400 shrink-0" />
        <span>No SLA</span>
      </span>
    </div>
  );
};

const selectClass =
  'text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 outline-none focus:ring-2 focus:ring-[#252578]/20 cursor-pointer min-w-[8.5rem]';

export default function EmployeeMachine() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All Status');
  const [slaFilter, setSlaFilter] = useState('All SLA');
  const [categoryFilter, setCategoryFilter] = useState('All Category');
  const [priorityFilter, setPriorityFilter] = useState('All Priority');

  const [typeFilter, setTypeFilter] = useState('all');
  const [assignedTab, setAssignedTab] = useState('in_progress'); // 'in_progress' | 'pending_evaluation' | 'all'

  // Compute tab counts
  const inProgressCount = useMemo(() => {
    return tickets.filter((t) => t.accepted && !CLOSED_STATUSES.includes(t.status) && !isPendingEvaluationTicket(t)).length;
  }, [tickets]);

  const pendingEvaluationCount = useMemo(() => {
    return tickets.filter((t) => t.accepted && !CLOSED_STATUSES.includes(t.status) && isPendingEvaluationTicket(t)).length;
  }, [tickets]);

  const totalAssignedCount = useMemo(() => {
    return tickets.filter((t) => t.accepted && !CLOSED_STATUSES.includes(t.status)).length;
  }, [tickets]);

  // Modal states
  const [infoTicket, setInfoTicket] = useState(null);
  const [reassignTicket, setReassignTicket] = useState(null);

  const loadTickets = useCallback(async ({ forceRefresh = false } = {}) => {
    const email = user?.email || 'frontend@example.com';
    setLoading(true);
    setLoadError('');
    try {
      const list = await getEmployeeAssignedTickets({ employeeEmail: email, forceRefresh });
      // Only show accepted & active (not closed/resolved) tickets
      setTickets(list);
    } catch (err) {
      setLoadError('Unable to load active progress tickets.');
    } finally {
      setLoading(false);
    }
  }, [user?.email]);

  useEffect(() => {
    loadTickets({ forceRefresh: true });
  }, [loadTickets]);

  useEffect(() => {
    const focusId = location.state?.focusTicketId;
    if (focusId && tickets.length > 0) {
      const match = tickets.find(t => t.id === focusId || t.ticket_ID === focusId);
      if (match) {
        setInfoTicket(match);
        window.history.replaceState({}, document.title);
      }
    }
  }, [location.state, tickets]);

  const handleRealtimeRefresh = useCallback(() => {
    clearEmployeeTicketsCache();
    loadTickets({ forceRefresh: true });
  }, [loadTickets]);

  useRealtimeRefresh({
    refresh: handleRealtimeRefresh,
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = tickets.filter((t) => {
      if (!t.accepted) return false;
      if (CLOSED_STATUSES.includes(t.status)) return false;

      // Tab filtering
      if (assignedTab === 'in_progress') {
        if (isPendingEvaluationTicket(t)) return false;
      } else if (assignedTab === 'pending_evaluation') {
        if (!isPendingEvaluationTicket(t)) return false;
      }

      if (statusFilter !== 'All Status') {
        if (statusFilter === 'Pending Reassignment' || statusFilter === 'Pending Reassign') {
          if (!hasPendingReassignment(t)) return false;
        } else if (statusFilter === 'Pending Evaluation') {
          if (!isPendingEvaluationTicket(t)) return false;
        } else if (t.status !== statusFilter) {
          return false;
        }
      }

      if (typeFilter === 'internal') {
        const isInternal = t.title?.startsWith('[Internal]') || t.is_internal || t.ticket_type === 'Internal' || t.type === 'Internal';
        if (!isInternal) return false;
      } else if (typeFilter === 'external') {
        const isInternal = t.title?.startsWith('[Internal]') || t.is_internal || t.ticket_type === 'Internal' || t.type === 'Internal';
        if (isInternal) return false;
      }

      if (slaFilter !== 'All SLA') {
        const targetSla = slaFilter.toLowerCase().replace(/[\s_-]+/g, '');
        const raw = t.sla_status || t.slaStatus || (t.sla?.resolution?.status) || '';
        const norm = String(raw).toLowerCase().replace(/[\s_-]+/g, '');
        if (targetSla === 'ontrack') {
          if (norm !== 'ontrack' && norm !== 'compliant') return false;
        } else if (norm !== targetSla) {
          return false;
        }
      }

      if (categoryFilter !== 'All Category' && t.category !== categoryFilter) return false;
      if (priorityFilter !== 'All Priority' && t.priority !== priorityFilter) return false;
      if (q) {
        const blob = `${t.id} ${t.title} ${t.customer} ${t.facility ?? ''}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });

    list = sortTicketsByPriority(list, 'desc');
    return list;
  }, [tickets, search, assignedTab, statusFilter, slaFilter, categoryFilter, priorityFilter, typeFilter]);

  const openTicketFlow = (t) => {
    setInfoTicket(t);
  };

  const handleUpdateClick = (t) => {
    setInfoTicket(null);
    const tId = t.ticket_ID || t.id;
    navigate('/employee/ticket-update', { state: { ticketId: tId, ticket: t } });
  };

  const handleReopenProgressTicket = (ticketId, reason) => {
    const timestamp = new Date().toISOString();
    setTickets((prev) =>
      prev.map((t) => {
        if (t.id === ticketId || t.ticket_ID === ticketId) {
          const timeline = t.timeline || [
            { id: 'creation', type: 'system', text: 'Ticket created.', timestamp: t.date_created || new Date().toISOString() }
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
      })
    );
    setInfoTicket(null);
    window.alert('Ticket reopened successfully.');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assigned Ticket"
        subtitle="Tickets assigned to you — work, update, and resolve."
        actions={
          <div className="flex border border-border rounded-lg overflow-hidden bg-card shrink-0">
            {['all', 'external', 'internal'].map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setTypeFilter(type)}
                className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  typeFilter === type
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card hover:bg-muted text-muted-foreground'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        }
      />

      {loadError && (
        <div className="rounded-lg bg-destructive/10 text-destructive border border-destructive/20 px-4 py-3 text-sm">
          {loadError}
        </div>
      )}

      {/* Assigned Tabs */}
      <div className="flex border-b border-border gap-2">
        <button
          type="button"
          onClick={() => setAssignedTab('in_progress')}
          className={`pb-3 px-4 text-sm font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
            assignedTab === 'in_progress'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
          }`}
        >
          <span>In Progress</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
            assignedTab === 'in_progress' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
          }`}>
            {inProgressCount}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setAssignedTab('pending_evaluation')}
          className={`pb-3 px-4 text-sm font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
            assignedTab === 'pending_evaluation'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
          }`}
        >
          <span>Pending Evaluation</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
            assignedTab === 'pending_evaluation' ? 'bg-accent/15 text-accent' : 'bg-muted text-muted-foreground'
          }`}>
            {pendingEvaluationCount}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setAssignedTab('all')}
          className={`pb-3 px-4 text-sm font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
            assignedTab === 'all'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
          }`}
        >
          <span>All Assigned</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
            assignedTab === 'all' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
          }`}>
            {totalAssignedCount}
          </span>
        </button>
      </div>

      {/* Filter toolbar */}
      <div className="w-full space-y-3 shrink-0">
        <div className="relative w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-slate" />
          <input
            type="search"
            placeholder="Search ID, title, customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-surface pl-10 pr-4 py-2.5 text-sm text-dark-slate outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent placeholder:text-muted-slate/60"
          />
        </div>
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 w-full">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="flex-1 min-w-[130px] rounded-xl border border-gray-200 bg-surface px-3 py-2 text-sm text-dark-slate outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent"
          >
            <option value="All Status">All Status</option>
            <option value="In Progress">In Progress</option>
            <option value="Pending">Pending</option>
            <option value="Pending Evaluation">Pending Evaluation</option>
            <option value="Pending Reassign">Pending Reassign</option>
            <option value="Resolved">Resolved</option>
            <option value="Closed">Closed</option>
            <option value="Reopened">Reopened</option>
          </select>
          <select
            value={slaFilter}
            onChange={(e) => setSlaFilter(e.target.value)}
            className="flex-1 min-w-[130px] rounded-xl border border-gray-200 bg-surface px-3 py-2 text-sm text-dark-slate outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent"
          >
            <option value="All SLA">All SLA</option>
            <option value="Breached">Breached</option>
            <option value="At Risk">At Risk</option>
            <option value="On Track">On Track</option>
            <option value="Paused">Paused</option>
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="flex-1 min-w-[130px] rounded-xl border border-gray-200 bg-surface px-3 py-2 text-sm text-dark-slate outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent"
          >
            <option value="All Category">All Category</option>
            <option value="MRI">MRI</option>
            <option value="CT Scan">CT Scan</option>
            <option value="Ultrasound">Ultrasound</option>
            <option value="X-Ray">X-Ray</option>
            <option value="Ventilator">Ventilator</option>
          </select>
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="flex-1 min-w-[130px] rounded-xl border border-gray-200 bg-surface px-3 py-2 text-sm text-dark-slate outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent"
          >
            <option value="All Priority">All Priority</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </div>
      </div>

      {/* Table Card */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[120px]">Ticket ID</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[140px]">SLA Status</TableHead>
              <TableHead className="w-[150px]">Last Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <DataTableSkeleton columns={9} rows={5} />
            ) : filtered.length === 0 ? (
              <DataTableEmptyState
                colSpan={9}
                message="No active accepted tickets found in your progress queue."
              />
            ) : (
              filtered.map((t) => {
                const displayStatus = hasPendingReassignment(t)
                  ? 'Pending Reassignment'
                  : isPendingEvaluationTicket(t)
                  ? 'Pending Evaluation'
                  : getDisplayStatus(t);

                return (
                  <TableRow
                    key={t.id}
                    onClick={() => openTicketFlow(t)}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                  >
                    <TableCell className="font-semibold text-primary whitespace-nowrap">
                      {t.id}
                    </TableCell>
                    <TableCell className="text-muted-foreground truncate max-w-[12rem]">
                      {t.customer}
                    </TableCell>
                    <TableCell>
                      <Badge variant={isInternalTicket(t) ? 'secondary' : 'outline'}>
                        {getTicketTypeLabel(t)}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium text-foreground max-w-[16rem]">
                      <div className="flex flex-col gap-0.5">
                        <span className="truncate">{t.title}</span>
                        {t.proofRejected && (
                          <p className="text-xs text-rose-600 font-medium truncate" title={`Proof rejected: ${t.rejectionReason || 'No reason provided'}`}>
                            Rejection reason: &quot;{t.rejectionReason || 'Proof rejected by CS'}&quot;
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {t.category}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          t.priority?.toLowerCase() === 'critical'
                            ? 'destructive'
                            : t.priority?.toLowerCase() === 'high'
                            ? 'warning'
                            : 'secondary'
                        }
                      >
                        {t.priority}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 items-start">
                        <Badge variant={getStatusBadgeVariant(displayStatus)}>
                          {displayStatus}
                        </Badge>
                        {t.proofRejected && (
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 shadow-2xs">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                            Proof Rejected
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {renderSlaBadge(t)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                      {formatDisplayDate(t.lastUpdate)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        {!loading && filtered.length > 0 && (
          <div className="px-4 py-3 border-t border-border bg-card">
            <p className="text-xs text-muted-foreground">
              Showing {filtered.length} of {totalAssignedCount} assigned tickets
            </p>
          </div>
        )}
      </div>

      {/* Detail management modal */}
      {infoTicket && (infoTicket.status === 'Closed' || infoTicket.status === 'Resolved' || infoTicket.status === 'Reopened') ? (
        <CustomerTicketDetailModal
          ticket={infoTicket}
          onClose={() => setInfoTicket(null)}
          onDiscard={null}
          allowReopen={false}
          onReopen={(ticketId, reason) => handleReopenProgressTicket(ticketId, reason)}
        />
      ) : infoTicket && (
        <TicketInfoModal
          ticket={infoTicket}
          onClose={() => setInfoTicket(null)}
          onReassignSuccess={(id, reason) => {
            setTickets((prev) =>
              prev.map((t) =>
                t.id === id || t.ticket_ID === id
                  ? {
                      ...t,
                      reassignmentRequested: true,
                      reassignmentStatus: 'Pending',
                      reassignmentReason: reason,
                      status: 'Pending Reassignment',
                      deniedReassignment: false,
                      reassignmentDenied: false,
                      disapprovalReason: null,
                      reassignmentDenyReason: null,
                    }
                  : t
              )
            );
            loadTickets({ forceRefresh: true });
          }}
        />
      )}

      {/* Reassignment modal */}
      {reassignTicket && (
        <ReassignmentModal
          ticket={reassignTicket}
          onClose={() => setReassignTicket(null)}
          onReassignSuccess={(id) => {
            setTickets((prev) =>
              prev.map((t) =>
                t.id === id
                  ? { ...t, reassignmentRequested: true, reassignmentStatus: 'Pending' }
                  : t
              )
            );
            setReassignTicket(null);
          }}
        />
      )}
    </div>
  );
}
