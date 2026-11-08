import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import SidebarAdmin from './SidebarAdmin';

export default function AdminLayout() {
  const [sidebarHovered, setSidebarHovered] = useState(false);

  return (
    <div className="min-h-screen bg-page font-sans flex flex-col text-dark-slate w-full max-w-full overflow-x-hidden">
      <Header sidebarHovered={sidebarHovered} />
      <SidebarAdmin collapsed={true} onHoverChange={setSidebarHovered} />

      <main className="pt-24 pb-8 px-4 sm:px-6 lg:px-8 flex-1 sm:ml-20 ml-0 sm:w-[calc(100%-5rem)] w-full min-w-0 max-w-full transition-all">
        <div className="w-full min-w-0 max-w-full">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
