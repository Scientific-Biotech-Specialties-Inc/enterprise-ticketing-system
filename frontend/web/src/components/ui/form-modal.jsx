import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function FormModal({
  isOpen,
  onClose,
  onSubmit,
  title,
  subtitle,
  icon,
  confirmLabel = "Save Changes",
  cancelLabel = "Cancel",
  loading = false,
  maxWidth = "max-w-2xl",
  children,
}) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !loading && onClose?.()}>
      <DialogContent className={cn("p-6 font-sans", maxWidth)}>
        {/* Left-aligned header */}
        <div className="flex items-start gap-4 pb-4 border-b border-slate-100">
          {icon && (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-accent">
              {React.isValidElement(icon)
                ? icon
                : typeof icon === "function" ||
                  (typeof icon === "object" && icon !== null && (icon.$$typeof || icon.render))
                ? React.createElement(icon, { className: "w-5 h-5" })
                : null}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <DialogTitle className="text-xl font-bold text-dark-slate">
              {title}
            </DialogTitle>
            {subtitle && (
              <DialogDescription className="text-xs text-muted-slate mt-0.5">
                {subtitle}
              </DialogDescription>
            )}
          </div>
        </div>

        {/* Form Body */}
        <div className="py-2 max-h-[70vh] overflow-y-auto pr-1">
          {children}
        </div>

        {/* Right-aligned action footer */}
        <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={onSubmit}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
