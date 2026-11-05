import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth, resolveUserRole, resolveUserDepartment } from './AuthContext';
import axiosInstance from '@/api/axiosInstance';
import tokenStore from '@/auth/tokenStore';

vi.mock('@/api/axiosInstance', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    defaults: {
      headers: {
        common: {},
      },
    },
  },
}));

vi.mock('@/auth/tokenStore', () => ({
  default: {
    getToken: vi.fn(),
    setToken: vi.fn(),
    clearToken: vi.fn(),
  },
}));

function TestAuthConsumer() {
  const { user, isAuthenticated, isLoading, login, logout } = useAuth();
  return (
    <div>
      <span data-testid="is-loading">{isLoading ? 'true' : 'false'}</span>
      <span data-testid="is-auth">{isAuthenticated ? 'true' : 'false'}</span>
      <span data-testid="user-email">{user?.email || 'none'}</span>
      <span data-testid="user-role">{user ? resolveUserRole(user) : 'none'}</span>
      <button
        onClick={() => login('agent@example.com', 'password')}
        data-testid="login-btn"
      >
        Login
      </button>
      <button onClick={() => logout()} data-testid="logout-btn">
        Logout
      </button>
    </div>
  );
}

describe('AuthContext and session management (AC-1, AC-15, AC-20)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('correctly resolves user role for various user structures (covers: AC-1, AC-15)', () => {
    expect(resolveUserRole(null)).toBe('');
    expect(resolveUserRole({ role: 'superadmin' })).toBe('superadmin');
    expect(resolveUserRole({ role: { name: 'admin' } })).toBe('admin');
    expect(resolveUserRole({ profile: { role: 'Customer Service' }, role: 'customer' })).toBe('Customer Service');
    expect(resolveUserRole({ profile: { role: { name: 'technician' } }, role: 'customer' })).toBe('technician');
  });

  it('correctly resolves user department (covers: AC-15)', () => {
    expect(resolveUserDepartment(null)).toBe('');
    expect(resolveUserDepartment({ department: 'Engineering' })).toBe('Engineering');
    expect(resolveUserDepartment({ department: { name: 'Support' } })).toBe('Support');
    expect(resolveUserDepartment({ profile: { department: 'Operations' } })).toBe('Operations');
  });

  it('clears session and local storage on logout including first login flags (covers: AC-15)', async () => {
    sessionStorage.setItem('user', JSON.stringify({ id: 10, email: 'test@example.com', role: 'employee' }));
    sessionStorage.setItem('first_login_pending', 'true');
    localStorage.setItem('user', JSON.stringify({ id: 10, email: 'test@example.com', role: 'employee' }));
    tokenStore.getToken.mockReturnValue('mock-token');
    axiosInstance.post.mockResolvedValueOnce({ data: { success: true } });

    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('is-loading').textContent).toBe('false');
    });

    await act(async () => {
      screen.getByTestId('logout-btn').click();
    });

    expect(sessionStorage.getItem('user')).toBeNull();
    expect(sessionStorage.getItem('first_login_pending')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('initializes from session revalidation and populates user state (covers: AC-20)', async () => {
    const mockUser = {
      id: 42,
      emp_id: 42,
      email: 'tech@example.com',
      role: 'employee',
      department: 'Service',
    };
    tokenStore.getToken.mockReturnValue('valid-token');
    axiosInstance.get.mockResolvedValueOnce({
      data: {
        user: mockUser,
        token: 'valid-token',
        is_first_login: false,
      },
    });

    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('is-loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('is-auth').textContent).toBe('true');
    expect(screen.getByTestId('user-email').textContent).toBe('tech@example.com');
  });

  it('replaces a stale cross role user record when a different account hydrates (covers: AC-4)', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 7, email: 'old.employee@example.com', role: 'employee' }));
    tokenStore.getToken.mockReturnValue('valid-token');
    axiosInstance.get.mockResolvedValueOnce({
      data: {
        user: { id: 1, email: 'admin@example.com', role: 'admin' },
        token: 'valid-token',
        is_first_login: false,
      },
    });

    render(
      <AuthProvider>
        <TestAuthConsumer />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('user-email').textContent).toBe('admin@example.com');
    });

    const stored = JSON.parse(localStorage.getItem('user'));
    expect(stored.email).toBe('admin@example.com');
    expect(stored.id).toBe(1);
    expect(resolveUserRole(stored)).toBe('admin');
  });
});
