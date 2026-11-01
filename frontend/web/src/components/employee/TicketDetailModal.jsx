import React, { useEffect, useState, useMemo } from 'react';
import { AlertTriangle, Clock, Bell } from 'lucide-react';
import { formatDisplayDate } from '@/utils/dateUtils';
import { statusColors, priorityColors } from '@/constants/employeeTickets';
import { updateEmployeeTicketOverride, getInternalNotes, addInternalNote } from '@/services/ticketService';
import ProofCompletionModal from './ProofCompletionModal';
import ReassignmentDisapprovalBanner from './ReassignmentDisapprovalBanner';
import { isReassignmentDenied, hasPendingReassignment } from '@/utils/reassignmentUtils';
import InternalNotesSection from '@/components/InternalNotesSection';
import InternalTicketMessageThread from '@/components/InternalTicketMessageThread';
import TicketFeedbackSection from '@/components/feedback/TicketFeedbackSection';
import { hasFeedbackBeenSubmitted } from '@/data/mockFeedbackData';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';

const STATUS_OPTIONS = ['In Progress', 'Pending', 'Resolved'];

export default function TicketDetailModal({
  ticket,
  onClose,
  onStatusChange,
  onAccept,
  onRequestReassign,
  isAccepting = false,
}) {
  const [statusDraft, setStatusDraft] = useState('');
  const [remarks, setRemarks] = useState('');
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  
  // Status change confirmation prompt
  const [showStatusConfirm, setShowStatusConfirm] = useState(false);
  


  // Sub-modal state for Proof of Completion (Modal 2)
  const [showProofModal, setShowProofModal] = useState(false);
  const [internalNotesList, setInternalNotesList] = useState(ticket?.internalNotes || []);
  const [isAddingNote, setIsAddingNote] = useState(false);

  useEffect(() => {
    setStatusDraft(ticket?.status ?? '');
    setRemarks('');
    setAttachedFiles([]);
    setErrorMessage('');
    setSuccessMessage('');
    setShowStatusConfirm(false);
    setShowProofModal(false);
    setTimelineSortOrder('asc');
    setInternalNotesList(ticket?.internalNotes || []);

    const ticketId = ticket?.id || ticket?.ticket_ID;
    if (ticketId) {
      getInternalNotes(ticketId)
        .then((notes) => {
          if (Array.isArray(notes)) {
            setInternalNotesList(notes);
          }
        })
        .catch((err) => {
          console.warn('Could not load internal notes:', err);
        });
    }
  }, [ticket]);

  useLockBodyScroll(!!ticket);

  if (!ticket) return null;

  const isAccepted = ticket.accepted === true;
  const isInternal = ticket?.title?.startsWith('[Internal]') || ticket?.is_internal || ticket?.ticket_type === 'Internal' || ticket?.type === 'Internal';
  const isExternal = !isInternal;
  const isProofRejected = ticket.proofRejected === true && ticket.status === 'In Progress';

  // Chronological timeline view
  const timelineEvents = useMemo(() => {
    const events = [
      {
        id: 'creation',
        type: 'system',
        text: `Ticket created by ${ticket.customer || 'Customer'}.`,
        timestamp: ticket.date,
      }
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

  const [timelineSortOrder, setTimelineSortOrder] = useState('asc'); // 'asc' or 'desc'

  const sortedTimelineEvents = useMemo(() => {
    const sorted = [...timelineEvents];
    sorted.sort((a, b) => {
      const dateA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const dateB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return timelineSortOrder === 'asc' ? dateA - dateB : dateB - dateA;
    });
    return sorted;
  }, [timelineEvents, timelineSortOrder]);

  // Handle file validation (max 15MB each, max 45MB total, allowed PDF, PNG, Word)
  const validateFiles = (files) => {
    const ALLOWED_EXTENSIONS = ['pdf', 'png', 'docx', 'doc'];
    const MAX_SIZE_BYTES = 15 * 1024 * 1024; // 15MB
    const MAX_TOTAL_SIZE = 45 * 1024 * 1024; // 45MB

    let totalSize = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const extension = file.name.split('.').pop().toLowerCase();
      
      if (!ALLOWED_EXTENSIONS.includes(extension)) {
        return `Invalid file type: "${file.name}". Supported formats: PDF, PNG, Word (.docx, .doc).`;
      }
      if (file.size > MAX_SIZE_BYTES) {
        return `File too large: "${file.name}" (${(file.size / (1024 * 1024)).toFixed(2)} MB). Maximum size is 15MB per file.`;
      }
      totalSize += file.size || 0;
    }

    if (totalSize > MAX_TOTAL_SIZE) {
      return `Total attachments size exceeds 45MB limit (${(totalSize / (1024 * 1024)).toFixed(2)} MB). Please remove some files.`;
    }

    return null;
  };

  // Submit Status Update
  const handleStatusSave = () => {
    if (statusDraft !== ticket.status && !remarks.trim()) {
      setErrorMessage('A note/remarks is required when changing ticket status.');
      return;
    }

    const fileError = validateFiles(attachedFiles);
    if (fileError) {
      setErrorMessage(fileError);
      return;
    }

    const timestamp = new Date().toISOString();
    const fileNames = attachedFiles.map(f => f.name);
    
    const update = {
      status: statusDraft,
      timeline: [
        {
          id: `status-${Date.now()}`,
          type: 'status',
          text: `Status updated to "${statusDraft}". Remarks: "${remarks.trim()}" ${
            fileNames.length > 0 ? `(Attached: ${fileNames.join(', ')})` : ''
          }`,
          timestamp,
        }
      ]
    };

    updateEmployeeTicketOverride(ticket.id, update);
    ticket.status = statusDraft;
    
    if (typeof onStatusChange === 'function') {
      onStatusChange(ticket.id, statusDraft);
    }

    setSuccessMessage('Status updated successfully!');
    setRemarks('');
    setAttachedFiles([]);
    setErrorMessage('');
    setShowStatusConfirm(false);
  };

  // Add Staff-Only Internal Note (TS028)
  const handleAddInternalNote = async (noteText) => {
    const trimmed = (noteText || '').trim();
    if (!trimmed) return;

    setIsAddingNote(true);
    setErrorMessage('');
    setSuccessMessage('');

    const ticketId = ticket?.id || ticket?.ticket_ID;
    try {
      const res = await addInternalNote(ticketId, trimmed);
      const newNote = res?.note || {
        id: `note-${Date.now()}`,
        text: trimmed,
        author: 'Staff Member',
        timestamp: new Date().toISOString(),
      };
      setInternalNotesList((prev) => [...prev, newNote]);
      setSuccessMessage('Internal note added successfully!');
    } catch (err) {
      const msg = err?.response?.data?.message || 'Failed to submit internal note. Please try again.';
      setErrorMessage(msg);
      throw err;
    } finally {
      setIsAddingNote(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-[1.5px] p-4" onClick={onClose}>
        <div
          className="bg-white rounded-3xl shadow-2xl w-full max-w-lg mx-4 relative flex flex-col max-h-[85vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-6 border-b border-gray-100 flex-shrink-0 relative">
            <button type="button" onClick={onClose} className="absolute top-5 right-5 p-2 rounded-full hover:bg-gray-100 transition-colors text-gray-400">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            
            <h2 className="text-modal-title text-gray-900 leading-snug pr-8">{ticket.title}</h2>
            <div className="flex flex-wrap items-center gap-2 mt-2 pr-8">
              <span className="text-badge text-[#252578] bg-blue-50 px-3 py-1 rounded-full">{ticket.id}</span>
              <span className={`text-badge px-3 py-1 rounded-full ${statusColors[ticket.status]}`}>
                {ticket.status}
              </span>
              <span className={`text-badge px-3 py-1 rounded-full ${priorityColors[ticket.priority]}`}>
                {ticket.priority}
              </span>
              {ticket.reassignmentRequested && (
                <span className="text-badge px-3 py-1 bg-amber-100 text-amber-800 rounded-full border border-amber-200">
                  Pending Reassignment
                </span>
              )}
              {(() => {
                const rawSla = ticket.sla_status || ticket.slaStatus || (ticket.sla_breached ? 'Breached' : null);
                const normalized = rawSla ? String(rawSla).toLowerCase().replace(/[\s_-]+/g, '') : '';
                if (normalized === 'breached' || normalized === 'violated') {
                  return (
                    <span className="text-badge px-3 py-1 bg-rose-100 text-rose-800 rounded-full border border-rose-200 font-semibold inline-flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />
                      <span>SLA Breached</span>
                    </span>
                  );
                }
                if (normalized === 'atrisk') {
                  return (
                    <span className="text-badge px-3 py-1 bg-amber-100 text-amber-800 rounded-full border border-amber-200 font-semibold inline-flex items-center gap-1">
                      <Clock className="w-3 h-3 text-amber-600 shrink-0" />
                      <span>SLA At Risk</span>
                    </span>
                  );
                }
                return null;
              })()}
            </div>
            <p className="text-sm text-gray-500 mt-1">{ticket.equipment} · {ticket.category}</p>
          </div>

          {/* Content Body - Scrollable */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            
            {/* Notifications / Feedback */}
            {successMessage && (
              <div className="rounded-xl bg-green-50 border border-green-200 text-green-800 px-4 py-3 text-sm font-medium flex items-center gap-2">
                <svg className="w-5 h-5 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{successMessage}</span>
              </div>
            )}

            {errorMessage && (
              <div className="rounded-xl bg-red-50 border border-red-200 text-red-800 px-4 py-3 text-sm font-medium flex items-center gap-2">
                <svg className="w-5 h-5 text-red-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Ticket Information Details */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-50 rounded-xl p-4 text-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-dark mb-0.5">Requestor</p>
                <p className="text-sm font-normal text-slate-600">{ticket.customer || 'Unknown Customer'}</p>
                {ticket.facility && <p className="text-xs font-normal text-slate-400 mt-0.5">{ticket.facility}</p>}
              </div>
              <div className="bg-gray-50 rounded-xl p-4 text-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-dark mb-0.5">Date Filed</p>
                <p className="text-sm font-normal text-slate-600">{formatDisplayDate(ticket.date)}</p>
              </div>
              {(ticket.resolution_due_at || ticket.due_at || ticket.sla_due_date || ticket.sla?.resolution?.target) && (
                <div className="col-span-2 bg-rose-50/50 border border-rose-100 rounded-xl p-4 text-sm">
                  <p className="text-xs font-bold uppercase tracking-wider text-rose-900 mb-0.5 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-rose-600" />
                    <span>SLA Resolution Target</span>
                  </p>
                  <p className="text-sm font-semibold text-rose-800">
                    {formatDisplayDate(ticket.resolution_due_at || ticket.due_at || ticket.sla_due_date || ticket.sla?.resolution?.target)}
                  </p>
                </div>
              )}
              {(ticket.last_reminder_sent_at || ticket.lastReminderSentAt) && (
                <div className="col-span-2 rounded-xl bg-indigo-50 border border-indigo-200 p-4 text-sm">
                  <p className="text-xs font-bold uppercase tracking-wider text-indigo-950 mb-0.5 flex items-center gap-1.5">
                    <Bell className="w-3.5 h-3.5 text-indigo-600" />
                    <span>CS Employee Reminder</span>
                  </p>
                  <p className="text-sm font-semibold text-indigo-800">
                    Last sent: {formatDisplayDate(ticket.last_reminder_sent_at || ticket.lastReminderSentAt)}
                  </p>
                  <p className="text-xs text-indigo-700 mt-1 leading-relaxed">
                    Customer Service dispatched a reminder prompt regarding this ticket. Please review and provide progress.
                  </p>
                </div>
              )}
            </div>

            {/* ────────────────────────────────────────────────────────
                UNACCEPTED STATE PANEL (Accept / Request Reassignment)
               ──────────────────────────────────────────────────────── */}
            {!isAccepted ? (
              <div className="space-y-4">
                <ReassignmentDisapprovalBanner
                  ticket={ticket}
                  onRequestReassignAgain={() => {
                    if (typeof onRequestReassign === 'function') {
                      onRequestReassign(ticket);
                    }
                  }}
                />
                {ticket.status === 'Pending Evaluation' ? (
                <div className="border border-purple-100 rounded-2xl p-6 bg-purple-50/30 text-center space-y-3">
                  <h4 className="text-sm font-bold text-purple-800">Pending for Evaluation</h4>
                  <p className="text-xs text-purple-700 leading-relaxed max-w-md mx-auto">
                    This ticket is currently awaiting evaluation. No action is required at this time.
                  </p>
                </div>
              ) : hasPendingReassignment(ticket) ? (
                <div className="border border-amber-100 rounded-2xl p-6 bg-amber-50/30 text-center space-y-3">
                  <h4 className="text-sm font-bold text-amber-900 flex items-center justify-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                    Reassignment Request Pending
                  </h4>
                  <p className="text-xs text-amber-800 leading-relaxed max-w-md mx-auto">
                    You have requested reassignment for this ticket with the reason:<br/>
                    <strong className="italic">&quot;{ticket.reassignmentReason || ticket.reassignment_reason || 'Awaiting review'}&quot;</strong><br/>
                    Awaiting CS coordinator review and action.
                  </p>
                </div>
              ) : (
                <div className="border border-gray-150 rounded-2xl p-6 bg-slate-50 text-center space-y-4">
                  <h4 className="text-sm font-bold text-gray-800">Pending Assignment Action</h4>
                  <p className="text-xs text-gray-500 leading-relaxed max-w-md mx-auto">
                    You are currently assigned to this ticket. Please accept this assignment to begin work, or request a reassignment if you cannot complete it.
                  </p>
                  <div className="flex gap-3 justify-center pt-2">
                    <button
                      type="button"
                      disabled={isAccepting}
                      onClick={() => {
                        if (typeof onRequestReassign === 'function') {
                          onRequestReassign(ticket);
                        }
                      }}
                      className="px-6 py-2.5 border border-red-200 text-red-700 hover:bg-red-50 text-button rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Request Reassignment
                    </button>
                    <button
                      type="button"
                      disabled={isAccepting}
                      onClick={() => {
                        if (typeof onAccept === 'function') {
                          onAccept(ticket.id);
                        }
                      }}
                      className="px-8 py-2.5 bg-[#252578] hover:bg-[#1a1a5c] text-white text-button rounded-xl transition-all shadow-md shadow-[#252578]/25 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isAccepting ? 'Accepting...' : 'Accept'}
                    </button>
                  </div>
                </div>
              )}
              </div>
            ) : (
              // ────────────────────────────────────────────────────────
              // ACCEPTED FULL MANAGEMENT PANEL
              // ────────────────────────────────────────────────────────
              <div className="space-y-6">
                
                {/* Reassignment disapproved banner */}
                <ReassignmentDisapprovalBanner
                  ticket={ticket}
                  onRequestReassignAgain={() => {
                    if (typeof onRequestReassign === 'function') {
                      onRequestReassign(ticket);
                    }
                  }}
                />

                {/* 1. Reassignment request pending banner (if reassignment requested post-accept) */}
                {hasPendingReassignment(ticket) && (
                  <div className="flex items-center gap-3 bg-amber-50/70 border border-amber-100 rounded-xl p-3.5 text-xs text-amber-800">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
                    <div>
                      <span className="font-bold">Reassignment Request Pending:</span> &quot;{ticket.reassignmentReason || ticket.reassignment_reason || 'Awaiting review'}&quot;
                    </div>
                  </div>
                )}

                {/* 2. Pending Evaluation banner */}
                {ticket.status === 'Pending Evaluation' && (
                  <div className="border border-purple-100 rounded-2xl p-5 bg-purple-50/30 text-center space-y-2">
                    <h4 className="text-sm font-bold text-purple-800">Pending for Evaluation</h4>
                    <p className="text-xs text-purple-700 leading-relaxed max-w-md mx-auto">
                      Your proof of completion has been submitted. Waiting for CS coordinator evaluation.
                    </p>
                  </div>
                )}

                {/* 3. Proof of Completion card — only visible when resolving/resolved */}
                {(statusDraft === 'Resolved' || ticket.status === 'Resolved' || ticket.status === 'Pending Evaluation' || isProofRejected) && (
                  <div className="border border-gray-150 rounded-2xl p-5 bg-green-50/30 border-green-100 flex items-center justify-between flex-wrap gap-4">
                    <div className="max-w-md text-left">
                      {isProofRejected && (
                        <div className="mb-2.5 flex items-center gap-2 bg-orange-50 border border-orange-200 text-orange-800 px-3 py-1.5 rounded-xl text-badge">
                          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0 animate-pulse" />
                          <span>Proof Rejected: &quot;{ticket.rejectionReason}&quot;</span>
                        </div>
                      )}
                      <h4 className="text-field-label uppercase text-gray-800">
                        {isProofRejected
                          ? 'Re-upload Proof of Completion'
                          : isInternal
                          ? 'Proof of Completion (Optional for Internal Tickets)'
                          : 'Proof of Completion Required'}
                      </h4>
                      <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                        {isInternal
                          ? 'Supporting documentation (PDF, PNG, Word up to 15MB each, 45MB total) is optional for internal tickets and can be attached if desired.'
                          : 'Supporting documentation (PDF, PNG, Word up to 15MB each, 45MB total) must be verified before the ticket can be resolved.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowProofModal(true)}
                      className="px-5 py-2.5 bg-green-700 hover:bg-green-800 text-white text-button rounded-xl transition-all shadow-md shadow-green-700/20 flex items-center gap-1.5 shrink-0"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                      {isProofRejected ? 'Re-upload Proof' : (isInternal ? 'Attach Proof Documents' : 'Upload Proof Documents')}
                    </button>
                  </div>
                )}

                {/* 4. Ticket Status updates (In Progress, Pending, Resolved) */}
                {ticket.status !== 'Pending Evaluation' && ticket.status !== 'Resolved' && (
                  <div className="border border-gray-100 rounded-2xl p-5 bg-gray-50/70 text-left">
                    <h4 className="text-field-label uppercase text-gray-700 mb-3">Update Ticket Status</h4>
                    
                    {!showStatusConfirm ? (
                      <div className="space-y-4">
                        <div>
                          <label htmlFor="modal-status-select" className="block text-field-label uppercase text-gray-500 mb-1">Select new status</label>
                          <select
                            id="modal-status-select"
                            value={statusDraft}
                            onChange={(e) => setStatusDraft(e.target.value)}
                            className="w-full text-xs border border-gray-200 rounded-xl px-3 py-2.5 bg-white text-gray-800 outline-none focus:ring-2 focus:ring-[#252578]/25 cursor-pointer font-semibold"
                          >
                            {STATUS_OPTIONS.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </div>

                        {statusDraft !== ticket.status && (
                          <div className="space-y-4">
                            {(statusDraft !== 'Resolved' || isInternal) && (
                              <>
                                <div>
                                  <label htmlFor="status-remarks" className="block text-field-label uppercase text-gray-500 mb-1">Remarks/Notes * (Required on status change)</label>
                                  <textarea
                                    id="status-remarks"
                                    placeholder="Provide detailed notes regarding the status change..."
                                    value={remarks}
                                    onChange={(e) => setRemarks(e.target.value)}
                                    className="w-full text-xs border border-gray-200 rounded-xl p-3 bg-white text-gray-800 outline-none focus:ring-2 focus:ring-[#252578]/25 min-h-[4rem] resize-none"
                                    required
                                  />
                                </div>

                                <div>
                                  <label className="block text-field-label uppercase text-gray-500 mb-1">
                                    Supporting Documentation (Optional · PDF, PNG, Word · max 15MB each, 45MB total)
                                  </label>
                                  <input
                                    type="file"
                                    multiple
                                    accept=".pdf,.png,.docx,.doc"
                                    onChange={(e) => setAttachedFiles(Array.from(e.target.files))}
                                    className="w-full text-xs text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-[#252578]/10 file:text-[#252578] hover:file:bg-[#252578]/20 file:cursor-pointer"
                                  />
                                  {attachedFiles.length > 0 && (
                                    <div className="mt-1.5 flex flex-wrap gap-1">
                                      {attachedFiles.map((file, idx) => (
                                        <span key={idx} className="inline-flex items-center text-badge bg-white border border-gray-200 rounded-full px-2.5 py-0.5 text-gray-600">
                                          {file.name}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </>
                            )}

                            {statusDraft === 'Resolved' && !isInternal ? (
                              <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-xl text-field-value text-center">
                                You must submit a Proof of Completion to resolve external tickets. Please click &quot;Upload Proof Documents&quot; in the card above.
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  if (statusDraft !== 'Resolved' && !remarks.trim()) {
                                    setErrorMessage('Remarks are required to change ticket status.');
                                    return;
                                  }
                                  setErrorMessage('');
                                  setShowStatusConfirm(true);
                                }}
                                className="w-full py-2.5 bg-[#252578] hover:bg-[#1a1a5c] text-white text-button rounded-xl transition-all shadow-md shadow-[#252578]/20"
                              >
                                {statusDraft === 'Resolved' ? 'Resolve Internal Ticket' : 'Save Status Change'}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="bg-white border border-blue-100 rounded-xl p-4 text-center">
                        <h5 className="text-field-label uppercase text-gray-800 mb-1.5">Confirm Status Change</h5>
                        <p className="text-timestamp text-gray-500 mb-4">
                          Are you sure you want to change the ticket status from <strong className="text-gray-700">&quot;{ticket.status}&quot;</strong> to <strong className="text-gray-700">&quot;{statusDraft}&quot;</strong>?
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setShowStatusConfirm(false)}
                            className="flex-1 py-2 text-button border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleStatusSave}
                            className="flex-1 py-2 text-button bg-[#252578] hover:bg-[#1a1a5c] text-white rounded-lg shadow"
                          >
                            Yes, Save Changes
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 4. Staff-Only Internal Notes */}
                <InternalNotesSection
                  notes={internalNotesList}
                  onAddNote={handleAddInternalNote}
                  isAdding={isAddingNote}
                />

                {/* Internal Ticket Message Thread */}
                {isInternal && (ticket.id || ticket.ticket_ID) && (
                  <div className="pt-2">
                    <InternalTicketMessageThread
                      ticketId={ticket.id || ticket.ticket_ID}
                      ticket={ticket}
                      isClosed={ticket.status === 'Closed' || Number(ticket.ticket_status_ID) === 4}
                    />
                  </div>
                )}

                {/* Customer Satisfaction Feedback */}
                {(ticket.status === 'Resolved' || ticket.status === 'Closed' || hasFeedbackBeenSubmitted(ticket.id || ticket.ticket_ID)) && (
                  <div className="pt-2">
                    <TicketFeedbackSection ticket={ticket} readOnly={true} />
                  </div>
                )}

                {/* 5. Chronological History Timeline */}
                <div className="space-y-3 text-left">
                  <div className="flex justify-between items-center">
                    <h4 className="text-field-label uppercase text-gray-800">Ticket Timeline & History</h4>
                    <button
                      type="button"
                      onClick={() => setTimelineSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-[#252578]/5 hover:bg-[#252578]/10 border border-[#252578]/10 rounded-xl text-badge text-[#252578] transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l-4-4m4 4l4-4" />
                      </svg>
                      {timelineSortOrder === 'asc' ? 'Oldest' : 'Newest'}
                    </button>
                  </div>
                  <div className="relative pl-6 space-y-4 border-l border-gray-200 ml-3 py-1.5">
                    {sortedTimelineEvents.map((evt, idx) => {
                      const isReminder = evt.type === 'reminder';
                      return (
                        <div key={evt.id || idx} className="relative text-field-value">
                          {/* Circle dot marker */}
                          <div className={`absolute -left-[30px] top-1 w-2.5 h-2.5 rounded-full border-2 border-white shadow ${
                            isReminder ? 'bg-indigo-600 ring-2 ring-indigo-200' : 'bg-[#252578]'
                          }`} />
                          <div className="flex justify-between items-center text-timestamp text-gray-400 mb-0.5">
                            <span className={`text-timestamp uppercase tracking-wide flex items-center gap-1 font-bold ${
                              isReminder ? 'text-indigo-600' : 'text-[#252578]'
                            }`}>
                              {isReminder && <Bell className="w-3 h-3 text-indigo-600 inline" />}
                              {isReminder ? 'CS Reminder' : evt.type === 'system' ? 'System' : evt.type || 'Update'}
                            </span>
                            <span className="text-timestamp">{formatDisplayDate(evt.timestamp)}</span>
                          </div>
                          <p
                            className={`text-field-value p-2.5 rounded-lg border break-words whitespace-pre-wrap max-w-full overflow-hidden ${
                              isReminder
                                ? 'text-indigo-950 bg-indigo-50/80 border-indigo-200 font-medium'
                                : 'text-gray-700 bg-gray-50/50 border-gray-100/50'
                            }`}
                            style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}
                          >
                            {evt.text}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>
            )}

          </div>

        </div>
      </div>

      {showProofModal && (
        <ProofCompletionModal
          ticket={ticket}
          onClose={() => setShowProofModal(false)}
          onStatusChange={onStatusChange}
        />
      )}
    </>
  );
}
