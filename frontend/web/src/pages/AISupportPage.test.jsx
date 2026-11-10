import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AISupportPage, { FormattedText } from './AISupportPage';
import * as authContextModule from '@/context/AuthContext';
import * as ticketServiceModule from '@/services/ticketService';
import axiosInstance from '@/api/axiosInstance';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ state: null, pathname: '/ai-support' }),
  };
});

vi.mock('@/api/axiosInstance', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { success: true, conversations: [] } }),
    post: vi.fn().mockResolvedValue({ data: { success: true, response: 'Thank you for the information.' } }),
    delete: vi.fn().mockResolvedValue({ data: { success: true } }),
  },
}));

vi.mock('@/services/ticketService', () => ({
  getTicketFormOptions: vi.fn().mockResolvedValue({ machines: [], problem_categories: [], ticket_priorities: [] }),
  createTicket: vi.fn(),
  getCustomerTickets: vi.fn().mockResolvedValue([]),
  saveTicketDraft: vi.fn(),
}));

describe('AISupportPage & FormattedText User Reply Rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(authContextModule, 'useAuth').mockReturnValue({
      user: { id: 1, name: 'Test Customer', role: 'customer' },
      role: 'customer',
      isAuthenticated: true,
    });
    axiosInstance.get.mockResolvedValue({ data: { success: true, conversations: [] } });
  });

  describe('FormattedText Component', () => {
    it('renders user reply with multiple steps as normal text and not buttons when isUser=true', () => {
      const userReplyText = `STEP 1 Printer
STEP 2 Yumizen
STEP 3 73030128
STEP 4 Not opening
STEP 5 Unplug and plug`;

      const { container } = render(<FormattedText text={userReplyText} isUser={true} />);

      // Must be rendered in a normal text paragraph with whitespace-pre-wrap
      const paragraph = container.querySelector('p');
      expect(paragraph).not.toBeNull();
      expect(paragraph.textContent).toContain('STEP 1 Printer');
      expect(paragraph.textContent).toContain('STEP 5 Unplug and plug');
      expect(paragraph.className).toContain('whitespace-pre-wrap');

      // Crucially, must NOT contain interactive step buttons or completion banners
      expect(screen.queryByText(/completed/i)).toBeNull();
      expect(screen.queryByText(/guided troubleshooting steps/i)).toBeNull();
      expect(container.querySelectorAll('.cursor-pointer').length).toBe(0);
      expect(container.querySelectorAll('button').length).toBe(0);
    });

    it('renders AI troubleshooting steps as interactive checklist when isUser=false', () => {
      const aiTroubleshootingText = `Step 1: Check the power cable
Step 2: Restart the machine`;

      const { container } = render(<FormattedText text={aiTroubleshootingText} isUser={false} />);

      expect(screen.getByText(/guided troubleshooting steps/i)).toBeDefined();
      expect(screen.getByText(/0 \/ 2 completed/i)).toBeDefined();
      expect(container.querySelectorAll('.cursor-pointer').length).toBe(2);
    });

    it('renders AI non-troubleshooting text with inline tokens as normal paragraphs', () => {
      const normalAiText = `Hello! I can help you troubleshoot. Please provide your machine details.`;

      const { container } = render(<FormattedText text={normalAiText} isUser={false} />);

      expect(screen.queryByText(/guided troubleshooting steps/i)).toBeNull();
      expect(container.querySelectorAll('.cursor-pointer').length).toBe(0);
      expect(screen.getByText(/hello! i can help you troubleshoot/i)).toBeDefined();
    });
  });

  describe('Chat bubble rendering in AISupportPage', () => {
    it('renders customer message replies with steps as plain text without buttons or completion header when sending a reply', async () => {
      render(<AISupportPage />);

      // Wait for initial conversation loading skeleton to disappear
      await waitFor(() => {
        expect(screen.queryByTestId('chat-messages-skeleton')).toBeNull();
      });

      const textarea = screen.getByPlaceholderText(/type a message/i);
      const userReplyText = `STEP 1 Printer\nSTEP 2 Yumizen\nSTEP 3 73030128\nSTEP 4 Not opening\nSTEP 5 Unplug and plug`;

      fireEvent.change(textarea, { target: { value: userReplyText } });
      const sendButton = textarea.nextElementSibling;
      fireEvent.click(sendButton);

      // The user message content must be visible in a normal text paragraph
      const paragraph = await screen.findByText((content, element) => {
        return element.tagName.toLowerCase() === 'p' && content.includes('STEP 1 Printer');
      });

      expect(paragraph).toBeDefined();
      expect(paragraph.className).toContain('whitespace-pre-wrap');
      expect(paragraph.textContent).toContain('STEP 5 Unplug and plug');

      // Crucially verify that no step buttons, checkboxes, or completed counter are rendered inside user chat bubble
      expect(screen.queryByText(/5 \/ 5 completed/i)).toBeNull();
      expect(screen.queryByText(/guided troubleshooting steps/i)).toBeNull();
    });

    it('renders single-line user messages cleanly as normal text', async () => {
      render(<AISupportPage />);

      await waitFor(() => {
        expect(screen.queryByTestId('chat-messages-skeleton')).toBeNull();
      });

      const textarea = screen.getByPlaceholderText(/type a message/i);
      fireEvent.change(textarea, { target: { value: 'My printer is not responding' } });
      const sendButton = textarea.nextElementSibling;
      fireEvent.click(sendButton);

      const paragraph = await screen.findByText('My printer is not responding');
      expect(paragraph).toBeDefined();
      expect(paragraph.tagName.toLowerCase()).toBe('p');
      expect(paragraph.className).toContain('whitespace-pre-wrap');
    });

    it('renders mobile conversations hamburger toggle and allows opening and closing drawer', async () => {
      render(<AISupportPage />);

      await waitFor(() => {
        expect(screen.queryByTestId('chat-messages-skeleton')).toBeNull();
      });

      const toggleButton = screen.getByTestId('mobile-conversations-toggle');
      expect(toggleButton).toBeDefined();
      expect(toggleButton.getAttribute('aria-label')).toBe('Open conversations');

      // Click to open mobile sidebar drawer
      fireEvent.click(toggleButton);

      const backdrop = screen.getByTestId('mobile-sidebar-backdrop');
      expect(backdrop).toBeDefined();

      const closeButton = screen.getByTestId('close-sidebar-button');
      expect(closeButton).toBeDefined();

      // Click close button to close drawer
      fireEvent.click(closeButton);
      expect(screen.queryByTestId('mobile-sidebar-backdrop')).toBeNull();
    });
  });
});
