import React from 'react';
import { isReassignmentDenied, getReassignmentDisapprovalReason } from '@/utils/reassignmentUtils';

export default function ReassignmentDisapprovalBanner({ ticket, className = '', onRequestReassignAgain }) {
  if (!ticket || !isReassignmentDenied(ticket)) return null;

  const reason = getReassignmentDisapprovalReason(ticket);

  return (
    <div
      className={`rounded-2xl border border-red-200 bg-red-50/80 p-4 shadow-xs transition-all animate-in fade-in duration-200 ${className}`}
      role="alert"
    >
      <div className="flex items-start gap-3.5">
        <div className="mt-0.5 rounded-full bg-red-100 p-2 text-red-600 shrink-0 shadow-2xs">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
            <h4 className="text-sm font-bold text-red-900 tracking-tight flex items-center gap-2">
              Reassignment Request Disapproved
            </h4>
            <span className="inline-flex items-center text-[10px] font-extrabold uppercase tracking-wider text-red-700 bg-red-100 px-2.5 py-0.5 rounded-full border border-red-200/60">
              Rejected by CSR
            </span>
          </div>

          <div className="mt-2 rounded-xl bg-white border border-red-150 p-3 shadow-2xs">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
              CSR Reason for Disapproval:
            </p>
            <p className="text-sm font-semibold text-gray-900 leading-relaxed break-words">
              {reason ? `"${reason}"` : (
                <span className="text-gray-500 italic font-normal">
                  No specific reason provided by customer support coordinator.
                </span>
              )}
            </p>
          </div>

          <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs text-red-700/90 leading-normal">
              Your request to reassign this ticket was disapproved. You may request reassignment again with updated details or proceed with troubleshooting.
            </p>
            {typeof onRequestReassignAgain === 'function' && (
              <button
                type="button"
                onClick={onRequestReassignAgain}
                className="px-3.5 py-1.5 text-xs font-bold rounded-xl border border-red-300 bg-white text-red-700 hover:bg-red-50 hover:border-red-400 transition-all shadow-2xs"
              >
                Request Reassignment Again
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
