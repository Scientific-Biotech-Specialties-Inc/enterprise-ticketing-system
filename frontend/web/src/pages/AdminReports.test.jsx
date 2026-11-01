import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AdminReports from './AdminReports';
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

const mockReportsResponse = {
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
      total_tickets: 85,
      resolved_tickets: 78,
      closed_tickets: 5,
      open_tickets: 2,
      avg_resolution_hours: 2.8,
      sla_compliance_rate: 96.2,
      csat_score: 4.9,
      active_employees_count: 14,
    },
    recurring_issues: {
      top_categories: [
        { name: 'POS Scanner Jam', count: 18, percentage: 40 },
        { name: 'Thermal Receipt Glitch', count: 12, percentage: 26 },
      ],
      top_equipment: [
        { name: 'Fujitsu Scanner 900', serial_number: 'SN-FJ-900', count: 8 },
      ],
    },
    workload: {
      details: [
        { emp_id: 4, name: 'Jasmine Aninion', department: 'Service', role: 'service', active_tickets: 3, resolved_tickets: 22 },
      ],
    },
    export_payload: {
      generated_at: '2026-10-30T23:00:00Z',
      metrics: {
        total_tickets: 85,
        resolved_tickets: 78,
        sla_compliance: 96.2,
        csat_score: 4.9,
      },
    },
  },
};

describe('AdminReports Component Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    axiosInstance.get.mockImplementation((url) => {
      if (url.includes('admin-reports')) {
        return Promise.resolve(mockReportsResponse);
      }
      return Promise.resolve({ data: { status: 'success', data: {} } });
    });
  });

  it('renders operational reports with live branch data and recurring issues', async () => {
    render(<AdminReports />);

    await waitFor(() => {
      expect(screen.getByText(/Master Operational & Predictive Analytics Report/i)).toBeInTheDocument();
      expect(screen.getByText('Branch: Main Branch (MAIN)')).toBeInTheDocument();
    });

    expect(screen.getByText('85')).toBeInTheDocument(); // Total Tickets
    expect(screen.getByText('96.2%')).toBeInTheDocument(); // SLA Compliance

    // Recurring issues
    expect(screen.getByText('POS Scanner Jam')).toBeInTheDocument();
    expect(screen.getByText('Thermal Receipt Glitch')).toBeInTheDocument();
  });

  it('allows switching report date range preset and triggers refetch', async () => {
    render(<AdminReports />);

    await waitFor(() => {
      expect(screen.getByText(/Master Operational & Predictive Analytics Report/i)).toBeInTheDocument();
    });

    const thirtyDaysBtn = screen.getByRole('button', { name: /^Last 30 Days$/i });
    fireEvent.click(thirtyDaysBtn);

    await waitFor(() => {
      expect(axiosInstance.get).toHaveBeenCalledWith(
        expect.stringContaining('/api/ticketing/ticket/admin-reports?preset=Last+30+Days')
      );
    });
  });
});
