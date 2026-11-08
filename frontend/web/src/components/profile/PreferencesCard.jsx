import React, { useState, useEffect } from 'react';
import { SlidersHorizontal, AlertCircle, CheckCircle, Bell, Mail, Info } from 'lucide-react';
import { getNotificationPreferences, updateNotificationPreferences } from '@/services/ticketService';

function ChannelToggleRow({ icon: Icon, label, description, checked, onChange, disabled }) {
  return (
    <div className="flex items-center justify-between px-6 py-3.5 hover:bg-slate-50/50 transition-colors font-sans">
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
          checked ? 'bg-blue-50 text-accent' : 'bg-slate-100 text-muted-slate'
        }`}>
          <Icon size={16} />
        </div>
        <div>
          <p className="text-sm font-semibold text-dark-slate">{label}</p>
          <p className="text-xs text-muted-slate">{description}</p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-accent/20 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
          checked ? 'bg-primary' : 'bg-slate-200'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-xs transform ring-0 transition duration-200 ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

export default function PreferencesCard({ role }) {
  const [prefs, setPrefs] = useState({
    email: true,
    in_app: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [warningMessage, setWarningMessage] = useState('');

  // Fetch preferences on mount
  useEffect(() => {
    let isMounted = true;
    const fetchPrefs = async () => {
      setLoading(true);
      try {
        const data = await getNotificationPreferences();
        if (isMounted && data) {
          setPrefs({
            email: Boolean(data.email ?? data.preferences?.email ?? true),
            in_app: Boolean(data.in_app ?? data.preferences?.in_app ?? true),
          });
        }
      } catch (err) {
        console.warn('Could not load notification preferences from server, using defaults.', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchPrefs();
    return () => { isMounted = false; };
  }, []);

  const handleToggle = async (channel, newValue) => {
    if (saving) return;

    setError('');
    setSuccess('');
    setWarningMessage('');

    const nextEmail = channel === 'email' ? newValue : prefs.email;
    const nextInApp = channel === 'in_app' ? newValue : prefs.in_app;

    // TS005 Rule: At least one channel must remain enabled at all times
    if (!nextEmail && !nextInApp) {
      setError('At least one notification channel must stay enabled so you don\'t miss updates.');
      return;
    }

    // Inline non-blocking warning when disabling a channel
    if (!newValue) {
      if (channel === 'email') {
        setWarningMessage('Disabling Email means you will only receive ticket updates via In-App notifications.');
      } else if (channel === 'in_app') {
        setWarningMessage('Disabling In-App notifications means you will only receive updates via Email alerts.');
      }
    } else {
      if (nextEmail && nextInApp) {
        setWarningMessage('');
      } else if (!nextEmail) {
        setWarningMessage('Disabling Email means you will only receive ticket updates via In-App notifications.');
      } else if (!nextInApp) {
        setWarningMessage('Disabling In-App notifications means you will only receive updates via Email alerts.');
      }
    }

    // Optimistically update
    const previousPrefs = { ...prefs };
    const updatedPrefs = { email: nextEmail, in_app: nextInApp };
    setPrefs(updatedPrefs);
    setSaving(true);

    try {
      await updateNotificationPreferences(updatedPrefs);
      setSuccess('Notification preferences updated immediately.');
      // Auto-clear success after 4 seconds
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      // Revert to previous state on failure
      setPrefs(previousPrefs);
      const errMsg = err.response?.data?.message || 'Failed to save preference changes. Reverting to previous state.';
      setError(errMsg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border shadow-xs font-sans">
      <div className="px-6 pt-5 pb-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
            <SlidersHorizontal size={16} className="text-accent" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-dark-slate">Notification Preferences</h3>
            <p className="text-xs text-muted-slate">Configure how and where you receive ticket updates.</p>
          </div>
        </div>
        {saving && (
          <span className="text-[11px] font-medium text-muted-slate animate-pulse">
            Saving...
          </span>
        )}
      </div>

      <div className="p-6 pb-2">
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-xs text-red-700 font-medium animate-fade-in">
            <AlertCircle size={15} className="shrink-0 mt-0.5 text-red-600" />
            <span>{error}</span>
          </div>
        )}

        {warningMessage && !error && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2 text-xs text-amber-800 font-medium animate-fade-in">
            <Info size={15} className="shrink-0 mt-0.5 text-amber-600" />
            <span>{warningMessage}</span>
          </div>
        )}

        {success && (
          <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-xs text-emerald-700 font-semibold animate-fade-in">
            <CheckCircle size={15} className="shrink-0 text-emerald-600" />
            <span>{success}</span>
          </div>
        )}

        <div className="mb-2">
          <p className="text-[10px] font-bold text-muted-slate uppercase tracking-widest">
            Delivery Channels
          </p>
        </div>
      </div>

      <div className="divide-y divide-border pb-4">
        <ChannelToggleRow
          icon={Mail}
          label="Email Notifications"
          description="Receive ticket creations, replies, and status changes directly in your inbox"
          checked={prefs.email}
          onChange={(newVal) => handleToggle('email', newVal)}
          disabled={loading || saving}
        />
        <ChannelToggleRow
          icon={Bell}
          label="In-App Notifications"
          description="Real-time notifications and alerts inside the ticketing portal"
          checked={prefs.in_app}
          onChange={(newVal) => handleToggle('in_app', newVal)}
          disabled={loading || saving}
        />
      </div>

      <div className="px-6 py-3 bg-slate-50/70 border-t border-border rounded-b-xl">
        <p className="text-[11px] text-muted-slate">
          * At least one channel must stay enabled to ensure you never miss critical ticket updates.
        </p>
      </div>
    </div>
  );
}

