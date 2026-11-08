// API Config
export const API_BASE_URL = import.meta.env.VITE_API_URL;
export const SANCTUM_URL = import.meta.env.VITE_SANCTUM_URL;
export const TICKET_API_URL = import.meta.env.VITE_TICKET_API_URL;
export const EMPLOYEE_API_URL = import.meta.env.VITE_EMPLOYEE_API_URL || '/api/ticketing/employee';
export const AI_API_URL = import.meta.env.VITE_AI_API_URL || '/api/ticketing/ai';

export const KB_API_URL = import.meta.env.VITE_KB_API_URL || '/api/ticketing/ai';
export const CONFIGURATION_API_URL = import.meta.env.VITE_CONFIGURATION_API_URL || '/api/ticketing/configuration';

if(!API_BASE_URL){
  throw new Error("Missing VITE_API_URL in environment variables");
}

if(!SANCTUM_URL){
  throw new Error("Missing SANCTUM_URL in environment variables");
}

if(!TICKET_API_URL){
  throw new Error("Missing VITE_TICKET_API_URL in environment variables");
}

// CSRF Config (Sanctum)
export const CSRF_COOKIE_NAME = 'XSRF-TOKEN';
export const CSRF_HEADER_NAME = 'X-XSRF-TOKEN';

// API Endpoints
export const AUTH_ENDPOINTS = {
  LOGIN: '/login',
  LOGOUT: '/logout',
  CSRF_TOKEN: '/sanctum/csrf-cookie',
  VERIFY_EMAIL: '/email/verify',
  FORGOT_PASSWORD: '/forgot-password',
  FORGOT_PASSWORD_VERIFY: '/forgot-password/verify',
  RESET_PASSWORD: '/reset-password',
  REFRESH_TOKEN: '/auth/refresh',
  ME: '/me',
};

// HTTP Status Codes
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  UNPROCESSABLE_ENTITY: 422,
  INTERNAL_SERVER_ERROR: 500,
};
