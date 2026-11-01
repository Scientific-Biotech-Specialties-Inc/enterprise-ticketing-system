import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, resolveUserRole, resolveUserDepartment } from '@/context/AuthContext';
import tokenStore from '@/auth/tokenStore';

// ─── Role helpers ─────────────────────────────────────────────────────────────
export const checkIsCS = (user) => {
  if (!user) return false;
  const dept = resolveUserDepartment(user).toLowerCase();
  const role = resolveUserRole(user).toLowerCase();
  if (dept.includes('customer service') || dept.includes('customer support') || dept === 'cs') return true;
  return (
    role.includes('customer service') ||
    role.includes('customer-service') ||
    role.includes('head of cs') ||
    role.includes('head of customer service') ||
    role === 'cs' ||
    role === 'head cs'
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

export const checkIsEmployee = (user) => {
  if (!user) return false;
  if (checkIsCS(user)) return false;
  if (checkIsAdmin(user)) return false;
  if (checkIsSuperAdmin(user)) return false;
  if (checkIsItManager(user)) return false;
  const dept = resolveUserDepartment(user).toLowerCase();
  const role = resolveUserRole(user).toLowerCase();
  if (dept === 'service' || dept.includes('engineer')) return true;
  return role === 'employee' || role.includes('service') || role.includes('engineer');
};

// ─── Wrong Portal page ────────────────────────────────────────────────────────
function WrongPortal() {
  const { logout } = useAuth();
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center max-w-md px-6">
        <div className="text-6xl mb-4">🚫</div>
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Wrong Portal</h1>
        <p className="text-gray-500 mb-6">
          This portal is for <strong>customers only</strong>.<br />
          Employees and Customer Service agents must log in through the main company portal.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <a
            href="http://localhost:5173"
            className="inline-block px-6 py-3 bg-[#252578] text-white rounded-lg font-medium hover:bg-[#1a1a5e] transition-colors"
          >
            Go to Employee Portal
          </a>
          <button
            onClick={logout}
            className="inline-block px-6 py-3 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors"
          >
            Log Out & Switch User
          </button>
        </div>
      </div>
    </div>
  );
}


// ─── Private Route ────────────────────────────────────────────────────────────
// isCustomerSite: true when running as the customer-only container (port 5006)
const isCustomerSite = import.meta.env.VITE_APP_MODE === 'customer';

export default function PrivateRoute({ children, role }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  useEffect(() => {
    const handlePageShow = (e) => {
      const token = tokenStore.getToken();
      if ((e.persisted || !isAuthenticated) && !isLoading) {
        if (!isAuthenticated && !token) {
          if (isCustomerSite) {
            window.location.replace(import.meta.env.BASE_URL || '/');
          } else {
            window.location.replace('/');
          }
        }
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, [isLoading, isAuthenticated]);

  // Trap back navigation so the user cannot bounce back to the login page
  useEffect(() => {
    if (isAuthenticated) {
      const handlePopState = () => {
        window.history.pushState(null, '', window.location.href);
      };

      window.history.pushState(null, '', window.location.href);
      window.addEventListener('popstate', handlePopState);

      return () => {
        window.removeEventListener('popstate', handlePopState);
      };
    }
  }, [isAuthenticated, location.pathname]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!isAuthenticated) {
    if (isCustomerSite) {
      // Customer portal: always go to /customer login
      return <Navigate to="/customer" replace state={{ from: location }} />;
    } else {
      // Employee/CS portal: redirect to auth-module root
      if (typeof window !== 'undefined') window.location.replace('/');
      return null;
    }
  }

  // Authenticated — check roles
  const isCS          = checkIsCS(user);
  const isAdmin       = checkIsAdmin(user);
  const isEmployee    = checkIsEmployee(user);
  const isSuperAdmin  = checkIsSuperAdmin(user);
  const isItManager   = checkIsItManager(user);
  const isCustomer    = !isCS && !isEmployee && !isSuperAdmin && !isAdmin && !isItManager;

  // ── Customer portal (port 5006) ──────────────────────────────────────────
  if (isCustomerSite) {
    // Only customers are allowed here
    if (!isCustomer) return <WrongPortal />;
    // Customers can access any customer route — fall through to render
  } else {
    // ── Employee/CS portal (port 5173/5005) ─────────────────────────────────
    if (isCustomer) {
      return <WrongPortal />;
    }

    // Role-specific route authorization
    if (role) {
      const normalizedRole = role.toLowerCase();
      if (isSuperAdmin && normalizedRole !== 'superadmin') {
        return <Navigate to="/superadmin/config" replace />;
      }
      if (isAdmin && normalizedRole !== 'admin') {
        return <Navigate to="/admin/dashboard" replace />;
      }
      if (isItManager && normalizedRole !== 'it_manager' && normalizedRole !== 'it manager') {
        return <Navigate to="/it-manager/dashboard" replace />;
      }
      if ((normalizedRole === 'it_manager' || normalizedRole === 'it manager') && !isItManager) {
        if (isSuperAdmin) return <Navigate to="/superadmin/config" replace />;
        if (isAdmin) return <Navigate to="/admin/dashboard" replace />;
        if (isCS) return <Navigate to="/cs/dashboard" replace />;
        return <Navigate to="/employee/dashboard" replace />;
      }
      if (normalizedRole === 'customer') {
        if (isSuperAdmin) {
          return <Navigate to="/superadmin/config" replace />;
        }
        if (isAdmin) {
          return <Navigate to="/admin/dashboard" replace />;
        }
        if (isCS) {
          return <Navigate to="/cs/dashboard" replace />;
        }
        if (isEmployee) {
          return <Navigate to="/employee/dashboard" replace />;
        }
      }
      if (normalizedRole === 'admin' && !isAdmin) {
        if (isSuperAdmin) return <Navigate to="/superadmin/config" replace />;
        if (isCS) return <Navigate to="/cs/dashboard" replace />;
        return <Navigate to="/employee/dashboard" replace />;
      }
      if (normalizedRole === 'superadmin' && !isSuperAdmin) {
        if (isAdmin) return <Navigate to="/admin/dashboard" replace />;
        return <Navigate to="/employee/dashboard" replace />;
      }
      if (normalizedRole === 'employee' && !isEmployee) {
        if (isAdmin) return <Navigate to="/admin/dashboard" replace />;
        return <Navigate to="/cs/dashboard" replace />;
      }
      if (
        (normalizedRole === 'cs' ||
          normalizedRole === 'customer service' ||
          normalizedRole === 'customer-service' ||
          normalizedRole === 'head of cs' ||
          normalizedRole === 'head of customer service') &&
        !isCS
      ) {
        if (isAdmin) return <Navigate to="/admin/dashboard" replace />;
        return <Navigate to="/employee/dashboard" replace />;
      }
    }
  }

  return children;
}
