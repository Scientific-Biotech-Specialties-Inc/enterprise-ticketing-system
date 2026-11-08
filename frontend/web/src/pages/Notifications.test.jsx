import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Notifications from './Notifications';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, role: 'customer' },
  })),
}));

vi.mock('@/hooks/useRealtimeRefresh', () => ({
  default: vi.fn(),
}));

vi.mock('@/services/ticketService', () => ({
  getNotifications: vi.fn(),
  markNotificationsRead: vi.fn(() => Promise.resolve()),
  markNotificationRead: vi.fn(() => Promise.resolve()),
  getTicketDetails: vi.fn(() => Promise.resolve({})),
  getAssignableEmployees: vi.fn(() => Promise.resolve([])),
  respondReassignment: vi.fn(() => Promise.resolve()),
}));

import * as ticketService from '@/services/ticketService';

describe('Notifications Page Component Tests (Message Notifications)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('covers AC-5 & AC-7: renders list of notifications including new message notifications', async () => {
    ticketService.getNotifications.mockResolvedValue({
      notifications: [
        {
          id: 601,
          ticket_id: 101,
          title: 'New message on Ticket #101: Network issue',
          message: 'Maria Santos: We are reviewing the logs.',
          is_read: false,
          created_at: '2026-10-22T08:00:00Z',
          data: JSON.stringify({
            type: 'new_message',
            ticket_id: 101,
            sender_name: 'Maria Santos',
            link: '/messages?selectedTicketId=101',
          }),
        },
      ],
    });

    render(<Notifications />);

    await waitFor(() => {
      expect(screen.getByText(/New message on Ticket #101/i)).toBeInTheDocument();
      expect(screen.getByText(/Maria Santos: We are reviewing the logs/i)).toBeInTheDocument();
      expect(screen.getByText('New Message')).toBeInTheDocument();
    });
  });

  it('covers AC-7: clicking new message notification navigates to ticket conversation with state', async () => {
    ticketService.getNotifications.mockResolvedValue({
      notifications: [
        {
          id: 602,
          ticket_id: 102,
          title: 'New message on Ticket #102: VPN Access',
          message: 'Tech support replied to your request',
          is_read: false,
          created_at: '2026-10-22T08:15:00Z',
          data: JSON.stringify({
            type: 'new_message',
            ticket_id: 102,
            link: '/messages?selectedTicketId=102',
          }),
        },
      ],
    });

    render(<Notifications />);

    await waitFor(() => {
      expect(screen.getByText(/New message on Ticket #102/i)).toBeInTheDocument();
    });

    const card = screen.getByText(/New message on Ticket #102/i).closest('.cursor-pointer');
    expect(card).toBeInTheDocument();
    fireEvent.click(card);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/messages', {
        state: { selectedTicketId: 102 },
      });
    });
  });

  it('covers SLA Breach: renders SLA Breach notification with Breached badge and link to ticket', async () => {
    ticketService.getNotifications.mockResolvedValue({
      notifications: [
        {
          id: 603,
          ticket_id: 103,
          title: 'SLA Breached: Ticket #103 Overdue',
          message: 'Ticket #103 has breached resolution target by 2 hours.',
          is_read: false,
          created_at: '2026-10-22T09:30:00Z',
          data: JSON.stringify({
            type: 'sla_breach',
            ticket_id: 103,
            sla_status: 'Breached',
          }),
        },
      ],
    });

    render(<Notifications />);

    await waitFor(() => {
      expect(screen.getByText(/SLA Breached: Ticket #103 Overdue/i)).toBeInTheDocument();
      expect(screen.getByText('SLA Breached')).toBeInTheDocument();
      expect(screen.getByText(/View Breached Ticket/i)).toBeInTheDocument();
    });
  });
});
