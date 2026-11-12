import React from 'react';
import { Ban, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * Turn a failed employee request into a notice that says what went wrong.
 *
 * A superadmin Transition Matrix block (code INVALID_TICKET_TRANSITION) names the blocked move;
 * any other failure shows the server's reason, or `fallbackMessage` when there is none.
 */
export function getActionError(err, fallbackMessage = 'Something went wrong. Please try again.') {
  const data = err?.response?.data;

  if (data?.code === 'INVALID_TICKET_TRANSITION') {
    const toStatus = data.to_status || 'Requested';
    // Spec 0038 AC-25: name the blocked move and the statuses that are allowed.
    const fromStatus = data.from_status ? String(data.from_status).replace(/\s*\((?:Employee|CS)-owned\)/i, '') : '';
    const allowed = Array.isArray(data.allowed_statuses)
      ? data.allowed_statuses.filter(Boolean).map((s) => String(s).replace(/\s*\((?:Employee|CS)-owned\)/i, ''))
      : [];
    const allowedText = allowed.length > 0
      ? ` Allowed next statuses: ${[...new Set(allowed)].join(', ')}.`
      : '';
    const message = fromStatus
      ? `Your administrator's transition rules don't allow ${fromStatus} to ${toStatus}, so your changes were not saved.${allowedText}`
      : `The ${toStatus} status has been blocked by the Super Admin, so your changes were not saved. Please contact your Super Admin for assistance.`;
    return {
      kind: 'blocked',
      title: `${toStatus} Status Blocked`,
      message,
      inline: fromStatus
        ? `Not saved: ${fromStatus} to ${toStatus} is not allowed by the transition rules.`
        : `Not saved: the ${toStatus} status has been blocked by the Super Admin.`,
    };
  }

  if (data?.virus_detected || data?.has_threats) {
    return {
      kind: 'error',
      title: 'File Failed Security Scan',
      message: 'One or more uploaded files failed security scanning and were quarantined. Nothing was saved. Remove or replace the flagged file with a clean document, then try again.',
      inline: 'Not saved: a file failed security scanning.',
    };
  }

  if (!err?.response) {
    return {
      kind: 'error',
      title: 'Connection Problem',
      message: 'The server could not be reached, so nothing was saved. Check your connection, then try again.',
      inline: 'Not saved: the server could not be reached.',
    };
  }

  const reason = data?.message || fallbackMessage;
  return {
    kind: 'error',
    title: 'Could Not Save',
    message: `${reason} Nothing was saved.`,
    inline: reason,
  };
}

/**
 * Modal telling the employee why their ticket update failed.
 * Rendered above other ticket modals (the proof upload modal uses z-[110]).
 */
export default function ActionErrorModal({ error, onClose }) {
  const isBlocked = error?.kind === 'blocked';
  return (
    <Dialog open={Boolean(error)} onOpenChange={(open) => !open && onClose?.()}>
      <DialogContent className="z-[120] max-w-md p-6 text-center sm:text-center">
        <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-warning">
          {isBlocked ? <Ban className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6" />}
        </div>
        <DialogHeader className="space-y-2 text-center sm:text-center">
          <DialogTitle className="text-center text-xl font-bold text-dark-slate">
            {error?.title}
          </DialogTitle>
          <DialogDescription className="text-center text-sm text-muted-slate">
            {error?.message}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex justify-center">
          <Button type="button" onClick={onClose} className="w-full sm:w-auto min-w-[100px]">
            OK
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
