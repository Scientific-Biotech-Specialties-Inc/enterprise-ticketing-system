import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TicketDetailModal from './TicketDetailModal';
import * as ticketService from '@/services/ticketService';
import { ToastProvider } from '@/context/ToastContext';

vi.mock('@/services/ticketService', () => ({
  acceptTicket: vi.fn(),
  requestReassignment: vi.fn(),
  getInternalNotes: vi.fn().mockResolvedValue([]),
  getTicketDetails: vi.fn(),
}));

vi.mock('@/components/InternalTicketMessageThread', () => ({
  default: () => <div data-testid="internal-message-thread">Mock Message Thread</div>,
}));

const mockUnacceptedTicket = {
  id: 'TKT-0001',
  ticket_ID: 1,
  title: 'tkttt',
  customer: 'SBSI Demo Customer',
  equipment: 'Bedside Monitor',
  equipment_type: 'MON-500-A11',
  category: 'Calibration Required',
  status: 'Open',
  priority: 'Low',
  accepted: false,
  date: '2026-06-20T00:00:00Z',
  created_at: '2026-06-20T00:00:00Z',
};

const mockDeclinedWithReasonTicket = {
  ...mockUnacceptedTicket,
  deniedReassignment: true,
  reassignmentDenyReason: 'Staff shortage in ICU. Please proceed with standard diagnostic protocol.',
  coordinator_name: 'Sarah CS Coordinator',
};

const mockDeclinedWithoutReasonTicket = {
  ...mockUnacceptedTicket,
  deniedReassignment: true,
  reassignmentDenyReason: '',
};

const mockPendingReassignTicket = {
  ...mockUnacceptedTicket,
  reassignmentRequested: true,
  reassignmentStatus: 'Pending',
  reassignmentReason: 'Requires specialist tools not in field kit.',
};

import { MemoryRouter } from 'react-router-dom';

const renderModal = (props = {}) => {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <TicketDetailModal
          ticket={mockUnacceptedTicket}
          onClose={vi.fn()}
          onAccept={vi.fn()}
          onRequestReassign={vi.fn()}
          {...props}
        />
      </ToastProvider>
    </MemoryRouter>
  );
};

describe('Technician TicketDetailModal (Awaiting Acceptance & Declined States)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. renders ModalHeader with ticket ID, Copy ID, 44x44 Close button, and no redundant view badges', () => {
    const handleClose = vi.fn();
    renderModal({ onClose: handleClose });

    expect(screen.getByText('TKT-0001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy ticket id/i })).toBeInTheDocument();
    expect(screen.queryByText('Technician view')).toBeNull();
    expect(screen.queryByText('Staff view')).toBeNull();

    const closeBtn = screen.getByRole('button', { name: /^close$/i });
    expect(closeBtn).toBeInTheDocument();
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalled();
  });

  it('2. renders TicketTitleBlock with title, priority, "Awaiting your acceptance" pill, subtitle, and NO standalone Open pill', () => {
    renderModal();

    expect(screen.getByRole('heading', { level: 2, name: 'tkttt' })).toBeInTheDocument();
    expect(screen.getAllByText('Low').length).toBeGreaterThan(0);
    expect(screen.getByText('Awaiting your acceptance')).toBeInTheDocument();
    expect(screen.getByText(/Bedside Monitor · MON-500-A11 · Calibration Required/)).toBeInTheDocument();

    // Must not have standalone "Open" pill in header (status communicated by stepper and status pill)
    expect(screen.queryByText(/^open$/i)).toBeNull();
  });

  it('3. renders StatusStepper with Submitted, Assigned to you, In Progress, Resolved', () => {
    renderModal();

    expect(screen.getAllByText('Submitted').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Assigned to you').length).toBeGreaterThan(0);
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('Resolved')).toBeInTheDocument();
  });

  it('4. renders DecisionCard with ACTION NEEDED, Accept ticket, and Request reassignment', () => {
    const handleAccept = vi.fn();
    renderModal({ onAccept: handleAccept });

    expect(screen.getByText('ACTION NEEDED')).toBeInTheDocument();
    expect(screen.getByText(/This ticket is assigned to you\. Accept it to start work\./i)).toBeInTheDocument();

    // Accept ticket button (with accessible name matching /^accept$/i)
    const acceptBtn = screen.getByRole('button', { name: /^accept$/i });
    expect(acceptBtn).toBeInTheDocument();
    expect(screen.getByText('Accept ticket')).toBeInTheDocument();

    // Initial first-time assignment: second button is labeled "Request reassignment"
    expect(screen.getByRole('button', { name: 'Request reassignment' })).toBeInTheDocument();
    // Helper text for declined re-request is NOT shown
    expect(screen.queryByText(/Requesting again needs a new reason/i)).toBeNull();

    fireEvent.click(acceptBtn);
    expect(handleAccept).toHaveBeenCalledWith(1);
  });

  it('5. renders amber ReassignmentNotice when request was declined WITH a reason', () => {
    renderModal({ ticket: mockDeclinedWithReasonTicket });

    // Warning amber banner
    expect(screen.getByText(/Your reassignment request wasn't approved/i)).toBeInTheDocument();
    expect(screen.getByText(/Reason from Sarah CS Coordinator:/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Staff shortage in ICU\. Please proceed with standard diagnostic protocol\./i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /ask coordinator why/i })).toBeInTheDocument();

    // Decision card button switches to "Request reassignment again" with helper text
    expect(screen.getByRole('button', { name: 'Request reassignment again' })).toBeInTheDocument();
    expect(screen.getByText(/Requesting again needs a new reason\./i)).toBeInTheDocument();
  });

  it('6. renders amber ReassignmentNotice when request was declined WITHOUT a reason', () => {
    renderModal({ ticket: mockDeclinedWithoutReasonTicket });

    expect(screen.getByText(/Your reassignment request wasn't approved/i)).toBeInTheDocument();
    expect(screen.getByText(/The coordinator didn't give a reason\. You can accept this ticket, or ask again with new details\./i)).toBeInTheDocument();
  });

  it('7. opens ReassignDialog, validates against empty and identical reasons, and submits via requestReassignment', async () => {
    ticketService.requestReassignment.mockResolvedValue({});
    renderModal({ ticket: mockDeclinedWithReasonTicket });

    // Click "Request reassignment again"
    const reassignBtn = screen.getByRole('button', { name: 'Request reassignment again' });
    fireEvent.click(reassignBtn);

    // Dialog opens with focus on textarea
    expect(screen.getByRole('dialog', { name: /Request Reassignment Again/i })).toBeInTheDocument();
    const textarea = screen.getByPlaceholderText(/Detail why you cannot complete this assignment/i);
    expect(textarea).toBeInTheDocument();
    expect(textarea.value).toBe(''); // Prefills nothing after a declined request

    const submitBtn = screen.getByRole('button', { name: /submit request/i });

    // Try entering identical reason to previous declined reason
    fireEvent.change(textarea, {
      target: { value: 'Staff shortage in ICU. Please proceed with standard diagnostic protocol.' },
    });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/Please enter a new reason\. It cannot be identical to your previous request\./i)).toBeInTheDocument();
    expect(ticketService.requestReassignment).not.toHaveBeenCalled();

    // Enter a new valid reason
    fireEvent.change(textarea, {
      target: { value: 'Dispatched to Emergency Room trauma unit for immediate defibrillator servicing.' },
    });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(ticketService.requestReassignment).toHaveBeenCalledWith({
        ticketId: 1,
        reason: 'Dispatched to Emergency Room trauma unit for immediate defibrillator servicing.',
      });
    });
  });

  it('8. renders TabBar with Details, Timeline (n), Files (n) and FieldGrid with PHT timestamps', () => {
    renderModal({ ticket: mockDeclinedWithReasonTicket });

    expect(screen.getByRole('tab', { name: /^Details/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Timeline/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^Files/i })).toBeInTheDocument();

    // FieldGrid fields
    expect(screen.getByText('SBSI Demo Customer')).toBeInTheDocument();
    expect(screen.getAllByText(/8:00 AM PHT/i).length).toBeGreaterThan(0);

    // Compact TIMELINE preview below grid
    expect(screen.getByText('TIMELINE')).toBeInTheDocument();
    expect(screen.getByText('Reassignment request declined')).toBeInTheDocument();
    expect(screen.getAllByText('Assigned to you').length).toBeGreaterThan(0);
  });

  it('9. replaces decision card with info banner when reassignment is currently pending', () => {
    renderModal({ ticket: mockPendingReassignTicket });

    expect(screen.getByText('Reassignment requested')).toBeInTheDocument();
    expect(screen.getByText(/Waiting for the coordinator's decision/i)).toBeInTheDocument();
    expect(screen.queryByText('ACTION NEEDED')).toBeNull();
  });

  it('10. renders sticky footer with "Message coordinator" button and opens message thread dialog', async () => {
    renderModal({ ticket: mockDeclinedWithReasonTicket });

    const msgBtn = screen.getByRole('button', { name: /Message coordinator/i });
    expect(msgBtn).toBeInTheDocument();
    expect(msgBtn).toHaveTextContent(/Sarah CS Coordinator/i);

    fireEvent.click(msgBtn);

    expect(await screen.findByText('Conversation with Coordinator')).toBeInTheDocument();
    expect(screen.getByTestId('internal-message-thread')).toBeInTheDocument();
  });
});
