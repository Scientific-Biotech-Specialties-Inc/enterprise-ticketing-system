import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EmployeeProgress from './EmployeeProgress';
import CSHistory from './CSHistory';
import EmployeeMyTickets from './EmployeeMyTickets';
import EmployeeAssigned from './EmployeeAssigned';
import MyTickets from './MyTickets';
import CustomerTicketDetailModal from '@/components/CustomerTicketDetailModal';
import { TicketSummary } from '@/components/CSModals';
import * as authContextModule from '@/context/AuthContext';
import * as ticketServiceModule from '@/services/ticketService';

const mockNavigate = vi.fn();

vi.mock('@/components/TicketModal', () => ({
  default: ({ isOpen, onSubmit }) =>
    isOpen ? (
      <div data-testid="mock-ticket-modal">
        <button
          type="button"
          data-testid="mock-submit-ticket-btn"
          onClick={() =>
            onSubmit({
              title: 'New MRI Compressor Issue',
              problem_category_ID: 1,
              description: 'Compressor oil level low',
            })
          }
        >
          Mock Submit
        </button>
      </div>
    ) : null,
}));

vi.mock('@/services/echo', () => ({
  default: {
    channel: vi.fn(() => ({ listen: vi.fn() })),
    private: vi.fn(() => ({ listen: vi.fn() })),
    disconnect: vi.fn(),
  },
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => ({ state: null, pathname: '/employee/progress' }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});

vi.mock('@/services/ticketService', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getEmployeeAssignedTickets: vi.fn(),
    getInternalTickets: vi.fn(),
    getCSIncomingTickets: vi.fn(),
    getDepartments: vi.fn().mockResolvedValue([]),
    getAssignableEmployees: vi.fn().mockResolvedValue([]),
    getTicketDetails: vi.fn(),
    reopenTicket: vi.fn(),
    getTicketDrafts: vi.fn().mockResolvedValue([]),
    getCustomerTickets: vi.fn().mockResolvedValue([]),
    getTicketFormOptions: vi.fn().mockResolvedValue({
      departments: [],
      categories: [],
      ticket_priorities: [],
      equipment_options: [],
      machines: [],
      problem_categories: [],
    }),
    getTicketConfig: vi.fn().mockResolvedValue({ autoCloseWindowDays: 2, reopenWindowDays: 2 }),
    clearEmployeeTicketsCache: vi.fn(),
    createInternalTicket: vi.fn(),
    assignTicketToEmployees: vi.fn(),
    getEligibleEmployees: vi.fn().mockResolvedValue({ eligible_employees: [], ineligible_employees: [] }),
  };
});

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

describe('Ticket History Filters & Internal Summary Modal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();

    authContextModule.useAuth.mockReturnValue({
      user: { id: 10, emp_id: 10, name: 'John Tech', email: 'john@hospital.org', role: 'employee' },
      isAuthenticated: true,
    });
  });

  const mockAssignedTickets = [
    {
      id: 'TKT-0001',
      ticket_ID: 1,
      title: 'Customer MRI Gradient Coil Failure',
      status: 'Resolved',
      priority: 'High',
      category: 'MRI',
      customer: 'St. Jude Hospital',
      is_internal: false,
      ticket_type: 'External',
      date: '2026-11-01T08:00:00Z',
    },
  ];

  const mockInternalTickets = [
    {
      id: 'TKT-0002',
      ticket_ID: 2,
      title: 'Internal Lab Centrifuge Repair Request',
      status: 'Closed',
      priority: 'Medium',
      category: 'Laboratory',
      customer: 'John Tech',
      is_internal: true,
      ticket_type: 'Internal',
      date: '2026-11-02T10:00:00Z',
    },
  ];

  it('filters Employee ticket history with [ALL | EXTERNAL | INTERNAL] pill toggle', async () => {
    ticketServiceModule.getEmployeeAssignedTickets.mockResolvedValueOnce(mockAssignedTickets);
    ticketServiceModule.getInternalTickets.mockResolvedValueOnce(mockInternalTickets);

    render(<EmployeeProgress />);

    await waitFor(() => {
      expect(screen.getByText('Customer MRI Gradient Coil Failure')).toBeInTheDocument();
      expect(screen.getByText('Internal Lab Centrifuge Repair Request')).toBeInTheDocument();
    });

    // Click EXTERNAL pill
    const externalPill = screen.getByRole('tab', { name: 'EXTERNAL' });
    fireEvent.click(externalPill);

    expect(screen.getByText('Customer MRI Gradient Coil Failure')).toBeInTheDocument();
    expect(screen.queryByText('Internal Lab Centrifuge Repair Request')).toBeNull();

    // Click INTERNAL pill
    const internalPill = screen.getByRole('tab', { name: 'INTERNAL' });
    fireEvent.click(internalPill);

    expect(screen.queryByText('Customer MRI Gradient Coil Failure')).toBeNull();
    expect(screen.getByText('Internal Lab Centrifuge Repair Request')).toBeInTheDocument();

    // Click ALL pill
    const allPill = screen.getByRole('tab', { name: 'ALL' });
    fireEvent.click(allPill);

    expect(screen.getByText('Customer MRI Gradient Coil Failure')).toBeInTheDocument();
    expect(screen.getByText('Internal Lab Centrifuge Repair Request')).toBeInTheDocument();
  });

  it('filters CS ticket history with [ALL | EXTERNAL | INTERNAL] pill toggle', async () => {
    ticketServiceModule.getCSIncomingTickets.mockResolvedValueOnce(mockAssignedTickets);
    ticketServiceModule.getInternalTickets.mockResolvedValueOnce(mockInternalTickets);

    render(<CSHistory roleContext="cs" />);

    await waitFor(() => {
      expect(screen.getByText('Customer MRI Gradient Coil Failure')).toBeInTheDocument();
      expect(screen.getByText('Internal Lab Centrifuge Repair Request')).toBeInTheDocument();
    });

    // Click EXTERNAL pill
    fireEvent.click(screen.getByRole('tab', { name: 'EXTERNAL' }));
    expect(screen.getByText('Customer MRI Gradient Coil Failure')).toBeInTheDocument();
    expect(screen.queryByText('Internal Lab Centrifuge Repair Request')).toBeNull();

    // Click INTERNAL pill
    fireEvent.click(screen.getByRole('tab', { name: 'INTERNAL' }));
    expect(screen.queryByText('Customer MRI Gradient Coil Failure')).toBeNull();
    expect(screen.getByText('Internal Lab Centrifuge Repair Request')).toBeInTheDocument();
  });

  it('only displays Closed and Resolved tickets in Employee ticket history, excluding active or discarded tickets', async () => {
    ticketServiceModule.getEmployeeAssignedTickets.mockResolvedValueOnce([
      ...mockAssignedTickets,
      {
        id: 'TKT-0003',
        ticket_ID: 3,
        title: 'Active In Progress Ventilator Service',
        status: 'In Progress',
        priority: 'High',
        category: 'Ventilator',
        customer: 'General Hospital',
        is_internal: false,
        reassignmentRequested: true,
      },
      {
        id: 'TKT-0004',
        ticket_ID: 4,
        title: 'Discarded Customer Ultrasound Request',
        status: 'Discarded',
        priority: 'Low',
        category: 'Ultrasound',
        customer: 'St. Mary Clinic',
        is_internal: false,
      },
    ]);
    ticketServiceModule.getInternalTickets.mockResolvedValueOnce(mockInternalTickets);

    render(<EmployeeProgress />);

    await waitFor(() => {
      expect(screen.getByText('Customer MRI Gradient Coil Failure')).toBeInTheDocument();
      expect(screen.getByText('Internal Lab Centrifuge Repair Request')).toBeInTheDocument();
    });

    expect(screen.queryByText('Active In Progress Ventilator Service')).toBeNull();
    expect(screen.queryByText('Discarded Customer Ultrasound Request')).toBeNull();
  });

  it('only displays Closed and Resolved tickets in CS ticket history, excluding active or discarded tickets', async () => {
    ticketServiceModule.getCSIncomingTickets.mockResolvedValueOnce([
      ...mockAssignedTickets,
      {
        id: 'TKT-0005',
        ticket_ID: 5,
        title: 'Open Triage Ticket Needing Assignment',
        status: 'Open',
        priority: 'Critical',
        category: 'X-Ray',
        customer: 'Metro Health',
        is_internal: false,
      },
    ]);
    ticketServiceModule.getInternalTickets.mockResolvedValueOnce(mockInternalTickets);

    render(<CSHistory roleContext="cs" />);

    await waitFor(() => {
      expect(screen.getByText('Customer MRI Gradient Coil Failure')).toBeInTheDocument();
      expect(screen.getByText('Internal Lab Centrifuge Repair Request')).toBeInTheDocument();
    });

    expect(screen.queryByText('Open Triage Ticket Needing Assignment')).toBeNull();
  });

  it('opens ticket summary modal in EmployeeMyTickets when clicking a row instead of redirecting to history page', async () => {
    ticketServiceModule.getInternalTickets.mockResolvedValueOnce([
      {
        id: 'TKT-0002',
        ticket_ID: 2,
        title: 'Internal Lab Centrifuge Repair Request',
        status: 'Open',
        priority: 'Medium',
        category: 'Laboratory',
        description: 'Centrifuge motor vibrating abnormally during high speed rotation.',
        equipment: 'Centrifuge CF-200',
        date_created: '2026-11-02T10:00:00Z',
      },
    ]);

    ticketServiceModule.getTicketDetails.mockResolvedValueOnce({
      id: 'TKT-0002',
      ticket_ID: 2,
      title: 'Internal Lab Centrifuge Repair Request',
      status: 'Open',
      priority: 'Medium',
      category: 'Laboratory',
      description: 'Centrifuge motor vibrating abnormally during high speed rotation.',
      equipment: 'Centrifuge CF-200',
      attachments: [],
      proofFiles: [],
    });

    render(<EmployeeMyTickets />);

    await waitFor(() => {
      expect(screen.getByText('Internal Lab Centrifuge Repair Request')).toBeInTheDocument();
    });

    // Click the ticket row
    fireEvent.click(screen.getByText('Internal Lab Centrifuge Repair Request'));

    // Should NOT navigate to /employee/history/2
    expect(mockNavigate).not.toHaveBeenCalledWith(expect.stringContaining('/history/2'), expect.anything());

    // Should open the summary modal with details
    await waitFor(() => {
      expect(screen.getByText('Centrifuge motor vibrating abnormally during high speed rotation.')).toBeInTheDocument();
    });

    // Modal can be closed
    const closeBtns = screen.getAllByRole('button', { name: /Close/i });
    fireEvent.click(closeBtns[0]);

    await waitFor(() => {
      expect(screen.queryByText('Centrifuge motor vibrating abnormally during high speed rotation.')).toBeNull();
    });
  });

  it('excludes message button from the customer table in MyTickets', async () => {
    ticketServiceModule.getCustomerTickets.mockResolvedValueOnce([
      {
        ticket_ID: 101,
        id: 'TKT-0101',
        title: 'Customer Ultrasound Calibration Issue',
        status: 'In Progress',
        priority: 'High',
        category: 'Ultrasound',
        assigned_to_name: 'Dr. Jane Smith',
        assigned_to: 5,
        date_created: '2026-11-05T09:00:00Z',
      },
    ]);

    authContextModule.useAuth.mockReturnValue({
      user: { id: 1, name: 'Customer Bob', email: 'bob@clinic.com', role: 'customer' },
      isAuthenticated: true,
    });

    render(<MyTickets />);

    await waitFor(() => {
      expect(screen.getByText('Customer Ultrasound Calibration Issue')).toBeInTheDocument();
      expect(screen.getByText('Dr. Jane Smith')).toBeInTheDocument();
    });

    // Ensure there is NO button labeled "Message" in the table
    expect(screen.queryByRole('button', { name: /Message/i })).toBeNull();
  });

  it('excludes resolved, closed, and discarded tickets from EmployeeAssigned (Incoming)', async () => {
    ticketServiceModule.getEmployeeAssignedTickets.mockResolvedValueOnce([
      {
        id: 'TKT-0201',
        ticket_ID: 201,
        title: 'Pending Calibration Service',
        status: 'Assigned',
        priority: 'Medium',
        category: 'MRI',
        accepted: false,
      },
      {
        id: 'TKT-0202',
        ticket_ID: 202,
        title: 'Resolved Equipment Task',
        status: 'Resolved',
        priority: 'High',
        category: 'X-Ray',
        accepted: false,
      },
      {
        id: 'TKT-0203',
        ticket_ID: 203,
        title: 'Closed Equipment Task',
        status: 'Closed',
        priority: 'Low',
        category: 'CT Scan',
        accepted: false,
      },
      {
        id: 'TKT-0204',
        ticket_ID: 204,
        title: 'Discarded Customer Task',
        status: 'Discarded',
        priority: 'Low',
        category: 'Ventilator',
        accepted: false,
      },
    ]);

    render(<EmployeeAssigned />);

    await waitFor(() => {
      expect(screen.getByText('Pending Calibration Service')).toBeInTheDocument();
    });

    expect(screen.queryByText('Resolved Equipment Task')).toBeNull();
    expect(screen.queryByText('Closed Equipment Task')).toBeNull();
    expect(screen.queryByText('Discarded Customer Task')).toBeNull();
  });

  it('renders "Message the assigned employee" when viewed in CS context, and "Message Customer Support" when viewed as customer', async () => {
    // 1. As CS user:
    authContextModule.useAuth.mockReturnValue({
      user: { id: 2, name: 'Alice CS', role: 'cs' },
      isAuthenticated: true,
    });

    const ticketWithAssignee = {
      id: 'TKT-0010',
      ticket_ID: 10,
      title: 'X-Ray Calibration Issue',
      status: 'In Progress',
      priority: 'High',
      assigned_to: 5,
      assigned_employee_name: 'Tech Bob',
      employee: { id: 5, name: 'Tech Bob' },
    };

    const { rerender } = render(
      <CustomerTicketDetailModal
        ticket={ticketWithAssignee}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Message the assigned employee')).toBeInTheDocument();
    expect(screen.queryByText('Message Customer Support')).toBeNull();

    // 2. As Customer:
    authContextModule.useAuth.mockReturnValue({
      user: { id: 1, name: 'Charlie Customer', role: 'customer' },
      isAuthenticated: true,
    });

    rerender(
      <CustomerTicketDetailModal
        ticket={ticketWithAssignee}
        isOpen={true}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Message Customer Support')).toBeInTheDocument();
    expect(screen.queryByText('Message the assigned employee')).toBeNull();
  });

  it('does not render "Message the assigned employee" in CSModals TicketSummary footer', () => {
    authContextModule.useAuth.mockReturnValue({
      user: { id: 2, name: 'Alice CS', role: 'cs' },
      isAuthenticated: true,
    });

    const ticketWithAssignee = {
      id: 'TKT-0011',
      ticket_ID: 11,
      title: 'ECG Monitor Display Fault',
      status: 'Assigned',
      priority: 'Medium',
      assigned: [{ id: 5, name: 'Tech Bob', department: 'Biomedical' }],
    };

    const employees = [
      { id: 5, name: 'Tech Bob', department: 'Biomedical', status: 'active' },
    ];

    render(
      <TicketSummary
        ticket={ticketWithAssignee}
        employees={employees}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByText('Message the assigned employee')).toBeNull();
    expect(screen.getByText('Message the customer')).toBeInTheDocument();
    expect(screen.getByText('Message Tech')).toBeInTheDocument();
  });

  it('opens AssignModal immediately upon CS creating a ticket so CS can assign an employee', async () => {
    ticketServiceModule.getInternalTickets.mockResolvedValue([]);
    ticketServiceModule.getAssignableEmployees.mockResolvedValue([
      { id: 22, emp_id: 22, name: 'Technician Mark', department: 'Service', is_active: 1 },
    ]);
    ticketServiceModule.getDepartments.mockResolvedValue([
      { id: 1, name: 'Customer Service' },
      { id: 2, name: 'Service' },
      { id: 3, name: 'IT' },
    ]);
    ticketServiceModule.createInternalTicket.mockResolvedValueOnce({
      id: 'TKT-0099',
      ticket: {
        ticket_ID: 99,
        title: 'New MRI Compressor Issue',
        description: 'Compressor oil level low',
      },
    });

    authContextModule.useAuth.mockReturnValue({
      user: { id: 2, emp_id: 2, name: 'Alice CS', email: 'alice@cs.org', role: 'cs' },
      isAuthenticated: true,
    });

    render(<EmployeeMyTickets roleContext="cs" />);

    // Click Create Ticket button
    fireEvent.click(screen.getByRole('button', { name: /Create Ticket/i }));

    // Submit using the mock ticket modal button
    await waitFor(() => {
      expect(screen.getByTestId('mock-submit-ticket-btn')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('mock-submit-ticket-btn'));

    // Now AssignModal should be visible on the spot with ticket ID
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Assign Ticket/i })).toBeInTheDocument();
      expect(screen.getAllByText('TKT-0099').length).toBeGreaterThanOrEqual(2);
    });
  });
});
