import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, User, Bell, PanelLeft, ChevronDown } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { getNotifications, markNotificationRead, markNotificationsRead, getTicketDetails, getAssignableEmployees, getDepartments, respondReassignment } from '@/services/ticketService';
import useRealtimeRefresh from '@/hooks/useRealtimeRefresh';
import NotificationDropdown from '@/components/notifications/NotificationDropdown';
import CustomerTicketDetailModal from '@/components/CustomerTicketDetailModal';
import { TicketSummary } from '@/components/CSModals';
import { getSystemStatus } from '@/services/configurationService';

export default function Header({ sidebarHovered }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notificationDropdownOpen, setNotificationDropdownOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [notificationCount, setNotificationCount] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [activeTicket, setActiveTicket] = useState(null);
  const [activeNotificationId, setActiveNotificationId] = useState(null);
  const [activeEmployees, setActiveEmployees] = useState([]);
  const [activeTicketLoading, setActiveTicketLoading] = useState(false);
  const [systemStatus, setSystemStatus] = useState('Operational');

  useEffect(() => {
    let isMounted = true;
    getSystemStatus().then((st) => {
      if (isMounted && st) setSystemStatus(st);
    }).catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  const basePath = location.pathname.startsWith('/cs')
    ? '/cs'
    : location.pathname.startsWith('/employee')
      ? '/employee'
      : location.pathname.startsWith('/superadmin')
        ? '/superadmin'
        : location.pathname.startsWith('/admin')
          ? '/admin'
          : '';

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    setNotificationLoading(true);
    try {
      const data = await getNotifications();
      setNotifications(data.notifications || []);
      setNotificationCount(data.unread_count || 0);
    } catch (err) {
      console.warn('Failed to fetch notifications:', err);
    } finally {
      setNotificationLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    const handleNotificationsUpdated = () => {
      fetchNotifications();
    };
    window.addEventListener('notifications:updated', handleNotificationsUpdated);
    return () => {
      window.removeEventListener('notifications:updated', handleNotificationsUpdated);
    };
  }, [fetchNotifications]);

  useRealtimeRefresh({
    refresh: fetchNotifications,
    channels: [{ name: 'ticket-updates', event: 'ticket.changed' }],
    intervalMs: 30000,
    deferRefresh: false,
  });

  const handleBellClick = () => {
    setNotificationDropdownOpen((prev) => {
      if (!prev) {
        fetchNotifications();
      }
      return !prev;
    });
  };

  const getNotificationPath = (n) => {
    if (n.data) {
      try {
        const parsed = typeof n.data === 'string' ? JSON.parse(n.data) : n.data;
        if (parsed.link) {
          return parsed.link.startsWith('http') ? new URL(parsed.link).pathname : parsed.link;
        }
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
      } catch {}
    }
    if (n.ticket_id) {
      const userStr = localStorage.getItem('user');
      let role = '';
      try { role = JSON.parse(userStr)?.role || ''; } catch {}
      if (role === 'customer') return '/my-tickets';
      if (role === 'employee') return '/employee/machine';
      if (role === 'cs') return '/cs/incoming';
      return `${basePath}/notifications`;
    }
    return `${basePath}/notifications`;
  };

  const handleCloseActiveTicket = useCallback(async () => {
    if (activeNotificationId) {
      const nid = activeNotificationId;
      setActiveNotificationId(null);
      setActiveTicket(null);
      try {
        await markNotificationRead(nid);
        setNotificationCount((prev) => Math.max(0, prev - 1));
        setNotifications((prev) => prev.map((item) => (item.id === nid ? { ...item, is_read: true, unread: false } : item)));
        window.dispatchEvent(new Event('notifications:updated'));
      } catch (err) {
        console.warn('Failed to mark notification as read on close:', err);
      }
    } else {
      setActiveTicket(null);
    }
  }, [activeNotificationId]);

  const handleNotificationClick = async (n) => {
    setNotificationDropdownOpen(false);
    const ticketId = n.ticket_id;
    const parsed = (() => { try { return typeof n.data === 'string' ? JSON.parse(n.data) : n.data || {}; } catch { return {}; } })();

    // Handle new message notification: navigate directly to messaging thread
    const isNewMessage = parsed.type === 'new_message' ||
      /new\s+message/i.test(n.title || '') ||
      (parsed.link && parsed.link.includes('messages'));

    if (isNewMessage) {
      try {
        await markNotificationRead(n.id);
        setNotificationCount((prev) => Math.max(0, prev - 1));
        setNotifications((prev) => prev.map((item) => (item.id === n.id ? { ...item, is_read: true, unread: false } : item)));
        window.dispatchEvent(new Event('notifications:updated'));
      } catch (err) {
        console.warn('Failed to mark message notification as read:', err);
      }

      const userStr = localStorage.getItem('user');
      let role = '';
      try { role = JSON.parse(userStr)?.role || ''; } catch {}
      let targetPath = parsed.link;
      if (!targetPath) {
        if (role === 'employee') targetPath = '/employee/messages';
        else if (role === 'cs') targetPath = '/cs/messages';
        else targetPath = '/messages';
      }
      const cleanPath = targetPath.startsWith('http') ? new URL(targetPath).pathname : targetPath;
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
      const ticketNum = Number(String(ticketId).replace(/\D/g, ''));
      const full = await getTicketDetails(ticketNum).catch(() => null);
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

      const merged = {
        ...base,
        id: base.id || `TKT-${String(ticketId).padStart(4, '0')}`,
        ticket_ID: base.ticket_ID || ticketId,
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

  const handleMarkAllRead = async () => {
    try {
      await markNotificationsRead();
      setNotificationCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true, unread: false })));
      window.dispatchEvent(new Event('notifications:updated'));
    } catch (err) {
      console.warn('Failed to mark all as read:', err);
    }
  };

  const getPageTitle = () => {
    const p = location.pathname.toLowerCase();
    if (p.includes('/dashboard')) return 'Dashboard';
    if (p.includes('/create-ticket')) return 'Create Ticket';
    if (p.includes('/my-tickets')) return 'My Tickets';
    if (p.includes('/history')) return 'History';
    if (p.includes('/messages')) return 'Messages';
    if (p.includes('/profile')) return 'My Profile';
    if (p.includes('/notifications')) return 'Notifications';
    if (p.includes('/incoming')) return 'Incoming Queue';
    if (p.includes('/assigned')) return 'Assigned Tickets';
    if (p.includes('/machine')) return 'Equipment & Machines';
    if (p.includes('/progress')) return 'Progress Tracking';
    if (p.includes('/ticket-update')) return 'Ticket Update';
    if (p.includes('/ticket-config')) return 'Ticket Configuration';
    if (p.includes('/audit-logs')) return 'Audit Logs';
    if (p.includes('/knowledge-base')) return 'AI Knowledge Base';
    if (p.includes('/settings')) return 'Settings';
    if (p.includes('/employees')) return 'Employee Directory';
    if (p.includes('/reports')) return 'Reports & Analytics';
    if (p.includes('/ai-support')) return 'AI Support Assistant';
    return 'Ticketing System';
  };

  const userInitial = user?.name?.charAt(0)?.toUpperCase() || 'U';

  return (
    <>
      {systemStatus === 'Under Maintenance' && (
        <div className="fixed top-0 left-0 right-0 z-[60] bg-amber-500 text-white text-[11px] font-semibold px-4 py-1 flex items-center justify-center gap-2 shadow-sm text-center">
          <span>⚠ System Notice: Platform is currently in Maintenance Mode. Non-admin operations may be restricted.</span>
        </div>
      )}
      <header className={`fixed ${systemStatus === 'Under Maintenance' ? 'top-6' : 'top-0'} left-0 w-full bg-white/90 backdrop-blur-md border-b border-slate-200 z-30 px-6 py-3.5 flex items-center justify-between shadow-sm transition-all font-sans`}>
        {/* Left Section */}
        <div className="flex items-center sm:ml-20 ml-12">
          <button
            type="button"
            className="p-1.5 rounded-lg text-dark-slate hover:bg-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Toggle navigation"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('toggle-sidebar'));
            }}
          >
            <PanelLeft size={20} className="text-dark-slate" />
          </button>
        </div>

        {/* Right Section (DESIGN.md Section VI.2) */}
        <div className="flex items-center gap-4">
          <div className="relative flex items-center gap-3">
            <button
              data-notification-trigger="true"
              onClick={handleBellClick}
              className="relative p-2 text-dark-slate hover:bg-slate-100 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={`Notifications${notificationCount > 0 ? ` (${notificationCount} unread)` : ''}`}
              aria-expanded={notificationDropdownOpen}
            >
              <Bell size={20} />
              {notificationCount > 0 && (
                <span className="absolute top-0 right-0 min-w-[1.25rem] h-5 px-1 bg-accent text-white rounded-full border-2 border-white flex items-center justify-center text-[10px] font-bold shadow-sm">
                  {notificationCount}
                </span>
              )}
            </button>

            {notificationDropdownOpen && (
              <NotificationDropdown
                notifications={notifications}
                loading={notificationLoading}
                unreadCount={notificationCount}
                basePath={basePath}
                onNotificationClick={handleNotificationClick}
                onMarkAllRead={notificationCount > 0 ? handleMarkAllRead : null}
                onClose={() => setNotificationDropdownOpen(false)}
              />
            )}

            <div className="h-6 w-px bg-slate-200" aria-hidden="true" />

            {/* User Profile Card (Dropdown Trigger) */}
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-3 p-1.5 rounded-xl hover:bg-slate-100/80 transition-colors cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <div className="w-8 h-8 rounded-full bg-[#A7A7C8] text-white flex items-center justify-center text-xs font-bold flex-shrink-0 shadow-sm">
                {userInitial}
              </div>
              <div className="flex flex-col items-start leading-tight text-left">
                <span className="text-sm font-semibold text-dark-slate">{user?.name || 'User'}</span>
                <span className="text-xs text-muted-slate capitalize">{user?.role || ''}</span>
              </div>
              <ChevronDown className="w-4 h-4 text-muted-slate ml-1" />
            </button>

            {dropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />
                <div className="absolute right-0 top-full mt-2 w-48 bg-surface border border-slate-100 rounded-xl shadow-md py-1.5 z-50 animate-fade-slide-in">
                  <button
                    onClick={() => { setDropdownOpen(false); navigate(`${basePath}/profile`); }}
                    className="flex items-center w-full px-4 py-2.5 hover:bg-slate-50 text-dark-slate text-sm font-medium transition-colors cursor-pointer"
                  >
                    <User size={16} className="mr-2.5 text-muted-slate" /> My Profile
                  </button>
                  {import.meta.env.VITE_APP_MODE !== 'customer' && (
                    <button
                      onClick={() => window.location.href = '/'}
                      className="flex items-center w-full px-4 py-2.5 hover:bg-slate-50 text-dark-slate text-sm font-medium transition-colors cursor-pointer"
                    >
                      <Home size={16} className="mr-2.5 text-muted-slate" /> Back to Home
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {activeTicket && activeTicket.reassignmentRequested && (['cs', 'customer service', 'head of cs', 'head of customer service'].includes(user?.role?.toLowerCase()) || (() => { try { const r = JSON.parse(localStorage.getItem('user')||'{}')?.role?.toLowerCase(); return ['cs', 'customer service', 'head of cs', 'head of customer service'].includes(r); } catch { return false; } })()) ? (
        <TicketSummary
          ticket={activeTicket}
          employees={activeEmployees}
          onClose={handleCloseActiveTicket}
          onEdit={() => {}}
          onStatusUpdate={async (updatedFields) => {
            try {
              if (updatedFields.reassignmentStatus) {
                const numericId = Number(String(activeTicket.ticket_ID || activeTicket.id).replace(/\D/g, ''));
                const action = updatedFields.reassignmentStatus === 'Approved' ? 'approve' : 'deny';
                await respondReassignment({ ticketId: numericId, action });
              }
            } catch (e) { console.warn(e); }
          }}
        />
      ) : activeTicket ? (
        <CustomerTicketDetailModal
          ticket={activeTicket}
          onClose={handleCloseActiveTicket}
          onDiscard={null}
          onReopen={null}
          onResolve={null}
          allowReopen={false}
          customerName={activeTicket.customer}
        />
      ) : null}

      {activeTicketLoading && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-[1.5px]">
          <div className="bg-white rounded-xl p-6 shadow-2xl flex flex-col items-center gap-4 max-w-xs w-full mx-4 border border-gray-100">
            <div className="w-10 h-10 border-4 border-[#252578]/10 border-t-[#252578] rounded-full animate-spin" />
            <p className="text-sm font-semibold text-[#252578]">Loading ticket...</p>
          </div>
        </div>
      )}
    </>
  );
}

