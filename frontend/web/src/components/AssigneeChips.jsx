import React from 'react';

/**
 * Every assignee of a ticket as a chip, with an `X of N Accepted` count when N > 1.
 * Extracted from CSAssigned (spec 0043 AC-18) and shared by CS Incoming and the summary modal.
 *
 * Reads `assigned_employees[]` ({ id, name, assignment_status }). Falls back to the single
 * `assigned_employee` name so single assignee tickets look as they always did.
 */
export const assigneeListFor = (ticket) => {
  if (Array.isArray(ticket?.assigned_employees) && ticket.assigned_employees.length > 0) {
    return ticket.assigned_employees;
  }
  return ticket?.assigned_employee
    ? [{ name: ticket.assigned_employee, assignment_status: ticket.accepted ? 'accepted' : 'assigned' }]
    : [];
};

export default function AssigneeChips({ ticket, emptyLabel = 'Unassigned' }) {
  const list = assigneeListFor(ticket);

  if (list.length === 0) {
    return <span className="text-xs text-muted-foreground italic font-normal">{emptyLabel}</span>;
  }

  const acceptedCount = list.filter((e) => e.assignment_status === 'accepted').length;

  return (
    <div className="flex flex-col gap-1" data-testid="assignee-chips">
      {list.length > 1 && (
        <span className="text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">
          {acceptedCount} of {list.length} Accepted
        </span>
      )}
      <div className="flex flex-wrap gap-1.5">
        {list.map((emp, i) => {
          const isAcc = emp.assignment_status === 'accepted';
          const isReassign = emp.assignment_status === 'reassign_requested';
          return (
            <span
              key={emp.id || emp.emp_id || i}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${
                isAcc
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : isReassign
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-slate-50 text-slate-700 border-slate-200'
              }`}
              title={isAcc ? 'Accepted' : isReassign ? 'Reassignment Requested' : 'Pending Acceptance'}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isAcc ? 'bg-emerald-500' : isReassign ? 'bg-amber-500' : 'bg-slate-400'
                }`}
              />
              <span className="truncate max-w-[130px]">{emp.name}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
