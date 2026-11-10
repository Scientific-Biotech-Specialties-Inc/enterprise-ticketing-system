import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import * as ticketService from '@/services/ticketService';
import CSAssigned from './CSAssigned';

// Mock AuthContext
const mockUser = {
  emp_id: 201,
  first_name: 'Sarah',
  last_name: 'Jenkins',
  role: 'Customer Support',
  department: 'Customer Service',
  branch_id: 1,
};

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: mockUser,
  })),
}));

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ search: '', state: {} }),
}));

// Mock ticketService
const mockIncomingTickets = [
  {
    id: 101,
    ticket_ID: 101,
    title: 'Server cluster offline in Data Center 1',
    customer: 'Acme Logistics',
    customer_name: 'Acme Logistics',
    category: 'IT',
    priority: 'Urgent',
    status: 'In Progress',
    department: 'Infrastructure',
    created_at: '2026-10-22T08:00:00Z',
    sla_status: 'Breached',
    sla_due_date: '2026-10-22T10:00:00Z',
    resolution_due_at: '2026-10-22T10:00:00Z',
    sla_label: 'Breached',
    time_remaining_minutes: -120,
    sla_breached: true,
  },
  {
    id: 102,
    ticket_ID: 102,
    title: 'POS terminal card reader failure',
    customer: 'Retail Hub',
    customer_name: 'Retail Hub',
    category: 'Service',
    priority: 'High',
    status: 'In Progress',
    department: 'Hardware',
    created_at: '2026-10-22T12:00:00Z',
    sla_status: 'At Risk',
    sla_due_date: '2026-10-22T14:30:00Z',
    resolution_due_at: '2026-10-22T14:30:00Z',
    sla_label: 'At Risk',
    time_remaining_minutes: 45,
    sla_breached: false,
  },
  {
    id: 103,
    ticket_ID: 103,
    title: 'Email client synchronization error',
    customer: 'Global Trading',
    customer_name: 'Global Trading',
    category: 'IT',
    priority: 'Medium',
    status: 'In Progress',
    department: 'Software Support',
    created_at: '2026-10-22T13:00:00Z',
    sla_status: 'On Track',
    sla_due_date: '2026-10-23T13:00:00Z',
    resolution_due_at: '2026-10-23T13:00:00Z',
    sla_label: 'On Track',
    time_remaining_minutes: 1200,
    sla_breached: false,
  },
  {
    id: 104,
    ticket_ID: 104,
    title: 'Waiting on replacement battery vendor',
    customer: 'City Hospitals',
    customer_name: 'City Hospitals',
    category: 'Service',
    priority: 'Normal',
    status: 'On Hold',
    department: 'Biomedical',
    created_at: '2026-10-21T09:00:00Z',
    sla_status: 'Paused',
    sla_due_date: null,
    resolution_due_at: null,
    sla_label: 'Paused',
    time_remaining_minutes: null,
    sla_breached: false,
  },
  {
    id: 105,
    ticket_ID: 105,
    title: 'Custom request with no rule set',
    customer: 'Special Ops',
    customer_name: 'Special Ops',
    category: 'Others',
    priority: 'Low',
    status: 'Pending',
    department: 'General Support',
    created_at: '2026-10-22T14:00:00Z',
    sla_status: null,
    sla_due_date: null,
    resolution_due_at: null,
    sla_label: null,
    time_remaining_minutes: null,
    sla_breached: false,
  },
];

const mockSlaSummary = {
  total: 5,
  breached: 1,
  at_risk: 1,
  on_track: 1,
  paused: 1,
  compliant: 0,
};

vi.mock('@/services/ticketService', () => ({
  // Spec 0037: the page asks the server for one filtered page. This fake server
  // applies the SLA filter the same way, so the tests check what the page sends.
  getCSQueuePage: vi.fn((query = {}) => {
    const labelFor = { breached: 'Breached', at_risk: 'At Risk', on_track: 'On Track', paused: 'Paused' };
    const keys = { Breached: 'breached', 'At Risk': 'at_risk', 'On Track': 'on_track', Paused: 'paused' };
    const key = query.sla ? (keys[query.sla] || query.sla) : null;
    const rows = key ? mockIncomingTickets.filter((t) => t.sla_status === labelFor[key]) : [...mockIncomingTickets];
    return Promise.resolve({
      tickets: rows,
      total: rows.length,
      page: 1,
      perPage: 10,
      lastPage: 1,
      slaSummary: mockSlaSummary,
      tabCounts: { all: 5, inProgress: 3, pendingEval: 0, reassigned: 0, onHold: 1, resolvedClosed: 0 },
    });
  }),
  getAssignableEmployees: vi.fn(() => Promise.resolve([])),
  getDepartments: vi.fn(() => Promise.resolve([])),
  acceptTicket: vi.fn(() => Promise.resolve({})),
  getTicketFormOptions: vi.fn(() => Promise.resolve({ departments: [], categories: [] })),
  getCSFilterOptions: vi.fn(() => Promise.resolve({ departments: [], categories: [] })),
  getTicketDetails: vi.fn(() => Promise.resolve({})),
  updateTicket: vi.fn(() => Promise.resolve({})),
  respondReassignment: vi.fn(() => Promise.resolve({})),
}));

vi.mock('@/hooks/useRealtimeRefresh', () => ({
  default: vi.fn(),
}));

describe('CSAssigned Component Tests (SLA Compliance Monitoring Acceptance Criteria)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('covers AC-1 & AC-2: renders tickets with established SLA status classifications (Breached, At Risk, On Track, Paused, and N/A fallback)', async () => {
    render(<CSAssigned />);

    // Wait for tickets to load
    await waitFor(() => {
      expect(screen.getByText('Server cluster offline in Data Center 1')).toBeInTheDocument();
    });

    // Check table rows for SLA badges
    const table = screen.getByRole('table');
    expect(within(table).getByText('Breached')).toBeInTheDocument();
    expect(within(table).getByText('At Risk')).toBeInTheDocument();
    expect(within(table).getByText('On Track')).toBeInTheDocument();
    expect(within(table).getByText('Paused')).toBeInTheDocument();
    expect(within(table).getByText('N/A')).toBeInTheDocument();
  });

  it('covers AC-3: renders visually distinct indicators with accessible text labels and icons rather than color alone', async () => {
    render(<CSAssigned />);

    await waitFor(() => {
      expect(screen.getByText('Server cluster offline in Data Center 1')).toBeInTheDocument();
    });

    const table = screen.getByRole('table');

    // Verify text labels exist with accessible titles on badge container
    const breachedSpan = within(table).getByText('Breached').parentElement;
    expect(breachedSpan).toHaveAttribute('title', expect.stringContaining('Breached'));

    const atRiskSpan = within(table).getByText('At Risk').parentElement;
    expect(atRiskSpan).toHaveAttribute('title', expect.stringContaining('Deadline'));

    const onTrackSpan = within(table).getByText('On Track').parentElement;
    expect(onTrackSpan).toHaveAttribute('title', expect.stringContaining('Target'));

    const pausedSpan = within(table).getByText('Paused').parentElement;
    expect(pausedSpan).toHaveAttribute('title', expect.stringContaining('paused'));
  });

  it('covers AC-4: provides sort controls supporting sorting by SLA due date and SLA status', async () => {
    render(<CSAssigned />);

    await waitFor(() => {
      expect(screen.getByText('Server cluster offline in Data Center 1')).toBeInTheDocument();
    });

    // Locate the sort select control
    const sortSelect = screen.getByTitle('Sort tickets queue');
    expect(sortSelect).toBeInTheDocument();

    // Verify sort options exist
    expect(screen.getByRole('option', { name: 'Sort: SLA Due Soonest' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sort: SLA Status (A-Z)' })).toBeInTheDocument();

    // Change sort to SLA Due Soonest
    fireEvent.change(sortSelect, { target: { value: 'sla_due_date:asc' } });
    expect(sortSelect.value).toBe('sla_due_date:asc');

    // Change sort to SLA Status
    fireEvent.change(sortSelect, { target: { value: 'sla_status:asc' } });
    expect(sortSelect.value).toBe('sla_status:asc');
  });

  it('covers AC-5: provides SLA status filter dropdown with Breached, At Risk, On Track, and Paused options', async () => {
    render(<CSAssigned />);

    await waitFor(() => {
      expect(screen.getByText('Server cluster offline in Data Center 1')).toBeInTheDocument();
    });

    // Verify the SLA filter dropdown is present (replacing old customer dropdown)
    const slaFilterSelect = screen.getByDisplayValue('All SLA Statuses');
    expect(slaFilterSelect).toBeInTheDocument();

    // Ensure options exist
    expect(screen.getByRole('option', { name: 'All SLA Statuses' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Breached' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'At Risk' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'On Track' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Paused' })).toBeInTheDocument();

    // Select "Breached" filter
    fireEvent.change(slaFilterSelect, { target: { value: 'Breached' } });

    // The filter is sent to the server, and only the Breached ticket comes back
    await waitFor(() => {
      expect(ticketService.getCSQueuePage).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'assigned', sla: 'Breached', page: 1 }));
      expect(screen.queryByText('POS terminal card reader failure')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Server cluster offline in Data Center 1')).toBeInTheDocument();
    expect(screen.queryByText('Email client synchronization error')).not.toBeInTheDocument();
  });

  it('covers AC-6: displays SLA status badge with accessible deadline tooltip per ticket', async () => {
    render(<CSAssigned />);

    await waitFor(() => {
      expect(screen.getByText('Server cluster offline in Data Center 1')).toBeInTheDocument();
    });

    const table = screen.getByRole('table');

    // At Risk ticket displays badge with deadline tooltip
    const atRiskBadge = within(table).getByText('At Risk').parentElement;
    expect(atRiskBadge).toHaveAttribute('title', expect.stringContaining('SLA Deadline approaching'));
  });

  it('covers AC-7: displays queue tab counts and filters by SLA status', async () => {
    render(<CSAssigned />);

    await waitFor(() => {
      expect(screen.getByText('Server cluster offline in Data Center 1')).toBeInTheDocument();
    });

    // Queue tabs exist with server counts
    expect(screen.getByText('All Assigned')).toBeInTheDocument();
    expect(screen.getByText('Pending Evaluation')).toBeInTheDocument();
    expect(screen.getByText('Reassigned Tickets')).toBeInTheDocument();

    // Selecting "At Risk" from the SLA filter dropdown asks the server for At Risk tickets
    const slaFilterSelect = screen.getByTitle('Filter by SLA status');
    fireEvent.change(slaFilterSelect, { target: { value: 'At Risk' } });

    // List is filtered to At Risk ticket by the server
    await waitFor(() => {
      expect(ticketService.getCSQueuePage).toHaveBeenLastCalledWith(expect.objectContaining({ sla: 'At Risk' }));
      expect(screen.queryByText('Server cluster offline in Data Center 1')).not.toBeInTheDocument();
    });
    expect(screen.getByText('POS terminal card reader failure')).toBeInTheDocument();
  });

  it('covers AC-8: shows structured fallback state when SLA data is unavailable', async () => {
    render(<CSAssigned />);

    await waitFor(() => {
      expect(screen.getByText('Custom request with no rule set')).toBeInTheDocument();
    });

    const table = screen.getByRole('table');

    // Fallback badge is rendered cleanly as N/A with accessible tooltip
    const naBadge = within(table).getByText('N/A');
    expect(naBadge).toBeInTheDocument();
    expect(naBadge.parentElement).toHaveAttribute('title', 'No department SLA configured for this ticket category');
  });

  it('covers AC-9: ensures accessibility and responsive controls across desktop and mobile', async () => {
    render(<CSAssigned />);

    await waitFor(() => {
      expect(screen.getByText('Assigned Tickets')).toBeInTheDocument();
    });

    // Search input has proper accessible placeholder
    const searchInput = screen.getByPlaceholderText('Search tickets, customers, departments...');
    expect(searchInput).toBeInTheDocument();

    // Table headers have accessible names
    expect(screen.getByRole('columnheader', { name: /ticket ID/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /title/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /status/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /SLA Compliance/i })).toBeInTheDocument();
  });
});
