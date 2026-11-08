import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TicketSummary } from './CSModals';

// Mock dependencies
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
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
  getTicketDetails: vi.fn(() => Promise.resolve({})),
  getInternalNotes: vi.fn(() => Promise.resolve([])),
  addInternalNote: vi.fn(() => Promise.resolve({})),
  holdTicket: vi.fn(() => Promise.resolve({})),
  resumeTicket: vi.fn(() => Promise.resolve({})),
  reclassifyTicket: vi.fn(() => Promise.resolve({})),
  getTicketFormOptions: vi.fn(() => Promise.resolve({
    problem_categories: [],
    ticket_priorities: [],
  })),
  sendTicketReminder: vi.fn(() => Promise.resolve({ success: true })),
}));

import { getTicketFormOptions } from '@/services/ticketService';

describe('CS ticket reclassification flow', () => {
  beforeEach(() => vi.clearAllMocks());

  // Regression: ReclassifyConfirmModal referenced priorityColors without importing it,
  // so clicking "Review Changes" crashed the page into a blank screen.
  it('opens the confirmation step after changing priority', async () => {
    getTicketFormOptions.mockResolvedValue({
      problem_categories: [{ problem_category_ID: 1, category_name: 'IT' }, { problem_category_ID: 2, category_name: 'Service' }],
      ticket_priorities: [{ priority_ID: 1, priority_name: 'Low' }, { priority_ID: 3, priority_name: 'High' }],
    });
    const ticket = { id: 'TKT-31', ticket_ID: 31, title: 'Monitor alarm', category: 'Service', priority: 'High', status: 'In Progress', assigned: [], timeline: [] };
    render(<TicketSummary ticket={ticket} employees={[]} onClose={vi.fn()} onEdit={vi.fn()} onStatusUpdate={vi.fn()} />);

    fireEvent.click(screen.getByText('Edit Priority'));
    await screen.findByText('Edit Category & Priority');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Low' })).toBeInTheDocument());

    const prioritySelect = screen.getByRole('option', { name: 'Low' }).closest('select');
    fireEvent.change(prioritySelect, { target: { value: 'Low' } });
    fireEvent.click(screen.getByText('Review Changes'));

    expect(await screen.findByText('Confirm Ticket Reclassification')).toBeInTheDocument();
  });
});
