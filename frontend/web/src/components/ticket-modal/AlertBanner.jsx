import React from 'react';
import { AlertTriangle, AlertCircle, Info, CheckCircle2 } from 'lucide-react';

/**
 * AlertBanner component
 * Variants: danger (SLA breach), warning (customer behind target), info
 * Accepts title, message, optional inline action buttons
 */
export default function AlertBanner({
  variant = 'info', // 'danger' | 'warning' | 'info' | 'success'
  title,
  message,
  actions = null,
  className = '',
}) {
  const styles = {
    danger: {
      container: 'bg-[#FDECEA] border border-red-200 text-[#B42318]',
      title: 'text-[#B42318] font-semibold',
      body: 'text-red-700',
      icon: <AlertTriangle className="w-4 h-4 text-[#B42318] shrink-0 mt-0.5" />,
    },
    warning: {
      container: 'bg-[#FFF4E0] border border-[#F2C879] text-[#7A4A00]',
      title: 'text-[#7A4A00] font-bold',
      body: 'text-[#8A5400]',
      icon: <AlertTriangle className="w-4 h-4 text-[#7A4A00] shrink-0 mt-0.5" />,
    },
    info: {
      container: 'bg-[#EFF6FF] border border-[#BFDBFE] text-[#1E40AF]',
      title: 'text-[#1E40AF] font-semibold',
      body: 'text-[#1E40AF]/90',
      icon: <Info className="w-4 h-4 text-[#1E40AF] shrink-0 mt-0.5" />,
    },
    success: {
      container: 'bg-emerald-50 border border-emerald-200 text-emerald-900',
      title: 'text-emerald-900 font-semibold',
      body: 'text-emerald-800',
      icon: <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />,
    },
  }[variant] || {
    container: 'bg-[#F5F6FA] border border-[#D5D9E4] text-[#1B2033]',
    title: 'text-[#1B2033] font-semibold',
    body: 'text-[#5A6178]',
    icon: <AlertCircle className="w-4 h-4 text-[#5A6178] shrink-0 mt-0.5" />,
  };

  return (
    <div className={`rounded-xl p-3.5 text-xs leading-relaxed transition-all shadow-xs ${styles.container} ${className}`}>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          {styles.icon}
          <div className="min-w-0 flex-1">
            {title && <p className={`text-xs ${styles.title}`}>{title}</p>}
            {message && <p className={`mt-0.5 text-xs leading-normal ${styles.body}`}>{message}</p>}
          </div>
        </div>

        {actions && (
          <div className="flex items-center gap-2 shrink-0 sm:self-center flex-wrap">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

