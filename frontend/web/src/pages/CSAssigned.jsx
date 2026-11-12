import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search, Loader2, Filter, RotateCcw, X, AlertTriangle, Clock, CheckCircle2, PauseCircle, HelpCircle, ArrowUpDown, Bell } from 'lucide-react';
import Pagination from '@/components/Pagination';
import { useAuth } from '@/context/AuthContext';
import useRealtimeRefresh from '@/hooks/useRealtimeRefresh';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';
import {
  getCSQueuePage,
  getAssignableEmployees,
  getDepartments,
  acceptTicket,
  getTicketFormOptions,
  getCSFilterOptions,
  getTicketDetails,
  updateTicket,
  respondReassignment,
} from '@/services/ticketService';
import { TicketSummary, AssignModal } from '@/components/CSModals';
import SlaStatusBadge from '@/components/sla/SlaStatusBadge';
import { formatDisplayDate, parseUTCDate } from '@/utils/dateUtils';
import { PageHeader } from '@/components/ui/page-header';
import { OriginPillToggle } from '@/components/ui/OriginPillToggle';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { DataTableSkeleton, DataTableEmptyState } from '@/components/ui/data-table';

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

  const dateValue = t.date || t.created_at || t.submitted_at || t.updated_at || '';
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

const renderSlaBadge = (ticket) => <SlaStatusBadge ticket={ticket} showDueDate={false} />;

export default function CSAssigned() {
  const { user } = useAuth();
  const location = useLocation();
  const [tickets, setTickets] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [priorityOptions, setPriorityOptions] = useState(['Low','Medium','High','Critical']);
  const [loading, setLoading] = useState(true);
  const [modalLoading, setModalLoading] = useState(false);
  useLockBodyScroll(modalLoading);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [slaFilter, setSlaFilter] = useState('All SLA Statuses');
  const [category, setCategory] = useState('All Categories');
  const [machineFilter, setMachineFilter] = useState('All Machines');
  const [departmentFilter, setDepartmentFilter] = useState('All Departments');
  const [sortBy, setSortBy] = useState('updated_at'); // 'updated_at' | 'sla_due_date' | 'sla_status'
  const [sortDir, setSortDir] = useState('desc'); // 'asc' | 'desc'
  const [slaSummary, setSlaSummary] = useState({
    total: 0,
    breached: 0,
    at_risk: 0,
    on_track: 0,
    paused: 0,
    compliant: 0,
  });
  const [csFilterOptions, setCsFilterOptions] = useState({
    departments: [],
    statuses: [],
    machines: [],
    categories: [],
  });
  const [showFilters, setShowFilters] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const [assignedTab, setAssignedTab] = useState('all'); // 'all' | 'in_progress' | 'pending_evaluation' | 'on_hold' | 'reassigned' | 'resolved_closed'

  // Spec 0037: the server applies the tab, filters, SLA filter, sort, and pagination,
  // and counts the tab badges and SLA cards, so the cards match the rows on every page.
  const ITEMS_PER_PAGE = 10;
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [lastPage, setLastPage] = useState(1);
  const [tabCounts, setTabCounts] = useState(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const requestSeqRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const queueQuery = useMemo(() => ({
    scope: 'assigned',
    page,
    limit: ITEMS_PER_PAGE,
    tab: assignedTab,
    search: debouncedSearch,
    category: category !== 'All Categories' ? category : undefined,
    machine: machineFilter !== 'All Machines' ? machineFilter : undefined,
    department: departmentFilter !== 'All Departments' ? departmentFilter : undefined,
    type: typeFilter,
    sla: slaFilter !== 'All SLA Statuses' ? slaFilter : undefined,
    sortBy: sortBy !== 'updated_at' ? sortBy : undefined,
    sortDir: sortBy !== 'updated_at' ? sortDir : undefined,
  }), [page, assignedTab, debouncedSearch, category, machineFilter, departmentFilter, typeFilter, slaFilter, sortBy, sortDir]);

  const queueQueryRef = useRef(queueQuery);
  queueQueryRef.current = queueQuery;

  // modal state: null | { mode: 'assign'|'summary', ticket }
  const [modal, setModal] = useState(null);

  const resetFilters = useCallback(() => {
    setSearch('');
    setSlaFilter('All SLA Statuses');
    setCategory('All Categories');
    setMachineFilter('All Machines');
    setDepartmentFilter('All Departments');
    setTypeFilter('all');
    setSortBy('updated_at');
    setSortDir('desc');
  }, []);

  const clearFilter = useCallback((key) => {
    switch (key) {
      case 'search':
        setSearch('');
        break;
      case 'sla':
        setSlaFilter('All SLA Statuses');
        break;
      case 'machine':
        setMachineFilter('All Machines');
        break;
      case 'department':
        setDepartmentFilter('All Departments');
        break;
      case 'status':
        setStatusFilter('All Statuses');
        break;
      case 'category':
        setCategory('All Categories');
        break;
      case 'type':
        setTypeFilter('all');
        break;
      default:
        break;
    }
  }, []);

  const loadStaticData = useCallback(async () => {
    try {
      const [depsResult, optionsResult, csOptsResult] = await Promise.allSettled([
        getDepartments(),
        getTicketFormOptions(),
        getCSFilterOptions(),
      ]);
      if (depsResult.status === 'fulfilled') {
        setDepartments((depsResult.value?.departments || depsResult.value || []).map((d) => d.name || d));
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
        });
      }
    } catch (e) {
      console.warn('Failed to load static options:', e);
    }
  }, []);

  const loadLiveData = useCallback(async ({ forceRefresh = false, source = 'manual' } = {}) => {
    if (source !== 'websocket' && source !== 'poll') {
      setLoading(true);
    }
    setError('');
    const seq = ++requestSeqRef.current;
    try {
      const [queue, assignees] = await Promise.all([
        getCSQueuePage(queueQueryRef.current),
        getAssignableEmployees({ forceRefresh }),
      ]);

      // A newer request (for example the user changed a filter) owns the screen now.
      if (seq !== requestSeqRef.current) {
        return;
      }

      setTickets(queue.tickets);
      setTotalCount(queue.total);
      setLastPage(queue.lastPage);
      setTabCounts(queue.tabCounts);
      setSlaSummary({
        total: queue.slaSummary?.total ?? queue.total,
        breached: queue.slaSummary?.breached ?? 0,
        at_risk: queue.slaSummary?.at_risk ?? 0,
        on_track: queue.slaSummary?.on_track ?? 0,
        paused: queue.slaSummary?.paused ?? 0,
        compliant: queue.slaSummary?.compliant ?? 0,
      });

      setEmployees(
        assignees.map((row) => ({
          id: Number(row.id ?? row.emp_id),
          name: row.name || `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.email || `Employee #${row.id ?? row.emp_id}`,
          role: row.role || '',
          status: row.is_active ? 'active' : 'inactive',
          presence: row.presence || (row.is_active ? 'online' : 'offline'),
          department: row.department || 'Unassigned',
          position_level: (row.position_level && !['senior', 'mid', 'junior'].includes(String(row.position_level).toLowerCase()))
            ? row.position_level
            : (row.role?.toLowerCase().includes('manager') ? 'Manager' : ((row.department || '').toLowerCase() === 'service' ? 'Engineer' : 'Employee')),
          technical_role: row.technical_role || row.role || '',
        }))
      );
    } catch {
      if (seq === requestSeqRef.current) {
        setError('Unable to load assigned tickets from ticket-service.');
      }
    } finally {
      if (source !== 'websocket' && source !== 'poll' && seq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.removeItem('demo_pending_evaluation_tickets');
    } catch {
      // ignore
    }
    loadStaticData();
  }, [loadStaticData]);

  useEffect(() => {
    loadLiveData({ forceRefresh: true });
  }, [queueQuery, loadLiveData]);

  useEffect(() => {
    const focusId = location.state?.focusTicketId;
    if (focusId && tickets.length > 0) {
      const match = tickets.find(t => t.id === focusId || t.ticket_ID === focusId);
      if (match) {
        handleRowAction(match);
        window.history.replaceState({}, document.title);
      } else {
        // The list is paged on the server, so the ticket may be on another page.
        const numericId = Number(String(focusId).replace(/\D/g, ''));
        window.history.replaceState({}, document.title);
        if (numericId) {
          getTicketDetails(numericId)
            .then((details) => {
              if (details) handleRowAction({ ...details, ticket_ID: details.ticket_ID ?? numericId });
            })
            .catch(() => {});
        }
      }
    }
  }, [location.state, tickets]);

  useRealtimeRefresh({
    refresh: (context) => {
      loadLiveData({ ...context, forceRefresh: true });
    },
    channels: [
      { name: 'ticket-updates', event: 'ticket.changed' },
      { name: 'employee-status', event: 'employee.status.changed' },
    ],
    intervalMs: 30000,
    deferRefresh: false,
  });

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
    const defaultStatuses = ['In Progress', 'Pending Evaluation', 'On Hold', 'Pending Assignment', 'Reopened'];
    const fromBackend = (csFilterOptions.statuses || [])
      .map((s) => s.status_name || s.name || s)
      .filter((s) => !['resolved', 'closed', 'discarded', 'discarded by customer'].includes(String(s).trim().toLowerCase()));
    return ['All Statuses', ...Array.from(new Set([...defaultStatuses, ...fromBackend]))];
  }, [csFilterOptions.statuses]);

  const departmentOptions = useMemo(() => {
    const fromDeps = departments.map((d) => d.name || d);
    const fromTickets = tickets.map((t) => t.department).filter(Boolean);
    return ['All Departments', ...Array.from(new Set([...fromDeps, ...fromTickets])).sort()];
  }, [departments, tickets]);

  const slaOptions = ['All SLA Statuses', 'Breached', 'At Risk', 'On Track', 'Paused', 'No SLA Configured', 'SLA Unavailable'];

  const hasActiveFilters = Boolean(
    search.trim() ||
    slaFilter !== 'All SLA Statuses' ||
    machineFilter !== 'All Machines' ||
    departmentFilter !== 'All Departments' ||
    category !== 'All Categories' ||
    typeFilter !== 'all' ||
    sortBy !== 'updated_at' ||
    sortDir !== 'desc'
  );

  const counts = {
    all: tabCounts?.all ?? 0,
    inProgress: tabCounts?.inProgress ?? 0,
    pendingEval: tabCounts?.pendingEval ?? 0,
    reassigned: tabCounts?.reassigned ?? 0,
    onHold: tabCounts?.onHold ?? 0,
    resolvedClosed: tabCounts?.resolvedClosed ?? 0,
  };

  const EXCLUDED_STATUSES = useMemo(() => ['resolved', 'closed', 'discarded', 'discarded by customer'], []);

  // Filter out resolved, closed, and discarded tickets - they only belong on the Ticket History page
  const filtered = useMemo(() => {
    return (tickets || []).filter((t) => !EXCLUDED_STATUSES.includes(String(t.status || '').trim().toLowerCase()));
  }, [tickets, EXCLUDED_STATUSES]);

  const totalPages = lastPage;

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [totalPages, page]);

  const paginated = filtered;

  const handleRowAction = (t) => {
    const isMock = !!t.isMock;
    if (isMock) {
      setModal({ mode: 'summary', ticket: t });
      return;
    }

    const isSummary = t.reassignmentRequested || t.status === 'Pending Assignment' || t.status === 'Pending Evaluation' || t.status === 'Resolved' || t.status === 'In Progress' || t.status === 'Pending' || t.status === 'Closed' || t.status === 'Reopened' || t.status === 'On Hold';
    if (isSummary) {
      // Instantly open the modal with existing ticket data from list so user never experiences latency
      setModal({ mode: 'summary', ticket: t, isLoadingDetails: true });
      const ticketId = t.ticket_ID || Number(String(t.id).replace(/\D/g, ''));
      getTicketDetails(ticketId)
        .then((details) => {
          setModal((prev) => {
            if (!prev || prev.mode !== 'summary') return prev;
            const currentId = prev.ticket?.ticket_ID || Number(String(prev.ticket?.id).replace(/\D/g, ''));
            if (currentId !== ticketId) return prev;
            return {
              ...prev,
              ticket: { ...prev.ticket, ...details },
              isLoadingDetails: false,
            };
          });
        })
        .catch((err) => {
          console.warn('Failed to load full ticket details, fallback to list item:', err);
          setModal((prev) => (prev ? { ...prev, isLoadingDetails: false } : null));
        });
    } else {
      setModal({ mode: 'assign', ticket: t });
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
      const refreshed = { ...updated, status: 'Pending Assignment', reassignmentRequested: false };
      setTickets((prev) => prev.map((t) => ((t.ticket_ID === updated.ticket_ID || t.id === updated.id) ? refreshed : t)));
      setAssignedTab('all');
      setPage(1);
      setModal(null);
      window.alert('Ticket assigned successfully.');
      return true;
    }

    try {
      await acceptTicket({
        ticketId: updated.ticket_ID || updated.id.replace(/\D/g, ''),
        employeeIds: updated.assigned,
        assignedByEmail: user?.email,
        priorityId: priorityMap[updated.priority] ?? 1,
      });

      window.dispatchEvent(new Event('notifications:updated'));

      // Redirect to "All Assigned" tab and close modal
      setAssignedTab('all');
      setPage(1);
      setModal(null);

      // Reconcile with the server (the tab and page change above also trigger a reload).
      loadLiveData({ forceRefresh: true, source: 'poll' });
      return true;
    } catch (err) {
      setError('Failed to assign ticket. Please try again.');
      console.error(err);
      return false;
    }
  };

  return (
    <div className="space-y-6 w-full min-w-0 max-w-full">
      <PageHeader
        title="Assigned Tickets"
        subtitle="Manage and track ongoing assigned support tickets"
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

      {/* Assigned Tabs placed at top */}
      <div className="flex border-b border-border gap-2 overflow-x-auto shrink-0">
        <button
          type="button"
          onClick={() => { setAssignedTab('all'); setPage(1); }}
          className={`pb-3 px-4 text-sm font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-2 shrink-0 ${
            assignedTab === 'all'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
          }`}
        >
          <span>All Assigned</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
            assignedTab === 'all' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
          }`}>
            {counts.all}
          </span>
        </button>
        <button
          type="button"
          onClick={() => { setAssignedTab('in_progress'); setPage(1); }}
          className={`pb-3 px-4 text-sm font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-2 shrink-0 ${
            assignedTab === 'in_progress'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
          }`}
        >
          <span>In Progress</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
            assignedTab === 'in_progress' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
          }`}>
            {counts.inProgress}
          </span>
        </button>
        <button
          type="button"
          onClick={() => { setAssignedTab('pending_evaluation'); setPage(1); }}
          className={`pb-3 px-4 text-sm font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-2 shrink-0 ${
            assignedTab === 'pending_evaluation'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
          }`}
        >
          <span>Pending Evaluation</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
            assignedTab === 'pending_evaluation' ? 'bg-accent/15 text-accent' : 'bg-muted text-muted-foreground'
          }`}>
            {counts.pendingEval}
          </span>
        </button>
        <button
          type="button"
          onClick={() => { setAssignedTab('reassigned'); setPage(1); }}
          className={`pb-3 px-4 text-sm font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-2 shrink-0 ${
            assignedTab === 'reassigned'
              ? 'border-warning text-warning'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
          }`}
        >
          <span>Reassigned Tickets</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
            assignedTab === 'reassigned' ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground'
          }`}>
            {counts.reassigned}
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
            placeholder="Search tickets, customers, departments..."
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
            value={departmentFilter}
            onChange={(e) => { setDepartmentFilter(e.target.value); setPage(1); }}
            className="h-10 flex-1 min-w-[140px] rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
            title="Filter by department"
          >
            {departmentOptions.map((d) => (
              <option key={d} value={d}>{d}</option>
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

          {/* Sort Control */}
          <select
            value={`${sortBy}:${sortDir}`}
            onChange={(e) => {
              const [sb, sd] = e.target.value.split(':');
              setSortBy(sb);
              setSortDir(sd);
              setPage(1);
            }}
            className="h-10 rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent shrink-0 transition-colors"
            title="Sort tickets queue"
          >
            <option value="updated_at:desc">Sort: Latest Update</option>
            <option value="sla_due_date:asc">Sort: SLA Due Soonest</option>
            <option value="sla_due_date:desc">Sort: SLA Due Latest</option>
            <option value="sla_status:asc">Sort: SLA Status (A-Z)</option>
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
              <TableHead>Title</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[160px]">
                <button
                  type="button"
                  onClick={() => {
                    if (sortBy === 'sla_status') {
                      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
                    } else {
                      setSortBy('sla_status');
                      setSortDir('asc');
                    }
                    setPage(1);
                  }}
                  className="flex items-center gap-1 font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <span>SLA Compliance</span>
                  <ArrowUpDown className="h-3 w-3" />
                </button>
              </TableHead>
              <TableHead className="min-w-[180px]">Assignees</TableHead>
              <TableHead className="w-[150px]">Last Update</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <DataTableSkeleton columns={7} rows={6} />
            ) : filtered.length === 0 ? (
              <DataTableEmptyState
                colSpan={7}
                message="No tickets found in this assigned queue."
              />
            ) : (
              paginated.map((t, idx) => {
                const isReassignmentReq = t.reassignmentRequested;

                return (
                  <TableRow
                    key={t.id}
                    onClick={() => handleRowAction(t)}
                    className={`cursor-pointer hover:bg-muted/50 transition-colors ${
                      isReassignmentReq
                        ? 'bg-warning/5'
                        : idx === 0 && page === 1
                        ? 'bg-muted/20'
                        : ''
                    }`}
                  >
                    <TableCell className="font-semibold text-primary whitespace-nowrap">
                      <div className="flex flex-col gap-1">
                        <span className={isReassignmentReq ? 'text-warning font-bold' : ''}>
                          {t.id}
                        </span>
                        {isReassignmentReq && (
                          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-warning/15 text-warning w-fit">
                            Reassignment Requested
                          </span>
                        )}
                        {(t.last_reminder_sent_at || t.lastReminderSentAt) && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 w-fit flex items-center gap-1" title={`Reminder dispatched: ${formatDisplayDate(t.last_reminder_sent_at || t.lastReminderSentAt)}`}>
                            <Bell className="w-2.5 h-2.5" />
                            Reminder Sent
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium text-foreground max-w-[18rem]">
                      <div className="flex flex-col gap-1">
                        <span className="truncate">{t.title}</span>
                        {t.status === 'Pending Evaluation' && !isReassignmentReq && (
                          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-accent/15 text-accent w-fit">
                            Pending Evaluation
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {t.category}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(isReassignmentReq ? 'Pending Reassignment' : t.status)}>
                        {isReassignmentReq ? 'Pending Reassignment' : (t.status === 'Reopen' ? 'Reopened' : t.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {renderSlaBadge(t)}
                    </TableCell>
                    <TableCell className="max-w-[16rem]">
                      {(() => {
                        const list = Array.isArray(t.assigned_employees) && t.assigned_employees.length > 0
                          ? t.assigned_employees
                          : (t.assigned_employee ? [{ name: t.assigned_employee, assignment_status: t.accepted ? 'accepted' : 'assigned' }] : []);

                        if (list.length === 0) {
                          return <span className="text-xs text-muted-foreground italic font-normal">Unassigned</span>;
                        }

                        const acceptedCount = list.filter((e) => e.assignment_status === 'accepted').length;

                        return (
                          <div className="flex flex-col gap-1">
                            {list.length > 1 && (
                              <span className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">
                                {acceptedCount} of {list.length} Accepted
                              </span>
                            )}
                            <div className="flex flex-wrap gap-1.5">
                              {list.map((emp, i) => {
                                const isAcc = emp.assignment_status === 'accepted';
                                const isReassign = emp.assignment_status === 'reassign_requested';
                                return (
                                  <span
                                    key={emp.id || i}
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${
                                      isAcc
                                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                        : isReassign
                                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                                        : 'bg-slate-50 text-slate-700 border-slate-200'
                                    }`}
                                    title={isAcc ? 'Accepted' : isReassign ? 'Reassignment Requested' : 'Pending Acceptance'}
                                  >
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full ${
                                        isAcc ? 'bg-emerald-500' : isReassign ? 'bg-amber-500' : 'bg-slate-400'
                                      }`}
                                    />
                                    <span className="truncate max-w-[130px]">{emp.name}</span>
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDisplayDate(t.updated_at || t.last_update || t.lastUpdate || t.date || t.created_at)}
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
            setTickets((prev) => prev.map((t) => (
              (t.id === (updatedFields.id || modal.ticket.id) || t.ticket_ID === (updatedFields.ticket_ID || modal.ticket.ticket_ID)) ? { ...t, ...updatedFields } : t
            )));

            // If the status is 'On Hold', resumed, or classification updated,
            // the dedicated endpoint (POST /hold, POST /resume, or PATCH /classification) was already executed directly in TicketSummary.
            if (updatedFields.status === 'On Hold' || updatedFields.hold_reason !== undefined || updatedFields.category || updatedFields.priority) {
              loadLiveData({ forceRefresh: true, source: 'poll' });
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
                setAssignedTab('all');
                setPage(1);
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

              // Close the modal immediately after a generic status/reassignment update
              setModal(null);
            } catch (err) {
              // Spec 0038 AC-32: let the modal show a refused proof approval instead of hiding it.
              if (['PROOF_NOT_VIEWED', 'PROOF_CHECK_UNAVAILABLE'].includes(err?.response?.data?.code)) {
                loadLiveData({ forceRefresh: true, source: 'poll' });
                throw err;
              }
              console.error('Failed to update ticket status on backend:', err);
            }

            // Reload the current page so tabs, counts, and SLA cards reflect the update.
            loadLiveData({ forceRefresh: true, source: 'poll' });
          }}
        />
      )}

      {modal?.mode === 'assign' && (
        <AssignModal
          ticket={modal.ticket}
          employees={employees}
          departments={departments}
          priorityOptions={priorityOptions}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
