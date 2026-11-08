import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ProofCompletionModal from './ProofCompletionModal';
import * as ticketService from '@/services/ticketService';

vi.mock('@/hooks/useMaxFileCount', () => ({ default: () => 5 }));

// Re-uploading proof after a CS rejection: when the superadmin Transition Matrix blocks
// In Progress (Employee-owned) -> Resolved, the employee must see a blocking notice,
// not a silent failure, and the proof form must stay open with their files.
describe('ProofCompletionModal re-upload blocked by the Transition Matrix', () => {
  const rejectedTicket = {
    id: 'TKT-0035',
    ticket_ID: 35,
    title: 'Centrifuge Motor Overheating',
    status: 'In Progress',
    proofRejected: true,
    rejectionReason: 'Missing calibration sheet.',
  };

  const blockedError = {
    response: {
      status: 422,
      data: {
        code: 'INVALID_TICKET_TRANSITION',
        message: "Transition from 'In Progress (Employee-owned)' to 'Resolved' is not permitted.",
        from_status: 'In Progress (Employee-owned)',
        to_status: 'Resolved',
      },
    },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const submitProof = async () => {
    const onClose = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <ProofCompletionModal ticket={rejectedTicket} onClose={onClose} onStatusChange={vi.fn()} />
      </MemoryRouter>
    );
    const file = new File(['proof'], 'calibration.pdf', { type: 'application/pdf' });
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
    fireEvent.change(container.querySelector('textarea'), { target: { value: 'Added calibration sheet' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    return { onClose };
  };

  it('shows the blocked notice naming the Resolved transition', async () => {
    vi.spyOn(ticketService, 'updateEmployeeTicket').mockRejectedValue(blockedError);
    await submitProof();

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Resolved Status Blocked')).toBeInTheDocument();
    expect(screen.getByText(
      'The Resolved status has been blocked by the Super Admin, so your changes were not saved. Please contact your Super Admin for assistance.'
    )).toBeInTheDocument();
  });

  it('keeps the proof form open with the file after the notice is dismissed', async () => {
    vi.spyOn(ticketService, 'updateEmployeeTicket').mockRejectedValue(blockedError);
    const { onClose } = await submitProof();

    fireEvent.click(await screen.findByRole('button', { name: 'OK' }));

    await waitFor(() => expect(screen.queryByText('Resolved Status Blocked')).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('calibration.pdf')).toBeInTheDocument();
  });

  it('shows a modal with the server reason for other failures', async () => {
    vi.spyOn(ticketService, 'updateEmployeeTicket').mockRejectedValue({
      response: { status: 500, data: { message: 'Attachment service is unavailable.' } },
    });
    await submitProof();

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Could Not Save')).toBeInTheDocument();
    expect(screen.getByText('Attachment service is unavailable. Nothing was saved.')).toBeInTheDocument();
    expect(screen.queryByText('Resolved Status Blocked')).not.toBeInTheDocument();
  });

  it('shows a modal when a proof file fails the security scan', async () => {
    vi.spyOn(ticketService, 'updateEmployeeTicket').mockRejectedValue({
      response: { status: 422, data: { virus_detected: true } },
    });
    await submitProof();

    expect(await screen.findByText('File Failed Security Scan')).toBeInTheDocument();
  });

  it('shows a modal when the server cannot be reached', async () => {
    vi.spyOn(ticketService, 'updateEmployeeTicket').mockRejectedValue(new Error('Network Error'));
    await submitProof();

    expect(await screen.findByText('Connection Problem')).toBeInTheDocument();
  });
});
