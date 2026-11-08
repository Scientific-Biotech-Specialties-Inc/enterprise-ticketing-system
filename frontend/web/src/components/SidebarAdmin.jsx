import React from 'react';
import { LayoutDashboard, Users, BarChart3, Settings } from 'lucide-react';
import SidebarBase from './SidebarBase';

export default function SidebarAdmin({ collapsed, onHoverChange }) {
  const navItems = [
    { name: 'Dashboard', path: '/admin/dashboard', icon: <LayoutDashboard size={20} /> },
    { name: 'Reports', path: '/admin/reports', icon: <BarChart3 size={20} /> },
  ];

  const bottomItems = [
    { name: 'Settings', path: '/admin/settings', icon: <Settings size={20} /> },
  ];

  return <SidebarBase navItems={navItems} bottomItems={bottomItems} collapsed={collapsed} onHoverChange={onHoverChange} />;
}
