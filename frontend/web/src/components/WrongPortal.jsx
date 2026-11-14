import React from 'react';
import { useAuth } from '@/context/AuthContext';

/**
 * WrongPortal / Access Denied Screen
 *
 * Dynamically adapts according to the portal context:
 * - target="customer": Employee attempted to access customer-only portal.
 * - target="employee": Customer attempted to access employee/staff-only portal.
 */
export default function WrongPortal({ portalType }) {
  const { logout } = useAuth();
  const isCustomerSite = import.meta.env.VITE_APP_MODE === 'customer';
  // If portalType is provided use it; otherwise infer from mode:
  // on customer container (isCustomerSite = true), the portal being visited is 'customer'.
  // otherwise, the portal being visited is 'employee'.
  const isCustomerPortal = portalType ? portalType === 'customer' : isCustomerSite;

  const title = isCustomerPortal ? 'Wrong Portal' : 'Access Denied';
  const description = isCustomerPortal ? (
    isCustomerSite ? (
      <>
        This portal is for <strong>customers only</strong>.<br />
        This account can&apos;t be used here.
      </>
    ) : (
      <>
        This portal is for <strong>customers only</strong>.<br />
        Employees and Customer Service agents must log in through the main company portal.
      </>
    )
  ) : (
    <>
      This portal is for <strong>employees and staff only</strong>.<br />
      Customers must access support and ticket management through the customer portal.
    </>
  );

  // Dynamic portal destinations
  const employeePortalUrl = (() => {
    if (import.meta.env.VITE_EMPLOYEE_PORTAL_URL) {
      return import.meta.env.VITE_EMPLOYEE_PORTAL_URL;
    }
    if (typeof window !== 'undefined' && window.location.port === '5006') {
      return `${window.location.protocol}//${window.location.hostname}:5005/ticketing/`;
    }
    return '/ticketing/';
  })();

  const customerPortalUrl = (() => {
    if (import.meta.env.VITE_CUSTOMER_PORTAL_URL) {
      return import.meta.env.VITE_CUSTOMER_PORTAL_URL;
    }
    if (typeof window !== 'undefined' && (window.location.port === '5173' || window.location.port === '5005')) {
      return `${window.location.protocol}//${window.location.hostname}:5006/`;
    }
    return '/';
  })();

  // A customer who opened a staff URL on the customer portal itself stays signed in and goes back
  // to their own dashboard; the employee portal is never offered to them.
  const isStaffUrlOnCustomerSite = isCustomerSite && !isCustomerPortal;
  const customerDashboardUrl = `${(import.meta.env.BASE_URL || '/').replace(/\/$/, '')}/customer-dashboard`;

  // The customer site must never point anyone at the employee portal / central auth module:
  // a non-customer account on the customer site only gets "Log Out", which stays on this site.
  const isNonCustomerOnCustomerSite = isCustomerSite && isCustomerPortal;
  const customerSiteRoot = import.meta.env.BASE_URL || '/';

  const ctaLabel = isNonCustomerOnCustomerSite
    ? null
    : isCustomerPortal
      ? 'Go to Employee Portal'
      : (isStaffUrlOnCustomerSite ? 'Back to My Dashboard' : 'Go to Customer Portal');
  const ctaHref = isCustomerPortal
    ? employeePortalUrl
    : (isStaffUrlOnCustomerSite ? customerDashboardUrl : customerPortalUrl);

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // Background logout cleanup failed silently
    }
    if (typeof window !== 'undefined') {
      const destination = isCustomerSite
        ? customerSiteRoot
        : (isCustomerPortal ? employeePortalUrl : customerPortalUrl);
      window.location.replace(destination);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center max-w-md px-6">
        <div className="text-6xl mb-4 select-none">🚫</div>
        <h1 className="text-2xl font-bold text-gray-800 mb-2">{title}</h1>
        <p className="text-gray-500 mb-6 leading-relaxed">{description}</p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          {ctaLabel && (
            <a
              href={ctaHref}
              className="inline-block px-6 py-3 bg-[#252578] text-white rounded-lg font-medium hover:bg-[#1a1a5e] transition-colors"
            >
              {ctaLabel}
            </a>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="inline-block px-6 py-3 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors"
          >
            Log Out
          </button>
        </div>
      </div>
    </div>
  );
}
