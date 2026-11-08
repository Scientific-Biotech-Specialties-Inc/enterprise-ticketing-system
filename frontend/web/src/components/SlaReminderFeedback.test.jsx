import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { TicketSummary, renderTicketSlaBadge } from './CSModals';
import TicketFeedbackSection from './feedback/TicketFeedbackSection';
import * as ticketService from '@/services/ticketService';
import * as mockFeedbackData from '@/data/mockFeedbackData';

// Mock AuthContext
const mockUser = {
  emp_id: 201,
  name: 'Sarah Jenkins',
  role: 'Customer Support',
  department: 'Customer Service',
};

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: mockUser,
  })),
}));

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ search: '', state: {} }),
}));

// Mock ticketService
vi.mock('@/services/ticketService', () => ({
  sendTicketReminder: vi.fn(() => Promise.resolve({ success: true })),
  getTicketFormOptions: vi.fn(() => Promise.resolve({
    problem_categories: [
      { id: 1, problem_category_ID: 1, category_name: 'Electrical' },
      { id: 2, problem_category_ID: 2, category_name: 'Software' },
    ],
    ticket_priorities: [
      { id: 1, priority_ID: 1, priority_name: 'Low' },
      { id: 2, priority_ID: 2, priority_name: 'Medium' },
      { id: 3, priority_ID: 3, priority_name: 'High' },
      { id: 4, priority_ID: 4, priority_name: 'Critical' },
    ],
  })),
  getInternalNotes: vi.fn(() => Promise.resolve([])),
  addInternalNote: vi.fn(() => Promise.resolve({})),
  holdTicket: vi.fn(() => Promise.resolve({})),
  resumeTicket: vi.fn(() => Promise.resolve({})),
  reclassifyTicket: vi.fn(() => Promise.resolve({
    data: {
      ticket: {
        due_at: '2026-10-28T18:00:00Z',
        sla_status: 'On Track',
      },
    },
  })),
}));

// Mock mockFeedbackData
vi.mock('@/data/mockFeedbackData', () => ({
  getTicketFeedback: vi.fn(),
  getTicketEmployees: vi.fn(() => [
    { id: 101, name: 'Alex Rivera', jobTitle: 'Support Engineer', department: 'Technical Support' },
  ]),
  saveFeedback: vi.fn(() => Promise.resolve({ submitted: true })),
  updateFeedback: vi.fn(() => Promise.resolve({ submitted: true })),
  deleteFeedback: vi.fn(() => Promise.resolve(true)),
  hasFeedbackBeenSubmitted: vi.fn(),
  fetchFeedbackForTicket: vi.fn(() => Promise.resolve(null)),
}));

describe('CS SLA Display and Employee Reminder Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const getFreshTicket = () => ({
    id: 991,
    ticket_ID: 991,
    title: 'Emergency Generator Failure',
    customer: 'St. Jude Hospital',
    category: 'Electrical',
    priority: 'Critical',
    status: 'In Progress',
    department: 'Facilities',
    due_at: '2026-10-25T14:00:00Z',
    resolution_due_at: '2026-10-25T14:00:00Z',
    sla_status: 'At Risk',
    assigned_employees: [
      { id: 501, name: 'Marcus Brody', department: 'Facilities', status: 'active' },
    ],
    assigned: [
      { id: 501, name: 'Marcus Brody', department: 'Facilities', status: 'active' },
    ],
    last_reminder_sent_at: null,
    timeline: [],
  });

  it('renders SLA due date and accessible status badge in TicketSummary', () => {
    render(<TicketSummary ticket={getFreshTicket()} employees={[]} onClose={vi.fn()} />);

    expect(screen.getByText('SLA Due Date')).toBeInTheDocument();
    expect(screen.getByText('At Risk')).toBeInTheDocument();
  });

  it('renders all SLA badge states with accessible titles and text', () => {
    const { rerender } = render(renderTicketSlaBadge('breached', '2026-10-25T14:00:00Z'));
    expect(screen.getByText('Breached')).toBeInTheDocument();

    rerender(renderTicketSlaBadge('paused', null));
    expect(screen.getByText('Paused (On Hold)')).toBeInTheDocument();

    rerender(renderTicketSlaBadge('ontrack', '2026-10-25T14:00:00Z'));
    expect(screen.getByText('On Track')).toBeInTheDocument();

    rerender(renderTicketSlaBadge('unavailable', null));
    expect(screen.getByText('SLA Unavailable')).toBeInTheDocument();

    rerender(renderTicketSlaBadge(null, null));
    expect(screen.getByText('No SLA Configured')).toBeInTheDocument();
  });

  it('shows Send Reminder button for eligible unresolved tickets and handles reminder dialog', async () => {
    render(<TicketSummary ticket={getFreshTicket()} employees={[]} onClose={vi.fn()} />);

    const reminderBtn = screen.getByRole('button', { name: /send reminder/i });
    expect(reminderBtn).toBeInTheDocument();
    expect(reminderBtn).not.toBeDisabled();

    // Open reminder dialog
    fireEvent.click(reminderBtn);

    expect(screen.getByText('Send Employee Reminder')).toBeInTheDocument();
    expect(screen.getAllByText('Marcus Brody').length).toBeGreaterThan(0);

    // Fill optional custom message
    const textarea = screen.getByPlaceholderText(/urgent note or instructions/i);
    fireEvent.change(textarea, { target: { value: 'Please update customer before end of day.' } });

    // Submit reminder
    const sendReminderButtons = screen.getAllByRole('button', { name: /send reminder/i });
    const modalSubmitBtn = sendReminderButtons[sendReminderButtons.length - 1];
    fireEvent.click(modalSubmitBtn);

    await waitFor(() => {
      expect(ticketService.sendTicketReminder).toHaveBeenCalledWith(
        991,
        'Please update customer before end of day.'
      );
    });
  });

  it('covers AC-7 (optional message): sends reminder with default/empty message when context note is left blank', async () => {
    render(<TicketSummary ticket={getFreshTicket()} employees={[]} onClose={vi.fn()} />);

    const reminderBtn = screen.getByRole('button', { name: /send reminder/i });
    fireEvent.click(reminderBtn);

    expect(screen.getByText('Send Employee Reminder')).toBeInTheDocument();

    // Leave textarea empty and click submit
    const sendReminderButtons = screen.getAllByRole('button', { name: /send reminder/i });
    const modalSubmitBtn = sendReminderButtons[sendReminderButtons.length - 1];
    fireEvent.click(modalSubmitBtn);

    await waitFor(() => {
      expect(ticketService.sendTicketReminder).toHaveBeenCalledWith(991, '');
    });
  });

  it('covers AC-8 (cancel): closing or cancelling Send Reminder dialog aborts send and leaves timeline untouched', () => {
    const freshTicket = getFreshTicket();
    render(<TicketSummary ticket={freshTicket} employees={[]} onClose={vi.fn()} />);

    const reminderBtn = screen.getByRole('button', { name: /send reminder/i });
    fireEvent.click(reminderBtn);

    expect(screen.getByText('Send Employee Reminder')).toBeInTheDocument();

    // Click Cancel in modal
    const cancelButtons = screen.getAllByRole('button', { name: /cancel/i });
    const modalCancelBtn = cancelButtons[cancelButtons.length - 1];
    fireEvent.click(modalCancelBtn);

    // Dialog is closed, send was not called
    expect(screen.queryByText('Send Employee Reminder')).not.toBeInTheDocument();
    expect(ticketService.sendTicketReminder).not.toHaveBeenCalled();
    expect(freshTicket.timeline).toHaveLength(0);
  });

  it('covers AC-8 (error state): displays clear error alert in reminder modal when send fails without recording in timeline', async () => {
    ticketService.sendTicketReminder.mockRejectedValueOnce({
      response: { data: { message: 'Notification service currently unreachable' } },
    });

    const freshTicket = getFreshTicket();
    render(<TicketSummary ticket={freshTicket} employees={[]} onClose={vi.fn()} />);

    const reminderBtn = screen.getByRole('button', { name: /send reminder/i });
    fireEvent.click(reminderBtn);

    expect(screen.getByText('Send Employee Reminder')).toBeInTheDocument();

    const sendReminderButtons = screen.getAllByRole('button', { name: /send reminder/i });
    const modalSubmitBtn = sendReminderButtons[sendReminderButtons.length - 1];
    fireEvent.click(modalSubmitBtn);

    await waitFor(() => {
      expect(screen.getByText('Notification service currently unreachable')).toBeInTheDocument();
    });

    expect(freshTicket.timeline).toHaveLength(0);
  });

  it('enforces 60-minute anti-spam cooldown on Send Reminder button', () => {
    const recentReminderTicket = {
      ...getFreshTicket(),
      last_reminder_sent_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(), // 15 mins ago
    };

    render(<TicketSummary ticket={recentReminderTicket} employees={[]} onClose={vi.fn()} />);

    const reminderBtn = screen.getByRole('button', { name: /send reminder/i });
    expect(reminderBtn).toBeDisabled();
    expect(screen.getByText('Last Reminder Sent')).toBeInTheDocument();
  });

  it('covers AC-6 (unassigned): hides Send Reminder button when ticket has no assigned employee', () => {
    const unassignedTicket = {
      ...getFreshTicket(),
      assigned: [],
      assigned_employees: [],
      assigned_to: null,
      assigned_employee: null,
    };

    render(<TicketSummary ticket={unassignedTicket} employees={[]} onClose={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /send reminder/i })).not.toBeInTheDocument();
  });

  it('covers AC-6 (resolved/closed): hides Send Reminder button when ticket is already Resolved or Closed', () => {
    const resolvedTicket = {
      ...getFreshTicket(),
      status: 'Resolved',
    };

    render(<TicketSummary ticket={resolvedTicket} employees={[]} onClose={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /send reminder/i })).not.toBeInTheDocument();
  });
});

describe('Customer Feedback Lifecycle Tests (Submit, Dismiss, Edit, Delete)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const resolvedTicket = {
    id: 882,
    ticket_ID: 882,
    title: 'Workstation Setup',
    status: 'Resolved',
    category: 'IT',
  };

  it('renders dismissible Rate Your Experience prompt and hides on dismiss', () => {
    mockFeedbackData.getTicketFeedback.mockReturnValue(null);

    render(<TicketFeedbackSection ticket={resolvedTicket} onLeaveFeedback={vi.fn()} />);

    expect(screen.getByText('Rate Your Experience')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /leave feedback/i })).toBeInTheDocument();

    // Click Not Now
    const notNowBtn = screen.getByRole('button', { name: /not now/i });
    fireEvent.click(notNowBtn);

    expect(screen.getByText(/feedback prompt dismissed/i)).toBeInTheDocument();
  });

  it('covers AC-9 (restore): allows restoring dismissed prompt via Rate Experience button', () => {
    mockFeedbackData.getTicketFeedback.mockReturnValue(null);

    render(<TicketFeedbackSection ticket={resolvedTicket} onLeaveFeedback={vi.fn()} />);

    const notNowBtn = screen.getByRole('button', { name: /not now/i });
    fireEvent.click(notNowBtn);

    expect(screen.getByText(/feedback prompt dismissed/i)).toBeInTheDocument();

    const restoreBtn = screen.getByRole('button', { name: /rate experience/i });
    fireEvent.click(restoreBtn);

    expect(screen.getByText('Rate Your Experience')).toBeInTheDocument();
  });

  it('renders submitted feedback and allows edit within 48-hour window', () => {
    const recentFeedback = {
      submitted: true,
      submittedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
      ratings: { 101: 5 },
      comments: { 101: 'Outstanding support!' },
      overallComment: 'Resolved smoothly.',
    };
    mockFeedbackData.getTicketFeedback.mockReturnValue(recentFeedback);

    const onEditMock = vi.fn();
    render(<TicketFeedbackSection ticket={resolvedTicket} onLeaveFeedback={vi.fn()} onEditFeedback={onEditMock} />);

    expect(screen.getByText('Customer Feedback')).toBeInTheDocument();
    expect(screen.getByText(/editable for/i)).toBeInTheDocument();

    const editBtn = screen.getByRole('button', { name: /edit/i });
    expect(editBtn).toBeInTheDocument();
    fireEvent.click(editBtn);

    expect(onEditMock).toHaveBeenCalledWith(recentFeedback);
  });

  it('spec 0034 AC-12: the customer portal has no delete feedback action', () => {
    const recentFeedback = {
      submitted: true,
      submittedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      ratings: { 101: 5 },
      comments: { 101: 'Great support!' },
    };
    mockFeedbackData.getTicketFeedback.mockReturnValue(recentFeedback);

    render(<TicketFeedbackSection ticket={resolvedTicket} onLeaveFeedback={vi.fn()} />);

    // Edit stays available inside the 48 hour window, delete is for admins only (done in the backend).
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Delete Feedback?')).not.toBeInTheDocument();
    expect(mockFeedbackData.deleteFeedback).not.toHaveBeenCalled();
  });

  it('locks feedback actions when 48-hour edit window is expired', () => {
    const expiredFeedback = {
      submitted: true,
      submittedAt: new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString(), // 50 hours ago
      ratings: { 101: 4 },
      comments: { 101: 'Good work' },
    };
    mockFeedbackData.getTicketFeedback.mockReturnValue(expiredFeedback);

    render(<TicketFeedbackSection ticket={resolvedTicket} onLeaveFeedback={vi.fn()} />);

    expect(screen.getByText(/feedback locked \(48h edit window closed\)/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
  });
});
