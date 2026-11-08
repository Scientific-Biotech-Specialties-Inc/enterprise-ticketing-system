import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NotificationItem from './NotificationItem';

describe('NotificationItem Component Tests (Participant Notifications)', () => {
  it('covers AC-5 & AC-7: renders new message notification with title, preview, and message badge', () => {
    const mockNotification = {
      id: 501,
      title: 'New message on Ticket #101: Network printer offline',
      message: 'Maria Santos: The replacement toner has arrived and is being installed.',
      created_at: '2026-10-22T08:30:00Z',
      is_read: false,
      data: JSON.stringify({
        type: 'new_message',
        ticket_id: 101,
        sender_name: 'Maria Santos',
        sender_role: 'Customer Support',
        link: '/employee/messages?selectedTicketId=101',
      }),
    };

    const handleClick = vi.fn();

    render(
      <NotificationItem
        notification={mockNotification}
        onClick={handleClick}
        isLast={false}
      />
    );

    expect(screen.getByText(/New message on Ticket #101/i)).toBeInTheDocument();
    expect(screen.getByText(/Maria Santos: The replacement toner has arrived/i)).toBeInTheDocument();
    expect(screen.getByText('Message')).toBeInTheDocument();
  });

  it('covers AC-7: fires onClick callback with notification payload when clicked', () => {
    const mockNotification = {
      id: 502,
      title: 'New message on Ticket #102',
      message: 'John Doe: Please check the firewall rules.',
      created_at: '2026-10-22T08:45:00Z',
      is_read: false,
      data: {
        type: 'new_message',
        ticket_id: 102,
      },
    };

    const handleClick = vi.fn();

    render(
      <NotificationItem
        notification={mockNotification}
        onClick={handleClick}
        isLast={true}
      />
    );

    const button = screen.getByRole('menuitem');
    expect(button).toHaveAttribute('aria-current', 'true');

    fireEvent.click(button);

    expect(handleClick).toHaveBeenCalledTimes(1);
    expect(handleClick).toHaveBeenCalledWith(mockNotification);
  });

  it('renders read message notification with inactive state and no unread dot', () => {
    const mockNotification = {
      id: 503,
      title: 'New message on Ticket #103',
      message: 'All tests verified.',
      created_at: '2026-10-22T07:00:00Z',
      is_read: true,
      unread: false,
      data: {
        type: 'new_message',
      },
    };

    render(
      <NotificationItem
        notification={mockNotification}
        onClick={vi.fn()}
        isLast={true}
      />
    );

    const button = screen.getByRole('menuitem');
    expect(button).not.toHaveAttribute('aria-current');
  });

  it('renders auto close notification with clock badge and amber styling', () => {
    const mockNotification = {
      id: 504,
      title: 'Ticket Auto-Close Warning',
      message: 'Ticket #99 will close automatically in 24 hours due to inactivity.',
      created_at: '2026-10-22T06:00:00Z',
      is_read: false,
    };

    render(
      <NotificationItem
        notification={mockNotification}
        onClick={vi.fn()}
        isLast={false}
      />
    );

    expect(screen.getByText('Auto-Close')).toBeInTheDocument();
    expect(screen.getByText(/Ticket Auto-Close Warning/i)).toBeInTheDocument();
  });

  it('covers SLA Breach: renders SLA Breach notification with urgent styling and Breached badge', () => {
    const mockNotification = {
      id: 505,
      title: 'SLA Breached: Ticket #105 Resolution Overdue',
      message: 'Ticket #105 (MRI system down) has breached its SLA resolution window by 45 minutes.',
      created_at: '2026-10-22T09:00:00Z',
      is_read: false,
      data: JSON.stringify({
        type: 'sla_breach',
        ticket_id: 105,
        category: 'MRI',
        priority: 'Critical',
        sla_status: 'Breached',
      }),
    };

    render(
      <NotificationItem
        notification={mockNotification}
        onClick={vi.fn()}
        isLast={false}
      />
    );

    expect(screen.getByText('Breached')).toBeInTheDocument();
    expect(screen.getByText(/SLA Breached: Ticket #105/i)).toBeInTheDocument();
    expect(screen.getByText(/has breached its SLA resolution window/i)).toBeInTheDocument();
  });
});
