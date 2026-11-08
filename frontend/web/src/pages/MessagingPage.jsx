import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { downloadAttachment } from '@/utils/attachmentFiles';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { MessageCircle, Send, Users, User, AlertCircle, MoreVertical, Edit2, Trash2, Archive, RotateCcw, X, Info, History, Sparkles, Bot, Clock, Paperclip, FileText, Download, ShieldAlert, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import {
  getTicketMessages,
  sendTicketMessage,
  editTicketMessage,
  getMessageEditHistory,
  deleteTicketMessage,
  pingThreadPresence,
  clearThreadPresence,
} from '@/services/messagingService';
import { getMessagingEcho } from '@/services/messagingEcho';
import useRealtimeRefresh from '@/hooks/useRealtimeRefresh';
import {
  getCustomerTickets,
  getCSIncomingTickets,
  getEmployeeInternalTickets,
  getEmployeeAssignedTickets,
  getTicketDetails,
  updateTicket,
} from '@/services/ticketService';
import { getMessagingConfiguration } from '@/services/configurationService';
import axiosInstance from '@/api/axiosInstance';
import { AI_API_URL } from '@/config/api.config';
import { formatDisplayDate } from '@/utils/dateUtils';
import { isMessageArchivalOnClosureEnabled } from '@/data/messageArchivalConfig';

// ─── Badge Styling Helpers ──────────────────────────────────────────────────
const statusBadges = {
  'Open': 'bg-blue-50 text-blue-700 border-blue-100',
  'In Progress': 'bg-amber-50 text-amber-700 border-amber-100',
  'Resolved': 'bg-green-50 text-green-700 border-green-100',
  'Closed': 'bg-gray-50 text-gray-700 border-gray-100',
  'Reopened': 'bg-purple-50 text-purple-700 border-purple-100',
  'Pending Assignment': 'bg-indigo-50 text-indigo-700 border-indigo-100',
  'Pending': 'bg-amber-50 text-amber-700 border-amber-100',
};

const priorityBadges = {
  'Low': 'bg-gray-50 text-gray-600 border-gray-200',
  'Medium': 'bg-blue-50 text-blue-600 border-blue-200',
  'High': 'bg-orange-50 text-orange-600 border-orange-200',
  'Critical': 'bg-red-50 text-red-600 border-red-200',
};

// ─── Helpers ──────────────────────────────────────────────────────────────

const formatTime = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  if (isToday) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (isYesterday) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const checkIsCS = (user) => {
  if (!user) return false;
  const dept = (user.department || user.profile?.department?.name || '').toLowerCase();
  const role = (user.role || user.profile?.role?.name || '').toLowerCase();
  if (dept.includes('customer service') || dept.includes('customer support') || dept === 'cs') return true;
  return (
    role.includes('customer service') ||
    role.includes('customer-service') ||
    role.includes('head of cs') ||
    role.includes('head of customer service') ||
    role === 'cs' ||
    role === 'head cs'
  );
};

const checkIsEmployee = (user) => {
  if (!user) return false;
  if (checkIsCS(user)) return false;
  const dept = (user.department || user.profile?.department?.name || '').toLowerCase();
  const role = (user.role || user.profile?.role?.name || '').toLowerCase();
  if (dept === 'service' || dept.includes('engineer')) return true;
  return role === 'employee' || role.includes('service') || role.includes('engineer');
};

// ─── Avatar Component ─────────────────────────────────────────────────────

function Avatar({ name, size = 'md' }) {
  const sizeClasses = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm';
  const rawStr = typeof name === 'string' ? name : (name?.name || (name ? String(name) : 'User'));
  const initials = rawStr.split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'U';
  return (
    <div className={`${sizeClasses} rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold shrink-0`}>
      {initials}
    </div>
  );
}

// ─── Main Messaging Page ──────────────────────────────────────────────────

export default function MessagingPage() {
  const { user } = useAuth();

  const isCS = checkIsCS(user);
  const isEmployee = checkIsEmployee(user);
  const isCustomer = !isCS && !isEmployee;

  const userType = isCS ? 'cs' : (isEmployee ? 'employee' : 'customer');
  const userId = isCustomer ? (user?.id ?? user?.client_ID ?? user?.client_id) : (user?.emp_id ?? user?.id);
  const currentUserKey = `${userType}:${userId}`;

  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editInputText, setEditInputText] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(null);
  const [activeHistoryMsgId, setActiveHistoryMsgId] = useState(null);
  const [historyModalData, setHistoryModalData] = useState(null);
  const [msgHistoryLoading, setMsgHistoryLoading] = useState(false);
  const [activeMenuMsgId, setActiveMenuMsgId] = useState(null);

  const location = useLocation();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const initialTicketId = location.state?.selectedTicketId || searchParams.get('selectedTicketId') || searchParams.get('ticketId');
  const [showDetailsSidebar, setShowDetailsSidebar] = useState(true);

  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedContactId, setSelectedContactId] = useState(null);
  const [csFilter, setCsFilter] = useState('external');
  const [conversationTab, setConversationTab] = useState('active'); // 'active' | 'archived'
  const [reopening, setReopening] = useState(false);

  // Live presence heartbeat for currently active ticket thread (suppresses in-app notification alerts for viewer)
  useEffect(() => {
    if (!selectedContactId) return undefined;
    const numericTargetId = Number(String(selectedContactId).replace(/\D/g, ''));
    if (!numericTargetId) return undefined;

    pingThreadPresence(numericTargetId);

    const interval = setInterval(() => {
      pingThreadPresence(numericTargetId);
    }, 15000);

    return () => {
      clearInterval(interval);
      clearThreadPresence(numericTargetId);
    };
  }, [selectedContactId]);

  // TS067: Message archival gate from Super Admin config
  // TEMPORARY: localStorage is used here only as a same-session demo bridge between
  // Super Admin and Customer/Employee/CS portals for this sprint's frontend-only scope.
  // This must be replaced with a real backend-persisted setting, read by all portals
  // via API, before this is production-ready — localStorage does not sync across
  // different users/devices/browsers.
  const [archiveOnClosureEnabled, setArchiveOnClosureEnabled] = useState(() => isMessageArchivalOnClosureEnabled());

  useEffect(() => {
    const handleToggleChanged = (e) => {
      if (e?.detail?.enabled !== undefined) {
        setArchiveOnClosureEnabled(Boolean(e.detail.enabled));
      } else {
        setArchiveOnClosureEnabled(isMessageArchivalOnClosureEnabled());
      }
    };
    window.addEventListener('message_archival_toggle_changed', handleToggleChanged);
    window.addEventListener('storage', handleToggleChanged);
    return () => {
      window.removeEventListener('message_archival_toggle_changed', handleToggleChanged);
      window.removeEventListener('storage', handleToggleChanged);
    };
  }, []);

  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadError, setUploadError] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const fileInputRef = useRef(null);
  const [lastMessageIdOnLoad, setLastMessageIdOnLoad] = useState(null);
  const [sidebarTab, setSidebarTab] = useState('info'); // 'info' | 'history' | 'ai'
  const [ticketHistory, setTicketHistory] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [aiConversations, setAiConversations] = useState([]);
  const [selectedAiConvId, setSelectedAiConvId] = useState(null);
  const [activeAiMessages, setActiveAiMessages] = useState([]);
  const [aiLoading, setAiLoading] = useState(false);

  const messagesEndRef = useRef(null);

  const currentTicketMessages = useMemo(() => {
    if (!selectedContactId) return [];
    const numericTargetId = Number(String(selectedContactId).replace(/\D/g, ''));
    return messages.filter(m => !m.ticket_id || Number(m.ticket_id) === numericTargetId);
  }, [messages, selectedContactId]);

  const lastLoadIndex = useMemo(() => {
    if (!lastMessageIdOnLoad) return -1;
    return currentTicketMessages.findIndex(m => (m.id === lastMessageIdOnLoad || m._id === lastMessageIdOnLoad));
  }, [currentTicketMessages, lastMessageIdOnLoad]);

  const firstNewMessageIndex = useMemo(() => {
    if (lastLoadIndex === -1) return -1;
    for (let i = lastLoadIndex + 1; i < currentTicketMessages.length; i++) {
      const msg = currentTicketMessages[i];
      const isMine = (msg.sender_type === userType && Number(msg.sender_id) === Number(userId)) ||
                     (msg.sender_type === 'cs' && userType === 'cs');
      if (!isMine) {
        return i;
      }
    }
    return -1;
  }, [currentTicketMessages, lastLoadIndex, userType, userId]);

  // Bumped by the ticket Reverb server so newly created/assigned tickets appear without a manual refresh.
  const [ticketRefreshTick, setTicketRefreshTick] = useState(0);
  const hasLoadedTicketsRef = useRef(false);
  const handleTicketRealtime = useCallback(() => setTicketRefreshTick((n) => n + 1), []);
  const realtimeChannels = useMemo(() => [{ name: 'ticket-updates', event: 'ticket.changed' }], []);
  useRealtimeRefresh({ refresh: handleTicketRealtime, channels: realtimeChannels, intervalMs: 30000 });

  // 1. Fetch tickets for chat list
  useEffect(() => {
    let active = true;
    async function loadTickets() {
      const isBackgroundRefresh = hasLoadedTicketsRef.current;
      try {
        if (!isBackgroundRefresh) setLoading(true);
        let list = [];
        if (isCS) {
          const res = await getCSIncomingTickets({ limit: 100, forceRefresh: true });
          list = Array.isArray(res) ? res : (res?.tickets || res?.list || []);
        } else if (isEmployee) {
          let internalList = [];
          try {
            const res = await getEmployeeInternalTickets();
            internalList = res?.tickets || [];
          } catch (e) {
            console.warn('Failed loading employee internal tickets', e);
          }

          let assignedList = [];
          try {
            const msgConfig = await getMessagingConfiguration().catch(() => null);
            const allowDelegated = Boolean(msgConfig?.allow_delegated_employee ?? true);
            if (allowDelegated) {
              const assigned = await getEmployeeAssignedTickets({ employeeEmail: user?.email, forceRefresh: true }).catch(() => []);
              assignedList = Array.isArray(assigned) ? assigned : (assigned?.tickets || []);
            }
          } catch (e) {
            console.warn('Failed loading assigned tickets for employee messaging', e);
          }

          const seen = new Set();
          const merged = [];
          for (const item of [...assignedList, ...internalList]) {
            const tid = item.ticket_ID || item.id;
            if (tid && !seen.has(tid)) {
              seen.add(tid);
              merged.push(item);
            }
          }
          list = merged;
        } else {
          const res = await getCustomerTickets({ createdBy: user?.id, limit: 100, forceRefresh: true });
          list = Array.isArray(res) ? res : (res?.tickets || res?.list || []);
        }

        // Deduplicate tickets by unique ticket ID to prevent duplicate React keys
        const seen = new Set();
        const dedupedList = [];
        for (const item of list) {
          const tid = item.ticket_ID || item.id;
          if (tid && !seen.has(tid)) {
            seen.add(tid);
            dedupedList.push(item);
          }
        }
        list = dedupedList;

        if (active) {
          setTickets(list);

          // Auto-select if initialTicketId is in the list
          if (initialTicketId && !isBackgroundRefresh) {
            const numericId = Number(initialTicketId);
            const found = list.find(t => {
              const ticketId = t.ticket_ID || t.id;
              const numericTicketId = Number(String(ticketId).replace(/\D/g, ''));
              return numericTicketId === numericId || String(ticketId) === String(initialTicketId);
            });
            if (found) {
              const selectedId = found.ticket_ID || found.id;
              setSelectedContactId(selectedId);
              // Clear location state so it doesn't keep resetting selection on refresh
              window.history.replaceState({}, document.title);
            } else if (numericId) {
              try {
                const singleTicket = await getTicketDetails(numericId).catch(() => null);
                if (singleTicket && active) {
                  const sId = singleTicket.ticket_ID || singleTicket.id;
                  setTickets(prev => [singleTicket, ...prev.filter(t => (t.ticket_ID || t.id) !== sId)]);
                  setSelectedContactId(sId);
                  window.history.replaceState({}, document.title);
                }
              } catch (e) {
                console.warn('Could not load specific ticket for messaging deep link', e);
              }
            }
          }
        }
      } catch (err) {
        console.error("Failed to load tickets for messaging page", err);
      } finally {
        if (active) {
          hasLoadedTicketsRef.current = true;
          setLoading(false);
        }
      }
    }
    loadTickets();
    return () => { active = false; };
  }, [isCS, isEmployee, user, initialTicketId, ticketRefreshTick]);

  // 2. Map tickets to formatted contacts & calculate archive state
  const contacts = useMemo(() => {
    return tickets.map(t => {
      const ticketId = t.ticket_ID || t.id;
      let contactName = '';
      let contactRole = '';
      let type = 'external';

      const rawCustomer = typeof t.customer === 'string' ? t.customer : (t.customer?.name || t.client?.client_name || t.client_name || t.created_by_name || null);
      if (isCS) {
        contactName = rawCustomer || 'Client';
        contactRole = t.is_internal ? 'Employee' : 'Customer';
        type = t.is_internal ? 'internal' : 'external';
      } else if (isEmployee) {
        const isDelegatedToMe = !t.is_internal || (t.requested_by != user?.emp_id && t.requested_by != user?.id);
        if (isDelegatedToMe) {
          contactName = rawCustomer || 'Customer & Support';
          contactRole = t.is_internal ? 'Internal Ticket' : 'Customer & Support';
          type = t.is_internal ? 'internal' : 'external';
        } else {
          contactName = 'Customer Support';
          contactRole = 'Representative';
          type = 'internal';
        }
      } else {
        contactName = 'Customer Support';
        contactRole = 'Representative';
        type = 'external';
      }

      const statusName = t.status || t.status_name || 'Open';
      const statusNormalized = String(statusName).trim().toLowerCase();
      const isClosed = statusNormalized === 'closed' || Number(t.ticket_status_ID || t.status_id) === 4;

      // Closed tickets route directly to the Archive tab
      const isArchived = isClosed;
      const ticketTitle = t.title || t.subject || `Ticket #${ticketId}`;

      return {
        id: ticketId,
        ticket_ID: t.ticket_ID || Number(String(ticketId).replace(/\D/g, '')),
        // Same ticket number the rest of the app shows; fall back to the padded id only if the API omits it.
        ticketNumber: t.ticket_number || t.ticketNumber || (typeof ticketId === 'string' && !/^\d+$/.test(ticketId) ? ticketId : null),
        created_by: t.created_by || t.client_id || t.user_id || (isCS ? null : user?.id),
        name: `${contactName} (${ticketTitle})`,
        displayTitle: ticketTitle,
        subtitle: contactName,
        role: contactRole,
        type,
        status: statusName,
        isClosed,
        isArchived,
        is_internal: Boolean(t.is_internal || t.ticket_type === 'Internal' || type === 'internal'),
        requested_by: t.requested_by,
        description: t.description || 'No description provided.',
        category: t.category || t.category_name || 'General',
        equipment: t.equipment || (t.machine_name ? `${t.machine_name} - ${t.serial_number}` : 'Unspecified equipment'),
        date: t.date_created || t.created_at || t.date || '',
        priority: t.priority || t.priority_name || 'Low',
      };
    });
  }, [tickets, isCS, isEmployee, archiveOnClosureEnabled, user?.id]);

  // 3. Separate Active and Archived contact lists
  const activeContacts = useMemo(() => {
    let list = contacts.filter(c => !c.isArchived);
    if (isCS) list = list.filter(c => c.type === csFilter);
    return list;
  }, [contacts, isCS, csFilter]);

  const archivedContacts = useMemo(() => {
    let list = contacts.filter(c => c.isArchived);
    if (isCS) list = list.filter(c => c.type === csFilter);
    return list;
  }, [contacts, isCS, csFilter]);

  const displayedContacts = useMemo(() => {
    return conversationTab === 'active' ? activeContacts : archivedContacts;
  }, [conversationTab, activeContacts, archivedContacts]);

  // Auto select contact if current selection is invalid for active tab
  useEffect(() => {
    if (displayedContacts.length > 0) {
      if (!selectedContactId || !displayedContacts.some(c => c.id === selectedContactId)) {
        setSelectedContactId(displayedContacts[0].id);
      }
    } else {
      setSelectedContactId(null);
    }
  }, [displayedContacts, selectedContactId]);

  const selectedContact = useMemo(() => contacts.find(c => c.id === selectedContactId), [contacts, selectedContactId]);

  // 4. Fetch messages and bind WebSockets on selection
  useEffect(() => {
    if (!selectedContactId) return;

    let active = true;
    setMessagesLoading(true);
    setMessages([]);
    setLastMessageIdOnLoad(null);

    const numericTargetId = Number(String(selectedContactId).replace(/\D/g, ''));

    getTicketMessages(selectedContactId)
      .then(msgs => {
        if (active) {
          const filtered = (msgs || []).filter(m => !m.ticket_id || Number(m.ticket_id) === numericTargetId);
          setMessages(filtered);
          setMessagesLoading(false);
          if (filtered.length > 0) {
            const lastMsg = filtered[filtered.length - 1];
            setLastMessageIdOnLoad(lastMsg.id || lastMsg._id);
          } else {
            setLastMessageIdOnLoad(null);
          }
        }
      })
      .catch(err => {
        console.error("Failed to load messages", err);
        if (active) setMessagesLoading(false);
      });

    // Use the singleton Echo instance
    const echo = getMessagingEcho();
    const channelName = `ticket.${selectedContactId}`;
    const channel = echo.private(channelName);

    channel.listen('.App\\Events\\MessageSent', (e) => {
      if (active) {
        if (e.ticket_id && Number(e.ticket_id) !== numericTargetId) {
          return;
        }
        setMessages(prev => {
          const msgId = e.id || e._id;
          if (prev.some(m => (m.id && (m.id === msgId || m.id === e.id || m.id === e._id)) || (m._id && (m._id === msgId || m._id === e.id || m._id === e._id)))) {
            return prev;
          }
          return [...prev, {
            id: msgId,
            _id: msgId,
            ticket_id: e.ticket_id,
            sender_id: e.sender_id,
            sender_name: e.sender_name,
            sender_type: e.sender_type,
            sender_role: e.sender_role,
            message: e.message || '',
            attachments: e.attachments || [],
            created_at: e.created_at,
          }];
        });
      }
    });

    channel.listen('.App\\Events\\MessageUpdated', (e) => {
      if (active) {
        setMessages(prev => {
          return prev.map(m => {
            if (m.id === e.id || m._id === e.id) {
              return {
                ...m,
                message: e.message,
                edit_history: e.edit_history,
                is_edited: e.is_edited ?? true,
                edited: e.edited ?? true,
                edited_at: e.edited_at,
                updated_at: e.updated_at,
              };
            }
            return m;
          });
        });
      }
    });

    channel.listen('.App\\Events\\MessageDeleted', (e) => {
      if (active) {
        if (e.user_key === currentUserKey) {
          setMessages(prev => prev.filter(m => m.id !== e.id && m._id !== e.id));
        }
      }
    });

    return () => {
      active = false;
      echo.leave(channelName);
    };
  }, [selectedContactId, currentUserKey]);

  // Load ticket history for details sidebar
  useEffect(() => {
    if (!selectedContactId || !showDetailsSidebar) return;
    if (sidebarTab !== 'history') return;

    let active = true;
    setHistoryLoading(true);
    const numericId = Number(String(selectedContactId).replace(/\D/g, ''));

    getTicketDetails(numericId)
      .then((data) => {
        if (active) {
          setTicketHistory(data?.timeline || []);
          setHistoryLoading(false);
        }
      })
      .catch((err) => {
        console.warn('Failed to load ticket history in messaging page:', err);
        if (active) {
          setTicketHistory([]);
          setHistoryLoading(false);
        }
      });

    return () => { active = false; };
  }, [selectedContactId, showDetailsSidebar, sidebarTab]);

  // Load AI conversations list
  useEffect(() => {
    if (!selectedContactId || !showDetailsSidebar) return;
    if (sidebarTab !== 'ai') return;

    let active = true;
    setAiLoading(true);

    const targetUserId = selectedContact?.created_by || (isCS ? null : user?.id);

    axiosInstance
      .get(`${AI_API_URL}/conversations`, {
        baseURL: '',
        params: targetUserId ? { user_id: targetUserId } : {},
      })
      .then((res) => {
        if (active && res.data?.success && Array.isArray(res.data.conversations)) {
          const convList = res.data.conversations;
          setAiConversations(convList);
          if (convList.length > 0) {
            const numericTicketId = Number(String(selectedContactId).replace(/\D/g, ''));
            // Prefer the exact conversation linked to this ticket; fall back to a title match only.
            const matched = convList.find(c => Number(c.escalation_data?.ticket_id) === numericTicketId)
              || convList.find(c =>
                c.title && selectedContact?.displayTitle &&
                (c.title.toLowerCase().includes(selectedContact.displayTitle.toLowerCase()) ||
                 selectedContact.displayTitle.toLowerCase().includes(c.title.toLowerCase()))
              )
              // The list is already scoped to this ticket's customer, so their latest chat is the best remaining guess
              // (tickets created before the ticket link existed have no stored id and an unrelated title).
              || convList[0];
            setSelectedAiConvId(matched.id);
          } else {
            setSelectedAiConvId(null);
            setActiveAiMessages([]);
            setAiLoading(false);
          }
        } else if (active) {
          setAiConversations([]);
          setSelectedAiConvId(null);
          setActiveAiMessages([]);
          setAiLoading(false);
        }
      })
      .catch((err) => {
        console.warn('Failed to load AI conversations:', err);
        if (active) {
          setAiConversations([]);
          setSelectedAiConvId(null);
          setActiveAiMessages([]);
          setAiLoading(false);
        }
      });

    return () => { active = false; };
  }, [selectedContactId, showDetailsSidebar, sidebarTab, selectedContact?.created_by, selectedContact?.displayTitle, isCS, user?.id]);

  // Load selected AI conversation messages
  useEffect(() => {
    if (!selectedAiConvId || sidebarTab !== 'ai') return;

    let active = true;
    setAiLoading(true);

    axiosInstance
      .get(`${AI_API_URL}/conversations/${selectedAiConvId}`, { baseURL: '' })
      .then((res) => {
        if (active && res.data?.success && res.data.conversation) {
          const msgs = res.data.conversation.messages || [];
          setActiveAiMessages(msgs);
        } else if (active) {
          setActiveAiMessages([]);
        }
      })
      .catch((err) => {
        console.warn('Failed to load AI conversation details:', err);
        if (active) setActiveAiMessages([]);
      })
      .finally(() => {
        if (active) setAiLoading(false);
      });

    return () => { active = false; };
  }, [selectedAiConvId, sidebarTab]);

  // 5. Listen to ticket status/updates channel globally for real-time archive/restore shifts
  useEffect(() => {
    let active = true;
    const echo = getMessagingEcho();
    const updatesChannel = echo.channel('ticket-updates');

    const handleTicketChanged = (e) => {
      if (!active) return;
      const changedTicketId = e.ticket_ID || e.ticketId || e.id;
      if (!changedTicketId) return;

      setTickets(prev => {
        return prev.map(t => {
          const tId = t.ticket_ID || t.id;
          const match = Number(String(tId).replace(/\D/g, '')) === Number(changedTicketId) ||
                        String(tId) === String(changedTicketId);
          if (match) {
            const rawTicket = e.ticket || {};
            const updatedStatus = rawTicket.status_name || rawTicket.status || t.status || t.status_name;
            const updatedPriority = rawTicket.priority_name || rawTicket.priority || t.priority || t.priority_name;
            const updatedDescription = rawTicket.description || t.description;
            const updatedCategory = rawTicket.category_name || rawTicket.category || t.category;
            const updatedEquipment = rawTicket.machine_name 
              ? `${rawTicket.machine_name} - ${rawTicket.serial_number}`
              : (rawTicket.equipment || t.equipment);

            return {
              ...t,
              status: updatedStatus,
              status_name: updatedStatus,
              priority: updatedPriority,
              priority_name: updatedPriority,
              description: updatedDescription,
              category: updatedCategory,
              equipment: updatedEquipment,
              assigned_to: rawTicket.assigned_to !== undefined ? rawTicket.assigned_to : t.assigned_to,
            };
          }
          return t;
        });
      });
    };

    updatesChannel.listen('.ticket.changed', handleTicketChanged);

    return () => {
      active = false;
      updatesChannel.stopListening('.ticket.changed', handleTicketChanged);
    };
  }, []);

  // 6. Scroll to bottom of message logs
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages.length, selectedContactId]);

  const handleSelectContact = useCallback((contactId) => {
    setSelectedContactId(contactId);
  }, []);

  const handleFileSelect = useCallback((e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setUploadError(null);

    if (selectedFiles.length + files.length > 5) {
      setUploadError("You can attach a maximum of 5 files per message.");
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const allowedExtensions = ['PDF', 'DOCX', 'DOC', 'JPG', 'JPEG', 'PNG', 'TXT', 'LOG', 'CSV', 'XLSX'];
    const maxSizeBytes = 15 * 1024 * 1024;
    for (const f of files) {
      const ext = (f.name.split('.').pop() || '').toUpperCase();
      if (!allowedExtensions.includes(ext)) {
        setUploadError(`File '${f.name}' has an unsupported file format (.${ext.toLowerCase()}). Allowed formats: ${allowedExtensions.join(', ')}.`);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      if (f.size > maxSizeBytes) {
        setUploadError(`File '${f.name}' exceeds the maximum allowed size of 15 MB.`);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
    }

    setSelectedFiles(prev => [...prev, ...files]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [selectedFiles.length]);

  const handleRemoveFile = useCallback((indexToRemove) => {
    setSelectedFiles(prev => prev.filter((_, idx) => idx !== indexToRemove));
    setUploadError(null);
  }, []);

  const handleSend = useCallback(async () => {
    const text = messageInput.trim();
    if (!text && selectedFiles.length === 0) return;
    if (!selectedContactId) return;
    if (selectedContact?.isArchived) return;

    setIsSending(true);
    setUploadError(null);

    const numericTargetId = Number(String(selectedContactId).replace(/\D/g, ''));
    const filesToUpload = [...selectedFiles];
    const textToSend = text;

    // TS084: Add optimistic pending message so the user immediately sees the sending / malware scan state
    const tempOptimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const optimisticMessage = {
      id: tempOptimisticId,
      _id: tempOptimisticId,
      ticket_id: numericTargetId,
      sender_id: userId,
      sender_name: user?.name || (user?.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : (isCustomer ? 'Customer' : 'You')),
      sender_type: userType,
      sender_role: isCustomer ? 'Customer' : (isCS ? 'Customer Support' : 'Staff / Engineer'),
      message: textToSend,
      attachments: filesToUpload.map((f, idx) => ({
        id: `opt-att-${idx}`,
        name: f.name,
        file_size: f.size,
        file_type: f.type,
        scan_status: 'pending', // Currently scanning for malware
        isScanning: true,
      })),
      created_at: new Date().toISOString(),
      isPending: true,
    };

    setMessages(prev => [...prev, optimisticMessage]);
    setMessageInput('');
    setSelectedFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';

    try {
      const newMsg = await sendTicketMessage(selectedContactId, textToSend, filesToUpload);
      setMessages(prev => {
        const filtered = prev.filter(m => m.id !== tempOptimisticId && m._id !== tempOptimisticId);
        if (newMsg.ticket_id && Number(newMsg.ticket_id) !== numericTargetId) {
          return filtered;
        }
        if (filtered.some(m => (m.id && (m.id === newMsg.id || m.id === newMsg._id)) || (m._id && (m._id === newMsg.id || m._id === newMsg._id)))) {
          return filtered;
        }
        return [...filtered, newMsg];
      });
    } catch (err) {
      console.error("Failed to send message", err);
      // Remove optimistic message on failure and restore user input/files
      setMessages(prev => prev.filter(m => m.id !== tempOptimisticId && m._id !== tempOptimisticId));
      setMessageInput(textToSend);
      setSelectedFiles(filesToUpload);
      const serverMsg = err?.response?.data?.message || err?.response?.data?.errors?.attachments?.[0] || err?.response?.data?.errors?.message?.[0] || "Failed to send message. Please try again.";
      setUploadError(serverMsg);
    } finally {
      setIsSending(false);
    }
  }, [messageInput, selectedFiles, selectedContactId, selectedContact?.isArchived, userId, userType, user, isCustomer, isCS]);

  const isWithinEditWindow = useCallback((msg) => {
    if (!msg?.created_at) return true;
    const sentTime = new Date(msg.created_at).getTime();
    const diffMinutes = (Date.now() - sentTime) / (1000 * 60);
    return diffMinutes <= 15;
  }, []);

  const renderRoleBadge = useCallback((msg) => {
    const roleText = msg.sender_role || (msg.sender_type === 'cs' ? 'Customer Support' : (msg.sender_type === 'employee' ? 'Staff / Engineer' : 'Customer'));
    const lower = roleText.toLowerCase();

    let badgeClass = 'bg-slate-100 text-slate-700 border-slate-200';
    if (lower.includes('customer support') || lower.includes('cs') || msg.sender_type === 'cs') {
      badgeClass = 'bg-blue-100 text-blue-700 border-blue-200';
    } else if (lower.includes('super admin') || lower.includes('superadmin')) {
      badgeClass = 'bg-amber-100 text-amber-800 border-amber-200';
    } else if (lower.includes('it admin') || lower.includes('admin')) {
      badgeClass = 'bg-indigo-100 text-indigo-800 border-indigo-200';
    } else if (lower.includes('engineer') || lower.includes('technician') || lower.includes('service') || msg.sender_type === 'employee') {
      badgeClass = 'bg-purple-100 text-purple-700 border-purple-200';
    } else if (lower.includes('customer') || msg.sender_type === 'customer') {
      badgeClass = 'bg-emerald-100 text-emerald-700 border-emerald-200';
    }

    return (
      <span className={`px-1.5 py-0.5 rounded-full font-semibold text-[9px] border ${badgeClass}`}>
        {roleText}
      </span>
    );
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleInputFocus = useCallback(() => {
    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      setLastMessageIdOnLoad(lastMsg.id || lastMsg._id);
    }
  }, [messages]);

  const handleStartEdit = useCallback((msg) => {
    setEditingMessageId(msg.id || msg._id);
    setEditInputText(msg.message || '');
    setEditError(null);
    setActiveMenuMsgId(null);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditInputText('');
    setEditError(null);
  }, []);

  const handleUpdateMessage = useCallback(async (messageId) => {
    const trimmed = editInputText.trim();
    if (!selectedContactId) return;

    if (!trimmed) {
      setEditError("Message content cannot be empty.");
      return;
    }

    setEditSaving(true);
    setEditError(null);

    try {
      const updated = await editTicketMessage(selectedContactId, messageId, trimmed);
      setMessages(prev => prev.map(m => (m.id === messageId || m._id === messageId) ? {
        ...m,
        ...updated,
        message: updated?.message ?? trimmed,
        is_edited: true,
        edited: true,
        edited_at: updated?.edited_at ?? new Date().toISOString(),
        edit_history: updated?.edit_history ?? m.edit_history,
      } : m));
      setEditingMessageId(null);
      setEditInputText('');
      setEditError(null);
    } catch (err) {
      console.error("Failed to update message", err);
      const serverMsg = err?.response?.data?.message || err?.response?.data?.errors?.message?.[0] || "Failed to update message. Please try again.";
      setEditError(serverMsg);
    } finally {
      setEditSaving(false);
    }
  }, [editInputText, selectedContactId]);

  const handleOpenHistory = useCallback(async (msg) => {
    const msgId = msg.id || msg._id;
    setActiveHistoryMsgId(msgId);
    setMsgHistoryLoading(true);
    setHistoryModalData({
      message: msg,
      history: msg.edit_history || [],
      original_sent_at: msg.created_at,
      current_content: msg.message,
      edited_at: msg.edited_at,
    });

    try {
      const remoteHistory = await getMessageEditHistory(selectedContactId, msgId);
      if (remoteHistory) {
        setHistoryModalData({
          message: msg,
          history: remoteHistory.edit_history || msg.edit_history || [],
          original_sent_at: remoteHistory.original_sent_at || msg.created_at,
          current_content: remoteHistory.current_content || msg.message,
          edited_at: remoteHistory.edited_at || msg.edited_at,
        });
      }
    } catch (err) {
      console.warn("Could not fetch remote edit history, using local history payload", err);
    } finally {
      setMsgHistoryLoading(false);
    }
  }, [selectedContactId]);

  const handleCloseHistory = useCallback(() => {
    setActiveHistoryMsgId(null);
    setHistoryModalData(null);
    setMsgHistoryLoading(false);
  }, []);

  const handleDeleteMessage = useCallback(async (messageId) => {
    if (!selectedContactId) return;
    if (!window.confirm("Are you sure you want to delete this message for you? It will still be visible to other participants.")) {
      return;
    }

    try {
      await deleteTicketMessage(selectedContactId, messageId);
      setMessages(prev => prev.filter(m => m.id !== messageId && m._id !== messageId));
    } catch (err) {
      console.error("Failed to delete message", err);
      window.alert("Failed to delete message. Please try again.");
    }
  }, [selectedContactId]);

  // Restore conversation by reopening ticket
  const handleReopenTicket = useCallback(async (ticketId) => {
    if (!ticketId || reopening) return;
    const numericId = Number(String(ticketId).replace(/\D/g, ''));
    if (!numericId) return;

    setReopening(true);
    try {
      await updateTicket({
        ticketId: numericId,
        statusId: 8, // Reopened
      });

      // Optimistically update local tickets state
      setTickets(prev => prev.map(t => {
        const tId = t.ticket_ID || t.id;
        const match = Number(String(tId).replace(/\D/g, '')) === numericId || String(tId) === String(ticketId);
        if (match) {
          return {
            ...t,
            status: 'Reopened',
            status_name: 'Reopened',
            assigned_to: null,
            assigned: [],
          };
        }
        return t;
      }));

      setConversationTab('active');
      setSelectedContactId(ticketId);
    } catch (err) {
      console.error("Failed to reopen ticket", err);
      window.alert(err?.response?.data?.message || "Failed to reopen ticket. Please try again.");
    } finally {
      setReopening(false);
    }
  }, [reopening]);

  return (
    <div className="flex flex-col h-[calc(100vh-9rem)]">
      <div className="mb-4 shrink-0">
        <PageHeader
          pattern="B"
          title="Messages"
          subtitle="Live customer support and staff collaboration threads"
        />
      </div>

      <div className="flex flex-1 bg-card rounded-xl shadow-xs border border-border overflow-hidden min-h-0">
        {/* ── Left Panel ── */}
        <div className="w-[360px] lg:w-[380px] border-r border-border flex flex-col shrink-0">
          {/* Active / Archive Conversation Tabs */}
          <div className="flex items-center gap-1 p-2 bg-slate-50 border-b border-border shrink-0">
            <button
              onClick={() => setConversationTab('active')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                conversationTab === 'active'
                  ? 'bg-card text-primary shadow-xs border border-border'
                  : 'text-slate-muted hover:text-slate-dark hover:bg-slate-100'
              }`}
            >
              <MessageCircle size={14} />
              <span>Active</span>
              {activeContacts.length > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-primary/10 text-primary font-semibold">
                  {activeContacts.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setConversationTab('archived')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                conversationTab === 'archived'
                  ? 'bg-card text-primary shadow-xs border border-border'
                  : 'text-slate-muted hover:text-slate-dark hover:bg-slate-100'
              }`}
            >
              <Archive size={14} />
              <span>Archive</span>
              {archivedContacts.length > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-amber-500/10 text-amber-700 font-semibold">
                  {archivedContacts.length}
                </span>
              )}
            </button>
          </div>

          {/* Filter bar — CS: External / Internal */}
          {isCS && (
            <div className="flex items-center gap-2 p-3 pb-2 border-b border-border shrink-0 flex-wrap">
              <button
                onClick={() => setCsFilter('external')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  csFilter === 'external'
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'bg-slate-100 text-slate-muted hover:bg-slate-200'
                }`}
              >
                <Users size={13} />
                External
              </button>
              <button
                onClick={() => setCsFilter('internal')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  csFilter === 'internal'
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'bg-slate-100 text-slate-muted hover:bg-slate-200'
                }`}
              >
                <User size={13} />
                Internal
              </button>
            </div>
          )}

          {/* Contact list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center text-gray-400">Loading tickets...</div>
            ) : displayedContacts.length === 0 ? (
              <div className="p-8 text-center">
                {conversationTab === 'active' ? (
                  <>
                    <MessageCircle size={32} className="mx-auto text-gray-300 mb-2" />
                    <p className="text-sm text-gray-400">No active ticket conversations</p>
                  </>
                ) : (
                  <>
                    <Archive size={32} className="mx-auto text-gray-300 mb-2" />
                    <p className="text-sm text-gray-400">No archived ticket conversations</p>
                  </>
                )}
              </div>
            ) : (
              displayedContacts.map((contact, cIdx) => (
                <button
                  key={contact.id ? `contact-${contact.id}` : `contact-idx-${cIdx}`}
                  onClick={() => handleSelectContact(contact.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all hover:bg-gray-50 border-b border-gray-50 cursor-pointer ${
                    selectedContactId === contact.id ? 'bg-[#252578]/5' : ''
                  }`}
                >
                  <Avatar name={contact.subtitle} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-gray-800 truncate">
                        {contact.displayTitle}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-xs text-gray-500 truncate">
                        {contact.subtitle}
                      </span>
                      {contact.isArchived ? (
                        <span className="text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1">
                          <Archive size={10} /> Archived
                        </span>
                      ) : (
                        <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">Active CS</span>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* ── Right Panel ── */}
        {selectedContact ? (
          <div className="flex-1 flex flex-row min-w-0">
            {/* Chat Area */}
            <div className="flex-1 flex flex-col min-w-0 border-r border-gray-100">
              {/* Conversation header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card shrink-0">
                <div className="flex items-center gap-3">
                  <Avatar name={selectedContact.subtitle} />
                  <div>
                    <p className="font-semibold text-sm text-slate-dark">{selectedContact.displayTitle}</p>
                    <p className="text-xs text-slate-muted">
                      {isCustomer ? `Ticket ${selectedContact.ticketNumber || `TKT-${String(selectedContact.ticket_ID || selectedContact.id).padStart(4, '0')}`}` : `Client: ${selectedContact.subtitle}`} • Status: {selectedContact.status}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowDetailsSidebar(!showDetailsSidebar)}
                  className={`px-3 py-1.5 rounded-lg border transition-all flex items-center gap-1.5 text-xs font-semibold cursor-pointer ${
                    showDetailsSidebar
                      ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                      : 'bg-card text-slate-dark border-border hover:bg-slate-50'
                  }`}
                  title="Toggle Ticket Details"
                >
                  <AlertCircle size={14} />
                  <span>Ticket Details</span>
                </button>
              </div>

              {/* Archive Banner Notice */}
              {selectedContact.isArchived && (
                <div className="bg-amber-50/90 border-b border-amber-200 px-6 py-3 flex items-center justify-between gap-4 select-none animate-in fade-in duration-200">
                  <div className="flex items-center gap-2 text-xs text-amber-900 font-medium">
                    <Archive size={16} className="text-amber-600 shrink-0" />
                    <span>
                      <strong>Archived Conversation:</strong> This ticket is Closed. The message thread is locked and read-only.
                    </span>
                  </div>
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 bg-page">
                {messagesLoading ? (
                  <div className="text-center py-8 text-slate-muted">Loading chat history...</div>
                ) : currentTicketMessages.length === 0 ? (
                  <div className="text-center py-8 text-slate-muted">
                    <MessageCircle size={28} className="mx-auto text-slate-300 mb-1" />
                    <p className="text-xs">No messages yet. Send a message to start the conversation.</p>
                  </div>
                ) : (
                  currentTicketMessages.map((msg, idx) => {
                    const msgId = msg.id || msg._id || `msg-${idx}`;
                    const isMine = (msg.sender_type === userType && Number(msg.sender_id) === Number(userId)) ||
                                   (msg.sender_type === 'cs' && userType === 'cs');
                    const isAuthor = msg.sender_type === userType && Number(msg.sender_id) === Number(userId);
                    const showNewMessagesBanner = idx === firstNewMessageIndex;

                    if (msg.sender_type === 'system' || msg.sender_name === 'System') {
                      return (
                        <React.Fragment key={msg.id ? `sys-${msg.id}` : (msg._id ? `sys-${msg._id}` : `sys-idx-${idx}`)}>
                          {showNewMessagesBanner && (
                            <div className="flex items-center my-4 select-none">
                              <div className="flex-1 border-t border-gray-200"></div>
                              <span className="mx-4 text-[10px] font-bold text-gray-600 bg-gray-50 px-2.5 py-1 rounded-full uppercase tracking-wider shadow-sm border border-gray-200 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse shrink-0"></span>
                                New Messages
                              </span>
                              <div className="flex-1 border-t border-gray-200"></div>
                            </div>
                          )}
                          <div className="flex justify-center my-3 select-none">
                            <span className="text-[11px] text-gray-500 bg-gray-100 border border-gray-200/50 px-3.5 py-1.5 rounded-full shadow-xs flex items-center gap-1.5 font-medium max-w-[90%] text-center">
                              <AlertCircle size={12} className="text-gray-400 shrink-0" />
                              {msg.message}
                            </span>
                          </div>
                        </React.Fragment>
                      );
                    }

                    return (
                      <React.Fragment key={msg.id ? `msg-${msg.id}` : (msg._id ? `msg-${msg._id}` : `msg-idx-${idx}`)}>
                        {showNewMessagesBanner && (
                          <div className="flex items-center my-4 select-none">
                            <div className="flex-1 border-t border-gray-200"></div>
                            <span className="mx-4 text-[10px] font-bold text-gray-600 bg-gray-50 px-2.5 py-1 rounded-full uppercase tracking-wider shadow-sm border border-gray-200 flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse shrink-0"></span>
                              New Messages
                            </span>
                            <div className="flex-1 border-t border-gray-200"></div>
                          </div>
                        )}
                        <div className={`flex ${isMine ? 'justify-end' : 'justify-start'} group/msg`}>
                          <div className="max-w-[75%] flex flex-col">
                          <div className={`text-[10px] text-slate-muted mb-0.5 px-1 flex items-center gap-1.5 flex-wrap ${isMine ? 'justify-end' : 'justify-start'}`}>
                            <span className="font-semibold text-slate-700">{msg.sender_name}</span>
                            {renderRoleBadge(msg)}
                          </div>
                          
                          <div className={`flex items-center gap-2 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
                            {/* Message Bubble */}
                            <div className={`px-4 py-2.5 ${
                              isMine
                                ? 'bg-primary text-primary-foreground rounded-2xl rounded-br-md'
                                : 'bg-card text-slate-dark border border-border rounded-2xl rounded-bl-md shadow-xs'
                            }`}>
                              {editingMessageId === msgId ? (
                                <div className="flex flex-col gap-2 min-w-[240px] sm:min-w-[320px]">
                                  <textarea
                                    value={editInputText}
                                    onChange={e => {
                                      setEditInputText(e.target.value);
                                      if (editError) setEditError(null);
                                    }}
                                    rows={3}
                                    className="w-full text-sm text-gray-800 bg-white border border-gray-300 rounded-lg p-2.5 focus:outline-none focus:ring-2 focus:ring-[#252578] resize-none"
                                    autoFocus
                                    placeholder="Edit your message..."
                                    onKeyDown={e => {
                                      if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleUpdateMessage(msgId);
                                      }
                                      if (e.key === 'Escape') handleCancelEdit();
                                    }}
                                  />
                                  {editError && (
                                    <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded p-2 flex items-start gap-1.5 animate-in fade-in duration-150">
                                      <AlertCircle size={14} className="shrink-0 mt-0.5" />
                                      <span>{editError}</span>
                                    </div>
                                  )}
                                  <div className="flex items-center justify-between text-xs pt-1">
                                    <span className="text-[10px] text-gray-400">Esc to cancel • Enter to save</span>
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={handleCancelEdit}
                                        disabled={editSaving}
                                        className="px-2.5 py-1 rounded border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 font-medium cursor-pointer transition-colors"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleUpdateMessage(msgId)}
                                        disabled={!editInputText.trim() || editSaving}
                                        className="px-3 py-1 bg-primary text-primary-foreground hover:opacity-90 rounded font-semibold cursor-pointer disabled:opacity-50 transition-opacity flex items-center gap-1.5"
                                      >
                                        {editSaving && <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span>}
                                        <span>Save</span>
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  {msg.message && (
                                    <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.message}</p>
                                  )}
                                  {/* Fallback if message has no text and no attachments so it never renders a blank blue rectangle */}
                                  {!msg.message && (!msg.attachments || msg.attachments.length === 0) && (
                                    <p className="text-xs italic opacity-75">Message has no content</p>
                                  )}
                                  {/* Inline Attachments */}
                                  {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
                                    <div className={`flex flex-col gap-1.5 ${msg.message ? 'mt-2 pt-2 border-t' : ''} ${isMine ? 'border-primary-foreground/20' : 'border-border'}`}>
                                      {msg.attachments.map((att, attIdx) => {
                                        const isQuarantined = att.scan_status === 'quarantined' || Boolean(att.threat_alert);
                                        const isScanning = att.scan_status === 'pending' || Boolean(att.isScanning);
                                        const formattedSize = att.file_size ? `${(att.file_size / 1024).toFixed(0)} KB` : '';
                                        const fileUrl = att.url || att.file_path || null;

                                        if (isQuarantined) {
                                          return (
                                            <div
                                              key={attIdx}
                                              className="flex items-start gap-2 p-2 rounded-lg bg-red-50 text-red-900 border border-red-200 text-xs text-left"
                                            >
                                              <ShieldAlert size={16} className="text-red-600 shrink-0 mt-0.5" />
                                              <div className="flex-1 min-w-0">
                                                <p className="font-semibold truncate">{att.name || 'Quarantined File'}</p>
                                                <p className="text-[10px] text-red-600 leading-tight">
                                                  {att.threat_alert || 'File was flagged as a security threat and blocked.'}
                                                </p>
                                              </div>
                                            </div>
                                          );
                                        }

                                        if (isScanning) {
                                          return (
                                            <div
                                              key={attIdx}
                                              className={`flex items-center gap-2.5 p-2.5 rounded-xl text-xs text-left transition-all ${
                                                isMine
                                                  ? 'bg-white/15 text-white border border-white/25 shadow-xs'
                                                  : 'bg-amber-50 text-amber-950 border border-amber-200 shadow-xs'
                                              }`}
                                            >
                                              <Loader2 size={16} className={`animate-spin shrink-0 ${isMine ? 'text-amber-300' : 'text-amber-600'}`} />
                                              <div className="flex-1 min-w-0">
                                                <p className="font-semibold truncate">{att.name || 'Attachment'}</p>
                                                <p className={`text-[10px] font-medium flex items-center gap-1 ${isMine ? 'text-amber-200' : 'text-amber-700'}`}>
                                                  <span>Scanning for threats... (Checking file for malware)</span>
                                                </p>
                                              </div>
                                              <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${
                                                isMine ? 'bg-amber-400/25 text-amber-200 border border-amber-300/30' : 'bg-amber-100 text-amber-800 border border-amber-300'
                                              }`}>
                                                Scanning
                                              </span>
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
                                              if (fileUrl) downloadAttachment(fileUrl, att.name).catch(() => window.alert('This file could not be downloaded. You may not have access to it.'));
                                            }}
                                            className={`flex items-center gap-2 p-2 rounded-lg transition-colors group/att ${
                                              isMine
                                                ? 'bg-white/10 hover:bg-white/20 text-white'
                                                : 'bg-gray-50 hover:bg-gray-100 text-slate-800 border border-gray-200'
                                            }`}
                                            title={`Download ${att.name || 'file'}`}
                                          >
                                            <FileText size={16} className="shrink-0 opacity-80 group-hover/att:opacity-100" />
                                            <div className="flex-1 min-w-0 text-left">
                                              <p className="text-xs font-semibold truncate leading-tight">{att.name || 'attachment'}</p>
                                              {formattedSize && (
                                                <p className={`text-[10px] ${isMine ? 'text-white/70' : 'text-slate-400'}`}>
                                                  {formattedSize}
                                                </p>
                                              )}
                                            </div>
                                            <Download size={14} className="shrink-0 opacity-70 group-hover/att:opacity-100" />
                                          </a>
                                        );
                                      })}
                                    </div>
                                  )}
                                  {/* Optimistic sending / scanning indicator */}
                                  {msg.isPending && (
                                    <div className={`mt-2 pt-1.5 border-t flex items-center justify-between text-[10px] ${
                                      isMine ? 'border-white/15 text-white/70' : 'border-gray-200 text-slate-400'
                                    }`}>
                                      <span className="flex items-center gap-1 font-medium">
                                        <Loader2 size={11} className="animate-spin" />
                                        {Array.isArray(msg.attachments) && msg.attachments.length > 0
                                          ? 'Scanning file for malware (ClamAV)...'
                                          : 'Sending...'}
                                      </span>
                                      {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
                                        <span className="italic opacity-80">Sending</span>
                                      )}
                                    </div>
                                  )}
                                </>
                              )}
                            </div>

                            {/* Options Menu Trigger & Dropdown */}
                            {editingMessageId !== msgId && !selectedContact.isArchived && (
                              <div className="relative flex items-center">
                                <button
                                  onClick={() => setActiveMenuMsgId(activeMenuMsgId === msgId ? null : msgId)}
                                  className="opacity-0 group-hover/msg:opacity-100 text-gray-400 hover:text-gray-600 transition-opacity p-1 rounded-full hover:bg-gray-100 cursor-pointer flex items-center justify-center"
                                  title="Options"
                                >
                                  <MoreVertical size={14} />
                                </button>
                                {activeMenuMsgId === msgId && (
                                  <div className={`absolute bottom-6 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-10 w-32 text-left text-xs ${isMine ? 'right-0' : 'left-0'}`}>
                                    {/* Spec 0037 (AC-17): a message that carries files stays exactly as sent. */}
                                    {isAuthor && isWithinEditWindow(msg) && !(msg.attachments?.length > 0) && (
                                      <button
                                        onClick={() => handleStartEdit(msg)}
                                        className="w-full px-3 py-1.5 hover:bg-gray-50 flex items-center gap-1.5 text-gray-700 cursor-pointer font-medium whitespace-nowrap"
                                      >
                                        <Edit2 size={12} />
                                        Edit
                                      </button>
                                    )}
                                    <button
                                      onClick={() => {
                                        handleDeleteMessage(msgId);
                                        setActiveMenuMsgId(null);
                                      }}
                                      className="w-full px-3 py-1.5 hover:bg-gray-50 flex items-center gap-1.5 text-red-600 hover:text-red-700 cursor-pointer font-medium whitespace-nowrap"
                                    >
                                      <Trash2 size={12} />
                                      Delete for you
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Footer / Edit Indicator & History Trigger */}
                          <div className={`flex items-center gap-1.5 mt-1 text-[10px] text-gray-400 ${isMine ? 'justify-end' : 'justify-start'}`}>
                            <span title={formatDisplayDate(msg.created_at)}>{formatTime(msg.created_at)}</span>
                            {(msg.is_edited || msg.edited || (msg.edit_history && msg.edit_history.length > 0)) && (
                              <button
                                type="button"
                                onClick={() => handleOpenHistory(msg)}
                                className="text-slate-400 hover:text-primary transition-colors underline cursor-pointer font-medium text-[9px] flex items-center gap-0.5"
                                title="Click to view edit history"
                              >
                                <span>(edited{msg.edited_at ? ` • ${formatTime(msg.edited_at)}` : ''})</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                      </React.Fragment>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input / Closed & Archived Banner */}
              {selectedContact.isArchived ? (
                <div className="flex items-center justify-center gap-2 px-6 py-5 border-t border-gray-100 bg-amber-50/50 flex-shrink-0">
                  <AlertCircle className="text-amber-600 shrink-0" size={18} />
                  <p className="text-xs text-amber-900 font-medium">
                    This conversation is archived because the ticket is Closed. The message thread is locked and read-only.
                  </p>
                </div>
              ) : isCS && !selectedContact.is_internal && selectedContact.type !== 'internal' && Number(selectedContact.requested_by) === Number(user?.emp_id ?? user?.id) ? (
                <div className="flex items-center justify-center gap-2 px-6 py-5 border-t border-gray-100 bg-amber-50/50 flex-shrink-0">
                  <AlertCircle className="text-amber-600" size={18} />
                  <p className="text-xs text-amber-800 font-medium">
                    You cannot send messages on an external ticket you created.
                  </p>
                </div>
              ) : (
                <div className="px-6 py-4 border-t border-border bg-card shrink-0">
                  {/* Inline upload error banner with retry guidance */}
                  {uploadError && (
                    <div className="flex items-start gap-2 mb-3 p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl animate-in fade-in">
                      <AlertCircle size={14} className="shrink-0 mt-0.5 text-red-600" />
                      <div className="flex-1">
                        <p className="font-semibold">{uploadError}</p>
                        <p className="text-[11px] text-red-600/80">Your message text and attachments were preserved. You can edit them and retry sending.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setUploadError(null)}
                        className="text-red-400 hover:text-red-600 p-0.5 cursor-pointer"
                        title="Dismiss"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}

                  {/* Attached files preview chips */}
                  {selectedFiles.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 mb-3 p-2 bg-gray-50 border border-gray-200 rounded-xl">
                      {selectedFiles.map((file, fIdx) => (
                        <div
                          key={fIdx}
                          className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-gray-200 rounded-lg text-xs shadow-xs"
                        >
                          <FileText size={14} className="text-primary shrink-0" />
                          <span className="font-medium text-slate-700 max-w-[140px] truncate">{file.name}</span>
                          <span className="text-[10px] text-slate-400">({(file.size / 1024).toFixed(0)} KB)</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveFile(fIdx)}
                            disabled={isSending}
                            className="text-slate-400 hover:text-red-500 transition-colors ml-1 p-0.5 rounded cursor-pointer disabled:opacity-50"
                            title="Remove file"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Composer Input controls */}
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      onChange={handleFileSelect}
                      className="hidden"
                      accept=".pdf,.docx,.doc,.jpg,.jpeg,.png"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isSending || selectedFiles.length >= 5}
                      className="p-2.5 text-slate-500 hover:text-primary hover:bg-slate-100 rounded-xl transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                      title="Attach files (max 5, up to 15MB each)"
                      aria-label="Attach files"
                    >
                      <Paperclip size={18} />
                    </button>
                    <input
                      type="text"
                      value={messageInput}
                      onChange={e => setMessageInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      onFocus={handleInputFocus}
                      disabled={isSending}
                      placeholder={selectedFiles.length > 0 ? "Add an optional caption..." : "Type a message..."}
                      className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                    <button
                      onClick={handleSend}
                      disabled={(!messageInput.trim() && selectedFiles.length === 0) || isSending}
                      className="bg-primary text-primary-foreground rounded-xl px-4 py-2.5 transition-all hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center shrink-0"
                      title="Send message"
                      aria-label="Send message"
                    >
                      {isSending ? (
                        <Loader2 size={18} className="animate-spin" />
                      ) : (
                        <Send size={18} />
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Collapsible details sidebar */}
            {showDetailsSidebar && (
              <div className="w-[320px] xl:w-[360px] bg-card flex flex-col shrink-0 overflow-hidden border-l border-border select-none">
                <div className="p-3 border-b border-border flex items-center justify-between">
                  <h3 className="font-bold text-slate-dark text-sm">Ticket Details</h3>
                  <button onClick={() => setShowDetailsSidebar(false)} className="text-slate-muted hover:text-slate-dark p-1 rounded-lg hover:bg-slate-100 cursor-pointer">
                    <X size={16} />
                  </button>
                </div>

                {/* Tab Navigation */}
                <div className="flex border-b border-border bg-gray-50/70 p-1 gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setSidebarTab('info')}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                      sidebarTab === 'info'
                        ? 'bg-white text-[#252578] shadow-xs border border-gray-200'
                        : 'text-slate-muted hover:text-slate-dark hover:bg-white/50'
                    }`}
                  >
                    <Info size={13} />
                    <span>Info</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSidebarTab('history')}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                      sidebarTab === 'history'
                        ? 'bg-white text-[#252578] shadow-xs border border-gray-200'
                        : 'text-slate-muted hover:text-slate-dark hover:bg-white/50'
                    }`}
                  >
                    <History size={13} />
                    <span>History</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSidebarTab('ai')}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                      sidebarTab === 'ai'
                        ? 'bg-white text-[#252578] shadow-xs border border-gray-200'
                        : 'text-slate-muted hover:text-slate-dark hover:bg-white/50'
                    }`}
                  >
                    <Sparkles size={13} className="text-[#2E85D8]" />
                    <span>AI Chat</span>
                  </button>
                </div>

                {/* Tab Content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {sidebarTab === 'info' && (
                    <>
                      <div>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Ticket ID</p>
                        <p className="text-sm font-bold text-gray-800 mt-0.5">
                          {selectedContact.ticketNumber
                            || (typeof selectedContact.id === 'number'
                              ? `TKT-${String(selectedContact.id).padStart(4, '0')}`
                              : selectedContact.id)}
                        </p>
                      </div>

                      <div>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Title</p>
                        <p className="text-xs font-semibold text-gray-700 mt-0.5 whitespace-normal break-words leading-relaxed">
                          {selectedContact.displayTitle}
                        </p>
                      </div>

                      <div className="flex gap-4">
                        <div className="flex-1">
                          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Status</p>
                          <div className="mt-1">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                              statusBadges[selectedContact.status] || 'bg-gray-50 text-gray-700 border-gray-100'
                            }`}>
                              {selectedContact.status}
                            </span>
                          </div>
                        </div>
                        <div className="flex-1">
                          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Priority</p>
                          <div className="mt-1">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                              priorityBadges[selectedContact.priority] || 'bg-gray-50 text-gray-700 border-gray-100'
                            }`}>
                              {selectedContact.priority}
                            </span>
                          </div>
                        </div>
                      </div>

                      {selectedContact.isArchived && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex flex-col gap-2">
                          <div className="flex items-center gap-1.5 text-xs text-amber-900 font-bold">
                            <Archive size={14} className="text-amber-700" />
                            <span>Archived Conversation</span>
                          </div>
                          <p className="text-[11px] text-amber-800 leading-normal">
                            This conversation is stored in Archive because the ticket is Closed. The message thread is locked and read-only.
                          </p>
                        </div>
                      )}

                      <div>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Category</p>
                        <p className="text-xs font-medium text-gray-700 mt-0.5">{selectedContact.category}</p>
                      </div>

                      <div>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Equipment</p>
                        <p className="text-xs font-medium text-gray-700 mt-0.5">{selectedContact.equipment}</p>
                      </div>

                      <div>
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Date Created</p>
                        <p className="text-xs font-medium text-gray-700 mt-0.5">
                          {selectedContact.date ? formatDisplayDate(selectedContact.date) : 'N/A'}
                        </p>
                      </div>

                      <div className="border-t border-gray-100 pt-3">
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Description</p>
                        <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                          {selectedContact.description}
                        </p>
                      </div>
                    </>
                  )}

                  {sidebarTab === 'history' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between pb-1">
                        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Ticket Timeline</span>
                        <span className="text-[10px] text-gray-400 font-mono">
                          {ticketHistory ? `${ticketHistory.length} events` : ''}
                        </span>
                      </div>

                      {historyLoading ? (
                        <div className="text-center py-8 text-xs text-slate-muted animate-pulse">
                          Loading ticket history...
                        </div>
                      ) : !ticketHistory || ticketHistory.length === 0 ? (
                        <div className="text-center py-8 text-xs text-slate-muted bg-gray-50 rounded-xl p-4 border border-dashed border-gray-200">
                          No history events recorded for this ticket.
                        </div>
                      ) : (
                        <div className="relative pl-4 space-y-4 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-gray-200">
                          {ticketHistory.map((evt, idx) => (
                            <div key={evt.id || idx} className="relative text-left">
                              <span className="absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full bg-[#252578] ring-4 ring-white" />
                              <p className="text-xs font-semibold text-gray-800 leading-snug">
                                {evt.text || evt.details || evt.action || 'Ticket updated'}
                              </p>
                              {evt.author && (
                                <p className="text-[11px] text-gray-500 mt-0.5 font-medium">
                                  By: {evt.author}
                                </p>
                              )}
                              <p className="text-[10px] text-gray-400 mt-0.5">
                                {formatDisplayDate(evt.timestamp || evt.created_at)}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {sidebarTab === 'ai' && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between pb-1">
                        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">AI Conversation History</span>
                        {aiConversations.length > 1 && (
                          <span className="text-[10px] text-gray-400 font-mono">{aiConversations.length} sessions</span>
                        )}
                      </div>

                      {aiConversations.length > 1 && (
                        <div>
                          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Select Session</label>
                          <select
                            value={selectedAiConvId || ''}
                            onChange={(e) => setSelectedAiConvId(e.target.value)}
                            className="w-full text-xs rounded-xl border border-gray-200 bg-white p-2 font-medium text-gray-700 outline-none focus:ring-1 focus:ring-[#252578]"
                          >
                            {aiConversations.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.title || 'Support Session'} ({c.message_count || (c.messages ? c.messages.length : 0)} msgs)
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {aiLoading ? (
                        <div className="text-center py-8 text-xs text-slate-muted animate-pulse">
                          Loading AI conversation...
                        </div>
                      ) : activeAiMessages.length === 0 ? (
                        <div className="text-center py-8 text-xs text-slate-muted bg-gray-50 rounded-xl p-4 border border-dashed border-gray-200">
                          <Bot size={24} className="mx-auto text-gray-300 mb-2" />
                          <p className="font-semibold text-gray-600">No AI Conversations Found</p>
                          <p className="text-[11px] text-gray-400 mt-1">This ticket did not originate from an AI triage conversation or no sessions were logged.</p>
                        </div>
                      ) : (
                        <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                          {activeAiMessages.map((msg, idx) => {
                            const isUser = msg.role === 'user';
                            return (
                              <div
                                key={msg.id || idx}
                                className={`p-3 rounded-xl text-xs leading-relaxed ${
                                  isUser
                                    ? 'bg-blue-50 text-blue-950 border border-blue-100 ml-3'
                                    : 'bg-white text-gray-800 border border-gray-200 mr-3 shadow-xs'
                                }`}
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <span className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${
                                    isUser ? 'text-[#252578]' : 'text-emerald-700'
                                  }`}>
                                    {isUser ? <User size={11} /> : <Bot size={11} />}
                                    {isUser ? 'Customer' : 'Gemini AI Assistant'}
                                  </span>
                                  {msg.timestamp && (
                                    <span className="text-[9px] text-gray-400 font-mono">
                                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  )}
                                </div>
                                <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-[#f4f7fb]/50">
            <div className="text-center">
              <MessageCircle size={48} className="mx-auto text-gray-300 mb-3" />
              <p className="text-gray-400 font-medium">Select a conversation</p>
              <p className="text-xs text-gray-300 mt-1">Choose a ticket from the left panel</p>
            </div>
          </div>
        )}

      {/* Edit History Modal */}
      {historyModalData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={handleCloseHistory}
        >
          <div
            className="bg-card text-card-foreground border border-border rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-history-title"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                  <History size={16} />
                </div>
                <div>
                  <h3 id="edit-history-title" className="text-sm font-semibold text-foreground">
                    Message Edit History
                  </h3>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                    <Clock size={11} />
                    <span>Originally sent {formatDisplayDate(historyModalData.original_sent_at)}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseHistory}
                className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-muted transition-colors cursor-pointer"
                title="Close"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {msgHistoryLoading ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-muted gap-2">
                  <span className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>
                  <p className="text-xs">Fetching version history...</p>
                </div>
              ) : (
                <>
                  {/* Current Active Version */}
                  <div className="border border-primary/30 bg-primary/5 rounded-xl p-3.5 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-primary flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
                        Current Version (Active)
                      </span>
                      {historyModalData.edited_at && (
                        <span className="text-[11px] text-muted-foreground font-mono">
                          {formatDisplayDate(historyModalData.edited_at)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed bg-card/60 p-2.5 rounded-lg border border-border">
                      {historyModalData.current_content}
                    </p>
                  </div>

                  {/* Prior Versions */}
                  <div>
                    <h4 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-2">
                      Prior Versions ({historyModalData.history?.length || 0})
                    </h4>

                    {(!historyModalData.history || historyModalData.history.length === 0) ? (
                      <p className="text-xs text-muted-foreground italic py-3 text-center bg-muted/20 rounded-lg">
                        No previous edits recorded for this message.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {historyModalData.history.map((hist, idx) => (
                          <div
                            key={idx}
                            className="border border-border rounded-xl p-3 bg-card space-y-1.5 shadow-xs"
                          >
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-medium text-slate-dark text-[11px] flex items-center gap-1">
                                <span className="font-semibold">Version {hist.version || idx + 1}</span>
                                {hist.editor_name && (
                                  <span className="text-slate-muted font-normal">• by {hist.editor_name}</span>
                                )}
                              </span>
                              <span className="text-[10px] text-slate-muted font-mono">
                                {formatDisplayDate(hist.edited_at)}
                              </span>
                            </div>
                            <p className="text-xs text-slate-dark whitespace-pre-wrap break-words leading-relaxed bg-muted/30 p-2.5 rounded-lg border border-border">
                              {hist.message}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-border bg-muted/30 flex justify-end">
              <button
                type="button"
                onClick={handleCloseHistory}
                className="px-4 py-1.5 rounded-lg bg-card text-foreground border border-border hover:bg-muted font-medium text-xs cursor-pointer transition-colors shadow-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
