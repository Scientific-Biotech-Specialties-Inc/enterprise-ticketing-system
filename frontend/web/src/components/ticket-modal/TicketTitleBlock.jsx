import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { formatPHT } from './ticketModalUtils';

/**
 * TicketTitleBlock component
 * Displays: Title (21-22px semibold), Badges row (priority, category/dept, status, filed date), Short description (13px)
 */
export default function TicketTitleBlock({
  title,
  priority,
  status,
  department,
  category,
  dateFiled,
  description,
  pendingReassignment = false,
  customBadges = null,
}) {
  const [descExpanded, setDescExpanded] = useState(false);

  const getPriorityBadgeClass = (pri) => {
    const norm = String(pri || '').toLowerCase();
    if (norm === 'critical') return 'bg-[#B42318] text-white';
    if (norm === 'high') return 'bg-amber-600 text-white';
    if (norm === 'medium') return 'bg-blue-600 text-white';
    return 'bg-[#5A6178] text-white';
  };

  return (
    <div className="space-y-2">
      {/* 21-22px semibold title */}
      <h2
        id="ticket-modal-title"
        className="text-[21px] sm:text-[22px] font-semibold text-[#1B2033] leading-snug break-words tracking-tight"
      >
        {title || 'Untitled Ticket'}
      </h2>

      {/* Badges row */}
      <div className="flex flex-wrap items-center gap-2">
        {priority && (
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${getPriorityBadgeClass(
              priority
            )}`}
          >
            {priority}
          </span>
        )}

        {pendingReassignment && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
            Pending reassignment
          </span>
        )}

        {department && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
            {department.toLowerCase().includes('dept') || department.toLowerCase().includes('department')
              ? department
              : `${department} Dept`}
          </span>
        )}

        {!department && category && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
            {category}
          </span>
        )}

        {status && !pendingReassignment && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
            {status}
          </span>
        )}

        {dateFiled && (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#F5F6FA] text-[#5A6178] border border-[#D5D9E4]">
            Filed {formatPHT(dateFiled)}
          </span>
        )}

        {customBadges}
      </div>

      {/* Short description (13px) */}
      {description && (
        <div className="text-[13px] text-slate-600 leading-relaxed pt-0.5">
          <div className={!descExpanded && description.length > 180 ? 'line-clamp-2' : ''}>
            {description}
          </div>
          {description.length > 180 && (
            <button
              type="button"
              onClick={() => setDescExpanded((p) => !p)}
              className="mt-1 text-xs font-semibold text-[#1E2A78] hover:underline inline-flex items-center gap-1 cursor-pointer"
            >
              <span>{descExpanded ? 'Show less' : 'Show full description'}</span>
              {descExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

