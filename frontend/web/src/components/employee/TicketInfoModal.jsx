import React, { useState, useEffect } from 'react';
import { ShieldAlert, AlertTriangle, Clock, Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { statusColors, priorityColors } from '@/constants/employeeTickets';
import { formatDisplayDate } from '@/utils/dateUtils';
import FilePreviewModal from '@/components/FilePreviewModal';
import InternalNotesSection from '@/components/InternalNotesSection';
import ReassignmentDisapprovalBanner from '@/components/employee/ReassignmentDisapprovalBanner';
import ReassignmentModal from '@/components/employee/ReassignmentModal';
import { isReassignmentDenied } from '@/utils/reassignmentUtils';
import { getTicketDetails } from '@/services/ticketService';
import TicketFeedbackSection from '@/components/feedback/TicketFeedbackSection';
import { hasFeedbackBeenSubmitted } from '@/data/mockFeedbackData';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';

export default function TicketInfoModal({ ticket, onClose, onReassignSuccess }) {
  const navigate = useNavigate();
  const [previewFile, setPreviewFile] = useState(null);
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [ticketDetails, setTicketDetails] = useState(ticket);

  useLockBodyScroll(!!ticket);

  useEffect(() => {
    setTicketDetails(ticket);
    const numericId = Number(String(ticket?.ticket_ID || ticket?.id || '').replace(/\D/g, ''));
    if (numericId && (!ticket?.timeline || isReassignmentDenied(ticket))) {
      getTicketDetails(numericId)
        .then((full) => {
          if (full) {
            setTicketDetails((prev) => ({
              ...full,
              ...(prev || {}),
              timeline: full.timeline || prev?.timeline,
              reassignmentDenyReason: prev?.reassignmentDenyReason || full.reassignmentDenyReason,
              disapprovalReason: prev?.disapprovalReason || full.disapprovalReason,
              reassignmentStatus: prev?.reassignmentStatus || full.reassignmentStatus,
              deniedReassignment: prev?.deniedReassignment ?? full.deniedReassignment,
              proofRejected: prev?.proofRejected ?? full.proofRejected,
              rejectionReason: prev?.rejectionReason ?? full.rejectionReason,
            }));
          }
        })
        .catch(() => {});
    }
  }, [ticket]);

  if (!ticket) return null;

  const currentTicket = ticketDetails || ticket;

  const handleUpdate = () => {
    onClose();
    const tId = currentTicket.ticket_ID || currentTicket.id;
    navigate('/employee/ticket-update', { state: { ticketId: tId, ticket: currentTicket } });
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4 backdrop-blur-[1.5px]"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 relative flex flex-col max-h-[85vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-gray-100 flex-shrink-0 relative">
          <button type="button" onClick={onClose} className="absolute top-5 right-5 p-2 rounded-full hover:bg-gray-100 transition-colors text-gray-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          <h2 className="text-xl font-bold text-gray-900 leading-snug pr-8">{ticket.title}</h2>
          <div className="flex flex-wrap items-center gap-2 mt-2 pr-8">
            <span className="text-xs font-bold text-[#252578] bg-blue-50 px-3 py-1 rounded-full">{ticket.id}</span>
            <span className={`text-xs font-semibold px-3 py-1 rounded-full ${statusColors[ticket.status] ?? 'bg-gray-100 text-gray-700'}`}>{ticket.status}</span>
            <span className={`text-xs font-semibold px-3 py-1 rounded-full ${priorityColors[ticket.priority] ?? 'bg-gray-100 text-gray-700'}`}>{ticket.priority}</span>
            {ticket.escalated && (
              <span className="text-xs font-bold px-3 py-1 bg-orange-100 text-orange-800 rounded-full border border-orange-200">
                Escalated
              </span>
            )}
            {(currentTicket.proofRejected || currentTicket.rejectionReason) && (
              <span className="text-xs font-bold px-3 py-1 bg-rose-100 text-rose-800 rounded-full border border-rose-200">
                Proof Rejected
              </span>
            )}
            {(() => {
              const rawSla = currentTicket.sla_status || currentTicket.slaStatus || (currentTicket.sla_breached ? 'Breached' : null);
              const normalized = rawSla ? String(rawSla).toLowerCase().replace(/[\s_-]+/g, '') : '';
              if (normalized === 'breached' || normalized === 'violated') {
                return (
                  <span className="inline-flex items-center gap-1 text-xs font-bold px-3 py-1 bg-rose-100 text-rose-800 rounded-full border border-rose-200">
                    <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />
                    <span>SLA Breached</span>
                  </span>
                );
              }
              if (normalized === 'atrisk') {
                return (
                  <span className="inline-flex items-center gap-1 text-xs font-bold px-3 py-1 bg-amber-100 text-amber-800 rounded-full border border-amber-200">
                    <Clock className="w-3 h-3 text-amber-600 shrink-0" />
                    <span>SLA At Risk</span>
                  </span>
                );
              }
              return null;
            })()}
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {ticket.equipment && `${ticket.equipment}`}
          </p>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Description */}
          {ticket.description && (
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-dark mb-1">Description</p>
              <p className="text-sm font-normal text-slate-600 leading-relaxed">{ticket.description}</p>
            </div>
          )}

          {/* Requestor / Date Filed */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-dark mb-0.5">Requestor</p>
              <p className="text-sm font-normal text-slate-600">{ticket.customer || '—'}</p>
              {ticket.facility && (
                <p className="text-xs text-slate-muted mt-0.5">{ticket.facility}</p>
              )}
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-dark mb-0.5">Date Filed</p>
              <p className="text-sm font-normal text-slate-600">{ticket.date ? formatDisplayDate(ticket.date) : '—'}</p>
            </div>
          </div>

          {/* Category / Last Updated */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-dark mb-1">Category</p>
              <p className="text-sm font-normal text-slate-600">{ticket.category || '—'}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-dark mb-0.5">Last Updated</p>
              <p className="text-sm font-normal text-slate-600">{ticket.lastUpdate ?? '—'}</p>
            </div>
          </div>

          {/* SLA Target Resolution */}
          {(currentTicket.resolution_due_at || currentTicket.due_at || currentTicket.sla_due_date || currentTicket.sla?.resolution?.target) && (
            <div className="bg-rose-50/50 border border-rose-100 rounded-xl p-3">
              <p className="text-xs font-bold uppercase tracking-wider text-rose-900 mb-0.5 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-rose-600" />
                <span>SLA Resolution Target</span>
              </p>
              <p className="text-sm font-semibold text-rose-800">
                {formatDisplayDate(currentTicket.resolution_due_at || currentTicket.due_at || currentTicket.sla_due_date || currentTicket.sla?.resolution?.target)}
              </p>
            </div>
          )}

          {/* Customer Service Reminder Prompt Alert */}
          {(currentTicket.last_reminder_sent_at || currentTicket.lastReminderSentAt) && (
            <div className="flex items-start gap-3 bg-indigo-50 border border-indigo-200 rounded-xl p-3.5 text-xs text-indigo-900 shadow-2xs">
              <div className="w-6 h-6 rounded-full bg-indigo-200 text-indigo-800 flex items-center justify-center shrink-0 mt-0.5">
                <Bell className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1">
                <span className="font-bold text-indigo-950 block text-xs">Customer Service Reminder Dispatched</span>
                <p className="text-indigo-800 text-xs mt-0.5 leading-relaxed">
                  A reminder prompt was dispatched on {formatDisplayDate(currentTicket.last_reminder_sent_at || currentTicket.lastReminderSentAt)}. Please review and provide a progress update.
                </p>
              </div>
            </div>
          )}

          {ticket.attachments && ticket.attachments.length > 0 && (
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-[10px] text-gray-400 mb-2">Original Ticket Attachments</p>
              <div className="flex flex-wrap gap-2">
                {ticket.attachments.map((file, idx) => {
                  const fName = typeof file === 'string' ? file.split('/').pop() : (file.name || file.file_name || `Attachment-${idx + 1}`);
                  const fUrl = typeof file === 'string' ? file : (file.url || file.file_path || file.path || '');
                  const isQuarantined = Boolean(
                    typeof file === 'object' && (file?.is_quarantined || file?.quarantined || file?.status === 'quarantined' || file?.virus_detected)
                  );

                  if (isQuarantined) {
                    return (
                      <span
                        key={file.id || file.attachment_id || idx}
                        className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-red-600 cursor-not-allowed"
                        title="File quarantined: Threat detected by antivirus scan"
                      >
                        <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-red-500" />
                        <span className="line-through">{fName}</span>
                        <span className="text-[9px] bg-red-100 text-red-700 px-1 py-0.5 rounded font-bold uppercase">Blocked</span>
                      </span>
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
                      className="flex items-center gap-1.5 bg-white border border-gray-150 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
                    >
                      <svg className="h-3.5 w-3.5 shrink-0 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                      {fName}
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {((ticket.proofAttachments && ticket.proofAttachments.length > 0) || (ticket.proofFiles && ticket.proofFiles.length > 0)) && (
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-[10px] text-gray-400 mb-2">Proof of Completion Documents</p>
              <div className="flex flex-wrap gap-2">
                {(ticket.proofAttachments || ticket.proofFiles).map((file, idx) => {
                  const fName = typeof file === 'string' ? file.split('/').pop() : (file.name || file.file_name || `Proof-${idx + 1}`);
                  const fUrl = typeof file === 'string' ? file : (file.url || file.file_path || file.path || '');
                  const isQuarantined = Boolean(
                    typeof file === 'object' && (file?.is_quarantined || file?.quarantined || file?.status === 'quarantined' || file?.virus_detected)
                  );

                  if (isQuarantined) {
                    return (
                      <span
                        key={file.id || file.proof_ID || idx}
                        className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-red-600 cursor-not-allowed"
                        title="Proof file quarantined: Threat detected by antivirus scan"
                      >
                        <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-red-500" />
                        <span className="line-through">{fName}</span>
                        <span className="text-[9px] bg-red-100 text-red-700 px-1 py-0.5 rounded font-bold uppercase">Blocked</span>
                      </span>
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
                      className="flex items-center gap-1.5 bg-white border border-gray-150 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-green-700 hover:underline cursor-pointer"
                    >
                      <svg className="h-3.5 w-3.5 shrink-0 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      {fName}
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {currentTicket.internalNotes && currentTicket.internalNotes.length > 0 && (
            <InternalNotesSection
              notes={currentTicket.internalNotes}
              readOnly={true}
              maxListHeight="max-h-36"
            />
          )}

          <ReassignmentDisapprovalBanner
            ticket={currentTicket}
            onRequestReassignAgain={() => setShowReassignModal(true)}
          />

          {(currentTicket.proofRejected || currentTicket.rejectionReason) && (
            <div className="flex items-start gap-3 bg-rose-50 border border-rose-200 rounded-xl p-3.5 text-xs text-rose-800">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse mt-1 shrink-0" />
              <div className="space-y-1">
                <span className="font-bold text-rose-900 block text-xs uppercase tracking-wide">
                  Proof of Completion Rejected by Customer Service
                </span>
                <p className="text-xs text-rose-800 font-medium leading-relaxed">
                  {currentTicket.rejectionReason
                    ? `Reason: "${currentTicket.rejectionReason}"`
                    : 'Please review and re-upload your proof of completion.'}
                </p>
              </div>
            </div>
          )}

          {currentTicket.reassignmentRequested && !isReassignmentDenied(currentTicket) && (
            <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping shrink-0" />
              <div>
                <span className="font-bold">Reassignment Request Pending</span>
                {currentTicket.reassignmentReason && `: "${currentTicket.reassignmentReason}"`}
              </div>
            </div>
          )}

          {/* Customer Satisfaction Feedback */}
          {(currentTicket.status === 'Resolved' || currentTicket.status === 'Closed' || hasFeedbackBeenSubmitted(currentTicket.id || currentTicket.ticket_ID)) && (
            <div className="pt-2">
              <TicketFeedbackSection ticket={currentTicket} readOnly={true} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-150 flex-shrink-0 flex justify-end gap-3">
          {isReassignmentDenied(currentTicket) && (
            <button
              type="button"
              onClick={() => setShowReassignModal(true)}
              className="px-5 py-2.5 border border-red-200 text-red-700 hover:bg-red-50 text-sm font-semibold rounded-xl transition-all"
            >
              Request Reassignment Again
            </button>
          )}
          <button
            type="button"
            onClick={handleUpdate}
            className="px-7 py-2.5 bg-[#252578] hover:bg-[#1a1a5c] text-white text-sm font-semibold rounded-xl transition-all shadow-md shadow-[#252578]/25"
          >
            Update
          </button>
        </div>
      </div>
      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}
      {showReassignModal && (
        <ReassignmentModal
          ticket={currentTicket}
          onClose={() => setShowReassignModal(false)}
          onReassignSuccess={(ticketId, reason) => {
            setShowReassignModal(false);
            setTicketDetails((prev) => ({
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
            if (typeof onReassignSuccess === 'function') {
              onReassignSuccess(ticketId, reason);
            }
            onClose();
          }}
        />
      )}
    </div>
  );
}
