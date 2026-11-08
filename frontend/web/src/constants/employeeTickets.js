export const recentProgress = [
  {
    id: 'TKT-0001',
    title: 'MRI Machine Not Powering On',
    time: 'Mar 22, 02:30 PM',
    desc: 'Conducted on-site inspection. Power distribution board is confirmed faulty — all capacitors on Line ...',
    attachments: 2,
  },
];

export const priorityColors = {
  Critical: 'bg-red-100 text-red-700',
  High: 'bg-orange-100 text-orange-700',
  Medium: 'bg-yellow-100 text-yellow-700',
  Low: 'bg-green-100 text-green-700',
};

export const statusColors = {
  'In Progress': 'bg-blue-100 text-blue-700',
  Open: 'bg-amber-100 text-amber-700',
  'Pending Assignment': 'bg-amber-100 text-amber-700',
  Resolved: 'bg-green-100 text-green-700',
  Escalated: 'bg-red-100 text-red-700',
  Closed: 'bg-gray-100 text-gray-700',
  Pending: 'bg-orange-100 text-orange-700',
  'Pending Evaluation': 'bg-purple-100 text-purple-700',
  Reopened: 'bg-red-100 text-red-700',
  New: 'bg-blue-100 text-blue-700',
  Ongoing: 'bg-indigo-100 text-indigo-700',
  Discarded: 'bg-red-100 text-red-700',
  'On Hold': 'bg-amber-100 text-amber-800 border border-amber-300 font-semibold',
  'Pending Reassignment': 'bg-amber-100 text-amber-800 border-amber-200',
  'Reassignment Failed': 'bg-rose-100 text-rose-800 border-rose-200',
  'Reassignment Disapproved': 'bg-rose-100 text-rose-800 border-rose-200',
};

export const slaStatusColors = {
  'At Risk': 'bg-amber-100 text-amber-800',
  Breached: 'bg-red-100 text-red-800',
  'On Track': 'bg-green-100 text-green-800',
};

const PRIORITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };

export function sortTicketsByPriority(list, direction = 'desc') {
  const mul = direction === 'desc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 9;
    const pb = PRIORITY_ORDER[b.priority] ?? 9;
    return (pa - pb) * mul;
  });
}
