import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CSDashboard from './CSDashboard';
import * as ticketService from '@/services/ticketService';
import { useAuth } from '@/context/AuthContext';

vi.mock('@/services/ticketService', () => ({
  getCSDashboard: vi.fn(),
  getCSIncomingTickets: vi.fn(),
  getReassignmentRequests: vi.fn(),
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

const mockSummaryPayload = {
  summary: {
    open: 4,
    in_progress: 8,
    resolved: 15,
    sla_breached: 1,
    high_priority: 3,
  },
  recent_tickets: [
    {
      id: 'TKT-101',
      ticket_ID: 101,
      title: 'POS Terminal Down in Pharmacy',
      customer: 'General Hospital',
      status: 'Open',
      priority: 'Critical',
      sla_breached: true,
      updated_at: '2026-11-03T10:00:00Z',
    },
  ],
};

const mockIncomingPayload = [
  {
    id: 'TKT-201',
    ticket_ID: 201,
    title: 'Network Switch Error',
    customer: 'St Jude Hospital',
    status: 'Open',
    priority: 'High',
    created_at: '2026-11-03T09:00:00Z',
  },
];

const mockReassignPayload = [
  {
    ticket_ref: 'TKT-301',
    ticket_id: 301,
    ticket_title: 'Radiology Workstation Setup',
    requesting_employee_name: 'Dr Santos',
    requesting_employee_department: 'Imaging',
    reason: 'Requires specialized technician',
    priority: 'High',
    created_at: '2026-11-03T08:30:00Z',
  },
];

describe('CSDashboard operational workspace (AC-12, AC-20)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({
      user: {
        id: 3,
        first_name: 'Carla',
        last_name: 'Santos',
        role: 'Customer Service',
      },
    });
    ticketService.getAssignableEmployees.mockResolvedValue([]);
    ticketService.getDepartments.mockResolvedValue([]);
  });

  it('renders CS traffic dashboard header and workload metric cards (covers: AC-12, AC-20)', async () => {
    ticketService.getCSDashboard.mockResolvedValue(mockSummaryPayload);
    ticketService.getCSIncomingTickets.mockResolvedValue(mockIncomingPayload);
    ticketService.getReassignmentRequests.mockResolvedValue(mockReassignPayload);

    render(
      <MemoryRouter>
        <CSDashboard />
      </MemoryRouter>
    );

    expect(screen.getByText(/Carla Santos/)).toBeInTheDocument();
    expect(screen.getByText(/Manage incoming ticket queues/)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Queued Tickets')).toBeInTheDocument();
      expect(screen.getByText('Assigned Workload')).toBeInTheDocument();
      expect(screen.getByText('Approaching SLA')).toBeInTheDocument();
      expect(screen.getByText('SLA Breached')).toBeInTheDocument();
    });

    expect(screen.getByText('Read-Only Summary')).toBeInTheDocument();
  });

  it('renders incoming queued tickets table and urgent attention items (covers: AC-12)', async () => {
    ticketService.getCSDashboard.mockResolvedValue(mockSummaryPayload);
    ticketService.getCSIncomingTickets.mockResolvedValue(mockIncomingPayload);
    ticketService.getReassignmentRequests.mockResolvedValue(mockReassignPayload);

    render(
      <MemoryRouter>
        <CSDashboard />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Network Switch Error')).toBeInTheDocument();
      expect(screen.getByText(/St Jude Hospital/)).toBeInTheDocument();
      expect(screen.getByText(/Radiology Workstation Setup/)).toBeInTheDocument();
    });
  });

  it('handles partial section failure gracefully when workload API throws (covers: AC-7, AC-12)', async () => {
    ticketService.getCSDashboard.mockRejectedValue(new Error('Network error'));
    ticketService.getCSIncomingTickets.mockResolvedValue(mockIncomingPayload);
    ticketService.getReassignmentRequests.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <CSDashboard />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Workload summary data is temporarily unavailable.')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('allows opening detail modal on clicking triage action (covers: AC-16, AC-20)', async () => {
    ticketService.getCSDashboard.mockResolvedValue(mockSummaryPayload);
    ticketService.getCSIncomingTickets.mockResolvedValue(mockIncomingPayload);
    ticketService.getReassignmentRequests.mockResolvedValue(mockReassignPayload);
    ticketService.getTicketDetails.mockResolvedValue({
      ticket_ID: 301,
      title: 'Radiology Workstation Setup',
      description: 'Full ticket description',
      status: 'Pending Reassignment',
    });

    render(
      <MemoryRouter>
        <CSDashboard />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Radiology Workstation Setup/)).toBeInTheDocument();
    });

    const triageButton = screen.getAllByRole('button', { name: /triage/i })[0];
    fireEvent.click(triageButton);

    await waitFor(() => {
      expect(ticketService.getTicketDetails).toHaveBeenCalledWith(301);
    });
  });
});
