/**
 * TS067: Message Thread Archival Configuration
 *
 * Lightweight shared module backed by localStorage with custom event dispatching.
 * Allows SuperAdminTicketConfig and MessagingPage to synchronize the message
 * archival toggle synchronously across views without requiring global Context wrappers.
 *
 * TEMPORARY: localStorage is used here only as a same-session demo bridge between
 * Super Admin and Customer/Employee/CS portals for this sprint's frontend-only scope.
 * This must be replaced with a real backend-persisted setting, read by all portals
 * via API, before this is production-ready — localStorage does not sync across
 * different users/devices/browsers.
 */

export const MESSAGE_ARCHIVAL_STORAGE_KEY = 'superadmin_archive_message_thread_on_closure';

export const DEFAULT_MESSAGE_ARCHIVAL_ENABLED = true;

/**
 * Check if message thread archival on ticket closure is enabled.
 * Default: true (ON).
 * @returns {boolean}
 */
export function isMessageArchivalOnClosureEnabled() {
  try {
    const val = localStorage.getItem(MESSAGE_ARCHIVAL_STORAGE_KEY);
    if (val === null) return DEFAULT_MESSAGE_ARCHIVAL_ENABLED;
    return JSON.parse(val);
  } catch {
    return DEFAULT_MESSAGE_ARCHIVAL_ENABLED;
  }
}

/**
 * Update and persist the message thread archival on ticket closure toggle.
 * Dispatches a 'message_archival_toggle_changed' CustomEvent for real-time reactivity.
 * @param {boolean} enabled
 */
export function setMessageArchivalOnClosureEnabled(enabled) {
  try {
    const value = Boolean(enabled);
    localStorage.setItem(MESSAGE_ARCHIVAL_STORAGE_KEY, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent('message_archival_toggle_changed', { detail: { enabled: value } }));
  } catch (err) {
    console.error('Failed to save message thread archival toggle to localStorage:', err);
  }
}
