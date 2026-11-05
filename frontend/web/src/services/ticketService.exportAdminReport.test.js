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
  default: { getToken: vi.fn(() => 'token'), clearToken: vi.fn(), setToken: vi.fn() },
}));

vi.mock('@/auth/refreshSession', () => ({
  refreshAccessToken: vi.fn(() => Promise.resolve(true)),
}));

import { exportAdminReport, getAdminDashboard, getAdminPredictiveInsights } from './ticketService';

describe('ticketService.getAdminDashboard shares identical in flight requests', () => {
  beforeEach(() => {
    instance.get.mockReset();
  });

  it('sends one request for concurrent calls with the same filters, whatever the key order', async () => {
    let resolve;
    instance.get.mockReturnValueOnce(new Promise((r) => { resolve = r; }));

    const a = getAdminDashboard({ preset: 'Last 7 Days', date_from: '2026-10-28' });
    const b = getAdminDashboard({ date_from: '2026-10-28', preset: 'Last 7 Days' });
    resolve({ data: { kpis: { total_tickets: 7 } } });

    expect(await a).toEqual({ kpis: { total_tickets: 7 } });
    expect(await b).toEqual({ kpis: { total_tickets: 7 } });
    expect(instance.get).toHaveBeenCalledTimes(1);
  });

  it('keeps different filters separate and sends a fresh request once the first has finished', async () => {
    instance.get.mockResolvedValue({ data: { ok: true } });

    await Promise.all([getAdminDashboard({ preset: 'Today' }), getAdminDashboard({ preset: 'Last 30 Days' })]);
    expect(instance.get).toHaveBeenCalledTimes(2);

    await getAdminDashboard({ preset: 'Today' });
    expect(instance.get).toHaveBeenCalledTimes(3);
  });

  it('shares concurrent predictive insight requests too, but never mixes them with dashboard requests', async () => {
    instance.get.mockResolvedValue({ data: { ok: true } });

    await Promise.all([getAdminPredictiveInsights({}), getAdminPredictiveInsights({}), getAdminDashboard({})]);

    expect(instance.get).toHaveBeenCalledTimes(2);
    expect(instance.get.mock.calls.map((c) => c[0]).sort()).toEqual(['/admin-reports/predictive-insights', '/admin/dashboard']);
  });

  it('does not keep a failed request, so the next call tries again', async () => {
    instance.get.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ data: { ok: true } });

    await expect(getAdminDashboard({ preset: 'Today' })).rejects.toThrow('boom');
    await expect(getAdminDashboard({ preset: 'Today' })).resolves.toEqual({ ok: true });
  });
});

describe('ticketService.exportAdminReport (spec 0029 AC-16, AC-17)', () => {
  beforeEach(() => {
    instance.post.mockReset();
  });

  it('posts the report type, format and filters to the export endpoint and asks for a blob', async () => {
    const response = { data: new Blob(['x']), headers: {} };
    instance.post.mockResolvedValueOnce(response);

    const result = await exportAdminReport({
      reportType: 'sla_compliance',
      format: 'xlsx',
      filters: { preset: 'Last 30 Days', department: 'Service' },
    });

    expect(instance.post).toHaveBeenCalledTimes(1);
    expect(instance.post).toHaveBeenCalledWith(
      '/admin/reports/export',
      { report_type: 'sla_compliance', format: 'xlsx', filters: { preset: 'Last 30 Days', department: 'Service' } },
      { responseType: 'blob' }
    );
    expect(result).toBe(response);
  });

  it('defaults filters to an empty object', async () => {
    instance.post.mockResolvedValueOnce({ data: new Blob(['x']) });

    await exportAdminReport({ reportType: 'ticket_volume', format: 'csv' });

    expect(instance.post.mock.calls[0][1]).toEqual({ report_type: 'ticket_volume', format: 'csv', filters: {} });
  });

  it('lets a server rejection reach the caller so the page can show an error', async () => {
    instance.post.mockRejectedValueOnce({ response: { status: 403 } });

    await expect(exportAdminReport({ reportType: 'ticket_volume', format: 'pdf' })).rejects.toMatchObject({
      response: { status: 403 },
    });
  });
});
