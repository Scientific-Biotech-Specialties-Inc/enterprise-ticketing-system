import React from 'react';
import ManagerSlaDashboard from '@/components/manager/ManagerSlaDashboard';

/**
 * Customer Service Manager dashboard: live SLA summary and breached queue for every ticket in the branch,
 * unassigned ones included (spec 0031 AC-8, AC-10). Scope is decided by the server from the signed in manager.
 */
export default function CSManagerDashboard() {
  return (
    <ManagerSlaDashboard
      title="CS Manager Dashboard & SLA Overview"
      subtitle="Live monitoring of branch wide ticket SLAs, including unassigned breaches"
      queueRoute="/cs-manager/tickets"
      queueLabel="CS Ticket Queue"
      totalLabel="Open Branch Tickets"
      staffLabel="Assignable Staff"
      breachedDescription="Branch tickets past their SLA resolution deadline. Unassigned breaches need triage here."
      emptyDescription="All open branch tickets are within their SLA resolution window."
    />
  );
}
