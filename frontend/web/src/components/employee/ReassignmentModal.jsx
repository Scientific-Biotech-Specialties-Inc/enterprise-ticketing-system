import React, { useState } from 'react';
import { requestReassignment } from '@/services/ticketService';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';

export default function ReassignmentModal({
  ticket,
  onClose,
  onReassignSuccess,
}) {
  useLockBodyScroll(Boolean(ticket));
  const [reason, setReason] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!ticket) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!reason.trim()) {
      setErrorMessage('Please provide a reason for the reassignment request.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const numericId = ticket.ticket_ID || Number(String(ticket.id).replace(/\D/g, ''));
      const rawReason = reason.trim();
      const formattedReason = rawReason.charAt(0).toUpperCase() + rawReason.slice(1);
      await requestReassignment({ ticketId: numericId, reason: formattedReason });
      
      // Optimistically update local ticket properties
      ticket.reassignmentRequested = true;
      ticket.reassignmentReason = formattedReason;
      ticket.reassignmentStatus = 'Pending';

      if (typeof onReassignSuccess === 'function') {
        onReassignSuccess(ticket.id);
      }

      setSuccessMessage('Reassignment request submitted successfully!');
      setIsSubmitted(true);
    } catch (err) {
      setErrorMessage(err.response?.data?.message || 'Failed to submit reassignment request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 backdrop-blur-[1.5px] overflow-y-auto py-10" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-8 relative animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full hover:bg-gray-100 text-gray-400 transition-colors"
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {!isSubmitted ? (
          <>
            <p className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-100 px-2.5 py-1 rounded-full uppercase tracking-wider w-max mb-3">Reassignment Request</p>
            <h2 className="text-xl font-bold text-gray-900 leading-snug">Request Ticket Reassignment</h2>
            <p className="text-xs text-gray-505 mt-1 mb-6">Ticket ID: {ticket.id} · {ticket.title}</p>

            {errorMessage && (
              <div className="mb-4 rounded-xl bg-red-50 border border-red-200 text-red-800 p-3.5 text-xs font-semibold flex items-center gap-2">
                <svg className="w-5 h-5 text-red-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="reassign-modal-reason" className="block text-[11px] font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">Reason for Reassignment *</label>
                <textarea
                  id="reassign-modal-reason"
                  placeholder="Detail why you cannot complete this assignment (e.g., specialized skills needed, scheduling conflict, equipment unavailable)..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={250}
                  className="w-full text-xs border border-gray-200 rounded-xl p-3 bg-white text-gray-800 outline-none focus:ring-2 focus:ring-[#252578]/25 min-h-[5.5rem] resize-none"
                  required
                  disabled={isSubmitting}
                />
                <div className="text-right text-[10px] text-gray-400 mt-1">{reason.length}/250</div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting || !reason.trim()}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-red-600/20 disabled:shadow-none disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="text-center py-4">
            <div className="w-14 h-14 rounded-full bg-amber-50 border border-amber-100 flex items-center justify-center mx-auto mb-4 text-amber-500">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-gray-900 leading-snug">Pending Reassignment</h3>
            <p className="text-xs text-gray-500 mt-1 mb-6">
              Your request has been filed. The ticket is now awaiting coordinator approval.
            </p>

            <div className="bg-amber-50/50 border border-amber-100 rounded-xl p-4 text-left mb-6 text-xs text-amber-800 space-y-1">
              <p className="font-bold text-amber-900">Reason Provided:</p>
              <p className="italic leading-relaxed font-medium">&quot;{reason}&quot;</p>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
