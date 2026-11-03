import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';
import * as authContextModule from '@/context/AuthContext';
import * as branchContextModule from '@/context/BranchContext';

vi.mock('@/services/echo', () => ({
  default: {
    channel: vi.fn(() => ({ listen: vi.fn() })),
    private: vi.fn(() => ({ listen: vi.fn() })),
    disconnect: vi.fn(),
  },
}));

vi.mock('@/context/AuthContext', async () => {
  const actual = await vi.importActual('@/context/AuthContext');
  return {
    ...actual,
    useAuth: vi.fn(),
    AuthProvider: ({ children }) => <div data-testid="auth-provider">{children}</div>,
  };
});

vi.mock('@/context/BranchContext', () => ({
  BranchProvider: ({ children }) => <div data-testid="branch-provider">{children}</div>,
  useBranch: () => ({ currentBranch: null, selectBranch: vi.fn(), branches: [] }),
  GLOBAL_BRANCH: { id: null, name: 'All Branches' },
}));

vi.mock('@/context/ToastContext', () => ({
  ToastProvider: ({ children }) => <div data-testid="toast-provider">{children}</div>,
  useToast: () => ({ toast: vi.fn() }),
}));

describe('App root component and portal gating (AC-1, AC-13, AC-20)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders skeleton loader layout during session loading state (covers: AC-20)', () => {
    authContextModule.useAuth.mockReturnValue({
      isLoading: true,
      isAuthenticated: false,
      user: null,
    });

    const { container } = render(<App />);

    expect(screen.getByTestId('auth-provider')).toBeInTheDocument();
    expect(screen.getByTestId('branch-provider')).toBeInTheDocument();
    expect(screen.getByTestId('toast-provider')).toBeInTheDocument();
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});
