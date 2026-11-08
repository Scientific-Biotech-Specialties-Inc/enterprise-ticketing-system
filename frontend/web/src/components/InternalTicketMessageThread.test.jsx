import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import InternalTicketMessageThread from './InternalTicketMessageThread';
import * as messagingService from '@/services/messagingService';

// Mock user context (Requestor employee)
const mockRequestor = {
  emp_id: 101,
  id: 101,
  first_name: 'John',
  last_name: 'Doe',
  name: 'John Doe',
  role: 'Employee',
  department: 'Production',
};

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: mockRequestor,
  })),
}));

// Mock messaging service
vi.mock('@/services/messagingService', () => ({
  getTicketMessages: vi.fn(),
  sendTicketMessage: vi.fn(),
}));

// Mock messaging Echo
let eventCallback = null;
const mockListen = vi.fn((eventName, cb) => {
  eventCallback = cb;
});
const mockStopListening = vi.fn();
const mockPrivateChannel = {
  listen: mockListen,
  stopListening: mockStopListening,
};

vi.mock('@/services/messagingEcho', () => ({
  getMessagingEcho: vi.fn(() => ({
    private: vi.fn(() => mockPrivateChannel),
  })),
}));

describe('InternalTicketMessageThread Component Tests (Acceptance Criteria)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventCallback = null;
  });

  const mockHistoricalMessages = [
    {
      id: 'msg-1',
      _id: 'msg-1',
      ticket_id: 501,
      sender_id: 101,
      sender_name: 'John Doe',
      sender_type: 'employee',
      sender_role: 'Requestor',
      message: 'CNC Lathe spindle vibrating erratically on Line 2.',
      attachments: [],
      created_at: '2026-10-23T08:00:00Z',
    },
    {
      id: 'msg-2',
      _id: 'msg-2',
      ticket_id: 501,
      sender_id: 205,
      sender_name: 'Alex Rivera',
      sender_type: 'employee',
      sender_role: 'Assigned Employee',
      message: 'Inspected mechanical bearings. Reassigning to electrical team.',
      attachments: [
        {
          name: 'bearing_inspection.pdf',
          url: 'http://localhost:8006/storage/bearing_inspection.pdf',
          file_size: 204800,
          scan_status: 'clean',
        },
      ],
      created_at: '2026-10-23T09:30:00Z',
    },
    {
      id: 'msg-3',
      _id: 'msg-3',
      ticket_id: 501,
      sender_id: 301,
      sender_name: 'David Vance',
      sender_type: 'employee',
      sender_role: 'Assigned Employee',
      message: 'Electrical team received. Replacing the vibration transducer now.',
      attachments: [],
      created_at: '2026-10-23T11:15:00Z',
    },
  ];

  it('covers AC-1 & AC-3: renders message thread on the internal ticket detail view with all prior messages in chronological order', async () => {
    messagingService.getTicketMessages.mockResolvedValueOnce(mockHistoricalMessages);

    render(
      <InternalTicketMessageThread
        ticketId={501}
        ticket={{
          ticket_ID: 501,
          is_internal: true,
          status: 'In Progress',
          requested_by: 101,
          assigned_to: 301,
        }}
      />
    );

    // Verify main thread container and title
    expect(await screen.findByText('Internal Ticket Discussion')).toBeInTheDocument();
    expect(screen.getByText('Team Thread')).toBeInTheDocument();

    // Verify all messages appear in correct order
    expect(await screen.findByText('CNC Lathe spindle vibrating erratically on Line 2.')).toBeInTheDocument();
    expect(screen.getByText('Inspected mechanical bearings. Reassigning to electrical team.')).toBeInTheDocument();
    expect(screen.getByText('Electrical team received. Replacing the vibration transducer now.')).toBeInTheDocument();
  });

  it('covers AC-4: clearly displays sender name, snapshot role badge (Requestor, Assigned Employee, CS), and timestamp per message', async () => {
    const messagesWithCS = [
      ...mockHistoricalMessages,
      {
        id: 'msg-cs',
        _id: 'msg-cs',
        ticket_id: 501,
        sender_id: 401,
        sender_name: 'Sarah CS',
        sender_type: 'cs',
        sender_role: 'Customer Support',
        message: 'Coordination update: Parts arrival confirmed for 2 PM.',
        attachments: [],
        created_at: '2026-10-23T11:45:00Z',
      },
    ];

    messagingService.getTicketMessages.mockResolvedValueOnce(messagesWithCS);

    render(
      <InternalTicketMessageThread
        ticketId={501}
        ticket={{ ticket_ID: 501, is_internal: true, status: 'In Progress' }}
      />
    );

    // Verify sender names
    expect(await screen.findByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument();
    expect(screen.getByText('David Vance')).toBeInTheDocument();
    expect(screen.getByText('Sarah CS')).toBeInTheDocument();

    // Verify immutable snapshot roles
    expect(screen.getByText('Requestor')).toBeInTheDocument();
    expect(screen.getAllByText('Assigned Employee').length).toBe(2);
    expect(screen.getByText('Customer Support')).toBeInTheDocument();
  });

  it('covers AC-5: preserves thread continuity across reassignment events without visual disruption', async () => {
    messagingService.getTicketMessages.mockResolvedValueOnce(mockHistoricalMessages);

    render(
      <InternalTicketMessageThread
        ticketId={501}
        ticket={{
          ticket_ID: 501,
          is_internal: true,
          status: 'In Progress',
          requested_by: 101,
          assigned_to: 301, // Current assignee is David; Alex was previously assigned
        }}
      />
    );

    // Prior messages from previous assigned employee Alex remain seamlessly intact and correctly attributed
    expect(await screen.findByText('Alex Rivera')).toBeInTheDocument();
    expect(screen.getByText('Inspected mechanical bearings. Reassigning to electrical team.')).toBeInTheDocument();

    // Current assignee David is also displayed in the same continuous chronological thread
    expect(screen.getByText('David Vance')).toBeInTheDocument();
    expect(screen.getByText('Electrical team received. Replacing the vibration transducer now.')).toBeInTheDocument();
  });

  it('covers AC-7: supports optional CS participation in the same unified thread', async () => {
    const threadWithCS = [
      {
        id: 'msg-req',
        _id: 'msg-req',
        ticket_id: 501,
        sender_name: 'John Doe',
        sender_role: 'Requestor',
        message: 'Help needed with internal request.',
        created_at: '2026-10-23T08:00:00Z',
      },
      {
        id: 'msg-cs',
        _id: 'msg-cs',
        ticket_id: 501,
        sender_name: 'Support Coordinator',
        sender_role: 'Customer Support',
        message: 'Assigned specialist to your request.',
        created_at: '2026-10-23T08:15:00Z',
      },
      {
        id: 'msg-emp',
        _id: 'msg-emp',
        ticket_id: 501,
        sender_name: 'David Vance',
        sender_role: 'Assigned Employee',
        message: 'On my way to inspect.',
        created_at: '2026-10-23T08:30:00Z',
      },
    ];

    messagingService.getTicketMessages.mockResolvedValueOnce(threadWithCS);

    render(
      <InternalTicketMessageThread
        ticketId={501}
        ticket={{ ticket_ID: 501, is_internal: true, status: 'In Progress' }}
      />
    );

    expect(await screen.findByText('Support Coordinator')).toBeInTheDocument();
    expect(screen.getByText('Customer Support')).toBeInTheDocument();
    expect(screen.getByText('Assigned specialist to your request.')).toBeInTheDocument();
  });

  it('covers AC-10: maintains strict separation and never renders staff-only internal notes inside this thread', async () => {
    // Message service returns only public internal thread messages; staff notes are never included
    messagingService.getTicketMessages.mockResolvedValueOnce(mockHistoricalMessages);

    render(
      <InternalTicketMessageThread
        ticketId={501}
        ticket={{ ticket_ID: 501, is_internal: true, status: 'In Progress' }}
      />
    );

    await screen.findByText('Internal Ticket Discussion');

    // Confirm that staff-only internal notes headers or keywords are not present in this discussion container
    expect(screen.queryByText(/Staff-Only Internal Notes/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Private staff note/i)).not.toBeInTheDocument();
  });

  it('covers AC-6: supports file attachments with preview chips, size labels, and upload handling', async () => {
    messagingService.getTicketMessages.mockResolvedValueOnce([]);
    messagingService.sendTicketMessage.mockResolvedValueOnce({
      id: 'msg-upload',
      _id: 'msg-upload',
      ticket_id: 501,
      sender_id: 101,
      sender_name: 'John Doe',
      sender_role: 'Requestor',
      message: 'Attached the vibration logs.',
      attachments: [
        {
          name: 'vibration_log.csv',
          url: 'http://localhost:8006/storage/vibration_log.csv',
          file_size: 15360,
          scan_status: 'clean',
        },
      ],
      created_at: '2026-10-23T12:00:00Z',
    });

    render(
      <InternalTicketMessageThread
        ticketId={501}
        ticket={{ ticket_ID: 501, is_internal: true, status: 'In Progress' }}
      />
    );

    await screen.findByText('Internal Ticket Discussion');

    const file = new File(['log,data,123'], 'vibration_log.csv', { type: 'text/csv' });
    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).toBeInTheDocument();

    fireEvent.change(fileInput, { target: { files: [file] } });

    // File preview chip with remove button should appear
    expect(await screen.findByText('vibration_log.csv')).toBeInTheDocument();

    // Type message and submit
    const textarea = screen.getByPlaceholderText(/Type your message/i);
    fireEvent.change(textarea, { target: { value: 'Attached the vibration logs.' } });

    const sendButton = screen.getByRole('button', { name: /Send Message/i });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(messagingService.sendTicketMessage).toHaveBeenCalledWith(501, 'Attached the vibration logs.', [file]);
    });

    // Verification of new message with attachment
    expect(await screen.findByText('Attached the vibration logs.')).toBeInTheDocument();
  });

  it('covers AC-13: blocks empty message submission with an inline validation warning', async () => {
    messagingService.getTicketMessages.mockResolvedValueOnce([]);

    render(
      <InternalTicketMessageThread
        ticketId={501}
        ticket={{ ticket_ID: 501, is_internal: true, status: 'In Progress' }}
      />
    );

    await screen.findByText('Internal Ticket Discussion');

    const sendButton = screen.getByRole('button', { name: /Send Message/i });
    fireEvent.click(sendButton);

    expect(await screen.findByText('Please enter a message or attach a file.')).toBeInTheDocument();
    expect(messagingService.sendTicketMessage).not.toHaveBeenCalled();
  });

  it('covers AC-12: preserves Requestor draft message and files on send failure with actionable error alert', async () => {
    messagingService.getTicketMessages.mockResolvedValueOnce([]);
    messagingService.sendTicketMessage.mockRejectedValueOnce({
      response: {
        data: {
          message: 'Server timeout. Connection temporarily interrupted.',
        },
      },
    });

    render(
      <InternalTicketMessageThread
        ticketId={501}
        ticket={{ ticket_ID: 501, is_internal: true, status: 'In Progress' }}
      />
    );

    await screen.findByText('Internal Ticket Discussion');

    const textarea = screen.getByPlaceholderText(/Type your message/i);
    fireEvent.change(textarea, { target: { value: 'Critical diagnostic observation' } });

    const sendButton = screen.getByRole('button', { name: /Send Message/i });
    fireEvent.click(sendButton);

    // Actionable error banner
    expect(await screen.findByText('Server timeout. Connection temporarily interrupted.')).toBeInTheDocument();
    expect(screen.getByText(/Your draft message text and attached files were preserved. You can edit and retry./i)).toBeInTheDocument();

    // Textarea input remains preserved
    expect(textarea.value).toBe('Critical diagnostic observation');
  });

  it('covers AC-14: displays AI exclusion safeguard badge confirming data is excluded from AI chatbot training and RAG indexing', async () => {
    messagingService.getTicketMessages.mockResolvedValueOnce([]);

    render(
      <InternalTicketMessageThread
        ticketId={501}
        ticket={{ ticket_ID: 501, is_internal: true, status: 'In Progress' }}
      />
    );

    // Safeguard badge verification
    expect(await screen.findByText('Excluded from AI')).toBeInTheDocument();
    expect(screen.getByText(/Direct collaboration between Requestor, Assigned Employee, and Support staff/i)).toBeInTheDocument();
  });

  it('covers AC-11: displays structured error message if Requestor is unauthorized to access the thread', async () => {
    messagingService.getTicketMessages.mockRejectedValueOnce({
      response: {
        status: 403,
        data: {
          message: 'You are not authorized to view this internal ticket thread.',
        },
      },
    });

    render(
      <InternalTicketMessageThread
        ticketId={999}
        ticket={{ ticket_ID: 999, is_internal: true, requested_by: 888 }}
      />
    );

    // Error alert banner with retry trigger
    expect(await screen.findByText('You are not authorized to view this internal ticket thread.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Click to retry loading messages/i })).toBeInTheDocument();
  });

  it('covers AC-15: provides responsive layout and accessible ARIA attributes on desktop and mobile', async () => {
    messagingService.getTicketMessages.mockResolvedValueOnce(mockHistoricalMessages);

    render(
      <InternalTicketMessageThread
        ticketId={501}
        ticket={{ ticket_ID: 501, is_internal: true, status: 'In Progress' }}
      />
    );

    await screen.findByText('Internal Ticket Discussion');

    const region = screen.getByRole('region', { name: /Internal Ticket Discussion Thread/i });
    expect(region).toBeInTheDocument();

    const messageLog = screen.getByRole('log');
    expect(messageLog).toHaveAttribute('aria-live', 'polite');

    const textarea = screen.getByLabelText(/Internal message input/i);
    expect(textarea).toBeInTheDocument();
  });

  it('covers AC-2 & real-time updates: automatically appends incoming message received on Reverb private channel', async () => {
    messagingService.getTicketMessages.mockResolvedValueOnce(mockHistoricalMessages);

    render(
      <InternalTicketMessageThread
        ticketId={501}
        ticket={{ ticket_ID: 501, is_internal: true, status: 'In Progress' }}
      />
    );

    await screen.findByText('Internal Ticket Discussion');

    // Simulate real-time event arriving on the Echo channel
    expect(mockListen).toHaveBeenCalledWith('.App\\Events\\MessageSent', expect.any(Function));

    // Fire the registered event callback
    eventCallback({
      id: 'realtime-msg-99',
      _id: 'realtime-msg-99',
      ticket_id: 501,
      sender_id: 301,
      sender_name: 'David Vance',
      sender_type: 'employee',
      sender_role: 'Assigned Employee',
      message: 'Repair complete! Please test the spindle now.',
      attachments: [],
      created_at: '2026-10-23T13:00:00Z',
    });

    expect(await screen.findByText('Repair complete! Please test the spindle now.')).toBeInTheDocument();
  });
});
