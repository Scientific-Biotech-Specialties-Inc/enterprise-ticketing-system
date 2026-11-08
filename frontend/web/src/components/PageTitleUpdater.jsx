import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Route pattern to page name mapping.
 * Titles will be formatted as: `"[Page Name] – SBSI"`
 */
const ROUTE_MAP = [
  // Customer Portal Routes
  { pattern: /^\/customer-dashboard\/?$/, title: 'Customer Dashboard' },
  { pattern: /^\/create-ticket\/?$/, title: 'Create Ticket' },
  { pattern: /^\/my-tickets\/?$/, title: 'My Tickets' },
  { pattern: /^\/history\/?$/, title: 'Ticket History' },
  { pattern: /^\/customer\/?$/, title: 'Customer Login' },
  { pattern: /^\/customer-login\/?$/, title: 'Customer Login' },

  // CS (Customer Service) Routes
  { pattern: /^\/cs\/dashboard\/?$/, title: 'CSR Dashboard' },
  { pattern: /^\/cs\/incoming\/?$/, title: 'Incoming Tickets' },
  { pattern: /^\/cs\/assigned\/?$/, title: 'Assigned Tickets' },
  { pattern: /^\/cs\/my-tickets\/?$/, title: 'My Tickets' },
  { pattern: /^\/cs\/history\/[^/]+\/?$/, title: 'Ticket History Detail' },
  { pattern: /^\/cs\/history\/?$/, title: 'Ticket History' },
  { pattern: /^\/cs\/analytics\/?$/, title: 'CS Analytics' },
  { pattern: /^\/cs\/messages\/?$/, title: 'Messages' },
  { pattern: /^\/cs\/profile\/?$/, title: 'Profile' },
  { pattern: /^\/cs\/notifications\/?$/, title: 'Notifications' },
  { pattern: /^\/cs\/?$/, title: 'CSR Dashboard' },

  // Employee (Service Engineer) Routes
  { pattern: /^\/employee\/dashboard\/?$/, title: 'Employee Dashboard' },
  { pattern: /^\/employee\/incoming\/?$/, title: 'Assigned Tickets' },
  { pattern: /^\/employee\/assigned\/?$/, title: 'Assigned Tickets' },
  { pattern: /^\/employee\/machine\/?$/, title: 'Machine Directory' },
  { pattern: /^\/employee\/progress\/?$/, title: 'Ticket Progress' },
  { pattern: /^\/employee\/my-tickets\/?$/, title: 'My Tickets' },
  { pattern: /^\/employee\/history\/[^/]+\/?$/, title: 'Ticket History Detail' },
  { pattern: /^\/employee\/ticket-update\/?$/, title: 'Ticket Update' },
  { pattern: /^\/employee\/registration\/?$/, title: 'Employee Registration' },
  { pattern: /^\/employee\/messages\/?$/, title: 'Messages' },
  { pattern: /^\/employee\/profile\/?$/, title: 'Profile' },
  { pattern: /^\/employee\/notifications\/?$/, title: 'Notifications' },
  { pattern: /^\/employee\/?$/, title: 'Employee Dashboard' },

  // Admin Routes
  { pattern: /^\/admin\/dashboard\/?$/, title: 'Admin Dashboard' },
  { pattern: /^\/admin\/reports\/?$/, title: 'Reports & Analytics' },
  { pattern: /^\/admin\/settings\/?$/, title: 'System Settings' },
  { pattern: /^\/admin\/profile\/?$/, title: 'Profile' },
  { pattern: /^\/admin\/notifications\/?$/, title: 'Notifications' },
  { pattern: /^\/admin\/?$/, title: 'Admin Dashboard' },

  // SuperAdmin Routes
  { pattern: /^\/superadmin\/(ticket-config|config)(\/.*)?$/, title: 'Ticket Configuration' },
  { pattern: /^\/superadmin\/audit-logs\/?$/, title: 'Audit Logs' },
  { pattern: /^\/superadmin\/history\/?$/, title: 'System History' },
  { pattern: /^\/superadmin\/knowledge-base\/?$/, title: 'Knowledge Base' },
  { pattern: /^\/superadmin\/settings\/?$/, title: 'System Settings' },
  { pattern: /^\/superadmin\/dev-login\/?$/, title: 'Dev Login' },
  { pattern: /^\/superadmin\/profile\/?$/, title: 'Profile' },
  { pattern: /^\/superadmin\/notifications\/?$/, title: 'Notifications' },
  { pattern: /^\/superadmin\/?$/, title: 'Ticket Configuration' },

  // Shared / Top-level Routes
  { pattern: /^\/messages\/?$/, title: 'Messages' },
  { pattern: /^\/ai-support\/?$/, title: 'AI Support' },
  { pattern: /^\/profile\/?$/, title: 'Profile' },
  { pattern: /^\/notifications\/?$/, title: 'Notifications' },
  { pattern: /^\/login\/employee\/?$/, title: 'Employee Login' },
  { pattern: /^\/login\/?$/, title: 'Login' },
  { pattern: /^\/employee-login\/?$/, title: 'Employee Login' },
];

export function resolvePageTitle(pathname) {
  const cleanPath = pathname.replace(/\/+$/, '') || '/';

  if (cleanPath === '/') {
    return import.meta.env.VITE_APP_MODE === 'customer' ? 'Welcome' : 'Ticketing Portal';
  }

  for (const entry of ROUTE_MAP) {
    if (entry.pattern.test(cleanPath)) {
      return entry.title;
    }
  }

  // Fallback: extract last readable path segment or generic
  const segments = cleanPath.split('/').filter(Boolean);
  if (segments.length > 0) {
    const raw = segments[segments.length - 1];
    return raw
      .split(/[-_]/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  return 'Ticketing System';
}

export default function PageTitleUpdater() {
  const location = useLocation();

  useEffect(() => {
    const pageName = resolvePageTitle(location.pathname);
    document.title = `${pageName} – SBSI`;
  }, [location.pathname]);

  return null;
}
