import React from 'react';
import { AlertTriangle, Clock, CheckCircle2, PauseCircle, HelpCircle, AlertOctagon } from 'lucide-react';
import { formatDisplayDate } from '@/utils/dateUtils';

/**
 * TS041, TS042, TS047: Standardized SLA Status Badge for ONE UI
 * Renders color-coded status paired with iconography and text for accessibility.
 * Supports: Breached, At Risk, On Track / Compliant, Paused (On Hold), No SLA Configured, SLA Unavailable.
 */

export function getTicketSlaStatus(ticket) {
  if (!ticket) return 'no_sla';
  if (ticket.status === 'On Hold') return 'paused';
  const rawStatus = ticket.sla_status || ticket.slaStatus || (ticket.sla?.resolution?.status) || null;
  const normalized = rawStatus ? String(rawStatus).toLowerCase().replace(/[\s_-]+/g, '') : null;
  if (normalized === 'breached' || normalized === 'violated' || Boolean(ticket.sla_breached)) {
    return 'breached';
  }
  if (normalized === 'paused') {
    return 'paused';
  }
  if (normalized === 'atrisk') {
    return 'at_risk';
  }
  if (normalized === 'ontrack' || normalized === 'compliant') {
    return 'on_track';
  }
  if (normalized === 'unavailable' || normalized === 'error' || normalized === 'slaunavailable') {
    return 'unavailable';
  }
  return 'no_sla';
}

export function getTicketSlaDueDate(ticket) {
  if (!ticket) return null;
  return ticket.resolution_due_at || ticket.due_at || ticket.sla?.resolution?.target || ticket.sla_due_at || ticket.sla_due_date || null;
}

export default function SlaStatusBadge({ ticket, showDueDate = true, className = '' }) {
  if (!ticket) return null;

  const normalizedStatus = getTicketSlaStatus(ticket);
  const isBreached = normalizedStatus === 'breached';
  const isOnHold = normalizedStatus === 'paused';

  const dueAt = getTicketSlaDueDate(ticket);
  const formattedDue = dueAt ? formatDisplayDate(dueAt) : null;

  const remainingMin = ticket.time_remaining_minutes !== undefined && ticket.time_remaining_minutes !== null
    ? Number(ticket.time_remaining_minutes)
    : null;

  // 1. Breached
  if (isBreached) {
    return (
      <div className={`flex flex-col gap-0.5 ${className}`}>
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 w-fit"
          title={formattedDue ? `SLA target Breached on: ${formattedDue}` : 'Resolution target Breached'}
        >
          <AlertTriangle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
          <span>Breached</span>
        </span>
        {showDueDate && (
          <span className="text-[10px] text-rose-600 font-semibold truncate max-w-[140px]">
            {formattedDue ? `Due: ${formattedDue}` : 'Overdue'}
          </span>
        )}
      </div>
    );
  }

  // 2. Paused (On Hold)
  if (isOnHold) {
    return (
      <div className={`flex flex-col gap-0.5 ${className}`}>
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 w-fit"
          title="SLA calculation clock paused while ticket is On Hold"
        >
          <PauseCircle className="h-3.5 w-3.5 text-blue-600 shrink-0" />
          <span>Paused</span>
        </span>
        {showDueDate && (
          <span className="text-[10px] text-muted-slate font-medium">
            Clock paused (On Hold)
          </span>
        )}
      </div>
    );
  }

  // 3. At Risk (approaching deadline)
  if (normalizedStatus === 'at_risk' || normalizedStatus === 'atrisk') {
    return (
      <div className={`flex flex-col gap-0.5 ${className}`}>
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 w-fit"
          title={formattedDue ? `SLA Deadline approaching: ${formattedDue}` : 'SLA resolution target at risk - Deadline approaching'}
        >
          <Clock className="h-3.5 w-3.5 text-amber-600 shrink-0" />
          <span>At Risk</span>
        </span>
        {showDueDate && (
          <span className="text-[10px] text-amber-700 font-semibold">
            {remainingMin !== null && remainingMin > 0
              ? remainingMin > 60
                ? `${Math.round(remainingMin / 60)}h left`
                : `${remainingMin}m left`
              : formattedDue
              ? `Due: ${formattedDue}`
              : 'Nearing deadline'}
          </span>
        )}
      </div>
    );
  }

  // 4. On Track / Compliant
  if (normalizedStatus === 'ontrack' || normalizedStatus === 'compliant' || normalizedStatus === 'on_track') {
    return (
      <div className={`flex flex-col gap-0.5 ${className}`}>
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 w-fit"
          title={formattedDue ? `Target: ${formattedDue}` : 'Compliant with SLA Target'}
        >
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
          <span>On Track</span>
        </span>
        {showDueDate && formattedDue && (
          <span className="text-[10px] text-muted-slate font-medium truncate max-w-[140px]">
            Due: {formattedDue}
          </span>
        )}
      </div>
    );
  }

  // 5. Calculation error or system error
  if (normalizedStatus === 'unavailable' || normalizedStatus === 'error') {
    return (
      <div className={`flex flex-col gap-0.5 ${className}`}>
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium bg-slate-50 text-slate-500 border border-slate-200 w-fit"
          title="SLA calculation is currently unavailable for this ticket"
        >
          <AlertOctagon className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <span>SLA Unavailable</span>
        </span>
        {showDueDate && (
          <span className="text-[10px] text-muted-foreground">Config Error</span>
        )}
      </div>
    );
  }

  // 6. No SLA configured
  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium bg-slate-50 text-slate-500 border border-slate-200 w-fit"
        title="No department SLA configured for this ticket category"
      >
        <HelpCircle className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        <span>N/A</span>
      </span>
      {showDueDate && (
        <span className="text-[10px] text-muted-foreground">Standard</span>
      )}
    </div>
  );
}
