/**
 * Branch Configuration & Mock Data (TS090, TS092, TS097)
 *
 * Reusable list of placeholder physical branches / hospital locations.
 *
 * NOTE: This is local mock state for the current sprint. Real branch records,
 * backend associations, and multi-tenant permissions need to come from backend
 * API / database migrations and business requirements in a future sprint.
 */

export const BRANCH_STORAGE_KEY = 'superadmin_active_branch';

export const DEFAULT_BRANCHES = [
  {
    id: 'main-office',
    name: 'Main Office',
    code: 'MAIN',
    region: 'Main',
    address: 'Makati City, Metro Manila',
    description: 'Main Office located in Makati City, Metro Manila',
  },
  {
    id: 'north-luzon-hub',
    name: 'North Luzon Hub',
    code: 'NORT',
    region: 'Main',
    address: 'Blk 8 Lot 2 Molave Subdivision, Brgy. Patul, Santiago City, Isabela',
    description: 'North Luzon Hub in Santiago City, Isabela',
  },
  {
    id: 'cebu-city-office',
    name: 'Cebu City Office',
    code: 'CEBU',
    region: 'Main',
    address: '3264A Maria Theresa Village 2, Guadalupe, Cebu City, Cebu',
    description: 'Cebu City Office in Guadalupe, Cebu City',
  },
];

export const DEFAULT_BRANCH_ID = 'main-office';

/**
 * Retrieve the currently stored active branch ID from localStorage,
 * falling back to DEFAULT_BRANCH_ID if missing or invalid.
 */
export function getStoredBranchId() {
  try {
    const stored = localStorage.getItem(BRANCH_STORAGE_KEY);
    if (stored === 'all' || stored === 'none' || stored === 'null') {
      return null;
    }
    if (stored && !['main', 'luzon', 'visayas', 'mindanao'].includes(stored)) {
      return stored;
    }
  } catch {
    // Ignore localStorage access failures (SSR / private mode)
  }
  return DEFAULT_BRANCH_ID;
}

/**
 * Persist the selected branch ID to localStorage and broadcast an event.
 */
export function setStoredBranchId(branchId) {
  try {
    if (branchId === null || branchId === 'all' || branchId === 'none') {
      localStorage.setItem(BRANCH_STORAGE_KEY, 'all');
      window.dispatchEvent(new CustomEvent('active_branch_changed', { detail: { branchId: null } }));
      return true;
    }
    localStorage.setItem(BRANCH_STORAGE_KEY, String(branchId));
    window.dispatchEvent(new CustomEvent('active_branch_changed', { detail: { branchId } }));
    return true;
  } catch {
    // Ignore localStorage access failures
  }
  return false;
}
