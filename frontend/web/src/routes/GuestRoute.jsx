import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, resolveUserRole, resolveUserDepartment } from '@/context/AuthContext';

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
      return <WrongPortal />;
    } else {
      if (isCS)       return <Navigate to="/cs/dashboard" replace />;
      if (isEmployee) return <Navigate to="/employee/dashboard" replace />;
      if (isCustomer) return <Navigate to="/customer-dashboard" replace />;
    }
  }

  return children;
}
