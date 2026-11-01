import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import {
  DEFAULT_BRANCHES,
  DEFAULT_BRANCH_ID,
  getStoredBranchId,
  setStoredBranchId,
} from '@/data/branchConfig';
import { getBranches, getPublicBranches } from '@/services/ticketService';
import { useAuth } from '@/context/AuthContext';

export const GLOBAL_BRANCH = {
  id: null,
  slug: 'all',
  name: 'All Branches (Global Scope)',
  code: 'ALL',
  region: 'Global',
  description: 'System-wide configuration and ticket scope across all physical facilities',
};

const BranchContext = createContext(null);

/**
 * BranchProvider manages the globally selected physical branch / facility.
 * Persists the Super Admin's selection across page reloads and cross-tab actions.
 */
export function BranchProvider({ children }) {
  let authUser = null;
  try {
    const auth = useAuth();
    authUser = auth?.user;
  } catch {
    // Graceful fallback when outside AuthProvider or during unauthenticated testing
  }

  const [branches, setBranches] = useState(DEFAULT_BRANCHES);
  const [selectedBranchId, setSelectedBranchIdState] = useState(getStoredBranchId);

  const isSuperOrAdmin = useMemo(() => {
    if (!authUser) return false;
    const role = (authUser.role || '').toLowerCase();
    const email = (authUser.email || '').toLowerCase();
    return (
      role === 'superadmin' ||
      role === 'admin' ||
      email === 'superadmin@example.com' ||
      email === 'admin@example.com'
    );
  }, [authUser]);

  // Dynamically load live branches from ticket service on mount or role change
  useEffect(() => {
    let isMounted = true;

    const loadBranches = async () => {
      try {
        const fetcher = isSuperOrAdmin ? getBranches : getPublicBranches;
        const res = await fetcher();
        const data = Array.isArray(res) ? res : (res?.branches || res?.data || []);
        if (isMounted && Array.isArray(data) && data.length > 0) {
          setBranches(data);
          return;
        }
      } catch {
        // Fallback to public branches if superadmin request failed
        try {
          const fallbackRes = await getPublicBranches();
          const fallbackData = Array.isArray(fallbackRes) ? fallbackRes : (fallbackRes?.branches || fallbackRes?.data || []);
          if (isMounted && Array.isArray(fallbackData) && fallbackData.length > 0) {
            setBranches(fallbackData);
            return;
          }
        } catch {
          // Gracefully retain DEFAULT_BRANCHES
        }
      }
    };

    loadBranches();

    return () => {
      isMounted = false;
    };
  }, [isSuperOrAdmin]);

  // Sync state when changed internally or via custom event / other tabs
  useEffect(() => {
    const handleCustomChange = (e) => {
      const nextId = e.detail?.branchId;
      if (nextId === null || nextId === 'all') {
        setSelectedBranchIdState(null);
      } else if (nextId) {
        setSelectedBranchIdState(nextId);
      }
    };

    const handleStorageChange = (e) => {
      if (e.key === 'superadmin_active_branch') {
        const val = e.newValue;
        if (val === 'all' || val === 'null' || !val) {
          setSelectedBranchIdState(null);
        } else {
          setSelectedBranchIdState(val);
        }
      }
    };

    window.addEventListener('active_branch_changed', handleCustomChange);
    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('active_branch_changed', handleCustomChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const setSelectedBranchId = useCallback((branchId) => {
    if (branchId === null || branchId === 'all' || branchId === 'none') {
      setSelectedBranchIdState(null);
      setStoredBranchId(null);
    } else {
      setSelectedBranchIdState(branchId);
      setStoredBranchId(branchId);
    }
  }, []);

  const setSelectedBranch = useCallback((branchOrId) => {
    if (branchOrId === null || branchOrId === 'all') {
      setSelectedBranchId(null);
      return;
    }
    const id = typeof branchOrId === 'string' || typeof branchOrId === 'number'
      ? branchOrId
      : branchOrId?.id || branchOrId?.slug;
    setSelectedBranchId(id);
  }, [setSelectedBranchId]);

  const selectedBranch = useMemo(() => {
    if (!isSuperOrAdmin && (authUser?.branch_id || authUser?.branch)) {
      const assigned = branches.find(
        (b) => String(b.id) === String(authUser.branch_id) ||
               String(b.name).toLowerCase() === String(authUser.branch).toLowerCase() ||
               String(b.slug).toLowerCase() === String(authUser.branch).toLowerCase()
      );
      if (assigned) return assigned;
      if (authUser.branch) {
        return {
          id: authUser.branch_id || null,
          name: authUser.branch,
          code: authUser.branch_code || (authUser.branch || '').substring(0, 3).toUpperCase(),
          region: 'Local',
        };
      }
    }

    if (selectedBranchId === null || selectedBranchId === 'all') {
      return GLOBAL_BRANCH;
    }
    const match = branches.find(
      (b) => String(b.id) === String(selectedBranchId) || String(b.slug) === String(selectedBranchId)
    );
    return match || GLOBAL_BRANCH;
  }, [selectedBranchId, branches, isSuperOrAdmin, authUser]);

  const isAllBranches = selectedBranchId === null || selectedBranchId === 'all';

  const value = useMemo(() => ({
    branches,
    selectedBranchId,
    selectedBranch,
    currentBranch: selectedBranch,
    setSelectedBranchId,
    setSelectedBranch,
    selectBranch: setSelectedBranch,
    isAllBranches,
    GLOBAL_BRANCH,
    loading: false,
  }), [branches, selectedBranchId, selectedBranch, setSelectedBranchId, setSelectedBranch, isAllBranches]);

  return (
    <BranchContext.Provider value={value}>
      {children}
    </BranchContext.Provider>
  );
}

/**
 * Custom hook to access active branch state in any component.
 */
export function useBranch() {
  const context = useContext(BranchContext);
  if (!context) {
    throw new Error('useBranch must be used within a <BranchProvider>');
  }
  return context;
}

export default BranchContext;
