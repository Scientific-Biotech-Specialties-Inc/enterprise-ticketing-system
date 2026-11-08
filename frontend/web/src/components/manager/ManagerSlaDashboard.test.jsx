import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ServiceManagerDashboard from '@/pages/ServiceManagerDashboard';
import CSManagerDashboard from '@/pages/CSManagerDashboard';
import * as ticketService from '@/services/ticketService';
import { useAuth } from '@/context/AuthContext';
import { formatOverdueMinutes } from './ManagerSlaDashboard';

vi.mock('@/services/ticketService', () => ({
  getManagerDashboard: vi.fn(),
  getAssignableEmployees: vi.fn(),
  assignTicketToEmployees: vi.fn(),
  getDepartments: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/components/CSModals', () => ({
  AssignModal: () => null,
}));

vi.mock('@/components/CustomerTicketDetailModal', () => ({
  default: () => null,
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// Shape returned by GET /manager/dashboard (spec 0031 AC-7).
const payload = (over = {}) => ({
  status: 'success',
  scope: { department: 'Service', branch_id: 1, branch_name: 'Main Branch', mode: 'department' },
  summary: { total_open: 0, unassigned: 0, within_sla: 0, breached: 0 },
  breached_queue: [],
  generated_at: '2026-11-05T10:00:00+00:00',
  ...over,
});

const breachRow = (over = {}) => ({
  ticket_ID: 501,
  ticket_number: 'TKT-501',
  title: 'Infusion pump calibration overdue',
  status_name: 'In Progress',
  priority_name: 'High',
  department: 'Service',
  assignee_id: 77,
  assignee_name: 'Grace Uy',
  resolution_due_at: '2026-10-06T08:00:00+00:00',
  overdue_minutes: 3 * 24 * 60 + 120,
  created_at: '2026-10-01T08:00:00+00:00',
  ...over,
});

const renderPage = (Page) =>
  render(
    <MemoryRouter>
      <Page />
    </MemoryRouter>
  );

describe('Manager SLA dashboards (spec 0031 AC-10, AC-11)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useAuth.mockReturnValue({ user: { email: 'manager.service@sbsi.com' } });
    ticketService.getAssignableEmployees.mockResolvedValue([
      { id: 77, name: 'Grace Uy', department: 'Service', position_level: 'Engineer' },
      { id: 88, name: 'Ian IT', department: 'IT', position_level: 'Employee' },
    ]);
    ticketService.getDepartments.mockResolvedValue([]);
  });

  it('shows the Zero SLA Breaches state and no sample tickets when the queue is empty', async () => {
    ticketService.getManagerDashboard.mockResolvedValue(payload({ summary: { total_open: 3, unassigned: 0, within_sla: 3, breached: 0 } }));

    renderPage(ServiceManagerDashboard);

    expect(await screen.findByText('Zero SLA Breaches!')).toBeInTheDocument();
    expect(screen.queryByText(/TICK-SRV/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Siemens|Carlos Mendoza/)).not.toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('lists the real breached tickets from the server, most overdue first as given', async () => {
    ticketService.getManagerDashboard.mockResolvedValue(
      payload({
        summary: { total_open: 4, unassigned: 0, within_sla: 2, breached: 2 },
        breached_queue: [breachRow(), breachRow({ ticket_ID: 502, ticket_number: 'TKT-502', title: 'Second overdue', overdue_minutes: 30 })],
      })
    );

    renderPage(ServiceManagerDashboard);

    expect(await screen.findByText('TKT-501')).toBeInTheDocument();
    expect(screen.getByText('TKT-502')).toBeInTheDocument();
    expect(screen.getByText('Overdue by 3d 2h')).toBeInTheDocument();
    expect(screen.getByText('2 Overdue')).toBeInTheDocument();
  });

  it('shows an error state with Retry when the request fails, then recovers on Retry', async () => {
    ticketService.getManagerDashboard
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(payload());

    renderPage(ServiceManagerDashboard);

    expect(await screen.findByText('Live SLA data unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Zero SLA Breaches!')).not.toBeInTheDocument();
    expect(screen.queryByText(/TICK-SRV/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));

    expect(await screen.findByText('Zero SLA Breaches!')).toBeInTheDocument();
    expect(ticketService.getManagerDashboard).toHaveBeenLastCalledWith({ forceRefresh: true });
  });

  it('loads assignable staff for the manager department only', async () => {
    ticketService.getManagerDashboard.mockResolvedValue(payload());

    renderPage(ServiceManagerDashboard);

    await waitFor(() => expect(ticketService.getAssignableEmployees).toHaveBeenCalledWith({ department: 'Service' }));
    expect(await screen.findByText('Grace Uy')).toBeInTheDocument();
    expect(screen.queryByText('Ian IT')).not.toBeInTheDocument();
  });

  it('CS manager sees unassigned breaches with a Department column and every assignable employee', async () => {
    ticketService.getManagerDashboard.mockResolvedValue(
      payload({
        scope: { department: 'Customer Service', branch_id: 1, branch_name: 'Main Branch', mode: 'branch' },
        summary: { total_open: 5, unassigned: 1, within_sla: 2, breached: 1 },
        breached_queue: [breachRow({ department: null, assignee_id: null, assignee_name: null })],
      })
    );

    renderPage(CSManagerDashboard);

    expect(await screen.findByText('TKT-501')).toBeInTheDocument();
    expect(screen.getByText('Department')).toBeInTheDocument();
    expect(screen.getAllByText('Unassigned').length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(ticketService.getAssignableEmployees).toHaveBeenCalledWith({ department: undefined }));
    expect(await screen.findByText('Ian IT')).toBeInTheDocument();
  });

  it('shows No data instead of 100% when nothing open has an SLA outcome', async () => {
    ticketService.getManagerDashboard.mockResolvedValue(payload());

    renderPage(ServiceManagerDashboard);

    expect(await screen.findByText('No data')).toBeInTheDocument();
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
  });

  it('formats overdue minutes', () => {
    expect(formatOverdueMinutes(45)).toBe('Overdue by 45m');
    expect(formatOverdueMinutes(125)).toBe('Overdue by 2h 5m');
    expect(formatOverdueMinutes(2 * 1440 + 60)).toBe('Overdue by 2d 1h');
  });
});
