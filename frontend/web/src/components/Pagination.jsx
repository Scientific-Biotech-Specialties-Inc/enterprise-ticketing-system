import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Calculates the visible page numbers with optional ellipsis
 * @param {number} current Current active page
 * @param {number} total Total number of pages
 * @param {number} max Maximum visible numbers before ellipsis
 */
function getPageNumbers(current, total, max = 7) {
  if (total <= max) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages = [];
  const showLeftEllipsis = current > 4;
  const showRightEllipsis = current < total - 3;

  if (!showLeftEllipsis && showRightEllipsis) {
    // Near start: 1, 2, 3, 4, 5, '...', total
    for (let i = 1; i <= 5; i++) pages.push(i);
    pages.push('...');
    pages.push(total);
  } else if (showLeftEllipsis && !showRightEllipsis) {
    // Near end: 1, '...', total - 4, total - 3, total - 2, total - 1, total
    pages.push(1);
    pages.push('...');
    for (let i = total - 4; i <= total; i++) pages.push(i);
  } else {
    // In middle: 1, '...', current - 1, current, current + 1, '...', total
    pages.push(1);
    pages.push('...');
    pages.push(current - 1);
    pages.push(current);
    pages.push(current + 1);
    pages.push('...');
    pages.push(total);
  }

  return pages;
}

/**
 * Canonical ONE UI Pagination component
 * Matches the ONE UI design system across all user roles:
 * [ < Previous ]  1  ( 2 )  3  4  5  6  [ Next > ]
 */
export default function Pagination({
  totalItems,
  itemsPerPage = 10,
  currentPage = 1,
  totalPages: propTotalPages,
  onPageChange = () => {},
  className = '',
  hideOnSinglePage = false,
  maxVisible = 7,
}) {
  const totalPages = Math.max(
    1,
    propTotalPages !== undefined && propTotalPages !== null
      ? Number(propTotalPages)
      : totalItems !== undefined && totalItems !== null
      ? Math.ceil(Number(totalItems) / Number(itemsPerPage))
      : 1
  );

  if (hideOnSinglePage && totalPages <= 1) {
    return null;
  }

  const handlePrev = () => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1);
    }
  };

  const handleNext = () => {
    if (currentPage < totalPages) {
      onPageChange(currentPage + 1);
    }
  };

  const pages = getPageNumbers(currentPage, totalPages, maxVisible);

  return (
    <nav
      role="navigation"
      aria-label="Pagination Navigation"
      className={cn('inline-flex items-center gap-1.5 sm:gap-2 font-sans select-none', className)}
    >
      {/* Previous Button: Pill shape with ChevronLeft and text */}
      <button
        type="button"
        onClick={handlePrev}
        disabled={currentPage <= 1}
        aria-label="Previous page"
        title="Previous Page"
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-slate-200 text-xs font-medium text-[#1E293B] hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer shrink-0"
      >
        <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
        <span>Previous</span>
      </button>

      {/* Page Numbers */}
      <div className="flex items-center gap-1">
        {pages.map((p, idx) => {
          if (p === '...') {
            return (
              <span
                key={`ellipsis-${idx}`}
                className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center text-xs font-semibold text-[#8D8B8F] select-none"
              >
                …
              </span>
            );
          }

          const isSelected = p === currentPage;
          return (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p)}
              aria-current={isSelected ? 'page' : undefined}
              aria-label={`Page ${p}`}
              className={cn(
                'w-7 h-7 sm:w-8 sm:h-8 rounded-full text-xs font-semibold transition cursor-pointer flex items-center justify-center shrink-0',
                isSelected
                  ? 'bg-[#252578] text-white shadow-xs cursor-default'
                  : 'text-[#1E293B] hover:bg-slate-100 border border-transparent'
              )}
            >
              {p}
            </button>
          );
        })}
      </div>

      {/* Next Button: Pill shape with text and ChevronRight */}
      <button
        type="button"
        onClick={handleNext}
        disabled={currentPage >= totalPages}
        aria-label="Next page"
        title="Next Page"
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-slate-200 text-xs font-medium text-[#1E293B] hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer shrink-0"
      >
        <span>Next</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
      </button>
    </nav>
  );
}
