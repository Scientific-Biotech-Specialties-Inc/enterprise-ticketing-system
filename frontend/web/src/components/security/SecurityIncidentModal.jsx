import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  FileText,
  User,
  Hash,
  Clock,
  HardDrive,
  Ticket,
  Lock,
  X,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Database,
  KeyRound,
  Activity,
  ChevronDown,
  ChevronUp,
  Globe,
  Server,
  Layers,
  Terminal,
} from 'lucide-react';
import { formatDisplayDate } from '@/utils/dateUtils';
import { getSecurityIncidentDetail } from '@/services/ticketService';

export default function SecurityIncidentModal({ incident, onClose, onNavigateAuditLogs }) {
  const [detailData, setDetailData] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showTrace, setShowTrace] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!incident) return null;

  // Extract base data from payload, handling nested notification or audit log formats
  const rawData = incident.data
    ? (typeof incident.data === 'string' ? JSON.parse(incident.data || '{}') : incident.data)
    : incident;

  const incidentId =
    detailData?.incident?.incident_id ||
    rawData.incident_id ||
    rawData.id ||
    incident.incident_id ||
    incident.id ||
    'INC-SEC-PENDING';

  useEffect(() => {
    let isMounted = true;
    if (incidentId && incidentId !== 'INC-SEC-PENDING' && !rawData.context_data && !rawData.context) {
      setLoadingDetail(true);
      getSecurityIncidentDetail(incidentId)
        .then((res) => {
          if (isMounted && res) {
            setDetailData(res);
          }
        })
        .catch(() => {
          // Keep existing base details if network fetch is not available
        })
        .finally(() => {
          if (isMounted) setLoadingDetail(false);
        });
    }
    return () => {
      isMounted = false;
    };
  }, [incidentId]);

  const mergedIncident = detailData?.incident || rawData;
  const context = detailData?.context || rawData.context || {};

  const isMalware = Boolean(
    mergedIncident.threat_name ||
    mergedIncident.file?.threat_name ||
    rawData.file?.threat_name ||
    rawData.event === 'malware_detected' ||
    /malware|quarantine/i.test(mergedIncident.title || mergedIncident.message || '')
  );

  const category = (mergedIncident.category || rawData.category || (isMalware ? 'malware_detected' : 'system_alert')).toLowerCase();
  const severity = (mergedIncident.severity || rawData.severity || 'high').toLowerCase();
  const burstCount = Number(mergedIncident.burst_count || rawData.burst_count || 1);
  const service = mergedIncident.service || rawData.service || 'ticket-service';
  const endpoint = mergedIncident.endpoint || rawData.endpoint || '';
  const httpMethod = mergedIncident.http_method || rawData.http_method || '';
  const clientIp = mergedIncident.client_ip || rawData.client_ip || rawData.uploader?.ip_address || '127.0.0.1';
  const userAgent = mergedIncident.user_agent || rawData.user_agent || '';
  const userId = mergedIncident.user_id || rawData.user_id || rawData.uploader?.email || rawData.user || 'System';
  const timestamp = mergedIncident.created_at || rawData.timestamp || incident.created_at || new Date().toISOString();
  const firstSeenAt = mergedIncident.first_seen_at || rawData.first_seen_at || timestamp;
  const lastSeenAt = mergedIncident.last_seen_at || rawData.last_seen_at || timestamp;

  // File metadata for malware events
  const uploader = rawData.uploader || {};
  const file = rawData.file || {};
  const ticketId = mergedIncident.ticket_id || rawData.ticket_id || incident.ticket_id;
  const threatName = file.threat_name || rawData.threat_name || 'Malware.Detected';
  const originalName = file.original_name || file.name || rawData.file_name || 'attachment';
  const fileSize = file.size
    ? (file.size > 1024 * 1024
      ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
      : `${(file.size / 1024).toFixed(1)} KB`)
    : 'Unknown size';
  const fileHash = file.hash_sha256 || rawData.hash_sha256 || 'SHA-256 Calculated';
  const quarantineRef = file.quarantine_ref || rawData.quarantine_ref || 'quarantine/isolated';

  // Category title resolution
  const getCategoryTitle = () => {
    switch (category) {
      case 'sql_error':
        return 'Database Query Exception & SQL Error';
      case 'unhandled_error':
        return 'Unhandled Application Error';
      case 'failed_login_spike':
        return 'Authentication Spike & Brute Force Warning';
      case 'unusual_login':
        return 'Anomalous User Login Origin';
      case 'pipeline_health':
        return 'System Alert Delivery Pipeline Health';
      case 'malware_detected':
        return 'Malware Detection & Quarantine Event';
      default:
        return mergedIncident.title || 'System Security Incident';
    }
  };

  const getHeaderGradient = () => {
    if (severity === 'critical') {
      return 'bg-gradient-to-r from-red-700 via-rose-700 to-red-900';
    }
    if (severity === 'high') {
      return 'bg-gradient-to-r from-rose-600 via-rose-700 to-red-800';
    }
    if (severity === 'medium') {
      return 'bg-gradient-to-r from-amber-600 via-amber-700 to-orange-800';
    }
    return 'bg-gradient-to-r from-slate-700 via-slate-800 to-slate-900';
  };

  const getCategoryIcon = () => {
    switch (category) {
      case 'sql_error':
        return <Database size={24} />;
      case 'failed_login_spike':
      case 'unusual_login':
        return <KeyRound size={24} />;
      case 'pipeline_health':
        return <Activity size={24} />;
      default:
        return <ShieldAlert size={24} />;
    }
  };

  const sanitizedTrace = context.sanitized_trace || [];
  const sanitizedSql = context.sanitized_sql || '';
  const sanitizedSnippet = context.sanitized_snippet || '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="security-incident-title"
    >
      <div
        className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-rose-100 overflow-hidden text-gray-800 animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Severity Accent */}
        <div className={`${getHeaderGradient()} text-white p-6 relative`}>
          <button
            type="button"
            onClick={onClose}
            className="absolute top-5 right-5 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>

          <div className="flex items-center gap-3 mb-2">
            <span className="p-2 rounded-xl bg-white/15 border border-white/20 text-white shadow-inner">
              {getCategoryIcon()}
            </span>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-black tracking-widest uppercase px-2.5 py-0.5 rounded-full bg-white/20 text-white">
                  {severity.toUpperCase()} INCIDENT
                </span>
                <span className="text-[11px] font-mono text-rose-100 opacity-90">
                  {incidentId}
                </span>
                {burstCount > 1 && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 flex items-center gap-1">
                    <Layers size={11} /> Burst ({burstCount} events)
                  </span>
                )}
              </div>
              <h2 id="security-incident-title" className="text-xl font-bold tracking-tight text-white mt-1">
                {getCategoryTitle()}
              </h2>
            </div>
          </div>
          <p className="text-xs text-rose-100 leading-relaxed max-w-xl mt-1">
            {mergedIncident.message || 'System level issue detected by enterprise telemetry and routed to Super Admin.'}
          </p>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-sm">
          {/* Status or containment banner */}
          {isMalware ? (
            <div className="rounded-2xl bg-emerald-50/80 border border-emerald-200/80 p-4 flex items-start gap-3.5">
              <CheckCircle2 size={20} className="text-emerald-600 shrink-0 mt-0.5" />
              <div className="text-xs">
                <h3 className="font-bold text-emerald-900">Security Containment: Neutralized</h3>
                <p className="text-emerald-700 mt-0.5 leading-relaxed">
                  The payload was intercepted before reaching persistent ticket storage. Quarantined binaries are isolated and blocked from public download and system execution.
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-amber-50/80 border border-amber-200/80 p-4 flex items-start gap-3.5">
              <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs">
                <h3 className="font-bold text-amber-900">Telemetry Alert & Sanitized Event</h3>
                <p className="text-amber-700 mt-0.5 leading-relaxed">
                  All sensitive variables, credentials, database connection strings, and tokens were scrubbed before alert ingestion and persistent audit logging.
                </p>
              </div>
            </div>
          )}

          {/* Malware specific info or System Incident metadata */}
          {isMalware ? (
            <>
              {/* Threat Classification */}
              <div className="rounded-2xl bg-rose-50/60 border border-rose-200 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle size={16} className="text-rose-600" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-rose-900">
                    Threat Classification
                  </h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-gray-500 block text-[11px]">Detected Threat</span>
                    <span className="font-mono font-bold text-rose-700 text-sm">{threatName}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block text-[11px]">Scanning Engine</span>
                    <span className="font-semibold text-gray-800">ClamAV In-Stream Daemon (zINSTREAM)</span>
                  </div>
                </div>
              </div>

              {/* File details */}
              <div className="border border-gray-100 rounded-2xl p-4 bg-gray-50/60 space-y-3">
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-[#252578]" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-800">
                    Infected File Metadata
                  </h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-gray-500 block text-[11px]">Original Filename</span>
                    <span className="font-semibold text-gray-900 break-all">{originalName}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block text-[11px]">File Size</span>
                    <span className="font-semibold text-gray-800">{fileSize}</span>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-gray-500 block text-[11px] flex items-center gap-1">
                      <Hash size={12} /> SHA-256 Checksum
                    </span>
                    <span className="font-mono text-[11px] text-gray-700 break-all bg-white px-2 py-1 rounded-lg border border-gray-200 block mt-0.5">
                      {fileHash}
                    </span>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="text-gray-500 block text-[11px] flex items-center gap-1">
                      <HardDrive size={12} /> Quarantine Reference
                    </span>
                    <span className="font-mono text-[11px] text-gray-600 break-all bg-white px-2 py-1 rounded-lg border border-gray-200 block mt-0.5">
                      {quarantineRef}
                    </span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* System Incident Overview */}
              <div className="rounded-2xl bg-gray-50/80 border border-gray-200 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Server size={16} className="text-[#252578]" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-800">
                    Incident Origin & Scope
                  </h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-gray-500 block text-[11px]">Microservice Origin</span>
                    <span className="font-semibold text-gray-900 bg-white px-2 py-0.5 rounded border border-gray-200 inline-block">
                      {service}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500 block text-[11px]">HTTP Request</span>
                    <span className="font-mono font-semibold text-gray-800 break-all">
                      {httpMethod ? `${httpMethod} ` : ''}{endpoint || 'Internal Execution'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500 block text-[11px]">Client IP</span>
                    <span className="font-mono font-semibold text-gray-800">{clientIp}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block text-[11px]">User or Principal</span>
                    <span className="font-semibold text-gray-800">{String(userId)}</span>
                  </div>
                  {userAgent && (
                    <div className="sm:col-span-2">
                      <span className="text-gray-500 block text-[11px] flex items-center gap-1">
                        <Globe size={12} /> User Agent
                      </span>
                      <span className="font-mono text-[11px] text-gray-700 break-all bg-white px-2 py-1 rounded-lg border border-gray-200 block mt-0.5">
                        {userAgent}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Burst Information if applicable */}
              {burstCount > 1 && (
                <div className="border border-amber-200 rounded-2xl p-4 bg-amber-50/40 space-y-2">
                  <div className="flex items-center gap-2">
                    <Layers size={16} className="text-amber-700" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-amber-900">
                      Burst Grouping Metrics
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <span className="text-amber-800 block text-[11px]">Aggregated Events</span>
                      <span className="font-bold text-amber-950 text-base">{burstCount}</span>
                    </div>
                    <div>
                      <span className="text-amber-800 block text-[11px]">First Seen</span>
                      <span className="font-medium text-amber-900">{formatDisplayDate(firstSeenAt)}</span>
                    </div>
                    <div>
                      <span className="text-amber-800 block text-[11px]">Last Seen</span>
                      <span className="font-medium text-amber-900">{formatDisplayDate(lastSeenAt)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Technical Context / Sanitized Trace Accordion */}
              {(sanitizedTrace.length > 0 || sanitizedSql || sanitizedSnippet) && (
                <div className="border border-gray-200 rounded-2xl overflow-hidden bg-gray-50/60">
                  <button
                    type="button"
                    onClick={() => setShowTrace(!showTrace)}
                    className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-100/70 transition cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Terminal size={16} className="text-[#252578]" />
                      <span className="text-xs font-bold uppercase tracking-wider text-gray-800">
                        Sanitized Technical Context & Trace
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-gray-500 font-semibold">
                      <span>{showTrace ? 'Hide Trace' : 'View Trace'}</span>
                      {showTrace ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                  </button>

                  {showTrace && (
                    <div className="p-4 pt-0 space-y-3 border-t border-gray-200 bg-slate-950 text-slate-200 font-mono text-[11px] rounded-b-2xl overflow-x-auto">
                      {sanitizedSql && (
                        <div>
                          <div className="text-[10px] uppercase font-bold text-slate-400 py-1">Sanitized SQL Statement:</div>
                          <pre className="p-2.5 rounded bg-slate-900 text-amber-300 overflow-x-auto whitespace-pre-wrap break-all border border-slate-800">
                            {sanitizedSql}
                          </pre>
                        </div>
                      )}
                      {sanitizedSnippet && (
                        <div>
                          <div className="text-[10px] uppercase font-bold text-slate-400 py-1">Code Snippet:</div>
                          <pre className="p-2.5 rounded bg-slate-900 text-sky-300 overflow-x-auto whitespace-pre-wrap break-all border border-slate-800">
                            {sanitizedSnippet}
                          </pre>
                        </div>
                      )}
                      {sanitizedTrace.length > 0 && (
                        <div>
                          <div className="text-[10px] uppercase font-bold text-slate-400 py-1">Sanitized Stack Trace:</div>
                          <div className="p-2.5 rounded bg-slate-900 border border-slate-800 space-y-1">
                            {sanitizedTrace.map((line, idx) => (
                              <div key={idx} className="leading-tight text-slate-300">
                                {line}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Origin and Timing Context */}
          <div className="border border-gray-100 rounded-2xl p-4 bg-gray-50/60 space-y-3">
            <div className="flex items-center gap-2">
              <User size={16} className="text-[#252578]" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-800">
                Timestamp & Ticket Reference
              </h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-gray-500 block text-[11px] flex items-center gap-1">
                  <Clock size={12} /> Event Timestamp
                </span>
                <span className="text-gray-700 font-medium">{formatDisplayDate(timestamp)}</span>
              </div>
              {ticketId && (
                <div>
                  <span className="text-gray-500 block text-[11px] flex items-center gap-1">
                    <Ticket size={12} /> Associated Ticket
                  </span>
                  <span className="font-bold text-[#252578]">TKT-{String(ticketId).padStart(4, '0')}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-3">
          <div className="text-[11px] text-gray-500 flex items-center gap-1.5">
            <Lock size={12} className="text-gray-400" />
            Audit logged to security ledger
          </div>
          <div className="flex items-center gap-2">
            {onNavigateAuditLogs && (
              <button
                type="button"
                onClick={() => onNavigateAuditLogs(incidentId)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#252578] bg-white border border-gray-200 hover:bg-gray-100 rounded-xl transition cursor-pointer"
              >
                <ExternalLink size={13} />
                View in Audit Logs
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-white bg-[#252578] hover:bg-[#1d1d60] rounded-xl transition cursor-pointer shadow-sm"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
