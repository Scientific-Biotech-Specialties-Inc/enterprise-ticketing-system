import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search, RotateCcw, Loader2, AlertTriangle, Clock, CheckCircle2, PauseCircle, ArrowUpDown } from 'lucide-react';
import Pagination from '@/components/Pagination';
import { TicketSummary, AssignModal } from '@/components/CSModals';
import AssigneeChips, { assigneeListFor } from '@/components/AssigneeChips';
import { ticketNeedsClassification, CLASSIFY_BEFORE_ASSIGN } from '@/components/ClassifyTicketPanel';
import SlaStatusBadge, { getTicketSlaStatus, getTicketSlaDueDate } from '@/components/sla/SlaStatusBadge';
import { formatDisplayDate, parseUTCDate } from '@/utils/dateUtils';
import { useAuth } from '@/context/AuthContext';
import useRealtimeRefresh from '@/hooks/useRealtimeRefresh';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';
import { PageHeader } from '@/components/ui/page-header';
import { OriginPillToggle } from '@/components/ui/OriginPillToggle';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { DataTableSkeleton, DataTableEmptyState } from '@/components/ui/data-table';
import { ticketBroadcast } from '@/services/ticketBroadcast';
import {
  getCSQueuePage,
  getAssignableEmployees,
  getDepartments,
  acceptTicket,
  getTicketFormOptions,
  prefetchTicketFormOptions,
  respondReassignment,
  getTicketDetails,
  updateTicket,
  getCSFilterOptions,
  closeTicket,
  CS_TICKET_REFRESH_EVENT,
} from '@/services/ticketService';

const normalizeDepartmentName = (value = '') => value.trim().toLowerCase().replace(/\s+/g, ' ');

const buildIncomingSignature = (list = []) => list
  .map((ticket) => [
    ticket.id ?? ticket.ticket_ID,
    ticket.status,
    ticket.updated_at ?? ticket.last_update ?? ticket.created_at ?? '',
    ticket.reassignmentRequested ? '1' : '0',
  ].join(':'))
  .join('|');

const buildEmployeeSignature = (list = []) => list
  .map((employee) => [
    employee.id,
    employee.status,
    employee.department,
    employee.last_seen_at ?? '',
  ].join(':'))
  .join('|');

const getDisplayStatus = (ticket) => ticket.status;

const buildTicketSearchString = (t) => {
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
  const displayStatus = String(
    getDisplayStatus(t) === 'Reopen' ? 'Reopened' : (getDisplayStatus(t) || '')
  );
  const reassignmentBadge = t.reassignmentRequested ? 'pending reassignment' : '';
  const statusStr = `${rawStatus} ${displayStatus} ${reassignmentBadge}`;
  const dept = String(t.department || '');
  const equip = String(t.equipment || t.machine_name || '');
  const facility = String(t.facility || '');

  const dateValue = t.date || t.created_at || t.submitted_at || '';
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
    statusStr,
    dept,
    equip,
    facility,
    rawDate,
    formattedDate,
    extraDates,
  ]
    .join(' ')
    .toLowerCase();
};

/* Modals are imported from @/components/CSModals */

/* ─────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────── */
export default function CSIncoming() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [tickets, setTickets] = useState([]);
  const [closeNotice, setCloseNotice] = useState('');
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [priorityOptions, setPriorityOptions] = useState(['Low','Medium','High','Critical']);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [customerFilter, setCustomerFilter] = useState('All Customers');
  const [category, setCategory] = useState('All Categories');
  const [slaFilter, setSlaFilter] = useState('All SLA Statuses');
  const [sortOrder, setSortOrder] = useState('default');
  const [machineFilter, setMachineFilter] = useState('All Machines');
  const [departmentFilter, setDepartmentFilter] = useState('All Departments');
  const [assignmentFilter, setAssignmentFilter] = useState('All');
  const [csFilterOptions, setCsFilterOptions] = useState({
    departments: [],
    statuses: [],
    machines: [],
    categories: [],
    customers: [],
  });
  const [incomingTab, setIncomingTab] = useState('open'); // 'open' | 'pending_assignment' | 'all'
  const [newTicketId, setNewTicketId] = useState(null);
  const newTicketTimerRef = useRef(null);
  const [typeFilter, setTypeFilter] = useState('all');

  // Spec 0037: the server applies the tab, filters, SLA filter, sort, and pagination,
  // and counts the tab badges and SLA cards, so the cards match the rows on every page.
  const ITEMS_PER_PAGE = 10;
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [lastPage, setLastPage] = useState(1);
  const [serverSlaSummary, setServerSlaSummary] = useState(null);
  const [tabCounts, setTabCounts] = useState(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const requestSeqRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Handle incoming URL SLA query parameter (e.g. from Dashboard SLA Breached card click)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const slaParam = params.get('sla');
    if (slaParam) {
      if (['Breached', 'At Risk', 'On Track', 'Paused', 'No SLA'].includes(slaParam)) {
        setSlaFilter(slaParam);
      }
    }
  }, [location.search]);

  // modal state: null | { mode: 'assign'|'summary', ticket }
  const [modal, setModal] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  useLockBodyScroll(modalLoading);

  const resetFilters = useCallback(() => {
    setSearch('');
    setCustomerFilter('All Customers');
    setCategory('All Categories');
    setSlaFilter('All SLA Statuses');
    setSortOrder('default');
    setMachineFilter('All Machines');
    setDepartmentFilter('All Departments');
    setAssignmentFilter('All');
    setTypeFilter('all');
    setPage(1);
  }, []);

  const clearFilter = useCallback((key) => {
    switch (key) {
      case 'search':
        setSearch('');
        break;
      case 'customer':
        setCustomerFilter('All Customers');
        break;
      case 'machine':
        setMachineFilter('All Machines');
        break;
      case 'department':
        setDepartmentFilter('All Departments');
        break;
      case 'category':
        setCategory('All Categories');
        break;
      case 'assignment':
        setAssignmentFilter('All');
        break;
      case 'type':
        setTypeFilter('all');
        break;
      default:
        break;
    }
    setPage(1);
  }, []);

  const loadStaticData = useCallback(async () => {
    const [depsResult, optionsResult, csOptsResult] = await Promise.allSettled([
      getDepartments(),
      prefetchTicketFormOptions(),
      getCSFilterOptions(),
    ]);

    if (depsResult.status === 'fulfilled') {
      setDepartments((depsResult.value || []).map((d) => d.name));
    }

    if (optionsResult.status === 'fulfilled') {
      setPriorityOptions((optionsResult.value?.ticket_priorities || []).map((p) => p.priority_name));
    }

    if (csOptsResult.status === 'fulfilled' && csOptsResult.value) {
      setCsFilterOptions({
        departments: csOptsResult.value.departments || [],
        statuses: csOptsResult.value.statuses || [],
        machines: csOptsResult.value.machines || [],
        categories: csOptsResult.value.categories || [],
        customers: csOptsResult.value.customers || [],
      });
      if (csOptsResult.value.departments?.length > 0) {
        setDepartments(csOptsResult.value.departments.map((d) => d.name || d.department_name || d));
      }
    }
  }, []);

  const sortParams = (order) => {
    if (order === 'sla_urgent') return { sortBy: 'sla_urgent' };
    if (order === 'sla_due_asc') return { sortBy: 'sla_due_date', sortDir: 'asc' };
    if (order === 'sla_due_desc') return { sortBy: 'sla_due_date', sortDir: 'desc' };
    return {};
  };

  const queueQuery = useMemo(() => ({
    scope: 'incoming',
    page,
    limit: ITEMS_PER_PAGE,
    tab: incomingTab,
    search: debouncedSearch,
    category: category !== 'All Categories' ? category : undefined,
    customerName: customerFilter !== 'All Customers' ? customerFilter : undefined,
    machine: machineFilter !== 'All Machines' ? machineFilter : undefined,
    department: departmentFilter !== 'All Departments' ? departmentFilter : undefined,
    type: typeFilter,
    sla: slaFilter !== 'All SLA Statuses' && slaFilter !== 'All SLA' ? slaFilter : undefined,
    assignment: assignmentFilter !== 'All' ? assignmentFilter : undefined,
    ...sortParams(sortOrder),
  }), [page, incomingTab, debouncedSearch, category, customerFilter, machineFilter, departmentFilter, typeFilter, slaFilter, assignmentFilter, sortOrder]);

  const queueQueryRef = useRef(queueQuery);
  queueQueryRef.current = queueQuery;

  const loadLiveData = useCallback(async ({ forceRefresh = false, source = 'manual' } = {}) => {
    if (source !== 'websocket' && source !== 'poll') {
      setLoading(true);
    }
    setError('');

    const seq = ++requestSeqRef.current;
    const [incomingResult, assigneesResult] = await Promise.allSettled([
      getCSQueuePage(queueQueryRef.current),
      getAssignableEmployees({ forceRefresh }),
    ]);

    // A newer request (for example the user changed a filter) owns the screen now.
    if (seq !== requestSeqRef.current) {
      return;
    }

    if (incomingResult.status === 'fulfilled') {
      const result = incomingResult.value;
      setTickets(result.tickets);
      setTotalCount(result.total);
      setLastPage(result.lastPage);
      setServerSlaSummary(result.slaSummary);
      setTabCounts(result.tabCounts);
    }

    if (assigneesResult.status === 'fulfilled') {
      setEmployees(
        assigneesResult.value.map((row) => ({
          id: Number(row.id ?? row.emp_id),
          name: row.name || `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.email,
          status: row.is_active ? 'active' : 'inactive',
          presence: row.presence || (row.is_active ? 'online' : 'offline'),
          department: row.department?.trim() || 'Unassigned',
          branch: row.branch || row.branch_name || 'Main',
          position_level: (row.position_level && !['senior', 'mid', 'junior'].includes(String(row.position_level).toLowerCase()))
            ? row.position_level
            : (row.role?.toLowerCase().includes('manager') ? 'Manager' : ((row.department || '').toLowerCase() === 'service' ? 'Engineer' : 'Employee')),
          technical_role: row.technical_role || row.role || 'Service Technician',
          availability: row.availability || (row.is_active || row.status === 'active' ? 'Available' : 'Unavailable'),
        }))
      );
    }

    if (incomingResult.status === 'rejected') {
      setError('Unable to load incoming tickets from ticket-service.');
    }

    if (source !== 'websocket' && source !== 'poll') {
      setLoading(false);
    }
  }, []);

  const handleRealtimeUpdate = useCallback((context) => {
    if (context && context.source === 'websocket') {
      const payload = context.payload;
      if (!payload) return;

      // Check if it's an employee status update
      if (payload.email && payload.role) {
        const updatedEmp = payload;
        setEmployees((prev) =>
          prev.map((e) =>
            e.id === Number(updatedEmp.id)
              ? {
                  ...e,
                  status: updatedEmp.is_active ? 'active' : 'inactive',
                  department: updatedEmp.department?.trim() || 'Unassigned',
                }
              : e
          )
        );
        return;
      }

      // Check if it's a ticket event
      if (payload.action) {
        const { action, ticket } = payload;
        if (!ticket) return;

        if (action === 'created') {
          // The server decides whether the new ticket belongs on this page and filter.
          loadLiveData({ forceRefresh: true, source: 'websocket' });

          // Set highlight timer
          if (newTicketTimerRef.current) {
            clearTimeout(newTicketTimerRef.current);
          }
          setNewTicketId(ticket.id);
          newTicketTimerRef.current = setTimeout(() => {
            setNewTicketId(null);
          }, 5000);
        } else if (
          action === 'assigned' ||
          action === 'accepted' ||
          action === 'updated' ||
          action === 'reassign_requested' ||
          action === 'reassigned_response'
        ) {
          // Refetch so the ticket moves between tabs, counts, and SLA cards correctly.
          loadLiveData({ forceRefresh: true, source: 'websocket' });
        }
      }
    } else {
      // Background poll: refresh silently. Without the source, loadLiveData shows the full skeleton every 30s.
      loadLiveData({ forceRefresh: true, source: context?.source || 'poll' });
    }
  }, [loadLiveData]);

  useEffect(() => {
    loadStaticData();
  }, [loadStaticData]);

  useEffect(() => {
    loadLiveData({ forceRefresh: true });
  }, [queueQuery, loadLiveData]);

  useEffect(() => {
    // assignTicketId (from a notification's Assign button) opens the assignment modal directly.
    const assignId = location.state?.assignTicketId;
    const focusId = location.state?.focusTicketId;
    const targetId = assignId ?? focusId;
    if (targetId && tickets.length > 0) {
      const numericTarget = Number(String(targetId).replace(/\D/g, ''));
      const match = tickets.find(t =>
        t.id === targetId || t.ticket_ID === targetId ||
        (numericTarget && Number(t.ticket_ID) === numericTarget)
      );
      if (match) {
        setModal({ mode: assignId ? 'assign' : 'summary', ticket: match });
        window.history.replaceState({}, document.title);
      } else if (numericTarget) {
        // The list is paged on the server, so the ticket may be on another page.
        window.history.replaceState({}, document.title);
        getTicketDetails(numericTarget)
          .then((details) => {
            if (details) setModal({ mode: assignId ? 'assign' : 'summary', ticket: { ...details, ticket_ID: details.ticket_ID ?? numericTarget } });
          })
          .catch(() => {});
      }
    }
  }, [location.state, tickets]);

  useEffect(() => {
    const handleRefreshEvent = () => {
      loadLiveData({ forceRefresh: true, source: 'poll' });
    };
    window.addEventListener(CS_TICKET_REFRESH_EVENT, handleRefreshEvent);
    return () => {
      window.removeEventListener(CS_TICKET_REFRESH_EVENT, handleRefreshEvent);
    };
  }, [loadLiveData]);

  useRealtimeRefresh({
    refresh: handleRealtimeUpdate,
    channels: [
      { name: 'ticket-updates', event: 'ticket.changed' },
      { name: 'employee-status', event: 'employee.status.changed' },
    ],
    intervalMs: 30000,
    deferRefresh: false,
  });

  const customers = useMemo(() => {
    const fromTickets = tickets.map((t) => t.customer || t.requestor || t.created_by_name).filter(Boolean);
    const list = Array.from(new Set([...(csFilterOptions.customers || []), ...fromTickets]));
    return ['All Customers', ...list.sort()];
  }, [tickets, csFilterOptions.customers]);

  const categories = useMemo(
    () => ['All Categories', ...Array.from(new Set([...(csFilterOptions.categories || []), ...tickets.map((t) => t.category).filter(Boolean)]))],
    [tickets, csFilterOptions.categories]
  );

  const machines = useMemo(() => {
    const fromTickets = tickets.map((t) => t.equipment || t.machine_name).filter(Boolean);
    const fromBackend = (csFilterOptions.machines || []).map((m) => m.machine_name || m.label || m.name || m);
    return ['All Machines', ...Array.from(new Set([...fromTickets, ...fromBackend])).sort()];
  }, [tickets, csFilterOptions.machines]);

  const statuses = useMemo(() => {
    const defaultStatuses = ['Open', 'In Progress', 'Pending Assignment', 'On Hold', 'Pending Evaluation', 'Resolved', 'Closed', 'Reopened'];
    const fromBackend = (csFilterOptions.statuses || []).map((s) => s.status_name || s.name || s);
    return ['All Statuses', ...Array.from(new Set([...defaultStatuses, ...fromBackend]))];
  }, [csFilterOptions.statuses]);

  const departmentOptions = useMemo(() => {
    const fromDeps = departments.map((d) => d.name || d);
    const fromTickets = tickets.map((t) => t.department).filter(Boolean);
    return ['All Departments', ...Array.from(new Set([...fromDeps, ...fromTickets])).sort()];
  }, [departments, tickets]);

  const hasActiveFilters = Boolean(
    search.trim() ||
    customerFilter !== 'All Customers' ||
    machineFilter !== 'All Machines' ||
    departmentFilter !== 'All Departments' ||
    category !== 'All Categories' ||
    assignmentFilter !== 'All' ||
    typeFilter !== 'all' ||
    slaFilter !== 'All SLA Statuses' ||
    sortOrder !== 'default'
  );

  const slaOptions = ['All SLA Statuses', 'Breached', 'At Risk', 'On Track', 'Paused', 'No SLA'];

  const slaSummary = {
    breached: serverSlaSummary?.breached ?? 0,
    at_risk: serverSlaSummary?.at_risk ?? 0,
    on_track: serverSlaSummary?.on_track ?? 0,
    paused: serverSlaSummary?.paused ?? 0,
  };

  const counts = {
    open: tabCounts?.open ?? 0,
    pending: tabCounts?.pending ?? 0,
    all: tabCounts?.all ?? 0,
  };

  const EXCLUDED_STATUSES = useMemo(
    () => ['in progress', 'resolved', 'closed', 'discarded', 'discarded by customer'],
    []
  );

  // Filter out in progress, resolved, closed, and discarded tickets from the Incoming triage queue
  const filtered = useMemo(() => {
    return (tickets || []).filter((t) => !EXCLUDED_STATUSES.includes(String(t.status || '').trim().toLowerCase()));
  }, [tickets, EXCLUDED_STATUSES]);

  const totalPages = lastPage;

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [totalPages, page]);

  const paginated = filtered;

  const handleRowAction = async (t) => {
    const isSummary = t.status === 'Pending Assignment' || t.status === 'Resolved' || t.status === 'In Progress' || t.status === 'Pending' || t.status === 'Pending Evaluation' || t.status === 'On Hold' || t.status === 'Closed' || t.status === 'Reopened';
    if (isSummary) {
      setModalLoading(true);
      try {
        const ticketId = t.ticket_ID || Number(String(t.id).replace(/\D/g, ''));
        const details = await getTicketDetails(ticketId);
        setModal({ mode: 'summary', ticket: details });
      } catch (err) {
        console.warn('Failed to load full ticket details, fallback to list item:', err);
        setModal({ mode: 'summary', ticket: t });
      } finally {
        setModalLoading(false);
      }
    } else {
      setModalLoading(true);
      try {
        const ticketId = t.ticket_ID || Number(String(t.id).replace(/\D/g, ''));
        const details = await getTicketDetails(ticketId);
        setModal({ mode: 'assign', ticket: { ...t, ...details, description: details.description || t.description, attachments: details.attachments || t.attachments || [], proofAttachments: details.proofAttachments || [] } });
      } catch (err) {
        console.warn('Failed to load full ticket details for assign, fallback to list item:', err);
        setModal({ mode: 'assign', ticket: t });
      } finally {
        setModalLoading(false);
      }
    }
  };

  const handleSave = async (updated) => {
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
      ticketBroadcast.emit('assigned', refreshed);
      setTickets((prev) => prev.map((t) => (t.ticket_ID === updated.ticket_ID || t.id === updated.id ? refreshed : t)));
      setModal(null);
      setIncomingTab('pending_assignment');
      return true;
    }

    setError(null);
    try {
      const targetTicketId = updated.ticket_ID || Number(String(updated.id || '').replace(/\D/g, ''));
      await acceptTicket({
        ticketId: targetTicketId,
        employeeIds: updated.assigned,
        assignedByEmail: user?.email,
        priorityId: priorityMap[updated.priority] ?? 1,
      });

      // Optimistically update tickets immediately so the UI reflects Pending Assignment with zero delay
      const chosenIds = (updated.assigned || []).map(Number);
      const refreshedTicket = {
        ...updated,
        ticket_ID: targetTicketId,
        status: 'Pending Assignment',
        assigned: updated.assigned,
        accepted: false,
        // Spec 0043 (AC-18): show every chosen employee right away, not only the first.
        assigned_employees: chosenIds.map((id) => {
          const emp = employees.find((e) => Number(e.id) === id);
          return { id, name: emp?.name || `Employee #${id}`, department: emp?.department || null, assignment_status: 'assigned' };
        }),
      };

      setTickets((prev) =>
        prev.map((t) => (t.ticket_ID === targetTicketId || t.id === updated.id ? { ...t, ...refreshedTicket } : t))
      );
      ticketBroadcast.emit('assigned', refreshedTicket);
      setModal(null);
      setIncomingTab('pending_assignment');
      setPage(1);

      window.dispatchEvent(new Event('notifications:updated'));

      // Reconcile with the server (the tab and page change above also trigger a reload).
      loadLiveData({ forceRefresh: true, source: 'poll' });
      return true;
    } catch (err) {
      const errMsg = err?.response?.data?.message || 'Failed to assign ticket. Please try again.';
      setError(errMsg);
      console.error(err);
      return false;
    }
  };

  const handleRespondReassignment = async (ticketId, action) => {
    const ticket = tickets.find(t => {
      const tId = t.ticket_ID || Number(String(t.id).replace(/\D/g, ''));
      const targetId = Number(String(ticketId).replace(/\D/g, ''));
      return tId === targetId;
    });
    const isMock = ticket ? !!ticket.isMock : false;
    if (isMock) {
      setTickets((prev) => prev.filter((t) => t.ticket_ID !== ticketId && t.id !== ticketId));
      setModal(null);
      window.alert(`Reassignment request ${action}ed successfully.`);
      return;
    }

    try {
      await respondReassignment({ ticketId, action });
      setModal(null);
      loadLiveData({ forceRefresh: true, source: 'poll' });
      if (action === 'approve') {
        try {
          const numericId = Number(String(ticketId).replace(/\D/g, ''));
          const details = await getTicketDetails(numericId);
          if (details) {
            setModal({ mode: 'assign', ticket: { ...(ticket || {}), ...details, ticket_ID: details.ticket_ID ?? numericId } });
          }
        } catch {
          // The list reload above still shows the ticket in its new state.
        }
      }
    } catch (err) {
      setError(`Failed to respond to reassignment request: ${err.message}`);
    }
  };

  // Close an incoming ticket without assigning it. Errors (e.g. the Transition
  // Matrix does not allow Open -> Closed) are re-thrown so the modal can show them.
  const handleCloseWithoutAssigning = async (ticket) => {
    const ticketId = ticket.ticket_ID || Number(String(ticket.id).replace(/\D/g, ''));
    await closeTicket(ticketId);
    setTickets((prev) => prev.filter((t) => (t.ticket_ID || t.id) !== (ticket.ticket_ID || ticket.id)));
    loadLiveData({ forceRefresh: true, source: 'poll' });
    setModal(null);
    setCloseNotice(`Ticket ${ticket.ticket_number || ticket.id} was closed without assignment.`);
    setTimeout(() => setCloseNotice(''), 5000);
  };

  return (
    <div className="space-y-6 w-full min-w-0 max-w-full">
      {closeNotice && (
        <div role="status" className="rounded-xl border border-success-border bg-success-bg px-4 py-3 text-sm font-medium text-success">
          {closeNotice}
        </div>
      )}
      <PageHeader
        title="Incoming Tickets"
        subtitle="Triage and assign new support tickets"
        actions={
          <OriginPillToggle
            value={typeFilter}
            onChange={(val) => setTypeFilter(val)}
          />
        }
      />

      {error && (
        <div className="rounded-lg bg-destructive/10 text-destructive border border-destructive/20 px-4 py-3 text-sm font-medium">
          {error}
        </div>
      )}

      {/* Tabs placed at top, matching Assign Ticket page standard */}
      <div className="flex border-b border-border gap-2 overflow-x-auto scrollbar-none shrink-0">
        <button
          type="button"
          onClick={() => { setIncomingTab('open'); setPage(1); }}
          className={`pb-3 px-4 text-sm font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-2 shrink-0 ${
            incomingTab === 'open'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
          }`}
        >
          <span>Open / Unassigned</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
            incomingTab === 'open' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
          }`}>
            {counts.open}
          </span>
        </button>
        <button
          type="button"
          onClick={() => { setIncomingTab('pending_assignment'); setPage(1); }}
          className={`pb-3 px-4 text-sm font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-2 shrink-0 ${
            incomingTab === 'pending_assignment'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
          }`}
        >
          <span>Pending Assignment</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
            incomingTab === 'pending_assignment' ? 'bg-accent/15 text-accent' : 'bg-muted text-muted-foreground'
          }`}>
            {counts.pending}
          </span>
        </button>
        <button
          type="button"
          onClick={() => { setIncomingTab('all'); setPage(1); }}
          className={`pb-3 px-4 text-sm font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-2 shrink-0 ${
            incomingTab === 'all'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
          }`}
        >
          <span>All Incoming</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
            incomingTab === 'all' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
          }`}>
            {counts.all}
          </span>
        </button>
      </div>

      {/* Filter toolbar */}
      <div className="w-full space-y-3 shrink-0">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by ID, customer, keyword..."
            className="w-full rounded-lg border border-border bg-card pl-9 pr-4 py-2.5 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2.5 w-full">
          {/* SLA Compliance Status Filter dropdown */}
          <select
            value={slaFilter}
            onChange={(e) => { setSlaFilter(e.target.value); setPage(1); }}
            className={`h-10 flex-1 min-w-[140px] rounded-lg border px-3 text-xs font-semibold outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors ${
              slaFilter === 'Breached'
                ? 'border-rose-300 bg-rose-50 text-rose-700'
                : slaFilter === 'At Risk'
                ? 'border-amber-300 bg-amber-50 text-amber-700'
                : slaFilter === 'On Track'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : slaFilter === 'Paused'
                ? 'border-blue-300 bg-blue-50 text-blue-700'
                : 'border-border bg-card text-foreground'
            }`}
            title="Filter by SLA status"
          >
            {slaOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>

          <select
            value={departmentFilter}
            onChange={(e) => { setDepartmentFilter(e.target.value); setPage(1); }}
            className="h-10 flex-1 min-w-[140px] rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
            title="Filter by department"
          >
            <option value="All Departments">All Departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>

          <select
            value={machineFilter}
            onChange={(e) => { setMachineFilter(e.target.value); setPage(1); }}
            className="h-10 flex-1 min-w-[140px] rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
            title="Filter by machine"
          >
            {machines.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value); setPage(1); }}
            className="h-10 flex-1 min-w-[140px] rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
            title="Filter by category"
          >
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <select
            value={assignmentFilter}
            onChange={(e) => { setAssignmentFilter(e.target.value); setPage(1); }}
            className="h-10 flex-1 min-w-[140px] rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
            title="Filter by assignment status"
          >
            <option value="All">All Assignments</option>
            <option value="Pending Assignment">Pending Assignment</option>
            <option value="Pending Reassign">Pending Reassign</option>
            <option value="Pending Evaluation">Pending Evaluation</option>
          </select>

          {/* Sort Control */}
          <select
            value={sortOrder}
            onChange={(e) => { setSortOrder(e.target.value); setPage(1); }}
            className="h-10 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent shrink-0 transition-colors"
            title="Sort incoming tickets queue"
          >
            <option value="default">Sort: Default</option>
            <option value="sla_urgent">Sort: SLA Urgent First</option>
            <option value="sla_due_asc">Sort: SLA Due Soonest</option>
            <option value="sla_due_desc">Sort: SLA Due Latest</option>
          </select>

          {hasActiveFilters && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={resetFilters}
              className="h-10 gap-1.5 text-xs text-muted-foreground hover:text-destructive shrink-0"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </Button>
          )}
        </div>
      </div>

      {/* Table Card */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-xs w-full min-w-0 max-w-full">
        <Table className="min-w-[960px] w-full">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[140px]">Ticket ID</TableHead>
              <TableHead className="min-w-[200px]">Title</TableHead>
              <TableHead className="w-[100px]">Priority</TableHead>
              <TableHead className="w-[120px]">Category</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead className="w-[160px]">
                <button
                  type="button"
                  onClick={() => {
                    setSortOrder((prev) => (prev === 'sla_due_asc' ? 'sla_due_desc' : prev === 'sla_due_desc' ? 'default' : 'sla_due_asc'));
                    setPage(1);
                  }}
                  className="inline-flex items-center gap-1.5 font-semibold hover:text-foreground transition-colors cursor-pointer"
                  title="Toggle SLA due sort"
                >
                  <span>SLA Compliance</span>
                  <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </TableHead>
              <TableHead className="w-[140px]">Date Submitted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <DataTableSkeleton columns={7} rows={6} />
            ) : filtered.length === 0 ? (
              <DataTableEmptyState
                colSpan={7}
                message="No tickets match your search or filter criteria. Try adjusting your filters or resetting them to view the full queue."
              />
            ) : (
              paginated.map((t, idx) => {
                const isNew = t.id === newTicketId || t.ticket_ID === newTicketId;

                return (
                  <TableRow
                    key={t.id}
                    onClick={() => handleRowAction(t)}
                    className={`cursor-pointer hover:bg-muted/50 transition-colors ${
                      isNew ? 'bg-primary/5' : idx === 0 && page === 1 ? 'bg-muted/20' : ''
                    }`}
                  >
                    <TableCell className="font-semibold text-primary whitespace-nowrap">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5">
                          <span>{t.id}</span>
                          {isNew && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-semibold">
                              New
                            </span>
                          )}
                        </div>
                        {t.reassignmentRequested && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-warning/15 text-warning w-fit">
                            Pending Reassignment
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium text-foreground max-w-[18rem]">
                      <div className="truncate">{t.title}</div>
                      {t.status === 'Pending Assignment' && assigneeListFor(t).length > 0 && (
                        <div className="mt-1 font-normal">
                          <AssigneeChips ticket={t} />
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(t.priority || 'Medium')}>
                        {t.priority || 'Medium'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {ticketNeedsClassification(t) ? (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border border-amber-300 bg-amber-50 text-amber-800"
                          title={CLASSIFY_BEFORE_ASSIGN}
                        >
                          Needs Classification
                        </span>
                      ) : t.category}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(getDisplayStatus(t))}>
                        {getDisplayStatus(t) === 'Reopen' ? 'Reopened' : getDisplayStatus(t)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <SlaStatusBadge ticket={t} showDueDate={false} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDisplayDate(t.date || t.created_at)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {!loading && filtered.length > 0 && (
          <div className="px-4 py-3 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              Showing {(page - 1) * ITEMS_PER_PAGE + 1} -{' '}
              {Math.min(page * ITEMS_PER_PAGE, totalCount)} of {totalCount} tickets
            </div>
            <Pagination
              totalItems={totalCount}
              itemsPerPage={ITEMS_PER_PAGE}
              currentPage={page}
              onPageChange={(p) => setPage(p)}
            />
          </div>
        )}
      </div>

      {/* Modals */}
      {modalLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs">
          <div className="bg-card border border-border rounded-xl p-6 shadow-xl flex flex-col items-center gap-3 max-w-xs w-full mx-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-semibold text-foreground">Loading ticket details...</p>
          </div>
        </div>
      )}
      {!modalLoading && modal?.mode === 'summary' && (
        <TicketSummary
          ticket={modal.ticket}
          employees={employees}
          onClose={() => setModal(null)}
          onEdit={() => setModal({ mode: 'assign', ticket: modal.ticket })}
          onStatusUpdate={async (updatedFields) => {
            setModal((prev) => prev ? { ...prev, ticket: { ...prev.ticket, ...updatedFields } } : null);

            setTickets((prev) => prev.map((t) => (
              (t.id === (updatedFields.id || modal.ticket.id) || t.ticket_ID === (updatedFields.ticket_ID || modal.ticket.ticket_ID)) ? { ...t, ...updatedFields } : t
            )));

            // If the status is 'On Hold' or if classification was updated,
            // the dedicated endpoint (POST /hold or PATCH /classification) was already executed directly in TicketSummary.
            if (updatedFields.status === 'On Hold' || updatedFields.category || updatedFields.priority) {
              return;
            }

            try {
              const numericId = modal.ticket.ticket_ID || Number(String(updatedFields.id || modal.ticket.id).replace(/\D/g, ''));
              
              if (updatedFields.reassignmentStatus) {
                await respondReassignment({
                  ticketId: numericId,
                  action: updatedFields.reassignmentStatus === 'Approved' ? 'approve' : 'deny',
                  reason: updatedFields.reassignmentDenyReason ?? '',
                });
              } else {
                const statusMap = {
                  'Open': 1,
                  'In Progress': 2,
                  'Resolved': 3,
                  'Closed': 4,
                  'Escalated': 5,
                  'Pending Evaluation': 6,
                  'Pending': 7,
                  'Reopened': 8,
                  'Reopen': 8,
                  'Pending Assignment': 9,
                };
                
                await updateTicket({
                  ticketId: numericId,
                  statusId: statusMap[updatedFields.status] ?? 2,
                  assignedByEmail: user?.email,
                  proof_rejected: updatedFields.proofRejected ?? false,
                  rejection_reason: updatedFields.rejectionReason ?? null,
                });
              }
            } catch (err) {
              // Spec 0038 AC-32: let the modal show a refused proof approval instead of hiding it.
              if (['PROOF_NOT_VIEWED', 'PROOF_CHECK_UNAVAILABLE'].includes(err?.response?.data?.code)) {
                throw err;
              }
              console.error('Failed to update ticket status on backend:', err);
            }
          }}
          onRespondReassignment={handleRespondReassignment}
        />
      )}

      {!modalLoading && modal?.mode === 'assign' && (
        <AssignModal
          ticket={modal.ticket}
          employees={employees.filter(e => e.id !== modal.ticket?.requested_by)}
          departments={departments}
          priorityOptions={priorityOptions}
          onClose={() => setModal(null)}
          onSave={handleSave}
          onCloseTicket={handleCloseWithoutAssigning}
          onClassified={(fields) => {
            const targetId = modal.ticket.ticket_ID;
            setTickets((prev) => prev.map((t) => (
              (targetId && t.ticket_ID === targetId) || t.id === modal.ticket.id ? { ...t, ...fields } : t
            )));
          }}
        />
      )}
    </div>
  );
}