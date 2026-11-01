import axios from 'axios';
import axiosInstance from '@/api/axiosInstance';
import { TICKET_API_URL, EMPLOYEE_API_URL, AUTH_ENDPOINTS, AI_API_URL } from '@/config/api.config';
import tokenStore from '@/auth/tokenStore';
import { refreshAccessToken } from '@/auth/refreshSession';

const ticketClient = axios.create({
  baseURL: TICKET_API_URL,
  withCredentials: true,
  headers: {
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  },
});

const getStoredClientId = () => {
  try {
    const raw = sessionStorage.getItem('user') || localStorage.getItem('user');
    if (!raw) return null;
    const u = JSON.parse(raw);
    return u?.client_ID || u?.client_id || u?.id || null;
  } catch {
    return null;
  }
};

ticketClient.interceptors.request.use((config) => {
  const token = tokenStore.getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const clientId = getStoredClientId();
  if (clientId) {
    config.headers['X-Client-Id'] = String(clientId);
    config.headers['X-User-Id'] = String(clientId);
  }

  return config;
});

ticketClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry
    ) {
      originalRequest._retry = true;
      const refreshed = await refreshAccessToken();
      const currentToken = tokenStore.getToken();
      if (refreshed && currentToken) {
        originalRequest.headers.Authorization = `Bearer ${currentToken}`;
        return ticketClient(originalRequest);
      }

      tokenStore.clearToken();
      sessionStorage.removeItem('user');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('auth:unauthorized'));
      }
    }

    return Promise.reject(error);
  }
);

const employeeClient = axios.create({
  baseURL: EMPLOYEE_API_URL || '/api/ticketing/employee',
  withCredentials: true,
  headers: {
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  },
});

employeeClient.interceptors.request.use((config) => {
  const token = tokenStore.getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

employeeClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry
    ) {
      originalRequest._retry = true;
      const refreshed = await refreshAccessToken();
      const currentToken = tokenStore.getToken();
      if (refreshed && currentToken) {
        originalRequest.headers.Authorization = `Bearer ${currentToken}`;
        return employeeClient(originalRequest);
      }

      tokenStore.clearToken();
      sessionStorage.removeItem('user');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('auth:unauthorized'));
      }
    }

    return Promise.reject(error);
  }
);

const attachmentClient = axios.create({
  baseURL: '/api/ticketing/attachment',
  withCredentials: true,
  headers: {
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': 'application/json',
  },
});

attachmentClient.interceptors.request.use((config) => {
  const token = tokenStore.getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const uploadAttachments = async (files, isProof = false) => {
  if (!files || files.length === 0) return [];
  const formData = new FormData();
  files.forEach((file) => {
    formData.append('attachments[]', file);
  });
  if (isProof) {
    formData.append('is_proof', 'true');
  }

  const response = await attachmentClient.post('/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data?.attachments ?? [];
};

const processPayloadAndUpload = async (payload, isProof = false) => {
  let files = [];
  let existingAttachmentIds = [];
  let fields = {};

  if (payload instanceof FormData) {
    for (const [key, value] of payload.entries()) {
      if (key === 'attachments[]' || key === 'attachments') {
        if (value instanceof File || value instanceof Blob) {
          files.push(value);
        } else if (value !== null && value !== undefined && value !== '') {
          const num = Number(value);
          if (!isNaN(num) && num > 0) existingAttachmentIds.push(num);
        }
      } else if (key === 'file' && value) {
        if (value instanceof File || value instanceof Blob) {
          files.push(value);
        }
      } else {
        fields[key] = value;
      }
    }
  } else if (payload && typeof payload === 'object') {
    fields = { ...payload };
    const rawAttachments = Array.isArray(payload.attachments)
      ? payload.attachments
      : payload.attachments !== undefined && payload.attachments !== null
      ? [payload.attachments]
      : [];

    rawAttachments.forEach((item) => {
      if (item instanceof File || item instanceof Blob) {
        files.push(item);
      } else if (item !== null && item !== undefined && item !== '') {
        const num = Number(item);
        if (!isNaN(num) && num > 0) existingAttachmentIds.push(num);
      }
    });
    delete fields.attachments;

    if (payload.file) {
      if (payload.file instanceof File || payload.file instanceof Blob) {
        files.push(payload.file);
      }
      delete fields.file;
    }
  } else {
    return payload;
  }

  let uploadedIds = [];
  if (files.length > 0) {
    const uploaded = await uploadAttachments(files, isProof);
    uploadedIds = (uploaded || []).map((a) => a.id || a.attachment_ID).filter(Boolean);
  }

  fields.attachments = [...existingAttachmentIds, ...uploadedIds];

  return fields;
};

let optionsCache = null;
let optionsCacheAt = 0;
let optionsInFlight = null;
const OPTIONS_CACHE_TTL_MS = 5 * 60 * 1000;

let dashboardCache = null;
let dashboardCacheAt = 0;
let dashboardInFlight = null;
const DASHBOARD_CACHE_TTL_MS = 30 * 1000;
const CUSTOMER_TICKET_OVERRIDES_KEY = 'customer_ticket_overrides';
const CUSTOMER_TICKET_DETAILS_KEY = 'customer_ticket_details';

let csDashboardCache = null;
let csDashboardCacheAt = 0;
let csDashboardInFlight = null;
const CS_DASHBOARD_CACHE_TTL_MS = 15 * 1000;

export const CS_TICKET_REFRESH_EVENT = 'cs:tickets-changed';

const notifyCsTicketRefresh = () => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(CS_TICKET_REFRESH_EVENT));
};

let incomingTicketsCache = null;
let incomingTicketsCacheAt = 0;
let incomingTicketsInFlight = null;
const INCOMING_TICKETS_CACHE_TTL_MS = 10 * 1000;

let employeesCache = {};
let employeesCacheAt = {};
let employeesInFlight = {};
const EMPLOYEES_CACHE_TTL_MS = 5 * 60 * 1000;

let departmentsCache = null;
let departmentsCacheAt = 0;
let departmentsInFlight = null;
const DEPARTMENTS_CACHE_TTL_MS = 5 * 60 * 1000;

let employeeTicketsCache = {};
let employeeTicketsCacheAt = {};
let employeeTicketsInFlight = {};
const EMPLOYEE_TICKETS_CACHE_TTL_MS = 30 * 1000;

export const clearEmployeeTicketsCache = () => {
  employeeTicketsCache = {};
  employeeTicketsCacheAt = {};
  employeeTicketsInFlight = {};
  clearTicketDetailsCache();
};

const isCacheFresh = () => optionsCache && (Date.now() - optionsCacheAt) < OPTIONS_CACHE_TTL_MS;
const isDashboardCacheFresh = () => dashboardCache && (Date.now() - dashboardCacheAt) < DASHBOARD_CACHE_TTL_MS;

const readJsonStore = (key, fallback) => {
  if (typeof window === 'undefined') return fallback;

  try {
    return JSON.parse(window.localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
};

const writeJsonStore = (key, value) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
};

const getTicketOverrides = () => readJsonStore(CUSTOMER_TICKET_OVERRIDES_KEY, {});
const getLocalTicketDetailsStore = () => readJsonStore(CUSTOMER_TICKET_DETAILS_KEY, {});

const normalizeCustomerTicket = (ticket = {}) => {
  const overrides = getTicketOverrides()[ticket.id] || {};
  const details = getLocalTicketDetailsStore()[ticket.id] || {};
  const status = overrides.status || ticket.status || 'Open';
  const now = new Date().toISOString();
  const assigned_to = ticket.assigned_to || details.assigned_to || null;

  const equipment_type = ticket.equipment_type || ticket.equipmentType || details.equipment_type || details.equipmentType || null;
  const assigned_employee =
    ticket.assigned_employee ||
    ticket.assigned_employee_name ||
    ticket.assigned_to_name ||
    (Array.isArray(ticket.assigned_employees) && ticket.assigned_employees[0]?.name ? ticket.assigned_employees[0].name : null) ||
    details.assigned_employee ||
    (typeof assigned_to === 'string' && assigned_to.trim() && assigned_to.trim().toLowerCase() !== 'unassigned' ? assigned_to : null);

  return {
    ...ticket,
    ticket_ID: ticket.ticket_ID || details.ticket_ID || Number(String(ticket.id || '').replace(/\D/g, '')) || null,
    id: ticket.id,
    title: ticket.title || details.title || 'Untitled ticket',
    category: ticket.category || details.category || 'General',
    priority: ticket.priority || details.priority || 'Medium',
    status,
    machine_ID: ticket.machine_ID || details.machine_ID || null,
    machine_name: ticket.machine_name || details.machine_name || null,
    equipment: ticket.equipment || details.equipment || 'Unspecified equipment',
    equipment_type,
    equipmentType: equipment_type,
    description: ticket.description || details.description || '',
    date_created: ticket.date_created || details.date_created || now,
    last_updated: overrides.last_updated || ticket.last_updated || details.last_updated || ticket.date_created || now,
    can_discard: status === 'Open' && !assigned_to,
    assigned_to,
    assigned_employee,
    assigned_employee_name: assigned_employee,
    assigned_to_name: ticket.assigned_to_name || assigned_employee,
    resolved_at: ticket.resolved_at || details.resolved_at || null,
    closed_at: ticket.closed_at || details.closed_at || null,
    remarks: ticket.remarks || details.remarks || [],
    remarks_history: ticket.remarks_history || details.remarks_history || [],
  };
};

export const saveCustomerTicketDetail = (ticket = {}) => {
  if (!ticket.id) return;

  const details = getLocalTicketDetailsStore();
  details[ticket.id] = {
    ...(details[ticket.id] || {}),
    ...ticket,
    last_updated: ticket.last_updated || new Date().toISOString(),
  };
  writeJsonStore(CUSTOMER_TICKET_DETAILS_KEY, details);
};

export const discardCustomerTicket = async (ticketId) => {
  const response = await ticketClient.delete(`/tickets/${ticketId}`);
  return response.data;
};

const fetchTicketFormOptions = async () => {
  const response = await ticketClient.get('/ticket-form-options');
  optionsCache = response.data;
  optionsCacheAt = Date.now();
  return response.data;
};

export const getTicketFormOptions = async ({ forceRefresh = false } = {}) => {
  if (!forceRefresh && isCacheFresh()) {
    return optionsCache;
  }

  if (!forceRefresh && optionsInFlight) {
    return optionsInFlight;
  }

  optionsInFlight = fetchTicketFormOptions().finally(() => {
    optionsInFlight = null;
  });

  return optionsInFlight;
};

export const prefetchTicketFormOptions = async () => getTicketFormOptions();

export const getCachedTicketFormOptions = () => {
  if (!isCacheFresh()) {
    return null;
  }

  return optionsCache;
};

export const clearTicketFormOptionsCache = () => {
  optionsCache = null;
  optionsCacheAt = 0;
  optionsInFlight = null;
};

const fetchCustomerDashboard = async ({ createdBy = 1, limit = 5, ...filters } = {}) => {
  const params = {
    created_by: createdBy,
    limit,
    ...filters,
  };
  const response = await ticketClient.get('/customer-dashboard', { params });

  const hasFilters = Object.values(filters).some((v) => v !== undefined && v !== '' && v !== null);
  if (!hasFilters) {
    dashboardCache = response.data;
    dashboardCacheAt = Date.now();
  }
  return response.data;
};

export const getCustomerDashboard = async ({ createdBy = 1, limit = 5, forceRefresh = false, ...filters } = {}) => {
  const hasFilters = Object.values(filters).some((v) => v !== undefined && v !== '' && v !== null);
  if (!hasFilters && !forceRefresh && isDashboardCacheFresh()) {
    return dashboardCache;
  }

  if (!hasFilters && !forceRefresh && dashboardInFlight) {
    return dashboardInFlight;
  }

  const promise = fetchCustomerDashboard({ createdBy, limit, ...filters }).finally(() => {
    if (!hasFilters) dashboardInFlight = null;
  });

  if (!hasFilters) dashboardInFlight = promise;
  return promise;
};

export const getCustomerTickets = async ({ createdBy = 1, limit = 20, forceRefresh = false, ...filters } = {}) => {
  const data = await getCustomerDashboard({ createdBy, limit, forceRefresh, ...filters });
  return (data?.recent_tickets || []).map(normalizeCustomerTicket);
};

export const getCustomerFilterOptions = async (createdBy = 1) => {
  const response = await ticketClient.get('/customer/filter-options', {
    params: { created_by: createdBy },
  });
  return response.data;
};

export const getCSFilterOptions = async () => {
  const response = await ticketClient.get('/cs/filter-options');
  return response.data;
};

export const saveTicketDraft = async (data) => {
  let uploadedAttachments = [];
  if (data.attachments && data.attachments.length > 0) {
    const rawFiles = data.attachments.filter((f) => typeof File !== 'undefined' && f instanceof File);
    const existing = data.attachments.filter((f) => !(typeof File !== 'undefined' && f instanceof File));
    if (rawFiles.length > 0) {
      const uploaded = await uploadAttachments(rawFiles);
      uploadedAttachments = [...existing, ...uploaded];
    } else {
      uploadedAttachments = existing;
    }
  }

  let clientId = data.client_id || data.client_ID || data.created_by || getStoredClientId();

  const payload = {
    client_id: clientId || undefined,
    draft_id: data.id || data.draft_id || undefined,
    title: data.title ?? '',
    description: data.description ?? '',
    machine_ID: data.machine_ID || undefined,
    problem_category_ID: data.problem_category_ID || undefined,
    priority_ID: data.priority_ID || 1,
    attachments: uploadedAttachments,
  };

  const response = await ticketClient.post('/tickets/draft', payload);
  return response.data;
};

export const getTicketDrafts = async (params = {}) => {
  let query = { ...params };
  if (!query.client_id) {
    const cid = getStoredClientId();
    if (cid) query.client_id = cid;
  }

  try {
    const response = await ticketClient.get('/tickets/drafts', { params: query });
    return response.data?.drafts ?? [];
  } catch (error) {
    if (error.response?.status === 401) {
      return [];
    }
    throw error;
  }
};

export const getTicketDraft = async (id, params = {}) => {
  let query = { ...params };
  if (!query.client_id) {
    const cid = getStoredClientId();
    if (cid) query.client_id = cid;
  }
  const response = await ticketClient.get(`/tickets/drafts/${id}`, { params: query });
  return response.data?.draft ?? response.data;
};

export const deleteTicketDraft = async (id, params = {}) => {
  let query = { ...params };
  if (!query.client_id) {
    const cid = getStoredClientId();
    if (cid) query.client_id = cid;
  }
  const response = await ticketClient.delete(`/tickets/drafts/${id}`, { params: query });
  return response.data;
};

export const getNotificationPreferences = async () => {
  const response = await axiosInstance.get('/notification-preferences');
  return response.data;
};

export const updateNotificationPreferences = async (preferences) => {
  const response = await axiosInstance.put('/notification-preferences', preferences);
  return response.data;
};

export const clearCustomerDashboardCache = () => {
  dashboardCache = null;
  dashboardCacheAt = 0;
  dashboardInFlight = null;
};

const fetchCSDashboard = async ({ limit = 10 } = {}) => {
  const response = await ticketClient.get('/cs-dashboard', {
    params: { limit },
  });

  csDashboardCache = response.data;
  csDashboardCacheAt = Date.now();
  return response.data;
};

const fetchIncomingTickets = async ({ limit = 50, page = 1, forceRefresh = false, ...filters } = {}) => {
  const params = { limit, page, ...filters };
  if (forceRefresh) {
    params.forceRefresh = true;
  }
  const response = await ticketClient.get('/cs-incoming', { params });
  const data = response.data?.incoming_tickets ?? [];
  const pagination = response.data?.pagination ?? null;
  const slaSummary = response.data?.sla_summary ?? null;

  const hasFilters = Object.values(filters).some((v) => v !== undefined && v !== '' && v !== null);
  if (!hasFilters) {
    incomingTicketsCache = { list: data, pagination, slaSummary };
    incomingTicketsCacheAt = Date.now();
  }
  return { list: data, pagination, slaSummary };
};

export const getCSIncomingTickets = async ({ limit = 50, page = 1, paginate = false, forceRefresh = false, ...filters } = {}) => {
  const hasFilters = Object.values(filters).some((v) => v !== undefined && v !== '' && v !== null);
  let result = { list: [], pagination: null, slaSummary: null };
  try {
    if (!hasFilters && !forceRefresh && incomingTicketsCache && (Date.now() - incomingTicketsCacheAt) < INCOMING_TICKETS_CACHE_TTL_MS) {
      result = incomingTicketsCache;
    } else if (!hasFilters && !forceRefresh && incomingTicketsInFlight) {
      result = await incomingTicketsInFlight;
    } else {
      const promise = fetchIncomingTickets({ limit, page, forceRefresh, ...filters }).finally(() => {
        if (!hasFilters) incomingTicketsInFlight = null;
      });
      if (!hasFilters) incomingTicketsInFlight = promise;
      result = await promise;
    }
  } catch (e) {
    console.warn("Failed to fetch incoming tickets from service:", e);
    throw e;
  }

  const rawList = Array.isArray(result) ? result : (result?.list ?? []);
  const pagination = Array.isArray(result) ? null : (result?.pagination ?? null);
  const slaSummary = Array.isArray(result) ? null : (result?.slaSummary ?? null);

  const list = [...rawList];
  if (slaSummary) {
    list.slaSummary = slaSummary;
  }

  if (paginate) {
    return { tickets: list, pagination, sla_summary: slaSummary };
  }
  return list;
};


export const clearIncomingTicketsCache = () => {
  incomingTicketsCache = null;
  incomingTicketsCacheAt = 0;
  incomingTicketsInFlight = null;
};

const getDeptKey = (dept) => dept || '_all_';

const fetchAssignableEmployees = async ({ department } = {}) => {
  const key = getDeptKey(department);
  const response = await axiosInstance.get('/employee-statuses', {
    params: department ? { department } : {},
  });
  const rawData = response.data?.employees ?? [];
  // Filter to operational departments and exclude superadmin and system administrators
  const excludedDepts = ['super admin', 'superadmin', 'admin'];
  const filtered = rawData.filter(emp => {
    const dept = (emp.department || '').trim().toLowerCase();
    if (excludedDepts.includes(dept)) return false;
    const nameLower = (emp.name || '').toLowerCase();
    const emailLower = (emp.email || '').toLowerCase();
    const roleLower = (emp.role || '').toLowerCase();
    const deptLower = (dept || '').toLowerCase();

    if (
      deptLower.includes('admin') ||
      roleLower.includes('admin') ||
      roleLower.includes('administrator') ||
      nameLower.includes('admin') ||
      nameLower.includes('administrator') ||
      emailLower.includes('admin')
    ) {
      return false;
    }
    return true;
  });
  employeesCache[key] = filtered;
  employeesCacheAt[key] = Date.now();
  return filtered;
};

export const getAssignableEmployees = async ({ department, forceRefresh = false } = {}) => {
  const key = getDeptKey(department);
  if (!forceRefresh && employeesCache[key] && (Date.now() - employeesCacheAt[key]) < EMPLOYEES_CACHE_TTL_MS) {
    return employeesCache[key];
  }

  if (!forceRefresh && employeesInFlight[key]) {
    return employeesInFlight[key];
  }

  const promise = fetchAssignableEmployees({ department }).finally(() => {
    delete employeesInFlight[key];
  });
  employeesInFlight[key] = promise;

  return promise;
};

export const clearAssignableEmployeesCache = () => {
  employeesCache = {};
  employeesCacheAt = {};
  employeesInFlight = {};
};

export const getEligibleEmployees = async (ticketId, { track } = {}) => {
  const normalizedId = typeof ticketId === 'object' ? (ticketId.ticket_ID || ticketId.id) : ticketId;
  const cleanId = Number(String(normalizedId || 0).replace(/\D/g, ''));
  const resolvedTrack = track || (typeof ticketId === 'object' ? (ticketId.track || ticketId.category) : undefined);
  const params = {};
  if (resolvedTrack) params.track = resolvedTrack;
  if (typeof ticketId === 'object' && ticketId.branch_id) params.branch_id = ticketId.branch_id;
  if (typeof ticketId === 'object' && ticketId.problem_category_ID) params.category_id = ticketId.problem_category_ID;

  let response;
  try {
    response = await employeeClient.get(`/tickets/${cleanId}/eligible-employees`, { params });
  } catch (err) {
    response = await ticketClient.get(`/tickets/${cleanId}/eligible-employees`, { params });
  }
  return response.data;
};

const fetchDepartments = async () => {
  let response;
  try {
    response = await employeeClient.get('/departments');
  } catch {
    response = await ticketClient.get('/departments');
  }
  const data = response.data?.departments ?? [];
  departmentsCache = data;
  departmentsCacheAt = Date.now();
  return data;
};

export const getDepartments = async ({ forceRefresh = false } = {}) => {
  if (!forceRefresh && departmentsCache && (Date.now() - departmentsCacheAt) < DEPARTMENTS_CACHE_TTL_MS) {
    return departmentsCache;
  }

  if (!forceRefresh && departmentsInFlight) {
    return departmentsInFlight;
  }

  departmentsInFlight = fetchDepartments().finally(() => {
    departmentsInFlight = null;
  });

  return departmentsInFlight;
};

export const clearDepartmentsCache = () => {
  departmentsCache = null;
  departmentsCacheAt = 0;
  departmentsInFlight = null;
};

export const assignTicketToEmployees = async ({ ticketId, employeeIds, assignedByEmail, priorityId } = {}) => {
  const normalizedId = ticketId || Number(String(ticketId || '').replace(/\D/g, ''));
  const payload = {
    employee_ids: employeeIds,
    assigned_by_email: assignedByEmail,
    priority_ID: priorityId,
  };
  let response;
  try {
    response = await employeeClient.post(`/tickets/${normalizedId}/assign`, payload);
  } catch (err) {
    response = await ticketClient.post(`/tickets/${normalizedId}/assign`, payload);
  }
  clearCSDashboardCache();
  notifyCsTicketRefresh();
  return response.data;
};

export const acceptTicket = async ({ ticketId, employeeIds, assignedByEmail, priorityId } = {}) => {
  const normalizedId = ticketId || Number(String(ticketId || '').replace(/\D/g, ''));
  const payload = {};
  if (employeeIds !== undefined && employeeIds !== null) payload.employee_ids = employeeIds;
  if (assignedByEmail !== undefined && assignedByEmail !== null) payload.assigned_by_email = assignedByEmail;
  if (priorityId !== undefined && priorityId !== null) payload.priority_ID = priorityId;

  let response;
  try {
    response = await employeeClient.patch(`/tickets/${normalizedId}/accept`, payload);
  } catch (err) {
    response = await ticketClient.patch(`/tickets/${normalizedId}/accept`, payload);
  }
  // The save changes the ticket row, assignment rows, and audit log entries.
  clearIncomingTicketsCache();
  clearCSDashboardCache();
  clearEmployeeTicketsCache();
  notifyCsTicketRefresh();
  return response.data;
};

export const updateTicket = async ({ ticketId, statusId, priorityId, assignedByEmail, proof_rejected, rejection_reason, title, description, machine_ID, problem_category_ID } = {}) => {
  const payload = {};
  if (statusId !== undefined) payload.ticket_status_ID = statusId;
  if (priorityId !== undefined) payload.priority_ID = priorityId;
  if (assignedByEmail !== undefined) payload.assigned_by_email = assignedByEmail;
  if (proof_rejected !== undefined) payload.proof_rejected = proof_rejected;
  if (rejection_reason !== undefined) payload.rejection_reason = rejection_reason;
  if (title !== undefined) payload.title = title;
  if (description !== undefined) payload.description = description;
  if (machine_ID !== undefined) payload.machine_ID = machine_ID;
  if (problem_category_ID !== undefined) payload.problem_category_ID = problem_category_ID;

  const response = await ticketClient.patch(`/tickets/${ticketId}`, payload);
  // Clear caches since ticket updates affect customer and CS dashboards
  clearCustomerDashboardCache();
  clearIncomingTicketsCache();
  clearCSDashboardCache();
  clearEmployeeTicketsCache();
  notifyCsTicketRefresh();
  return response.data;
};

export const reopenTicket = async (ticketId, reason) => {
  const numericId = Number(String(ticketId).replace(/\D/g, ''));
  const response = await ticketClient.post(`/tickets/${numericId}/reopen`, {
    reason: String(reason || '').trim(),
  });
  // Clear caches since ticket updates affect customer and CS dashboards
  clearCustomerDashboardCache();
  clearIncomingTicketsCache();
  clearCSDashboardCache();
  clearEmployeeTicketsCache();
  notifyCsTicketRefresh();
  return response.data;
};

export const holdTicket = async (ticketId, reason) => {
  const numericId = Number(String(ticketId).replace(/\D/g, ''));
  const response = await ticketClient.post(`/tickets/${numericId}/hold`, {
    reason: String(reason || '').trim(),
  });
  clearCustomerDashboardCache();
  clearIncomingTicketsCache();
  clearCSDashboardCache();
  clearEmployeeTicketsCache();
  notifyCsTicketRefresh();
  return response.data;
};

export const resumeTicket = async (ticketId) => {
  const numericId = Number(String(ticketId).replace(/\D/g, ''));
  const response = await ticketClient.post(`/tickets/${numericId}/resume`);
  clearCustomerDashboardCache();
  clearIncomingTicketsCache();
  clearCSDashboardCache();
  clearEmployeeTicketsCache();
  notifyCsTicketRefresh();
  return response.data;
};

export const reclassifyTicket = async ({ ticketId, problem_category_ID, priority_ID }) => {
  const numericId = Number(String(ticketId).replace(/\D/g, ''));
  const payload = {};
  if (problem_category_ID !== undefined && problem_category_ID !== null) {
    payload.problem_category_ID = Number(problem_category_ID);
  }
  if (priority_ID !== undefined && priority_ID !== null) {
    payload.priority_ID = Number(priority_ID);
  }
  const response = await ticketClient.patch(`/tickets/${numericId}/classification`, payload);
  clearCustomerDashboardCache();
  clearIncomingTicketsCache();
  clearCSDashboardCache();
  clearEmployeeTicketsCache();
  notifyCsTicketRefresh();
  return response.data;
};

const fetchEmployeeAssignedTickets = async ({ employeeEmail }) => {
  try {
    const response = await ticketClient.get('/employee-tickets', {
      params: {
        employee_email: employeeEmail,
      },
    });
    const tickets = response.data?.tickets ?? [];

    const overrides = getEmployeeOverrides();
    return tickets.map((t) => {
      const { status: _overrideStatus, ...overrideFields } = overrides[t.id] || {};

      return {
        ...t,
        ...overrideFields,
      };
    });
  } catch (error) {
    console.warn('Failed to fetch assigned tickets from ticket-service:', error);
    throw error;
  }
};

export const getEmployeeAssignedTickets = async ({ employeeEmail, forceRefresh = false } = {}) => {
  const emailKey = employeeEmail || 'default';

  if (forceRefresh) {
    delete employeeTicketsCache[emailKey];
    delete employeeTicketsCacheAt[emailKey];
    delete employeeTicketsInFlight[emailKey];
  }

  if (!forceRefresh && employeeTicketsCache[emailKey] && (Date.now() - employeeTicketsCacheAt[emailKey]) < EMPLOYEE_TICKETS_CACHE_TTL_MS) {
    return employeeTicketsCache[emailKey];
  }

  if (!forceRefresh && employeeTicketsInFlight[emailKey]) {
    return employeeTicketsInFlight[emailKey];
  }

  employeeTicketsInFlight[emailKey] = fetchEmployeeAssignedTickets({ employeeEmail }).then((data) => {
    employeeTicketsCache[emailKey] = data;
    employeeTicketsCacheAt[emailKey] = Date.now();
    return data;
  }).finally(() => {
    employeeTicketsInFlight[emailKey] = null;
  });

  return employeeTicketsInFlight[emailKey];
};

export const getCSDashboard = async ({ limit = 10, forceRefresh = false } = {}) => {
  if (!forceRefresh && csDashboardCache && (Date.now() - csDashboardCacheAt) < CS_DASHBOARD_CACHE_TTL_MS) {
    return csDashboardCache;
  }

  if (!forceRefresh && csDashboardInFlight) {
    return csDashboardInFlight;
  }

  csDashboardInFlight = fetchCSDashboard({ limit }).finally(() => {
    csDashboardInFlight = null;
  });

  return csDashboardInFlight;
};

export const clearCSDashboardCache = () => {
  csDashboardCache = null;
  csDashboardCacheAt = 0;
  csDashboardInFlight = null;
};

export const createTicket = async (payload) => {
  const processedPayload = await processPayloadAndUpload(payload, false);
  const response = await ticketClient.post('/tickets', processedPayload);
  clearCustomerDashboardCache();
  clearCSDashboardCache();
  notifyCsTicketRefresh();
  if (response.data?.dashboard_ticket) {
    saveCustomerTicketDetail({
      ...response.data.dashboard_ticket,
      ticket_ID: response.data.ticket?.ticket_ID,
      description: response.data.ticket?.description,
      date_created: response.data.ticket?.created_at,
      last_updated: response.data.ticket?.updated_at,
    });
  }
  return response.data;
};

export const createInternalTicket = async (payload) => {
  const processedPayload = await processPayloadAndUpload(payload, false);
  const response = await ticketClient.post('/tickets/internal', processedPayload);
  clearIncomingTicketsCache();
  clearCSDashboardCache();
  clearEmployeeTicketsCache();
  notifyCsTicketRefresh();
  return response.data;
};
/**
 * Fetch all internal tickets created by the logged-in employee from the backend.
 * Route: GET /employee/tickets/internal  (auth.subsystem required)
 */
export const getEmployeeInternalTickets = async () => {
  const response = await ticketClient.get('/employee/tickets/internal');
  return response.data; // { tickets: [...] }
};

// Local Storage Helper functions for Employee Actions
const EMPLOYEE_OVERRIDE_KEY = 'employee_ticket_overrides_v1';

export const getEmployeeOverrides = () => {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(EMPLOYEE_OVERRIDE_KEY) || '{}');
  } catch {
    return {};
  }
};

export const updateEmployeeTicketOverride = (ticketId, override) => {
  if (typeof window === 'undefined') return;
  try {
    const all = getEmployeeOverrides();
    const existing = all[ticketId] || {};

    // Merge internal notes
    let mergedNotes = existing.internalNotes || [];
    if (override.internalNotes) {
      mergedNotes = [...mergedNotes, ...override.internalNotes];
    }

    // Merge timeline
    let mergedTimeline = existing.timeline || [];
    if (override.timeline) {
      mergedTimeline = [...mergedTimeline, ...override.timeline];
    }

    all[ticketId] = {
      ...existing,
      ...override,
      internalNotes: mergedNotes,
      timeline: mergedTimeline,
    };

    window.localStorage.setItem(EMPLOYEE_OVERRIDE_KEY, JSON.stringify(all));
    notifyCsTicketRefresh();
  } catch (err) {
    console.error('Failed to update employee override:', err);
  }
};

export const cleanupCorruptedOverrides = () => {
  if (typeof window === 'undefined') return;
  try {
    const all = getEmployeeOverrides();
    let modified = false;
    Object.keys(all).forEach((key) => {
      if (all[key] && (all[key].reassignmentRequested !== undefined || all[key].reassignmentStatus !== undefined)) {
        delete all[key].reassignmentRequested;
        delete all[key].reassignmentStatus;
        delete all[key].reassignmentDenyReason;
        delete all[key].reassignmentReason;
        modified = true;
      }
    });
    if (modified) {
      window.localStorage.setItem(EMPLOYEE_OVERRIDE_KEY, JSON.stringify(all));
    }
  } catch {
    // Ignore
  }
};
cleanupCorruptedOverrides();

export const requestReassignment = async ({ ticketId, reason }) => {
  const response = await ticketClient.post(`/tickets/${ticketId}/reassign-request`, {
    reason,
  });

  try {
    const all = getEmployeeOverrides();
    const numericId = Number(ticketId);
    const keys = [
      `TKT-${String(numericId).padStart(4, '0')}`,
      `TKT-${String(numericId).padStart(5, '0')}`,
      String(numericId),
      Number(ticketId),
      ...(response.data?.ticket?.id ? [response.data.ticket.id] : []),
    ];
    Object.keys(all).forEach((k) => {
      const matchNum = Number(String(k).replace(/\D/g, ''));
      if (matchNum === numericId && !keys.includes(k)) {
        keys.push(k);
      }
    });

    keys.forEach((k) => {
      if (all[k]) {
        delete all[k].deniedReassignment;
        delete all[k].reassignmentDenied;
        delete all[k].disapprovalReason;
        delete all[k].reassignmentDenyReason;
        all[k].reassignmentRequested = true;
        all[k].reassignmentStatus = 'Pending';
        all[k].reassignmentReason = reason;
        all[k].status = 'Pending Reassignment';
      }
    });
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(EMPLOYEE_OVERRIDE_KEY, JSON.stringify(all));
    }
  } catch {
    // Ignore storage errors
  }

  clearEmployeeTicketsCache();
  clearIncomingTicketsCache();
  clearCSDashboardCache();
  notifyCsTicketRefresh();
  return response.data;
};

export const respondReassignment = async ({ ticketId, action, newEmployeeId, reason }) => {
  const body = { action };
  if (newEmployeeId !== undefined) body.new_employee_id = newEmployeeId;
  if (reason !== undefined) body.reason = reason;
  const response = await ticketClient.post(`/tickets/${ticketId}/reassign-respond`, body);

  try {
    const all = getEmployeeOverrides();
    const numericId = Number(ticketId);
    const keys = [
      `TKT-${String(numericId).padStart(4, '0')}`,
      `TKT-${String(numericId).padStart(5, '0')}`,
      String(numericId),
      Number(ticketId),
    ];
    Object.keys(all).forEach((k) => {
      const matchNum = Number(String(k).replace(/\D/g, ''));
      if (matchNum === numericId && !keys.includes(k)) {
        keys.push(k);
      }
    });

    keys.forEach((k) => {
      if (all[k]) {
        delete all[k].reassignmentRequested;
        delete all[k].reassignmentStatus;
        delete all[k].reassignmentReason;
        delete all[k].reassignmentDenyReason;
      }
    });
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(EMPLOYEE_OVERRIDE_KEY, JSON.stringify(all));
    }
  } catch {
    // Ignore storage errors
  }

  clearEmployeeTicketsCache();
  clearIncomingTicketsCache();
  clearCSDashboardCache();
  notifyCsTicketRefresh();
  return response.data;
};

export const getReassignmentRequests = async (params = {}) => {
  const response = await ticketClient.get('/reassignment-requests', {
    params,
  });
  return response.data?.requests ?? [];
};

const ticketDetailsCache = {};
const ticketDetailsCacheAt = {};
const ticketDetailsInFlight = {};
const TICKET_DETAILS_CACHE_TTL_MS = 30000;

export const clearTicketDetailsCache = (ticketId) => {
  if (ticketId) {
    const key = String(ticketId);
    delete ticketDetailsCache[key];
    delete ticketDetailsCacheAt[key];
    delete ticketDetailsInFlight[key];
  } else {
    Object.keys(ticketDetailsCache).forEach((k) => delete ticketDetailsCache[k]);
    Object.keys(ticketDetailsCacheAt).forEach((k) => delete ticketDetailsCacheAt[k]);
    Object.keys(ticketDetailsInFlight).forEach((k) => delete ticketDetailsInFlight[k]);
  }
};

export const getTicketDetails = async (ticketId, { forceRefresh = false } = {}) => {
  const key = String(ticketId);
  if (forceRefresh) {
    clearTicketDetailsCache(key);
  }

  if (!forceRefresh && ticketDetailsCache[key] && (Date.now() - (ticketDetailsCacheAt[key] || 0)) < TICKET_DETAILS_CACHE_TTL_MS) {
    return ticketDetailsCache[key];
  }

  if (!forceRefresh && ticketDetailsInFlight[key]) {
    return ticketDetailsInFlight[key];
  }

  ticketDetailsInFlight[key] = ticketClient.get(`/tickets/${ticketId}`)
    .then((response) => {
      ticketDetailsCache[key] = response.data;
      ticketDetailsCacheAt[key] = Date.now();
      return response.data;
    })
    .finally(() => {
      delete ticketDetailsInFlight[key];
    });

  return ticketDetailsInFlight[key];
};

export const getCustomerTicketContext = async (ticketId) => {
  const response = await ticketClient.get(`/tickets/${ticketId}/customer-context`);
  return response.data;
};

export const updateEmployeeTicket = async (ticketId, formData) => {
  const isProof = formData instanceof FormData
    ? formData.get('is_proof') === 'true'
    : Boolean(formData?.is_proof);

  const processedPayload = await processPayloadAndUpload(formData, isProof);
  let response;
  try {
    response = await employeeClient.post(`/tickets/${ticketId}/employee-update`, processedPayload);
  } catch (err) {
    response = await ticketClient.post(`/tickets/${ticketId}/employee-update`, processedPayload);
  }
  clearEmployeeTicketsCache();
  clearIncomingTicketsCache();
  clearCSDashboardCache();
  notifyCsTicketRefresh();
  return response.data;
};



export const getInternalTickets = async () => {
  const response = await ticketClient.get('/employee/tickets/internal');
  return response.data?.tickets ?? [];
};

export const getEmployeeProfile = async () => {
  const response = await ticketClient.get('/employee/profile');
  return response.data;
};

export const getWorklogs = async (params = {}) => {
  try {
    const response = await employeeClient.get('/employee/worklogs', { params });
    return response.data;
  } catch (err) {
    const response = await ticketClient.get('/employee/worklogs', { params });
    return response.data;
  }
};

export const saveWorkLog = async (payload) => {
  try {
    const response = await employeeClient.post('/employee/worklogs', payload);
    return response.data;
  } catch (err) {
    const response = await ticketClient.post('/employee/worklogs', payload);
    return response.data;
  }
};

export const getNotifications = async () => {
  const response = await ticketClient.get('/notifications');
  return response.data;
};

export const markNotificationsRead = async () => {
  const response = await ticketClient.patch('/notifications/read-all');
  return response.data;
};

export const markNotificationRead = async (id) => {
  const response = await ticketClient.patch(`/notifications/${id}/read`);
  return response.data;
};

export const getSuperAdminConfig = async () => {
  const response = await ticketClient.get('/superadmin/config');
  return response.data;
};

export const getTicketLimitConfig = async () => {
  const response = await ticketClient.get('/superadmin/ticket-limit');
  return response.data?.value || response.data;
};

export const updateTicketLimitConfig = async (payload) => {
  const response = await ticketClient.put('/superadmin/ticket-limit', payload);
  return response.data?.value || response.data;
};

export const resetTicketLimitConfig = async () => {
  const response = await ticketClient.post('/superadmin/ticket-limit/reset');
  return response.data?.value || response.data;
};

export const getTicketNumberFormatConfig = async () => {
  const response = await ticketClient.get('/superadmin/number-format');
  return response.data?.value || response.data;
};

export const updateTicketNumberFormatConfig = async (payload) => {
  const response = await ticketClient.put('/superadmin/number-format', payload);
  return response.data?.value || response.data;
};

export const resetTicketNumberFormatConfig = async () => {
  const response = await ticketClient.post('/superadmin/number-format/reset');
  return response.data?.value || response.data;
};

export const createSuperAdminEquipment = async (payload) => {
  const response = await ticketClient.post('/superadmin/equipment', payload);
  return response.data;
};

export const updateSuperAdminEquipment = async (id, payload) => {
  const response = await ticketClient.put(`/superadmin/equipment/${id}`, payload);
  return response.data;
};

export const deleteSuperAdminEquipment = async (id) => {
  const response = await ticketClient.delete(`/superadmin/equipment/${id}`);
  return response.data;
};

export const createSuperAdminTicketCategory = async (payload) => {
  const response = await ticketClient.post('/superadmin/ticket-categories', payload);
  return response.data;
};

export const updateSuperAdminTicketCategory = async (id, payload) => {
  const response = await ticketClient.put(`/superadmin/ticket-categories/${id}`, payload);
  return response.data;
};

export const deleteSuperAdminTicketCategory = async (id) => {
  const response = await ticketClient.delete(`/superadmin/ticket-categories/${id}`);
  return response.data;
};

export const createSuperAdminPriority = async (payload) => {
  const response = await ticketClient.post('/superadmin/priority', payload);
  return response.data;
};

export const updateSuperAdminPriority = async (id, payload) => {
  const response = await ticketClient.put(`/superadmin/priority/${id}`, payload);
  return response.data;
};

export const deleteSuperAdminPriority = async (id) => {
  const response = await ticketClient.delete(`/superadmin/priority/${id}`);
  return response.data;
};

export const getSuperAdminAuditLogs = async () => {
  const response = await ticketClient.get('/superadmin/audit-logs');
  return response.data;
};

export const getAuditLogRetentionConfig = async () => {
  const response = await ticketClient.get('/superadmin/audit-logs/retention');
  return response.data;
};

export const updateAuditLogRetentionConfig = async (retentionDays) => {
  const response = await ticketClient.post('/superadmin/audit-logs/retention', { retention_days: retentionDays });
  return response.data;
};

export const purgeAuditLogs = async (retentionDays) => {
  const response = await ticketClient.post('/superadmin/audit-logs/purge', { retention_days: retentionDays });
  return response.data;
};

export const getSuperAdminHistory = async () => {
  const response = await ticketClient.get('/superadmin/history');
  return response.data;
};

export const getSLARules = async (params = {}) => {
  const response = await ticketClient.get('/superadmin/sla-rules', { params });
  return response.data;
};

export const createSLARule = async (payload) => {
  const response = await ticketClient.post('/superadmin/sla-rules', payload);
  return response.data;
};

export const updateSLARule = async (id, payload) => {
  const response = await ticketClient.put(`/superadmin/sla-rules/${id}`, payload);
  return response.data;
};

export const deleteSLARule = async (id) => {
  const response = await ticketClient.delete(`/superadmin/sla-rules/${id}`);
  return response.data;
};

export const saveDepartmentSLARules = async (departmentId, rules) => {
  const response = await ticketClient.post(`/superadmin/sla-rules/department/${departmentId}`, { rules });
  return response.data;
};

// Workflow Statuses
export const getWorkflowStatuses = async () => {
  const response = await ticketClient.get('/superadmin/workflow-statuses');
  return response.data;
};

export const createWorkflowStatus = async (payload) => {
  const response = await ticketClient.post('/superadmin/workflow-statuses', payload);
  return response.data;
};

export const updateWorkflowStatus = async (id, payload) => {
  const response = await ticketClient.put(`/superadmin/workflow-statuses/${id}`, payload);
  return response.data;
};

export const deleteWorkflowStatus = async (id) => {
  const response = await ticketClient.delete(`/superadmin/workflow-statuses/${id}`);
  return response.data;
};

export const resetWorkflowStatuses = async () => {
  const response = await ticketClient.post('/superadmin/workflow-statuses/reset-defaults');
  return response.data;
};

// Escalation Rules
export const getEscalationRules = async () => {
  const response = await ticketClient.get('/superadmin/escalation-rules');
  return response.data;
};

export const createEscalationRule = async (payload) => {
  const response = await ticketClient.post('/superadmin/escalation-rules', payload);
  return response.data;
};

export const updateEscalationRule = async (id, payload) => {
  const response = await ticketClient.put(`/superadmin/escalation-rules/${id}`, payload);
  return response.data;
};

export const toggleEscalationRule = async (id) => {
  const response = await ticketClient.patch(`/superadmin/escalation-rules/${id}/toggle`);
  return response.data;
};

export const deleteEscalationRule = async (id) => {
  const response = await ticketClient.delete(`/superadmin/escalation-rules/${id}`);
  return response.data;
};

export const getWindowConfig = async () => {
  const response = await ticketClient.get('/superadmin/window-config');
  return response.data?.value || response.data;
};

export const updateWindowConfig = async (payload) => {
  const response = await ticketClient.put('/superadmin/window-config', payload);
  return response.data?.value || response.data;
};

export const getTicketDefaultsConfig = async () => {
  const response = await ticketClient.get('/superadmin/ticket-defaults');
  return response.data?.value || response.data;
};

export const updateTicketDefaultsConfig = async (payload) => {
  const response = await ticketClient.put('/superadmin/ticket-defaults', payload);
  return response.data?.value || response.data;
};

export const resetTicketDefaultsConfig = async () => {
  const response = await ticketClient.post('/superadmin/ticket-defaults/reset');
  return response.data?.value || response.data;
};

// Branch listing & sync
export const getBranches = async () => {
  const response = await ticketClient.get('/superadmin/branches');
  return response.data?.branches || response.data || [];
};

export const getPublicBranches = async () => {
  const response = await ticketClient.get('/branches');
  return response.data?.branches || response.data || [];
};

// Branch-specific priority levels & SLA overrides (scoped to a branch slug)
const branchPriorityPath = (branchId) => `/superadmin/branches/${encodeURIComponent(branchId)}/priorities`;

export const getBranchPriorities = async (branchId) => {
  const response = await ticketClient.get(branchPriorityPath(branchId));
  return response.data;
};

export const createBranchPriority = async (branchId, payload) => {
  const response = await ticketClient.post(branchPriorityPath(branchId), payload);
  return response.data;
};

export const updateBranchPriority = async (branchId, id, payload) => {
  const response = await ticketClient.put(`${branchPriorityPath(branchId)}/${encodeURIComponent(id)}`, payload);
  return response.data;
};

export const deleteBranchPriority = async (branchId, id) => {
  const response = await ticketClient.delete(`${branchPriorityPath(branchId)}/${encodeURIComponent(id)}`);
  return response.data;
};

// Branch-specific categories & SLA policies
const branchCategoryPath = (branchId) => `/superadmin/branches/${encodeURIComponent(branchId)}/categories`;
const branchSlaPolicyPath = (branchId) => `/superadmin/branches/${encodeURIComponent(branchId)}/sla-policies`;

export const getBranchCategoriesAndSla = async (branchId) => {
  const response = await ticketClient.get(branchCategoryPath(branchId));
  return response.data;
};

export const createBranchCategory = async (branchId, payload) => {
  const response = await ticketClient.post(branchCategoryPath(branchId), payload);
  return response.data;
};

export const updateBranchCategory = async (branchId, id, payload) => {
  const response = await ticketClient.put(`${branchCategoryPath(branchId)}/${encodeURIComponent(id)}`, payload);
  return response.data;
};

export const deleteBranchCategory = async (branchId, id) => {
  const response = await ticketClient.delete(`${branchCategoryPath(branchId)}/${encodeURIComponent(id)}`);
  return response.data;
};

export const resetBranchCategoriesToDefaults = async (branchId) => {
  const response = await ticketClient.post(`${branchCategoryPath(branchId)}/reset`);
  return response.data;
};

export const saveBranchSlaPolicy = async (branchId, payload) => {
  const response = await ticketClient.post(branchSlaPolicyPath(branchId), payload);
  return response.data;
};

export const deleteBranchSlaPolicy = async (branchId, payload) => {
  const response = await ticketClient.delete(branchSlaPolicyPath(branchId), { data: payload });
  return response.data;
};

// Escalation Handoff (TS027)
export const getEscalateHandoff = async (conversationId) => {
  const response = await ticketClient.get(`/tickets/escalate-handoff/${conversationId}`);
  return response.data;
};

// Internal Notes (TS028)
export const getInternalNotes = async (ticketId) => {
  const response = await ticketClient.get(`/tickets/${ticketId}/internal-notes`);
  return response.data?.notes ?? response.data?.data ?? [];
};

export const addInternalNote = async (ticketId, note) => {
  const response = await ticketClient.post(`/tickets/${ticketId}/internal-notes`, { note });
  return response.data;
};

// Employee Profile Update (TS105)
export const updateEmployeeProfile = async (payload) => {
  const response = await ticketClient.put('/employee/profile', payload);
  return response.data;
};

// Employee Directory & Search (TS107)
export const searchEmployees = async (params = {}) => {
  const response = await ticketClient.get('/employees/search', { params });
  return response.data;
};

export const getEmployeeFilterOptions = async () => {
  const response = await ticketClient.get('/employees/filter-options');
  return response.data;
};

// Ticket SLA Reminder (TS-REMINDER)
export const sendTicketReminder = async (ticketId, customMessage = '') => {
  const numericId = typeof ticketId === 'number' ? ticketId : Number(String(ticketId).replace(/\D/g, ''));
  const response = await ticketClient.post(`/tickets/${numericId}/reminders`, {
    custom_message: customMessage,
    message: customMessage,
  });
  return response.data;
};

// Customer Feedback Lifecycle (TS-FEEDBACK)
export const getTicketFeedback = async (ticketId) => {
  const response = await axiosInstance.get(`/api/ticketing/analytics/feedback/ticket/${ticketId}`);
  return response.data?.feedback ?? response.data?.data ?? response.data;
};

export const submitTicketFeedback = async (ticketId, feedbackPayload) => {
  const response = await axiosInstance.post('/api/ticketing/analytics/feedback', {
    ticket_id: String(ticketId),
    customer_id: feedbackPayload.customerId ? String(feedbackPayload.customerId) : null,
    rating: feedbackPayload.rating,
    comment: feedbackPayload.comment || '',
    ratings: feedbackPayload.ratings || {},
    comments: feedbackPayload.comments || {},
    overall_comment: feedbackPayload.overallComment || feedbackPayload.comment || '',
    question_answers: feedbackPayload.questionAnswers || {},
    category_questions_snapshot: feedbackPayload.categoryQuestionsSnapshot || [],
  });
  return response.data;
};

export const updateTicketFeedback = async (ticketId, feedbackPayload) => {
  const response = await axiosInstance.put(`/api/ticketing/analytics/feedback/ticket/${ticketId}`, {
    rating: feedbackPayload.rating,
    comment: feedbackPayload.comment || '',
    ratings: feedbackPayload.ratings || {},
    comments: feedbackPayload.comments || {},
    overall_comment: feedbackPayload.overallComment || feedbackPayload.comment || '',
    question_answers: feedbackPayload.questionAnswers || {},
    category_questions_snapshot: feedbackPayload.categoryQuestionsSnapshot || [],
  });
  return response.data;
};

export const deleteTicketFeedback = async (ticketId) => {
  const response = await axiosInstance.delete(`/api/ticketing/analytics/feedback/ticket/${ticketId}`);
  return response.data;
};

export const getSecurityIncidents = async (params = {}) => {
  const response = await ticketClient.get('/superadmin/security-incidents', { params });
  return response.data;
};

export const getSecurityIncidentDetail = async (incidentId) => {
  const response = await ticketClient.get(`/superadmin/security-incidents/${encodeURIComponent(incidentId)}`);
  return response.data;
};



export const classifyDepartment = async (title, description) => {
  try {
    const response = await axiosInstance.post(`${AI_API_URL || '/api/ticketing/ai'}/classify-department`, {
      title,
      description,
    });
    return response.data?.data || response.data;
  } catch (err) {
    console.warn('AI classification request error, falling back to local heuristic:', err);
    const text = `${title} ${description}`.toLowerCase();
    const isSoftware = /(software|app|login|password|account|portal|bug|glitch|crash|freeze|network|wifi|database|timeout|license)/i.test(text);
    return {
      department: isSoftware ? 'IT' : 'Service',
      department_id: isSoftware ? 2 : 1,
      is_software: isSoftware,
      requires_equipment: !isSoftware,
      confidence: 0.8,
      reasoning: isSoftware
        ? 'Your problem description indicates a software or account issue. Physical equipment is optional.'
        : 'Your problem description indicates physical machinery or hardware maintenance. Equipment selection is required.',
      source: 'client-fallback'
    };
  }
};
