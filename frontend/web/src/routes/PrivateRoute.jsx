import SkeletonLoader from '@/components/SkeletonLoader.jsx';
import React, { useEffect, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, resolveUserRole, resolveUserDepartment } from '@/context/AuthContext';
import tokenStore from '@/auth/tokenStore';
import WrongPortal from '@/components/WrongPortal.jsx';

export { WrongPortal };

// ─── Role helpers ─────────────────────────────────────────────────────────────
export const checkIsCSManager = (user) => {
  if (!user) return false;
  const role = resolveUserRole(user).toLowerCase();
  const dept = resolveUserDepartment(user).toLowerCase();
  const posLevel = (user.position_level || user.profile?.position_level || '').toLowerCase();
  const email = (user.email || '').toLowerCase();
  if (email === 'headofcs@gmail.com') return true;
  return (
    role === 'cs_manager' ||
    role === 'cs manager' ||
    role === 'customer_service_manager' ||
    role === 'customer service manager' ||
    role === 'customer support manager' ||
    role === 'head of cs' ||
    role === 'head of customer service' ||
    role === 'head cs' ||
    ((dept.includes('customer service') || dept.includes('customer support') || dept === 'cs') && (role.includes('manager') || role.includes('head') || posLevel === 'manager'))
  );
};

export const checkIsCS = (user) => {
  if (!user) return false;
  if (checkIsCSManager(user)) return false;
  const dept = resolveUserDepartment(user).toLowerCase();
  const role = resolveUserRole(user).toLowerCase();
  if (dept.includes('customer service') || dept.includes('customer support') || dept === 'cs') return true;
  return (
    role.includes('customer service') ||
    role.includes('customer-service') ||
    role === 'cs'
  );
};

export const checkIsSuperAdmin = (user) => {
  if (!user) return false;
  const role = resolveUserRole(user).toLowerCase();
  const dept = resolveUserDepartment(user).toLowerCase();
  return role === 'superadmin' || role === 'super admin' || dept === 'superadmin' || dept === 'super admin';
};

export const checkIsAdmin = (user) => {
  if (!user) return false;
  const role = resolveUserRole(user).toLowerCase();
  const dept = resolveUserDepartment(user).toLowerCase();
  return role === 'admin' || role === 'it admin' || (dept === 'admin' && role !== 'superadmin' && role !== 'super admin');
};

export const checkIsItManager = (user) => {
  if (!user) return false;
  const role = resolveUserRole(user).toLowerCase();
  const dept = resolveUserDepartment(user).toLowerCase();
  return (
    role === 'it_manager' ||
    role === 'it manager' ||
    role === 'it department manager' ||
    (dept.includes('it') && role.includes('manager'))
  );
};

export const checkIsServiceManager = (user) => {
  if (!user) return false;
  // "Customer Service" contains "service", so a CS manager would also match below and the two
  // manager routes would redirect to each other forever. CS manager takes precedence.
  if (checkIsCSManager(user)) return false;
  const role = resolveUserRole(user).toLowerCase();
  const dept = resolveUserDepartment(user).toLowerCase();
  const posLevel = (user.position_level || user.profile?.position_level || '').toLowerCase();
  const email = (user.email || '').toLowerCase();
  if (email === 'carlos.mendoza@hospital.com') return true;
  return (
    role === 'service_manager' ||
    role === 'service manager' ||
    role === 'service department manager' ||
    role === 'lead service engineer' ||
    ((dept.includes('service') || dept.includes('biomedical') || dept.includes('radiology') || dept.includes('facilities')) && (role.includes('manager') || posLevel === 'manager'))
  );
};

export const checkIsEmployee = (user) => {
  if (!user) return false;
  if (checkIsCS(user)) return false;
  if (checkIsAdmin(user)) return false;
  if (checkIsSuperAdmin(user)) return false;
  if (checkIsItManager(user)) return false;
  if (checkIsServiceManager(user)) return false;
  if (checkIsCSManager(user)) return false;
  const dept = resolveUserDepartment(user).toLowerCase();
  const role = resolveUserRole(user).toLowerCase();
  if (dept === 'service' || dept.includes('engineer')) return true;
  return role === 'employee' || role.includes('service') || role.includes('engineer');
};

// ─── Private Route ────────────────────────────────────────────────────────────
// isCustomerSite: true when running as the customer-only container (port 5006)
const isCustomerSite = import.meta.env.VITE_APP_MODE === 'customer';

export default function PrivateRoute({ children, role }) {
  const { isAuthenticated, isLoading, user, logout } = useAuth();
  const location = useLocation();
  // Ref keeps the popstate effect from re-registering (and re-pushing history) when logout's identity changes.
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  useEffect(() => {
    const handlePageShow = (e) => {
      // Customer and employee portals: a page restored from the back/forward cache keeps its old DOM.
      // Hide it and reload so the session is re-checked before anything is shown.
      //
      // Only bfcache restores are handled here. `pageshow` also fires on every normal page load,
      // usually while AuthContext is still probing /me (isLoading=true, no in-memory token yet).
      // Redirecting on that event bounced SSO users back to the central portal right after they
      // opened /ticketing/ ("it logs me out"). Normal loads are guarded by the render logic below,
      // which waits for isLoading=false before deciding.
      if (e.persisted) {
        document.documentElement.style.visibility = 'hidden';
        window.location.reload();
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  useEffect(() => {
    if (isLoading || !isAuthenticated) return undefined;
    // Applies to every customer-portal page (dashboard, tickets, AI support, ...), not just the dashboard.
    const isCustomerPage = isCustomerSite && role === 'customer';
    if (!isCustomerPage) return undefined;

    // Capture the dashboard URL now: inside popstate, window.location already points at the
    // entry the user navigated to (e.g. the login page), so re-pushing it would leak that page
    // into the forward history.
    const guardUrl = window.location.href;
    const guardState = window.history.state;
    window.history.pushState(guardState, '', guardUrl);
    const handlePopState = (e) => {
      if (sessionStorage.getItem('is_logged_out') === 'true' || !tokenStore.getToken()) {
        window.location.replace(isCustomerSite ? (import.meta.env.BASE_URL || '/') : '/');
        return;
      }
      e.stopImmediatePropagation();
      // Back on the dashboard ends the session: logout() revokes the token, sets the
      // is_logged_out flag and hard-redirects (replace) to the landing page, so neither
      // Back nor Forward can bring the dashboard up again.
      logoutRef.current();
    };
    window.addEventListener('popstate', handlePopState, true);
    return () => window.removeEventListener('popstate', handlePopState, true);
  }, [isLoading, isAuthenticated, location.pathname, role]);

  if (isLoading || (isAuthenticated && !user)) {
    return (
      <div className="min-h-screen flex flex-col justify-start p-8 bg-page text-dark-slate space-y-6">
        <div className="flex justify-between items-center w-full mx-auto mb-4">
          <SkeletonLoader className="h-10 w-48" />
          <SkeletonLoader className="h-10 w-24 rounded-full" />
        </div>
        <div className="w-full mx-auto grid grid-cols-1 md:grid-cols-4 gap-6">
          <SkeletonLoader className="h-32 rounded-2xl" variant="default" />
          <SkeletonLoader className="h-32 rounded-2xl" variant="default" />
          <SkeletonLoader className="h-32 rounded-2xl" variant="default" />
          <SkeletonLoader className="h-32 rounded-2xl" variant="default" />
        </div>
        <div className="w-full mx-auto bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
          <div className="space-y-4">
            <SkeletonLoader className="h-8 w-1/3 mb-6" />
            <div className="space-y-3">
              <SkeletonLoader className="h-12 w-full rounded-xl" />
              <SkeletonLoader className="h-12 w-full rounded-xl" />
              <SkeletonLoader className="h-12 w-full rounded-xl" />
              <SkeletonLoader className="h-12 w-full rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!isAuthenticated) {
    if (isCustomerSite) {
      // Customer portal: redirect to landing page
      return <Navigate to="/" replace />;
    } else {
      // Employee/CS portal: redirect to auth-module root
      if (typeof window !== 'undefined') window.location.replace('/');
      return null;
    }
  }

  // Authenticated — check roles
  const isCS             = checkIsCS(user);
  const isAdmin          = checkIsAdmin(user);
  const isEmployee       = checkIsEmployee(user);
  const isSuperAdmin     = checkIsSuperAdmin(user);
  const isItManager      = checkIsItManager(user);
  const isServiceManager = checkIsServiceManager(user);
  const isCSManager      = checkIsCSManager(user);
  const isCustomer       = !isCS && !isEmployee && !isSuperAdmin && !isAdmin && !isItManager && !isServiceManager && !isCSManager;

  // ── Customer portal (port 5006) ──────────────────────────────────────────
  if (isCustomerSite) {
    // Only customers are allowed here
    if (!isCustomer) return <WrongPortal portalType="customer" />;
    // Staff only routes (superadmin, cs, employee, ...) are never available on the customer portal,
    // even though the routes are registered in the shared route table. Show Access Denied rather
    // than silently redirecting, so the customer knows the URL is not for them.
    if (role && role.toLowerCase() !== 'customer') {
      return <WrongPortal portalType="employee" />;
    }
  } else {
    // ── Employee/CS portal (port 5173/5005) ─────────────────────────────────
    if (isCustomer) {
      return <WrongPortal portalType="employee" />;
    }

    // Role-specific route authorization
    if (role) {
      const normalizedRole = role.toLowerCase();
      if (isSuperAdmin && normalizedRole !== 'superadmin') {
        return <Navigate to="/superadmin/dashboard" replace />;
      }
      if (isAdmin && normalizedRole !== 'admin') {
        return <Navigate to="/admin/dashboard" replace />;
      }
      if (isItManager && normalizedRole !== 'it_manager' && normalizedRole !== 'it manager') {
        return <Navigate to="/it-manager/dashboard" replace />;
      }
      if ((normalizedRole === 'it_manager' || normalizedRole === 'it manager') && !isItManager) {
        if (isSuperAdmin) return <Navigate to="/superadmin/dashboard" replace />;
        if (isAdmin) return <Navigate to="/admin/dashboard" replace />;
        if (isServiceManager) return <Navigate to="/service-manager/dashboard" replace />;
        if (isCSManager) return <Navigate to="/cs-manager/dashboard" replace />;
        if (isCS) return <Navigate to="/cs/dashboard" replace />;
        return <Navigate to="/employee/dashboard" replace />;
      }

      if (isServiceManager && normalizedRole !== 'service_manager' && normalizedRole !== 'service manager') {
        return <Navigate to="/service-manager/dashboard" replace />;
      }
      if ((normalizedRole === 'service_manager' || normalizedRole === 'service manager') && !isServiceManager) {
        if (isSuperAdmin) return <Navigate to="/superadmin/dashboard" replace />;
        if (isAdmin) return <Navigate to="/admin/dashboard" replace />;
        if (isItManager) return <Navigate to="/it-manager/dashboard" replace />;
        if (isCSManager) return <Navigate to="/cs-manager/dashboard" replace />;
        if (isCS) return <Navigate to="/cs/dashboard" replace />;
        return <Navigate to="/employee/dashboard" replace />;
      }

      if (isCSManager && normalizedRole !== 'cs_manager' && normalizedRole !== 'cs manager') {
        return <Navigate to="/cs-manager/dashboard" replace />;
      }
      if ((normalizedRole === 'cs_manager' || normalizedRole === 'cs manager') && !isCSManager) {
        if (isSuperAdmin) return <Navigate to="/superadmin/dashboard" replace />;
        if (isAdmin) return <Navigate to="/admin/dashboard" replace />;
        if (isItManager) return <Navigate to="/it-manager/dashboard" replace />;
        if (isServiceManager) return <Navigate to="/service-manager/dashboard" replace />;
        if (isCS) return <Navigate to="/cs/dashboard" replace />;
        return <Navigate to="/employee/dashboard" replace />;
      }

      if (normalizedRole === 'customer') {
        if (isSuperAdmin) return <Navigate to="/superadmin/dashboard" replace />;
        if (isAdmin) return <Navigate to="/admin/dashboard" replace />;
        if (isItManager) return <Navigate to="/it-manager/dashboard" replace />;
        if (isServiceManager) return <Navigate to="/service-manager/dashboard" replace />;
        if (isCSManager) return <Navigate to="/cs-manager/dashboard" replace />;
        if (isCS) return <Navigate to="/cs/dashboard" replace />;
        if (isEmployee) return <Navigate to="/employee/dashboard" replace />;
      }
      if (normalizedRole === 'admin' && !isAdmin) {
        if (isSuperAdmin) return <Navigate to="/superadmin/dashboard" replace />;
        if (isItManager) return <Navigate to="/it-manager/dashboard" replace />;
        if (isServiceManager) return <Navigate to="/service-manager/dashboard" replace />;
        if (isCSManager) return <Navigate to="/cs-manager/dashboard" replace />;
        if (isCS) return <Navigate to="/cs/dashboard" replace />;
        return <Navigate to="/employee/dashboard" replace />;
      }
      if (normalizedRole === 'superadmin' && !isSuperAdmin) {
        if (isAdmin) return <Navigate to="/admin/dashboard" replace />;
        if (isItManager) return <Navigate to="/it-manager/dashboard" replace />;
        if (isServiceManager) return <Navigate to="/service-manager/dashboard" replace />;
        if (isCSManager) return <Navigate to="/cs-manager/dashboard" replace />;
        return <Navigate to="/employee/dashboard" replace />;
      }
      if (normalizedRole === 'employee' && !isEmployee) {
        if (isAdmin) return <Navigate to="/admin/dashboard" replace />;
        if (isItManager) return <Navigate to="/it-manager/dashboard" replace />;
        if (isServiceManager) return <Navigate to="/service-manager/dashboard" replace />;
        if (isCSManager) return <Navigate to="/cs-manager/dashboard" replace />;
        return <Navigate to="/cs/dashboard" replace />;
      }
      if (
        (normalizedRole === 'cs' ||
          normalizedRole === 'customer service' ||
          normalizedRole === 'customer-service' ||
          normalizedRole === 'head of cs' ||
          normalizedRole === 'head of customer service') &&
        !isCS && !isCSManager
      ) {
        if (isAdmin) return <Navigate to="/admin/dashboard" replace />;
        if (isItManager) return <Navigate to="/it-manager/dashboard" replace />;
        if (isServiceManager) return <Navigate to="/service-manager/dashboard" replace />;
        return <Navigate to="/employee/dashboard" replace />;
      }
    }
  }

  return children;
}
