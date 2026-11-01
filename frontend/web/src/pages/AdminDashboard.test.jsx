import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AdminDashboard from './AdminDashboard';
import axiosInstance from '@/api/axiosInstance';

// Mock chart.js / react-chartjs-2 to prevent canvas errors in jsdom
vi.mock('react-chartjs-2', () => ({
  Line: () => <div data-testid="mock-line-chart" />,
  Bar: () => <div data-testid="mock-bar-chart" />,
  Doughnut: () => <div data-testid="mock-doughnut-chart" />,
}));

vi.mock('@/api/axiosInstance', () => ({
  default: {
    get: vi.fn(),
  },
}));

const mockDashboardResponse = {
  data: {
    status: 'success',
    branch: {
      id: 1,
      slug: 'main',
      name: 'Main Branch',
      code: 'MAIN',
      region: 'NCR',
    },
    period: {
      preset: 'Last 7 Days',
      date_from: '2026-10-23T00:00:00Z',
      date_to: '2026-10-30T23:59:59Z',
    },
    kpis: {
      total_tickets: 42,
      resolved_tickets: 36,
      closed_tickets: 4,
      open_tickets: 2,
      in_progress_tickets: 4,
      on_hold_tickets: 0,
      active_tickets: 6,
      avg_resolution_hours: 3.2,
      sla_compliance_rate: 95.5,
      sla_met_count: 38,
      sla_breached_count: 4,
      csat_score: 4.8,
      satisfaction_percentage: 96,
      total_csat_reviews: 25,
      active_employees_count: 12,
      open_vs_closed: {
        open: 6,
        closed: 36,
      },
    },
    trends: {
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      new: [5, 8, 6, 7, 9, 4, 3],
      resolved: [4, 7, 5, 8, 8, 3, 1],
    },
    status_distribution: {
      open: 2,
      inProgress: 4,
      resolved: 32,
      closed: 4,
      onHold: 0,
      active_total: 6,
      breakdown: [
        { status: 'Open', count: 2, percentage: 5 },
        { status: 'In Progress', count: 4, percentage: 10 },
        { status: 'Resolved', count: 32, percentage: 75 },
        { status: 'Closed', count: 4, percentage: 10 },
      ],
    },
    sla: {
      overall_compliance: 95.5,
      sla_met: 38,
      sla_breached: 4,
      compliance_trend: [94, 95, 96, 95, 96, 95, 95.5],
      breaches_trend: [1, 0, 1, 0, 1, 1, 0],
      resolution_time_trend: [3.4, 3.1, 3.2, 3.0, 3.5, 3.2, 3.2],
      by_department: [
        { department: 'IT', compliance: 96, met: 20, breached: 1 },
        { department: 'Service', compliance: 95, met: 18, breached: 3 },
      ],
    },
    employee_performance: {
      labels: ['Jasmine Aninion', 'Bernadette Tormo'],
      resolved: [15, 21],
      response_time: [12, 14],
      resolution_time: [2.5, 2.8],
      sla_compliance: [98, 93],
      list: [
        { emp_id: 4, name: 'Jasmine Aninion', department: 'Service', role: 'service', active_tickets: 2, resolved_tickets: 15 },
        { emp_id: 1093, name: 'Bernadette Tormo', department: 'Service', role: 'service', active_tickets: 4, resolved_tickets: 21 },
      ],
    },
    workload: {
      department: {
        labels: ['Service', 'IT'],
        data: [6, 0],
      },
      details: [
        { emp_id: 4, name: 'Jasmine Aninion', department: 'Service', role: 'service', active_tickets: 2, resolved_tickets: 15 },
        { emp_id: 1093, name: 'Bernadette Tormo', department: 'Service', role: 'service', active_tickets: 4, resolved_tickets: 21 },
      ],
    },
    recurring_issues: {
      top_categories: [
        { name: 'Hardware Replacement', count: 14, percentage: 33 },
        { name: 'Network Connectivity', count: 10, percentage: 24 },
      ],
      top_equipment: [
        { name: 'POS Terminal 4', serial_number: 'SN-POS-004', count: 6 },
        { name: 'Barcode Scanner B', serial_number: 'SN-BC-012', count: 4 },
      ],
    },
  },
};

describe('AdminDashboard Component Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    axiosInstance.get.mockImplementation((url) => {
      if (url.includes('admin-dashboard')) {
        return Promise.resolve(mockDashboardResponse);
      }
      return Promise.resolve({ data: { status: 'success', data: {} } });
    });
  });

  it('renders branch dashboard KPIs and recurring issues from live endpoint', async () => {
    render(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Branch: Main Branch')).toBeInTheDocument();
    });

    expect(screen.getByText('42')).toBeInTheDocument(); // Total Tickets
    expect(screen.getByText('95.5%')).toBeInTheDocument(); // SLA Compliance
    expect(screen.getByText('12')).toBeInTheDocument(); // Active Staff
    expect(screen.getByText('4.8 / 5')).toBeInTheDocument(); // CSAT Score
    expect(screen.getByText('3.2h')).toBeInTheDocument(); // Avg Resolution

    // Recurring issues
    expect(screen.getByText('Hardware Replacement')).toBeInTheDocument();
    expect(screen.getByText('Network Connectivity')).toBeInTheDocument();
    expect(screen.getByText('POS Terminal 4')).toBeInTheDocument();

    // Staff workload
    expect(screen.getByText('Jasmine Aninion')).toBeInTheDocument();
    expect(screen.getByText('Bernadette Tormo')).toBeInTheDocument();
  });

  it('switches date range presets and re-fetches dashboard data', async () => {
    render(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
    });

    expect(axiosInstance.get).toHaveBeenCalledWith(
      expect.stringContaining('/api/ticketing/ticket/admin-dashboard?preset=Last+7+Days')
    );

    // Click 'Today' filter button
    const todayButton = screen.getByRole('button', { name: /^Today$/i });
    fireEvent.click(todayButton);

    await waitFor(() => {
      expect(axiosInstance.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/ticketing/ticket/admin-dashboard?preset=Today')
      );
    });
  });

  it('gracefully handles API error with toast/error state without crashing', async () => {
    axiosInstance.get.mockImplementation(() => Promise.reject(new Error('Network gateway error')));

    render(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
    });

    // Should still display page header and fallback without crashing
    expect(screen.getByText('Admin Dashboard')).toBeInTheDocument();
  });
});
