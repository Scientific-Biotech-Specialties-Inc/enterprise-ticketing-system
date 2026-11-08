import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Returns a time-of-day greeting (e.g., "Good morning", "Good afternoon", "Good evening")
 */
export function getTimeOfDayGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * Hook to provide live clock time & date
 */
function useLiveClock() {
  const [now, setNow] = React.useState(new Date());

  React.useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeString = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  const dateString = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return { timeString, dateString };
}

/**
 * Pattern A: Dashboard Page Header (Home / Executive Views)
 */
export function DashboardHeader({
  eyebrow = "TICKETING SYSTEM",
  userName = "User",
  subtitle = "Here is your operational overview for today.",
  className,
}) {
  const { timeString, dateString } = useLiveClock();
  const greeting = getTimeOfDayGreeting();

  return (
    <div
      className={cn(
        "flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6 font-sans",
        className
      )}
    >
      <div>
        {eyebrow && (
          <span className="text-xs font-bold text-eyebrow tracking-wider uppercase block mb-1">
            {eyebrow}
          </span>
        )}
        <h1 className="text-2xl md:text-[26px] font-bold text-dark-slate tracking-tight">
          {greeting}, {userName}!
        </h1>
        {subtitle && (
          <p className="text-sm text-eyebrow mt-0.5 max-w-2xl">{subtitle}</p>
        )}
      </div>

      <div className="text-left md:text-right shrink-0 bg-surface md:bg-transparent p-3 md:p-0 rounded-xl md:rounded-none border md:border-0 border-slate-100 shadow-sm md:shadow-none">
        <div className="text-lg md:text-xl font-bold text-dark-slate tabular-nums">
          {timeString}
        </div>
        <div className="text-xs text-eyebrow mt-0.5">{dateString}</div>
      </div>
    </div>
  );
}

/**
 * Pattern B: Standard Page Header (All Functional Views)
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}) {
  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 font-sans",
        className
      )}
    >
      <div>
        <h1 className="text-2xl font-bold text-dark-slate tracking-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-eyebrow mt-0.5">{subtitle}</p>
        )}
      </div>

      {actions && (
        <div className="flex items-center gap-2.5 flex-wrap">{actions}</div>
      )}
    </div>
  );
}
