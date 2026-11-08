import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AssignModal } from './CSModals';
import * as ticketService from '@/services/ticketService';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, name: 'CS Agent', email: 'cs@sbsi.com.ph', role: 'cs' },
  }),
}));

describe('AssignModal Eligibility & Reassignment Escalation Tests', () => {
  const mockTicket = {
    id: 'TKT-00101',
    ticket_ID: 101,
    title: 'Centrifuge Motor Overheating',
    category: 'Biomedical Equipment',
    priority: 'High',
    branch: 'Main Branch',
    branch_name: 'Main Branch',
    sla: '4h Remaining',
    status: 'Open',
    assigned: [],
  };

  const mockDepartments = ['Service', 'IT'];
  const mockPriorityOptions = ['Low', 'Medium', 'High', 'Urgent'];

  const mockEligibleData = {
    ticket_id: 101,
    category: 'Biomedical Equipment',
    track: 'service',
    branch: 'Main Branch',
    rule: {
      department: ['Service'],
      min_position_level: 'Senior',
      allowed_roles: ['Lead Service Engineer'],
      allow_cross_branch: false,
    },
    department_managers: {
      service: {
        id: 1097,
        name: 'Reymie Gonzaga',
        email: 'shelleysesantee@gmail.com',
        phone: '+63 917 123 4567',
        department: 'Service',
      },
      it: {
        id: 1140,
        name: 'Ejay Detera',
        email: 'eggiesailor123@gmail.com',
        phone: '+63 917 234 5678',
        department: 'IT',
      },
    },
    eligible_count: 1,
    ineligible_count: 0,
    eligible_employees: [
      {
        id: 10,
        name: 'Juan Dela Cruz',
        department: 'Service',
        branch: 'Main Branch',
        position_level: 'Senior',
        technical_role: 'Lead Service Engineer',
        availability: 'Available',
        status: 'active',
      },
    ],
    ineligible_employees: [],
    empty_state_guidance: 'No active personnel at this branch meet category requirements. Escalate to Reymie Gonzaga.',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders AssignModal and fetches eligible employees based on category escalation rules', async () => {
    vi.spyOn(ticketService, 'getEligibleEmployees').mockResolvedValue(mockEligibleData);

    render(
      <AssignModal
        ticket={mockTicket}
        employees={[]}
        departments={mockDepartments}
        priorityOptions={mockPriorityOptions}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: 'Assign Ticket' })).toBeInTheDocument();

    await waitFor(() => {
      expect(ticketService.getEligibleEmployees).toHaveBeenCalled();
    });

    expect(screen.getByText('Eligible Staff (1)')).toBeInTheDocument();
    expect(screen.getAllByText('Juan Dela Cruz').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Lead Service Engineer').length).toBeGreaterThan(0);
  });

  it('does not render an ineligible tab as ineligible tab is removed', async () => {
    vi.spyOn(ticketService, 'getEligibleEmployees').mockResolvedValue(mockEligibleData);

    render(
      <AssignModal
        ticket={mockTicket}
        employees={[]}
        departments={mockDepartments}
        priorityOptions={mockPriorityOptions}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Eligible Staff (1)')).toBeInTheDocument();
    });

    expect(screen.queryByText(/Ineligible/i)).not.toBeInTheDocument();
  });

  it('displays Department Managers with contact information on the Managers tab', async () => {
    vi.spyOn(ticketService, 'getEligibleEmployees').mockResolvedValue(mockEligibleData);

    render(
      <AssignModal
        ticket={mockTicket}
        employees={[]}
        departments={mockDepartments}
        priorityOptions={mockPriorityOptions}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Department Managers')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Department Managers'));

    expect(screen.getAllByText('Reymie Gonzaga').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ejay Detera').length).toBeGreaterThan(0);
  });

  it('distinguishes empty state with escalation guidance when no eligible candidates exist', async () => {
    vi.spyOn(ticketService, 'getEligibleEmployees').mockResolvedValue({
      ...mockEligibleData,
      eligible_count: 0,
      eligible_employees: [],
      empty_state_guidance: 'Escalate to Service Manager Reymie Gonzaga immediately.',
    });

    render(
      <AssignModal
        ticket={mockTicket}
        employees={[]}
        departments={mockDepartments}
        priorityOptions={mockPriorityOptions}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getAllByText('No Eligible Employees Found').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText(/Escalate to Service Manager Reymie Gonzaga/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText('View Escalation Managers').length).toBeGreaterThan(0);
  });

  it('displays clear error state with retry action when eligibility fetch fails', async () => {
    vi.spyOn(ticketService, 'getEligibleEmployees')
      .mockRejectedValueOnce(new Error('Gateway timeout while reaching Configuration Service'))
      .mockResolvedValueOnce(mockEligibleData);

    render(
      <AssignModal
        ticket={mockTicket}
        employees={[]}
        departments={mockDepartments}
        priorityOptions={mockPriorityOptions}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Unable to load employee eligibility data')).toBeInTheDocument();
    });

    expect(screen.getByText('Gateway timeout while reaching Configuration Service')).toBeInTheDocument();

    const retryBtn = screen.getByText('Retry Loading');
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getAllByText('Juan Dela Cruz').length).toBeGreaterThan(0);
    });
  });

  it('recalculates eligibility when ticket category changes', async () => {
    const fetchSpy = vi.spyOn(ticketService, 'getEligibleEmployees').mockResolvedValue(mockEligibleData);

    render(
      <AssignModal
        ticket={mockTicket}
        employees={[]}
        departments={mockDepartments}
        priorityOptions={mockPriorityOptions}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const categorySelect = screen.getByDisplayValue('Biomedical Equipment');
    fireEvent.change(categorySelect, { target: { value: 'IT' } });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'IT',
        })
      );
    });
  });
});
