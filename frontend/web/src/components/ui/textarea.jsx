import * as React from "react";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef(({ className, error, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-lg border bg-surface p-3 text-sm text-dark-slate placeholder:text-muted-slate shadow-sm transition-all duration-200 outline-none disabled:cursor-not-allowed disabled:opacity-50",
        error
          ? "border-destructive focus-visible:border-destructive focus-visible:ring-2 focus-visible:ring-destructive/20"
          : "border-slate-200 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
