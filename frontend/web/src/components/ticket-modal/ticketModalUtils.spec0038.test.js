import { describe, it, expect } from 'vitest';
import { getAssigneeList, getMessagesPath } from './ticketModalUtils';

describe('getAssigneeList (spec 0038 AC-7 / AC-10 / AC-11)', () => {
  it('lists every active assignee in order with its own status and reminder time', () => {
    const ticket = {
      assigned_employees: [
        { id: 4, name: 'Ana Cruz', department: 'Service', assignment_status: 'accepted', last_reminder_sent_at: '2026-11-11T01:00:00Z' },
        { id: 1093, name: 'Ben Reyes', department: 'Service', assignment_status: 'assigned' },
        { id: 7, name: 'Done Person', department: 'Service', assignment_status: 'accepted', completed_at: '2026-11-10T00:00:00Z' },
        { id: 8, name: 'Moving On', department: 'Service', assignment_status: 'reassign_requested' },
      ],
    };
    const list = getAssigneeList(ticket);
    expect(list.map((a) => a.id)).toEqual([4, 1093]);
    expect(list[0]).toMatchObject({ firstName: 'Ana', isAccepted: true, lastReminderSentAt: '2026-11-11T01:00:00Z' });
    expect(list[1]).toMatchObject({ firstName: 'Ben', isAccepted: false, lastReminderSentAt: null });
  });

  it('returns an empty list when nobody is actively assigned', () => {
    expect(getAssigneeList({ assigned_employees: [] })).toEqual([]);
    expect(getAssigneeList({})).toEqual([]);
  });
});

describe('getMessagesPath (spec 0038 AC-17 / AC-18)', () => {
  it.each([
    ['/cs/incoming', '/cs/messages'],
    ['/cs-manager/tickets/12', '/cs-manager/messages'],
    ['/service-manager/dashboard', '/service-manager/messages'],
    ['/it-manager', '/it-manager/messages'],
    ['/employee/ticket-update', '/employee/messages'],
    ['/my-tickets', '/messages'],
    ['/', '/messages'],
  ])('maps %s to %s', (pathname, expected) => {
    expect(getMessagesPath(pathname)).toBe(expected);
  });
});
