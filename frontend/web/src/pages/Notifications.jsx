import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  ShieldAlert,
  MessageCircle,
  AlertTriangle,
  Database,
  KeyRound,
  Activity,
  Layers,
  Terminal,
  AlertOctagon,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import {
  getNotifications,
  markNotificationsRead,
  markNotificationRead,
  getTicketDetails,
  getAssignableEmployees,
} from '@/services/ticketService';
import { useAuth } from '@/context/AuthContext';
import useRealtimeRefresh from '@/hooks/useRealtimeRefresh';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';
import SkeletonLoader from '@/components/SkeletonLoader';
import { formatDisplayDate } from '@/utils/dateUtils';
import CustomerTicketDetailModal from '@/components/CustomerTicketDetailModal';
import { TicketSummary } from '@/components/CSModals';
import { respondReassignment } from '@/services/ticketService';
import SecurityIncidentModal from '@/components/security/SecurityIncidentModal';
import SystemAlertModal from '@/components/security/SystemAlertModal';

export const isNotificationRead = (n) => {
  if (!n) return false;
  if (n.is_read === true || n.is_read === 1 || n.is_read === '1' || n.is_read === 'true') return true;
  if (n.is_read === false || n.is_read === 0 || n.is_read === '0' || n.is_read === 'false') return false;
  return !Boolean(n.unread);
};

export default function Notifications() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [notifications, setNotifications] = useState([]);
  const [filter, setFilter] = useState('all'); // 'all' | 'unread' | 'read'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeTicket, setActiveTicket] = useState(null);
  const [activeNotificationId, setActiveNotificationId] = useState(null);
  const [activeEmployees, setActiveEmployees] = useState([]);
  const [activeTicketLoading, setActiveTicketLoading] = useState(false);
  useLockBodyScroll(activeTicketLoading);
  const [activeSecurityIncident, setActiveSecurityIncident] = useState(null);
  const [activeSystemAlert, setActiveSystemAlert] = useState(null);

  const unreadCount = useMemo(() => {
    return notifications.filter((n) => !isNotificationRead(n)).length;
  }, [notifications]);

  const readCount = useMemo(() => {
    return notifications.filter((n) => isNotificationRead(n)).length;
  }, [notifications]);

  const filteredNotifications = useMemo(() => {
    if (filter === 'unread') {
      return notifications.filter((n) => !isNotificationRead(n));
    }
    if (filter === 'read') {
      return notifications.filter((n) => isNotificationRead(n));
    }
    return notifications;
  }, [notifications, filter]);

  const loadData = useCallback(async ({ source = 'manual' } = {}) => {
    if (source !== 'websocket' && source !== 'poll') {
      setLoading(true);
    }
    setError('');
    try {
      const data = await getNotifications();
      setNotifications(data.notifications || []);
    } catch (err) {
      console.error(err);
      setError('Failed to fetch notifications.');
    } finally {
      if (source !== 'websocket' && source !== 'poll') {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useRealtimeRefresh({
    refresh: loadData,
    channels: [{ name: 'ticket-updates', event: 'ticket.changed' }],
    intervalMs: 30000,
  });

  const handleMarkAllRead = async () => {
    // 1. Optimistically update local state immediately
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, is_read: true, unread: false }))
    );
    try {
      await markNotificationsRead();
      setSuccess('All notifications marked as read.');
      window.dispatchEvent(new Event('notifications:updated'));
      const data = await getNotifications();
      if (data?.notifications) {
        setNotifications(data.notifications);
      }
    } catch (err) {
      console.error(err);
      setError('Failed to mark notifications as read.');
      loadData();
    }
  };

  const handleMarkOneRead = async (id) => {
    // Optimistically update local state immediately
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true, unread: false } : n))
    );
    try {
      await markNotificationRead(id);
      window.dispatchEvent(new Event('notifications:updated'));
    } catch (err) {
      console.error(err);
    }
  };

  const getNotificationPath = (n) => {
    if (n.data) {
      try {
        const parsed = typeof n.data === 'string' ? JSON.parse(n.data) : n.data;
        if (parsed.link) {
          return parsed.link.startsWith('http') ? new URL(parsed.link).pathname : parsed.link;
        }
        // Handle specific notification types for employees
        const userStr = localStorage.getItem('user');
        let role = '';
        try { role = JSON.parse(userStr)?.role || ''; } catch {}
        if (role === 'employee' && parsed.type) {
          if (parsed.type === 'proof_uploaded' || parsed.type === 'proof_rejected') {
            return '/employee/machine';
          }
          if (parsed.type === 'ticket_assigned' || parsed.type === 'ticket_reassigned') {
            return '/employee/assigned';
          }
          if (parsed.type === 'reassignment_approved' || parsed.type === 'reassignment_denied') {
            return '/employee/assigned';
          }
          if (parsed.type === 'reassignment_request') {
            return '/cs/incoming';
          }
        }
      } catch { }
    }
    if (n.ticket_id) {
      const userStr = localStorage.getItem('user');
      let role = '';
      try { role = JSON.parse(userStr)?.role || ''; } catch {}
      const isAutoClose = /auto-close|auto close|inactivity/i.test((n.title || '') + ' ' + (n.message || ''));
      if (role === 'customer') return '/my-tickets';
      if (role === 'employee') return isAutoClose ? `/employee/history/${n.ticket_id}` : '/employee/machine';
      if (role === 'cs') return '/cs/incoming';
      return '/notifications';
    }
    return null;
  };

  const handleCloseActiveTicket = useCallback(async () => {
    if (activeNotificationId) {
      const nid = activeNotificationId;
      setActiveNotificationId(null);
      setActiveTicket(null);
      try {
        await markNotificationRead(nid);
        window.dispatchEvent(new Event('notifications:updated'));
        await loadData();
      } catch (err) {
        console.warn('Failed to mark notification as read on close:', err);
      }
    } else {
      setActiveTicket(null);
    }
  }, [activeNotificationId, loadData]);

  const handleNotificationClick = async (n) => {
    if (!isNotificationRead(n)) {
      handleMarkOneRead(n.id);
    }

    const parsedData = (() => {
      try { return typeof n.data === 'string' ? JSON.parse(n.data) : n.data || {}; } catch { return {}; }
    })();

    const isSecurityAlert = Boolean(
      parsedData.alert_type === 'security_alert' ||
      parsedData.alert_type === 'system_alert' ||
      parsedData.category ||
      parsedData.incident_id ||
      parsedData.event === 'malware_detected' ||
      /security alert|system alert|malware|sql error|unhandled error|failed login|unusual login/i.test(n.title || '') ||
      /malware|quarantine|brute force/i.test(n.message || '')
    );

    if (isSecurityAlert) {
      if (!n.is_read) {
        handleMarkOneRead(n.id);
      }
      setActiveSecurityIncident({ ...n, data: parsedData });
      return;
    }

    // TS072: Super Admin System-level issues (Application Errors, Failed Logins, SQL Errors, Unusual Logins)
    const isSystemIssue = Boolean(
      parsedData.alert_type === 'system_issue' ||
      parsedData.event === 'system_error' ||
      parsedData.category === 'system_alert' ||
      /failed login|sql error|database error|application error|unusual login|unhandled exception|system error/i.test((n.title || '') + ' ' + (n.message || ''))
    );

    if (isSystemIssue) {
      if (!n.is_read) {
        handleMarkOneRead(n.id);
      }
      setActiveSystemAlert({ ...n, data: parsedData });
      return;
    }

    const ticketId = n.ticket_id || parsedData?.ticket_id;

    const isNewMessage = Boolean(
      parsedData.type === 'new_message' ||
      /new\s+message/i.test(n.title || '') ||
      (parsedData.link && parsedData.link.includes('messages'))
    );

    if (isNewMessage) {
      if (!n.is_read) {
        handleMarkOneRead(n.id);
      }
      const userStr = localStorage.getItem('user');
      let role = '';
      try { role = JSON.parse(userStr)?.role || ''; } catch {}
      let targetPath = parsedData.link;
      if (!targetPath) {
        if (role === 'employee') targetPath = '/employee/messages';
        else if (role === 'cs') targetPath = '/cs/messages';
        else targetPath = '/messages';
      }
      const cleanPath = targetPath.startsWith('http') ? new URL(targetPath).pathname : targetPath.split('?')[0];
      navigate(cleanPath, { state: { selectedTicketId: ticketId } });
      return;
    }

    if (!ticketId) {
      const path = getNotificationPath(n);
      if (path) navigate(path);
      return;
    }
    setActiveTicketLoading(true);
    setActiveNotificationId(n.id);
    try {
      const parsed = parsedData;
      const ticketNum = Number(String(ticketId).replace(/\D/g, ''));
      const full = await getTicketDetails(ticketNum).catch(() => null);
      const base = full || { id: `TKT-${String(ticketId).padStart(4, '0')}`, ticket_ID: ticketId, title: n.title, description: n.message, status: 'Open', priority: 'Medium', customer: '—', timeline: [{ id: 'creation', type: 'system', text: n.message, timestamp: n.created_at }] };
      const isReassignDenied = parsed.type === 'reassignment_denied' ||
        parsed.type === 'reassignment_rejected' ||
        /reassign.*(reject|deni|disapprov)/i.test(n.title || '') ||
        /reassign.*(reject|deni|disapprov)/i.test(n.message || '');

      const csrDenyReason = (isReassignDenied ? (parsed.reason || parsed.reassignmentDenyReason || parsed.denialReason) : '') ||
        (() => {
          if (!isReassignDenied) return '';
          const match = (n.message || '').match(/Reason:\s*"([^"]+)"/i) || (n.message || '').match(/Reason:\s*([^.]+)/i);
          return match && match[1] ? match[1].trim() : '';
        })();

      const isSlaBreachNotif = Boolean(
        parsed.type === 'overdue_sla_breach' ||
        parsed.sla_status === 'Breached' ||
        /sla.*breach|breached/i.test(n.title || '') ||
        /breached.*sla/i.test(n.message || '')
      );

      const merged = {
        ...base,
        id: base.id || `TKT-${String(ticketId).padStart(4, '0')}`,
        ticket_ID: base.ticket_ID || ticketId,
        sla_status: isSlaBreachNotif ? 'Breached' : (base.sla_status || parsed.sla_status || 'On Track'),
        slaStatus: isSlaBreachNotif ? 'Breached' : (base.slaStatus || parsed.sla_status || 'On Track'),
        sla_breached: isSlaBreachNotif || Boolean(base.sla_breached),
        reassignmentReason: isReassignDenied
          ? (base.reassignmentReason || '')
          : (base.reassignmentReason || parsed.reason || parsed.reassignmentReason || ''),
        reassignmentRequested: isReassignDenied
          ? false
          : (base.reassignmentRequested ?? (parsed.type === 'reassignment_request')),
        reassignmentRequestedBy: base.reassignmentRequestedBy ?? parsed.requested_by,
        reassignmentStatus: isReassignDenied ? 'Denied' : base.reassignmentStatus,
        reassignmentDenied: isReassignDenied || base.reassignmentDenied,
        reassignmentDisapproved: isReassignDenied || base.reassignmentDisapproved,
        deniedReassignment: isReassignDenied || base.deniedReassignment,
        reassignmentDenyReason: csrDenyReason || base.reassignmentDenyReason || base.disapprovalReason || '',
        disapprovalReason: csrDenyReason || base.disapprovalReason || base.reassignmentDenyReason || '',
        notificationMessage: n.message,
        notificationTitle: n.title,
        notificationData: parsed,
      };
      if (merged.reassignmentRequested) {
        try {
          const emps = await getAssignableEmployees({ forceRefresh: false }).catch(() => []);
          setActiveEmployees(emps.map((row) => ({ id: Number(row.id ?? row.emp_id), name: row.name || `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.email, status: row.is_active ? 'active' : 'inactive', department: row.department?.trim() || 'Unassigned' })));
        } catch {}
      }
      setActiveTicket(merged);
    } catch (err) {
      console.warn('Failed to load ticket for notification:', err);
      const path = getNotificationPath(n);
      if (path) navigate(path, { state: { focusTicketId: ticketId } });
      setActiveNotificationId(null);
    } finally {
      setActiveTicketLoading(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto font-sans">
      <div className="mb-6">
        <PageHeader
          pattern="B"
          title="Notifications & Alerts"
          subtitle="Stay updated with real-time ticket status updates and remarks."
          actions={
            unreadCount > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleMarkAllRead}
                className="text-xs font-semibold text-accent hover:text-accent cursor-pointer"
              >
                Mark all as read
              </Button>
            ) : null
          }
        />
      </div>

      {success && (
        <div className="mb-6 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-800 p-4 text-sm font-semibold flex items-center gap-3 animate-fadeIn">
          <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
            <CheckCircle2 size={18} />
          </div>
          <span>{success}</span>
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-xl bg-rose-50 border border-rose-100 text-rose-800 p-4 text-sm font-semibold flex items-center gap-3 animate-fadeIn">
          <div className="w-8 h-8 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
            <AlertCircle size={18} />
          </div>
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          <SkeletonLoader variant="ticket-card" />
          <SkeletonLoader variant="ticket-card" />
          <SkeletonLoader variant="ticket-card" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Unified General Notification Feed with Filter Tabs */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-dark-slate">Notifications</h2>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-accent/10 text-accent">
                    {unreadCount} unread
                  </span>
                )}
              </div>

              {/* Notification Filter Toggle (TS Defect 4) */}
              <div className="flex items-center gap-3">
                <div className="inline-flex p-1 bg-slate-100 rounded-xl gap-1">
                  <button
                    type="button"
                    onClick={() => setFilter('all')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                      filter === 'all'
                        ? 'bg-white text-primary shadow-xs'
                        : 'text-muted-slate hover:text-dark-slate'
                    }`}
                  >
                    All <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-slate-200/70 text-slate-700">{notifications.length}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilter('unread')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                      filter === 'unread'
                        ? 'bg-white text-primary shadow-xs'
                        : 'text-muted-slate hover:text-dark-slate'
                    }`}
                  >
                    Unread <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-blue-100 text-blue-700">{unreadCount}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilter('read')}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                      filter === 'read'
                        ? 'bg-white text-primary shadow-xs'
                        : 'text-muted-slate hover:text-dark-slate'
                    }`}
                  >
                    Read <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-slate-200/70 text-slate-700">{readCount}</span>
                  </button>
                </div>
              </div>
            </div>

            {filteredNotifications.length === 0 ? (
              <div className="bg-card rounded-xl border border-border p-12 text-center shadow-xs">
                <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center mx-auto mb-4 border border-border text-slate-400">
                  <Bell size={28} className="text-slate-300" />
                </div>
                <h3 className="text-lg font-bold text-dark-slate">
                  {filter === 'unread' ? 'No unread notifications' : filter === 'read' ? 'No read notifications' : 'All caught up!'}
                </h3>
                <p className="text-sm text-muted-slate mt-1">
                  {filter === 'unread'
                    ? 'You have reviewed all incoming alerts and status updates.'
                    : filter === 'read'
                    ? 'None of your notifications have been marked as read yet.'
                    : 'There are no recent notifications.'}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredNotifications.map((n) => {
                  const isItemUnread = !isNotificationRead(n);
                  const parsedData = (() => {
                    try { return typeof n.data === 'string' ? JSON.parse(n.data) : n.data || {}; } catch { return {}; }
                  })();
                  const isSecurityAlert = Boolean(
                    parsedData.alert_type === 'security_alert' ||
                    parsedData.alert_type === 'system_alert' ||
                    parsedData.category ||
                    parsedData.incident_id ||
                    parsedData.event === 'malware_detected' ||
                    /security alert|system alert|malware|sql error|unhandled error|failed login|unusual login/i.test(n.title || '') ||
                    /malware|quarantine|brute force/i.test(n.message || '')
                  );
                  const isSystemIssue = !isSecurityAlert && Boolean(
                    parsedData.alert_type === 'system_issue' ||
                    parsedData.event === 'system_error' ||
                    parsedData.category === 'system_alert' ||
                    /failed login|sql error|database error|application error|unusual login|unhandled exception|system error/i.test((n.title || '') + ' ' + (n.message || ''))
                  );
                  const isSqlError = isSystemIssue && /sql|database/i.test((n.title || '') + ' ' + (n.message || ''));
                  const isLoginIssue = isSystemIssue && /login|brute/i.test((n.title || '') + ' ' + (n.message || ''));

                  const isSlaBreach = !isSecurityAlert && !isSystemIssue && Boolean(
                    parsedData.type === 'overdue_sla_breach' ||
                    parsedData.sla_status === 'Breached' ||
                    /sla.*breach|breached/i.test(n.title || '') ||
                    /breached.*sla/i.test(n.message || '')
                  );
                  const isAutoClose = !isSecurityAlert && !isSystemIssue && !isSlaBreach && /auto-close|auto close|inactivity/i.test((n.title || '') + ' ' + (n.message || ''));
                  const isNewMessage = !isSecurityAlert && !isSystemIssue && !isSlaBreach && !isAutoClose && Boolean(
                    parsedData.type === 'new_message' ||
                    /new\s+message/i.test(n.title || '') ||
                    (parsedData.link && parsedData.link.includes('messages'))
                  );

                  const category = (parsedData.category || '').toLowerCase();
                  const severity = (parsedData.severity || 'high').toLowerCase();
                  const burstCount = Number(parsedData.burst_count || 1);

                  const renderSecurityIcon = () => {
                    if (category === 'sql_error') return <Database size={20} className="text-destructive" />;
                    if (category === 'failed_login_spike' || category === 'unusual_login') return <KeyRound size={20} className="text-destructive" />;
                    if (category === 'pipeline_health') return <Activity size={20} className="text-destructive" />;
                    return <ShieldAlert size={20} className="text-destructive" />;
                  };

                  const getCategoryLabel = () => {
                    if (category === 'sql_error') return 'SQL Error';
                    if (category === 'unhandled_error') return 'System Error';
                    if (category === 'failed_login_spike') return 'Auth Spike';
                    if (category === 'unusual_login') return 'Unusual Origin';
                    if (category === 'pipeline_health') return 'Pipeline Alert';
                    return 'Security Alert';
                  };

                  const getSeverityStyle = () => {
                    if (severity === 'critical') return 'bg-red-100 text-red-800 border-red-300';
                    if (severity === 'high') return 'bg-rose-100 text-rose-800 border-rose-300';
                    if (severity === 'medium') return 'bg-amber-100 text-amber-800 border-amber-300';
                    return 'bg-slate-100 text-slate-800 border-slate-300';
                  };

                  return (
                    <div
                      key={n.id}
                      onClick={() => handleNotificationClick(n)}
                      className={`bg-card rounded-xl border p-5 shadow-xs flex items-start gap-4 transition-all duration-200 cursor-pointer animate-fadeIn ${
                        isSecurityAlert
                          ? 'border-destructive/30 bg-destructive/5 hover:border-destructive/40 ' + (isItemUnread ? 'border-l-4 border-l-destructive pl-4' : '')
                          : isSystemIssue
                            ? 'border-amber-300 bg-amber-50/25 hover:border-amber-400 ' + (isItemUnread ? 'border-l-4 border-l-amber-600 pl-4' : '')
                            : isSlaBreach
                              ? 'border-red-200 bg-red-50/25 hover:border-red-300 ' + (isItemUnread ? 'border-l-4 border-l-red-600 pl-4' : '')
                              : isAutoClose
                                ? 'border-amber-200 bg-amber-50/20 ' + (isItemUnread ? 'border-l-4 border-l-accent pl-4' : '')
                                : isNewMessage
                                  ? 'border-indigo-200 bg-indigo-50/20 hover:border-indigo-300 ' + (isItemUnread ? 'border-l-4 border-l-indigo-600 pl-4' : '')
                                  : 'border-border hover:border-slate-300 ' + (isItemUnread ? 'border-l-4 border-l-accent pl-4' : '')
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                        isSecurityAlert
                          ? 'bg-destructive/15 text-destructive'
                          : isSystemIssue
                            ? isSqlError
                              ? 'bg-purple-100 text-purple-700'
                              : isLoginIssue
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-rose-100 text-rose-700'
                            : isSlaBreach
                              ? 'bg-red-100 text-red-600'
                              : isAutoClose
                                ? 'bg-amber-100 text-amber-700'
                                : isNewMessage
                                  ? 'bg-indigo-100 text-indigo-700'
                                  : !n.is_read ? 'bg-accent/10 text-accent' : 'bg-muted text-muted-slate'
                      }`}>
                        {isSecurityAlert ? (
                          renderSecurityIcon()
                        ) : isSystemIssue ? (
                          isSqlError ? (
                            <Database size={18} className="text-purple-700" />
                          ) : isLoginIssue ? (
                            <KeyRound size={18} className="text-amber-700" />
                          ) : (
                            <Terminal size={18} className="text-rose-700" />
                          )
                        ) : isSlaBreach ? (
                          <AlertTriangle size={18} className="text-red-600" />
                        ) : isAutoClose ? (
                          <Clock size={18} />
                        ) : isNewMessage ? (
                          <MessageCircle size={18} />
                        ) : (
                          <Bell size={18} />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start mb-1 gap-4">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className={`text-sm font-bold leading-snug ${isSecurityAlert || isSlaBreach || isSystemIssue ? 'text-dark-slate font-black' : 'text-dark-slate'}`}>{n.title}</h3>
                            {isSecurityAlert && (
                              <>
                                <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/20 flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-ping inline-block" />
                                  {getCategoryLabel()}
                                </span>
                                {parsedData.severity && (
                                  <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${getSeverityStyle()}`}>
                                    {severity}
                                  </span>
                                )}
                                {burstCount > 1 && (
                                  <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1">
                                    <Layers size={10} />
                                    +{burstCount} repeat events
                                  </span>
                                )}
                              </>
                            )}
                            {isSystemIssue && (
                              <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-600 animate-ping inline-block" />
                                {isSqlError ? 'SQL Error' : isLoginIssue ? 'Auth Alert' : 'System Issue'}
                              </span>
                            )}
                            {isSlaBreach && (
                              <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-100 text-red-800 border border-red-200 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-ping inline-block" />
                                SLA Breached
                              </span>
                            )}
                            {isAutoClose && (
                              <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                                Auto-Close Notice
                              </span>
                            )}
                            {isNewMessage && (
                              <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800">
                                New Message
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-muted-slate font-semibold whitespace-nowrap">{formatDisplayDate(n.created_at)}</span>
                        </div>
                        <p className={`text-xs leading-relaxed font-medium ${isSecurityAlert || isSlaBreach ? 'text-red-900 font-semibold' : 'text-muted-slate'}`}>{n.message}</p>
                        <div className="flex items-center gap-3 flex-wrap mt-2">
                          {n.ticket_id && (
                            <span className="inline-block text-[9px] font-extrabold text-primary bg-primary/10 px-2 py-0.5 rounded-md">
                              TKT-{String(n.ticket_id).padStart(4, '0')}
                            </span>
                          )}
                          {isSecurityAlert && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-destructive hover:underline">
                              Inspect Incident Details →
                            </span>
                          )}
                          {isSystemIssue && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-950 hover:underline">
                              Inspect System Context &amp; Logs →
                            </span>
                          )}
                          {isSlaBreach && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-700 hover:underline">
                              View Breached Ticket →
                            </span>
                          )}
                          {isNewMessage && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 hover:underline">
                              Open Conversation →
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTicket && (() => { const role = (()=>{ try{ return JSON.parse(localStorage.getItem('user')||'{}')?.role||'';}catch{return ''}})(); const isCSReassign = activeTicket.reassignmentRequested && role==='cs'; return isCSReassign ? (
        <TicketSummary ticket={activeTicket} employees={activeEmployees} onClose={handleCloseActiveTicket} onEdit={()=>{}} onStatusUpdate={async (upd)=>{ try{ if(upd.reassignmentStatus){ const nid=Number(String(activeTicket.ticket_ID||activeTicket.id).replace(/\D/g,'')); const act=upd.reassignmentStatus==='Approved'?'approve':'deny'; await respondReassignment({ticketId:nid, action:act}); } }catch(e){ console.warn(e);} }} />
      ) : (
        <CustomerTicketDetailModal ticket={activeTicket} onClose={handleCloseActiveTicket} onAssign={(t) => { const tid = t?.ticket_ID || activeTicket.ticket_ID || activeTicket.id; handleCloseActiveTicket(); let r = ''; try { r = String(JSON.parse(localStorage.getItem('user') || '{}')?.role || '').toLowerCase(); } catch {} navigate(r === 'employee' || r === 'service' ? '/employee/incoming' : '/cs/incoming', { state: { assignTicketId: tid } }); }} onDiscard={null} onReopen={null} onResolve={null} allowReopen={false} customerName={activeTicket.customer} />
      );})()}

      {activeSecurityIncident && (
        <SecurityIncidentModal
          incident={activeSecurityIncident}
          onClose={() => setActiveSecurityIncident(null)}
          onNavigateAuditLogs={(targetIncidentId) => {
            const incId = targetIncidentId || activeSecurityIncident?.data?.incident_id || activeSecurityIncident?.incident_id;
            setActiveSecurityIncident(null);
            if (incId) {
              navigate(`/superadmin/audit-logs?incidentId=${encodeURIComponent(incId)}`);
            } else {
              navigate('/superadmin/audit-logs');
            }
          }}
        />
      )}

      {activeSystemAlert && (
        <SystemAlertModal
          isOpen={Boolean(activeSystemAlert)}
          onClose={() => setActiveSystemAlert(null)}
          alert={activeSystemAlert}
          onNavigateToLogs={(targetUrl) => {
            setActiveSystemAlert(null);
            navigate(targetUrl);
          }}
        />
      )}

      {activeTicketLoading && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-[1.5px]">
          <div className="bg-card rounded-xl p-6 shadow-2xl flex flex-col items-center gap-4 max-w-xs w-full mx-4 border border-border">
            <Loader2 size={28} className="animate-spin text-primary" />
            <p className="text-sm font-semibold text-dark-slate">Loading ticket...</p>
          </div>
        </div>
      )}
    </div>
  );
}
