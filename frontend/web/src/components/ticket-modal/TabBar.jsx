import React, { useRef } from 'react';

/**
 * TabBar component
 * Details | Timeline (n) | Notes · Staff only (n) | Files (n)
 * 3px navy underline on active tab, 44px min height,
 * role="tablist" / "tab" / "tabpanel" attributes, arrow-key navigation
 */
export default function TabBar({
  tabs = [], // [{ id, label, count, staffOnly }]
  activeTab,
  onTabChange,
  className = '',
}) {
  const tabRefs = useRef({});

  const handleKeyDown = (e, index) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextIdx = (index + 1) % tabs.length;
      const nextTab = tabs[nextIdx];
      if (nextTab) {
        onTabChange(nextTab.id);
        tabRefs.current[nextTab.id]?.focus();
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIdx = (index - 1 + tabs.length) % tabs.length;
      const prevTab = tabs[prevIdx];
      if (prevTab) {
        onTabChange(prevTab.id);
        tabRefs.current[prevTab.id]?.focus();
      }
    }
  };

  return (
    <div
      role="tablist"
      aria-label="Ticket information sections"
      className={`flex items-center border-b border-[#D5D9E4] gap-4 sm:gap-6 overflow-x-auto scrollbar-none shrink-0 ${className}`}
    >
      {tabs.map((tab, idx) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            ref={(el) => (tabRefs.current[tab.id] = el)}
            role="tab"
            id={`tab-${tab.id}`}
            aria-controls={`panel-${tab.id}`}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            type="button"
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            className={`min-h-[44px] pb-3 text-xs sm:text-sm font-semibold transition-all relative cursor-pointer flex items-center gap-1.5 whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-[#1E2A78]/30 rounded-t-sm ${
              isActive
                ? 'text-[#1E2A78] font-bold'
                : 'text-[#5A6178] hover:text-[#1B2033]'
            }`}
          >
            <span>{tab.label}</span>

            {typeof tab.count !== 'undefined' && tab.count !== null && (
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold border transition-colors ${
                  isActive
                    ? 'bg-[#1E2A78]/10 text-[#1E2A78] border-[#1E2A78]/20'
                    : 'bg-[#F5F6FA] text-[#5A6178] border-[#D5D9E4]'
                }`}
              >
                {tab.count}
              </span>
            )}

            {/* 3px navy underline on the active tab */}
            {isActive && (
              <span className="absolute bottom-0 left-0 w-full h-[3px] bg-[#1E2A78] rounded-t-sm" />
            )}
          </button>
        );
      })}
    </div>
  );
}

