import React from 'react';

/**
 * Segmented Pill Toggle matching ONE UI Specification & Design Guardrails:
 * - Fully rounded container (`rounded-full border border-gray-200 bg-white overflow-hidden shadow-xs`)
 * - Active pill: Primary Navy (`bg-brand-primary` / #252578 / #1E2A78) with white bold text
 * - Inactive pills: Transparent background with Muted Slate text (#8D8B8F / `text-muted-slate`)
 * - Uppercase labels: ALL | EXTERNAL | INTERNAL
 */
export function OriginPillToggle({
  value = 'all',
  onChange,
  className = '',
  options = ['ALL', 'EXTERNAL', 'INTERNAL'],
}) {
  const normalizedValue = String(value || 'all').toUpperCase();

  return (
    <div
      role="tablist"
      aria-label="Filter tickets by origin"
      className={`inline-flex items-center border border-gray-200 dark:border-border rounded-full overflow-hidden bg-white dark:bg-card shrink-0 shadow-xs ${className}`}
    >
      {options.map((option) => {
        const optionKey = option.toUpperCase();
        const isActive = normalizedValue === optionKey;

        return (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange?.(option.toLowerCase(), option)}
            className={`px-4 py-1.5 text-xs uppercase tracking-wider transition-colors cursor-pointer select-none ${
              isActive
                ? 'bg-brand-primary text-white font-bold'
                : 'bg-transparent hover:bg-slate-50 dark:hover:bg-muted/40 text-muted-slate dark:text-muted-foreground font-semibold hover:text-dark-slate'
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

export default OriginPillToggle;

