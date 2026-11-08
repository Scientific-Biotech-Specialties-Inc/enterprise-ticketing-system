import * as React from "react";
import { Check, X, AlertTriangle, Info, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function ToastItem({ toast, onDismiss }) {
  const [isPaused, setIsPaused] = React.useState(false);
  const remainingTimeRef = React.useRef(toast.duration || 4000);
  const timerStartRef = React.useRef(Date.now());
  const timerIdRef = React.useRef(null);

  React.useEffect(() => {
    if (isPaused) {
      if (timerIdRef.current) {
        clearTimeout(timerIdRef.current);
        timerIdRef.current = null;
      }
      remainingTimeRef.current -= Date.now() - timerStartRef.current;
    } else {
      timerStartRef.current = Date.now();
      timerIdRef.current = setTimeout(() => {
        onDismiss(toast.id);
      }, Math.max(0, remainingTimeRef.current));
    }

    return () => {
      if (timerIdRef.current) clearTimeout(timerIdRef.current);
    };
  }, [isPaused, toast.id, onDismiss]);

  const variants = {
    success: {
      border: "border-l-4 border-l-[#10B981]",
      badge: "bg-emerald-50 text-emerald-600",
      icon: <Check className="h-4 w-4" />,
    },
    error: {
      border: "border-l-4 border-l-[#EF4444]",
      badge: "bg-red-50 text-destructive",
      icon: <AlertCircle className="h-4 w-4" />,
    },
    warning: {
      border: "border-l-4 border-l-[#F59E0B]",
      badge: "bg-amber-50 text-amber-600",
      icon: <AlertTriangle className="h-4 w-4" />,
    },
    info: {
      border: "border-l-4 border-l-[#2E85D8]",
      badge: "bg-blue-50 text-accent",
      icon: <Info className="h-4 w-4" />,
    },
  };

  const currentVariant = variants[toast.type] || variants.info;

  return (
    <div
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className={cn(
        "pointer-events-auto flex w-80 md:w-96 items-start gap-3 rounded-xl bg-surface p-4 shadow-lg border border-slate-100 transition-all duration-300 font-sans animate-fade-slide-in",
        currentVariant.border
      )}
      role="alert"
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-0.5",
          currentVariant.badge
        )}
      >
        {currentVariant.icon}
      </div>

      <div className="flex-1 min-w-0 pr-2">
        {toast.title && (
          <h4 className="text-xs font-bold text-dark-slate uppercase tracking-wider mb-0.5">
            {toast.title}
          </h4>
        )}
        <p className="text-xs text-muted-slate leading-normal break-words">
          {toast.message}
        </p>
      </div>

      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="rounded-md p-1 text-muted-slate hover:text-dark-slate transition-colors"
        aria-label="Dismiss toast"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ToastContainer({ toasts, onDismiss }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div
      className="fixed z-[1200] flex flex-col gap-2.5 pointer-events-none"
      style={{ top: "24px", right: "24px" }}
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
