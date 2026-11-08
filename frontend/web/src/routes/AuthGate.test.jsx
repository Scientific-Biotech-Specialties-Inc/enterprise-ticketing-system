import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AuthGate from './AuthGate';
import * as authContextModule from '@/context/AuthContext';

vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

describe('AuthGate route component (AC-20)', () => {
  it('renders skeleton loader layout during session verification (covers: AC-20)', () => {
    authContextModule.useAuth.mockReturnValue({
      isLoading: true,
    });

    const { container } = render(
      <AuthGate>
        <div data-testid="protected-content">Secret content</div>
      </AuthGate>
    );

    expect(screen.queryByTestId('protected-content')).toBeNull();
    const skeletons = container.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders child components when authentication loading finishes (covers: AC-20)', () => {
    authContextModule.useAuth.mockReturnValue({
      isLoading: false,
    });

    render(
      <AuthGate>
        <div data-testid="protected-content">Secret content</div>
      </AuthGate>
    );

    expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    expect(screen.getByText('Secret content')).toBeInTheDocument();
  });
});

