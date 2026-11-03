import React from 'react';
import { LayoutDashboard, Inbox, Clock, ClipboardList, MessageCircle } from 'lucide-react';
import SidebarBase from './SidebarBase';

export default function SidebarServiceManager({ collapsed, onHoverChange }) {
  const navItems = [
    { name: 'Dashboard', path: '/service-manager/dashboard', icon: <LayoutDashboard size={20} /> },
    { name: 'Ticket Queue', path: '/service-manager/tickets', icon: <Inbox size={20} /> },
    { name: 'History', path: '/service-manager/history', icon: <Clock size={20} /> },
  ];

  const bottomItems = [
    { name: 'My Tickets', path: '/service-manager/my-tickets', icon: <ClipboardList size={20} /> },
    { name: 'Messages', path: '/service-manager/messages', icon: <MessageCircle size={20} /> },
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
