import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Notifications from '@/pages/Notifications';
import SuperAdminAuditLogs from '@/pages/SuperAdminAuditLogs';
import SecurityIncidentModal from './SecurityIncidentModal';

const mockNavigate = vi.fn();
let mockLocationSearch = '';

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/superadmin/audit-logs', search: mockLocationSearch }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, role: 'superadmin', email: 'admin@company.com' },
  })),
}));

vi.mock('@/hooks/useRealtimeRefresh', () => ({
  default: vi.fn(),
}));

vi.mock('@/services/ticketService', () => ({
  getNotifications: vi.fn(),
  markNotificationsRead: vi.fn(() => Promise.resolve()),
  markNotificationRead: vi.fn(() => Promise.resolve()),
  getTicketDetails: vi.fn(() => Promise.resolve({})),
  getAssignableEmployees: vi.fn(() => Promise.resolve([])),
  respondReassignment: vi.fn(() => Promise.resolve()),
  getSuperAdminAuditLogs: vi.fn(),
  getSecurityIncidents: vi.fn(),
  getSecurityIncidentDetail: vi.fn(),
}));

import * as ticketService from '@/services/ticketService';

describe('System & Security Alert Unit and Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocationSearch = '';
  });

  it('renders system security alerts in Notifications with category labels, severity badges, and burst metrics', async () => {
    ticketService.getNotifications.mockResolvedValue({
      notifications: [
        {
          id: 901,
          title: 'System Alert: SQL Error Spike',
          message: 'Syntax error in prepared query statement',
          is_read: false,
          created_at: '2026-10-25T12:00:00Z',
          data: JSON.stringify({
            alert_type: 'system_alert',
            category: 'sql_error',
            severity: 'critical',
            incident_id: 'INC-SQL-901',
            burst_count: 5,
            service: 'ticket-service',
          }),
        },
      ],
    });

    render(<Notifications />);

    await waitFor(() => {
      expect(screen.getByText(/System Alert: SQL Error Spike/i)).toBeInTheDocument();
      expect(screen.getByText('SQL Error')).toBeInTheDocument();
      expect(screen.getByText(/critical/i)).toBeInTheDocument();
      expect(screen.getByText(/\+5 repeat events/i)).toBeInTheDocument();
      expect(screen.getByText(/Inspect Incident Details/i)).toBeInTheDocument();
    });
  });

  it('opens SecurityIncidentModal when clicking a system security alert and displays origin details', async () => {
    const mockIncident = {
      id: 902,
      title: 'System Alert: Unhandled Exception',
      message: 'Call to undefined method in Dispatcher',
      is_read: false,
      data: JSON.stringify({
        alert_type: 'system_alert',
        category: 'unhandled_error',
        severity: 'high',
        incident_id: 'INC-ERR-902',
        service: 'customer-service',
        endpoint: '/api/customer/auth/login',
        http_method: 'POST',
        client_ip: '192.168.1.100',
        burst_count: 1,
        context: {
          sanitized_trace: ['app/Services/AuthService.php:45', 'app/Http/Controllers/AuthController.php:20'],
        },
      }),
    };

    ticketService.getNotifications.mockResolvedValue({
      notifications: [mockIncident],
    });

    render(<Notifications />);

    await waitFor(() => {
      expect(screen.getByText(/System Alert: Unhandled Exception/i)).toBeInTheDocument();
    });

    const card = screen.getByText(/System Alert: Unhandled Exception/i).closest('.cursor-pointer');
    fireEvent.click(card);

    await waitFor(() => {
      expect(screen.getByText(/HIGH INCIDENT/i)).toBeInTheDocument();
      expect(screen.getByText('INC-ERR-902')).toBeInTheDocument();
      expect(screen.getByText(/customer-service/i)).toBeInTheDocument();
      expect(screen.getByText(/192.168.1.100/i)).toBeInTheDocument();
    });

    // Expand trace accordion
    const traceButton = screen.getByText(/Sanitized Technical Context & Trace/i);
    fireEvent.click(traceButton);

    await waitFor(() => {
      expect(screen.getByText(/app\/Services\/AuthService\.php:45/i)).toBeInTheDocument();
    });
  });

  it('renders SuperAdminAuditLogs with Security & System Incidents tab and filters records accordingly', async () => {
    ticketService.getSuperAdminAuditLogs.mockResolvedValue([
      {
        id: 1,
        timestamp: '2026-10-25 12:00:00',
        user: 'Super Admin',
        role: 'Super Admin',
        action: 'Updated',
        module: 'Ticket Categories',
        target: 'Hardware',
        details: 'Updated ticket category name',
      },
      {
        id: 2,
        timestamp: '2026-10-25 12:05:00',
        user: 'System',
        role: 'System',
        action: 'System Alert',
        module: 'Security & System',
        target: 'INC-SQL-901',
        details: 'SQL query syntax error detected',
        incident_id: 'INC-SQL-901',
        severity: 'critical',
        burst_count: 3,
      },
    ]);

    ticketService.getSecurityIncidentDetail.mockResolvedValue({
      incident: {
        incident_id: 'INC-SQL-901',
        category: 'sql_error',
        severity: 'critical',
        title: 'SQL query syntax error detected',
        message: 'SQL query syntax error detected',
        service: 'ticket-service',
      },
      context: {},
    });

    render(<SuperAdminAuditLogs />);

    // Incidents are merged into the single Audit Log Trail, shown inline with severity and burst badges.
    await waitFor(() => {
      expect(screen.getByText('Audit Log Trail')).toBeInTheDocument();
      expect(screen.getByText(/Updated ticket category name/i)).toBeInTheDocument();
      expect(screen.getByText(/SQL query syntax error detected/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/\+3 bursts/i)).toBeInTheDocument();
    expect(screen.getByText(/critical/i)).toBeInTheDocument();

    // Clicking the incident row opens the incident inspection modal.
    fireEvent.click(screen.getByText(/\+3 bursts/i).closest('tr'));

    await waitFor(() => {
      expect(ticketService.getSecurityIncidentDetail).toHaveBeenCalled();
    });
  });

  it('deep links directly into incident modal when incidentId query parameter is provided in SuperAdminAuditLogs', async () => {
    mockLocationSearch = '?incidentId=INC-AUTH-777';
    ticketService.getSuperAdminAuditLogs.mockResolvedValue([]);
    ticketService.getSecurityIncidentDetail.mockResolvedValue({
      incident: {
        incident_id: 'INC-AUTH-777',
        category: 'failed_login_spike',
        severity: 'high',
        title: 'Authentication Spike Detected',
        message: 'Multiple failed logins from IP',
        service: 'customer-service',
        client_ip: '10.0.0.5',
      },
      context: {},
    });

    render(<SuperAdminAuditLogs />);

    await waitFor(() => {
      expect(screen.getByText('INC-AUTH-777')).toBeInTheDocument();
      expect(screen.getByText(/Authentication Spike/i)).toBeInTheDocument();
    });
  });
});
