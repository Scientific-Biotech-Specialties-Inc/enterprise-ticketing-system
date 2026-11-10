import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AdminDashboard from './AdminDashboard';
import * as ticketService from '@/services/ticketService';
import * as authContextModule from '@/context/AuthContext';
import { BranchProvider, GLOBAL_BRANCH } from '@/context/BranchContext';

vi.mock('@/services/ticketService', () => ({
  getAdminDashboard: vi.fn(),
  getAdminEmployeePerformance: vi.fn(),
  getAdminDepartmentPerformance: vi.fn(),
  getAdminPredictiveInsights: vi.fn(),
  triggerEtlSync: vi.fn(),
  getBranches: vi.fn(),
  getPublicBranches: vi.fn(),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick, disabled }) => (
    <button onClick={onClick} disabled={disabled} type="button">{children}</button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

// Mock chart.js and react-chartjs-2 to avoid canvas rendering issues in jsdom
vi.mock('react-chartjs-2', () => ({
  Line: ({ data }) => (
    <div data-testid="line-chart" data-labels={JSON.stringify(data?.labels)}>
      {data?.datasets?.map((ds, idx) => (
        <span key={idx} data-testid={`dataset-${idx}`}>{ds.label}: {ds.data?.length}</span>
      ))}
    </div>
  ),
  Bar: ({ data }) => (
    <div data-testid="bar-chart" data-labels={JSON.stringify(data?.labels)}>
      {data?.datasets?.map((ds, idx) => (
        <span key={idx} data-testid={`dataset-${idx}`}>{ds.label}: {ds.data?.length}</span>
      ))}
    </div>
  ),
}));

const mockLiveDashboard = {
  status: 'success',
  has_data: true,
  branch: { id: 1, slug: 'cebu', name: 'Cebu Branch', code: 'CEB' },
  kpis: {
    total_tickets: 42,
    resolved_tickets: 25,
    closed_tickets: 10,
    open_tickets: 5,
    in_progress_tickets: 2,
    avg_resolution_hours: 2.8,
    sla_compliance_rate: 94.2,
    sla_met_count: 35,
    sla_breached_count: 2,
    csat_score: 4.8,
    active_employees_count: 6,
  },
  trends: {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    new: [5, 8, 12, 6, 7, 3, 1],
    resolved: [4, 7, 10, 5, 6, 2, 1],
  },
  status_distribution: {
    open: 5,
    inProgress: 2,
    resolved: 25,
    closed: 10,
  },
  sla: {
    compliance_trend: [92, 95, 91, 96, 94, 95, 94],
    breaches_trend: [1, 0, 1, 0, 0, 0, 0],
    resolution_time_trend: [2.5, 3.1, 2.8, 2.4, 2.9, 2.7, 2.8],
    by_department: [
      { name: 'Service', compliance_rate: 95.0 },
      { name: 'Engineering', compliance_rate: 93.5 },
    ],
  },
  employee_performance: [
    { name: 'Maria Dela Cruz', tickets_resolved: 15, avg_response_hours: 0.3, avg_resolution_hours: 2.2, sla_compliance: 96 },
    { name: 'Jose Cruz', tickets_resolved: 10, avg_response_hours: 0.5, avg_resolution_hours: 2.9, sla_compliance: 92 },
  ],
  csat: {
    average_score: 4.8,
    total_reviews: 18,
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    trend: [4.7, 4.8, 4.6, 4.9, 4.8, 4.8, 4.8],
  },
  workload: {
    by_employee: [
      { name: 'Maria Dela Cruz', active_tickets: 4 },
      { name: 'Jose Cruz', active_tickets: 3 },
    ],
    by_department: [
      { name: 'Service', active_tickets: 5 },
      { name: 'Engineering', active_tickets: 2 },
    ],
  },
  recurring_issues: {
    top_categories: [
      { name: 'Hardware Calibration', count: 14, percentage: 33.3 },
      { name: 'Software Update', count: 9, percentage: 21.4 },
    ],
    top_equipment: [
      { name: 'Sysmex KX-21N', serial_number: 'SN-882', label: 'Sysmex KX-21N (SN-882)', count: 11, percentage: 26.2 },
    ],
  },
};

const mockBranches = [
  { id: 1, name: 'Cebu Branch', code: 'CEB', slug: 'cebu' },
  { id: 2, name: 'Davao Branch', code: 'DVO', slug: 'davao' },
];

describe('AdminDashboard (Live Data, Scoping, and ETL Sync)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ticketService.getBranches.mockResolvedValue({ data: mockBranches });
    ticketService.getPublicBranches.mockResolvedValue({ data: mockBranches });
    ticketService.getAdminDashboard.mockResolvedValue(mockLiveDashboard);
    ticketService.getAdminEmployeePerformance.mockResolvedValue({ active_employees_count: 6, employees: [] });
    ticketService.getAdminDepartmentPerformance.mockResolvedValue({ departments: [] });
    ticketService.getAdminPredictiveInsights.mockResolvedValue({ volume_forecast: [] });
  });

  it('renders live KPI metrics and trend charts without static mock constants (AC-4, AC-5)', async () => {
    vi.spyOn(authContextModule, 'useAuth').mockReturnValue({
      user: { id: 1, role: 'superadmin', email: 'superadmin@example.com' },
    });

    render(
      <BranchProvider>
        <AdminDashboard />
      </BranchProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('42')).toBeDefined(); // Total tickets from mockLiveDashboard
      expect(screen.getByText('94.2%')).toBeDefined(); // SLA compliance from mockLiveDashboard
      expect(screen.getByText('4.8')).toBeDefined(); // CSAT Score from mockLiveDashboard
      expect(screen.getByText('2.8h')).toBeDefined(); // Avg resolution from mockLiveDashboard
    });

    expect(ticketService.getAdminDashboard).toHaveBeenCalled();
  });

  it('renders informative empty state cards when has_data is false (AC-6)', async () => {
    vi.spyOn(authContextModule, 'useAuth').mockReturnValue({
      user: { id: 1, role: 'admin', email: 'admin@example.com', branch_id: 1, branch: 'Cebu Branch' },
    });

    ticketService.getAdminDashboard.mockResolvedValue({
      status: 'success',
      has_data: false,
      kpis: { total_tickets: 0, sla_compliance_rate: 0, active_employees_count: 0, csat_score: 0, avg_resolution_hours: 0 },
      trends: { labels: [], new: [], resolved: [] },
      status_distribution: { open: 0, inProgress: 0, resolved: 0, closed: 0 },
      sla: { compliance_trend: [], breaches_trend: [], resolution_time_trend: [] },
      workload: { by_employee: [], by_department: [] },
    });

    render(
      <BranchProvider>
        <AdminDashboard />
      </BranchProvider>
    );

    await waitFor(() => {
      const emptyStates = screen.getAllByText('No ticket activity recorded for this period');
      expect(emptyStates.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('locks regular non-superadmin Admin users to their assigned facility (AC-2)', async () => {
    vi.spyOn(authContextModule, 'useAuth').mockReturnValue({
      user: { id: 2, role: 'admin', email: 'localadmin@example.com', branch_id: 1, branch: 'Cebu Branch' },
    });

    render(
      <BranchProvider>
        <AdminDashboard />
      </BranchProvider>
    );

    await waitFor(() => {
      // Expect locked facility pill showing Cebu Branch
      expect(screen.getByText('Cebu Branch')).toBeDefined();
    });

    // Verify there is no dropdown toggle button with aria-haspopup="listbox" for regular admin
    const listboxButtons = screen.queryAllByRole('button', { name: /branch/i });
    expect(listboxButtons.length).toBe(0);

    // Verify non-superadmin dashboard query does not send cross-branch branch_id parameter
    expect(ticketService.getAdminDashboard).toHaveBeenCalledWith(
      expect.not.objectContaining({ branch_id: expect.anything() })
    );
  });

  it('triggers synchronous ETL sync and reports processed records (AC-7, AC-8)', async () => {
    vi.spyOn(authContextModule, 'useAuth').mockReturnValue({
      user: { id: 1, role: 'superadmin', email: 'superadmin@example.com' },
    });

    ticketService.triggerEtlSync.mockResolvedValue({
      status: 'success',
      message: 'ETL synchronization completed successfully.',
      records_processed: 38,
      duration_ms: 215,
      timestamp: new Date().toISOString(),
    });

    render(
      <BranchProvider>
        <AdminDashboard />
      </BranchProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('ETL Pipeline')).toBeDefined();
    });

    // Click ETL Pipeline button to open menu
    const etlBtn = screen.getByText('ETL Pipeline');
    fireEvent.click(etlBtn);

    // Click Run Incremental ETL
    await waitFor(() => {
      expect(screen.getByText('Run Incremental ETL')).toBeDefined();
    });

    const runIncBtn = screen.getByText('Run Incremental ETL');
    fireEvent.click(runIncBtn);

    await waitFor(() => {
      expect(ticketService.triggerEtlSync).toHaveBeenCalledWith({
        full_sync: false,
        branch_id: expect.any(String),
      });
      expect(screen.getByText(/Processed 38 records/)).toBeDefined();
    });
  });

  it('renders workload and employee performance charts when backend returns object shape with labels and data arrays', async () => {
    vi.spyOn(authContextModule, 'useAuth').mockReturnValue({
      user: { id: 8, role: 'admin', email: 'admin@example.com', branch_id: 1, branch: 'Main Branch' },
    });

    ticketService.getAdminDashboard.mockResolvedValue({
      ...mockLiveDashboard,
      sla: {
        ...mockLiveDashboard.sla,
        by_department: [
          { department: 'Service', compliance_percentage: 95.0, total: 20, breached: 1 },
          { department: 'Engineering', compliance_percentage: 90.0, total: 10, breached: 1 },
        ],
      },
      employee_performance: {
        labels: ['Maria Dela Cruz', 'Jose Cruz'],
        resolved: [15, 10],
        response_time: [18, 30],
        resolution_time: [2.2, 2.9],
        sla_compliance: [96, 92],
        list: [
          { emp_id: 1, name: 'Maria Dela Cruz', department: 'Service', role: 'technician', active_tickets: 4, resolved_tickets: 15 },
          { emp_id: 2, name: 'Jose Cruz', department: 'Engineering', role: 'engineer', active_tickets: 3, resolved_tickets: 10 },
        ],
      },
      workload: {
        by_employee: {
          labels: ['Maria Dela Cruz', 'Jose Cruz'],
          data: [4, 3],
        },
        by_department: {
          labels: ['Service', 'Engineering'],
          data: [5, 2],
        },
        details: [
          { emp_id: 1, name: 'Maria Dela Cruz', department: 'Service', role: 'technician', active_tickets: 4, resolved_tickets: 15 },
          { emp_id: 2, name: 'Jose Cruz', department: 'Engineering', role: 'engineer', active_tickets: 3, resolved_tickets: 10 },
        ],
      },
    });

    render(
      <BranchProvider>
        <AdminDashboard />
      </BranchProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('42')).toBeDefined();
      expect(screen.getByText('Active ticket distribution across branch technicians.')).toBeDefined();
      expect(screen.getByText('Resolved tickets across active facility technicians.')).toBeDefined();
    });

    // Switch workload view to By Department and ensure no TypeError occurs
    const workloadSelect = screen.getByDisplayValue('By Employee');
    fireEvent.change(workloadSelect, { target: { value: 'By Department' } });

    await waitFor(() => {
      expect(screen.getByText('Active tickets distributed by operational department.')).toBeDefined();
    });

    // Switch SLA view to SLA by Dept and ensure compliance_percentage renders cleanly
    const slaSelect = screen.getByDisplayValue('Compliance');
    fireEvent.change(slaSelect, { target: { value: 'SLA by Dept' } });

    await waitFor(() => {
      expect(screen.getByText('Operational department SLA adherence breakdown.')).toBeDefined();
    });
  });

  it('fetches only getAdminDashboard when switching date presets without re-fetching predictive insights (AC-5, AC-6)', async () => {
    const stableAdminUser = { id: 1, role: 'admin', email: 'admin@example.com', branch_id: 1, branch: 'Cebu Branch' };
    vi.spyOn(authContextModule, 'useAuth').mockReturnValue({
      user: stableAdminUser,
    });

    render(
      <BranchProvider>
        <AdminDashboard />
      </BranchProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Cebu Branch')).toBeDefined();
      expect(ticketService.getAdminDashboard).toHaveBeenCalled();
    });

    ticketService.getAdminDashboard.mockClear();
    ticketService.getAdminPredictiveInsights.mockClear();

    // Switch date preset to Today
    fireEvent.click(screen.getByText('Today'));

    await waitFor(() => {
      expect(ticketService.getAdminDashboard).toHaveBeenCalledTimes(1);
    });

    // Predictive insights should not be re-fetched on historical date preset changes
    expect(ticketService.getAdminPredictiveInsights).not.toHaveBeenCalled();
    expect(ticketService.getAdminEmployeePerformance).not.toHaveBeenCalled();
    expect(ticketService.getAdminDepartmentPerformance).not.toHaveBeenCalled();
  });

  it('keeps the most recently selected range when an earlier request finishes late (spec 0031 AC-15)', async () => {
    vi.spyOn(authContextModule, 'useAuth').mockReturnValue({
      user: { id: 1, role: 'admin', email: 'admin@example.com', branch_id: 1, branch: 'Cebu Branch' },
    });

    let resolveSlow;
    const slow = new Promise((resolve) => { resolveSlow = resolve; });
    ticketService.getAdminDashboard.mockReset();
    ticketService.getAdminDashboard
      .mockImplementationOnce(() => slow)
      .mockResolvedValue({ ...mockLiveDashboard, kpis: { ...mockLiveDashboard.kpis, total_tickets: 222 } });

    render(
      <BranchProvider>
        <AdminDashboard />
      </BranchProvider>
    );

    await waitFor(() => expect(ticketService.getAdminDashboard).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('Last 30 Days'));
    await waitFor(() => expect(screen.getByText('222')).toBeDefined());

    // The first (older) range answers last; it must not overwrite the newer range.
    resolveSlow({ ...mockLiveDashboard, kpis: { ...mockLiveDashboard.kpis, total_tickets: 111 } });
    await new Promise((r) => setTimeout(r, 20));

    expect(screen.queryByText('111')).toBeNull();
    expect(screen.getByText('222')).toBeDefined();
  });

  it('shows No data and a dash instead of invented rates (spec 0031 AC-6)', async () => {
    vi.spyOn(authContextModule, 'useAuth').mockReturnValue({
      user: { id: 1, role: 'superadmin', email: 'superadmin@example.com' },
    });

    ticketService.getAdminDashboard.mockResolvedValue({
      ...mockLiveDashboard,
      kpis: { ...mockLiveDashboard.kpis, sla_compliance_rate: null, avg_resolution_hours: null, csat_score: null, csat_available: false },
      branch_comparisons: [
        { branch_id: 1, branch_name: 'Cebu Branch', branch_code: 'CEB', total_tickets: 3, active_tickets: 3, escalated_tickets: 0, sla_breaches: 0, sla_compliance_rate: null, avg_resolution_hours: null, csat_score: null },
      ],
    });

    render(
      <BranchProvider>
        <AdminDashboard />
      </BranchProvider>
    );

    await waitFor(() => {
      expect(screen.getAllByText('No data').length).toBeGreaterThanOrEqual(2); // SLA Compliance and Avg Resolution KPIs
      expect(screen.getByText('Unavailable')).toBeDefined(); // CSAT when analytics is down
    });
    expect(screen.queryByText('100%')).toBeNull();
  });

  it('renders sortable Cross-Branch Performance Comparison table for SuperAdmin (AC-12)', async () => {
    vi.spyOn(authContextModule, 'useAuth').mockReturnValue({
      user: { id: 1, role: 'superadmin', email: 'superadmin@example.com' },
    });

    ticketService.getAdminDashboard.mockResolvedValue({
      ...mockLiveDashboard,
      branch_comparisons: [
        {
          branch_id: 1,
          branch_name: 'Cebu Branch',
          branch_code: 'CEB',
          total_tickets: 28,
          active_tickets: 4,
          escalated_tickets: 1,
          sla_breaches: 1,
          sla_compliance_rate: 96.4,
          avg_resolution_hours: 2.3,
          csat_score: 4.9,
        },
        {
          branch_id: 2,
          branch_name: 'Davao Branch',
          branch_code: 'DVO',
          total_tickets: 14,
          active_tickets: 3,
          escalated_tickets: 0,
          sla_breaches: 1,
          sla_compliance_rate: 91.0,
          avg_resolution_hours: 3.1,
          csat_score: 4.7,
        },
      ],
    });

    render(
      <BranchProvider>
        <AdminDashboard />
      </BranchProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Cross-Branch Performance Comparison')).toBeDefined();
      expect(screen.getByText('2 Active Branches')).toBeDefined();
      expect(screen.getByText('96.4%')).toBeDefined();
      expect(screen.getByText('91%')).toBeDefined();
    });
  });

  it('rejects End date earlier than Start date under Custom Range', async () => {
    vi.spyOn(authContextModule, 'useAuth').mockReturnValue({
      user: { id: 1, role: 'admin', email: 'admin@example.com', branch_id: 1, branch: 'Cebu Branch' },
    });

    render(
      <BranchProvider>
        <AdminDashboard />
      </BranchProvider>
    );

    await waitFor(() => expect(ticketService.getAdminDashboard).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Custom Range' }));
    const startInput = screen.getByLabelText('Start date');
    const endInput = screen.getByLabelText('End date');

    fireEvent.change(startInput, { target: { value: '2026-11-10' } });
    fireEvent.change(endInput, { target: { value: '2026-11-12' } });
    await waitFor(() => expect(endInput.value).toBe('2026-11-12'));

    const callsBeforeInvalid = ticketService.getAdminDashboard.mock.calls.length;

    fireEvent.change(endInput, { target: { value: '2026-11-05' } });
    expect(screen.getByRole('alert')).toHaveTextContent('End date cannot be earlier than start date.');
    expect(endInput.value).toBe('2026-11-12');
    expect(ticketService.getAdminDashboard).toHaveBeenCalledTimes(callsBeforeInvalid);
  });

  it('displays live time, date, and Recurring Issues section with categories and equipment toggle', async () => {
    vi.spyOn(authContextModule, 'useAuth').mockReturnValue({
      user: { id: 1, role: 'admin', email: 'admin@example.com', branch_id: 1, branch: 'Cebu Branch' },
    });

    render(
      <BranchProvider>
        <AdminDashboard />
      </BranchProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Recurring Issues')).toBeDefined();
      expect(screen.getByText('Hardware Calibration')).toBeDefined();
      expect(screen.getByText(/Most frequent: Hardware Calibration \(14 tickets, 33.3% of period volume\)\./)).toBeDefined();
    });

    // Live time & date header renders AM/PM clock like other role dashboards
    expect(screen.getByText(/\d{1,2}:\d{2}:\d{2}\s?(AM|PM)/i)).toBeDefined();

    // Switch Recurring Issues dropdown to Top Equipment
    const recurringSelect = screen.getByDisplayValue('Top Categories');
    fireEvent.change(recurringSelect, { target: { value: 'Top Equipment' } });

    await waitFor(() => {
      expect(screen.getByText('Sysmex KX-21N (SN-882)')).toBeDefined();
      expect(screen.getByText(/Most frequent: Sysmex KX-21N \(SN-882\) \(11 tickets, 26.2% of period volume\)\./)).toBeDefined();
    });

    // KPI cards render without info tooltip icons or hover title tooltips
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('42')).not.toHaveAttribute('title');
  });
});
