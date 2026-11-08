import React from 'react';
import ManagerSlaDashboard from '@/components/manager/ManagerSlaDashboard';

/**
 * IT Manager dashboard: live SLA summary and breached queue for tickets assigned to IT staff
 * (spec 0031 AC-8, AC-10). Scope is decided by the server from the signed in manager.
 */
export default function ITManagerDashboard() {
  return (
    <ManagerSlaDashboard
      title="IT Manager Dashboard & SLA Overview"
      subtitle="Live monitoring of IT staff capacity and SLA breaches"
      queueRoute="/it-manager/tickets"
      queueLabel="IT Ticket Queue"
      totalLabel="Open IT Tickets"
      staffLabel="IT Staff"
      breachedDescription="IT tickets past their SLA resolution deadline that need re-assignment or escalation."
      emptyDescription="All open IT tickets are within their SLA resolution window."
    />
  );
}
