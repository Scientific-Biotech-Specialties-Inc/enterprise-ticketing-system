import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import NotificationItem from './NotificationItem';
import EmptyState from './EmptyState';
import LoadingState from './LoadingState';

const isNotificationRead = (n) => {
  if (!n) return false;
  if (n.is_read === true || n.is_read === 1 || n.is_read === '1' || n.is_read === 'true') return true;
  if (n.is_read === false || n.is_read === 0 || n.is_read === '0' || n.is_read === 'false') return false;
  return !Boolean(n.unread);
};

export default function NotificationDropdown({
  notifications = [],
  loading = false,
  unreadCount = 0,
  basePath = '',
  onNotificationClick,
  onMarkAllRead,
  onClose,
}) {
  const dropdownRef = useRef(null);
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all'); // 'all' | 'unread'

  const effectiveUnreadCount = useMemo(() => {
    return unreadCount > 0 ? unreadCount : notifications.filter(n => !isNotificationRead(n)).length;
  }, [unreadCount, notifications]);

  const filteredNotifications = useMemo(() => {
    if (filter === 'unread') {
      return notifications.filter(n => !isNotificationRead(n));
    }
    return notifications;
  }, [notifications, filter]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    const handleOutsideClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        if (!e.target.closest('[data-notification-trigger]')) {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [onClose]);

  const handleViewAll = () => {
    onClose();
    navigate(`${basePath}/notifications`);
  };

  const handleItemClick = (notification) => {
    onNotificationClick(notification);
  };

  return (
    <div
      ref={dropdownRef}
      className="fixed inset-x-2 top-16 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full mt-2 sm:w-96 max-w-[calc(100vw-1rem)] bg-white border border-gray-100 rounded-2xl shadow-xl z-50 animate-fade-slide-in overflow-hidden font-sans"
      role="menu"
      aria-label="Notifications"
    >
      <div className="px-4 py-3 border-b border-gray-100 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-gray-800">Notifications</h3>
            {effectiveUnreadCount > 0 && (
              <span className="bg-accent text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
                {effectiveUnreadCount}
              </span>
            )}
          </div>
          {effectiveUnreadCount > 0 && onMarkAllRead && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onMarkAllRead(e);
              }}
              className="text-[11px] font-bold text-accent hover:text-primary transition-colors cursor-pointer"
            >
              Mark all read
            </button>
          )}
        </div>

        {/* Toggle filter tabs (TS Defect 4) */}
        <div className="inline-flex p-0.5 bg-slate-100 rounded-lg gap-1 w-fit">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all cursor-pointer ${
              filter === 'all'
                ? 'bg-white text-primary shadow-xs'
                : 'text-muted-slate hover:text-dark-slate'
            }`}
          >
            All ({notifications.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('unread')}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all cursor-pointer ${
              filter === 'unread'
                ? 'bg-white text-primary shadow-xs'
                : 'text-muted-slate hover:text-dark-slate'
            }`}
          >
            Unread ({effectiveUnreadCount})
          </button>
        </div>
      </div>

      <div className="max-h-[420px] overflow-y-auto overscroll-contain">
        {loading ? (
          <LoadingState />
        ) : filteredNotifications.length === 0 ? (
          <div className="py-8 text-center px-4">
            <p className="text-xs font-semibold text-dark-slate">
              {filter === 'unread' ? 'No unread notifications' : 'No notifications'}
            </p>
            <p className="text-[11px] text-muted-slate mt-0.5">
              {filter === 'unread' ? 'All caught up!' : 'No recent alerts or updates.'}
            </p>
          </div>
        ) : (
          filteredNotifications.map((n, idx) => (
            <NotificationItem
              key={n.id || idx}
              notification={n}
              onClick={handleItemClick}
              isLast={idx === filteredNotifications.length - 1}
            />
          ))
        )}
      </div>

      <div className="border-t border-gray-100 px-4 py-2.5">
        <button
          onClick={handleViewAll}
          className="w-full text-center text-xs font-bold text-gray-600 hover:text-primary transition-colors py-1 cursor-pointer"
        >
          View all notifications →
        </button>
      </div>
    </div>
  );
}
