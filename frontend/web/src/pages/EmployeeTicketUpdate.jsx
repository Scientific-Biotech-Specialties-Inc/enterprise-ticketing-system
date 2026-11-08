import { safeUrl } from '@/utils/safeUrl';
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Paperclip,
  UploadCloud,
  X,
  FileText,
  Clock,
  ArrowUpDown,
  AlertTriangle,
  Loader2,
  Share2,
  Pin,
  MessageSquare,
  History,
  UserCheck,
  Download,
} from 'lucide-react';
import { formatDisplayDate } from '@/utils/dateUtils';
import { getTicketDetails, updateEmployeeTicket, saveWorkLog, getAssignableEmployees, acceptTicket } from '@/services/ticketService';
import { getTicketMessages } from '@/services/messagingService';
import ProofCompletionModal from '@/components/employee/ProofCompletionModal';
import ReassignmentModal from '@/components/employee/ReassignmentModal';
import DelegateTicketModal from '@/components/employee/DelegateTicketModal';
import ReassignmentDisapprovalBanner from '@/components/employee/ReassignmentDisapprovalBanner';
import { isReassignmentDenied, hasPendingReassignment } from '@/utils/reassignmentUtils';
import useRealtimeRefresh from '@/hooks/useRealtimeRefresh';
import useMaxFileCount from '@/hooks/useMaxFileCount';
import { useAuth } from '@/context/AuthContext';
import FilePreviewModal from '@/components/FilePreviewModal';
import InternalNotesSection from '@/components/InternalNotesSection';
import TicketFeedbackSection from '@/components/feedback/TicketFeedbackSection';
import { hasFeedbackBeenSubmitted } from '@/data/mockFeedbackData';
import { PageHeader } from '@/components/ui/page-header';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmationModal } from '@/components/ui/confirmation-modal';
import { Skeleton } from '@/components/ui/skeleton';
import CustomerInfoPanel from '@/components/employee/CustomerInfoPanel';

const STATUS_OPTIONS = ['In Progress', 'Pending', 'Resolved', 'On Hold'];

export default function EmployeeTicketUpdate() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state;
  const { user } = useAuth();

  const queryTicketId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const val = params.get('ticketId') || params.get('id');
    return val ? Number(String(val).replace(/\D/g, '')) : null;
  }, [location.search]);

  const [ticket, setTicket] = useState(state?.ticket ?? null);
  const [statusDraft, setStatusDraft] = useState(state?.ticket?.status ?? '');
  const [remarks, setRemarks] = useState('');
  const [attachedFiles, setAttachedFiles] = useState([]);
  const maxFileCount = useMaxFileCount();
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [showStatusConfirm, setShowStatusConfirm] = useState(false);

  const [showProofModal, setShowProofModal] = useState(false);
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [showDelegateModal, setShowDelegateModal] = useState(false);
  const [assignableEmployees, setAssignableEmployees] = useState([]);
  const [isDelegating, setIsDelegating] = useState(false);
  const [conversationMessages, setConversationMessages] = useState([]);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState('');

  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);

  // Work Log state
  const [workLogTask, setWorkLogTask] = useState('');
  const [workLogHours, setWorkLogHours] = useState('');
  const [workLogDate, setWorkLogDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [isSavingLog, setIsSavingLog] = useState(false);
  const [workLogError, setWorkLogError] = useState('');
  const [workLogSuccess, setWorkLogSuccess] = useState('');
  const [savedWorkLogs, setSavedWorkLogs] = useState([]);

  const numericId = useMemo(() => {
    if (state?.ticketId) {
      const parsed = Number(String(state.ticketId).replace(/\D/g, ''));
      if (parsed) return parsed;
    }
    if (ticket) {
      const parsed = ticket.ticket_ID || Number(String(ticket.id).replace(/\D/g, ''));
      if (parsed) return parsed;
    }
    if (queryTicketId) {
      return queryTicketId;
    }
    try {
      const saved = sessionStorage.getItem('current_employee_ticket_id');
      if (saved) {
        const parsed = Number(saved);
        if (parsed) return parsed;
      }
    } catch {
      // sessionStorage unavailable
    }
    return null;
  }, [state?.ticketId, ticket, queryTicketId]);

  // Persist current active numeric ticket ID into sessionStorage
  useEffect(() => {
    if (numericId) {
      try {
        sessionStorage.setItem('current_employee_ticket_id', String(numericId));
      } catch {
        // sessionStorage unavailable
      }
    }
  }, [numericId]);

  // Security: strip raw database ticket IDs from the browser address bar query parameters
  useEffect(() => {
    if (location.search && (location.search.includes('id=') || location.search.includes('ticketId='))) {
      window.history.replaceState(location.state, document.title, location.pathname);
    }
  }, [location.pathname, location.search, location.state]);

  const loadTicketData = useCallback(async () => {
    if (!numericId) return;
    setLoading(true);
    setErrorMessage('');
    try {
      const details = await getTicketDetails(numericId);
      setTicket((prev) => ({
        ...details,
        ...(prev || {}),
        timeline: details?.timeline || prev?.timeline,
        reassignmentDenyReason: prev?.reassignmentDenyReason || details?.reassignmentDenyReason,
        disapprovalReason: prev?.disapprovalReason || details?.disapprovalReason,
        reassignmentStatus: prev?.reassignmentStatus || details?.reassignmentStatus,
        deniedReassignment: prev?.deniedReassignment ?? details?.deniedReassignment,
      }));
      if (Array.isArray(details?.worklogs)) {
        setSavedWorkLogs(details.worklogs);
      }
      if (!statusDraft && details?.status) {
        setStatusDraft(details.status);
      }

      // TS040: Automatically load complete customer and support conversation thread
      try {
        setConversationLoading(true);
        const msgs = await getTicketMessages(numericId);
        setConversationMessages(Array.isArray(msgs) ? msgs : []);
        setConversationError('');
      } catch (cErr) {
        console.warn('Could not load real-time conversation messages:', cErr);
        setConversationError('Unable to load customer conversation messages.');
      } finally {
        setConversationLoading(false);
      }
    } catch (err) {
      const msg = err?.response?.data?.message || 'Failed to load ticket details.';
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  }, [numericId, statusDraft]);

  useEffect(() => {
    if (!numericId) {
      navigate('/employee/machine', { replace: true });
    } else {
      loadTicketData();
    }
  }, [numericId]);

  useEffect(() => {
    if (ticket) {
      setStatusDraft(ticket.status);
    }
  }, [ticket?.status]);

  useRealtimeRefresh({
    refresh: loadTicketData,
    channels: [{ name: 'ticket-updates', event: 'ticket.changed' }],
    intervalMs: 30000,
    shouldRefresh: ({ payload }) => {
      return (
        payload &&
        (Number(payload.ticketId) === numericId || Number(payload.ticket_ID) === numericId)
      );
    },
  });

  const isInternal =
    ticket?.title?.startsWith('[Internal]') ||
    ticket?.is_internal ||
    ticket?.ticket_type === 'Internal' ||
    ticket?.type === 'Internal';
  const isProofRejected =
    ticket?.proofRejected === true && ticket?.status === 'In Progress';

  const [timelineSortOrder, setTimelineSortOrder] = useState('asc');

  const timelineEvents = useMemo(() => {
    if (!ticket) return [];
    const events = [
      {
        id: 'creation',
        type: 'system',
        text: `Ticket created by ${ticket.customer || 'Customer'}.`,
        timestamp: ticket.date,
      },
    ];
    if (ticket.accepted) {
      events.push({
        id: 'acceptance',
        type: 'system',
        text: 'Assignment accepted by employee.',
        timestamp: ticket.date,
      });
    }
    if (ticket.timeline && Array.isArray(ticket.timeline)) {
      events.push(...ticket.timeline);
    }
    return events;
  }, [ticket]);

  const sortedTimelineEvents = useMemo(() => {
    const sorted = [...timelineEvents];
    sorted.sort((a, b) => {
      const dateA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const dateB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return timelineSortOrder === 'asc' ? dateA - dateB : dateB - dateA;
    });
    return sorted;
  }, [timelineEvents, timelineSortOrder]);

  // TS040: Prominently surfaced pinned delegation / escalation handoff context
  const pinnedHandoffNote = useMemo(() => {
    if (!ticket) return null;
    if (ticket.delegation_note) {
      return {
        text: ticket.delegation_note,
        author: ticket.delegated_by_name || 'Escalation Recipient',
        date: ticket.delegated_at ? formatDisplayDate(ticket.delegated_at) : 'Recent',
      };
    }
    const notes = ticket.internalNotes || ticket.internal_notes || [];
    const match = notes.find((n) => {
      const text = String(n.text || n.note || '');
      return text.includes('[Delegation Handoff Note]') || text.includes('[Escalation Context]');
    });
    if (match) {
      return {
        text: String(match.text || match.note || '').replace(/^\[(Delegation Handoff Note|Escalation Context)\]\s*/i, ''),
        author: match.author || 'Escalation Recipient',
        date: match.timestamp ? formatDisplayDate(match.timestamp) : 'Recent',
      };
    }
    return null;
  }, [ticket]);

  // TS034: Check if current ticket is in escalated state
  const isEscalated = Boolean(
    ticket?.escalated ||
    ticket?.is_escalated ||
    ticket?.status === 'Escalated' ||
    String(ticket?.ticket_status_ID) === '5'
  );

  const handleOpenDelegateModal = async () => {
    setErrorMessage('');
    try {
      const emps = await getAssignableEmployees();
      const list = Array.isArray(emps) ? emps : emps?.data || [];
      const normalized = list.map((e) => ({
        id: Number(e.id || e.emp_id),
        name: e.name || `${e.first_name || ''} ${e.last_name || ''}`.trim() || e.email,
        email: e.email,
        role: e.role || e.position || 'Specialist',
        department: e.department || e.dept || 'Engineering',
        activeTickets: Number(e.active_tickets_count ?? e.open_tickets_count ?? e.activeTickets ?? 0),
        status: e.is_active === false ? 'offline' : 'available',
      }));
      setAssignableEmployees(normalized);
      setShowDelegateModal(true);
    } catch (err) {
      setErrorMessage('Failed to load eligible delegate candidates. Please try again.');
    }
  };

  const handleConfirmDelegate = async ({ employee, note }) => {
    if (!employee || !numericId) return;
    setIsDelegating(true);
    setErrorMessage('');
    try {
      await acceptTicket({
        ticketId: numericId,
        employeeIds: [Number(employee.id)],
        assignedByEmail: user?.email,
      });

      const actorName = `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || user?.name || 'Escalation Recipient';
      const actorRole = user?.role || 'Lead Specialist';
      const targetName = employee.name || 'Assigned Specialist';
      const targetRole = employee.role || 'Specialist';

      const handoffNote = `[Delegation Handoff Note] Delegated from ${actorName} (${actorRole}) to ${targetName} (${targetRole})${note ? `: "${note}"` : '.'}`;

      const noteFormData = new FormData();
      noteFormData.append('internal_note', handoffNote);
      await updateEmployeeTicket(numericId, noteFormData).catch(() => {});

      setSuccessMessage(`Ticket successfully delegated to ${targetName}.`);
      setShowDelegateModal(false);
      await loadTicketData();
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Failed to delegate ticket. Ticket assignment remains unchanged.';
      setErrorMessage(msg);
      throw err;
    } finally {
      setIsDelegating(false);
    }
  };

  const currentAssignedName = ticket?.assigned_to_name || ticket?.assigned_employee || ticket?.employee_name || '';

  const isPreviousEmployee = (authorName, authorRole) => {
    if (!authorName) return false;
    const isTechRole = /technician|specialist|engineer|employee|staff/i.test(authorRole || '');
    const isDifferentFromCurrent = currentAssignedName && !authorName.toLowerCase().includes(currentAssignedName.toLowerCase());
    const isMentionedInTimelineReassign = sortedTimelineEvents.some((evt) =>
      evt.text && evt.text.toLowerCase().includes(authorName.toLowerCase()) && /reassign|delegat|transfer|escalat/i.test(evt.text)
    );
    return isMentionedInTimelineReassign || (isTechRole && isDifferentFromCurrent);
  };

  const validateFiles = (files) => {
    const ALLOWED = ['pdf', 'png', 'docx', 'doc'];
    const MAX_FILE_SIZE = 15 * 1024 * 1024;
    const MAX_TOTAL_SIZE = 45 * 1024 * 1024;

    let totalSize = 0;
    for (const file of files) {
      const ext = file.name.split('.').pop().toLowerCase();
      if (!ALLOWED.includes(ext)) {
        return `Invalid file type: "${file.name}". Allowed formats: PDF, PNG, Word (.docx, .doc).`;
      }
      if (file.size > MAX_FILE_SIZE) {
        return `File too large: "${file.name}" (${(file.size / (1024 * 1024)).toFixed(2)} MB). Maximum allowed is 15MB per file.`;
      }
      totalSize += file.size || 0;
    }

    if (totalSize > MAX_TOTAL_SIZE) {
      return `Total attachments size exceeds 45MB limit (${(totalSize / (1024 * 1024)).toFixed(2)} MB). Please remove some files.`;
    }

    return null;
  };

  const handleFileChange = (e) => {
    const selected = Array.from(e.target.files);
    const fileError = selected.length > maxFileCount
      ? `You can attach a maximum of ${maxFileCount} files.`
      : validateFiles(selected);
    if (fileError) {
      setErrorMessage(fileError);
      setAttachedFiles([]);
      e.target.value = null;
    } else {
      setErrorMessage('');
      setAttachedFiles(selected);
    }
  };

  const handleStatusSave = async () => {
    if (statusDraft !== ticket.status && !remarks.trim()) {
      setErrorMessage('A remark is required when changing ticket status.');
      return;
    }
    const fileError = validateFiles(attachedFiles);
    if (fileError) {
      setErrorMessage(fileError);
      return;
    }

    setErrorMessage('');
    setSuccessMessage('');
    setIsSaving(true);

    const formData = new FormData();
    formData.append('status', statusDraft);
    formData.append('remarks', remarks.trim());
    attachedFiles.forEach((file) => {
      formData.append('attachments[]', file);
    });

    try {
      await updateEmployeeTicket(numericId, formData);
      setSuccessMessage('Status updated successfully!');
      setRemarks('');
      setAttachedFiles([]);
      setShowStatusConfirm(false);
      await loadTicketData();
    } catch {
      setErrorMessage('Failed to update status.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddInternalNote = async (noteText) => {
    const trimmed = (noteText || '').trim();
    if (!trimmed) return;

    setErrorMessage('');
    setSuccessMessage('');
    setIsAddingNote(true);

    const optimisticNote = {
      id: `temp-${Date.now()}`,
      text: trimmed,
      author: `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || user?.name || 'Staff Member',
      role: user?.role || 'Technician',
      timestamp: new Date().toISOString(),
      isOptimistic: true,
    };

    setTicket((prev) => prev ? {
      ...prev,
      internalNotes: [...(prev.internalNotes || []), optimisticNote],
    } : prev);

    const formData = new FormData();
    formData.append('internal_note', trimmed);

    try {
      await updateEmployeeTicket(numericId, formData);
      setSuccessMessage('Internal note added successfully!');
      setTimeout(() => setSuccessMessage(''), 4000);
      await loadTicketData();
    } catch (err) {
      // Revert optimistic note
      setTicket((prev) => prev ? {
        ...prev,
        internalNotes: (prev.internalNotes || []).filter((n) => n.id !== optimisticNote.id),
      } : prev);
      const msg = err?.response?.data?.message || err?.message || 'Failed to add internal note.';
      setErrorMessage(msg);
      throw err; // Re-throw so InternalNotesSection preserves input text
    } finally {
      setIsAddingNote(false);
    }
  };

  if (!ticket) return null;

  const backDestination = () => {
    const activeStatuses = ['In Progress', 'Pending', 'Pending Evaluation', 'On Hold'];
    const historyStatuses = ['Closed', 'Resolved'];
    if (ticket && activeStatuses.includes(ticket.status)) {
      return '/employee/machine';
    } else if (ticket && historyStatuses.includes(ticket.status)) {
      return '/employee/progress';
    }
    return '/employee/assigned';
  };

  const backLabel = () => {
    if (ticket && ['In Progress', 'Pending', 'Pending Evaluation', 'On Hold'].includes(ticket.status)) {
      return 'Back to Assigned Tickets';
    } else if (ticket && ['Closed', 'Resolved'].includes(ticket.status)) {
      return 'Back to Ticket History';
    }
    return 'Back to Incoming Tickets';
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Back button */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(backDestination())}
          className="text-primary hover:text-primary gap-2 -ml-2 font-medium"
        >
          <ArrowLeft className="h-4 w-4" />
          {backLabel()}
        </Button>
      </div>

      {loading ? (
        <div className="space-y-6">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : (
        <>
          {/* Ticket Header Card */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-xs font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-md">
                {ticket.id}
              </span>
              <Badge variant={getStatusBadgeVariant(ticket.status)}>
                {ticket.status}
              </Badge>
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
              {isEscalated && (
                <Badge variant="destructive">
                  Escalated
                </Badge>
              )}
              {isEscalated && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenDelegateModal}
                  className="bg-accent/10 border-accent/30 text-accent hover:bg-accent/20 text-xs font-semibold gap-1.5 ml-auto cursor-pointer"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  Delegate Escalated Ticket
                </Button>
              )}
              {isReassignmentDenied(ticket) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowReassignModal(true)}
                  className={`border-destructive/30 text-destructive hover:bg-destructive/10 text-xs font-medium ${!isEscalated ? 'ml-auto' : 'ml-2'}`}
                >
                  Request Reassignment Again
                </Button>
              )}
            </div>

            <h1 className="text-2xl font-bold text-foreground mb-1">{ticket.title}</h1>
            <p className="text-sm text-muted-foreground">
              {ticket.equipment && `${ticket.equipment} · `}
              {ticket.category}
            </p>

            {/* Info Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
              <div className="bg-muted/40 rounded-lg p-3 border border-border/50">
                <p className="text-[11px] font-medium text-muted-foreground mb-0.5">Requestor</p>
                <p className="text-sm font-semibold text-foreground">{ticket.customer || '—'}</p>
                {ticket.facility && (
                  <p className="text-xs text-muted-foreground mt-0.5">{ticket.facility}</p>
                )}
              </div>
              <div className="bg-muted/40 rounded-lg p-3 border border-border/50">
                <p className="text-[11px] font-medium text-muted-foreground mb-0.5">Date Filed</p>
                <p className="text-sm font-semibold text-foreground">
                  {ticket.date ? formatDisplayDate(ticket.date) : '—'}
                </p>
              </div>
              <div className="bg-muted/40 rounded-lg p-3 border border-border/50">
                <p className="text-[11px] font-medium text-muted-foreground mb-0.5">SLA</p>
                <span className="inline-flex text-xs font-semibold px-2 py-0.5 rounded-md bg-card border border-border">
                  {ticket.slaStatus ?? '—'}
                </span>
              </div>
              <div className="bg-muted/40 rounded-lg p-3 border border-border/50">
                <p className="text-[11px] font-medium text-muted-foreground mb-0.5">Last Update</p>
                <p className="text-sm font-semibold text-foreground">
                  {ticket.lastUpdate || ticket.updated_at
                    ? formatDisplayDate(ticket.lastUpdate || ticket.updated_at)
                    : '—'}
                </p>
              </div>
            </div>

            {ticket.description && (
              <div className="mt-4 bg-muted/30 rounded-lg p-4 border border-border/50">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Description
                </p>
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">
                  {ticket.description}
                </p>
              </div>
            )}
          </div>

          {/* Feedback messages */}
          {successMessage && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 text-sm font-medium flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}
          {errorMessage && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 text-sm font-medium flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="space-y-6">
            {/* Reassignment disapproved banner */}
            <ReassignmentDisapprovalBanner
              ticket={ticket}
              onRequestReassignAgain={() => setShowReassignModal(true)}
            />

            {/* Customer & Machine Context Panel (TS029) */}
            <CustomerInfoPanel
              ticketId={numericId}
              ticket={ticket}
              user={user}
              onViewRelatedTicket={(machineId) => {
                navigate('/employee/progress', { state: { machineFilter: machineId } });
              }}
            />

            {/* Reassignment pending banner */}
            {ticket.reassignmentRequested && !isReassignmentDenied(ticket) && (
              <div className="bg-warning/10 rounded-xl p-5 flex items-center gap-3 border border-warning/30 text-warning-foreground">
                <div className="w-2 h-2 rounded-full bg-warning animate-ping shrink-0" />
                <div className="text-sm">
                  <span className="font-bold">Reassignment Request Pending:</span>
                  {ticket.reassignmentReason && ` "${ticket.reassignmentReason}"`}
                  <p className="text-xs text-muted-foreground mt-1">
                    You cannot modify this ticket while a reassignment request is pending.
                  </p>
                </div>
              </div>
            )}

            {/* Proof of Completion Card */}
            {(statusDraft === 'Resolved' ||
              ticket.status === 'Resolved' ||
              ticket.status === 'Pending Evaluation' ||
              isProofRejected) && (
              <div className="rounded-xl border border-border bg-card p-6 shadow-xs flex items-center justify-between flex-wrap gap-4">
                <div className="max-w-lg">
                  {isProofRejected && (
                    <div className="mb-2.5 flex items-center gap-2 bg-destructive/10 border border-destructive/20 text-destructive px-3 py-1.5 rounded-lg text-xs font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse shrink-0" />
                      Proof Rejected: &quot;{ticket.rejectionReason}&quot;
                    </div>
                  )}
                  <h3 className="text-sm font-bold text-foreground">
                    {isProofRejected
                      ? 'Re-upload Proof of Completion'
                      : isInternal
                      ? 'Proof of Completion (Optional for Internal Tickets)'
                      : 'Proof of Completion Required'}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {isInternal
                      ? 'Supporting documentation (PDF, PNG, Word up to 15MB each, 45MB total) is optional for internal tickets and can be attached if desired.'
                      : 'Supporting documentation (PDF, PNG, Word up to 15MB each, 45MB total) must be verified before the ticket can be resolved.'}
                  </p>
                </div>
                {ticket.reassignmentRequested ? (
                  <span className="text-xs text-warning bg-warning/10 border border-warning/20 px-3 py-2 rounded-lg font-medium">
                    Proof upload disabled while reassignment is pending
                  </span>
                ) : (
                  <Button
                    onClick={() => setShowProofModal(true)}
                    disabled={isSaving}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                  >
                    <UploadCloud className="h-4 w-4" />
                    {isProofRejected
                      ? 'Re-upload Proof'
                      : isInternal
                      ? 'Attach Proof Documents'
                      : 'Upload Proof Documents'}
                  </Button>
                )}

                {/* List of uploaded proofs */}
                {((ticket.proofAttachments && ticket.proofAttachments.length > 0) ||
                  (ticket.proofFiles && ticket.proofFiles.length > 0)) && (
                  <div className="w-full mt-4 border-t border-border pt-4 text-left">
                    <p className="text-xs font-bold text-muted-foreground mb-2">
                      Uploaded Proof Documents:
                    </p>
                    <div className="flex flex-col gap-2">
                      {(ticket.proofAttachments || ticket.proofFiles).map((file, idx) => {
                        const fName = typeof file === 'string' ? file.split('/').pop() : (file.name || file.file_name || `Proof-${idx + 1}`);
                        const fUrl = safeUrl(typeof file === 'string' ? file : (file.url || file.file_path || file.path || ''));
                        const isQuarantined = Boolean(
                          typeof file === 'object' && (file?.is_quarantined || file?.quarantined || file?.status === 'quarantined' || file?.virus_detected)
                        );

                        if (isQuarantined) {
                          return (
                            <div
                              key={file.id || file.proof_ID || idx}
                              className="flex items-center gap-2 text-xs font-semibold text-destructive bg-destructive/10 p-2.5 rounded-lg border border-destructive/20 w-fit cursor-not-allowed"
                              title="Proof file quarantined: Threat detected by antivirus scan"
                            >
                              <ShieldAlert className="w-4 h-4 shrink-0 text-destructive" />
                              <span className="line-through">{fName}</span>
                              <span className="text-[9px] bg-destructive/20 text-destructive px-1 py-0.5 rounded font-bold uppercase">Blocked</span>
                            </div>
                          );
                        }
                        return (
                          <a
                            key={file.id || file.proof_ID || idx}
                            href={fUrl || '#'}
                            onClick={(e) => {
                              e.preventDefault();
                              setPreviewFile({ name: fName, url: fUrl });
                            }}
                            className="flex items-center gap-2 text-xs font-semibold text-accent hover:underline bg-accent/5 p-2.5 rounded-lg border border-accent/20 w-fit cursor-pointer"
                          >
                            <FileText className="h-4 w-4 shrink-0 text-accent" />
                            <span>{fName}</span>
                          </a>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Status Update Form */}
            {!ticket.reassignmentRequested &&
              ticket.status !== 'Pending Evaluation' &&
              ticket.status !== 'Resolved' && (
                <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
                  <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-4">
                    Update Ticket Status
                  </h3>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                        Select new status
                      </label>
                      <select
                        value={statusDraft}
                        disabled={isSaving}
                        onChange={(e) => setStatusDraft(e.target.value)}
                        className="w-full text-sm border border-border rounded-lg px-3 py-2.5 bg-background text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent font-semibold cursor-pointer disabled:opacity-50"
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>

                    {statusDraft !== ticket.status && (
                      <div className="space-y-4">
                        {(statusDraft !== 'Resolved' || isInternal) && (
                          <>
                            <div>
                              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                                Remarks / Notes <span className="text-destructive">*</span>{' '}
                                <span className="text-muted-foreground font-normal">
                                  (required on status change)
                                </span>
                              </label>
                              <textarea
                                placeholder="Provide detailed notes about this status change..."
                                value={remarks}
                                disabled={isSaving}
                                onChange={(e) => setRemarks(e.target.value)}
                                rows={4}
                                className="w-full text-sm border border-border rounded-lg p-3 bg-background text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent resize-none disabled:opacity-50"
                              />
                            </div>

                            <div>
                              <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
                                Supporting Documentation{' '}
                                <span className="text-muted-foreground font-normal">
                                  (optional · PDF, PNG, Word · max 15MB each, 45MB total)
                                </span>
                              </label>
                              <input
                                type="file"
                                multiple
                                accept=".pdf,.png,.docx,.doc"
                                disabled={isSaving}
                                onChange={handleFileChange}
                                className="w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 file:cursor-pointer disabled:opacity-50"
                              />
                              {attachedFiles.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {attachedFiles.map((file, idx) => (
                                    <span
                                      key={idx}
                                      className="inline-flex items-center gap-1.5 text-xs bg-muted border border-border rounded-md px-2.5 py-1 text-foreground"
                                    >
                                      <span>{file.name}</span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setAttachedFiles((prev) =>
                                            prev.filter((_, i) => i !== idx)
                                          )
                                        }
                                        className="text-muted-foreground hover:text-destructive"
                                        title="Remove file"
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </>
                        )}

                        {statusDraft === 'Resolved' && !isInternal ? (
                          <div className="bg-warning/10 border border-warning/20 text-warning-foreground p-4 rounded-lg text-xs font-medium text-center">
                            You must submit a Proof of Completion to resolve external tickets.
                            Please click &quot;Upload Proof Documents&quot; in the card above.
                          </div>
                        ) : (
                          <Button
                            type="button"
                            disabled={isSaving}
                            onClick={() => {
                              if (!remarks.trim()) {
                                setErrorMessage('Remarks are required to change ticket status.');
                                return;
                              }
                              setErrorMessage('');
                              setShowStatusConfirm(true);
                            }}
                            className="w-full"
                          >
                            {isSaving ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                Saving...
                              </>
                            ) : statusDraft === 'Resolved' ? (
                              'Resolve Internal Ticket'
                            ) : (
                              'Save Status Change'
                            )}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

            {/* Request Reassignment Card */}
            {!hasPendingReassignment(ticket) ? (
              <div className="rounded-xl border border-border bg-card p-6 shadow-xs flex items-center justify-between flex-wrap gap-4">
                <div>
                  <h3 className="text-sm font-bold text-foreground">Request Reassignment</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    Cannot complete this ticket? Request to have it reassigned to another technician.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSaving}
                  onClick={() => setShowReassignModal(true)}
                  className="text-destructive border-destructive/30 hover:bg-destructive/10"
                >
                  Request Reassignment
                </Button>
              </div>
            ) : (
              <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 flex items-center gap-3 text-xs text-warning-foreground shadow-xs">
                <div className="w-2 h-2 rounded-full bg-warning animate-ping shrink-0" />
                <div>
                  <span className="font-bold">Reassignment Request Pending:</span> &quot;
                  {ticket.reassignmentReason ||
                    ticket.reassignment_reason ||
                    'Awaiting CS coordinator review'}
                  &quot;
                </div>
              </div>
            )}

            {/* Ticket Attachments */}
            {ticket.attachments && ticket.attachments.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-3">
                  Original Ticket Attachments
                </h3>
                <div className="flex flex-wrap gap-3">
                  {ticket.attachments.map((file, idx) => {
                    const fName = typeof file === 'string' ? file.split('/').pop() : (file.name || file.file_name || `Attachment-${idx + 1}`);
                    const fUrl = safeUrl(typeof file === 'string' ? file : (file.url || file.file_path || file.path || ''));
                    const isQuarantined = Boolean(
                      typeof file === 'object' && (file?.is_quarantined || file?.quarantined || file?.status === 'quarantined' || file?.virus_detected)
                    );

                    if (isQuarantined) {
                      return (
                        <div
                          key={file.id || file.attachment_id || idx}
                          className="flex items-center gap-2 text-xs font-semibold text-destructive bg-destructive/10 px-3 py-2 rounded-lg border border-destructive/20 cursor-not-allowed"
                          title="Attachment quarantined: Threat detected by antivirus scan"
                        >
                          <ShieldAlert className="w-4 h-4 text-destructive shrink-0" />
                          <span className="line-through">{fName}</span>
                          <span className="text-[9px] bg-destructive/20 text-destructive px-1 py-0.5 rounded font-bold uppercase">Blocked</span>
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
                        className="flex items-center gap-2 text-xs font-semibold text-foreground hover:text-primary bg-muted/50 hover:bg-muted px-3 py-2 rounded-lg border border-border transition-colors cursor-pointer"
                      >
                        <Paperclip className="h-4 w-4 text-muted-foreground" />
                        <span>{fName}</span>
                      </a>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TS040: Prominently Surfaced Pinned Delegation / Escalation Handoff Note */}
            {pinnedHandoffNote && (
              <div className="rounded-xl border-2 border-accent/40 bg-accent/5 p-5 shadow-xs">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-accent text-white flex items-center justify-center shrink-0">
                    <Pin className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-accent uppercase tracking-wider">
                          Pinned Delegation Handoff Context
                        </span>
                        <Badge variant="outline" className="text-[10px] bg-accent/10 text-accent border-accent/30 font-semibold">
                          Surfaced for Immediate Context
                        </Badge>
                      </div>
                      <span className="text-[11px] text-muted-foreground font-medium flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {pinnedHandoffNote.date}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-foreground whitespace-pre-wrap leading-relaxed bg-card/60 p-3 rounded-lg border border-accent/20">
                      {pinnedHandoffNote.text}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      Handoff context recorded by <span className="font-semibold text-foreground">{pinnedHandoffNote.author}</span>. No need to ask the requestor to repeat themselves.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* TS040: Complete Customer & Support Conversation History */}
            <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-primary" />
                  Customer Conversation History ({conversationMessages.length})
                </h3>
                <span className="text-xs text-muted-foreground">
                  Unified thread across Customer, CS &amp; Assigned Employees
                </span>
              </div>

              {conversationLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full rounded-lg" />
                  <Skeleton className="h-16 w-full rounded-lg" />
                </div>
              ) : conversationError ? (
                <div className="rounded-lg bg-destructive/10 border border-destructive/20 text-destructive p-3 text-xs flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{conversationError}</span>
                </div>
              ) : conversationMessages.length === 0 ? (
                <div className="text-center py-6 border border-dashed border-border rounded-lg bg-muted/20">
                  <p className="text-xs text-muted-foreground">No customer-facing messages exchanged yet.</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                  {conversationMessages.map((msg, idx) => {
                    const senderName = msg.sender_name || msg.user_name || msg.sender?.name || msg.author || 'User';
                    const senderRole = msg.sender_role || msg.user_role || msg.sender?.role || 'Customer';
                    const isPriorEmp = isPreviousEmployee(senderName, senderRole);
                    const isCustomer = /customer|client/i.test(senderRole);

                    return (
                      <div
                        key={msg.id || msg._id || idx}
                        className={`rounded-lg border p-4 text-xs transition-colors ${
                          isCustomer
                            ? 'bg-muted/30 border-border'
                            : 'bg-primary/5 border-primary/20'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-foreground">
                              {senderName}
                            </span>
                            {isPriorEmp ? (
                              <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 rounded-md border border-amber-300">
                                {senderName} (previous Assigned Employee)
                              </span>
                            ) : (
                              <Badge variant="outline" className="text-[10px] py-0">
                                {senderRole}
                              </Badge>
                            )}
                          </div>
                          <span className="text-[11px] text-muted-foreground">
                            {formatDisplayDate(msg.created_at || msg.timestamp || msg.date)}
                          </span>
                        </div>

                        <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed mt-1">
                          {msg.message || msg.text || msg.body}
                        </p>

                        {/* Attachments within message */}
                        {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2 pt-2 border-t border-border/50">
                            {msg.attachments.map((att, aIdx) => {
                              const attName = typeof att === 'string' ? att.split('/').pop() : (att.name || att.file_name || `Attachment-${aIdx + 1}`);
                              const attUrl = typeof att === 'string' ? att : (att.url || att.file_path || '');
                              return (
                                <button
                                  key={aIdx}
                                  type="button"
                                  onClick={() => setPreviewFile({ name: attName, url: attUrl })}
                                  className="inline-flex items-center gap-1.5 text-xs bg-card hover:bg-muted text-primary font-medium px-2.5 py-1 rounded-md border border-border transition-colors cursor-pointer"
                                >
                                  <Paperclip className="h-3 w-3 text-muted-foreground" />
                                  <span>{attName}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Staff-Only Internal Notes */}
            <InternalNotesSection
              notes={ticket.internalNotes}
              onAddNote={handleAddInternalNote}
              isAdding={isAddingNote}
              userRole={user?.role}
              disabledReason={
                ticket.reassignmentRequested
                  ? 'Internal notes cannot be added while a reassignment request is pending.'
                  : null
              }
            />

            {/* Work Logs */}
            <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
              <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                Work Log
                <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-bold uppercase border border-primary/20">
                  Staff Only
                </span>
              </h3>

              {savedWorkLogs.length > 0 && (
                <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
                  {savedWorkLogs.map((log, i) => (
                    <div key={i} className="bg-muted/40 border border-border rounded-lg p-3">
                      <div className="flex justify-between items-center text-xs text-muted-foreground mb-1">
                        <span className="font-bold text-primary">{log.log_date}</span>
                        <span>{log.hours_spent}h</span>
                      </div>
                      <p className="text-sm text-foreground">{log.task_description}</p>
                    </div>
                  ))}
                </div>
              )}

              {!ticket.reassignmentRequested ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!workLogTask.trim() || !workLogHours || !workLogDate) {
                      setWorkLogError('Please fill in all fields.');
                      return;
                    }
                    setIsSavingLog(true);
                    setWorkLogError('');
                    setWorkLogSuccess('');
                    try {
                      const payload = {
                        ticket_id: numericId,
                        task_description: workLogTask.trim(),
                        hours_spent: parseFloat(workLogHours),
                        log_date: workLogDate,
                      };
                      await saveWorkLog(payload);
                      setWorkLogTask('');
                      setWorkLogHours('');
                      setWorkLogDate(new Date().toISOString().split('T')[0]);
                      setWorkLogSuccess('Work log saved successfully.');
                      setTimeout(() => setWorkLogSuccess(''), 3000);
                      await loadTicketData();
                    } catch (err) {
                      setWorkLogError(err?.response?.data?.message || 'Failed to save work log.');
                    } finally {
                      setIsSavingLog(false);
                    }
                  }}
                  className="space-y-3"
                >
                  <textarea
                    placeholder="What did you work on? (e.g., Replaced faulty capacitor, ran diagnostics)"
                    value={workLogTask}
                    onChange={(e) => setWorkLogTask(e.target.value)}
                    rows={2}
                    disabled={isSavingLog}
                    className="w-full text-sm border border-border rounded-lg px-3 py-2.5 bg-background text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-50 resize-none"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider block mb-1">
                        Hours Spent
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min="0.1"
                        max="24"
                        placeholder="e.g. 2.5"
                        value={workLogHours}
                        onChange={(e) => setWorkLogHours(e.target.value)}
                        disabled={isSavingLog}
                        className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted-foreground font-semibold uppercase tracking-wider block mb-1">
                        Date
                      </label>
                      <input
                        type="date"
                        value={workLogDate}
                        onChange={(e) => setWorkLogDate(e.target.value)}
                        disabled={isSavingLog}
                        className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-50"
                      />
                    </div>
                  </div>
                  {workLogError && <p className="text-xs text-destructive font-semibold">{workLogError}</p>}
                  {workLogSuccess && <p className="text-xs text-emerald-600 font-semibold">{workLogSuccess}</p>}
                  <Button
                    type="submit"
                    disabled={isSavingLog}
                    className="w-full"
                  >
                    {isSavingLog ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Saving...
                      </>
                    ) : (
                      'Save Work Log'
                    )}
                  </Button>
                </form>
              ) : (
                <p className="text-xs text-warning bg-warning/10 border border-warning/20 p-2.5 rounded-lg font-medium">
                  Work logs cannot be submitted while a reassignment request is pending.
                </p>
              )}
            </div>

            {/* Ticket Timeline */}
            <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
                  Ticket Timeline &amp; History
                </h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setTimelineSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
                  className="gap-1.5 text-xs text-primary"
                >
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  {timelineSortOrder === 'asc' ? 'Oldest First' : 'Newest First'}
                </Button>
              </div>
              <div className="relative pl-6 space-y-4 border-l border-border ml-3 py-1.5">
                {sortedTimelineEvents.map((evt, idx) => (
                  <div key={evt.id || idx} className="relative text-sm">
                    <div className="absolute -left-[31px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-card bg-primary" />
                    <div className="flex justify-between items-center text-xs text-muted-foreground mb-1">
                      <span className="font-bold text-primary uppercase text-[10px] tracking-wider">
                        {evt.type === 'system' ? 'System' : evt.type || 'Update'}
                      </span>
                      <span>{formatDisplayDate(evt.timestamp)}</span>
                    </div>
                    <p className="text-foreground leading-relaxed font-normal bg-muted/30 p-2.5 rounded-lg border border-border break-words whitespace-pre-wrap">
                      {evt.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Customer Satisfaction Feedback */}
            {(ticket.status === 'Resolved' || ticket.status === 'Closed' || hasFeedbackBeenSubmitted(ticket.id || ticket.ticket_ID)) && (
              <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
                <TicketFeedbackSection ticket={ticket} readOnly={true} />
              </div>
            )}
          </div>
        </>
      )}

      {/* Confirmation Modal for status change */}
      <ConfirmationModal
        open={showStatusConfirm}
        onOpenChange={setShowStatusConfirm}
        title="Confirm Status Change"
        description={`Are you sure you want to change the status from "${ticket.status}" to "${statusDraft}"?`}
        confirmLabel={isSaving ? 'Saving...' : 'Yes, Save Changes'}
        cancelLabel="Cancel"
        onConfirm={handleStatusSave}
        isDestructive={false}
      />

      {showProofModal && (
        <ProofCompletionModal
          ticket={ticket}
          onClose={() => setShowProofModal(false)}
          onStatusChange={(id, newStatus) =>
            setTicket((prev) => ({ ...prev, status: newStatus }))
          }
        />
      )}

      {showReassignModal && (
        <ReassignmentModal
          ticket={ticket}
          onClose={() => setShowReassignModal(false)}
          onReassignSuccess={(ticketId, reason) => {
            setTicket((prev) => ({
              ...prev,
              reassignmentRequested: true,
              reassignmentStatus: 'Pending',
              reassignmentReason: reason,
              status: 'Pending Reassignment',
              deniedReassignment: false,
              reassignmentDenied: false,
              disapprovalReason: null,
              reassignmentDenyReason: null,
            }));
            setShowReassignModal(false);
          }}
        />
      )}

      {showDelegateModal && (
        <DelegateTicketModal
          isOpen={showDelegateModal}
          onClose={() => setShowDelegateModal(false)}
          ticket={ticket}
          employees={assignableEmployees}
          onConfirmDelegate={handleConfirmDelegate}
          isDelegating={isDelegating}
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
