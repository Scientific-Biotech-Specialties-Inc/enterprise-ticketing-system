import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CSDashboard from './CSDashboard';
import * as ticketService from '@/services/ticketService';
import { useAuth } from '@/context/AuthContext';

vi.mock('@/services/ticketService', () => ({
  getCSDashboardSummary: vi.fn(),
  getTicketDetails: vi.fn(),
  getAssignableEmployees: vi.fn(),
  getDepartments: vi.fn(),
  acceptTicket: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/hooks/useRealtimeRefresh', () => ({
  default: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useOutletContext: () => ({ refreshKey: 0 }),
  };
});

// Shape returned by GET /cs-dashboard-summary (spec 0028 AC-12).
const summary = (over = {}) => ({
  status: 'success',
  queued_tickets: {
    count: 4,
    items: [
      { ref: 'TKT-201', ticket_ID: 201, title: 'Network Switch Error', customer: 'St Jude Hospital', status: 'Open', priority: 'High', sla_status: 'On Track', created_at: '2026-11-03T09:00:00Z' },
    ],
  },
  assigned_monitored: { count: 6, by_status: { Open: 1, 'In Progress': 3, 'On Hold': 1, Resolved: 1 } },
  workload_metrics: { active_tickets: 5, at_risk: 2, breached: 1, pending_reassignments: 1 },
  needs_attention: {
    count: 2,
    items: [
      { ref: 'TKT-301', ticket_ID: 301, title: 'Radiology Workstation Setup', customer: 'Imaging', status: 'In Progress', priority: 'High', reason: 'Breached', created_at: '2026-11-03T08:30:00Z' },
      { ref: 'TKT-302', ticket_ID: 302, title: 'Reassign request ticket', customer: 'Dr Santos', status: 'Pending Reassignment', priority: 'High', reason: 'Reassignment pending', requested_at: '2026-11-03T08:00:00Z' },
    ],
  },
  pending_reassignments: { count: 1 },
  partial_errors: [],
  ...over,
});

describe('CSDashboard operational workspace (AC-12, AC-20)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useAuth.mockReturnValue({
      user: { id: 3, first_name: 'Carla', last_name: 'Santos', role: 'Customer Service' },
    });
    ticketService.getAssignableEmployees.mockResolvedValue([]);
    ticketService.getDepartments.mockResolvedValue([]);
  });

  it('renders the header and workload cards from the per agent summary', async () => {
    ticketService.getCSDashboardSummary.mockResolvedValue(summary());
    render(<MemoryRouter><CSDashboard /></MemoryRouter>);

    expect(screen.getByText(/Carla Santos/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Queued Tickets')).toBeInTheDocument();
      expect(screen.getByText('Assigned Workload')).toBeInTheDocument();
      expect(screen.getByText('Approaching SLA')).toBeInTheDocument();
      expect(screen.getAllByText('SLA Breached').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByText('Read-Only Summary')).toBeInTheDocument();
    expect(ticketService.getCSDashboardSummary).toHaveBeenCalledTimes(1);
  });

  it('shows queued tickets and urgent attention items including pending reassignments', async () => {
    ticketService.getCSDashboardSummary.mockResolvedValue(summary());
    render(<MemoryRouter><CSDashboard /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Network Switch Error')).toBeInTheDocument();
      expect(screen.getByText(/St Jude Hospital/)).toBeInTheDocument();
      expect(screen.getByText(/Radiology Workstation Setup/)).toBeInTheDocument();
      expect(screen.getByText(/Reassign request ticket/)).toBeInTheDocument();
    });
  });

  it('does not invent numbers when the summary is empty', async () => {
    ticketService.getCSDashboardSummary.mockResolvedValue(
      summary({
        queued_tickets: { count: 0, items: [] },
        assigned_monitored: { count: 0, by_status: {} },
        workload_metrics: { active_tickets: 0, at_risk: 0, breached: 0, pending_reassignments: 0 },
        needs_attention: { count: 0, items: [] },
      })
    );
    render(<MemoryRouter><CSDashboard /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('Approaching SLA')).toBeInTheDocument());
    // The old page showed made up values (7, 9, 3) whenever data was missing.
    expect(screen.queryByText('7')).not.toBeInTheDocument();
    expect(screen.queryByText('9')).not.toBeInTheDocument();
  });

  it('keeps the other sections visible when one section fails on the server', async () => {
    ticketService.getCSDashboardSummary.mockResolvedValue(
      summary({
        workload_metrics: null,
        assigned_monitored: null,
        partial_errors: [
          { section: 'assigned_monitored', message: 'This section could not be loaded.' },
          { section: 'workload_metrics', message: 'Depends on assigned and monitored tickets.' },
        ],
      })
    );
    render(<MemoryRouter><CSDashboard /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Workload summary data is temporarily unavailable.')).toBeInTheDocument();
    });
    expect(screen.getByText('Network Switch Error')).toBeInTheDocument();
    expect(screen.getByText(/Radiology Workstation Setup/)).toBeInTheDocument();
  });

  it('shows an error state with retry for every section when the request fails', async () => {
    ticketService.getCSDashboardSummary.mockRejectedValue(new Error('Network error'));
    render(<MemoryRouter><CSDashboard /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Workload summary data is temporarily unavailable.')).toBeInTheDocument();
    });
    expect(screen.getByText('Incoming queued tickets failed to load.')).toBeInTheDocument();
    expect(screen.getByText('Tickets needing immediate attention could not be fetched.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /retry/i }).length).toBeGreaterThanOrEqual(1);
  });

  it('opens the ticket detail modal from a triage action', async () => {
    ticketService.getCSDashboardSummary.mockResolvedValue(summary());
    ticketService.getTicketDetails.mockResolvedValue({
      ticket_ID: 301,
      title: 'Radiology Workstation Setup',
      description: 'Full ticket description',
      status: 'In Progress',
    });
    render(<MemoryRouter><CSDashboard /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText(/Radiology Workstation Setup/)).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: /triage/i })[0]);

    await waitFor(() => expect(ticketService.getTicketDetails).toHaveBeenCalledWith(301));
  });
});
