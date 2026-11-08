import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as ticketService from '@/services/ticketService';
import CSIncoming from './CSIncoming';

/**
 * Spec 0037 (AC-14 to AC-16): the Incoming queue asks the server for one filtered page,
 * shows the server's rows as they are, and takes its card and tab counts from the server.
 */

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: { id: 1, email: 'cs@example.com', role: 'cs' } })),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ search: '', state: {} }),
}));

vi.mock('@/hooks/useRealtimeRefresh', () => ({ default: vi.fn() }));

const row = (id, title, sla) => ({
  id: `TCK-${id}`,
  ticket_ID: id,
  title,
  customer: 'Acme Clinic',
  category: 'Service',
  status: 'Open',
  priority: 'High',
  department: 'Service',
  sla_status: sla,
  assigned: [],
  accepted: false,
  created_at: '2026-11-01T08:00:00Z',
});

const breachedRows = [row(201, 'Ventilator alarm fault', 'Breached'), row(202, 'Infusion pump error', 'Breached')];
const allRows = [...breachedRows, row(203, 'Monitor screen flicker', 'On Track')];

vi.mock('@/services/ticketService', () => ({
  getCSQueuePage: vi.fn((query = {}) => {
    const rows = query.sla === 'Breached' ? breachedRows : allRows;
    return Promise.resolve({
      tickets: rows,
      // The server total covers every page, not only the rows on screen.
      total: query.sla === 'Breached' ? 42 : 130,
      page: query.page ?? 1,
      perPage: 10,
      lastPage: query.sla === 'Breached' ? 5 : 13,
      slaSummary: { breached: 42, at_risk: 3, on_track: 80, paused: 5, compliant: 0, no_sla: 0 },
      tabCounts: { open: 70, pending: 60, all: 130 },
    });
  }),
  getAssignableEmployees: vi.fn(() => Promise.resolve([])),
  getDepartments: vi.fn(() => Promise.resolve([])),
  acceptTicket: vi.fn(() => Promise.resolve({})),
  getTicketFormOptions: vi.fn(() => Promise.resolve({})),
  prefetchTicketFormOptions: vi.fn(() => Promise.resolve({ ticket_priorities: [] })),
  respondReassignment: vi.fn(() => Promise.resolve({})),
  getTicketDetails: vi.fn(() => Promise.resolve({})),
  updateTicket: vi.fn(() => Promise.resolve({})),
  getCSFilterOptions: vi.fn(() => Promise.resolve({ departments: [], statuses: [], machines: [], categories: ['Service'], customers: ['Acme Clinic'] })),
  closeTicket: vi.fn(() => Promise.resolve({})),
  CS_TICKET_REFRESH_EVENT: 'cs:tickets:refresh',
}));

describe('CSIncoming server driven queue (spec 0037)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks for the incoming scope and the open tab, and shows server counts', async () => {
    render(<CSIncoming />);

    await waitFor(() => {
      expect(screen.getByText('Monitor screen flicker')).toBeInTheDocument();
    });

    expect(ticketService.getCSQueuePage).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'incoming', tab: 'open', page: 1, limit: 10 })
    );

    // Summary card and tab badge counts come from the server, not from the 3 rows on screen.
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('70')).toBeInTheDocument();
    expect(screen.getByText(/of 130 tickets/)).toBeInTheDocument();
  });

  it('clicking the Breached card asks the server and shows every page of breached tickets', async () => {
    render(<CSIncoming />);

    await waitFor(() => {
      expect(screen.getByText('Monitor screen flicker')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Resolution overdue').closest('button'));

    await waitFor(() => {
      expect(ticketService.getCSQueuePage).toHaveBeenLastCalledWith(
        expect.objectContaining({ scope: 'incoming', sla: 'Breached', page: 1 })
      );
      expect(screen.queryByText('Monitor screen flicker')).not.toBeInTheDocument();
    });

    expect(screen.getByText('Ventilator alarm fault')).toBeInTheDocument();
    // The card said 42, and the list total says 42 across its pages.
    expect(screen.getByText(/of 42 tickets/)).toBeInTheDocument();
  });

  it('switching tabs asks the server for that tab', async () => {
    render(<CSIncoming />);

    await waitFor(() => {
      expect(screen.getByText('Monitor screen flicker')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText('Pending Assignment').find((el) => el.tagName === 'SPAN').closest('button'));

    await waitFor(() => {
      expect(ticketService.getCSQueuePage).toHaveBeenLastCalledWith(
        expect.objectContaining({ tab: 'pending_assignment', page: 1 })
      );
    });
  });
});
