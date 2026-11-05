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

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/hooks/useRealtimeRefresh', () => ({ default: vi.fn() }));

// Stub the modals so the test exercises the dashboard's own wiring (handleAssignSave).
vi.mock('@/components/CustomerTicketDetailModal', () => ({
  default: ({ ticket, onAssign }) => (
    <button onClick={() => onAssign(ticket)}>stub-open-assign</button>
  ),
}));
vi.mock('@/components/CSModals', () => ({
  AssignModal: ({ ticket, onSave, onClose }) => (
    <div>
      <span>assign-modal-{ticket.ticket_ID}</span>
      <button
        onClick={async () => {
          const ok = await onSave({ ...ticket, priority: 'High', assigned: [7, 9] });
          if (ok) onClose();
        }}
      >
        stub-save-assign
      </button>
    </div>
  ),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useOutletContext: () => ({ refreshKey: 0 }),
  };
});

describe('CSDashboard assignment flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuth.mockReturnValue({
      user: { id: 3, email: 'cs@example.com', first_name: 'Carla', last_name: 'Santos' },
    });
    ticketService.getAssignableEmployees.mockResolvedValue([]);
    ticketService.getDepartments.mockResolvedValue([]);
    ticketService.getCSDashboardSummary.mockResolvedValue({
      queued_tickets: {
        count: 1,
        items: [
          {
            ref: 'TKT-201',
            ticket_ID: 201,
            title: 'Network Switch Error',
            customer: 'St Jude Hospital',
            status: 'Open',
            priority: 'High',
            created_at: '2026-11-03T09:00:00Z',
          },
        ],
      },
      assigned_monitored: { count: 0, by_status: {} },
      workload_metrics: { active_tickets: 0, at_risk: 0, breached: 0, pending_reassignments: 0 },
      needs_attention: { count: 0, items: [] },
      partial_errors: [],
    });
    ticketService.getTicketDetails.mockResolvedValue({ ticket_ID: 201, title: 'Network Switch Error' });
    ticketService.acceptTicket.mockResolvedValue({});
  });

  it('opens AssignModal without crashing and saves through acceptTicket', async () => {
    render(
      <MemoryRouter>
        <CSDashboard />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('Network Switch Error')).toBeInTheDocument());

    // Open the ticket detail modal from the queue row.
    const row = screen.getByText('Network Switch Error').closest('tr') || screen.getByText('Network Switch Error');
    const rowButton = row.querySelector ? row.querySelector('button') : null;
    fireEvent.click(rowButton || screen.getByText('Network Switch Error'));

    fireEvent.click(await screen.findByText('stub-open-assign'));
    expect(await screen.findByText('assign-modal-201')).toBeInTheDocument();

    fireEvent.click(screen.getByText('stub-save-assign'));

    await waitFor(() => {
      expect(ticketService.acceptTicket).toHaveBeenCalledWith({
        ticketId: 201,
        employeeIds: [7, 9],
        assignedByEmail: 'cs@example.com',
        priorityId: 3,
      });
    });

    // Modal closes and the dashboard reloads its summary after a successful save.
    await waitFor(() => expect(screen.queryByText('assign-modal-201')).not.toBeInTheDocument());
    await waitFor(() => expect(ticketService.getCSDashboardSummary.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});

