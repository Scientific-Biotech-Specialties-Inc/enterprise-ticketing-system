import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AssignModal } from './CSModals';
import * as ticketService from '@/services/ticketService';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, name: 'CS Agent', email: 'cs@sbsi.com.ph', role: 'cs' } }),
}));

const person = (id, name, presence) => ({
  id,
  name,
  department: 'Service',
  branch: 'Main Branch',
  position_level: 'Senior',
  technical_role: 'Lead Service Engineer',
  is_active: true,
  presence,
});

const eligibility = (employees) => ({
  ticket_id: 101,
  category: 'Biomedical Equipment',
  track: 'service',
  branch: 'Main Branch',
  rule: { department: ['Service'], allow_cross_branch: false },
  department_managers: {},
  eligible_count: employees.length,
  ineligible_count: 0,
  eligible_employees: employees,
  ineligible_employees: [],
});

function renderModal() {
  render(
    <AssignModal
      ticket={{ id: 'TKT-00101', ticket_ID: 101, title: 'Centrifuge', category: 'Biomedical Equipment', priority: 'High', branch: 'Main Branch', status: 'Open', assigned: [] }}
      employees={[]}
      departments={['Service', 'IT']}
      priorityOptions={['Low', 'High']}
      onClose={vi.fn()}
      onSave={vi.fn()}
    />
  );
}

describe('AssignModal presence badges (covers: AC-4)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('shows Online for a fresh heartbeat and Offline with a warning for a stale one', async () => {
    vi.spyOn(ticketService, 'getEligibleEmployees').mockResolvedValue(
      eligibility([person(1, 'Olivia Online', 'online'), person(2, 'Oscar Offline', 'offline')])
    );
    renderModal();

    await waitFor(() => expect(screen.getByText('Olivia Online')).toBeInTheDocument());

    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.getAllByText(/may not see this right away/i)).toHaveLength(1);
  });

  it('keeps an offline employee selectable', async () => {
    vi.spyOn(ticketService, 'getEligibleEmployees').mockResolvedValue(
      eligibility([person(2, 'Oscar Offline', 'offline')])
    );
    renderModal();

    await waitFor(() => expect(screen.getByText('Oscar Offline')).toBeInTheDocument());

    expect(screen.getAllByRole('checkbox')[0]).toBeEnabled();
  });

  it('lists employees in the order the API returned them (online first)', async () => {
    vi.spyOn(ticketService, 'getEligibleEmployees').mockResolvedValue(
      eligibility([person(1, 'Olivia Online', 'online'), person(2, 'Oscar Offline', 'offline')])
    );
    renderModal();

    await waitFor(() => expect(screen.getByText('Olivia Online')).toBeInTheDocument());
    const names = screen.getAllByText(/Olivia Online|Oscar Offline/).map((n) => n.textContent);

    expect(names.indexOf('Olivia Online')).toBeLessThan(names.indexOf('Oscar Offline'));
  });
});
