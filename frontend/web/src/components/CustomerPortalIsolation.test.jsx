import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';

/**
 * Customer portal isolation: the customer build (VITE_APP_MODE=customer) must never send anyone to the
 * employee portal / central auth module, and must only ever log in against customer-service.
 * The employee build keeps its existing behavior, including the localhost port fallback.
 */

const axiosMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
}));

vi.mock('@/api/axiosInstance', () => ({ default: axiosMock }));
vi.mock('@/utils/rsa', () => ({
  fetchEncryptionKey: vi.fn(async () => ({ public_key: 'pk', key_id: 'kid' })),
  encryptPayload: vi.fn(() => 'encrypted'),
}));

const logoutMock = vi.fn(async () => ({ success: true }));

async function renderWrongPortal(mode, props = {}) {
  vi.stubEnv('VITE_APP_MODE', mode);
  vi.resetModules();
  vi.doMock('@/context/AuthContext', () => ({ useAuth: () => ({ logout: logoutMock }) }));
  const { default: WrongPortal } = await import('./WrongPortal');
  return render(<WrongPortal {...props} />);
}

describe('Customer portal isolation', () => {
  let replaceSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    replaceSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, replace: replaceSpy, href: 'http://localhost:5006/', port: '5006', hostname: 'localhost', protocol: 'http:' },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('@/context/AuthContext');
  });

  it('customer site: WrongPortal offers no link to the employee portal', async () => {
    await renderWrongPortal('customer', { portalType: 'customer' });

    expect(screen.queryByText(/Go to Employee Portal/i)).not.toBeInTheDocument();
    expect(screen.getByText(/can't be used here/i)).toBeInTheDocument();
    for (const link of screen.queryAllByRole('link')) {
      expect(link.getAttribute('href')).not.toMatch(/ticketing|5005/);
    }
  });

  it('customer site: logging out from WrongPortal stays on the customer site', async () => {
    await renderWrongPortal('customer', { portalType: 'customer' });

    await act(async () => {
      screen.getByRole('button', { name: /Log Out/i }).click();
    });

    expect(logoutMock).toHaveBeenCalled();
    expect(replaceSpy).toHaveBeenCalledWith('/');
  });

  it('employee site on localhost: a customer account is pointed to the customer portal on :5006', async () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, replace: replaceSpy, port: '5005', hostname: 'localhost', protocol: 'http:' },
    });
    await renderWrongPortal('employee', { portalType: 'employee' });

    const cta = screen.getByText(/Go to Customer Portal/i);
    expect(cta.getAttribute('href')).toBe('http://localhost:5006/');
  });

  it('customer site: login() always uses customer mode and never redirects to central SSO', async () => {
    vi.stubEnv('VITE_APP_MODE', 'customer');
    vi.resetModules();
    axiosMock.get.mockRejectedValue({ response: { status: 401 } });
    axiosMock.post.mockImplementation(async (url) => {
      if (String(url).includes('login')) {
        return { data: { user: { id: 1, role: 'customer', email: 'c@example.com' }, token: 't', is_first_login: false } };
      }
      throw { response: { status: 401 } };
    });

    const { AuthProvider, useAuth } = await import('@/context/AuthContext');
    let auth;
    const Probe = () => {
      auth = useAuth();
      return null;
    };
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(auth).toBeDefined());

    const hrefBefore = window.location.href;
    let result;
    await act(async () => {
      result = await auth.login('c@example.com', 'secret', 'employee');
    });

    const loginCall = axiosMock.post.mock.calls.find(([url]) => String(url).includes('login'));
    expect(loginCall).toBeDefined();
    expect(loginCall[1].mode).toBe('customer');
    expect(result.success).toBe(true);
    expect(window.location.href).toBe(hrefBefore);
  });
});
