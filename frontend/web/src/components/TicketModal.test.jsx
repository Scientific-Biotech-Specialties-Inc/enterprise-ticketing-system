import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import TicketModal from './TicketModal';

vi.mock('@/services/ticketService', () => {
  const options = {
    equipment_options: [{ value: 7, label: 'Centrifuge - SN001' }],
    category_options: [{ value: 3, label: 'Hardware' }],
    machines: [],
    problem_categories: [],
  };
  return {
    getCachedTicketFormOptions: () => options,
    getTicketFormOptions: vi.fn().mockResolvedValue(options),
  };
});

const LOWERCASE_TITLE = 'printer not working';
const DESCRIPTION = 'The printer on floor two jams every time we print.';

const field = (name) => document.querySelector(`[name="${name}"]`);

const setValue = (el, value) => fireEvent.change(el, { target: { value } });
const choose = (name, value) => setValue(field(name), String(value));

async function fillBasics({ title = LOWERCASE_TITLE } = {}) {
  await waitFor(() => expect(field('problem_category_ID').options.length).toBeGreaterThan(1));
  const titleInput = screen.getByPlaceholderText('Brief description of the issue');
  setValue(titleInput, title);
  fireEvent.blur(titleInput);
  choose('problem_category_ID', 3);
  setValue(field('description'), DESCRIPTION);
}

function renderModal(props = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<TicketModal isOpen onClose={vi.fn()} onSubmit={onSubmit} {...props} />);
  return { onSubmit };
}

describe('TicketModal title casing prompt (covers: AC-7)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows no casing prompt when the title loses focus to a dropdown', async () => {
    renderModal();
    await fillBasics();

    fireEvent.focus(field('machine_ID'));
    fireEvent.click(field('machine_ID'));

    expect(screen.queryByText('Proper Casing Applied')).not.toBeInTheDocument();
  });

  it('shows the casing prompt only after Submit when the title needs casing', async () => {
    const { onSubmit } = renderModal();
    await fillBasics();
    choose('machine_ID', 7);

    expect(screen.queryByText('Proper Casing Applied')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Submit Ticket' }));

    expect(await screen.findByText('Proper Casing Applied')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits straight away when the title is already in proper casing', async () => {
    const { onSubmit } = renderModal();
    await fillBasics({ title: 'Printer Not Working' });
    choose('machine_ID', 7);

    fireEvent.click(screen.getByRole('button', { name: 'Submit Ticket' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Proper Casing Applied')).not.toBeInTheDocument();
  });
});

describe('TicketModal department rule (covers: AC-8)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hides the department selector by default so customer pages are unchanged', async () => {
    renderModal();
    await waitFor(() => expect(field('problem_category_ID')).toBeInTheDocument());

    expect(field('department_id')).toBeNull();
    expect(field('machine_ID')).toBeRequired();
  });

  it('does not send department_id when the selector is off', async () => {
    const { onSubmit } = renderModal();
    await fillBasics({ title: 'Printer Not Working' });
    choose('machine_ID', 7);

    fireEvent.click(screen.getByRole('button', { name: 'Submit Ticket' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('department_id');
  });

  it('keeps Submit disabled for a Service ticket with no equipment', async () => {
    renderModal({ showDepartmentSelector: true });
    await fillBasics({ title: 'Printer Not Working' });

    expect(field('department_id').value).toBe('1');
    expect(field('machine_ID')).toBeRequired();
    expect(screen.getByRole('button', { name: 'Submit Ticket' })).toBeDisabled();
  });

  it('lets an IT ticket submit with no equipment and labels it optional', async () => {
    const { onSubmit } = renderModal({ showDepartmentSelector: true });
    await fillBasics({ title: 'Printer Not Working' });

    choose('department_id', 2);

    expect(screen.getByText('(Optional for IT)')).toBeInTheDocument();
    expect(field('machine_ID')).not.toBeRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Submit Ticket' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.department_id).toBe(2);
    expect(payload.machine_ID).toBe('');
  });

  it('requires equipment again after switching from IT back to Service', async () => {
    renderModal({ showDepartmentSelector: true });
    await fillBasics({ title: 'Printer Not Working' });

    choose('department_id', 2);
    choose('department_id', 1);

    expect(screen.getByRole('button', { name: 'Submit Ticket' })).toBeDisabled();
  });
});
