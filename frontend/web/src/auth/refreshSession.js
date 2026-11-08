import axios from 'axios';
import { API_BASE_URL, AUTH_ENDPOINTS } from '@/config/api.config';
import tokenStore from '@/auth/tokenStore';

let refreshInFlight = null;

const refreshClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  withXSRFToken: true,
  headers: {
    'X-Requested-With': 'XMLHttpRequest',
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
});

export const refreshAccessToken = async () => {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  const token = tokenStore.getToken();
  if (token === 'frontend-dev-token') {
    return false;
  }

  try {
    const rawUser = sessionStorage.getItem('user') || localStorage.getItem('user');
    if (rawUser) {
      const u = JSON.parse(rawUser);
      const role = (typeof u.role === 'object' ? u.role?.name : u.role) || '';
      const roleLower = String(role).toLowerCase();
      const dept = (typeof u.department === 'object' ? u.department?.name : u.department) || '';
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
      if (isStaff) {
        return false;
      }
    }
  } catch {}

  refreshInFlight = refreshClient
    .post(AUTH_ENDPOINTS.REFRESH_TOKEN, {})
    .then((response) => {
      const newToken = response.data?.token;
      if (newToken) {
        tokenStore.setToken(newToken);
      }
      return Boolean(newToken);
    })
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
};
