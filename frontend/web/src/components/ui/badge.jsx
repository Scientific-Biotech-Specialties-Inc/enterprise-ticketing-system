import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full text-xs font-semibold select-none font-sans transition-colors h-6 px-3 leading-none",
  {
    variants: {
      variant: {
        // High-emphasis (solid)
        default: "bg-primary text-white",
        success: "bg-emerald-600 text-white",
        warning: "bg-amber-500 text-white",
        destructive: "bg-red-600 text-white",
        info: "bg-sky-600 text-white",
        violet: "bg-indigo-600 text-white",
        muted: "bg-slate-600 text-white",

        // Medium-emphasis (pastel with 1px border - standard for table rows)
        "medium-success": "bg-emerald-50 text-emerald-700 border border-emerald-300",
        "medium-warning": "bg-amber-50 text-amber-800 border border-amber-300",
        "medium-destructive": "bg-red-50 text-red-700 border border-red-300",
        "medium-info": "bg-sky-50 text-sky-700 border border-sky-300",
        "medium-violet": "bg-indigo-50 text-indigo-700 border border-indigo-200",
        "medium-muted": "bg-slate-100 text-slate-700 border border-slate-300",

        // Low-emphasis (borderless soft tinted wash)
        "low-success": "bg-emerald-50 text-emerald-700",
        "low-warning": "bg-amber-50 text-amber-800",
        "low-destructive": "bg-red-50 text-red-700",
        "low-info": "bg-sky-50 text-sky-700",
        "low-violet": "bg-indigo-50 text-indigo-700",
        "low-muted": "bg-slate-100 text-slate-600",
      },
      size: {
        default: "h-6 px-3 text-xs",
        sm: "h-5 px-2 text-[11px]",
        lg: "h-7 px-3.5 text-xs",
      },
    },
    defaultVariants: {
      variant: "medium-info",
      size: "default",
    },
  }
);

/**
 * Normalizes any text to Title Case (e.g. "IN_PROGRESS" -> "In Progress", "open" -> "Open")
 */
function toTitleCase(str) {
  if (!str) return "";
  return String(str)
    .replace(/[_-]/g, " ")
    .replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase());
}

/**
 * Maps ticket status or priority to canonical ONE UI badge variant
 */
export function getStatusBadgeVariant(status, tier = "medium") {
  const s = String(status || "").toLowerCase().trim();
  const prefix = tier === "high" ? "" : `${tier}-`;

  if (s === "open" || s === "new") return `${prefix}info`;
  if (s === "in_progress" || s === "in progress" || s === "pending" || s === "assigned" || s === "pending approval") {
    return `${prefix}warning`;
  }
  if (s === "resolved" || s === "approved" || s === "active" || s === "completed") {
    return `${prefix}success`;
  }
  if (s === "closed" || s === "inactive" || s === "archived") {
    return `${prefix}muted`;
  }
  if (s === "rejected" || s === "cancelled" || s === "canceled" || s === "error" || s === "high" || s === "urgent" || s === "breached") {
    return `${prefix}destructive`;
  }
  if (s === "medium" || s === "cs" || s === "admin") {
    return `${prefix}violet`;
  }
  if (s === "low") {
    return `${prefix}info`;
  }
  return `${prefix}info`;
}

function Badge({ className, variant, size, dot = false, children, ...props }) {
  const content = typeof children === "string" ? toTitleCase(children) : children;
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" />}
      {content}
    </span>
  );
}

export { Badge, badgeVariants, toTitleCase };
