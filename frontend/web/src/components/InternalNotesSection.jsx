import React, { useState, useMemo } from 'react';
import { AlertTriangle, Loader2, Lock, ShieldAlert, AlertCircle, X, Clock } from 'lucide-react';
import { formatDisplayDate } from '@/utils/dateUtils';
import { validateNoteText, NOTE_MAX_LENGTH } from '@/utils/noteValidation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const TRUNCATE_CHAR_LIMIT = 350;

/**
 * Individual note card with structured display, author role badge, and truncation toggle.
 */
export function NoteItem({
  id,
  author,
  role,
  timestamp,
  text = '',
  truncateLimit = TRUNCATE_CHAR_LIMIT,
  className = '',
  isOptimistic = false,
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isLong = text.length > truncateLimit;
  const displayText = isLong && !isExpanded ? `${text.slice(0, truncateLimit)}...` : text;

  // Derive role if not explicitly provided
  const displayRole = role || (
    /tech|eng/i.test(author || '')
      ? 'Technician'
      : /cs|support/i.test(author || '')
      ? 'Customer Support'
      : /admin/i.test(author || '')
      ? 'Administrator'
      : 'Staff Member'
  );

  return (
    <div
      className={`bg-card border rounded-xl p-3 shadow-xs text-field-value leading-relaxed min-w-0 max-w-full overflow-hidden font-sans transition-all ${
        isOptimistic
          ? 'border-accent/40 bg-accent/5 opacity-80'
          : 'border-border'
      } ${className}`}
    >
      <div className="flex flex-wrap justify-between items-center gap-1.5 text-timestamp text-muted-slate mb-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-badge text-primary font-semibold">{author || 'Staff Member'}</span>
          <span className="text-[10px] bg-muted/60 text-muted-foreground font-semibold px-2 py-0.5 rounded-full border border-border tracking-wide uppercase">
            {displayRole}
          </span>
          {isOptimistic && (
            <span className="text-[10px] bg-accent/10 text-accent font-semibold px-1.5 py-0.5 rounded animate-pulse inline-flex items-center gap-1">
              <Clock size={10} /> Sending...
            </span>
          )}
        </div>
        <span className="text-timestamp">{formatDisplayDate(timestamp)}</span>
      </div>
      <p
        className="text-field-value text-dark-slate break-words whitespace-pre-wrap max-w-full overflow-hidden"
        style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
      >
        {displayText}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="text-xs text-primary hover:text-accent font-semibold mt-1 inline-block cursor-pointer transition-colors"
        >
          {isExpanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

/**
 * Reusable list container for internal notes sorted chronologically.
 */
export function NoteList({
  notes = [],
  emptyMessage = 'No internal notes recorded for this ticket yet.',
  maxHeightClass = 'max-h-60',
  truncateLimit = TRUNCATE_CHAR_LIMIT,
}) {
  const sortedNotes = useMemo(() => {
    const list = [...(notes || [])];
    list.sort((a, b) => {
      const timeA = a.timestamp || a.created_at || a.date ? new Date(a.timestamp || a.created_at || a.date).getTime() : 0;
      const timeB = b.timestamp || b.created_at || b.date ? new Date(b.timestamp || b.created_at || b.date).getTime() : 0;
      return timeA - timeB; // Chronological order: oldest to newest
    });
    return list;
  }, [notes]);

  if (!sortedNotes || sortedNotes.length === 0) {
    return (
      <div className="py-3 text-center bg-muted/30 rounded-xl border border-dashed border-border">
        <p className="text-xs text-muted-slate italic">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={`space-y-2.5 ${maxHeightClass} overflow-y-auto pr-1`}>
      {sortedNotes.map((note, index) => (
        <NoteItem
          key={note.id || `note-${index}`}
          id={note.id || index}
          author={note.author || note.employee_name}
          role={note.role || note.author_role}
          timestamp={note.timestamp || note.created_at || note.date}
          text={note.text || note.remark || ''}
          truncateLimit={truncateLimit}
          isOptimistic={note.isOptimistic}
        />
      ))}
    </div>
  );
}

/**
 * Staff-Only Internal Notes section:
 * 1. Visually distinct with private styling and lock badge.
 * 2. Displays author, staff role badge, and chronological timestamp.
 * 3. Immediate optimistic UI updates.
 * 4. Clear error messaging with user text preservation on failed submission.
 * 5. Role authorization guard (staff only).
 * 6. Responsive & accessible on desktop and mobile.
 */
export default function InternalNotesSection({
  notes = [],
  onAddNote,
  isAdding = false,
  title = 'Internal Staff Notes',
  badgeText = 'Staff-Only',
  subtitle = 'Confidential · Hidden from customer view',
  emptyMessage = 'No internal notes added yet. Notes added here are strictly private to support staff.',
  maxListHeight = 'max-h-64',
  readOnly = false,
  userRole = null,
  disabledReason = null,
}) {
  const [noteText, setNoteText] = useState('');
  const [warnPending, setWarnPending] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Authorization check: only authorized staff roles can view or submit internal notes
  const isAuthorized = useMemo(() => {
    if (!userRole) return true; // Defaults to authorized when used on internal staff pages
    const r = String(userRole).toLowerCase().trim();
    return ['employee', 'technician', 'cs', 'customer support', 'customer service', 'head of cs', 'head of customer service', 'admin', 'superadmin', 'super admin', 'engineer'].includes(r);
  }, [userRole]);

  const validation = useMemo(() => validateNoteText(noteText), [noteText]);

  const handleTextChange = (e) => {
    setNoteText(e.target.value);
    if (warnPending) setWarnPending(false);
    if (submitError) setSubmitError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = noteText.trim();
    if (!trimmed || isAdding || validation.isOverLimit) return;

    // Soft gibberish warning confirmation
    if (validation.warning && !warnPending) {
      setWarnPending(true);
      return;
    }

    setSubmitError('');

    if (typeof onAddNote === 'function') {
      try {
        await onAddNote(trimmed);
        // ONLY clear note text upon confirmed success
        setNoteText('');
        setWarnPending(false);
      } catch (err) {
        console.error('Internal note submission failed:', err);
        const errorMsg =
          err?.response?.data?.message ||
          err?.message ||
          'Failed to submit internal note. Your draft text has been preserved below. Please try again.';
        setSubmitError(errorMsg);
        // Note text is deliberately NOT cleared
      }
    }
  };

  if (!isAuthorized) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="Staff-Only Internal Notes"
      className="border border-border rounded-xl p-5 bg-slate-50/50 space-y-4 text-left font-sans"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center text-dark-slate shrink-0">
            <Lock size={14} className="text-dark-slate" />
          </div>
          <div>
            <h4 className="text-field-label uppercase text-dark-slate flex items-center gap-1.5 font-bold">
              <span>{title}</span>
              {badgeText && (
                <Badge variant="destructive" className="uppercase text-[10px]">
                  {badgeText}
                </Badge>
              )}
            </h4>
            {subtitle && (
              <p className="text-timestamp text-muted-slate italic">{subtitle}</p>
            )}
          </div>
        </div>
        <span className="text-[11px] text-muted-slate font-mono bg-card px-2 py-0.5 rounded-md border border-border">
          {notes.length} {notes.length === 1 ? 'note' : 'notes'}
        </span>
      </div>

      {/* Chronological Notes List */}
      <NoteList
        notes={notes}
        emptyMessage={emptyMessage}
        maxHeightClass={maxListHeight}
      />

      {/* Inline Submission Error (Preserves Text) */}
      {submitError && (
        <div
          role="alert"
          className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 font-medium flex items-start gap-2 animate-fadeIn"
        >
          <AlertCircle size={16} className="text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-bold block">Submission Failed:</span>
            {submitError}
            <span className="block text-[11px] text-red-700 mt-0.5">Your input has been preserved in the form below.</span>
          </div>
          <button
            type="button"
            onClick={() => setSubmitError('')}
            className="text-red-400 hover:text-red-600 p-0.5 cursor-pointer"
            aria-label="Dismiss error"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Input Form */}
      {!readOnly && typeof onAddNote === 'function' && (
        disabledReason ? (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-xl text-xs font-semibold flex items-center gap-2">
            <ShieldAlert size={15} className="text-amber-600 shrink-0" />
            <span>{disabledReason}</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-2 pt-1 border-t border-border">
            <div className="relative">
              <label htmlFor="internal-note-input" className="sr-only">
                Write an internal note
              </label>
              <textarea
                id="internal-note-input"
                rows={2}
                maxLength={NOTE_MAX_LENGTH}
                placeholder="Write an internal note..."
                value={noteText}
                disabled={isAdding}
                onChange={handleTextChange}
                className="w-full text-xs border border-border rounded-xl p-2.5 bg-card text-dark-slate outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent disabled:opacity-50 resize-y min-h-[44px]"
              />
            </div>

            {/* Always-visible maximum character limit indication & live counter */}
            <div className="flex justify-between items-center text-[11px] text-muted-slate px-0.5">
              <span className="font-medium text-muted-slate">Max {NOTE_MAX_LENGTH.toLocaleString()} characters</span>
              <span
                className={
                  validation.isOverLimit
                    ? 'text-red-500 font-bold'
                    : validation.charsRemaining <= 100
                    ? 'text-amber-600 font-semibold'
                    : 'text-muted-slate'
                }
              >
                {noteText.length} / {NOTE_MAX_LENGTH.toLocaleString()}
              </span>
            </div>

            {/* Inline Soft Gibberish Warning */}
            {validation.warning && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-2.5 text-xs text-amber-800 animate-fadeIn">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1 leading-snug">
                  <p className="font-semibold">{validation.warning}</p>
                  {warnPending ? (
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      Click &ldquo;Add Note&rdquo; again to submit anyway, or review your note above.
                    </p>
                  ) : (
                    <p className="text-[11px] text-amber-600 mt-0.5">
                      Please double-check before submitting.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2">
              {warnPending && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setWarnPending(false)}
                  className="cursor-pointer"
                >
                  Review Note
                </Button>
              )}
              <Button
                type="submit"
                size="sm"
                disabled={isAdding || !noteText.trim() || validation.isOverLimit}
                variant={warnPending ? 'warning' : 'default'}
                className="cursor-pointer"
              >
                {isAdding ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    Adding...
                  </>
                ) : warnPending ? (
                  'Submit Anyway'
                ) : (
                  'Add Note'
                )}
              </Button>
            </div>
          </form>
        )
      )}
    </div>
  );
}
