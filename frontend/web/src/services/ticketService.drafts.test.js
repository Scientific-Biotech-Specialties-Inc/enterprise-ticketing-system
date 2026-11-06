import { describe, it, expect, vi, beforeEach } from 'vitest';

const { instance } = vi.hoisted(() => ({
  instance: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    defaults: { headers: { common: {} } },
  },
}));

vi.mock('axios', () => ({
  default: { create: vi.fn(() => instance), isAxiosError: vi.fn(() => false) },
}));

vi.mock('@/config/api.config', async (importOriginal) => ({
  ...(await importOriginal()),
  TICKET_API_URL: '/api/ticketing/ticket',
  EMPLOYEE_API_URL: '/api/ticketing/employee',
}));

vi.mock('@/auth/tokenStore', () => ({
  default: { getToken: vi.fn(() => 'token-abc'), clearToken: vi.fn(), setToken: vi.fn() },
}));

vi.mock('@/auth/refreshSession', () => ({
  refreshAccessToken: vi.fn(() => Promise.resolve(true)),
}));

import { saveTicketDraft, getTicketDrafts, getTicketDraft, deleteTicketDraft } from './ticketService';

// The request interceptors register themselves when the module loads. Keep them before any mock reset.
const requestInterceptors = instance.interceptors.request.use.mock.calls.map(([fn]) => fn);

/**
 * Spec 0034 (AC-1, AC-2, AC-11): drafts belong to the verified customer, so the frontend sends
 * the token and nothing that names a customer.
 */
describe('ticketService request identity (spec 0034)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('registers request interceptors that add the bearer token', () => {
    expect(requestInterceptors.length).toBeGreaterThan(0);

    const withAuth = requestInterceptors
      .map((fn) => fn({ headers: {} }))
      .filter((config) => config.headers.Authorization === 'Bearer token-abc');

    expect(withAuth.length).toBeGreaterThan(0);
  });

  it('never sends X-Client-Id or X-User-Id, even when a customer is stored in the browser', () => {
    sessionStorage.setItem('user', JSON.stringify({ id: 42, client_ID: 42, role: 'customer' }));
    localStorage.setItem('user', JSON.stringify({ id: 42, client_ID: 42, role: 'customer' }));

    for (const fn of requestInterceptors) {
      const { headers } = fn({ headers: {} });
      const names = Object.keys(headers).map((h) => h.toLowerCase());
      expect(names).not.toContain('x-client-id');
      expect(names).not.toContain('x-user-id');
      expect(names).not.toContain('x-user-role');
    }
  });
});

describe('ticket draft calls (spec 0034)', () => {
  beforeEach(() => {
    instance.get.mockReset();
    instance.post.mockReset();
    instance.delete.mockReset();
    sessionStorage.clear();
    sessionStorage.setItem('user', JSON.stringify({ id: 42, client_ID: 42, role: 'customer' }));
  });

  it('saves a draft without naming a customer, whatever the caller passes in', async () => {
    instance.post.mockResolvedValueOnce({ data: { success: true, draft: { id: 9 } } });

    const result = await saveTicketDraft({
      title: 'Printer down',
      description: 'Paper jam',
      client_id: 99,
      client_ID: 99,
      created_by: 99,
      priority_ID: 2,
    });

    expect(result.draft.id).toBe(9);
    const [url, payload] = instance.post.mock.calls[0];
    expect(url).toBe('/tickets/draft');
    expect(payload).not.toHaveProperty('client_id');
    expect(payload).not.toHaveProperty('client_ID');
    expect(payload).not.toHaveProperty('created_by');
    expect(payload).toMatchObject({ title: 'Printer down', description: 'Paper jam', priority_ID: 2, attachments: [] });
  });

  it('keeps the draft id when an existing draft is saved again', async () => {
    instance.post.mockResolvedValueOnce({ data: { success: true } });

    await saveTicketDraft({ id: 7, title: 'Edit' });

    expect(instance.post.mock.calls[0][1].draft_id).toBe(7);
  });

  it('lists drafts with no customer filter', async () => {
    instance.get.mockResolvedValueOnce({ data: { drafts: [{ id: 1 }, { id: 2 }], total: 2 } });

    const drafts = await getTicketDrafts({ client_id: 99 });

    expect(drafts).toHaveLength(2);
    expect(instance.get).toHaveBeenCalledWith('/tickets/drafts');
  });

  it('returns an empty list when the session is not signed in (401)', async () => {
    instance.get.mockRejectedValueOnce({ response: { status: 401 } });

    await expect(getTicketDrafts()).resolves.toEqual([]);
  });

  it('rethrows other errors when listing drafts so the page can show them', async () => {
    instance.get.mockRejectedValueOnce({ response: { status: 500 } });

    await expect(getTicketDrafts()).rejects.toMatchObject({ response: { status: 500 } });
  });

  it('reads and deletes one draft by id only', async () => {
    instance.get.mockResolvedValueOnce({ data: { draft: { id: 7, title: 'x' } } });
    instance.delete.mockResolvedValueOnce({ data: { message: 'Draft deleted successfully.' } });

    const draft = await getTicketDraft(7, { client_id: 99 });
    const deleted = await deleteTicketDraft(7, { client_id: 99 });

    expect(draft).toEqual({ id: 7, title: 'x' });
    expect(deleted.message).toBe('Draft deleted successfully.');
    expect(instance.get).toHaveBeenCalledWith('/tickets/drafts/7');
    expect(instance.delete).toHaveBeenCalledWith('/tickets/drafts/7');
  });

  it('surfaces a 404 for someone else\'s draft instead of hiding it', async () => {
    instance.get.mockRejectedValueOnce({ response: { status: 404 } });

    await expect(getTicketDraft(123)).rejects.toMatchObject({ response: { status: 404 } });
  });
});
