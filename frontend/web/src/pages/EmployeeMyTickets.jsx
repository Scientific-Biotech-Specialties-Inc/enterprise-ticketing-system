import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Filter, Plus, Search, Eye, Inbox, AlertTriangle } from 'lucide-react';
import TicketModal from '@/components/TicketModal';
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
} from '@/services/ticketService';
import { statusColors } from '@/constants/employeeTickets';
import { getMaxOpenTicketsLimit, OPEN_STATUS_SET } from '@/data/ticketLimitConfig';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { DataTableSkeleton, DataTableEmptyState } from '@/components/ui/data-table';
import { ConfirmationModal } from '@/components/ui/confirmation-modal';

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

  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [confirmCreated, setConfirmCreated] = useState(null);
  const [confirmDiscard, setConfirmDiscard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modalLoading, setModalLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('Loading...');
  const [error, setError] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const isHistory = false;
  // CS delegation state
  const [csAssignTicket, setCsAssignTicket] = useState(null);
  const [csEmployees, setCsEmployees] = useState([]);
  const [csDepartments, setCsDepartments] = useState([]);
  const [csPriorityOptions] = useState(['Low', 'Medium', 'High', 'Critical']);
  const storageKey = roleContext === 'cs' ? 'cs_created_tickets' : 'employee_created_tickets';

  const [filters, setFilters] = useState({
    status: '',
    category: '',
    dateFrom: '',
    dateTo: '',
    search: '',
  });

  const [employees, setEmployees] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [assignModalTicket, setAssignModalTicket] = useState(null);

  useEffect(() => {
    if (roleContext === 'cs') {
      const loadAssignOptions = async () => {
        try {
          const [emps, depts] = await Promise.all([
            getAssignableEmployees(),
            getDepartments(),
          ]);
          setEmployees(emps.map(row => ({
            id: Number(row.id ?? row.emp_id),
            name: row.name || `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.email,
            status: row.is_active ? 'active' : 'inactive',
            department: row.department?.trim() || 'Unassigned',
          })));
          const allowedDepts = ['Customer Service', 'IT', 'Service'];
          const filteredDepts = (depts || []).filter(d => allowedDepts.includes(d.name));
          setDepartments(filteredDepts);
        } catch (err) {
          console.error('Failed to load assign options for CS:', err);
        }
      };
      loadAssignOptions();
    }
  }, [roleContext]);

  const loadTickets = useCallback(async ({ forceRefresh = false } = {}) => {
    setLoading(true);
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
        if (roleContext === 'cs') {
          throw apiErr;
        }
      }

      if (roleContext !== 'cs' && mapped.length === 0) {
        let stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
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
          localStorage.setItem(storageKey, JSON.stringify(mapped));
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
    if (roleContext !== 'cs') return;
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
  }, [roleContext]);

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
      if (filters.dateFrom && new Date(ticket.date_created) < new Date(filters.dateFrom)) return false;
      if (filters.dateTo && new Date(ticket.date_created) > new Date(`${filters.dateTo}T23:59:59`)) return false;

      const search = filters.search.trim().toLowerCase();
      if (!search) return true;
      return ticket.id.toLowerCase().includes(search) || ticket.title.toLowerCase().includes(search);
    });
  }, [filters, isHistory, tickets]);

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

      const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const updatedList = [
        newTicket,
        ...stored.filter((ticket) => ticket.id !== newTicket.id && ticket.ticket_ID !== numericTicketId),
      ];

      localStorage.setItem(storageKey, JSON.stringify(updatedList));
      setTickets(updatedList);
      setIsModalOpen(false);

      // CS: immediately open delegation modal instead of success dialog
      if (roleContext === 'cs') {
        // Refresh employees list before showing modal
        const emps = await getAssignableEmployees({ forceRefresh: true }).catch(() => csEmployees);
        const mappedEmps = (emps || []).map((row) => ({
          id: Number(row.id ?? row.emp_id),
          name: row.name || `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.email,
          status: row.is_active ? 'active' : 'inactive',
          department: row.department?.trim() || 'Unassigned',
        }));
        setCsEmployees(mappedEmps);
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
      await assignTicketToEmployees({
        ticketId: updated.ticket_ID,
        employeeIds: updated.assigned,
        assignedByEmail: user?.email,
        priorityId: priorityMap[updated.priority] ?? 1,
      });
      setCsAssignTicket(null);
      setConfirmCreated(updated);
    } catch (err) {
      console.error('Failed to assign ticket:', err);
      window.alert(err?.response?.data?.message || 'Failed to assign ticket.');
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

  const handleViewTicket = (t) => {
    const ticketId = t.ticket_ID || parseInt(String(t.id || '').replace(/\D/g, ''), 10);
    const basePath = roleContext === 'cs' ? '/cs' : roleContext === 'it_manager' ? '/it-manager' : '/employee';
    const backPath = roleContext === 'cs' ? '/cs/my-tickets' : roleContext === 'it_manager' ? '/it-manager/my-tickets' : '/employee/my-tickets';
    navigate(`${basePath}/history/${ticketId}`, { state: { ticket: t, backPath } });
  };

  const handleResolveTicket = async (ticketId) => {
    const isMock = selectedTicket ? !!selectedTicket.isMock : false;
    if (isMock) {
      const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
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
      localStorage.setItem(storageKey, JSON.stringify(updatedList));
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
            onClick={() => setIsModalOpen(true)}
            icon={<Plus className="h-4 w-4" />}
          >
            Create Ticket
          </Button>
        }
      />

      <div className="w-full space-y-3 shrink-0">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-slate" />
          <input
            type="text"
            placeholder="Search ID or title..."
            value={filters.search}
            onChange={(event) => updateFilter('search', event.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-surface pl-9 pr-4 py-2.5 text-sm text-dark-slate outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent placeholder:text-muted-slate/60"
          />
        </div>
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 w-full">
          <select
            value={filters.status}
            onChange={(event) => updateFilter('status', event.target.value)}
            className="flex-1 min-w-[130px] rounded-xl border border-gray-200 bg-surface px-3 py-2 text-sm text-dark-slate outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent"
          >
            <option value="">All statuses</option>
            {(roleContext === 'cs' ? STATUSES.filter(s => s !== 'Pending Assignment') : STATUSES).map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
          <select
            value={filters.category}
            onChange={(event) => updateFilter('category', event.target.value)}
            className="flex-1 min-w-[130px] rounded-xl border border-gray-200 bg-surface px-3 py-2 text-sm text-dark-slate outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent"
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(event) => {
              const v = event.target.value;
              setFilters((c) => ({ ...c, dateFrom: v, dateTo: v }));
            }}
            className="flex-1 min-w-[130px] rounded-xl border border-gray-200 bg-surface px-3 py-2 text-sm text-dark-slate outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent"
          />
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
              <TableHead className="w-[100px] text-center">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleTickets.length === 0 && loading && (
              <DataTableSkeleton columns={7} rows={4} />
            )}
            {visibleTickets.length === 0 && !loading && (
              <DataTableEmptyState
                colSpan={7}
                icon={Inbox}
                title="No tickets found"
                description="No tickets match the current filters."
              />
            )}
            {visibleTickets.map((ticket) => (
              <TableRow key={ticket.id}>
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
                    <Badge variant={getStatusBadgeVariant(ticket.status)} dot>
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
                <TableCell className="text-center">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleViewTicket(ticket)}
                    icon={<Eye className="h-3.5 w-3.5" />}
                  >
                    View
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <TicketModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreateTicket}
        openTicketsCount={openInternalTicketsCount}
      />
      
      {roleContext === 'cs' && assignModalTicket && (
        <AssignModal
          ticket={assignModalTicket}
          employees={employees}
          departments={departments}
          priorityOptions={['Low', 'Medium', 'High', 'Critical']}
          onClose={() => setAssignModalTicket(null)}
          onSave={async (updated) => {
            const priorityMap = {
              Low: 1,
              Medium: 2,
              High: 3,
              Critical: 4,
            };
            setModalLoading(true);
            setLoadingText('Saving assignment...');
            try {
              await acceptTicket({
                ticketId: updated.ticket_ID,
                employeeIds: updated.assigned,
                assignedByEmail: user?.email,
                priorityId: priorityMap[updated.priority] ?? 1,
              });
              setAssignModalTicket(null);
              window.alert('Ticket assigned successfully.');
              loadTickets({ forceRefresh: true });
            } catch (err) {
              console.error('Failed to assign ticket:', err);
              window.alert('Failed to assign ticket. Please try again.');
            } finally {
              setModalLoading(false);
            }
          }}
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
          onClose={() => setCsAssignTicket(null)}
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
            <h2 className="mt-4 text-lg font-bold text-dark-slate">Ticket Submitted</h2>
            <p className="mt-1.5 text-xs text-muted-slate">{confirmCreated.id} has been created successfully.</p>
            <Button
              className="mt-6 w-full"
              onClick={() => {
                const ticketId = confirmCreated.ticket_ID || confirmCreated.id;
                setConfirmCreated(null);
                const targetPath = roleContext === 'cs' ? '/cs/messages' : roleContext === 'it_manager' ? '/it-manager/messages' : '/employee/messages';
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