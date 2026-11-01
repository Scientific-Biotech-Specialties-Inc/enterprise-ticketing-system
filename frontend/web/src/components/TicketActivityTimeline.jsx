import React, { useState, useMemo } from 'react';
import {
  Clock,
  ArrowUpDown,
  Filter,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  User,
  Bot,
  MessageSquare,
  FileText,
  RotateCcw,
  Tag,
  ArrowRight,
  ChevronDown,
} from 'lucide-react';
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

/**
 * Enterprise Ticket Activity Timeline (TS086)
 *
 * Chronologically tracks and displays every state-changing event on a ticket.
 * Displays actor name, actor role, before/after values, system vs. user indicators,
 * event-type filters, and pagination/lazy-loading.
 */
export default function TicketActivityTimeline({
  ticket,
  userRole = 'cs',
  loadError = null,
  onRetry = null,
  pageSize = 8,
}) {
  const [sortOrder, setSortOrder] = useState('asc'); // 'asc' = oldest first, 'desc' = newest first
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [visibleCount, setVisibleCount] = useState(pageSize);

  // ─── Extract & Synthesize Complete Chronological Events ─────────────────
  const rawEvents = useMemo(() => {
    if (!ticket) return [];
    const list = [];

    // 1. Creation event
    const creationTime = ticket.date || ticket.created_at || ticket.date_created;
    if (creationTime) {
      list.push({
        id: 'evt-create',
        type: 'creation',
        category: 'status',
        text: `Ticket created by ${ticket.customer || 'Customer'} with initial status "Open".`,
        actorName: ticket.customer || 'Customer',
        actorRole: 'Customer',
        isSystem: false,
        timestamp: creationTime,
        beforeAfter: { field: 'Status', before: null, after: 'Open' },
      });
    }

    // 2. Acceptance event
    if (ticket.accepted) {
      list.push({
        id: 'evt-accept',
        type: 'assignment',
        category: 'assign',
        text: 'Ticket assignment accepted by assigned technician.',
        actorName: ticket.assigned_employee?.name || ticket.assigned_employee || 'Technician',
        actorRole: 'Service Engineer',
        isSystem: false,
        timestamp: ticket.date || ticket.created_at,
      });
    }

    // 3. Reassignment Request event
    if (ticket.reassignmentRequested) {
      list.push({
        id: 'evt-reassign-req',
        type: 'reassign',
        category: 'assign',
        text: `Reassignment requested by technician.${ticket.reassignmentReason ? ` Reason: "${ticket.reassignmentReason}"` : ''}`,
        actorName: ticket.assigned_employee?.name || ticket.assigned_employee || 'Technician',
        actorRole: 'Service Engineer',
        isSystem: false,
        timestamp: ticket.lastUpdate || ticket.updated_at || ticket.date,
      });
    }

    // 4. SLA Breach event (TS086 Criteria)
    const rawSla = String(ticket.sla_status || ticket.slaStatus || (ticket.sla?.resolution?.status) || '').toLowerCase();
    const isBreached = rawSla.includes('breach') || rawSla.includes('violated') || ticket.sla_breached;
    if (isBreached) {
      list.push({
        id: 'evt-sla-breach',
        type: 'sla_breach',
        category: 'system',
        text: 'Resolution SLA deadline breached. System flagged ticket and alerted CS supervisors.',
        actorName: 'SLA Engine',
        actorRole: 'Automated System Monitor',
        isSystem: true,
        timestamp: ticket.resolution_due_at || ticket.due_at || ticket.updated_at || creationTime,
      });
    }

    // 5. Auto-Close event
    if (ticket.status === 'Closed' && (ticket.auto_closed || ticket.closed_by === 'system')) {
      list.push({
        id: 'evt-autoclose',
        type: 'system_autoclose',
        category: 'system',
        text: 'Ticket closed automatically by system due to customer inactivity following the resolution window.',
        actorName: 'System Scheduler',
        actorRole: 'Automated System Daemon',
        isSystem: true,
        timestamp: ticket.closed_at || ticket.updated_at || ticket.lastUpdate,
        beforeAfter: { field: 'Status', before: 'Resolved', after: 'Closed' },
      });
    } else if (ticket.status === 'Closed') {
      list.push({
        id: 'evt-close-manual',
        type: 'status_close',
        category: 'status',
        text: `Ticket closed by ${ticket.closed_by || 'Customer Service'}.`,
        actorName: ticket.closed_by || 'Customer Service',
        actorRole: 'Customer Service Representative',
        isSystem: false,
        timestamp: ticket.closed_at || ticket.updated_at || ticket.lastUpdate,
        beforeAfter: { field: 'Status', before: 'Resolved', after: 'Closed' },
      });
    }

    // 6. Integrate backend timeline array
    if (Array.isArray(ticket.timeline)) {
      ticket.timeline.forEach((item, idx) => {
        // Skip duplicate close/create
        if (item.type === 'system_autoclose' && list.some((e) => e.id === 'evt-autoclose')) return;
        if (item.type === 'creation' && list.some((e) => e.id === 'evt-create')) return;

        // Parse actor and role
        let actorName = 'Staff Member';
        let actorRole = 'Customer Service Representative';
        let isSystem = false;
        let category = 'status';

        const txt = String(item.text || '');

        if (/by customer/i.test(txt)) {
          actorName = ticket.customer || 'Customer';
          actorRole = 'Hospital Client';
        } else if (/automatically|by system|sla monitor/i.test(txt) || item.type === 'system_autoclose') {
          actorName = 'System Engine';
          actorRole = 'Automated System';
          isSystem = true;
          category = 'system';
        } else if (/technician|engineer/i.test(txt)) {
          actorName = ticket.assigned_employee?.name || ticket.assigned_employee || 'Technician';
          actorRole = 'Service Engineer';
        } else if (/by cs|by admin|by john|by alice/i.test(txt)) {
          actorRole = 'Customer Service Representative';
        }

        // Determine category
        if (item.type === 'internal_note' || item.type === 'remark' || /note|remark/i.test(txt)) {
          category = 'notes';
        } else if (item.type === 'reassign' || /assign|delegate/i.test(txt)) {
          category = 'assign';
        } else if (isSystem) {
          category = 'system';
        }

        // Extract Before/After values if present
        let beforeAfter = null;
        const changeMatch = txt.match(/from\s+["']?([^"']+)["']?\s+to\s+["']?([^"']+)["']?/i);
        if (changeMatch) {
          let field = 'State';
          if (/priority/i.test(txt)) field = 'Priority';
          else if (/category/i.test(txt)) field = 'Category';
          else if (/status/i.test(txt)) field = 'Status';
          beforeAfter = { field, before: changeMatch[1], after: changeMatch[2] };
        } else if (/reclassified to\s+["']?([^"']+)["']?/i.test(txt)) {
          const match = txt.match(/reclassified to\s+["']?([^"']+)["']?/i);
          beforeAfter = { field: 'Category', before: 'Previous', after: match[1] };
        } else if (/priority updated to\s+["']?([^"']+)["']?/i.test(txt)) {
          const match = txt.match(/priority updated to\s+["']?([^"']+)["']?/i);
          beforeAfter = { field: 'Priority', before: 'Standard', after: match[1] };
        } else if (/status updated to\s+["']?([^"']+)["']?/i.test(txt)) {
          const match = txt.match(/status updated to\s+["']?([^"']+)["']?/i);
          beforeAfter = { field: 'Status', before: 'Previous', after: match[1] };
        }

        list.push({
          id: item.id || `timeline-${idx}-${Date.now()}`,
          type: item.type || 'update',
          category,
          text: txt,
          actorName: item.actorName || actorName,
          actorRole: item.actorRole || actorRole,
          isSystem,
          timestamp: item.timestamp || ticket.updated_at || ticket.date,
          beforeAfter,
        });
      });
    }

    // Filter out internal notes if user is a customer
    const isCustomer = String(userRole).toLowerCase() === 'customer';
    const accessible = isCustomer ? list.filter((e) => e.category !== 'notes') : list;

    // Deduplicate by text and timestamp
    const seen = new Set();
    const unique = [];
    accessible.forEach((e) => {
      const key = `${e.timestamp}_${e.text.substring(0, 30)}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(e);
      }
    });

    return unique;
  }, [ticket, userRole]);

  // ─── Filter & Sort ────────────────────────────────────────────────────────
  const filteredAndSortedEvents = useMemo(() => {
    let result = rawEvents;

    if (selectedFilter !== 'all') {
      result = result.filter((e) => e.category === selectedFilter);
    }

    return [...result].sort((a, b) => {
      const dateA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const dateB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
    });
  }, [rawEvents, selectedFilter, sortOrder]);

  // Paginated slice for performance (TS086 Criteria)
  const paginatedEvents = useMemo(() => {
    return filteredAndSortedEvents.slice(0, visibleCount);
  }, [filteredAndSortedEvents, visibleCount]);

  // ─── Error State (TS086 Criteria) ─────────────────────────────────────────
  if (loadError) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center space-y-3">
        <AlertTriangle className="w-6 h-6 text-destructive mx-auto" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-destructive">Activity Timeline Failed to Load</p>
          <p className="text-xs text-muted-foreground">
            Could not retrieve historical ticket audit events from the server.
          </p>
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} className="h-8 text-xs gap-1.5">
            <RotateCcw className="w-3.5 h-3.5" /> Retry Timeline
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-xs space-y-5">
      {/* Header & Controls Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
              Activity Timeline &amp; History ({rawEvents.length})
            </h3>
            <Badge variant="outline" className="text-[10px]">Read-Only Audit</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Traceable chronological event log of status updates, reassignments, and system actions.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Event-Type Filter Dropdown (TS086 Criteria) */}
          <select
            value={selectedFilter}
            onChange={(e) => {
              setSelectedFilter(e.target.value);
              setVisibleCount(pageSize);
            }}
            className="h-8 rounded-lg border border-border bg-page px-2.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
          >
            {FILTER_TYPES.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>

          {/* Chronological Sort Toggle (TS086 Criteria) */}
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

      {/* Timeline Stream */}
      {filteredAndSortedEvents.length === 0 ? (
        <div className="py-8 text-center text-xs text-muted-foreground italic">
          No activity events match the selected category filter.
        </div>
      ) : (
        <div className="relative pl-6 space-y-4 border-l-2 border-border ml-3 py-1">
          {paginatedEvents.map((evt, idx) => {
            const isSystem = evt.isSystem;
            const dotColor = isSystem
              ? 'bg-slate-700 ring-2 ring-slate-200'
              : evt.category === 'notes'
              ? 'bg-amber-500 ring-2 ring-amber-100'
              : evt.category === 'assign'
              ? 'bg-accent ring-2 ring-blue-100'
              : 'bg-primary ring-2 ring-indigo-100';

            return (
              <div key={evt.id || idx} className="relative text-xs group">
                {/* Dot */}
                <div
                  className={`absolute -left-[31px] top-1.5 w-3 h-3 rounded-full border-2 border-card shadow-xs ${dotColor}`}
                />

                {/* Entry Meta Bar: Actor, Role, System indicator, and Timestamp (TS086 Criteria) */}
                <div className="flex flex-wrap items-center justify-between gap-1 mb-1.5 text-muted-foreground">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* System vs User Distinct Badging (TS086 Criteria) */}
                    {isSystem ? (
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

                    <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                      {evt.type === 'creation'
                        ? 'Ticket Created'
                        : evt.type === 'sla_breach'
                        ? 'SLA Breach'
                        : evt.type === 'system_autoclose'
                        ? 'Auto-Closed'
                        : evt.category === 'notes'
                        ? 'Internal Note'
                        : evt.category === 'assign'
                        ? 'Reassignment / Assignment'
                        : 'Status Update'}
                    </span>
                  </div>

                  <span className="text-[11px] text-muted-foreground">
                    {formatDisplayDate(evt.timestamp)}
                  </span>
                </div>

                {/* Plain-Language Description */}
                <div className={`p-3 rounded-xl border leading-relaxed break-words whitespace-pre-wrap ${
                  isSystem
                    ? 'bg-slate-50/80 border-slate-200 text-slate-900'
                    : evt.category === 'notes'
                    ? 'bg-amber-50/70 border-amber-200 text-amber-950 font-medium'
                    : 'bg-muted/30 border-border text-foreground font-normal'
                }`}>
                  <p className="text-xs">{evt.text}</p>

                  {/* Before / After State Change Indicator (TS086 Criteria) */}
                  {evt.beforeAfter && (
                    <div className="mt-2 pt-2 border-t border-border/60 flex items-center gap-2 text-[11px]">
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

      {/* Pagination / Lazy-Loading Controls (TS086 Criteria) */}
      {filteredAndSortedEvents.length > pageSize && (
        <div className="pt-2 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing <strong>{Math.min(visibleCount, filteredAndSortedEvents.length)}</strong> of{' '}
            <strong>{filteredAndSortedEvents.length}</strong> activity events
          </span>

          <div className="flex items-center gap-2">
            {visibleCount < filteredAndSortedEvents.length ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVisibleCount((prev) => prev + pageSize)}
                className="h-7 text-xs"
              >
                <span>Load More Activities</span>
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setVisibleCount(pageSize)}
                className="h-7 text-xs text-muted-foreground"
              >
                Show Less
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

