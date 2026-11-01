import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  ArrowUpRight,
  ShieldAlert,
  AlertTriangle,
  User,
  Building2,
  Tag,
  CheckCircle2,
  Clock,
  Layers,
  HelpCircle,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';

/**
 * Categorize ticket into Service, IT, or Others
 */
export const resolveCategoryType = (categoryName = '', departmentName = '') => {
  const normCat = String(categoryName || '').toLowerCase();
  const normDept = String(departmentName || '').toLowerCase();

  // Service: Position level rules (L1 -> L2 -> L3)
  if (
    normCat.includes('service') ||
    normCat.includes('machine') ||
    normCat.includes('maintenance') ||
    normCat.includes('radiology') ||
    normCat.includes('biomedical') ||
    normCat.includes('mri') ||
    normCat.includes('x-ray') ||
    normDept.includes('service')
  ) {
    return 'service';
  }

  // IT: Technical role / team rules
  if (
    normCat.includes('it') ||
    normCat.includes('software') ||
    normCat.includes('hardware') ||
    normCat.includes('network') ||
    normCat.includes('system') ||
    normCat.includes('security') ||
    normDept.includes('it')
  ) {
    return 'it';
  }

  // Others: Configured routing target rules
  return 'others';
};

/**
 * TS032: Category-Specific Escalation Modal
 * Computes and displays the determined escalation target based on ticket category:
 * - Service: Position level escalation (e.g. L1 to L2 / Senior Engineer)
 * - IT: Technical role / team routing (e.g. Senior System Admin / Software Engineer)
 * - Others: Configured routing target (e.g. Operations Escalation Lead)
 */
export default function EscalateTicketModal({
  isOpen,
  onClose,
  ticket,
  employees = [],
  onConfirmEscalate,
  isEscalating = false,
}) {
  useLockBodyScroll(isOpen);

  const [escalationReason, setEscalationReason] = useState('');
  const [selectedTargetId, setSelectedTargetId] = useState(null);
  const [validationError, setValidationError] = useState('');

  const categoryName = ticket?.category || ticket?.category_name || '';
  const departmentName = ticket?.department || ticket?.department_name || '';

  const categoryType = useMemo(() => {
    return resolveCategoryType(categoryName, departmentName);
  }, [categoryName, departmentName]);

  // Compute eligible candidates based strictly on the category rule
  const eligibleCandidates = useMemo(() => {
    if (!employees || employees.length === 0) return [];

    if (categoryType === 'service') {
      // Position Level escalation: Senior Engineers, L2, L3, Supervisors, Managers in Service/Engineering/Biomedical
      return employees.filter((emp) => {
        const role = String(emp.role || emp.position || '').toLowerCase();
        const dept = String(emp.department || '').toLowerCase();
        const level = String(emp.position_level || '').toLowerCase();
        const techRole = String(emp.technical_role || '').toLowerCase();

        const isServiceDept =
          dept.includes('service') ||
          dept.includes('engineering') ||
          dept.includes('operations') ||
          dept.includes('biomedical') ||
          dept.includes('radiology') ||
          dept.includes('facilities') ||
          dept.includes('equipment');

        const isHigherTier =
          level.includes('senior') ||
          level.includes('lead') ||
          level.includes('manager') ||
          level.includes('l2') ||
          level.includes('l3') ||
          role.includes('senior') ||
          role.includes('lead') ||
          role.includes('supervisor') ||
          role.includes('manager') ||
          role.includes('specialist') ||
          role.includes('l2') ||
          role.includes('l3') ||
          techRole.includes('senior') ||
          techRole.includes('lead') ||
          techRole.includes('specialist') ||
          techRole.includes('manager');

        return isServiceDept && isHigherTier;
      });
    }

    if (categoryType === 'it') {
      // Technical Role / Team escalation: IT Admin, System Admin, Software Engineer, Security, Network
      return employees.filter((emp) => {
        const role = String(emp.role || emp.position || '').toLowerCase();
        const dept = String(emp.department || '').toLowerCase();
        const level = String(emp.position_level || '').toLowerCase();
        const techRole = String(emp.technical_role || '').toLowerCase();

        const isIT = dept.includes('it') || dept.includes('information tech') || dept.includes('network');
        const isTechRole =
          level.includes('senior') ||
          level.includes('lead') ||
          level.includes('manager') ||
          role.includes('admin') ||
          role.includes('engineer') ||
          role.includes('security') ||
          role.includes('system') ||
          role.includes('lead') ||
          role.includes('senior') ||
          role.includes('manager') ||
          techRole.includes('admin') ||
          techRole.includes('system') ||
          techRole.includes('network') ||
          techRole.includes('specialist');

        return isIT || isTechRole;
      });
    }

    // 'others': Configured routing target (Operations Leads, Supervisors, Managers, CS Seniors)
    return employees.filter((emp) => {
      const role = String(emp.role || emp.position || '').toLowerCase();
      const dept = String(emp.department || '').toLowerCase();
      const level = String(emp.position_level || '').toLowerCase();
      const techRole = String(emp.technical_role || '').toLowerCase();

      const isLeadOrSenior =
        level.includes('senior') ||
        level.includes('lead') ||
        level.includes('manager') ||
        role.includes('supervisor') ||
        role.includes('manager') ||
        role.includes('lead') ||
        role.includes('admin') ||
        role.includes('head') ||
        role.includes('senior') ||
        techRole.includes('senior') ||
        techRole.includes('lead');

      return isLeadOrSenior || dept.includes('operations') || dept.includes('customer service') || dept.includes('facilities') || dept.includes('finance');
    });
  }, [employees, categoryType]);

  // Auto-select first eligible candidate when candidates load
  useEffect(() => {
    if (eligibleCandidates.length > 0) {
      setSelectedTargetId(eligibleCandidates[0].id || eligibleCandidates[0].emp_id);
    } else {
      setSelectedTargetId(null);
    }
    setEscalationReason('');
    setValidationError('');
  }, [eligibleCandidates, isOpen]);

  const selectedCandidate = useMemo(() => {
    return eligibleCandidates.find(
      (c) => (c.id || c.emp_id) === Number(selectedTargetId)
    );
  }, [eligibleCandidates, selectedTargetId]);

  if (!isOpen || !ticket) return null;

  const handleConfirm = async (e) => {
    e.preventDefault();
    if (eligibleCandidates.length === 0) {
      setValidationError('Cannot escalate: No eligible recipients available.');
      return;
    }
    if (!selectedCandidate) {
      setValidationError('Please select an escalation recipient target.');
      return;
    }
    if (!escalationReason.trim()) {
      setValidationError('Please provide a brief reason or context for this escalation.');
      return;
    }

    setValidationError('');
    await onConfirmEscalate({
      targetEmployee: selectedCandidate,
      reason: escalationReason.trim(),
      categoryType,
      categoryName,
    });
  };

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px] animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="escalate-modal-title"
    >
      <div className="relative w-full max-w-xl rounded-2xl bg-surface border border-border shadow-modal overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-[#252578] text-white px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white shrink-0">
              <ArrowUpRight className="w-5 h-5 text-rose-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-rose-500/30 text-rose-200 border border-rose-400/30 font-sans">
                  TS032 Escalation
                </span>
                <span className="text-xs text-white/70 font-mono">
                  {ticket.ticket_number || ticket.id}
                </span>
              </div>
              <h3 id="escalate-modal-title" className="text-lg font-bold tracking-tight text-white mt-0.5 font-sans">
                Escalate Ticket
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isEscalating}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleConfirm} className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Category Rule Badge Banner */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                Category Escalation Rule
              </span>
              <Badge variant="outline" className="text-xs font-semibold bg-white border-slate-300 text-[#252578]">
                {categoryType === 'service'
                  ? 'Service: Position Level (L1 → L2/Senior)'
                  : categoryType === 'it'
                  ? 'IT: Technical Role / Team Specialization'
                  : 'Others: Configured Operations Routing'}
              </Badge>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              {categoryType === 'service'
                ? `Ticket category "${categoryName || 'Service'}" requires escalation along tiered position levels. The system will route to a qualified Senior Field Service Engineer or Technical Specialist.`
                : categoryType === 'it'
                ? `Ticket category "${categoryName || 'IT'}" requires technical role-based qualification. Routing targets designated Systems Administrators and Technical Engineers.`
                : `Ticket category "${categoryName || 'General'}" routes per the configured operational escalation path to Operations Leads and Supervisors.`}
            </p>
          </div>

          {/* Blocked Escalation Warning if 0 Eligible Recipients */}
          {eligibleCandidates.length === 0 ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 flex items-start gap-3 text-rose-900 shadow-xs">
              <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <p className="font-bold text-rose-900">
                  Blocked Escalation: No Eligible Recipients Found
                </p>
                <p className="text-rose-700 leading-relaxed">
                  No personnel matching the category-specific qualifications (
                  {categoryType === 'service'
                    ? 'Higher Position Level / Senior Field Specialist'
                    : categoryType === 'it'
                    ? 'Specialized Technical Role / System Administrator'
                    : 'Designated Operations Lead'}
                  ) are currently available in the active employee directory. Escalation is temporarily blocked until an eligible target is online.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Target Selection & Summary Card */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Determined Escalation Target <span className="text-rose-500">*</span>
                </label>
                <div className="space-y-2">
                  {eligibleCandidates.map((cand) => {
                    const candId = cand.id || cand.emp_id;
                    const isSelected = Number(selectedTargetId) === candId;
                    return (
                      <div
                        key={candId}
                        onClick={() => setSelectedTargetId(candId)}
                        className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
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
                              {cand.position_level ? `${cand.position_level} • ` : ''}{cand.technical_role || cand.role || 'Specialist'} • {cand.department || 'Operations'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                              cand.status === 'active' || cand.is_active
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {cand.status === 'active' || cand.is_active ? 'Active' : 'Offline'}
                          </span>
                          {isSelected && (
                            <CheckCircle2 className="w-4 h-4 text-[#252578]" />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Escalation Reason / Context Field */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="escalation-reason" className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Reason for Escalation <span className="text-rose-500">*</span>
                  </label>
                  <span className="text-[10px] text-slate-400">
                    {escalationReason.length}/500
                  </span>
                </div>
                <textarea
                  id="escalation-reason"
                  rows={3}
                  maxLength={500}
                  value={escalationReason}
                  onChange={(e) => setEscalationReason(e.target.value)}
                  placeholder="Explain why this ticket is being escalated (e.g. Unresolved technical fault after L1 diagnosis; requires senior specialist inspection)..."
                  className="w-full rounded-xl border border-slate-200 bg-page p-3 text-xs text-slate-900 outline-none focus:border-[#2E85D8] focus:ring-1 focus:ring-[#2E85D8] placeholder:text-slate-400"
                  required
                />
              </div>
            </>
          )}

          {/* Validation Error Banner */}
          {validationError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}

          {/* Handoff Notice */}
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 flex items-start gap-2.5 text-xs text-blue-900">
            <Clock className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              Upon confirmation, the ticket will transition to <strong>Escalated</strong> status per the workflow state machine. The complete conversation history and internal notes will automatically transfer to the new recipient.
            </p>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isEscalating}
              className="px-4"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isEscalating || eligibleCandidates.length === 0}
              className="bg-[#252578] hover:bg-[#1e1e60] text-white px-5 flex items-center gap-1.5"
            >
              {isEscalating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Escalating...</span>
                </>
              ) : (
                <>
                  <ArrowUpRight className="w-4 h-4" />
                  <span>Confirm Escalation</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
