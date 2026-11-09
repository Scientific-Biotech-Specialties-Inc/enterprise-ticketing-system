import { parseUTCDate } from '@/utils/dateUtils';
import { safeUrl } from '@/utils/safeUrl';

/**
 * Format date in Asia/Manila (PHT) timezone.
 * Example: "Nov 9, 8:02 PM PHT" or "Nov 9 PHT"
 */
export const formatPHT = (dateStr, { includeTime = true, showTimezone = true } = {}) => {
  const date = parseUTCDate(dateStr);
  if (!date || isNaN(date.getTime())) return '—';

  const opts = {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
  };
  if (includeTime) {
    opts.hour = 'numeric';
    opts.minute = '2-digit';
    opts.hour12 = true;
  }
  const formatted = new Intl.DateTimeFormat('en-US', opts).format(date);
  return showTimezone ? `${formatted} PHT` : formatted;
};

/**
 * Format relative + absolute PHT time.
 * Example: "Updated 2 hrs ago (Nov 9, 9:08 AM PHT)" or "2h ago (Nov 9, 9:08 AM PHT)"
 */
export const formatRelativePHT = (dateStr, { prefix = '' } = {}) => {
  const date = parseUTCDate(dateStr);
  if (!date || isNaN(date.getTime())) return '—';

  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);
  let rel = '';
  if (diffSec < 60) rel = 'Just now';
  else if (diffSec < 3600) rel = `${Math.floor(diffSec / 60)}m ago`;
  else if (diffSec < 86400) rel = `${Math.floor(diffSec / 3600)}h ago`;
  else if (diffSec < 604800) rel = `${Math.floor(diffSec / 86400)}d ago`;
  else rel = formatPHT(dateStr, { includeTime: false });

  const pht = formatPHT(dateStr, { includeTime: true });
  const base = `${rel} (${pht})`;
  return prefix ? `${prefix} ${base}` : base;
};

/**
 * Extract clean filename from string or object
 */
export const getFileName = (file, fallback = 'Attachment') => {
  if (!file) return fallback;
  if (typeof file === 'string') return file.split('/').pop() || fallback;
  return file.name || file.file_name || fallback;
};

/**
 * Resolve normalized safe attachment URL
 */
export const getFileUrl = (file) => {
  if (!file) return '';
  let raw = '';
  if (typeof file === 'string') {
    raw = file;
  } else {
    raw = file.url || file.file_path || file.path || '';
  }
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('blob:') || raw.startsWith('data:')) {
    return safeUrl(raw);
  }
  const clean = raw.replace(/^\/+/, '');
  if (clean.startsWith('storage/')) return safeUrl(`/api/ticketing/attachment/${clean}`);
  if (clean.startsWith('api/ticketing/attachment/')) return safeUrl(`/${clean}`);
  if (clean.startsWith('api/storage/')) return safeUrl(`/api/ticketing/attachment/${clean.substring(4)}`);
  if (clean.startsWith('api/')) return safeUrl(`/${clean}`);
  return safeUrl(`/api/ticketing/attachment/storage/${clean}`);
};

/**
 * Human readable file size
 */
export const formatFileSize = (bytes) => {
  if (!bytes || isNaN(bytes)) return '';
  const b = Number(bytes);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Determine if a file is quarantined/blocked by ClamAV
 */
export const isQuarantinedFile = (file) => {
  if (!file) return false;
  return Boolean(
    file.is_quarantined ||
    file.quarantined ||
    file.virus_detected ||
    file.threat_found ||
    file.status === 'quarantined' ||
    file.status === 'blocked'
  );
};

/**
 * 4-Step Stepper Definition
 */
export const STEPPER_STEPS = [
  { id: 'submitted', label: 'Submitted' },
  { id: 'assigned', label: 'Assigned' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'resolved', label: 'Resolved' },
];

/**
 * Calculate active stepper step index (0 to 3) based on status
 */
export const getStepIndex = (status, isAssigned) => {
  const norm = String(status || '').trim().toLowerCase();
  if (norm === 'resolved' || norm === 'closed') return 3;
  if (norm === 'in progress' || norm === 'on hold' || norm === 'reopened' || norm === 'pending evaluation' || norm === 'escalated') return 2;
  if (norm === 'assigned' || isAssigned) return 1;
  return 0; // Submitted
};

/**
 * Parse assignee details
 */
export const getAssigneeInfo = (ticket, employees = []) => {
  let name = '';
  let department = ticket?.department || 'Support Department';

  if (Array.isArray(ticket?.assigned_employees) && ticket.assigned_employees.length > 0) {
    const first = ticket.assigned_employees[0];
    name = first.name || first.full_name || '';
    if (first.department) department = first.department;
  } else if (Array.isArray(ticket?.assigned) && ticket.assigned.length > 0) {
    const first = ticket.assigned[0];
    if (typeof first === 'object' && first?.name) {
      name = first.name;
      if (first.department) department = first.department;
    } else {
      const match = employees.find((e) => String(e.id) === String(first) || String(e.emp_id) === String(first));
      if (match) {
        name = match.name;
        if (match.department) department = match.department;
      }
    }
  }

  if (!name) {
    name = ticket?.assigned_employee || ticket?.assigned_employee_name || ticket?.assigned_to_name || '';
  }

  if (!name && ticket?.assigned_to && typeof ticket.assigned_to === 'string' && ticket.assigned_to.toLowerCase() !== 'unassigned') {
    name = ticket.assigned_to;
  }

  const isAssigned = Boolean(name && name.toLowerCase() !== 'unassigned');
  const displayName = isAssigned ? name : 'Unassigned';
  const firstName = isAssigned ? displayName.split(' ')[0] : 'Support';
  const initials = isAssigned
    ? displayName
        .split(' ')
        .filter(Boolean)
        .map((p) => p[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : 'CS';

  return {
    isAssigned,
    name: displayName,
    firstName,
    initials,
    department,
  };
};

