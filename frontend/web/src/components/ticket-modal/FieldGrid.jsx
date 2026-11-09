import React from 'react';

/**
 * FieldGrid component
 * 2-column label (12px muted) / value (14px) grid.
 * Equipment shows full name, wrapped with no truncation.
 * Priority and Category accept optional inline Edit callbacks (44px touch targets).
 */
export default function FieldGrid({
  requestor,
  department,
  priority,
  onEditPriority = null,
  category,
  onEditCategory = null,
  equipment,
  assetId = null,
  slaDueDate = null,
  slaStatusBadge = null,
  dateFiled = null,
  extraFields = [],
  className = '',
}) {
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 ${className}`}>
      {/* Requestor */}
      {requestor && (
        <div className="rounded-xl border border-[#D5D9E4] bg-white p-3.5 flex flex-col justify-between">
          <span className="text-[12px] font-bold text-[#5A6178] uppercase tracking-wide">
            Requestor
          </span>
          <p className="mt-1 text-[14px] font-medium text-[#1B2033] leading-snug break-words">
            {requestor}
          </p>
        </div>
      )}

      {/* Department */}
      {department && (
        <div className="rounded-xl border border-[#D5D9E4] bg-white p-3.5 flex flex-col justify-between">
          <span className="text-[12px] font-bold text-[#5A6178] uppercase tracking-wide">
            Department
          </span>
          <p className="mt-1 text-[14px] font-medium text-[#1B2033] leading-snug break-words">
            {department}
          </p>
        </div>
      )}

      {/* Priority with inline Edit */}
      {priority && (
        <div className="rounded-xl border border-[#D5D9E4] bg-white p-3.5 flex flex-col justify-between">
          <span className="text-[12px] font-bold text-[#5A6178] uppercase tracking-wide">
            Priority
          </span>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-[14px] font-medium text-[#1B2033]">
              {priority}
            </span>
            {onEditPriority && (
              <button
                type="button"
                onClick={onEditPriority}
                aria-label="Edit Priority"
                className="min-h-[44px] min-w-[44px] -my-2 -mr-2 px-2 inline-flex items-center justify-center text-xs font-semibold text-[#1E2A78] hover:underline cursor-pointer"
              >
                <span className="sr-only">Edit Priority</span>
                <span aria-hidden="true">Edit</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Category with inline Edit */}
      {category && (
        <div className="rounded-xl border border-[#D5D9E4] bg-white p-3.5 flex flex-col justify-between">
          <span className="text-[12px] font-bold text-[#5A6178] uppercase tracking-wide">
            Category
          </span>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-[14px] font-medium text-[#1B2033] break-words">
              {category}
            </span>
            {onEditCategory && (
              <button
                type="button"
                onClick={onEditCategory}
                aria-label="Edit Category"
                className="min-h-[44px] min-w-[44px] -my-2 -mr-2 px-2 inline-flex items-center justify-center text-xs font-semibold text-[#1E2A78] hover:underline cursor-pointer"
              >
                <span className="sr-only">Edit Category</span>
                <span aria-hidden="true">Edit</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Equipment (full name, wrap, no truncation) */}
      {equipment && (
        <div className="sm:col-span-2 rounded-xl border border-[#D5D9E4] bg-white p-3.5">
          <span className="text-[12px] font-bold text-[#5A6178] uppercase tracking-wide">
            Equipment
          </span>
          <p className="mt-1 text-[14px] font-medium text-[#1B2033] leading-relaxed break-words whitespace-normal">
            {equipment}
            {assetId && (
              <span className="block text-xs font-mono text-[#5A6178] mt-0.5">
                Asset ID: {assetId}
              </span>
            )}
          </p>
        </div>
      )}

      {/* SLA Due Date */}
      {slaDueDate && (
        <div className="rounded-xl border border-[#D5D9E4] bg-white p-3.5 flex flex-col justify-between">
          <span className="text-[12px] font-bold text-[#5A6178] uppercase tracking-wide">
            SLA Due Date
          </span>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="text-[14px] font-medium text-[#1B2033] leading-snug">
              {slaDueDate}
            </span>
            {slaStatusBadge}
          </div>
        </div>
      )}

      {/* Date Filed */}
      {dateFiled && (
        <div className="rounded-xl border border-[#D5D9E4] bg-white p-3.5 flex flex-col justify-between">
          <span className="text-[12px] font-bold text-[#5A6178] uppercase tracking-wide">
            Date Filed
          </span>
          <p className="mt-1 text-[14px] font-medium text-[#1B2033] leading-snug">
            {dateFiled}
          </p>
        </div>
      )}

      {/* Extra fields */}
      {extraFields.map((field, idx) => (
        <div
          key={idx}
          className={`${field.fullWidth ? 'sm:col-span-2' : ''} rounded-xl border border-[#D5D9E4] bg-white p-3.5 flex flex-col justify-between`}
        >
          <span className="text-[12px] font-bold text-[#5A6178] uppercase tracking-wide">
            {field.label}
          </span>
          <div className="mt-1 text-[14px] font-medium text-[#1B2033] leading-snug">
            {field.value}
          </div>
        </div>
      ))}
    </div>
  );
}
