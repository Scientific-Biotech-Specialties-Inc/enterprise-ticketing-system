import React from 'react';
import { AlertTriangle, ExternalLink, X } from 'lucide-react';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';

/**
 * Modern modal shown when an active ongoing ticket already exists for the selected machine,
 * replacing invasive browser alert banners (e.g. "localhost:5173 says...").
 */
export default function DuplicateTicketModal({
  isOpen,
  machineName = '',
  ticketNo = '',
  ticketStatus = 'Open',
  onClose,
  onViewTicket,
  onSelectDifferentMachine,
}) {
  useLockBodyScroll(isOpen);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px] animate-in fade-in duration-200">
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl text-left border border-amber-100 flex flex-col gap-4 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          aria-label="Close"
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900">Active Ticket Detected</h3>
            <p className="text-xs text-amber-700 font-medium">Ongoing Ticket Protection</p>
          </div>
        </div>

        <div className="rounded-xl bg-amber-50/70 p-4 space-y-2 border border-amber-200/80 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Machine</span>
            <span className="font-bold text-gray-900 text-sm">{machineName || 'Selected Machine'}</span>
          </div>
          <div className="flex items-center justify-between pt-1 border-t border-amber-200/50">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Existing Ticket</span>
            <span className="font-bold text-[#252578] text-sm">{ticketNo || 'Active Ticket'}</span>
          </div>
          <div className="flex items-center justify-between pt-1 border-t border-amber-200/50">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Current Status</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-200 text-amber-900">
              {ticketStatus}
            </span>
          </div>
        </div>

        <p className="text-xs text-gray-600 leading-relaxed">
          You already have an active support ticket open for this machine. Duplicate ticket creation for the same machine is restricted until resolved.
          <br />
          <span className="text-gray-500 mt-1 block">
            If you need assistance with a <strong>different machine</strong>, you can change the machine selection in your form.
          </span>
        </p>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t border-gray-100">
          {onSelectDifferentMachine ? (
            <button
              type="button"
              onClick={onSelectDifferentMachine}
              className="rounded-xl px-4 py-2.5 text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
            >
              Change Machine
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2.5 text-xs font-semibold text-gray-600 hover:bg-gray-100 transition-colors"
            >
              Close
            </button>
          )}

          {onViewTicket && (
            <button
              type="button"
              onClick={onViewTicket}
              className="rounded-xl bg-[#252578] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#1f1f66] shadow-sm transition-all inline-flex items-center justify-center gap-1.5"
            >
              <span>View Existing Ticket</span>
              <ExternalLink size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
