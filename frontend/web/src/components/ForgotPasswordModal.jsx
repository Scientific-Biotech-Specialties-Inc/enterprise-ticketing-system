import React, { useState, useEffect, useRef } from 'react';
import { Mail, Lock, Eye, EyeOff, CheckCircle2, AlertCircle, Loader2, X, ArrowLeft, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';
import {
  requestPasswordReset,
  verifyPasswordResetOtp,
  resetPassword,
} from '@/services/authService';

const OTP_SECONDS = 210; // 3 minutes 30 seconds

export default function ForgotPasswordModal({ onClose, defaultEmail = '' }) {
  useLockBodyScroll(true);

  const [step, setStep] = useState(1); // 1: Email, 2: OTP, 3: New Password, 4: Success
  const [email, setEmail] = useState(defaultEmail);
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [otpTimer, setOtpTimer] = useState(OTP_SECONDS);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const otpRefs = useRef([...Array(6)].map(() => React.createRef()));

  // OTP Countdown timer
  useEffect(() => {
    if (step !== 2) return;
    if (otpTimer <= 0) return;
    const timer = setInterval(() => {
      setOtpTimer((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [step, otpTimer]);

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const hasMinLength = newPassword.length >= 12;
  const hasUppercase = /[A-Z]/.test(newPassword);
  const hasNumber = /\d/.test(newPassword);
  const hasSymbol = /[^A-Za-z0-9]/.test(newPassword);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const isPasswordValid = hasMinLength && hasUppercase && hasNumber && hasSymbol && passwordsMatch;

  const extractError = (err) => {
    if (typeof err === 'string') return err;
    if (err?.errors) {
      const firstKey = Object.keys(err.errors)[0];
      const val = err.errors[firstKey];
      return Array.isArray(val) ? val[0] : String(val);
    }
    return err?.message || 'An error occurred. Please try again.';
  };

  // STEP 1: Request Password Reset OTP
  const handleSendCode = async (e) => {
    e?.preventDefault();
    if (!email.trim() || busy) return;

    setBusy(true);
    setError('');
    setNotice('');

    try {
      await requestPasswordReset(email.trim());
      setStep(2);
      setOtp(['', '', '', '', '', '']);
      setOtpTimer(OTP_SECONDS);
      setNotice('A 6-digit verification code has been sent to your email.');
      setTimeout(() => {
        otpRefs.current[0]?.current?.focus();
      }, 100);
    } catch (err) {
      setError(extractError(err) || 'Unable to send verification code. Please check your email.');
    } finally {
      setBusy(false);
    }
  };

  // STEP 2: Handle OTP inputs
  const handleOtpChange = (value, index) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[index] = digit;
    setOtp(next);

    if (digit && index < 5) {
      otpRefs.current[index + 1]?.current?.focus();
    }
  };

  const handleOtpKeyDown = (e, index) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.current?.focus();
    }
  };

  const handleOtpPaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;

    const next = [...Array(6)].map((_, i) => pasted[i] || '');
    setOtp(next);
    const targetIdx = Math.min(pasted.length, 5);
    otpRefs.current[targetIdx]?.current?.focus();
  };

  const handleVerifyOtp = async (e) => {
    e?.preventDefault();
    if (busy) return;

    const code = otp.join('');
    if (code.length !== 6) {
      setError('Please enter the complete 6-digit code.');
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');

    try {
      await verifyPasswordResetOtp(email.trim(), code);
      setStep(3);
    } catch (err) {
      setError(extractError(err) || 'Invalid or expired verification code.');
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    if (busy) return;

    setBusy(true);
    setError('');
    setNotice('');

    try {
      await requestPasswordReset(email.trim());
      setOtp(['', '', '', '', '', '']);
      setOtpTimer(OTP_SECONDS);
      setNotice('A new code has been sent to your email.');
      otpRefs.current[0]?.current?.focus();
    } catch (err) {
      setError(extractError(err) || 'Unable to resend code.');
    } finally {
      setBusy(false);
    }
  };

  // STEP 3: Reset Password
  const handleResetPassword = async (e) => {
    e?.preventDefault();
    if (busy) return;

    if (!hasMinLength || !hasUppercase || !hasNumber || !hasSymbol) {
      setError('Password must meet all format requirements.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');

    try {
      await resetPassword(email.trim(), otp.join(''), newPassword, confirmPassword);
      setStep(4);
    } catch (err) {
      setError(extractError(err) || 'Failed to reset password. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in duration-200"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="relative w-full max-w-md rounded-2xl bg-white border border-slate-200/80 p-6 sm:p-8 shadow-2xl text-dark-slate my-8 transition-all"
        role="dialog"
        aria-modal="true"
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-muted-slate hover:text-dark-slate hover:bg-slate-100 transition-colors"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        {/* ── STEP 1: Enter Email ── */}
        {step === 1 && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent shrink-0">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-primary tracking-tight">Forgot Password?</h2>
                <p className="text-xs text-muted-slate mt-0.5">
                  Enter your registered email to receive a recovery code.
                </p>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-destructive flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSendCode} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="fp-email" className="text-xs font-semibold text-dark-slate">
                  Email Address
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-slate" />
                  <Input
                    id="fp-email"
                    type="email"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10 h-11 text-sm bg-slate-50/50"
                    required
                    autoFocus
                  />
                </div>
              </div>

              <Button
                id="fp-send-code"
                type="submit"
                variant="default"
                className="w-full h-11 text-sm font-semibold"
                disabled={busy || !email.trim()}
                loading={busy}
              >
                Send Code
              </Button>
            </form>
          </div>
        )}

        {/* ── STEP 2: Enter OTP Code ── */}
        {step === 2 && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent shrink-0">
                <Mail className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-primary tracking-tight">Enter Verification Code</h2>
                <p className="text-xs text-muted-slate mt-0.5">
                  Code sent to <span className="font-semibold text-dark-slate">{email}</span>
                </p>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-destructive flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {notice && !error && (
              <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-xs text-accent flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{notice}</span>
              </div>
            )}

            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="flex justify-between gap-2">
                {otp.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={otpRefs.current[idx]}
                    id={`otp-${idx}`}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(e.target.value, idx)}
                    onKeyDown={(e) => handleOtpKeyDown(e, idx)}
                    onPaste={handleOtpPaste}
                    className="w-11 h-12 text-center text-lg font-bold rounded-xl border border-slate-300 bg-slate-50/50 focus:bg-white focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none transition-all"
                  />
                ))}
              </div>

              <div className="flex items-center justify-between text-xs pt-1">
                <span className="text-muted-slate">
                  {otpTimer > 0 ? (
                    <>Expires in <span className="font-semibold text-dark-slate">{formatTime(otpTimer)}</span></>
                  ) : (
                    <span className="text-destructive font-medium">Code expired</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={busy}
                  className="text-accent hover:underline font-semibold cursor-pointer disabled:opacity-50"
                >
                  Resend Code
                </button>
              </div>

              <div className="pt-2 flex flex-col gap-2">
                <Button
                  id="fp-verify"
                  type="submit"
                  variant="default"
                  className="w-full h-11 text-sm font-semibold"
                  disabled={busy || otp.join('').length !== 6}
                  loading={busy}
                >
                  Verify Code
                </Button>

                <button
                  type="button"
                  onClick={() => {
                    setStep(1);
                    setError('');
                    setNotice('');
                  }}
                  className="w-full py-2 text-xs text-muted-slate hover:text-dark-slate flex items-center justify-center gap-1 font-medium transition-colors"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Change Email Address
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── STEP 3: Reset Password ── */}
        {step === 3 && (
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-accent/10 flex items-center justify-center text-accent shrink-0">
                <Lock className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-primary tracking-tight">Reset Password</h2>
                <p className="text-xs text-muted-slate mt-0.5">
                  Create a new secure password for your account.
                </p>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-destructive flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="fp-new-password" className="text-xs font-semibold text-dark-slate">
                  New Password
                </Label>
                <div className="relative">
                  <Input
                    id="fp-new-password"
                    type={showNew ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="pr-10 h-11 text-sm bg-slate-50/50"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(!showNew)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-slate hover:text-dark-slate"
                  >
                    {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="fp-confirm-password" className="text-xs font-semibold text-dark-slate">
                  Confirm Password
                </Label>
                <div className="relative">
                  <Input
                    id="fp-confirm-password"
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    className="pr-10 h-11 text-sm bg-slate-50/50"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-slate hover:text-dark-slate"
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Password rules checklist */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5 text-muted-slate">
                <div className="font-semibold text-dark-slate mb-1">Password Requirements:</div>
                <div className={`flex items-center gap-1.5 ${hasMinLength ? 'text-emerald-600 font-medium' : ''}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${hasMinLength ? 'bg-emerald-600' : 'bg-slate-300'}`} />
                  Minimum 12 characters
                </div>
                <div className={`flex items-center gap-1.5 ${hasUppercase ? 'text-emerald-600 font-medium' : ''}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${hasUppercase ? 'bg-emerald-600' : 'bg-slate-300'}`} />
                  At least one uppercase letter (A-Z)
                </div>
                <div className={`flex items-center gap-1.5 ${hasNumber ? 'text-emerald-600 font-medium' : ''}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${hasNumber ? 'bg-emerald-600' : 'bg-slate-300'}`} />
                  At least one number (0-9)
                </div>
                <div className={`flex items-center gap-1.5 ${hasSymbol ? 'text-emerald-600 font-medium' : ''}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${hasSymbol ? 'bg-emerald-600' : 'bg-slate-300'}`} />
                  At least one symbol (!@#$%^&*...)
                </div>
                <div className={`flex items-center gap-1.5 ${passwordsMatch ? 'text-emerald-600 font-medium' : ''}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${passwordsMatch ? 'bg-emerald-600' : 'bg-slate-300'}`} />
                  Passwords match
                </div>
              </div>

              <Button
                id="fp-done"
                type="submit"
                variant="default"
                className="w-full h-11 text-sm font-semibold"
                disabled={busy || !isPasswordValid}
                loading={busy}
              >
                Reset Password
              </Button>
            </form>
          </div>
        )}

        {/* ── STEP 4: Success Confirmation ── */}
        {step === 4 && (
          <div className="text-center py-4 space-y-4">
            <div className="h-14 w-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-primary tracking-tight">Password Reset Complete!</h2>
              <p className="text-xs text-muted-slate mt-1.5 max-w-xs mx-auto leading-relaxed">
                Your password has been successfully updated. You can now sign in with your new credentials.
              </p>
            </div>
            <Button
              id="fp-login-btn"
              type="button"
              variant="default"
              className="w-full h-11 text-sm font-semibold mt-2"
              onClick={onClose}
            >
              Sign In Now
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
