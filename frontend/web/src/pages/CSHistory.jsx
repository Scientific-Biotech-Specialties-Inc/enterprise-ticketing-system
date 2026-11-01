import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import Pagination from '@/components/Pagination';
import useRealtimeRefresh from '@/hooks/useRealtimeRefresh';
import {
  getCSIncomingTickets,
  getDepartments,
} from '@/services/ticketService';
import { formatDisplayDate, parseUTCDate } from '@/utils/dateUtils';
import { PageHeader } from '@/components/ui/page-header';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { DataTableSkeleton, DataTableEmptyState } from '@/components/ui/data-table';
const HISTORY_STATUSES = ['Closed', 'Resolved'];

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
  const statusStr = `${rawStatus} ${displayStatus}`;
  const dept = String(t.department || '');
  const equip = String(t.equipment || t.machine_name || '');

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
    rawDate,
    formattedDate,
    extraDates,
  ]
    .join(' ')
    .toLowerCase();
};

export default function CSHistory({ roleContext = 'cs' }) {
  const navigate = useNavigate();

  const [tickets, setTickets] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All Categories');
  const [statusFilter, setStatusFilter] = useState('All Status');
  const [typeFilter, setTypeFilter] = useState('all');

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
      const incomingResult = await getCSIncomingTickets({ limit: 100, forceRefresh });
      const list = incomingResult.filter((ticket) =>
        HISTORY_STATUSES.includes(ticket.status)
      );
      setTickets(list);
    } catch {
      setError('Unable to load history tickets from ticket-service.');
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

        if (action === 'created') {
          return;
        }

        const isHistoryTicket = HISTORY_STATUSES.includes(ticket.status);

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
    channels: [
      { name: 'ticket-updates', event: 'ticket.changed' },
    ],
    intervalMs: 30000,
    deferRefresh: false,
  });

  const categories = useMemo(
    () => ['All Categories', ...Array.from(new Set(tickets.map((t) => t.category)))],
    [tickets]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t) => {
      if (category !== 'All Categories' && t.category !== category) return false;
      
      const displayStatus = getDisplayStatus(t);
      if (statusFilter !== 'All Status' && displayStatus !== statusFilter) return false;
      
      if (typeFilter === 'internal') {
        const isInternal = t.title?.startsWith('[Internal]') || t.is_internal || t.ticket_type === 'Internal' || t.type === 'Internal';
        if (!isInternal) return false;
      } else if (typeFilter === 'external') {
        const isInternal = t.title?.startsWith('[Internal]') || t.is_internal || t.ticket_type === 'Internal' || t.type === 'Internal';
        if (isInternal) return false;
      }

      if (!q) return true;
      const cleanQ = q.trim().toLowerCase();
      const searchBlob = buildTicketSearchString(t);
      if (searchBlob.includes(cleanQ)) return true;
      const tokens = cleanQ.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
      return tokens.length > 0 && tokens.every((token) => searchBlob.includes(token));
    });
  }, [tickets, search, category, statusFilter, typeFilter]);

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
    const ticketId = t.ticket_ID || Number(String(t.id).replace(/\D/g, ''));
    const basePath = roleContext === 'it_manager' ? '/it-manager' : '/cs';
    navigate(`${basePath}/history/${ticketId}`, { state: { ticket: t, backPath: `${basePath}/history` } });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ticket History"
        subtitle="View resolved, closed, and completed tickets"
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

      {/* Filter toolbar */}
      <div className="w-full space-y-3 shrink-0">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search history by ID, customer, title..."
            className="w-full rounded-lg border border-border bg-card pl-9 pr-4 py-2.5 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          />
        </div>
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 w-full">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="flex-1 min-w-[140px] rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          >
            <option value="All Status">All Statuses</option>
            <option value="Resolved">Resolved</option>
            <option value="Closed">Closed</option>
          </select>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="flex-1 min-w-[140px] rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
          >
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table Card */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-bold text-foreground">Completed Logs</h2>
          <div className="text-xs text-muted-foreground">{filtered.length} tickets</div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[140px]">Ticket ID</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[150px]">Date Submitted</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <DataTableSkeleton columns={7} rows={6} />
            ) : filtered.length === 0 ? (
              <DataTableEmptyState
                colSpan={7}
                message="No tickets found in the history queue."
              />
            ) : (
              paginated.map((t) => {
                const isInternalTicket =
                  t.title?.startsWith('[Internal]') ||
                  t.is_internal ||
                  t.ticket_type === 'Internal' ||
                  t.type === 'Internal';

                return (
                  <TableRow
                    key={t.id}
                    onClick={() => handleRowAction(t)}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                  >
                    <TableCell className="font-semibold text-primary whitespace-nowrap">
                      {t.id}
                    </TableCell>
                    <TableCell className="text-muted-foreground truncate max-w-[12rem]">
                      {t.customer}
                    </TableCell>
                    <TableCell>
                      <Badge variant={isInternalTicket ? 'secondary' : 'outline'}>
                        {isInternalTicket ? 'Internal' : 'External'}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium text-foreground max-w-[18rem] truncate">
                      {t.title}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {t.category}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(getDisplayStatus(t))}>
                        {getDisplayStatus(t)}
                      </Badge>
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
              {Math.min(page * ITEMS_PER_PAGE, filtered.length)} of {filtered.length}
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
    </div>
  );
}
