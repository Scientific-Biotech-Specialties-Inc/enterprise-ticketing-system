import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * TechnicianDecisionCard component
 * Shown when an assigned ticket is awaiting acceptance by the technician.
 * 2px navy border, #F7F8FD background.
 * Primary "Accept ticket" button (navy fill) + Outlined "Request reassignment [again]" button.
 * Stacks vertically on mobile (<640px) with Accept first.
 */
export default function TechnicianDecisionCard({
  onAccept,
  onRequestReassign,
  isDeclined = false,
  isAccepting = false,
  isProcessing = false,
  className = '',
}) {
  const isBusy = isAccepting || isProcessing;

  return (
    <div
      className={`border-2 border-[#1E2A78] bg-[#F7F8FD] rounded-xl p-4 sm:p-5 space-y-3.5 shadow-sm transition-all ${className}`}
    >
      {/* Label */}
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-[#1E2A78] inline-block" />
        <h3 className="text-xs font-bold tracking-wider uppercase text-[#1E2A78]">
          ACTION NEEDED
        </h3>
      </div>

      {/* Main explanation text */}
      <p className="text-sm text-[#1B2033] leading-relaxed font-normal">
        This ticket is assigned to you. Accept it to start work.
      </p>

      {/* Decision Buttons: desktop row, mobile column with Accept first */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-1">
        <button
          type="button"
          disabled={isBusy}
          onClick={onAccept}
          aria-label="Accept"
          className="min-h-[44px] px-6 py-2.5 bg-[#1E2A78] hover:bg-[#151E56] text-white font-semibold text-sm rounded-lg shadow-xs transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isAccepting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-white" />
              <span>Accepting...</span>
            </>
          ) : (
            <span>Accept ticket</span>
          )}
        </button>

        <button
          type="button"
          disabled={isBusy}
          onClick={onRequestReassign}
          aria-label={isDeclined ? 'Request reassignment again' : 'Request reassignment'}
          className="min-h-[44px] px-6 py-2.5 border border-[#1E2A78] bg-white text-[#1E2A78] hover:bg-[#F5F6FA] font-semibold text-sm rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isDeclined ? 'Request reassignment again' : 'Request reassignment'}
        </button>
      </div>

      {/* Helper text after a declined request */}
      {isDeclined && (
        <p className="text-xs text-[#5A6178] mt-1 font-medium">
          Requesting again needs a new reason.
        </p>
      )}
    </div>
  );
}

