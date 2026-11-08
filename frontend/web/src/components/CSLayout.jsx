import React, { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import SidebarCS from './SidebarCS';
import { CS_TICKET_REFRESH_EVENT } from '@/services/ticketService';
import { useAuth } from '@/context/AuthContext';
import ForceChangePasswordModal from './ForceChangePasswordModal';
import MaintenanceGate from './MaintenanceGate';

export default function CSLayout() {
  const { isFirstLogin } = useAuth();
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const handleTicketRefresh = () => {
      setRefreshKey((current) => current + 1);
    };

    window.addEventListener(CS_TICKET_REFRESH_EVENT, handleTicketRefresh);

    return () => {
      window.removeEventListener(CS_TICKET_REFRESH_EVENT, handleTicketRefresh);
    };
  }, []);

  return (
    <div className="min-h-screen bg-page font-sans flex flex-col text-dark-slate w-full max-w-full overflow-x-hidden">
      <Header sidebarHovered={sidebarHovered} />
      <SidebarCS collapsed={true} onHoverChange={setSidebarHovered} />

      <main className="pt-24 pb-8 px-4 sm:px-6 lg:px-8 flex-1 sm:ml-20 ml-0 sm:w-[calc(100%-5rem)] w-full min-w-0 max-w-full transition-all">
        <div className="w-full min-w-0 max-w-full">
          <MaintenanceGate>
            <Outlet context={{ refreshKey }} />
          </MaintenanceGate>
        </div>
      </main>

      {isFirstLogin && <ForceChangePasswordModal />}
    </div>
  );
}

