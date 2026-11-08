import React from 'react';
import { LayoutDashboard, Inbox, Clock, ClipboardList, MessageCircle } from 'lucide-react';
import SidebarBase from './SidebarBase';

export default function SidebarITManager({ collapsed, onHoverChange }) {
  const navItems = [
    { name: 'Dashboard', path: '/it-manager/dashboard', icon: <LayoutDashboard size={20} /> },
    { name: 'Ticket Queue', path: '/it-manager/tickets', icon: <Inbox size={20} /> },
    { name: 'History', path: '/it-manager/history', icon: <Clock size={20} /> },
  ];

  const bottomItems = [
    { name: 'My Tickets', path: '/it-manager/my-tickets', icon: <ClipboardList size={20} /> },
    { name: 'Messages', path: '/it-manager/messages', icon: <MessageCircle size={20} /> },
  ];

  return (
    <SidebarBase
      navItems={navItems}
      bottomItems={bottomItems}
      collapsed={collapsed}
      onHoverChange={onHoverChange}
    />
  );
}
