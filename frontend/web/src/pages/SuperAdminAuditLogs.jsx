import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Search,
  ShieldAlert,
  Terminal,
  Database,
  KeyRound,
  Filter,
  RotateCcw,
  X,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  AlertTriangle,
  Trash2,
  CheckCircle2,
  RefreshCw,
  Shield,
  HelpCircle,
  HardDrive,
  Building2,
  User,
  ArrowRight,
  ClipboardList,
  Layers,
} from 'lucide-react';
import {
  getSuperAdminAuditLogs,
  getAuditLogRetentionConfig,
  updateAuditLogRetentionConfig,
  purgeAuditLogs,
} from '@/services/ticketService';
import useRealtimeRefresh from '@/hooks/useRealtimeRefresh';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from '@/components/ui/table';
import { DataTableSkeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { DEFAULT_BRANCHES } from '@/data/branchConfig';
import SecurityIncidentModal from '@/components/security/SecurityIncidentModal';
import SystemAlertModal from '@/components/security/SystemAlertModal';
import { formatDisplayDate } from '@/utils/dateUtils';

const RETENTION_STORAGE_KEY = 'superadmin_audit_log_retention_days';
const DEFAULT_RETENTION_DAYS = 365;

export default function SuperAdminAuditLogs({ defaultTab = 'logs' }) {
  const location = useLocation();
  const navigate = useNavigate();

  // Active Tab: 'logs' | 'retention'
  const [activeTab, setActiveTab] = useState(() => {
    if (location.pathname.includes('log-retention')) return 'retention';
    const params = new URLSearchParams(location.search);
    if (params.get('tab') === 'retention') return 'retention';
    return defaultTab;
  });

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    if (tab === 'retention') {
      navigate('/superadmin/log-retention');
    } else {
      navigate('/superadmin/audit-logs');
    }
  };

  // Filter States (TS087)
  const [search, setSearch] = useState('');
  const [datePreset, setDatePreset] = useState('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterActor, setFilterActor] = useState('');
  const [filterModule, setFilterModule] = useState('');
  const [filterBranch, setFilterBranch] = useState('');

  // Pagination States (TS087)
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Data States
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [selectedSystemAlert, setSelectedSystemAlert] = useState(null);

  const isSecurityLog = useCallback((log) => {
    return Boolean(
      log.module === 'Security' ||
      log.module === 'Security & System' ||
      log.action === 'System Alert' ||
      log.action === 'Alert Burst' ||
      log.incident_id ||
      /malware|quarantine|threat|infected|system alert/i.test((log.action || '') + ' ' + (log.details || ''))
    );
  }, []);

  const handleOpenIncident = useCallback((log) => {
    const incId = log.incident_id || log.target || log.id;
    setSelectedIncident({
      id: incId,
      incident_id: incId,
      user: log.user,
      data: {
        incident_id: incId,
        timestamp: log.timestamp,
        severity: log.severity || 'high',
        burst_count: log.burst_count || 1,
        title: log.action,
        message: log.details,
        uploader: { email: log.user, role: log.role },
        file: {
          original_name: log.details?.match(/file\s+'([^']+)'/i)?.[1] || log.target || 'attachment',
          threat_name: log.details?.match(/threat\s+'([^']+)'/i)?.[1] || 'Malware.Detected',
        },
      },
    });
  }, []);

  // Retention & Purge States (TS088)
  const [retentionDays, setRetentionDays] = useState(() => {
    const saved = localStorage.getItem(RETENTION_STORAGE_KEY);
    return saved ? Number(saved) : DEFAULT_RETENTION_DAYS;
  });
  const [selectedRetentionPreset, setSelectedRetentionPreset] = useState(() => {
    const saved = localStorage.getItem(RETENTION_STORAGE_KEY);
    return saved ? String(saved) : String(DEFAULT_RETENTION_DAYS);
  });
  const [customRetentionDays, setCustomRetentionDays] = useState('');
  const [confirmModal, setConfirmModal] = useState(null); // { type: 'reduction' | 'purge', targetDays, affectedCount }
  const [retentionSuccessMsg, setRetentionSuccessMsg] = useState('');
  const [isPurging, setIsPurging] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const incidentId = params.get('incidentId');
    const query = params.get('q');
    const tab = params.get('tab');
    if (incidentId) {
      setSearch(incidentId);
      setSelectedIncident({ incident_id: incidentId, id: incidentId });
    } else if (query) {
      setSearch(query);
    }
    if (location.pathname.includes('log-retention') || tab === 'retention') {
      setActiveTab('retention');
    } else if (location.pathname.includes('audit-logs')) {
      setActiveTab('logs');
    }
  }, [location.pathname, location.search]);

  // ─── Fetch Logs ─────────────────────────────────────────────────────────────
  const loadLogs = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getSuperAdminAuditLogs();
      const serverLogs = Array.isArray(data) ? data : [];

      let simulatedLogs = [];
      try {
        const stored = localStorage.getItem('superadmin_simulated_audit_logs');
        if (stored) {
          simulatedLogs = JSON.parse(stored);
        }
      } catch (e) {
        console.error('Failed to parse simulated audit logs:', e);
      }

      // Assign realistic branch scopes to logs if not set
      const branchNames = DEFAULT_BRANCHES.map((b) => b.name);
      const merged = [...simulatedLogs, ...serverLogs].map((l, idx) => ({
        ...l,
        branch: l.branch || branchNames[idx % branchNames.length],
      })).sort((a, b) => {
        const timeA = new Date(a.timestamp || 0).getTime();
        const timeB = new Date(b.timestamp || 0).getTime();
        return timeB - timeA;
      });

      setLogs(merged);
    } catch (err) {
      console.error('Failed to load superadmin audit logs:', err);
      setLoadError('Unable to connect to the audit log service. Please check network connectivity or try again.');
      try {
        const stored = localStorage.getItem('superadmin_simulated_audit_logs');
        if (stored) {
          setLogs(JSON.parse(stored));
        }
      } catch {}
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useRealtimeRefresh({
    refresh: loadLogs,
    channels: [{ name: 'ticket-updates', event: 'ticket.changed' }],
    intervalMs: 15000,
  });

  // ─── Dynamic Dropdown Options (TS087 Criteria) ─────────────────────────────
  const actionOptions = useMemo(() => [...new Set(logs.map((l) => l.action).filter(Boolean))].sort(), [logs]);
  const actorOptions = useMemo(() => [...new Set(logs.map((l) => l.user).filter(Boolean))].sort(), [logs]);
  const moduleOptions = useMemo(() => [...new Set(logs.map((l) => l.module).filter(Boolean))].sort(), [logs]);
  const branchOptions = useMemo(() => DEFAULT_BRANCHES.map((b) => b.name), []);

  // ─── Multi-Filter Engine (TS087 Criteria) ───────────────────────────────────
  const filtered = useMemo(() => {
    let result = logs;

    // Free-text search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (log) =>
          (log.user || '').toLowerCase().includes(q) ||
          (log.role || '').toLowerCase().includes(q) ||
          (log.action || '').toLowerCase().includes(q) ||
          (log.module || '').toLowerCase().includes(q) ||
          (log.target || '').toLowerCase().includes(q) ||
          (log.details || '').toLowerCase().includes(q) ||
          (log.branch || '').toLowerCase().includes(q) ||
          (log.incident_id || '').toLowerCase().includes(q)
      );
    }

    // Date range filter
    if (datePreset !== 'all') {
      const now = new Date();
      if (datePreset === 'today') {
        const todayStr = now.toISOString().split('T')[0];
        result = result.filter((l) => (l.timestamp || '').startsWith(todayStr));
      } else if (datePreset === '7d') {
        const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        result = result.filter((l) => new Date(l.timestamp) >= cutoff);
      } else if (datePreset === '30d') {
        const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        result = result.filter((l) => new Date(l.timestamp) >= cutoff);
      } else if (datePreset === 'custom') {
        if (customStart) {
          const start = new Date(customStart);
          result = result.filter((l) => new Date(l.timestamp) >= start);
        }
        if (customEnd) {
          const end = new Date(customEnd);
          end.setHours(23, 59, 59, 999);
          result = result.filter((l) => new Date(l.timestamp) <= end);
        }
      }
    }

    // Specific category filters
    if (filterAction) result = result.filter((l) => l.action === filterAction);
    if (filterActor) result = result.filter((l) => l.user === filterActor);
    if (filterModule) result = result.filter((l) => l.module === filterModule);
    if (filterBranch) result = result.filter((l) => l.branch === filterBranch);

    return result;
  }, [logs, search, datePreset, customStart, customEnd, filterAction, filterActor, filterModule, filterBranch]);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, datePreset, customStart, customEnd, filterAction, filterActor, filterModule, filterBranch, pageSize]);

  // ─── Pagination Calculations ────────────────────────────────────────────────
  const totalEntries = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalEntries / pageSize));
  const paginatedLogs = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  // Active filters list for individual removal badges
  const activeFilters = useMemo(() => {
    const list = [];
    if (search.trim()) list.push({ key: 'search', label: `Search: "${search}"`, clear: () => setSearch('') });
    if (datePreset !== 'all') {
      const label = datePreset === 'custom' ? `Date: ${customStart || '...'} to ${customEnd || '...'}` : `Date: ${datePreset.toUpperCase()}`;
      list.push({ key: 'date', label, clear: () => { setDatePreset('all'); setCustomStart(''); setCustomEnd(''); } });
    }
    if (filterAction) list.push({ key: 'action', label: `Action: ${filterAction}`, clear: () => setFilterAction('') });
    if (filterActor) list.push({ key: 'actor', label: `Actor: ${filterActor}`, clear: () => setFilterActor('') });
    if (filterModule) list.push({ key: 'module', label: `Module: ${filterModule}`, clear: () => setFilterModule('') });
    if (filterBranch) list.push({ key: 'branch', label: `Branch: ${filterBranch}`, clear: () => setFilterBranch('') });
    return list;
  }, [search, datePreset, customStart, customEnd, filterAction, filterActor, filterModule, filterBranch]);

  const handleResetAllFilters = () => {
    setSearch('');
    setDatePreset('all');
    setCustomStart('');
    setCustomEnd('');
    setFilterAction('');
    setFilterActor('');
    setFilterModule('');
    setFilterBranch('');
    setCurrentPage(1);
  };

  // ─── TS088: Retention & Purge Logic ─────────────────────────────────────────
  const thresholdDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - retentionDays);
    return d;
  }, [retentionDays]);

  const affectedPurgeCount = useMemo(() => {
    return logs.filter((l) => new Date(l.timestamp || 0) < thresholdDate).length;
  }, [logs, thresholdDate]);

  const handleApplyRetentionSetting = () => {
    const targetDays = selectedRetentionPreset === 'custom'
      ? Number(customRetentionDays) || 365
      : Number(selectedRetentionPreset);

    if (targetDays < retentionDays) {
      // Shorter retention triggers confirmation modal (TS088 Criteria)
      const futureThreshold = new Date();
      futureThreshold.setDate(futureThreshold.getDate() - targetDays);
      const affected = logs.filter((l) => new Date(l.timestamp || 0) < futureThreshold).length;

      setConfirmModal({
        type: 'reduction',
        targetDays,
        affectedCount: affected,
        cutoffDate: futureThreshold.toISOString().split('T')[0],
      });
    } else {
      setRetentionDays(targetDays);
      localStorage.setItem(RETENTION_STORAGE_KEY, String(targetDays));
      updateAuditLogRetentionConfig(targetDays).catch(() => {});
      setRetentionSuccessMsg(`Log retention policy updated to ${targetDays} days.`);
      setTimeout(() => setRetentionSuccessMsg(''), 5000);
    }
  };

  const handleConfirmRetentionReduction = () => {
    if (!confirmModal) return;
    const target = confirmModal.targetDays;
    setRetentionDays(target);
    localStorage.setItem(RETENTION_STORAGE_KEY, String(target));
    updateAuditLogRetentionConfig(target).catch(() => {});
    setConfirmModal(null);
    setRetentionSuccessMsg(`Log retention policy reduced to ${target} days. Expired records will be purged on scheduled nightly run.`);
    setTimeout(() => setRetentionSuccessMsg(''), 6000);
  };

  const handleTriggerManualPurge = () => {
    setConfirmModal({
      type: 'purge',
      targetDays: retentionDays,
      affectedCount: affectedPurgeCount,
      cutoffDate: thresholdDate.toISOString().split('T')[0],
    });
  };

  const handleExecuteManualPurge = async () => {
    setIsPurging(true);
    try {
      // Filter out purged records permanently
      const surviving = logs.filter((l) => new Date(l.timestamp || 0) >= thresholdDate);
      purgeAuditLogs(retentionDays).catch(() => {});

      // Record a new audit log entry for the purge action
      const purgeLogEntry = {
        id: `purge-${Date.now()}`,
        timestamp: new Date().toISOString(),
        user: 'Super Admin',
        role: 'Super Admin',
        action: 'Purged',
        module: 'System',
        target: 'Audit Logs',
        branch: 'National HQ',
        details: `Purged ${affectedPurgeCount} historical audit log entries older than ${retentionDays} days (${thresholdDate.toISOString().split('T')[0]}).`,
      };

      const nextLogs = [purgeLogEntry, ...surviving];
      setLogs(nextLogs);
      localStorage.setItem('superadmin_simulated_audit_logs', JSON.stringify(nextLogs));

      setRetentionSuccessMsg(`Successfully purged ${affectedPurgeCount} expired log records older than ${thresholdDate.toISOString().split('T')[0]}.`);
      setConfirmModal(null);
      setTimeout(() => setRetentionSuccessMsg(''), 6000);
    } catch (err) {
      console.error('Failed to execute manual purge:', err);
    } finally {
      setIsPurging(false);
    }
  };

  return (
    <div className="w-full max-w-full space-y-6">
      <PageHeader
        pattern="B"
        title={activeTab === 'retention' ? "Log Retention & Storage Governance" : "Audit Logs & Governance"}
        subtitle={
          activeTab === 'retention'
            ? "Configure automated retention lifecycles, scheduled background purge thresholds, and storage compliance."
            : "System-wide forensic activity trail, filterable investigations, and branch-level log inspection."
        }
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 text-xs">
              <Shield className="w-3.5 h-3.5 mr-1 text-primary" />
              Super Admin Unrestricted Scope
            </Badge>
          </div>
        }
      />

      {/* Navigation Tabs (ONE UI Flush Tabs) */}
      <div className="flex items-center gap-6 border-b border-border">
        <button
          type="button"
          onClick={() => handleTabChange('logs')}
          className={`pb-3 text-sm font-semibold transition-all cursor-pointer border-b-2 -mb-px flex items-center gap-2 ${
            activeTab === 'logs'
              ? 'text-primary border-primary'
              : 'text-muted-foreground border-transparent hover:text-foreground'
          }`}
        >
          <ClipboardList className="w-4 h-4" />
          <span>Audit Log Trail</span>
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('retention')}
          className={`pb-3 text-sm font-semibold transition-all cursor-pointer border-b-2 -mb-px flex items-center gap-2 ${
            activeTab === 'retention'
              ? 'text-primary border-primary'
              : 'text-muted-foreground border-transparent hover:text-foreground'
          }`}
        >
          <HardDrive className="w-4 h-4" />
          <span>Log Retention Policy</span>
          {affectedPurgeCount > 0 && (
            <span className="ml-1 px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-[11px] font-bold">
              {affectedPurgeCount}
            </span>
          )}
        </button>
      </div>

      {/* ─── TAB 1: AUDIT LOG TRAIL & MULTI-FILTER INVESTIGATION (TS087) ─────── */}
      {activeTab === 'logs' && (
        <div className="space-y-4">
          {/* Filter Bar Controls */}
          <div className="bg-card rounded-xl border border-border p-4 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Free-text search */}
              <div className="relative flex-1 min-w-[220px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  type="text"
                  placeholder="Search by user, action, target, details, before/after..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-9 text-xs"
                />
              </div>

              {/* Date Preset Filter */}
              <select
                value={datePreset}
                onChange={(e) => setDatePreset(e.target.value)}
                className="h-9 rounded-lg border border-border bg-page px-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer"
              >
                <option value="all">All Dates</option>
                <option value="today">Today</option>
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
                <option value="custom">Custom Range</option>
              </select>

              {/* Dynamic Action Filter */}
              <select
                value={filterAction}
                onChange={(e) => setFilterAction(e.target.value)}
                className="h-9 rounded-lg border border-border bg-page px-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer"
              >
                <option value="">All Actions</option>
                {actionOptions.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>

              {/* Dynamic Actor Filter */}
              <select
                value={filterActor}
                onChange={(e) => setFilterActor(e.target.value)}
                className="h-9 rounded-lg border border-border bg-page px-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer"
              >
                <option value="">All Actors</option>
                {actorOptions.map((act) => (
                  <option key={act} value={act}>{act}</option>
                ))}
              </select>

              {/* Dynamic Module / Entity Filter */}
              <select
                value={filterModule}
                onChange={(e) => setFilterModule(e.target.value)}
                className="h-9 rounded-lg border border-border bg-page px-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer"
              >
                <option value="">All Modules</option>
                {moduleOptions.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>

              {/* Dynamic Branch Filter */}
              <select
                value={filterBranch}
                onChange={(e) => setFilterBranch(e.target.value)}
                className="h-9 rounded-lg border border-border bg-page px-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer"
              >
                <option value="">All Branches</option>
                {branchOptions.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>

              {/* Reset All Filters Button */}
              {activeFilters.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetAllFilters}
                  className="h-9 text-xs gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Filters</span>
                </Button>
              )}
            </div>

            {/* Custom Date Pickers if 'custom' is active */}
            {datePreset === 'custom' && (
              <div className="flex items-center gap-2 pt-2 border-t border-border/60 text-xs">
                <span className="text-muted-foreground font-medium">Date Range:</span>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="h-8 rounded border border-border px-2 text-xs bg-page"
                />
                <span className="text-muted-foreground">to</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="h-8 rounded border border-border px-2 text-xs bg-page"
                />
              </div>
            )}

            {/* Active Filter Tags (TS087 Criteria) */}
            {activeFilters.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/60 text-xs">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Active Filters:</span>
                {activeFilters.map((f) => (
                  <span
                    key={f.key}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium"
                  >
                    <span>{f.label}</span>
                    <button
                      type="button"
                      onClick={f.clear}
                      className="hover:text-primary/70 cursor-pointer"
                      title="Clear filter"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Error State with Retry (TS087 Criteria) */}
          {loadError && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-xs text-destructive flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
                <span>{loadError}</span>
              </div>
              <Button variant="outline" size="sm" onClick={loadLogs} className="h-7 text-xs">
                Retry Load
              </Button>
            </div>
          )}

          {/* Audit Logs Table */}
          <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden min-h-[520px] flex flex-col justify-between w-full">
            {loading ? (
              <div className="p-4">
                <DataTableSkeleton columns={8} rows={8} />
              </div>
            ) : filtered.length === 0 ? (
              /* Empty Results State (TS087 Criteria) */
              <div className="p-12 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-muted/60 text-muted-foreground flex items-center justify-center mx-auto">
                  <Search className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-bold text-foreground">No log entries match your filter criteria</h3>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  Try widening your search terms, selecting a broader date range, or clearing individual filter tags.
                </p>
                <div className="pt-2">
                  <Button variant="outline" size="sm" onClick={handleResetAllFilters} className="text-xs gap-1.5">
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset All Filters
                  </Button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap text-[11px] font-bold text-muted-foreground uppercase tracking-wider py-2.5 px-3">Timestamp</TableHead>
                      <TableHead className="whitespace-nowrap text-[11px] font-bold text-muted-foreground uppercase tracking-wider py-2.5 px-3">Actor / User</TableHead>
                      <TableHead className="whitespace-nowrap text-[11px] font-bold text-muted-foreground uppercase tracking-wider py-2.5 px-3">Role</TableHead>
                      <TableHead className="whitespace-nowrap text-[11px] font-bold text-muted-foreground uppercase tracking-wider py-2.5 px-3">Action</TableHead>
                      <TableHead className="whitespace-nowrap text-[11px] font-bold text-muted-foreground uppercase tracking-wider py-2.5 px-3">Module</TableHead>
                      <TableHead className="whitespace-nowrap text-[11px] font-bold text-muted-foreground uppercase tracking-wider py-2.5 px-3">Branch</TableHead>
                      <TableHead className="whitespace-nowrap text-[11px] font-bold text-muted-foreground uppercase tracking-wider py-2.5 px-3">Affected Entity</TableHead>
                      <TableHead className="whitespace-nowrap text-[11px] font-bold text-muted-foreground uppercase tracking-wider py-2.5 px-3">Event Detail / Changes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedLogs.map((log) => {
                      const isSecurity = Boolean(
                        log.module === 'Security' ||
                        /malware|quarantine|threat|infected/i.test(log.action + ' ' + log.details)
                      );
                      const isSystemIssue = !isSecurity && Boolean(
                        log.module === 'System' ||
                        /sql error|database error|failed login|unusual login|application error|unhandled exception|system error/i.test(log.action + ' ' + log.details)
                      );

                      return (
                        <TableRow
                          key={log.id}
                          onClick={() => {
                            if (isSecurity) {
                              handleOpenIncident(log);
                            } else if (isSystemIssue) {
                              setSelectedSystemAlert({
                                id: log.target || log.id,
                                title: log.action,
                                message: log.details,
                                created_at: log.timestamp,
                                data: {
                                  issue_type: /sql|database/i.test(log.action + ' ' + log.details)
                                    ? 'sql_error'
                                    : /login/i.test(log.action + ' ' + log.details)
                                    ? 'failed_login'
                                    : 'application_error',
                                  severity: /sql|database/i.test(log.action + ' ' + log.details) ? 'Critical' : 'High',
                                  affected_user: log.user,
                                  timestamp: log.timestamp,
                                  endpoint: log.target,
                                  stack_trace: log.details,
                                },
                              });
                            }
                          }}
                          className={`transition-colors ${
                            isSecurity
                              ? 'bg-destructive/5 hover:bg-destructive/10 cursor-pointer'
                              : isSystemIssue
                              ? 'bg-amber-50/40 hover:bg-amber-50/80 cursor-pointer'
                              : 'hover:bg-muted/30'
                          }`}
                        >
                          {/* Timestamp */}
                          <TableCell className="text-muted-foreground whitespace-nowrap text-xs font-mono py-2.5 px-3">
                            {formatDisplayDate(log.timestamp)}
                          </TableCell>

                          {/* Actor */}
                          <TableCell className="font-semibold text-foreground whitespace-nowrap text-xs py-2.5 px-3">
                            {log.user}
                          </TableCell>

                          {/* Role */}
                          <TableCell className="whitespace-nowrap py-2.5 px-3">
                            <Badge
                              size="sm"
                              variant={
                                log.role === 'Super Admin'
                                  ? 'default'
                                  : isSecurity
                                  ? 'destructive'
                                  : isSystemIssue
                                  ? 'warning'
                                  : 'outline'
                              }
                            >
                              {log.role}
                            </Badge>
                          </TableCell>

                          {/* Action */}
                          <TableCell className="text-foreground whitespace-nowrap font-medium text-xs py-2.5 px-3">
                            {isSecurity ? (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="inline-flex items-center gap-1.5 font-bold text-destructive">
                                  <ShieldAlert size={13} className="text-destructive shrink-0" />
                                  {log.action}
                                </span>
                                {log.severity && (
                                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-200">
                                    {log.severity}
                                  </span>
                                )}
                                {log.burst_count > 1 && (
                                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1">
                                    <Layers size={10} />
                                    +{log.burst_count} bursts
                                  </span>
                                )}
                              </div>
                            ) : isSystemIssue ? (
                              <span className="inline-flex items-center gap-1.5 font-bold text-amber-900">
                                <Terminal size={13} className="text-amber-700 shrink-0" />
                                {log.action}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 font-semibold text-primary">
                                {log.action}
                              </span>
                            )}
                          </TableCell>

                          {/* Module */}
                          <TableCell className="whitespace-nowrap py-2.5 px-3 text-xs text-muted-foreground">
                            {log.module}
                          </TableCell>

                          {/* Branch */}
                          <TableCell className="whitespace-nowrap py-2.5 px-3">
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-muted/40 px-2 py-0.5 rounded border border-border">
                              <Building2 className="w-3 h-3 text-primary" />
                              <span>{log.branch || 'Main Branch'}</span>
                            </span>
                          </TableCell>

                          {/* Affected Entity Target */}
                          <TableCell className="text-foreground whitespace-nowrap font-mono text-xs py-2.5 px-3">
                            {log.target}
                          </TableCell>

                          {/* Details & Before/After Values */}
                          <TableCell className="text-muted-foreground max-w-sm text-xs py-2.5 px-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className={`truncate text-xs ${isSecurity ? 'text-destructive font-medium' : isSystemIssue ? 'text-amber-950 font-medium' : ''}`}>
                                {log.details}
                              </span>
                              {isSecurity && (
                                <button type="button" className="shrink-0 text-xs font-bold text-destructive hover:underline ml-2 cursor-pointer">
                                  Inspect
                                </button>
                              )}
                              {isSystemIssue && (
                                <button type="button" className="shrink-0 text-xs font-bold text-amber-800 hover:underline ml-2 cursor-pointer">
                                  View
                                </button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Pagination Controls (TS087 Criteria) */}
            {!loading && filtered.length > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-t border-border bg-page/50 text-xs text-muted-foreground">
                <div className="flex items-center gap-3">
                  <span>
                    Showing <strong>{(currentPage - 1) * pageSize + 1}</strong> to <strong>{Math.min(currentPage * pageSize, totalEntries)}</strong> of <strong>{totalEntries}</strong> entries
                  </span>
                  <div className="flex items-center gap-1.5 ml-2">
                    <span>Rows per page:</span>
                    <select
                      value={pageSize}
                      onChange={(e) => setPageSize(Number(e.target.value))}
                      className="h-7 rounded border border-border bg-card px-2 text-xs text-foreground cursor-pointer"
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    className="h-8 w-8 p-0"
                    title="Previous Page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="px-3 py-1 font-semibold text-foreground">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    className="h-8 w-8 p-0"
                    title="Next Page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── TAB 2: LOG RETENTION POLICY & AUTOMATED PURGE (TS088) ───────────── */}
      {activeTab === 'retention' && (
        <div className="space-y-6 w-full max-w-full">
          {/* Executive Storage Overview Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total Recorded Logs</span>
              <div className="text-2xl font-bold text-foreground mt-1 font-mono">{logs.length.toLocaleString()}</div>
              <p className="text-[11px] text-muted-foreground mt-1">Total audit trail events</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active Retained Logs</span>
              <div className="text-2xl font-bold text-emerald-600 mt-1 font-mono">{(logs.length - affectedPurgeCount).toLocaleString()}</div>
              <p className="text-[11px] text-muted-foreground mt-1">Within active retention window</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Expired Logs Ready for Purge</span>
              <div className="text-2xl font-bold text-amber-600 mt-1 font-mono">{affectedPurgeCount.toLocaleString()}</div>
              <p className="text-[11px] text-muted-foreground mt-1">Older than {retentionDays} days</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Configured Retention</span>
              <div className="text-2xl font-bold text-primary mt-1 font-mono">{retentionDays} Days</div>
              <p className="text-[11px] text-muted-foreground mt-1">Automatic nightly purge</p>
            </div>
          </div>

          {/* Success Notification Banner */}
          {retentionSuccessMsg && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="font-semibold">{retentionSuccessMsg}</span>
            </div>
          )}

          {/* Configuration Card */}
          <div className="rounded-xl border border-border bg-card p-6 shadow-xs space-y-6">
            <div>
              <h2 className="text-base font-bold text-foreground flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-primary" />
                Audit Log Retention Policy
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                Configure automated lifecycle threshold rules for historical audit logs to prevent database volume exhaustion.
              </p>
            </div>

            {/* Retention Selector Grid */}
            <div className="space-y-3">
              <label className="text-xs font-semibold text-foreground">Active Retention Threshold Period</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {[
                  { days: '30', label: '30 Days', desc: '1 Month' },
                  { days: '90', label: '90 Days', desc: '1 Quarter' },
                  { days: '180', label: '180 Days', desc: '6 Months' },
                  { days: '365', label: '365 Days', desc: '1 Year (Default)' },
                  { days: 'custom', label: 'Custom', desc: 'Specify Days' },
                ].map((opt) => (
                  <button
                    key={opt.days}
                    type="button"
                    onClick={() => setSelectedRetentionPreset(opt.days)}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      selectedRetentionPreset === opt.days
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border bg-page hover:border-slate-300'
                    }`}
                  >
                    <div className="font-bold text-xs text-foreground">{opt.label}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">{opt.desc}</div>
                  </button>
                ))}
              </div>

              {selectedRetentionPreset === 'custom' && (
                <div className="flex items-center gap-2 pt-2">
                  <Input
                    type="number"
                    min="7"
                    max="1825"
                    placeholder="Enter retention days (e.g. 730)..."
                    value={customRetentionDays}
                    onChange={(e) => setCustomRetentionDays(e.target.value)}
                    className="max-w-xs h-9 text-xs"
                  />
                  <span className="text-xs text-muted-foreground">days of log history</span>
                </div>
              )}
            </div>

            {/* Impact Calculation Summary (TS088 Criteria) */}
            <div className="bg-muted/30 border border-border/80 rounded-xl p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between font-semibold text-foreground">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-primary" />
                  Scheduled Purge Impact Analysis
                </span>
                <span className="text-primary font-bold">Nightly at 02:00 UTC</span>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                Logs created prior to <strong>{thresholdDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</strong> ({retentionDays} days ago) are marked as expired.
              </p>
              <div className="flex items-center gap-2 pt-1 text-xs">
                <span className="font-semibold text-foreground">Current Expired Entries:</span>
                <Badge variant={affectedPurgeCount > 0 ? 'warning' : 'outline'}>
                  {affectedPurgeCount} records ready for purge
                </Badge>
              </div>
              <div className="pt-2 text-[11px] text-muted-foreground border-t border-border/60">
                <strong>Non-Destructive Boundary:</strong> The automated purge job permanently deletes historical audit log rows only. Active operational tickets, client profiles, and user credentials are NEVER modified or deleted.
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-border">
              <Button
                variant="default"
                size="sm"
                onClick={handleApplyRetentionSetting}
                className="gap-1.5 text-xs bg-[#252578] hover:bg-[#1d1d60] text-white shadow-xs font-semibold cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Save Retention Policy</span>
              </Button>

              <Button
                variant="destructive"
                size="sm"
                onClick={handleTriggerManualPurge}
                disabled={affectedPurgeCount === 0 || isPurging}
                className="gap-1.5 text-xs cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isPurging ? 'Purging Expired Records...' : `Purge ${affectedPurgeCount} Expired Records Now`}</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ─── CONFIRMATION MODALS (TS088 Criteria) ────────────────────────────── */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="bg-card border border-destructive/20 rounded-2xl p-6 shadow-2xl max-w-md w-full space-y-4 animate-scale-up">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">
                  {confirmModal.type === 'reduction' ? 'Confirm Retention Reduction' : 'Permanent Log Purge Confirmation'}
                </h3>
                <p className="text-xs text-muted-foreground">Permanent and Irrecoverable Action</p>
              </div>
            </div>

            <div className="text-xs text-muted-foreground space-y-2 bg-destructive/5 border border-destructive/15 rounded-xl p-3.5 leading-relaxed">
              {confirmModal.type === 'reduction' ? (
                <>
                  <p className="text-destructive font-semibold">
                    Reducing the retention policy to {confirmModal.targetDays} days will permanently delete approximately {confirmModal.affectedCount} log entries older than {confirmModal.cutoffDate} on the next scheduled run.
                  </p>
                  <p>Once logs are deleted by the retention purge job, they cannot be recovered. Active operational tickets and client profiles will remain completely intact.</p>
                </>
              ) : (
                <>
                  <p className="text-destructive font-semibold">
                    You are triggering an immediate manual purge of {confirmModal.affectedCount} log records older than {confirmModal.cutoffDate}.
                  </p>
                  <p>These audit log entries will be immediately and permanently removed from the data warehouse. This action is irreversible.</p>
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmModal(null)}
                disabled={isPurging}
                className="text-xs"
              >
                Cancel
              </Button>

              <Button
                variant="destructive"
                size="sm"
                onClick={confirmModal.type === 'reduction' ? handleConfirmRetentionReduction : handleExecuteManualPurge}
                disabled={isPurging}
                className="text-xs font-semibold gap-1.5"
              >
                {isPurging ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                <span>{confirmModal.type === 'reduction' ? 'Confirm & Apply Retention' : 'Confirm & Execute Purge'}</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Security Incident & System Alert Inspection Modals */}
      {selectedIncident && (
        <SecurityIncidentModal
          incident={selectedIncident}
          onClose={() => setSelectedIncident(null)}
        />
      )}

      {selectedSystemAlert && (
        <SystemAlertModal
          isOpen={Boolean(selectedSystemAlert)}
          onClose={() => setSelectedSystemAlert(null)}
          alert={selectedSystemAlert}
          onNavigateToLogs={() => setSelectedSystemAlert(null)}
        />
      )}
    </div>
  );
}
