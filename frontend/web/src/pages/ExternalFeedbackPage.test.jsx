import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ExternalFeedbackPage from './ExternalFeedbackPage';
import tokenStore from '@/auth/tokenStore';

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useParams: () => ({ ticketId: '101' }),
  useNavigate: () => mockNavigate,
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}));

// Mock mockFeedbackData
const mockSaveFeedback = vi.fn(() => Promise.resolve());
let mockExistingFeedback = null;

vi.mock('@/data/mockFeedbackData', () => ({
  getTicketEmployees: vi.fn((ticket) => {
    if (ticket?.assigned && Array.isArray(ticket.assigned) && ticket.assigned.length > 0) {
      return ticket.assigned;
    }
    return [
      {
        id: 501,
        name: 'Alex Rivera',
        jobTitle: 'Support Specialist',
        department: 'IT Support',
      },
    ];
  }),
  saveFeedback: (...args) => mockSaveFeedback(...args),
  hasFeedbackBeenSubmitted: vi.fn(() => Boolean(mockExistingFeedback)),
  getTicketFeedback: vi.fn(() => mockExistingFeedback),
  isFeedbackFormEnabled: vi.fn(() => true),
}));

// Mock configurationService
const mockQuestionsIT = [
  {
    id: 'q-it-1',
    text: 'How quickly was your technical incident resolved?',
    category: 'IT',
    responseType: 'Star Rating',
    required: false,
  },
  {
    id: 'q-it-2',
    text: 'Did the technician follow security protocols during the session?',
    category: 'IT',
    responseType: 'Yes / No',
    required: false,
  },
  {
    id: 'q-it-3',
    text: 'Which primary communication channel was used?',
    category: 'IT',
    responseType: 'Multiple Choice',
    options: ['In Person', 'Remote Access', 'Phone Call', 'Portal Chat'],
    required: false,
  },
  {
    id: 'q-it-4',
    text: 'Which hardware or software components were checked?',
    category: 'IT',
    responseType: 'Checkbox',
    options: ['Operating System', 'Network Router', 'Peripheral Devices', 'Cloud Storage'],
    required: false,
  },
  {
    id: 'q-it-5',
    text: 'Any additional notes regarding system stability?',
    category: 'IT',
    responseType: 'Free Text',
    required: false,
  },
];

let mockConfigShouldFail = false;

vi.mock('@/services/configurationService', () => ({
  getCategoryFeedbackQuestions: vi.fn(async (cat) => {
    if (mockConfigShouldFail) {
      throw new Error('Configuration service unavailable');
    }
    return {
      category: cat,
      questions: cat === 'IT' ? mockQuestionsIT : [],
    };
  }),
  getFeedbackFormStatus: vi.fn(async () => ({ is_enabled: true })),
}));

describe('ExternalFeedbackPage Component Tests (Category Specific Feedback Acceptance Criteria)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistingFeedback = null;
    mockConfigShouldFail = false;

    // Mock global fetch for ticket details and analytics pre-fill
    global.fetch = vi.fn(async (url) => {
      if (url.includes('/api/ticketing/analytics/feedback/ticket/')) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ data: null }),
        };
      }
      if (url.includes('/api/ticketing/ticket/tickets/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ticket: {
              id: '101',
              ticket_ID: '101',
              title: 'Workstation bootloop after system update',
              category: 'IT',
              status: 'Closed',
              customer: 'Acme Corp',
              assigned: [
                {
                  id: 501,
                  name: 'Alex Rivera',
                  jobTitle: 'Support Specialist',
                  department: 'IT Support',
                },
              ],
            },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
  });

  it('covers AC-1 & AC-2: displays feedback questions tailored to ticket category (IT) from configuration', async () => {
    render(<ExternalFeedbackPage />);

    // Wait for the form to render with IT category questions
    await waitFor(() => {
      expect(screen.getByText('Customer Satisfaction Survey')).toBeInTheDocument();
      expect(screen.getByText(/IT Category/i)).toBeInTheDocument();
    });

    // Check that configured IT questions are displayed
    expect(screen.getByText('How quickly was your technical incident resolved?')).toBeInTheDocument();
    expect(screen.getByText('Did the technician follow security protocols during the session?')).toBeInTheDocument();
    expect(screen.getByText('Which primary communication channel was used?')).toBeInTheDocument();
    expect(screen.getByText('Which hardware or software components were checked?')).toBeInTheDocument();
    expect(screen.getByText('Any additional notes regarding system stability?')).toBeInTheDocument();
  });

  it('covers AC-3: includes baseline overall rating for support specialists across all categories', async () => {
    render(<ExternalFeedbackPage />);

    await waitFor(() => {
      expect(screen.getByText('Assigned Support Specialists')).toBeInTheDocument();
    });

    // Baseline specialist rating card is present with assigned specialist
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument();
    expect(screen.getByText('Support Specialist')).toBeInTheDocument();
  });

  it('covers AC-4: renders all question types (Star Rating, Yes / No, Multiple Choice, Checkbox, Free Text)', async () => {
    render(<ExternalFeedbackPage />);

    await waitFor(() => {
      expect(screen.getByText('How quickly was your technical incident resolved?')).toBeInTheDocument();
    });

    // 1. Yes / No binary buttons
    expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No' })).toBeInTheDocument();

    // 2. Multiple choice options
    expect(screen.getByRole('button', { name: 'In Person' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remote Access' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Phone Call' })).toBeInTheDocument();

    // 3. Checkbox options
    expect(screen.getByText('Operating System')).toBeInTheDocument();
    expect(screen.getByText('Network Router')).toBeInTheDocument();

    // 4. Free text input
    expect(screen.getByPlaceholderText('Type your response here...')).toBeInTheDocument();

    // Click 'Yes' button
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));

    // Click 'Remote Access' button
    fireEvent.click(screen.getByRole('button', { name: 'Remote Access' }));

    // Check a checkbox
    const osCheckbox = screen.getByLabelText('Operating System');
    fireEvent.click(osCheckbox);
    expect(osCheckbox.checked).toBe(true);

    // Type in free text
    const textInput = screen.getByPlaceholderText('Type your response here...');
    fireEvent.change(textInput, { target: { value: 'All workstation services restored normally.' } });
    expect(textInput.value).toBe('All workstation services restored normally.');
  });

  it('covers AC-5: falls back cleanly without breaking if category has no specific questions configured', async () => {
    // Ticket with Service category that returns empty questions
    global.fetch = vi.fn(async (url) => {
      if (url.includes('/api/ticketing/ticket/tickets/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ticket: {
              id: '101',
              ticket_ID: '101',
              title: 'HVAC scheduled maintenance',
              category: 'Service',
              status: 'Closed',
              assigned: [
                {
                  id: 502,
                  name: 'Elena Santos',
                  jobTitle: 'Field Technician',
                  department: 'Facilities',
                },
              ],
            },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    render(<ExternalFeedbackPage />);

    await waitFor(() => {
      expect(screen.getByText(/Service Category/i)).toBeInTheDocument();
    });

    // Category questions section is cleanly absent, but baseline rating and overall comment remain
    expect(screen.queryByText('Category Evaluation')).not.toBeInTheDocument();
    expect(screen.getByText('Assigned Support Specialists')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Share your experience or suggestions here...')).toBeInTheDocument();
  });

  it('covers AC-6: allows submitting feedback with only required fields answered and optional category questions blank', async () => {
    render(<ExternalFeedbackPage />);

    await waitFor(() => {
      expect(screen.getByText('Customer Satisfaction Survey')).toBeInTheDocument();
    });

    // Provide required rating for technician (click 5th star radio button)
    const starRadios = screen.getAllByRole('radio', { name: /5 stars/i });
    if (starRadios.length > 0) {
      fireEvent.click(starRadios[0]);
    }

    // Submit without answering optional category questions
    const submitBtn = screen.getByRole('button', { name: /Submit Feedback/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockSaveFeedback).toHaveBeenCalled();
    });
  });

  it('covers AC-7: pre-fills previously submitted answers when customer enters edit mode', async () => {
    mockExistingFeedback = {
      submitted: true,
      ratings: { 501: 5 },
      comments: { 501: 'Prompt support' },
      overallComment: 'Great turnaround on urgent ticket.',
      questionAnswers: {
        'q-it-2': 'Yes',
        'q-it-3': 'Remote Access',
      },
      categoryQuestionsSnapshot: mockQuestionsIT,
    };

    render(<ExternalFeedbackPage />);

    // Screen initially displays "Feedback Already Submitted"
    await waitFor(() => {
      expect(screen.getByText('Feedback Already Submitted')).toBeInTheDocument();
      expect(screen.getByText(/"Great turnaround on urgent ticket."/i)).toBeInTheDocument();
    });

    // Click "Edit Feedback" button
    const editBtn = screen.getByRole('button', { name: /Edit Feedback/i });
    fireEvent.click(editBtn);

    // Form opens in edit mode pre-filling previous answers
    await waitFor(() => {
      expect(screen.getByText('Customer Satisfaction Survey')).toBeInTheDocument();
    });

    // Text area is pre-filled
    const commentInput = screen.getByPlaceholderText('Share your experience or suggestions here...');
    expect(commentInput.value).toBe('Great turnaround on urgent ticket.');
  });

  it('covers AC-8: falls back to baseline overall rating if question configuration fails to load', async () => {
    mockConfigShouldFail = true;

    render(<ExternalFeedbackPage />);

    // Page still renders successfully with baseline specialist rating
    await waitFor(() => {
      expect(screen.getByText('Customer Satisfaction Survey')).toBeInTheDocument();
      expect(screen.getByText('Assigned Support Specialists')).toBeInTheDocument();
    });

    // Customer is not blocked from submitting
    expect(screen.getByRole('button', { name: /Submit Feedback/i })).toBeInTheDocument();
  });

  it('spec 0034 AC-4: asks the analytics service for existing feedback with the signed in bearer token', async () => {
    tokenStore.setToken('customer-token-xyz');

    try {
      render(<ExternalFeedbackPage />);

      await waitFor(() => {
        expect(screen.getByText('Customer Satisfaction Survey')).toBeInTheDocument();
      });

      const feedbackCall = global.fetch.mock.calls.find(([url]) => String(url).includes('/api/ticketing/analytics/feedback/ticket/'));
      expect(feedbackCall).toBeDefined();
      expect(feedbackCall[1].headers.Authorization).toBe('Bearer customer-token-xyz');
    } finally {
      tokenStore.clearToken();
    }
  });

  it('spec 0034 AC-4: sends no Authorization header when nobody is signed in', async () => {
    tokenStore.clearToken();

    render(<ExternalFeedbackPage />);

    await waitFor(() => {
      expect(screen.getByText('Customer Satisfaction Survey')).toBeInTheDocument();
    });

    const feedbackCall = global.fetch.mock.calls.find(([url]) => String(url).includes('/api/ticketing/analytics/feedback/ticket/'));
    expect(feedbackCall).toBeDefined();
    expect(feedbackCall[1].headers).not.toHaveProperty('Authorization');
  });

  it('covers AC-9: ensures responsive and accessible form controls for desktop and mobile', async () => {
    render(<ExternalFeedbackPage />);

    await waitFor(() => {
      expect(screen.getByText('Customer Satisfaction Survey')).toBeInTheDocument();
    });

    // Back button and submit button are accessible
    expect(screen.getByRole('button', { name: /Back to Portal/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Submit Feedback/i })).toBeInTheDocument();

    // Check textarea accessibility
    expect(screen.getByPlaceholderText('Share your experience or suggestions here...')).toBeInTheDocument();
  });
});
