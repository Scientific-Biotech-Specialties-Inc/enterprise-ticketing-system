import React from 'react';
import { MessageCircle, Bell, ArrowUpRight } from 'lucide-react';

/**
 * AssigneeRow component
 * Displays: Avatar initials, Name + Department, Updated <time> PHT, optional Message and Remind buttons
 */
export default function AssigneeRow({
  name,
  firstName,
  initials,
  department,
  updatedText,
  onMessage = null,
  messageLabel = null,
  onRemind = null,
  remindDisabled = false,
  remindTitle = '',
  remindCooldownText = '',
  onEscalate = null,
  extraActions = null,
  className = '',
}) {
  const displayFirstName = firstName || (name ? name.split(' ')[0] : 'Assignee');
  const msgText = messageLabel || `Message ${displayFirstName}`;

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-[#D5D9E4] ${className}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-full bg-[#1E2A78] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
          {initials || 'CS'}
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-[#1B2033] truncate">
            {name || 'Unassigned'}
            {department && name && (
              <span className="text-xs font-normal text-[#5A6178] ml-1.5 hidden sm:inline">
                · {department}
              </span>
            )}
          </h4>
          <p className="text-xs text-[#5A6178] truncate">
            Assigned technician{updatedText ? ` · ${updatedText}` : ''}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        {onMessage && (
          <button
            type="button"
            onClick={onMessage}
            className="h-10 sm:h-11 px-3.5 sm:px-4 bg-[#1E2A78] hover:bg-[#252578] text-white text-xs sm:text-sm font-medium rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer min-h-[44px]"
            title={`Send a message to ${displayFirstName}`}
          >
            <MessageCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{msgText}</span>
          </button>
        )}

        {onRemind && (
          <button
            type="button"
            onClick={onRemind}
            disabled={remindDisabled}
            title={remindTitle || `Send reminder to ${displayFirstName}`}
            aria-label={`Send reminder to ${displayFirstName}`}
            className="h-10 sm:h-11 px-3 sm:px-3.5 border border-[#D5D9E4] hover:bg-[#F5F6FA] text-[#1B2033] text-xs sm:text-sm font-medium rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
          >
            <Bell className="w-3.5 h-3.5 text-[#5A6178] shrink-0" />
            <span>Remind {displayFirstName}</span>
            {remindCooldownText && (
              <span className="text-[10px] text-[#5A6178]">({remindCooldownText})</span>
            )}
          </button>
        )}

        {onEscalate && (
          <button
            type="button"
            onClick={onEscalate}
            className="h-10 sm:h-11 px-3.5 border border-[#B42318] text-[#B42318] hover:bg-red-50 text-xs sm:text-sm font-medium rounded-lg inline-flex items-center gap-1.5 transition-colors cursor-pointer min-h-[44px]"
          >
            <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
            <span>Escalate</span>
          </button>
        )}

        {extraActions}
      </div>
    </div>
  );
}

