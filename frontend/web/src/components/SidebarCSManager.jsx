import React from 'react';
import { LayoutDashboard, Inbox, Clock, ClipboardList, MessageCircle } from 'lucide-react';
import SidebarBase from './SidebarBase';

export default function SidebarCSManager({ collapsed, onHoverChange }) {
  const navItems = [
    { name: 'Dashboard', path: '/cs-manager/dashboard', icon: <LayoutDashboard size={20} /> },
    { name: 'Ticket Queue', path: '/cs-manager/tickets', icon: <Inbox size={20} /> },
    { name: 'History', path: '/cs-manager/history', icon: <Clock size={20} /> },
  ];

  const bottomItems = [
    { name: 'My Tickets', path: '/cs-manager/my-tickets', icon: <ClipboardList size={20} /> },
    { name: 'Messages', path: '/cs-manager/messages', icon: <MessageCircle size={20} /> },
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
