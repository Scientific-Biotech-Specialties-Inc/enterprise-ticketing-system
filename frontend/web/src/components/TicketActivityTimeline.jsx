import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Clock,
  ArrowUpDown,
  AlertTriangle,
  User,
  Bot,
  RotateCcw,
  Tag,
  ArrowRight,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { getTicketTimeline } from '@/services/ticketService';
import { formatDisplayDate } from '@/utils/dateUtils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const FILTER_TYPES = [
  { id: 'all', label: 'All Activities' },
  { id: 'status', label: 'Status Updates' },
  { id: 'assign', label: 'Assignments & Reassigns' },
  { id: 'notes', label: 'Notes & Remarks' },
  { id: 'system', label: 'System Actions' },
];

const FIELD_LABELS = {
  ticket_status_ID: 'Status',
  priority_ID: 'Priority',
  problem_category_ID: 'Category',
  assigned_to: 'Assigned employee',
  ticket_type_ID: 'Ticket type',
  machine_ID: 'Equipment',
};

const titleCase = (value) =>
  String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

/** Sort an audit entry into one of the filter groups using the server's event data, never its wording. */
function categorize(entry) {
  if (entry.is_system) return 'system';
  const type = String(entry.event_type || entry.action_type || '');
  if (/note|message_edit/i.test(type)) return 'notes';
  if (/reassign|assign|delegat|escalat/i.test(type)) return 'assign';
  const field = entry.before_state ? Object.keys(entry.before_state)[0] : null;
  if (field === 'assigned_to') return 'assign';
  return 'status';
}

/** Human title for the small uppercase label above each entry. */
function eventLabel(entry) {
  const type = String(entry.event_type || entry.action_type || '');
  if (entry.is_system && /sla_breach/i.test(type)) return 'SLA Breach';
  if (entry.is_system) return 'System Action';
  if (type === 'create') return 'Ticket Created';
  if (type === 'reminder_sent') return 'CS Reminder';
  return titleCase(type) || 'Update';
}

/** Only changes that really have an old and a new value get the before/after strip. */
function beforeAfterOf(entry) {
  const before = entry.before_state;
  const after = entry.after_state;
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return null;
  const field = Object.keys(before)[0];
  if (!field || !(field in after)) return null;
  return {
    field: FIELD_LABELS[field] || titleCase(field.replace(/_ID$/i, '')),
    before: before[field] == null ? '' : String(before[field]),
    after: after[field] == null ? 'None' : String(after[field]),
  };
}

/**
 * Enterprise Ticket Activity Timeline (spec 0028 AC-16 to AC-19)
 *
 * Shows the server's audit trail for one ticket, read only. Every entry's description, actor,
 * role, system flag and before/after values come from `GET /tickets/{id}/timeline`.
 * Pages are fetched on demand so tickets with long histories stay fast.
 */
export default function TicketActivityTimeline({
  ticket,
  ticketId: ticketIdProp = null,
  pageSize = 8,
}) {
  // Always the real database id. A display id such as "TKTS-00015" is not the same number.
  const ticketId = ticketIdProp ?? ticket?.ticket_ID ?? null;

  const [sortOrder, setSortOrder] = useState('asc'); // asc = oldest first
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [entries, setEntries] = useState([]);
  const [pagination, setPagination] = useState({ current_page: 0, last_page: 1, total: 0 });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const requestToken = useRef(0);

  const fetchPage = useCallback(
    async (page, { append }) => {
      if (!ticketId) return;
      const token = ++requestToken.current;
      append ? setLoadingMore(true) : setLoading(true);
      setError(null);
      try {
        const res = await getTicketTimeline(ticketId, { page, per_page: pageSize, order: sortOrder });
        if (token !== requestToken.current) return; // a newer request replaced this one
        const incoming = Array.isArray(res?.data) ? res.data : [];
        setEntries((prev) => (append ? [...prev, ...incoming] : incoming));
        setPagination(res?.pagination || { current_page: page, last_page: page, total: incoming.length });
      } catch (err) {
        if (token !== requestToken.current) return;
        console.error('Failed to load ticket timeline:', err);
        setError(err?.response?.data?.message || 'Could not retrieve the ticket history from the server.');
      } finally {
        if (token === requestToken.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [ticketId, pageSize, sortOrder]
  );

  // First page (and a fresh start whenever the ticket or sort order changes).
  useEffect(() => {
    setEntries([]);
    setPagination({ current_page: 0, last_page: 1, total: 0 });
    fetchPage(1, { append: false });
  }, [fetchPage]);

  const events = useMemo(
    () =>
      entries.map((entry) => ({
        id: entry.log_id,
        category: categorize(entry),
        label: eventLabel(entry),
        text: entry.description || entry.details || titleCase(entry.event_type || entry.action_type),
        isSystem: Boolean(entry.is_system),
        isInternal: Boolean(entry.is_internal),
        actorName: entry.actor?.name || 'Unknown',
        actorRole: titleCase(entry.actor?.role),
        timestamp: entry.created_at,
        beforeAfter: beforeAfterOf(entry),
      })),
    [entries]
  );

  const visibleEvents = useMemo(
    () => (selectedFilter === 'all' ? events : events.filter((e) => e.category === selectedFilter)),
    [events, selectedFilter]
  );

  const hasMore = pagination.current_page < pagination.last_page;

  if (!ticketId) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center">
        <p className="text-sm font-semibold text-destructive">Activity Timeline unavailable</p>
        <p className="text-xs text-muted-foreground mt-1">This ticket has no record id, so its history cannot be loaded.</p>
      </div>
    );
  }

  if (error && entries.length === 0) {
    return (
      <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center space-y-3">
        <AlertTriangle className="w-6 h-6 text-destructive mx-auto" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-destructive">Activity Timeline Failed to Load</p>
          <p className="text-xs text-muted-foreground">{error}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => fetchPage(1, { append: false })} className="h-8 text-xs gap-1.5">
          <RotateCcw className="w-3.5 h-3.5" /> Retry Timeline
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-xs space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
              Activity Timeline &amp; History ({pagination.total})
            </h3>
            <Badge variant="outline" className="text-[10px]">Read-Only Audit</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Chronological record of every recorded action on this ticket.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            aria-label="Filter activity"
            value={selectedFilter}
            onChange={(e) => setSelectedFilter(e.target.value)}
            className="h-8 rounded-lg border border-border bg-page px-2.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
          >
            {FILTER_TYPES.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
            className="h-8 gap-1.5 text-xs text-primary"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            <span>{sortOrder === 'asc' ? 'Oldest First' : 'Newest First'}</span>
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <span>{error} Showing the entries loaded so far.</span>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => fetchPage(Math.max(1, pagination.current_page + 1), { append: pagination.current_page > 0 })}>
            Retry
          </Button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading ticket history">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-muted/50 animate-pulse" />
          ))}
        </div>
      ) : visibleEvents.length === 0 ? (
        <div className="py-8 text-center text-xs text-muted-foreground italic">
          {events.length === 0
            ? 'No activity has been recorded for this ticket yet.'
            : 'No loaded activity matches the selected category. Load more to look further back.'}
        </div>
      ) : (
        <div className="relative pl-6 space-y-4 border-l-2 border-border ml-3 py-1">
          {visibleEvents.map((evt) => {
            const dotColor = evt.isSystem
              ? 'bg-slate-700 ring-2 ring-slate-200'
              : evt.category === 'notes'
              ? 'bg-amber-500 ring-2 ring-amber-100'
              : evt.category === 'assign'
              ? 'bg-accent ring-2 ring-blue-100'
              : 'bg-primary ring-2 ring-indigo-100';

            return (
              <div key={evt.id} className="relative text-xs group">
                <div className={`absolute -left-[31px] top-1.5 w-3 h-3 rounded-full border-2 border-card shadow-xs ${dotColor}`} />

                <div className="flex flex-wrap items-center justify-between gap-1 mb-1.5 text-muted-foreground">
                  <div className="flex items-center gap-2 flex-wrap">
                    {evt.isSystem ? (
                      <Badge variant="outline" className="bg-slate-100 text-slate-800 border-slate-300 text-[10px] gap-1 py-0">
                        <Bot className="w-2.5 h-2.5" />
                        <span>System-Initiated</span>
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px] gap-1 py-0 font-medium">
                        <User className="w-2.5 h-2.5 text-primary" />
                        <span>{evt.actorName}</span>
                        <span className="text-muted-foreground">• {evt.actorRole}</span>
                      </Badge>
                    )}
                    <span className="text-[10px] uppercase font-semibold text-muted-foreground">{evt.label}</span>
                    {evt.isInternal && (
                      <Badge variant="outline" className="text-[10px] py-0">Internal</Badge>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground">{formatDisplayDate(evt.timestamp)}</span>
                </div>

                <div className={`p-3 rounded-xl border leading-relaxed break-words whitespace-pre-wrap ${
                  evt.isSystem
                    ? 'bg-slate-50/80 border-slate-200 text-slate-900'
                    : evt.category === 'notes'
                    ? 'bg-amber-50/70 border-amber-200 text-amber-950 font-medium'
                    : 'bg-muted/30 border-border text-foreground font-normal'
                }`}>
                  <p className="text-xs">{evt.text}</p>

                  {evt.beforeAfter && (
                    <div className="mt-2 pt-2 border-t border-border/60 flex items-center gap-2 text-[11px] flex-wrap">
                      <Tag className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground font-medium">{evt.beforeAfter.field}:</span>
                      {evt.beforeAfter.before && (
                        <>
                          <span className="line-through text-muted-foreground/80 px-1.5 py-0.5 rounded bg-muted/50 border border-border/40">
                            {evt.beforeAfter.before}
                          </span>
                          <ArrowRight className="w-3 h-3 text-muted-foreground" />
                        </>
                      )}
                      <span className="font-bold text-primary px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20">
                        {evt.beforeAfter.after}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && pagination.total > 0 && (
        <div className="pt-2 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Loaded <strong>{entries.length}</strong> of <strong>{pagination.total}</strong> activity events
          </span>
          {hasMore && (
            <Button
              variant="outline"
              size="sm"
              disabled={loadingMore}
              onClick={() => fetchPage(pagination.current_page + 1, { append: true })}
              className="h-7 text-xs"
            >
              {loadingMore ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
              <span>Load More Activities</span>
              {!loadingMore && <ChevronDown className="w-3 h-3 ml-1" />}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
