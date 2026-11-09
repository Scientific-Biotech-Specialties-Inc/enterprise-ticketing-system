import React, { useState, useEffect } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import { useAuth } from '@/context/AuthContext';
import PrivateRoute from '@/routes/PrivateRoute';
import ForceChangePasswordModal from './ForceChangePasswordModal';
import MaintenanceGate from './MaintenanceGate';
import tokenStore from '@/auth/tokenStore';

export default function CustomerLayout() {
  const { isAuthenticated, isLoading, isFirstLogin } = useAuth();
  const [sidebarHovered, setSidebarHovered] = useState(false);

  useEffect(() => {
    const handlePageShow = (e) => {
      if (e.persisted) {
        window.location.reload();
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  const isLoggedOut = typeof window !== 'undefined' && sessionStorage.getItem('is_logged_out') === 'true';
  if ((!isLoading && !isAuthenticated) || isLoggedOut) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen bg-page font-sans flex flex-col text-dark-slate w-full max-w-full overflow-x-hidden">
      <Header sidebarHovered={sidebarHovered} />
      
      <Sidebar collapsed={true} onHoverChange={setSidebarHovered} />

      <main className="pt-24 pb-8 px-4 sm:px-6 lg:px-8 flex-1 sm:ml-20 ml-0 sm:w-[calc(100%-5rem)] w-full min-w-0 max-w-full transition-all">
        <div className="w-full min-w-0 max-w-full">
          <PrivateRoute role="customer">
            <MaintenanceGate>
              <Outlet />
            </MaintenanceGate>
          </PrivateRoute>
        </div>
      </main>

      {isFirstLogin && <ForceChangePasswordModal />}
    </div>
  );
}
