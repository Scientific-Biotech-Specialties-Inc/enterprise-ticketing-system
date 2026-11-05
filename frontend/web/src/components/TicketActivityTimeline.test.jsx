import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import TicketActivityTimeline from './TicketActivityTimeline';
import * as ticketService from '@/services/ticketService';

vi.mock('@/services/ticketService', () => ({
  getTicketTimeline: vi.fn(),
}));

const entry = (over) => ({
  log_id: 1,
  ticket_id: 7,
  action_type: 'update',
  event_type: 'update',
  actor: { id: 5, name: 'Ava Santos', role: 'customer service' },
  description: 'Status changed from Open to In Progress',
  before_state: { ticket_status_ID: 'Open' },
  after_state: { ticket_status_ID: 'In Progress' },
  details: '{}',
  is_system: false,
  is_internal: false,
  created_at: '2026-11-02T09:00:00+00:00',
  ...over,
});

describe('TicketActivityTimeline (spec 0028 AC-16 to AC-19)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('loads the real endpoint using the database ticket id, not the display id', async () => {
    ticketService.getTicketTimeline.mockResolvedValue({
      data: [entry({})],
      pagination: { current_page: 1, last_page: 1, total: 1 },
    });
    render(<TicketActivityTimeline ticket={{ id: 'TKTS-00015', ticket_ID: 6 }} pageSize={5} />);

    await screen.findByText('Status changed from Open to In Progress');
    expect(ticketService.getTicketTimeline).toHaveBeenCalledWith(6, { page: 1, per_page: 5, order: 'asc' });
  });

  it('shows the actor and role from the server and the before and after values', async () => {
    ticketService.getTicketTimeline.mockResolvedValue({
      data: [entry({})],
      pagination: { current_page: 1, last_page: 1, total: 1 },
    });
    render(<TicketActivityTimeline ticket={{ ticket_ID: 7 }} />);

    await screen.findByText('Ava Santos');
    expect(screen.getByText(/Customer Service/)).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('Status:')).toBeInTheDocument();
  });

  it('labels system entries as system initiated and never guesses a human actor', async () => {
    ticketService.getTicketTimeline.mockResolvedValue({
      data: [
        entry({
          log_id: 2,
          action_type: 'sla_breached',
          event_type: 'sla_breached',
          is_system: true,
          actor: { id: 1, name: 'System', role: 'system' },
          description: 'SLA breached (2.0 hours overdue)',
          before_state: null,
          after_state: null,
        }),
      ],
      pagination: { current_page: 1, last_page: 1, total: 1 },
    });
    render(<TicketActivityTimeline ticket={{ ticket_ID: 7 }} />);

    await screen.findByText('SLA breached (2.0 hours overdue)');
    expect(screen.getByText('System-Initiated')).toBeInTheDocument();
    expect(screen.getByText('SLA Breach')).toBeInTheDocument();
  });

  it('fetches the next page on demand', async () => {
    ticketService.getTicketTimeline
      .mockResolvedValueOnce({ data: [entry({ log_id: 1 })], pagination: { current_page: 1, last_page: 2, total: 2 } })
      .mockResolvedValueOnce({
        data: [entry({ log_id: 2, description: 'Priority changed from Low to High', before_state: { priority_ID: 'Low' }, after_state: { priority_ID: 'High' } })],
        pagination: { current_page: 2, last_page: 2, total: 2 },
      });
    render(<TicketActivityTimeline ticket={{ ticket_ID: 7 }} pageSize={1} />);

    await screen.findByText('Status changed from Open to In Progress');
    fireEvent.click(screen.getByRole('button', { name: /Load More Activities/i }));

    await screen.findByText('Priority changed from Low to High');
    expect(ticketService.getTicketTimeline).toHaveBeenLastCalledWith(7, { page: 2, per_page: 1, order: 'asc' });
    expect(screen.queryByRole('button', { name: /Load More Activities/i })).not.toBeInTheDocument();
  });

  it('shows an actionable error with retry when the request fails', async () => {
    ticketService.getTicketTimeline.mockRejectedValueOnce(new Error('Network Error'));
    ticketService.getTicketTimeline.mockResolvedValueOnce({
      data: [entry({})],
      pagination: { current_page: 1, last_page: 1, total: 1 },
    });
    render(<TicketActivityTimeline ticket={{ ticket_ID: 7 }} />);

    await screen.findByText('Activity Timeline Failed to Load');
    fireEvent.click(screen.getByRole('button', { name: /Retry Timeline/i }));

    await screen.findByText('Status changed from Open to In Progress');
  });

  it('reports a missing record id instead of showing an invented history', () => {
    render(<TicketActivityTimeline ticket={{ id: 'TKTS-00015' }} />);
    expect(screen.getByText('Activity Timeline unavailable')).toBeInTheDocument();
    expect(ticketService.getTicketTimeline).not.toHaveBeenCalled();
  });

  it('reloads from the server when the sort order changes', async () => {
    ticketService.getTicketTimeline.mockResolvedValue({
      data: [entry({})],
      pagination: { current_page: 1, last_page: 1, total: 1 },
    });
    render(<TicketActivityTimeline ticket={{ ticket_ID: 7 }} pageSize={4} />);
    await screen.findByText('Ava Santos');

    fireEvent.click(screen.getByRole('button', { name: /Oldest First/i }));

    await waitFor(() =>
      expect(ticketService.getTicketTimeline).toHaveBeenLastCalledWith(7, { page: 1, per_page: 4, order: 'desc' })
    );
  });
});
