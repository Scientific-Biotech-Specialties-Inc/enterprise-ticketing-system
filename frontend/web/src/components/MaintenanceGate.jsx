import React, { useState, useEffect, useCallback } from 'react';
import { Wrench, RefreshCw, LogOut, ShieldAlert, Clock, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { getSystemStatus } from '@/services/configurationService';
import echo from '@/services/echo';

/**
 * MaintenanceGate
 *
 * Restricts customer and employee access whenever the platform is set to
 * "Under Maintenance". SuperAdmin and Admin users are exempt to allow system
 * configuration and restoration.
 */
export default function MaintenanceGate({ children }) {
  const { user, logout } = useAuth();
  const [status, setStatus] = useState('Operational');
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState(null);
  const [checkNotice, setCheckNotice] = useState('');

  const isExempt =
    user?.role === 'superadmin' ||
    user?.role === 'admin' ||
    user?.role === 'systemadministrator';

  const checkStatus = useCallback(async (isManual = false) => {
    if (isManual) setChecking(true);
    try {
      const currentStatus = await getSystemStatus();
      if (currentStatus) {
        setStatus(currentStatus);
        setLastChecked(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        if (isManual) {
          if (currentStatus === 'Under Maintenance') {
            setCheckNotice('The system is still under maintenance. Please try again shortly.');
          } else {
            setCheckNotice('The system is operational! Access restored.');
          }
        }
      }
    } catch (err) {
      console.warn('[MaintenanceGate] Failed to fetch system status:', err);
      if (isManual) {
        setCheckNotice('Unable to reach server. Please check your connection.');
      }
    } finally {
      if (isManual) {
        setTimeout(() => setChecking(false), 400);
        setTimeout(() => setCheckNotice(''), 4000);
      }
    }
  }, []);

  useEffect(() => {
    // Initial fetch
    checkStatus(false);

    // Listen for WebSocket broadcast events from configuration-service
    const channels = ['system-status', 'ticket-updates', 'ticket-config'];
    const eventNames = ['system.status.updated', '.system.status.updated'];

    const subscriptions = [];

    channels.forEach((chName) => {
      try {
        const ch = echo.channel(chName);
        eventNames.forEach((evName) => {
          const handler = (payload) => {
            const nextStatus = payload?.status || (payload?.key === 'system_status' ? payload?.status : null);
            if (nextStatus) {
              setStatus(nextStatus);
              setLastChecked(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
            }
          };
          ch.listen(evName, handler);
          subscriptions.push({ ch, evName });
        });
      } catch (e) {
        console.warn(`[MaintenanceGate] Channel ${chName} subscription error:`, e);
      }
    });

    // Cross-tab/window event
    const handleLocalStatusChanged = (e) => {
      const next = e?.detail?.status;
      if (next) {
        setStatus(next);
        setLastChecked(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      }
    };
    window.addEventListener('system:status-changed', handleLocalStatusChanged);

    // Polling fallback every 20 seconds to keep clients synchronized
    const interval = setInterval(() => {
      checkStatus(false);
    }, 20000);

    return () => {
      clearInterval(interval);
      window.removeEventListener('system:status-changed', handleLocalStatusChanged);
      subscriptions.forEach(({ ch, evName }) => {
        try {
          if (ch?.stopListening) ch.stopListening(evName);
        } catch {}
      });
    };
  }, [checkStatus]);

  // Exempt administrators from the maintenance block
  if (isExempt) {
    return <>{children}</>;
  }

  // If system is operational, render children normally
  if (status !== 'Under Maintenance') {
    return <>{children}</>;
  }

  // System is Under Maintenance: display modern, friendly maintenance message
  return (
    <div className="w-full py-8 px-4 flex items-center justify-center min-h-[70vh]">
      <div className="max-w-xl w-full bg-white rounded-3xl shadow-xl border border-amber-200/80 p-8 sm:p-10 text-center relative overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Subtle decorative gradient top bar */}
        <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600" />

        {/* Ambient glow */}
        <div className="absolute -top-16 -right-16 w-36 h-36 bg-amber-100 rounded-full blur-3xl opacity-60 pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-36 h-36 bg-blue-100 rounded-full blur-3xl opacity-60 pointer-events-none" />

        {/* Icon */}
        <div className="relative mx-auto w-20 h-20 rounded-3xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shadow-sm mb-6">
          <Wrench className="w-10 h-10 animate-pulse text-amber-600" />
          <span className="absolute -top-1 -right-1 flex h-4 w-4">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-4 w-4 bg-amber-500" />
          </span>
        </div>

        {/* Status Pill */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-200 mb-4">
          <Clock size={13} className="text-amber-700" />
          System Maintenance Active
        </div>

        {/* Heading */}
        <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
          Sorry, the system is under maintenance
        </h2>

        {/* Subtitle */}
        <p className="text-sm text-gray-600 mt-3 leading-relaxed max-w-md mx-auto">
          Our team is currently performing scheduled platform maintenance and upgrades. Customer and employee operations are temporarily paused while improvements are finalized.
        </p>

        {/* Key Info Points */}
        <div className="mt-6 bg-amber-50/60 rounded-2xl border border-amber-200/60 p-4 text-left space-y-2.5 text-xs text-gray-700">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 size={15} className="text-emerald-600 mt-0.5 shrink-0" />
            <span>All tickets, messages, and drafts remain safe and preserved in our database.</span>
          </div>
          <div className="flex items-start gap-2.5">
            <ShieldAlert size={15} className="text-amber-600 mt-0.5 shrink-0" />
            <span>Ticket submission and assignments will automatically resume once maintenance ends.</span>
          </div>
        </div>

        {/* Real-time status feedback note */}
        {checkNotice && (
          <div className="mt-4 text-xs font-semibold px-3 py-2 rounded-xl bg-gray-100 text-gray-700 border border-gray-200 transition-all">
            {checkNotice}
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => checkStatus(true)}
            disabled={checking}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-[#252578] hover:bg-[#1a1a5e] text-white px-5 py-2.5 text-xs font-bold transition-all shadow-md hover:shadow-lg disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw size={14} className={checking ? 'animate-spin' : ''} />
            {checking ? 'Checking Status…' : 'Check Status Again'}
          </button>

          <button
            type="button"
            onClick={async () => {
              const isCust = user?.role === 'customer' || import.meta.env.VITE_APP_MODE === 'customer';
              await logout();
              window.location.replace(isCust ? '/customer' : '/');
            }}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 px-5 py-2.5 text-xs font-bold transition-all shadow-xs cursor-pointer"
          >
            <LogOut size={14} className="text-gray-500" />
            Sign Out
          </button>
        </div>

        {lastChecked && (
          <p className="mt-4 text-[11px] text-gray-400">
            Last checked: {lastChecked} &bull; Auto-syncing
          </p>
        )}
      </div>
    </div>
  );
}
