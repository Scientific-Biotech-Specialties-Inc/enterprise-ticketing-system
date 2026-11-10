import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EmployeeHistoryDetail from './EmployeeHistoryDetail';
import MyTickets from './MyTickets';
import * as authContextModule from '@/context/AuthContext';
import * as ticketServiceModule from '@/services/ticketService';
import * as configServiceModule from '@/services/configurationService';

const mockNavigate = vi.fn();
let mockLocationState = null;
let mockPathname = '/history/101';

vi.mock('@/services/echo', () => ({
  default: {
    channel: vi.fn(() => ({ listen: vi.fn() })),
    private: vi.fn(() => ({ listen: vi.fn() })),
    disconnect: vi.fn(),
  },
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useParams: () => ({ ticketId: '101' }),
    useNavigate: () => mockNavigate,
    useLocation: () => ({ state: mockLocationState, pathname: mockPathname }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

vi.mock('@/services/ticketService', () => ({
  getTicketDetails: vi.fn(),
  reopenTicket: vi.fn(),
  getTicketTimeline: vi.fn().mockResolvedValue({ events: [], pagination: { total: 0 } }),
  getCustomerTickets: vi.fn(),
  getCustomerFilterOptions: vi.fn().mockResolvedValue({ categories: [], statuses: [], machines: [], priorities: [] }),
  getTicketDrafts: vi.fn().mockResolvedValue([]),
  getCachedTicketFormOptions: vi.fn().mockReturnValue(null),
  getTicketFormOptions: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/services/configurationService', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getWindowConfiguration: vi.fn().mockResolvedValue({
      autoCloseEnabled: true,
      autoCloseWindowDays: 2,
      reopenEnabled: true,
      reopenWindowDays: 2,
    }),
    getCachedWindowConfiguration: vi.fn().mockReturnValue({
      autoCloseEnabled: true,
      autoCloseWindowDays: 2,
      reopenEnabled: true,
      reopenWindowDays: 2,
    }),
    getFileLimitsConfig: vi.fn().mockResolvedValue({ maxFileCount: 5 }),
    getCachedFileLimitsConfig: vi.fn().mockReturnValue({ maxFileCount: 5 }),
  };
});

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/data/mockFeedbackData', () => ({
  getTicketFeedback: vi.fn().mockReturnValue(null),
  getTicketEmployees: vi.fn().mockReturnValue([]),
  fetchFeedbackForTicket: vi.fn().mockResolvedValue(null),
  hasFeedbackBeenSubmitted: vi.fn().mockReturnValue(false),
  isFeedbackFormEnabled: vi.fn().mockReturnValue(true),
}));

describe('Customer Ticket History Detail View (/history/:ticketId)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocationState = null;
    mockPathname = '/history/101';
    delete window.location;
    window.location = { pathname: '/history/101' };

    authContextModule.useAuth.mockReturnValue({
      user: { id: 12, name: 'Alice Customer', role: 'customer' },
      isAuthenticated: true,
    });
  });

  const mockTicket = {
    id: 'TKT-0101',
    ticket_ID: 101,
    title: 'Hospital Bedside Monitor Calibration',
    description: 'Monitor requires zero-point calibration and baseline safety testing.',
    status: 'Resolved',
    priority: 'Medium',
    customer: 'Alice Customer',
    facility: 'St. Jude Medical',
    equipment: 'Bedside Monitor',
    equipment_type: 'MON-500-A11',
    category: 'Biomedical',
    date: '2026-11-01T08:00:00Z',
    resolved_at: '2026-11-05T12:00:00Z',
    reassignmentRequested: true, // internal staff field
    reassignmentReason: 'Internal schedule clash',
    is_internal: false,
    proofFiles: [
      { name: 'calibration-report.pdf', url: '/storage/proofs/calibration-report.pdf' },
    ],
  };

  it('renders ticket details, auto-close window, and proof files for customer', async () => {
    ticketServiceModule.getTicketDetails.mockResolvedValueOnce(mockTicket);

    render(<EmployeeHistoryDetail />);

    await waitFor(() => {
      expect(screen.getByText('Hospital Bedside Monitor Calibration')).toBeInTheDocument();
    });

    expect(screen.getByText('TKT-0101')).toBeInTheDocument();
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('Bedside Monitor')).toBeInTheDocument();
    expect(screen.getAllByText('MON-500-A11').length).toBeGreaterThan(0);
    expect(screen.getAllByText('calibration-report.pdf').length).toBeGreaterThan(0);

    // Verify internal staff widgets are hidden for customer
    expect(screen.queryByText(/Your reassignment request wasn't approved/i)).toBeNull();
    expect(screen.queryByText('Reassigned')).toBeNull();
  });

  it('navigates back to /history when Back to History button is clicked', async () => {
    ticketServiceModule.getTicketDetails.mockResolvedValueOnce(mockTicket);

    render(<EmployeeHistoryDetail />);

    await waitFor(() => {
      expect(screen.getByText('Hospital Bedside Monitor Calibration')).toBeInTheDocument();
    });

    const backButton = screen.getByRole('button', { name: /Back to History/i });
    fireEvent.click(backButton);

    expect(mockNavigate).toHaveBeenCalledWith('/history');
  });

  it('navigates to /messages with selectedTicketId when Message Support is clicked', async () => {
    ticketServiceModule.getTicketDetails.mockResolvedValueOnce(mockTicket);

    render(<EmployeeHistoryDetail />);

    await waitFor(() => {
      expect(screen.getByText('Hospital Bedside Monitor Calibration')).toBeInTheDocument();
    });

    const msgBtn = screen.getByRole('button', { name: /Message Support/i });
    fireEvent.click(msgBtn);

    expect(mockNavigate).toHaveBeenCalledWith('/messages', {
      state: {
        selectedTicketId: 101,
        openDirectChat: true,
      },
    });
  });

  it('allows customer to reopen ticket when within reopen window', async () => {
    ticketServiceModule.getTicketDetails.mockResolvedValueOnce(mockTicket);
    ticketServiceModule.reopenTicket.mockResolvedValueOnce({ success: true });

    render(<EmployeeHistoryDetail />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Reopen Ticket/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Reopen Ticket/i }));

    expect(screen.getByText('Reopen Support Ticket')).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText(/Please detail why this issue persists/i);
    fireEvent.change(textarea, { target: { value: 'Monitor still shows error code 44 after reboot.' } });

    const confirmBtn = screen.getByRole('button', { name: /Confirm Reopen/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(ticketServiceModule.reopenTicket).toHaveBeenCalledWith(101, 'Monitor still shows error code 44 after reboot.');
    });

    await waitFor(() => {
      expect(screen.getByText('Ticket successfully reopened.')).toBeInTheDocument();
    });
  });

  it('navigates to /history/:ticketId when clicking a resolved ticket in MyTickets history mode', async () => {
    ticketServiceModule.getCustomerTickets.mockResolvedValueOnce([
      {
        id: 'TKT-0101',
        ticket_ID: 101,
        title: 'Resolved Ultrasound Probe Check',
        status: 'Resolved',
        date_created: '2026-11-01T08:00:00Z',
      },
    ]);

    render(<MyTickets mode="history" />);

    await waitFor(() => {
      expect(screen.getByText('Resolved Ultrasound Probe Check')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Resolved Ultrasound Probe Check'));

    expect(mockNavigate).toHaveBeenCalledWith('/history/101', {
      state: {
        ticket: expect.objectContaining({ ticket_ID: 101, status: 'Resolved' }),
        backPath: '/history',
      },
    });
  });
});
