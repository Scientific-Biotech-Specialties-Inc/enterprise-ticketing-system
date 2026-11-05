import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EmployeeDashboard from './EmployeeDashboard';
import * as ticketService from '@/services/ticketService';
import { useAuth } from '@/context/AuthContext';

vi.mock('@/services/ticketService', () => ({
  getEmployeeAssignedTickets: vi.fn(),
  getInternalTickets: vi.fn(),
  getTicketDetails: vi.fn(),
  getEmployeeProfile: vi.fn(),
  clearEmployeeTicketsCache: vi.fn(),
  acceptTicket: vi.fn(),
  getInternalNotes: vi.fn().mockResolvedValue([]),
  addInternalNote: vi.fn(),
  updateEmployeeTicketOverride: vi.fn(),
}));

// The chat thread opens network connections; it is irrelevant to dashboard wiring.
vi.mock('@/components/InternalTicketMessageThread', () => ({ default: () => null }));

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
  };
});

const mockAssignedTickets = [
  {
    id: 'TKT-501',
    ticket_ID: 501,
    title: 'X-Ray Sensor Calibration',
    customer: 'St Anthony Medical Center',
    status: 'In Progress',
    priority: 'Critical',
    sla_breached: true,
    accepted: true,
    updated_at: '2026-11-03T10:30:00Z',
  },
  {
    id: 'TKT-502',
    ticket_ID: 502,
    title: 'Operating Room Monitor Replacement',
    customer: 'City Heart Center',
    status: 'Open',
    priority: 'High',
    sla_breached: false,
    accepted: false,
    updated_at: '2026-11-03T11:15:00Z',
  },
];

const mockMyRequests = [
  {
    id: 'INT-601',
    ticket_ID: 601,
    title: 'Request for New Antivirus License',
    status: 'Resolved',
    priority: 'Medium',
    created_at: '2026-11-02T14:00:00Z',
    updated_at: '2026-11-03T09:00:00Z',
  },
  {
    id: 'INT-602',
    ticket_ID: 602,
    title: 'VPN Access to Cebu Medical Server',
    status: 'Open',
    priority: 'Low',
    created_at: '2026-11-03T08:00:00Z',
    updated_at: '2026-11-03T08:00:00Z',
  },
];

describe('EmployeeDashboard dual panel workspace (AC-13, AC-14, AC-15, AC-20)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ticketService.getInternalNotes.mockResolvedValue([]);
    useAuth.mockReturnValue({
      user: {
        id: 5,
        emp_id: 5,
        email: 'tech.doe@example.com',
        first_name: 'John',
        last_name: 'Doe',
        role: 'employee',
      },
    });
  });

  it('renders dual panel workspace with assigned workload and requestor activity sections (covers: AC-13, AC-20)', async () => {
    ticketService.getEmployeeAssignedTickets.mockResolvedValue(mockAssignedTickets);
    ticketService.getInternalTickets.mockResolvedValue(mockMyRequests);

    render(
      <MemoryRouter>
        <EmployeeDashboard />
      </MemoryRouter>
    );

    expect(screen.getByText(/John Doe/)).toBeInTheDocument();
    expect(screen.getByText(/Manage your assigned technician work/)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Section I: Assigned Workload (My Work)')).toBeInTheDocument();
      expect(screen.getByText('Section II: Requestor Activity (My Requests)')).toBeInTheDocument();
    });
  });

  it('displays status breakdowns and attention items for assigned technician work (covers: AC-14)', async () => {
    ticketService.getEmployeeAssignedTickets.mockResolvedValue(mockAssignedTickets);
    ticketService.getInternalTickets.mockResolvedValue(mockMyRequests);

    render(
      <MemoryRouter>
        <EmployeeDashboard />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('X-Ray Sensor Calibration').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Operating Room Monitor Replacement').length).toBeGreaterThan(0);
      expect(screen.getByText(/Assigned Items Needing Immediate Action/)).toBeInTheDocument();
    });
  });

  it('switches between view sections when clicking navigation pills (covers: AC-13)', async () => {
    ticketService.getEmployeeAssignedTickets.mockResolvedValue(mockAssignedTickets);
    ticketService.getInternalTickets.mockResolvedValue(mockMyRequests);

    render(
      <MemoryRouter>
        <EmployeeDashboard />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Section I: Assigned Workload (My Work)')).toBeInTheDocument();
    });

    const requestsPill = screen.getByRole('button', { name: /my requests/i });
    fireEvent.click(requestsPill);

    await waitFor(() => {
      expect(screen.queryByText('Section I: Assigned Workload (My Work)')).toBeNull();
      expect(screen.getByText('Section II: Requestor Activity (My Requests)')).toBeInTheDocument();
    });
  });

  it('filters assigned tickets by search term (covers: AC-14, AC-20)', async () => {
    ticketService.getEmployeeAssignedTickets.mockResolvedValue(mockAssignedTickets);
    ticketService.getInternalTickets.mockResolvedValue(mockMyRequests);

    render(
      <MemoryRouter>
        <EmployeeDashboard />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('X-Ray Sensor Calibration').length).toBeGreaterThan(0);
    });

    const searchInput = screen.getByPlaceholderText('Search assigned...');
    fireEvent.change(searchInput, { target: { value: 'Calibration' } });

    await waitFor(() => {
      expect(screen.getAllByText('X-Ray Sensor Calibration').length).toBeGreaterThan(0);
      expect(screen.queryByRole('cell', { name: 'Operating Room Monitor Replacement' })).toBeNull();
    });
  });

  it('handles partial section error gracefully when assigned workload fails to load (covers: AC-7, AC-15)', async () => {
    ticketService.getEmployeeAssignedTickets.mockRejectedValue(new Error('Backend error'));
    ticketService.getInternalTickets.mockResolvedValue(mockMyRequests);

    render(
      <MemoryRouter>
        <EmployeeDashboard />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Unable to load assigned workload tickets.')).toBeInTheDocument();
    });

    expect(screen.getByText('Section II: Requestor Activity (My Requests)')).toBeInTheDocument();
  });

  describe('contextual ticket modals (covers: AC-3)', () => {
    beforeEach(() => {
      ticketService.getEmployeeAssignedTickets.mockResolvedValue(mockAssignedTickets);
      ticketService.getInternalTickets.mockResolvedValue(mockMyRequests);
      ticketService.getTicketDetails.mockImplementation(async (id) => ({ ticket_ID: id }));
    });

    const openTicket = async (title) => {
      render(
        <MemoryRouter>
          <EmployeeDashboard />
        </MemoryRouter>
      );
      await waitFor(() => expect(screen.getAllByText(title).length).toBeGreaterThan(0));
      fireEvent.click(screen.getAllByText(title)[0]);
    };

    it('opens the accept modal for an unaccepted ticket and accepts it', async () => {
      ticketService.acceptTicket.mockResolvedValue({});
      await openTicket('Operating Room Monitor Replacement');

      const acceptBtn = await screen.findByRole('button', { name: /^accept$/i });
      fireEvent.click(acceptBtn);

      await waitFor(() => {
        expect(ticketService.acceptTicket).toHaveBeenCalledWith({ ticketId: 502 });
      });
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /^accept$/i })).toBeNull();
      });
    });

    it('keeps the modal open and reports failure when accepting fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      ticketService.acceptTicket.mockRejectedValue(new Error('Already reassigned'));
      await openTicket('Operating Room Monitor Replacement');

      fireEvent.click(await screen.findByRole('button', { name: /^accept$/i }));

      await waitFor(() => {
        expect(ticketService.acceptTicket).toHaveBeenCalledWith({ ticketId: 502 });
      });
      // Modal stays open so the technician can retry, and the user gets a toast (console fallback outside a provider).
      expect(await screen.findByRole('button', { name: /^accept$/i })).toBeInTheDocument();
      await waitFor(() => {
        expect(
          consoleSpy.mock.calls.some((c) => String(c[0]).includes('[Toast Error]'))
        ).toBe(true);
      });
      consoleSpy.mockRestore();
    });

    it('does not offer Accept for an already accepted ticket', async () => {
      await openTicket('X-Ray Sensor Calibration');

      await waitFor(() => {
        expect(ticketService.getTicketDetails).toHaveBeenCalledWith(501);
      });
      expect(screen.queryByRole('button', { name: /^accept$/i })).toBeNull();
      expect(ticketService.acceptTicket).not.toHaveBeenCalled();
    });
  });
});
