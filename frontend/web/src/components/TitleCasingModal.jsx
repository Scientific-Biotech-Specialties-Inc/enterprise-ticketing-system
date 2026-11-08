import React from 'react';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';

/**
 * Modal shown when a user enters a ticket title with non-standard casing (e.g., "OmICRon BlOOd pREssURE").
 * Displays the before and after transformation and confirms the proper casing format.
 */
export default function TitleCasingModal({
  isOpen,
  originalTitle = '',
  formattedTitle = '',
  onConfirm,
  onCancel,
  confirmText = 'Apply & Continue',
  cancelText = 'Edit Title',
}) {
  useLockBodyScroll(isOpen);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px] animate-in fade-in duration-200">
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl text-left border border-gray-100 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-[#252578]">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5h12M9 5v14m6-8h6m-3-4v8" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900">Proper Casing Applied</h3>
            <p className="text-xs text-gray-500">Ticket titles are formatted to standard Title Case</p>
          </div>
        </div>

        <div className="rounded-xl bg-gray-50 p-4 space-y-2.5 border border-gray-100 text-sm">
          <div>
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider block">
              Original Entered Title
            </span>
            <span className="line-through text-red-500 font-mono text-xs break-words block mt-0.5">
              {originalTitle}
            </span>
          </div>
          <div className="pt-2 border-t border-gray-200">
            <span className="text-[11px] font-semibold text-[#252578] uppercase tracking-wider block">
              Formatted Proper Title
            </span>
            <span className="font-bold text-gray-900 text-sm break-words block mt-0.5">
              {formattedTitle}
            </span>
          </div>
        </div>

        <p className="text-xs text-gray-600 leading-relaxed">
          We adjusted your ticket title to proper casing so it is readable across the enterprise system.
        </p>

        <div className="flex justify-end gap-2.5 pt-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 transition-colors"
            >
              {cancelText}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-[#252578] px-5 py-2 text-xs font-semibold text-white hover:bg-[#1f1f66] shadow-sm transition-all"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
