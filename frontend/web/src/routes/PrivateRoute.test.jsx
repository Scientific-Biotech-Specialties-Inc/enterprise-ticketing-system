import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import PrivateRoute, { checkIsCSManager, checkIsServiceManager } from './PrivateRoute';
import * as authContextModule from '@/context/AuthContext';

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
  resolveUserRole: vi.fn((u) => u?.role || ''),
  resolveUserDepartment: vi.fn((u) => u?.department || ''),
}));

describe('PrivateRoute authorization guard (AC-1, AC-8, AC-12, AC-15, AC-20)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('treats a Customer Service manager as a CS manager only, never also a service manager (prevents a redirect loop)', () => {
    const csManager = { role: 'Manager', department: 'Customer Service', email: 'cs.lead@example.com' };
    const serviceManager = { role: 'Manager', department: 'Service', email: 'svc.lead@example.com' };

    expect(checkIsCSManager(csManager)).toBe(true);
    expect(checkIsServiceManager(csManager)).toBe(false);
    expect(checkIsServiceManager(serviceManager)).toBe(true);
    expect(checkIsCSManager(serviceManager)).toBe(false);
  });

  it('renders skeleton loader when loading or validating authenticated session (covers: AC-20)', () => {
    authContextModule.useAuth.mockReturnValue({
      isLoading: true,
      isAuthenticated: false,
      user: null,
    });

    const { container } = render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <PrivateRoute>
          <div data-testid="dashboard-content">Dashboard</div>
        </PrivateRoute>
      </MemoryRouter>
    );

    expect(screen.queryByTestId('dashboard-content')).toBeNull();
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('redirects unauthenticated users away from restricted routes (covers: AC-1, AC-15)', () => {
    authContextModule.useAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
      user: null,
    });

    render(
      <MemoryRouter initialEntries={['/ticketing/dashboard']}>
        <Routes>
          <Route path="/login" element={<div data-testid="login-page">Login Page</div>} />
          <Route path="/customer" element={<div data-testid="customer-login">Customer Login</div>} />
          <Route
            path="/ticketing/dashboard"
            element={
              <PrivateRoute>
                <div data-testid="dashboard-content">Dashboard</div>
              </PrivateRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByTestId('dashboard-content')).toBeNull();
  });

  it('allows authorized employee to render protected destination (covers: AC-13, AC-20)', () => {
    const mockUser = {
      id: 1,
      emp_id: 1,
      role: 'employee',
      department: 'Service',
    };
    authContextModule.useAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      user: mockUser,
    });

    render(
      <MemoryRouter initialEntries={['/ticketing/employee/dashboard']}>
        <PrivateRoute role="employee">
          <div data-testid="employee-dashboard-content">Employee Dashboard View</div>
        </PrivateRoute>
      </MemoryRouter>
    );

    expect(screen.getByTestId('employee-dashboard-content')).toBeInTheDocument();
  });
});

