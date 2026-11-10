import React from 'react';
import { LayoutDashboard, BarChart3 } from 'lucide-react';
import SidebarBase from './SidebarBase';

export default function SidebarAdmin({ collapsed, onHoverChange }) {
  const navItems = [
    { name: 'Dashboard', path: '/admin/dashboard', icon: <LayoutDashboard size={20} /> },
    { name: 'Reports', path: '/admin/reports', icon: <BarChart3 size={20} /> },
  ];

  return <SidebarBase navItems={navItems} collapsed={collapsed} onHoverChange={onHoverChange} />;
}
