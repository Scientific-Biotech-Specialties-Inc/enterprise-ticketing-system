import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import useRealtimeRefresh from '@/hooks/useRealtimeRefresh';
import {
  getCSIncomingTickets,
  getDepartments,
  getInternalTickets,
} from '@/services/ticketService';
import { formatDisplayDate, parseUTCDate } from '@/utils/dateUtils';
import { PageHeader } from '@/components/ui/page-header';
import { OriginPillToggle } from '@/components/ui/OriginPillToggle';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { DataTableSkeleton, DataTableEmptyState } from '@/components/ui/data-table';
import Pagination from '@/components/Pagination';

const HISTORY_STATUSES = ['Closed', 'Resolved'];

const isClosedOrResolved = (status) => {
  const s = String(status || '').trim().toLowerCase();
  return s === 'closed' || s === 'resolved';
};

const getDisplayStatus = (ticket) => ticket.status;

export default function CSHistory({ roleContext = 'cs' }) {
  const navigate = useNavigate();

  const [tickets, setTickets] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [typeScope, setTypeScope] = useState('all'); // 'all' | 'external' | 'internal'
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All Status');
  const [categoryFilter, setCategoryFilter] = useState('All Category');
  const [priorityFilter, setPriorityFilter] = useState('All Priority');
  const [dateFilter, setDateFilter] = useState('');
  const [page, setPage] = useState(1);
  const itemsPerPage = 10;

  const loadStaticData = useCallback(async () => {
    try {
      const [depsResult] = await Promise.allSettled([getDepartments()]);
      if (depsResult.status === 'fulfilled') {
        setDepartments((depsResult.value || []).map((d) => d.name));
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
      const [incomingResult, internalResult] = await Promise.allSettled([
        getCSIncomingTickets({ limit: 150, forceRefresh }),
        getInternalTickets(),
      ]);

      const incomingList = incomingResult.status === 'fulfilled' ? (incomingResult.value || []) : [];
      const internalList = internalResult.status === 'fulfilled' ? (internalResult.value || []) : [];
      let sessionInternal = [];
      try {
        sessionInternal = JSON.parse(sessionStorage.getItem('cs_created_tickets') || '[]');
      } catch {
        sessionInternal = [];
      }

      const seen = new Set();
      const combined = [];

      // 1. Process internal tickets (where CS/staff is requestor)
      [...internalList, ...sessionInternal].forEach((t) => {
        const id = t.ticket_ID || t.id;
        if (!id || seen.has(id)) return;
        seen.add(id);
        combined.push({
          ...t,
          is_internal: true,
          ticket_type: 'Internal',
          is_own_ticket: true,
          customer: t.customer || t.requestor || 'Staff (Internal)',
        });
      });

      // 2. Process incoming tickets
      incomingList.forEach((t) => {
        const id = t.ticket_ID || t.id;
        if (!id || seen.has(id)) return;
        seen.add(id);
        const isInternal = Boolean(
          t.is_internal ||
          t.ticket_type === 'Internal' ||
          t.type === 'Internal' ||
          t.title?.startsWith('[Internal]') ||
          t.requester_employee_name ||
          (t.requested_by && t.requested_by !== null)
        );
        combined.push({
          ...t,
          is_internal: isInternal,
          ticket_type: isInternal ? 'Internal' : 'External',
        });
      });

      const list = combined.filter((ticket) => isClosedOrResolved(ticket.status));
      setTickets(list);
    } catch {
      setError('Unable to load ticket history.');
    } finally {
      if (source !== 'websocket' && source !== 'poll') {
        setLoading(false);
      }
    }
  }, []);

  const handleRealtimeUpdate = useCallback((context) => {
    if (context && context.source === 'websocket') {
      const payload = context.payload;
      if (!payload) return;

      if (payload.action) {
        const { action, ticket } = payload;
        if (!ticket) return;

        if (action === 'created') return;

        const isHistoryTicket = isClosedOrResolved(ticket.status);

        setTickets((prev) => {
          const index = prev.findIndex((t) => t.id === ticket.id || t.ticket_ID === ticket.ticket_ID);
          if (index !== -1) {
            if (isHistoryTicket) {
              const next = [...prev];
              next[index] = { ...next[index], ...ticket };
              return next;
            } else {
              return prev.filter((t) => t.id !== ticket.id && t.ticket_ID !== ticket.ticket_ID);
            }
          } else {
            if (isHistoryTicket) {
              return [ticket, ...prev];
            }
            return prev;
          }
        });
      }
    } else {
      loadLiveData({ forceRefresh: true });
    }
  }, [loadLiveData]);

  useEffect(() => {
    loadStaticData();
    loadLiveData({ forceRefresh: true });
  }, [loadStaticData, loadLiveData]);

  useRealtimeRefresh({
    refresh: handleRealtimeUpdate,
    channels: [{ name: 'ticket-updates', event: 'ticket.changed' }],
    intervalMs: 30000,
    deferRefresh: false,
  });

  const categories = useMemo(() => {
    const list = Array.from(new Set(tickets.map((t) => t.category).filter(Boolean)));
    return ['All Category', ...list.sort()];
  }, [tickets]);

  const isInternalTicket = (t) =>
    Boolean(
      t.is_internal ||
      t.ticket_type === 'Internal' ||
      t.type === 'Internal' ||
      t.title?.startsWith('[Internal]') ||
      t.is_own_ticket ||
      t.requester_employee_name ||
      (t.requested_by && t.requested_by !== null)
    );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t) => {
      const displayStatus = getDisplayStatus(t);

      // Origin filter (ALL / EXTERNAL / INTERNAL)
      const scope = String(typeScope || 'all').toLowerCase();
      if (scope === 'external' && isInternalTicket(t)) return false;
      if (scope === 'internal' && !isInternalTicket(t)) return false;

      // Only Closed and Resolved tickets belong in Ticket History
      if (!isClosedOrResolved(t.status)) return false;

      if (statusFilter !== 'All Status' && displayStatus !== statusFilter) return false;
      if (categoryFilter !== 'All Category' && t.category !== categoryFilter) return false;
      if (priorityFilter !== 'All Priority' && t.priority !== priorityFilter) return false;

      if (dateFilter) {
        const rawDate = t.resolved_at || t.closed_at || t.updated_at || t.lastUpdate || t.date || t.created_at;
        if (!rawDate) return false;
        try {
          const d = new Date(rawDate);
          if (!isNaN(d.getTime())) {
            const iso = d.toISOString().split('T')[0];
            const local = d.toLocaleDateString('en-CA');
            if (iso !== dateFilter && local !== dateFilter) return false;
          }
        } catch {
          return false;
        }
      }

      if (q) {
        const id = String(t.id || t.ticket_ID || t.ticket_number || '');
        const title = String(t.title || '');
        const customer = String(
          t.customer ||
          t.customer_name ||
          t.requestor ||
          t.created_by_name ||
          ''
        );
        const facility = String(t.facility || '');
        const blob = `${id} ${title} ${customer} ${facility}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [tickets, search, statusFilter, categoryFilter, priorityFilter, dateFilter, typeScope]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, categoryFilter, priorityFilter, dateFilter, typeScope]);

  const paged = useMemo(() => {
    const start = (page - 1) * itemsPerPage;
    return filtered.slice(start, start + itemsPerPage);
  }, [filtered, page, itemsPerPage]);

  const openDetail = (t) => {
    const ticketId = t.ticket_ID || Number(String(t.id).replace(/\D/g, ''));
    const basePath =
      roleContext === 'it_manager'
        ? '/it-manager'
        : roleContext === 'service_manager'
        ? '/service-manager'
        : roleContext === 'cs_manager'
        ? '/cs-manager'
        : '/cs';
    navigate(`${basePath}/history/${ticketId}`, {
      state: { ticket: t, backPath: `${basePath}/history` },
    });
  };

  return (
    <div className="space-y-6 w-full min-w-0 max-w-full">
      <PageHeader
        title="Ticket History"
        subtitle="Closed and resolved tickets on record."
        actions={
          <OriginPillToggle
            value={typeScope}
            onChange={(val) => setTypeScope(val)}
          />
        }
      />

      {error && (
        <div className="rounded-lg bg-destructive/10 text-destructive border border-destructive/20 px-4 py-3 text-sm font-medium">
          {error}
        </div>
      )}

      {/* Filter toolbar: Single unified row matching Employee Ticket History standard */}
      <div className="flex flex-col lg:flex-row items-center gap-2.5 w-full shrink-0">
        <div className="relative flex-1 w-full min-w-[200px]">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search ID, title, customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-card pl-10 pr-4 py-2 text-sm text-foreground outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent placeholder:text-muted-foreground h-10"
          />
        </div>
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 w-full lg:w-auto shrink-0">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 flex-1 sm:flex-initial min-w-[120px] rounded-xl border border-gray-200 bg-card px-3 text-sm text-foreground outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent cursor-pointer"
          >
            {['All Status', 'Closed', 'Resolved'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-10 flex-1 sm:flex-initial min-w-[120px] rounded-xl border border-gray-200 bg-card px-3 text-sm text-foreground outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent cursor-pointer"
          >
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="h-10 flex-1 sm:flex-initial min-w-[110px] rounded-xl border border-gray-200 bg-card px-3 text-sm text-foreground outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent cursor-pointer"
          >
            {['All Priority', 'Critical', 'High', 'Medium', 'Low'].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <div className="relative flex-1 sm:flex-initial">
            <input
              type="date"
              aria-label="Filter by date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="h-10 w-full sm:w-auto min-w-[130px] rounded-xl border border-gray-200 bg-card px-3 text-sm text-foreground outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent cursor-pointer"
            />
            {dateFilter && (
              <button
                type="button"
                onClick={() => setDateFilter('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs px-1 font-bold cursor-pointer"
                title="Clear date"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Table Card */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[130px]">Ticket ID</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[150px]">Last Update</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <DataTableSkeleton columns={7} rows={5} />
            ) : filtered.length === 0 ? (
              <DataTableEmptyState
                colSpan={7}
                message={
                  (typeScope || 'all').toLowerCase() === 'external'
                    ? 'No external customer history tickets found.'
                    : (typeScope || 'all').toLowerCase() === 'internal'
                    ? 'No internal tickets found where you are the requestor.'
                    : 'No history tickets found. Closed and resolved tickets will appear here.'
                }
              />
            ) : (
              paged.map((t) => (
                <TableRow
                  key={t.id}
                  onClick={() => openDetail(t)}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                >
                  <TableCell className="font-semibold text-primary whitespace-nowrap">
                    <div className="flex flex-col min-w-0">
                      <span>{t.id}</span>
                      {Boolean(t.is_internal || t.ticket_type === 'Internal' || t.is_own_ticket) && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-[#252578] border border-blue-200 mt-1 w-fit">
                          Internal
                        </span>
                      )}
                      {t.reassignmentRequested && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-warning/15 text-warning mt-1 w-fit">
                          Reassigned
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className="font-medium text-foreground text-sm truncate">{t.customer || t.customer_name || 'Customer'}</p>
                    <p className="text-xs text-muted-foreground truncate">{t.facility || ''}</p>
                  </TableCell>
                  <TableCell className="font-medium text-foreground line-clamp-2 max-w-[16rem]">
                    {t.title}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{t.category}</TableCell>
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
                    <Badge variant={getStatusBadgeVariant(getDisplayStatus(t))}>
                      {getDisplayStatus(t)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatDisplayDate(t.lastUpdate || t.updated_at || t.resolved_at || t.closed_at || t.date)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {!loading && filtered.length > 0 && (
          <div className="px-4 py-3 border-t border-border bg-card flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Showing {(page - 1) * itemsPerPage + 1} to{' '}
              {Math.min(page * itemsPerPage, filtered.length)} of {filtered.length} history records
            </p>
            <Pagination
              totalItems={filtered.length}
              itemsPerPage={itemsPerPage}
              currentPage={page}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>
    </div>
  );
}
