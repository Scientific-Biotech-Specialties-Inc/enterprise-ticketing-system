import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, resolveUserRole, resolveUserDepartment } from '@/context/AuthContext';
import WrongPortal from '@/components/WrongPortal.jsx';

// ─── Role helpers (shared) ────────────────────────────────────────────────────
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

export const checkIsEmployee = (user) => {
  if (!user) return false;
  if (checkIsCS(user)) return false;
  if (checkIsAdmin(user)) return false;
  if (checkIsSuperAdmin(user)) return false;
  const dept = resolveUserDepartment(user).toLowerCase();
  const role = resolveUserRole(user).toLowerCase();
  if (dept === 'service' || dept.includes('engineer')) return true;
  return role === 'employee' || role.includes('service') || role.includes('engineer');
};

// ─── Guest Route ──────────────────────────────────────────────────────────────
// isCustomerSite: true when running as the customer-only container (port 5006)
const isCustomerSite = import.meta.env.VITE_APP_MODE === 'customer';

export default function GuestRoute({ children }) {
  const { isAuthenticated, isLoading, user, isFirstLogin } = useAuth();
  const location = useLocation();

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

  if (isAuthenticated && !isFirstLogin) {
    const isSuperAdmin = checkIsSuperAdmin(user);
    const isAdmin      = checkIsAdmin(user);
    const isCS         = checkIsCS(user);
    const isEmployee   = checkIsEmployee(user);
    const isCustomer   = !isCS && !isEmployee && !isSuperAdmin && !isAdmin;

    if (isSuperAdmin) {
      return <Navigate to="/superadmin/dashboard" replace />;
    }
    if (isAdmin) {
      return <Navigate to="/admin/dashboard" replace />;
    }
    if (isCustomerSite) {
      if (isCustomer) {
        return <Navigate to="/customer-dashboard" replace />;
      }
      return <WrongPortal portalType="customer" />;
    } else {
      if (isCS)       return <Navigate to="/cs/dashboard" replace />;
      if (isEmployee) return <Navigate to="/employee/dashboard" replace />;
      if (isCustomer) return <Navigate to="/customer-dashboard" replace />;
    }
  }

  return children;
}
