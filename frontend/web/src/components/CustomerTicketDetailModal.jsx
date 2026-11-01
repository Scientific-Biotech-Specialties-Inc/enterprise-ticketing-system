import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  FileText,
  Paperclip,
  CheckCircle,
  CheckCircle2,
  AlertCircle,
  Star,
  ArrowUpDown,
  RotateCcw,
  Pencil,
  Eye,
  Check,
  Clock,
  ShieldAlert,
  AlertTriangle,
  PauseCircle,
  MessageCircle,
  Bell,
} from 'lucide-react';
import FilePreviewModal from './FilePreviewModal';
import FeedbackModal from './feedback/FeedbackModal';
import TicketFeedbackSection from './feedback/TicketFeedbackSection';
import InternalTicketMessageThread from './InternalTicketMessageThread';
import TicketActivityTimeline from './TicketActivityTimeline';
import ReassignmentDisapprovalBanner from './employee/ReassignmentDisapprovalBanner';
import { formatDisplayDate } from '@/utils/dateUtils';
import { hasFeedbackBeenSubmitted, isFeedbackFormEnabled, setFeedbackFormEnabled, fetchFeedbackForTicket } from '@/data/mockFeedbackData';
import { getFeedbackFormStatus, getWindowConfiguration, getCachedWindowConfiguration } from '@/services/configurationService';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const getFileName = (file, fallback = 'Attachment') => {
  if (!file) return fallback;
  if (typeof file === 'string') return file.split('/').pop() || fallback;
  return file.name || file.file_name || fallback;
};

const getFileUrl = (file) => {
  if (!file) return '';
  if (typeof file === 'string') return file;
  return file.url || file.file_path || file.path || '';
};

export default function CustomerTicketDetailModal({
  ticket,
  onClose,
  onDiscard,
  onReopen,
  onResolve,
  allowReopen = true,
  customerName,
  isHistoryView = false,
  onAssign,
  onViewTicket,
  onFeedbackSubmitted,
}) {
  useLockBodyScroll(Boolean(ticket));
  const navigate = useNavigate();
  const [currentTicket, setCurrentTicket] = useState(ticket);
  const [timelineSortOrder, setTimelineSortOrder] = useState('asc');
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenValidationError, setReopenValidationError] = useState('');
  const [reopenError, setReopenError] = useState('');
  const [reopenSubmitting, setReopenSubmitting] = useState(false);
  const [reopenSuccessNotice, setReopenSuccessNotice] = useState('');
  const [previewFile, setPreviewFile] = useState(null);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [editingFeedback, setEditingFeedback] = useState(null);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [feedbackEnabled, setFeedbackEnabled] = useState(() => isFeedbackFormEnabled());

  useEffect(() => {
    setCurrentTicket(ticket);
    setReopenSuccessNotice('');
  }, [ticket]);

  const effectiveTicket = currentTicket || ticket;

  useEffect(() => {
    let isMounted = true;
    getFeedbackFormStatus().then((res) => {
      if (isMounted && res && (res.is_enabled !== undefined || res.isEnabled !== undefined)) {
        const isMasterOn = Boolean(res.is_enabled ?? res.isEnabled);
        setFeedbackEnabled(isMasterOn);
        setFeedbackFormEnabled(isMasterOn);
      }
    }).catch(() => {});

    const handleToggleChange = () => {
      setFeedbackEnabled(isFeedbackFormEnabled());
    };
    window.addEventListener('storage', handleToggleChange);
    window.addEventListener('feedback_master_toggle_changed', handleToggleChange);
    return () => {
      isMounted = false;
      window.removeEventListener('storage', handleToggleChange);
      window.removeEventListener('feedback_master_toggle_changed', handleToggleChange);
    };
  }, []);

  const [windowConfig, setWindowConfig] = useState(() => {
    const cached = getCachedWindowConfiguration();
    if (cached && typeof cached.reopenWindowDays !== 'undefined') {
      return {
        reopenEnabled: Boolean(cached.reopenEnabled ?? true),
        reopenWindowDays: Number(cached.reopenWindowDays ?? 2),
        autoCloseEnabled: Boolean(cached.autoCloseEnabled ?? true),
        autoCloseWindowDays: Number(cached.autoCloseWindowDays ?? 2),
      };
    }
    return { reopenEnabled: true, reopenWindowDays: 2, autoCloseEnabled: true, autoCloseWindowDays: 2 };
  });

  useEffect(() => {
    let isMounted = true;
    getWindowConfiguration()
      .then((cfg) => {
        if (isMounted && cfg) {
          setWindowConfig({
            reopenEnabled: Boolean(cfg.reopenEnabled ?? true),
            reopenWindowDays: Number(cfg.reopenWindowDays ?? 2),
            autoCloseEnabled: Boolean(cfg.autoCloseEnabled ?? true),
            autoCloseWindowDays: Number(cfg.autoCloseWindowDays ?? 2),
          });
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  const [modalNow, setModalNow] = useState(Date.now());
  const isResolvedModal = effectiveTicket?.status === 'Resolved';
  const resolvedDateModal = effectiveTicket?.resolved_at || effectiveTicket?.lastUpdate || effectiveTicket?.updated_at;

  useEffect(() => {
    if (!isResolvedModal) return;
    const interval = setInterval(() => setModalNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isResolvedModal]);

  const { modalRemainingSeconds, isModalAutoCloseExpired } = useMemo(() => {
    if (!isResolvedModal || !resolvedDateModal || !windowConfig.autoCloseEnabled) {
      return { modalRemainingSeconds: null, isModalAutoCloseExpired: false };
    }
    const resolvedMs = new Date(resolvedDateModal).getTime();
    if (isNaN(resolvedMs)) return { modalRemainingSeconds: null, isModalAutoCloseExpired: false };
    const windowMs = (windowConfig.autoCloseWindowDays || 2) * 24 * 60 * 60 * 1000;
    const deadlineMs = resolvedMs + windowMs;
    const diffSec = Math.floor((deadlineMs - modalNow) / 1000);
    return {
      modalRemainingSeconds: diffSec,
      isModalAutoCloseExpired: diffSec <= 0,
    };
  }, [isResolvedModal, resolvedDateModal, windowConfig, modalNow]);

  useEffect(() => {
    if (isResolvedModal && isModalAutoCloseExpired && windowConfig.autoCloseEnabled) {
      const nowIso = new Date().toISOString();
      setCurrentTicket((prev) => {
        if (!prev || prev.status === 'Closed') return prev;
        const priorTimeline = prev.timeline || [];
        return {
          ...prev,
          status: 'Closed',
          closed_at: nowIso,
          auto_closed: true,
          closed_by: 'system',
          timeline: [
            ...priorTimeline,
            {
              id: `auto-close-${Date.now()}`,
              type: 'system_autoclose',
              text: 'Closed automatically by system due to inactivity following resolution window.',
              timestamp: nowIso,
            },
          ],
        };
      });
    }
  }, [isResolvedModal, isModalAutoCloseExpired, windowConfig.autoCloseEnabled]);

  const isAutoClosedModal = useMemo(() => {
    if (!effectiveTicket || effectiveTicket.status !== 'Closed') return false;
    if (effectiveTicket.auto_closed || effectiveTicket.autoClosed) return true;
    if (effectiveTicket.closed_by === 'system' || effectiveTicket.actor_type === 'system') return true;
    const timeline = effectiveTicket.timeline || [];
    const hasAutoEvent = timeline.some((t) =>
      /auto-close|closed automatically|system due to inactivity/i.test(t.text || '')
    );
    const audit = effectiveTicket.audit_logs || effectiveTicket.auditLogs || [];
    const hasAutoAudit = audit.some((a) =>
      a.actor_type === 'system' || /auto-close/i.test(a.details || '')
    );
    return hasAutoEvent || hasAutoAudit;
  }, [effectiveTicket]);

  const formatCountdown = (totalSec) => {
    if (totalSec === null || totalSec < 0) return '00:00:00';
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (d > 0) {
      return `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
    }
    return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  };

  const formatRemainingText = (totalSec) => {
    if (totalSec === null || totalSec <= 0) return 'less than a minute';
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const parts = [];
    if (d > 0) parts.push(`${d} day${d > 1 ? 's' : ''}`);
    if (h > 0) parts.push(`${h} hour${h > 1 ? 's' : ''}`);
    if (m > 0 && d === 0) parts.push(`${m} minute${m > 1 ? 's' : ''}`);
    return parts.join(' and ') || 'less than a minute';
  };

  const isCS = useMemo(() => {
    try {
      if (typeof window !== 'undefined' && window.location.pathname.startsWith('/cs')) return true;
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const dept = (user.department || user.profile?.department?.name || '').toLowerCase();
      const role = (user.role || user.profile?.role?.name || '').toLowerCase();
      return (
        dept.includes('customer service') ||
        dept.includes('customer support') ||
        dept === 'cs' ||
        role.includes('customer service') ||
        role.includes('customer-service') ||
        role.includes('head of cs') ||
        role.includes('head of customer service') ||
        role === 'cs' ||
        role === 'head cs'
      );
    } catch {
      return false;
    }
  }, []);

  const isEmployee = useMemo(() => {
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const role = String(user?.role || '').toLowerCase();
      return role === 'employee' || role.includes('engineer') || role.includes('technician') || import.meta.env.VITE_APP_MODE === 'employee';
    } catch {
      return false;
    }
  }, []);

  const hasAssignedEmployee = useMemo(() => {
    if (!effectiveTicket) return false;
    return Boolean(
      (Array.isArray(effectiveTicket.assigned) && effectiveTicket.assigned.length > 0) ||
      (Array.isArray(effectiveTicket.assigned_employees) && effectiveTicket.assigned_employees.length > 0) ||
      effectiveTicket.assigned_to ||
      (effectiveTicket.assigned_employee && effectiveTicket.assigned_employee !== '—' && effectiveTicket.assigned_employee !== 'Unassigned')
    );
  }, [effectiveTicket]);

  const isAlreadyAssigned = useMemo(() => {
    if (!effectiveTicket) return false;
    return Boolean(
      hasAssignedEmployee ||
      (effectiveTicket.status && ['In Progress', 'Assigned', 'Pending Assignment', 'Resolved', 'Closed', 'Pending Evaluation', 'On Hold', 'Ongoing'].includes(effectiveTicket.status))
    );
  }, [effectiveTicket, hasAssignedEmployee]);

  const isExternalClosed = (effectiveTicket?.status === 'Closed' || effectiveTicket?.status === 'Resolved') &&
    !effectiveTicket?.is_internal &&
    effectiveTicket?.ticket_type !== 'Internal' &&
    effectiveTicket?.type !== 'Internal';
  const [feedbackAlreadySubmitted, setFeedbackAlreadySubmitted] = useState(() => (
    hasFeedbackBeenSubmitted(effectiveTicket?.id) || hasFeedbackBeenSubmitted(effectiveTicket?.ticket_ID)
  ));

  useEffect(() => {
    let isMounted = true;
    const tId = effectiveTicket?.id || effectiveTicket?.ticket_ID;
    if (!tId) return;
    if (hasFeedbackBeenSubmitted(tId)) {
      setFeedbackAlreadySubmitted(true);
      return;
    }
    if (typeof fetchFeedbackForTicket === 'function') {
      fetchFeedbackForTicket(tId).then((fb) => {
        if (isMounted && fb && fb.submitted) {
          setFeedbackAlreadySubmitted(true);
        }
      });
    }
    return () => {
      isMounted = false;
    };
  }, [effectiveTicket?.id, effectiveTicket?.ticket_ID]);

  const remarksList = useMemo(() => {
    if (!effectiveTicket) return [];
    const list = [];
    const seenRemarks = new Set();
    const normalizeKey = (author, text) => `${(author || '').trim().toLowerCase()}::${(text || '').trim().replace(/^["']|["']$/g, '').toLowerCase()}`;

    const addRemark = (id, author, remark, timestamp) => {
      if (!remark || typeof remark !== 'string' || !remark.trim()) return;
      const key = normalizeKey(author, remark);
      if (seenRemarks.has(key)) return;
      seenRemarks.add(key);
      list.push({
        id,
        author: author || 'Staff Member',
        remark: remark.trim(),
        timestamp,
      });
    };

    if (Array.isArray(effectiveTicket.remarks)) {
      effectiveTicket.remarks.forEach((rem, idx) => {
        addRemark(
          rem.id || `rem-${idx}`,
          rem.author || rem.user_name || rem.created_by_name,
          rem.remark || rem.text,
          rem.timestamp || rem.created_at
        );
      });
    }
    if (Array.isArray(effectiveTicket.remarks_history)) {
      effectiveTicket.remarks_history.forEach((rem, idx) => {
        addRemark(
          rem.id || `rem-hist-${idx}`,
          rem.author || rem.user_name || rem.created_by_name,
          rem.remark || rem.text,
          rem.timestamp || rem.created_at
        );
      });
    }
    if (Array.isArray(effectiveTicket.timeline)) {
      effectiveTicket.timeline.forEach((evt, idx) => {
        if (evt.type === 'remark' && evt.text) {
          const cleanText = evt.text.replace(/^Remark added by [^:]+:\s*"?/, '').replace(/"?$/, '');
          addRemark(
            evt.id || `timeline-rem-${idx}`,
            evt.author,
            cleanText || evt.text,
            evt.timestamp
          );
        }
      });
    }
    return list;
  }, [effectiveTicket]);

  const sortedTimelineEvents = useMemo(() => {
    if (!effectiveTicket) return [];
    const events = [];
    if (effectiveTicket.timeline && Array.isArray(effectiveTicket.timeline)) {
      events.push(...effectiveTicket.timeline.filter(evt => evt.type !== 'internal_note'));
    } else {
      events.push({
        id: 'creation',
        type: 'system',
        text: 'Ticket created.',
        timestamp: effectiveTicket.date_created || effectiveTicket.created_at,
      });
    }

    const sorted = [...events];
    sorted.sort((a, b) => {
      const dateA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const dateB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return timelineSortOrder === 'asc' ? dateA - dateB : dateB - dateA;
    });
    return sorted;
  }, [effectiveTicket, timelineSortOrder]);

  useLockBodyScroll(!!effectiveTicket);

  if (!effectiveTicket) return null;

  // Window Calculation Logic
  const isClosedTicket = effectiveTicket.status === 'Closed' || effectiveTicket.status === 'Resolved';
  const closedDate = effectiveTicket.closed_at || effectiveTicket.resolved_at;
  const resolvedAt = closedDate ? new Date(closedDate) : null;
  const reopenWindowDays = Number(windowConfig.reopenWindowDays) || 2;
  const reopenDurationMs = reopenWindowDays * 24 * 60 * 60 * 1000;
  const hasValidDate = resolvedAt && !Number.isNaN(resolvedAt.getTime());
  const isWindowExpired = hasValidDate && (Date.now() - resolvedAt.getTime()) >= reopenDurationMs;
  const isReopenPolicyDisabled = !windowConfig.reopenEnabled;

  const isReopenable = isClosedTicket && Boolean(windowConfig.reopenEnabled) && (!hasValidDate || !isWindowExpired);
  const canShowReopenAction = allowReopen && isReopenable && typeof onReopen === 'function';
  const isReopenExpired = allowReopen && isClosedTicket && (isWindowExpired || isReopenPolicyDisabled) && typeof onReopen === 'function';

  const handleExecuteReopen = async () => {
    const trimmed = reopenReason.trim();
    if (!trimmed || trimmed.length < 3) {
      setReopenValidationError('Please provide a reason for reopening (at least 3 characters).');
      return;
    }
    if (trimmed.length > 1000) {
      setReopenValidationError('The reason cannot exceed 1000 characters.');
      return;
    }

    setReopenSubmitting(true);
    setReopenError('');

    try {
      const res = await onReopen(effectiveTicket.ticket_ID || effectiveTicket.id, trimmed);

      // Immediately update ticket detail view state
      const nowIso = new Date().toISOString();
      const newTimelineEvent = {
        id: `timeline-reopen-${Date.now()}`,
        type: 'status',
        text: `Ticket reopened by customer. Reason: "${trimmed}"`,
        timestamp: nowIso,
      };
      const newRemark = {
        id: `rem-reopen-${Date.now()}`,
        author: customerName || 'Customer',
        remark: `Reopen Reason: ${trimmed}`,
        timestamp: nowIso,
      };

      const updatedTicket = {
        ...effectiveTicket,
        ...(res?.ticket || {}),
        status: 'Reopened',
        last_updated: nowIso,
        timeline: [...(effectiveTicket.timeline || []), newTimelineEvent],
        remarks: [...(effectiveTicket.remarks || []), newRemark],
      };

      setCurrentTicket(updatedTicket);
      setShowReopenModal(false);
      setReopenReason('');
      setReopenSuccessNotice('Ticket successfully reopened. Our support team has been notified and the ticket status is now Reopened.');
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Failed to reopen ticket. Please try again.';
      setReopenError(msg);
    } finally {
      setReopenSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px]">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-card border border-border shadow-modal animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-start justify-between border-b border-border px-6 py-5 shrink-0 bg-card">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-primary font-mono">{effectiveTicket.id}</span>
              {effectiveTicket.status === 'Closed' ? (
                isAutoClosedModal ? (
                  <Badge variant="outline" className="gap-1 bg-slate-100 text-slate-800 border-slate-300">
                    <Clock className="h-3 w-3 text-slate-500" />
                    Closed automatically
                  </Badge>
                ) : (
                  <Badge variant="emerald">
                    {effectiveTicket.closed_by ? `Closed by ${effectiveTicket.closed_by}` : 'Closed'}
                  </Badge>
                )
              ) : (
                <Badge variant={effectiveTicket.status === 'Open' ? 'sky' : effectiveTicket.status === 'In Progress' ? 'amber' : (effectiveTicket.status === 'Resolved' || effectiveTicket.status === 'Closed') ? 'emerald' : effectiveTicket.status === 'On Hold' ? 'amber' : 'default'}>
                  {(effectiveTicket.status === 'Pending Assignment' || (effectiveTicket.status === 'Open' && !effectiveTicket.accepted && (effectiveTicket.assigned_employee || effectiveTicket.assigned_to))) ? 'Assigned' : effectiveTicket.status}
                </Badge>
              )}
              <Badge variant={effectiveTicket.priority === 'Critical' ? 'destructive' : effectiveTicket.priority === 'High' ? 'amber' : 'outline'}>
                {effectiveTicket.priority}
              </Badge>
              {effectiveTicket.is_internal && (
                <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                  Internal
                </Badge>
              )}
              {(() => {
                const rawSla = effectiveTicket.sla_status || effectiveTicket.slaStatus || (effectiveTicket.sla_breached ? 'Breached' : null);
                if (!rawSla) return null;
                const normalized = String(rawSla).toLowerCase().replace(/[\s_-]+/g, '');
                if (normalized === 'breached' || normalized === 'violated') {
                  return (
                    <Badge variant="destructive" className="bg-rose-100 text-rose-800 border-rose-300 font-semibold flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />
                      <span>SLA Breached</span>
                    </Badge>
                  );
                }
                if (normalized === 'atrisk' || normalized === 'nearviolation') {
                  return (
                    <Badge variant="amber" className="bg-amber-100 text-amber-800 border-amber-300 font-semibold flex items-center gap-1">
                      <Clock className="w-3 h-3 text-amber-600 shrink-0" />
                      <span>SLA At Risk</span>
                    </Badge>
                  );
                }
                if (normalized === 'ontrack' || normalized === 'achieved' || normalized === 'compliant') {
                  return (
                    <Badge variant="emerald" className="bg-emerald-100 text-emerald-800 border-emerald-300 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                      <span>SLA On Track</span>
                    </Badge>
                  );
                }
                if (normalized === 'paused') {
                  return (
                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 font-semibold flex items-center gap-1">
                      <PauseCircle className="w-3 h-3 text-blue-600 shrink-0" />
                      <span>SLA Paused</span>
                    </Badge>
                  );
                }
                return (
                  <Badge variant="outline">
                    {rawSla}
                  </Badge>
                );
              })()}
            </div>
            <div className="mt-2">
              <span className="text-xs font-bold text-slate-dark uppercase tracking-wider">Ticket Title</span>
              <h2 className="mt-0.5 text-xl font-normal text-slate-dark">{effectiveTicket.title}</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-muted hover:bg-page hover:text-slate-dark transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* Remaining-Time-to-Auto-Close Indicator (Resolved Tickets) */}
          {isResolvedModal && windowConfig.autoCloseEnabled && modalRemainingSeconds !== null && (
            <div
              role="region"
              aria-live="polite"
              className={`rounded-2xl border p-4 transition-all shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                modalRemainingSeconds <= 7200
                  ? 'bg-rose-50/90 border-rose-200 text-rose-900'
                  : modalRemainingSeconds <= 86400
                  ? 'bg-amber-50/90 border-amber-200 text-amber-900'
                  : 'bg-blue-50/90 border-blue-200 text-[#252578]'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                    modalRemainingSeconds <= 7200
                      ? 'bg-rose-100 text-rose-700'
                      : modalRemainingSeconds <= 86400
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-blue-100 text-[#252578]'
                  }`}
                >
                  <Clock size={16} className={modalRemainingSeconds <= 7200 ? 'animate-pulse' : ''} />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-xs font-bold uppercase tracking-wider">Auto-Close Countdown</h3>
                    <span
                      className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                        modalRemainingSeconds <= 7200
                          ? 'bg-rose-200/80 text-rose-900'
                          : modalRemainingSeconds <= 86400
                          ? 'bg-amber-200/80 text-amber-900'
                          : 'bg-blue-200/80 text-[#252578]'
                      }`}
                    >
                      {modalRemainingSeconds <= 7200 ? 'Expiring Soon' : 'Active'}
                    </span>
                  </div>
                  <p className="text-xs mt-0.5 opacity-90">
                    Will auto-close in <strong className="font-semibold">{formatRemainingText(modalRemainingSeconds)}</strong> without response.
                  </p>
                </div>
              </div>
              <div className="shrink-0 font-mono font-bold text-xs px-3 py-1.5 rounded-lg border bg-white shadow-xs">
                {formatCountdown(modalRemainingSeconds)}
              </div>
            </div>
          )}

          {/* Reopen Success Alert Banner */}
          {reopenSuccessNotice && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between gap-2.5 text-xs text-emerald-800 font-semibold animate-fade-in">
              <div className="flex items-center gap-2">
                <CheckCircle size={16} className="shrink-0 text-emerald-600" />
                <span>{reopenSuccessNotice}</span>
              </div>
              <button
                type="button"
                onClick={() => setReopenSuccessNotice('')}
                className="text-emerald-700 hover:text-emerald-900 p-0.5 cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>
          )}

          <ReassignmentDisapprovalBanner ticket={effectiveTicket} />

          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2 min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-dark">Description</p>
              <p className="mt-1 rounded-xl bg-page border border-border p-4 text-sm font-normal leading-6 text-slate-600 break-words whitespace-normal overflow-hidden break-all max-h-[180px] overflow-y-auto">
                {effectiveTicket.description || 'No description available.'}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-dark">Requestor</p>
              <p className="mt-1 text-sm font-normal text-slate-600">{effectiveTicket.customer || effectiveTicket.requestor || effectiveTicket.created_by_name || customerName || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-dark">Equipment / Machine</p>
              <p className="mt-1 text-sm font-normal text-slate-600">{effectiveTicket.equipment || effectiveTicket.machine_name || effectiveTicket.machine?.machine_name || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-dark">Equipment Type</p>
              <p className="mt-1 text-sm font-normal text-slate-600">
                {effectiveTicket.equipment_type || effectiveTicket.equipmentType || effectiveTicket.machine_category || effectiveTicket.machine?.category_name || (effectiveTicket.category ? `${effectiveTicket.category} Equipment` : 'Medical Equipment')}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-dark">Assigned Employee</p>
              <p className="mt-1 text-sm font-normal text-slate-600">
                {effectiveTicket.assigned_employee || effectiveTicket.assigned_employee_name || effectiveTicket.assigned_to_name || (effectiveTicket.assigned_employees?.[0]?.name) || (typeof effectiveTicket.assigned_to === 'string' ? effectiveTicket.assigned_to : null) || 'Unassigned'}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-dark">Category</p>
              <p className="mt-1 text-sm font-normal text-slate-600">{effectiveTicket.category || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-dark">Date Filed</p>
              <p className="mt-1 text-sm font-normal text-slate-600">{formatDisplayDate(effectiveTicket.date_created || effectiveTicket.created_at || effectiveTicket.date)}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-dark">Last Updated</p>
              <p className="mt-1 text-sm font-normal text-slate-600">{formatDisplayDate(effectiveTicket.last_updated || effectiveTicket.updated_at || effectiveTicket.lastUpdate)}</p>
            </div>
            {(effectiveTicket.resolution_due_at || effectiveTicket.due_at || effectiveTicket.sla_due_date || effectiveTicket.sla?.resolution?.target) && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-dark">SLA Target Resolution</p>
                <p className="mt-1 text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  {formatDisplayDate(effectiveTicket.resolution_due_at || effectiveTicket.due_at || effectiveTicket.sla_due_date || effectiveTicket.sla?.resolution?.target)}
                </p>
              </div>
            )}
            {(effectiveTicket.last_reminder_sent_at || effectiveTicket.lastReminderSentAt) && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-indigo-950 flex items-center gap-1.5">
                  <Bell className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Last Reminder Sent</span>
                </p>
                <p className="mt-1 text-sm font-semibold text-indigo-800">
                  {formatDisplayDate(effectiveTicket.last_reminder_sent_at || effectiveTicket.lastReminderSentAt)}
                </p>
              </div>
            )}
            {(effectiveTicket.resolved_at || effectiveTicket.closed_at) && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">Date Resolved / Closed</p>
                <p className="mt-1 text-sm font-semibold text-emerald-700">
                  {formatDisplayDate(effectiveTicket.resolved_at || effectiveTicket.closed_at)}
                </p>
              </div>
            )}

            {effectiveTicket.attachments && effectiveTicket.attachments.length > 0 && (
              <div className="md:col-span-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-muted">Attachments ({effectiveTicket.attachments.length})</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {effectiveTicket.attachments.map((file, idx) => {
                    const fName = getFileName(file);
                    const fUrl = getFileUrl(file);
                    const isQuarantined = Boolean(
                      file.is_quarantined ||
                      file.quarantined ||
                      file.status === 'quarantined' ||
                      file.virus_detected
                    );

                    if (isQuarantined) {
                      return (
                        <div
                          key={file.id || file.attachment_id || idx}
                          className="flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800 select-none cursor-not-allowed"
                          title="This file was flagged by security scanning and quarantined. Binary download is blocked."
                        >
                          <ShieldAlert className="h-4 w-4 shrink-0 text-rose-600" />
                          <span className="truncate max-w-[200px] line-through text-gray-500">{fName}</span>
                          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">Blocked</span>
                        </div>
                      );
                    }

                    return (
                      <a
                        key={file.id || file.attachment_id || idx}
                        href={fUrl || '#'}
                        onClick={(e) => {
                          e.preventDefault();
                          setPreviewFile({ name: fName, url: fUrl });
                        }}
                        className="flex items-center gap-1.5 rounded-xl border border-border bg-page px-3 py-2 text-xs font-medium text-primary hover:text-accent hover:underline cursor-pointer transition-colors"
                      >
                        <Paperclip className="h-4 w-4 shrink-0 text-slate-muted" />
                        <span className="truncate max-w-[220px]">{fName}</span>
                      </a>
                    );
                  })}
                </div>
              </div>
            )}

            {((effectiveTicket.proofAttachments && effectiveTicket.proofAttachments.length > 0) || (effectiveTicket.proofFiles && effectiveTicket.proofFiles.length > 0)) && (
              <div className="md:col-span-2">
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">Proof of Completion Files</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(effectiveTicket.proofAttachments || effectiveTicket.proofFiles).map((file, pIdx) => {
                    const fName = getFileName(file);
                    const fUrl = getFileUrl(file);
                    return (
                      <a
                        key={file.id || file.attachment_id || pIdx}
                        href={fUrl || '#'}
                        onClick={(e) => {
                          e.preventDefault();
                          setPreviewFile({ name: fName, url: fUrl });
                        }}
                        className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs font-semibold text-emerald-800 hover:text-emerald-950 hover:underline cursor-pointer transition-colors"
                      >
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                        <span className="truncate max-w-[220px]">{fName}</span>
                      </a>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Remarks History */}
            {remarksList && remarksList.length > 0 && (
              <div className="md:col-span-2 border-t border-border pt-4 mt-2">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-dark flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-primary inline-block" />
                    Remarks &amp; Reason History ({remarksList.length})
                  </h3>
                </div>
                <div className="space-y-2.5 max-h-52 overflow-y-auto pr-1">
                  {remarksList.map((rem, idx) => (
                    <div key={rem.id || idx} className="rounded-xl border border-border bg-page p-3 text-xs shadow-xs">
                      <div className="flex items-center justify-between text-slate-muted mb-1">
                        <span className="font-bold text-primary text-[11px] uppercase tracking-wide">
                          {rem.author || 'Staff Member'}
                        </span>
                        <span className="text-[10px] text-slate-muted">
                          {formatDisplayDate(rem.timestamp)}
                        </span>
                      </div>
                      <p className="text-slate-dark leading-relaxed break-words whitespace-pre-wrap font-medium">
                        {rem.remark || rem.text}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Activity Timeline & History (TS086) */}
            <div className="md:col-span-2 pt-2">
              <TicketActivityTimeline
                ticket={effectiveTicket}
                userRole="employee"
                pageSize={6}
              />
            </div>

            {(effectiveTicket.is_internal || effectiveTicket.ticket_type === 'Internal' || effectiveTicket.type === 'Internal' || effectiveTicket.title?.startsWith('[Internal]')) && (
              <div className="md:col-span-2">
                <InternalTicketMessageThread
                  ticketId={effectiveTicket.ticket_ID || effectiveTicket.id}
                  ticket={effectiveTicket}
                  isClosed={effectiveTicket.status === 'Closed' || Number(effectiveTicket.ticket_status_ID) === 4}
                />
              </div>
            )}

            {(isExternalClosed || feedbackAlreadySubmitted) && (feedbackAlreadySubmitted || feedbackSubmitted || feedbackEnabled) && (
              <div className="md:col-span-2">
                <TicketFeedbackSection
                  key={feedbackSubmitted ? 'submitted' : 'pending'}
                  ticket={effectiveTicket}
                  onLeaveFeedback={() => {
                    setEditingFeedback(null);
                    setShowFeedbackModal(true);
                  }}
                  onEditFeedback={(fb) => {
                    setEditingFeedback(fb);
                    setShowFeedbackModal(true);
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="border-t border-border bg-card px-6 py-4 shrink-0 space-y-3">
          {/* Explanatory banner if reopen window is expired */}
          {isReopenExpired && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/90 p-3 text-xs text-amber-800 flex items-start gap-2.5 animate-in fade-in duration-200">
              <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold text-amber-900">Reopen Window Expired</p>
                <p className="mt-0.5 leading-relaxed">
                  {isReopenPolicyDisabled
                    ? 'Ticket reopening is disabled by administrative operational policy. If you need further assistance, please create a new support ticket.'
                    : `The allowed reopen window for this ticket has expired (tickets may be reopened within ${reopenWindowDays} days of resolution). If your issue is not fully resolved, please submit a new ticket.`}
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3">
            {(isCS || onAssign || onViewTicket) ? (
              !isAlreadyAssigned ? (
                <Button
                  type="button"
                  variant="default"
                  onClick={() => {
                    if (onAssign) {
                      onAssign(effectiveTicket);
                    } else {
                      onClose();
                    }
                  }}
                >
                  Assign
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="default"
                  onClick={() => {
                    if (onViewTicket) {
                      onViewTicket(effectiveTicket);
                    } else {
                      onClose();
                      const ticketId = effectiveTicket.ticket_ID || Number(String(effectiveTicket.id).replace(/\D/g, ''));
                      navigate(`/cs/history/${ticketId}`, { state: { ticket: effectiveTicket, backPath: window.location.pathname } });
                    }
                  }}
                >
                  View Ticket
                </Button>
              )
            ) : (
              isEmployee && effectiveTicket?.status !== 'Closed' && effectiveTicket?.status !== 'Resolved' && (
                <Button
                  type="button"
                  variant="default"
                  onClick={() => {
                    onClose();
                    const tId = effectiveTicket.ticket_ID || effectiveTicket.id;
                    navigate('/employee/ticket-update', { state: { ticketId: tId, ticket: effectiveTicket } });
                  }}
                >
                  Update Ticket
                </Button>
              )
            )}

            {/* Direct Link to Unified Message Thread (TS062) */}
            {effectiveTicket && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onClose();
                  const tId = effectiveTicket.ticket_ID || effectiveTicket.id;
                  const path = window.location.pathname.startsWith('/cs')
                    ? '/cs/messages'
                    : window.location.pathname.startsWith('/employee')
                      ? '/employee/messages'
                      : '/messages';
                  navigate(path, { state: { selectedTicketId: tId } });
                }}
                className="gap-1.5"
                title="Open unified message thread for this ticket"
              >
                <MessageCircle size={14} />
                <span>Messages</span>
              </Button>
            )}

            {/* Active Reopen Button (within allowed window) */}
            {canShowReopenAction && (
              <Button
                type="button"
                variant="default"
                onClick={() => {
                  setReopenValidationError('');
                  setReopenError('');
                  setShowReopenModal(true);
                }}
                className="gap-1.5"
              >
                <RotateCcw size={14} />
                Reopen Ticket
              </Button>
            )}

            {/* Disabled Reopen Button (window expired) */}
            {isReopenExpired && (
              <Button
                type="button"
                disabled
                variant="outline"
                title={isReopenPolicyDisabled ? 'Reopen disabled by policy' : 'Reopen window expired'}
                className="gap-1.5 opacity-60 cursor-not-allowed text-slate-muted"
              >
                <RotateCcw size={14} />
                Reopen Expired
              </Button>
            )}

            {isExternalClosed && !isEmployee && (
              <Button
                type="button"
                variant={feedbackAlreadySubmitted || feedbackSubmitted ? 'default' : 'secondary'}
                onClick={() => setShowFeedbackModal(true)}
                className="gap-1.5"
              >
                <Star className="h-4 w-4" />
                {feedbackAlreadySubmitted || feedbackSubmitted ? 'View Feedback' : 'Give Feedback'}
              </Button>
            )}

            {effectiveTicket.can_discard && effectiveTicket.status === 'Open' && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => onDiscard?.(effectiveTicket)}
              >
                Discard Ticket
              </Button>
            )}
          </div>
        </div>
      </div>

      {showFeedbackModal && (
        <FeedbackModal
          ticket={effectiveTicket}
          existingFeedback={editingFeedback}
          mode={editingFeedback ? 'edit' : 'create'}
          onClose={() => {
            setShowFeedbackModal(false);
            setEditingFeedback(null);
            setFeedbackSubmitted(true);
            onFeedbackSubmitted?.(effectiveTicket);
          }}
        />
      )}
      {/* Confirmation Modal for Reopening with Required Reason */}
      {showReopenModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px] animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-xl bg-card p-6 shadow-modal border border-border animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                  <RotateCcw size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-dark">Reopen Ticket</h3>
                  <p className="text-xs text-slate-muted font-mono">{effectiveTicket.id}</p>
                </div>
              </div>
              <button
                type="button"
                disabled={reopenSubmitting}
                onClick={() => {
                  setShowReopenModal(false);
                  setReopenValidationError('');
                  setReopenError('');
                }}
                className="text-slate-muted hover:text-slate-dark p-1 rounded-lg cursor-pointer transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="py-4 space-y-3.5">
              <p className="text-xs text-slate-600 leading-relaxed">
                Reopening will transition this ticket back to active status for customer support intervention. Please describe what issue remains unresolved:
              </p>

              {/* Error Message if Reopen Action Fails */}
              {reopenError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-xs text-red-700 font-semibold animate-in fade-in duration-200">
                  <AlertCircle size={15} className="shrink-0 mt-0.5 text-red-600" />
                  <span className="leading-relaxed">{reopenError}</span>
                </div>
              )}

              {/* Required Reason Input */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="reopen-reason-textarea" className="text-[11px] font-bold text-slate-dark uppercase tracking-wide">
                    Reason for Reopening <span className="text-red-500">*</span>
                  </label>
                  <span className="text-[10px] text-slate-muted font-mono">
                    {reopenReason.trim().length} / 1000
                  </span>
                </div>
                <textarea
                  id="reopen-reason-textarea"
                  value={reopenReason}
                  onChange={(e) => {
                    setReopenReason(e.target.value);
                    if (reopenValidationError) setReopenValidationError('');
                    if (reopenError) setReopenError('');
                  }}
                  disabled={reopenSubmitting}
                  placeholder="Explain why this ticket needs to be reopened (minimum 3 characters)..."
                  rows={4}
                  className={`w-full rounded-xl border p-3 text-xs text-slate-dark placeholder:text-slate-muted outline-none transition resize-none disabled:bg-muted ${
                    reopenValidationError
                      ? 'border-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-100 bg-red-50/20'
                      : 'border-border focus:border-primary focus:ring-2 focus:ring-primary/10 bg-card'
                  }`}
                />
                {reopenValidationError && (
                  <p className="text-[11px] text-red-600 font-medium flex items-center gap-1 mt-1 animate-in fade-in duration-200">
                    <AlertCircle size={12} /> {reopenValidationError}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={reopenSubmitting}
                onClick={() => {
                  setShowReopenModal(false);
                  setReopenValidationError('');
                  setReopenError('');
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                disabled={reopenSubmitting}
                onClick={handleExecuteReopen}
                className="gap-1.5"
              >
                <RotateCcw size={13} className={reopenSubmitting ? 'animate-spin' : ''} />
                {reopenSubmitting ? 'Reopening...' : 'Confirm Reopen'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
}
