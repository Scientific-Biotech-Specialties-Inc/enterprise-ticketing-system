import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-sans text-sm font-semibold transition-all duration-200 outline-none select-none disabled:pointer-events-none disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        // Primary Brand Navy: #252578, Hover: #2F2F8E, Pressed: #1E1E66 scale(0.98), Focus: 2px ring #2E85D8
        default:
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary-hover active:bg-primary-pressed active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:bg-th-header disabled:opacity-50",
        // Destructive Red: #EF4444, Hover: #DC2626, Pressed: #B91C1C scale(0.98), Focus: ring red-400
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive-hover active:bg-destructive-pressed active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-destructive-border focus-visible:ring-offset-2 disabled:bg-destructive/50 disabled:opacity-50",
        // Outline / Secondary: White bg, #CBD5E1 border, #1E293B text, Hover: #F8FAFC
        outline:
          "border border-slate-300 bg-surface text-dark-slate shadow-sm hover:bg-slate-100 hover:border-th-header active:bg-slate-200 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:text-th-header",
        // Secondary / Brand Accent
        secondary:
          "bg-accent text-accent-foreground shadow-sm hover:bg-accent/90 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:opacity-50",
        // Ghost
        ghost:
          "text-dark-slate hover:bg-slate-100 hover:text-dark-slate active:bg-slate-200 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50",
        // Link
        link:
          "text-accent underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-accent p-0 h-auto",
        // Workflow Approval (Solid Emerald: #10B981)
        success:
          "bg-success text-success-foreground shadow-sm hover:bg-success-hover active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-success-border focus-visible:ring-offset-2 disabled:opacity-50",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-12 rounded-lg px-6 text-base",
        icon: "h-10 w-10 p-0",
        "icon-sm": "h-8 w-8 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

const Button = React.forwardRef(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }), loading && "pointer-events-none opacity-70")}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            <span>{children}</span>
          </>
        ) : (
          children
        )}
      </Comp>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
