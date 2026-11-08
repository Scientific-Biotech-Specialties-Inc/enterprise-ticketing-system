import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EmployeeTicketUpdate from './EmployeeTicketUpdate';
import * as ticketService from '@/services/ticketService';

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 6, emp_id: 6, name: 'Support Engineer', role: 'technician' },
  })),
}));

vi.mock('@/hooks/useRealtimeRefresh', () => ({
  default: vi.fn(),
}));

vi.mock('@/services/ticketService', () => ({
  getTicketDetails: vi.fn(),
  updateEmployeeTicket: vi.fn(),
  saveWorkLog: vi.fn(),
  getCustomerTicketContext: vi.fn(() => Promise.resolve({ customer: {}, machine: {} })),
}));

describe('EmployeeTicketUpdate Component Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads ticket details from backend when given state.ticket and displays ticket details', async () => {
    ticketService.getTicketDetails.mockResolvedValueOnce({
      id: 'TKTS-00017',
      ticket_ID: 8,
      title: 'Analyzer Transmission Failure',
      status: 'In Progress',
      priority: 'Medium',
      description: 'Results from analyzer are not reaching LIS',
      resolution_due_at: '2026-10-25T10:41:40+00:00',
      timeline: [],
    });

    render(
      <MemoryRouter initialEntries={[{ pathname: '/employee/ticket-update', state: { ticket: { ticket_ID: 8, status: 'In Progress' } } }]}>
        <Routes>
          <Route path="/employee/ticket-update" element={<EmployeeTicketUpdate />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Analyzer Transmission Failure')).toBeInTheDocument();
      expect(screen.getByText('Results from analyzer are not reaching LIS')).toBeInTheDocument();
    });

    expect(screen.queryByText(/Failed to load ticket details/i)).not.toBeInTheDocument();
  });

  it('loads ticket details from ?id= query parameter when state is null (e.g. direct link or page refresh)', async () => {
    ticketService.getTicketDetails.mockResolvedValueOnce({
      id: 'TKTS-00017',
      ticket_ID: 8,
      title: 'Direct Link Loaded Ticket',
      status: 'In Progress',
      priority: 'High',
      description: 'Loaded without state object',
      resolution_due_at: '2026-10-25T10:41:40+00:00',
      timeline: [],
    });

    render(
      <MemoryRouter initialEntries={['/employee/ticket-update?id=8']}>
        <Routes>
          <Route path="/employee/ticket-update" element={<EmployeeTicketUpdate />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Direct Link Loaded Ticket')).toBeInTheDocument();
    });
  });

  it('displays error banner if getTicketDetails fails', async () => {
    ticketService.getTicketDetails.mockRejectedValueOnce({
      response: { data: { message: 'Ticket not found or unauthorized' } },
    });

    render(
      <MemoryRouter initialEntries={[{ pathname: '/employee/ticket-update', state: { ticket: { ticket_ID: 999, status: 'Open' } } }]}>
        <Routes>
          <Route path="/employee/ticket-update" element={<EmployeeTicketUpdate />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Ticket not found or unauthorized/i)).toBeInTheDocument();
    });
  });

  it('loads ticket details from state.ticketId without exposing ticket id in url query parameters', async () => {
    ticketService.getTicketDetails.mockResolvedValueOnce({
      id: 'TKTS-00015',
      ticket_ID: 6,
      title: 'State Loaded Secure Ticket',
      status: 'In Progress',
      priority: 'Medium',
      description: 'Loaded purely via router state without URL query parameters',
      timeline: [],
    });

    render(
      <MemoryRouter initialEntries={[{ pathname: '/employee/ticket-update', state: { ticketId: 6 } }]}>
        <Routes>
          <Route path="/employee/ticket-update" element={<EmployeeTicketUpdate />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('State Loaded Secure Ticket')).toBeInTheDocument();
    });
  });
});
