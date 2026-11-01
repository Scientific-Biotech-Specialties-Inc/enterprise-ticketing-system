import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { BranchProvider, useBranch, GLOBAL_BRANCH } from './BranchContext';
import * as ticketService from '../services/ticketService';
import * as authContextModule from './AuthContext';

vi.mock('../services/ticketService', () => ({
  getBranches: vi.fn(),
  getPublicBranches: vi.fn(),
}));

const mockBranches = [
  { id: 1, name: 'Cebu Main Branch', code: 'CEB', region: 'Visayas', address: 'Osmeña Blvd, Cebu City' },
  { id: 2, name: 'Davao South Branch', code: 'DVO', region: 'Mindanao', address: 'Quirino Ave, Davao City' },
];

function TestConsumer() {
  const { currentBranch, branches, selectBranch, isAllBranches, loading } = useBranch();
  return (
    <div>
      <span data-testid="loading">{loading ? 'true' : 'false'}</span>
      <span data-testid="branch-count">{branches.length}</span>
      <span data-testid="current-branch-name">{currentBranch?.name || 'NONE'}</span>
      <span data-testid="current-branch-code">{currentBranch?.code || 'NONE'}</span>
      <span data-testid="is-all">{isAllBranches ? 'true' : 'false'}</span>
      <button
        onClick={() => selectBranch(GLOBAL_BRANCH)}
        data-testid="select-global-btn"
      >
        Select Global
      </button>
      <button
        onClick={() => selectBranch(mockBranches[0])}
        data-testid="select-cebu-btn"
      >
        Select Cebu
      </button>
    </div>
  );
}

describe('BranchContext and null branch support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('allows superadmin with null branch to select global view', async () => {
    vi.spyOn(authContextModule, 'useAuth').mockReturnValue({
      user: {
        id: 1,
        email: 'superadmin@example.com',
        role: 'superadmin',
        branch: null,
        branch_id: null,
      },
    });

    ticketService.getBranches.mockResolvedValue({
      data: mockBranches,
    });

    render(
      <BranchProvider>
        <TestConsumer />
      </BranchProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('branch-count').textContent).toBe('2');

    await act(async () => {
      screen.getByTestId('select-global-btn').click();
    });

    expect(screen.getByTestId('current-branch-name').textContent).toBe(GLOBAL_BRANCH.name);
    expect(screen.getByTestId('current-branch-code').textContent).toBe(GLOBAL_BRANCH.code);
    expect(screen.getByTestId('is-all').textContent).toBe('true');
  });

  it('locks operational employee to assigned branch', async () => {
    vi.spyOn(authContextModule, 'useAuth').mockReturnValue({
      user: {
        id: 5,
        email: 'agent@example.com',
        role: 'customer_service',
        branch: 'Cebu Main Branch',
        branch_id: 1,
      },
    });

    ticketService.getPublicBranches.mockResolvedValue({
      data: mockBranches,
    });

    render(
      <BranchProvider>
        <TestConsumer />
      </BranchProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(screen.getByTestId('current-branch-name').textContent).toBe('Cebu Main Branch');
    expect(screen.getByTestId('current-branch-code').textContent).toBe('CEB');
  });

  it('routes engineer to public branches without hitting superadmin endpoint', async () => {
    vi.spyOn(authContextModule, 'useAuth').mockReturnValue({
      user: {
        id: 7,
        email: 'engineer@example.com',
        role: 'engineer',
        branch: 'Davao South Branch',
        branch_id: 2,
      },
    });

    ticketService.getPublicBranches.mockResolvedValue({
      data: mockBranches,
    });

    render(
      <BranchProvider>
        <TestConsumer />
      </BranchProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    expect(ticketService.getBranches).not.toHaveBeenCalled();
    expect(ticketService.getPublicBranches).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('current-branch-name').textContent).toBe('Davao South Branch');
    expect(screen.getByTestId('current-branch-code').textContent).toBe('DVO');
  });
});
