import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axiosInstance from '@/api/axiosInstance';
import { AUTH_ENDPOINTS, SANCTUM_URL } from '@/config/api.config';
import tokenStore from '@/auth/tokenStore';

// GLOBAL AUTHENTICATION

const AuthContext = createContext({
  user: null,
  setUser: () => {},
  isAuthenticated: false,
  setIsAuthenticated: () => {},
  isLoading: true,
  error: null,
  isFirstLogin: false,
  login: async () => ({ success: false }),
  register: async () => ({ success: false }),
  logout: async () => ({ success: true }),
  updateProfile: async () => ({ success: false }),
  changePassword: async () => ({ success: false }),
  clearError: () => {},
  revalidateSession: async () => false,
});
const LOCKOUT_STORAGE_KEY = 'login_lockout_until';
const MOCK_AUTH_ENABLED = import.meta.env.VITE_MOCK_AUTH === 'true';
const MOCK_TOKEN = 'frontend-dev-token';

const getMockUser = (email = 'frontend@example.com', mode = 'customer') => {
  if (mode === 'employee') {
    return {
      id: 2,
      emp_id: 2,
      first_name: 'Frontend',
      last_name: 'Employee',
      name: 'Frontend Employee',
      email,
      role: 'employee',
    };
  }

  return {
    id: 1,
    first_name: 'Frontend',
    last_name: 'Customer',
    name: 'Frontend Customer',
    email,
    role: 'customer',
  };
};

export const resolveUserRole = (user) => {
  if (!user) return '';
  const profileRole = user.profile?.role
    ? (typeof user.profile.role === 'object' ? user.profile.role.name : user.profile.role)
    : '';
  // If user has a specific profile role (like "Super Admin", "IT Admin", "Customer Service"), trust that over a generic "customer" fallback
  if (profileRole && (!user.role || user.role === 'customer')) {
    return profileRole;
  }
  if (typeof user.role === 'object' && user.role !== null) {
    return user.role.name || '';
  }
  if (typeof user.role === 'string' && user.role) {
    return user.role;
  }
  return profileRole || 'customer';
};

export const resolveUserDepartment = (user) => {
  if (!user) return '';
  if (typeof user.department === 'string' && user.department) return user.department;
  if (typeof user.department === 'object' && user.department !== null) return user.department.name || '';
  if (user.profile?.department) {
    return typeof user.profile.department === 'object' ? user.profile.department.name : user.profile.department;
  }
  return '';
};

export const checkIsItManager = (user) => {
  if (!user) return false;
  const role = resolveUserRole(user).toLowerCase();
  const dept = resolveUserDepartment(user).toLowerCase();
  return (
    role === 'it_manager' ||
    role === 'it manager' ||
    role === 'it department manager' ||
    (dept.includes('it') && role.includes('manager'))
  );
};

export const checkIsServiceManager = (user) => {
  if (!user) return false;
  const role = resolveUserRole(user).toLowerCase();
  const dept = resolveUserDepartment(user).toLowerCase();
  const posLevel = (user.position_level || user.profile?.position_level || '').toLowerCase();
  const email = (user.email || '').toLowerCase();
  if (email === 'carlos.mendoza@hospital.com') return true;
  return (
    role === 'service_manager' ||
    role === 'service manager' ||
    role === 'service department manager' ||
    role === 'lead service engineer' ||
    ((dept.includes('service') || dept.includes('biomedical') || dept.includes('radiology') || dept.includes('facilities')) && (role.includes('manager') || posLevel === 'manager'))
  );
};

export const checkIsCSManager = (user) => {
  if (!user) return false;
  const role = resolveUserRole(user).toLowerCase();
  const dept = resolveUserDepartment(user).toLowerCase();
  const posLevel = (user.position_level || user.profile?.position_level || '').toLowerCase();
  const email = (user.email || '').toLowerCase();
  if (email === 'headofcs@gmail.com') return true;
  return (
    role === 'cs_manager' ||
    role === 'cs manager' ||
    role === 'customer_service_manager' ||
    role === 'customer service manager' ||
    role === 'customer support manager' ||
    role === 'head of cs' ||
    role === 'head of customer service' ||
    role === 'head cs' ||
    ((dept.includes('customer service') || dept.includes('customer support') || dept === 'cs') && (role.includes('manager') || role.includes('head') || posLevel === 'manager'))
  );
};

export const checkIsCS = (user) => {
  if (!user) return false;
  if (checkIsCSManager(user)) return false;
  const dept = resolveUserDepartment(user).toLowerCase();
  const role = resolveUserRole(user).toLowerCase();
  if (dept.includes('customer service') || dept.includes('customer support') || dept === 'cs') return true;
  return (
    role.includes('customer service') ||
    role.includes('customer-service') ||
    role === 'cs'
  );
};

export const checkIsSuperAdmin = (user) => {
  if (!user) return false;
  const role = resolveUserRole(user).toLowerCase();
  const dept = resolveUserDepartment(user).toLowerCase();
  return role === 'superadmin' || role === 'super admin' || dept === 'superadmin' || dept === 'super admin';
};

export const checkIsAdmin = (user) => {
  if (!user) return false;
  const role = resolveUserRole(user).toLowerCase();
  const dept = resolveUserDepartment(user).toLowerCase();
  return role === 'admin' || role === 'it admin' || (dept === 'admin' && role !== 'superadmin' && role !== 'super admin');
};

export const checkIsEmployee = (user) => {
  if (!user) return false;
  if (checkIsCS(user)) return false;
  if (checkIsCSManager(user)) return false;
  if (checkIsAdmin(user)) return false;
  if (checkIsSuperAdmin(user)) return false;
  if (checkIsItManager(user)) return false;
  if (checkIsServiceManager(user)) return false;
  const dept = resolveUserDepartment(user).toLowerCase();
  const role = resolveUserRole(user).toLowerCase();
  if (dept === 'service' || dept.includes('engineer')) return true;
  return role === 'employee' || role.includes('service') || role.includes('engineer');
};

const normalizeUser = (userData) => {
  if (!userData) return null;

  let firstName = userData.first_name || userData.profile?.first_name;
  let lastName = userData.last_name || userData.profile?.last_name;

  if (!firstName && userData.client_name) {
    const parts = userData.client_name.split(' ');
    firstName = parts[0];
    lastName = parts.slice(1).join(' ');
  }

  const role = resolveUserRole(userData);
  const department = resolveUserDepartment(userData);

  const branchName = userData.branch || userData.profile?.branch?.name || userData.branch_details?.name || null;
  const branchId = userData.branch_id || userData.profile?.branch_id || userData.branch_details?.id || null;
  const branchDetails = userData.branch_details || (userData.profile?.branch ? {
    id: userData.profile.branch.id,
    name: userData.profile.branch.name,
    address: userData.profile.branch.address,
  } : null);

  return {
    ...userData,
    first_name: firstName || userData.name || '',
    last_name: lastName || '',
    phone: userData.phone || userData.contact_number || userData.profile?.phone || '',
    department,
    role,
    branch: branchName,
    branch_id: branchId,
    branch_details: branchDetails,
  };
};

export const isStaffUser = (userData) => {
  if (!userData) return false;
  return (
    checkIsSuperAdmin(userData) ||
    checkIsAdmin(userData) ||
    checkIsCS(userData) ||
    checkIsCSManager(userData) ||
    checkIsItManager(userData) ||
    checkIsServiceManager(userData) ||
    checkIsEmployee(userData)
  );
};

export const sanitizeCustomerForStorage = (userData) => {
  if (!userData) return null;
  return {
    id: userData.id,
    first_name: userData.first_name || userData.name || '',
    last_name: userData.last_name || '',
    name: userData.client_name || userData.name || `${userData.first_name || ''} ${userData.last_name || ''}`.trim(),
    email: userData.email || '',
    role: resolveUserRole(userData) || 'customer',
    status: userData.status ?? true,
  };
};

const persistStoredUser = (userData) => {
  try {
    if (!userData) {
      sessionStorage.removeItem('user');
      localStorage.removeItem('user');
      return;
    }

    if (!isStaffUser(userData)) {
      // Customer: Sanitize PII (strip address, phone, contact_number, timestamps)
      // and restrict persistence strictly to sessionStorage (purged on tab/browser close).
      const sanitized = sanitizeCustomerForStorage(userData);
      sessionStorage.setItem('user', JSON.stringify(sanitized));
      localStorage.removeItem('user');
      return;
    }

    sessionStorage.setItem('user', JSON.stringify(userData));

    // Overwriting the key replaces any stale record from a different account or role.
    localStorage.setItem('user', JSON.stringify(userData));
  } catch {}
};

const clearStoredUser = () => {
  try {
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('first_login_pending');
    localStorage.removeItem('user');
  } catch {}
};

const readStoredUser = () => {
  try {
    let raw = sessionStorage.getItem('user');
    if (!raw) {
      raw = localStorage.getItem('user');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (isStaffUser(parsed)) {
          sessionStorage.setItem('user', raw);
          // Keep localStorage['user'] intact so Central Auth Module does not think the session was destroyed
        } else {
          // If a customer record is found in localStorage, sanitize it, migrate to sessionStorage,
          // and immediately wipe it from localStorage.
          const sanitized = sanitizeCustomerForStorage(normalizeUser(parsed));
          sessionStorage.setItem('user', JSON.stringify(sanitized));
          localStorage.removeItem('user');
          raw = JSON.stringify(sanitized);
        }
      }
    } else {
      // If customer record is already in sessionStorage, ensure any stale customer entry in localStorage is purged
      try {
        const parsedSession = JSON.parse(raw);
        if (!isStaffUser(parsedSession)) {
          localStorage.removeItem('user');
        }
      } catch {}
    }
    if (!raw) return null;
    const stored = JSON.parse(raw);

    const isCustomer = !isStaffUser(stored);

    const isCustomerSite = import.meta.env.VITE_APP_MODE === 'customer';
    if (isCustomerSite && !isCustomer) {
      return null;
    }
    if (!isCustomerSite && isCustomer) {
      return null;
    }

    return normalizeUser(stored);
  } catch {
    return null;
  }
};

const ensureCsrfCookie = async () => {
  // Passport (customer portal) uses Bearer tokens 
  if (import.meta.env.VITE_APP_MODE === 'customer') return;

  const hasXsrfCookie = document.cookie.split('; ').some((cookie) => cookie.startsWith('XSRF-TOKEN='));
  if (hasXsrfCookie) {
    return;
  }

  await axiosInstance.get(`${SANCTUM_URL}${AUTH_ENDPOINTS.CSRF_TOKEN}`, {
    withCredentials: true,
    withXSRFToken: true,
  });
};

//logout cleanup 
const applyUnauthenticated = (setUser, setIsAuthenticated) => {
  tokenStore.clearToken();
  clearStoredUser();
  setUser(null);
  setIsAuthenticated(false);
};


export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => readStoredUser());
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    if (typeof window === 'undefined') return false;
    const hasAuthCookie = document.cookie.split('; ').some((c) => c.startsWith('is_authenticated=true') || c.startsWith('access_token='));
    const stored = readStoredUser();
    return hasAuthCookie || Boolean(stored);
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isFirstLogin, setIsFirstLogin] = useState(() =>
    sessionStorage.getItem('first_login_pending') === 'true'
  );

  useEffect(() => {
    return undefined;
  }, []);

  // Verify existing token
  const revalidateSession = useCallback(async () => {
    if (MOCK_AUTH_ENABLED) {
      const token = tokenStore.getToken();
      const storedUser = readStoredUser();

      if (token && storedUser) {
        setUser(normalizeUser(storedUser));
        setIsAuthenticated(true);
        setIsFirstLogin(false);
        return true;
      }

      applyUnauthenticated(setUser, setIsAuthenticated);
      return false;
    }

    // If the browser has active SSO session cookies or a stored staff user from Central Auth Module,
    // clear any stale logout flags left in sessionStorage from a prior session.
    if (typeof window !== 'undefined') {
      const hasSsoAuth = document.cookie.split('; ').some((c) => c.startsWith('is_authenticated=true') || c.startsWith('access_token='));
      const stored = readStoredUser();
      const hasStaffSession = isStaffUser(stored);
      if (hasSsoAuth || hasStaffSession) {
        sessionStorage.removeItem('is_logged_out');
        sessionStorage.removeItem('logged_out');
      }
    }

    // Skip session revalidation on guest/login pages or if user explicitly logged out
    if (
      typeof window !== 'undefined' &&
      (sessionStorage.getItem('is_logged_out') === 'true' || sessionStorage.getItem('logged_out') === 'true')
    ) {
      applyUnauthenticated(setUser, setIsAuthenticated);
      return false;
    }

    const pathname = window.location.pathname;
    const isLoginPage =
      pathname.endsWith('/customer') ||
      pathname.includes('/customer?') ||
      pathname.includes('/login');
    if (isLoginPage) {
      applyUnauthenticated(setUser, setIsAuthenticated);
      return false;
    }

    // Customer portal guests (e.g. the landing page) have no token and no stored user,
    // so probing /me and /auth/refresh would only log two expected 401s in the console.
    if (import.meta.env.VITE_APP_MODE === 'customer') {
      let hasStoredUser = false;
      try {
        hasStoredUser = Boolean(sessionStorage.getItem('user') || localStorage.getItem('user'));
      } catch {}
      if (!tokenStore.getToken() && !hasStoredUser) {
        applyUnauthenticated(setUser, setIsAuthenticated);
        return false;
      }
    }

    const existingToken = tokenStore.getToken();

    // Employee/CS sessions come from the central SSO and have no customer-service refresh token,
    // so they must fall through to the /me probe (which accepts the SSO access_token cookie).
    if (!existingToken && import.meta.env.VITE_APP_MODE === 'customer') {
      // In-memory access token is empty on page reload / new tab.
      // Silently restore session via the httpOnly refresh cookie.
      try {
        const resp = await axiosInstance.post(AUTH_ENDPOINTS.REFRESH_TOKEN, {}, { withCredentials: true });
        const newToken = resp.data?.token;
        const userData = resp.data?.user;
        if (newToken) {
          tokenStore.setToken(newToken);
          const normalized = normalizeUser(userData);
          setUser(normalized);
          setIsAuthenticated(true);
          const firstLoginRefreshed = Boolean(resp.data?.is_first_login);
          setIsFirstLogin(firstLoginRefreshed);
          if (firstLoginRefreshed) {
            sessionStorage.setItem('first_login_pending', 'true');
          } else {
            sessionStorage.removeItem('first_login_pending');
          }
          if (normalized) persistStoredUser(normalized);
          return true;
        }
      } catch {
        // Refresh token expired or unauthenticated guest
      }
      applyUnauthenticated(setUser, setIsAuthenticated);
      return false;
    }

    try {
      const resp = await axiosInstance.get(AUTH_ENDPOINTS.ME);
      const userData = resp.data?.user;
      const firstLogin = Boolean(resp.data?.is_first_login);
      const sessionToken = resp.data?.token;
      if (sessionToken) {
        tokenStore.setToken(sessionToken);
      }
      if (userData) {
        const normalized = normalizeUser(userData);
        setUser(normalized);
        persistStoredUser(normalized);
      }
      setIsAuthenticated(true);
      setIsFirstLogin(firstLogin);
      if (firstLogin) {
        sessionStorage.setItem('first_login_pending', 'true');
      } else {
        sessionStorage.removeItem('first_login_pending');
      }
      return true;
    } catch (err) {
      if (err.response?.status === 401) {
        try {
          const resp = await axiosInstance.post(AUTH_ENDPOINTS.REFRESH_TOKEN, {}, { withCredentials: true });
          const newToken = resp.data?.token;
          const userData = resp.data?.user;
          if (newToken) {
            tokenStore.setToken(newToken);
            const normalized = normalizeUser(userData);
            setUser(normalized);
            setIsAuthenticated(true);
            const firstLoginRefreshed = Boolean(resp.data?.is_first_login);
            setIsFirstLogin(firstLoginRefreshed);
            if (firstLoginRefreshed) {
              sessionStorage.setItem('first_login_pending', 'true');
            } else {
              sessionStorage.removeItem('first_login_pending');
            }
            if (normalized) persistStoredUser(normalized);
            return true;
          }
        } catch {
          // refresh failed
        }
        applyUnauthenticated(setUser, setIsAuthenticated);
        return false;
      }

      // Fail-closed principle: Any error during revalidation MUST deny access
      applyUnauthenticated(setUser, setIsAuthenticated);
      return false;
    }
  }, []);

  // For refresh token
  useEffect(() => {
    const initAuth = async () => {
      setIsLoading(true);
      try {
        await revalidateSession();
      } catch {
        applyUnauthenticated(setUser, setIsAuthenticated);
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, [revalidateSession]);

  // For browser back and next

  useEffect(() => {
    const onPageShow = () => {
      revalidateSession();
    };

    window.addEventListener('pageshow', onPageShow);

    return () => {
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [revalidateSession]);

  
  useEffect(() => {
    const handleUnauthorized = () => {
      applyUnauthenticated(setUser, setIsAuthenticated);
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, []);


  // Login with email and password
  const login = useCallback(async (email, password, mode = 'customer') => {
    if (mode === 'employee') {
      if (typeof window !== 'undefined') {
        window.location.href = '/';
      }
      return { success: false, error: 'Redirecting to central SSO...' };
    }
    try {
      setError(null);

      if (MOCK_AUTH_ENABLED) {
        const userData = getMockUser(email, mode);

        try {
          sessionStorage.removeItem('logged_out');
          sessionStorage.removeItem('is_logged_out');
        } catch {}

        tokenStore.setToken(MOCK_TOKEN);
        persistStoredUser(userData);
        setUser(userData);
        setIsAuthenticated(true);
        setIsFirstLogin(false);

        return { success: true, user: userData, isFirstLogin: false };
      }

      // For CSRF
      await ensureCsrfCookie();

      const { fetchEncryptionKey, encryptPayload } = await import('@/utils/rsa');
      const { public_key, key_id } = await fetchEncryptionKey();

      const response = await axiosInstance.post(AUTH_ENDPOINTS.LOGIN, {
        email,
        password: encryptPayload(password, public_key),
        mode,
      }, {
        headers: {
          'X-Key-Id': key_id
        }
      });

      const { user: userData, token, is_first_login: firstLogin } = response.data;

      try {
        sessionStorage.removeItem('logged_out');
        sessionStorage.removeItem('is_logged_out');
      } catch {}

      // Store auth data in memory and set user
      const normalized = normalizeUser(userData);
      tokenStore.setToken(token);
      persistStoredUser(normalized);
      setUser(normalized);
      setIsAuthenticated(true);
      setIsFirstLogin(Boolean(firstLogin));
      // Persist flag so CustomerLayout's fallback modal works on page refresh / lazy-load
      if (Boolean(firstLogin)) {
        sessionStorage.setItem('first_login_pending', 'true');
      } else {
        sessionStorage.removeItem('first_login_pending');
      }

      return { success: true, user: normalized, isFirstLogin: Boolean(firstLogin) };
    } catch (err) {
      // IP LIMITER
      if (err.response?.status === 429) {
        const retryAfter = err.response?.headers?.['retry-after'] ?? null;
        const message = err.response?.data?.message || 'Too many requests. Please try again later.';
        setError(message);
        return { success: false, error: message, retryAfter };
      }
      const errorMessage = err.response?.data?.message || 'Login failed';
      setError(errorMessage);
      setIsAuthenticated(false);
      return {
        success: false,
        error: errorMessage,
        remainingAttempts: err.response?.data?.remaining_attempts ?? null,
        lockedUntil: err.response?.data?.locked_until ?? null,
      };
    } finally {
      // leave app-level isLoading for global session bootstrap only
    }
  }, []);

  /**
   * Register new user
   */
  const register = useCallback(async (userData) => {
    try {
      setError(null);

      if (MOCK_AUTH_ENABLED) {
        const newUser = {
          id: 3,
          name: userData?.name || 'Frontend Customer',
          email: userData?.email || 'frontend@example.com',
          role: 'customer',
        };

        tokenStore.setToken(MOCK_TOKEN);
        persistStoredUser(newUser);
        setUser(newUser);
        setIsAuthenticated(true);
        setIsFirstLogin(false);

        return { success: true, user: newUser };
      }

      // CSRF
      await ensureCsrfCookie();

      const response = await axiosInstance.post(AUTH_ENDPOINTS.REGISTER, userData);

      const { user: newUser, token } = response.data;

      const normalized = normalizeUser(newUser);
      tokenStore.setToken(token);
      persistStoredUser(normalized);

      setUser(normalized);
      setIsAuthenticated(true);

      return { success: true, user: normalized };
    } catch (err) {
      const errorMessage = err.response?.data?.message || 'Registration failed';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      // do not toggle global isLoading here; UI uses local spinners
    }
  }, []);

  //For logout
  const logout = useCallback(async () => {
    const currentToken = tokenStore.getToken();

    if (MOCK_AUTH_ENABLED) {
      clearStoredUser();
      try {
        localStorage.removeItem(LOCKOUT_STORAGE_KEY);
        sessionStorage.removeItem('first_login_pending');
        sessionStorage.setItem('logged_out', 'true');
      } catch {}
      tokenStore.clearToken();

      setUser(null);
      setIsAuthenticated(false);
      setError(null);
      setIsFirstLogin(false);
      setIsLoading(false);

      if (typeof window !== 'undefined') {
        const isCustomerSite = import.meta.env.VITE_APP_MODE === 'customer';
        const isCustomerUser =
          user?.role === 'customer' ||
          (!isStaffUser(user) &&
            !window.location.pathname.includes('/employee') &&
            !window.location.pathname.includes('/superadmin') &&
            !window.location.pathname.includes('/cs') &&
            !window.location.pathname.includes('/admin'));

        let targetUrl = '/';
        if (isCustomerSite) {
          targetUrl = import.meta.env.BASE_URL || '/';
        } else if (isCustomerUser) {
          if (import.meta.env.VITE_CUSTOMER_PORTAL_URL) {
            targetUrl = import.meta.env.VITE_CUSTOMER_PORTAL_URL;
          } else if (window.location.port === '5173' || window.location.port === '5005') {
            targetUrl = `${window.location.protocol}//${window.location.hostname}:5006/`;
          } else {
            targetUrl = '/';
          }
        } else {
          targetUrl = '/';
        }
        window.location.replace(targetUrl);
      }

      return { success: true };
    }

    try {
      //logout
      await axiosInstance.post(
        AUTH_ENDPOINTS.LOGOUT,
        {},
        { withCredentials: true, headers: currentToken ? { Authorization: `Bearer ${currentToken}` } : {} }
      );
    } catch {
      // Background logout cleanup failed silently
    } finally {
      clearStoredUser();
      try {
        localStorage.removeItem(LOCKOUT_STORAGE_KEY);
        sessionStorage.removeItem('first_login_pending');
        sessionStorage.setItem('logged_out', 'true');
        sessionStorage.setItem('is_logged_out', 'true');
      } catch {}
      tokenStore.clearToken();

      setUser(null);
      setIsAuthenticated(false);
      setError(null);
      setIsFirstLogin(false);
      setIsLoading(false);

      if (typeof window !== 'undefined') {
        const isCustomerSite = import.meta.env.VITE_APP_MODE === 'customer';
        const isCustomerUser =
          user?.role === 'customer' ||
          (!isStaffUser(user) &&
            !window.location.pathname.includes('/employee') &&
            !window.location.pathname.includes('/superadmin') &&
            !window.location.pathname.includes('/cs') &&
            !window.location.pathname.includes('/admin'));

        let targetUrl = '/';
        if (isCustomerSite) {
          targetUrl = import.meta.env.BASE_URL || '/';
        } else if (isCustomerUser) {
          if (import.meta.env.VITE_CUSTOMER_PORTAL_URL) {
            targetUrl = import.meta.env.VITE_CUSTOMER_PORTAL_URL;
          } else if (window.location.port === '5173' || window.location.port === '5005') {
            targetUrl = `${window.location.protocol}//${window.location.hostname}:5006/`;
          } else {
            targetUrl = '/';
          }
        } else {
          targetUrl = '/';
        }
        window.location.replace(targetUrl);
      }
    }

    return { success: true };
  }, [user]);

  // Clear error messages
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Update user profile
  const updateProfile = useCallback(async (userData) => {
    try {
      setError(null);

      if (MOCK_AUTH_ENABLED) {
        const updatedUser = {
          ...(readStoredUser() || getMockUser()),
          ...userData,
        };

        persistStoredUser(updatedUser);
        setUser(updatedUser);

        return { success: true, user: updatedUser };
      }

      const response = await axiosInstance.put('/profile', userData);

      const updatedUser = response.data.user;
      const normalized = normalizeUser(updatedUser);
      persistStoredUser(normalized);
      setUser(normalized);

      return { success: true, user: normalized };
    } catch (err) {
      const errorMessage = err.response?.data?.message || 'Failed to update profile';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    }
  }, []);

  // Change password
  const changePassword = useCallback(async (currentPassword, newPassword, confirmPassword) => {
    try {
      setError(null);

      if (MOCK_AUTH_ENABLED) {
        return { success: true };
      }

      const { fetchEncryptionKey, encryptPayload } = await import('@/utils/rsa');
      const { public_key, key_id } = await fetchEncryptionKey();

      const response = await axiosInstance.post('/change-password', {
        current_password: encryptPayload(currentPassword, public_key),
        new_password: encryptPayload(newPassword, public_key),
        new_password_confirmation: encryptPayload(confirmPassword, public_key),
      }, {
        headers: {
          'X-Key-Id': key_id
        }
      });

      return { success: true, message: response.data.message };
    } catch (err) {
      const errorMessage = err.response?.data?.message || 'Failed to change password';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    }
  }, []);

  // Heartbeat loop for employees
  useEffect(() => {
    if (!isAuthenticated || !user || user.role === 'customer' || user.role === 'customer service' || user.role === 'head of cs' || user.role === 'head of customer service') {
      return undefined;
    }

    const sendHeartbeat = async () => {
      try {
        await axiosInstance.post('/heartbeat');
      } catch {
        // Silent failure for heartbeat presence ping
      }
    };

    // Send immediate heartbeat on login/mount
    sendHeartbeat();

    const interval = setInterval(sendHeartbeat, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated, user]);

  const value = {
    user,
    setUser,
    isAuthenticated,
    setIsAuthenticated,
    isLoading,
    error,
    isFirstLogin,
    login,
    register,
    logout,
    updateProfile,
    changePassword,
    clearError,
    revalidateSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Custom hook
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
