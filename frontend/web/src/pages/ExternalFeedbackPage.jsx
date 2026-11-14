import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { CheckCircle2, MessageSquare, Star, ArrowLeft, ShieldAlert, Sparkles, Building2, User } from 'lucide-react';
import EmployeeFeedbackCard from '@/components/feedback/EmployeeFeedbackCard';
import StarRating from '@/components/feedback/StarRating';
import ThankYouScreen from '@/components/feedback/ThankYouScreen';
import { getTicketEmployees, saveFeedback, hasFeedbackBeenSubmitted, getTicketFeedback, isFeedbackFormEnabled } from '@/data/mockFeedbackData';
import { getCategoryFeedbackQuestions, getFeedbackFormStatus } from '@/services/configurationService';
import tokenStore from '@/auth/tokenStore';

export default function ExternalFeedbackPage() {
  const { ticketId } = useParams();
  const navigate = useNavigate();

  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState('form');
  const [ratings, setRatings] = useState({});
  const [comments, setComments] = useState({});
  const [overallComment, setOverallComment] = useState('');
  const [questionAnswers, setQuestionAnswers] = useState({});
  const [questionsSnapshot, setQuestionsSnapshot] = useState([]);
  const [questionsLoading, setQuestionsLoading] = useState(true);
  const [validationError, setValidationError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMasterEnabled, setIsMasterEnabled] = useState(true);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);

  // Clean numeric ID or code
  const effectiveTicketId = ticketId || '1';

  // 1. Check master switch & load ticket
  useEffect(() => {
    let isMounted = true;

    async function initPage() {
      setLoading(true);
      try {
        // Check master switch
        const statusRes = await getFeedbackFormStatus().catch(() => null);
        if (statusRes && (statusRes.is_enabled !== undefined || statusRes.isEnabled !== undefined)) {
          const masterOn = Boolean(statusRes.is_enabled ?? statusRes.isEnabled);
          if (isMounted) setIsMasterEnabled(masterOn);
        }

        // Check for existing submitted feedback
        const localFb = getTicketFeedback(effectiveTicketId);
        if (localFb && localFb.submitted) {
          if (isMounted) {
            setAlreadySubmitted(true);
            setStep('already_submitted');
            if (localFb.ratings) setRatings(localFb.ratings);
            if (localFb.comments) setComments(localFb.comments);
            if (localFb.overallComment) setOverallComment(localFb.overallComment);
            if (localFb.questionAnswers) setQuestionAnswers(localFb.questionAnswers);
            if (Array.isArray(localFb.categoryQuestionsSnapshot) && localFb.categoryQuestionsSnapshot.length > 0) {
              setQuestionsSnapshot(localFb.categoryQuestionsSnapshot);
            }
          }
        } else {
          try {
            const apiRes = await fetch(`/api/ticketing/analytics/feedback/ticket/${effectiveTicketId}`, {
              headers: {
                Accept: 'application/json',
                ...(tokenStore.getToken() ? { Authorization: `Bearer ${tokenStore.getToken()}` } : {}),
              },
            });
            if (apiRes.ok) {
              const apiJson = await apiRes.json();
              if (apiJson.data && isMounted) {
                const d = apiJson.data;
                const rMap = {};
                const cMap = {};
                if (Array.isArray(d.employee_ratings)) {
                  d.employee_ratings.forEach((er) => {
                    if (er.employee_id) {
                      rMap[er.employee_id] = er.rating;
                      cMap[er.employee_id] = er.comment;
                    }
                  });
                }
                setRatings(rMap);
                setComments(cMap);
                setOverallComment(d.overall_comment || '');
                if (d.question_answers) setQuestionAnswers(d.question_answers);
                if (Array.isArray(d.category_questions_snapshot) && d.category_questions_snapshot.length > 0) {
                  setQuestionsSnapshot(d.category_questions_snapshot);
                }
                setAlreadySubmitted(true);
                setStep('already_submitted');
              }
            }
          } catch {
            // Ignore API errors
          }
        }

        // Fetch ticket details via API (with fallback)
        try {
          const token = localStorage.getItem('token') || localStorage.getItem('auth_token');
          const headers = { 'Accept': 'application/json' };
          if (token) headers['Authorization'] = `Bearer ${token}`;

          const res = await fetch(`/api/ticketing/ticket/tickets/${effectiveTicketId}`, { headers });
          if (res.ok) {
            const data = await res.json();
            if (isMounted) setTicket(data.ticket || data);
          } else {
            // Minimal fallback ticket object for external guest view
            if (isMounted) {
              setTicket({
                id: effectiveTicketId,
                ticket_ID: effectiveTicketId,
                title: `Service Ticket #${effectiveTicketId}`,
                category: 'Others',
                status: 'Closed',
              });
            }
          }
        } catch {
          if (isMounted) {
            setTicket({
              id: effectiveTicketId,
              ticket_ID: effectiveTicketId,
              title: `Service Ticket #${effectiveTicketId}`,
              category: 'Others',
              status: 'Closed',
            });
          }
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    initPage();
    return () => {
      isMounted = false;
    };
  }, [effectiveTicketId]);

  // Derive ticket category
  // Spec 0043 (AC-12): questions follow the ticket's live problem category name. A missing or
  // unclassified category loads the general `Others` set; `IT` is never a fallback.
  const ticketCategory = ticket?.category && ticket.category !== 'Unclassified' ? ticket.category : 'Others';

  // 2. Fetch category questions
  useEffect(() => {
    let isMounted = true;
    async function fetchQuestions() {
      try {
        setQuestionsLoading(true);
        const res = await getCategoryFeedbackQuestions(ticketCategory);
        if (isMounted && res?.questions && Array.isArray(res.questions)) {
          setQuestionsSnapshot(Object.freeze([...res.questions]));
        }
      } catch (err) {
        console.warn('Failed to fetch category feedback questions:', err);
      } finally {
        if (isMounted) setQuestionsLoading(false);
      }
    }
    // Wait for the ticket so the questions match its real category (spec 0043 AC-12).
    if (ticket && ticketCategory) {
      fetchQuestions();
    }
    return () => {
      isMounted = false;
    };
  }, [ticket, ticketCategory]);

  const employees = useMemo(() => getTicketEmployees(ticket), [ticket]);

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

  const allRated = employees.length > 0
    ? employees.every((emp) => ratings[emp.id] && ratings[emp.id] > 0)
    : true;

  const handleSubmit = async () => {
    if (!allRated && employees.length > 0) {
      setValidationError('Please provide a star rating for all assigned support specialists.');
      return;
    }
    setIsSubmitting(true);
    try {
      await saveFeedback(
        effectiveTicketId,
        ratings,
        comments,
        overallComment,
        ticket?.customer_id || ticket?.customer,
        questionAnswers,
        questionsSnapshot
      );
      setStep('thankyou');
    } catch (err) {
      console.error('Failed to submit external feedback:', err);
      setValidationError('An error occurred while submitting feedback. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-[#252578] border-t-transparent" />
          <p className="text-slate-600 font-medium">Loading feedback portal...</p>
        </div>
      </div>
    );
  }

  if (!isMasterEnabled) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 text-center shadow-xl border border-slate-100">
          <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-amber-100 text-amber-600">
            <ShieldAlert size={32} />
          </div>
          <h2 className="text-xl font-bold text-slate-800">Feedback Form Unavailable</h2>
          <p className="text-sm text-slate-500 mt-2 leading-relaxed">
            Customer feedback collection is currently paused by the system administrator. Thank you for your patience!
          </p>
          <div className="mt-6">
            <button
              onClick={() => navigate('/')}
              className="w-full py-3 px-4 rounded-xl bg-[#252578] hover:bg-[#1e1e62] text-white font-medium transition-colors"
            >
              Return to Portal
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'thankyou') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/30 to-blue-50/20 flex items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl overflow-hidden border border-slate-100">
          <ThankYouScreen onDone={() => navigate('/')} />
        </div>
      </div>
    );
  }

  if (step === 'already_submitted') {
    const existingFeedback = getTicketFeedback(effectiveTicketId);
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-lg w-full bg-white rounded-3xl p-8 text-center shadow-xl border border-slate-100">
          <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-emerald-100 text-emerald-600">
            <CheckCircle2 size={32} />
          </div>
          <h2 className="text-xl font-bold text-slate-800">Feedback Already Submitted</h2>
          <p className="text-sm text-slate-500 mt-2 leading-relaxed">
            You have already provided feedback for Ticket <span className="font-semibold text-[#252578]">#{effectiveTicketId}</span>. Thank you for helping us improve!
          </p>
          {existingFeedback?.overallComment && (
            <div className="mt-5 p-4 rounded-2xl bg-slate-50 border border-slate-100 text-left">
              <p className="text-xs uppercase font-bold text-slate-400">Your Submitted Comment</p>
              <p className="text-sm text-slate-700 mt-1 italic">"{existingFeedback.overallComment}"</p>
            </div>
          )}
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => setStep('form')}
              className="flex-1 py-3 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-[#252578] font-semibold transition-colors cursor-pointer shadow-xs"
            >
              Edit Feedback
            </button>
            <button
              onClick={() => navigate('/')}
              className="flex-1 py-3 px-4 rounded-xl bg-[#252578] hover:bg-[#1e1e62] text-white font-medium transition-colors"
            >
              Back to Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/70 py-10 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto">
        {/* Header Branding */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#252578] text-white flex items-center justify-center shadow-md">
              <Sparkles size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 leading-tight">Customer Satisfaction Survey</h1>
              <p className="text-xs text-slate-500">Enterprise Service Desk</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-[#252578] transition-colors py-2 px-3 rounded-xl hover:bg-white/80"
          >
            <ArrowLeft size={14} />
            Back to Portal
          </button>
        </div>

        {/* Main Feedback Form Card */}
        <div className="bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden">
          {/* Ticket Header Banner */}
          <div className="border-b border-slate-100 px-6 py-6 sm:px-8 bg-gradient-to-r from-blue-50/50 via-white to-indigo-50/40">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="inline-flex items-center px-2.5 py-1 rounded-lg font-bold text-[#252578] bg-blue-50 border border-blue-200/60 text-xs">
                Ticket #{effectiveTicketId}
              </span>
              <span className="inline-flex items-center px-2.5 py-1 rounded-lg font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 text-xs">
                {ticketCategory} Category
              </span>
              {ticket?.title && (
                <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-slate-700 bg-slate-100 text-xs font-medium max-w-sm truncate">
                  {ticket.title}
                </span>
              )}
            </div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight mt-3">
              How was your service experience?
            </h2>
            <p className="mt-1 text-sm text-slate-500 leading-relaxed">
              Your honest feedback helps us recognize outstanding technician support and continually improve our customer resolution quality.
            </p>
          </div>

          {/* Form Content */}
          <div className="px-6 py-6 sm:px-8 sm:py-8 space-y-7">
            {/* 1. Personnel Ratings */}
            <div>
              <div className="mb-4">
                <h3 className="text-sm font-bold text-slate-900 tracking-tight">Assigned Support Specialists</h3>
                <p className="text-xs text-slate-500 mt-0.5">Please rate the personnel who assisted you on this ticket:</p>
              </div>

              <div className="space-y-4">
                {employees.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center">
                    <User className="mx-auto h-8 w-8 text-slate-400 mb-2" />
                    <p className="text-sm font-medium text-slate-600">Customer Support Specialist</p>
                    <p className="text-xs text-slate-400 mt-1">Overall resolution support</p>
                    <div className="mt-4 flex justify-center">
                      <StarRating
                        value={ratings[1] || 0}
                        onChange={(r) => handleRatingChange(1, r)}
                      />
                    </div>
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
            </div>

            {/* 2. TS104 Category-Scoped Questions */}
            {questionsSnapshot && questionsSnapshot.length > 0 && (
              <div className="rounded-2xl border border-slate-150 bg-slate-50/50 p-5 sm:p-6 space-y-5">
                <div className="border-b border-slate-200/80 pb-3">
                  <h3 className="text-sm font-bold text-slate-900 tracking-tight">Category Evaluation ({ticketCategory})</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Please evaluate the specific parameters below:</p>
                </div>

                <div className="space-y-4">
                  {questionsSnapshot.map((q) => {
                    const val = questionAnswers[q.id];
                    return (
                      <div key={q.id} className="rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5 shadow-xs space-y-3">
                        <p className="text-sm font-semibold text-slate-800 leading-snug">{q.text}</p>

                        {q.responseType === 'Star Rating' && (
                          <div className="pt-1">
                            <StarRating
                              value={val || 0}
                              onChange={(r) => handleQuestionAnswerChange(q.id, r)}
                            />
                          </div>
                        )}

                        {q.responseType === 'Yes / No' && (
                          <div className="flex items-center gap-2 pt-1">
                            {['Yes', 'No'].map((opt) => {
                              const isSelected = val === opt;
                              return (
                                <button
                                  key={opt}
                                  type="button"
                                  onClick={() => handleQuestionAnswerChange(q.id, opt)}
                                  className={`px-6 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                                    isSelected
                                      ? 'bg-[#252578] text-white border-[#252578] shadow-sm'
                                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 hover:border-slate-300'
                                  }`}
                                >
                                  {opt}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {q.responseType === 'Multiple Choice' && (
                          <div className="flex items-center gap-2 flex-wrap pt-1">
                            {(q.options && q.options.length > 0 ? q.options : ['Option 1', 'Option 2']).map((opt) => {
                              const isSelected = val === opt;
                              return (
                                <button
                                  key={opt}
                                  type="button"
                                  onClick={() => handleQuestionAnswerChange(q.id, opt)}
                                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                                    isSelected
                                      ? 'bg-[#252578] text-white border-[#252578] shadow-sm'
                                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 hover:border-slate-300'
                                  }`}
                                >
                                  {opt}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {q.responseType === 'Checkbox' && (
                          <div className="flex flex-col gap-2 pt-1">
                            {(q.options && q.options.length > 0 ? q.options : ['Option 1', 'Option 2']).map((opt) => {
                              const currentSelected = Array.isArray(val) ? val : [];
                              const isChecked = currentSelected.includes(opt);
                              return (
                                <label
                                  key={opt}
                                  className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-xs font-medium cursor-pointer transition-all ${
                                    isChecked
                                      ? 'bg-blue-50/60 border-[#252578] text-[#252578]'
                                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => {
                                      const next = isChecked
                                        ? currentSelected.filter((x) => x !== opt)
                                        : [...currentSelected, opt];
                                      handleQuestionAnswerChange(q.id, next);
                                    }}
                                    className="rounded border-slate-300 text-[#252578] focus:ring-[#252578] h-4 w-4"
                                  />
                                  <span>{opt}</span>
                                </label>
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
                            className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-xs text-slate-800 outline-none transition-colors focus:border-[#252578]/40 focus:bg-white focus:ring-2 focus:ring-[#252578]/15 placeholder:text-slate-400"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 3. Overall Experience Comment */}
            <div>
              <label className="text-sm font-bold text-slate-900 block mb-1.5">
                Overall Experience & Suggestions (Optional)
              </label>
              <p className="text-xs text-slate-500 mb-2.5">
                Any additional comments about your resolution experience or how we can serve you better?
              </p>
              <textarea
                value={overallComment}
                onChange={(e) => setOverallComment(e.target.value)}
                placeholder="Share your experience or suggestions here..."
                rows={3}
                maxLength={1000}
                className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50/50 p-4 text-sm text-slate-800 outline-none transition-colors focus:border-[#252578]/40 focus:bg-white focus:ring-2 focus:ring-[#252578]/15 placeholder:text-slate-400"
              />
              <div className="mt-1 flex justify-end">
                <span className="text-xs text-slate-400 font-medium">{overallComment.length}/1000</span>
              </div>
            </div>
          </div>

          {/* Form Actions Footer */}
          <div className="border-t border-slate-100 px-6 py-5 sm:px-8 bg-slate-50/60 flex flex-col sm:flex-row justify-between items-center gap-4">
            {validationError ? (
              <p className="text-sm font-semibold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-4 py-2 w-full sm:w-auto">
                {validationError}
              </p>
            ) : (
              <p className="text-xs text-slate-400">All submissions are securely recorded and reviewed.</p>
            )}

            <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={() => navigate('/')}
                className="rounded-xl px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-200/70 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!allRated || isSubmitting}
                className="rounded-xl bg-[#252578] px-7 py-2.5 text-sm font-bold text-white transition-all hover:bg-[#1e1e62] disabled:cursor-not-allowed disabled:opacity-50 shadow-md shadow-indigo-900/10"
              >
                {isSubmitting ? 'Submitting...' : 'Submit Feedback'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
