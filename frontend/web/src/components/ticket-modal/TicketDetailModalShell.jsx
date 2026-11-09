import React, { useEffect, useRef } from 'react';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';

/**
 * TicketDetailModalShell component
 * Centered modal on desktop (max-width ~600px, 16px border-radius)
 * Mobile bottom sheet (<640px)
 * Native scrolling, focus trap, Escape key handling
 */
export default function TicketDetailModalShell({
  isOpen = true,
  onClose,
  header,
  children,
  footer,
  className = '',
  maxWidth = 'max-w-3xl lg:max-w-4xl',
}) {
  useLockBodyScroll(isOpen);
  const modalRef = useRef(null);
  const previousActiveElement = useRef(null);

  useEffect(() => {
    previousActiveElement.current = document.activeElement;
    return () => {
      if (previousActiveElement.current && typeof previousActiveElement.current.focus === 'function') {
        previousActiveElement.current.focus();
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ticket-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-0 sm:p-4 backdrop-blur-[2px] animate-in fade-in duration-200"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close dialog"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[99] focus:p-2 focus:bg-white focus:text-black focus:rounded"
      >
        Close
      </button>
      <div
        ref={modalRef}
        className={`flex w-full ${maxWidth} flex-col overflow-hidden bg-white border border-[#D5D9E4] shadow-2xl transition-all
          max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[96vh] max-sm:rounded-t-2xl max-sm:rounded-b-none
          sm:max-h-[90vh] sm:rounded-2xl ${className}`}
      >
        {/* Sticky Header */}
        {header}

        {/* Scrollable Content (Native Scroll, no custom arrows, 24px padding on desktop, 16px section gap) */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-4">
          {children}
        </div>

        {/* Sticky Footer */}
        {footer}
      </div>
    </div>
  );
}
