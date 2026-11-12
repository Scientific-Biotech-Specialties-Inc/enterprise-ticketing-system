import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import EmployeePerformanceView from './EmployeePerformanceView';
import { getAdminEmployeePerformance } from '@/services/ticketService';

vi.mock('@/services/ticketService', () => ({ getAdminEmployeePerformance: vi.fn() }));

const rows = [
  { employee_id: 1, name: 'Jasmine', department: 'Service', has_data: true, performance_score: 87.5, score_status: 'scored',
    pending_count: 1, tickets_assigned: 3, tickets_resolved: 2, sla_compliance_rate: 66.7, response_sla_rate: 100,
    average_response_minutes: 20, average_resolution_hours: 3.4, csat_score: null },
  { employee_id: 3, name: 'New Starter', department: 'IT', has_data: true, performance_score: null, score_status: 'not_enough_data',
    pending_count: 0, tickets_assigned: 2, tickets_resolved: 1, sla_compliance_rate: 50, response_sla_rate: 100,
    average_response_minutes: 12.5, average_resolution_hours: 1, csat_score: 4.5 },
  { employee_id: 2, name: 'Idle Person', department: 'Operations', has_data: false, tickets_assigned: 0 },
];

describe('EmployeePerformanceView (spec 0029 AC-5, AC-6; spec 0039 AC-18)', () => {
  beforeEach(() => {
    getAdminEmployeePerformance.mockReset();
    getAdminEmployeePerformance.mockResolvedValue({ employees: rows });
  });

  it('shows real values, a dash for missing ones and a notice for no activity', async () => {
    render(<EmployeePerformanceView selectedPeriod="This Month" />);
    expect(await screen.findByText('Jasmine')).toBeInTheDocument();
    expect(screen.getByText('87.5')).toBeInTheDocument(); // Performance Score
    expect(screen.getByText('66.7%')).toBeInTheDocument(); // Resolution SLA
    expect(screen.getByText('20 min')).toBeInTheDocument(); // Avg Response
    expect(screen.getByText('—')).toBeInTheDocument(); // CSAT
    expect(screen.getByText('Not enough data')).toBeInTheDocument();
    expect(screen.getByText('No data recorded for this period')).toBeInTheDocument();
  });

  it('asks for Performance Score high to low by default and sends the chosen branch', async () => {
    render(<EmployeePerformanceView selectedPeriod="This Month" branchId="all" />);
    await screen.findByText('Jasmine');
    expect(getAdminEmployeePerformance.mock.calls[0][0]).toMatchObject({
      sort_by: 'performance_score', sort_dir: 'desc', branch_id: 'all',
    });
  });

  it('sends no branch for a branch admin', async () => {
    render(<EmployeePerformanceView selectedPeriod="This Month" />);
    await screen.findByText('Jasmine');
    expect(getAdminEmployeePerformance.mock.calls[0][0]).not.toHaveProperty('branch_id');
  });

  it('asks the server to sort when a header is clicked', async () => {
    render(<EmployeePerformanceView selectedPeriod="This Month" />);
    await screen.findByText('Jasmine');
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Response SLA' }));
    await waitFor(() => {
      const last = getAdminEmployeePerformance.mock.calls.at(-1)[0];
      expect(last).toMatchObject({ preset: 'This Month', sort_by: 'response_sla_rate', sort_dir: 'desc' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sort by Response SLA' }));
    await waitFor(() => expect(getAdminEmployeePerformance.mock.calls.at(-1)[0].sort_dir).toBe('asc'));
  });

  it('shows an error with retry instead of fake rows', async () => {
    getAdminEmployeePerformance.mockRejectedValueOnce(new Error('boom'));
    render(<EmployeePerformanceView />);
    expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');
  });
});
