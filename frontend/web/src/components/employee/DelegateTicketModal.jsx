import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  Share2,
  UserCheck,
  Building2,
  Briefcase,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Search,
  Filter,
  Loader2,
  FileText,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';

/**
 * TS034: Delegate Escalated Ticket Modal
 * Allows the Escalation Recipient to delegate an escalated ticket to an Assigned Employee
 * with decision-support information (role, department, workload, availability) and an optional handoff note.
 */
export default function DelegateTicketModal({
  isOpen,
  onClose,
  ticket,
  employees = [],
  onConfirmDelegate,
  isDelegating = false,
}) {
  useLockBodyScroll(isOpen);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDeptFilter, setSelectedDeptFilter] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [delegationNote, setDelegationNote] = useState('');
  const [showConfirmStep, setShowConfirmStep] = useState(false);
  const [validationError, setValidationError] = useState('');

  const ticketCategory = ticket?.category || ticket?.category_name || '';
  const ticketDepartment = ticket?.department || ticket?.department_name || '';

  // Filter candidates matching ticket category / eligibility rules
  const eligibleCandidates = useMemo(() => {
    if (!employees || employees.length === 0) return [];

    return employees.filter((emp) => {
      // Exclude current employee from delegating to themselves
      const empId = Number(emp.id || emp.emp_id);
      const currentAssignedId = Number(ticket?.assigned_to || ticket?.employee_ID);
      if (empId === currentAssignedId) return false;

      // Filter by department if dropdown selected
      if (selectedDeptFilter && emp.department !== selectedDeptFilter) {
        return false;
      }

      // Filter by search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const name = String(emp.name || `${emp.first_name || ''} ${emp.last_name || ''}`).toLowerCase();
        const role = String(emp.role || '').toLowerCase();
        const dept = String(emp.department || '').toLowerCase();
        if (!name.includes(q) && !role.includes(q) && !dept.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [employees, ticket, selectedDeptFilter, searchQuery]);

  const departments = useMemo(() => {
    const list = [...new Set(employees.map((e) => e.department).filter(Boolean))];
    return list.sort();
  }, [employees]);

  const selectedCandidate = useMemo(() => {
    return employees.find((e) => Number(e.id || e.emp_id) === Number(selectedEmployeeId));
  }, [employees, selectedEmployeeId]);

  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setSelectedDeptFilter('');
      setSelectedEmployeeId(null);
      setDelegationNote('');
      setShowConfirmStep(false);
      setValidationError('');
    }
  }, [isOpen]);

  if (!isOpen || !ticket) return null;

  const handleProceedToConfirm = () => {
    if (!selectedCandidate) {
      setValidationError('Please select an employee candidate to delegate this ticket to.');
      return;
    }
    setValidationError('');
    setShowConfirmStep(true);
  };

  const handleFinalConfirm = async () => {
    if (!selectedCandidate) return;
    setValidationError('');
    await onConfirmDelegate({
      assignedEmployee: selectedCandidate,
      delegationNote: delegationNote.trim(),
    });
  };

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px] animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delegate-modal-title"
    >
      <div className="relative w-full max-w-xl rounded-2xl bg-surface border border-border shadow-modal overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-[#252578] text-white px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white shrink-0">
              <UserCheck className="w-5 h-5 text-sky-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-sky-500/30 text-sky-200 border border-sky-400/30 font-sans">
                  TS034 Delegation
                </span>
                <span className="text-xs text-white/70 font-mono">
                  {ticket.ticket_number || ticket.id}
                </span>
              </div>
              <h3 id="delegate-modal-title" className="text-lg font-bold tracking-tight text-white mt-0.5 font-sans">
                Delegate Escalated Ticket
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isDelegating}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {showConfirmStep ? (
            /* Confirmation Step */
            <div className="space-y-4 animate-in fade-in zoom-in-95 duration-150">
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 flex items-start gap-3 text-blue-900">
                <Share2 className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <p className="font-bold text-blue-900">
                    Confirm Delegation to {selectedCandidate?.name || 'Selected Specialist'}?
                  </p>
                  <p className="text-blue-700 leading-relaxed">
                    This ticket will be delegated and assigned to{' '}
                    <strong>{selectedCandidate?.name}</strong>. It will immediately appear in their work queue, and you will be recorded as the designated approver for any subsequent reassignment requests.
                  </p>
                </div>
              </div>

              {/* Handoff Note Preview */}
              <div className="rounded-xl border border-border bg-page p-4 space-y-2">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-primary" />
                  Handoff Note for Specialist
                </span>
                <p className="text-xs text-slate-800 italic leading-relaxed break-words whitespace-pre-wrap">
                  {delegationNote.trim() ? `"${delegationNote.trim()}"` : 'No handoff note attached.'}
                </p>
              </div>

              {validationError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{validationError}</span>
                </div>
              )}
            </div>
          ) : (
            /* Selection Step */
            <>
              {/* Guidance Notice */}
              <p className="text-xs text-slate-600 leading-relaxed">
                As the escalation recipient, select a qualified specialist from your team to delegate this ticket to. The specialist will receive immediate access to the full conversation history and your handoff context note.
              </p>

              {/* Search & Filter Bar */}
              <div className="flex flex-col sm:flex-row gap-2.5">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name, role, or department..."
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-border bg-page text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent placeholder:text-slate-400"
                  />
                </div>
                {departments.length > 0 && (
                  <select
                    value={selectedDeptFilter}
                    onChange={(e) => setSelectedDeptFilter(e.target.value)}
                    className="px-3 py-2 text-xs rounded-xl border border-border bg-page text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent sm:w-44"
                  >
                    <option value="">All Departments</option>
                    {departments.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Candidate Selection List */}
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {eligibleCandidates.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500 bg-page rounded-xl border border-dashed border-slate-200">
                    No eligible specialists found matching the criteria.
                  </div>
                ) : (
                  eligibleCandidates.map((cand) => {
                    const candId = Number(cand.id || cand.emp_id);
                    const isSelected = selectedEmployeeId === candId;
                    const activeWorkload = cand.active_ticket_count ?? cand.workload ?? 0;
                    return (
                      <div
                        key={candId}
                        onClick={() => setSelectedEmployeeId(candId)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                          isSelected
                            ? 'border-[#252578] bg-[#252578]/5 ring-1 ring-[#252578]'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                              isSelected
                                ? 'bg-[#252578] text-white'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {(cand.name || cand.first_name || 'U').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-900 truncate">
                              {cand.name || `${cand.first_name || ''} ${cand.last_name || ''}`.trim() || cand.email}
                            </p>
                            <p className="text-[11px] text-slate-500 truncate">
                              {cand.role || 'Specialist'} • {cand.department || 'Operations'}
                            </p>
                          </div>
                        </div>

                        {/* Decision-Support Badges */}
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                            {activeWorkload} active {activeWorkload === 1 ? 'ticket' : 'tickets'}
                          </span>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                              cand.status === 'active' || cand.is_active
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {cand.status === 'active' || cand.is_active ? 'Available' : 'Offline'}
                          </span>
                          {isSelected && (
                            <CheckCircle2 className="w-4 h-4 text-[#252578]" />
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Optional Delegation Note Field */}
              <div className="space-y-1.5 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <label htmlFor="delegation-note" className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Delegation Note / Context <span className="text-slate-400 font-normal">(Optional)</span>
                  </label>
                  <span className="text-[10px] text-slate-400">
                    {delegationNote.length}/500
                  </span>
                </div>
                <textarea
                  id="delegation-note"
                  rows={2}
                  maxLength={500}
                  value={delegationNote}
                  onChange={(e) => setDelegationNote(e.target.value)}
                  placeholder="Provide handoff context for the receiving specialist (e.g., Please check the compressor — customer reports intermittent shutdown)..."
                  className="w-full rounded-xl border border-slate-200 bg-page p-3 text-xs text-slate-900 outline-none focus:border-[#2E85D8] focus:ring-1 focus:ring-[#2E85D8] placeholder:text-slate-400"
                />
              </div>

              {validationError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{validationError}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-5 border-t border-border bg-page/50 flex items-center justify-end gap-3">
          {showConfirmStep ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowConfirmStep(false)}
                disabled={isDelegating}
                className="px-4"
              >
                Back to Selection
              </Button>
              <Button
                type="button"
                onClick={handleFinalConfirm}
                disabled={isDelegating}
                className="bg-[#252578] hover:bg-[#1e1e60] text-white px-5 flex items-center gap-1.5"
              >
                {isDelegating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Delegating...</span>
                  </>
                ) : (
                  <>
                    <UserCheck className="w-4 h-4" />
                    <span>Confirm Delegation</span>
                  </>
                )}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isDelegating}
                className="px-4"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleProceedToConfirm}
                disabled={isDelegating || !selectedEmployeeId}
                className="bg-[#252578] hover:bg-[#1e1e60] text-white px-5 flex items-center gap-1.5"
              >
                <span>Continue</span>
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
