import React from 'react';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';
import { Sparkles, Monitor, Wrench, CheckCircle2, ArrowRight } from 'lucide-react';

/**
 * Modal shown before creating a ticket or when customer finishes typing their description.
 * Displays AI recommendation between IT (Software) and Service (Hardware) and lets the user
 * confirm or switch with one click.
 */
export default function AIDepartmentModal({
  isOpen,
  classification,
  selectedDepartment,
  onSelectDepartment,
  onConfirm,
  onCancel,
  confirmText = 'Confirm & Continue',
  cancelText = 'Review Form',
}) {
  useLockBodyScroll(isOpen);
  if (!isOpen) return null;

  const currentDept = selectedDepartment || classification?.department || 'IT';
  const isIT = currentDept === 'IT';
  const isService = currentDept === 'Service';
  const reasoning = classification?.reasoning || (isIT
    ? 'Your problem description indicates a software or account issue. Physical equipment is optional.'
    : 'Your problem description indicates physical machinery or hardware maintenance. Equipment selection is required.');

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px] animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl text-left border border-slate-100 flex flex-col gap-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#252578] border border-blue-100">
            <Sparkles className="w-6 h-6 text-accent" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-dark-slate">AI Department Classification</h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-[#252578] uppercase tracking-wide">
                Smart Triage
              </span>
            </div>
            <p className="text-xs text-muted-slate mt-0.5">
              Review and confirm the target department for your issue before submitting.
            </p>
          </div>
        </div>

        {/* Department Option Cards (Interactive Toggle) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* IT Option */}
          <button
            type="button"
            onClick={() => onSelectDepartment('IT')}
            className={`cursor-pointer rounded-xl p-4 text-left transition-all border flex flex-col justify-between ${
              isIT
                ? 'border-[#252578] bg-blue-50/50 shadow-sm ring-2 ring-[#252578]/20'
                : 'border-slate-200 hover:border-slate-300 bg-white'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className={`p-2 rounded-lg ${isIT ? 'bg-[#252578] text-white' : 'bg-slate-100 text-slate-600'}`}>
                  <Monitor className="w-5 h-5" />
                </div>
                {isIT && <CheckCircle2 className="w-5 h-5 text-[#252578]" />}
              </div>
              <h4 className="text-sm font-bold text-dark-slate">IT (Software)</h4>
              <p className="text-xs text-muted-slate mt-1 leading-relaxed">
                Logins, account access, web portal, EHR bugs, server errors, or digital system timeouts.
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                Equipment Optional
              </span>
            </div>
          </button>

          {/* Service Option */}
          <button
            type="button"
            onClick={() => onSelectDepartment('Service')}
            className={`cursor-pointer rounded-xl p-4 text-left transition-all border flex flex-col justify-between ${
              isService
                ? 'border-[#252578] bg-blue-50/50 shadow-sm ring-2 ring-[#252578]/20'
                : 'border-slate-200 hover:border-slate-300 bg-white'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className={`p-2 rounded-lg ${isService ? 'bg-[#252578] text-white' : 'bg-slate-100 text-slate-600'}`}>
                  <Wrench className="w-5 h-5" />
                </div>
                {isService && <CheckCircle2 className="w-5 h-5 text-[#252578]" />}
              </div>
              <h4 className="text-sm font-bold text-dark-slate">Service (Hardware)</h4>
              <p className="text-xs text-muted-slate mt-1 leading-relaxed">
                Physical medical machines, scanner breakdown, power cables, sensors, or biomedical repair.
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md">
                Equipment Required
              </span>
            </div>
          </button>
        </div>

        {/* AI Reasoning Box */}
        <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3.5 text-xs">
          <div className="flex items-center gap-1.5 font-bold text-[#252578] mb-1">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            <span>AI Reasoning</span>
          </div>
          <p className="text-slate-700 leading-relaxed">
            {reasoning}
          </p>
        </div>

        {/* Notice on Equipment */}
        {isIT ? (
          <p className="text-xs text-muted-slate">
            Because this issue is classified under <strong className="text-dark-slate">IT (Software)</strong>, selecting a physical machine or equipment is <span className="text-emerald-700 font-semibold">optional</span>.
          </p>
        ) : (
          <p className="text-xs text-muted-slate">
            Because this issue is classified under <strong className="text-dark-slate">Service (Hardware)</strong>, selecting a physical equipment unit is <span className="text-amber-800 font-semibold">mandatory</span> so technicians can inspect it.
          </p>
        )}

        {/* Footer Actions */}
        <div className="flex justify-end gap-2.5 pt-2 border-t border-slate-100">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="cursor-pointer rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
            >
              {cancelText}
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            className="cursor-pointer rounded-xl bg-[#252578] px-5 py-2 text-xs font-semibold text-white hover:bg-[#1f1f66] shadow-sm transition-all flex items-center gap-1.5"
          >
            <span>{confirmText}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
