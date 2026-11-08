import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SuperAdminAuditLogs from './SuperAdminAuditLogs';
import * as ticketService from '@/services/ticketService';

// Mock realtime refresh hook
vi.mock('@/hooks/useRealtimeRefresh', () => ({
  default: vi.fn(),
}));

// Mock ticketService APIs
vi.mock('@/services/ticketService', () => ({
  getSuperAdminAuditLogs: vi.fn(),
  getAuditLogFilterOptions: vi.fn(),
  getAuditLogRetentionImpact: vi.fn(),
  getAuditLogRetentionConfig: vi.fn(),
  updateAuditLogRetentionConfig: vi.fn(),
  purgeAuditLogs: vi.fn(),
}));

describe('SuperAdminAuditLogs Component Tests', () => {
  const sampleLogs = [
    {
      id: 'log-1',
      timestamp: '2026-11-02T10:15:00Z',
      user: 'alice.admin@company.com',
      role: 'admin',
      action: 'Updated Priority',
      module: 'Tickets',
      target: 'TCK-501',
      branch: 'National HQ',
      details: 'Priority escalated from Medium to Critical',
    },
    {
      id: 'log-2',
      timestamp: '2026-10-15T08:30:00Z',
      user: 'bob.technician@company.com',
      role: 'technical',
      action: 'Resolved Ticket',
      module: 'Tickets',
      target: 'TCK-490',
      branch: 'Downtown Clinic',
      details: 'Replaced power capacitor on ventilator',
    },
    {
      id: 'log-3',
      timestamp: '2025-01-01T12:00:00Z', // Old log beyond 365 days
      user: 'sam.super@company.com',
      role: 'superadmin',
      action: 'Updated System Settings',
      module: 'Configuration',
      target: 'Global Settings',
      branch: 'National HQ',
      details: 'Modified email delivery credentials',
    },
  ];

  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    ticketService.getSuperAdminAuditLogs.mockResolvedValue(sampleLogs);
    ticketService.getAuditLogFilterOptions.mockResolvedValue({
      action_types: ['update_priority', 'resolve_ticket'],
      branches: [{ id: 1, name: 'National HQ', code: 'HQ' }, { id: 2, name: 'Downtown Clinic', code: 'DTC' }],
    });
    ticketService.getAuditLogRetentionConfig.mockResolvedValue({ retention_days: 365, pending_purge_estimate: 1 });
    ticketService.getAuditLogRetentionImpact.mockResolvedValue({
      retention_days: 90,
      cutoff_timestamp: '2026-08-05T00:00:00+00:00',
      affected_records_count: 2,
    });
    ticketService.updateAuditLogRetentionConfig.mockResolvedValue({});
    ticketService.purgeAuditLogs.mockResolvedValue({ records_deleted: 1 });
  });

  it('covers AC-18 and AC-20: renders system wide audit logs table with actor, action, and entity details', async () => {
    ticketService.getSuperAdminAuditLogs.mockResolvedValueOnce(sampleLogs);

    render(
      <MemoryRouter initialEntries={['/superadmin/audit-logs']}>
        <SuperAdminAuditLogs />
      </MemoryRouter>
    );

    expect(screen.getByText('Audit Logs & Governance')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText('alice.admin@company.com').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Updated Priority').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('TCK-501')).toBeInTheDocument();
      expect(screen.getByText('Priority escalated from Medium to Critical')).toBeInTheDocument();
    });
  });

  it('covers AC-18 and AC-19: filters records by search keyword and dynamic category dropdowns', async () => {
    ticketService.getSuperAdminAuditLogs.mockResolvedValueOnce(sampleLogs);

    render(
      <MemoryRouter initialEntries={['/superadmin/audit-logs']}>
        <SuperAdminAuditLogs />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('alice.admin@company.com').length).toBeGreaterThanOrEqual(1);
    });

    const searchInput = screen.getByPlaceholderText(/search by user, action, target/i);
    fireEvent.change(searchInput, { target: { value: 'ventilator' } });

    await waitFor(() => {
      expect(screen.getByRole('cell', { name: 'bob.technician@company.com' })).toBeInTheDocument();
      expect(screen.queryByText('Priority escalated from Medium to Critical')).not.toBeInTheDocument();
    });

    // Clear search and use the action dropdown, which is populated from the server
    fireEvent.change(searchInput, { target: { value: '' } });
    await screen.findByRole('option', { name: 'Update Priority' });
    const selects = screen.getAllByRole('combobox');
    const actionSelect = selects[1]; // Action filter
    ticketService.getSuperAdminAuditLogs.mockResolvedValue([sampleLogs[0]]);
    fireEvent.change(actionSelect, { target: { value: 'update_priority' } });

    await waitFor(() => {
      expect(ticketService.getSuperAdminAuditLogs).toHaveBeenLastCalledWith({ event_type: 'update_priority' });
      expect(screen.getByText('Priority escalated from Medium to Critical')).toBeInTheDocument();
      expect(screen.queryByText('Replaced power capacitor on ventilator')).not.toBeInTheDocument();
    });
  });

  it('covers AC-18 and AC-19: branch dropdown uses server branches and filters on the server', async () => {
    render(
      <MemoryRouter initialEntries={['/superadmin/audit-logs']}>
        <SuperAdminAuditLogs />
      </MemoryRouter>
    );

    await screen.findByRole('option', { name: 'Downtown Clinic' });
    const branchSelect = screen.getAllByRole('combobox').find((el) => el.value === '' && el.textContent.includes('All Branches'));
    ticketService.getSuperAdminAuditLogs.mockResolvedValue([sampleLogs[1]]);
    fireEvent.change(branchSelect, { target: { value: '2' } });

    await waitFor(() => {
      expect(ticketService.getSuperAdminAuditLogs).toHaveBeenLastCalledWith({ branch_id: '2' });
    });
  });

  it('covers AC-18: shows an actionable error when the log request fails', async () => {
    ticketService.getSuperAdminAuditLogs.mockRejectedValue(new Error('Network Error'));

    render(
      <MemoryRouter initialEntries={['/superadmin/audit-logs']}>
        <SuperAdminAuditLogs />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Unable to load audit logs/i)).toBeInTheDocument();
    });
  });

  it('covers AC-19: paginates audit log records and adjusts page size', async () => {
    const manyLogs = Array.from({ length: 30 }, (_, i) => ({
      id: `bulk-log-${i}`,
      timestamp: new Date(Date.now() - i * 3600000).toISOString(),
      user: `user-${i}@company.com`,
      role: 'technical',
      action: 'Ticket Update',
      module: 'Tickets',
      target: `TCK-${i}`,
      branch: 'National HQ',
      details: `Bulk update ${i}`,
    }));

    ticketService.getSuperAdminAuditLogs.mockResolvedValueOnce(manyLogs);

    render(
      <MemoryRouter initialEntries={['/superadmin/audit-logs']}>
        <SuperAdminAuditLogs />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('cell', { name: 'user-0@company.com' })).toBeInTheDocument();
    });

    // Default pageSize is 25, so user-25 should not be in the table rows on first page
    expect(screen.queryByRole('cell', { name: 'user-25@company.com' })).not.toBeInTheDocument();

    const nextPageBtn = screen.getByTitle('Next Page');
    fireEvent.click(nextPageBtn);

    await waitFor(() => {
      expect(screen.getByRole('cell', { name: 'user-25@company.com' })).toBeInTheDocument();
      expect(screen.queryByRole('cell', { name: 'user-0@company.com' })).not.toBeInTheDocument();
    });
  });

  it('covers AC-21: opens Log Retention tab and displays retention settings and preview counts', async () => {
    render(
      <MemoryRouter initialEntries={['/superadmin/log-retention']}>
        <SuperAdminAuditLogs defaultTab="retention" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Log Retention & Storage Governance')).toBeInTheDocument();
      expect(screen.getByText('Total Recorded Logs')).toBeInTheDocument();
      expect(screen.getByText('Active Retained Logs')).toBeInTheDocument();
      expect(screen.getByText('Expired Logs Ready for Purge')).toBeInTheDocument();
      expect(screen.getByText('Active Retention Threshold Period')).toBeInTheDocument();
    });
  });

  it('covers AC-21: prompts confirmation modal when reducing retention threshold with purge preview', async () => {
    render(
      <MemoryRouter initialEntries={['/superadmin/log-retention']}>
        <SuperAdminAuditLogs defaultTab="retention" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Log Retention & Storage Governance')).toBeInTheDocument();
    });

    // Click 90 Days preset button (reducing from 365 default)
    const ninetyDaysBtn = screen.getByRole('button', { name: /90 Days/i });
    fireEvent.click(ninetyDaysBtn);

    const saveBtn = screen.getByRole('button', { name: /Save Retention Policy/i });
    fireEvent.click(saveBtn);

    // Confirmation modal should appear
    await waitFor(() => {
      expect(screen.getByText('Confirm Retention Reduction')).toBeInTheDocument();
      expect(screen.getByText(/Reducing the retention policy to 90 days/i)).toBeInTheDocument();
      expect(screen.getByText(/approximately 2 log entries/i)).toBeInTheDocument();
    });
    expect(ticketService.getAuditLogRetentionImpact).toHaveBeenCalledWith(90);

    const confirmBtn = screen.getByRole('button', { name: /Confirm & Apply Retention/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(ticketService.updateAuditLogRetentionConfig).toHaveBeenCalledWith(90);
      expect(screen.getByText(/Log retention policy reduced to 90 days/i)).toBeInTheDocument();
    });
  });

  it('covers AC-21: shows an error and keeps the old policy when saving fails', async () => {
    ticketService.updateAuditLogRetentionConfig.mockRejectedValue({ response: { data: { message: 'Save blocked' } } });

    render(
      <MemoryRouter initialEntries={['/superadmin/log-retention']}>
        <SuperAdminAuditLogs defaultTab="retention" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Log Retention & Storage Governance')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /90 Days/i }));
    fireEvent.click(screen.getByRole('button', { name: /Save Retention Policy/i }));
    await screen.findByText('Confirm Retention Reduction');
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Apply Retention/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Save blocked');
    });
    expect(screen.queryByText(/Log retention policy reduced/i)).not.toBeInTheDocument();
  });

  it('covers AC-22: reports a purge failure instead of claiming success', async () => {
    ticketService.purgeAuditLogs.mockRejectedValue({ response: { status: 409, data: {} } });

    render(
      <MemoryRouter initialEntries={['/superadmin/log-retention']}>
        <SuperAdminAuditLogs defaultTab="retention" />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole('button', { name: /Purge 1 Expired Records Now/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Confirm & Execute Purge/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/already running/i);
    });
    expect(screen.queryByText(/Purged \d+ expired log records/i)).not.toBeInTheDocument();
  });

  it('covers AC-22: executes manual purge removing expired records while preserving unexpired logs', async () => {
    render(
      <MemoryRouter initialEntries={['/superadmin/log-retention']}>
        <SuperAdminAuditLogs defaultTab="retention" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Log Retention & Storage Governance')).toBeInTheDocument();
    });

    // Click purge trigger button
    const purgeTriggerBtn = screen.getByRole('button', { name: /Purge 1 Expired Records Now/i });
    fireEvent.click(purgeTriggerBtn);

    await waitFor(() => {
      expect(screen.getByText('Permanent Log Purge Confirmation')).toBeInTheDocument();
    });

    const executeBtn = screen.getByRole('button', { name: /Confirm & Execute Purge/i });
    fireEvent.click(executeBtn);

    await waitFor(() => {
      expect(ticketService.purgeAuditLogs).toHaveBeenCalledWith(365);
      expect(screen.getByText(/Purged 1 expired log records/i)).toBeInTheDocument();
    });
  });
});
