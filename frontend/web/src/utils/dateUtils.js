export const parseUTCDate = (dateStr) => {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return isNaN(dateStr.getTime()) ? null : dateStr;
  const str = String(dateStr).trim();
  if (!str) return null;

  // Check if string already has an explicit timezone indicator (Z or +HH:mm or -HH:mm)
  const hasExplicitTimezone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(str);

  // If it's standard SQL or ISO format without timezone, backend sends it as UTC.
  // Parse as UTC by appending 'Z' so local browser timezone conversion works accurately.
  if (!hasExplicitTimezone) {
    // SQL format: "YYYY-MM-DD HH:mm:ss" or ISO without Z: "YYYY-MM-DDTHH:mm:ss(.sss)?"
    const sqlOrIsoRegex = /^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)$/;
    const match = str.match(sqlOrIsoRegex);
    if (match) {
      const utcStr = `${match[1]}T${match[2]}Z`;
      const d = new Date(utcStr);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // Fallback to native Date parsing (handles formats with timezone, RFC 2822, localized strings, etc.)
  const direct = new Date(str);
  if (!isNaN(direct.getTime())) {
    return direct;
  }

  return null;
};

export const formatDisplayDate = (dateStr) => {
  const date = parseUTCDate(dateStr);
  if (!date || isNaN(date.getTime())) return '—';
  
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

export const formatRelativeTime = (dateStr) => {
  if (!dateStr) return '';
  const date = parseUTCDate(dateStr);
  if (!date || isNaN(date.getTime())) return dateStr;

  const now = new Date();
  const diffMs = now - date;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export const DATE_RANGE_ERROR_MESSAGE = 'End date cannot be earlier than start date.';

/**
 * Returns true if startDate and endDate form a valid range (missing either bound, or end >= start).
 */
export const isDateRangeValid = (startDate, endDate) => {
  if (!startDate || !endDate) return true;
  return String(endDate) >= String(startDate);
};

/**
 * Resolves a Start Date input change so End Date never stays earlier than Start Date.
 */
export const resolveStartDateUpdate = (newStart, currentEnd) => {
  if (newStart && currentEnd && String(newStart) > String(currentEnd)) {
    return { startDate: newStart, endDate: newStart, error: '' };
  }
  return { startDate: newStart, endDate: currentEnd, error: '' };
};

/**
 * Validates an End Date input change against Start Date; rejects dates earlier than Start Date.
 */
export const resolveEndDateUpdate = (currentStart, newEnd) => {
  if (newEnd && currentStart && String(newEnd) < String(currentStart)) {
    return { valid: false, error: DATE_RANGE_ERROR_MESSAGE };
  }
  return { valid: true, endDate: newEnd, error: '' };
};
