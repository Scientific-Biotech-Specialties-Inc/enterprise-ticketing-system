import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { isReassignmentDenied, getReassignmentDisapprovalReason } from '@/utils/reassignmentUtils';

/**
 * ReassignmentNotice component
 * Shown ONLY when an employee's reassignment request was declined.
 * Uses amber visual tokens: #FFF4E0 background, #F2C879 border, #7A4A00 text.
 * Replaces the old red "Reassignment Request Disapproved" banner.
 */
export default function ReassignmentNotice({
  ticket,
  onAskWhy,
  coordinatorName = null,
  className = '',
}) {
  if (!ticket || !isReassignmentDenied(ticket)) return null;

  const reason = getReassignmentDisapprovalReason(ticket);
  const coordinatorLabel = coordinatorName ? coordinatorName : 'coordinator';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-xl border border-[#F2C879] bg-[#FFF4E0] p-4 text-xs leading-relaxed transition-all shadow-xs ${className}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          <AlertTriangle className="w-4 h-4 text-[#7A4A00] shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <h4 className="text-xs font-bold text-[#7A4A00]">
              Your reassignment request wasn&apos;t approved
            </h4>

            {reason ? (
              <div className="mt-2 p-2.5 rounded-lg bg-white/70 border border-[#F2C879]/70 text-xs">
                <span className="text-[11px] font-bold uppercase tracking-wider block text-[#7A4A00] mb-0.5">
                  Reason from {coordinatorLabel}:
                </span>
                <p className="text-xs font-semibold text-[#7A4A00] italic break-words">
                  &quot;{reason}&quot;
                </p>
              </div>
            ) : (
              <p className="mt-1 text-xs text-[#7A4A00] leading-relaxed">
                The coordinator didn&apos;t give a reason. You can accept this ticket, or ask again with new details.
              </p>
            )}

            {typeof onAskWhy === 'function' && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={onAskWhy}
                  className="min-h-[44px] px-4 py-2 rounded-lg border border-[#F2C879] bg-white text-[#7A4A00] hover:bg-[#FFF4E0] font-semibold text-xs transition-colors cursor-pointer shadow-2xs"
                >
                  Ask coordinator why
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

