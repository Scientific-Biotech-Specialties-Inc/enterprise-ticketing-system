import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DepartmentPerformanceView from './DepartmentPerformanceView';
import { classifyWorkloadImbalance } from '@/services/dashboardAnalyticsService';
import * as ticketService from '@/services/ticketService';

vi.mock('@/services/ticketService', () => ({
  getAdminDepartmentPerformance: vi.fn(),
}));

vi.mock('react-chartjs-2', () => ({
  Bar: ({ data }) => <div data-testid="bar-chart" data-labels={JSON.stringify(data?.labels)} />,
}));

// Shape of GET /admin-reports/departments (spec 0029 AC-7 to AC-9).
const apiPayload = {
  status: 'success',
  preset: 'Last 7 Days',
  departments: [
    {
      department: 'Service',
      staff_count: 3,
      has_data: true,
      period_status: 'active',
      total_tickets: 10,
      resolved_tickets: 3,
      resolution_rate: 30,
      avg_resolution_hours: 3.3,
      sla_compliance_rate: 50,
      csat_score: null,
      open_tickets_count: 2,
      overdue_tickets_count: 5,
      unclosed_tickets_count: 7,
      workload_distribution: [
        { employee_id: 1, name: 'Ana Cruz', active_tickets_count: 5, share_percentage: 71.4 },
        { employee_id: 2, name: 'Ben Diaz', active_tickets_count: 1, share_percentage: 14.3 },
        { employee_id: 3, name: 'Cy Lim', active_tickets_count: 1, share_percentage: 14.3 },
      ],
    },
    {
      department: 'Operations',
      staff_count: 6,
      has_data: false,
      period_status: 'no_data',
      total_tickets: 0,
      resolved_tickets: 0,
      resolution_rate: null,
      avg_resolution_hours: null,
      sla_compliance_rate: null,
      csat_score: null,
      open_tickets_count: 0,
      overdue_tickets_count: 0,
      workload_distribution: [],
    },
  ],
};

const renderView = (props = {}) =>
  render(
    <MemoryRouter>
      <DepartmentPerformanceView branchName="Main Branch" selectedPeriod="Last 7 Days" {...props} />
    </MemoryRouter>
  );

describe('DepartmentPerformanceView (spec 0029 AC-7 to AC-9)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('loads the real endpoint for the selected period', async () => {
    ticketService.getAdminDepartmentPerformance.mockResolvedValue(apiPayload);
    renderView();

    await screen.findByText('Service');
    expect(ticketService.getAdminDepartmentPerformance).toHaveBeenCalledWith({ preset: 'Last 7 Days' });
  });

  it('sends the custom date window when the period is a custom range', async () => {
    ticketService.getAdminDepartmentPerformance.mockResolvedValue(apiPayload);
    renderView({ selectedPeriod: 'Custom Range', dateFrom: '2026-10-01', dateTo: '2026-10-31' });

    await screen.findByText('Service');
    expect(ticketService.getAdminDepartmentPerformance).toHaveBeenCalledWith({
      preset: 'custom',
      date_from: '2026-10-01',
      date_to: '2026-10-31',
    });
  });

  it('keeps open and overdue as separate counts', async () => {
    ticketService.getAdminDepartmentPerformance.mockResolvedValue(apiPayload);
    renderView();

    await screen.findByText('Service');
    expect(screen.getByText('2 Open')).toBeInTheDocument();
    expect(screen.getByText('5 Overdue')).toBeInTheDocument();
  });

  it('says "No data for this period" instead of showing zeros', async () => {
    ticketService.getAdminDepartmentPerformance.mockResolvedValue(apiPayload);
    renderView();

    await screen.findByText('Operations');
    expect(screen.getByText(/no data for this period/i)).toBeInTheDocument();
  });

  it('does not invent CSAT when none was recorded', async () => {
    ticketService.getAdminDepartmentPerformance.mockResolvedValue(apiPayload);
    renderView();

    await screen.findByText('Service');
    expect(screen.queryByText(/★/)).not.toBeInTheDocument();
  });

  it('flags the department where one person carries most of the open work', async () => {
    ticketService.getAdminDepartmentPerformance.mockResolvedValue(apiPayload);
    renderView();

    await screen.findByText('Service');
    // 5 open for the busiest of 3 staff against an average of 2.33 is more than 2x.
    expect(screen.getByText(/High Imbalance/)).toBeInTheDocument();
  });

  it('drills down into the individual employees of a department', async () => {
    ticketService.getAdminDepartmentPerformance.mockResolvedValue(apiPayload);
    renderView();

    await screen.findByText('Service');
    fireEvent.click(screen.getAllByRole('button', { name: /Drill Down/i })[0]);

    const heading = await screen.findByText('Service Team Drill-Down');
    expect(heading).toBeInTheDocument();
    expect(screen.getByText('Ana Cruz')).toBeInTheDocument();
    expect(screen.getByText(/5 open • 71.4%/)).toBeInTheDocument();
    expect(screen.getByText('Ben Diaz')).toBeInTheDocument();
  });

  it('shows a data unavailable state with retry when the request fails', async () => {
    ticketService.getAdminDepartmentPerformance.mockRejectedValueOnce(new Error('Network Error'));
    ticketService.getAdminDepartmentPerformance.mockResolvedValueOnce(apiPayload);
    renderView();

    await screen.findByText('Data unavailable');
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));

    await screen.findByText('Service');
  });
});

describe('classifyWorkloadImbalance', () => {
  const staff = (...counts) => counts.map((activeTickets, i) => ({ id: i, activeTickets }));

  it('is balanced for even work', () => {
    expect(classifyWorkloadImbalance(staff(3, 3, 3))).toBe('Balanced');
  });

  it('is moderate at 1.5x the average and high at 2x', () => {
    expect(classifyWorkloadImbalance(staff(6, 3, 3))).toBe('Moderate'); // 6 vs avg 4 = 1.5x
    expect(classifyWorkloadImbalance(staff(5, 1, 0))).toBe('High Imbalance'); // 5 vs avg 2 = 2.5x
  });

  it('does not judge tiny samples', () => {
    expect(classifyWorkloadImbalance(staff(2))).toBe('Balanced');
    expect(classifyWorkloadImbalance(staff(2, 0))).toBe('Balanced');
    expect(classifyWorkloadImbalance([])).toBe('Balanced');
  });
});
