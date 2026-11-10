import React, { useState, useMemo } from 'react';
import { Bell, Clock, ShieldAlert, ArrowUpRight, CheckCircle2, User, Bot, AlertTriangle } from 'lucide-react';
import { formatPHT } from './ticketModalUtils';

/**
 * StaffTimelineView component
 * Never empty: synthesizes ticket events if server timeline has few items.
 * Filter: All / Customer-visible / Internal.
 */
export default function StaffTimelineView({
  ticket,
  serverEvents = [],
  className = '',
}) {
  const [filter, setFilter] = useState('all'); // 'all' | 'customer' | 'internal'

  // Combine and synthesize events so timeline is never empty
  const allEvents = useMemo(() => {
    const list = Array.isArray(serverEvents) ? [...serverEvents] : [];

    // Synthesize baseline events if not present in serverEvents
    const hasSubmitted = list.some((e) =>
      String(e.description || e.action_type || e.text || '').toLowerCase().includes('submitted')
    );
    const hasAssigned = list.some((e) =>
      String(e.description || e.action_type || e.text || '').toLowerCase().includes('assigned')
    );
    const hasSlaStart = list.some((e) =>
      String(e.description || e.action_type || e.text || '').toLowerCase().includes('sla clock')
    );
    const hasBreach = list.some((e) =>
      String(e.description || e.action_type || e.text || '').toLowerCase().includes('breached')
    );
    const hasReassign = list.some((e) =>
      String(e.description || e.action_type || e.text || '').toLowerCase().includes('reassignment')
    );

    const synthetic = [];

    // 1. Reassignment requested if currently active
    if (ticket?.reassignmentRequested && !hasReassign) {
      const techName = ticket.assigned_employee || ticket.assigned_to_name || 'Assigned technician';
      synthetic.push({
        id: 'synth-reassign',
        title: `Reassignment requested by ${techName}`,
        description: ticket.reassignmentReason ? `Reason: "${ticket.reassignmentReason}"` : 'Awaiting CS decision',
        created_at: ticket.updated_at || ticket.last_updated || new Date().toISOString(),
        actor: { name: techName, role: 'technician' },
        visibility: 'internal',
        type: 'reassign',
      });
    }

    // 2. SLA breached if active
    const isBreached = Boolean(
      ticket?.sla_breached ||
      String(ticket?.sla_status || '').toLowerCase().includes('breached')
    );
    const dueAt = ticket?.resolution_due_at || ticket?.due_at || ticket?.sla_due_date;
    if (isBreached && !hasBreach) {
      synthetic.push({
        id: 'synth-breach',
        title: 'SLA target breached',
        description: `Target resolution was due ${formatPHT(dueAt)}.`,
        created_at: dueAt || ticket.updated_at || new Date().toISOString(),
        actor: { name: 'SLA Monitor', role: 'system' },
        visibility: 'internal',
        type: 'sla_breach',
      });
    }

    // 3. Assigned to technician
    const assignedName =
      ticket?.assigned_employee ||
      ticket?.assigned_to_name ||
      (Array.isArray(ticket?.assigned_employees) && ticket.assigned_employees[0]?.name) ||
      (Array.isArray(ticket?.assigned) && typeof ticket.assigned[0] === 'object' && ticket.assigned[0]?.name);
    if (assignedName && !hasAssigned) {
      synthetic.push({
        id: 'synth-assigned',
        title: `Assigned to ${assignedName}`,
        description: `Technician assigned to work on ticket.`,
        created_at: ticket.assigned_at || ticket.updated_at || ticket.created_at,
        actor: { name: 'CS Dispatcher', role: 'cs' },
        visibility: 'customer',
        type: 'assigned',
      });
    }

    // 4. SLA clock started
    if (!hasSlaStart) {
      synthetic.push({
        id: 'synth-sla-start',
        title: 'SLA clock started',
        description: dueAt ? `Target resolution set to ${formatPHT(dueAt)}.` : 'Standard SLA clock initialized.',
        created_at: ticket.created_at || ticket.date_created || ticket.date,
        actor: { name: 'System Engine', role: 'system' },
        visibility: 'internal',
        type: 'system',
      });
    }

    // 5. Submitted
    if (!hasSubmitted) {
      const customer = ticket?.customer || ticket?.requestor || 'Customer';
      synthetic.push({
        id: 'synth-submitted',
        title: 'Ticket submitted',
        description: `Ticket filed by ${customer}.`,
        created_at: ticket.created_at || ticket.date_created || ticket.date,
        actor: { name: customer, role: 'customer' },
        visibility: 'customer',
        type: 'submitted',
      });
    }

    // Merge normalized server events and synthetic
    const normalizedServer = list.map((e, i) => {
      const isInternal = Boolean(
        e.is_internal ||
        e.action_type === 'internal_note' ||
        e.action_type === 'reminder_sent' ||
        e.action_type === 'reassignment_request' ||
        e.action_type === 'sla_breached' ||
        e.type === 'reminder' ||
        e.type === 'internal_note'
      );
      return {
        id: e.id || e.log_id || `evt-${i}`,
        title: e.action_title || e.title || e.event_type || e.type || 'Activity update',
        description: e.description || e.text || e.details || '',
        created_at: e.created_at || e.timestamp || e.date,
        actor: e.actor || { name: e.author || 'System', role: 'staff' },
        visibility: isInternal ? 'internal' : 'customer',
        type: e.type || e.action_type || 'event',
      };
    });

    // Combined sorted descending
    const combined = [...normalizedServer, ...synthetic].sort((a, b) => {
      const tA = new Date(a.created_at).getTime() || 0;
      const tB = new Date(b.created_at).getTime() || 0;
      return tB - tA;
    });

    return combined;
  }, [ticket, serverEvents]);

  // Filter events
  const filteredEvents = useMemo(() => {
    if (filter === 'customer') {
      return allEvents.filter((e) => e.visibility === 'customer');
    }
    if (filter === 'internal') {
      return allEvents.filter((e) => e.visibility === 'internal');
    }
    return allEvents;
  }, [allEvents, filter]);

  return (
    <div className={`space-y-3.5 ${className}`}>
      {/* Filter Tabs */}
      <div className="flex items-center justify-between gap-2 border-b border-[#D5D9E4] pb-2.5">
        <span className="text-xs font-bold uppercase tracking-wider text-[#5A6178]">
          TIMELINE ({filteredEvents.length})
        </span>

        <div className="flex items-center gap-1 bg-[#F5F6FA] p-0.5 rounded-lg border border-[#D5D9E4]">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              filter === 'all'
                ? 'bg-white text-[#1E2A78] shadow-xs'
                : 'text-[#5A6178] hover:text-[#1B2033]'
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setFilter('customer')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              filter === 'customer'
                ? 'bg-white text-[#1E2A78] shadow-xs'
                : 'text-[#5A6178] hover:text-[#1B2033]'
            }`}
          >
            Customer-visible
          </button>
          <button
            type="button"
            onClick={() => setFilter('internal')}
            className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              filter === 'internal'
                ? 'bg-white text-[#1E2A78] shadow-xs'
                : 'text-[#5A6178] hover:text-[#1B2033]'
            }`}
          >
            Internal
          </button>
        </div>
      </div>

      {/* Events List */}
      <div className="max-h-72 overflow-y-auto pr-1 pt-1 ml-1 space-y-0">
        {filteredEvents.map((evt, idx) => {
          const isReminder = evt.type === 'reminder' || evt.type === 'reminder_sent';
          const isBreach = evt.type === 'sla_breach';
          const isReassign = evt.type === 'reassign';
          const isLast = idx === filteredEvents.length - 1;

          return (
            <div key={evt.id || idx} className="flex items-start gap-3 text-xs">
              {/* Timeline Track: Centered Dot + Vertical Line */}
              <div className="flex flex-col items-center self-stretch shrink-0 w-3">
                <div
                  className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1 ${
                    isBreach
                      ? 'bg-[#B42318]'
                      : isReminder
                      ? 'bg-indigo-600'
                      : isReassign
                      ? 'bg-amber-500'
                      : 'bg-[#1E2A78]'
                  }`}
                />
                {!isLast && (
                  <div className="w-[2px] bg-[#1E2A78] flex-1 my-0.5" />
                )}
              </div>

              {/* Event Content */}
              <div className={`flex-1 min-w-0 ${!isLast ? 'pb-3.5' : 'pb-1'}`}>
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <p className="font-bold text-[#1B2033] text-xs">
                    {evt.title}
                    {evt.visibility === 'internal' && (
                      <span className="ml-2 text-[10px] font-semibold text-[#5A6178] bg-slate-100 px-1.5 py-0.5 rounded">
                        Staff only
                      </span>
                    )}
                  </p>
                  <span className="text-[11px] text-[#5A6178] shrink-0">
                    {formatPHT(evt.created_at)}
                  </span>
                </div>

                {evt.description && (
                  <p className="text-slate-600 mt-0.5 leading-relaxed break-words">
                    {evt.description}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

