import axios from 'axios';
import { API_BASE_URL, AUTH_ENDPOINTS } from '@/config/api.config';
import tokenStore from '@/auth/tokenStore';
import { refreshAccessToken } from '@/auth/refreshSession';


const axiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // for refresh tokens (httpOnly cookies)
  withXSRFToken: true,
  xsrfCookieName: 'XSRF-TOKEN',
  xsrfHeaderName: 'X-XSRF-TOKEN',
  headers: {
    'X-Requested-With': 'XMLHttpRequest', 
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  },
});

const AUTH_PATH_PREFIXES = [
  '/login',
  '/register',
  '/forgot-password',
  '/forgot-password/verify',
  '/reset-password',
  '/sanctum/csrf-cookie',
  AUTH_ENDPOINTS.REFRESH_TOKEN,
];

const isAuthEndpoint = (url = '') => AUTH_PATH_PREFIXES.some((path) => url.includes(path));
const UNSAFE_METHODS = ['post', 'put', 'patch', 'delete'];

const getCookie = (name) => {
  if (typeof document === 'undefined') return null;

  const cookie = document.cookie
    .split('; ')
    .find((item) => item.startsWith(`${name}=`));

  if (!cookie) return null;

  return decodeURIComponent(cookie.split('=').slice(1).join('='));
};

// Attach token to every request

axiosInstance.interceptors.request.use(
  (config) => {
    // If the request URL is already an absolute API path (starts with /api/) or full URL (http/https),
    // clear baseURL so Axios does not erroneously prepend API_BASE_URL (/api/ticketing/customer)
    if (config.url && (config.url.startsWith('/api/') || config.url.startsWith('http://') || config.url.startsWith('https://'))) {
      config.baseURL = '';
    }

    const method = (config.method || 'get').toLowerCase();
    const xsrfToken = getCookie('XSRF-TOKEN');

    if (UNSAFE_METHODS.includes(method) && xsrfToken) {
      config.headers['X-XSRF-TOKEN'] = xsrfToken;
    }

    const token = tokenStore.getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor: Global Error

axiosInstance.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const requestUrl = originalRequest?.url ?? '';

    if (error.response?.status === 429) {
      const retryAfter = error.response.headers?.['retry-after'];
      error.isTooManyRequests = true;
      error.retryAfter = retryAfter;
      return Promise.reject(error);
    }

    // Auto refresh token system
    if (
      error.response?.status === 401 &&
      !isAuthEndpoint(requestUrl) &&
      originalRequest &&
      !originalRequest._retry
    ) {

      // Retry original request
      originalRequest._retry = true;
      const refreshed = await refreshAccessToken();
      const currentToken = tokenStore.getToken();
      if (refreshed && currentToken) {
        originalRequest.headers.Authorization = `Bearer ${currentToken}`;
        return axiosInstance(originalRequest);
      }

      // Fail-closed principle: if token refresh fails on unauthorized, clear auth state and trigger unauthorized handler
      tokenStore.clearToken();
      sessionStorage.removeItem('user');
      try {
        const raw = localStorage.getItem('user');
        if (raw) {
          const parsed = JSON.parse(raw);
          const role = (typeof parsed.role === 'object' ? parsed.role?.name : parsed.role) || '';
          const roleLower = String(role).toLowerCase();
          const dept = (typeof parsed.department === 'object' ? parsed.department?.name : parsed.department) || '';
          const deptLower = String(dept).toLowerCase();
          const isStaff =
            roleLower.includes('admin') ||
            roleLower.includes('employee') ||
            roleLower.includes('cs') ||
            roleLower.includes('customer service') ||
            deptLower.includes('admin') ||
            deptLower.includes('employee') ||
            deptLower.includes('cs') ||
            deptLower.includes('customer service');
          if (!isStaff) {
            localStorage.removeItem('user');
          }
        }
      } catch {}
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('auth:unauthorized'));
      }
    }

    return Promise.reject(error);
  }
);

export default axiosInstance;
