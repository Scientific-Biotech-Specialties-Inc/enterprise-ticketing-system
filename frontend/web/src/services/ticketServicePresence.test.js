import { describe, it, expect, vi, beforeEach } from 'vitest';

const get = vi.fn();
vi.mock('@/api/axiosInstance', () => ({
  default: {
    get: (...args) => get(...args),
    post: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));

import { getAssignableEmployees, clearAssignableEmployeesCache } from './ticketService';

const row = (id, extra) => ({
  id,
  name: `Tech ${id}`,
  department: 'Service',
  role: 'engineer',
  email: `t${id}@x.com`,
  is_active: true,
  ...extra,
});

describe('getAssignableEmployees presence mapping (covers: AC-2)', () => {
  beforeEach(() => {
    clearAssignableEmployeesCache();
    get.mockReset();
  });

  it('treats an online employee as available and keeps the account flag', async () => {
    get.mockResolvedValue({ data: { employees: [row(1, { presence: 'online' })] } });

    const [emp] = await getAssignableEmployees({ forceRefresh: true });

    expect(emp.is_active).toBe(true);
    expect(emp.account_active).toBe(true);
    expect(emp.presence).toBe('online');
  });

  it('treats an offline employee as not available even though the account is active', async () => {
    get.mockResolvedValue({ data: { employees: [row(2, { presence: 'offline' })] } });

    const [emp] = await getAssignableEmployees({ forceRefresh: true });

    expect(emp.is_active).toBe(false);
    expect(emp.account_active).toBe(true);
  });

  it('leaves rows without presence untouched for older responses', async () => {
    get.mockResolvedValue({ data: { employees: [row(3, {})] } });

    const [emp] = await getAssignableEmployees({ forceRefresh: true });

    expect(emp.is_active).toBe(true);
    expect(emp).not.toHaveProperty('account_active');
  });

  it('still filters out admin accounts', async () => {
    get.mockResolvedValue({
      data: { employees: [row(4, { presence: 'online', role: 'admin' }), row(5, { presence: 'online' })] },
    });

    const list = await getAssignableEmployees({ forceRefresh: true });

    expect(list.map((e) => e.id)).toEqual([5]);
  });
});
