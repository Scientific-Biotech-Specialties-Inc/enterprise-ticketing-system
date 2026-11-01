import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EscalateTicketModal from './EscalateTicketModal';

describe('EscalateTicketModal Component Tests', () => {
  const serviceTicket = {
    id: 101,
    ticket_number: 'TCK-2026-00101',
    title: 'Defective ultrasound probe',
    category: 'Biomedical Service Repair',
    department: 'Service',
    status: 'In Progress',
  };

  const itTicket = {
    id: 102,
    ticket_number: 'TCK-2026-00102',
    title: 'Database connection failure',
    category: 'IT Hardware & Software',
    department: 'IT',
    status: 'In Progress',
  };

  const mockEmployees = [
    {
      id: 1139,
      name: 'Mobaraq Camar',
      role: 'service',
      department: 'Service',
      position_level: 'Engineer',
      technical_role: 'Engineer',
      is_active: true,
    },
    {
      id: 4,
      name: 'Jasmine Aninion',
      role: 'service',
      department: 'Service',
      position_level: 'Engineer',
      technical_role: 'Engineer',
      is_active: true,
    },
    {
      id: 1140,
      name: 'Ejay Detera',
      role: 'service',
      department: 'IT',
      position_level: 'Manager',
      technical_role: 'IT Manager',
      is_active: true,
    },
    {
      id: 1142,
      name: 'Reymie Gonzaga',
      role: 'service',
      department: 'Service',
      position_level: 'Manager',
      technical_role: 'Service Manager',
      is_active: true,
    },
    {
      id: 1143,
      name: 'Derrick Pamintuan',
      role: 'service',
      department: 'IT',
      position_level: 'Employee',
      technical_role: 'Employee',
      is_active: true,
    },
  ];

  it('restricts eligible escalation targets strictly to managers in the Service department', () => {
    render(
      <EscalateTicketModal
        isOpen={true}
        onClose={vi.fn()}
        ticket={serviceTicket}
        employees={mockEmployees}
        onConfirmEscalate={vi.fn()}
      />
    );

    // Reymie Gonzaga is the Service Manager and must be present
    expect(screen.getByText('Reymie Gonzaga')).toBeDefined();

    // Non-manager Service Engineers must NOT be in the escalation list
    expect(screen.queryByText('Mobaraq Camar')).toBeNull();
    expect(screen.queryByText('Jasmine Aninion')).toBeNull();

    // IT Manager must NOT be in the Service escalation list
    expect(screen.queryByText('Ejay Detera')).toBeNull();
  });

  it('restricts eligible escalation targets strictly to managers in the IT department', () => {
    render(
      <EscalateTicketModal
        isOpen={true}
        onClose={vi.fn()}
        ticket={itTicket}
        employees={mockEmployees}
        onConfirmEscalate={vi.fn()}
      />
    );

    // Ejay Detera is the IT Manager and must be present
    expect(screen.getByText('Ejay Detera')).toBeDefined();

    // Non-manager IT employees must NOT be present
    expect(screen.queryByText('Derrick Pamintuan')).toBeNull();

    // Service Manager must NOT be in the IT escalation list
    expect(screen.queryByText('Reymie Gonzaga')).toBeNull();
  });

  it('allows switching to IT department tab to escalate to IT Manager Ejay Detera', async () => {
    const handleConfirmEscalate = vi.fn().mockResolvedValue(true);

    render(
      <EscalateTicketModal
        isOpen={true}
        onClose={vi.fn()}
        ticket={serviceTicket}
        employees={mockEmployees}
        onConfirmEscalate={handleConfirmEscalate}
      />
    );

    // Initially shows Service Manager
    expect(screen.getByText('Reymie Gonzaga')).toBeDefined();
    expect(screen.queryByText('Ejay Detera')).toBeNull();

    // Click 'IT' department tab button
    const itButtons = screen.getAllByRole('button', { name: /^IT$/i });
    fireEvent.click(itButtons[0]);

    // Now Ejay Detera (IT Manager) should be visible and Reymie Gonzaga should be gone
    expect(screen.getByText('Ejay Detera')).toBeDefined();
    expect(screen.queryByText('Reymie Gonzaga')).toBeNull();

    // Fill escalation reason
    const textarea = screen.getByPlaceholderText(/Explain why this ticket is being escalated/i);
    fireEvent.change(textarea, { target: { value: 'Requires infrastructure server reboot' } });

    // Submit form
    const submitBtn = screen.getByRole('button', { name: /Confirm Escalation/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(handleConfirmEscalate).toHaveBeenCalledTimes(1);
      expect(handleConfirmEscalate).toHaveBeenCalledWith(
        expect.objectContaining({
          targetEmployee: expect.objectContaining({ id: 1140, name: 'Ejay Detera' }),
          reason: 'Requires infrastructure server reboot',
          categoryType: 'it',
        })
      );
    });
  });

  it('displays blocked banner when no manager exists for the ticket department', () => {
    const facilitiesTicket = {
      id: 103,
      ticket_number: 'TCK-2026-00103',
      title: 'Power breaker issue',
      category: 'Facilities Maintenance',
      department: 'Facilities',
      status: 'In Progress',
    };

    render(
      <EscalateTicketModal
        isOpen={true}
        onClose={vi.fn()}
        ticket={facilitiesTicket}
        employees={mockEmployees}
        onConfirmEscalate={vi.fn()}
      />
    );

    // Banner informing user that no Facilities manager was found
    expect(screen.getByText(/Blocked Escalation: No Facilities Manager Found/i)).toBeDefined();
  });

  it('blocks re-escalation and disables confirm button when ticket is already escalated', () => {
    const escalatedTicket = {
      id: 104,
      ticket_number: 'TCK-2026-00104',
      title: 'Already escalated server outage',
      category: 'IT Hardware & Software',
      department: 'IT',
      status: 'Escalated',
    };

    render(
      <EscalateTicketModal
        isOpen={true}
        onClose={vi.fn()}
        ticket={escalatedTicket}
        employees={mockEmployees}
        onConfirmEscalate={vi.fn()}
      />
    );

    // Banner informing user that ticket is already escalated
    expect(screen.getByText(/Ticket Already Escalated/i)).toBeDefined();
    expect(screen.getByText(/This ticket has already been escalated to department leadership/i)).toBeDefined();

    // Submit button should be disabled
    const submitBtn = screen.getByRole('button', { name: /Confirm Escalation/i });
    expect(submitBtn.hasAttribute('disabled')).toBe(true);
  });
});
