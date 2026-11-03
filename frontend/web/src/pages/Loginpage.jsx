import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, resolveUserRole, resolveUserDepartment } from '@/context/AuthContext';
import loginImage from '@/assets/login.png';
import { Mail, Lock, Eye, EyeOff, AlertCircle, AlertTriangle, ArrowLeft, ShieldCheck, Loader2 } from 'lucide-react';
import { getSystemStatus } from '@/services/configurationService';
import ForgotPasswordModal from '@/components/ForgotPasswordModal';
import ForceChangePasswordModal from '@/components/ForceChangePasswordModal';

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 60;
const LOCKOUT_STORAGE_KEY_PREFIX = 'login_lockout_until_';

const lockKeyFor = (email) => `${LOCKOUT_STORAGE_KEY_PREFIX}${email}`;

const checkIsCS = (user) => {
  if (!user) return false;
  const dept = resolveUserDepartment(user).toLowerCase();
  const role = resolveUserRole(user).toLowerCase();
  
  if (dept.includes('customer service') || dept.includes('customer support') || dept === 'cs') {
    return true;
  }
  return (
    role.includes('customer service') ||
    role.includes('customer-service') ||
    role.includes('head of cs') ||
    role.includes('head of customer service') ||
    role === 'cs' ||
    role === 'head cs'
  );
};

const checkIsSuperAdmin = (user) => {
  if (!user) return false;
  const role = resolveUserRole(user).toLowerCase();
  const dept = resolveUserDepartment(user).toLowerCase();
  return role === 'superadmin' || role === 'super admin' || dept === 'superadmin' || dept === 'super admin';
};

const checkIsAdmin = (user) => {
  if (!user) return false;
  const role = resolveUserRole(user).toLowerCase();
  const dept = resolveUserDepartment(user).toLowerCase();
  return role === 'admin' || role === 'it admin' || (dept === 'admin' && role !== 'superadmin' && role !== 'super admin');
};

const checkIsEmployee = (user) => {
  if (!user) return false;
  if (checkIsCS(user)) return false;
  if (checkIsAdmin(user)) return false;
  if (checkIsSuperAdmin(user)) return false;
  
  const dept = resolveUserDepartment(user).toLowerCase();
  const role = resolveUserRole(user).toLowerCase();
  
  if (dept === 'service' || dept.includes('engineer')) {
    return true;
  }
  return role === 'employee' || role.includes('service') || role.includes('engineer');
};

/* ══════════════════════════════════════════════════════════════════════
   STYLES — ONE UI DESIGN SYSTEM ENFORCEMENT (matches Capstone-Auth LoginView.vue)
   Brand Primary: #252578 | Brand Accent: #2E85D8 | Brand Deep: #3A3A85
   Dark Slate: #1E293B | Muted Slate: #8D8B8F | Page Background: #F8F9FA
   ══════════════════════════════════════════════════════════════════════ */
const loginStyles = `
.login-container * { box-sizing: border-box; margin: 0; padding: 0; }

.login-container {
  display: flex;
  min-height: 100vh;
  width: 100%;
  background-color: #f8f9fa;
  font-family: 'Poppins', 'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif;
  color: #1e293b;
}

/* ── LEFT PANEL (Branding & Identity) ── */
.left-panel {
  position: relative;
  width: 50%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 48px;
  overflow: hidden;
  background-color: #0e0e2e;
}
.bg-image {
  position: absolute;
  inset: 0;
  width: 100%; height: 100%;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  z-index: 1;
}
.overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(37,37,120,0.86) 0%, rgba(25,25,90,0.80) 50%, rgba(14,14,46,0.94) 100%);
  z-index: 2;
}
.left-top { position: relative; z-index: 3; }
.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(255,255,255,0.12);
  border: 1px solid rgba(255,255,255,0.22);
  color: #fff;
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: all 0.2s ease;
  font-family: inherit;
}
.back-btn:hover {
  background: rgba(255,255,255,0.22);
  transform: translateX(-2px);
}
.left-content {
  position: relative;
  z-index: 3;
  width: fit-content;
  max-width: 520px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.left-title {
  font-size: clamp(28px, 3.2vw, 42px);
  font-weight: 800;
  color: #fff;
  line-height: 1.2;
  letter-spacing: -0.01em;
  margin-bottom: 20px;
  text-align: left;
}
.left-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  background: rgba(255,255,255,0.14);
  border: 1px solid rgba(255,255,255,0.24);
  border-radius: 9999px;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  align-self: flex-start;
  backdrop-filter: blur(8px);
}
.badge-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background-color: #10b981;
  box-shadow: 0 0 8px #10b981;
}
.left-system-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 9999px;
  background: rgba(255,255,255,0.10);
  border: 1px solid rgba(255,255,255,0.20);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-bottom: 16px;
}

/* ── RIGHT PANEL (Form Surface) ── */
.right-panel {
  width: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #f8f9fa;
  padding: 48px;
}
.login-card {
  width: 100%;
  max-width: 500px;
  background-color: #fff;
  border-radius: 24px;
  padding: 48px;
  box-shadow: 0 20px 45px -10px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.04);
}
.card-head { text-align: center; margin-bottom: 32px; }
.card-title {
  font-size: 30px;
  font-weight: 800;
  color: #1e293b;
  letter-spacing: -0.015em;
  margin-bottom: 8px;
  text-align: center;
}
.card-subtitle {
  font-size: 14px;
  color: #8d8b8f;
  line-height: 1.5;
  text-align: center;
}

/* Alerts */
.login-alert-error {
  background-color: #fef2f2;
  border: 1px solid #fca5a5;
  color: #ef4444;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.login-alert-warning {
  background-color: #fffbeb;
  border: 1px solid #fcd34d;
  color: #92400e;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Form */
.form-body { display: flex; flex-direction: column; gap: 22px; }
.form-group { display: flex; flex-direction: column; }
.field-label {
  font-size: 11.5px;
  font-weight: 700;
  color: #8086a3;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  margin-bottom: 8px;
}
.password-label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.forgot-link {
  background: none;
  border: none;
  padding: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: #2e85d8;
  cursor: pointer;
  text-decoration: none;
  transition: color 0.2s ease;
  font-family: inherit;
}
.forgot-link:hover { color: #252578; text-decoration: underline; }
.input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}
.input-icon {
  position: absolute;
  left: 16px;
  color: #94a3b8;
  pointer-events: none;
}
.input-field {
  width: 100%;
  height: 50px;
  padding: 12px 16px 12px 46px;
  background-color: #fff;
  border: 1.5px solid #e2e8f0;
  border-radius: 10px;
  font-size: 14.5px;
  font-family: inherit;
  color: #1e293b;
  outline: none;
  transition: all 0.2s ease;
}
.input-field--password { padding-right: 46px; }
.input-field::placeholder { color: #94a3b8; }
.input-field:focus {
  border-color: #2e85d8;
  box-shadow: 0 0 0 3px rgba(46,133,216,0.15);
}
.input-wrapper.has-error .input-field {
  border-color: #ef4444;
  background-color: #fffbfb;
}
.eye-toggle {
  position: absolute;
  right: 16px;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  color: #94a3b8;
  transition: color 0.2s ease;
}
.eye-toggle:hover { color: #252578; }

/* Submit Button */
.login-btn {
  width: 100%;
  height: 52px;
  margin-top: 8px;
  background-color: #252578;
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 16px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-shadow: 0 2px 6px rgba(37,37,120,0.2);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.login-btn:hover:not(:disabled) {
  background-color: #2f2f8e;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(37,37,120,0.3);
}
.login-btn:active:not(:disabled) {
  background-color: #1e1e66;
  transform: scale(0.98);
}
.login-btn:disabled {
  background-color: #94a3b8;
  opacity: 0.7;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}
.btn-spinner { animation: spin 0.8s linear infinite; }
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Security Notice */
.security-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12px;
  color: #8d8b8f;
  margin-top: 28px;
}
.security-icon { color: #10b981; }

/* Back link */
.back-link-row {
  text-align: center;
  margin-top: 16px;
}
.back-link-btn {
  background: none;
  border: none;
  padding: 0;
  font-size: 12px;
  font-weight: 600;
  color: #2e85d8;
  cursor: pointer;
  text-decoration: none;
  font-family: inherit;
  transition: color 0.2s ease;
}
.back-link-btn:hover { color: #252578; text-decoration: underline; }

.mobile-brand-title {
  display: none;
  font-size: 13px;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: 0.02em;
}

/* ── RESPONSIVE ── */
@media (max-width: 960px) {
  .login-container {
    flex-direction: column;
    min-height: 100vh;
    background-color: #f8f9fa;
  }
  .left-panel {
    width: 100%;
    min-height: 80px;
    padding: 16px 20px;
    justify-content: center;
  }
  .left-content {
    display: none;
  }
  .left-badge {
    display: none;
  }
  .mobile-brand-title {
    display: inline-block;
  }
  .left-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }
  .right-panel {
    width: 100%;
    flex: 1;
    padding: 24px 16px 40px 16px;
    align-items: flex-start;
  }
  .login-card {
    width: 100%;
    max-width: 440px;
    margin: 0 auto;
    padding: 32px 24px;
    background-color: #ffffff;
    border-radius: 20px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
    border: 1px solid #e2e8f0;
  }
  .card-title {
    font-size: 24px;
    margin-bottom: 6px;
  }
  .card-subtitle {
    font-size: 13px;
  }
}

@media (max-width: 480px) {
  .left-panel {
    min-height: 110px;
    padding: 16px 14px;
  }
  .right-panel {
    padding: 16px 12px 32px 12px;
  }
  .login-card {
    padding: 24px 16px;
    border-radius: 16px;
  }
  .card-title {
    font-size: 21px;
  }
  .card-subtitle {
    font-size: 12px;
  }
  .form-body {
    gap: 16px;
  }
  .input-field {
    height: 46px;
    font-size: 14px;
  }
  .login-btn {
    height: 48px;
    font-size: 15px;
  }
}
`;

export function Loginpage({ mode = 'customer' }) {
  const navigate = useNavigate();
  const { login, clearError, isAuthenticated, user, isFirstLogin } = useAuth();
  const isEmployeeLogin = mode === 'employee';

  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Rate limiting state 
  const [attempts, setAttempts] = useState(0);
  const [lockedOut, setLockedOut] = useState(false);
  const [lockTimer, setLockTimer] = useState(LOCKOUT_SECONDS);
  const [loginError, setLoginError] = useState('');
  const [lockedEmail, setLockedEmail] = useState('');

  // Forgot password modal
  const [showForgot, setShowForgot] = useState(false);

  // System maintenance status
  const [isMaintenance, setIsMaintenance] = useState(false);

  /* Inject scoped styles */
  useEffect(() => {
    const tag = document.createElement('style');
    tag.textContent = loginStyles;
    document.head.appendChild(tag);
    return () => tag.remove();
  }, []);

  useEffect(() => {
    let isMounted = true;
    getSystemStatus().then((status) => {
      if (isMounted && status === 'Under Maintenance') {
        setIsMaintenance(true);
      }
    }).catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  // Prevent browsing back to login if already authenticated and completed first login
  useEffect(() => {
    if (isAuthenticated && user && !isFirstLogin) {
      const isCS = checkIsCS(user);
      const isEmployee = checkIsEmployee(user);
      const isSuperAdmin = checkIsSuperAdmin(user);
      const isAdmin = checkIsAdmin(user);
      const isCustomerSite = import.meta.env.VITE_APP_MODE === 'customer';

      if (isSuperAdmin) {
        navigate('/superadmin/config', { replace: true });
      } else if (isAdmin) {
        navigate('/admin/dashboard', { replace: true });
      } else if (isCustomerSite) {
        if (isCS) {
          window.location.replace('/ticketing/cs/dashboard');
        } else if (isEmployee) {
          window.location.replace('/ticketing/employee/dashboard');
        } else {
          navigate('/customer-dashboard', { replace: true });
        }
      } else {
        if (isCS) {
          navigate('/cs/dashboard', { replace: true });
        } else if (isEmployee) {
          navigate('/employee/dashboard', { replace: true });
        } else {
          navigate('/customer-dashboard', { replace: true });
        }
      }
    }
  }, [isAuthenticated, user, isFirstLogin, navigate]);

  // Lockout per-email handling
  useEffect(() => {
    const checkLockForEmail = () => {
      if (!email) return;
      const saved = Number(localStorage.getItem(lockKeyFor(email)) || 0);
      const now = Date.now();
      if (saved > now) {
        setLockedOut(true);
        setLockedEmail(email);
        setLockTimer(Math.max(1, Math.ceil((saved - now) / 1000)));
      } else {
        localStorage.removeItem(lockKeyFor(email));
        if (lockedEmail === email) {
          setLockedOut(false);
          setLockedEmail('');
          setLockTimer(LOCKOUT_SECONDS);
          setLoginError('');
        }
      }
    };

    checkLockForEmail();
    if (!lockedOut) return;
    if (lockTimer <= 0) {
      setLockedOut(false);
      setAttempts(0);
      setLockTimer(LOCKOUT_SECONDS);
      setLoginError('');
      localStorage.removeItem(lockKeyFor(lockedEmail));
      setLockedEmail('');
      return;
    }
    const t = setTimeout(() => setLockTimer((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [email, lockedOut, lockTimer, lockedEmail]);

  const formatLock = (s) => {
    const m = Math.floor(s / 60).toString().padStart(2, '0');
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  const handleLogin = async (e) => {
    e.preventDefault();

    if (lockedOut || isSubmitting) return;

    setLoginError('');
    clearError();
    setIsSubmitting(true);

    try {
      const result = await login(email, password, mode);

      if (result.success) {
        setLoginError('');
        setAttempts(0);

        // If first login, remain on login page so ForceChangePasswordModal renders immediately
        if (result.isFirstLogin) {
          return;
        }

        const isCS = checkIsCS(result.user);
        const isEmployee = checkIsEmployee(result.user);
        const isSuperAdmin = checkIsSuperAdmin(result.user);
        const isAdmin = checkIsAdmin(result.user);
        const isCustomerSite = import.meta.env.VITE_APP_MODE === 'customer';

        if (isSuperAdmin) {
          navigate('/superadmin/config', { replace: true });
        } else if (isAdmin) {
          navigate('/admin/dashboard', { replace: true });
        } else if (isCustomerSite) {
          if (isCS) {
            window.location.replace('/ticketing/cs/dashboard');
          } else if (isEmployee) {
            window.location.replace('/ticketing/employee/dashboard');
          } else {
            navigate('/customer-dashboard', { replace: true });
          }
        } else {
          if (isCS) {
            navigate('/cs/dashboard', { replace: true });
          } else if (isEmployee) {
            navigate('/employee/dashboard', { replace: true });
          } else {
            navigate('/customer-dashboard', { replace: true });
          }
        }
      } else {
        if (result.retryAfter) {
          const seconds = Number(result.retryAfter);
          if (!Number.isNaN(seconds) && seconds > 0) {
            setLockedOut(true);
            const lockUntilMs = Date.now() + seconds * 1000;
            localStorage.setItem(lockKeyFor(email), String(lockUntilMs));
            setLockTimer(seconds);
            setLoginError(`${result.error} Try again in ${formatLock(seconds)}`);
          } else {
            setLoginError(result.error);
          }
          setIsSubmitting(false);
          return;
        }

        const remainingAttempts = result.remainingAttempts ?? Math.max(0, MAX_ATTEMPTS - (attempts + 1));
        setAttempts(MAX_ATTEMPTS - remainingAttempts);

        if (result.lockedUntil || remainingAttempts === 0) {
          setLockedOut(true);
          const lockUntilMs = Date.now() + LOCKOUT_SECONDS * 1000;
          localStorage.setItem(lockKeyFor(email), String(lockUntilMs));
          setLockedEmail(email);
          setLockTimer(LOCKOUT_SECONDS);
          setLoginError(`Account temporarily locked. Please wait ${LOCKOUT_SECONDS} seconds.`);
        } else {
          setLoginError(
            result.lockedUntil
              ? `${result.error} Account is locked temporarily.`
              : `${result.error} ${remainingAttempts} attempt(s) remaining.`
          );
        }
      }
    } catch (error) {
      console.error('Login error:', error);
      setLoginError('Login failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-container">
      {/* ── LEFT PANEL (Branding & Enterprise Identity) ── */}
      <div className="left-panel">
        <div className="bg-image" style={{ backgroundImage: `url(${loginImage})` }} />
        <div className="overlay" />

        {/* Top Bar: Back to Home */}
        <div className="left-top">
          <button className="back-btn" onClick={() => navigate('/')} aria-label="Back to Home">
            <ArrowLeft size={16} />
            <span>Back to Home</span>
          </button>
          <span className="mobile-brand-title">SBSI Ticketing</span>
        </div>

        {/* Bottom Narrative */}
        <div className="left-content">
          <div className="left-system-badge">Ticketing System</div>
          <h1 className="left-title">
            25 Years of Innovating Diagnostics Solutions
          </h1>
          <div className="left-badge">
            <span className="badge-dot" />
            <span>Scientific Biotech Specialties, Inc. — ISO 9001:2015 Certified</span>
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL (ONE UI Compliant Form Surface) ── */}
      <div className="right-panel">
        <div className="login-card">
          {/* Header */}
          <div className="card-head">
            <h2 className="card-title">
              {isEmployeeLogin ? 'Employee Portal' : 'Welcome Back!'}
            </h2>
            <p className="card-subtitle">
              {isEmployeeLogin
                ? 'Sign in to access your technical queues and tickets.'
                : 'Sign in to the Ticketing System to manage support requests.'}
            </p>
          </div>

          {/* Maintenance advisory */}
          {isMaintenance && (
            <div className="login-alert-warning" role="alert">
              <AlertTriangle size={16} style={{ flexShrink: 0, color: '#d97706' }} />
              <span>System Notice: Platform is currently in Maintenance Mode. Non-admin logins may be restricted.</span>
            </div>
          )}

          {/* Lockout banner */}
          {lockedOut && (
            <div className="login-alert-error" role="alert">
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>Too many failed attempts. Try again in {formatLock(lockTimer)}.</span>
            </div>
          )}

          {/* Inline error */}
          {loginError && !lockedOut && (
            <div className="login-alert-error" role="alert">
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{loginError}</span>
            </div>
          )}

          {/* Login Form */}
          <form className="form-body" onSubmit={handleLogin}>
            {/* EMAIL FIELD */}
            <div className="form-group">
              <label htmlFor="login-email" className="field-label">Email Address</label>
              <div className="input-wrapper">
                <Mail size={18} className="input-icon" />
                <input
                  id="login-email"
                  type="email"
                  placeholder="name@company.com"
                  className="input-field"
                  value={email}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEmail(v);
                    if (lockedOut && lockedEmail && v !== lockedEmail) {
                      setLockedOut(false);
                      setLockedEmail('');
                      setLoginError('');
                    }
                  }}
                  required
                  maxLength={255}
                  autoComplete="email"
                />
              </div>
            </div>

            {/* PASSWORD FIELD */}
            <div className="form-group">
              <div className="password-label-row">
                <label htmlFor="login-password" className="field-label">Password</label>
                {!isEmployeeLogin && (
                  <button type="button" className="forgot-link" onClick={() => setShowForgot(true)}>
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="input-wrapper">
                <Lock size={18} className="input-icon" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  className="input-field input-field--password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  maxLength={255}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="eye-toggle"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label="Toggle password visibility"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* SUBMIT BUTTON */}
            <button
              id="login-submit"
              type="submit"
              className="login-btn"
              disabled={(lockedOut && lockedEmail === email) || isSubmitting}
            >
              {isSubmitting && <Loader2 size={18} className="btn-spinner" />}
              <span>{isSubmitting ? 'Signing in...' : 'Sign In'}</span>
            </button>
          </form>

          {/* SECURITY NOTICE */}
          <div className="security-footer">
            <ShieldCheck size={16} className="security-icon" />
            <span>Protected by SBSI Central Identity Authority</span>
          </div>

          {/* Back / Forgot link */}
          {isEmployeeLogin && (
            <div className="back-link-row">
              <button type="button" className="back-link-btn" onClick={() => navigate('/')}>
                Back to Central Portal
              </button>
            </div>
          )}
        </div>
      </div>

      {/* FORGOT PASSWORD MODAL */}
      {showForgot && (
        <ForgotPasswordModal
          onClose={() => setShowForgot(false)}
          defaultEmail={email}
        />
      )}

      {/* FORCE CHANGE PASSWORD / FIRST LOGIN OTP MODAL */}
      {isFirstLogin && <ForceChangePasswordModal />}
    </div>
  );
}

export default Loginpage;
