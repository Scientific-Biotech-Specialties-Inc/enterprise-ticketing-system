import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search, Filter, Inbox, AlertTriangle, Bell } from 'lucide-react';
import {
  statusColors,
  priorityColors,
  sortTicketsByPriority,
} from '@/constants/employeeTickets';
import TicketDetailModal from '@/components/employee/TicketDetailModal';
import TicketInfoModal from '@/components/employee/TicketInfoModal';
import ReassignmentModal from '@/components/employee/ReassignmentModal';
import { formatDisplayDate, parseUTCDate } from '@/utils/dateUtils';
import { useAuth } from '@/context/AuthContext';
import { getEmployeeAssignedTickets, acceptTicket, updateTicket, updateEmployeeTicketOverride, clearEmployeeTicketsCache } from '@/services/ticketService';
import useRealtimeRefresh from '@/hooks/useRealtimeRefresh';
import { isReassignmentDenied, hasPendingReassignment } from '@/utils/reassignmentUtils';
import { PageHeader } from '@/components/ui/page-header';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { DataTableSkeleton, DataTableEmptyState } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';

const CLOSED_STATUSES = ['Closed', 'Resolved'];

const buildEmployeeTicketSearchString = (t) => {
  if (!t) return '';
  const id = String(t.id || t.ticket_ID || t.ticket_number || '');
  const customer = String(
    t.customer ||
    t.customer_name ||
    t.requestor ||
    t.created_by_name ||
    (typeof t.customer === 'object' ? t.customer?.name : '') ||
    ''
  );
  const isInternal = Boolean(
    t.title?.startsWith('[Internal]') ||
    t.is_internal ||
    t.ticket_type === 'Internal' ||
    t.type === 'Internal'
  );
  const typeStr = isInternal ? 'internal' : 'external';
  const title = String(t.title || '');
  const category = String(t.category || '');
  const rawStatus = String(t.status || '');
  const reassignmentBadge = hasPendingReassignment(t)
    ? 'pending reassignment'
    : isReassignmentDenied(t)
    ? 'reassignment failed reassignment disapproved'
    : '';
  const statusStr = `${rawStatus} ${reassignmentBadge}`;
  const priorityStr = String(t.priority || '');
  const facility = String(t.facility || '');
  const dept = String(t.department || '');
  const equip = String(t.equipment || t.machine_name || '');

  const dateValue = t.updated_at || t.last_update || t.date || t.created_at || '';
  const rawDate = String(dateValue);
  const formattedDate = formatDisplayDate(dateValue);
  let extraDates = '';
  try {
    const parsed = parseUTCDate(dateValue);
    if (parsed && !isNaN(parsed.getTime())) {
      extraDates = [
        parsed.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
        parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        parsed.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }),
        parsed.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }),
      ].join(' ');
    }
  } catch (e) {}

  return [
    id,
    customer,
    typeStr,
    title,
    category,
    priorityStr,
    statusStr,
    facility,
    dept,
    equip,
    rawDate,
    formattedDate,
    extraDates,
  ]
    .join(' ')
    .toLowerCase();
};

const selectClass =
  'text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 outline-none focus:ring-2 focus:ring-[#252578]/20 cursor-pointer min-w-[8.5rem]';

export default function EmployeeAssigned() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();



  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All Status');
  const [categoryFilter, setCategoryFilter] = useState('All Category');
  const [priorityFilter, setPriorityFilter] = useState('All Priority');
  const [sortPriority, setSortPriority] = useState('Priority');

  const [isAccepting, setIsAccepting] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const [incomingTab, setIncomingTab] = useState('incoming'); // 'incoming' | 'pending_reassignment' | 'all'

  // Compute incoming counts for display
  const pendingAcceptanceCount = useMemo(() => {
    return tickets.filter((t) => !t.rejected && !CLOSED_STATUSES.includes(t.status) && (!t.accepted || t.proofRejected) && !hasPendingReassignment(t)).length;
  }, [tickets]);

  const pendingReassignmentCount = useMemo(() => {
    return tickets.filter((t) => !t.rejected && !CLOSED_STATUSES.includes(t.status) && hasPendingReassignment(t)).length;
  }, [tickets]);

  const totalIncomingCount = useMemo(() => {
    return tickets.filter((t) => !t.rejected && !CLOSED_STATUSES.includes(t.status) && (!t.accepted || t.proofRejected)).length;
  }, [tickets]);

  const pendingCount = totalIncomingCount;

  // Modal state — which modal to show
  const [pendingTicket, setPendingTicket] = useState(null);   // not-yet-accepted → TicketDetailModal
  const [infoTicket, setInfoTicket] = useState(null);         // accepted & active → TicketInfoModal
  const [reassignTicket, setReassignTicket] = useState(null); // reassign flow
  const [deniedReassignTicket, setDeniedReassignTicket] = useState(null); // denied reassign → skip accept, show update

  const loadTickets = useCallback(async ({ forceRefresh = false } = {}) => {
    const email = user?.email || 'frontend@example.com';
    setLoading(true);
    setLoadError('');
    try {
      const list = await getEmployeeAssignedTickets({ employeeEmail: email, forceRefresh });
      setTickets(list.map((t) => ({ ...t, rejected: false })));
    } catch {
      setLoadError('Unable to load assigned tickets from ticket-service.');
    } finally {
      setLoading(false);
    }
  }, [user?.email]);

  useEffect(() => {
    loadTickets({ forceRefresh: true });
  }, [loadTickets]);

  // Handle notification-triggered ticket opens
  useEffect(() => {
    const focusId = location.state?.focusTicketId;
    if (focusId && tickets.length > 0) {
      const match = tickets.find(t => t.id === focusId || t.ticket_ID === focusId);
      if (match) {
        // Open the ticket based on its status
        if (match.deniedReassignment || isReassignmentDenied(match)) {
          setDeniedReassignTicket(match);
        } else if (!match.accepted) {
          setPendingTicket(match);
        } else {
          setInfoTicket(match);
        }
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

        if (isRemovedAssignee && payloadTicketId) {
          setPendingTicket((prev) => (Number(prev?.ticket_ID || String(prev?.id).replace(/\D/g, '')) === payloadTicketId ? null : prev));
          setInfoTicket((prev) => (Number(prev?.ticket_ID || String(prev?.id).replace(/\D/g, '')) === payloadTicketId ? null : prev));
          setReassignTicket((prev) => (Number(prev?.ticket_ID || String(prev?.id).replace(/\D/g, '')) === payloadTicketId ? null : prev));
        }

        return Boolean(isCurrentAssignee || isRemovedAssignee || isHoldingTicket || !payloadTicketId);
      }
      return true;
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = tickets.filter((t) => {
      if (t.rejected) return false;
      if (CLOSED_STATUSES.includes(t.status)) return false;
      if (t.accepted && !t.proofRejected) return false;

      // Tab filtering
      if (incomingTab === 'incoming') {
        if (hasPendingReassignment(t)) return false;
      } else if (incomingTab === 'pending_reassignment') {
        if (!hasPendingReassignment(t)) return false;
      }

      if (statusFilter !== 'All Status') {
        if (statusFilter === 'Pending Reassignment' || statusFilter === 'Pending Reassign') {
          if (!hasPendingReassignment(t)) return false;
        } else if (statusFilter === 'Reassignment Failed' || statusFilter === 'Reassignment Disapproved') {
          if (!isReassignmentDenied(t)) return false;
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

      if (categoryFilter !== 'All Category' && t.category !== categoryFilter) return false;
      if (priorityFilter !== 'All Priority' && t.priority !== priorityFilter) return false;
      if (q) {
        const cleanQ = q.trim().toLowerCase();
        const searchBlob = buildEmployeeTicketSearchString(t);
        if (!searchBlob.includes(cleanQ)) {
          const tokens = cleanQ.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
          if (!(tokens.length > 0 && tokens.every((token) => searchBlob.includes(token)))) {
            return false;
          }
        }
      }
      return true;
    });

    if (sortPriority === 'Priority') {
      list = sortTicketsByPriority(list, 'desc');
    } else {
      list = [...list].sort((a, b) => {
        const timeA = new Date(a.updated_at || a.last_update || a.lastUpdate || a.date || a.created_at || 0).getTime();
        const timeB = new Date(b.updated_at || b.last_update || b.lastUpdate || b.date || b.created_at || 0).getTime();
        return timeB - timeA;
      });
    }

    return list;
  }, [tickets, search, incomingTab, statusFilter, categoryFilter, priorityFilter, sortPriority, typeFilter]);

  const handleAcceptAssignment = useCallback(async (id) => {
    const ticketObj = tickets.find((t) => t.id === id);
    if (!ticketObj) return;

    const numericId = ticketObj.ticket_ID || Number(String(id).replace(/\D/g, ''));
    setIsAccepting(true);
    try {
      await acceptTicket({
        ticketId: numericId,
      });
      setIsAccepting(false);
      setPendingTicket(null);
      setTickets((prev) => prev.filter((t) => t.id !== id));
      window.dispatchEvent(new Event('notifications:updated'));
      navigate('/employee/machine');
    } catch (err) {
      console.error('Failed to accept assignment on backend:', err);
      setIsAccepting(false);
      window.alert(err?.response?.data?.message || 'Failed to accept assignment. Please try again.');
    }
  }, [tickets, navigate]);

  const handleRejectAssignment = useCallback((id) => {
    setTickets((prev) =>
      prev.map((t) => (t.id === id ? { ...t, rejected: true } : t))
    );
    setPendingTicket(null);
  }, []);


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
      setTickets((prev) =>
        prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t))
      );
    } catch (err) {
      console.error('Failed to update ticket status on backend:', err);
      // fallback
      updateEmployeeTicketOverride(id, {
        status: newStatus,
        proofRejected: false,
        rejectionReason: null,
      });
      setTickets((prev) =>
        prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t))
      );
    }
  }, [tickets, user]);

  /** Decide what to do when a row is clicked */
  const openTicketFlow = useCallback(
    (t) => {
      // Closed / Resolved → redirect to History
      if (CLOSED_STATUSES.includes(t.status)) {
        navigate('/employee/progress');
        return;
      }
      // If reassignment was denied/failed, show ticket detail modal so they can review disapproval reason and accept
      if (t.deniedReassignment || isReassignmentDenied(t)) {
        if (!t.accepted) {
          setPendingTicket(t);
        } else {
          setDeniedReassignTicket(t);
        }
        return;
      }
      // If pending reassignment, open TicketDetailModal (which hides Request Reassignment button and shows pending banner)
      if (hasPendingReassignment(t)) {
        setPendingTicket(t);
        return;
      }
      // If proof rejected → show TicketInfoModal with proof rejection banner and Update button
      if (t.proofRejected) {
        setInfoTicket(t);
        return;
      }
      // Not yet accepted → show full Accept/Reject modal
      if (!t.accepted) {
        setPendingTicket(t);
        return;
      }
      // Accepted & active → show lightweight info modal with Update button
      setInfoTicket(t);
    },
    [navigate]
  );

  const activeCount = tickets.filter(
    (t) => !t.rejected && !CLOSED_STATUSES.includes(t.status)
  ).length;

  return (
    <div className="flex flex-col gap-6 font-sans text-dark-slate">
      <PageHeader
        title="Incoming Tickets"
        subtitle="Pending tickets awaiting your acceptance."
        actions={
          <div className="flex border border-gray-200 rounded-xl overflow-hidden bg-surface shadow-xs">
            {['all', 'external', 'internal'].map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setTypeFilter(type)}
                className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer ${
                  typeFilter === type
                    ? 'bg-brand-primary text-white'
                    : 'bg-surface hover:bg-page text-muted-slate'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        }
      />

      {loadError && (
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-3 text-sm">
          {loadError}
        </div>
      )}

      {/* Incoming Tabs */}
      <div className="flex border-b border-gray-200 gap-1 sm:gap-2">
        <button
          type="button"
          onClick={() => setIncomingTab('incoming')}
          className={`pb-3 px-3 sm:px-4 text-xs sm:text-sm font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
            incomingTab === 'incoming'
              ? 'border-brand-primary text-brand-primary'
              : 'border-transparent text-muted-slate hover:text-dark-slate hover:border-gray-300'
          }`}
        >
          <span>Pending Acceptance</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
            incomingTab === 'incoming' ? 'bg-brand-primary/10 text-brand-primary' : 'bg-page text-muted-slate'
          }`}>
            {pendingAcceptanceCount}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setIncomingTab('pending_reassignment')}
          className={`pb-3 px-3 sm:px-4 text-xs sm:text-sm font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
            incomingTab === 'pending_reassignment'
              ? 'border-amber-500 text-amber-700'
              : 'border-transparent text-muted-slate hover:text-dark-slate hover:border-gray-300'
          }`}
        >
          <span>Pending Reassignment</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
            incomingTab === 'pending_reassignment' ? 'bg-amber-100 text-amber-800' : 'bg-page text-muted-slate'
          }`}>
            {pendingReassignmentCount}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setIncomingTab('all')}
          className={`pb-3 px-3 sm:px-4 text-xs sm:text-sm font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
            incomingTab === 'all'
              ? 'border-brand-primary text-brand-primary'
              : 'border-transparent text-muted-slate hover:text-dark-slate hover:border-gray-300'
          }`}
        >
          <span>All Incoming</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
            incomingTab === 'all' ? 'bg-brand-primary/10 text-brand-primary' : 'bg-page text-muted-slate'
          }`}>
            {totalIncomingCount}
          </span>
        </button>
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
            {['All Status', 'Open', 'In Progress', 'Pending Reassignment', 'Reassignment Failed', 'Escalated', 'Pending', 'On Hold'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="flex-1 min-w-[130px] rounded-xl border border-gray-200 bg-surface px-3 py-2 text-sm text-dark-slate outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent"
          >
            {[
              'All Category',
              'MRI',
              'CT Scan',
              'Ultrasound',
              'X-Ray',
              'Ventilator',
              'Defibrillator',
            ].map((c) => (
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

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-surface shadow-xs">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[120px]">Ticket ID</TableHead>
              <TableHead className="w-[160px]">Customer</TableHead>
              <TableHead className="w-[110px]">Type</TableHead>
              <TableHead className="min-w-[240px]">Title</TableHead>
              <TableHead className="w-[140px]">Category</TableHead>
              <TableHead className="w-[110px]">Priority</TableHead>
              <TableHead className="w-[160px]">Status</TableHead>
              <TableHead className="w-[140px]">Last Update</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <DataTableSkeleton columns={8} rows={4} />
            ) : filtered.length === 0 ? (
              <DataTableEmptyState
                colSpan={8}
                icon={Inbox}
                title="No incoming tickets"
                description="No incoming tickets pending acceptance match your current filters."
              />
            ) : (
              filtered.map((t) => (
                <TableRow
                  key={t.id}
                  className="cursor-pointer hover:bg-page"
                  onClick={() => openTicketFlow(t)}
                >
                  <TableCell className="font-semibold text-brand-primary whitespace-nowrap">
                    {t.id}
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate text-dark-slate font-medium">
                    {t.customer}
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex whitespace-nowrap px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      (t.title?.startsWith('[Internal]') || t.is_internal || t.ticket_type === 'Internal' || t.type === 'Internal')
                        ? 'bg-purple-100 text-purple-700'
                        : 'bg-blue-100 text-blue-700'
                    }`}>
                      {(t.title?.startsWith('[Internal]') || t.is_internal || t.ticket_type === 'Internal' || t.type === 'Internal') ? 'Internal' : 'External'}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[260px]">
                    <p className="font-medium text-dark-slate text-sm line-clamp-2 leading-snug">{t.title}</p>
                    {t.proofRejected && (
                      <p className="text-xs text-rose-600 font-medium truncate mt-0.5" title={`Proof rejected: ${t.rejectionReason || 'No reason provided'}`}>
                        Rejection reason: &quot;{t.rejectionReason || 'Proof rejected by CS'}&quot;
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-slate text-sm truncate">{t.category}</TableCell>
                  <TableCell>
                    <span className="text-xs font-semibold text-muted-slate">{t.priority}</span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {isReassignmentDenied(t) ? (
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 shadow-2xs">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                          Reassignment Failed
                        </span>
                      ) : hasPendingReassignment(t) ? (
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                          Pending Reassignment
                        </span>
                      ) : t.proofRejected ? (
                        <div className="flex flex-col gap-1 items-start">
                          <Badge variant={getStatusBadgeVariant(t.status)} dot>
                            {t.status}
                          </Badge>
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 shadow-2xs">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                            Proof Rejected
                          </span>
                        </div>
                      ) : (
                        <Badge variant={getStatusBadgeVariant(t.status)} dot>
                          {t.status}
                        </Badge>
                      )}
                      {(() => {
                        const rawSla = t.sla_status || t.slaStatus || (t.sla_breached ? 'Breached' : null);
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
                      {(t.last_reminder_sent_at || t.lastReminderSentAt) && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200" title={`Reminder sent by CS: ${formatDisplayDate(t.last_reminder_sent_at || t.lastReminderSentAt)}`}>
                          <Bell className="h-2.5 w-2.5 text-indigo-600 shrink-0" />
                          <span>Reminder</span>
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-slate text-xs whitespace-nowrap">
                    {formatDisplayDate(t.lastUpdate)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Modal: Not-yet-accepted ticket (Accept / Request Reassignment) */}
      {pendingTicket && (
        <TicketDetailModal
          ticket={pendingTicket}
          onClose={() => setPendingTicket(null)}
          onStatusChange={handleStatusChange}
          onAccept={handleAcceptAssignment}
          onRequestReassign={(t) => {
            setPendingTicket(null);
            setReassignTicket(t);
          }}
          isAccepting={isAccepting}
        />
      )}

      {/* Modal: Accepted active ticket — lightweight info + Update button */}
      {infoTicket && (
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

      {/* Modal: Denied reassignment — skip accept, show update modal directly */}
      {deniedReassignTicket && (
        <TicketInfoModal
          ticket={deniedReassignTicket}
          onClose={() => setDeniedReassignTicket(null)}
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

      {/* Modal: Reassignment request */}
      {reassignTicket && (
        <ReassignmentModal
          ticket={reassignTicket}
          onClose={() => setReassignTicket(null)}
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
            setIncomingTab('pending_reassignment');
            setReassignTicket(null);
            loadTickets({ forceRefresh: true });
          }}
        />
      )}
    </div>
  );
}
