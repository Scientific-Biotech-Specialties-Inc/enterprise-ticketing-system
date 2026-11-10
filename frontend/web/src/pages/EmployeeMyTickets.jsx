import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Filter, Plus, Search, Inbox, AlertTriangle, FileText, Edit3, Trash2, AlertCircle } from 'lucide-react';
import TicketModal from '@/components/TicketModal';
import CustomerTicketDetailModal from '@/components/CustomerTicketDetailModal';
import { AssignModal } from '@/components/CSModals';
import { useAuth } from '@/context/AuthContext';
import useRealtimeRefresh from '@/hooks/useRealtimeRefresh';
import {
  createInternalTicket,
  getInternalTickets,
  getCachedTicketFormOptions,
  getTicketFormOptions,
  getTicketDetails,
  updateTicket,
  getAssignableEmployees,
  getDepartments,
  acceptTicket,
  assignTicketToEmployees,
  getTicketDrafts,
  deleteTicketDraft,
  reopenTicket,
} from '@/services/ticketService';
import { statusColors } from '@/constants/employeeTickets';
import { getMaxOpenTicketsLimit, OPEN_STATUS_SET } from '@/data/ticketLimitConfig';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { DataTableSkeleton, DataTableEmptyState } from '@/components/ui/data-table';
import { ConfirmationModal } from '@/components/ui/confirmation-modal';
import Pagination from '@/components/Pagination';

const STATUSES = ['Open', 'Pending Assignment', 'In Progress', 'Pending', 'Resolved', 'Closed', 'Discarded', 'On Hold'];
const HISTORY_STATUSES = ['Resolved', 'Closed', 'Discarded by Customer', 'Discarded'];

const formatDate = (value) => {
  if (!value) return '-';
  let dateStr = String(value);
  if (typeof value === 'string' && !value.includes('T') && !value.includes('Z')) {
    dateStr = value.replace(' ', 'T') + 'Z';
  }
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).format(new Date(dateStr));
};

const statusClass = (s) => statusColors[s] ?? (s?.includes('Discarded') ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700');

export default function EmployeeMyTickets({ roleContext }) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [confirmCreated, setConfirmCreated] = useState(null);
  const [confirmDiscard, setConfirmDiscard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modalLoading, setModalLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('Loading...');
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDraft, setEditingDraft] = useState(null);
  const [activeTab, setActiveTab] = useState(
    location.state?.tab === 'drafts' || searchParams.get('tab') === 'drafts' ? 'drafts' : 'tickets'
  );
  const [drafts, setDrafts] = useState([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [formOptions, setFormOptions] = useState(() => getCachedTicketFormOptions() || {});
  const isHistory = false;

  const isCsRole = useMemo(() => {
    const role = String(user?.role || roleContext || '').toLowerCase();
    return role.includes('cs') || role.includes('customer service') || role.includes('coordinator');
  }, [user?.role, roleContext]);

  // CS delegation state
  const [csAssignTicket, setCsAssignTicket] = useState(null);
  const [csEmployees, setCsEmployees] = useState([]);
  const [csDepartments, setCsDepartments] = useState([]);
  const [csPriorityOptions] = useState(['Low', 'Medium', 'High', 'Critical']);
  const storageKey = roleContext === 'cs' ? 'cs_created_tickets' : 'employee_created_tickets';

  const currentUserId = useMemo(() => {
    const uid = user?.client_ID ?? user?.client_id ?? user?.id ?? user?.emp_id;
    if (uid) return Number(uid);
    for (const key of ['user', 'auth_user']) {
      for (const store of [sessionStorage, localStorage]) {
        try {
          const parsed = JSON.parse(store.getItem(key) || 'null');
          const id = parsed?.client_ID ?? parsed?.client_id ?? parsed?.id ?? parsed?.emp_id;
          if (id) return Number(id);
        } catch { /* ignore */ }
      }
    }
    return 1;
  }, [user]);

  const loadDrafts = useCallback(async () => {
    setLoadingDrafts(true);
    try {
      const list = await getTicketDrafts({ client_id: currentUserId });
      setDrafts(list || []);
    } catch (err) {
      console.warn('Failed to load ticket drafts:', err);
    } finally {
      setLoadingDrafts(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    loadDrafts();
    getTicketFormOptions({ forceRefresh: false })
      .then((opts) => {
        if (opts) setFormOptions(opts);
      })
      .catch(() => {});
  }, [loadDrafts]);

  useEffect(() => {
    const targetTab = location.state?.tab || searchParams.get('tab');
    if (targetTab) {
      setActiveTab(targetTab);
      if (targetTab === 'drafts') {
        loadDrafts();
      }
    }
  }, [location.state?.tab, location.state?.draftSavedAt, searchParams, loadDrafts]);

  const handleEditDraft = (draft) => {
    setEditingDraft(draft);
    setIsModalOpen(true);
  };

  const handleDeleteDraft = async (draft) => {
    if (!draft?.id) return;
    try {
      await deleteTicketDraft(draft.id, { client_id: currentUserId });
      setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
    } catch (err) {
      console.error('Failed to delete draft:', err);
      window.alert(err?.response?.data?.message || 'Failed to delete draft.');
    }
  };

  const getEquipmentName = (machineId) => {
    if (!machineId) return '—';
    const eqOpts = formOptions?.equipment_options || [];
    const found = eqOpts.find((o) => String(o.value) === String(machineId));
    if (found) return found.label;
    const mach = (formOptions?.machines || []).find((m) => String(m.machine_ID) === String(machineId));
    if (mach) return `${mach.machine_name} - ${mach.serial_number}`;
    return `Equipment #${machineId}`;
  };

  const getCategoryName = (catId) => {
    if (!catId) return '—';
    const catOpts = formOptions?.category_options || [];
    const found = catOpts.find((o) => String(o.value) === String(catId));
    if (found) return found.label;
    const cat = (formOptions?.problem_categories || []).find((c) => String(c.problem_category_ID) === String(catId));
    if (cat) return cat.category_name;
    return `Category #${catId}`;
  };

  const [filters, setFilters] = useState({
    status: '',
    category: '',
    priority: '',
    dateFrom: '',
    dateTo: '',
    search: '',
  });


  const loadTickets = useCallback(async ({ forceRefresh = false, source = 'manual' } = {}) => {
    // Realtime ticks (websocket/poll) refresh silently instead of flashing the skeleton.
    if (source !== 'websocket' && source !== 'poll') setLoading(true);
    setError('');
    try {
      let mapped = [];
      try {
        const apiTickets = await getInternalTickets();
        if (apiTickets && apiTickets.length > 0) {
          mapped = apiTickets.map(t => ({
            ...t,
            date_created: t.date || t.created_at,
            last_updated: t.lastUpdate || t.updated_at,
            is_internal: true,
            ticket_type: 'Internal',
            can_discard: t.status === 'Open' && !t.assigned_to,
          }));
        }
      } catch (apiErr) {
        console.warn('API getInternalTickets failed, falling back to local storage:', apiErr);
      }

      if (mapped.length === 0) {
        let stored = JSON.parse(sessionStorage.getItem(storageKey) || '[]');
        let healed = false;
        mapped = stored.map(t => {
          const numericId = t.ticket_ID || parseInt(String(t.id || '').replace(/\D/g, ''), 10);
          const isMock = !!t.isMock || [1001, 1002, 1003, 1004, 7545, 9091, 9092].includes(numericId) || String(t.id).startsWith('TKT-100');
          if (isMock && !t.isMock) {
            healed = true;
            return { ...t, isMock: true };
          }
          return t;
        });
        if (healed) {
          // State updated directly
        }
      }
      setTickets(mapped);
    } catch (err) {
      setError('Failed to load tickets. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [storageKey]);

  useEffect(() => {
    loadTickets({ forceRefresh: false });
  }, [loadTickets]);

  // Prefetch employees & departments for CS delegation
  useEffect(() => {
    if (!isCsRole) return;
    Promise.all([
      getAssignableEmployees({ forceRefresh: false }).catch(() => []),
      getDepartments({ forceRefresh: false }).catch(() => []),
    ]).then(([emps, deps]) => {
      setCsEmployees(
        (emps || []).map((row) => ({
          id: Number(row.id ?? row.emp_id),
          name: row.name || `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.email,
          status: row.is_active ? 'active' : 'inactive',
          department: row.department?.trim() || 'Unassigned',
        }))
      );
      const allowedDepts = ['Customer Service', 'IT', 'Service'];
      setCsDepartments((deps || []).filter(d => allowedDepts.includes(d.name)).map(d => d.name));
    });
  }, [isCsRole]);

  useEffect(() => {
    if (location.state?.openCreateModal) {
      setIsModalOpen(true);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  useRealtimeRefresh({
    refresh: loadTickets,
    channels: [{ name: 'ticket-updates', event: 'ticket.changed' }],
    intervalMs: 30000,
  });

  const categories = useMemo(() => {
    const unique = new Set(tickets.map((ticket) => ticket.category).filter(Boolean));
    return Array.from(unique).sort();
  }, [tickets]);

  const visibleTickets = useMemo(() => {
    return tickets.filter((ticket) => {
      const normalizedStatus = ticket.status === 'Discarded by Customer' ? 'Discarded' : ticket.status;
      if (isHistory && !HISTORY_STATUSES.includes(ticket.status)) return false;
      if (filters.status && normalizedStatus !== filters.status) return false;
      if (filters.category && ticket.category !== filters.category) return false;
      if (filters.priority) {
        const ticketPriority = (typeof ticket.priority === 'object' ? ticket.priority?.priority_name : ticket.priority) || ticket.priority_name || '';
        if (String(ticketPriority).toLowerCase() !== filters.priority.toLowerCase()) return false;
      }
      if (filters.dateFrom) {
        const ticketDateStr = ticket.date_created || ticket.created_at || ticket.date;
        if (ticketDateStr) {
          const d = new Date(ticketDateStr);
          const start = new Date(`${filters.dateFrom}T00:00:00`);
          const end = new Date(`${filters.dateFrom}T23:59:59.999`);
          if (d < start || d > end) return false;
        }
      } else if (filters.dateTo) {
        if (new Date(ticket.date_created) > new Date(`${filters.dateTo}T23:59:59`)) return false;
      }

      const search = filters.search.trim().toLowerCase();
      if (!search) return true;
      return (
        ticket.id?.toLowerCase().includes(search) ||
        ticket.title?.toLowerCase().includes(search) ||
        ticket.description?.toLowerCase().includes(search)
      );
    });
  }, [filters, isHistory, tickets]);

  const [page, setPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    setPage(1);
  }, [filters, isHistory, activeTab]);

  const paginatedTickets = useMemo(() => {
    const start = (page - 1) * itemsPerPage;
    return visibleTickets.slice(start, start + itemsPerPage);
  }, [visibleTickets, page, itemsPerPage]);

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const currentEmployeeId = user?.id ?? user?.emp_id;

  const openInternalTicketsCount = useMemo(() => {
    return (tickets || []).filter((t) => {
      const isInternal = t.is_internal === true || t.ticket_type === 'Internal';
      const matchesEmp = !currentEmployeeId ||
        String(t.requested_by) === String(currentEmployeeId) ||
        String(t.created_by) === String(currentEmployeeId) ||
        (!t.requested_by && !t.created_by);
      return isInternal && matchesEmp && OPEN_STATUS_SET.includes(t.status);
    }).length;
  }, [tickets, currentEmployeeId]);

  const handleCreateTicket = async (payload) => {
    // TS096: Enforce max open internal tickets limit for Employee-as-Requestor
    const limitConfig = getMaxOpenTicketsLimit();
    if (!limitConfig.isUnlimited && openInternalTicketsCount >= limitConfig.limit) {
      throw new Error(`You've reached the maximum number of open tickets (${limitConfig.limit}). Resolve or close an existing ticket before submitting another.`);
    }

    setLoadingText('Submitting internal ticket...');
    setModalLoading(true);

    try {
      const options = getCachedTicketFormOptions() || await getTicketFormOptions();
      const category = options.category_options?.find((item) => String(item.value) === String(payload.problem_category_ID))?.label || 'General';
      const equipment = options.equipment_options?.find((item) => String(item.value) === String(payload.machine_ID))?.label || 'Unspecified equipment';
      const response = await createInternalTicket(payload);
      const createdTicket = response.ticket || {};
      const numericTicketId = createdTicket.ticket_ID || Number(String(response.id || '').replace(/\D/g, ''));
      const now = new Date().toISOString();
      const createdAt = createdTicket.created_at || now;
      const updatedAt = createdTicket.updated_at || createdAt;
      const ticketRef = createdTicket.ticket_number || response.ticket_number || response.dashboard_ticket?.ticket_number || response.id || `TKT-${String(numericTicketId).padStart(4, '0')}`;

      const newTicket = {
        id: ticketRef,
        ticket_ID: numericTicketId,
        isMock: false,
        title: createdTicket.title || payload.title,
        category,
        equipment,
        status: 'Open',
        description: createdTicket.description || payload.description,
        date_created: createdAt,
        last_updated: updatedAt,
        date: createdAt,
        lastUpdate: updatedAt,
        attachments: response.attachments || [],
        is_internal: true,
        ticket_type: 'Internal',
        type: 'Internal',
        can_discard: true,
        requested_by: user?.id ?? user?.emp_id,
      };

      const stored = JSON.parse(sessionStorage.getItem(storageKey) || '[]');
      const updatedList = [
        newTicket,
        ...stored.filter((ticket) => ticket.id !== newTicket.id && ticket.ticket_ID !== numericTicketId),
      ];

      // State updated directly
      setTickets(updatedList);
      setIsModalOpen(false);

      if (isCsRole) {
        setCsAssignTicket(newTicket);
      } else {
        setConfirmCreated(newTicket);
      }
    } catch (err) {
      console.error('Failed to create internal ticket:', err);
      throw err;
    } finally {
      setModalLoading(false);
    }
  };

  const handleCsAssignSave = async (updated) => {
    const priorityMap = { Low: 1, Medium: 2, High: 3, Critical: 4 };
    try {
      const rawId = updated.ticket_ID || updated.id;
      const numericId = Number(String(rawId).replace(/\D/g, ''));
      await assignTicketToEmployees({
        ticketId: numericId,
        employeeIds: updated.assigned,
        assignedByEmail: user?.email,
        priorityId: priorityMap[updated.priority] ?? 1,
      });
      setCsAssignTicket(null);
      setTickets((prev) =>
        prev.map((t) =>
          t.id === updated.id || t.ticket_ID === numericId
            ? {
                ...t,
                status: 'Assigned',
                assigned_to: Array.isArray(updated.assigned) ? updated.assigned[0] : updated.assigned,
                assigned: updated.assigned,
                priority: updated.priority || t.priority,
              }
            : t
        )
      );
      loadTickets({ forceRefresh: true });
      setConfirmCreated({
        ...updated,
        assignedSuccess: true,
      });
      return true;
    } catch (err) {
      console.error('Failed to assign ticket:', err);
      window.alert(err?.response?.data?.message || 'Failed to assign ticket.');
      throw err;
    }
  };

  const handleConfirmDiscard = async () => {
    if (!confirmDiscard) return;

    setLoadingText('Discarding ticket...');
    setModalLoading(true);
    try {
      const ticketId = confirmDiscard.ticket_ID || parseInt(String(confirmDiscard.id || '').replace(/\D/g, ''), 10);
      await updateTicket({
        ticketId: ticketId,
        statusId: 9, // Discarded
      });
      setConfirmDiscard(null);
      setSelectedTicket(null);
      window.alert('Ticket discarded successfully.');
      loadTickets({ forceRefresh: true });
    } catch (err) {
      console.error('Failed to discard ticket:', err);
      window.alert(err?.response?.data?.message || 'Failed to discard ticket.');
    } finally {
      setModalLoading(false);
    }
  };

  const handleViewTicket = async (t) => {
    const isMock = !!t.isMock;
    if (isMock) {
      setSelectedTicket({
        ...t,
        description: t.description || '',
        resolved_at: t.resolved_at || null,
        proofAttachments: t.proofAttachments || [],
        proofFiles: t.proofFiles || [],
        can_discard: t.status === 'Open' && !t.assigned_to,
      });
      return;
    }

    setLoadingText('Loading ticket details...');
    setModalLoading(true);
    try {
      const ticketId = t.ticket_ID || parseInt(String(t.id || '').replace(/\D/g, ''), 10);
      const fullTicket = await getTicketDetails(ticketId);
      setSelectedTicket({
        ...t,
        ...fullTicket,
        id: fullTicket.id || t.id || `TKT-${String(ticketId).padStart(4, '0')}`,
        status: fullTicket.status || t.status,
        description: fullTicket.description || t.description || '',
        resolved_at: fullTicket.resolved_at || t.resolved_at || null,
        closed_at: fullTicket.closed_at || t.closed_at || null,
        proofAttachments: fullTicket.proofAttachments || [],
        proofFiles: fullTicket.proofFiles || [],
        attachments: fullTicket.attachments || fullTicket.ticket_attachments || t.attachments || [],
        can_discard: (fullTicket.status || t.status) === 'Open' && !fullTicket.assigned_to,
      });
    } catch (err) {
      console.warn('Could not load full ticket details, using row data:', err);
      setSelectedTicket({
        ...t,
        can_discard: t.status === 'Open' && !t.assigned_to,
      });
    } finally {
      setModalLoading(false);
    }
  };

  const handleResolveTicket = async (ticketId) => {
    const isMock = selectedTicket ? !!selectedTicket.isMock : false;
    if (isMock) {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) || '[]');
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
      // State updated directly
      setTickets(updatedList);
      setSelectedTicket(null);
      window.alert('Ticket resolved successfully.');
      return;
    }

    setLoadingText('Resolving ticket...');
    setModalLoading(true);
    try {
      const numericId = Number(String(ticketId).replace(/\D/g, ''));
      await updateTicket({
        ticketId: numericId,
        statusId: 3, // Resolved
      });
      setSelectedTicket(null);
      window.alert('Ticket resolved successfully.');
      loadTickets({ forceRefresh: true });
    } catch (err) {
      console.error('Failed to resolve ticket:', err);
      window.alert(err?.response?.data?.message || 'Failed to resolve ticket.');
    } finally {
      setModalLoading(false);
    }
  };

  const handleCloseTicket = async (ticketId) => {
    setLoadingText('Closing ticket...');
    setModalLoading(true);
    try {
      const numericId = Number(String(ticketId).replace(/\D/g, ''));
      await updateTicket({
        ticketId: numericId,
        statusId: 4, // Closed
      });
      setSelectedTicket(null);
      window.alert('Ticket closed successfully.');
      loadTickets({ forceRefresh: true });
    } catch (err) {
      console.error('Failed to close ticket:', err);
      window.alert(err?.response?.data?.message || 'Failed to close ticket.');
    } finally {
      setModalLoading(false);
    }
  };

  const handleReopenTicket = async (ticketId, reason) => {
    setLoadingText('Reopening ticket...');
    setModalLoading(true);
    try {
      const numericId = Number(String(ticketId).replace(/\D/g, ''));
      await updateTicket({
        ticketId: numericId,
        statusId: 8, // Reopened
      });
      setSelectedTicket(null);
      window.alert('Ticket reopened successfully.');
      loadTickets({ forceRefresh: true });
    } catch (err) {
      console.error('Failed to reopen ticket:', err);
      window.alert(err?.response?.data?.message || 'Failed to reopen ticket.');
    } finally {
      setModalLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 font-sans text-dark-slate">
      <PageHeader
        title="My Tickets"
        subtitle="Track and manage your submitted support tickets."
        actions={
          <Button
            onClick={() => {
              setEditingDraft(null);
              setIsModalOpen(true);
            }}
            icon={<Plus className="h-4 w-4" />}
          >
            Create Ticket
          </Button>
        }
      />

      <div className="flex border-b border-gray-200 gap-2">
        <button
          type="button"
          onClick={() => {
            setActiveTab('tickets');
            setSearchParams({});
          }}
          className={`pb-3 px-4 text-sm font-bold transition-all border-b-2 -mb-px flex items-center gap-2 cursor-pointer ${
            activeTab === 'tickets'
              ? 'border-brand-primary text-brand-primary'
              : 'border-transparent text-muted-slate hover:text-dark-slate'
          }`}
        >
          All Tickets
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
            activeTab === 'tickets' ? 'bg-brand-primary/10 text-brand-primary' : 'bg-page text-muted-slate'
          }`}>
            {visibleTickets.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab('drafts');
            setSearchParams({ tab: 'drafts' });
            loadDrafts();
          }}
          className={`pb-3 px-4 text-sm font-bold transition-all border-b-2 -mb-px flex items-center gap-2 cursor-pointer ${
            activeTab === 'drafts'
              ? 'border-brand-primary text-brand-primary'
              : 'border-transparent text-muted-slate hover:text-dark-slate'
          }`}
        >
          My Drafts
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
            activeTab === 'drafts' ? 'bg-amber-100 text-amber-800' : 'bg-page text-muted-slate'
          }`}>
            {drafts.length}
          </span>
        </button>
      </div>

      {activeTab !== 'drafts' ? (
        <>
          {/* Filter toolbar: Search bar in the same row as dropdown filters */}
          <div className="flex flex-col lg:flex-row items-center gap-2.5 w-full shrink-0">
            <div className="relative flex-1 w-full min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-slate" />
              <input
                type="search"
                placeholder="Search ID, title, or description..."
                value={filters.search}
                onChange={(event) => updateFilter('search', event.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-surface pl-9 pr-4 py-2 text-sm text-dark-slate outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent placeholder:text-muted-slate/60 h-10"
              />
            </div>
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 w-full lg:w-auto shrink-0">
              <select
                value={filters.status}
                onChange={(event) => updateFilter('status', event.target.value)}
                className="h-10 flex-1 sm:flex-initial min-w-[130px] rounded-xl border border-gray-200 bg-surface px-3 text-sm text-dark-slate outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent cursor-pointer"
              >
                <option value="">All statuses</option>
                {STATUSES.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
              <select
                value={filters.category}
                onChange={(event) => updateFilter('category', event.target.value)}
                className="h-10 flex-1 sm:flex-initial min-w-[130px] rounded-xl border border-gray-200 bg-surface px-3 text-sm text-dark-slate outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent cursor-pointer"
              >
                <option value="">All categories</option>
                {categories.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
              <select
                value={filters.priority}
                onChange={(event) => updateFilter('priority', event.target.value)}
                className="h-10 flex-1 sm:flex-initial min-w-[130px] rounded-xl border border-gray-200 bg-surface px-3 text-sm text-dark-slate outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent cursor-pointer"
              >
                <option value="">All priorities</option>
                {['Low', 'Medium', 'High', 'Critical'].map((priority) => (
                  <option key={priority} value={priority}>{priority}</option>
                ))}
              </select>
              <div className="relative flex-1 sm:flex-initial">
                <input
                  type="date"
                  aria-label="Filter by date"
                  value={filters.dateFrom}
                  onChange={(event) => {
                    const v = event.target.value;
                    setFilters((c) => ({ ...c, dateFrom: v, dateTo: v }));
                  }}
                  className="h-10 w-full sm:w-auto min-w-[130px] rounded-xl border border-gray-200 bg-surface px-3 text-sm text-dark-slate outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent cursor-pointer"
                />
                {filters.dateFrom && (
                  <button
                    type="button"
                    onClick={() => setFilters((c) => ({ ...c, dateFrom: '', dateTo: '' }))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs px-1 font-bold cursor-pointer"
                    title="Clear date"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-surface shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">ID</TableHead>
                  <TableHead className="min-w-[240px]">Title</TableHead>
                  <TableHead className="w-[160px]">Category</TableHead>
                  <TableHead className="w-[140px]">Status</TableHead>
                  <TableHead className="w-[140px]">Date Created</TableHead>
                  <TableHead className="w-[140px]">Last Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleTickets.length === 0 && loading && (
                  <DataTableSkeleton columns={6} rows={4} />
                )}
                {visibleTickets.length === 0 && !loading && (
                  <DataTableEmptyState
                    colSpan={6}
                    icon={Inbox}
                    title="No tickets found"
                    description="No tickets match the current filters."
                  />
                )}
                {paginatedTickets.map((ticket) => (
                  <TableRow
                    key={ticket.id}
                    onClick={() => handleViewTicket(ticket)}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                  >
                    <TableCell className="font-semibold text-brand-primary whitespace-nowrap">
                      {ticket.id}
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      <p className="font-medium text-dark-slate line-clamp-2">{ticket.title}</p>
                    </TableCell>
                    <TableCell className="text-muted-slate text-sm truncate">
                      {ticket.category}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant={getStatusBadgeVariant(ticket.status)}>
                          {ticket.status}
                        </Badge>
                        {(() => {
                          const rawSla = ticket.sla_status || ticket.slaStatus || (ticket.sla_breached ? 'Breached' : null);
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
                    <TableCell className="text-muted-slate text-xs whitespace-nowrap">
                      {formatDate(ticket.date_created)}
                    </TableCell>
                    <TableCell className="text-muted-slate text-xs whitespace-nowrap">
                      {formatDate(ticket.last_updated)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!loading && visibleTickets.length > 0 && (
              <div className="px-4 py-3 border-t border-slate-200 bg-surface flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-slate">
                <span>
                  Showing {(page - 1) * itemsPerPage + 1} to{' '}
                  {Math.min(page * itemsPerPage, visibleTickets.length)} of {visibleTickets.length} tickets
                </span>
                <Pagination
                  totalItems={visibleTickets.length}
                  itemsPerPage={itemsPerPage}
                  currentPage={page}
                  onPageChange={setPage}
                />
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-gray-150 shadow-xs">
            <div>
              <h2 className="text-sm font-bold text-gray-800">Your Saved Drafts</h2>
              <p className="text-xs text-gray-500">Finish and submit in-progress tickets at your convenience.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-3 py-1 rounded-full text-xs font-bold border ${
                drafts.length >= 10
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : drafts.length >= 7
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-blue-50 text-[#252578] border-blue-200'
              }`}>
                {drafts.length} / 10 Drafts
              </span>
            </div>
          </div>

          {drafts.length >= 10 && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3.5 text-xs font-semibold text-amber-800 flex items-center gap-2.5">
              <AlertCircle size={16} className="text-amber-600 shrink-0" />
              <span>You have reached the maximum allowed limit of 10 drafts. Please submit or delete an existing draft to create new ones.</span>
            </div>
          )}

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-surface shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Draft Title / Summary</TableHead>
                  <TableHead>Equipment</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Last Saved</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drafts.length === 0 && loadingDrafts && (
                  <DataTableSkeleton columns={5} rows={3} />
                )}
                {drafts.length === 0 && !loadingDrafts && (
                  <DataTableEmptyState
                    colSpan={5}
                    icon={FileText}
                    title="No saved drafts"
                    description="When creating a ticket, you can click 'Save as Draft' to continue anytime."
                    action={
                      <Button
                        size="sm"
                        onClick={() => {
                          setEditingDraft(null);
                          setIsModalOpen(true);
                        }}
                        icon={<Plus className="h-3.5 w-3.5" />}
                      >
                        Create New Ticket
                      </Button>
                    }
                  />
                )}
                {drafts.map((draft) => (
                  <TableRow
                    key={draft.id}
                    onClick={() => handleEditDraft(draft)}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                  >
                    <TableCell className="max-w-[280px]">
                      <div className="truncate font-semibold text-dark-slate" title={draft.title}>
                        {draft.title || 'Untitled Draft'}
                      </div>
                      {draft.description && (
                        <div className="text-xs text-muted-slate truncate mt-0.5">
                          {draft.description}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-slate max-w-[220px] truncate">
                      {getEquipmentName(draft.machine_ID)}
                    </TableCell>
                    <TableCell className="text-muted-slate">
                      {getCategoryName(draft.problem_category_ID)}
                    </TableCell>
                    <TableCell className="text-muted-slate text-xs whitespace-nowrap">
                      {formatDate(draft.last_saved_at || draft.updated_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditDraft(draft)}
                          icon={<Edit3 className="h-3.5 w-3.5" />}
                        >
                          Continue
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteDraft(draft)}
                          icon={<Trash2 className="h-3.5 w-3.5" />}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <TicketModal
        showDepartmentSelector
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingDraft(null);
        }}
        onSubmit={async (payload) => {
          await handleCreateTicket(payload);
          setEditingDraft(null);
          setActiveTab('tickets');
          setSearchParams({});
          loadDrafts();
        }}
        openTicketsCount={openInternalTicketsCount}
        initialDraft={editingDraft}
        onDraftSaved={() => {
          setEditingDraft(null);
          setActiveTab('drafts');
          setSearchParams({ tab: 'drafts' });
          loadDrafts();
        }}
      />

      {/* Ticket Detail Summary Modal */}
      {selectedTicket && (
        <CustomerTicketDetailModal
          ticket={selectedTicket}
          onClose={() => setSelectedTicket(null)}
          onDiscard={(ticket) => setConfirmDiscard(ticket)}
          onReopen={(ticketId, reason) => handleReopenTicket(ticketId, reason)}
          onResolve={(ticketId) => handleResolveTicket(ticketId)}
        />
      )}
      


      {confirmDiscard && (
        <ConfirmationModal
          open={!!confirmDiscard}
          onOpenChange={(open) => !open && setConfirmDiscard(null)}
          title="Discard this ticket?"
          description={`This will mark ${confirmDiscard.id} as Discarded.`}
          confirmLabel="Discard"
          badgeVariant="destructive"
          onConfirm={handleConfirmDiscard}
        />
      )}

      {csAssignTicket && (
        <AssignModal
          ticket={csAssignTicket}
          employees={csEmployees}
          departments={csDepartments}
          priorityOptions={csPriorityOptions}
          onClose={() => {
            const t = csAssignTicket;
            setCsAssignTicket(null);
            setConfirmCreated(t);
          }}
          onSave={handleCsAssignSave}
        />
      )}

      {confirmCreated && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px] animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl bg-surface p-6 text-center shadow-level-4 border border-slate-200">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="mt-4 text-lg font-bold text-dark-slate">
              {confirmCreated.assignedSuccess ? 'Ticket Created & Assigned' : 'Ticket Submitted'}
            </h2>
            <p className="mt-1.5 text-xs text-muted-slate">
              {confirmCreated.id || (confirmCreated.ticket_ID ? `TKT-${String(confirmCreated.ticket_ID).padStart(4, '0')}` : 'Ticket')} has been created {confirmCreated.assignedSuccess ? 'and assigned to the technician' : 'successfully'}.
            </p>
            <Button
              className="mt-6 w-full"
              onClick={() => {
                const ticketId = confirmCreated.ticket_ID || confirmCreated.id;
                setConfirmCreated(null);
                const targetPath = roleContext === 'cs' ? '/cs/messages' : roleContext === 'cs_manager' ? '/cs-manager/messages' : roleContext === 'service_manager' ? '/service-manager/messages' : roleContext === 'it_manager' ? '/it-manager/messages' : '/employee/messages';
                navigate(targetPath, { state: { selectedTicketId: ticketId } });
              }}
            >
              Done
            </Button>
          </div>
        </div>
      )}

      {modalLoading && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-[1.5px] animate-in fade-in duration-200">
          <div className="bg-surface rounded-2xl p-6 shadow-level-4 flex flex-col items-center gap-4 max-w-xs w-full mx-4 border border-slate-200">
            <div className="w-10 h-10 border-4 border-brand-primary/10 border-t-brand-primary rounded-full animate-spin" />
            <p className="text-sm font-semibold text-brand-primary text-center font-sans">
              {loadingText}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}