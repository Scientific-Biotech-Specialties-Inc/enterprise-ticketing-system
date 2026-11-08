import React, { useState, useEffect } from 'react';
import {
  Building2,
  Phone,
  Mail,
  Globe,
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  AlertTriangle,
  Info,
  Terminal,
  AlertCircle,
  Activity,
  Layers,
  RotateCcw,
  ExternalLink,
  ChevronDown,
  ShieldCheck,
  MapPin,
  Lock,
} from 'lucide-react';
import NotificationModal from '@/components/NotificationModal';
import BranchSelector from '@/components/BranchSelector';
import { useBranch } from '@/context/BranchContext';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import {
  getCompanyInfo,
  updateCompanyInfo,
  resetCompanyInfo,
  getSystemStatus,
  updateSystemStatus,
  getLogLevel,
  updateLogLevel,
} from '@/services/configurationService';

// =========================================================================
// TS097 Initial Baseline Data (Branch-Scoped Company Info & System Status)
// =========================================================================
const INITIAL_COMPANY_INFO = {
  address: 'SBSI Building, 28 East Capitol Drive, Kapitolyo, Pasig City, Metro Manila, Philippines 1603',
  contactNumber: '+63 2 8635 9999',
  contactEmail: 'support@sbsi.com.ph',
  socialLinks: [
    { id: 'soc-1', platform: 'LinkedIn', url: 'https://www.linkedin.com/company/scientific-biotech-specialties-inc' },
    { id: 'soc-2', platform: 'Facebook', url: 'https://www.facebook.com/ScientificBiotechSpecialties' },
    { id: 'soc-3', platform: 'Twitter / X', url: 'https://x.com/sbsi_ph' },
  ],
};

const INITIAL_BRANCH_COMPANY_INFO = {
  main: {
    ...INITIAL_COMPANY_INFO,
  },
};

// Company info and system status are stored as single global keys in configuration-service
// (company_info, system_status). They are not branch scoped, so local state uses one fixed key and
// every save goes to the backend regardless of which branch is selected in the header.
const CONFIG_SCOPE = 'main';

const SOCIAL_PLATFORMS = ['LinkedIn', 'Facebook', 'Twitter / X', 'YouTube', 'Instagram', 'Other'];

const LOG_LEVELS = [
  {
    level: 'Error',
    badgeClass: 'bg-red-50 text-red-700 border-red-200',
    description: 'Captures fatal application errors, unhandled exceptions, and service outages only.',
  },
  {
    level: 'Warning',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
    description: 'Captures non-fatal warnings, deprecated API calls, and soft degradation events.',
  },
  {
    level: 'Info',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
    description: 'Standard production baseline. Logs routine operations, logins, and ticket state transitions.',
  },
  {
    level: 'Debug',
    badgeClass: 'bg-purple-50 text-purple-700 border-purple-200',
    description: 'Verbose diagnostic mode. Logs complete request payloads, database queries, and stack traces.',
  },
];

// Validation helpers

// Mirrors the backend rule (email:rfc,filter + TLD): no consecutive dots, no leading or trailing dot
// in the local part, letters/digits/hyphens only in each domain label, and a 2+ letter TLD.
const isValidEmail = (email) => {
  const value = email.trim();
  if (value.includes('..')) return false;
  return /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/.test(value);
};

const isValidPhone = (phone) => {
  return /^[\+]?[(]?[0-9]{1,4}[)]?[-\s\./0-9]{6,15}$/.test(phone.trim());
};

const isValidUrl = (url) => {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

export default function SuperAdminSettings() {
  const { selectedBranch } = useBranch();

  // Navigation tabs (reusing group-pill styling pattern)
  const [activeTab, setActiveTab] = useState('all');

  // 1. Company Information State (branch-scoped dictionary: { [branchId]: { address, contactNumber, contactEmail, socialLinks } })
  const [branchCompanyInfo, setBranchCompanyInfo] = useState(INITIAL_BRANCH_COMPANY_INFO);
  const [companyErrors, setCompanyErrors] = useState({});

  // Active branch company info (defaults to empty strings/array if unconfigured)
  const currentCompanyInfo = branchCompanyInfo[CONFIG_SCOPE] || {
    address: '',
    contactNumber: '',
    contactEmail: '',
    socialLinks: [],
  };

  const hasCompanyInfoSet = Boolean(
    currentCompanyInfo.address?.trim() ||
    currentCompanyInfo.contactNumber?.trim() ||
    currentCompanyInfo.contactEmail?.trim() ||
    (currentCompanyInfo.socialLinks && currentCompanyInfo.socialLinks.length > 0)
  );

  // Clear branch-scoped company form errors when switching branches
  useEffect(() => {
    setCompanyErrors({});
  }, [selectedBranch.id]);

  // 2. System Status State (branch-scoped dictionary: { [branchId]: 'Operational' | 'Under Maintenance' })
  const [branchSystemStatus, setBranchSystemStatus] = useState({});

  // Active branch system status (defaults to 'Operational')
  const currentBranchStatus = branchSystemStatus[CONFIG_SCOPE] || 'Operational';

  // 3. Log Level State (global, untouched)
  const [logLevel, setLogLevel] = useState('Info');

  // Loading & Action States
  const [isSavingCompany, setIsSavingCompany] = useState(false);
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const [isSavingLogLevel, setIsSavingLogLevel] = useState(false);

  // Initial load from configuration-service
  useEffect(() => {
    let isMounted = true;
    Promise.all([
      getCompanyInfo().catch(() => null),
      getSystemStatus().catch(() => null),
      getLogLevel().catch(() => null),
    ]).then(([comp, stat, log]) => {
      if (!isMounted) return;
      if (comp) {
        setBranchCompanyInfo((prev) => ({
          ...prev,
          main: {
            address: comp.address || INITIAL_COMPANY_INFO.address,
            contactNumber: comp.contactNumber || INITIAL_COMPANY_INFO.contactNumber,
            contactEmail: comp.contactEmail || INITIAL_COMPANY_INFO.contactEmail,
            socialLinks: Array.isArray(comp.socialLinks) ? comp.socialLinks : INITIAL_COMPANY_INFO.socialLinks,
          },
        }));
      }
      if (stat) {
        setBranchSystemStatus((prev) => ({
          ...prev,
          main: stat,
        }));
      }
      if (log) {
        const match = LOG_LEVELS.find((l) => l.level.toLowerCase() === (log || '').toLowerCase());
        setLogLevel(match ? match.level : log);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // Notification Modal State
  const [notification, setNotification] = useState(null);
  const closeNotif = () => setNotification(null);
  const showSuccess = (title, message) => setNotification({ type: 'success', title, message });
  const showError = (title, message) => setNotification({ type: 'error', title, message });
  const showConfirm = (title, message, onConfirm, opts = {}) =>
    setNotification({ type: 'confirm', title, message, onConfirm, onCancel: closeNotif, ...opts });


  // ── Company Information Handlers (Branch-Scoped) ──────────────────────────
  const handleCompanyFieldChange = (field, value) => {
    setBranchCompanyInfo((prev) => {
      const existing = prev[CONFIG_SCOPE] || {
        address: '',
        contactNumber: '',
        contactEmail: '',
        socialLinks: [],
      };
      return {
        ...prev,
        [CONFIG_SCOPE]: {
          ...existing,
          [field]: value,
        },
      };
    });
    if (companyErrors[field]) {
      setCompanyErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleSocialLinkChange = (id, key, value) => {
    setBranchCompanyInfo((prev) => {
      const existing = prev[CONFIG_SCOPE] || {
        address: '',
        contactNumber: '',
        contactEmail: '',
        socialLinks: [],
      };
      return {
        ...prev,
        [CONFIG_SCOPE]: {
          ...existing,
          socialLinks: (existing.socialLinks || []).map((link) =>
            link.id === id ? { ...link, [key]: value } : link
          ),
        },
      };
    });
    const errKey = `social_${id}`;
    if (companyErrors[errKey]) {
      setCompanyErrors((prev) => {
        const next = { ...prev };
        delete next[errKey];
        return next;
      });
    }
  };

  const handleAddSocialLink = () => {
    const newId = `soc-${Date.now()}`;
    setBranchCompanyInfo((prev) => {
      const existing = prev[CONFIG_SCOPE] || {
        address: '',
        contactNumber: '',
        contactEmail: '',
        socialLinks: [],
      };
      return {
        ...prev,
        [CONFIG_SCOPE]: {
          ...existing,
          socialLinks: [
            ...(existing.socialLinks || []),
            { id: newId, platform: 'LinkedIn', url: '' },
          ],
        },
      };
    });
  };

  const handleRemoveSocialLink = (id) => {
    setBranchCompanyInfo((prev) => {
      const existing = prev[CONFIG_SCOPE] || {
        address: '',
        contactNumber: '',
        contactEmail: '',
        socialLinks: [],
      };
      return {
        ...prev,
        [CONFIG_SCOPE]: {
          ...existing,
          socialLinks: (existing.socialLinks || []).filter((link) => link.id !== id),
        },
      };
    });
    setCompanyErrors((prev) => {
      const next = { ...prev };
      delete next[`social_${id}`];
      return next;
    });
  };

  const handleSaveCompanyInfo = async (e) => {
    if (e) e.preventDefault();
    const errors = {};

    if (!currentCompanyInfo.address.trim()) {
      errors.address = `Address is required for ${selectedBranch.name}.`;
    } else if (currentCompanyInfo.address.trim().length < 5) {
      errors.address = 'Please enter a complete address (minimum 5 characters).';
    }

    if (!currentCompanyInfo.contactNumber.trim()) {
      errors.contactNumber = `Contact phone number is required for ${selectedBranch.name}.`;
    } else if (!isValidPhone(currentCompanyInfo.contactNumber)) {
      errors.contactNumber = 'Please provide a valid phone number (e.g. +63 2 8635 9999 or (02) 8123-4567).';
    }

    if (!currentCompanyInfo.contactEmail.trim()) {
      errors.contactEmail = `Contact email is required for ${selectedBranch.name}.`;
    } else if (!isValidEmail(currentCompanyInfo.contactEmail)) {
      errors.contactEmail = 'Please provide a valid email address (e.g. support@sbsi.com.ph).';
    }

    (currentCompanyInfo.socialLinks || []).forEach((link) => {
      if (!link.url.trim()) {
        errors[`social_${link.id}`] = 'URL cannot be empty.';
      } else if (!isValidUrl(link.url)) {
        errors[`social_${link.id}`] = 'Please enter a valid web URL starting with http:// or https://.';
      }
    });

    if (Object.keys(errors).length > 0) {
      setCompanyErrors(errors);
      return;
    }

    setCompanyErrors({});
    setIsSavingCompany(true);

    try {
      const res = await updateCompanyInfo(currentCompanyInfo);
      if (res) {
        const updated = {
          address: res.address || currentCompanyInfo.address,
          contactNumber: res.contactNumber || currentCompanyInfo.contactNumber,
          contactEmail: res.contactEmail || currentCompanyInfo.contactEmail,
          socialLinks: Array.isArray(res.socialLinks) ? res.socialLinks : currentCompanyInfo.socialLinks,
        };
        setBranchCompanyInfo((prev) => ({
          ...prev,
          [CONFIG_SCOPE]: updated,
        }));
      }
      showSuccess(
        'Company Information Saved',
        `Company profile, contact lines, and social links updated for ${selectedBranch.name} successfully.`
      );
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to update company information.';
      const serverErrors = err.response?.data?.errors;
      if (serverErrors && typeof serverErrors === 'object') {
        setCompanyErrors(serverErrors);
      }
      showError('Save Failed', msg);
    } finally {
      setIsSavingCompany(false);
    }
  };

  const handleResetCompanyInfo = () => {
    showConfirm(
      `Restore Default Company Information for ${selectedBranch.name}?`,
      `This will reset contact lines and profile information for ${selectedBranch.name} back to default values.`,
      async () => {
        closeNotif();
        setIsSavingCompany(true);
        try {
          await resetCompanyInfo();
          const resetTarget = { ...INITIAL_COMPANY_INFO };
          setBranchCompanyInfo((prev) => ({
            ...prev,
            [CONFIG_SCOPE]: resetTarget,
          }));
          setCompanyErrors({});
          showSuccess(
            'Company Information Reset',
            'Company information has been restored to initial defaults.'
          );
        } catch (err) {
          showError('Reset Failed', err.response?.data?.message || 'Failed to reset company information.');
        } finally {
          setIsSavingCompany(false);
        }
      }
    );
  };

  // ── System Status Handlers (Branch-Scoped) ────────────────────────────────
  const handleSelectSystemStatus = async (newStatus) => {
    if (newStatus === currentBranchStatus || isSavingStatus) return;

    if (newStatus === 'Under Maintenance') {
      showConfirm(
        `Set ${selectedBranch.name} to Under Maintenance?`,
        `Setting ${selectedBranch.name} to Under Maintenance may restrict or affect access for users at this location. Are you sure?`,
        async () => {
          closeNotif();
          setIsSavingStatus(true);
          try {
            await updateSystemStatus('Under Maintenance');
            window.dispatchEvent(new CustomEvent('system:status-changed', { detail: { status: 'Under Maintenance' } }));
            setBranchSystemStatus((prev) => ({
              ...prev,
              [CONFIG_SCOPE]: 'Under Maintenance',
            }));
            showSuccess(
              'System Status Updated',
              `Platform status for ${selectedBranch.name} set to "Under Maintenance". Advisory banners will be presented to non-admin users at this location.`
            );
          } catch (err) {
            showError('Status Update Failed', err.response?.data?.message || 'Unable to change system status.');
          } finally {
            setIsSavingStatus(false);
          }
        },
        {
          confirmText: 'Set to Maintenance',
          confirmClassName: 'bg-amber-600 hover:bg-amber-700',
        }
      );
    } else {
      setIsSavingStatus(true);
      try {
        await updateSystemStatus('Operational');
        window.dispatchEvent(new CustomEvent('system:status-changed', { detail: { status: 'Operational' } }));
        setBranchSystemStatus((prev) => ({
          ...prev,
          [CONFIG_SCOPE]: newStatus,
        }));
        showSuccess(
          'System Status Restored',
          `Platform status for ${selectedBranch.name} has been restored to "Operational".`
        );
      } catch (err) {
        showError('Status Update Failed', err.response?.data?.message || 'Unable to restore operational status.');
      } finally {
        setIsSavingStatus(false);
      }
    }
  };

  // ── Log Level Handlers (Global Infrastructure) ────────────────────────────
  const handleSaveLogLevel = async (newLevel) => {
    const levelToSet = newLevel || logLevel;
    setIsSavingLogLevel(true);
    try {
      const updated = await updateLogLevel(levelToSet);
      const match = LOG_LEVELS.find((l) => l.level.toLowerCase() === (updated || '').toLowerCase());
      setLogLevel(match ? match.level : levelToSet);
      showSuccess(
        'Log Level Saved',
        `Diagnostic log verbosity set to "${levelToSet}". Changes apply immediately to runtime requests via dynamic Redis cache wiring.`
      );
    } catch (err) {
      showError('Save Failed', err.response?.data?.message || 'Failed to update diagnostic log level.');
    } finally {
      setIsSavingLogLevel(false);
    }
  };

  const TABS = [
    { id: 'all', label: 'All Settings', icon: <Layers size={14} /> },
    { id: 'company', label: 'Company Information', icon: <Building2 size={14} /> },
    { id: 'status', label: 'System Status', icon: <Activity size={14} /> },
    { id: 'logs', label: 'Log Level', icon: <Terminal size={14} /> },
  ];


  return (
    <div className="flex flex-col gap-6">
      {/* Interactive Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-slate-muted">
        <span className="text-slate-400">Super Admin</span>
        <span className="text-slate-300">/</span>
        <span className="text-primary font-semibold">System Settings</span>
      </nav>

      {/* Page Header */}
      <PageHeader
        pattern="B"
        title="System Settings"
        subtitle="Configure global corporate information, system operational state, and diagnostic logging."
        actions={
          <div className="flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
              <CheckCircle2 size={13} className="shrink-0" />
              <span>Persisted & Synchronized</span>
            </span>
            <div className="flex items-center gap-2 self-start sm:self-auto rounded-xl border border-border bg-card px-3.5 py-2 shadow-2xs">
              <span className="text-xs text-slate-muted font-medium">Platform:</span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                  currentBranchStatus === 'Operational'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    currentBranchStatus === 'Operational' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                  }`}
                />
                {currentBranchStatus} ({selectedBranch.name})
              </span>
            </div>
          </div>
        }
      />

      {/* Navigation Pills */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 w-fit flex-wrap shadow-xs">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                isActive ? 'bg-card text-primary shadow-xs' : 'text-slate-muted hover:text-slate-dark'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Content Layout */}
      <div className="flex flex-col gap-6">
        {/* Single Branch Selector Banner governing both branch-scoped sections (Company Info & System Status) */}
        {(activeTab === 'all' || activeTab === 'company' || activeTab === 'status') && (
          <BranchSelector variant="banner" />
        )}

        {/* =================================================================== */}
        {/* SECTION 1: Company Information (TS097 - Branch-Scoped)              */}
        {/* =================================================================== */}
        {(activeTab === 'all' || activeTab === 'company') && (
          <section aria-labelledby="section-company-heading" className="rounded-2xl border border-gray-200 bg-white p-6 sm:p-7 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-border gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Building2 size={20} />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 id="section-company-heading" className="text-base sm:text-lg font-bold text-gray-900">
                      Company Information
                    </h2>
                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 border border-indigo-200">
                      <MapPin size={11} className="shrink-0" />
                      Branch-Scoped ({selectedBranch.name})
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Physical location address, primary contact lines, and official social media presences for {selectedBranch.name}.
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200 self-start sm:self-auto">
                Independent Save
              </span>
            </div>

            <form onSubmit={handleSaveCompanyInfo} className="mt-6 space-y-6">
              {/* Informational placeholder banner when no info has been configured for this branch */}
              {!hasCompanyInfoSet && (
                <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/70 p-4 text-xs text-amber-900 flex items-start gap-2.5 shadow-2xs animate-fade-slide-in">
                  <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-amber-900">No company information set for this branch yet.</p>
                    <p className="mt-0.5 text-amber-700 leading-relaxed">
                      The address, phone, and email for <strong>{selectedBranch.name}</strong> come from the Auth Module. Set them there first.
                    </p>
                  </div>
                </div>
              )}

              {/* Branch contact details are owned by the Auth Module, so they are read only here. */}
              <div role="note" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 flex items-start gap-2">
                <Lock size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Branch address, phone number, and email address are read only.</p>
                  <p className="mt-1 text-amber-700 leading-relaxed">
                    These details are managed centrally for all branches. If they must be changed, update them in the Auth Module.
                  </p>
                </div>
              </div>

              {/* Address Field */}
              <div className="space-y-1.5">
                <label htmlFor="company-address" className="text-xs font-semibold text-gray-700 uppercase tracking-wider block">
                  {selectedBranch.id === 'main' ? 'Headquarters Address' : `${selectedBranch.name} Address`} <Lock size={11} className="inline text-gray-400" aria-label="Read only" />
                </label>
                <textarea
                  id="company-address"
                  rows={3}
                  value={currentCompanyInfo.address}
                  readOnly
                  aria-readonly="true"
                  placeholder={
                    selectedBranch.id === 'main'
                      ? 'e.g. SBSI Building, 28 East Capitol Drive, Pasig City...'
                      : `Enter physical facility address for ${selectedBranch.name}...`
                  }
                  className={`w-full rounded-xl border px-4 py-3 text-sm font-medium outline-none transition-all resize-none ${
                    companyErrors.address ? 'border-red-300 bg-red-50/40 text-red-900' : 'border-gray-200 bg-gray-50 text-gray-600 cursor-not-allowed'
                  }`}
                />
                {companyErrors.address && (
                  <p className="text-xs text-red-600 font-semibold flex items-center gap-1 mt-1">
                    <AlertCircle size={12} className="shrink-0" />
                    {companyErrors.address}
                  </p>
                )}
              </div>

              {/* Contact Grid: Phone and Email */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Contact Phone */}
                <div className="space-y-1.5">
                  <label htmlFor="company-phone" className="text-xs font-semibold text-gray-700 uppercase tracking-wider block">
                    Contact Phone Number <Lock size={11} className="inline text-gray-400" aria-label="Read only" />
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                      <Phone size={16} />
                    </span>
                    <input
                      id="company-phone"
                      type="text"
                      value={currentCompanyInfo.contactNumber}
                      readOnly
                      aria-readonly="true"
                      placeholder="e.g. +63 2 8635 9999"
                      className={`w-full rounded-xl border pl-10 pr-4 py-3 text-sm font-semibold outline-none transition-all ${
                        companyErrors.contactNumber ? 'border-red-300 bg-red-50/40 text-red-900' : 'border-gray-200 bg-gray-50 text-gray-600 cursor-not-allowed'
                      }`}
                    />
                  </div>
                  {companyErrors.contactNumber && (
                    <p className="text-xs text-red-600 font-semibold flex items-center gap-1 mt-1">
                      <AlertCircle size={12} className="shrink-0" />
                      {companyErrors.contactNumber}
                    </p>
                  )}
                </div>

                {/* Contact Email */}
                <div className="space-y-1.5">
                  <label htmlFor="company-email" className="text-xs font-semibold text-gray-700 uppercase tracking-wider block">
                    Contact Email Address <Lock size={11} className="inline text-gray-400" aria-label="Read only" />
                  </label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                      <Mail size={16} />
                    </span>
                    <input
                      id="company-email"
                      type="email"
                      value={currentCompanyInfo.contactEmail}
                      readOnly
                      aria-readonly="true"
                      placeholder="e.g. support@sbsi.com.ph"
                      className={`w-full rounded-xl border pl-10 pr-4 py-3 text-sm font-semibold outline-none transition-all ${
                        companyErrors.contactEmail ? 'border-red-300 bg-red-50/40 text-red-900' : 'border-gray-200 bg-gray-50 text-gray-600 cursor-not-allowed'
                      }`}
                    />
                  </div>
                  {companyErrors.contactEmail && (
                    <p className="text-xs text-red-600 font-semibold flex items-center gap-1 mt-1">
                      <AlertCircle size={12} className="shrink-0" />
                      {companyErrors.contactEmail}
                    </p>
                  )}
                </div>
              </div>

              {/* Social Media Links Section */}
              <div className="pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-gray-800">Official Social Media Profiles</h3>
                    <p className="text-xs text-gray-400">External brand links displayed across public customer portals and footers for this branch.</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddSocialLink}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#252578] hover:bg-gray-50 transition-all shadow-2xs cursor-pointer"
                  >
                    <Plus size={14} />
                    Add Link
                  </button>
                </div>

                <div className="space-y-3">
                  {currentCompanyInfo.socialLinks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-xs text-gray-500">
                      No social links configured for {selectedBranch.name}. Click "Add Link" to register external profiles.
                    </div>
                  ) : (
                    currentCompanyInfo.socialLinks.map((link) => {
                      const linkError = companyErrors[`social_${link.id}`];
                      return (
                        <div key={link.id} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-3 rounded-xl border border-gray-200/80 bg-gray-50/50">
                          {/* Platform Selector */}
                          <div className="w-full sm:w-44 shrink-0">
                            <select
                              value={link.platform}
                              onChange={(e) => handleSocialLinkChange(link.id, 'platform', e.target.value)}
                              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 outline-none focus:ring-1 focus:ring-[#252578] cursor-pointer"
                            >
                              {SOCIAL_PLATFORMS.map((plat) => (
                                <option key={plat} value={plat}>
                                  {plat}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* URL Input */}
                          <div className="flex-1 min-w-0">
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                                <Globe size={14} />
                              </span>
                              <input
                                type="url"
                                value={link.url}
                                onChange={(e) => handleSocialLinkChange(link.id, 'url', e.target.value)}
                                placeholder="https://..."
                                className={`w-full rounded-lg border pl-9 pr-3 py-2 text-xs font-medium outline-none transition-all ${
                                  linkError
                                    ? 'border-red-300 bg-red-50/40 text-red-900 focus:ring-1 focus:ring-red-400'
                                    : 'border-gray-200 bg-white text-gray-900 focus:ring-1 focus:ring-[#252578]'
                                }`}
                              />
                            </div>
                            {linkError && (
                              <p className="text-[11px] text-red-600 font-semibold flex items-center gap-1 mt-1">
                                <AlertCircle size={10} className="shrink-0" />
                                {linkError}
                              </p>
                            )}
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center gap-1 self-end sm:self-center">
                            {link.url && isValidUrl(link.url) && (
                              <a
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Open link in new tab"
                                className="p-2 text-gray-400 hover:text-[#252578] hover:bg-white rounded-lg transition-colors cursor-pointer"
                              >
                                <ExternalLink size={14} />
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={() => handleRemoveSocialLink(link.id)}
                              title="Delete link"
                              className="p-2 text-gray-400 hover:text-red-600 hover:bg-white rounded-lg transition-colors cursor-pointer"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Form Action Bar */}
              <div className="flex items-center justify-between pt-4 border-t border-border flex-wrap gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleResetCompanyInfo}
                  className="text-xs text-slate-muted hover:text-slate-dark"
                >
                  <RotateCcw size={13} />
                  Restore Defaults ({selectedBranch.name})
                </Button>

                <Button
                  type="submit"
                  disabled={isSavingCompany}
                  className="ml-auto"
                >
                  <Save size={16} />
                  Save Company Info
                </Button>
              </div>
            </form>
          </section>
        )}

        {/* =================================================================== */}
        {/* SECTION 2: System Status (TS097 - Branch-Scoped)                    */}
        {/* =================================================================== */}
        {(activeTab === 'all' || activeTab === 'status') && (
          <section aria-labelledby="section-status-heading" className="rounded-2xl border border-gray-200 bg-white p-6 sm:p-7 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-gray-100 gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#252578]/10 text-[#252578]">
                  <Activity size={20} />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 id="section-status-heading" className="text-base sm:text-lg font-bold text-gray-900">
                      System Status
                    </h2>
                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 border border-indigo-200">
                      <MapPin size={11} className="shrink-0" />
                      Branch-Scoped ({selectedBranch.name})
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Control the operational state for {selectedBranch.name}. Maintenance mode notifies users at this location and may restrict interactions.
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200 self-start sm:self-auto">
                Independent Save
              </span>
            </div>

            {/* Status Selectors */}
            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Option 1: Operational */}
              <div
                onClick={() => handleSelectSystemStatus('Operational')}
                className={`rounded-2xl border p-5 transition-all cursor-pointer select-none flex flex-col justify-between ${
                  currentBranchStatus === 'Operational'
                    ? 'border-[#252578] bg-[#252578]/5 shadow-sm ring-1 ring-[#252578]'
                    : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      Live Status
                    </span>
                    {currentBranchStatus === 'Operational' && (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-[#252578]">
                        <CheckCircle2 size={16} className="text-[#252578]" />
                        Active
                      </span>
                    )}
                  </div>
                  <h3 className="text-base font-bold text-gray-900 mt-3 flex items-center gap-2">
                    Operational
                  </h3>
                  <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
                    All services, agent queues, and operations for {selectedBranch.name} are active and running normally.
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
                  <span>Standard production mode</span>
                  <span className="font-semibold text-emerald-600">Normal Access</span>
                </div>
              </div>

              {/* Option 2: Under Maintenance */}
              <div
                onClick={() => handleSelectSystemStatus('Under Maintenance')}
                className={`rounded-2xl border p-5 transition-all cursor-pointer select-none flex flex-col justify-between ${
                  currentBranchStatus === 'Under Maintenance'
                    ? 'border-amber-400 bg-amber-50/30 shadow-sm ring-1 ring-amber-400'
                    : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 border border-amber-200">
                      <span className="h-2 w-2 rounded-full bg-amber-500" />
                      Restricted Mode
                    </span>

                    <div className="flex items-center gap-2">
                      <div className="relative group inline-flex items-center">
                        <button
                          type="button"
                          aria-label="Under Maintenance warning information"
                          onClick={(e) => e.stopPropagation()}
                          className="text-amber-600 hover:text-amber-800 cursor-help p-1 rounded-full hover:bg-amber-100/50 transition-colors"
                        >
                          <Info size={16} />
                        </button>
                        <div className="pointer-events-none absolute bottom-full right-0 mb-2 hidden w-72 rounded-xl bg-gray-900 p-3 text-center text-xs text-white shadow-xl group-hover:block z-50 leading-relaxed">
                          Setting {selectedBranch.name} to Under Maintenance may restrict or affect access for users at this location.
                          <div className="absolute top-full right-4 border-4 border-transparent border-t-gray-900" />
                        </div>
                      </div>

                      {currentBranchStatus === 'Under Maintenance' && (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700">
                          <CheckCircle2 size={16} className="text-amber-600" />
                          Active
                        </span>
                      )}
                    </div>
                  </div>

                  <h3 className="text-base font-bold text-gray-900 mt-3 flex items-center gap-2">
                    Under Maintenance
                    <AlertTriangle size={16} className="text-amber-600 shrink-0" />
                  </h3>
                  <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
                    Maintenance window is active for {selectedBranch.name}. Non-admin users at this facility will be presented with advisory notifications or restricted access.
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
                  <span>Restricted maintenance state</span>
                  <span className="font-semibold text-amber-600">Requires Confirmation</span>
                </div>
              </div>
            </div>

            {/* Status Information Box */}
            <div
              className={`mt-5 rounded-xl border p-4 flex items-start gap-3 transition-colors ${
                currentBranchStatus === 'Operational'
                  ? 'border-emerald-200 bg-emerald-50/40 text-emerald-900'
                  : 'border-amber-200 bg-amber-50/50 text-amber-900'
              }`}
            >
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-lg shrink-0 mt-0.5 ${
                  currentBranchStatus === 'Operational' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                }`}
              >
                {currentBranchStatus === 'Operational' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              </div>
              <div className="text-xs leading-relaxed">
                <span className="font-bold">Current System Condition: </span>
                {currentBranchStatus === 'Operational' ? (
                  <span><strong>{selectedBranch.name}</strong> is fully healthy and operating as expected. Customer intake forms and queues are unobstructed.</span>
                ) : (
                  <span>
                    <strong>{selectedBranch.name}</strong> is running in maintenance mode. Switching back to <strong>Operational</strong> takes effect immediately without requiring a confirmation dialog.
                  </span>
                )}
              </div>
            </div>
          </section>
        )}

        {/* =================================================================== */}
        {/* SECTION 3: Log Level (TS097 - Global Infrastructure Setting)        */}
        {/* =================================================================== */}
        {(activeTab === 'all' || activeTab === 'logs') && (
          <section aria-labelledby="section-logs-heading" className="rounded-2xl border border-gray-200 bg-white p-6 sm:p-7 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-gray-100 gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#252578]/10 text-[#252578]">
                  <Terminal size={20} />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 id="section-logs-heading" className="text-base sm:text-lg font-bold text-gray-900">
                      Log Level Configuration
                    </h2>
                    <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-semibold text-purple-700 border border-purple-200">
                      <Globe size={11} className="shrink-0" />
                      System-Wide / Infrastructure
                    </span>
                    <div className="relative group inline-flex items-center">
                      <button
                        type="button"
                        aria-label="Log Level verbosity information"
                        className="text-gray-400 hover:text-[#252578] cursor-help p-0.5"
                      >
                        <Info size={15} />
                      </button>
                      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden w-80 rounded-xl bg-gray-900 p-3 text-center text-xs text-white shadow-xl group-hover:block z-50 leading-relaxed">
                        Higher verbosity levels (like Debug) produce significantly more log data and are typically intended for troubleshooting rather than everyday operation.
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Set the minimum severity threshold for microservice and gateway log streams across all facilities.
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200 self-start sm:self-auto">
                Independent Save
              </span>
            </div>

            <div className="mt-6 space-y-6">
              {/* Infrastructure-Wide Scope Callout */}
              <div className="rounded-xl border border-purple-100 bg-purple-50/70 p-3.5 text-xs text-purple-900 flex items-start gap-2.5">
                <Info size={16} className="text-purple-600 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <span className="font-bold">System-Wide Infrastructure Setting:</span>{' '}
                  Log verbosity is an infrastructure-wide setting and applies system-wide, not per branch.
                </div>
              </div>
              {/* Select Dropdown & Current Level */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-center">
                <div className="space-y-1.5">
                  <label htmlFor="log-level-select" className="text-xs font-semibold text-gray-700 uppercase tracking-wider block">
                    Diagnostic Logging Threshold
                  </label>
                  <div className="relative">
                    <select
                      id="log-level-select"
                      value={logLevel}
                      onChange={(e) => setLogLevel(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-[#252578] cursor-pointer appearance-none pr-10 shadow-2xs"
                    >
                      {LOG_LEVELS.map((lvl) => (
                        <option key={lvl.level} value={lvl.level}>
                          {lvl.level} — {lvl.level === 'Info' ? 'Standard Default' : lvl.description.slice(0, 40) + '...'}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={18} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                </div>

                {/* Current Active Badge Box */}
                <div className="rounded-xl border border-gray-200/80 bg-gray-50/50 p-4 shadow-2xs flex items-center justify-between">
                  <div>
                    <span className="text-xs text-gray-400 font-medium block">Active Verbosity</span>
                    <span className="text-sm font-bold text-gray-900 mt-0.5 block">{logLevel} Mode</span>
                  </div>
                  <span
                    className={`inline-block rounded-full px-3 py-1 text-xs font-semibold border ${
                      LOG_LEVELS.find((l) => l.level === logLevel)?.badgeClass || 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {logLevel}
                  </span>
                </div>
              </div>

              {/* Log Level Options Visual Matrix */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
                {LOG_LEVELS.map((item) => {
                  const isSelected = item.level === logLevel;
                  return (
                    <div
                      key={item.level}
                      onClick={() => setLogLevel(item.level)}
                      className={`rounded-xl border p-4 transition-all cursor-pointer select-none flex flex-col justify-between ${
                        isSelected
                          ? 'border-primary bg-primary/5 shadow-xs ring-1 ring-primary'
                          : 'border-border bg-card hover:border-slate-300 hover:bg-slate-50/40 opacity-80'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold border ${item.badgeClass}`}>
                            {item.level}
                          </span>
                          {isSelected && <CheckCircle2 size={14} className="text-primary" />}
                        </div>
                        <p className="text-xs text-slate-muted mt-2.5 leading-relaxed">{item.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Action Bar */}
              <div className="flex items-center justify-end pt-4 border-t border-border">
                <Button
                  type="button"
                  disabled={isSavingLogLevel}
                  onClick={() => handleSaveLogLevel(logLevel)}
                >
                  <Save size={16} />
                  Save Log Level
                </Button>
              </div>
            </div>
          </section>
        )}


      </div>

      {/* Global Notification Modal */}
      <NotificationModal
        isOpen={!!notification}
        type={notification?.type}
        title={notification?.title}
        message={notification?.message}
        onClose={closeNotif}
        onConfirm={notification?.onConfirm}
        onCancel={notification?.onCancel}
        confirmText={notification?.confirmText}
        confirmClassName={notification?.confirmClassName}
      />
    </div>
  );
}
