import { describe, it, expect, vi, beforeEach } from 'vitest';

const { instance } = vi.hoisted(() => ({
  instance: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    defaults: { headers: { common: {} } },
  },
}));

vi.mock('axios', () => ({
  default: { create: vi.fn(() => instance), isAxiosError: vi.fn(() => false) },
}));

let mockToken = 'staff-token';
vi.mock('@/auth/tokenStore', () => ({
  default: { getToken: vi.fn(() => mockToken), clearToken: vi.fn(), setToken: vi.fn() },
}));

vi.mock('@/auth/refreshSession', () => ({
  refreshAccessToken: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@/utils/rsa', () => ({
  fetchEncryptionKey: vi.fn(),
  encryptPayload: vi.fn(),
}));

import './configurationService';

const requestInterceptor = instance.interceptors.request.use.mock.calls[0][0];

/**
 * Spec 0034: the configuration service decides who is calling from the verified token only.
 * The browser must not send a role or actor name for it to trust.
 */
describe('configurationService request headers (spec 0034)', () => {
  beforeEach(() => {
    mockToken = 'staff-token';
    sessionStorage.clear();
    localStorage.clear();
    sessionStorage.setItem('user', JSON.stringify({ id: 1, role: 'superadmin', name: 'Super Admin', first_name: 'Super', last_name: 'Admin' }));
  });

  it('sends the bearer token', () => {
    const config = requestInterceptor({ headers: {} });

    expect(config.headers.Authorization).toBe('Bearer staff-token');
  });

  it('does not send a role or actor name taken from the stored user', () => {
    const config = requestInterceptor({ headers: {} });
    const names = Object.keys(config.headers).map((h) => h.toLowerCase());

    expect(names).not.toContain('x-user-role');
    expect(names).not.toContain('x-actor-name');
    expect(names).not.toContain('x-user-id');
  });

  it('sends no Authorization header when there is no token, rather than "Bearer null"', () => {
    mockToken = null;

    const config = requestInterceptor({ headers: {} });

    expect(config.headers).not.toHaveProperty('Authorization');
  });

  it('keeps any headers already set on the request', () => {
    const config = requestInterceptor({ headers: { 'X-Requested-With': 'XMLHttpRequest' } });

    expect(config.headers['X-Requested-With']).toBe('XMLHttpRequest');
  });
});
