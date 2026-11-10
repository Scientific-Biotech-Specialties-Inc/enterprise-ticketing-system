import React, { useState } from 'react';
import { X, Loader2, AlertCircle } from 'lucide-react';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';

/**
 * RejectReasonModal component
 * Small dialog with a REQUIRED reason textarea for rejecting reassignment requests.
 */
export default function RejectReasonModal({
  isOpen,
  onClose,
  onConfirmReject,
  technicianName = 'technician',
  isSubmitting = false,
}) {
  useLockBodyScroll(isOpen);
  const [reason, setReason] = useState('');
  const [validationError, setValidationError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed || trimmed.length < 5) {
      setValidationError('Please provide a specific reason for rejection (at least 5 characters).');
      return;
    }
    setValidationError('');
    onConfirmReject(trimmed);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reject-dialog-title"
      className="fixed inset-0 z-[65] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px] overscroll-none animate-in fade-in duration-150"
    >
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto overscroll-contain rounded-2xl bg-white p-5 sm:p-6 shadow-2xl border border-[#D5D9E4] space-y-4 animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-[#D5D9E4] pb-3">
          <h3 id="reject-dialog-title" className="text-base font-bold text-[#1B2033]">
            Reject Reassignment Request
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-[#5A6178] hover:text-[#1B2033] hover:bg-[#F5F6FA] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed">
          Provide a clear explanation for why this reassignment request is rejected. This reason will be dispatched to <strong className="font-semibold text-slate-800">{technicianName}</strong> and logged in the ticket history.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="rejection-reason" className="block text-xs font-bold text-slate-700 uppercase tracking-wide mb-1">
              Reason for Rejection <span className="text-[#B42318]">*</span>
            </label>
            <textarea
              id="rejection-reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (validationError) setValidationError('');
              }}
              rows={4}
              maxLength={1000}
              placeholder="Explain why this request is declined and what action the technician should take..."
              className="w-full text-xs sm:text-sm border border-[#D5D9E4] rounded-lg p-3 bg-white text-[#1B2033] outline-none focus:ring-2 focus:ring-[#B42318]/25 focus:border-[#B42318] leading-relaxed resize-none"
              required
            />
            <div className="flex items-center justify-between mt-1 text-[11px] text-slate-500">
              <span>{validationError ? <span className="text-[#B42318] flex items-center gap-1 font-medium"><AlertCircle className="w-3.5 h-3.5" />{validationError}</span> : 'Mandatory requirement'}</span>
              <span>{reason.length}/1,000</span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#D5D9E4]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="min-h-[44px] px-4 rounded-lg border border-[#D5D9E4] hover:bg-[#F5F6FA] text-xs font-semibold text-[#1B2033] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !reason.trim()}
              className="min-h-[44px] px-4 rounded-lg bg-[#B42318] hover:bg-red-800 text-white text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer inline-flex items-center gap-1.5 shadow-xs"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Confirm Rejection
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

