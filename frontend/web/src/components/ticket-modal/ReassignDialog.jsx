import React, { useState, useEffect, useRef } from 'react';
import { X, Loader2, AlertCircle } from 'lucide-react';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';

/**
 * ReassignDialog component
 * Accessible modal dialog for technicians to submit or re-submit a reassignment request.
 * Enforces:
 * - Non-empty required reason
 * - If previously declined, the new reason cannot be identical to the previous one.
 */
export default function ReassignDialog({
  isOpen = false,
  ticket,
  previousReason = '',
  onClose,
  onSubmit, // async (newReason) => void
  isSubmitting = false,
}) {
  useLockBodyScroll(isOpen);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setReason('');
      setError('');
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose?.();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const isDeclined = Boolean(previousReason && previousReason.trim());
  const ticketRef = ticket?.id || (ticket?.ticket_ID ? `TKT-${String(ticket.ticket_ID).padStart(4, '0')}` : 'Ticket');

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = reason.trim();

    if (!trimmed) {
      setError('Please provide a reason for the reassignment request.');
      return;
    }

    if (isDeclined && previousReason) {
      const cleanPrev = previousReason.trim().toLowerCase();
      const cleanNew = trimmed.toLowerCase();
      if (cleanNew === cleanPrev) {
        setError('Please enter a new reason. It cannot be identical to your previous request.');
        return;
      }
    }

    setError('');
    onSubmit?.(trimmed);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reassign-dialog-title"
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px] animate-in fade-in duration-200"
    >
      <div
        className="bg-white rounded-2xl border border-[#D5D9E4] shadow-2xl w-full max-w-lg overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#D5D9E4] px-6 py-4 bg-white">
          <div>
            <h3 id="reassign-dialog-title" className="text-base font-bold text-[#1B2033]">
              {isDeclined ? 'Request Reassignment Again' : 'Request Ticket Reassignment'}
            </h3>
            <p className="text-xs text-[#5A6178] mt-0.5">
              {ticketRef} {ticket?.title ? `· ${ticket.title}` : ''}
            </p>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            aria-label="Close dialog"
            className="w-11 h-11 inline-flex items-center justify-center rounded-xl text-[#5A6178] hover:text-[#1B2033] hover:bg-[#F5F6FA] transition-colors cursor-pointer disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {isDeclined && previousReason && (
            <div className="rounded-xl border border-[#F2C879] bg-[#FFF4E0] p-3 text-xs text-[#7A4A00]">
              <span className="font-bold uppercase tracking-wider text-[10px] block mb-0.5">
                Previously declined reason:
              </span>
              <p className="italic font-medium">&quot;{previousReason}&quot;</p>
              <p className="mt-1 font-semibold text-[11px]">
                Please enter a new, different reason with updated details.
              </p>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor="reassign-reason-input"
              className="block text-xs font-bold text-[#1B2033] uppercase tracking-wider"
            >
              Reason for reassignment <span className="text-rose-600">*</span>
            </label>
            <textarea
              id="reassign-reason-input"
              ref={textareaRef}
              rows={4}
              maxLength={250}
              required
              disabled={isSubmitting}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError('');
              }}
              placeholder="Detail why you cannot complete this assignment (e.g. specialized tooling required, scheduling conflict, conflicting emergency field call)..."
              className="w-full text-sm border border-[#D5D9E4] rounded-xl p-3 bg-white text-[#1B2033] outline-none focus:ring-2 focus:ring-[#1E2A78]/30 focus:border-[#1E2A78] resize-none min-h-[110px] transition-all"
            />
            <div className="flex items-center justify-between text-[11px] text-[#5A6178]">
              <span>Maximum 250 characters</span>
              <span>{reason.length}/250</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="min-h-[44px] px-5 py-2.5 rounded-lg border border-[#D5D9E4] bg-white text-[#5A6178] hover:text-[#1B2033] hover:bg-[#F5F6FA] font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !reason.trim()}
              className="min-h-[44px] px-6 py-2.5 rounded-lg bg-[#1E2A78] hover:bg-[#151E56] text-white font-semibold text-xs transition-colors cursor-pointer shadow-xs flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Submitting...</span>
                </>
              ) : (
                <span>Submit Request</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

