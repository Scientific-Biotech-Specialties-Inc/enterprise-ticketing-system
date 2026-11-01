import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search, SlidersHorizontal, Loader2, Filter, RotateCcw, X, AlertTriangle, Clock, CheckCircle2, PauseCircle, HelpCircle, ArrowUpDown, Bell } from 'lucide-react';
import Pagination from '@/components/Pagination';
import { useAuth } from '@/context/AuthContext';
import useRealtimeRefresh from '@/hooks/useRealtimeRefresh';
import {
  getCSIncomingTickets,
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
import { formatProperSentenceCase } from '@/utils/titleCaseUtils';
import { PageHeader } from '@/components/ui/page-header';
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

const renderSlaBadge = (ticket) => <SlaStatusBadge ticket={ticket} />;

export default function CSAssigned() {
  const { user } = useAuth();
  const location = useLocation();
  const [tickets, setTickets] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [priorityOptions, setPriorityOptions] = useState(['Low','Medium','High','Critical']);
  const [loading, setLoading] = useState(true);
  const [modalLoading, setModalLoading] = useState(false);
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
  });
  const [notificationBanner, setNotificationBanner] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const [assignedTab, setAssignedTab] = useState('all'); // 'all' | 'in_progress' | 'pending_evaluation' | 'on_hold' | 'reassigned' | 'resolved_closed'

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
    try {
      const [incoming, assignees] = await Promise.all([
        getCSIncomingTickets({ limit: 100, forceRefresh }),
        getAssignableEmployees({ forceRefresh }),
      ]);

      // Assigned page: show tickets with assigned / in progress / evaluation / resolved / closed / reassigned / on hold
      const assignedTickets = incoming.filter(t =>
        t.reassignmentRequested === true ||
        ['Pending Assignment', 'In Progress', 'Pending Evaluation', 'Resolved', 'Pending', 'Closed', 'On Hold'].includes(t.status) ||
        (t.assigned && t.assigned.length > 0)
      );
      
      setTickets(assignedTickets);

      if (incoming.slaSummary) {
        setSlaSummary(incoming.slaSummary);
        const summary = { total: assignedTickets.length, breached: 0, at_risk: 0, on_track: 0, paused: 0, compliant: 0 };
        assignedTickets.forEach((t) => {
          const s = String(t.sla_status || t.slaStatus || '').toLowerCase().replace(/[\s_-]+/g, '');
          const isBreached = s === 'breached' || s === 'violated' || Boolean(t.is_breached) || Boolean(t.sla_breached) || (t.resolution_due_at && new Date(t.resolution_due_at) < new Date());
          if (['Resolved', 'Closed'].includes(t.status)) {
            summary.compliant++;
          } else if (isBreached) {
            summary.breached++;
          } else if (s === 'atrisk') {
            summary.at_risk++;
          } else if (s === 'paused' || t.status === 'On Hold') {
            summary.paused++;
          } else {
            summary.on_track++;
          }
        });
        setSlaSummary(summary);
      }
      
      setEmployees(
        assignees.map((row) => ({
          id: Number(row.id ?? row.emp_id),
          name: row.name || `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.email || `Employee #${row.id ?? row.emp_id}`,
          role: row.role || '',
          status: row.is_active ? 'active' : 'inactive',
          department: row.department || 'Unassigned',
          position_level: (row.position_level && !['senior', 'mid', 'junior'].includes(String(row.position_level).toLowerCase()))
            ? row.position_level
            : (row.role?.toLowerCase().includes('manager') ? 'Manager' : ((row.department || '').toLowerCase() === 'service' ? 'Engineer' : 'Employee')),
          technical_role: row.technical_role || row.role || '',
        }))
      );
    } catch {
      setError('Unable to load assigned tickets from ticket-service.');
    } finally {
      if (source !== 'websocket' && source !== 'poll') {
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
    loadLiveData({ forceRefresh: true });
  }, [loadStaticData, loadLiveData]);

  useEffect(() => {
    const focusId = location.state?.focusTicketId;
    if (focusId && tickets.length > 0) {
      const match = tickets.find(t => t.id === focusId || t.ticket_ID === focusId);
      if (match) {
        handleRowAction(match);
        window.history.replaceState({}, document.title);
      }
    }
  }, [location.state, tickets]);

  useRealtimeRefresh({
    refresh: (context) => {
      loadLiveData({ ...context, forceRefresh: true });
      if (context && context.source === 'websocket') {
        setNotificationBanner('Ticket list automatically updated via real-time sync');
        setTimeout(() => {
          setNotificationBanner(null);
        }, 4000);
      }
    },
    channels: [
      { name: 'ticket-updates', event: 'ticket.changed' },
      { name: 'employee-status', event: 'employee.status.changed' },
    ],
    intervalMs: 30000,
    deferRefresh: false,
  });

  const categories = useMemo(
    () => ['All Categories', ...Array.from(new Set(tickets.map((t) => t.category).filter(Boolean)))],
    [tickets]
  );

  const machines = useMemo(() => {
    const fromTickets = tickets.map((t) => t.equipment || t.machine_name).filter(Boolean);
    const fromBackend = (csFilterOptions.machines || []).map((m) => m.machine_name || m.label || m.name || m);
    return ['All Machines', ...Array.from(new Set([...fromTickets, ...fromBackend])).sort()];
  }, [tickets, csFilterOptions.machines]);

  const statuses = useMemo(() => {
    const defaultStatuses = ['In Progress', 'Pending Evaluation', 'On Hold', 'Pending Assignment', 'Resolved', 'Closed', 'Reopened'];
    const fromBackend = (csFilterOptions.statuses || []).map((s) => s.status_name || s.name || s);
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

  const counts = useMemo(() => {
    let all = 0;
    let inProgress = 0;
    let pendingEval = 0;
    let reassigned = 0;
    let onHold = 0;
    let resolvedClosed = 0;

    tickets.forEach((t) => {
      all++;
      if (t.reassignmentRequested === true) reassigned++;
      if (t.status === 'In Progress') inProgress++;
      if (t.status === 'Pending Evaluation') pendingEval++;
      if (t.status === 'On Hold') onHold++;
      if (t.status === 'Resolved' || t.status === 'Closed') resolvedClosed++;
    });

    return { all, inProgress, pendingEval, reassigned, onHold, resolvedClosed };
  }, [tickets]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = tickets.filter((t) => {
      if (category !== 'All Categories' && t.category !== category) return false;
      if (machineFilter !== 'All Machines' && (t.equipment || t.machine_name || '') !== machineFilter) return false;
      if (departmentFilter !== 'All Departments' && (t.department || '').trim().toLowerCase() !== departmentFilter.trim().toLowerCase()) return false;

      if (slaFilter !== 'All SLA Statuses') {
        const rawSla = String(t.sla_status || t.slaStatus || t.sla?.resolution?.status || '').toLowerCase().replace(/[\s_-]+/g, '');
        const targetSla = slaFilter.toLowerCase().replace(/[\s_-]+/g, '');
        if (targetSla === 'breached' && rawSla !== 'breached') return false;
        if (targetSla === 'atrisk' && rawSla !== 'atrisk') return false;
        if (targetSla === 'ontrack' && rawSla !== 'ontrack' && rawSla !== 'compliant') return false;
        if (targetSla === 'paused' && rawSla !== 'paused') return false;
        if (targetSla === 'noslaconfigured' && rawSla !== 'noslaconfigured' && rawSla !== 'nosla' && rawSla !== 'na' && rawSla !== '') return false;
        if (targetSla === 'slaunavailable' && rawSla !== 'unavailable' && rawSla !== 'slaunavailable') return false;
      }

      if (typeFilter === 'internal') {
        const isInternal = t.title?.startsWith('[Internal]') || t.is_internal || t.ticket_type === 'Internal' || t.type === 'Internal';
        if (!isInternal) return false;
      } else if (typeFilter === 'external') {
        const isInternal = t.title?.startsWith('[Internal]') || t.is_internal || t.ticket_type === 'Internal' || t.type === 'Internal';
        if (isInternal) return false;
      }

      // Tab filter
      if (assignedTab === 'in_progress' && t.status !== 'In Progress') return false;
      if (assignedTab === 'pending_evaluation' && t.status !== 'Pending Evaluation') return false;
      if (assignedTab === 'on_hold' && t.status !== 'On Hold') return false;
      if (assignedTab === 'reassigned' && !t.reassignmentRequested) return false;
      if (assignedTab === 'resolved_closed' && t.status !== 'Resolved' && t.status !== 'Closed') return false;
      
      if (!q) return true;
      const cleanQ = q.trim().toLowerCase();
      const searchBlob = buildTicketSearchString(t);
      if (searchBlob.includes(cleanQ)) return true;
      const tokens = cleanQ.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
      return tokens.length > 0 && tokens.every((token) => searchBlob.includes(token));
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'sla_due_date') {
        const dateA = new Date(a.due_at || a.resolution_due_at || a.sla?.resolution?.target || 0).getTime();
        const dateB = new Date(b.due_at || b.resolution_due_at || b.sla?.resolution?.target || 0).getTime();
        return sortDir === 'asc' ? dateA - dateB : dateB - dateA;
      }
      if (sortBy === 'sla_status') {
        const sA = String(a.sla_status || a.slaStatus || a.sla?.resolution?.status || '');
        const sB = String(b.sla_status || b.slaStatus || b.sla?.resolution?.status || '');
        return sortDir === 'asc' ? sA.localeCompare(sB) : sB.localeCompare(sA);
      }
      const timeA = new Date(a.updated_at || a.last_update || a.lastUpdate || a.date || a.created_at || 0).getTime();
      const timeB = new Date(b.updated_at || b.last_update || b.lastUpdate || b.date || b.created_at || 0).getTime();
      return timeB - timeA;
    });
  }, [tickets, search, slaFilter, machineFilter, departmentFilter, category, typeFilter, assignedTab, sortBy, sortDir]);

  const ITEMS_PER_PAGE = 10;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [filtered.length, totalPages, page]);

  const paginated = useMemo(() => {
    const start = (page - 1) * ITEMS_PER_PAGE;
    return filtered.slice(start, start + ITEMS_PER_PAGE);
  }, [filtered, page]);

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

      // Soft data refetch
      try {
        const incoming = await getCSIncomingTickets({ limit: 100, forceRefresh: true });
        const assignedTickets = incoming.filter(t =>
          t.reassignmentRequested === true ||
          ['Pending Assignment', 'In Progress', 'Pending Evaluation', 'Resolved', 'Pending', 'Closed', 'On Hold'].includes(t.status) ||
          (t.assigned && t.assigned.length > 0)
        );
        setTickets(assignedTickets);
      } catch (e) {
        const refreshed = { ...updated, status: 'Pending Assignment', reassignmentRequested: false };
        setTickets((prev) => prev.map((t) => ((t.ticket_ID === updated.ticket_ID || t.id === updated.id) ? refreshed : t)));
      }
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

      {error && (
        <div className="rounded-lg bg-destructive/10 text-destructive border border-destructive/20 px-4 py-3 text-sm font-medium">
          {error}
        </div>
      )}

      {notificationBanner && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-primary text-primary-foreground px-6 py-3 rounded-full shadow-xl flex items-center gap-3 border border-primary-foreground/20">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="text-sm font-semibold tracking-wide">{notificationBanner}</span>
        </div>
      )}

      {/* SLA Compliance Summary Metrics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full shrink-0">
        <button
          type="button"
          onClick={() => { setSlaFilter(slaFilter === 'Breached' ? 'All SLA Statuses' : 'Breached'); setPage(1); }}
          className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
            slaFilter === 'Breached'
              ? 'border-rose-400 bg-rose-50 shadow-xs ring-2 ring-rose-400/20'
              : 'border-border bg-card hover:border-rose-200 hover:bg-rose-50/30'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-600 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-600" /> Breached
            </span>
            <span className="text-xl font-bold text-rose-700">{slaSummary.breached}</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Resolution overdue</p>
        </button>

        <button
          type="button"
          onClick={() => { setSlaFilter(slaFilter === 'At Risk' ? 'All SLA Statuses' : 'At Risk'); setPage(1); }}
          className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
            slaFilter === 'At Risk'
              ? 'border-amber-400 bg-amber-50 shadow-xs ring-2 ring-amber-400/20'
              : 'border-border bg-card hover:border-amber-200 hover:bg-amber-50/30'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-600 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-amber-600" /> At Risk
            </span>
            <span className="text-xl font-bold text-amber-700">{slaSummary.at_risk}</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Near threshold (&le;4h)</p>
        </button>

        <button
          type="button"
          onClick={() => { setSlaFilter(slaFilter === 'On Track' ? 'All SLA Statuses' : 'On Track'); setPage(1); }}
          className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
            slaFilter === 'On Track'
              ? 'border-emerald-400 bg-emerald-50 shadow-xs ring-2 ring-emerald-400/20'
              : 'border-border bg-card hover:border-emerald-200 hover:bg-emerald-50/30'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> On Track
            </span>
            <span className="text-xl font-bold text-emerald-700">{slaSummary.on_track}</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Compliant with SLA</p>
        </button>

        <button
          type="button"
          onClick={() => { setSlaFilter(slaFilter === 'Paused' ? 'All SLA Statuses' : 'Paused'); setPage(1); }}
          className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
            slaFilter === 'Paused'
              ? 'border-blue-400 bg-blue-50 shadow-xs ring-2 ring-blue-400/20'
              : 'border-border bg-card hover:border-blue-200 hover:bg-blue-50/30'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-blue-600 flex items-center gap-1.5">
              <PauseCircle className="h-3.5 w-3.5 text-blue-600" /> Paused
            </span>
            <span className="text-xl font-bold text-blue-700">{slaSummary.paused}</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Clock paused on hold</p>
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

      {/* Assigned Tabs */}
      <div className="flex border-b border-border gap-2 overflow-x-auto">
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
        <button
          type="button"
          onClick={() => { setAssignedTab('resolved_closed'); setPage(1); }}
          className={`pb-3 px-4 text-sm font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-2 shrink-0 ${
            assignedTab === 'resolved_closed'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
          }`}
        >
          <span>Resolved / Closed</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
            assignedTab === 'resolved_closed' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
          }`}>
            {counts.resolvedClosed}
          </span>
        </button>
      </div>

      {/* Table Card */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-xs w-full min-w-0 max-w-full">
        <Table className="min-w-[960px] w-full">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[140px]">Ticket ID</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Type</TableHead>
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
              <TableHead className="w-[80px] text-center">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <DataTableSkeleton columns={10} rows={6} />
            ) : filtered.length === 0 ? (
              <DataTableEmptyState
                colSpan={10}
                message="No tickets found in this assigned queue."
              />
            ) : (
              paginated.map((t, idx) => {
                const isReassignmentReq = t.reassignmentRequested;
                const isInternalTicket =
                  t.title?.startsWith('[Internal]') ||
                  t.is_internal ||
                  t.ticket_type === 'Internal' ||
                  t.type === 'Internal';

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
                    <TableCell className="text-muted-foreground truncate max-w-[12rem]">
                      {t.customer}
                    </TableCell>
                    <TableCell>
                      <Badge variant={isInternalTicket ? 'secondary' : 'outline'}>
                        {isInternalTicket ? 'Internal' : 'External'}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium text-foreground max-w-[18rem]">
                      <div className="flex flex-col gap-1">
                        <span className="truncate">{t.title}</span>
                        {isReassignmentReq && (
                          <div className="text-xs text-warning bg-warning/10 p-1.5 rounded border border-warning/20">
                            <p className="font-semibold">
                              Req: {t.reassignmentRequestedBy || 'Employee'} {t.reassignmentDepartment ? `• ${t.reassignmentDepartment}` : ''}
                            </p>
                            {t.reassignmentReason && (
                              <p className="text-muted-foreground italic truncate max-w-xs">
                                &quot;{formatProperSentenceCase(t.reassignmentReason)}&quot;
                              </p>
                            )}
                          </div>
                        )}
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
                                    <span className="truncate max-w-[90px]">{emp.name}</span>
                                    <span className="text-[9px] font-semibold opacity-80">
                                      ({isAcc ? 'Accepted' : isReassign ? 'Reassign' : 'Pending'})
                                    </span>
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
                    <TableCell className="text-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRowAction(t);
                        }}
                        className="h-8 w-8 text-muted-foreground hover:text-primary"
                        aria-label="Manage ticket"
                      >
                        <SlidersHorizontal className="h-4 w-4" />
                      </Button>
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
              {Math.min(page * ITEMS_PER_PAGE, filtered.length)} of {filtered.length} tickets
            </div>
            <Pagination
              totalItems={filtered.length}
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
              try {
                const incoming = await getCSIncomingTickets({ limit: 100, forceRefresh: true });
                const assignedTickets = incoming.filter(t =>
                  t.reassignmentRequested === true ||
                  ['Pending Assignment', 'In Progress', 'Pending Evaluation', 'Resolved', 'Pending', 'Closed', 'On Hold'].includes(t.status) ||
                  (t.assigned && t.assigned.length > 0)
                );
                setTickets(assignedTickets);
              } catch (e) {
                // Keep local state
              }
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
              console.error('Failed to update ticket status on backend:', err);
            }

            // Soft reload the list to reflect updates immediately
            try {
              const incoming = await getCSIncomingTickets({ limit: 100, forceRefresh: true });
              const assignedTickets = incoming.filter(t =>
                t.reassignmentRequested === true ||
                ['Pending Assignment', 'In Progress', 'Pending Evaluation', 'Resolved', 'Pending', 'Closed', 'On Hold'].includes(t.status) ||
                (t.assigned && t.assigned.length > 0)
              );
              setTickets(assignedTickets);
            } catch (e) {
              setTickets(prev => prev.map(t => (t.id === (updatedFields.id || modal.ticket.id)) ? { ...t, ...updatedFields } : t));
            }
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
