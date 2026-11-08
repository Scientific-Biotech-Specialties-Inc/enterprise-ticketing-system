import * as React from "react";
import { AlertTriangle, AlertCircle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export function PersistentBanner({
  title,
  message,
  variant = "warning",
  icon,
  action,
  className,
}) {
  const configs = {
    warning: {
      container: "bg-[#FFFDF0] border border-[#FCD34D] text-amber-900",
      iconColor: "text-[#D97706]",
      icon: <AlertCircle className="h-5 w-5" />,
    },
    error: {
      container: "bg-red-50 border border-red-200 text-red-900",
      iconColor: "text-destructive",
      icon: <AlertTriangle className="h-5 w-5" />,
    },
    info: {
      container: "bg-blue-50 border border-blue-200 text-blue-900",
      iconColor: "text-accent",
      icon: <Info className="h-5 w-5" />,
    },
    success: {
      container: "bg-emerald-50 border border-emerald-200 text-emerald-900",
      iconColor: "text-success",
      icon: <CheckCircle2 className="h-5 w-5" />,
    },
  };

  const cfg = configs[variant] || configs.warning;

  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 p-4 rounded-xl shadow-sm font-sans",
        cfg.container,
        className
      )}
    >
      <div className={cn("shrink-0 mt-0.5", cfg.iconColor)}>
        {icon || cfg.icon}
      </div>
      <div className="flex-1 text-sm">
        {title && <h5 className="font-semibold mb-0.5">{title}</h5>}
        <div className="text-xs leading-relaxed opacity-95">{message}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function InlineWarning({ message, className }) {
  if (!message) return null;
  return (
    <div className={cn("flex items-center gap-1.5 text-xs text-[#D97706] font-medium font-sans mt-1", className)}>
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
