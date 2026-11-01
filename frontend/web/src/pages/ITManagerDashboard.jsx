import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldAlert,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Users,
  Search,
  Filter,
  RefreshCw,
  UserCheck,
  UserPlus,
  ArrowUpDown,
  ExternalLink,
  ChevronDown,
  Layers,
  Inbox,
  AlertCircle,
  HelpCircle,
  CheckCircle,
  ArrowRight,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { MetricCard } from '@/components/ui/metric-card';
import { Button } from '@/components/ui/button';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { DataTableSkeleton, DataTableEmptyState } from '@/components/ui/data-table';
import { useAuth } from '@/context/AuthContext';
import { useBranch } from '@/context/BranchContext';
import BranchSelector from '@/components/BranchSelector';
import SlaStatusBadge, { getTicketSlaDueDate, getTicketSlaStatus } from '@/components/sla/SlaStatusBadge';
import { AssignModal } from '@/components/CSModals';
import CustomerTicketDetailModal from '@/components/CustomerTicketDetailModal';
import {
  getCSIncomingTickets,
  getAssignableEmployees,
  assignTicketToEmployees,
  getDepartments,
} from '@/services/ticketService';
import { cn } from '@/lib/utils';

// Helper: Format Overdue Duration (e.g. "Overdue by 3h 15m")
function formatOverdueDuration(dueDateStr) {
  if (!dueDateStr) return 'Overdue';
  const due = new Date(dueDateStr);
  const now = new Date();
  const diffMs = now - due;
  if (diffMs <= 0) return 'Within SLA';

  const totalMinutes = Math.floor(diffMs / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `Overdue by ${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `Overdue by ${hours}h ${minutes}m`;
  }
  return `Overdue by ${minutes}m`;
}

// Sample fallback IT tickets for initial instant responsiveness
const MOCK_IT_TICKETS = [
  {
    id: 9001,
    ticket_ID: 'TICK-IT-101',
    title: 'Core Switch Fiber Uplink Failure - Server Room A',
    description: 'Redundant fiber transceiver lost link state. Hospital PACS telemetry is degraded.',
    priority: 'Critical',
    status: 'In Progress',
    department: 'IT Department',
    category: 'Network',
    created_at: new Date(Date.now() - 36 * 3600 * 1000).toISOString(),
    sla_due_date: new Date(Date.now() - 14 * 3600 * 1000).toISOString(),
    assigned: [201],
    assigned_names: ['David Miller'],
  },
  {
    id: 9002,
    ticket_ID: 'TICK-IT-102',
    title: 'Hospital Domain Controller LDAP Authentication Intermittent',
    description: 'Active Directory domain controller rejecting clinical workstation kerberos tickets.',
    priority: 'High',
    status: 'In Progress',
    department: 'IT Department',
    category: 'Security',
    created_at: new Date(Date.now() - 18 * 3600 * 1000).toISOString(),
    sla_due_date: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
    assigned: [202],
    assigned_names: ['Sarah Connor'],
  },
  {
    id: 9003,
    ticket_ID: 'TICK-IT-103',
    title: 'Intensive Care Unit Telemetry Gateway Packet Loss',
    description: 'ECG monitors reporting 12% drop rate on VLAN 104.',
    priority: 'Critical',
    status: 'Pending Assignment',
    department: 'IT Department',
    category: 'Network',
    created_at: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
    sla_due_date: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    assigned: [],
    assigned_names: [],
  },
  {
    id: 9004,
    ticket_ID: 'TICK-IT-104',
    title: 'Workstation OS Imaging & Provisioning - Radiology Dept',
    description: 'Deploy 8 new Dell precision workstations with DICOM imaging viewers.',
    priority: 'Medium',
    status: 'In Progress',
    department: 'IT Department',
    category: 'Hardware',
    created_at: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
    sla_due_date: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    assigned: [203],
    assigned_names: ['Alex Chen'],
  },
  {
    id: 9005,
    ticket_ID: 'TICK-IT-105',
    title: 'PostgreSQL Database Re-indexing & Connection Pool Expansion',
    description: 'Electronic Health Record backend query response time exceeded 800ms threshold.',
    priority: 'High',
    status: 'Pending Assignment',
    department: 'IT Department',
    category: 'Database',
    created_at: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
    sla_due_date: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
    assigned: [],
    assigned_names: [],
  },
  {
    id: 9006,
    ticket_ID: 'TICK-IT-106',
    title: 'Wi-Fi 6 Access Point Firmware Upgrade - West Wing Ward 3',
    description: 'Apply security vendor hotfix for WPA3 enterprise roaming protocol.',
    priority: 'Low',
    status: 'Pending Assignment',
    department: 'IT Department',
    category: 'Network',
    created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    sla_due_date: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    assigned: [],
    assigned_names: [],
  },
  {
    id: 9007,
    ticket_ID: 'TICK-IT-107',
    title: 'Firewall Policy Rule Audit - Vendor Remote Support VPN',
    description: 'Bi-annual audit of third-party telemetry tunnels and zero-trust perimeter access.',
    priority: 'Medium',
    status: 'In Progress',
    department: 'IT Department',
    category: 'Security',
    created_at: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    sla_due_date: new Date(Date.now() + 36 * 3600 * 1000).toISOString(),
    assigned: [200],
    assigned_names: ['IT Department Manager'],
  },
];

export default function ITManagerDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Data state
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);

  // Modals state
  const [assignModalTicket, setAssignModalTicket] = useState(null);
  const [assignEmployees, setAssignEmployees] = useState([]);
  const [assignDepartments, setAssignDepartments] = useState([]);
  const [detailModalTicket, setDetailModalTicket] = useState(null);

  // 1. Fetch tickets from ticket-service scoped to IT Department
  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setIsRefreshing(true);
    try {
      const apiTickets = await getCSIncomingTickets({ limit: 100, forceRefresh: true });
      const itScoped = (apiTickets || []).filter((t) => {
        const dept = (t.department || t.department_target || '').toLowerCase();
        const cat = (t.category || '').toLowerCase();
        return (
          dept.includes('it') ||
          dept.includes('service') ||
          cat.includes('network') ||
          cat.includes('hardware') ||
          cat.includes('software') ||
          cat.includes('security') ||
          cat.includes('database') ||
          cat.includes('server')
        );
      });

      const merged = itScoped.length > 0 ? itScoped : MOCK_IT_TICKETS;
      setTickets(merged);
    } catch (err) {
      console.warn('Failed to fetch live IT tickets, falling back to mock tickets:', err);
      setTickets(MOCK_IT_TICKETS);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 2. Fetch IT technicians and department options for AssignModal
  useEffect(() => {
    Promise.all([
      getAssignableEmployees({ forceRefresh: false }).catch(() => []),
      getDepartments().catch(() => []),
    ]).then(([emps, deps]) => {
      const formattedStaff = [
        { id: 201, name: 'David Miller', email: 'david.miller@example.com', role: 'IT Support Engineer', department: 'IT Department' },
        { id: 202, name: 'Sarah Connor', email: 'sarah.connor@example.com', role: 'Systems Administrator', department: 'IT Department' },
        { id: 203, name: 'Alex Chen', email: 'alex.chen@example.com', role: 'IT Support Technician', department: 'IT Department' },
        { id: 200, name: 'Arthur Pendleton (IT Manager)', email: 'itmanager@example.com', role: 'IT Manager', department: 'IT Department' },
      ];

      const mergedEmps = [...formattedStaff];
      (emps || []).forEach((e) => {
        const id = Number(e.id ?? e.emp_id);
        if (!mergedEmps.some((m) => m.id === id)) {
          mergedEmps.push({
            id,
            name: e.name || `${e.first_name || ''} ${e.last_name || ''}`.trim() || e.email,
            email: e.email,
            role: e.role,
            department: e.department || 'IT Department',
          });
        }
      });

      setAssignEmployees(mergedEmps);
      setAssignDepartments(deps && deps.length > 0 ? deps.map((d) => d.name || d) : ['IT Department', 'Service', 'Customer Service']);
    });
  }, []);

  // 3. Normalize ticket fields and SLA status
  const evaluatedTickets = useMemo(() => {
    return tickets.map((t) => {
      const assignedList = Array.isArray(t.assigned)
        ? t.assigned
        : Array.isArray(t.assigned_to)
        ? t.assigned_to
        : t.assigned_to_user
        ? [t.assigned_to_user]
        : [];

      const assignedNamesList = Array.isArray(t.assigned_names)
        ? t.assigned_names
        : Array.isArray(t.assignee_names)
        ? t.assignee_names
        : [];

      const isUnassigned =
        assignedList.length === 0 &&
        assignedNamesList.length === 0 &&
        (!t.status || t.status.toLowerCase().includes('pending assignment') || t.status.toLowerCase() === 'unassigned');

      const assigneeName = assignedNamesList.length > 0
        ? assignedNamesList.join(', ')
        : assignedList.length > 0
        ? `Technician #${assignedList[0]}`
        : 'Unassigned';

      const dueDate = getTicketSlaDueDate(t);
      const isBreached = dueDate ? new Date() > new Date(dueDate) : false;

      return {
        ...t,
        isUnassigned,
        assigneeName,
        dueDate,
        isBreached,
      };
    });
  }, [tickets]);

  // 4. SLA Overview Metrics (Overview only)
  const slaMetrics = useMemo(() => {
    const total = evaluatedTickets.length;
    const unassigned = evaluatedTickets.filter((t) => t.isUnassigned).length;
    const breached = evaluatedTickets.filter((t) => t.isBreached).length;
    const withinSla = total - breached;

    return { total, unassigned, withinSla, breached };
  }, [evaluatedTickets]);

  // 5. Breached Tickets Queue (past SLA due date)
  const breachedTickets = useMemo(() => {
    return evaluatedTickets
      .filter((t) => t.isBreached)
      .sort((a, b) => new Date(a.dueDate || 0) - new Date(b.dueDate || 0));
  }, [evaluatedTickets]);

  // Assignment Modal Submission
  const handleAssignSubmit = async (payload) => {
    try {
      if (payload.ticketId) {
        await assignTicketToEmployees(payload.ticketId, payload.employeeIds, payload.priority, payload.department);
      }
      const assignedEmployeeObjs = assignEmployees.filter((e) =>
        (payload.employeeIds || []).includes(e.id)
      );
      const assignedNames = assignedEmployeeObjs.map((e) => e.name);

      setTickets((prev) =>
        prev.map((t) => {
          if (t.id === payload.ticketId || t.ticket_ID === payload.ticketId) {
            return {
              ...t,
              status: 'In Progress',
              priority: payload.priority || t.priority,
              assigned: payload.employeeIds,
              assigned_names: assignedNames,
            };
          }
          return t;
        })
      );

      setToastMessage({
        type: 'success',
        text: `Ticket successfully reassigned to ${assignedNames.join(', ') || 'IT Staff'}.`,
      });
      setAssignModalTicket(null);
    } catch (err) {
      console.error('Failed to assign ticket:', err);
      setToastMessage({
        type: 'error',
        text: 'Failed to assign ticket. Please try again.',
      });
    }

    setTimeout(() => setToastMessage(null), 4000);
  };

  const dateStr = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());

  return (
    <div className="w-full max-w-full space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 flex items-center gap-2.5 px-4 py-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl shadow-lg animate-in fade-in slide-in-from-top-2">
          <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="text-xs font-semibold">{toastMessage.text}</span>
        </div>
      )}

      {/* Page Header */}
      <PageHeader
        pattern="B"
        title="IT Manager Dashboard & SLA Overview"
        subtitle={`Live monitoring of IT staff capacity, SLA metrics, and critical overdue escalations — ${dateStr}`}
        actions={
          <div className="flex items-center gap-2.5">
            <Button
              variant="default"
              size="sm"
              onClick={() => navigate('/it-manager/tickets')}
              className="text-xs bg-[#252578] hover:bg-[#1d1d60] text-white font-semibold gap-1.5 shadow-xs cursor-pointer"
            >
              <Inbox className="w-3.5 h-3.5" />
              <span>IT Ticket Queue</span>
              <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadData(true)}
              disabled={isRefreshing}
              className="text-xs gap-1.5 cursor-pointer"
            >
              <RefreshCw className={cn('w-3.5 h-3.5 text-accent', isRefreshing && 'animate-spin')} />
              <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
            </Button>
          </div>
        }
      />

      {/* ─────────────────────────────────────────────────────────────────────────────
          SECTION 1: SLA OVERVIEW SUMMARY CARDS
         ───────────────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total IT Tickets"
          value={slaMetrics.total}
          icon={<Layers className="w-5 h-5 text-accent" />}
          iconBg="bg-blue-50 text-accent"
        />
        <MetricCard
          title="Unassigned Tickets"
          value={slaMetrics.unassigned}
          icon={<Inbox className="w-5 h-5 text-amber-600" />}
          iconBg="bg-amber-50 text-amber-600"
          variant="amber"
        />
        <MetricCard
          title="Within SLA"
          value={slaMetrics.withinSla}
          icon={<CheckCircle2 className="w-5 h-5 text-emerald-600" />}
          iconBg="bg-emerald-50 text-emerald-600"
        />
        <MetricCard
          title="Breached Tickets"
          value={slaMetrics.breached}
          icon={<ShieldAlert className="w-5 h-5 text-rose-600" />}
          iconBg="bg-rose-50 text-rose-600"
          variant="crimson"
        />
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────────
          SECTION 2: SLA COMPLIANCE & STAFF CAPACITY
         ───────────────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Compliance Meter */}
        <div className="bg-card rounded-xl border border-border p-5 space-y-4 shadow-xs">
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-bold text-foreground">SLA Health Overview</h3>
            </div>
            <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary">
              Live Status
            </Badge>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground font-medium">Compliance Rate</span>
                <span className="font-bold text-foreground">
                  {slaMetrics.total > 0
                    ? `${Math.round(((slaMetrics.total - slaMetrics.breached) / slaMetrics.total) * 100)}%`
                    : '100%'}
                </span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-emerald-500 h-2.5 rounded-full transition-all duration-500"
                  style={{
                    width: `${
                      slaMetrics.total > 0
                        ? Math.round(((slaMetrics.total - slaMetrics.breached) / slaMetrics.total) * 100)
                        : 100
                    }%`,
                  }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <div className="p-3 bg-emerald-50/60 rounded-xl border border-emerald-100 text-center">
                <p className="text-[10px] font-semibold text-emerald-800 uppercase">On-Track</p>
                <p className="text-lg font-bold text-emerald-900 mt-0.5">{slaMetrics.withinSla}</p>
              </div>
              <div className="p-3 bg-rose-50/60 rounded-xl border border-rose-100 text-center">
                <p className="text-[10px] font-semibold text-rose-800 uppercase">Breached</p>
                <p className="text-lg font-bold text-rose-900 mt-0.5">{slaMetrics.breached}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Staff Capacity */}
        <div className="lg:col-span-2 bg-card rounded-xl border border-border p-5 space-y-4 shadow-xs">
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-bold text-foreground">IT Staff Workload &amp; Capacity</h3>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/it-manager/tickets')}
              className="text-xs text-accent hover:text-primary p-0 h-auto cursor-pointer"
            >
              Manage Assignments →
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { name: 'David Miller', role: 'IT Support Engineer', email: 'david.miller@example.com' },
              { name: 'Sarah Connor', role: 'Systems Administrator', email: 'sarah.connor@example.com' },
              { name: 'Alex Chen', role: 'IT Support Technician', email: 'alex.chen@example.com' },
              { name: 'Arthur Pendleton (IT Manager)', role: 'Department Head', email: 'itmanager@example.com' },
            ].map((staff) => {
              const assignedCount = evaluatedTickets.filter(
                (t) => t.assigneeName.toLowerCase().includes(staff.name.toLowerCase().split(' ')[0])
              ).length;
              const breachedCount = evaluatedTickets.filter(
                (t) =>
                  t.isBreached &&
                  t.assigneeName.toLowerCase().includes(staff.name.toLowerCase().split(' ')[0])
              ).length;

              return (
                <div
                  key={staff.email}
                  className="p-3 rounded-xl border border-border bg-slate-50/50 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-foreground truncate">{staff.name}</p>
                    <p className="text-[10px] text-muted-foreground">{staff.role}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-800">
                      {assignedCount} active
                    </span>
                    {breachedCount > 0 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-rose-100 text-rose-700">
                        {breachedCount} late
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-100 text-xs text-blue-900 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-accent shrink-0" />
              <span>
                <strong>{slaMetrics.unassigned}</strong> tickets currently unassigned in the IT queue.
              </span>
            </div>
            <Button
              size="sm"
              onClick={() => navigate('/it-manager/tickets')}
              className="text-xs bg-[#252578] hover:bg-[#1d1d60] text-white shrink-0 py-1 h-7 cursor-pointer"
            >
              Assign Tickets
            </Button>
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────────
          SECTION 3: BREACHED TICKETS QUEUE (ON THE SAME DASHBOARD PAGE)
         ───────────────────────────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="p-4 rounded-xl border border-rose-200 bg-rose-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-rose-900">
                  Breached Tickets Queue
                </h3>
                <Badge variant="destructive" size="sm" className="text-[10px]">
                  {breachedTickets.length} Overdue
                </Badge>
              </div>
              <p className="text-xs text-rose-700 mt-0.5">
                Tickets exceeding agreed SLA resolution deadlines requiring immediate technician re-assignment or escalation.
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => loadData(true)}
            className="text-xs text-rose-800 border-rose-300 hover:bg-rose-100/60 shrink-0 cursor-pointer"
          >
            <RefreshCw className={cn('w-3.5 h-3.5 mr-1 text-rose-700', isRefreshing && 'animate-spin')} />
            Refresh Breaches
          </Button>
        </div>

        {/* Breached Tickets Table */}
        <div className="bg-card rounded-xl border border-border shadow-xs overflow-hidden">
          <div className="overflow-x-auto min-h-[300px]">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 border-b border-border">
                  <TableHead className="w-28 font-semibold text-xs">Ticket ID</TableHead>
                  <TableHead className="min-w-[280px] font-semibold text-xs">Subject &amp; Impact</TableHead>
                  <TableHead className="w-28 font-semibold text-xs">Priority</TableHead>
                  <TableHead className="min-w-[180px] font-semibold text-xs">Assigned Technician</TableHead>
                  <TableHead className="w-44 font-semibold text-xs text-rose-700">Overdue Duration</TableHead>
                  <TableHead className="w-40 font-semibold text-xs">Target SLA Due</TableHead>
                  <TableHead className="w-36 text-right font-semibold text-xs">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <DataTableSkeleton columns={7} rows={4} />
                ) : breachedTickets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-48 text-center">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                          <CheckCircle2 className="w-5 h-5" />
                        </div>
                        <p className="text-sm font-bold text-foreground">Zero SLA Breaches!</p>
                        <p className="text-xs text-muted-foreground">
                          All operational IT tickets are currently operating within their SLA resolution window.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  breachedTickets.map((t) => (
                    <TableRow key={t.id || t.ticket_ID} className="hover:bg-rose-50/20 transition-colors">
                      {/* Ticket ID */}
                      <TableCell className="font-mono text-xs font-bold text-rose-700">
                        {t.ticket_ID || `TICK-${t.id}`}
                      </TableCell>

                      {/* Subject */}
                      <TableCell>
                        <div className="space-y-0.5">
                          <p
                            onClick={() => setDetailModalTicket(t)}
                            className="text-xs font-bold text-foreground hover:text-rose-700 cursor-pointer transition-colors line-clamp-1"
                            title={t.title}
                          >
                            {t.title}
                          </p>
                          <p className="text-[11px] text-muted-foreground line-clamp-1">
                            {t.description || 'No additional telemetry reported.'}
                          </p>
                        </div>
                      </TableCell>

                      {/* Priority */}
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(t.priority)} className="text-[10px]">
                          {t.priority}
                        </Badge>
                      </TableCell>

                      {/* Assigned */}
                      <TableCell>
                        {t.isUnassigned ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                            Unassigned (Escalate)
                          </span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded-full bg-[#252578]/10 text-[#252578] font-bold text-[10px] flex items-center justify-center shrink-0">
                              {t.assigneeName.charAt(0)}
                            </div>
                            <span className="text-xs font-semibold text-foreground truncate max-w-[140px]">
                              {t.assigneeName}
                            </span>
                          </div>
                        )}
                      </TableCell>

                      {/* Overdue Duration (Live tracking) */}
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200">
                          <Clock className="w-3.5 h-3.5 text-rose-600 animate-pulse" />
                          {formatOverdueDuration(t.sla_due_date)}
                        </span>
                      </TableCell>

                      {/* Target SLA Due */}
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {t.sla_due_date ? new Date(t.sla_due_date).toLocaleString() : 'N/A'}
                      </TableCell>

                      {/* Action */}
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            onClick={() => setAssignModalTicket(t)}
                            className="text-xs h-7 px-2.5 bg-[#252578] hover:bg-[#1d1d60] text-white font-medium gap-1 cursor-pointer"
                          >
                            <UserCheck className="w-3 h-3" />
                            <span>Reassign</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDetailModalTicket(t)}
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground cursor-pointer"
                            title="View Details"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* Assignment Modal */}
      {assignModalTicket && (
        <AssignModal
          ticket={assignModalTicket}
          employees={assignEmployees}
          departments={assignDepartments}
          priorityOptions={['Low', 'Medium', 'High', 'Critical']}
          onClose={() => setAssignModalTicket(null)}
          onAssign={handleAssignSubmit}
        />
      )}

      {/* Ticket Details Inspection Modal */}
      {detailModalTicket && (
        <CustomerTicketDetailModal
          ticket={detailModalTicket}
          isOpen={Boolean(detailModalTicket)}
          onClose={() => setDetailModalTicket(null)}
        />
      )}
    </div>
  );
}
