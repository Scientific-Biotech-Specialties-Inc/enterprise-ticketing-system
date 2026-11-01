import React, { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

// Vite's BASE_URL is '/', '/ticketing/', or '/customer-service/' depending on context.
const routerBasename = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
import { AuthProvider, useAuth, resolveUserRole, resolveUserDepartment } from '@/context/AuthContext';
import { BranchProvider } from '@/context/BranchContext';
import PrivateRoute from '@/routes/PrivateRoute';
import GuestRoute from '@/routes/GuestRoute';
import AuthGate from '@/routes/AuthGate';
import SkeletonLoader from '@/components/SkeletonLoader.jsx';
import PageTitleUpdater from '@/components/PageTitleUpdater.jsx';
import MaintenanceGate from '@/components/MaintenanceGate.jsx';
import { ToastProvider } from '@/context/ToastContext';

// Lazy loaded page and layout components
const Loginpage = React.lazy(() => import('./pages/Loginpage.jsx'));
const CustomerLayout = React.lazy(() => import('./components/CustomerLayout.jsx'));
const CustomerDashboard = React.lazy(() => import('./pages/CustomerDashboard.jsx'));
const TicketCreation = React.lazy(() => import('./pages/TicketCreation.jsx'));
const MyTickets = React.lazy(() => import('./pages/MyTickets.jsx'));
const CustomerHistory = React.lazy(() => import('./pages/CustomerHistory.jsx'));
const EmployeeLayout = React.lazy(() => import('./components/EmployeeLayout.jsx'));
const EmployeeDashboard = React.lazy(() => import('./pages/EmployeeDashboard.jsx'));
const EmployeeAssigned = React.lazy(() => import('./pages/EmployeeAssigned.jsx'));
const EmployeeMachine = React.lazy(() => import('./pages/EmployeeMachine.jsx'));
const EmployeeProgress = React.lazy(() => import('./pages/EmployeeProgress.jsx'));
const EmployeeRegistration = React.lazy(() => import('./pages/EmployeeRegistration.jsx'));
const EmployeeTicketUpdate = React.lazy(() => import('./pages/EmployeeTicketUpdate.jsx'));
const EmployeeHistoryDetail = React.lazy(() => import('./pages/EmployeeHistoryDetail.jsx'));
const EmployeeMyTickets = React.lazy(() => import('./pages/EmployeeMyTickets.jsx'));
const CSLayout = React.lazy(() => import('./components/CSLayout.jsx'));
const CSDashboard = React.lazy(() => import('./pages/CSDashboard.jsx'));
const CSIncoming = React.lazy(() => import('./pages/CSIncoming.jsx'));
const CSAssigned = React.lazy(() => import('./pages/CSAssigned.jsx'));
const CSHistory = React.lazy(() => import('./pages/CSHistory.jsx'));
const Notifications = React.lazy(() => import('./pages/Notifications.jsx'));
const MessagingPage = React.lazy(() => import('./pages/MessagingPage.jsx'));
const AISupportPage = React.lazy(() => import('./pages/AISupportPage.jsx'));
const Profile = React.lazy(() => import('./pages/Profile.jsx'));

// Lazy loaded SuperAdmin page and layout components
const SuperAdminLayout = React.lazy(() => import('./components/SuperAdminLayout.jsx'));
const SuperAdminTicketConfig = React.lazy(() => import('./pages/SuperAdminTicketConfig.jsx'));
const SuperAdminAuditLogs = React.lazy(() => import('./pages/SuperAdminAuditLogs.jsx'));
const SuperAdminHistory = React.lazy(() => import('./pages/SuperAdminHistory.jsx'));
const AIKnowledgeBase = React.lazy(() => import('./pages/AIKnowledgeBase.jsx'));
const SuperAdminSettings = React.lazy(() => import('./pages/SuperAdminSettings.jsx'));
const SuperAdminDevLogin = React.lazy(() => import('./pages/SuperAdminDevLogin.jsx'));
const LandingPage = React.lazy(() => import('./pages/LandingPage.jsx'));

// Lazy loaded IT Manager components
const ITManagerLayout = React.lazy(() => import('./components/ITManagerLayout.jsx'));
const ITManagerDashboard = React.lazy(() => import('./pages/ITManagerDashboard.jsx'));
const ITManagerTickets = React.lazy(() => import('./pages/ITManagerTickets.jsx'));

// Lazy loaded Admin page and layout components
const AdminLayout = React.lazy(() => import('./components/AdminLayout.jsx'));
const AdminDashboard = React.lazy(() => import('./pages/AdminDashboard.jsx'));
const AdminEmployees = React.lazy(() => import('./pages/AdminEmployees.jsx'));
const AdminReports = React.lazy(() => import('./pages/AdminReports.jsx'));
const AdminSettings = React.lazy(() => import('./pages/AdminSettings.jsx'));
const ExternalFeedbackPage = React.lazy(() => import('./pages/ExternalFeedbackPage.jsx'));

// ─── Role helpers (mirrors GuestRoute / PrivateRoute) ─────────────────────────
const checkIsCS = (user) => {
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
const checkIsSuperAdmin = (user) => {
  if (!user) return false;
  const role = resolveUserRole(user).toLowerCase();
  const dept = resolveUserDepartment(user).toLowerCase();
  return role === 'superadmin' || role === 'super admin' || dept === 'superadmin' || dept === 'super admin';
};
const checkIsAdmin = (user) => {
  if (!user) return false;
  const role = resolveUserRole(user).toLowerCase();
  const dept = resolveUserDepartment(user).toLowerCase();
  return role === 'admin' || role === 'it admin' || (dept === 'admin' && role !== 'superadmin' && role !== 'super admin');
};
const checkIsItManager = (user) => {
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
const checkIsEmployee = (user) => {
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

// ─── Employee Portal Gate ─────────────────────────────────────────────────────
// Smart entry-point for the employee/CS ticketing portal (/ticketing/).
// • Loading    → full-screen spinner (no premature redirect)
// • Authed     → send to the correct role dashboard via React Router Navigate
// • Not authed → hard-navigate to the Auth Module at '/' to log in
function EmployeePortalGate() {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
          <p className="mt-4 text-slate-600 font-medium">Verifying session…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Send back to the Auth Module login page (hard navigate, not React Router)
    window.location.replace('/');
    return null;
  }

  const isSuperAdmin = checkIsSuperAdmin(user);
  const isAdmin      = checkIsAdmin(user);
  const isCS         = checkIsCS(user);
  const isItManager  = checkIsItManager(user);
  const isEmployee   = checkIsEmployee(user);

  if (isSuperAdmin) return <Navigate to="/superadmin/config" replace />;
  if (isAdmin)      return <Navigate to="/admin/dashboard" replace />;
  if (isCS)         return <Navigate to="/cs/dashboard" replace />;
  if (isItManager)  return <Navigate to="/it-manager/dashboard" replace />;
  if (isEmployee)   return <Navigate to="/employee/dashboard" replace />;

  // Unknown role on the employee portal → back to auth module
  window.location.replace('/');
  return null;
}

function App() {
  return (
    <AuthProvider>
      <BranchProvider>
        <ToastProvider>
        <Router basename={routerBasename}>
        <PageTitleUpdater />
        <AuthGate>
          <Suspense fallback={
            <div className="min-h-screen flex flex-col justify-start p-8 bg-gray-50/50 space-y-6">
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
          }>
            <Routes>
              {/* / — customer landing page (customer mode) OR employee portal gate (employee mode) */}
              <Route
                index
                element={
                  import.meta.env.VITE_APP_MODE === 'customer'
                    ? (
                      <GuestRoute>
                        <LandingPage />
                      </GuestRoute>
                    )
                    : <EmployeePortalGate />
                }
              />

              {/* /customer — customer login; does NOT use the auth-module */}
              <Route
                path="/customer"
                element={
                  <GuestRoute>
                    <Loginpage mode="customer" />
                  </GuestRoute>
                }
              />

              {/* /login — redirect appropriately per mode */}
              <Route
                path="/login"
                element={
                  import.meta.env.VITE_APP_MODE === 'customer'
                    ? <Navigate to="/customer" replace />
                    : <EmployeePortalGate />
                }
              />

              {/* Aliases */}
              <Route path="/login/customer" element={<Navigate to="/customer" replace />} />
              <Route
                path="/login/employee"
                element={
                  <GuestRoute>
                    <Loginpage mode="employee" />
                  </GuestRoute>
                }
              />

              {/* /superadmin/dev-login — dev-only mock login */}
              <Route
                path="/superadmin/dev-login"
                element={
                  <GuestRoute>
                    <SuperAdminDevLogin />
                  </GuestRoute>
                }
              />

              {/* External Customer Feedback (accessible directly via email links or portal) */}
              <Route path="/feedback/:ticketId" element={<ExternalFeedbackPage />} />
              <Route path="/feedback" element={<ExternalFeedbackPage />} />

              {/* Protected Customer Routes */}
              <Route element={<CustomerLayout />}>
                <Route path="customer-dashboard" element={<CustomerDashboard />} />
                <Route path="create-ticket" element={<TicketCreation />} />
                <Route path="my-tickets" element={<MyTickets />} />
                <Route path="history" element={<CustomerHistory />} />
                <Route path="messages" element={<MessagingPage />} />
                <Route path="profile" element={<Profile />} />
                <Route path="notifications" element={<Notifications />} />
              </Route>

              {/* Employee Routes */}
              <Route
                path="/employee"
                element={
                  <PrivateRoute role="employee">
                    <EmployeeLayout />
                  </PrivateRoute>
                }
              >
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<EmployeeDashboard />} />
                <Route path="incoming" element={<EmployeeAssigned />} />
                <Route path="assigned" element={<EmployeeAssigned />} />
                <Route path="machine" element={<EmployeeMachine />} />
                <Route path="progress" element={<EmployeeProgress />} />
                <Route path="my-tickets" element={<EmployeeMyTickets />} />
                <Route path="messages" element={<MessagingPage />} />
                <Route path="history/:ticketId" element={<EmployeeHistoryDetail />} />
                <Route path="ticket-update" element={<EmployeeTicketUpdate />} />
                <Route path="registration" element={<EmployeeRegistration />} />
                <Route path="profile" element={<Profile />} />
                <Route path="notifications" element={<Notifications />} />
              </Route>

              <Route path="/employee-dashboard" element={<Navigate to="/employee/dashboard" replace />} />
              <Route path="/employee-assigned" element={<Navigate to="/employee/assigned" replace />} />
              <Route path="/employee-machine" element={<Navigate to="/employee/machine" replace />} />
              <Route path="/employee-progress" element={<Navigate to="/employee/progress" replace />} />
              <Route path="/employee-registration" element={<Navigate to="/employee/registration" replace />} />

              {/* /ai-support — accessible ONLY by customers */}
              <Route
                path="/ai-support"
                element={
                  <PrivateRoute role="customer">
                    <MaintenanceGate>
                      <AISupportPage />
                    </MaintenanceGate>
                  </PrivateRoute>
                }
              />

              {/* IT Manager Routes (Strictly role: it_manager) */}
              <Route
                path="/it-manager"
                element={
                  <PrivateRoute role="it_manager">
                    <ITManagerLayout />
                  </PrivateRoute>
                }
              >
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<ITManagerDashboard />} />
                <Route path="tickets" element={<ITManagerTickets />} />
                <Route path="breached" element={<Navigate to="/it-manager/dashboard" replace />} />
                <Route path="history" element={<CSHistory roleContext="it_manager" />} />
                <Route path="history/:ticketId" element={<EmployeeHistoryDetail />} />
                <Route path="my-tickets" element={<EmployeeMyTickets roleContext="it_manager" />} />
                <Route path="messages" element={<MessagingPage />} />
                <Route path="profile" element={<Profile />} />
                <Route path="notifications" element={<Notifications />} />
              </Route>

              {/* Customer Service (CS) Routes */}
              <Route
                path="/cs"
                element={
                  <PrivateRoute role="cs">
                    <CSLayout />
                  </PrivateRoute>
                }
              >
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<CSDashboard />} />
                <Route path="incoming" element={<CSIncoming />} />
                <Route path="assigned" element={<CSAssigned />} />
                <Route path="my-tickets" element={<EmployeeMyTickets roleContext="cs" />} />
                <Route path="messages" element={<MessagingPage />} />
                <Route path="history" element={<CSHistory />} />
                <Route path="history/:ticketId" element={<EmployeeHistoryDetail />} />
                <Route path="analytics" element={<div className="p-6 text-gray-500">CS Analytics — coming soon.</div>} />
                <Route path="profile" element={<Profile />} />
                <Route path="notifications" element={<Notifications />} />
              </Route>

              {/* SuperAdmin Routes */}
              <Route
                path="/superadmin"
                element={
                  <PrivateRoute role="superadmin">
                    <SuperAdminLayout />
                  </PrivateRoute>
                }
              >
                <Route index element={<Navigate to="config" replace />} />
                <Route path="config" element={<SuperAdminTicketConfig />} />
                <Route path="config/:subtab" element={<SuperAdminTicketConfig />} />
                <Route path="ticket-config" element={<Navigate to="/superadmin/config" replace />} />
                <Route path="ticket-config/:group" element={<SuperAdminTicketConfig />} />
                <Route path="ticket-config/:group/:subtab" element={<SuperAdminTicketConfig />} />
                <Route path="audit-logs" element={<SuperAdminAuditLogs defaultTab="logs" />} />
                <Route path="log-retention" element={<SuperAdminAuditLogs defaultTab="retention" />} />
                <Route path="history" element={<SuperAdminHistory />} />
                <Route path="knowledge-base" element={<AIKnowledgeBase />} />
                <Route path="settings" element={<SuperAdminSettings />} />
                <Route path="profile" element={<Profile />} />
                <Route path="notifications" element={<Notifications />} />
              </Route>

              {/* Admin Routes */}
              <Route
                path="/admin"
                element={
                  <PrivateRoute role="admin">
                    <AdminLayout />
                  </PrivateRoute>
                }
              >
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<AdminDashboard />} />
                <Route path="employees" element={<Navigate to="dashboard" replace />} />
                <Route path="reports" element={<AdminReports />} />
                <Route path="settings" element={<AdminSettings />} />
                <Route path="profile" element={<Profile />} />
                <Route path="notifications" element={<Notifications />} />
              </Route>

              <Route path="/employee-login" element={<Navigate to="/login/employee" replace />} />
              <Route path="/customer-login" element={<Navigate to="/customer" replace />} />

              <Route
                path="*"
                element={
                  <div className="p-8 text-center text-red-500 font-bold">404 Page Not Found</div>
                }
              />
            </Routes>
          </Suspense>
        </AuthGate>
      </Router>
        </ToastProvider>
    </BranchProvider>
    </AuthProvider>
  );
}

export default App;
