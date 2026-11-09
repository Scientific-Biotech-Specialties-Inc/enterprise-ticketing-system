import tokenStore from '@/auth/tokenStore';

// Spec 0034: the analytics-service identifies the caller from the verified token only.
const authHeaders = () => {
  const token = tokenStore.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const STORAGE_KEY = 'customer_feedback';
const EXTERNAL_TICKETS_KEY = 'demo_external_tickets';
const PENDING_EVAL_KEY = 'demo_pending_evaluation_tickets';

const mockEmployees = [
  { id: 1, name: 'Juan Dela Cruz', jobTitle: 'Technical Support Engineer', department: 'Technical Support' },
  { id: 2, name: 'Maria Santos', jobTitle: 'Network Engineer', department: 'Network Engineering' },
  { id: 3, name: 'John Reyes', jobTitle: 'QA Engineer', department: 'Quality Assurance' },
];

// demoExternalTicket and demoPendingEvaluationTicket have been removed so only real database tickets are displayed.

export function getMockEmployees() {
  return mockEmployees;
}

export function getEmployeeById(id) {
  return mockEmployees.find((e) => e.id === id) || null;
}

export function getTicketEmployees(ticket) {
  if (!ticket) return [];

  const rawList = [];

  // 1. If assigned_employees array exists:
  if (Array.isArray(ticket.assigned_employees) && ticket.assigned_employees.length > 0) {
    ticket.assigned_employees.forEach((a, idx) => {
      if (typeof a === 'object' && a !== null) {
        const id = a.id ?? a.emp_id ?? a.employee_id ?? `assigned-${idx + 1}`;
        rawList.push({
          id,
          name: a.name || `${a.first_name || ''} ${a.last_name || ''}`.trim() || 'Assigned Support Specialist',
          jobTitle: a.role || a.jobTitle || 'Technical Support Specialist',
          department: a.department || ticket.department || 'Technical Support',
        });
      } else if (a) {
        const mock = getEmployeeById(a);
        rawList.push(mock || {
          id: a,
          name: `Support Specialist #${a}`,
          jobTitle: 'Technical Support Specialist',
          department: ticket.department || 'Technical Support',
        });
      }
    });
  }

  // 2. If assigned array of objects exists:
  if (rawList.length === 0 && Array.isArray(ticket.assigned) && ticket.assigned.length > 0) {
    ticket.assigned.forEach((a, idx) => {
      if (typeof a === 'object' && a !== null) {
        const id = a.id ?? a.emp_id ?? a.employee_id ?? `assigned-${idx + 1}`;
        rawList.push({
          id,
          name: a.name || `${a.first_name || ''} ${a.last_name || ''}`.trim() || 'Assigned Support Specialist',
          jobTitle: a.role || a.jobTitle || 'Technical Support Specialist',
          department: a.department || ticket.department || 'Technical Support',
        });
      } else if (a) {
        const mock = getEmployeeById(a);
        rawList.push(mock || {
          id: a,
          name: `Support Specialist #${a}`,
          jobTitle: 'Technical Support Specialist',
          department: ticket.department || 'Technical Support',
        });
      }
    });
  }

  // 3. If assignedEmployees array of IDs exists:
  if (rawList.length === 0 && Array.isArray(ticket.assignedEmployees) && ticket.assignedEmployees.length > 0) {
    ticket.assignedEmployees.forEach((id) => {
      if (id) {
        const mock = getEmployeeById(id);
        rawList.push(mock || {
          id,
          name: `Support Specialist #${id}`,
          jobTitle: 'Technical Support Specialist',
          department: ticket.department || 'Technical Support',
        });
      }
    });
  }

  // 4. If assigned_employee name exists:
  if (rawList.length === 0) {
    const empName = ticket.assigned_employee || ticket.assigned_employee_name || ticket.assigned_to_name || (typeof ticket.assigned_to === 'string' ? ticket.assigned_to : null);
    if (empName && empName !== '—' && empName !== 'Unassigned') {
      const empId = typeof ticket.assigned_to === 'number' ? ticket.assigned_to : (ticket.assigned_to || 'emp-assigned');
      rawList.push({
        id: empId,
        name: empName,
        jobTitle: 'Technical Support Specialist',
        department: ticket.department || 'Technical Support',
      });
    }
  }

  // 5. If assigned_to exists:
  if (rawList.length === 0 && ticket.assigned_to && ticket.assigned_to !== 'Unassigned') {
    const numId = Number(ticket.assigned_to);
    const mock = numId ? getEmployeeById(numId) : null;
    rawList.push(mock || {
      id: ticket.assigned_to,
      name: 'Assigned Support Specialist',
      jobTitle: 'Technical Support Specialist',
      department: ticket.department || 'Technical Support',
    });
  }

  // 6. Deduplicate by ID and Name to avoid duplicate React keys
  const seenIds = new Set();
  const seenNames = new Set();
  const deduped = [];
  rawList.forEach((emp, index) => {
    let empId = emp.id;
    if (empId === undefined || empId === null || seenIds.has(String(empId))) {
      empId = `emp-${index + 1}-${String(emp.name || 'spec').replace(/\s+/g, '-').toLowerCase()}`;
    }
    const nameKey = (emp.name || '').trim().toLowerCase();
    if (nameKey && seenNames.has(nameKey)) {
      return;
    }
    seenIds.add(String(empId));
    if (nameKey) seenNames.add(nameKey);
    deduped.push({
      ...emp,
      id: empId,
    });
  });

  if (deduped.length > 0) {
    return deduped;
  }

  // Fallback to distinct team identity without colliding with employee id: 1
  return [{
    id: 'support-team',
    name: 'Customer Support Team',
    jobTitle: 'Technical Support & Service Specialist',
    department: ticket.department || ticket.category || 'Customer Service',
  }];
}

export function getDemoExternalTicket() {
  return null;
}

export function seedDemoExternalTicket() {
  try {
    localStorage.removeItem(EXTERNAL_TICKETS_KEY);
  } catch {
    // ignore
  }
  return false;
}

export function getExternalTicketsFromStorage() {
  return [];
}

export function getDemoPendingEvaluationTicket() {
  return null;
}

export function seedDemoPendingEvaluationTicket() {
  try {
    localStorage.removeItem(PENDING_EVAL_KEY);
  } catch {
    // ignore
  }
  return false;
}

export function getPendingEvaluationTicketsFromStorage() {
  try {
    localStorage.removeItem(PENDING_EVAL_KEY);
  } catch {
    // ignore
  }
  return [];
}

export function clearPendingEvaluationMocks() {
  try {
    localStorage.removeItem(PENDING_EVAL_KEY);
  } catch {
    // ignore
  }
}

export function getAllFeedback() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function getTicketFeedback(ticketId) {
  if (!ticketId) return null;
  const all = getAllFeedback();
  if (all[ticketId]) return all[ticketId];
  if (all[String(ticketId)]) return all[String(ticketId)];
  const num = Number(String(ticketId).replace(/\D/g, ''));
  if (num && all[num]) return all[num];
  return null;
}

export function hasFeedbackBeenSubmitted(ticketId) {
  const feedback = getTicketFeedback(ticketId);
  return !!(feedback && feedback.submitted);
}

/**
 * The id the backend understands for a ticket. The analytics service looks the ticket up by its
 * numeric primary key, so the display number (e.g. "TKT-0012") must never be sent to it.
 */
export function feedbackTicketId(ticket) {
  return ticket?.ticket_ID ?? ticket?.ticket_id ?? ticket?.id;
}

// Throws for an HTTP rejection so callers can show it. A network failure is not an HTTP error,
// so the caller keeps the local copy for those.
async function assertFeedbackResponse(res) {
  if (res.ok) return;
  let message = `Feedback request failed (${res.status}).`;
  try {
    const body = await res.json();
    message = body?.message || message;
  } catch {
    // keep default message
  }
  const err = new Error(message);
  err.isHttpError = true;
  throw err;
}

export async function saveFeedback(ticketId, ratings, comments, overallComment, customerId = null, questionAnswers = {}, categoryQuestionsSnapshot = []) {
  const feedbackData = {
    ratings,
    comments: comments || {},
    overallComment: overallComment || '',
    questionAnswers: questionAnswers || {},
    categoryQuestionsSnapshot: categoryQuestionsSnapshot || [],
    submittedAt: new Date().toISOString(),
    submitted: true,
  };

  const persistLocal = () => {
    const all = getAllFeedback();
    all[ticketId] = feedbackData;
    all[String(ticketId)] = feedbackData;
    const num = Number(String(ticketId).replace(/\D/g, ''));
    if (num) {
      all[num] = feedbackData;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    try {
      window.dispatchEvent(new CustomEvent('customer_feedback_submitted', { detail: { ticketId } }));
    } catch {
      // ignore
    }
    return all[ticketId];
  };

  // Send rating payload to legacy DB via analytics-service backend API
  if (!tokenStore.getToken()) {
    return persistLocal();
  }

  try {
    const res = await fetch('/api/ticketing/analytics/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({
        ticket_id: String(ticketId),
        ratings,
        comments: comments || {},
        overall_comment: overallComment || '',
        question_answers: questionAnswers || {},
        category_questions_snapshot: categoryQuestionsSnapshot || [],
      }),
    });
    await assertFeedbackResponse(res);
  } catch (err) {
    if (err?.isHttpError) throw err;
    console.warn('Analytics service offline. Feedback persisted locally:', err);
  }

  return persistLocal();
}

export async function updateFeedback(ticketId, ratings, comments, overallComment, customerId = null, questionAnswers = {}, categoryQuestionsSnapshot = []) {
  const existing = getAllFeedback()[ticketId] || getAllFeedback()[String(ticketId)] || {};
  const feedbackData = {
    ...existing,
    ratings,
    comments: comments || {},
    overallComment: overallComment || '',
    questionAnswers: questionAnswers || {},
    categoryQuestionsSnapshot: categoryQuestionsSnapshot || existing.categoryQuestionsSnapshot || [],
    updatedAt: new Date().toISOString(),
    submittedAt: existing.submittedAt || new Date().toISOString(),
    submitted: true,
  };

  const persistLocal = () => {
    const all = getAllFeedback();
    all[ticketId] = feedbackData;
    all[String(ticketId)] = feedbackData;
    const num = Number(String(ticketId).replace(/\D/g, ''));
    if (num) {
      all[num] = feedbackData;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    try {
      window.dispatchEvent(new CustomEvent('customer_feedback_updated', { detail: { ticketId, feedback: feedbackData } }));
    } catch {
      // ignore
    }
    return all[ticketId];
  };

  if (!tokenStore.getToken()) {
    return persistLocal();
  }

  try {
    const res = await fetch(`/api/ticketing/analytics/feedback/ticket/${ticketId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({
        ratings,
        comments: comments || {},
        overall_comment: overallComment || '',
        question_answers: questionAnswers || {},
        category_questions_snapshot: categoryQuestionsSnapshot || existing.categoryQuestionsSnapshot || [],
      }),
    });
    await assertFeedbackResponse(res);
  } catch (err) {
    if (err?.isHttpError) throw err;
    console.warn('Analytics service offline. Feedback update persisted locally:', err);
  }

  return persistLocal();
}

export async function deleteFeedback(ticketId) {
  const all = getAllFeedback();
  delete all[ticketId];
  delete all[String(ticketId)];
  const num = Number(String(ticketId).replace(/\D/g, ''));
  if (num) {
    delete all[num];
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));

  try {
    window.dispatchEvent(new CustomEvent('customer_feedback_deleted', { detail: { ticketId } }));
  } catch {
    // ignore
  }

  if (!tokenStore.getToken()) {
    return true;
  }

  try {
    const res = await fetch(`/api/ticketing/analytics/feedback/ticket/${ticketId}`, {
      method: 'DELETE',
      headers: {
        'Accept': 'application/json',
        ...authHeaders(),
      },
    });
    const result = await res.json();
    console.log('CSAT feedback deleted on analytics-service:', result);
  } catch (err) {
    console.warn('Analytics service offline. Feedback deletion persisted locally:', err);
  }

  return true;
}

export async function fetchFeedbackForTicket(ticketId) {
  if (!ticketId) return null;
  const local = getTicketFeedback(ticketId);
  const token = tokenStore.getToken();
  if (!token) return local;

  try {
    let res = await fetch(`/api/ticketing/analytics/feedback/ticket/${ticketId}`, {
      headers: { Accept: 'application/json', ...authHeaders() },
    });
    if (res.status === 401 || res.status === 403) {
      return local;
    }
    if (!res.ok && res.status === 404) {
      const strId = String(ticketId);
      const numMatch = strId.match(/\d+/);
      if (numMatch) {
        const num = parseInt(numMatch[0], 10);
        const altId = strId.startsWith('TKTS-') ? String(num) : `TKTS-${String(num).padStart(5, '0')}`;
        res = await fetch(`/api/ticketing/analytics/feedback/ticket/${altId}`, {
          headers: { Accept: 'application/json', ...authHeaders() },
        });
      }
    }
    if (res.ok) {
      const json = await res.json();
      const data = json.data || json.feedback || json;
      if (data && (data.employee_ratings || data.ratings || data.overall_rating || data.id)) {
        const ratings = { ...(local?.ratings || {}) };
        const comments = { ...(local?.comments || {}) };
        if (Array.isArray(data.employee_ratings)) {
          data.employee_ratings.forEach((er) => {
            if (er && er.employee_id !== undefined && er.employee_id !== null) {
              ratings[er.employee_id] = er.rating;
              ratings[String(er.employee_id)] = er.rating;
              if (er.comment) {
                comments[er.employee_id] = er.comment;
                comments[String(er.employee_id)] = er.comment;
              }
            }
          });
        }
        if (data.ratings && typeof data.ratings === 'object') {
          Object.assign(ratings, data.ratings);
        }
        if (data.comments && typeof data.comments === 'object') {
          Object.assign(comments, data.comments);
        }
        const syncedFeedback = {
          ratings,
          comments,
          overallRating: data.overall_rating,
          overallComment: data.overall_comment || data.overallComment || local?.overallComment || '',
          employeeRatings: data.employee_ratings || [],
          questionAnswers: data.question_answers || data.questionAnswers || local?.questionAnswers || {},
          categoryQuestionsSnapshot: data.category_questions_snapshot || data.categoryQuestionsSnapshot || local?.categoryQuestionsSnapshot || [],
          submittedAt: data.created_at || data.submittedAt || local?.submittedAt || new Date().toISOString(),
          updatedAt: data.updated_at || data.updatedAt || local?.updatedAt,
          submitted: true,
        };
        const all = getAllFeedback();
        all[ticketId] = syncedFeedback;
        all[String(ticketId)] = syncedFeedback;
        const num = Number(String(ticketId).replace(/\D/g, ''));
        if (num) all[num] = syncedFeedback;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
        return syncedFeedback;
      }
    }
  } catch (err) {
    // Analytics service offline or network issue
  }
  return local;
}

export const FEEDBACK_MASTER_ENABLED_KEY = 'feedback_form_master_enabled';

// TEMPORARY: localStorage is used here only as a same-session demo bridge between Super Admin and Customer portals for this sprint's frontend-only scope. This must be replaced with a real backend-persisted setting, read by both portals via API, before this is production-ready — localStorage does not sync across different users/devices/browsers.
export function isFeedbackFormEnabled() {
  try {
    const val = localStorage.getItem(FEEDBACK_MASTER_ENABLED_KEY);
    if (val === null) return true; // Default: ON
    return JSON.parse(val);
  } catch {
    return true;
  }
}

// TEMPORARY: localStorage is used here only as a same-session demo bridge between Super Admin and Customer portals for this sprint's frontend-only scope. This must be replaced with a real backend-persisted setting, read by both portals via API, before this is production-ready — localStorage does not sync across different users/devices/browsers.
export function setFeedbackFormEnabled(enabled) {
  try {
    localStorage.setItem(FEEDBACK_MASTER_ENABLED_KEY, JSON.stringify(Boolean(enabled)));
    window.dispatchEvent(new Event('feedback_master_toggle_changed'));
  } catch (err) {
    console.error('Failed to save feedback master toggle to localStorage:', err);
  }
}

