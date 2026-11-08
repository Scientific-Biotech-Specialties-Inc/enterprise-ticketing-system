import React from 'react';
import { statusColors, priorityColors } from '@/constants/employeeTickets';
import { formatDisplayDate } from '@/utils/dateUtils';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';

/**
 * First step when opening an assignment: summary + Accept / Reject (not shown in the table).
 */
export default function AssignmentSummaryModal({ ticket, onClose }) {
  useLockBodyScroll(!!ticket);

  if (!ticket) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-[1.5px] p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 relative flex flex-col max-h-[85vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-8 pb-0 shrink-0">
          <div>
            <p className="text-field-label uppercase text-gray-400 mb-2">New assignment</p>
            <h2 className="text-modal-title text-gray-900 mb-1 pr-8">Ticket summary</h2>
            <p className="text-sm text-gray-500">Review the ticket details.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 text-gray-400 shrink-0"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 pt-6 space-y-4">
          <div className="flex flex-wrap gap-2">
            <span className="text-badge text-[#252578] bg-blue-50 px-3 py-1 rounded-full">{ticket.id}</span>
            <span className={`text-badge px-3 py-1 rounded-full ${statusColors[ticket.status]}`}>{ticket.status}</span>
            <span className={`text-badge px-3 py-1 rounded-full ${priorityColors[ticket.priority]}`}>{ticket.priority}</span>
          </div>

          <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-4 space-y-3 text-sm">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-dark mb-0.5">Ticket Title</p>
              <p className="text-sm font-normal text-slate-600">{ticket.title}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-dark mb-0.5">Requestor</p>
              <p className="text-sm font-normal text-slate-600">{ticket.customer}</p>
              {ticket.facility && <p className="text-xs font-normal text-slate-400 mt-0.5">{ticket.facility}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-dark mb-0.5">Equipment/Machine</p>
                <p className="text-sm font-normal text-slate-600">{ticket.equipment}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-dark mb-0.5">Category</p>
                <p className="text-sm font-normal text-slate-600">{ticket.category}</p>
              </div>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-dark mb-0.5">Date Filed</p>
              <p className="text-sm font-normal text-slate-600">{formatDisplayDate(ticket.date)}</p>
            </div>
          </div>
        </div>

        <div className="flex justify-end p-8 pt-4 border-t border-gray-100 shrink-0 bg-white">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-[#252578] text-white text-button hover:bg-[#1a1a5c]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
