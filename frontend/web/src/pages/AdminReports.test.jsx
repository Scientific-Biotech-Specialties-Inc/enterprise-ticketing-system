import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminReports from './AdminReports';
import * as ticketService from '@/services/ticketService';

// Mock BranchContext
vi.mock('@/context/BranchContext', () => ({
  useBranch: () => ({
    selectedBranch: { id: 1, name: 'Downtown Health Clinic' },
    selectedBranchId: 1,
    isSuperAdmin: false,
  }),
}));

// Mock BranchSelector component
vi.mock('@/components/BranchSelector', () => ({
  default: () => <div data-testid="branch-selector">Downtown Health Clinic</div>,
}));

// Mock DropdownMenu component for clean testing
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick, disabled }) => (
    <button onClick={onClick} disabled={disabled} type="button">
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

// Mock ticketService APIs
vi.mock('@/services/ticketService', () => ({
  getAdminReports: vi.fn(),
  exportAdminReport: vi.fn(),
}));

describe('AdminReports Component Tests', () => {
  const sampleTicketVolumeResponse = {
    headers: ['Ticket ID', 'Subject', 'Branch', 'Department', 'Assigned Technician', 'Priority', 'Status', 'Created Date'],
    rows: [
      {
        'Ticket ID': 'TCK-2001',
        Subject: 'MRI Network Drop',
        Branch: 'Downtown Health Clinic',
        Department: 'Service',
        'Assigned Technician': 'John Doe',
        Priority: 'High',
        Status: 'Resolved',
        'Created Date': '2026-11-01',
      },
    ],
    branch: { name: 'Downtown Health Clinic' },
    summary: { total: 1, resolved: 1 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('covers AC-14: renders filter controls, branch scope, and generate button', async () => {
    ticketService.getAdminReports.mockResolvedValueOnce(sampleTicketVolumeResponse);

    render(<AdminReports />);

    expect(screen.getByText('Report Generator & Document Exporter')).toBeInTheDocument();
    expect(screen.getByLabelText('Report Type')).toBeInTheDocument();
    expect(screen.getByLabelText('Date Range')).toBeInTheDocument();
    expect(screen.getByLabelText('Department Filter')).toBeInTheDocument();
    expect(screen.getByLabelText('Severity / Priority')).toBeInTheDocument();

    await waitFor(() => {
      expect(ticketService.getAdminReports).toHaveBeenCalledWith(
        expect.objectContaining({
          report_type: 'ticket_volume',
          preset: 'Last 30 Days',
        })
      );
      expect(screen.getAllByText('Generate & Preview Report').length).toBeGreaterThan(0);
    });
  });

  it('covers AC-14 and AC-15: renders live preview table matching backend response rows and headers', async () => {
    ticketService.getAdminReports.mockResolvedValueOnce(sampleTicketVolumeResponse);

    render(<AdminReports />);

    await waitFor(() => {
      expect(screen.getByText('MRI Network Drop')).toBeInTheDocument();
      expect(screen.getByText('TCK-2001')).toBeInTheDocument();
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    expect(screen.getByText('Report:')).toBeInTheDocument();
    expect(screen.getAllByText('Ticket Volume & Status Summary').length).toBeGreaterThan(0);
  });

  it('covers AC-14: queries updated scope when changing report type or department filter', async () => {
    ticketService.getAdminReports.mockResolvedValue(sampleTicketVolumeResponse);

    render(<AdminReports />);

    await waitFor(() => {
      expect(ticketService.getAdminReports).toHaveBeenCalledTimes(1);
    });

    const reportTypeSelect = screen.getByLabelText('Report Type');
    fireEvent.change(reportTypeSelect, { target: { value: 'sla_compliance' } });

    await waitFor(() => {
      expect(ticketService.getAdminReports).toHaveBeenCalledWith(
        expect.objectContaining({
          report_type: 'sla_compliance',
        })
      );
    });

    const deptSelect = screen.getByLabelText('Department Filter');
    fireEvent.change(deptSelect, { target: { value: 'Service' } });

    await waitFor(() => {
      expect(ticketService.getAdminReports).toHaveBeenCalledWith(
        expect.objectContaining({
          report_type: 'sla_compliance',
          department: 'Service',
        })
      );
    });
  });

  it('covers AC-14: passes date_from and date_to when custom date range is selected', async () => {
    ticketService.getAdminReports.mockResolvedValue(sampleTicketVolumeResponse);

    render(<AdminReports />);

    await waitFor(() => {
      expect(ticketService.getAdminReports).toHaveBeenCalledTimes(1);
    });

    const dateRangeSelect = screen.getByLabelText('Date Range');
    fireEvent.change(dateRangeSelect, { target: { value: 'Custom Range' } });

    await waitFor(() => {
      expect(ticketService.getAdminReports).toHaveBeenCalledWith(
        expect.objectContaining({
          preset: 'Custom Range',
          date_from: expect.any(String),
          date_to: expect.any(String),
        })
      );
    });
  });

  it('covers AC-15: distinguishes empty search results from server errors with informative notice', async () => {
    ticketService.getAdminReports.mockResolvedValueOnce({
      headers: ['Ticket ID', 'Subject'],
      rows: [],
      branch: { name: 'Downtown Health Clinic' },
    });

    render(<AdminReports />);

    await waitFor(() => {
      expect(screen.getByText('No data found for the selected filters')).toBeInTheDocument();
    });

    expect(screen.queryByText('Failed to retrieve and compile live report data')).not.toBeInTheDocument();
  });

  it('covers AC-15: renders error alert banner and retry button upon API query failure', async () => {
    ticketService.getAdminReports.mockRejectedValueOnce({
      response: { data: { message: 'Gateway timeout querying records' } },
    });

    render(<AdminReports />);

    await waitFor(() => {
      expect(screen.getByText('Gateway timeout querying records')).toBeInTheDocument();
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });

  it('covers AC-16 and AC-17: exports through the server with the same filters as the preview', async () => {
    ticketService.getAdminReports.mockResolvedValueOnce(sampleTicketVolumeResponse);
    ticketService.exportAdminReport.mockResolvedValue({
      data: new Blob(['x']),
      headers: { 'content-disposition': 'attachment; filename="ticket_volume_test.csv"' },
    });
    window.URL.createObjectURL = vi.fn(() => 'blob:test');
    window.URL.revokeObjectURL = vi.fn();

    render(<AdminReports />);

    await waitFor(() => {
      expect(screen.getByText('MRI Network Drop')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Export as PDF'));
    await waitFor(() => expect(ticketService.exportAdminReport).toHaveBeenCalledTimes(1));
    expect(ticketService.exportAdminReport).toHaveBeenCalledWith(
      expect.objectContaining({
        reportType: 'ticket_volume',
        format: 'pdf',
        filters: expect.objectContaining({ preset: expect.any(String) }),
      })
    );

    fireEvent.click(screen.getByText('Export as Excel (.xlsx)'));
    await waitFor(() => expect(ticketService.exportAdminReport).toHaveBeenCalledTimes(2));
    expect(ticketService.exportAdminReport).toHaveBeenLastCalledWith(expect.objectContaining({ format: 'xlsx' }));

    fireEvent.click(screen.getByText('Export as CSV'));
    await waitFor(() => expect(ticketService.exportAdminReport).toHaveBeenCalledTimes(3));
    expect(ticketService.exportAdminReport).toHaveBeenLastCalledWith(expect.objectContaining({ format: 'csv' }));
  });

  it('shows an error message when the server export fails', async () => {
    ticketService.getAdminReports.mockResolvedValueOnce(sampleTicketVolumeResponse);
    ticketService.exportAdminReport.mockRejectedValueOnce({ response: { status: 500 } });

    render(<AdminReports />);
    await waitFor(() => expect(screen.getByText('MRI Network Drop')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Export as CSV'));
    await waitFor(() => {
      expect(screen.getByText('The export could not be generated. Please try again.')).toBeInTheDocument();
    });
  });
});
