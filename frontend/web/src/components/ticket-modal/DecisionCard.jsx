import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * DecisionCard component for CS Pending Reassignment View
 * Navy 2px border, light #F7F8FD background
 * Requesting employee (avatar, name, department)
 * Reason provided box
 * Reassign to select (required)
 * Buttons: Approve and reassign (primary, disabled until selected), Reject with reason (outlined red)
 */
export default function DecisionCard({
  requestingEmployee, // { name, department, initials }
  reason,
  availableEmployees = [], // [{ id, name, role, department, isSuggested }]
  suggestedEmployeeId = null,
  onApproveAndReassign, // (newEmployeeId) => Promise
  onOpenRejectDialog, // () => void
  isProcessing = false,
  className = '',
}) {
  const [selectedEmpId, setSelectedEmpId] = useState(suggestedEmployeeId || '');

  useEffect(() => {
    if (suggestedEmployeeId && !selectedEmpId) {
      setSelectedEmpId(String(suggestedEmployeeId));
    }
  }, [suggestedEmployeeId, selectedEmpId]);

  const reqName = requestingEmployee?.name || 'Assigned Technician';
  const reqDept = requestingEmployee?.department || 'Service Department';
  const reqInitials = requestingEmployee?.initials ||
    reqName.split(' ').filter(Boolean).map((n) => n[0]).join('').slice(0, 2).toUpperCase() || 'MR';

  const handleApprove = () => {
    if (!selectedEmpId) return;
    onApproveAndReassign?.(selectedEmpId);
  };

  return (
    <div
      className={`border-2 border-[#1E2A78] bg-[#F7F8FD] rounded-xl p-4 sm:p-5 space-y-3.5 shadow-sm transition-all ${className}`}
    >
      {/* Label */}
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-[#1E2A78] inline-block" />
        <h3 className="text-xs font-bold tracking-wider uppercase text-[#1E2A78]">
          DECISION NEEDED · REASSIGNMENT REQUEST
        </h3>
      </div>

      {/* Requesting Employee Row */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-[#1E2A78] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
          {reqInitials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#1B2033] truncate">
            {reqName}
            {reqDept && <span className="text-slate-500 font-normal"> · {reqDept}</span>}
          </p>
          <p className="text-xs text-slate-500">Currently assigned technician</p>
        </div>
      </div>

      {/* Reason Provided Box */}
      <div className="bg-white border border-[#D5D9E4] rounded-lg p-3 text-xs sm:text-sm">
        <span className="text-xs text-slate-500 font-medium block mb-1">
          Reason provided
        </span>
        <p className="text-[#1B2033] font-medium leading-relaxed italic">
          &quot;{reason || 'Specialist tool calibration required beyond standard field kit.'}&quot;
        </p>
      </div>

      {/* Reassign to Select */}
      <div className="space-y-1.5">
        <label
          htmlFor="reassign-select"
          className="block text-xs font-semibold text-slate-700"
        >
          Reassign to <span className="text-[#B42318]">*</span>
        </label>
        <select
          id="reassign-select"
          value={selectedEmpId}
          onChange={(e) => setSelectedEmpId(e.target.value)}
          className="w-full h-11 px-3 text-xs sm:text-sm bg-white border border-[#D5D9E4] rounded-lg text-[#1B2033] outline-none focus:ring-2 focus:ring-[#1E2A78]/30 focus:border-[#1E2A78] transition-colors cursor-pointer"
        >
          <option value="" disabled>
            Select available technician...
          </option>
          {availableEmployees.map((emp) => {
            const empId = String(emp.id || emp.emp_id);
            const isSuggested = emp.isSuggested || String(suggestedEmployeeId) === empId;
            return (
              <option key={empId} value={empId}>
                {emp.name} · {emp.role || emp.department || 'Specialist'}{' '}
                {isSuggested ? '(suggested)' : ''}
              </option>
            );
          })}
        </select>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
        <button
          type="button"
          onClick={handleApprove}
          disabled={!selectedEmpId || isProcessing}
          className="flex-1 h-11 px-4 bg-[#1E2A78] hover:bg-[#252578] text-white text-xs sm:text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5 cursor-pointer shadow-xs min-h-[44px]"
        >
          {isProcessing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
          Approve and reassign
        </button>

        <button
          type="button"
          onClick={onOpenRejectDialog}
          disabled={isProcessing}
          className="flex-1 sm:flex-initial h-11 px-4 border border-[#B42318] text-[#B42318] hover:bg-red-50 text-xs sm:text-sm font-semibold rounded-lg transition-colors cursor-pointer inline-flex items-center justify-center min-h-[44px]"
        >
          Reject with reason
        </button>
      </div>
    </div>
  );
}

