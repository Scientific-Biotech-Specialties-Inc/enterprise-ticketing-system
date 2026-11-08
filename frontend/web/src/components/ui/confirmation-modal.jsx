import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Trash2, CheckCircle2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "destructive", // 'destructive' | 'success' | 'warning' | 'primary'
  loading = false,
  requiresReason = false,
  reasonPlaceholder = "Please provide remarks or reason for this action...",
  requiresPassword = false,
  children,
}) {
  const [reason, setReason] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (isOpen) {
      setReason("");
      setPassword("");
      setError("");
    }
  }, [isOpen]);

  const handleConfirm = () => {
    if (requiresReason && !reason.trim()) {
      setError("A reason is required to proceed.");
      return;
    }
    if (requiresPassword && !password.trim()) {
      setError("Password confirmation is required.");
      return;
    }
    setError("");
    onConfirm?.({ reason, password });
  };

  const iconVariants = {
    destructive: {
      bg: "bg-red-50 text-destructive",
      icon: <Trash2 className="h-6 w-6" />,
      buttonVariant: "destructive",
    },
    warning: {
      bg: "bg-amber-50 text-warning",
      icon: <AlertTriangle className="h-6 w-6" />,
      buttonVariant: "destructive",
    },
    success: {
      bg: "bg-emerald-50 text-emerald-600",
      icon: <CheckCircle2 className="h-6 w-6" />,
      buttonVariant: "success",
    },
    primary: {
      bg: "bg-blue-50 text-primary",
      icon: <ShieldAlert className="h-6 w-6" />,
      buttonVariant: "default",
    },
  };

  const config = iconVariants[variant] || iconVariants.destructive;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !loading && onClose?.()}>
      <DialogContent className="max-w-md p-6 text-center sm:text-center">
        {/* Status Icon Badge centered */}
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full mb-3" style={{ background: undefined }}>
          <div className={cn("h-14 w-14 rounded-full flex items-center justify-center", config.bg)}>
            {config.icon}
          </div>
        </div>

        <DialogHeader className="text-center sm:text-center space-y-2">
          <DialogTitle className="text-xl font-bold text-dark-slate text-center">
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription className="text-sm text-muted-slate text-center">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>

        {children}

        {requiresReason && (
          <div className="mt-4 text-left space-y-1.5">
            <label className="text-xs font-semibold text-eyebrow uppercase tracking-wider">
              Reason / Remarks <span className="text-destructive">*</span>
            </label>
            <Textarea
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError("");
              }}
              placeholder={reasonPlaceholder}
              rows={3}
              error={!!error}
              disabled={loading}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}

        {requiresPassword && (
          <div className="mt-4 text-left space-y-1.5">
            <label className="text-xs font-semibold text-eyebrow uppercase tracking-wider">
              Confirm Password <span className="text-destructive">*</span>
            </label>
            <Input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError("");
              }}
              placeholder="Enter your password to authorize"
              error={!!error}
              disabled={loading}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}

        {/* Centered Action Footer */}
        <div className="mt-6 flex flex-col-reverse sm:flex-row justify-center items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={loading}
            className="w-full sm:w-auto min-w-[100px]"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={config.buttonVariant}
            onClick={handleConfirm}
            loading={loading}
            className="w-full sm:w-auto min-w-[100px]"
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
