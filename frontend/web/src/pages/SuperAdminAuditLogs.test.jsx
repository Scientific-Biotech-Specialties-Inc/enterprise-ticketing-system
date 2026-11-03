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
  getAuditLogRetentionConfig: vi.fn(),
  updateAuditLogRetentionConfig: vi.fn(() => Promise.resolve()),
  purgeAuditLogs: vi.fn(() => Promise.resolve()),
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
    vi.clearAllMocks();
    localStorage.clear();
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

    // Clear search and test action dropdown
    fireEvent.change(searchInput, { target: { value: '' } });
    const selects = screen.getAllByRole('combobox');
    const actionSelect = selects[1]; // Action filter
    fireEvent.change(actionSelect, { target: { value: 'Updated Priority' } });

    await waitFor(() => {
      expect(screen.getByText('Priority escalated from Medium to Critical')).toBeInTheDocument();
      expect(screen.queryByText('Replaced power capacitor on ventilator')).not.toBeInTheDocument();
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
    ticketService.getSuperAdminAuditLogs.mockResolvedValueOnce(sampleLogs);

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
    ticketService.getSuperAdminAuditLogs.mockResolvedValueOnce(sampleLogs);

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
    });

    const confirmBtn = screen.getByRole('button', { name: /Confirm & Apply Retention/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(ticketService.updateAuditLogRetentionConfig).toHaveBeenCalledWith(90);
      expect(screen.getByText(/Log retention policy reduced to 90 days/i)).toBeInTheDocument();
    });
  });

  it('covers AC-22: executes manual purge removing expired records while preserving unexpired logs', async () => {
    ticketService.getSuperAdminAuditLogs.mockResolvedValueOnce(sampleLogs);

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
      expect(screen.getByText(/Successfully purged 1 expired log records/i)).toBeInTheDocument();
    });
  });
});
