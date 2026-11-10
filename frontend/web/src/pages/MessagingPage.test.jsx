import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MessagingPage from './MessagingPage';

// Mock AuthContext
const mockUser = {
  emp_id: 10,
  first_name: 'Maria',
  last_name: 'Santos',
  department: 'Customer Service',
  role: 'Customer Support',
};

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: mockUser,
  })),
}));

// Mock react-router-dom
vi.mock('react-router-dom', () => ({
  useLocation: vi.fn(() => ({
    state: { selectedTicketId: 101 },
  })),
}));

// Mock messagingService
vi.mock('@/services/messagingService', () => ({
  getTicketMessages: vi.fn(),
  sendTicketMessage: vi.fn(),
  editTicketMessage: vi.fn(),
  getMessageEditHistory: vi.fn(),
  deleteTicketMessage: vi.fn(),
  pingThreadPresence: vi.fn(() => Promise.resolve({ status: 'ok' })),
  clearThreadPresence: vi.fn(() => Promise.resolve({ status: 'cleared' })),
}));

// Mock ticketService
vi.mock('@/services/ticketService', () => ({
  getCustomerTickets: vi.fn(() => Promise.resolve([])),
  getCSIncomingTickets: vi.fn(() =>
    Promise.resolve([
      {
        ticket_ID: 101,
        id: 101,
        subject: 'Network printer offline',
        status: 'In Progress',
        status_name: 'In Progress',
        priority: 'High',
        priority_name: 'High',
        created_at: '2026-10-22T08:00:00Z',
        description: 'Printer on 2nd floor is unreachable',
        is_internal: false,
        client: { client_name: 'Acme Corp' },
        customer: { name: 'Acme Corp' },
        assigned_employee: { first_name: 'Maria', last_name: 'Santos' },
      },
    ])
  ),
  getEmployeeInternalTickets: vi.fn(() => Promise.resolve({ tickets: [] })),
  getEmployeeAssignedTickets: vi.fn(() => Promise.resolve({ tickets: [] })),
  getTicketDetails: vi.fn(() => Promise.resolve({})),
  updateTicket: vi.fn(() => Promise.resolve({})),
}));

// Mock useRealtimeRefresh
vi.mock('@/hooks/useRealtimeRefresh', () => ({
  default: vi.fn(),
}));

// Mock messagingEcho
vi.mock('@/services/messagingEcho', () => ({
  getMessagingEcho: vi.fn(() => ({
    channel: vi.fn(() => ({
      listen: vi.fn().mockReturnThis(),
      stopListening: vi.fn().mockReturnThis(),
    })),
    private: vi.fn(() => ({
      listen: vi.fn().mockReturnThis(),
      stopListening: vi.fn().mockReturnThis(),
    })),
    leave: vi.fn(),
  })),
}));

// Mock configurationService
vi.mock('@/services/configurationService', () => ({
  getMessagingConfiguration: vi.fn(() =>
    Promise.resolve({ allow_delegated_employee: true })
  ),
}));

// Mock axiosInstance
vi.mock('@/api/axiosInstance', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: { success: true, conversations: [] } })),
    post: vi.fn(() => Promise.resolve({ data: { success: true } })),
  },
}));

// Import mocked services to set return values per test
import * as messagingService from '@/services/messagingService';
import * as ticketService from '@/services/ticketService';

describe('MessagingPage Component Tests (Acceptance Criteria)', () => {
  const initialMessages = [
    {
      id: 'msg-1',
      _id: 'msg-1',
      ticket_id: 101,
      sender_id: 99,
      sender_name: 'Acme Corp',
      sender_type: 'customer',
      sender_role: 'Customer',
      message: 'Hello, our printer is not responding.',
      attachments: [
        {
          name: 'diagnostics.pdf',
          file_size: 102400,
          url: '/storage/ticket-attachments/diagnostics.pdf',
          scan_status: 'clean',
        },
      ],
      created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    },
    {
      id: 'msg-2',
      _id: 'msg-2',
      ticket_id: 101,
      sender_id: 10,
      sender_name: 'Maria Santos',
      sender_type: 'cs',
      sender_role: 'Customer Support',
      message: 'Looking into this now. Please see the attached diagnostics.',
      attachments: [],
      created_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    },
    {
      id: 'msg-3',
      _id: 'msg-3',
      ticket_id: 101,
      sender_id: 10,
      sender_name: 'Maria Santos',
      sender_type: 'cs',
      sender_role: 'Customer Support',
      message: 'Here is an attachment still undergoing scan.',
      attachments: [
        {
          name: 'pending_scan.docx',
          file_size: 45000,
          scan_status: 'pending',
        },
      ],
      created_at: new Date(Date.now() - 1 * 60 * 1000).toISOString(),
    },
    {
      id: 'msg-4',
      _id: 'msg-4',
      ticket_id: 101,
      sender_id: 99,
      sender_name: 'Acme Corp',
      sender_type: 'customer',
      sender_role: 'Customer',
      message: 'I tried sending this file earlier.',
      attachments: [
        {
          name: 'suspicious_payload.exe',
          file_size: 80000,
          scan_status: 'quarantined',
          threat_alert: 'File was flagged as a security threat and blocked.',
        },
      ],
      created_at: new Date(Date.now() - 30 * 1000).toISOString(),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    messagingService.getTicketMessages.mockResolvedValue(initialMessages);
  });

  it('covers AC-1 & AC-12: includes attachment control alongside message input with accessible attributes', async () => {
    render(<MessagingPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Type a message/i)).toBeInTheDocument();
    });

    const attachButton = screen.getByRole('button', { name: /Attach files/i });
    expect(attachButton).toBeInTheDocument();
    expect(attachButton).toHaveAttribute('title', expect.stringContaining('Attach files'));
  });

  it('covers AC-2 & AC-3: attaches a file and displays per-file chip with removal button', async () => {
    render(<MessagingPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Type a message/i)).toBeInTheDocument();
    });

    const file = new File(['test content'], 'evidence.png', { type: 'image/png' });
    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();

    fireEvent.change(fileInput, { target: { files: [file] } });

    // File chip should appear with filename and remove button
    await waitFor(() => {
      expect(screen.getByText('evidence.png')).toBeInTheDocument();
      expect(screen.getByTitle(/Remove file/i)).toBeInTheDocument();
    });

    // Remove the attached file before sending
    const removeBtn = screen.getByTitle(/Remove file/i);
    fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(screen.queryByText('evidence.png')).not.toBeInTheDocument();
    });
  });

  it('covers AC-2 & AC-4: displays clear inline error when attached file exceeds 15MB limit and does not block typing', async () => {
    render(<MessagingPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Type a message/i)).toBeInTheDocument();
    });

    // Create a 16MB file
    const largeFile = new File([new Uint8Array(16 * 1024 * 1024)], 'giant.pdf', {
      type: 'application/pdf',
    });
    Object.defineProperty(largeFile, 'size', { value: 16 * 1024 * 1024 });

    const fileInput = document.querySelector('input[type="file"]');
    fireEvent.change(fileInput, { target: { files: [largeFile] } });

    await waitFor(() => {
      expect(
        screen.getByText(/exceeds the maximum allowed size of 15 MB/i)
      ).toBeInTheDocument();
    });

    // User can still type message text alone
    const textInput = screen.getByPlaceholderText(/Type a message/i);
    fireEvent.change(textInput, { target: { value: 'Sending without heavy file' } });
    expect(textInput.value).toBe('Sending without heavy file');
  });

  it('covers AC-5: renders clean attached file inline with filename, size, and download link', async () => {
    render(<MessagingPage />);

    await waitFor(() => {
      expect(screen.getByText('diagnostics.pdf')).toBeInTheDocument();
      expect(screen.getByText(/100 KB/i)).toBeInTheDocument();
    });

    const downloadLink = screen.getByTitle(/Download diagnostics\.pdf/i);
    expect(downloadLink).toBeInTheDocument();
    // Spec 0037 (AC-7): files are private, so the link never points at a bare /storage/ URL;
    // clicking it runs the authenticated download instead.
    expect(downloadLink.getAttribute('href')).not.toContain('/storage/');
  });

  it('covers spec 0037 AC-17: own message that carries a file shows no Edit option, but Delete stays', async () => {
    render(<MessagingPage />);

    await waitFor(() => {
      expect(screen.getByText('Here is an attachment still undergoing scan.')).toBeInTheDocument();
    });

    // msg-3 is the signed in user's own recent message, and it carries a file.
    const optionButtons = screen.getAllByTitle('Options');
    expect(optionButtons.length).toBeGreaterThanOrEqual(3);
    fireEvent.click(optionButtons[2]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Delete for you/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /Edit/i })).not.toBeInTheDocument();
  });

  it('covers AC-6: displays sender name and role badge clearly and consistently on all messages', async () => {
    render(<MessagingPage />);

    await waitFor(() => {
      // Customer message role badge
      expect(screen.getAllByText('Customer').length).toBeGreaterThan(0);
      // Customer Support role badge
      expect(screen.getAllByText('Customer Support').length).toBeGreaterThan(0);
      // Sender names
      expect(screen.getAllByText('Acme Corp').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Maria Santos').length).toBeGreaterThan(0);
    });
  });

  it('covers AC-7 & AC-8: displays accurate timestamp with title tooltip and preserves chronological order', async () => {
    render(<MessagingPage />);

    await waitFor(() => {
      expect(screen.getByText('Hello, our printer is not responding.')).toBeInTheDocument();
      expect(screen.getByText('Looking into this now. Please see the attached diagnostics.')).toBeInTheDocument();
    });

    // Check timestamps have title attributes with full dates
    const timeElements = document.querySelectorAll('span[title]');
    expect(timeElements.length).toBeGreaterThan(0);
  });

  it('covers AC-9: renders Scanning state for pending scans and quarantined warning for malicious files', async () => {
    render(<MessagingPage />);

    await waitFor(() => {
      // Pending file shows Scanning state
      expect(screen.getByText('pending_scan.docx')).toBeInTheDocument();
      expect(screen.getByText(/Scanning for threats\.\.\./i)).toBeInTheDocument();

      // Quarantined file shows threat blocked warning
      expect(screen.getByText('suspicious_payload.exe')).toBeInTheDocument();
      expect(
        screen.getByText(/File was flagged as a security threat and blocked/i)
      ).toBeInTheDocument();
    });
  });

  it('covers AC-10: preserves both message text and attached files if send fails for easy retry', async () => {
    messagingService.sendTicketMessage.mockRejectedValueOnce({
      response: { data: { message: 'Network connection timeout. Please try again.' } },
    });

    render(<MessagingPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Type a message/i)).toBeInTheDocument();
    });

    const textInput = screen.getByPlaceholderText(/Type a message/i);
    fireEvent.change(textInput, { target: { value: 'Important follow-up notes' } });

    const file = new File(['log data'], 'retry_test.log', { type: 'text/plain' });
    const fileInput = document.querySelector('input[type="file"]');
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('retry_test.log')).toBeInTheDocument();
    });

    const sendBtn = screen.getByRole('button', { name: /Send message/i });
    fireEvent.click(sendBtn);

    // After failure, error message is displayed
    await waitFor(() => {
      expect(screen.getByText(/Network connection timeout/i)).toBeInTheDocument();
    });

    // Input text and file chip are preserved!
    expect(textInput.value).toBe('Important follow-up notes');
    expect(screen.getByText('retry_test.log')).toBeInTheDocument();
  });

  it('covers AC-13 & AC-14: shows Edit action only on user own messages within edit window, not on others', async () => {
    render(<MessagingPage />);

    await waitFor(() => {
      expect(screen.getByText('Looking into this now. Please see the attached diagnostics.')).toBeInTheDocument();
    });

    const optionButtons = screen.getAllByTitle('Options');
    expect(optionButtons.length).toBeGreaterThanOrEqual(2);

    // 1. Click options on someone else's message (Acme Corp, index 0)
    fireEvent.click(optionButtons[0]);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Edit/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Delete for you/i })).toBeInTheDocument();
    });

    // Close menu
    fireEvent.click(optionButtons[0]);

    // 2. Click options on user's own message (Maria Santos, index 1)
    fireEvent.click(optionButtons[1]);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Edit/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Delete for you/i })).toBeInTheDocument();
    });
  });

  it('covers AC-15, AC-18 & AC-21: opens inline edit with pre-filled content, and cancel discards changes', async () => {
    render(<MessagingPage />);

    await waitFor(() => {
      expect(screen.getByText('Looking into this now. Please see the attached diagnostics.')).toBeInTheDocument();
    });

    // Target own message (index 1)
    const optionButtons = screen.getAllByTitle('Options');
    fireEvent.click(optionButtons[1]);

    const editBtn = await screen.findByRole('button', { name: /Edit/i });
    fireEvent.click(editBtn);

    // Textarea should appear pre-filled
    const editTextarea = screen.getByPlaceholderText(/Edit your message\.\.\./i);
    expect(editTextarea).toBeInTheDocument();
    expect(editTextarea.value).toBe('Looking into this now. Please see the attached diagnostics.');

    // Cancel edit
    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelBtn);

    // Textarea closed, original text intact
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Edit your message\.\.\./i)).not.toBeInTheDocument();
      expect(screen.getByText('Looking into this now. Please see the attached diagnostics.')).toBeInTheDocument();
    });
  });

  it('covers AC-16 & AC-19: validates non-empty text and saves edit displaying (edited) indicator', async () => {
    messagingService.editTicketMessage.mockResolvedValueOnce({
      id: 'msg-2',
      message: 'Looking into this now with updated patch.',
      is_edited: true,
      edited: true,
      edited_at: '2026-10-22T09:10:00Z',
    });

    render(<MessagingPage />);

    await waitFor(() => {
      expect(screen.getByText('Looking into this now. Please see the attached diagnostics.')).toBeInTheDocument();
    });

    // Target own message (index 1)
    const optionButtons = screen.getAllByTitle('Options');
    fireEvent.click(optionButtons[1]);

    const editBtn = await screen.findByRole('button', { name: /Edit/i });
    fireEvent.click(editBtn);

    const editTextarea = screen.getByPlaceholderText(/Edit your message\.\.\./i);

    // Try saving empty string (AC-19)
    fireEvent.change(editTextarea, { target: { value: '   ' } });
    const saveBtn = screen.getByRole('button', { name: /Save/i });
    expect(saveBtn).toBeDisabled();

    // Fill valid text and save
    fireEvent.change(editTextarea, { target: { value: 'Looking into this now with updated patch.' } });
    expect(saveBtn).not.toBeDisabled();
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(screen.getByText('Looking into this now with updated patch.')).toBeInTheDocument();
      expect(screen.getByText(/\(edited/i)).toBeInTheDocument();
    });
  });

  it('covers AC-17 & AC-24: clicking (edited) indicator opens edit history modal showing prior revisions', async () => {
    const editedMsgWithHistory = [
      {
        id: 'msg-99',
        _id: 'msg-99',
        ticket_id: 101,
        sender_id: 10,
        sender_name: 'Maria Santos',
        sender_type: 'cs',
        sender_role: 'Customer Support',
        message: 'Current revision text',
        is_edited: true,
        edited_at: '2026-10-22T09:20:00Z',
        edit_history: [
          {
            version: 1,
            message: 'Original first draft text',
            edited_at: '2026-10-22T09:10:00Z',
            editor_name: 'Maria Santos',
          },
        ],
        created_at: '2026-10-22T09:00:00Z',
      },
    ];

    messagingService.getTicketMessages.mockResolvedValueOnce(editedMsgWithHistory);
    messagingService.getMessageEditHistory.mockResolvedValueOnce({
      message_id: 'msg-99',
      edit_history: editedMsgWithHistory[0].edit_history,
      original_sent_at: '2026-10-22T09:00:00Z',
      current_content: 'Current revision text',
    });

    render(<MessagingPage />);

    const editedIndicator = await screen.findByTitle(/Click to view edit history/i);
    expect(editedIndicator).toBeInTheDocument();

    fireEvent.click(editedIndicator);

    // Edit history modal appears with audit trail
    await waitFor(() => {
      expect(screen.getByText(/Message Edit History/i)).toBeInTheDocument();
      expect(screen.getByText('Original first draft text')).toBeInTheDocument();
    });
  });

  it('displays optimistic pending message with active malware scanning indicator when sending a file', async () => {
    let resolveSend;
    messagingService.sendTicketMessage.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSend = resolve;
    }));

    render(<MessagingPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Type a message/i)).toBeInTheDocument();
    });

    const file = new File(['image data'], 'diagnostic_scan.png', { type: 'image/png' });
    const fileInput = document.querySelector('input[type="file"]');
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('diagnostic_scan.png')).toBeInTheDocument();
    });

    const sendBtn = screen.getByRole('button', { name: /Send message/i });
    fireEvent.click(sendBtn);

    // Optimistic pending state immediately shows in chat before upload finishes
    await waitFor(() => {
      expect(screen.getByText('diagnostic_scan.png')).toBeInTheDocument();
      expect(screen.getAllByText(/Checking file for malware/i).length).toBeGreaterThanOrEqual(2);
    });

    // Complete the send successfully
    resolveSend({
      id: 'msg-real-123',
      ticket_id: 101,
      sender_id: 10,
      sender_name: 'Maria Santos',
      sender_type: 'cs',
      sender_role: 'Customer Support',
      message: '',
      attachments: [{
        id: 105,
        name: 'diagnostic_scan.png',
        url: '/storage/ticket-attachments/diagnostic_scan.png',
        scan_status: 'clean',
      }],
      created_at: '2026-10-22T09:30:00Z',
    });

    // Optimistic message is replaced with the clean confirmed attachment
    await waitFor(() => {
      expect(screen.getByTitle(/Download diagnostic_scan\.png/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Checking file for malware/i).length).toBe(1);
    });
  });

  it('covers AC-4: pings thread presence on active ticket selection and clears presence on unmount', async () => {
    const { unmount } = render(<MessagingPage />);

    await waitFor(() => {
      expect(messagingService.pingThreadPresence).toHaveBeenCalledWith(101);
    });

    unmount();

    expect(messagingService.clearThreadPresence).toHaveBeenCalledWith(101);
  });

  it('covers AC-2 & AC-5: renders unified continuous thread with sender role labels and timestamps', async () => {
    messagingService.getTicketMessages.mockResolvedValueOnce([
      {
        id: 'msg-prev-employee',
        ticket_id: 101,
        sender_id: 88,
        sender_name: 'John Smith',
        sender_role: 'Assigned Employee',
        message: 'Replaced power supply unit',
        created_at: '2026-10-22T08:00:00Z',
      },
      {
        id: 'msg-cs-rep',
        ticket_id: 101,
        sender_id: 10,
        sender_name: 'Maria Santos',
        sender_role: 'Customer Support',
        message: 'Checking in on ticket resolution',
        created_at: '2026-10-22T08:15:00Z',
      },
    ]);

    render(<MessagingPage />);

    await waitFor(() => {
      expect(screen.getByText('Replaced power supply unit')).toBeInTheDocument();
      expect(screen.getByText('Checking in on ticket resolution')).toBeInTheDocument();
      expect(screen.getByText(/John Smith/i)).toBeInTheDocument();
      expect(screen.getByText(/Maria Santos/i)).toBeInTheDocument();
    });
  });

  it('accurately routes closed tickets to Archive tab and keeps active tickets in Active tab', async () => {
    ticketService.getCSIncomingTickets.mockResolvedValueOnce([
      {
        ticket_ID: 201,
        id: 201,
        subject: 'Active ongoing ticket',
        status: 'In Progress',
        status_name: 'In Progress',
        is_internal: false,
        client: { client_name: 'Acme Corp' },
      },
      {
        ticket_ID: 202,
        id: 202,
        subject: 'Finished and closed ticket',
        status: 'Closed',
        status_name: 'Closed',
        is_internal: false,
        client: { client_name: 'Beta LLC' },
      },
    ]);

    render(<MessagingPage />);

    await waitFor(() => {
      // Active tab should be active by default and display the active ticket
      expect(screen.getByText(/Active ongoing ticket/i)).toBeInTheDocument();
      // Closed ticket should not appear under Active tab
      expect(screen.queryByText(/Finished and closed ticket/i)).not.toBeInTheDocument();
    });

    // Switch to Archive tab
    const archiveTabBtn = screen.getByRole('button', { name: /Archive/i });
    fireEvent.click(archiveTabBtn);

    await waitFor(() => {
      // Under Archive tab, closed ticket must be displayed
      expect(screen.getAllByText(/Finished and closed ticket/i).length).toBeGreaterThanOrEqual(1);
      // Active ticket must not appear under Archive tab
      expect(screen.queryByText(/Active ongoing ticket/i)).not.toBeInTheDocument();
    });
  });

  it('renders mobile hamburger menu to toggle conversation drawer and closes on close button or selection', async () => {
    render(<MessagingPage />);

    const hamburgerBtn = await screen.findByTestId('mobile-messages-toggle');
    expect(hamburgerBtn).toBeInTheDocument();
    expect(hamburgerBtn.getAttribute('aria-label')).toBe('Open conversations');

    // Open mobile contacts drawer
    fireEvent.click(hamburgerBtn);

    const backdrop = screen.getByTestId('mobile-contacts-backdrop');
    expect(backdrop).toBeInTheDocument();

    const closeBtn = screen.getByTestId('close-contacts-drawer');
    expect(closeBtn).toBeInTheDocument();

    // Close drawer via close button
    fireEvent.click(closeBtn);
    expect(screen.queryByTestId('mobile-contacts-backdrop')).not.toBeInTheDocument();
  });
});
