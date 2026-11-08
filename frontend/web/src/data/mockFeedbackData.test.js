import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import tokenStore from '@/auth/tokenStore';
import { saveFeedback, updateFeedback, deleteFeedback, fetchFeedbackForTicket } from './mockFeedbackData';

/**
 * Spec 0034 (AC-4, AC-11): the analytics service identifies the caller from the verified token only.
 * These helpers must send the bearer token and must never send a customer id in the body.
 */
const okResponse = (body = { status: 'success', data: null }) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

const callTo = (method, urlPart) =>
  global.fetch.mock.calls.find(([url, init]) => String(url).includes(urlPart) && (init?.method || 'GET') === method);

describe('feedback requests to the analytics service (spec 0034)', () => {
  beforeEach(() => {
    localStorage.clear();
    tokenStore.setToken('access-token-123');
    global.fetch = vi.fn(async () => okResponse());
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    tokenStore.clearToken();
    vi.restoreAllMocks();
  });

  it('sends the bearer token when a customer submits feedback', async () => {
    await saveFeedback('5001', { 501: 5 }, { 501: 'Great' }, 'Thanks');

    const [, init] = callTo('POST', '/api/ticketing/analytics/feedback');
    expect(init.headers.Authorization).toBe('Bearer access-token-123');
  });

  it('never puts a customer id in the submitted body, even when a caller passes one', async () => {
    await saveFeedback('5001', { 501: 5 }, {}, '', 9002);

    const [, init] = callTo('POST', '/api/ticketing/analytics/feedback');
    const body = JSON.parse(init.body);
    expect(body).not.toHaveProperty('customer_id');
    expect(body.ticket_id).toBe('5001');
    expect(body.ratings).toEqual({ 501: 5 });
  });

  it('sends the bearer token when feedback is edited', async () => {
    await updateFeedback('5001', { 501: 4 }, {}, 'Better');

    const [, init] = callTo('PUT', '/api/ticketing/analytics/feedback/ticket/5001');
    expect(init.headers.Authorization).toBe('Bearer access-token-123');
    expect(JSON.parse(init.body)).not.toHaveProperty('customer_id');
  });

  it('sends the bearer token when feedback is deleted', async () => {
    await deleteFeedback('5001');

    const [, init] = callTo('DELETE', '/api/ticketing/analytics/feedback/ticket/5001');
    expect(init.headers.Authorization).toBe('Bearer access-token-123');
  });

  it('sends the bearer token when reading feedback, including the retry with the alternate ticket id', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ data: null }) })
      .mockResolvedValueOnce(okResponse({ status: 'success', data: null }));

    await fetchFeedbackForTicket('101');

    expect(global.fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of global.fetch.mock.calls) {
      expect(init.headers.Authorization).toBe('Bearer access-token-123');
    }
    expect(String(global.fetch.mock.calls[1][0])).toContain('TKTS-00101');
  });

  it('sends no Authorization header when nobody is signed in, instead of a broken "Bearer null"', async () => {
    tokenStore.clearToken();

    await deleteFeedback('5001');

    const [, init] = callTo('DELETE', '/api/ticketing/analytics/feedback/ticket/5001');
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('keeps the saved local copy even when the analytics request is refused', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ message: 'Unauthenticated.' }) }));

    await saveFeedback('5001', { 501: 5 }, {}, 'Still saved locally');

    const stored = JSON.parse(localStorage.getItem('customer_feedback'));
    expect(stored['5001'].overallComment).toBe('Still saved locally');
  });
});
