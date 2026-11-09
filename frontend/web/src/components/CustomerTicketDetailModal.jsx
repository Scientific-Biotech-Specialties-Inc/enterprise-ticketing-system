import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  RotateCcw,
  Plus,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import FilePreviewModal from './FilePreviewModal';
import FeedbackModal from './feedback/FeedbackModal';
import TicketFeedbackSection from './feedback/TicketFeedbackSection';
import TicketActivityTimeline from './TicketActivityTimeline';
import {
  TicketDetailModalShell,
  ModalHeader,
  TicketTitleBlock,
  StatusStepper,
  AlertBanner,
  AssigneeRow,
  TabBar,
  FieldGrid,
  AttachmentCard,
  ModalFooter,
  formatPHT,
  formatRelativePHT,
  getAssigneeInfo,
  getFileName,
  getFileUrl,
} from './ticket-modal';
import { isFeedbackFormEnabled } from '@/data/mockFeedbackData';
import { getWindowConfiguration, getCachedWindowConfiguration } from '@/services/configurationService';
import { getTicketTimeline } from '@/services/ticketService';
import { getTicketMessages } from '@/services/messagingService';

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
  readOnly = false,
}) {
  const navigate = useNavigate();
  const [currentTicket, setCurrentTicket] = useState(ticket);
  const [activeTab, setActiveTab] = useState('details'); // 'details' | 'updates' | 'files'
  const [descExpanded, setDescExpanded] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);

  // Updates / Timeline Data for Tab and Mini-Timeline
  const [timelineEvents, setTimelineEvents] = useState([]);
  const [timelineTotal, setTimelineTotal] = useState(0);
  const [timelineLoading, setTimelineLoading] = useState(false);

  // Reopen Modal State
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [reopenValidationError, setReopenValidationError] = useState('');
  const [reopenError, setReopenError] = useState('');
  const [reopenSubmitting, setReopenSubmitting] = useState(false);
  const [reopenSuccessNotice, setReopenSuccessNotice] = useState('');

  // Feedback State
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [editingFeedback, setEditingFeedback] = useState(null);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  useEffect(() => {
    setCurrentTicket(ticket);
    setReopenSuccessNotice('');
  }, [ticket]);

  const effectiveTicket = currentTicket || ticket;

  // Window Configuration for Reopening
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
    return () => { isMounted = false; };
  }, []);

  // Fetch normalized attachments & proof files
  const normalizedAttachments = useMemo(() => {
    let list = effectiveTicket?.attachments || effectiveTicket?.ticket_attachments || [];
    if (typeof list === 'string') {
      try { list = JSON.parse(list); } catch { list = []; }
    }
    return Array.isArray(list) ? list : [];
  }, [effectiveTicket?.attachments, effectiveTicket?.ticket_attachments]);

  const proofFiles = useMemo(() => {
    const list = effectiveTicket?.proofAttachments || effectiveTicket?.proofFiles || [];
    return Array.isArray(list) ? list : [];
  }, [effectiveTicket?.proofAttachments, effectiveTicket?.proofFiles]);

  const allFiles = useMemo(() => {
    return [...normalizedAttachments, ...proofFiles];
  }, [normalizedAttachments, proofFiles]);

  // Ticket Numeric ID
  const ticketNumericId = useMemo(() => {
    const raw = effectiveTicket?.ticket_ID || effectiveTicket?.id;
    if (!raw) return null;
    const n = Number(String(raw).replace(/\D/g, ''));
    return isNaN(n) ? null : n;
  }, [effectiveTicket?.ticket_ID, effectiveTicket?.id]);

  const loadTimeline = useCallback(async () => {
    if (!ticketNumericId) return;
    setTimelineLoading(true);
    try {
      const res = await getTicketTimeline(ticketNumericId, { page: 1, per_page: 20, order: 'desc' });
      const incoming = Array.isArray(res?.data)
        ? res.data.map((item, idx) => ({
            ...item,
            id: item.id || item.log_id || `timeline-${idx}`,
            type: item.type || item.action_type || item.event_type,
            title:
              item.type === 'reminder' || item.action_type === 'reminder_sent' || item.event_type === 'reminder_sent'
                ? 'CS Reminder'
                : item.title || item.description || 'Update',
            description: item.description || item.title || '',
            created_at: item.created_at || item.timestamp,
          }))
        : [];
      setTimelineEvents(incoming);
      setTimelineTotal(res?.pagination?.total ?? incoming.length);
    } catch {
      setTimelineEvents([]);
    } finally {
      setTimelineLoading(false);
    }
  }, [ticketNumericId]);

  useEffect(() => {
    loadTimeline();
  }, [loadTimeline]);

  // Assignee Information
  const assignee = useMemo(() => {
    return getAssigneeInfo(effectiveTicket);
  }, [effectiveTicket]);

  // SLA Status & Dates
  const isSlaBreached = Boolean(
    effectiveTicket?.sla_breached ||
    effectiveTicket?.sla_status === 'Breached' ||
    effectiveTicket?.slaStatus === 'Breached' ||
    effectiveTicket?.sla_status === 'sla_breached'
  );

  const slaTargetDate =
    effectiveTicket?.resolution_due_at ||
    effectiveTicket?.due_at ||
    effectiveTicket?.sla_due_date ||
    effectiveTicket?.sla?.resolution?.target;

  const formattedSlaTarget = slaTargetDate ? formatPHT(slaTargetDate) : 'today';

  // Fallback Baseline Events
  const displayEvents = useMemo(() => {
    if (!effectiveTicket) return [];
    if (timelineEvents.length > 0) return timelineEvents;

    const base = [];
    if (Array.isArray(effectiveTicket.timeline) && effectiveTicket.timeline.length > 0) {
      effectiveTicket.timeline.forEach((evt, idx) => {
        base.push({
          id: evt.id || `timeline-${idx}`,
          title: (evt.type === 'reminder' || evt.action_type === 'reminder_sent') ? 'CS Reminder' : (evt.title || evt.text || 'Event'),
          description: evt.text || evt.description || evt.title || '',
          created_at: evt.date || evt.timestamp || evt.created_at,
          type: evt.type || evt.action_type,
        });
      });
      return base;
    }

    if (assignee.isAssigned) {
      base.push({
        id: 'base-assigned',
        description: `Assigned to ${assignee.name}`,
        created_at: effectiveTicket?.last_updated || effectiveTicket?.updated_at || effectiveTicket?.date_created,
      });
    }
    base.push({
      id: 'base-submitted',
      description: 'Ticket submitted',
      created_at: effectiveTicket?.date_created || effectiveTicket?.created_at || effectiveTicket?.date,
    });
    return base;
  }, [timelineEvents, assignee, effectiveTicket]);

  const updatesCount = timelineTotal || displayEvents.length;
  const filesCount = allFiles.length;

  const handleRedirectToMessages = () => {
    if (!effectiveTicket) return;
    onClose?.();
    const tId = effectiveTicket.ticket_ID || effectiveTicket.id;
    let path = '/messages';
    if (typeof window !== 'undefined') {
      if (window.location.pathname.startsWith('/cs-manager')) path = '/cs-manager/messages';
      else if (window.location.pathname.startsWith('/service-manager')) path = '/service-manager/messages';
      else if (window.location.pathname.startsWith('/it-manager')) path = '/it-manager/messages';
      else if (window.location.pathname.startsWith('/cs')) path = '/cs/messages';
      else if (window.location.pathname.startsWith('/employee')) path = '/employee/messages';
    }
    navigate(path, { state: { selectedTicketId: tId } });
  };

  const handleExecuteReopen = async () => {
    const trimmed = reopenReason.trim();
    if (!trimmed || trimmed.length < 3) {
      setReopenValidationError('Please provide a reason for reopening (at least 3 characters).');
      return;
    }
    setReopenSubmitting(true);
    setReopenError('');
    try {
      await onReopen?.(effectiveTicket.ticket_ID || effectiveTicket.id, trimmed);
      setShowReopenModal(false);
      setReopenReason('');
      setReopenSuccessNotice('Ticket successfully reopened.');
      setCurrentTicket((prev) => ({ ...prev, status: 'Reopened' }));
      loadTimeline();
    } catch (err) {
      setReopenError(err?.response?.data?.message || err?.message || 'Failed to reopen ticket.');
    } finally {
      setReopenSubmitting(false);
    }
  };

  if (!effectiveTicket) return null;

  const ticketFormattedId = effectiveTicket.id || `TKT-${String(ticketNumericId).padStart(4, '0')}`;

  const tabsConfig = [
    { id: 'details', label: 'Details' },
    { id: 'updates', label: 'Updates', count: updatesCount },
    { id: 'files', label: 'Files', count: filesCount },
  ];

  return (
    <>
      <TicketDetailModalShell
        isOpen={Boolean(effectiveTicket)}
        onClose={onClose}
        header={
          <ModalHeader
            ticketId={ticketFormattedId}
            isStaffView={false}
            onClose={onClose}
          />
        }
        footer={
          <ModalFooter
            primaryAction={
              allowReopen &&
              (effectiveTicket.status === 'Closed' || effectiveTicket.status === 'Resolved') &&
              windowConfig.reopenEnabled ? (
                <button
                  type="button"
                  onClick={() => setShowReopenModal(true)}
                  className="min-h-[44px] px-4 rounded-lg bg-[#1E2A78] hover:bg-[#252578] text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer inline-flex items-center gap-1.5 shadow-xs"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reopen ticket</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleRedirectToMessages}
                  className="min-h-[44px] px-4 rounded-lg border border-[#D5D9E4] hover:bg-[#F5F6FA] text-xs sm:text-sm font-semibold text-[#1B2033] transition-colors cursor-pointer inline-flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add info / upload file</span>
                </button>
              )
            }
          />
        }
      >
        {/* Reopen Success Alert */}
        {reopenSuccessNotice && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-semibold text-emerald-900 flex items-center justify-between gap-2">
            <span>{reopenSuccessNotice}</span>
            <button type="button" onClick={() => setReopenSuccessNotice('')} className="p-1 text-emerald-700 hover:text-emerald-900 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* 1. Title Block */}
        <TicketTitleBlock
          title={effectiveTicket.title}
          priority={effectiveTicket.priority}
          dateFiled={effectiveTicket.date_created || effectiveTicket.created_at || effectiveTicket.date}
          customBadges={
            <span className="sr-only">
              {isSlaBreached && <span>SLA Breached</span>}
              <span>SLA Target Resolution</span>
              {effectiveTicket.last_reminder_sent_at && <span>Last Reminder Sent</span>}
            </span>
          }
        />

        {/* 2. Status Hero Card with Stepper, Alert, AssigneeRow */}
        <div className="rounded-xl border border-[#D5D9E4] bg-white p-4 sm:p-5 shadow-xs space-y-4">
          {/* Stepper */}
          <StatusStepper
            status={effectiveTicket.status}
            isAssigned={assignee.isAssigned}
          />

          {/* Plain-Language Status Alert Banner */}
          {isSlaBreached ? (
            <AlertBanner
              variant="warning"
              title="We're running behind our target"
              message={`Expected fix was ${formattedSlaTarget}. ${assignee.firstName} is working on it and you'll be notified of every update.`}
            />
          ) : (
            <AlertBanner
              variant="info"
              title="On track"
              message={`Target resolution expected by ${formattedSlaTarget}.`}
            />
          )}

          {/* Assignee Row */}
          <AssigneeRow
            name={assignee.name}
            firstName={assignee.firstName}
            initials={assignee.initials}
            department={assignee.department}
            updatedText={`Updated ${formatPHT(effectiveTicket.last_updated || effectiveTicket.updated_at || effectiveTicket.date_created)}`}
            onMessage={assignee.isAssigned ? handleRedirectToMessages : null}
            messageLabel={`Message ${assignee.firstName}`}
          />
        </div>

        {/* 3. TabBar */}
        <TabBar
          tabs={tabsConfig}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        {/* 4. Tab Panels */}
        {activeTab === 'details' && (
          <div id="panel-details" role="tabpanel" aria-labelledby="tab-details" className="space-y-4 pt-1 animate-in fade-in duration-150">
            {/* WHAT YOU REPORTED */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#5A6178] mb-1.5">
                WHAT YOU REPORTED
              </p>
              <div className="rounded-xl bg-[#F5F6FA] border border-[#D5D9E4] p-3.5 sm:p-4 text-xs sm:text-sm text-[#1B2033] leading-relaxed break-words whitespace-pre-wrap">
                <div className={!descExpanded && (effectiveTicket.description || '').length > 200 ? 'line-clamp-3' : ''}>
                  {effectiveTicket.description || 'No description provided.'}
                </div>
                {(effectiveTicket.description || '').length > 200 && (
                  <button
                    type="button"
                    onClick={() => setDescExpanded((p) => !p)}
                    className="mt-2 text-xs font-bold text-[#1E2A78] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <span>{descExpanded ? 'Show less' : 'Show more'}</span>
                    {descExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>

            {/* FieldGrid: Equipment + Category */}
            <FieldGrid
              equipment={effectiveTicket.equipment || effectiveTicket.machine_name || 'Medical Diagnostic Unit'}
              assetId={effectiveTicket.serial_number || effectiveTicket.machine?.serial_number}
              category={effectiveTicket.category ? `${effectiveTicket.category} · ${effectiveTicket.equipment_type || effectiveTicket.machine_category || 'Imaging Equipment'}` : 'Imaging Equipment'}
            />

            {/* LATEST UPDATES Mini-Timeline */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#5A6178] mb-2">
                LATEST UPDATES
              </p>
              <div className="relative pl-4 space-y-3 border-l-2 border-[#1E2A78] ml-2">
                {displayEvents.slice(0, 3).map((evt, idx) => {
                  const isReminder = evt.type === 'reminder' || evt.action_type === 'reminder_sent' || evt.event_type === 'reminder_sent';
                  const title = isReminder ? 'CS Reminder' : (evt.title || evt.description || evt.details || 'Status update logged');
                  return (
                    <div key={evt.id || evt.log_id || idx} className="relative text-xs">
                      <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-[#1E2A78]" />
                      <p className="font-bold text-[#1B2033]">
                        {title}
                      </p>
                      <span className="text-[11px] text-[#5A6178]">
                        {formatPHT(evt.created_at || evt.timestamp)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Attachments preview row */}
            {allFiles.length > 0 && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#5A6178] mb-2">
                  ATTACHMENTS
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {allFiles.slice(0, 2).map((file, fIdx) => (
                    <AttachmentCard
                      key={file.id || fIdx}
                      file={file}
                      onPreview={setPreviewFile}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'updates' && (
          <div id="panel-updates" role="tabpanel" aria-labelledby="tab-updates" className="space-y-4 pt-1 animate-in fade-in duration-150">
            <TicketActivityTimeline
              ticket={effectiveTicket}
              ticketId={ticketNumericId}
              pageSize={8}
              collapsible={false}
            />
          </div>
        )}

        {activeTab === 'files' && (
          <div id="panel-files" role="tabpanel" aria-labelledby="tab-files" className="space-y-3 pt-1 animate-in fade-in duration-150">
            {allFiles.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#5A6178] rounded-xl border border-dashed border-[#D5D9E4] bg-[#F5F6FA]">
                No files or attachments currently attached to this ticket.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {allFiles.map((file, fIdx) => (
                  <AttachmentCard
                    key={file.id || fIdx}
                    file={file}
                    onPreview={setPreviewFile}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Feedback Section (when closed/resolved) */}
        {(effectiveTicket.status === 'Closed' || effectiveTicket.status === 'Resolved') && (
          <div className="pt-2 border-t border-[#D5D9E4]">
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
      </TicketDetailModalShell>

      {/* ─── Reopen Modal ─── */}
      {showReopenModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[1px] animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-[#D5D9E4] space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#1B2033]">Reopen Support Ticket</h3>
              <button
                type="button"
                onClick={() => setShowReopenModal(false)}
                className="p-1 text-[#5A6178] hover:text-[#1B2033] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {reopenError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 font-semibold">
                {reopenError}
              </div>
            )}
            <div>
              <label htmlFor="reopen-reason" className="block text-[11px] font-bold text-[#5A6178] uppercase mb-1">
                Reason for Reopening <span className="text-rose-500">*</span>
              </label>
              <textarea
                id="reopen-reason"
                rows={3}
                value={reopenReason}
                onChange={(e) => {
                  setReopenReason(e.target.value);
                  if (reopenValidationError) setReopenValidationError('');
                }}
                placeholder="Explain why this ticket needs further assistance..."
                className="w-full rounded-xl border border-[#D5D9E4] p-3 text-xs outline-none focus:ring-2 focus:ring-[#1E2A78] focus:border-transparent resize-none"
              />
              {reopenValidationError && (
                <p className="mt-1 text-xs text-rose-600 font-semibold">{reopenValidationError}</p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#D5D9E4]">
              <button
                type="button"
                onClick={() => setShowReopenModal(false)}
                className="px-3 py-1.5 rounded-lg border border-[#D5D9E4] text-xs font-semibold text-[#5A6178] hover:bg-[#F5F6FA] cursor-pointer min-h-[44px]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={reopenSubmitting}
                onClick={handleExecuteReopen}
                className="px-4 py-1.5 rounded-lg bg-[#1E2A78] hover:bg-[#161F58] text-white text-xs font-semibold transition-colors cursor-pointer min-h-[44px]"
              >
                {reopenSubmitting ? 'Reopening...' : 'Confirm Reopen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── File Preview Modal ─── */}
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}

      {/* ─── Feedback Modal ─── */}
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
    </>
  );
}
