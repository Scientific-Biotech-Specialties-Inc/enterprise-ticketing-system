import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Paperclip,
  FileText,
  CheckCircle2,
  ArrowUpDown,
  ImageIcon,
  RotateCcw,
  X,
  Clock,
  AlertCircle,
  ShieldAlert,
  MessageSquare,
} from 'lucide-react';
import { formatDisplayDate } from '@/utils/dateUtils';
import FilePreviewModal from '@/components/FilePreviewModal';
import AuthenticatedImage from '@/components/AuthenticatedImage';
import ReassignmentDisapprovalBanner from '@/components/employee/ReassignmentDisapprovalBanner';
import { getTicketDetails, reopenTicket } from '@/services/ticketService';
import { getWindowConfiguration, getCachedWindowConfiguration } from '@/services/configurationService';
import { useAuth } from '@/context/AuthContext';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import TicketFeedbackSection from '@/components/feedback/TicketFeedbackSection';
import FeedbackModal from '@/components/feedback/FeedbackModal';
import InternalTicketMessageThread from '@/components/InternalTicketMessageThread';
import TicketActivityTimeline from '@/components/TicketActivityTimeline';

export default function EmployeeHistoryDetail() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const { ticketId } = useParams();
  const { user } = useAuth();

  const isCustomer = user?.role === 'customer' || (
    !window.location.pathname.startsWith('/employee') &&
    !window.location.pathname.startsWith('/cs') &&
    !window.location.pathname.startsWith('/it-manager') &&
    !window.location.pathname.startsWith('/service-manager') &&
    !window.location.pathname.startsWith('/cs-manager')
  );

  const [ticket, setTicket] = useState(state?.ticket || null);
  const [loading, setLoading] = useState(!state?.ticket);
  const [error, setError] = useState(null);
  const backPath = state?.backPath ?? (
    window.location.pathname.startsWith('/it-manager') ? '/it-manager/history' :
    window.location.pathname.startsWith('/service-manager') ? '/service-manager/history' :
    window.location.pathname.startsWith('/cs-manager') ? '/cs-manager/history' :
    window.location.pathname.startsWith('/cs') ? '/cs/history' :
    window.location.pathname.startsWith('/employee') ? '/employee/progress' :
    '/history'
  );
  const messagesPath = (
    window.location.pathname.startsWith('/it-manager') ? '/it-manager/messages' :
    window.location.pathname.startsWith('/service-manager') ? '/service-manager/messages' :
    window.location.pathname.startsWith('/cs-manager') ? '/cs-manager/messages' :
    window.location.pathname.startsWith('/cs') ? '/cs/messages' :
    window.location.pathname.startsWith('/employee') ? '/employee/messages' :
    '/messages'
  );
  const [previewFile, setPreviewFile] = useState(null);
  const [timelineSortOrder, setTimelineSortOrder] = useState('asc'); // 'asc' or 'desc'
  const [now, setNow] = useState(Date.now());
  const [showConversationModal, setShowConversationModal] = useState(false);

  // Reopen State
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenValidationError, setReopenValidationError] = useState('');
  const [reopenSubmitting, setReopenSubmitting] = useState(false);
  const [reopenSuccessNotice, setReopenSuccessNotice] = useState('');

  // Feedback State
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  // Spec 0043 (AC-19): My Tickets' "Give Feedback" lands here with the modal already open.
  const openFeedbackOnArrival = Boolean(state?.openFeedback);
  useEffect(() => {
    if (openFeedbackOnArrival && ticket && ticket.status === 'Closed') {
      setShowFeedbackModal(true);
    }
    // Only on arrival with the ticket loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFeedbackOnArrival, ticket?.status]);
  const [editingFeedback, setEditingFeedback] = useState(null);

  const [windowConfig, setWindowConfig] = useState(() => {
    const cached = getCachedWindowConfiguration();
    return {
      autoCloseEnabled: Boolean(cached?.autoCloseEnabled ?? true),
      autoCloseWindowDays: Number(cached?.autoCloseWindowDays ?? 2),
      reopenEnabled: Boolean(cached?.reopenEnabled ?? true),
      reopenWindowDays: Number(cached?.reopenWindowDays ?? 2),
    };
  });

  useEffect(() => {
    let isMounted = true;
    getWindowConfiguration()
      .then((cfg) => {
        if (isMounted && cfg) {
          setWindowConfig({
            autoCloseEnabled: Boolean(cfg.autoCloseEnabled ?? true),
            autoCloseWindowDays: Number(cfg.autoCloseWindowDays ?? 2),
            reopenEnabled: Boolean(cfg.reopenEnabled ?? true),
            reopenWindowDays: Number(cfg.reopenWindowDays ?? 2),
          });
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  const numericId = useMemo(() => {
    if (ticketId) {
      const parsed = parseInt(String(ticketId).replace(/\D/g, ''), 10);
      if (!isNaN(parsed)) return parsed;
    }
    if (state?.ticket?.ticket_ID) return state.ticket.ticket_ID;
    if (state?.ticket?.id) {
      const parsed = parseInt(String(state.ticket.id).replace(/\D/g, ''), 10);
      if (!isNaN(parsed)) return parsed;
    }
    return null;
  }, [ticketId, state?.ticket]);

  const canReopen = useMemo(() => {
    if (!isCustomer || !ticket) return false;
    if (ticket.status !== 'Closed' && ticket.status !== 'Resolved') return false;
    if (!windowConfig.reopenEnabled) return false;
    const resolvedOrClosedAt = ticket.closed_at || ticket.resolved_at || ticket.updated_at || ticket.date;
    if (!resolvedOrClosedAt) return true;
    const closedMs = new Date(resolvedOrClosedAt).getTime();
    if (isNaN(closedMs)) return true;
    const windowMs = (windowConfig.reopenWindowDays || 2) * 24 * 60 * 60 * 1000;
    return (Date.now() - closedMs) <= windowMs;
  }, [isCustomer, ticket, windowConfig]);

  const handleExecuteReopen = async () => {
    const trimmed = reopenReason.trim();
    if (!trimmed || trimmed.length < 3) {
      setReopenValidationError('Please provide a reason for reopening (at least 3 characters).');
      return;
    }
    setReopenSubmitting(true);
    setReopenValidationError('');
    try {
      await reopenTicket(numericId, trimmed);
      setShowReopenModal(false);
      setReopenReason('');
      setReopenSuccessNotice('Ticket successfully reopened.');
      setTicket((prev) => ({
        ...prev,
        status: 'Reopened',
      }));
      getTicketDetails(numericId).then((fresh) => {
        if (fresh) setTicket((prev) => ({ ...prev, ...fresh }));
      }).catch(() => {});
    } catch (err) {
      setReopenValidationError(err?.response?.data?.message || err?.message || 'Failed to reopen ticket.');
    } finally {
      setReopenSubmitting(false);
    }
  };

  const handleOpenConversation = () => {
    navigate(messagesPath, {
      state: {
        selectedTicketId: numericId,
        openDirectChat: true,
      },
    });
  };

  useEffect(() => {
    if (!numericId) {
      if (!ticket) setLoading(false);
      return;
    }

    let isMounted = true;
    const fetchDetails = async () => {
      try {
        const fullDetails = await getTicketDetails(numericId);
        if (isMounted && fullDetails) {
          setTicket((prev) => ({
            ...(prev || {}),
            ...fullDetails,
            customer: fullDetails.customer || prev?.customer,
            facility: fullDetails.facility || prev?.facility,
          }));
        }
      } catch (err) {
        console.error('Failed to load full ticket history details:', err);
        if (isMounted && !ticket) {
          setError('Unable to load ticket details.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchDetails();
    return () => {
      isMounted = false;
    };
  }, [numericId]);

  const remarksList = useMemo(() => {
    if (!ticket) return [];
    const fromProps = ticket.remarks || ticket.remarks_history || [];
    const list = Array.isArray(fromProps) ? [...fromProps] : [];

    if (ticket.timeline && Array.isArray(ticket.timeline)) {
      ticket.timeline.forEach((evt) => {
        if (evt.type === 'remark' || (evt.text && evt.text.toLowerCase().includes('remark'))) {
          if (!list.some((r) => (r.remark || r.text) === evt.text)) {
            list.push({
              id: evt.id,
              remark: evt.text,
              timestamp: evt.timestamp,
              author: 'Staff Member',
            });
          }
        }
      });
    }

    return list.sort((a, b) => {
      const dateA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const dateB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return dateB - dateA;
    });
  }, [ticket]);

  const isResolved = ticket?.status === 'Resolved';
  const resolvedDate = ticket?.resolved_at || ticket?.lastUpdate || ticket?.updated_at || ticket?.date;

  useEffect(() => {
    if (!isResolved) return;
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [isResolved]);

  const { remainingSeconds, isAutoCloseExpired } = useMemo(() => {
    if (!isResolved || !resolvedDate || !windowConfig.autoCloseEnabled) {
      return { remainingSeconds: null, isAutoCloseExpired: false };
    }
    const resolvedMs = new Date(resolvedDate).getTime();
    if (isNaN(resolvedMs)) return { remainingSeconds: null, isAutoCloseExpired: false };
    const windowMs = (windowConfig.autoCloseWindowDays || 2) * 24 * 60 * 60 * 1000;
    const deadlineMs = resolvedMs + windowMs;
    const diffSec = Math.floor((deadlineMs - now) / 1000);
    return {
      remainingSeconds: diffSec,
      isAutoCloseExpired: diffSec <= 0,
    };
  }, [isResolved, resolvedDate, windowConfig, now]);

  useEffect(() => {
    if (isResolved && isAutoCloseExpired && windowConfig.autoCloseEnabled) {
      const nowIso = new Date().toISOString();
      setTicket((prev) => {
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
  }, [isResolved, isAutoCloseExpired, windowConfig.autoCloseEnabled]);

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

  const isAutoClosed = useMemo(() => {
    if (!ticket || ticket.status !== 'Closed') return false;
    if (ticket.auto_closed || ticket.autoClosed) return true;
    if (ticket.closed_by === 'system' || ticket.actor_type === 'system') return true;
    const timeline = ticket.timeline || [];
    const hasAutoEvent = timeline.some((t) =>
      /auto-close|closed automatically|system due to inactivity/i.test(t.text || '')
    );
    const audit = ticket.audit_logs || ticket.auditLogs || [];
    const hasAutoAudit = audit.some((a) =>
      a.actor_type === 'system' || /auto-close/i.test(a.details || '')
    );
    return hasAutoEvent || hasAutoAudit;
  }, [ticket]);

  const timelineEvents = useMemo(() => {
    if (!ticket) return [];
    const events = [
      {
        id: 'creation',
        type: 'system',
        text: `Ticket created by ${ticket.customer || 'Customer'}.`,
        timestamp: ticket.date || ticket.created_at || ticket.date_created,
      },
    ];
    if (ticket.accepted) {
      events.push({
        id: 'acceptance',
        type: 'system',
        text: 'Assignment accepted by employee.',
        timestamp: ticket.date || ticket.created_at,
      });
    }
    if (ticket.reassignmentRequested) {
      events.push({
        id: 'reassignment',
        type: 'reassign',
        text: `Reassignment requested by employee.${
          ticket.reassignmentReason ? ` Reason: "${ticket.reassignmentReason}"` : ''
        }`,
        timestamp: ticket.lastUpdate ?? ticket.date,
      });
    }
    if (ticket.status === 'Closed') {
      const hasCloseEvent = (ticket.timeline || []).some((item) => /closed/i.test(item.text || ''));
      if (!hasCloseEvent) {
        events.push({
          id: 'closure',
          type: isAutoClosed ? 'system_autoclose' : 'status',
          text: isAutoClosed
            ? 'Closed automatically by system due to inactivity following resolution window.'
            : `Ticket closed by ${ticket.closed_by || ticket.assigned_employee || ticket.customer || 'staff'}.`,
          timestamp: ticket.closed_at || ticket.lastUpdate || ticket.updated_at || ticket.date,
        });
      }
    }
    if (ticket.timeline && Array.isArray(ticket.timeline)) {
      ticket.timeline.forEach((item) => {
        if (!events.some((e) => e.id === item.id || (e.text === item.text && e.timestamp === item.timestamp))) {
          events.push(item);
        }
      });
    }
    return events;
  }, [ticket, isAutoClosed]);

  const sortedTimelineEvents = useMemo(() => {
    const sorted = [...timelineEvents];
    sorted.sort((a, b) => {
      const dateA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const dateB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return timelineSortOrder === 'asc' ? dateA - dateB : dateB - dateA;
    });
    return sorted;
  }, [timelineEvents, timelineSortOrder]);

  const isImage = (fileName) => {
    if (!fileName) return false;
    const ext = fileName.split('.').pop().toLowerCase();
    return ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);
  };

  if (loading) {
    return (
      <div className="space-y-6 w-full min-w-0 max-w-full">
        <Skeleton className="h-10 w-36 rounded-lg" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="space-y-6 w-full min-w-0 max-w-full">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(backPath)}
          className="text-primary hover:text-primary gap-2 -ml-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to History
        </Button>
        <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-6 text-destructive text-sm font-medium">
          {error || 'Ticket not found.'}
        </div>
      </div>
    );
  }

  const assignedEmployeeDisplay =
    ticket.assigned_employee?.name ||
    ticket.assigned_employee ||
    ticket.assignedTo ||
    ticket.assigned_to_name ||
    '—';

  const machineDisplay =
    ticket.equipment ||
    ticket.machine_name ||
    ticket.item_name ||
    ticket.equipment_name ||
    '—';

  const equipmentTypeDisplay =
    ticket.equipment_type ||
    ticket.equipmentType ||
    ticket.model_number ||
    (ticket.serial_number ? `Serial: ${ticket.serial_number}` : '—');

  const resolvedDateDisplay =
    ticket.resolved_at || ticket.closed_at ? formatDisplayDate(ticket.resolved_at || ticket.closed_at) : null;

  return (
    <div className="space-y-6 w-full min-w-0 max-w-full">
      {/* Back button */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(backPath)}
          className="text-primary hover:text-primary gap-2 -ml-2 font-medium cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          {backPath.includes('dashboard')
            ? 'Back to Dashboard'
            : backPath.includes('my-tickets')
            ? 'Back to My Tickets'
            : backPath.includes('progress')
            ? 'Back to Progress'
            : 'Back to History'}
        </Button>
      </div>

      {/* Header Card */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-md">
              {ticket.id || (ticket.ticket_ID ? `TKT-${String(ticket.ticket_ID).padStart(4, '0')}` : 'Ticket')}
            </span>
            {ticket.status === 'Closed' && isAutoClosed ? (
              <Badge variant="outline" className="bg-slate-100 text-slate-800 border-slate-300 gap-1.5" title="Ticket was closed automatically due to inactivity following resolution window.">
                <Clock className="h-3 w-3 text-slate-500" />
                Closed automatically
              </Badge>
            ) : (
              <Badge variant={getStatusBadgeVariant(ticket.status)}>
                {ticket.status}
              </Badge>
            )}
            <Badge
              variant={
                ticket.priority?.toLowerCase() === 'critical'
                  ? 'destructive'
                  : ticket.priority?.toLowerCase() === 'high'
                  ? 'warning'
                  : 'secondary'
              }
            >
              {ticket.priority}
            </Badge>
            {!isCustomer && (ticket.title?.startsWith('[Internal]') || ticket.is_internal || ticket.ticket_type === 'Internal' || ticket.type === 'Internal') && (
              <Badge variant="secondary">
                Internal
              </Badge>
            )}
            {!isCustomer && ticket.escalated && (
              <Badge variant="destructive">
                Escalated
              </Badge>
            )}
            {!isCustomer && ticket.reassignmentRequested && (
              <Badge variant="warning">
                Reassigned
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canReopen && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowReopenModal(true)}
                className="text-xs font-semibold gap-1.5 border-border hover:bg-muted/50 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5 text-primary" />
                <span>Reopen Ticket</span>
              </Button>
            )}
            {numericId && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleOpenConversation}
                className="text-xs font-semibold gap-1.5 shrink-0 border-border hover:bg-muted/50 cursor-pointer"
              >
                <MessageSquare className="w-3.5 h-3.5 text-primary" />
                <span>{isCustomer ? 'Message Support' : 'Open Conversation'}</span>
              </Button>
            )}
          </div>
        </div>

        {/* Reopen Success Alert */}
        {reopenSuccessNotice && (
          <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-semibold text-emerald-900 flex items-center justify-between gap-2 shadow-xs">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{reopenSuccessNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setReopenSuccessNotice('')}
              className="p-1 text-emerald-700 hover:text-emerald-900 cursor-pointer"
              aria-label="Dismiss notice"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* ─── Remaining-Time-to-Auto-Close Indicator (Resolved Tickets) ─── */}
        {isResolved && windowConfig.autoCloseEnabled && remainingSeconds !== null && (
          <div
            role="region"
            aria-live="polite"
            className={`mb-5 rounded-2xl border p-4 transition-all shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
              remainingSeconds <= 7200
                ? 'bg-rose-50/90 border-rose-200 text-rose-900'
                : remainingSeconds <= 86400
                ? 'bg-amber-50/90 border-amber-200 text-amber-900'
                : 'bg-blue-50/90 border-blue-200 text-[#252578]'
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                  remainingSeconds <= 7200
                    ? 'bg-rose-100 text-rose-700'
                    : remainingSeconds <= 86400
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-blue-100 text-[#252578]'
                }`}
              >
                <Clock size={18} className={remainingSeconds <= 7200 ? 'animate-pulse' : ''} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold">Auto-Close Window Active</h2>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                      remainingSeconds <= 7200
                        ? 'bg-rose-200/80 text-rose-900'
                        : remainingSeconds <= 86400
                        ? 'bg-amber-200/80 text-amber-900'
                        : 'bg-blue-200/80 text-[#252578]'
                    }`}
                  >
                    {remainingSeconds <= 7200 ? 'Closing Soon' : 'Pending Response'}
                  </span>
                </div>
                <p className="text-xs mt-1 opacity-90 leading-relaxed">
                  This resolved {isCustomer ? '' : 'internal '}ticket will automatically close in{' '}
                  <strong className="font-semibold underline decoration-dotted">
                    {formatRemainingText(remainingSeconds)}
                  </strong>{' '}
                  if no further response is recorded.
                </p>
              </div>
            </div>

            <div className="shrink-0 flex items-center gap-2">
              <div
                className={`px-4 py-2 rounded-xl text-center font-mono font-bold text-sm tracking-tight border ${
                  remainingSeconds <= 7200
                    ? 'bg-white text-rose-700 border-rose-300'
                    : remainingSeconds <= 86400
                    ? 'bg-white text-amber-800 border-amber-300'
                    : 'bg-white text-[#252578] border-blue-200'
                }`}
              >
                {formatCountdown(remainingSeconds)}
              </div>
            </div>
          </div>
        )}

        <h1 className="text-2xl font-bold text-foreground mb-1">{ticket.title}</h1>
        <p className="text-sm text-muted-foreground mb-4">
          {machineDisplay !== '—' && `${machineDisplay} · `}
          <span className="font-medium text-foreground">{equipmentTypeDisplay}</span>
          {ticket.category && ` · ${ticket.category}`}
        </p>

        {!isCustomer && <ReassignmentDisapprovalBanner ticket={ticket} className="mb-5" />}

        {/* Info grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div className="bg-muted/40 rounded-lg p-3 border border-border/50">
            <p className="text-[11px] uppercase font-bold text-muted-foreground mb-0.5">Requestor</p>
            <p className="text-sm font-semibold text-foreground">{ticket.customer || ticket.requestor || '—'}</p>
            {ticket.facility && (
              <p className="text-xs text-muted-foreground mt-0.5">{ticket.facility}</p>
            )}
          </div>
          <div className="bg-muted/40 rounded-lg p-3 border border-border/50">
            <p className="text-[11px] uppercase font-bold text-muted-foreground mb-0.5">Equipment / Machine</p>
            <p className="text-sm font-semibold text-foreground truncate" title={machineDisplay}>
              {machineDisplay}
            </p>
          </div>
          <div className="bg-muted/40 rounded-lg p-3 border border-border/50">
            <p className="text-[11px] uppercase font-bold text-muted-foreground mb-0.5">Equipment Type</p>
            <p className="text-sm font-semibold text-foreground truncate" title={equipmentTypeDisplay}>
              {equipmentTypeDisplay}
            </p>
          </div>
          <div className="bg-muted/40 rounded-lg p-3 border border-border/50">
            <p className="text-[11px] uppercase font-bold text-muted-foreground mb-0.5">Assigned Employee</p>
            <p className="text-sm font-semibold text-foreground truncate" title={assignedEmployeeDisplay}>
              {assignedEmployeeDisplay}
            </p>
          </div>
          <div className="bg-muted/40 rounded-lg p-3 border border-border/50">
            <p className="text-[11px] uppercase font-bold text-muted-foreground mb-0.5">Category</p>
            <p className="text-sm font-semibold text-foreground">{ticket.category || '—'}</p>
          </div>
          <div className="bg-muted/40 rounded-lg p-3 border border-border/50">
            <p className="text-[11px] uppercase font-bold text-muted-foreground mb-0.5">Date Filed</p>
            <p className="text-sm font-semibold text-foreground">
              {ticket.date || ticket.created_at ? formatDisplayDate(ticket.date || ticket.created_at) : '—'}
            </p>
          </div>
          {resolvedDateDisplay ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              <p className="text-[11px] uppercase font-bold text-emerald-800 mb-0.5">Date Resolved</p>
              <p className="text-sm font-bold text-emerald-900">{resolvedDateDisplay}</p>
            </div>
          ) : (
            <div className="bg-muted/40 rounded-lg p-3 border border-border/50">
              <p className="text-[11px] uppercase font-bold text-muted-foreground mb-0.5">SLA Status</p>
              <span className="inline-flex text-xs font-semibold px-2 py-0.5 rounded-md bg-card border border-border">
                {ticket.slaStatus || ticket.sla || '—'}
              </span>
            </div>
          )}
          <div className="bg-muted/40 rounded-lg p-3 border border-border/50">
            <p className="text-[11px] uppercase font-bold text-muted-foreground mb-0.5">Last Update</p>
            <p className="text-sm font-semibold text-foreground">
              {ticket.lastUpdate || ticket.updated_at ? formatDisplayDate(ticket.lastUpdate || ticket.updated_at) : '—'}
            </p>
          </div>
        </div>

        {ticket.description && (
          <div className="mt-4 bg-muted/30 rounded-lg p-4 border border-border/50">
            <p className="text-[11px] uppercase font-bold text-muted-foreground mb-1">Description</p>
            <p className="text-sm text-foreground leading-relaxed break-words whitespace-pre-wrap">{ticket.description}</p>
          </div>
        )}
      </div>

      {/* Attached Files / Photos */}
      {ticket.attachments && ticket.attachments.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
            <Paperclip className="h-4 w-4 text-primary" />
            Attached Files &amp; Photos ({ticket.attachments.length})
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {ticket.attachments.map((file, idx) => {
              const fileName = typeof file === 'string' ? file.split('/').pop() : (file.name || file.file_name || `File-${idx + 1}`);
              const fileUrl = typeof file === 'string' ? file : (file.url || file.file_path || file.path || '');
              const isQuarantined = Boolean(
                typeof file === 'object' && (file?.is_quarantined || file?.quarantined || file?.status === 'quarantined' || file?.virus_detected)
              );

              if (isQuarantined) {
                return (
                  <div
                    key={idx}
                    className="border border-red-200 rounded-xl overflow-hidden shadow-xs bg-red-50/50 p-4 cursor-not-allowed"
                    title="Attachment quarantined: Threat detected by antivirus scan"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                        <ShieldAlert className="w-5 h-5 text-red-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-red-700 truncate line-through">{fileName}</p>
                        <p className="text-[10px] text-red-500 font-bold uppercase mt-0.5">Quarantined / Blocked</p>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={idx}
                  onClick={() => setPreviewFile(typeof file === 'object' ? file : { name: fileName, url: fileUrl })}
                  className="border border-border rounded-lg overflow-hidden shadow-xs cursor-pointer hover:border-accent transition-colors"
                >
                  {isImage(fileName) ? (
                    <AuthenticatedImage
                      src={fileUrl}
                      alt={fileName}
                      className="w-full h-36 object-cover"
                    />
                  ) : null}
                  <div className={`flex items-center gap-3 p-4 bg-muted/40 h-36 ${isImage(fileName) ? 'hidden' : 'flex'}`}>
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <FileText className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{fileName}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">Document</p>
                    </div>
                  </div>
                  <div className="px-3 py-2 border-t border-border bg-muted/20 flex items-center justify-between">
                    <p className="text-[11px] text-muted-foreground truncate">{fileName}</p>
                    <span className="text-[11px] text-primary font-semibold">Preview</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Proof of Completion */}
      {((ticket.proofFiles && ticket.proofFiles.length > 0) || (ticket.proofAttachments && ticket.proofAttachments.length > 0)) && (
        <div className="rounded-xl border border-emerald-500/20 bg-card p-6 shadow-xs">
          <h3 className="text-sm font-bold text-emerald-800 uppercase tracking-wider mb-1 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            Proof of Completion Documents
          </h3>
          <p className="text-xs text-muted-foreground mb-4">Completed service logs and documents submitted by the technician.</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {(ticket.proofFiles || ticket.proofAttachments).map((file, idx) => {
              const fileName = typeof file === 'string' ? file.split('/').pop() : (file.name || file.file_name || `Proof-${idx + 1}`);
              const fileUrl = typeof file === 'string' ? file : (file.url || file.file_path || file.path || '');
              const isQuarantined = Boolean(
                typeof file === 'object' && (file?.is_quarantined || file?.quarantined || file?.status === 'quarantined' || file?.virus_detected)
              );

              if (isQuarantined) {
                return (
                  <div
                    key={idx}
                    className="border border-red-200 rounded-xl overflow-hidden shadow-xs bg-red-50/50 p-4 cursor-not-allowed"
                    title="Proof file quarantined: Threat detected by antivirus scan"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
                        <ShieldAlert className="w-5 h-5 text-red-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-red-700 truncate line-through">{fileName}</p>
                        <p className="text-[10px] text-red-500 font-bold uppercase mt-0.5">Quarantined / Blocked</p>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={idx}
                  onClick={() => setPreviewFile(typeof file === 'object' ? file : { name: fileName, url: fileUrl })}
                  className="border border-emerald-500/30 rounded-lg overflow-hidden shadow-xs cursor-pointer hover:border-emerald-600 transition-colors"
                >
                  {isImage(fileName) ? (
                    <AuthenticatedImage
                      src={fileUrl}
                      alt={fileName}
                      className="w-full h-36 object-cover"
                    />
                  ) : null}
                  <div className={`flex items-center gap-3 p-4 bg-emerald-50/60 h-36 ${isImage(fileName) ? 'hidden' : 'flex'}`}>
                    <div className="w-10 h-10 rounded-lg bg-emerald-600/10 flex items-center justify-center shrink-0">
                      <FileText className="h-5 w-5 text-emerald-700" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{fileName}</p>
                      <p className="text-[11px] text-emerald-700 font-medium mt-0.5">Proof Document</p>
                    </div>
                  </div>
                  <div className="px-3 py-2 border-t border-emerald-500/20 bg-emerald-50/40 flex items-center justify-between">
                    <p className="text-[11px] text-muted-foreground truncate">{fileName}</p>
                    <span className="text-[11px] text-emerald-800 font-bold">Preview</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Remarks History */}
      {remarksList && remarksList.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary inline-block" />
            Remarks History ({remarksList.length})
          </h3>
          <div className="space-y-3">
            {remarksList.map((rem, idx) => (
              <div
                key={rem.id || idx}
                className="rounded-lg border border-border bg-muted/30 p-4 text-xs"
              >
                <div className="flex items-center justify-between text-muted-foreground mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-primary text-xs uppercase tracking-wider">
                      {rem.author || (isCustomer ? 'Support Team' : 'Staff Member')}
                    </span>
                    {rem.status && (
                      <span className="px-2 py-0.5 text-[10px] font-semibold bg-muted text-foreground rounded-full border border-border">
                        {rem.status}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {formatDisplayDate(rem.timestamp)}
                  </span>
                </div>
                <p className="text-foreground text-sm leading-relaxed break-words whitespace-pre-wrap font-medium">
                  {rem.remark || rem.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ticket Discussion Trigger Card */}
      {numericId && (
        <div className="rounded-xl border border-border bg-card p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">
                {isCustomer ? 'Support Conversation' : 'Internal Ticket Discussion'}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isCustomer
                  ? 'Direct communications and updates with our customer support team.'
                  : 'Collaboration messages and team communication recorded for this ticket.'}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleOpenConversation}
            className="text-xs font-semibold gap-2 bg-[#252578] hover:bg-[#1d1d60] text-white shrink-0 cursor-pointer h-9 px-4"
          >
            <MessageSquare className="w-4 h-4" />
            <span>{isCustomer ? 'Chat with Support' : 'Open Conversation'}</span>
          </Button>
        </div>
      )}

      {/* Internal Ticket Discussion Modal (only for internal modal if enabled) */}
      {!isCustomer && showConversationModal && numericId && (
        <Dialog open={showConversationModal} onOpenChange={setShowConversationModal}>
          <DialogContent className="max-w-3xl w-full p-0 overflow-hidden max-h-[85vh] flex flex-col">
            <div className="p-4 border-b border-border flex items-center justify-between bg-card shrink-0">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">Internal Ticket Discussion</h3>
                <span className="text-xs font-semibold text-muted-foreground">
                  ({ticket?.id || (numericId ? `TKT-${String(numericId).padStart(4, '0')}` : '')})
                </span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 bg-muted/10">
              <InternalTicketMessageThread
                ticketId={numericId}
                ticket={ticket}
                isClosed={ticket?.status === 'Closed' || Number(ticket?.ticket_status_ID) === 4}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Customer Satisfaction Feedback */}
      {ticket && (
        <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
          <TicketFeedbackSection
            ticket={ticket}
            readOnly={!isCustomer}
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

      {/* Chronological Activity Timeline (TS086) */}
      <TicketActivityTimeline
        ticket={ticket}
        ticketId={numericId}
        pageSize={8}
      />

      {/* Reopen Modal for Customer */}
      {showReopenModal && (
        <Dialog open={showReopenModal} onOpenChange={setShowReopenModal}>
          <DialogContent className="max-w-md w-full p-6">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-primary" />
                <h3 className="text-base font-bold text-foreground">Reopen Support Ticket</h3>
              </div>
            </div>

            <div className="py-4 space-y-4">
              {reopenValidationError && (
                <div className="rounded-lg bg-destructive/10 text-destructive border border-destructive/20 p-3 text-xs font-semibold">
                  {reopenValidationError}
                </div>
              )}
              <div>
                <label htmlFor="reopen-reason-input" className="block text-xs font-bold text-foreground uppercase tracking-wider mb-1.5">
                  Reason for Reopening <span className="text-rose-500">*</span>
                </label>
                <textarea
                  id="reopen-reason-input"
                  rows={4}
                  value={reopenReason}
                  onChange={(e) => {
                    setReopenReason(e.target.value);
                    if (reopenValidationError) setReopenValidationError('');
                  }}
                  placeholder="Please detail why this issue persists or why further assistance is required..."
                  className="w-full rounded-xl border border-border bg-card p-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
                />
                <p className="text-[11px] text-muted-foreground mt-1">Minimum 3 characters required.</p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowReopenModal(false);
                  setReopenValidationError('');
                }}
                disabled={reopenSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleExecuteReopen}
                disabled={reopenSubmitting}
                className="bg-[#252578] hover:bg-[#1d1d60] text-white"
              >
                {reopenSubmitting ? 'Reopening...' : 'Confirm Reopen'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Customer Feedback Modal */}
      {showFeedbackModal && (
        <FeedbackModal
          ticket={ticket}
          existingFeedback={editingFeedback}
          mode={editingFeedback ? 'edit' : 'create'}
          onClose={() => {
            setShowFeedbackModal(false);
            setEditingFeedback(null);
          }}
          onSubmitSuccess={() => {
            setShowFeedbackModal(false);
            setEditingFeedback(null);
          }}
        />
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
