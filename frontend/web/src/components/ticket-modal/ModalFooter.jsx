import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * ModalFooter component
 * Sticky footer with status-aware primary and outlined secondary actions
 */
export default function ModalFooter({
  leftContent = null,
  secondaryActions = null,
  primaryAction = null,
  className = '',
}) {
  const hasLeft = Boolean(leftContent || secondaryActions);
  return (
    <div
      className={`border-t border-[#D5D9E4] bg-white px-5 sm:px-6 py-3.5 shrink-0 flex flex-col sm:flex-row items-stretch sm:items-center ${hasLeft ? 'justify-between' : 'justify-end'} gap-3 ${className}`}
    >
      {hasLeft && (
        <div className="flex items-center gap-2 flex-wrap">
          {leftContent}
          {secondaryActions}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 shrink-0">
        {primaryAction}
      </div>
    </div>
  );
}

