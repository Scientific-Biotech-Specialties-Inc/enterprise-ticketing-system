import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  AlertTriangle,
  ShieldAlert,
  Database,
  Flame,
  Globe,
  KeyRound,
  ServerCrash,
  Clock,
  User,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Copy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDisplayDate } from '@/utils/dateUtils';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';

/**
 * TS072: System Alert Modal for Super Admin
 * Renders technical and operational context for system-level issues:
 * application errors, repeated failed logins, SQL errors, and unusual logins.
 */
export default function SystemAlertModal({
  isOpen,
  onClose,
  alert,
  onNavigateAuditLogs,
}) {
  useLockBodyScroll(isOpen);
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !alert) return null;

  const rawData = alert.data
    ? typeof alert.data === 'string'
      ? (() => {
          try {
            return JSON.parse(alert.data);
          } catch {
            return {};
          }
        })()
      : alert.data
    : {};

  const alertType = String(
    rawData.alert_type ||
      rawData.event_type ||
      rawData.category ||
      alert.type ||
      'system_issue'
  ).toLowerCase();

  const title = alert.title || rawData.title || 'System-Level Alert';
  const message = alert.message || rawData.message || 'A system event requiring Super Admin review occurred.';
  const timestamp = alert.created_at || rawData.timestamp || new Date().toISOString();
  const severity = (rawData.severity || (alertType.includes('login') ? 'High' : 'Critical')).toUpperCase();

  // Categorize styling and icon per issue type
  const getCategoryMeta = () => {
    if (alertType.includes('login') || alertType.includes('auth')) {
      return {
        label: 'Authentication / Brute-Force Alert',
        icon: KeyRound,
        badgeBg: 'bg-rose-50 text-rose-700 border-rose-200',
        headerGrad: 'from-rose-600 via-rose-700 to-red-800',
        searchQuery: rawData.email || 'LOGIN_FAILED',
        module: 'Authentication',
      };
    }
    if (alertType.includes('sql') || alertType.includes('database')) {
      return {
        label: 'Database / SQL Exception',
        icon: Database,
        badgeBg: 'bg-amber-50 text-amber-700 border-amber-200',
        headerGrad: 'from-amber-600 via-amber-700 to-orange-800',
        searchQuery: 'SQL_ERROR',
        module: 'Database',
      };
    }
    if (alertType.includes('unusual') || alertType.includes('suspicious')) {
      return {
        label: 'Unusual Login Activity',
        icon: Globe,
        badgeBg: 'bg-purple-50 text-purple-700 border-purple-200',
        headerGrad: 'from-purple-600 via-indigo-700 to-slate-900',
        searchQuery: rawData.email || 'UNUSUAL_LOGIN',
        module: 'Security',
      };
    }
    // Default application error / unhandled exception
    return {
      label: 'Application Error / Job Failure',
      icon: Flame,
      badgeBg: 'bg-rose-50 text-rose-700 border-rose-200',
      headerGrad: 'from-red-600 via-rose-700 to-slate-900',
      searchQuery: rawData.endpoint || 'APP_ERROR',
      module: 'System',
    };
  };

  const meta = getCategoryMeta();
  const IconComponent = meta.icon;

  const handleGoToAuditLogs = () => {
    onClose();
    if (typeof onNavigateAuditLogs === 'function') {
      onNavigateAuditLogs(meta.searchQuery, meta.module);
    } else {
      navigate(`/superadmin/audit-logs?q=${encodeURIComponent(meta.searchQuery)}`);
    }
  };

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="system-alert-title"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-border overflow-hidden text-slate-800 animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`bg-gradient-to-r ${meta.headerGrad} text-white p-6 relative`}>
          <button
            type="button"
            onClick={onClose}
            className="absolute top-5 right-5 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>

          <div className="flex items-center gap-3 mb-2">
            <span className="p-2.5 rounded-xl bg-white/15 border border-white/20 text-white shadow-inner">
              <IconComponent size={24} />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black tracking-widest uppercase px-2.5 py-0.5 rounded-full bg-white/20 text-white font-sans">
                  {severity} Alert
                </span>
                <span className="text-[11px] font-mono text-white/80">
                  {meta.label}
                </span>
              </div>
              <h2 id="system-alert-title" className="text-xl font-bold tracking-tight text-white mt-1 font-sans">
                {title}
              </h2>
            </div>
          </div>
          <p className="text-xs text-white/90 leading-relaxed max-w-xl mt-1">
            {message}
          </p>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs text-slate-700 flex-1">
          {/* Metadata Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1">
                <Clock size={12} /> Detected At
              </span>
              <p className="font-semibold text-slate-900">{formatDisplayDate(timestamp)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-1">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1">
                <ShieldAlert size={12} /> Target Subsystem / Module
              </span>
              <p className="font-semibold text-slate-900">{rawData.module || meta.module || 'Enterprise Core'}</p>
            </div>
          </div>

          {/* Technical Context Details */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Diagnostic & Audit Context
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4 text-xs">
              <div>
                <span className="text-slate-400 block text-[11px]">Affected User / Subject:</span>
                <span className="font-mono font-medium text-slate-800">
                  {rawData.email || rawData.user_id || rawData.affected_user || 'System Process'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Origin IP Address:</span>
                <span className="font-mono font-medium text-slate-800">
                  {rawData.ip_address || rawData.ip || '127.0.0.1 (Internal Gateway)'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Endpoint / Route:</span>
                <span className="font-mono font-medium text-slate-800">
                  {rawData.endpoint || rawData.route || '/api/ticketing/*'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Environment:</span>
                <span className="font-mono font-medium text-slate-800">
                  {rawData.environment || 'Docker Cluster (Local)'}
                </span>
              </div>
            </div>

            {/* Sanitized Stack / Technical Message */}
            {rawData.details && (
              <div className="mt-3 pt-3 border-t border-slate-200 space-y-1">
                <span className="text-slate-400 block text-[11px] font-medium">Technical Details:</span>
                <pre className="p-3 bg-slate-900 text-slate-100 rounded-xl text-[11px] font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed max-h-36">
                  {typeof rawData.details === 'object'
                    ? JSON.stringify(rawData.details, null, 2)
                    : String(rawData.details)}
                </pre>
              </div>
            )}
          </div>

          {/* Super Admin Advisory Notice */}
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 flex items-start gap-2.5 text-xs text-amber-900">
            <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              This event was captured by the central security monitoring daemon and recorded in the audit log. Credentials and sensitive headers are filtered per repository cryptography invariants.
            </p>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-5 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="px-4 text-xs font-semibold"
          >
            Dismiss
          </Button>
          <Button
            type="button"
            onClick={handleGoToAuditLogs}
            className="bg-[#252578] hover:bg-[#1e1e60] text-white px-5 text-xs font-semibold flex items-center gap-1.5"
          >
            <span>View Full Log in Audit Trail</span>
            <ExternalLink size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}
