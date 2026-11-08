/**
 * Utility functions to detect reassignment disapproval and extract the CSR's disapproval reason.
 */

/**
 * Clean and normalize a reason string.
 */
const cleanReason = (str) => {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Extract CSR disapproval reason from text (e.g. notification message or timeline entry).
 */
export const extractDisapprovalReasonFromText = (text) => {
  if (!text || typeof text !== 'string') return '';

  // Match Reason: "..." or Reason: '...'
  const quotedMatch = text.match(/Reason:\s*["']([^"']+)["']/i);
  if (quotedMatch && quotedMatch[1]) {
    return cleanReason(quotedMatch[1]);
  }

  // Match Reason: <text> until next sentence or end
  const unquotedMatch = text.match(/Reason:\s*([^.]+?)(?:\.\s*Ticket status|\.|$)/i);
  if (unquotedMatch && unquotedMatch[1]) {
    return cleanReason(unquotedMatch[1]);
  }

  return '';
};

/**
 * Checks if a ticket has a denied/rejected/disapproved reassignment.
 */
export const isReassignmentDenied = (ticket) => {
  if (!ticket) return false;

  // Active pending reassignment request supersedes any past denial
  const statusStr = String(ticket.reassignmentStatus || ticket.assignment_status || ticket.status || '').toLowerCase();
  if (
    ['pending', 'reassignment_requested', 'pending reassignment', 'pending reassign'].includes(statusStr) ||
    ticket.reassignmentRequested === true ||
    ticket.status === 'Pending Reassignment' ||
    ticket.has_pending_reassignment
  ) {
    return false;
  }

  // Direct status or boolean flags
  if (['denied', 'rejected', 'disapproved', 'failed', 'reassignment failed', 'reassignment disapproved'].includes(statusStr)) {
    return true;
  }

  if (
    ticket.deniedReassignment === true ||
    ticket.reassignmentDenied === true ||
    ticket.reassignmentDisapproved === true ||
    ticket.reassignmentFailed === true
  ) {
    return true;
  }

  // Check explicit deny reason fields
  if (
    ticket.reassignmentDenyReason ||
    ticket.disapprovalReason ||
    ticket.reassignmentDisapprovalReason ||
    ticket.reassignmentDenialReason ||
    ticket.denialReason
  ) {
    return true;
  }

  // Check notification context if present
  const notifType = ticket.notificationType || ticket.type || '';
  if (notifType === 'reassignment_denied' || notifType === 'reassignment_rejected') {
    return true;
  }

  const notifTitle = ticket.notificationTitle || '';
  if (/reassign.*(reject|deni|disapprov)/i.test(notifTitle)) {
    return true;
  }

  const notifMsg = ticket.notificationMessage || ticket.message || '';
  if (/reassign.*(reject|deni|disapprov)/i.test(notifMsg)) {
    return true;
  }

  // Check timeline events
  if (Array.isArray(ticket.timeline)) {
    const hasDenyEvent = ticket.timeline.some((evt) => {
      const text = String(evt.text || '');
      return (
        (evt.type === 'reassign' || /reassign/i.test(text)) &&
        /(denied|rejected|disapproved)/i.test(text)
      );
    });
    if (hasDenyEvent) return true;
  }

  return false;
};

/**
 * Retrieves the CSR's reason for disapproving/rejecting a reassignment request.
 */
export const getReassignmentDisapprovalReason = (ticket) => {
  if (!ticket) return '';

  // 1. Direct object properties
  if (ticket.reassignmentDenyReason && typeof ticket.reassignmentDenyReason === 'string' && ticket.reassignmentDenyReason.trim()) {
    return cleanReason(ticket.reassignmentDenyReason);
  }
  if (ticket.disapprovalReason && typeof ticket.disapprovalReason === 'string' && ticket.disapprovalReason.trim()) {
    return cleanReason(ticket.disapprovalReason);
  }
  if (ticket.reassignmentDisapprovalReason && typeof ticket.reassignmentDisapprovalReason === 'string' && ticket.reassignmentDisapprovalReason.trim()) {
    return cleanReason(ticket.reassignmentDisapprovalReason);
  }
  if (ticket.reassignmentDenialReason && typeof ticket.reassignmentDenialReason === 'string' && ticket.reassignmentDenialReason.trim()) {
    return cleanReason(ticket.reassignmentDenialReason);
  }
  if (ticket.denialReason && typeof ticket.denialReason === 'string' && ticket.denialReason.trim()) {
    return cleanReason(ticket.denialReason);
  }
  if (ticket.reassignDenyReason && typeof ticket.reassignDenyReason === 'string' && ticket.reassignDenyReason.trim()) {
    return cleanReason(ticket.reassignDenyReason);
  }
  if (ticket.reassignment_deny_reason && typeof ticket.reassignment_deny_reason === 'string' && ticket.reassignment_deny_reason.trim()) {
    return cleanReason(ticket.reassignment_deny_reason);
  }
  if (ticket.reassignment_reject_reason && typeof ticket.reassignment_reject_reason === 'string' && ticket.reassignment_reject_reason.trim()) {
    return cleanReason(ticket.reassignment_reject_reason);
  }

  // 2. Notification payload data
  if (ticket.notificationData) {
    const data = typeof ticket.notificationData === 'string'
      ? (() => { try { return JSON.parse(ticket.notificationData); } catch { return {}; } })()
      : ticket.notificationData;
    if (data?.reason && typeof data.reason === 'string' && data.reason.trim()) {
      return cleanReason(data.reason);
    }
  }

  // 3. Timeline events (search newest first)
  if (Array.isArray(ticket.timeline)) {
    for (let i = ticket.timeline.length - 1; i >= 0; i--) {
      const evt = ticket.timeline[i];
      const text = String(evt.text || '');
      const isDeny = (evt.type === 'reassign' || /reassign/i.test(text)) &&
        /(denied|rejected|disapproved)/i.test(text);
      if (isDeny) {
        const extracted = extractDisapprovalReasonFromText(text);
        if (extracted) return extracted;
      }
    }
  }

  // 4. Notification message or general message
  const notifMsg = ticket.notificationMessage || ticket.message || '';
  if (notifMsg && /reassign.*(reject|deni|disapprov)/i.test(notifMsg)) {
    const extracted = extractDisapprovalReasonFromText(notifMsg);
    if (extracted) return extracted;
  }

  // 5. Remarks / Remarks history
  const remarks = Array.isArray(ticket.remarks) ? ticket.remarks : [];
  for (let i = remarks.length - 1; i >= 0; i--) {
    const rem = String(remarks[i]?.remark || remarks[i]?.text || '');
    if (/reassign.*(reject|deni|disapprov)/i.test(rem)) {
      const extracted = extractDisapprovalReasonFromText(rem);
      if (extracted) return extracted;
    }
  }

  return '';
};

/**
 * Checks if a ticket has an active pending reassignment request awaiting CS coordinator review.
 */
export const hasPendingReassignment = (ticket) => {
  if (!ticket) return false;
  const statusStr = String(ticket.reassignmentStatus || ticket.assignment_status || ticket.status || '').toLowerCase();
  if (['pending', 'reassignment_requested', 'pending reassignment', 'pending reassign'].includes(statusStr)) {
    return true;
  }
  if (
    ticket.reassignmentRequested === true ||
    ticket.status === 'Pending Reassignment' ||
    ticket.has_pending_reassignment
  ) {
    return true;
  }
  return false;
};

/**
 * Helper to get the canonical employee incoming status string.
 */
export const getEmployeeIncomingDisplayStatus = (ticket) => {
  if (!ticket) return 'Open';
  if (isReassignmentDenied(ticket)) {
    return 'Reassignment Failed';
  }
  if (hasPendingReassignment(ticket)) {
    return 'Pending Reassignment';
  }
  return ticket.status || 'Open';
};
