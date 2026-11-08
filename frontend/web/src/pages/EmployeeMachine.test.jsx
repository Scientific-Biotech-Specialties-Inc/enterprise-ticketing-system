import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EmployeeMachine from './EmployeeMachine';
import * as ticketService from '@/services/ticketService';

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 6, emp_id: 6, name: 'Support Engineer', email: 'engineer@example.com', role: 'technician' },
  })),
}));

vi.mock('@/hooks/useRealtimeRefresh', () => ({
  default: vi.fn(),
}));

vi.mock('@/services/ticketService', () => ({
  getEmployeeAssignedTickets: vi.fn(),
  clearEmployeeTicketsCache: vi.fn(),
}));

describe('EmployeeMachine Component Tests (SLA Status Display & Filtering)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockTickets = [
    {
      id: 'TKT-0001',
      ticket_ID: 1,
      title: 'Ventilator Pressure Sensor Error',
      customer: 'Metro General Hospital',
      status: 'In Progress',
      priority: 'Critical',
      category: 'Ventilator',
      accepted: true,
      sla_status: 'Breached',
      resolution_due_at: '2026-10-22T08:00:00Z',
      time_remaining_minutes: 0,
      lastUpdate: '2026-10-22',
    },
    {
      id: 'TKT-0002',
      ticket_ID: 2,
      title: 'MRI Cooling Flow Interruption',
      customer: 'St. Jude Medical Center',
      status: 'In Progress',
      priority: 'High',
      category: 'MRI',
      accepted: true,
      sla_status: 'At Risk',
      resolution_due_at: '2026-10-23T12:00:00Z',
      time_remaining_minutes: 90,
      lastUpdate: '2026-10-23',
    },
    {
      id: 'TKT-0003',
      ticket_ID: 3,
      title: 'X-Ray Calibration Routine Check',
      customer: 'Apex Diagnostic Clinic',
      status: 'In Progress',
      priority: 'Medium',
      category: 'X-Ray',
      accepted: true,
      sla_status: 'On Track',
      resolution_due_at: '2026-10-25T16:00:00Z',
      time_remaining_minutes: 1800,
      lastUpdate: '2026-10-23',
    },
    {
      id: 'TKT-0004',
      ticket_ID: 4,
      title: 'CT Scan Reconstruction Timeout',
      customer: 'City Hope Hospital',
      status: 'In Progress',
      priority: 'Low',
      category: 'CT Scan',
      accepted: true,
      sla_status: 'Paused',
      resolution_due_at: '2026-10-24T10:00:00Z',
      time_remaining_minutes: 600,
      lastUpdate: '2026-10-23',
    },
    {
      id: 'TKT-0005',
      ticket_ID: 5,
      title: 'Ultrasound Software Maintenance',
      customer: 'West End Clinic',
      status: 'In Progress',
      priority: 'Low',
      category: 'Ultrasound',
      accepted: true,
      sla_status: null,
      slaStatus: null,
      resolution_due_at: null,
      time_remaining_minutes: null,
      lastUpdate: '2026-10-23',
    },
  ];

  it('renders the SLA Status table column header', async () => {
    ticketService.getEmployeeAssignedTickets.mockResolvedValueOnce(mockTickets);

    render(
      <MemoryRouter initialEntries={['/ticketing/employee/machine']}>
        <Routes>
          <Route path="/ticketing/employee/machine" element={<EmployeeMachine />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('columnheader', { name: /SLA Status/i })).toBeInTheDocument();
    });
  });

  it('renders color-coded SLA badges for Breached, At Risk, On Track, and Paused tickets', async () => {
    ticketService.getEmployeeAssignedTickets.mockResolvedValueOnce(mockTickets);

    render(
      <MemoryRouter initialEntries={['/ticketing/employee/machine']}>
        <Routes>
          <Route path="/ticketing/employee/machine" element={<EmployeeMachine />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Ventilator Pressure Sensor Error')).toBeInTheDocument();
    });

    // Breached badge (matches dropdown option and badge span)
    expect(screen.getAllByText('Breached').length).toBeGreaterThanOrEqual(2);

    // At Risk badge (matches dropdown option and badge span)
    expect(screen.getAllByText('At Risk').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/left/i)).toBeInTheDocument();

    // On Track badge (matches dropdown option and badge span)
    expect(screen.getAllByText('On Track').length).toBeGreaterThanOrEqual(2);

    // Paused badge (matches dropdown option and badge span)
    expect(screen.getAllByText('Paused').length).toBeGreaterThanOrEqual(2);

    // Unconfigured SLA fallback badge
    expect(screen.getByText('No SLA')).toBeInTheDocument();
  });

  it('filters tickets by SLA Status using the SLA Filter dropdown', async () => {
    ticketService.getEmployeeAssignedTickets.mockResolvedValueOnce(mockTickets);

    render(
      <MemoryRouter initialEntries={['/ticketing/employee/machine']}>
        <Routes>
          <Route path="/ticketing/employee/machine" element={<EmployeeMachine />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Ventilator Pressure Sensor Error')).toBeInTheDocument();
    });

    // Find the SLA filter dropdown (has option "All SLA")
    const selects = screen.getAllByRole('combobox');
    const slaSelect = selects.find((s) => s.querySelector('option[value="All SLA"]'));
    expect(slaSelect).toBeDefined();

    // Filter by Breached
    fireEvent.change(slaSelect, { target: { value: 'Breached' } });

    await waitFor(() => {
      expect(screen.getByText('Ventilator Pressure Sensor Error')).toBeInTheDocument();
      expect(screen.queryByText('MRI Cooling Flow Interruption')).not.toBeInTheDocument();
      expect(screen.queryByText('X-Ray Calibration Routine Check')).not.toBeInTheDocument();
    });

    // Filter by At Risk
    fireEvent.change(slaSelect, { target: { value: 'At Risk' } });

    await waitFor(() => {
      expect(screen.queryByText('Ventilator Pressure Sensor Error')).not.toBeInTheDocument();
      expect(screen.getByText('MRI Cooling Flow Interruption')).toBeInTheDocument();
      expect(screen.queryByText('X-Ray Calibration Routine Check')).not.toBeInTheDocument();
    });
  });
});
