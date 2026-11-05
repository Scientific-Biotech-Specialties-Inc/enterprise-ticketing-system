import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import SuperAdminDashboard from './SuperAdminDashboard';
import * as ticketService from '@/services/ticketService';

vi.mock('@/services/ticketService', () => ({
  getSystemDashboard: vi.fn(),
  triggerEtlSync: vi.fn(),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }) => <button onClick={onClick} type="button">{children}</button>,
  DropdownMenuSeparator: () => <hr />,
}));

vi.mock('react-chartjs-2', () => ({
  Bar: () => <div data-testid="bar-chart" />,
  Line: () => <div data-testid="line-chart" />,
}));

const apiPayload = {
  summary: {
    total_tickets: 16,
    active_tickets: 10,
    escalated_tickets: 1,
    sla_breaches: 6,
    tickets_created_today: 3,
    users_by_role: { customer: 46, employee: 37, cs: 4, admin: 1, superadmin: 2, total: 90 },
  },
  kpis: { sla_compliance_rate: 62.5, avg_resolution_hours: 3.3, csat_score: null },
  branch_comparisons: [
    { branch_id: 1, branch_name: 'Main Branch', branch_code: 'MAIN', region: 'NCR', total_tickets: 12, resolved_tickets: 3, active_tickets: 7, escalated_tickets: 0, sla_breaches: 6, sla_compliance_rate: 50, avg_resolution_hours: 3.3, csat_score: null },
    { branch_id: 5, branch_name: 'Cebu City Office', branch_code: 'CEBU', region: 'Visayas', total_tickets: 0, resolved_tickets: 0, active_tickets: 0, escalated_tickets: 0, sla_breaches: 0, sla_compliance_rate: 100, avg_resolution_hours: 0, csat_score: null },
  ],
  recent_activity: [
    { log_id: 9, ticket_id: 4, ticket_number: 'TKTS-00015', ticket_title: 'Analyzer fault', branch_name: 'Main Branch', event_type: 'sla_breached', actor_name: 'Ava Santos', is_system: false, created_at: new Date().toISOString() },
  ],
};

describe('SuperAdminDashboard (spec 0028 AC-8 to AC-11)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('shows figures from the real endpoint, not simulated numbers', async () => {
    ticketService.getSystemDashboard.mockResolvedValue(apiPayload);
    render(<SuperAdminDashboard />);

    await waitFor(() => expect(screen.getByText('90')).toBeInTheDocument());
    expect(screen.getByText('16')).toBeInTheDocument();
    expect(screen.getByText('10 / 1')).toBeInTheDocument();
    expect(screen.getByText('62.5%')).toBeInTheDocument();
    expect(screen.getByText('TKTS-00015:')).toBeInTheDocument();
    expect(screen.queryByText('412')).not.toBeInTheDocument();
    expect(ticketService.getSystemDashboard).toHaveBeenCalledWith({ preset: 'Last 7 Days' });
  });

  it('labels missing CSAT as unavailable instead of inventing a score', async () => {
    ticketService.getSystemDashboard.mockResolvedValue(apiPayload);
    render(<SuperAdminDashboard />);

    await waitFor(() => expect(screen.getAllByText('Unavailable').length).toBeGreaterThanOrEqual(1));
    expect(screen.queryByText(/4\.8 \/ 5\.0/)).not.toBeInTheDocument();
    expect(screen.getByText('No Data')).toBeInTheDocument();
  });

  it('requests the selected period from the server', async () => {
    ticketService.getSystemDashboard.mockResolvedValue(apiPayload);
    render(<SuperAdminDashboard />);
    await waitFor(() => expect(ticketService.getSystemDashboard).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'This Month' }));

    await waitFor(() => expect(ticketService.getSystemDashboard).toHaveBeenLastCalledWith({ preset: 'This Month' }));
  });

  it('shows a data unavailable state for each section when the request fails', async () => {
    ticketService.getSystemDashboard.mockRejectedValue(new Error('Network Error'));
    render(<SuperAdminDashboard />);

    await waitFor(() => expect(screen.getAllByText(/Data unavailable/i).length).toBeGreaterThanOrEqual(3));
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThanOrEqual(3);
  });
});
