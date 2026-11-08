import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, RefreshCw, AlertCircle, WifiOff } from 'lucide-react';
import axiosInstance from '@/api/axiosInstance';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import ProfileHero from '@/components/profile/ProfileHero';
import PersonalInfoCard from '@/components/profile/PersonalInfoCard';
import PreferencesCard from '@/components/profile/PreferencesCard';
import SecurityCard from '@/components/profile/SecurityCard';
import SkeletonLoader from '@/components/SkeletonLoader';
import { formatDisplayDate } from '@/utils/dateUtils';

const getStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
};

export default function Profile() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, setUser } = useAuth();
  const [freshProfile, setFreshProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isStale, setIsStale] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(() => {
    return localStorage.getItem('profile_last_synced') || new Date().toISOString();
  });

  const effectiveUser = freshProfile || user || getStoredUser();
  // Read through a ref so fetchFresh stays stable; depending on effectiveUser made every fetch trigger the next one.
  const effectiveUserRef = useRef(effectiveUser);
  effectiveUserRef.current = effectiveUser;

  const fetchFresh = useCallback(async (isManualRetry = false) => {
    if (isManualRetry) setLoading(true);
    setError('');
    try {
      const res = await axiosInstance.get('/profile');
      if (res.data?.user) {
        setFreshProfile(res.data.user);
        const now = new Date().toISOString();
        setLastSyncedAt(now);
        localStorage.setItem('profile_last_synced', now);
        setIsStale(false);
      }
    } catch (err) {
      console.warn('Failed to refresh profile from auth service:', err);
      // If we already have a user in session or localStorage, degrade gracefully to stale data
      if (effectiveUserRef.current) {
        setIsStale(true);
      } else {
        setError('Unable to load employee profile from the corporate authentication service. Please check your network connection and try again.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFresh();
  }, [fetchFresh]);

  const basePath = location.pathname.startsWith('/cs')
    ? '/cs'
    : location.pathname.startsWith('/employee')
      ? '/employee'
      : '';

  const dashboardUrl = basePath ? `${basePath}/dashboard` : '/customer-dashboard';

  const profile = {
    id: effectiveUser?.id || effectiveUser?.emp_id || 'EMP-001',
    emp_id: effectiveUser?.emp_id || effectiveUser?.id || 'EMP-001',
    firstName: effectiveUser?.first_name || '',
    middleName: effectiveUser?.middle_name || '',
    lastName: effectiveUser?.last_name || '',
    name: effectiveUser?.client_name || effectiveUser?.name || `${effectiveUser?.first_name || ''} ${effectiveUser?.last_name || ''}`.trim() || 'Jane Doe',
    email: effectiveUser?.email || '',
    phone: effectiveUser?.phone || effectiveUser?.contact_number || '',
    address: effectiveUser?.address || '',
    role: effectiveUser?.role || 'Employee',
    department: effectiveUser?.department || 'Engineering',
    facility: effectiveUser?.facility || effectiveUser?.branch || 'Headquarters',
    is_readonly_cms: effectiveUser?.is_readonly_cms ?? true,
    lastSynced: lastSyncedAt ? formatDisplayDate(lastSyncedAt) : 'Just now',
    dateJoined: effectiveUser?.created_at
      ? new Date(effectiveUser.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : 'January 5, 2025',
  };

  const handleProfileUpdated = (updatedUser) => {
    setFreshProfile(updatedUser);
    if (setUser) setUser(updatedUser);
  };

  // Full-page error state when no profile data can be loaded
  if (error && !effectiveUser) {
    return (
      <div className="p-8 max-w-xl mx-auto my-12 text-center bg-card rounded-2xl border border-destructive/20 shadow-xs font-sans">
        <div className="w-16 h-16 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center mx-auto mb-4 border border-destructive/20">
          <AlertCircle size={32} />
        </div>
        <h2 className="text-xl font-bold text-dark-slate mb-2">Profile Synchronization Failed</h2>
        <p className="text-sm text-muted-slate mb-6 leading-relaxed">
          {error}
        </p>
        <Button
          type="button"
          onClick={() => fetchFresh(true)}
          className="inline-flex items-center gap-2 cursor-pointer"
        >
          <RefreshCw size={16} />
          Retry Synchronization
        </Button>
      </div>
    );
  }

  // Initial loading skeleton if no cached profile exists
  if (loading && !effectiveUser) {
    return (
      <div className="p-8 space-y-6 max-w-5xl mx-auto font-sans">
        <SkeletonLoader className="h-8 w-40" />
        <SkeletonLoader className="h-44 w-full rounded-xl" />
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <SkeletonLoader className="h-96 w-full rounded-xl" />
          <SkeletonLoader className="h-96 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-5xl mx-auto font-sans">
      <PageHeader
        title="My Profile"
        subtitle="Identity and account information synced from central corporate authentication."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fetchFresh(true)}
              disabled={loading}
              className="cursor-pointer gap-1.5"
              title="Refresh profile data from Auth system"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin text-accent' : ''} />
              {loading ? 'Syncing...' : 'Sync with Auth'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(dashboardUrl)}
              className="cursor-pointer gap-1.5 text-muted-slate hover:text-dark-slate"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </Button>
          </div>
        }
      />

      {/* Graceful Degradation / Stale Data State Banner */}
      {isStale && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-start justify-between gap-3 text-xs text-amber-900 animate-fadeIn">
          <div className="flex items-start gap-2.5">
            <WifiOff size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-amber-900">Viewing Cached Profile Information</p>
              <p className="text-amber-700 mt-0.5 leading-relaxed">
                We are currently displaying your cached identity profile synced on {formatDisplayDate(lastSyncedAt)}. Updates from corporate Auth will be synchronized automatically when the connection is refreshed.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fetchFresh(true)}
            className="shrink-0 text-amber-900 border-amber-300 hover:bg-amber-100 cursor-pointer"
          >
            Retry
          </Button>
        </div>
      )}

      <ProfileHero profile={profile} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <PersonalInfoCard profile={profile} onProfileUpdated={handleProfileUpdated} />
        <PreferencesCard role={profile.role} />
      </div>

      <SecurityCard />
    </div>
  );
}
