import * as React from "react";
import { Info } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function MetricCard({
  title,
  label,
  value,
  subtitle,
  definition,
  trend,
  trendPositive = true,
  icon,
  iconBg,
  loading = false,
  className,
  onClick,
  variant = "default",
  showTooltip = true,
}) {
  if (loading) {
    return (
      <div className={cn("p-3.5 sm:p-5 lg:p-6 rounded-[14px] bg-surface shadow-sm border border-slate-100/50 space-y-3 font-sans", className)}>
        <Skeleton className="h-3.5 w-24 max-w-full" />
        <div className="flex justify-between items-center gap-2">
          <Skeleton className="h-8 w-16 max-w-full" />
          <Skeleton className="h-8 w-8 sm:h-10 sm:w-10 rounded-lg sm:rounded-xl shrink-0" />
        </div>
        <Skeleton className="h-4 w-14 max-w-full" />
      </div>
    );
  }

  const displayTitle = title || label;

  const defaultIconBg =
    variant === "crimson" || variant === "destructive"
      ? "bg-rose-50 text-rose-600"
      : variant === "amber" || variant === "warning"
      ? "bg-amber-50 text-amber-600"
      : "bg-blue-50 text-accent";

  const resolvedIconBg = iconBg || defaultIconBg;

  const renderIcon = () => {
    if (!icon) return null;
    if (React.isValidElement(icon)) {
      return React.cloneElement(icon, {
        className: cn("w-4 h-4 sm:w-5 sm:h-5", icon.props?.className),
      });
    }
    if (
      typeof icon === "function" ||
      (typeof icon === "object" && icon !== null && (icon.$$typeof || icon.render))
    ) {
      const IconComponent = icon;
      return <IconComponent className="w-4 h-4 sm:w-5 sm:h-5" />;
    }
    return null;
  };

  const valueStr = value != null ? String(value) : '';
  const isVeryLong = typeof value === 'string' && value.length > 8; // e.g. "Unavailable" (11 chars)
  const isMediumLong = typeof value === 'string' && value.length > 5; // e.g. "No data" (7 chars), "100.0%" (6 chars)

  return (
    <div
      onClick={onClick}
      className={cn(
        "p-3.5 sm:p-5 lg:p-6 rounded-[14px] bg-surface shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md border border-slate-100/50 font-sans flex flex-col justify-between min-w-0",
        onClick && "cursor-pointer",
        className
      )}
    >
      <div className="min-w-0">
        <p className="text-[11px] sm:text-xs font-semibold text-eyebrow uppercase tracking-wider mb-1.5 sm:mb-2 flex items-center justify-between gap-1">
          <span className="truncate">{displayTitle}</span>
          {showTooltip && definition && (
            <span
              role="img"
              tabIndex={0}
              title={definition}
              aria-label={`${displayTitle}: ${definition}`}
              className="inline-flex cursor-help text-muted-slate normal-case focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-full shrink-0"
            >
              <Info className="w-3.5 h-3.5" aria-hidden="true" />
            </span>
          )}
        </p>
        <div className="flex items-center justify-between gap-1.5 sm:gap-2 min-w-0">
          <p
            title={showTooltip ? valueStr : undefined}
            className={cn(
              "font-bold text-dark-slate font-sans tracking-tight min-w-0 flex-1 truncate",
              isVeryLong
                ? "text-sm sm:text-base lg:text-lg leading-tight"
                : isMediumLong
                ? "text-base sm:text-lg lg:text-2xl leading-tight"
                : "text-2xl sm:text-3xl leading-none"
            )}
          >
            {value}
          </p>
          {icon && (
            <div
              className={cn(
                "h-8 w-8 sm:h-10 sm:w-10 rounded-lg sm:rounded-xl flex items-center justify-center shrink-0",
                resolvedIconBg
              )}
            >
              {renderIcon()}
            </div>
          )}
        </div>
      </div>

      {(trend || subtitle) && (
        <div className="flex items-center gap-2 mt-2 sm:mt-3 min-w-0">
          {trend && (
            <span
              className={cn(
                "text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full inline-flex items-center shrink-0",
                trendPositive
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-red-50 text-red-600"
              )}
            >
              {trend}
            </span>
          )}
          {subtitle && (
            <p className="text-[10px] sm:text-xs text-muted-slate truncate">{subtitle}</p>
          )}
        </div>
      )}
    </div>
  );
}
