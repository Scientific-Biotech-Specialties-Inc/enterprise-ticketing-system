import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const listeners = {};
const mockChannel = {
  listen: vi.fn((event, cb) => {
    listeners[event] = cb;
    return mockChannel;
  }),
  stopListening: vi.fn((event, cb) => {
    if (listeners[event] === cb) delete listeners[event];
    return mockChannel;
  }),
};

vi.mock('@/services/echo', () => ({ default: { channel: vi.fn(() => mockChannel) } }));
vi.mock('@/services/ticketService', () => ({ getTicketDetails: vi.fn() }));

import { getTicketDetails } from '@/services/ticketService';
import { ticketBroadcast } from '@/services/ticketBroadcast';
import useLiveTicket, { mergeLiveTicket, toNumericTicketId } from './useLiveTicket';

const unassigned = {
  ticket_ID: 12,
  id: 'TKT-0012',
  status: 'Open',
  assigned_to: null,
  assigned: [],
  title: 'Printer down',
};

const assignedDetails = {
  ticket_ID: 12,
  status: 'Pending Assignment',
  assigned: [7],
  assigned_employee: 'Ana Cruz',
  assigned_employee_name: 'Ana Cruz',
  assigned_employees: [{ id: 7, name: 'Ana Cruz' }],
};

describe('useLiveTicket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(listeners).forEach((k) => delete listeners[k]);
  });

  it('fetches fresh details on open and overlays assignment onto a stale snapshot', async () => {
    getTicketDetails.mockResolvedValue(assignedDetails);
    const { result } = renderHook(() => useLiveTicket(unassigned));

    expect(result.current.ticket.assigned).toEqual([]);
    await waitFor(() => expect(result.current.ticket.assigned_employee).toBe('Ana Cruz'));

    expect(getTicketDetails).toHaveBeenCalledWith(12, { forceRefresh: true });
    expect(result.current.ticket.status).toBe('Pending Assignment');
    // Local-only fields on the snapshot are preserved.
    expect(result.current.ticket.title).toBe('Printer down');
  });

  it('refetches when a ticket.changed event for this ticket arrives', async () => {
    getTicketDetails.mockResolvedValueOnce({ ...unassigned, assigned: [], assigned_employees: [] });
    const { result } = renderHook(() => useLiveTicket(unassigned));
    await waitFor(() => expect(getTicketDetails).toHaveBeenCalledTimes(1));
    expect(result.current.ticket.assigned_employee ?? null).toBeNull();

    getTicketDetails.mockResolvedValueOnce(assignedDetails);
    await act(async () => {
      listeners['.ticket.changed']({ action: 'assigned', ticket_ID: 12 });
    });

    await waitFor(() => expect(result.current.ticket.assigned_employee).toBe('Ana Cruz'));
    expect(getTicketDetails).toHaveBeenCalledTimes(2);
  });

  it('ignores events for other tickets and config events without a ticket id', async () => {
    getTicketDetails.mockResolvedValue(assignedDetails);
    renderHook(() => useLiveTicket(unassigned));
    await waitFor(() => expect(getTicketDetails).toHaveBeenCalledTimes(1));

    await act(async () => {
      listeners['.ticket.changed']({ action: 'assigned', ticket_ID: 99 });
      listeners['.ticket.changed']({ type: 'config' });
    });

    expect(getTicketDetails).toHaveBeenCalledTimes(1);
  });

  it('refetches on a same-tab ticketBroadcast for this ticket', async () => {
    getTicketDetails.mockResolvedValue(assignedDetails);
    renderHook(() => useLiveTicket(unassigned));
    await waitFor(() => expect(getTicketDetails).toHaveBeenCalledTimes(1));

    await act(async () => {
      ticketBroadcast.emit('assigned', { ticket_ID: 12 });
    });

    await waitFor(() => expect(getTicketDetails).toHaveBeenCalledTimes(2));
  });

  it('removes only its own listener on unmount', async () => {
    getTicketDetails.mockResolvedValue(assignedDetails);
    const { unmount } = renderHook(() => useLiveTicket(unassigned));
    const handler = listeners['.ticket.changed'];
    unmount();
    expect(mockChannel.stopListening).toHaveBeenCalledWith('.ticket.changed', handler);
  });

  it('does not fetch for mock tickets or tickets without an id', () => {
    renderHook(() => useLiveTicket({ id: 'x', isMock: true }));
    renderHook(() => useLiveTicket(null));
    expect(getTicketDetails).not.toHaveBeenCalled();
  });

  it('keeps the snapshot when the fetch fails', async () => {
    getTicketDetails.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useLiveTicket(unassigned));
    await waitFor(() => expect(getTicketDetails).toHaveBeenCalled());
    expect(result.current.ticket).toBe(unassigned);
  });
});

describe('mergeLiveTicket', () => {
  it('clears a stale assignee when the server reports none', () => {
    const stale = { ...unassigned, assigned_to: 'Ana Cruz', assigned_employee: 'Ana Cruz', assigned: [7] };
    const merged = mergeLiveTicket(stale, { ticket_ID: 12, status: 'Open', assigned: [], assigned_employees: [] });
    expect(merged.assigned_to).toBeNull();
    expect(merged.assigned_employee).toBeNull();
    expect(merged.assigned).toEqual([]);
  });

  it('parses numeric ids from ticket_ID or the display id', () => {
    expect(toNumericTicketId({ ticket_ID: 5 })).toBe(5);
    expect(toNumericTicketId({ id: 'TKT-0012' })).toBe(12);
    expect(toNumericTicketId({})).toBeNull();
  });
});
