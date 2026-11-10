import React, { useState, useEffect } from 'react';
import { Pencil, X, Clock, CheckCircle2, Star, HelpCircle } from 'lucide-react';
import EmployeeFeedbackCard from './EmployeeFeedbackCard';
import { getTicketFeedback, getTicketEmployees, fetchFeedbackForTicket, feedbackTicketId } from '@/data/mockFeedbackData';

export default function TicketFeedbackSection({ ticket, onLeaveFeedback, onEditFeedback, readOnly = false }) {
  const ticketId = feedbackTicketId(ticket);
  const [feedback, setFeedback] = useState(() => getTicketFeedback(ticketId));
  const [isDismissed, setIsDismissed] = useState(false);

  // Sync feedback on prop change, backend fetch, or custom events
  useEffect(() => {
    let isMounted = true;
    const local = getTicketFeedback(ticketId);
    if (local) setFeedback(local);

    if (typeof fetchFeedbackForTicket === 'function') {
      fetchFeedbackForTicket(ticketId)
        ?.then((fb) => {
          if (isMounted && fb) {
            setFeedback(fb);
          }
        })
        ?.catch(() => {});
    }

    return () => {
      isMounted = false;
    };
  }, [ticketId]);

  useEffect(() => {
    const handleUpdate = () => {
      setFeedback(getTicketFeedback(ticketId));
      setIsDismissed(false);
    };
    window.addEventListener('customer_feedback_submitted', handleUpdate);
    window.addEventListener('customer_feedback_updated', handleUpdate);
    window.addEventListener('customer_feedback_deleted', handleUpdate);
    return () => {
      window.removeEventListener('customer_feedback_submitted', handleUpdate);
      window.removeEventListener('customer_feedback_updated', handleUpdate);
      window.removeEventListener('customer_feedback_deleted', handleUpdate);
    };
  }, [ticketId]);

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  // 48-hour edit window calculation
  const submissionTime = feedback?.submittedAt ? new Date(feedback.submittedAt).getTime() : 0;
  const editWindowMs = 48 * 60 * 60 * 1000;
  const timeSinceSubmission = Date.now() - submissionTime;
  const isWithinEditWindow = submissionTime > 0 && timeSinceSubmission < editWindowMs;
  const hoursRemaining = isWithinEditWindow ? Math.max(1, Math.round((editWindowMs - timeSinceSubmission) / (60 * 60 * 1000))) : 0;

  // In readOnly mode without feedback, show clean informative placeholder
  if (readOnly && (!feedback || !feedback.submitted)) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-page p-4 text-center">
        <p className="text-xs font-medium text-slate-muted">
          No customer feedback submitted yet for this ticket.
        </p>
      </div>
    );
  }

  // If dismissed and no feedback submitted, show minimal banner
  if (isDismissed && (!feedback || !feedback.submitted)) {
    return (
      <div className="rounded-xl border border-border bg-page p-4 flex items-center justify-between text-xs text-slate-muted">
        <span>Feedback prompt dismissed. You can share your feedback whenever you are ready.</span>
        <button
          type="button"
          onClick={() => setIsDismissed(false)}
          className="font-bold text-primary hover:text-accent underline cursor-pointer ml-3"
        >
          Rate Experience
        </button>
      </div>
    );
  }

  // Not yet submitted state: Rate Your Experience prompt (customer mode only)
  if (!feedback || !feedback.submitted) {
    return (
      <div className="relative rounded-xl border border-border bg-card p-6 shadow-xs text-center animate-in fade-in duration-200">
        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          className="absolute top-4 right-4 text-slate-muted hover:text-slate-dark transition-colors p-1 rounded-md cursor-pointer"
          aria-label="Dismiss feedback prompt"
          title="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
          <Star className="h-6 w-6 text-amber-500 fill-amber-500" />
        </div>
        <h3 className="mt-3 text-base font-bold text-slate-dark">Rate Your Experience</h3>
        <p className="mt-1 text-sm text-slate-muted max-w-md mx-auto leading-relaxed">
          Your feedback is optional but greatly appreciated. Help us improve our customer support by rating the team members who assisted you.
        </p>

        <div className="mt-4 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setIsDismissed(true)}
            className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-slate-muted hover:text-slate-dark hover:bg-muted transition-colors cursor-pointer"
          >
            Not Now
          </button>
          <button
            type="button"
            onClick={onLeaveFeedback}
            className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 cursor-pointer shadow-xs"
          >
            Leave Feedback
          </button>
        </div>
      </div>
    );
  }

  const employees = getTicketEmployees(ticket);

  return (
    <div className="rounded-xl border border-border bg-page p-6 shadow-xs space-y-4 animate-in fade-in duration-200">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <h3 className="text-base font-bold text-slate-dark">Customer Feedback</h3>
          <p className="text-xs text-slate-muted mt-0.5">
            Submitted on {formatDate(feedback.submittedAt)}
            {feedback.updatedAt && ` · Edited on ${formatDate(feedback.updatedAt)}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!readOnly && isWithinEditWindow && (
            <>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
                <Clock className="w-3 h-3 text-amber-600" />
                Editable for {hoursRemaining}h
              </span>
              <button
                type="button"
                onClick={() => (onEditFeedback ? onEditFeedback(feedback) : onLeaveFeedback('edit', feedback))}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-semibold text-slate-dark hover:bg-muted transition-colors cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5 text-primary" />
                Edit
              </button>
            </>
          )}
          {!readOnly && !isWithinEditWindow && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-muted bg-card border border-border px-2.5 py-1 rounded-lg">
              Feedback locked (48h edit window closed)
            </span>
          )}
          {readOnly && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              Verified Customer Submission
            </span>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {employees.map((emp) => {
          const empRating = feedback.ratings?.[emp.id] ?? feedback.ratings?.[String(emp.id)] ?? feedback.ratings?.[Number(emp.id)] ?? (employees.length === 1 && Object.values(feedback.ratings || {})[0]) ?? (feedback.overallRating || 0);
          const empComment = feedback.comments?.[emp.id] ?? feedback.comments?.[String(emp.id)] ?? feedback.comments?.[Number(emp.id)] ?? (employees.length === 1 && Object.values(feedback.comments || {})[0]) ?? '';
          return (
            <EmployeeFeedbackCard
              key={emp.id}
              employee={emp}
              rating={Number(empRating) || 0}
              comment={empComment || ''}
              readOnly
              submissionDate={formatDate(feedback.submittedAt)}
            />
          );
        })}
      </div>

      {feedback.overallComment && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-muted">Overall Experience Feedback</p>
          <p className="mt-1.5 text-sm text-slate-dark leading-relaxed whitespace-pre-wrap">{feedback.overallComment}</p>
        </div>
      )}

      {feedback.categoryQuestionsSnapshot && feedback.categoryQuestionsSnapshot.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-xs space-y-3">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-muted">Category Service Evaluation</p>
          <div className="divide-y divide-border">
            {feedback.categoryQuestionsSnapshot.map((q) => {
              const answer = feedback.questionAnswers?.[q.id] ?? feedback.questionAnswers?.[String(q.id)] ?? feedback.questionAnswers?.[Number(q.id)];
              return (
                <div key={q.id} className="py-2.5 first:pt-0 last:pb-0">
                  <p className="text-xs font-medium text-slate-muted">{q.text}</p>
                  <p className="mt-1 text-sm font-semibold text-slate-dark">
                    {answer !== undefined && answer !== null && answer !== '' ? String(answer) : '—'}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
