import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WrongPortal from './WrongPortal';
import * as authContextModule from '@/context/AuthContext';

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

describe('WrongPortal Component Tests', () => {
  const mockLogout = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    authContextModule.useAuth.mockReturnValue({
      logout: mockLogout,
      user: null,
    });
  });

  it('renders Access Denied and Customer Portal CTA when customer visits employee portal', () => {
    render(<WrongPortal portalType="employee" />);

    expect(screen.getByRole('heading', { name: /Access Denied/i })).toBeInTheDocument();
    expect(screen.getByText(/This portal is for/i)).toHaveTextContent(/employees and staff only/i);
    expect(screen.getByRole('link', { name: /Go to Customer Portal/i })).toBeInTheDocument();
  });

  it('renders Wrong Portal and Employee Portal CTA when employee visits customer portal', () => {
    render(<WrongPortal portalType="customer" />);

    expect(screen.getByRole('heading', { name: /Wrong Portal/i })).toBeInTheDocument();
    expect(screen.getByText(/This portal is for/i)).toHaveTextContent(/customers only/i);
    expect(screen.getByRole('link', { name: /Go to Employee Portal/i })).toBeInTheDocument();
  });

  it('invokes logout when clicking Log Out', () => {
    render(<WrongPortal portalType="employee" />);

    const logoutButton = screen.getByRole('button', { name: /^Log Out$/i });
    fireEvent.click(logoutButton);

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});
