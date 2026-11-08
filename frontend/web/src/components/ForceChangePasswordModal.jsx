import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import axiosInstance from '@/api/axiosInstance';
import { Lock, Eye, EyeOff, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';

/**
 * Blocking modal shown when the backend flags `is_first_login`.
 * Conforms to ONE UI Section VI.5 & VI.6 standards.
 */
export default function ForceChangePasswordModal() {
  useLockBodyScroll(true);
  const { user, revalidateSession, logout } = useAuth();

  const isEmployee = Boolean(user && (user.emp_id || ['employee', 'customer service', 'admin', 'superadmin'].includes(user.role?.toLowerCase())));
  const isCustomer = !isEmployee;
  const [step, setStep] = useState(isCustomer ? 1 : 2); // 1: Verify OTP, 2: Change Password
  const [otp, setOtp] = useState(isCustomer ? '' : '000000');
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const [resendNotice, setResendNotice] = useState('');

  useEffect(() => {
    if (user) {
      const isEmp = Boolean(user.emp_id || ['employee', 'customer service', 'admin', 'superadmin'].includes(user.role?.toLowerCase()));
      if (!isEmp) {
        setStep(1);
        setOtp((prev) => (prev === '000000' ? '' : prev));
      }
    }
  }, [user]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = 'Password change is mandatory. If you leave, you will remain locked to this screen.';
      return e.returnValue;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  const hasMinLength = newPassword.length >= 12;
  const hasUppercase = /[A-Z]/.test(newPassword);
  const hasNumber = /\d/.test(newPassword);
  const hasSymbol = /[!@#$%^&*(),.?":{}|<>]/.test(newPassword);
  const isPasswordValid = hasMinLength && hasUppercase && hasNumber && hasSymbol;
  const isOtpValid = /^\d{6}$/.test(otp);

  const handleResendOtp = async () => {
    if (resendCooldown > 0 || resending || busy) return;
    setResending(true);
    setError('');
    setResendNotice('');

    try {
      const res = await axiosInstance.post('/first-login/resend-otp');
      setResendNotice(res.data?.message || 'A new verification code has been sent to your email.');
      setResendCooldown(res.data?.cooldown_seconds || 60);
    } catch (err) {
      if (err.response?.status === 429) {
        setResendCooldown(err.response?.data?.retry_after || 60);
        setError(err.response?.data?.message || 'Please wait before requesting another code.');
      } else {
        setError(err.response?.data?.message || 'Failed to resend code. Please try again.');
      }
    } finally {
      setResending(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setResendNotice('');

    if (!isOtpValid) {
      setError('Please enter a valid 6-digit OTP code.');
      return;
    }

    setBusy(true);
    try {
      await axiosInstance.post('/first-login/verify-otp', { otp });
      setStep(2);
    } catch (err) {
      const remaining = err.response?.data?.remaining_attempts;
      let msg = err.response?.data?.message || 'Invalid or expired OTP code.';
      if (remaining !== undefined && remaining !== null) {
        msg = `${msg} (${remaining} attempts remaining before temporary lockout).`;
      }
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitPassword = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');

    if (!currentPassword) {
      setError('Please enter your current password.');
      return;
    }

    if (!isPasswordValid) {
      setError('New password must meet all complexity requirements.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New password and confirmation password do not match.');
      return;
    }

    if (newPassword === currentPassword) {
      setError('New password cannot be identical to your system-generated default credential.');
      return;
    }

    setBusy(true);

    try {
      const { fetchEncryptionKey, encryptPayload } = await import('@/utils/rsa');
      const { public_key, key_id } = await fetchEncryptionKey();

      await axiosInstance.post('/change-password', {
        otp: otp,
        current_password: encryptPayload(currentPassword, public_key),
        new_password: encryptPayload(newPassword, public_key),
        new_password_confirmation: encryptPayload(confirmPassword, public_key),
      }, {
        headers: {
          'X-Key-Id': key_id,
        },
      });

      setSuccess(true);
      sessionStorage.removeItem('first_login_pending');

      setTimeout(async () => {
        await revalidateSession();
      }, 1800);
    } catch (err) {
      const msg =
        err.response?.data?.message ||
        (err.response?.data?.errors
          ? Object.values(err.response.data.errors).flat()[0]
          : 'Failed to change password. Please try again.');
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 font-sans">
      <div
        className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl border border-slate-100 flex flex-col gap-4 relative animate-fade-slide-in"
        role="dialog"
        aria-modal="true"
        aria-label="Change your password"
      >
        {/* Accent bar at top */}
        <div className="absolute top-0 left-0 right-0 h-1.5 rounded-t-2xl bg-gradient-to-r from-primary to-accent" />

        {!success ? (
          step === 1 ? (
            <form onSubmit={handleVerifyOtp} className="space-y-4 pt-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-primary mx-auto">
                <Lock className="h-6 w-6" />
              </div>

              <div className="text-center space-y-1">
                <h2 className="text-xl font-bold text-dark-slate">
                  First Login Verification
                </h2>
                <p className="text-xs text-muted-slate leading-relaxed">
                  Enter the 6-digit OTP code sent to your registered email address.
                  {user?.name ? ` Welcome, ${user.name}.` : ''}
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-destructive font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {resendNotice && !error && (
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 font-medium flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{resendNotice}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="fcp-otp">OTP Code</Label>
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    disabled={resendCooldown > 0 || resending || busy}
                    className="text-xs text-accent hover:underline disabled:text-muted-slate disabled:no-underline font-semibold"
                  >
                    {resendCooldown > 0
                      ? `Resend in ${resendCooldown}s`
                      : resending
                      ? 'Sending...'
                      : 'Resend Code'}
                  </button>
                </div>
                <Input
                  id="fcp-otp"
                  type="text"
                  className="font-mono tracking-widest text-center text-lg font-bold"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  autoComplete="one-time-code"
                  disabled={busy}
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={logout}
                  disabled={busy}
                >
                  Log Out
                </Button>
                <Button
                  type="submit"
                  variant="default"
                  disabled={busy || !isOtpValid}
                  loading={busy}
                >
                  Verify Code
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleSubmitPassword} className="space-y-4 pt-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-primary mx-auto">
                <Lock className="h-6 w-6" />
              </div>

              <div className="text-center space-y-1">
                <h2 className="text-xl font-bold text-dark-slate">
                  Set New Password
                </h2>
                <p className="text-xs text-muted-slate leading-relaxed">
                  Your identity is verified. Create a secure password to activate your account.
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-destructive font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="fcp-current">Current Password</Label>
                <div className="relative">
                  <Input
                    id="fcp-current"
                    type={showCurrent ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    autoComplete="current-password"
                    disabled={busy}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-slate hover:text-dark-slate"
                    onClick={() => setShowCurrent((p) => !p)}
                    tabIndex={-1}
                  >
                    {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="fcp-new">New Password</Label>
                <div className="relative">
                  <Input
                    id="fcp-new"
                    type={showNew ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter strong new password"
                    autoComplete="new-password"
                    disabled={busy}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-slate hover:text-dark-slate"
                    onClick={() => setShowNew((p) => !p)}
                    tabIndex={-1}
                  >
                    {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="fcp-confirm">Confirm New Password</Label>
                <div className="relative">
                  <Input
                    id="fcp-confirm"
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    autoComplete="new-password"
                    disabled={busy}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-slate hover:text-dark-slate"
                    onClick={() => setShowConfirm((p) => !p)}
                    tabIndex={-1}
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Password complexity checklist */}
              <div className="grid grid-cols-2 gap-2 p-3 rounded-lg bg-slate-50 text-[11px] text-muted-slate">
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${hasMinLength ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  <span>12+ characters</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${hasUppercase ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  <span>Uppercase letter</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${hasNumber ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  <span>Number</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${hasSymbol ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  <span>Special symbol</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={logout}
                  disabled={busy}
                >
                  Log Out
                </Button>
                <Button
                  type="submit"
                  variant="default"
                  disabled={busy || !isPasswordValid || newPassword !== confirmPassword || !currentPassword}
                  loading={busy}
                >
                  Update Password
                </Button>
              </div>
            </form>
          )
        ) : (
          <div className="text-center py-6 space-y-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 mx-auto">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <h2 className="text-xl font-bold text-dark-slate">Password Changed!</h2>
            <p className="text-xs text-muted-slate">
              Your password was updated successfully. Redirecting to your dashboard…
            </p>
            <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 animate-pulse w-full" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
