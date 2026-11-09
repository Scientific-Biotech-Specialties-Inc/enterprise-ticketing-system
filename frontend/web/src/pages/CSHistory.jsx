import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
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

const HISTORY_STATUSES = ['Closed', 'Resolved', 'Discarded', 'Discarded by Customer'];

const getDisplayStatus = (ticket) => ticket.status;

export default function CSHistory({ roleContext = 'cs' }) {
  const navigate = useNavigate();

  const [tickets, setTickets] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All Status');
  const [categoryFilter, setCategoryFilter] = useState('All Category');
  const [priorityFilter, setPriorityFilter] = useState('All Priority');
  const [dateFilter, setDateFilter] = useState('');

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
      const incomingResult = await getCSIncomingTickets({ limit: 150, forceRefresh });
      const list = incomingResult.filter((ticket) =>
        HISTORY_STATUSES.includes(ticket.status) || ticket.reassignmentRequested
      );
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

        const isHistoryTicket = HISTORY_STATUSES.includes(ticket.status) || ticket.reassignmentRequested;

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t) => {
      const displayStatus = getDisplayStatus(t);

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
  }, [tickets, search, statusFilter, categoryFilter, priorityFilter, dateFilter]);

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
    <div className="space-y-6">
      <PageHeader
        title="Ticket History"
        subtitle="Closed, resolved, and completed tickets on record."
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
                message="No history tickets found. Closed, resolved, and completed tickets will appear here."
              />
            ) : (
              filtered.map((t) => (
                <TableRow
                  key={t.id}
                  onClick={() => openDetail(t)}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                >
                  <TableCell className="font-semibold text-primary whitespace-nowrap">
                    <div className="flex flex-col min-w-0">
                      <span>{t.id}</span>
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
          <div className="px-4 py-3 border-t border-border bg-card">
            <p className="text-xs text-muted-foreground">
              Showing {filtered.length} of {tickets.length} history records
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
