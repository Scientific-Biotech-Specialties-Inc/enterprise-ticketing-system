import axios from 'axios';
import tokenStore from '@/auth/tokenStore';
import { refreshAccessToken } from '@/auth/refreshSession';
import { CONFIGURATION_API_URL } from '@/config/api.config';
import { fetchEncryptionKey, encryptPayload } from '@/utils/rsa';

const configClient = axios.create({
  baseURL: CONFIGURATION_API_URL || '/api/ticketing/configuration',
  withCredentials: true,
  headers: {
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  },
});

configClient.interceptors.request.use((config) => {
  let token = tokenStore.getToken();
  if (!token) {
    try {
      token = sessionStorage.getItem('access_token') || localStorage.getItem('access_token');
    } catch {}
  }
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Spec 0034: identity comes only from the verified token. No X-User-Role or X-Actor-Name headers.
  return config;
});

configClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true;
      const token = tokenStore.getToken();
      if (token === 'frontend-dev-token') {
        return Promise.reject(error);
      }
      try {
        const rawUser = sessionStorage.getItem('user') || localStorage.getItem('user');
        if (rawUser) {
          const u = JSON.parse(rawUser);
          if (u.role === 'superadmin' || u.role === 'employee' || u.role === 'admin') {
            return Promise.reject(error);
          }
        }
      } catch {}

      const refreshed = await refreshAccessToken();
      const currentToken = tokenStore.getToken();
      if (refreshed && currentToken) {
        originalRequest.headers.Authorization = `Bearer ${currentToken}`;
        return configClient(originalRequest);
      }
    }
    return Promise.reject(error);
  }
);

/**
 * Fetches the ephemeral RSA encryption key directly from configuration-service
 * or falls back to the default gateway encryption key.
 */
async function getServiceEncryptionKey() {
  try {
    const res = await configClient.get('/encryption-key');
    if (res.data?.public_key && res.data?.key_id) {
      return res.data;
    }
  } catch {
    // Fall back to default auth/gateway key
  }
  return fetchEncryptionKey();
}

/**
 * Fetch the current email delivery configuration.
 * Returns { is_configured: boolean, data: { provider, api_key: 're_•••••••••', from_name, from_email, last_tested } | null }
 */
export async function getEmailConfiguration() {
  const response = await configClient.get('/email');
  return response.data;
}

/**
 * Save new email configuration with client-side RSA encryption for the API key.
 */
export async function saveEmailConfiguration({ apiKey, fromName, fromEmail }) {
  const { public_key, key_id } = await getServiceEncryptionKey();
  const encryptedApiKey = encryptPayload(apiKey.trim(), public_key);

  const response = await configClient.post(
    '/email',
    {
      apiKey: encryptedApiKey,
      fromName: fromName.trim(),
      fromEmail: fromEmail.trim(),
    },
    {
      headers: {
        'X-Key-Id': key_id,
      },
    }
  );
  return response.data;
}

/**
 * Update sender identity (fromName, fromEmail) on the active configuration.
 */
export async function updateEmailConfiguration({ fromName, fromEmail }) {
  const response = await configClient.put('/email', {
    fromName: fromName.trim(),
    fromEmail: fromEmail.trim(),
  });
  return response.data;
}

/**
 * Update the API key for the active configuration with RSA encryption.
 */
export async function updateEmailApiKey(apiKey) {
  const { public_key, key_id } = await getServiceEncryptionKey();
  const encryptedApiKey = encryptPayload(apiKey.trim(), public_key);

  const response = await configClient.put(
    '/email/api-key',
    {
      apiKey: encryptedApiKey,
    },
    {
      headers: {
        'X-Key-Id': key_id,
      },
    }
  );
  return response.data;
}

/**
 * Remove the active email configuration.
 */
export async function removeEmailConfiguration() {
  const response = await configClient.delete('/email');
  return response.data;
}

/**
 * Dispatches a test verification email via Resend.
 */
export async function sendTestEmail({ recipientEmail, apiKey, fromName, fromEmail }) {
  const headers = {};
  const payload = {
    recipientEmail: recipientEmail.trim(),
  };

  if (apiKey) {
    const { public_key, key_id } = await getServiceEncryptionKey();
    payload.apiKey = encryptPayload(apiKey.trim(), public_key);
    payload.fromName = fromName?.trim();
    payload.fromEmail = fromEmail?.trim();
    headers['X-Key-Id'] = key_id;
  }

  const response = await configClient.post(
    '/email/test',
    payload,
    { headers }
  );
  return response.data;
}

// ---------------------------------------------------------------------------
// Email Templates
// ---------------------------------------------------------------------------

/**
 * Fetch all email templates with placeholder reference.
 * Returns { templates: [...], placeholders: { token: description } }
 */
export async function getEmailTemplates() {
  const response = await configClient.get('/email-templates');
  return response.data;
}

/**
 * Update the subject and body of a specific email template.
 */
export async function updateEmailTemplate(eventKey, { subject, body, is_enabled }) {
  const response = await configClient.put(`/email-templates/${eventKey}`, {
    subject,
    body,
    is_enabled,
  });
  return response.data;
}

/**
 * Toggle an email template on/off by event key.
 */
export async function toggleEmailTemplate(eventKey, isEnabled) {
  const response = await configClient.post(`/email-templates/${eventKey}/toggle`, {
    is_enabled: isEnabled,
  });
  return response.data;
}

/**
 * Reset a template back to its factory defaults.
 */
export async function resetEmailTemplate(eventKey) {
  const response = await configClient.post(`/email-templates/${eventKey}/reset`);
  return response.data;
}

/**
 * Dispatches a test email for a specific template to the superadmin/recipient.
 */
export async function sendTestTemplateEmail(eventKey, { recipientEmail, subject, body }) {
  const response = await configClient.post(`/email-templates/${eventKey}/test`, {
    recipientEmail: recipientEmail?.trim(),
    subject: subject?.trim(),
    body,
  });
  return response.data;
}

// ---------------------------------------------------------------------------
// Notification Delivery Channels
// ---------------------------------------------------------------------------

/**
 * Fetch all alert types and their active notification delivery channel configurations.
 * Returns { channels: [...], alert_types: { key: meta } }
 */
export async function getNotificationChannels() {
  const response = await configClient.get('/notification-channels');
  return response.data;
}

/**
 * Bulk update notification delivery channels for all alert types.
 * @param {Object} channels - Map of { [alertKey]: 'email' | 'in_app' | 'both' }
 */
export async function updateNotificationChannels(channels) {
  const response = await configClient.put('/notification-channels', { channels });
  return response.data;
}

/**
 * Update the delivery channel for a single alert type.
 * @param {string} alertKey
 * @param {'email' | 'in_app' | 'both'} channel
 */
export async function updateSingleNotificationChannel(alertKey, channel) {
  const response = await configClient.put(`/notification-channels/${alertKey}`, { channel });
  return response.data;
}

/**
 * Reset all notification delivery channels to their factory defaults.
 */
export async function resetNotificationChannels() {
  const response = await configClient.post('/notification-channels/reset');
  return response.data;
}

// ---------------------------------------------------------------------------
// Notification Recipient Routing
// ---------------------------------------------------------------------------

/**
 * Fetch active notification recipient routing for configurable alert types.
 * Returns { key: 'routing', value: { new_ticket: [], new_message: [], overdue_ticket: [] }, immutable_scope: {...} }
 */
export async function getNotificationRouting() {
  const response = await configClient.get('/ticket-configurations/routing');
  return response.data?.value || response.data;
}

/**
 * Update notification recipient routing with zero-recipient validation.
 * @param {Object} routing - Map of { [alertKey]: string[] }
 */
export async function updateNotificationRouting(routing) {
  const response = await configClient.put('/ticket-configurations/routing', { routing });
  return response.data?.value || response.data;
}

/**
 * Reset notification recipient routing to system defaults.
 */
export async function resetNotificationRouting() {
  const response = await configClient.post('/ticket-configurations/routing/reset');
  return response.data?.value || response.data;
}

// ---------------------------------------------------------------------------
// Feedback Form Questions (TS104 Category-Scoped Questions)
// ---------------------------------------------------------------------------

/**
 * Fetch all feedback questions grouped by category or filtered by category.
 * @param {string} [category] - Optional category filter ('IT', 'Service', 'Others')
 * @returns {Promise<{ grouped: { IT: [], Service: [], Others: [] }, questions: [] }>}
 */
export async function getFeedbackQuestions(category) {
  const response = await configClient.get('/feedback-questions', {
    params: category ? { category } : {},
  });
  return response.data;
}

/**
 * Fetch currently enabled feedback questions for a given ticket category.
 * Used by the customer feedback form rendering engine.
 * @param {string} category
 * @returns {Promise<{ category: string, questions: [] }>}
 */
export async function getCategoryFeedbackQuestions(category) {
  const response = await configClient.get(`/feedback-questions/category/${encodeURIComponent(category)}`);
  return response.data;
}

/**
 * Create a new feedback question for a category.
 */
export async function createFeedbackQuestion({ category, text, responseType, options, isEnabled }) {
  const response = await configClient.post('/feedback-questions', {
    category,
    text,
    responseType,
    options,
    isEnabled,
  });
  return response.data;
}

/**
 * Update an existing feedback question.
 */
export async function updateFeedbackQuestion(id, { category, text, responseType, options, isEnabled }) {
  const response = await configClient.put(`/feedback-questions/${id}`, {
    category,
    text,
    responseType,
    options,
    isEnabled,
  });
  return response.data;
}

/**
 * Toggle the enabled state of a feedback question.
 */
export async function toggleFeedbackQuestion(id, category) {
  const response = await configClient.post(`/feedback-questions/${id}/toggle`, {
    category,
  });
  return response.data;
}

/**
 * Reorder questions within a category.
 * @param {string} category
 * @param {Array<string|number>} order - Array of question IDs in sequential order
 */
export async function reorderFeedbackQuestions(category, order) {
  const response = await configClient.post('/feedback-questions/reorder', {
    category,
    order,
  });
  return response.data;
}

/**
 * Delete / remove a feedback question (soft deleted on backend to preserve historical responses).
 */
export async function deleteFeedbackQuestion(id, category) {
  const response = await configClient.delete(`/feedback-questions/${id}`, {
    params: category ? { category } : {},
  });
  return response.data;
}

/**
 * Reset feedback questions for a category or all categories to defaults.
 * @param {string} [category]
 */
export async function resetFeedbackQuestions(category) {
  const response = await configClient.post('/feedback-questions/reset', { category });
  return response.data;
}

/**
 * Seed default feedback questions for a new equipment/machine category.
 * Idempotent: the backend skips seeding if questions already exist for that category.
 * @param {string} category - The new equipment category name
 * @returns {Promise<{ seeded: boolean, category: string, questions: [] }>}
 */
export async function seedFeedbackCategory(category) {
  const response = await configClient.post('/feedback-questions/seed-category', { category });
  return response.data;
}

/**
 * Get the feedback form master switch status.
 * @returns {Promise<{ is_enabled: boolean, isEnabled: boolean, updated_at: string }>}
 */
export async function getFeedbackFormStatus() {
  const response = await configClient.get('/feedback-form/status');
  return response.data;
}

/**
 * Update / toggle the feedback form master switch status.
 * @param {boolean} isEnabled
 */
export async function updateFeedbackFormStatus(isEnabled) {
  const response = await configClient.post('/feedback-form/status', { is_enabled: Boolean(isEnabled) });
  return response.data;
}

/**
 * Get per-category feedback enabled states.
 * @returns {Promise<{ categories: { [categoryName]: boolean } }>}
 */
export async function getCategoryFeedbackToggles() {
  const response = await configClient.get('/feedback-form/category-toggles');
  return response.data;
}

/**
 * Enable or disable the feedback form for a specific equipment category.
 * @param {string} category - The equipment category name (e.g. 'IT', 'Service')
 * @param {boolean} isEnabled
 */
export async function setCategoryFeedbackToggle(category, isEnabled) {
  const response = await configClient.post('/feedback-form/category-toggle', {
    category,
    is_enabled: Boolean(isEnabled),
  });
  return response.data;
}

/**
 * Auto-disable feedback collection for a category when the equipment category is deleted.
 * Historical feedback data and questions are preserved.
 * @param {string} category
 */
export async function disableFeedbackCategory(category) {
  const response = await configClient.post('/feedback-form/disable-category', { category });
  return response.data;
}

export const TS100_WINDOW_CONFIG_CACHE_KEY = 'ts100_ticket_window_config';

/**
 * Retrieve cached ticket window configuration from localStorage for instant, zero-latency rendering.
 */
export function getCachedWindowConfiguration() {
  try {
    const raw = localStorage.getItem(TS100_WINDOW_CONFIG_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.reopenWindowDays !== 'undefined') {
        return parsed;
      }
    }
  } catch (e) {
    // ignore
  }
  return null;
}

/**
 * Store updated ticket window configuration in localStorage cache.
 */
export function setCachedWindowConfiguration(config) {
  try {
    if (config) {
      localStorage.setItem(TS100_WINDOW_CONFIG_CACHE_KEY, JSON.stringify(config));
      window.dispatchEvent(new CustomEvent('ticket_window_config_updated', { detail: config }));
    } else {
      localStorage.removeItem(TS100_WINDOW_CONFIG_CACHE_KEY);
    }
  } catch (e) {
    // ignore
  }
}

/**
 * Get ticket lifecycle window configurations (reopen and auto-close).
 */
export async function getWindowConfiguration() {
  const response = await configClient.get('/ticket-configurations/windows');
  const val = response.data?.value || response.data;
  if (val) {
    setCachedWindowConfiguration(val);
  }
  return val;
}

/**
 * Update ticket lifecycle window configurations (reopen and auto-close).
 */
export async function updateWindowConfiguration(payload) {
  const response = await configClient.put('/ticket-configurations/windows', payload);
  const val = response.data?.value || response.data;
  if (val) {
    setCachedWindowConfiguration(val);
  }
  return val;
}

/**
 * Reset ticket lifecycle window configurations to system defaults.
 */
export async function resetWindowConfiguration() {
  const response = await configClient.post('/ticket-configurations/windows/reset');
  const val = response.data?.value || response.data;
  if (val) {
    setCachedWindowConfiguration(val);
  }
  return val;
}

// ---------------------------------------------------------------------------
// SuperAdmin Settings: Company Info, System Status, Log Level
// ---------------------------------------------------------------------------

/**
 * Fetch company information.
 */
export async function getCompanyInfo() {
  const response = await configClient.get('/ticket-configurations/company-info');
  return response.data?.value || response.data;
}

/**
 * Update company information with format validation on backend.
 */
export async function updateCompanyInfo(payload) {
  const response = await configClient.put('/ticket-configurations/company-info', payload);
  return response.data?.value || response.data;
}

/**
 * Reset company info to defaults.
 */
export async function resetCompanyInfo() {
  const response = await configClient.post('/ticket-configurations/company-info/reset');
  return response.data?.value || response.data;
}

/**
 * Fetch current system operational status.
 */
export async function getSystemStatus() {
  const response = await configClient.get('/ticket-configurations/system-status');
  return response.data?.status || response.data?.value?.status || 'Operational';
}

/**
 * Update system status (Operational vs Under Maintenance).
 */
export async function updateSystemStatus(status) {
  const response = await configClient.put('/ticket-configurations/system-status', { status });
  return response.data?.status || response.data?.value?.status || status;
}

/**
 * Reset system status to Operational.
 */
export async function resetSystemStatus() {
  const response = await configClient.post('/ticket-configurations/system-status/reset');
  return response.data?.status || response.data?.value?.status || 'Operational';
}

/**
 * Fetch current logging verbosity level.
 */
export async function getLogLevel() {
  const response = await configClient.get('/ticket-configurations/log-level');
  return response.data?.level || response.data?.value?.level || 'Info';
}

/**
 * Update logging verbosity (Error, Warning, Info, Debug).
 */
export async function updateLogLevel(level) {
  const response = await configClient.put('/ticket-configurations/log-level', { level });
  return response.data?.level || response.data?.value?.level || level;
}

/**
 * Reset logging verbosity to Info.
 */
export async function resetLogLevel() {
  const response = await configClient.post('/ticket-configurations/log-level/reset');
  return response.data?.level || response.data?.value?.level || 'Info';
}

// ---------------------------------------------------------------------------
// SLA Business Hours (working hours used to count SLA limits)
// ---------------------------------------------------------------------------

/**
 * Fetch SLA business hours: { enabled, timezone, startTime, endTime, workingDays }.
 * workingDays uses ISO numbering (1 = Monday ... 7 = Sunday).
 */
export async function getBusinessHoursConfig() {
  const response = await configClient.get('/ticket-configurations/business_hours');
  return response.data?.value || response.data;
}

/**
 * Save SLA business hours.
 */
export async function updateBusinessHoursConfig(payload) {
  const response = await configClient.put('/ticket-configurations/business_hours', payload);
  return response.data?.value || response.data;
}

// ---------------------------------------------------------------------------
// Ticket State Machine: Transition Rules
// ---------------------------------------------------------------------------

/**
 * Fetch transition rules configuration.
 */
export async function getTransitionRulesConfig() {
  const response = await configClient.get('/ticket-configurations/transitions');
  return response.data?.value || response.data;
}

/**
 * Update transition rules configuration.
 */
export async function updateTransitionRulesConfig(payload) {
  const response = await configClient.put('/ticket-configurations/transitions', payload);
  return response.data?.value || response.data;
}

/**
 * Reset transition rules configuration to defaults.
 */
export async function resetTransitionRulesConfig() {
  const response = await configClient.post('/ticket-configurations/transitions/reset');
  return response.data?.value || response.data;
}

// ---------------------------------------------------------------------------
// File Upload Limits & Security Configuration
// ---------------------------------------------------------------------------

/**
 * Fetch file upload limits and security configuration.
 * Returns { maxFileSizeMB: number, allowedFileTypes: string[], maxFileCount: number, malwareScanningEnabled: boolean }
 */
export async function getFileLimitsConfig() {
  const response = await configClient.get('/ticket-configurations/file_limits');
  return response.data?.value || response.data;
}

/**
 * Update file upload limits and security configuration.
 */
export async function updateFileLimitsConfig(payload) {
  const response = await configClient.put('/ticket-configurations/file_limits', payload);
  return response.data?.value || response.data;
}

/**
 * Reset file upload limits and security configuration to factory defaults.
 */
export async function resetFileLimitsConfig() {
  const response = await configClient.post('/ticket-configurations/file_limits/reset');
  return response.data?.value || response.data;
}

// ---------------------------------------------------------------------------
// Ticket Messaging Participation Configuration
// ---------------------------------------------------------------------------

/**
 * Fetch ticket messaging participation configuration.
 * Returns { default_participants: string, allow_delegated_employee: boolean, allow_full_history: boolean, notify_on_employee_join: boolean }
 */
export async function getMessagingConfiguration() {
  const response = await configClient.get('/ticket-configurations/messaging');
  return response.data?.value || response.data;
}

/**
 * Update ticket messaging participation configuration.
 */
export async function updateMessagingConfiguration(payload) {
  const response = await configClient.put('/ticket-configurations/messaging', payload);
  return response.data?.value || response.data;
}

/**
 * Reset ticket messaging participation configuration to factory defaults.
 */
export async function resetMessagingConfiguration() {
  const response = await configClient.post('/ticket-configurations/messaging/reset');
  return response.data?.value || response.data;
}

