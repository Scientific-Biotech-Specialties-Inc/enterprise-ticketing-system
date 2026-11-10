import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SuperAdminTicketConfig from './SuperAdminTicketConfig';
import * as configurationService from '@/services/configurationService';
import * as ticketService from '@/services/ticketService';

// Mock AuthContext
vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: {
      emp_id: 1,
      name: 'Super Admin',
      role: 'superadmin',
      department: 'IT',
    },
  })),
}));

// Mock BranchContext
vi.mock('@/context/BranchContext', () => ({
  useBranch: vi.fn(() => ({
    selectedBranchId: 1,
    selectedBranch: { id: 1, name: 'Main Branch' },
    branches: [{ id: 1, name: 'Main Branch' }],
    loading: false,
    setSelectedBranchId: vi.fn(),
  })),
}));

// Mock react-router-dom with active 'messaging' tab
vi.mock('@/services/echo', () => ({
  default: {
    channel: vi.fn(() => ({
      listen: vi.fn(),
      stopListening: vi.fn(),
    })),
    private: vi.fn(() => ({
      listen: vi.fn(),
      stopListening: vi.fn(),
    })),
  },
}));

vi.mock('react-router-dom', () => ({
  useParams: vi.fn(() => ({ subtab: 'messaging' })),
  useNavigate: vi.fn(() => vi.fn()),
  useLocation: vi.fn(() => ({ pathname: '/ticketing/superadmin/config/messaging' })),
}));

// Mock ticketService
vi.mock('@/services/ticketService', () => ({
  getSuperAdminConfig: vi.fn(() => Promise.resolve({ equipment: [], categories: [], priorities: [] })),
  getDepartments: vi.fn(() => Promise.resolve([])),
  getSLARules: vi.fn(() => Promise.resolve([])),
  getWorkflowStatuses: vi.fn(() => Promise.resolve([])),
  getEscalationRules: vi.fn(() => Promise.resolve([])),
  getTicketFormOptions: vi.fn(() => Promise.resolve({ problem_categories: [], ticket_priorities: [] })),
  getTicketLimitConfig: vi.fn(() => Promise.resolve({})),
  getTicketNumberFormatConfig: vi.fn(() => Promise.resolve({})),
  getTicketDefaultsConfig: vi.fn(() => Promise.resolve({})),
  getBranchPriorities: vi.fn(() => Promise.resolve([])),
  getBranchCategoriesAndSla: vi.fn(() => Promise.resolve([])),
  saveDepartmentSLARules: vi.fn(() => Promise.resolve({})),
  recalculateOpenTicketSlas: vi.fn(() => Promise.resolve({ message: 'Recalculated SLA deadlines for 3 open ticket(s).', recalculated: 3 })),
}));

// Mock configurationService
vi.mock('@/services/configurationService', () => ({
  getMessagingConfiguration: vi.fn(),
  updateMessagingConfiguration: vi.fn(),
  resetMessagingConfiguration: vi.fn(),
  getEmailConfiguration: vi.fn(() => Promise.resolve({})),
  getEmailTemplates: vi.fn(() => Promise.resolve([])),
  getNotificationChannels: vi.fn(() => Promise.resolve({})),
  getFeedbackQuestions: vi.fn(() => Promise.resolve([])),
  getFeedbackFormStatus: vi.fn(() => Promise.resolve({})),
  getCategoryFeedbackToggles: vi.fn(() => Promise.resolve({})),
  getCachedWindowConfiguration: vi.fn(() => ({})),
  getWindowConfiguration: vi.fn(() => Promise.resolve({})),
  getNotificationRouting: vi.fn(() => Promise.resolve({})),
  getTransitionRulesConfig: vi.fn(() => Promise.resolve({})),
  getBusinessHoursConfig: vi.fn(() => Promise.resolve({ enabled: true, timezone: 'Asia/Manila', startTime: '08:00', endTime: '17:00', workingDays: [1, 2, 3, 4, 5] })),
  updateBusinessHoursConfig: vi.fn((p) => Promise.resolve(p)),
  getFileLimitsConfig: vi.fn(() => Promise.resolve({})),
}));

describe('SuperAdminTicketConfig Messaging Subtabs & Internal Configuration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockMessagingConfig = {
    allow_customer_support: true,
    allow_delegated_employee: true,
    allow_full_thread_history: true,
    allow_employee_file_attachments: true,
    allow_customer_file_attachments: true,
    internal: {
      mode: 'requestor_cs_delegated',
      allow_direct_assigned: true,
      allow_full_history: true,
      notify_on_activity: true,
    },
  };

  it('renders messaging tab with External Tickets and Internal Tickets segmented control', async () => {
    configurationService.getMessagingConfiguration.mockResolvedValueOnce(mockMessagingConfig);

    render(<SuperAdminTicketConfig />);

    expect(await screen.findByText('Ticket Messaging Configuration')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /External Customer Tickets/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Internal Employee Tickets/i })).toBeInTheDocument();
  });

  it('switches between External and Internal ticket configurations', async () => {
    configurationService.getMessagingConfiguration.mockResolvedValueOnce(mockMessagingConfig);

    render(<SuperAdminTicketConfig />);

    await screen.findByText('Ticket Messaging Configuration');

    // Default is external
    expect(screen.getByText('Baseline Participants')).toBeInTheDocument();

    // Click Internal Employee Tickets segmented sub-tab
    const internalTabButton = screen.getByRole('button', { name: /Internal Employee Tickets/i });
    fireEvent.click(internalTabButton);

    // Should now display internal configuration cards
    expect(await screen.findByText('Internal Communication Mode')).toBeInTheDocument();
    expect(screen.getByText('Direct Collaboration Rules')).toBeInTheDocument();
    expect(screen.getByText(/Security.*AI Isolation/i)).toBeInTheDocument();
    expect(screen.getByText(/Requestor.*CS Only/i)).toBeInTheDocument();
  });

  it('allows SuperAdmin to switch internal mode and save the updated configuration', async () => {
    configurationService.getMessagingConfiguration.mockResolvedValueOnce(mockMessagingConfig);
    configurationService.updateMessagingConfiguration.mockResolvedValueOnce({
      success: true,
      data: {
        ...mockMessagingConfig,
        internal: {
          ...mockMessagingConfig.internal,
          mode: 'requestor_cs_only',
        },
      },
    });

    render(<SuperAdminTicketConfig />);

    await screen.findByText('Ticket Messaging Configuration');

    // Switch to Internal Employee Tickets
    fireEvent.click(screen.getByRole('button', { name: /Internal Employee Tickets/i }));

    // Select Requestor -> CS Only mode radio
    const csOnlyRadio = screen.getByDisplayValue('requestor_cs_only');
    fireEvent.click(csOnlyRadio);

    // Click Save Settings button
    const saveButton = screen.getByRole('button', { name: /Save Settings/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(configurationService.updateMessagingConfiguration).toHaveBeenCalledWith(
        expect.objectContaining({
          internal: expect.objectContaining({
            mode: 'requestor_cs_only',
          }),
        })
      );
    });
  });

  it('resets messaging settings back to system defaults including internal configuration', async () => {
    configurationService.getMessagingConfiguration.mockResolvedValueOnce(mockMessagingConfig);
    configurationService.resetMessagingConfiguration.mockResolvedValueOnce({
      success: true,
      data: mockMessagingConfig,
    });

    render(<SuperAdminTicketConfig />);

    await screen.findByText('Ticket Messaging Configuration');

    const resetButton = screen.getByRole('button', { name: /Reset to Defaults/i });
    fireEvent.click(resetButton);

    await waitFor(() => {
      expect(configurationService.resetMessagingConfiguration).toHaveBeenCalled();
    });
  });
});

describe('SuperAdminTicketConfig - SLA business hours', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const router = await import('react-router-dom');
    router.useParams.mockReturnValue({ subtab: 'sla' });
    router.useLocation.mockReturnValue({ pathname: '/ticketing/superadmin/config/sla' });
    ticketService.getDepartments.mockResolvedValue({ departments: [{ id: 1, name: 'Service' }] });
    ticketService.getSuperAdminConfig.mockResolvedValue({
      equipment: [],
      ticket_categories: [],
      priorities: [{ id: 1, name: 'Low' }, { id: 2, name: 'Medium' }, { id: 3, name: 'High' }],
    });
    ticketService.getSLARules.mockResolvedValue({ sla_rules: [] });
    configurationService.getMessagingConfiguration.mockResolvedValue({});
    configurationService.updateMessagingConfiguration?.mockResolvedValue?.({});
    configurationService.resetMessagingConfiguration?.mockResolvedValue?.({});
  });

  it('lists only the database priorities and no hardcoded Critical', async () => {
    render(<SuperAdminTicketConfig />);
    expect(await screen.findByText('Business Hours')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('High:')).toBeInTheDocument());
    expect(screen.queryByText('Critical:')).not.toBeInTheDocument();
  });

  it('confirms before saving business hours, then saves them', async () => {
    render(<SuperAdminTicketConfig />);
    const start = await screen.findByLabelText('Start Time');
    fireEvent.change(start, { target: { value: '09:00' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Business Hours/i }));

    expect(await screen.findByText('Update Business Hours?')).toBeInTheDocument();
    const confirmButtons = screen.getAllByRole('button', { name: /Save Business Hours/i });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => expect(configurationService.updateBusinessHoursConfig).toHaveBeenCalledWith(
      expect.objectContaining({ startTime: '09:00', timezone: 'Asia/Manila', workingDays: [1, 2, 3, 4, 5] })
    ));
    // Saving business hours also moves existing open tickets onto the new hours.
    await waitFor(() => expect(ticketService.recalculateOpenTicketSlas).toHaveBeenCalledTimes(1));
  });

  it('warns when business hours use a timezone other than the local one and offers a fix', async () => {
    configurationService.getBusinessHoursConfig.mockResolvedValueOnce({ enabled: true, timezone: 'Pacific/Kiritimati', startTime: '09:00', endTime: '17:00', workingDays: [1, 2, 3, 4, 5] });
    const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    render(<SuperAdminTicketConfig />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/not your local time/);
    fireEvent.click(screen.getByRole('button', { name: `Use ${localTz}` }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Timezone')).toHaveValue(localTz);
  });

  it('recalculates open ticket deadlines after confirmation', async () => {
    render(<SuperAdminTicketConfig />);
    fireEvent.click(await screen.findByRole('button', { name: /Recalculate Open Tickets/i }));
    expect(await screen.findByText('Recalculate Open Ticket Deadlines?')).toBeInTheDocument();
    expect(ticketService.recalculateOpenTicketSlas).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Recalculate' }));
    await waitFor(() => expect(ticketService.recalculateOpenTicketSlas).toHaveBeenCalledTimes(1));
  });

  it('warns that SLA limits count only during working hours before saving department rules', async () => {
    render(<SuperAdminTicketConfig />);
    fireEvent.click(await screen.findByText('Service'));

    for (const name of ['High', 'Medium', 'Low']) {
      fireEvent.change(await screen.findByLabelText(`${name} response limit`), { target: { value: '30' } });
      fireEvent.change(screen.getByLabelText(`${name} resolution limit`), { target: { value: '4' } });
      fireEvent.change(screen.getByLabelText(`${name} resolution limit unit`), { target: { value: 'hours' } });
    }

    fireEvent.click(screen.getAllByRole('button', { name: /Save SLA Rules for Service/i })[0]);

    expect(await screen.findByText('Save SLA Rules?')).toBeInTheDocument();
    expect(screen.getByText(/only count during working hours: 08:00 to 17:00 \(Asia\/Manila\)/)).toBeInTheDocument();
    expect(ticketService.saveDepartmentSLARules).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Save SLA Rules' }));
    await waitFor(() => expect(ticketService.saveDepartmentSLARules).toHaveBeenCalledWith(1, expect.arrayContaining([
      { priority: 'High', response_time_limit: 30, resolution_time_limit: 240 },
    ])));
  });
});
