import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Loader2, Bell } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { formatDisplayDate } from '@/utils/dateUtils';
import {
  acceptTicket,
  requestReassignment,
  getInternalNotes,
  getTicketDetails,
} from '@/services/ticketService';
import {
  isReassignmentDenied,
  getReassignmentDisapprovalReason,
  hasPendingReassignment,
} from '@/utils/reassignmentUtils';
import {
  TicketDetailModalShell,
  ModalHeader,
  TicketTitleBlock,
  StatusStepper,
  ReassignmentNotice,
  TechnicianDecisionCard,
  ReassignDialog,
  TabBar,
  FieldGrid,
  AttachmentCard,
  ModalFooter,
  AlertBanner,
  formatPHT,
  buildTechnicianTimeline,
} from '../ticket-modal';
import InternalTicketMessageThread from '@/components/InternalTicketMessageThread';
import FilePreviewModal from '@/components/FilePreviewModal';
import { Dialog, DialogContent } from '@/components/ui/dialog';

const TECHNICIAN_STEPS = [
  { id: 'submitted', label: 'Submitted' },
  { id: 'assigned', label: 'Assigned to you' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'resolved', label: 'Resolved' },
];

export default function TicketDetailModal({
  ticket,
  onClose,
  onStatusChange,
  onAccept,
  onRequestReassign,
  isAccepting: externalIsAccepting = false,
}) {
  const navigate = useNavigate();
  const toast = useToast();

  const [localTicket, setLocalTicket] = useState(ticket);
  const [internalIsAccepting, setInternalIsAccepting] = useState(false);
  const isAccepting = externalIsAccepting || internalIsAccepting;

  // Active tab state: 'details' | 'timeline' | 'files' | 'notes'
  const [activeTab, setActiveTab] = useState('details');

  // Reassignment dialog state
  const [isReassignDialogOpen, setIsReassignDialogOpen] = useState(false);
  const [isSubmittingReassignment, setIsSubmittingReassignment] = useState(false);

  // Message coordinator dialog state
  const [showMessageDialog, setShowMessageDialog] = useState(false);

  // File preview state
  const [previewFile, setPreviewFile] = useState(null);

  // Internal notes state
  const [internalNotesList, setInternalNotesList] = useState(ticket?.internalNotes || []);

  useEffect(() => {
    setLocalTicket(ticket);
    setActiveTab('details');
    setIsReassignDialogOpen(false);
    setShowMessageDialog(false);
    setInternalNotesList(ticket?.internalNotes || []);

    const ticketId = ticket?.ticket_ID || ticket?.id;
    if (ticketId) {
      getInternalNotes(ticketId)
        .then((notes) => {
          if (Array.isArray(notes)) {
            setInternalNotesList(notes);
          }
        })
        .catch(() => {});
    }
  }, [ticket]);

  if (!localTicket) return null;

  const currentTicket = localTicket;
  const numericId = currentTicket.ticket_ID || Number(String(currentTicket.id || '').replace(/\D/g, ''));
  const ticketRef = currentTicket.id || (numericId ? `TKT-${String(numericId).padStart(4, '0')}` : 'TKT-0000');

  const isAccepted = Boolean(currentTicket.accepted === true || ['In Progress', 'Pending', 'Resolved', 'Closed'].includes(currentTicket.status));
  const isDeclined = isReassignmentDenied(currentTicket);
  const isPendingReassign = hasPendingReassignment(currentTicket);
  const previousDeclineReason = getReassignmentDisapprovalReason(currentTicket);

  // Coordinator resolution
  const coordinatorName =
    currentTicket.coordinator_name ||
    currentTicket.coordinator ||
    currentTicket.assigned_by_name ||
    currentTicket.csr_name ||
    '';

  // Subtitle pieces: <Equipment Name> · <Equipment ID> · <Issue summary>
  const equipName = currentTicket.equipment || currentTicket.machine_name || currentTicket.equipment_name || 'Bedside Monitor';
  const equipId = currentTicket.equipment_type || currentTicket.model_number || currentTicket.serial_number || currentTicket.asset_id || currentTicket.assetId || 'MON-500-A11';
  const issueSummary = currentTicket.category || currentTicket.issue_summary || (currentTicket.title ? currentTicket.title.replace(/^\[.*?\]\s*/, '') : 'Calibration Required');
  const subtitle = [equipName, equipId, issueSummary].filter(Boolean).join(' · ');

  // Auto-generated timeline events (never empty, most recent first)
  const timelineEvents = useMemo(() => {
    return buildTechnicianTimeline(currentTicket);
  }, [currentTicket]);

  // Attachments and proof documents count
  const allAttachments = useMemo(() => {
    const list = [];
    if (Array.isArray(currentTicket.attachments)) list.push(...currentTicket.attachments);
    if (Array.isArray(currentTicket.proofFiles)) list.push(...currentTicket.proofFiles);
    if (Array.isArray(currentTicket.proofAttachments)) list.push(...currentTicket.proofAttachments);
    return list;
  }, [currentTicket]);

  // Stepper active index:
  // 0 = Submitted, 1 = Assigned to you, 2 = In Progress, 3 = Resolved
  const activeStepIndex = useMemo(() => {
    const s = String(currentTicket.status || '').toLowerCase();
    if (s === 'resolved' || s === 'closed') return 3;
    if (isAccepted || s === 'in progress' || s === 'on hold') return 2;
    return 1; // "Assigned to you" (awaiting acceptance)
  }, [currentTicket.status, isAccepted]);

  // Tab definitions
  const tabs = useMemo(() => {
    const t = [
      { id: 'details', label: 'Details' },
      { id: 'timeline', label: 'Timeline', count: timelineEvents.length },
      { id: 'files', label: 'Files', count: allAttachments.length },
    ];
    if (internalNotesList.length > 0) {
      t.push({ id: 'notes', label: 'Notes', count: internalNotesList.length });
    }
    return t;
  }, [timelineEvents.length, allAttachments.length, internalNotesList.length]);

  // Handle Accept
  const handleAccept = useCallback(async () => {
    if (isAccepting) return;

    if (typeof onAccept === 'function') {
      try {
        await onAccept(currentTicket.ticket_ID || currentTicket.id);
      } catch (err) {
        // Parent already handled or logged
      }
      return;
    }

    setInternalIsAccepting(true);
    try {
      await acceptTicket({ ticketId: numericId });
      setLocalTicket((prev) => ({
        ...prev,
        accepted: true,
        status: 'In Progress',
      }));
      toast?.success?.('Assignment accepted', 'You have accepted this ticket assignment.');
      onStatusChange?.('In Progress');
    } catch (err) {
      console.error('Failed to accept ticket:', err);
      toast?.error?.(
        err?.response?.data?.message || 'Could not accept this assignment. Please try again.',
        'Accept failed'
      );
    } finally {
      setInternalIsAccepting(false);
    }
  }, [isAccepting, onAccept, currentTicket, numericId, onStatusChange, toast]);

  // Handle Request Reassignment Submit
  const handleReassignSubmit = useCallback(async (newReason) => {
    setIsSubmittingReassignment(true);
    try {
      await requestReassignment({
        ticketId: numericId,
        reason: newReason,
      });

      // Update local state to show pending outcome
      setLocalTicket((prev) => ({
        ...prev,
        reassignmentRequested: true,
        reassignmentStatus: 'Pending',
        reassignmentReason: newReason,
        status: 'Pending Reassignment',
      }));

      setIsReassignDialogOpen(false);
      toast?.success?.(
        'Reassignment requested',
        'Your reassignment request has been submitted to the coordinator.'
      );

      if (typeof onRequestReassign === 'function') {
        onRequestReassign(currentTicket, newReason);
      }
      onStatusChange?.('Pending Reassignment');
    } catch (err) {
      console.error('Failed to submit reassignment request:', err);
      toast?.error?.(
        err?.response?.data?.message || 'Could not submit reassignment request. Please try again.',
        'Request failed'
      );
    } finally {
      setIsSubmittingReassignment(false);
    }
  }, [numericId, currentTicket, onRequestReassign, onStatusChange, toast]);

  const handleOpenMessages = useCallback(() => {
    setShowMessageDialog(true);
  }, []);

  return (
    <>
      <TicketDetailModalShell
        isOpen={Boolean(ticket)}
        onClose={onClose}
        maxWidth="max-w-xl sm:max-w-[600px]"
        header={
          <ModalHeader
            ticketId={ticketRef}
            onClose={onClose}
          />
        }
        footer={
          <ModalFooter
            primaryAction={
              <button
                type="button"
                onClick={handleOpenMessages}
                aria-label="Message coordinator"
                className="min-h-[44px] px-5 py-2 rounded-lg border border-[#D5D9E4] bg-white text-[#1B2033] hover:text-[#1E2A78] hover:border-[#1E2A78] hover:bg-[#F5F6FA] text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-2 shadow-2xs"
              >
                <MessageSquare className="w-4 h-4 text-[#1E2A78]" />
                <span>
                  {coordinatorName ? `Message coordinator (${coordinatorName})` : 'Message coordinator'}
                </span>
              </button>
            }
          />
        }
      >
        {/* 2. Ticket Title Block */}
        <TicketTitleBlock
          title={currentTicket.title}
          priority={currentTicket.priority || 'Low'}
          statusPill={!isAccepted ? 'Awaiting your acceptance' : null}
          hideStatusBadge={!isAccepted}
          subtitle={subtitle}
        />

        {/* 3. Status Stepper (Submitted > Assigned to you > In Progress > Resolved) */}
        <div className="pt-1 pb-1">
          <StatusStepper
            status={currentTicket.status}
            steps={TECHNICIAN_STEPS}
            activeStepIndex={activeStepIndex}
            ringCurrentStep={!isAccepted}
          />
        </div>

        {/* Reminder notification banner */}
        {Boolean(currentTicket.last_reminder_sent_at) && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 space-y-2">
            <div className="flex items-center gap-2 text-indigo-900 font-semibold text-xs">
              <Bell className="w-4 h-4 text-indigo-600" />
              <span>CS Employee Reminder</span>
            </div>
            <p className="text-xs text-indigo-950">
              Customer Service dispatched a reminder prompt regarding this ticket on{' '}
              {formatDisplayDate(currentTicket.last_reminder_sent_at)}.
            </p>
          </div>
        )}

        {/* 4. Reassignment Outcome Notice (Amber AlertBanner, shown only when declined) */}
        {isDeclined && !isPendingReassign && (
          <ReassignmentNotice
            ticket={currentTicket}
            coordinatorName={coordinatorName}
            onAskWhy={handleOpenMessages}
          />
        )}

        {/* 5. Decision Card or Pending Notice */}
        {!isAccepted ? (
          isPendingReassign ? (
            <AlertBanner
              variant="info"
              title="Reassignment requested"
              message="Waiting for the coordinator's decision. You will be notified once reviewed."
            />
          ) : (
            <TechnicianDecisionCard
              onAccept={handleAccept}
              onRequestReassign={() => setIsReassignDialogOpen(true)}
              isDeclined={isDeclined}
              isAccepting={isAccepting}
            />
          )
        ) : null}

        {/* 6. TabBar (Details | Timeline (n) | Files (n)) */}
        <TabBar
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          className="pt-1"
        />

        {/* 7. Tab Panels */}
        <div className="pt-2">
          {/* TAB 1: DETAILS */}
          {activeTab === 'details' && (
            <div className="space-y-5">
              <FieldGrid
                requestor={currentTicket.customer || currentTicket.requestor || '—'}
                dateFiled={currentTicket.date || currentTicket.created_at ? formatPHT(currentTicket.date || currentTicket.created_at) : '—'}
                equipment={equipName}
                assetId={equipId}
                priority={currentTicket.priority || 'Low'}
                category={currentTicket.category || null}
                slaDueDate={currentTicket.slaDueDate || currentTicket.expected_resolution ? formatPHT(currentTicket.slaDueDate || currentTicket.expected_resolution) : null}
                extraFields={
                  currentTicket.description
                    ? [
                        {
                          label: 'Issue Description',
                          value: (
                            <p className="text-xs sm:text-sm text-[#1B2033] leading-relaxed break-words whitespace-pre-wrap">
                              {currentTicket.description}
                            </p>
                          ),
                          fullWidth: true,
                        },
                      ]
                    : []
                }
              />

              {/* Mockup Timeline Preview underneath Details Grid */}
              <div className="rounded-xl border border-[#D5D9E4] bg-white p-4 space-y-3 shadow-2xs">
                <span className="text-[11px] font-bold text-[#5A6178] uppercase tracking-wider block">
                  TIMELINE
                </span>
                <div className="space-y-3.5 divide-y divide-[#D5D9E4]/60">
                  {timelineEvents.slice(0, 4).map((evt, idx) => (
                    <div key={evt.id || idx} className={idx > 0 ? 'pt-3' : ''}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs sm:text-[13px] font-bold text-[#1B2033] leading-snug">
                          {evt.title}
                        </p>
                      </div>
                      {evt.description && (
                        <p className="text-xs text-[#5A6178] mt-0.5 leading-normal">
                          {evt.description}
                        </p>
                      )}
                      <p className="text-[11px] text-[#5A6178] mt-1 font-medium">
                        {formatPHT(evt.timestamp)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: TIMELINE */}
          {activeTab === 'timeline' && (
            <div className="rounded-xl border border-[#D5D9E4] bg-white p-4 space-y-4 shadow-2xs">
              <span className="text-[11px] font-bold text-[#5A6178] uppercase tracking-wider block">
                Activity &amp; Assignment History ({timelineEvents.length})
              </span>
              <div className="space-y-0 ml-1">
                {timelineEvents.map((evt, idx) => {
                  const isLast = idx === timelineEvents.length - 1;
                  return (
                    <div key={evt.id || idx} className="flex items-start gap-3 text-xs">
                      <div className="flex flex-col items-center self-stretch shrink-0 w-3">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0 mt-1 bg-[#1E2A78]" />
                        {!isLast && <div className="w-[2px] bg-[#1E2A78] flex-1 my-0.5" />}
                      </div>
                      <div className={`flex-1 min-w-0 ${!isLast ? 'pb-4' : 'pb-1'}`}>
                        <p className="text-xs sm:text-sm font-bold text-[#1B2033]">
                          {evt.title}
                        </p>
                        {evt.description && (
                          <p className="text-xs text-[#5A6178] mt-0.5 leading-relaxed">
                            {evt.description}
                          </p>
                        )}
                        <p className="text-[11px] text-[#5A6178] mt-1 font-medium">
                          {formatPHT(evt.timestamp)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: FILES */}
          {activeTab === 'files' && (
            <div className="space-y-3">
              {allAttachments.length === 0 ? (
                <div className="rounded-xl border border-[#D5D9E4] bg-white p-6 text-center text-xs text-[#5A6178]">
                  No attached files or photos for this ticket.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {allAttachments.map((file, idx) => (
                    <AttachmentCard
                      key={idx}
                      file={file}
                      showActions={true}
                      onPreview={setPreviewFile}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: NOTES (Only if notes present) */}
          {activeTab === 'notes' && internalNotesList.length > 0 && (
            <div className="rounded-xl border border-[#D5D9E4] bg-white p-4 space-y-3 shadow-2xs">
              <span className="text-[11px] font-bold text-[#5A6178] uppercase tracking-wider block">
                Internal Notes ({internalNotesList.length})
              </span>
              <div className="space-y-2.5">
                {internalNotesList.map((n, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-[#F5F6FA] border border-[#D5D9E4] text-xs">
                    <p className="font-semibold text-[#1B2033]">{n.note || n.text || n.content}</p>
                    <p className="text-[10px] text-[#5A6178] mt-1">{formatPHT(n.created_at || n.date)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </TicketDetailModalShell>

      {/* Reassign Dialog */}
      <ReassignDialog
        isOpen={isReassignDialogOpen}
        ticket={currentTicket}
        previousReason={previousDeclineReason}
        onClose={() => setIsReassignDialogOpen(false)}
        onSubmit={handleReassignSubmit}
        isSubmitting={isSubmittingReassignment}
      />

      {/* Coordinator Message Discussion Dialog */}
      {showMessageDialog && numericId && (
        <Dialog open={showMessageDialog} onOpenChange={setShowMessageDialog}>
          <DialogContent className="max-w-2xl w-full p-0 overflow-hidden max-h-[85vh] flex flex-col rounded-2xl">
            <div className="p-4 border-b border-[#D5D9E4] flex items-center justify-between bg-white shrink-0">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-[#1E2A78]" />
                <h3 className="text-sm font-bold text-[#1B2033]">
                  Conversation with Coordinator
                </h3>
                <span className="text-xs font-semibold text-[#5A6178]">
                  ({ticketRef})
                </span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 bg-[#F5F6FA]/50">
              <InternalTicketMessageThread
                ticketId={numericId}
                ticket={currentTicket}
                isClosed={currentTicket.status === 'Closed' || Number(currentTicket.ticket_status_ID) === 4}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* File Preview Modal */}
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </>
  );
}
