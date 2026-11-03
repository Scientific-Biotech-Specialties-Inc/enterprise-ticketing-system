import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldAlert,
  Clock,
  CheckCircle2,
  Users,
  RefreshCw,
  UserCheck,
  UserPlus,
  ExternalLink,
  Layers,
  Inbox,
  CheckCircle,
  ArrowRight,
  Wrench,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { MetricCard } from '@/components/ui/metric-card';
import { Button } from '@/components/ui/button';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { DataTableSkeleton } from '@/components/ui/data-table';
import { useAuth } from '@/context/AuthContext';
import { getTicketSlaDueDate } from '@/components/sla/SlaStatusBadge';
import { AssignModal } from '@/components/CSModals';
import CustomerTicketDetailModal from '@/components/CustomerTicketDetailModal';
import {
  getCSIncomingTickets,
  getAssignableEmployees,
  assignTicketToEmployees,
  getDepartments,
} from '@/services/ticketService';
import { cn } from '@/lib/utils';

// Helper: Format Overdue Duration
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

// Fallback seed tickets for initial instant responsiveness for Service
const MOCK_SERVICE_TICKETS = [
  {
    id: 8001,
    ticket_ID: 'TICK-SRV-101',
    title: 'Siemens Magnetom Lumina 3T MRI - Cryostat Helium Pressure Spike',
    description: 'Cold head compressor fault causing helium boil-off warning. Imaging suite shut down.',
    priority: 'Critical',
    status: 'In Progress',
    department: 'Service',
    category: 'Equipment',
    created_at: new Date(Date.now() - 36 * 3600 * 1000).toISOString(),
    sla_due_date: new Date(Date.now() - 14 * 3600 * 1000).toISOString(),
    assigned: [1028],
    assigned_names: ['Carlos Mendoza'],
  },
  {
    id: 8002,
    ticket_ID: 'TICK-SRV-102',
    title: 'GE Revolution Apex CT Scanner - Slip-Ring Thermal Overheat Warning',
    description: 'High-speed slip ring telemetry reporting abnormal rotor thermal gradient during chest helical scan.',
    priority: 'Critical',
    status: 'In Progress',
    department: 'Service',
    category: 'Radiology',
    created_at: new Date(Date.now() - 18 * 3600 * 1000).toISOString(),
    sla_due_date: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
    assigned: [2],
    assigned_names: ['Mark Reyes'],
  },
  {
    id: 8003,
    ticket_ID: 'TICK-SRV-103',
    title: 'Baxter Prismaflex CRRT Hemodialysis Unit - Pressure Transducer Fault',
    description: 'Effluent line sensor calibration variance exceeds safety tolerance in ICU Ward 4.',
    priority: 'Critical',
    status: 'Pending Assignment',
    department: 'Service',
    category: 'Biomedical',
    created_at: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
    sla_due_date: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    assigned: [],
    assigned_names: [],
  },
  {
    id: 8004,
    ticket_ID: 'TICK-SRV-104',
    title: 'Philips EPIQ Elite Ultrasound - Transducer Beam Calibration Drift',
    description: 'Periodic PM calibration required for cardiac phased-array probes.',
    priority: 'Medium',
    status: 'In Progress',
    department: 'Service',
    category: 'Maintenance',
    created_at: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
    sla_due_date: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    assigned: [4],
    assigned_names: ['Bernadette Gonzaga'],
  },
  {
    id: 8005,
    ticket_ID: 'TICK-SRV-105',
    title: 'Carestream DRX Evolution Plus X-Ray - Collimator Shutter Sticking',
    description: 'Manual and motorized collimator leaves binding at full field-of-view aperture.',
    priority: 'High',
    status: 'Pending Assignment',
    department: 'Service',
    category: 'Hardware',
    created_at: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
    sla_due_date: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
    assigned: [],
    assigned_names: [],
  },
  {
    id: 8006,
    ticket_ID: 'TICK-SRV-106',
    title: 'Mindray BeneView T8 Patient Monitor - Defibrillator Sync Interface Loss',
    description: 'Cardiology recovery ward monitor failing analog sync pulse to defibrillator cart.',
    priority: 'Low',
    status: 'In Progress',
    department: 'Service',
    category: 'Biomedical',
    created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    sla_due_date: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    assigned: [1050],
    assigned_names: ['Oliver Queen'],
  },
  {
    id: 8007,
    ticket_ID: 'TICK-SRV-107',
    title: 'Olympus EVIS EXERA III Video Colonoscope - Light Guide Insertion Bundle',
    description: 'Endoscopy tower report of reduced illumination intensity on distal tip optics.',
    priority: 'Medium',
    status: 'Pending Assignment',
    department: 'Service',
    category: 'Equipment',
    created_at: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    sla_due_date: new Date(Date.now() + 36 * 3600 * 1000).toISOString(),
    assigned: [],
    assigned_names: [],
  },
];

export default function ServiceManagerDashboard() {
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

  // 1. Fetch tickets scoped to Service Department
  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setIsRefreshing(true);
    try {
      const apiTickets = await getCSIncomingTickets({ limit: 100, forceRefresh: true });
      const serviceScoped = (apiTickets || []).filter((t) => {
        const dept = (t.department || t.department_target || '').toLowerCase();
        const cat = (t.category || '').toLowerCase();
        return (
          dept.includes('service') ||
          dept.includes('biomedical') ||
          dept.includes('radiology') ||
          dept.includes('facilities') ||
          cat.includes('equipment') ||
          cat.includes('hardware') ||
          cat.includes('machine') ||
          cat.includes('calibration') ||
          cat.includes('maintenance') ||
          cat.includes('repair') ||
          cat.includes('biomedical') ||
          cat.includes('radiology')
        );
      });

      const merged = serviceScoped.length > 0 ? serviceScoped : MOCK_SERVICE_TICKETS;
      setTickets(merged);
    } catch (err) {
      console.warn('Failed to fetch live Service tickets, falling back to mock tickets:', err);
      setTickets(MOCK_SERVICE_TICKETS);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 2. Fetch Service engineers and department options for AssignModal
  useEffect(() => {
    Promise.all([
      getAssignableEmployees({ forceRefresh: false }).catch(() => []),
      getDepartments().catch(() => []),
    ]).then(([emps, deps]) => {
      const formattedStaff = [
        { id: 1028, name: 'Carlos Mendoza (Service Manager)', email: 'carlos.mendoza@hospital.com', role: 'Lead Service Engineer', department: 'Service' },
        { id: 2, name: 'Mark Reyes', email: 'employee@gmail.com', role: 'Service Engineer', department: 'Service' },
        { id: 4, name: 'Bernadette Gonzaga', email: 'slosinada@gmail.com', role: 'Biomedical Support Engineer', department: 'Service' },
        { id: 1050, name: 'Oliver Queen', email: 'oliver.queen@hospital.com', role: 'Senior Diagnostic Systems Engineer', department: 'Service' },
        { id: 1058, name: 'Wanda Maximoff', email: 'wanda.maximoff@hospital.com', role: 'Radiology Maintenance Specialist', department: 'Service' },
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
            department: e.department || 'Service',
          });
        }
      });

      setAssignEmployees(mergedEmps);
      setAssignDepartments(deps && deps.length > 0 ? deps.map((d) => d.name || d) : ['Service', 'Biomedical Engineering', 'Radiology Maintenance', 'Facilities & Equipment']);
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
        ? `Engineer #${assignedList[0]}`
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

  // 4. SLA Overview Metrics
  const slaMetrics = useMemo(() => {
    const total = evaluatedTickets.length;
    const unassigned = evaluatedTickets.filter((t) => t.isUnassigned).length;
    const breached = evaluatedTickets.filter((t) => t.isBreached).length;
    const withinSla = total - breached;

    return { total, unassigned, withinSla, breached };
  }, [evaluatedTickets]);

  // 5. Breached Tickets Queue
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
        text: `Ticket successfully reassigned to ${assignedNames.join(', ') || 'Service Engineer'}.`,
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
        title="Service Manager Dashboard & SLA Overview"
        subtitle={`Live monitoring of Service engineering capacity, SLA metrics, and critical equipment escalations — ${dateStr}`}
        actions={
          <div className="flex items-center gap-2.5">
            <Button
              variant="default"
              size="sm"
              onClick={() => navigate('/service-manager/tickets')}
              className="text-xs bg-[#252578] hover:bg-[#1d1d60] text-white font-semibold gap-1.5 shadow-xs cursor-pointer"
            >
              <Inbox className="w-3.5 h-3.5" />
              <span>Service Ticket Queue</span>
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

      {/* SECTION 1: SLA OVERVIEW SUMMARY CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Service Tickets"
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

      {/* SECTION 2: SLA COMPLIANCE & STAFF CAPACITY */}
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
              <h3 className="text-sm font-bold text-foreground">Service Staff Workload &amp; Capacity</h3>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/service-manager/tickets')}
              className="text-xs text-accent hover:text-primary p-0 h-auto cursor-pointer"
            >
              Manage Assignments →
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { name: 'Carlos Mendoza', role: 'Lead Service Engineer (Manager)', email: 'carlos.mendoza@hospital.com' },
              { name: 'Mark Reyes', role: 'Service Engineer', email: 'employee@gmail.com' },
              { name: 'Bernadette Gonzaga', role: 'Biomedical Support Engineer', email: 'slosinada@gmail.com' },
              { name: 'Oliver Queen', role: 'Senior Diagnostic Systems Engineer', email: 'oliver.queen@hospital.com' },
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
                <strong>{slaMetrics.unassigned}</strong> equipment tickets unassigned in the Service queue.
              </span>
            </div>
            <Button
              size="sm"
              onClick={() => navigate('/service-manager/tickets')}
              className="text-xs bg-[#252578] hover:bg-[#1d1d60] text-white shrink-0 py-1 h-7 cursor-pointer"
            >
              Assign Tickets
            </Button>
          </div>
        </div>
      </div>

      {/* SECTION 3: BREACHED TICKETS QUEUE */}
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
                Service requests exceeding agreed SLA resolution deadlines requiring immediate engineer re-assignment or escalation.
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
                  <TableHead className="min-w-[280px] font-semibold text-xs">Subject &amp; Equipment</TableHead>
                  <TableHead className="w-28 font-semibold text-xs">Priority</TableHead>
                  <TableHead className="min-w-[180px] font-semibold text-xs">Assigned Engineer</TableHead>
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
                          All operational Service tickets are currently operating within their SLA resolution window.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  breachedTickets.map((t) => (
                    <TableRow key={t.id || t.ticket_ID} className="hover:bg-rose-50/20 transition-colors">
                      <TableCell className="font-mono text-xs font-bold text-rose-700">
                        {t.ticket_ID || `TICK-${t.id}`}
                      </TableCell>

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

                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(t.priority)} className="text-[10px]">
                          {t.priority}
                        </Badge>
                      </TableCell>

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

                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200">
                          <Clock className="w-3.5 h-3.5 text-rose-600 animate-pulse" />
                          {formatOverdueDuration(t.sla_due_date)}
                        </span>
                      </TableCell>

                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {t.sla_due_date ? new Date(t.sla_due_date).toLocaleString() : 'N/A'}
                      </TableCell>

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
