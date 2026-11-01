import React, { useState, useRef, useEffect } from 'react';
import { Building2, ChevronDown, Check, MapPin, AlertCircle, Info, Globe2 } from 'lucide-react';
import { useBranch, GLOBAL_BRANCH } from '@/context/BranchContext';

/**
 * Reusable BranchSelector Component (TS090, TS092, TS097)
 *
 * Prominently displays and selects the physical branch / hospital facility
 * that Super Admin is currently configuring, to prevent accidental cross-branch edits.
 *
 * Supports two variants:
 * - 'default' (standard prominent selector pill for page headers and toolbars)
 * - 'banner' (full-width informational bar highlighting active branch scope)
 */
export default function BranchSelector({
  variant = 'default',
  showDescription = true,
  className = '',
  onChange,
}) {
  const { branches, selectedBranch, setSelectedBranchId } = useBranch();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const activeBranch = selectedBranch || GLOBAL_BRANCH;

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelectBranch = (branchId) => {
    setSelectedBranchId(branchId);
    setIsOpen(false);
    if (onChange) {
      const branchObj = branchId === null || branchId === 'all'
        ? GLOBAL_BRANCH
        : branches.find((b) => b.id === branchId || b.slug === branchId);
      onChange(branchObj);
    }
  };

  const branchList = [GLOBAL_BRANCH, ...branches.filter((b) => b.id !== null && b.slug !== 'all')];

  if (variant === 'inline') {
    return (
      <div ref={dropdownRef} className={`relative inline-block text-left ${className}`}>
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200/90 bg-white px-3 py-1.5 text-xs text-slate-700 shadow-xs hover:border-slate-300 transition-all cursor-pointer"
          title={`Active Branch: ${selectedBranch?.name || activeBranch.name} (${selectedBranch?.region || activeBranch.region || ''})`}
        >
          <Building2 size={14} className="text-slate-700 shrink-0" />
          <span className="text-slate-500 font-normal">Branch</span>
          <span className="font-semibold text-slate-900">{selectedBranch?.name || activeBranch.name}</span>
          <span className="rounded-md bg-indigo-100/80 px-1.5 py-0.5 text-[10px] font-bold text-indigo-800">
            {selectedBranch?.code || activeBranch.code}
          </span>
          <ChevronDown
            size={14}
            className={`text-slate-400 transition-transform duration-150 ${
              isOpen ? 'rotate-180 text-slate-700' : ''
            }`}
          />
        </button>

        {/* Dropdown Menu */}
        {isOpen && (
          <div className="absolute right-0 mt-2 z-50 w-72 sm:w-80 rounded-2xl border border-gray-100 bg-white p-2 shadow-xl animate-fade-slide-in">
            <div className="px-3 py-2 border-b border-gray-100 mb-1">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                  Select Branch Scope
                </p>
                <span className="rounded bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-800">
                  {selectedBranch?.code || activeBranch.code}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Metrics and forecasts are scoped strictly to this facility.
              </p>
            </div>

            <div className="flex flex-col gap-1 max-h-64 overflow-y-auto" role="listbox">
              {branches.map((branch) => {
                const isSelected = branch.id === (selectedBranch?.id || activeBranch.id);
                return (
                  <button
                    key={branch.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelectBranch(branch.id)}
                    className={`flex items-start justify-between gap-3 rounded-xl px-3 py-2 text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#252578]/10 text-[#252578]'
                        : 'hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <Building2
                        size={15}
                        className={`shrink-0 mt-0.5 ${
                          isSelected ? 'text-[#252578]' : 'text-gray-400'
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-bold truncate">
                            {branch.name}
                          </span>
                          <span className="rounded bg-gray-100 px-1.5 py-0.2 text-[10px] font-semibold text-gray-600">
                            {branch.code}
                          </span>
                        </div>
                        {showDescription && (
                          <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-1">
                            {branch.description}
                          </p>
                        )}
                      </div>
                    </div>

                    {isSelected && (
                      <Check size={15} className="text-[#252578] shrink-0 mt-0.5" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (variant === 'banner') {
    return (
      <div
        ref={dropdownRef}
        className={`relative rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50/90 via-blue-50/50 to-white p-4 shadow-xs ${className}`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#252578] text-white shadow-xs shrink-0">
              {activeBranch.id === null ? <Globe2 size={20} /> : <Building2 size={20} />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-900/70">
                  Target Branch Scope
                </span>
                <span className="inline-flex items-center rounded-md bg-indigo-100/80 px-2 py-0.5 text-[11px] font-bold text-indigo-800">
                  {activeBranch.code || 'GLOBAL'}
                </span>
              </div>
              <h4 className="text-sm font-bold text-gray-900">
                {activeBranch.name}
                {activeBranch.region && (
                  <span className="ml-2 text-xs font-normal text-gray-500">
                    ({activeBranch.region})
                  </span>
                )}
              </h4>
            </div>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setIsOpen((prev) => !prev)}
              aria-haspopup="listbox"
              aria-expanded={isOpen}
              className="inline-flex items-center gap-2.5 rounded-xl border border-indigo-200 bg-white px-4 py-2 text-xs font-semibold text-[#252578] shadow-xs hover:bg-indigo-50/50 transition-all cursor-pointer"
            >
              <MapPin size={14} className="text-[#252578]" />
              <span>Switch Scope</span>
              <ChevronDown
                size={14}
                className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {/* Dropdown Menu */}
            {isOpen && (
              <div className="absolute right-0 mt-2 z-50 w-72 sm:w-80 rounded-2xl border border-gray-100 bg-white p-2 shadow-xl animate-fade-slide-in">
                <div className="px-3 py-2 border-b border-gray-100 mb-1">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                    Select Target Facility
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Configurations will be scoped to this branch or all branches.
                  </p>
                </div>

                <div className="flex flex-col gap-1 max-h-64 overflow-y-auto" role="listbox">
                  {branchList.map((branch) => {
                    const isSelected =
                      (branch.id === null && (activeBranch.id === null || activeBranch.id === 'all')) ||
                      (branch.id !== null && branch.id === activeBranch.id);
                    return (
                      <button
                        key={branch.id || 'global'}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => handleSelectBranch(branch.id)}
                        className={`flex items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[#252578]/10 text-[#252578]'
                            : 'hover:bg-gray-50 text-gray-700'
                        }`}
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          {branch.id === null ? (
                            <Globe2
                              size={16}
                              className={`shrink-0 mt-0.5 ${
                                isSelected ? 'text-[#252578]' : 'text-gray-400'
                              }`}
                            />
                          ) : (
                            <Building2
                              size={16}
                              className={`shrink-0 mt-0.5 ${
                                isSelected ? 'text-[#252578]' : 'text-gray-400'
                              }`}
                            />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-bold truncate">
                                {branch.name}
                              </span>
                              {branch.code && (
                                <span className="rounded bg-gray-100 px-1.5 py-0.2 text-[10px] font-semibold text-gray-600">
                                  {branch.code}
                                </span>
                              )}
                            </div>
                            {showDescription && branch.description && (
                              <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-1">
                                {branch.description}
                              </p>
                            )}
                          </div>
                        </div>

                        {isSelected && (
                          <Check size={16} className="text-[#252578] shrink-0 mt-0.5" />
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-2 pt-2 border-t border-gray-100 px-2 py-1 flex items-center gap-1.5 text-[10px] text-amber-700 bg-amber-50/70 rounded-lg">
                  <AlertCircle size={12} className="shrink-0 text-amber-600" />
                  <span>Edits made apply to the active branch scope only.</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Default variant: prominent header/toolbar pill
  return (
    <div ref={dropdownRef} className={`relative inline-block text-left ${className}`}>
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          className="group inline-flex items-center gap-2.5 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50/80 to-white px-3.5 py-2 text-xs font-semibold text-gray-800 shadow-xs hover:border-[#252578] hover:shadow-sm transition-all cursor-pointer"
          title={`Currently configuring: ${activeBranch.name}`}
        >
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#252578] text-white shrink-0 shadow-xs">
            {activeBranch.id === null ? <Globe2 size={13} /> : <Building2 size={13} />}
          </div>

          <div className="flex flex-col text-left">
            <span className="text-[9px] font-bold uppercase tracking-wider text-indigo-900/60 leading-none">
              Configuring Scope
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="font-bold text-[#252578] text-xs">
                {activeBranch.name}
              </span>
              {activeBranch.code && (
                <span className="rounded bg-indigo-100 px-1.5 py-0.2 text-[10px] font-bold text-indigo-800">
                  {activeBranch.code}
                </span>
              )}
            </div>
          </div>

          <ChevronDown
            size={14}
            className={`text-gray-400 group-hover:text-[#252578] transition-transform duration-200 ml-1 ${
              isOpen ? 'rotate-180 text-[#252578]' : ''
            }`}
          />
        </button>
      </div>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute left-0 sm:right-0 sm:left-auto mt-2 z-50 w-72 sm:w-80 rounded-2xl border border-gray-100 bg-white p-2 shadow-xl animate-fade-slide-in">
          <div className="px-3 py-2 border-b border-gray-100 mb-1">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                Active Branch Configuration
              </p>
              <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                {branches.length} Branches
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Select which physical branch or global scope to configure.
            </p>
          </div>

          <div className="flex flex-col gap-1 max-h-64 overflow-y-auto" role="listbox">
            {branchList.map((branch) => {
              const isSelected =
                (branch.id === null && (activeBranch.id === null || activeBranch.id === 'all')) ||
                (branch.id !== null && branch.id === activeBranch.id);
              return (
                <button
                  key={branch.id || 'global'}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelectBranch(branch.id)}
                  className={`flex items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#252578]/10 text-[#252578]'
                      : 'hover:bg-gray-50 text-gray-700'
                  }`}
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    {branch.id === null ? (
                      <Globe2
                        size={16}
                        className={`shrink-0 mt-0.5 ${
                          isSelected ? 'text-[#252578]' : 'text-gray-400'
                        }`}
                      />
                    ) : (
                      <Building2
                        size={16}
                        className={`shrink-0 mt-0.5 ${
                          isSelected ? 'text-[#252578]' : 'text-gray-400'
                        }`}
                      />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-bold truncate">
                          {branch.name}
                        </span>
                        {branch.code && (
                          <span className="rounded bg-gray-100 px-1.5 py-0.2 text-[10px] font-semibold text-gray-600">
                            {branch.code}
                          </span>
                        )}
                        {branch.region && (
                          <span className="text-[10px] text-gray-400">
                            ({branch.region})
                          </span>
                        )}
                      </div>
                      {showDescription && branch.description && (
                        <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-1">
                          {branch.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {isSelected && (
                    <Check size={16} className="text-[#252578] shrink-0 mt-0.5" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-2 pt-2 border-t border-gray-100 px-2 py-1.5 flex items-start gap-1.5 text-[11px] text-gray-600 bg-gray-50 rounded-xl">
            <Info size={13} className="shrink-0 text-indigo-600 mt-0.5" />
            <span className="text-[10px] leading-tight">
              Edits made on this screen apply to <strong>{activeBranch.name}</strong>.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
