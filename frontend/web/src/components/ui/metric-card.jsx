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
}) {
  if (loading) {
    return (
      <div className={cn("p-6 rounded-[14px] bg-surface shadow-sm border border-slate-100/50 space-y-3 font-sans", className)}>
        <Skeleton className="h-3.5 w-24" />
        <div className="flex justify-between items-center">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-10 w-10 rounded-xl" />
        </div>
        <Skeleton className="h-4 w-14" />
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
    if (React.isValidElement(icon)) return icon;
    if (
      typeof icon === "function" ||
      (typeof icon === "object" && icon !== null && (icon.$$typeof || icon.render))
    ) {
      const IconComponent = icon;
      return <IconComponent className="w-5 h-5" />;
    }
    return null;
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        "p-6 rounded-[14px] bg-surface shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md border border-slate-100/50 font-sans flex flex-col justify-between",
        onClick && "cursor-pointer",
        className
      )}
    >
      <div>
        <p className="text-xs font-semibold text-eyebrow uppercase tracking-wider mb-2 flex items-center gap-1">
          {displayTitle}
          {definition && (
            <span
              role="img"
              tabIndex={0}
              title={definition}
              aria-label={`${displayTitle}: ${definition}`}
              className="inline-flex cursor-help text-muted-slate normal-case focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-full"
            >
              <Info className="w-3.5 h-3.5" aria-hidden="true" />
            </span>
          )}
        </p>
        <div className="flex items-center justify-between">
          <p className="text-3xl font-bold text-dark-slate font-sans tracking-tight">
            {value}
          </p>
          {icon && (
            <div
              className={cn(
                "h-10 w-10 rounded-xl flex items-center justify-center shrink-0",
                resolvedIconBg
              )}
            >
              {renderIcon()}
            </div>
          )}
        </div>
      </div>

      {(trend || subtitle) && (
        <div className="flex items-center gap-2 mt-3">
          {trend && (
            <span
              className={cn(
                "text-xs font-semibold px-2 py-0.5 rounded-full inline-flex items-center",
                trendPositive
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-red-50 text-red-600"
              )}
            >
              {trend}
            </span>
          )}
          {subtitle && (
            <p className="text-xs text-muted-slate">{subtitle}</p>
          )}
        </div>
      )}
    </div>
  );
}
