import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

// Regression: the customer and CS ticket modals showed the list snapshot forever, so assigning a
// ticket while the modal was open never moved the "Assigned" stepper circle or the assignee row.

const listeners = {};
const mockChannel = {
  listen: vi.fn((event, cb) => {
    listeners[event] = cb;
    return mockChannel;
  }),
  stopListening: vi.fn(() => mockChannel),
};
vi.mock('@/services/echo', () => ({ default: { channel: vi.fn(() => mockChannel) } }));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ search: '', state: {} }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: { id: 3, emp_id: 3, name: 'CS Agent', role: 'cs' } })),
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

vi.mock('@/services/messagingService', () => ({
  getTicketMessages: vi.fn(() => Promise.resolve([])),
  sendTicketMessage: vi.fn(() => Promise.resolve({})),
}));

vi.mock('@/services/ticketService', () => ({
  getTicketDetails: vi.fn(),
  getTicketTimeline: vi.fn(() => Promise.resolve({ data: [], pagination: { total: 0 } })),
  getInternalNotes: vi.fn(() => Promise.resolve([])),
  addInternalNote: vi.fn(() => Promise.resolve({})),
  holdTicket: vi.fn(() => Promise.resolve({})),
  resumeTicket: vi.fn(() => Promise.resolve({})),
  reclassifyTicket: vi.fn(() => Promise.resolve({})),
  getTicketFormOptions: vi.fn(() => Promise.resolve({ problem_categories: [], ticket_priorities: [] })),
  sendTicketReminder: vi.fn(() => Promise.resolve({ success: true })),
}));

import { getTicketDetails } from '@/services/ticketService';
import CustomerTicketDetailModal from './CustomerTicketDetailModal';
import { TicketSummary } from './CSModals';

const openUnassigned = {
  id: 'TKT-0042',
  ticket_ID: 42,
  title: 'Centrifuge will not spin up',
  description: 'Rotor error on start.',
  status: 'Open',
  priority: 'High',
  category: 'Lab Equipment',
  department: 'Service',
  assigned: [],
  assigned_to: null,
  date: '2026-11-09T01:00:00Z',
  date_created: '2026-11-09T01:00:00Z',
};

const serverUnassigned = { ...openUnassigned, assigned_employees: [], assigned_employee: null };

const serverAssigned = {
  ...openUnassigned,
  status: 'Pending Assignment',
  assigned: [7],
  assigned_employee: 'Ana Cruz',
  assigned_employee_name: 'Ana Cruz',
  assigned_to_name: 'Ana Cruz',
  assigned_employees: [{ id: 7, name: 'Ana Cruz', department: 'Service', status: 'active' }],
};

const currentStep = (container) => container.querySelector('[aria-current="step"]')?.getAttribute('data-step');

describe('ticket modals follow backend assignment while open', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(listeners).forEach((k) => delete listeners[k]);
    localStorage.clear();
  });

  it('customer modal: Assigned circle lights up when the opened snapshot is stale', async () => {
    getTicketDetails.mockResolvedValue(serverAssigned);
    const { container } = render(<CustomerTicketDetailModal ticket={openUnassigned} onClose={vi.fn()} />);

    expect(currentStep(container)).toBe('submitted');
    await waitFor(() => expect(currentStep(container)).toBe('assigned'));
    expect(screen.getByText('Ana Cruz')).toBeInTheDocument();
    expect(getTicketDetails).toHaveBeenCalledWith(42, { forceRefresh: true });
  });

  it('customer modal: Assigned circle lights up when CS assigns while the modal is open', async () => {
    getTicketDetails.mockResolvedValueOnce(serverUnassigned);
    const { container } = render(<CustomerTicketDetailModal ticket={openUnassigned} onClose={vi.fn()} />);
    await waitFor(() => expect(getTicketDetails).toHaveBeenCalledTimes(1));
    expect(currentStep(container)).toBe('submitted');
    expect(screen.getByText('Unassigned')).toBeInTheDocument();

    getTicketDetails.mockResolvedValueOnce(serverAssigned);
    await act(async () => {
      listeners['.ticket.changed']({ action: 'assigned', ticket_ID: 42 });
    });

    await waitFor(() => expect(currentStep(container)).toBe('assigned'));
    expect(screen.getByText('Ana Cruz')).toBeInTheDocument();
  });

  it('CS summary: assigned employee appears when assignment happens while open', async () => {
    getTicketDetails.mockResolvedValueOnce(serverUnassigned);
    const employees = [{ id: 7, name: 'Ana Cruz', department: 'Service', status: 'active' }];
    render(<TicketSummary ticket={openUnassigned} employees={employees} onClose={vi.fn()} readOnly />);
    await waitFor(() => expect(getTicketDetails).toHaveBeenCalledTimes(1));
    expect(screen.getByText('None assigned')).toBeInTheDocument();

    getTicketDetails.mockResolvedValueOnce(serverAssigned);
    await act(async () => {
      listeners['.ticket.changed']({ action: 'assigned', ticket_ID: 42 });
    });

    await waitFor(() => expect(screen.queryByText('None assigned')).not.toBeInTheDocument());
    expect(screen.getByText('Ana Cruz')).toBeInTheDocument();
  });
});
