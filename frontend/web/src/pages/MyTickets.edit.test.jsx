import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as ticketService from '@/services/ticketService';
import MyTickets from './MyTickets';

vi.mock('@/services/ticketService', () => ({
  createTicket: vi.fn(),
  discardCustomerTicket: vi.fn(),
  getCachedTicketFormOptions: vi.fn(() => null),
  getCustomerTickets: vi.fn(),
  getTicketFormOptions: vi.fn(),
  saveCustomerTicketDetail: vi.fn(),
  getTicketDetails: vi.fn(),
  updateTicket: vi.fn(),
  reopenTicket: vi.fn(),
  getTicketDrafts: vi.fn(async () => []),
  deleteTicketDraft: vi.fn(),
  getCustomerFilterOptions: vi.fn(async () => ({})),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Customer One', role: 'customer' }, isAuthenticated: true }),
}));
vi.mock('@/hooks/useRealtimeRefresh', () => ({ default: () => {} }));
vi.mock('@/data/mockFeedbackData', () => ({
  hasFeedbackBeenSubmitted: () => false,
  fetchFeedbackForTicket: vi.fn(async () => null),
}));
vi.mock('@/components/CustomerTicketDetailModal', () => ({ default: () => null }));
vi.mock('@/components/TicketModal', () => ({ default: () => null }));

// TKT-0007 as the customer list returns it: Open, unassigned, AI could not classify, machine 2.
const ticket7 = {
  id: 'TKT-0007',
  ticket_ID: 7,
  title: 'Bedside Monitor - Hii',
  description: 'Results from the analyzer are not reaching the LIS and pending results are stuck.',
  status: 'Open',
  category: null,
  problem_category_ID: null,
  machine_ID: 2,
  equipment: 'Bedside Monitor - MON-500-A11',
  assigned_to: null,
  date_created: '2026-11-14T15:35:06Z',
};

const options = {
  problem_categories: [
    { problem_category_ID: 1, category_name: 'Software' },
    { problem_category_ID: 2, category_name: 'Service' },
  ],
  machines: [{ machine_ID: 2, machine_name: 'Bedside Monitor', serial_number: 'MON-500-A11' }],
};

async function openEditDialog() {
  render(
    <MemoryRouter>
      <MyTickets />
    </MemoryRouter>
  );
  await screen.findAllByText('Bedside Monitor - Hii');
  const trigger = document.querySelector('.menu-trigger, [aria-haspopup="menu"]');
  expect(trigger, 'row action menu trigger').toBeTruthy();
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('menuitem', { name: /edit/i }));
  await screen.findByText('Edit Ticket');
}

describe('Customer edit ticket save (spec 0043 AC-16)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    ticketService.getCustomerTickets.mockResolvedValue([ticket7]);
    ticketService.getTicketFormOptions.mockResolvedValue(options);
    ticketService.getTicketDetails.mockResolvedValue({ ...ticket7 });
    ticketService.updateTicket.mockResolvedValue({ ticket: { ...ticket7, title: 'Bedside Monitor - Hii' } });
  });

  it('switching tabs does not throw', async () => {
    render(
      <MemoryRouter>
        <MyTickets />
      </MemoryRouter>
    );
    await screen.findAllByText('Bedside Monitor - Hii');
    const closedTab = screen.getAllByRole('button').find((b) => /^Closed/.test(b.textContent.trim()));
    expect(closedTab).toBeTruthy();
    await act(async () => { fireEvent.click(closedTab); });
    await waitFor(() => expect(screen.queryByText('Bedside Monitor - Hii')).toBeNull());
  });

  it('Save Changes asks to confirm, then sends the PATCH', async () => {
    await openEditDialog();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save Changes' })); });

    const confirm = await screen.findByRole('button', { name: 'Update Ticket' }, { timeout: 2000 });
    await act(async () => { fireEvent.click(confirm); });

    await waitFor(() => expect(ticketService.updateTicket).toHaveBeenCalled());
    expect(ticketService.updateTicket.mock.calls[0][0]).toMatchObject({ ticketId: 7, machine_ID: 2 });
  });

  it('lets the customer pick a category; Software sends the category and no machine', async () => {
    await openEditDialog();

    const select = await screen.findByTestId('edit-category');
    await waitFor(() => expect(select).not.toBeDisabled());
    await act(async () => { fireEvent.change(select, { target: { value: '1' } }); });
    expect(screen.queryByLabelText(/Equipment/)).toBeNull();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save Changes' })); });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Update Ticket' })); });

    await waitFor(() => expect(ticketService.updateTicket).toHaveBeenCalled());
    expect(ticketService.updateTicket.mock.calls[0][0]).toMatchObject({ ticketId: 7, problem_category_ID: 1, machine_ID: null });
  });
});
