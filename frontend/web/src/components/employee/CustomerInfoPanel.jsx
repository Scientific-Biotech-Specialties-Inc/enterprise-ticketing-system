import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  User,
  Phone,
  Mail,
  MapPin,
  Wrench,
  Cpu,
  Clock,
  History,
  AlertTriangle,
  RefreshCw,
  Copy,
  Check,
  ShieldCheck,
  Lock,
} from 'lucide-react';
import { getCustomerTicketContext } from '@/services/ticketService';
import { formatDisplayDate } from '@/utils/dateUtils';

/**
 * Customer & Equipment Context Panel (TS029)
 *
 * Displays read-only customer contact info, machine hardware specifications,
 * and related ticket history summary for assigned technicians and CS staff.
 */
export default function CustomerInfoPanel({
  ticketId,
  ticket = {},
  user = null,
  onViewRelatedTicket,
  className = '',
}) {
  const [loading, setLoading] = useState(false);
  const [context, setContext] = useState(null);
  const [isCachedFallback, setIsCachedFallback] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [copiedSerial, setCopiedSerial] = useState(false);

  // Check authorization: Must be currently assigned employee or CS/Admin role
  const isAuthorized = useMemo(() => {
    if (!user) return true;
    const role = String(user.role || '').toLowerCase().trim();
    const isCSOrAdmin = ['cs', 'customer support', 'customer service', 'head of cs', 'head of customer service', 'admin', 'superadmin', 'super admin'].includes(role);
    if (isCSOrAdmin) return true;

    const empId = user.emp_id || user.id;
    if (!empId) return true;

    // Check if user is assigned to this ticket
    const assignedTo = ticket.assigned_to;
    const isDirectlyAssigned = Number(assignedTo) === Number(empId);
    const isInAssignments = Array.isArray(ticket.assigned) && ticket.assigned.map(Number).includes(Number(empId));
    const isInEmployeesList = Array.isArray(ticket.assigned_employees) && ticket.assigned_employees.some(e => Number(e.id || e.emp_id) === Number(empId));

    return isDirectlyAssigned || isInAssignments || isInEmployeesList;
  }, [user, ticket]);

  const loadContext = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    setErrorMsg('');

    try {
      const res = await getCustomerTicketContext(ticketId);
      if (res && res.customer) {
        setContext(res);
        setIsCachedFallback(false);
      } else {
        throw new Error('Customer context data unavailable');
      }
    } catch (err) {
      console.warn('Customer context fetch error, falling back to cached ticket info:', err);
      setIsCachedFallback(true);
      setErrorMsg('Customer Management System is currently unreachable. Displaying cached ticket context.');

      // Synthesize cached fallback from ticket properties
      setContext({
        customer: {
          type: ticket.is_internal ? 'internal_employee' : 'customer',
          name: ticket.customer || ticket.client_name || 'Customer',
          email: ticket.customer_email || ticket.email || null,
          phone: ticket.contact_number || ticket.customer_phone || ticket.phone || null,
          address: ticket.facility || ticket.address || null,
          preferred_contact_method: ticket.phone ? 'Phone' : 'Email',
          missing_fields: [],
        },
        machine: ticket.machine_name || ticket.equipment ? {
          linked: true,
          machine_name: ticket.machine_name || ticket.equipment,
          brand: ticket.machine_brand || ticket.brand || '—',
          model: ticket.machine_model || ticket.model || '—',
          serial_number: ticket.serial_number || 'N/A',
          status: 'Active',
          category: ticket.category || 'General',
          location: ticket.facility || 'Customer Site',
          history_summary: {
            past_ticket_count: 0,
            last_service_date: null,
          },
        } : null,
      });
    } finally {
      setLoading(false);
    }
  }, [ticketId, ticket]);

  useEffect(() => {
    if (ticketId && isAuthorized) {
      loadContext();
    }
  }, [ticketId, isAuthorized, loadContext]);

  const handleCopySerial = (serial) => {
    if (!serial || serial === 'N/A') return;
    navigator.clipboard.writeText(serial);
    setCopiedSerial(true);
    setTimeout(() => setCopiedSerial(false), 2000);
  };

  if (!isAuthorized) {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
        <Lock size={20} className="text-slate-400" />
        <p className="font-semibold text-slate-700">Customer & Machine Context Restricted</p>
        <p>Customer contact and equipment records are strictly restricted to the assigned employee and CS staff.</p>
      </div>
    );
  }

  const customerData = context?.customer;
  const machineData = context?.machine;
  const historySummary = machineData?.history_summary;

  return (
    <div
      role="region"
      aria-label="Customer and Equipment Context"
      className={`bg-white rounded-2xl border border-gray-150 shadow-sm p-6 space-y-5 text-left transition-all ${className}`}
    >
      {/* Header with Read-Only Badge */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-50 text-[#252578] flex items-center justify-center shrink-0">
            <User size={16} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-gray-900">Customer & Equipment Context</h3>
              <span className="text-[10px] bg-gray-100 text-gray-600 font-bold px-2 py-0.5 rounded-full uppercase border border-gray-200 inline-flex items-center gap-1">
                <ShieldCheck size={11} className="text-gray-500" /> Read-Only
              </span>
            </div>
            <p className="text-xs text-gray-500">Verified contact and equipment details for this ticket.</p>
          </div>
        </div>

        {isCachedFallback && (
          <button
            type="button"
            onClick={loadContext}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-amber-300 bg-amber-50 text-amber-800 text-xs font-semibold hover:bg-amber-100 transition disabled:opacity-50 cursor-pointer"
            title="Retry connecting to live customer database"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Retrying...' : 'Retry Live Sync'}
          </button>
        )}
      </div>

      {/* CMS-Unavailable / Cached Data Alert */}
      {isCachedFallback && (
        <div
          role="alert"
          className="rounded-xl bg-amber-50 border border-amber-200 p-3.5 text-xs text-amber-900 flex items-start gap-2.5 animate-fadeIn"
        >
          <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 leading-relaxed">
            <span className="font-bold">CMS Unavailable:</span> {errorMsg}
            <span className="block text-[11px] text-amber-700 mt-0.5">
              Contact and equipment data below is derived from cached ticket records. Live updates will resume once connection is restored.
            </span>
          </div>
        </div>
      )}

      {/* 2-Column Responsive Layout for Customer + Machine */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Customer Information Card */}
        <div className="bg-slate-50/70 border border-slate-200/80 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <User size={13} className="text-slate-400" />
              {customerData?.type === 'internal_employee' ? 'Internal Requester' : 'Customer Contact Details'}
            </span>
            <span className="text-[10px] bg-white border border-slate-200 text-slate-600 font-semibold px-2 py-0.5 rounded-full">
              {customerData?.type === 'internal_employee' ? 'Staff' : 'Client Profile'}
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div>
              <span className="text-gray-400 block text-[10px] uppercase font-semibold">Name</span>
              <p className="font-bold text-gray-800 text-sm">{customerData?.name || ticket.customer || '—'}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <div>
                <span className="text-gray-400 block text-[10px] uppercase font-semibold">Phone Number</span>
                {customerData?.phone ? (
                  <a
                    href={`tel:${customerData.phone}`}
                    className="font-semibold text-blue-600 hover:underline flex items-center gap-1 mt-0.5"
                  >
                    <Phone size={11} className="text-blue-500 shrink-0" />
                    <span>{customerData.phone}</span>
                  </a>
                ) : (
                  <span className="text-gray-400 italic">Not available</span>
                )}
              </div>

              <div>
                <span className="text-gray-400 block text-[10px] uppercase font-semibold">Email Address</span>
                {customerData?.email ? (
                  <a
                    href={`mailto:${customerData.email}`}
                    className="font-semibold text-blue-600 hover:underline flex items-center gap-1 mt-0.5 truncate"
                    title={customerData.email}
                  >
                    <Mail size={11} className="text-blue-500 shrink-0" />
                    <span className="truncate">{customerData.email}</span>
                  </a>
                ) : (
                  <span className="text-gray-400 italic">Not available</span>
                )}
              </div>
            </div>

            <div className="pt-1">
              <span className="text-gray-400 block text-[10px] uppercase font-semibold">Location / Address</span>
              <div className="flex items-start gap-1.5 text-gray-700 mt-0.5">
                <MapPin size={13} className="text-gray-400 shrink-0 mt-0.5" />
                <span className="leading-snug">{customerData?.address || ticket.facility || 'Customer Site'}</span>
              </div>
            </div>

            {customerData?.preferred_contact_method && (
              <div className="pt-1 text-[11px] text-gray-500 flex items-center gap-1.5">
                <span className="font-semibold text-gray-600">Preferred Channel:</span>
                <span className="bg-white px-2 py-0.5 rounded border border-gray-200 font-medium text-gray-700">
                  {customerData.preferred_contact_method}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Machine & Equipment Details Card */}
        <div className="bg-slate-50/70 border border-slate-200/80 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-200/60 pb-2">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Wrench size={13} className="text-slate-400" />
              Machine & Equipment Details
            </span>
            <span className="text-[10px] bg-white border border-slate-200 text-slate-600 font-semibold px-2 py-0.5 rounded-full">
              {machineData?.category || ticket.category || 'Asset'}
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <div>
              <span className="text-gray-400 block text-[10px] uppercase font-semibold">Machine Name</span>
              <p className="font-bold text-gray-800 text-sm">
                {machineData?.machine_name || ticket.equipment || ticket.machine_name || 'No machine linked'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <span className="text-gray-400 block text-[10px] uppercase font-semibold">Brand / Make</span>
                <p className="font-medium text-gray-700 mt-0.5">{machineData?.brand || machineData?.make || '—'}</p>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px] uppercase font-semibold">Model</span>
                <p className="font-medium text-gray-700 mt-0.5">{machineData?.model || '—'}</p>
              </div>
            </div>

            <div className="pt-1">
              <span className="text-gray-400 block text-[10px] uppercase font-semibold">Serial Number</span>
              <div className="flex items-center gap-2 mt-0.5">
                <code className="bg-white border border-gray-200 px-2 py-1 rounded text-xs font-mono font-bold text-gray-800 tracking-wider">
                  {machineData?.serial_number || ticket.serial_number || 'N/A'}
                </code>
                {machineData?.serial_number && machineData.serial_number !== 'N/A' && (
                  <button
                    type="button"
                    onClick={() => handleCopySerial(machineData.serial_number)}
                    className="p-1 text-gray-400 hover:text-gray-600 rounded transition cursor-pointer"
                    title="Copy serial number"
                    aria-label="Copy serial number"
                  >
                    {copiedSerial ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                  </button>
                )}
              </div>
            </div>

            {machineData?.last_maintenance_date && (
              <div className="pt-1 text-[11px] text-gray-500 flex items-center gap-1.5">
                <Clock size={12} className="text-gray-400" />
                <span>Last Maintenance: {formatDisplayDate(machineData.last_maintenance_date)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Related Ticket History Summary Component */}
      <div className="bg-blue-50/60 border border-blue-150 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[#252578]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
            <History size={16} className="text-[#252578]" />
          </div>
          <div>
            <h4 className="font-bold text-gray-900">Related Machine Service History</h4>
            <p className="text-gray-600 text-xs mt-0.5">
              {historySummary && Number(historySummary.past_ticket_count) > 0 ? (
                <span>
                  This machine has <strong className="font-semibold">{historySummary.past_ticket_count}</strong> prior service ticket{historySummary.past_ticket_count === 1 ? '' : 's'} on record.
                  {historySummary.last_service_date && (
                    <span> Last service resolved on {formatDisplayDate(historySummary.last_service_date)}.</span>
                  )}
                </span>
              ) : (
                <span>No prior tickets recorded for this machine serial number. First incident on record.</span>
              )}
            </p>
          </div>
        </div>

        {historySummary && Number(historySummary.past_ticket_count) > 0 && typeof onViewRelatedTicket === 'function' && (
          <button
            type="button"
            onClick={() => onViewRelatedTicket(machineData?.machine_id || ticket.machine_ID)}
            className="px-3.5 py-1.5 bg-white border border-blue-200 text-[#252578] hover:bg-blue-50 rounded-xl font-semibold transition shrink-0 cursor-pointer text-xs"
          >
            View History ({historySummary.past_ticket_count})
          </button>
        )}
      </div>
    </div>
  );
}
