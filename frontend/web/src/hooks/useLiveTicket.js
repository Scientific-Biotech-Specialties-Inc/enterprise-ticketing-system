import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import echo from '@/services/echo';
import { ticketBroadcast } from '@/services/ticketBroadcast';
import { getTicketDetails } from '@/services/ticketService';

/**
 * Fields that the backend owns and that must follow the server while a ticket modal is open.
 * Everything else on the `ticket` prop (local-only UI state, list-shaped fields) is left alone.
 */
const LIVE_FIELDS = [
  'status',
  'ticket_status_ID',
  'state',
  'allowed_transitions',
  'in_progress_owner',
  'accepted',
  'assigned',
  'assigned_employee',
  'assigned_employee_name',
  'assigned_to_name',
  'assigned_employees',
  'department',
  'last_updated',
  'updated_at',
  'lastUpdate',
  'resolved_at',
  'closed_at',
  'last_reminder_sent_at',
];

const POLL_INTERVAL_MS = 20000;

export const toNumericTicketId = (ticket) => {
  if (!ticket) return null;
  const raw = ticket.ticket_ID ?? ticket.id;
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(String(raw).replace(/\D/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const hasAssignee = (fresh) =>
  (Array.isArray(fresh.assigned) && fresh.assigned.length > 0) ||
  (Array.isArray(fresh.assigned_employees) && fresh.assigned_employees.length > 0) ||
  Boolean(fresh.assigned_employee);

/**
 * Overlay server-owned fields from `fresh` onto `base`.
 * When the server reports no assignee we also clear the legacy `assigned_to` value so a ticket
 * that was unassigned/reassigned does not keep a stale technician name from the list snapshot.
 */
export const mergeLiveTicket = (base, fresh) => {
  if (!base || !fresh) return base;
  const next = { ...base };
  LIVE_FIELDS.forEach((key) => {
    if (fresh[key] !== undefined) next[key] = fresh[key];
  });
  if (!hasAssignee(fresh)) {
    next.assigned_to = null;
    next.assigned = [];
    next.assigned_employees = [];
    next.assigned_employee = null;
    next.assigned_employee_name = null;
    next.assigned_to_name = null;
  }
  return next;
};

/**
 * Keeps a ticket shown in a modal in sync with the backend.
 *
 * - Fetches fresh details when the modal opens (the list snapshot may be stale).
 * - Refetches when a `ticket.changed` websocket event for this ticket arrives, or when another
 *   part of this tab emits on `ticketBroadcast` (e.g. CS just assigned the ticket).
 * - Polls while mounted so it still updates when real-time is disabled (no-op Echo).
 *
 * Returns the ticket merged with the latest server state, plus a `refresh()` to force a refetch.
 */
export default function useLiveTicket(ticket, { enabled = true } = {}) {
  const ticketId = toNumericTicketId(ticket);
  const skip = !enabled || !ticketId || Boolean(ticket?.isMock);

  const [fresh, setFresh] = useState(null);
  const requestSeq = useRef(0);
  const activeId = useRef(ticketId);
  activeId.current = ticketId;

  const refresh = useCallback(async () => {
    if (skip) return;
    const seq = ++requestSeq.current;
    try {
      const details = await getTicketDetails(ticketId, { forceRefresh: true });
      // Ignore out-of-order responses and responses for a ticket we are no longer showing.
      if (seq !== requestSeq.current || activeId.current !== ticketId || !details) return;
      setFresh(details);
    } catch {
      // Keep showing the snapshot we already have; the next event/poll will retry.
    }
  }, [skip, ticketId]);

  useEffect(() => {
    setFresh(null);
  }, [ticketId]);

  useEffect(() => {
    if (skip) return undefined;

    refresh();

    const matches = (id) => Number(id) === ticketId;

    const channel = echo.channel('ticket-updates');
    const onTicketChanged = (payload) => {
      const changedId = payload?.ticket_ID ?? payload?.ticketId ?? payload?.ticket_id;
      // Config/notification events carry no ticket id; they are not about this ticket.
      if (!changedId || !matches(changedId)) return;
      refresh();
    };
    channel.listen('.ticket.changed', onTicketChanged);

    const unsubscribeLocal = ticketBroadcast.subscribe((event) => {
      const changedId = toNumericTicketId(event?.ticket);
      if (changedId && matches(changedId)) refresh();
    });

    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(timer);
      unsubscribeLocal();
      // Pass our own callback so we never strip other components' listeners from the shared channel.
      channel?.stopListening?.('.ticket.changed', onTicketChanged);
    };
  }, [skip, ticketId, refresh]);

  const merged = useMemo(() => {
    if (!fresh || toNumericTicketId(fresh) !== ticketId) return ticket;
    return mergeLiveTicket(ticket, fresh);
  }, [ticket, fresh, ticketId]);

  return { ticket: merged, refresh };
}
