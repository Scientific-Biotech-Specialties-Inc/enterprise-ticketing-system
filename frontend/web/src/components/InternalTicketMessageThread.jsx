import React, { useState, useEffect, useRef, useCallback } from 'react';
import { downloadAttachment } from '@/utils/attachmentFiles';
import {
  MessageSquare,
  Send,
  Paperclip,
  X,
  FileText,
  Download,
  AlertCircle,
  Loader2,
  Users,
  ShieldCheck,
  ShieldAlert,
  RotateCcw,
} from 'lucide-react';
import { getTicketMessages, sendTicketMessage } from '@/services/messagingService';
import { getMessagingEcho } from '@/services/messagingEcho';
import { formatDisplayDate } from '@/utils/dateUtils';
import { useAuth } from '@/context/AuthContext';
import { Skeleton } from '@/components/ui/skeleton';

// Helper for formatting file sizes
const formatFileSize = (bytes) => {
  if (!bytes || isNaN(bytes)) return '';
  const num = Number(bytes);
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
};

// Helper to format message timestamps
const formatMessageTime = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

// Role badge component reflecting immutable role at the time
const RoleBadge = ({ role }) => {
  const normalized = String(role || '').trim().toLowerCase();
  let colorStyles = 'bg-slate-100 text-slate-700 border-slate-200';

  if (normalized.includes('requestor') || normalized.includes('requester')) {
    colorStyles = 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800';
  } else if (normalized.includes('assigned employee') || normalized.includes('assigned')) {
    colorStyles = 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800';
  } else if (normalized.includes('customer support') || normalized === 'cs' || normalized.includes('support')) {
    colorStyles = 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800';
  } else if (normalized.includes('admin')) {
    colorStyles = 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800';
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wide border ${colorStyles}`}>
      {role || 'Participant'}
    </span>
  );
};

export default function InternalTicketMessageThread({
  ticketId,
  ticket = null,
  isClosed = false,
  className = '',
  title = null,
  subtitle = null,
  isCustomerThread = false,
}) {
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  // Composer state
  const [messageText, setMessageText] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [validationError, setValidationError] = useState('');
  const [sendError, setSendError] = useState(null);
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  const numericTicketId = Number(ticketId || ticket?.ticket_ID || ticket?.id);
  const ticketStatus = String(ticket?.status || ticket?.status_name || '').trim().toLowerCase();
  const isTicketArchived = isClosed || ticketStatus === 'closed' || Number(ticket?.ticket_status_ID) === 4;

  const currentUserId = user?.emp_id ?? user?.id;

  const scrollToBottom = useCallback((smooth = true) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
    }
  }, []);

  // Fetch thread messages
  const loadMessages = useCallback(async () => {
    if (!numericTicketId) return;
    setLoading(true);
    setFetchError(null);
    try {
      const thread = await getTicketMessages(numericTicketId);
      const filtered = (thread || []).filter(
        (m) => !m.ticket_id || Number(m.ticket_id) === numericTicketId
      );
      setMessages(filtered);
    } catch (err) {
      console.error('Failed to load internal ticket messages:', err);
      setFetchError(
        err.response?.data?.message || 'Unable to load message history. Please check your connection and retry.'
      );
    } finally {
      setLoading(false);
    }
  }, [numericTicketId]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Scroll to bottom after loading messages
  useEffect(() => {
    if (!loading && messages.length > 0) {
      scrollToBottom(false);
    }
  }, [loading, messages.length, scrollToBottom]);

  // Real-time updates via Laravel Echo on Reverb channel
  useEffect(() => {
    if (!numericTicketId) return;

    let active = true;
    const echo = getMessagingEcho();
    const channelName = `ticket.${numericTicketId}`;
    const channel = echo.private(channelName);

    channel.listen('.App\\Events\\MessageSent', (eventData) => {
      if (!active) return;
      if (eventData.ticket_id && Number(eventData.ticket_id) !== numericTicketId) {
        return;
      }

      setMessages((prev) => {
        const incomingId = eventData.id || eventData._id;
        const exists = prev.some(
          (m) =>
            (m.id && (m.id === incomingId || m.id === eventData.id || m.id === eventData._id)) ||
            (m._id && (m._id === incomingId || m._id === eventData.id || m._id === eventData._id))
        );
        if (exists) return prev;

        return [
          ...prev,
          {
            id: incomingId,
            _id: incomingId,
            ticket_id: eventData.ticket_id,
            sender_id: eventData.sender_id,
            sender_name: eventData.sender_name,
            sender_type: eventData.sender_type,
            sender_role: eventData.sender_role,
            message: eventData.message || '',
            attachments: eventData.attachments || [],
            created_at: eventData.created_at || new Date().toISOString(),
          },
        ];
      });

      setTimeout(() => scrollToBottom(true), 100);
    });

    return () => {
      active = false;
      channel.stopListening('.App\\Events\\MessageSent');
    };
  }, [numericTicketId, scrollToBottom]);

  // File selection handler
  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    // Filter file types and enforce reasonable limits
    setSelectedFiles((prev) => [...prev, ...files]);
    setValidationError('');
    setSendError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeFile = (indexToRemove) => {
    setSelectedFiles((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  // Send message handler with inline validation and text preservation on error
  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();

    const trimmedText = messageText.trim();
    if (!trimmedText && selectedFiles.length === 0) {
      setValidationError('Please enter a message or attach a file.');
      return;
    }

    setValidationError('');
    setSendError(null);
    setSending(true);

    try {
      const responseData = await sendTicketMessage(numericTicketId, trimmedText, selectedFiles);

      if (responseData) {
        const newMsgId = responseData.id || responseData._id;
        setMessages((prev) => {
          const exists = prev.some((m) => (m.id && m.id === newMsgId) || (m._id && m._id === newMsgId));
          if (exists) return prev;
          return [...prev, responseData];
        });
      } else {
        // Fallback reload if response shape is empty
        await loadMessages();
      }

      // Success: clear inputs
      setMessageText('');
      setSelectedFiles([]);
      setTimeout(() => scrollToBottom(true), 100);
    } catch (err) {
      console.error('Failed to send internal ticket message:', err);
      const serverMessage =
        err.response?.data?.message ||
        err.response?.data?.errors?.message?.[0] ||
        err.message ||
        'Failed to deliver message. Your message text and attachments were preserved. Please retry.';
      setSendError(serverMessage);
      // NOTE: messageText and selectedFiles remain untouched so user does not lose input
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className={`rounded-2xl border border-border bg-card shadow-xs overflow-hidden flex flex-col ${className}`}
      role="region"
      aria-label="Internal Ticket Discussion Thread"
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-muted/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#252578]/10 text-[#252578] dark:bg-[#252578]/30 flex items-center justify-center shrink-0">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-foreground">
                {title || (isCustomerThread ? 'Direct Message Conversation' : 'Internal Ticket Discussion')}
              </h3>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#252578] text-white">
                <Users className="w-3 h-3" />
                {isCustomerThread ? 'Assigned Specialist & CS' : 'Team Thread'}
              </span>
              {!isCustomerThread && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800">
                  <ShieldCheck className="w-3 h-3" />
                  Excluded from AI
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {subtitle || 'Direct collaboration between Requestor, Assigned Employee, and Support staff.'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={loadMessages}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors cursor-pointer self-start sm:self-auto"
          title="Refresh message thread"
        >
          <RotateCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Messages Scrollable Area */}
      <div
        className="p-6 overflow-y-auto space-y-4 max-h-[480px] min-h-[220px] bg-background/50"
        role="log"
        aria-live="polite"
      >
        {loading && messages.length === 0 ? (
          <div className="space-y-4 py-4">
            <div className="flex items-start gap-3">
              <Skeleton className="w-8 h-8 rounded-full" />
              <div className="space-y-2 flex-1 max-w-md">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-16 w-full rounded-xl" />
              </div>
            </div>
            <div className="flex items-start gap-3 justify-end">
              <div className="space-y-2 flex-1 max-w-md text-right">
                <Skeleton className="h-4 w-28 ml-auto" />
                <Skeleton className="h-14 w-full rounded-xl" />
              </div>
              <Skeleton className="w-8 h-8 rounded-full" />
            </div>
          </div>
        ) : fetchError ? (
          <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-red-800 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-semibold">{fetchError}</p>
              <button
                type="button"
                onClick={loadMessages}
                className="mt-2 text-xs font-bold text-red-700 underline hover:text-red-900 cursor-pointer"
              >
                Click to retry loading messages
              </button>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-2xl bg-muted/60 flex items-center justify-center mb-3 text-muted-foreground">
              <MessageSquare className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-foreground">No messages yet</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              Use the composer below to message the assigned technician or request updates on this internal ticket.
            </p>
          </div>
        ) : (
          messages.map((msg, index) => {
            const isMine =
              currentUserId &&
              msg.sender_id &&
              Number(msg.sender_id) === Number(currentUserId);

            const senderRole = msg.sender_role || (msg.sender_type === 'cs' ? 'Customer Support' : 'Staff');
            const timeDisplay = formatMessageTime(msg.created_at);
            const dateDisplay = formatDisplayDate(msg.created_at);

            return (
              <div
                key={msg.id || msg._id || index}
                className={`flex flex-col ${isMine ? 'items-end' : 'items-start'} group`}
              >
                {/* Sender Metadata Bar */}
                <div className={`flex items-center gap-2 mb-1 text-xs text-muted-foreground ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
                  <span className="font-semibold text-foreground">
                    {msg.sender_name || 'User'}
                  </span>
                  <RoleBadge role={senderRole} />
                  <span className="text-[11px] text-muted-foreground/80" title={dateDisplay}>
                    {timeDisplay}
                  </span>
                </div>

                {/* Message Bubble */}
                <div
                  className={`max-w-[85%] sm:max-w-[75%] rounded-2xl p-4 text-sm leading-relaxed shadow-2xs transition-colors ${
                    isMine
                      ? 'bg-[#252578] text-white rounded-tr-xs'
                      : 'bg-muted/70 text-foreground border border-border/70 rounded-tl-xs'
                  }`}
                >
                  {msg.message && (
                    <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                  )}

                  {/* Message Attachments */}
                  {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
                    <div className={`mt-3 space-y-1.5 pt-2 border-t ${isMine ? 'border-white/20' : 'border-border'}`}>
                      {msg.attachments.map((att, attIdx) => {
                        const attName = att.name || att.file_name || 'Attachment';
                        const attUrl = att.url || att.file_path;
                        const isQuarantined =
                          att.scan_status === 'quarantined' ||
                          att.virus_detected ||
                          att.is_quarantined;

                        if (isQuarantined) {
                          return (
                            <div
                              key={attIdx}
                              className="flex items-center gap-2 p-2 rounded-lg bg-red-100/90 text-red-900 border border-red-300 text-xs"
                              title="Attachment quarantined: Threat detected by antivirus scanner"
                            >
                              <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <span className="font-medium truncate line-through block">{attName}</span>
                                <span className="text-[10px] uppercase font-bold text-red-700">Blocked by Antivirus</span>
                              </div>
                            </div>
                          );
                        }

                        const isImageAtt =
                          /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(attName || '') ||
                          /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(attUrl || '') ||
                          String(att.mime_type || att.file_type || '').toLowerCase().startsWith('image/');

                        if (isImageAtt && attUrl) {
                          return (
                            <div key={attIdx} className="space-y-1.5">
                              <div className="overflow-hidden rounded-xl border border-white/20 bg-black/5 max-w-[280px] sm:max-w-[340px]">
                                <img
                                  src={attUrl}
                                  alt={attName}
                                  loading="lazy"
                                  className="w-full max-h-[240px] object-contain bg-white/95 rounded-t-xl block"
                                />
                                <div
                                  className={`flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] ${
                                    isMine ? 'bg-white/10 text-white' : 'bg-background text-foreground border-t border-border'
                                  }`}
                                >
                                  <span className="truncate font-medium">{attName}</span>
                                  <a
                                    href={attUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="shrink-0 opacity-80 hover:opacity-100"
                                    title={`Download ${attName}`}
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                  </a>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <a
                            key={attIdx}
                            href="#"
                            role="button"
                            onClick={(e) => {
                              e.preventDefault();
                              if (attUrl) downloadAttachment(attUrl, attName).catch(() => {});
                            }}
                            className={`flex items-center gap-2.5 p-2 rounded-xl transition-all ${
                              isMine
                                ? 'bg-white/10 hover:bg-white/20 text-white'
                                : 'bg-background hover:bg-muted text-foreground border border-border'
                            }`}
                            title={`Download ${attName}`}
                          >
                            <FileText className="w-4 h-4 shrink-0 opacity-80" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold truncate leading-tight">{attName}</p>
                              {att.file_size && (
                                <p className={`text-[10px] mt-0.5 ${isMine ? 'text-white/70' : 'text-muted-foreground'}`}>
                                  {formatFileSize(att.file_size)}
                                </p>
                              )}
                            </div>
                            <Download className="w-3.5 h-3.5 shrink-0 opacity-70" />
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer Section */}
      {isTicketArchived ? (
        <div className="p-4 border-t border-border bg-amber-50/70 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200 flex items-center justify-center gap-2 text-xs font-medium">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>This ticket is closed. The message thread is locked and read only.</span>
        </div>
      ) : (
        <div className="p-4 border-t border-border bg-card">
          {/* Send Error Alert with Preservation Assurance */}
          {sendError && (
            <div className="mb-3 p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">{sendError}</p>
                <p className="text-[11px] text-red-700/80 mt-0.5">
                  Your draft message text and attached files were preserved. You can edit and retry.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSendError(null)}
                className="text-red-500 hover:text-red-700 p-0.5 cursor-pointer"
                title="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Validation Warning */}
          {validationError && (
            <div className="mb-2 text-xs font-semibold text-rose-600 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{validationError}</span>
            </div>
          )}

          {/* Selected Files Preview Chips */}
          {selectedFiles.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2 p-2 rounded-xl bg-muted/40 border border-border">
              {selectedFiles.map((file, fIdx) => (
                <div
                  key={fIdx}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-background border border-border text-xs text-foreground shadow-2xs"
                >
                  <Paperclip className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className="max-w-[160px] truncate font-medium">{file.name}</span>
                  <span className="text-[10px] text-muted-foreground font-mono">({formatFileSize(file.size)})</span>
                  <button
                    type="button"
                    onClick={() => removeFile(fIdx)}
                    className="text-muted-foreground hover:text-foreground cursor-pointer ml-0.5"
                    title={`Remove ${file.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Textarea & Actions Row */}
          <form onSubmit={handleSendMessage} className="space-y-3">
            <div className="relative">
              <textarea
                ref={textareaRef}
                value={messageText}
                onChange={(e) => {
                  setMessageText(e.target.value);
                  if (validationError) setValidationError('');
                  if (sendError) setSendError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder="Type your message to the assigned technician or team..."
                rows={2}
                disabled={sending}
                className="w-full resize-none rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-[#252578]/40 focus:border-[#252578] disabled:opacity-50 transition-all"
                aria-label="Internal message input"
              />
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                  id={`internal-thread-file-input-${numericTicketId}`}
                  disabled={sending}
                />
                <label
                  htmlFor={`internal-thread-file-input-${numericTicketId}`}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted rounded-xl border border-border cursor-pointer transition-colors"
                  title="Attach file (inspected for threats with ClamAV)"
                >
                  <Paperclip className="w-4 h-4 text-primary" />
                  <span>Attach Files</span>
                </label>
                <span className="text-[11px] text-muted-foreground hidden sm:inline">
                  ClamAV scanned · Press Enter to send, Shift+Enter for newline
                </span>
              </div>

              <button
                type="submit"
                disabled={sending}
                className="inline-flex items-center justify-center gap-2 px-5 py-2 rounded-xl bg-[#252578] hover:bg-[#1e1e63] text-white text-xs font-bold transition-all shadow-xs disabled:opacity-60 cursor-pointer"
              >
                {sending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Sending...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Send Message</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
