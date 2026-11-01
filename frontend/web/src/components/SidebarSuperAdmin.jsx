import React from 'react';
import { Settings, History, ClipboardList, HardDrive, Book } from 'lucide-react';
import SidebarBase from './SidebarBase';

export default function SidebarSuperAdmin({ collapsed, onHoverChange }) {
  const navItems = [
    { name: 'Ticket Configuration', path: '/superadmin/config', icon: <Settings size={20} /> },
    { name: 'AI Knowledge Base', path: '/superadmin/knowledge-base', icon: <Book size={20} /> },
    { name: 'Audit Logs', path: '/superadmin/audit-logs', icon: <ClipboardList size={20} /> },
    { name: 'Log Retention', path: '/superadmin/log-retention', icon: <HardDrive size={20} /> },
    { name: 'History', path: '/superadmin/history', icon: <History size={20} /> },
  ];

  const bottomItems = [
    { name: 'System Settings', path: '/superadmin/settings', icon: <Settings size={20} /> },
  ];

  return <SidebarBase navItems={navItems} bottomItems={bottomItems} collapsed={collapsed} onHoverChange={onHoverChange} />;
}
