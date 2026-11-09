import React, { useState } from 'react';
import { Copy, Check, X } from 'lucide-react';

/**
 * ModalHeader component
 * Displays: Monospace Ticket ID, Copy ID button, optional Staff view pill, 44x44 Close button
 */
export default function ModalHeader({
  ticketId,
  isStaffView = false,
  onClose,
  extraBadge = null,
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!ticketId) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(String(ticketId));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex items-center justify-between border-b border-[#D5D9E4] px-5 sm:px-6 py-3.5 shrink-0 bg-white rounded-t-2xl">
      <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap">
        <span className="font-mono text-xs sm:text-sm font-bold text-[#1B2033] tracking-wider">
          {ticketId || 'TKT-0000'}
        </span>

        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy Ticket ID"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[#D5D9E4] hover:bg-[#F5F6FA] text-xs font-medium text-[#5A6178] hover:text-[#1B2033] transition-colors cursor-pointer min-h-[32px]"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-emerald-600" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
          <span>{copied ? 'Copied' : 'Copy ID'}</span>
        </button>

        {isStaffView && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-900 text-white">
            Staff view
          </span>
        )}

        {extraBadge}
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="w-11 h-11 inline-flex items-center justify-center rounded-xl text-[#5A6178] hover:text-[#1B2033] hover:bg-[#F5F6FA] transition-colors cursor-pointer shrink-0 ml-2"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}

