import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-50 overflow-hidden rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-slate-50 shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 max-w-xs leading-normal",
      className
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

/**
 * Reusable InfoTooltip helper for KPI definitions and calculation methods.
 */
export function InfoTooltip({ content, children, className }) {
  if (!content) return null;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          {children || (
            <button
              type="button"
              className={cn("text-slate-muted hover:text-slate-dark transition-colors inline-flex items-center justify-center p-0.5 rounded focus:outline-none focus:ring-1 focus:ring-accent", className)}
              aria-label="More information"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
            </button>
          )}
        </TooltipTrigger>
        <TooltipContent side="top" align="center" className="text-[11px] font-normal font-sans shadow-lg bg-slate-900/95 text-slate-100">
          {content}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };

