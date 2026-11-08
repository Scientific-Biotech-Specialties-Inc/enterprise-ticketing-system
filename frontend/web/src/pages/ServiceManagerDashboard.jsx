import React from 'react';
import ManagerSlaDashboard from '@/components/manager/ManagerSlaDashboard';

/**
 * Service Manager dashboard: live SLA summary and breached queue for tickets assigned to Service staff
 * (spec 0031 AC-8, AC-10). Scope is decided by the server from the signed in manager.
 */
export default function ServiceManagerDashboard() {
  return (
    <ManagerSlaDashboard
      title="Service Manager Dashboard & SLA Overview"
      subtitle="Live monitoring of Service engineering capacity and SLA breaches"
      queueRoute="/service-manager/tickets"
      queueLabel="Service Ticket Queue"
      totalLabel="Open Service Tickets"
      staffLabel="Service Staff"
      breachedDescription="Service tickets past their SLA resolution deadline that need re-assignment or escalation."
      emptyDescription="All open Service tickets are within their SLA resolution window."
    />
  );
}
