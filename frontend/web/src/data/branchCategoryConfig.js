/**
 * Branch-Specific Ticket Categories & SLA Policies Configuration (TS090)
 *
 * Distinct from "Equipment Categories" (biomedical hardware types in machine_categories)
 * and "Problem Categories" (issue types in problem_categories).
 *
 * System-wide default categories ('IT', 'Service', 'Others') map onto the backend
 * Department concept (Service, IT from departments table) plus an 'Others' catch-all,
 * consistent with the pattern used for TS104's FEEDBACK_CATEGORIES.
 *
 * NOTE: This is local mock state for the current sprint. Real branch records,
 * backend associations, and multi-tenant permissions need to come from backend
 * API / database migrations and business requirements in a future sprint.
 */

export const SYSTEM_DEFAULT_CATEGORIES = ['IT', 'Service', 'Others'];

export const BRANCH_CATEGORIES_STORAGE_KEY = 'superadmin_branch_categories';
export const BRANCH_SLA_POLICIES_STORAGE_KEY = 'superadmin_branch_sla_policies';

// Baseline system-wide default resolution SLA by priority (in minutes)
export const SYSTEM_DEFAULT_CATEGORY_SLAS = {
  Critical: 240, // 4 hours
  High: 480,     // 8 hours
  Medium: 1440,  // 24 hours
  Low: 4320,     // 72 hours
};

/**
 * Initial branch categories mock data.
 * Per TS090 specification:
 * - Includes system-wide defaults (IT, Service, Others) with isSystemDefault: true.
 * - Seeds one custom category as inUse: true with a nonzero activeTicketCount (e.g. 4)
 *   to demonstrate the blocked removal path.
 * - Seeds another custom category as inUse: false, activeTicketCount: 0 to demonstrate
 *   the successful removal path.
 */
// SIMULATED: no real branch-tagged ticket data exists yet. Replace with a real query once tickets support branch tagging.
export const INITIAL_BRANCH_CATEGORIES = {
  luzon: [
    {
      id: 'branch-luzon-cat-it',
      branchId: 'luzon',
      name: 'IT',
      isSystemDefault: true,
      inUse: false,
      activeTicketCount: 0,
    },
    {
      id: 'branch-luzon-cat-srv',
      branchId: 'luzon',
      name: 'Service',
      isSystemDefault: true,
      inUse: false,
      activeTicketCount: 0,
    },
    {
      id: 'branch-luzon-cat-oth',
      branchId: 'luzon',
      name: 'Others',
      isSystemDefault: true,
      inUse: false,
      activeTicketCount: 0,
    },
    {
      id: 'branch-luzon-cat-bio',
      branchId: 'luzon',
      name: 'Biomedical Facility Maintenance',
      isSystemDefault: false,
      inUse: true, // SIMULATED: blocked removal demonstration
      activeTicketCount: 4,
    },
    {
      id: 'branch-luzon-cat-rad',
      branchId: 'luzon',
      name: 'Radiology Support',
      isSystemDefault: false,
      inUse: false, // SIMULATED: successful removal demonstration
      activeTicketCount: 0,
    },
  ],
  main: [
    {
      id: 'branch-main-cat-it',
      branchId: 'main',
      name: 'IT',
      isSystemDefault: true,
      inUse: false,
      activeTicketCount: 0,
    },
    {
      id: 'branch-main-cat-srv',
      branchId: 'main',
      name: 'Service',
      isSystemDefault: true,
      inUse: false,
      activeTicketCount: 0,
    },
    {
      id: 'branch-main-cat-oth',
      branchId: 'main',
      name: 'Others',
      isSystemDefault: true,
      inUse: false,
      activeTicketCount: 0,
    },
  ],
  visayas: [
    {
      id: 'branch-visayas-cat-it',
      branchId: 'visayas',
      name: 'IT',
      isSystemDefault: true,
      inUse: false,
      activeTicketCount: 0,
    },
    {
      id: 'branch-visayas-cat-srv',
      branchId: 'visayas',
      name: 'Service',
      isSystemDefault: true,
      inUse: false,
      activeTicketCount: 0,
    },
    {
      id: 'branch-visayas-cat-oth',
      branchId: 'visayas',
      name: 'Others',
      isSystemDefault: true,
      inUse: false,
      activeTicketCount: 0,
    },
  ],
  mindanao: [
    {
      id: 'branch-mindanao-cat-it',
      branchId: 'mindanao',
      name: 'IT',
      isSystemDefault: true,
      inUse: false,
      activeTicketCount: 0,
    },
    {
      id: 'branch-mindanao-cat-srv',
      branchId: 'mindanao',
      name: 'Service',
      isSystemDefault: true,
      inUse: false,
      activeTicketCount: 0,
    },
    {
      id: 'branch-mindanao-cat-oth',
      branchId: 'mindanao',
      name: 'Others',
      isSystemDefault: true,
      inUse: false,
      activeTicketCount: 0,
    },
  ],
};

/**
 * Initial branch SLA policies mock data.
 * Combination of categoryName + priorityName overrides per branch.
 */
export const INITIAL_BRANCH_SLA_POLICIES = {
  luzon: [
    {
      id: 'branch-luzon-sla-it-high',
      branchId: 'luzon',
      categoryName: 'IT',
      priorityName: 'High',
      resolutionTimeLimit: 360, // 6 hours (override from default 480m)
      isInherited: false,
    },
    {
      id: 'branch-luzon-sla-bio-crit',
      branchId: 'luzon',
      categoryName: 'Biomedical Facility Maintenance',
      priorityName: 'Critical',
      resolutionTimeLimit: 120, // 2 hours (override from default 240m)
      isInherited: false,
    },
  ],
  main: [],
  visayas: [],
  mindanao: [],
};

export function getStoredBranchCategories() {
  try {
    const raw = localStorage.getItem(BRANCH_CATEGORIES_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Ignore parse error
  }
  return INITIAL_BRANCH_CATEGORIES;
}

export function setStoredBranchCategories(data) {
  try {
    localStorage.setItem(BRANCH_CATEGORIES_STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function getStoredBranchSlaPolicies() {
  try {
    const raw = localStorage.getItem(BRANCH_SLA_POLICIES_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Ignore parse error
  }
  return INITIAL_BRANCH_SLA_POLICIES;
}

export function setStoredBranchSlaPolicies(data) {
  try {
    localStorage.setItem(BRANCH_SLA_POLICIES_STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
