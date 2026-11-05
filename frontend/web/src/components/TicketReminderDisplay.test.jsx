import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import CustomerTicketDetailModal from './CustomerTicketDetailModal';
import TicketDetailModal from './employee/TicketDetailModal';
import TicketInfoModal from './employee/TicketInfoModal';
import { TicketSummary } from './CSModals';

// Mock router and auth
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ search: '', state: {} }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 6, emp_id: 6, name: 'David Kim', role: 'technician' },
  })),
}));

vi.mock('@/services/configurationService', () => ({
  getFeedbackFormStatus: vi.fn(() => Promise.resolve({ enabled: false })),
  getWindowConfiguration: vi.fn(() => Promise.resolve({ reopenEnabled: true, autoCloseEnabled: true })),
  getCachedWindowConfiguration: vi.fn(() => ({ reopenEnabled: true, autoCloseEnabled: true })),
}));

vi.mock('@/data/mockFeedbackData', () => ({
  hasFeedbackBeenSubmitted: vi.fn(() => false),
  isFeedbackFormEnabled: vi.fn(() => false),
  setFeedbackFormEnabled: vi.fn(),
  fetchFeedbackForTicket: vi.fn(() => Promise.resolve(null)),
  getTicketFeedback: vi.fn(),
  getTicketEmployees: vi.fn(() => []),
}));

vi.mock('@/services/ticketService', () => ({
  // The timeline reads the server's audit trail; a reminder shows up as a reminder_sent entry.
  getTicketTimeline: vi.fn(() => Promise.resolve({
    data: [
      {
        log_id: 1,
        ticket_id: 2002,
        action_type: 'reminder_sent',
        event_type: 'reminder_sent',
        actor: { id: 5, name: 'Customer Support', role: 'customer service' },
        description: 'Reminder sent',
        before_state: null,
        after_state: null,
        details: '{}',
        is_system: false,
        is_internal: false,
        created_at: '2026-10-23T06:15:00Z',
      },
    ],
    pagination: { current_page: 1, last_page: 1, total: 1 },
  })),
  getTicketDetails: vi.fn(() => Promise.resolve({})),
  getInternalNotes: vi.fn(() => Promise.resolve([])),
  addInternalNote: vi.fn(() => Promise.resolve({})),
  updateEmployeeTicketOverride: vi.fn(() => Promise.resolve({})),
  holdTicket: vi.fn(() => Promise.resolve({})),
  resumeTicket: vi.fn(() => Promise.resolve({})),
  reclassifyTicket: vi.fn(() => Promise.resolve({})),
  getTicketFormOptions: vi.fn(() => Promise.resolve({
    problem_categories: [],
    ticket_priorities: [],
  })),
  sendTicketReminder: vi.fn(() => Promise.resolve({ success: true })),
}));

describe('Ticket Reminder Visual Displays across CS and Employee Modals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleTicketWithReminder = {
    id: 'TKT-2002',
    ticket_ID: 2002,
    title: 'Network Gateway Intermittent Drops',
    description: 'Switch port 4 flap causes VPN disconnection for remote staff.',
    customer: 'Alpha Branch Office',
    category: 'Network & Connectivity',
    priority: 'High',
    status: 'In Progress',
    department: 'Facilities',
    sla_status: 'Breached',
    accepted: true,
    last_reminder_sent_at: '2026-10-23T06:15:00Z',
    assigned: [
      { id: 6, name: 'David Kim', department: 'Facilities', status: 'active' },
    ],
    timeline: [
      {
        id: 1,
        type: 'reminder',
        title: 'Reminder sent to David Kim by Sarah Connor. Message: "Please expedite network review."',
        date: '2026-10-23T06:15:00Z',
        actor: 'Sarah Connor',
      },
    ],
  };

  it('renders Employee Reminder Dispatched banner and timeline entry in TicketSummary (CS)', () => {
    render(
      <TicketSummary
        ticket={sampleTicketWithReminder}
        employees={[{ id: 6, name: 'David Kim' }]}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/Employee Reminder Dispatched/i)).toBeInTheDocument();
    expect(screen.getByText(/A reminder prompt was dispatched to the assigned technician on/i)).toBeInTheDocument();
  });

  it('renders CS Employee Reminder card and timeline item in TicketDetailModal (Employee)', () => {
    render(
      <TicketDetailModal
        ticket={sampleTicketWithReminder}
        onClose={vi.fn()}
        onStatusChange={vi.fn()}
      />
    );

    expect(screen.getByText('CS Employee Reminder')).toBeInTheDocument();
    expect(screen.getByText(/Customer Service dispatched a reminder prompt regarding this ticket/i)).toBeInTheDocument();
    expect(screen.getByText('CS Reminder')).toBeInTheDocument();
  });

  it('renders Customer Service Reminder Dispatched banner in TicketInfoModal (Employee)', () => {
    render(
      <TicketInfoModal
        ticket={sampleTicketWithReminder}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Customer Service Reminder Dispatched')).toBeInTheDocument();
    expect(screen.getByText(/A reminder prompt was dispatched on/i)).toBeInTheDocument();
  });

  it('renders Last Reminder Sent details card and timeline entry in CustomerTicketDetailModal', async () => {
    render(
      <CustomerTicketDetailModal
        ticket={sampleTicketWithReminder}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Last Reminder Sent')).toBeInTheDocument();
    expect(await screen.findByText('CS Reminder')).toBeInTheDocument();
  });
});
