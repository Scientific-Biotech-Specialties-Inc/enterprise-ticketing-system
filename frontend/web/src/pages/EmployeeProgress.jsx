import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { getEmployeeAssignedTickets, clearEmployeeTicketsCache } from '@/services/ticketService';
import { useAuth } from '@/context/AuthContext';
import useRealtimeRefresh from '@/hooks/useRealtimeRefresh';
import { formatDisplayDate } from '@/utils/dateUtils';
import { PageHeader } from '@/components/ui/page-header';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { DataTableSkeleton, DataTableEmptyState } from '@/components/ui/data-table';

const HISTORY_STATUSES = ['Closed', 'Resolved', 'Discarded', 'Discarded by Customer'];

const getDisplayStatus = (ticket) => ticket.status;

export default function EmployeeProgress() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All Status');
  const [categoryFilter, setCategoryFilter] = useState('All Category');
  const [priorityFilter, setPriorityFilter] = useState('All Priority');

  const loadHistory = useCallback(async ({ forceRefresh = false } = {}) => {
    const email = user?.email || 'frontend@example.com';
    setLoading(true);
    setLoadError('');
    try {
      const list = await getEmployeeAssignedTickets({ employeeEmail: email, forceRefresh });
      setTickets(
        list.filter(
          (t) => HISTORY_STATUSES.includes(t.status) || t.reassignmentRequested
        )
      );
    } catch {
      setLoadError('Unable to load ticket history.');
    } finally {
      setLoading(false);
    }
  }, [user?.email]);

  useEffect(() => {
    loadHistory({ forceRefresh: true });
  }, [loadHistory]);

  useRealtimeRefresh({
    refresh: () => {
      clearEmployeeTicketsCache();
      loadHistory({ forceRefresh: true });
    },
    channels: [{ name: 'ticket-updates', event: 'ticket.changed' }],
    intervalMs: 30000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t) => {
      const displayStatus = getDisplayStatus(t);

      if (statusFilter !== 'All Status' && displayStatus !== statusFilter) return false;
      if (categoryFilter !== 'All Category' && t.category !== categoryFilter) return false;
      if (priorityFilter !== 'All Priority' && t.priority !== priorityFilter) return false;
      if (q) {
        const blob =
          `${t.id} ${t.title} ${t.customer} ${t.facility ?? ''}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [tickets, search, statusFilter, categoryFilter, priorityFilter]);

  const openDetail = (t) => {
    navigate(`/employee/history/${t.id}`, { state: { ticket: t, backPath: '/employee/progress' } });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ticket History"
        subtitle="Closed, resolved, and reassigned tickets you have handled."
      />

      {loadError && (
        <div className="rounded-lg bg-destructive/10 text-destructive border border-destructive/20 px-4 py-3 text-sm">
          {loadError}
        </div>
      )}

      {/* Filter toolbar */}
      <div className="w-full space-y-3 shrink-0">
        <div className="relative w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-slate" />
          <input
            type="search"
            placeholder="Search ID, title, customer..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-surface pl-10 pr-4 py-2.5 text-sm text-dark-slate outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent placeholder:text-muted-slate/60"
          />
        </div>
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 w-full">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="flex-1 min-w-[130px] rounded-xl border border-gray-200 bg-surface px-3 py-2 text-sm text-dark-slate outline-none focus:border-transparent focus:ring-2 focus:ring-brand-accent"
          >
            {['All Status', 'Closed', 'Resolved'].map((s) => (
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
                message="No history tickets found. Closed, resolved, and reassigned tickets will appear here."
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
                    <p className="font-medium text-foreground text-sm truncate">{t.customer}</p>
                    <p className="text-xs text-muted-foreground truncate">{t.facility}</p>
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
                    {formatDisplayDate(t.lastUpdate)}
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
