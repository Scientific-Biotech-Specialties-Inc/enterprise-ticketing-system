import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MoreVertical, Filter, RotateCcw, Trash2, Edit3, FileText, X, Plus, Search, Calendar, User, Tag, AlertCircle, CheckCircle2, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { DataTableSkeleton, DataTableEmptyState } from '@/components/ui/data-table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import TicketModal from '@/components/TicketModal';
import CustomerTicketDetailModal from '@/components/CustomerTicketDetailModal';
import NotificationModal from '@/components/NotificationModal';
import { statusColors, priorityColors } from '@/constants/employeeTickets';
import { useAuth } from '@/context/AuthContext';
import useRealtimeRefresh from '@/hooks/useRealtimeRefresh';
import { normalizeCasing } from '@/utils/normalizeCasing';
import { formatDisplayDate } from '@/utils/dateUtils';
import {
  createTicket,
  discardCustomerTicket,
  getCachedTicketFormOptions,
  getCustomerTickets,
  getTicketFormOptions,
  saveCustomerTicketDetail,
  getTicketDetails,
  updateTicket,
  reopenTicket,
  getTicketDrafts,
  deleteTicketDraft,
  getCustomerFilterOptions,
} from '@/services/ticketService';
import { getMaxOpenTicketsLimit, OPEN_STATUS_SET } from '@/data/ticketLimitConfig';

import { parseUTCDate } from '@/utils/dateUtils';
import TitleCasingModal from '@/components/TitleCasingModal';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';
import { hasFeedbackBeenSubmitted, fetchFeedbackForTicket } from '@/data/mockFeedbackData';

const ACTIVE_STATUSES = ['Open', 'Pending Assignment', 'In Progress', 'Pending', 'On Hold', 'Closed'];
const HISTORY_STATUSES = ['Resolved', 'Closed', 'Discarded by Customer', 'Discarded'];

const getStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
};

const formatDate = (value) => formatDisplayDate(value);

const getTicketAssignedEmployee = (ticket) => {
  if (!ticket) return 'Unassigned';
  const candidate =
    ticket.assigned_employee ||
    ticket.assigned_employee_name ||
    ticket.assigned_to_name ||
    (Array.isArray(ticket.assigned_employees) && ticket.assigned_employees[0]?.name ? ticket.assigned_employees[0].name : null) ||
    (typeof ticket.assigned_to === 'string' && ticket.assigned_to.trim() && ticket.assigned_to.trim().toLowerCase() !== 'unassigned' ? ticket.assigned_to.trim() : null);
  return candidate || 'Unassigned';
};

const statusClass = (s) => statusColors[s] ?? (s?.includes('Discarded') ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700');

export default function MyTickets({ mode = 'all' }) {
  const isHistory = mode === 'history';
  const { user } = useAuth();
  const effectiveUser = user || getStoredUser();
  const customerId = effectiveUser?.id || 1;
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const urlTicketId = params?.ticketId || searchParams.get('ticketId');

  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(location.state?.openCreateModal || false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [notification, setNotification] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('Loading...');
  const [editingTicket, setEditingTicket] = useState(null);
  useLockBodyScroll(!!editingTicket);
  const [editTitle, setEditTitle] = useState('');
  const [titleCasingData, setTitleCasingData] = useState(null);
  const [showTitleCasingModal, setShowTitleCasingModal] = useState(false);
  const [editDescription, setEditDescription] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editEquipment, setEditEquipment] = useState('');
  const [editOptions, setEditOptions] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPos, setMenuPos] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [activeTab, setActiveTab] = useState(
    location.state?.tab === 'drafts' || searchParams.get('tab') === 'drafts' ? 'drafts' : 'tickets'
  ); // 'tickets' | 'drafts'
  const [feedbackVersion, setFeedbackVersion] = useState(0);
  const [drafts, setDrafts] = useState([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [filterOptions, setFilterOptions] = useState({
    categories: [],
    statuses: [],
    machines: [],
  });

  const [filters, setFilters] = useState({
    keywords: '',
    status: '',
    category: '',
    machine: '',
    priority: '',
    employee: '',
    date: '',
  });

  const loadDrafts = useCallback(async () => {
    setLoadingDrafts(true);
    try {
      const list = await getTicketDrafts({ client_id: customerId });
      setDrafts(list || []);
    } catch (err) {
      console.warn('Failed to load ticket drafts:', err);
    } finally {
      setLoadingDrafts(false);
    }
  }, [customerId]);

  useEffect(() => {
    const targetTab = location.state?.tab || searchParams.get('tab');
    if (targetTab) {
      setActiveTab(targetTab);
      if (targetTab === 'drafts') {
        loadDrafts();
      }
    }
  }, [location.state?.tab, location.state?.draftSavedAt, searchParams, loadDrafts]);

  // Auto-open ticket modal when navigating with ticketId (e.g. from email links or alerts)
  useEffect(() => {
    if (!urlTicketId) return;
    const cleanId = String(urlTicketId).replace(/\D/g, '');
    if (!cleanId) return;

    let isMounted = true;
    (async () => {
      setModalLoading(true);
      setLoadingText('Loading ticket details...');
      try {
        const fullTicket = await getTicketDetails(Number(cleanId));
        if (isMounted && fullTicket) {
          setSelectedTicket({
            ...fullTicket,
            id: fullTicket.id || `TKT-${String(cleanId).padStart(4, '0')}`,
            status: fullTicket.status || 'Open',
            description: fullTicket.description || '',
            proofAttachments: fullTicket.proofAttachments || [],
            proofFiles: fullTicket.proofFiles || [],
            attachments: fullTicket.attachments || fullTicket.ticket_attachments || [],
            can_discard: (fullTicket.status || 'Open') === 'Open' && !fullTicket.assigned_to,
          });
        }
      } catch (err) {
        console.warn('Could not auto-open ticket from URL:', err);
      } finally {
        if (isMounted) setModalLoading(false);
      }
    })();

    return () => { isMounted = false; };
  }, [urlTicketId]);

  const loadFilterOptions = useCallback(async () => {
    try {
      const opts = await getCustomerFilterOptions(customerId);
      if (opts) {
        setFilterOptions((prev) => ({
          ...prev,
          categories: opts.categories || [],
          statuses: opts.statuses || [],
          priorities: opts.priorities || [],
          machines: opts.machines || [],
          employees: opts.employees || prev.employees || [],
        }));
      }
    } catch (err) {
      console.warn('Failed to load customer filter options:', err);
    }
  }, [customerId]);

  const loadTickets = useCallback(async ({ forceRefresh = false, source = 'manual' } = {}) => {
    // Realtime ticks (websocket/poll) refresh silently instead of flashing the skeleton.
    if (source !== 'websocket' && source !== 'poll') setLoading(true);
    setError('');
    try {
      const ticketsList = await getCustomerTickets({ createdBy: customerId, limit: 100, forceRefresh });
      const seen = new Set();
      const uniqueTickets = (ticketsList || []).filter((t) => {
        const id = t.id || t.ticket_ID;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      setTickets(uniqueTickets);

      // Prefetch feedback for completed tickets so feedback status is immediately known
      uniqueTickets.forEach((t) => {
        if (t.status === 'Closed' || t.status === 'Resolved') {
          const tId = t.id || t.ticket_ID;
          if (tId && typeof fetchFeedbackForTicket === 'function') {
            fetchFeedbackForTicket(tId).catch(() => {});
          }
        }
      });
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load tickets.');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    try {
      localStorage.removeItem('demo_external_tickets');
    } catch {
      // ignore
    }
    loadTickets({ forceRefresh: false });
    loadDrafts();
    loadFilterOptions();
  }, [loadTickets, loadDrafts, loadFilterOptions]);

  useEffect(() => {
    if (!openMenuId) return;
    const handler = (e) => {
      if (!e.target.closest('[data-menu-id]') && !e.target.closest('.menu-trigger')) {
        setOpenMenuId(null);
        setMenuPos(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMenuId]);

  useEffect(() => {
    if (location.state?.openCreateModal) {
      setIsModalOpen(true);
      window.history.replaceState({}, document.title);
    }
    const focusId = location.state?.focusTicketId;
    if (focusId && tickets.length > 0) {
      const match = tickets.find(t => t.id === focusId || t.ticket_ID === focusId);
      if (match) {
        handleViewTicket(match);
        window.history.replaceState({}, document.title);
      }
    }
  }, [location.state, tickets]);

  useRealtimeRefresh({
    refresh: loadTickets,
    channels: [{ name: 'ticket-updates', event: 'ticket.changed' }],
    intervalMs: 30000,
  });

  const availableEmployees = useMemo(() => {
    const set = new Set();
    if (Array.isArray(filterOptions.employees) && filterOptions.employees.length > 0) {
      filterOptions.employees.forEach((e) => {
        const name = typeof e === 'string' ? e : (e.name || `${e.first_name || ''} ${e.last_name || ''}`.trim());
        if (name) set.add(name);
      });
    }
    (tickets || []).forEach((t) => {
      const emp = t.assigned_employee || t.assigned_employee_name || t.assigned_to_name || (typeof t.assigned_to === 'string' ? t.assigned_to : null);
      if (emp && typeof emp === 'string' && emp.trim() && emp.trim().toLowerCase() !== 'unassigned') {
        set.add(emp.trim());
      }
    });
    return Array.from(set).sort();
  }, [filterOptions.employees, tickets]);

  const availablePriorities = useMemo(() => {
    if (filterOptions.priorities && filterOptions.priorities.length > 0) {
      return filterOptions.priorities.map((p) => (typeof p === 'string' ? p : (p.priority_name || p.name || p.label || String(p.priority_ID))));
    }
    const set = new Set();
    (tickets || []).forEach((t) => {
      if (t.priority) set.add(t.priority);
    });
    if (set.size > 0) return Array.from(set);
    return ['Low', 'Medium', 'High', 'Critical'];
  }, [filterOptions.priorities, tickets]);

  const availableMachines = useMemo(() => {
    if (filterOptions.machines && filterOptions.machines.length > 0) {
      return filterOptions.machines.map((m) => {
        if (typeof m === 'string') return m;
        return m.machine_name ? `${m.machine_name}${m.serial_number ? ` - ${m.serial_number}` : ''}` : (m.label || m.name || (m.machine_ID ? `Machine #${m.machine_ID}` : ''));
      }).filter(Boolean);
    }
    const set = new Set();
    (tickets || []).forEach((t) => {
      const m = t.equipment || t.machine_name;
      if (m && m.trim()) set.add(m.trim());
    });
    return Array.from(set).sort();
  }, [filterOptions.machines, tickets]);

  const availableCategories = useMemo(() => {
    if (filterOptions.categories && filterOptions.categories.length > 0) {
      return filterOptions.categories.map((c) => (typeof c === 'string' ? c : (c.category_name || c.name || c.label || String(c.problem_category_ID))));
    }
    const set = new Set();
    (tickets || []).forEach((t) => {
      if (t.category && t.category.trim()) set.add(t.category.trim());
    });
    return Array.from(set).sort();
  }, [filterOptions.categories, tickets]);

  const availableStatuses = useMemo(() => {
    if (filterOptions.statuses && filterOptions.statuses.length > 0) {
      return filterOptions.statuses.map((s) => (typeof s === 'string' ? s : (s.status_name || s.name || s.label || String(s.ticket_status_ID))));
    }
    return isHistory ? HISTORY_STATUSES : ACTIVE_STATUSES;
  }, [filterOptions.statuses, isHistory]);

  const activeFilterList = useMemo(() => {
    const list = [];
    if (filters.keywords) list.push({ key: 'keywords', label: `Keywords: "${filters.keywords}"` });
    if (filters.machine) list.push({ key: 'machine', label: `Machine: ${filters.machine}` });
    if (filters.status) list.push({ key: 'status', label: `Status: ${filters.status}` });
    if (filters.category) list.push({ key: 'category', label: `Category: ${filters.category}` });
    if (filters.priority) list.push({ key: 'priority', label: `Priority: ${filters.priority}` });
    if (filters.employee) list.push({ key: 'employee', label: `Employee: ${filters.employee}` });
    if (filters.date) list.push({ key: 'date', label: `Date: ${filters.date}` });
    return list;
  }, [filters]);

  const visibleTickets = useMemo(() => {
    return tickets.filter((ticket) => {
      const normalizedStatus = ticket.status === 'Discarded by Customer' ? 'Discarded' : ticket.status;
      const isInternal = ticket.is_internal || ticket.ticket_type === 'Internal';
      const hasFeedback = hasFeedbackBeenSubmitted(ticket.id) || hasFeedbackBeenSubmitted(ticket.ticket_ID);
      const isClosedPendingFeedback = ticket.status === 'Closed' && !isInternal && !hasFeedback;

      if (isHistory) {
        if (!HISTORY_STATUSES.includes(ticket.status)) return false;
        // Closed tickets pending feedback stay in My Tickets until feedback is submitted
        if (isClosedPendingFeedback) return false;
      } else {
        // Active "My Tickets"
        if (filters.status) {
          // If the user explicitly selects a status filter like 'Closed' or 'Resolved', respect it
          if (ticket.status !== filters.status) return false;
        } else {
          if (ticket.status === 'Closed') {
            if (!isClosedPendingFeedback) return false;
          } else if (HISTORY_STATUSES.includes(ticket.status) || ['Resolved', 'Discarded', 'Discarded by Customer'].includes(ticket.status)) {
            return false;
          }
        }
      }

      // Keywords filter (matching Ticket ID, Title, Description, Machine/Equipment, Category)
      if (filters.keywords) {
        const kw = filters.keywords.trim().toLowerCase();
        const tid = String(ticket.id || '').toLowerCase();
        const numId = String(ticket.ticket_ID || ticket.id || '').replace(/\D/g, '');
        const cleanKw = kw.replace(/\D/g, '');
        const matches = (
          tid.includes(kw) ||
          (cleanKw && numId.includes(cleanKw)) ||
          (ticket.title && ticket.title.toLowerCase().includes(kw)) ||
          (ticket.description && ticket.description.toLowerCase().includes(kw)) ||
          (ticket.equipment && ticket.equipment.toLowerCase().includes(kw)) ||
          (ticket.machine_name && ticket.machine_name.toLowerCase().includes(kw)) ||
          (ticket.category && ticket.category.toLowerCase().includes(kw))
        );
        if (!matches) return false;
      }

      // Status filter
      if (filters.status && normalizedStatus.toLowerCase() !== filters.status.toLowerCase()) {
        return false;
      }

      // Category filter
      if (filters.category && (ticket.category || '').trim().toLowerCase() !== filters.category.trim().toLowerCase()) {
        return false;
      }

      // Machine filter
      if (filters.machine) {
        const machineFilter = filters.machine.trim().toLowerCase();
        const ticketMachine = (ticket.equipment || ticket.machine_name || '').trim().toLowerCase();
        if (!ticketMachine.includes(machineFilter)) {
          return false;
        }
      }

      // Priority filter
      if (filters.priority && (ticket.priority || 'Medium').trim().toLowerCase() !== filters.priority.trim().toLowerCase()) {
        return false;
      }

      // Employee filter
      if (filters.employee) {
        const empFilter = filters.employee.trim().toLowerCase();
        const empName = getTicketAssignedEmployee(ticket).toLowerCase();
        if (empFilter === 'unassigned') {
          if (empName !== 'unassigned' && empName !== '' && empName !== 'null') {
            return false;
          }
        } else {
          if (!empName.includes(empFilter)) {
            return false;
          }
        }
      }

      // Date filter
      if (filters.date) {
        const ticketDate = ticket.date_created ? new Date(String(ticket.date_created).replace(' ', 'T')) : null;
        if (ticketDate && !isNaN(ticketDate.getTime())) {
          const filterDateStr = filters.date; // "YYYY-MM-DD"
          const year = ticketDate.getFullYear();
          const month = String(ticketDate.getMonth() + 1).padStart(2, '0');
          const day = String(ticketDate.getDate()).padStart(2, '0');
          const ticketDateStr = `${year}-${month}-${day}`;
          if (ticketDateStr !== filterDateStr) {
            return false;
          }
        }
      }

      return true;
    });
  }, [filters, isHistory, tickets]);

  const closeNotif = () => setNotification(null);
  const showSuccess = (title, message) => setNotification({ type: 'success', title, message });
  const showError = (title, message) => setNotification({ type: 'error', title, message });
  const showConfirm = (title, message, onConfirm, opts = {}) => setNotification({ type: 'confirm', title, message, onConfirm, onCancel: closeNotif, ...opts });

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const clearFilter = (key) => {
    setFilters((current) => ({ ...current, [key]: '' }));
  };

  const resetFilters = () => {
    setFilters({
      keywords: '',
      status: '',
      category: '',
      machine: '',
      priority: '',
      employee: '',
      date: '',
    });
  };

  const handleEditDraft = (draft) => {
    navigate('/create-ticket', { state: { draftId: draft.id } });
  };

  const handleDeleteDraft = (draft) => {
    showConfirm(
      'Delete this draft?',
      `Delete "${draft.title || 'Untitled draft'}"? This action cannot be undone.`,
      async () => {
        closeNotif();
        try {
          await deleteTicketDraft(draft.id);
          showSuccess('Draft Deleted', 'The draft has been permanently removed.');
          loadDrafts();
        } catch (err) {
          showError('Error', err?.response?.data?.message || 'Failed to delete draft.');
        }
      },
      { confirmText: 'Delete Draft', confirmClassName: 'bg-red-600 hover:bg-red-700' }
    );
  };

  const customerOpenCount = useMemo(() => {
    return (tickets || []).filter((t) => !t.is_internal && OPEN_STATUS_SET.includes(t.status)).length;
  }, [tickets]);

  const handleCreateTicket = async (payload) => {
    const limitConfig = getMaxOpenTicketsLimit();
    if (!limitConfig.isUnlimited && customerOpenCount >= limitConfig.limit) {
      throw new Error(`You've reached the maximum number of open tickets (${limitConfig.limit}). Resolve or close an existing ticket before submitting another.`);
    }

    setLoadingText('Submitting ticket...');
    setModalLoading(true);
    try {
      const response = await createTicket({
        ...payload,
        created_by: customerId,
      });
      
      const createdId = response.ticket?.ticket_number
        || response.dashboard_ticket?.ticket_number
        || response.ticket_number
        || (response.ticket
          ? 'TKT-' + String(response.ticket.ticket_ID).padStart(4, '0')
          : 'TKT-' + String(response.ticket_ID || 'new').padStart(4, '0'));
        
      const newTicketId = response.ticket?.ticket_ID || response.ticket_ID;
        
      setIsModalOpen(false);
      loadTickets({ forceRefresh: true });
      setNotification({
        type: 'success',
        title: 'Ticket submitted',
        message: `${createdId} has been created successfully.`,
        onClose: () => {
          setNotification(null);
          navigate('/messages', { state: { selectedTicketId: newTicketId } });
        }
      });
    } catch (err) {
      console.error(err);
      showError('Error', err?.response?.data?.message || 'Failed to create ticket.');
    } finally {
      setModalLoading(false);
    }
  };

  const handleConfirmDiscard = async (ticket) => {
    closeNotif();
    if (!ticket) return;

    const isMock = !!ticket.isMock;
    if (isMock) {
      const stored = JSON.parse(localStorage.getItem('customer_created_tickets') || '[]');
      const updatedList = stored.map(t => {
        if (t.id === ticket.id) {
          return { ...t, status: 'Discarded' };
        }
        return t;
      });
      localStorage.setItem('customer_created_tickets', JSON.stringify(updatedList));
      setTickets(updatedList);
      setSelectedTicket(null);
      showSuccess('Ticket discarded', 'Ticket discarded successfully.');
      return;
    }

    try {
      const ticketId = ticket.ticket_ID || parseInt(String(ticket.id || '').replace(/\D/g, ''), 10);
      await discardCustomerTicket(ticketId);
      setSelectedTicket(null);
      showSuccess('Ticket discarded', 'Ticket discarded successfully.');
      loadTickets({ forceRefresh: true });
    } catch (err) {
      console.error('Failed to discard ticket:', err);
      showError('Error', err?.response?.data?.message || 'Failed to discard ticket.');
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
      let localDetails = {};
      try { localDetails = JSON.parse(localStorage.getItem('customer_ticket_details') || '{}')[t.id] || {}; } catch { localDetails = {}; }
      const mergedTimeline = (() => {
        const base = fullTicket.timeline && Array.isArray(fullTicket.timeline) ? [...fullTicket.timeline] : (localDetails.timeline ? [...localDetails.timeline] : []);
        if (localDetails.timeline && fullTicket.timeline) {
          const existingIds = new Set(base.map(x => x.id));
          localDetails.timeline.forEach(evt => { if (!existingIds.has(evt.id)) base.push(evt); });
        } else if (localDetails.timeline && !fullTicket.timeline) {
          return localDetails.timeline;
        }
        return base.length ? base : undefined;
      })();
      setSelectedTicket({
        ...t,
        ...localDetails,
        ...fullTicket,
        openDirectChat: Boolean(t?.openDirectChat),
        status: fullTicket.status || t.status || localDetails.status,
        description: fullTicket.description || localDetails.description || t.description || '',
        last_updated: fullTicket.updated_at || fullTicket.last_updated || localDetails.last_updated || t.last_updated,
        updated_at: fullTicket.updated_at || localDetails.last_updated,
        timeline: mergedTimeline || fullTicket.timeline || localDetails.timeline,
        resolved_at: fullTicket.resolved_at || t.resolved_at || localDetails.resolved_at || null,
        closed_at: fullTicket.closed_at || t.closed_at || localDetails.closed_at || null,
        proofAttachments: fullTicket.proofAttachments || [],
        proofFiles: fullTicket.proofFiles || [],
        attachments: fullTicket.attachments || fullTicket.ticket_attachments || t.attachments || localDetails.attachments || [],
        can_discard: (fullTicket.status || t.status) === 'Open' && !fullTicket.assigned_to,
      });

      try {
        const storedAll = JSON.parse(localStorage.getItem('customer_ticket_details') || '{}');
        storedAll[t.id] = {
          ...storedAll[t.id],
          ...fullTicket,
          status: fullTicket.status || t.status,
        };
        localStorage.setItem('customer_ticket_details', JSON.stringify(storedAll));
      } catch { /* ignore */ }
    } catch (err) {
      console.error('Failed to load ticket details:', err);
      setSelectedTicket(t);
    } finally {
      setModalLoading(false);
    }
  };

  const handleResolveTicket = async (ticketId) => {
    const isMock = selectedTicket ? !!selectedTicket.isMock : false;
    if (isMock) {
      const stored = JSON.parse(localStorage.getItem('customer_created_tickets') || '[]');
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
      localStorage.setItem('customer_created_tickets', JSON.stringify(updatedList));
      setTickets(updatedList);
      setSelectedTicket(null);
      showSuccess('Ticket resolved', 'Ticket resolved successfully.');
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
      showSuccess('Ticket resolved', 'Ticket resolved successfully.');
      loadTickets({ forceRefresh: true });
    } catch (err) {
      console.error('Failed to resolve ticket:', err);
      showError('Error', err?.response?.data?.message || 'Failed to resolve ticket.');
    } finally {
      setModalLoading(false);
    }
  };

  const handleCloseTicket = async (ticketId) => {
    const isMock = selectedTicket ? !!selectedTicket.isMock : false;
    if (isMock) {
      const stored = JSON.parse(localStorage.getItem('customer_created_tickets') || '[]');
      const updatedList = stored.map(t => {
        if (t.id === ticketId || t.ticket_ID === ticketId) {
          const timestamp = new Date().toISOString();
          const timeline = t.timeline || [
            { id: 'creation', type: 'system', text: 'Ticket created.', timestamp: t.date_created }
          ];
          return {
            ...t,
            status: 'Closed',
            resolved_at: timestamp,
            last_updated: timestamp,
            timeline: [
              ...timeline,
              {
                id: `status-closed-${Date.now()}`,
                type: 'status',
                text: 'Ticket closed by creator.',
                timestamp,
              }
            ]
          };
        }
        return t;
      });
      localStorage.setItem('customer_created_tickets', JSON.stringify(updatedList));
      setTickets(updatedList);
      setSelectedTicket(null);
      showSuccess('Ticket closed', 'Ticket closed successfully.');
      return;
    }

    setLoadingText('Closing ticket...');
    setModalLoading(true);
    try {
      const numericId = Number(String(ticketId).replace(/\D/g, ''));
      await updateTicket({
        ticketId: numericId,
        statusId: 4, // Closed
      });
      setSelectedTicket(null);
      showSuccess('Ticket closed', 'Ticket closed successfully.');
      loadTickets({ forceRefresh: true });
    } catch (err) {
      console.error('Failed to close ticket:', err);
      showError('Error', err?.response?.data?.message || 'Failed to close ticket.');
    } finally {
      setModalLoading(false);
    }
  };

  const canEditTicket = (t) => {
    if (!t) return false;
    const s = (t.status || '').trim();
    const hasAssignee = !!(t.assigned_to || t.assigned_employee || t.assigned_to_emp_id);
    return s === 'Open' && !hasAssignee;
  };

  const handleEditTicket = async (ticket) => {
    if (!canEditTicket(ticket)) {
      showError('Cannot Edit Ticket', 'Tickets can only be edited while Open and not yet assigned to an employee.');
      return;
    }

    setEditTitle(ticket.title || '');
    setEditDescription(ticket.description || '');
    setEditCategory(ticket.problem_category_ID || ticket.problemCategoryId || '');
    setEditEquipment(ticket.machine_ID || ticket.machineId || '');
    setEditingTicket(ticket);
    setOpenMenuId(null);

    let opts = getCachedTicketFormOptions();
    if (!opts) {
    }
    setEditOptions(opts);

    const inferIds = (options) => {
      if (!options) return;
      const catList = options.problem_categories || options.category_options || [];
      const eqList = options.machines || options.equipment_options || [];
      if (!ticket.problem_category_ID && !ticket.problemCategoryId && ticket.category) {
        const found = catList.find(c => (c.category_name || c.label || c.name) === ticket.category);
        if (found) setEditCategory(String(found.problem_category_ID || found.value));
      }
      if (!ticket.machine_ID && !ticket.machineId && ticket.equipment) {
        const found = eqList.find(m => {
          const label = m.machine_name ? `${m.machine_name} - ${m.serial_number}` : (m.label || '');
          return label === ticket.equipment || m.machine_name === ticket.equipment;
        });
        if (found) setEditEquipment(String(found.machine_ID || found.value));
      }
    };

    inferIds(opts);

    if (!ticket.problem_category_ID && !ticket.machine_ID && ticket.ticket_ID) {
      try {
        const details = await getTicketDetails(ticket.ticket_ID || parseInt(String(ticket.id || '').replace(/\D/g, ''), 10));
        if (details?.problem_category_ID) setEditCategory(String(details.problem_category_ID));
        if (details?.machine_ID) setEditEquipment(String(details.machine_ID));
        if (details?.title) setEditTitle(details.title);
        if (details?.description) setEditDescription(details.description);
        if (details?.problem_category_ID || details?.machine_ID) {
          let freshOpts = opts;
          if (!freshOpts) {
            try { freshOpts = await getTicketFormOptions(); setEditOptions(freshOpts); } catch { /* ignore */ }
          }
          inferIds(freshOpts);
        }
      } catch { /* ignore */ }
    }
    setEditOptions(opts);
  };

  const handleSaveEdit = () => {
    if (!editingTicket) return;
    const titleTrimmed = (editTitle || '').trim();
    if (!titleTrimmed) {
      showError('Validation Error', 'Ticket title is required.');
      return;
    }

    if (needsProperCasing(titleTrimmed)) {
      const proper = formatProperTitleCase(titleTrimmed);
      setTitleCasingData({
        original: titleTrimmed,
        formatted: proper,
      });
      setShowTitleCasingModal(true);
      return;
    }

    showConfirm(
      'Update this ticket?',
      'Are you sure you want to save the changes to this ticket?',
      () => executeSaveEdit(titleTrimmed),
      { confirmText: 'Update Ticket', confirmClassName: 'bg-[#252578] hover:bg-[#1f1f66]' }
    );
  };

  const handleConfirmTitleCasing = () => {
    if (!titleCasingData) return;
    const formatted = titleCasingData.formatted;
    setEditTitle(formatted);
    setShowTitleCasingModal(false);
    showConfirm(
      'Update this ticket?',
      `Are you sure you want to save the changes with formatted title "${formatted}"?`,
      () => executeSaveEdit(formatted),
      { confirmText: 'Update Ticket', confirmClassName: 'bg-[#252578] hover:bg-[#1f1f66]' }
    );
  };

  const executeSaveEdit = async (overrideTitle) => {
    if (!editingTicket) return;
    const ticket = editingTicket;
    const normalizedTitle = normalizeCasing(editTitle);
    const normalizedDesc = normalizeCasing(editDescription);
    if (!normalizedTitle.trim() || normalizedTitle.trim().length < 5) {
      showError('Validation error', 'Title must be at least 5 characters.');
      return;
    }
    if (!normalizedDesc.trim() || normalizedDesc.trim().length < 20) {
      showError('Validation error', 'Description must be at least 20 characters.');
      return;
    }
    const isMock = !!ticket.isMock;
    const finalTitle = overrideTitle || editTitle;

    if (isMock) {
      const stored = JSON.parse(localStorage.getItem('customer_created_tickets') || '[]');
      const timestamp = new Date().toISOString();
      const categoryLabel = (() => {
        if (!editCategory) return ticket.category;
        const list = editOptions?.problem_categories || editOptions?.category_options || [];
        const found = list.find(c => String(c.problem_category_ID || c.value) === String(editCategory));
        return found ? (found.category_name || found.label || found.name) : ticket.category;
      })();
      const equipmentLabel = (() => {
        if (!editEquipment) return ticket.equipment;
        const list = editOptions?.machines || editOptions?.equipment_options || [];
        const found = list.find(m => String(m.machine_ID || m.value) === String(editEquipment));
        return found ? (found.machine_name ? `${found.machine_name} - ${found.serial_number}` : found.label) : ticket.equipment;
      })();
      const changes = [];
      if (normalizedTitle !== ticket.title) changes.push('title');
      if (normalizedDesc !== ticket.description) changes.push('description');
      if (editCategory && String(editCategory) !== String(ticket.problem_category_ID || '')) changes.push('category');
      if (editEquipment && String(editEquipment) !== String(ticket.machine_ID || '')) changes.push('equipment');
      const updatedList = stored.map(t => {
        if (t.id === ticket.id) {
          const timeline = t.timeline || [{ id: 'creation', type: 'system', text: 'Ticket created.', timestamp: t.date_created }];
          return { ...t, title: finalTitle, description: editDescription, category: categoryLabel, equipment: equipmentLabel, problem_category_ID: editCategory || t.problem_category_ID, machine_ID: editEquipment || t.machine_ID, last_updated: timestamp, updated_at: timestamp, timeline: [...timeline, { id: `update-${Date.now()}`, type: 'status', text: `Ticket details updated${changes.length ? `: ${changes.join(', ')}` : ''}.`, timestamp }] };
        }
        return t;
      });
      localStorage.setItem('customer_created_tickets', JSON.stringify(updatedList));
      setTickets(updatedList);
      setEditingTicket(null);
      showSuccess('Ticket updated', 'Ticket details updated successfully. Last updated: ' + formatDisplayDate(timestamp));
      return;
    }

    setLoadingText('Updating ticket...');
    setModalLoading(true);
    try {
      const numericId = ticket.ticket_ID || parseInt(String(ticket.id || '').replace(/\D/g, ''), 10);
      const payload = {
        ticketId: numericId,
        title: finalTitle,
        description: editDescription,
      };
      if (editCategory) payload.problem_category_ID = editCategory;
      if (editEquipment) payload.machine_ID = editEquipment;
      await updateTicket(payload);
      const timestamp = new Date().toISOString();
      try {
        const existing = JSON.parse(localStorage.getItem('customer_ticket_details') || '{}');
        const key = ticket.id;
        const prev = existing[key] || {};
        const categoryLabel = (() => {
          if (!editCategory) return prev.category || ticket.category;
          const list = editOptions?.problem_categories || editOptions?.category_options || [];
          const found = list.find(c => String(c.problem_category_ID || c.value) === String(editCategory));
          return found ? (found.category_name || found.label || found.name) : ticket.category;
        })();
        const equipmentLabel = (() => {
          if (!editEquipment) return prev.equipment || ticket.equipment;
          const list = editOptions?.machines || editOptions?.equipment_options || [];
          const found = list.find(m => String(m.machine_ID || m.value) === String(editEquipment));
          return found ? (found.machine_name ? `${found.machine_name} - ${found.serial_number}` : found.label) : ticket.equipment;
        })();
        const changes = [];
        if (normalizedTitle !== ticket.title) changes.push('title');
        if (normalizedDesc !== ticket.description) changes.push('description');
        if (editCategory && String(editCategory) !== String(ticket.problem_category_ID || '')) changes.push('category');
        if (editEquipment && String(editEquipment) !== String(ticket.machine_ID || '')) changes.push('equipment');
        const newEvent = { id: `update-${Date.now()}`, type: 'status', text: `Ticket details updated${changes.length ? `: ${changes.join(', ')}` : ''}.`, timestamp };
        const priorTimeline = prev.timeline || [];
        existing[key] = { ...prev, title: normalizedTitle, description: normalizedDesc, category: categoryLabel, equipment: equipmentLabel, last_updated: timestamp, timeline: [...priorTimeline, newEvent] };
        localStorage.setItem('customer_ticket_details', JSON.stringify(existing));
      } catch { /* ignore */ }
      setEditingTicket(null);
      showSuccess('Ticket updated', 'Ticket details updated successfully.');
      loadTickets({ forceRefresh: true });
    } catch (err) {
      console.error('Failed to update ticket:', err);
      showError('Error', err?.response?.data?.message || 'Failed to update ticket.');
    } finally {
      setModalLoading(false);
    }
  };

  const handleDeleteTicket = (ticket) => {
    setOpenMenuId(null);
    showConfirm('Discard this ticket?', `This will mark ${ticket.id} as Discarded.`, () => handleConfirmDiscard(ticket), { confirmText: 'Discard', confirmClassName: 'bg-red-600 hover:bg-red-700' });
  };

  const handleReopenTicket = async (ticketId, reason) => {
    const isMock = selectedTicket ? !!selectedTicket.isMock : false;
    if (isMock) {
      const stored = JSON.parse(localStorage.getItem('customer_created_tickets') || '[]');
      const timestamp = new Date().toISOString();
      const updatedList = stored.map(t => {
        if (t.id === ticketId || t.ticket_ID === ticketId) {
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
      localStorage.setItem('customer_created_tickets', JSON.stringify(updatedList));
      setTickets(updatedList);
      showSuccess('Ticket reopened', 'Ticket reopened successfully.');
      return { success: true };
    }

    try {
      const numericId = Number(String(ticketId).replace(/\D/g, ''));
      const res = await reopenTicket(numericId, reason);
      showSuccess('Ticket reopened', 'Ticket reopened successfully.');
      loadTickets({ forceRefresh: true });
      return res;
    } catch (err) {
      console.error('Failed to reopen ticket:', err);
      const msg = err?.response?.data?.message || 'Failed to reopen ticket.';
      showError('Error', msg);
      throw err;
    }
  };

  return (
    <div className="flex flex-col gap-6 font-sans text-dark-slate">
      <PageHeader
        title={isHistory ? 'Ticket History' : 'My Tickets'}
        subtitle={isHistory ? 'Review completed and discarded tickets.' : 'Track and manage your submitted support tickets.'}
        actions={
          !isHistory && (
            <Button
              onClick={() => navigate('/ai-support', { state: { startNewChat: true } })}
              icon={<Plus className="h-4 w-4" />}
            >
              Create Ticket
            </Button>
          )
        }
      />

      {!isHistory && (
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
      )}

      {activeTab !== 'drafts' ? (
        <>
          {/* ─── Search & Filter Bar ─── */}
          <div className="rounded-2xl border border-gray-150 bg-white p-4 shadow-sm space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
              {/* 1. Keywords Search */}
              <div className="relative">
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Keywords</label>
                <div className="relative">
                  <input
                    type="text"
                    aria-label="Search by keywords"
                    placeholder="Search keywords, ID, title..."
                    value={filters.keywords}
                    onChange={(e) => updateFilter('keywords', e.target.value)}
                    className="w-full rounded-xl border border-gray-200 pl-8 pr-7 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-[#252578] focus:border-transparent transition"
                  />
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  {filters.keywords && (
                    <button
                      type="button"
                      aria-label="Clear keywords filter"
                      onClick={() => clearFilter('keywords')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5 rounded cursor-pointer"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>

              {/* 2. Machine Dropdown */}
              <div className="relative">
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Machine</label>
                <div className="relative">
                  <select
                    aria-label="Filter by machine"
                    value={filters.machine}
                    onChange={(e) => updateFilter('machine', e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-[#252578] focus:border-transparent transition bg-white appearance-none pr-7"
                  >
                    <option value="">All Machines</option>
                    {availableMachines.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  {filters.machine ? (
                    <button
                      type="button"
                      aria-label="Clear machine filter"
                      onClick={() => clearFilter('machine')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5 rounded cursor-pointer"
                    >
                      <X size={13} />
                    </button>
                  ) : (
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none text-[10px]">▼</span>
                  )}
                </div>
              </div>

              {/* 3. Status Dropdown */}
              <div className="relative">
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Status</label>
                <div className="relative">
                  <select
                    aria-label="Filter by status"
                    value={filters.status}
                    onChange={(e) => updateFilter('status', e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-[#252578] focus:border-transparent transition bg-white appearance-none pr-7"
                  >
                    <option value="">All Statuses</option>
                    {availableStatuses.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  {filters.status ? (
                    <button
                      type="button"
                      aria-label="Clear status filter"
                      onClick={() => clearFilter('status')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5 rounded cursor-pointer"
                    >
                      <X size={13} />
                    </button>
                  ) : (
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none text-[10px]">▼</span>
                  )}
                </div>
              </div>

              {/* 4. Category Dropdown */}
              <div className="relative">
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Category</label>
                <div className="relative">
                  <select
                    aria-label="Filter by category"
                    value={filters.category}
                    onChange={(e) => updateFilter('category', e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-[#252578] focus:border-transparent transition bg-white appearance-none pr-7"
                  >
                    <option value="">All Categories</option>
                    {availableCategories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  {filters.category ? (
                    <button
                      type="button"
                      aria-label="Clear category filter"
                      onClick={() => clearFilter('category')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5 rounded cursor-pointer"
                    >
                      <X size={13} />
                    </button>
                  ) : (
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none text-[10px]">▼</span>
                  )}
                </div>
              </div>

              {/* 5. Priority Dropdown */}
              <div className="relative">
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Priority</label>
                <div className="relative">
                  <select
                    aria-label="Filter by priority"
                    value={filters.priority}
                    onChange={(e) => updateFilter('priority', e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-[#252578] focus:border-transparent transition bg-white appearance-none pr-7"
                  >
                    <option value="">All Priorities</option>
                    {availablePriorities.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                  {filters.priority ? (
                    <button
                      type="button"
                      aria-label="Clear priority filter"
                      onClick={() => clearFilter('priority')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5 rounded cursor-pointer"
                    >
                      <X size={13} />
                    </button>
                  ) : (
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none text-[10px]">▼</span>
                  )}
                </div>
              </div>

              {/* 6. Employee Dropdown */}
              <div className="relative">
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Employee</label>
                <div className="relative">
                  <select
                    aria-label="Filter by employee"
                    value={filters.employee}
                    onChange={(e) => updateFilter('employee', e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-[#252578] focus:border-transparent transition bg-white appearance-none pr-7"
                  >
                    <option value="">All Employees</option>
                    <option value="Unassigned">Unassigned</option>
                    {availableEmployees.map((emp) => (
                      <option key={emp} value={emp}>{emp}</option>
                    ))}
                  </select>
                  {filters.employee ? (
                    <button
                      type="button"
                      aria-label="Clear employee filter"
                      onClick={() => clearFilter('employee')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5 rounded cursor-pointer"
                    >
                      <X size={13} />
                    </button>
                  ) : (
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none text-[10px]">▼</span>
                  )}
                </div>
              </div>

              {/* 7. Date Picker */}
              <div className="relative">
                <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Date</label>
                <div className="relative">
                  <input
                    type="date"
                    aria-label="Filter by date"
                    value={filters.date}
                    onChange={(e) => updateFilter('date', e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-[#252578] focus:border-transparent transition bg-white"
                  />
                  {filters.date && (
                    <button
                      type="button"
                      aria-label="Clear date filter"
                      onClick={() => clearFilter('date')}
                      className="absolute right-7 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5 rounded cursor-pointer"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Active Filter Badges + Reset Actions */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-gray-100 text-xs">
              <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-[240px]">
                {activeFilterList.map((item) => (
                  <span
                    key={item.key}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-50 text-[#252578] border border-blue-200/60 animate-in fade-in duration-150"
                  >
                    <span>{item.label}</span>
                    <button
                      type="button"
                      aria-label={`Remove filter ${item.label}`}
                      onClick={() => clearFilter(item.key)}
                      className="hover:bg-blue-200/60 rounded-full p-0.5 transition cursor-pointer"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
                {activeFilterList.length === 0 && (
                  <span className="text-gray-400 text-xs">No active filters</span>
                )}
              </div>

              <div className="flex items-center gap-2 ml-auto shrink-0">
                <span className="text-gray-400 text-[11px]">
                  Showing <strong className="text-gray-700">{visibleTickets.length}</strong> of {tickets.length}
                </span>
                {activeFilterList.length > 0 && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition cursor-pointer"
                  >
                    <RotateCcw size={12} /> Reset all filters
                  </button>
                )}
              </div>
            </div>
          </div>

          {error && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold flex items-center justify-between">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => loadTickets({ forceRefresh: true })}
                className="underline hover:no-underline text-xs"
              >
                Retry
              </button>
            </div>
          )}

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-surface shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[110px]">Ticket ID</TableHead>
                  <TableHead className="min-w-[220px]">Title & Summary</TableHead>
                  <TableHead className="min-w-[140px]">Equipment</TableHead>
                  <TableHead className="w-[100px]">Priority</TableHead>
                  <TableHead className="w-[170px] min-w-[155px]">Status</TableHead>
                  <TableHead className="min-w-[140px]">Assigned Employee</TableHead>
                  <TableHead className="w-[130px]">Date Created</TableHead>
                  <TableHead className="w-[130px]">Last Updated</TableHead>
                  <TableHead className="w-[70px] text-center">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleTickets.length === 0 && loading && (
                  <DataTableSkeleton columns={9} rows={5} />
                )}
                {visibleTickets.length === 0 && !loading && (
                  <DataTableEmptyState
                    colSpan={9}
                    title="No tickets match your criteria"
                    description="Try adjusting your search keywords or clearing active filters."
                    action={
                      activeFilterList.length > 0 && (
                        <Button variant="outline" size="sm" onClick={resetFilters} icon={<RotateCcw className="h-3.5 w-3.5" />}>
                          Clear all filters
                        </Button>
                      )
                    }
                  />
                )}
                {visibleTickets.map((ticket, idx) => {
                  const assignedEmpDisplay = getTicketAssignedEmployee(ticket);

                  return (
                    <TableRow
                      key={ticket.id || ticket.ticket_ID || `ticket-${idx}`}
                      className="cursor-pointer"
                      onClick={() => handleViewTicket(ticket)}
                    >
                      <TableCell className="font-semibold text-brand-primary whitespace-nowrap">
                        {ticket.id}
                      </TableCell>
                      <TableCell className="max-w-[260px]">
                        <div className="truncate font-medium text-dark-slate" title={ticket.title}>{ticket.title}</div>
                        <div className="truncate max-w-[240px] text-xs text-muted-slate md:hidden" title={ticket.description}>{ticket.description}</div>
                      </TableCell>
                      <TableCell className="text-muted-slate max-w-[160px] truncate" title={ticket.equipment || ticket.category}>
                        {ticket.equipment || ticket.category || '—'}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${priorityColors[ticket.priority] ?? 'bg-gray-100 text-gray-700'}`}>
                          {ticket.priority || 'Low'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <Badge variant={getStatusBadgeVariant(ticket.status)}>
                            {ticket.status}
                          </Badge>
                          {(hasFeedbackBeenSubmitted(ticket.id) || hasFeedbackBeenSubmitted(ticket.ticket_ID)) && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                              ★ Rated
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-slate max-w-[200px]" title={assignedEmpDisplay}>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <User size={13} className="text-muted-slate shrink-0" />
                            <span className="truncate">{assignedEmpDisplay}</span>
                          </div>
                          {assignedEmpDisplay !== 'Unassigned' && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleViewTicket({ ...ticket, openDirectChat: true });
                              }}
                              className="inline-flex items-center gap-1 rounded-lg bg-[#252578]/10 hover:bg-[#252578] text-[#252578] hover:text-white px-2 py-0.5 text-[11px] font-semibold transition-all shrink-0 cursor-pointer"
                              title={`Open message with ${assignedEmpDisplay}`}
                            >
                              <MessageCircle size={12} />
                              <span>Message</span>
                            </button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-slate text-xs whitespace-nowrap">
                        {formatDisplayDate(ticket.date_created)}
                      </TableCell>
                      <TableCell className="text-muted-slate text-xs whitespace-nowrap">
                        {formatDisplayDate(ticket.last_updated)}
                      </TableCell>
                      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="rounded-full p-2 text-muted-slate hover:bg-page hover:text-dark-slate transition-colors cursor-pointer"
                              aria-label="Actions"
                            >
                              <MoreVertical size={16} />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {isHistory ? (
                              <>
                                <DropdownMenuItem
                                  onClick={() => handleViewTicket(ticket)}
                                  disabled={ticket.status !== 'Closed'}
                                >
                                  Reopen
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  destructive
                                  onClick={() => handleDeleteTicket(ticket)}
                                >
                                  Delete
                                </DropdownMenuItem>
                              </>
                            ) : (
                              <>
                                {canEditTicket(ticket) && (
                                  <DropdownMenuItem onClick={() => handleEditTicket(ticket)}>
                                    Edit
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  destructive
                                  onClick={() => handleDeleteTicket(ticket)}
                                >
                                  Discard
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      ) : (
        /* ─── My Drafts Tab (TS020) ─── */
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
              <button
                type="button"
                onClick={() => navigate('/create-ticket')}
                disabled={drafts.length >= 10}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#252578] hover:bg-[#1f1f66] disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition cursor-pointer"
              >
                + New Ticket
              </button>
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
                    <Button size="sm" onClick={() => navigate('/create-ticket')} icon={<Plus className="h-3.5 w-3.5" />}>
                      Create New Ticket
                    </Button>
                  }
                />
              )}
              {drafts.map((draft) => (
                <TableRow key={draft.id}>
                  <TableCell className="max-w-[280px]">
                    <div className="truncate font-semibold text-dark-slate" title={draft.title}>
                      {draft.title || 'Untitled draft'}
                    </div>
                    {draft.description && (
                      <div className="text-xs text-muted-slate truncate mt-0.5">
                        {draft.description}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-slate">
                    {draft.machine_ID ? `Equipment #${draft.machine_ID}` : '—'}
                  </TableCell>
                  <TableCell className="text-muted-slate">
                    {draft.problem_category_ID ? `Category #${draft.problem_category_ID}` : '—'}
                  </TableCell>
                  <TableCell className="text-muted-slate text-xs whitespace-nowrap">
                    {formatDisplayDate(draft.last_saved_at || draft.updated_at)}
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
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreateTicket}
        openTicketsCount={customerOpenCount}
        onDraftSaved={() => {
          setActiveTab('drafts');
          setSearchParams({ tab: 'drafts' });
          loadDrafts();
        }}
      />
      <CustomerTicketDetailModal
        ticket={selectedTicket}
        onClose={() => setSelectedTicket(null)}
        onDiscard={(ticket) => showConfirm('Discard this ticket?', `This will mark ${ticket.id} as Discarded.`, () => handleConfirmDiscard(ticket), { confirmText: 'Discard', confirmClassName: 'bg-red-600 hover:bg-red-700' })}
        onReopen={(ticketId, reason) => handleReopenTicket(ticketId, reason)}
        onResolve={(ticketId) => handleCloseTicket(ticketId)}
        customerName={effectiveUser?.name || effectiveUser?.first_name ? `${effectiveUser.first_name}${effectiveUser.last_name ? ' ' + effectiveUser.last_name : ''}` : 'Customer'}
        allowReopen={true}
        isHistoryView={isHistory}
        onFeedbackSubmitted={() => {
          setFeedbackVersion((v) => v + 1);
          loadTickets({ forceRefresh: true });
        }}
      />

      {editingTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px] animate-in fade-in duration-200">
          <div className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-surface shadow-level-4">
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5 shrink-0 bg-surface">
              <div>
                <h2 className="text-xl font-bold text-dark-slate">Edit Ticket</h2>
                <p className="mt-0.5 text-xs font-semibold text-brand-primary">{editingTicket.id}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingTicket(null)}
                className="rounded-full p-2 text-muted-slate hover:bg-page hover:text-dark-slate transition-colors cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5 text-dark-slate">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-slate">Title</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={(e) => { const n = normalizeCasing(e.target.value); if (n !== e.target.value) { setEditTitle(n); e.target.value = n; } }}
                  placeholder={editingTicket.title || 'Enter title'}
                  className="w-full rounded-xl border border-gray-200 bg-surface px-4 py-2.5 text-sm text-dark-slate outline-none transition-all placeholder:text-muted-slate/60 focus:border-transparent focus:ring-2 focus:ring-brand-accent"
                />
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="min-w-0 md:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-slate">Category</p>
                  {editOptions ? (
                    <select
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                      title={editingTicket.category || ''}
                      className="mt-1 w-full rounded-xl border border-gray-200 bg-surface px-3 py-2 text-sm text-dark-slate outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-brand-accent"
                    >
                      <option value="">{editingTicket.category ? `Current: ${editingTicket.category}` : 'Select category'}</option>
                      {(editOptions.problem_categories || editOptions.category_options || []).map((cat) => (
                        <option key={cat.problem_category_ID || cat.value} value={cat.problem_category_ID || cat.value} title={cat.category_name || cat.label || cat.name}>
                          {cat.category_name || cat.label || cat.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="mt-1 text-sm text-dark-slate break-words">{editingTicket.category}</p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-slate">Status</p>
                  <p className="mt-1 text-sm font-semibold text-dark-slate">
                    {!editingTicket.assigned_to && editingTicket.status === 'In Progress' ? 'Open' : editingTicket.status}
                  </p>
                </div>
                <div className="min-w-0 md:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-slate">Equipment</p>
                  {editOptions ? (
                    <select
                      value={editEquipment}
                      onChange={(e) => setEditEquipment(e.target.value)}
                      title={editingTicket.equipment || ''}
                      className="mt-1 w-full rounded-xl border border-gray-200 bg-surface px-3 py-2 text-sm text-dark-slate outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-brand-accent"
                    >
                      <option value="">{editingTicket.equipment ? `Current: ${editingTicket.equipment}` : 'Select equipment'}</option>
                      {(editOptions.equipment_options || editOptions.machines || []).map((m) => {
                        const optVal = m.machine_ID || m.value || '';
                        const optLabel = m.machine_name ? `${m.machine_name}${m.serial_number ? ` - ${m.serial_number}` : ''}` : (typeof m.label === 'string' ? m.label : (m.name || `Machine #${optVal}`));
                        return (
                          <option key={optVal || optLabel} value={optVal} title={optLabel}>
                            {optLabel}
                          </option>
                        );
                      })}
                    </select>
                  ) : (
                    <p className="mt-1 text-sm text-dark-slate break-words">{editingTicket.equipment}</p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-slate">Date Created</p>
                  <p className="mt-1 text-sm text-dark-slate">{formatDate(editingTicket.date_created)}</p>
                </div>
              </div>
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-slate">Description</label>
                <textarea
                  rows="4"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  onBlur={(e) => { const n = normalizeCasing(e.target.value); if (n !== e.target.value) { setEditDescription(n); e.target.value = n; } }}
                  placeholder={editingTicket.description || 'Enter description'}
                  className="w-full resize-none rounded-xl border border-gray-200 bg-surface px-4 py-2.5 text-sm text-dark-slate outline-none transition-all placeholder:text-muted-slate/60 focus:border-transparent focus:ring-2 focus:ring-brand-accent"
                />
              </div>
            </div>
            <div className="border-t border-slate-200 px-6 py-4 shrink-0 flex justify-end gap-3 bg-surface">
              <Button variant="outline" onClick={() => setEditingTicket(null)}>
                Cancel
              </Button>
              <Button onClick={handleSaveEdit}>
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}

      <TitleCasingModal
        isOpen={showTitleCasingModal}
        originalTitle={titleCasingData?.original}
        formattedTitle={titleCasingData?.formatted}
        onConfirm={handleConfirmTitleCasing}
        onCancel={() => setShowTitleCasingModal(false)}
      />

      <NotificationModal
        isOpen={!!notification}
        type={notification?.type}
        title={notification?.title}
        message={notification?.message}
        onClose={notification?.onClose || closeNotif}
        onConfirm={notification?.onConfirm}
        onCancel={notification?.onCancel}
        confirmText={notification?.confirmText}
        confirmClassName={notification?.confirmClassName}
      />

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
