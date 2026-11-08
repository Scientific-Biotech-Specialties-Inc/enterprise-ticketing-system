import React, { useState, useEffect, useRef } from 'react';
import EmployeeFeedbackCard from './EmployeeFeedbackCard';
import StarRating from './StarRating';
import ThankYouScreen from './ThankYouScreen';
import { getEmployeeById, getTicketEmployees, saveFeedback, updateFeedback } from '@/data/mockFeedbackData';
import { getCategoryFeedbackQuestions } from '@/services/configurationService';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';

export default function FeedbackModal({ ticket, onClose, existingFeedback = null, mode = 'create' }) {
  useLockBodyScroll(true);
  const isEditMode = mode === 'edit' || Boolean(existingFeedback);
  const [step, setStep] = useState('form');
  const [ratings, setRatings] = useState(existingFeedback?.ratings || {});
  const [comments, setComments] = useState(existingFeedback?.comments || {});
  const [overallComment, setOverallComment] = useState(existingFeedback?.overallComment || existingFeedback?.comment || '');
  const [questionAnswers, setQuestionAnswers] = useState(existingFeedback?.questionAnswers || existingFeedback?.question_answers || {});
  const [questionsSnapshot, setQuestionsSnapshot] = useState(existingFeedback?.categoryQuestionsSnapshot || []);
  const [questionsLoading, setQuestionsLoading] = useState(!existingFeedback?.categoryQuestionsSnapshot?.length);
  const [validationError, setValidationError] = useState('');
  const modalRef = useRef(null);

  // Derive ticket category
  const ticketCategory = ticket?.category || ticket?.department?.name || ticket?.department || 'IT';

  // Fetch enabled questions for category at form open time and freeze snapshot in state
  useEffect(() => {
    if (existingFeedback?.categoryQuestionsSnapshot?.length > 0) {
      setQuestionsSnapshot(existingFeedback.categoryQuestionsSnapshot);
      setQuestionsLoading(false);
      return;
    }
    let isMounted = true;
    async function fetchQuestions() {
      try {
        setQuestionsLoading(true);
        const res = await getCategoryFeedbackQuestions(ticketCategory);
        if (isMounted && res?.questions && Array.isArray(res.questions)) {
          // Freeze snapshot for this session
          setQuestionsSnapshot(Object.freeze([...res.questions]));
        }
      } catch (err) {
        console.warn('Failed to fetch category feedback questions, using defaults:', err);
      } finally {
        if (isMounted) setQuestionsLoading(false);
      }
    }
    fetchQuestions();
    return () => {
      isMounted = false;
    };
  }, [ticketCategory, existingFeedback]);

  useEffect(() => {
    modalRef.current?.focus();
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && step !== 'thankyou') onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, step]);

  const employees = getTicketEmployees(ticket);

  const handleRatingChange = (employeeId, rating) => {
    setRatings((prev) => ({ ...prev, [employeeId]: rating }));
    setValidationError('');
  };

  const handleCommentChange = (employeeId, comment) => {
    setComments((prev) => ({ ...prev, [employeeId]: comment }));
  };

  const handleQuestionAnswerChange = (questionId, value) => {
    setQuestionAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const allRated = employees.every((emp) => ratings[emp.id] && ratings[emp.id] > 0);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!allRated) {
      setValidationError('Please provide a rating for all assigned support personnel.');
      return;
    }
    setIsSubmitting(true);
    try {
      if (isEditMode) {
        await updateFeedback(
          ticket.id,
          ratings,
          comments,
          overallComment,
          ticket.customer_id || ticket.customer,
          questionAnswers,
          questionsSnapshot
        );
      } else {
        await saveFeedback(
          ticket.id,
          ratings,
          comments,
          overallComment,
          ticket.customer_id || ticket.customer,
          questionAnswers,
          questionsSnapshot
        );
      }
    } catch (err) {
      console.error('Failed to submit feedback:', err);
      setValidationError('Failed to save feedback. Please check your network and try again.');
      setIsSubmitting(false);
      return;
    } finally {
      setIsSubmitting(false);
      setStep('thankyou');
    }
  };

  if (step === 'thankyou') {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 sm:p-6 backdrop-blur-[1.5px]">
        <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          <ThankYouScreen onDone={onClose} />
        </div>
      </div>
    );
  }

  const formatDisplayDate = (dateStr) => {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 sm:p-6 backdrop-blur-[1.5px]">
      <div
        ref={modalRef}
        tabIndex={-1}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="border-b border-gray-150 px-7 py-6 sm:px-8 shrink-0 bg-white">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900 tracking-tight">
                {isEditMode ? 'Edit Your Support Feedback' : 'How was your support experience?'}
              </h2>
              <p className="mt-1.5 text-sm text-gray-500 leading-relaxed">
                {isEditMode
                  ? 'Update your ratings and remarks within the 48-hour editing window.'
                  : 'Your feedback helps us recognize excellent support and improve our customer service.'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors shrink-0 cursor-pointer"
              aria-label="Close modal"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center px-2.5 py-1 rounded-lg font-bold text-[#252578] bg-blue-50 border border-blue-100">
              {ticket.id}
            </span>
            <span className="inline-flex items-center px-2.5 py-1 rounded-lg font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200">
              {ticketCategory} Category
            </span>
            {(ticket.title || ticket.subject) && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-gray-700 bg-gray-100 font-medium max-w-xs truncate">
                {ticket.title || ticket.subject}
              </span>
            )}
            {(ticket.closed_at || ticket.resolved_at) && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-gray-500 bg-gray-50 border border-gray-200">
                Closed: {formatDisplayDate(ticket.closed_at || ticket.resolved_at)}
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-7 py-6 sm:px-8 sm:py-7 space-y-6">
          <div className="space-y-4">
            {employees.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/70 px-5 py-5 text-center">
                <p className="text-sm font-medium text-gray-500">No assigned support personnel to rate for this ticket.</p>
              </div>
            ) : (
              employees.map((emp) => (
                <EmployeeFeedbackCard
                  key={emp.id}
                  employee={emp}
                  rating={ratings[emp.id] || 0}
                  onRatingChange={(r) => handleRatingChange(emp.id, r)}
                  comment={comments[emp.id] || ''}
                  onCommentChange={(c) => handleCommentChange(emp.id, c)}
                />
              ))
            )}
          </div>

          {/* TS104 Category-Scoped Questions */}
          {questionsSnapshot && questionsSnapshot.length > 0 && (
            <div className="rounded-2xl border border-gray-150 bg-gray-50/40 p-5 sm:p-6 space-y-5">
              <div className="border-b border-gray-200/80 pb-3">
                <h3 className="text-sm font-bold text-gray-900 tracking-tight">Service Quality Evaluation</h3>
                <p className="text-xs text-gray-500 mt-0.5">Please share your perspective on the following category-specific questions:</p>
              </div>

              <div className="space-y-4">
                {questionsSnapshot.map((q) => {
                  const val = questionAnswers[q.id];
                  return (
                    <div key={q.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-xs space-y-3">
                      <p className="text-sm font-semibold text-gray-800 leading-snug">{q.text}</p>

                      {q.responseType === 'Star Rating' && (
                        <div className="pt-1">
                          <StarRating
                            value={val || 0}
                            onChange={(r) => handleQuestionAnswerChange(q.id, r)}
                          />
                        </div>
                      )}

                      {q.responseType === 'Multiple Choice' && (
                        <div className="flex items-center gap-2 flex-wrap pt-1">
                          {(q.options || ['Yes', 'No']).map((opt) => {
                            const isSelected = val === opt;
                            return (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => handleQuestionAnswerChange(q.id, opt)}
                                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer select-none border ${
                                  isSelected
                                    ? 'bg-[#252578] text-white border-[#252578] shadow-xs'
                                    : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100 hover:border-gray-300'
                                }`}
                              >
                                {opt}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {q.responseType === 'Free Text' && (
                        <textarea
                          value={val || ''}
                          onChange={(e) => handleQuestionAnswerChange(q.id, e.target.value)}
                          placeholder="Type your response here..."
                          rows={2}
                          maxLength={500}
                          className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50/50 p-3 text-xs text-gray-800 outline-none transition-colors focus:border-[#252578]/40 focus:bg-white focus:ring-2 focus:ring-[#252578]/15 placeholder:text-gray-400"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </div>

        <div className="border-t border-gray-150 px-7 py-5 sm:px-8 shrink-0 bg-gray-50/50">
          {validationError && (
            <p className="mb-3 text-sm font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{validationError}</p>
          )}
          <div className="flex justify-end items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-5 py-2.5 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-200/70 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!allRated || isSubmitting}
              className="rounded-xl bg-[#252578] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1f1f66] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer shadow-xs"
            >
              {isSubmitting
                ? (isEditMode ? 'Saving Changes...' : 'Submitting...')
                : (isEditMode ? 'Save Changes' : 'Submit Feedback')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
