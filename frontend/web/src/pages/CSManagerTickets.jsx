import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Inbox,
  Search,
  RefreshCw,
  UserCheck,
  UserPlus,
  ExternalLink,
  Clock,
  ArrowLeft,
  RotateCcw,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { DataTableSkeleton, DataTableEmptyState } from '@/components/ui/data-table';
import { useAuth } from '@/context/AuthContext';
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

// Fallback seed tickets for instant responsiveness
const MOCK_CS_TICKETS = [
  {
    id: 7001,
    ticket_ID: 'TICK-CS-101',
    title: "St. Luke's Medical Center - Enterprise Client Portal MFA Lockout",
    description: 'Chief biomedical administrator locked out following credential sync timeout during emergency surgery intake.',
    priority: 'Critical',
    status: 'In Progress',
    department: 'Customer Service',
    category: 'Account Access',
    created_at: new Date(Date.now() - 36 * 3600 * 1000).toISOString(),
    sla_due_date: new Date(Date.now() - 14 * 3600 * 1000).toISOString(),
    assigned: [1],
    assigned_names: ['Ava Santos'],
  },
  {
    id: 7002,
    ticket_ID: 'TICK-CS-102',
    title: 'Philippine General Hospital - Monthly Equipment SLA Invoice Discrepancy',
    description: 'Finance billing discrepancy regarding quarterly preventive maintenance coverage on oncology linear accelerators.',
    priority: 'High',
    status: 'In Progress',
    department: 'Customer Service',
    category: 'Billing',
    created_at: new Date(Date.now() - 18 * 3600 * 1000).toISOString(),
    sla_due_date: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
    assigned: [1037],
    assigned_names: ['Fiona Gallagher'],
  },
  {
    id: 7003,
    ticket_ID: 'TICK-CS-103',
    title: 'The Medical City - Patient Telemetry Intake API Webhook Desync',
    description: 'Webhook endpoint returning 504 Gateway Timeout during clinical shift handoff.',
    priority: 'Critical',
    status: 'Pending Assignment',
    department: 'Customer Service',
    category: 'Integration',
    created_at: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
    sla_due_date: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    assigned: [],
    assigned_names: [],
  },
  {
    id: 7004,
    ticket_ID: 'TICK-CS-104',
    title: 'QC General Hospital - Scheduled Preventive Maintenance Confirmation',
    description: 'Confirmation requested for upcoming Sunday radiology equipment shutdown window.',
    priority: 'Medium',
    status: 'In Progress',
    department: 'Customer Service',
    category: 'Inquiry',
    created_at: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
    sla_due_date: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    assigned: [1042],
    assigned_names: ['Kevin Bacon'],
  },
  {
    id: 7005,
    ticket_ID: 'TICK-CS-105',
    title: 'Makati Medical Center - Extended Warranty Coverage & Spare Parts Contract',
    description: 'Inquiry regarding warranty coverage tiers for newly installed ultrasound transducers.',
    priority: 'Low',
    status: 'In Progress',
    department: 'Customer Service',
    category: 'Contract',
    created_at: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
    sla_due_date: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
    assigned: [1049],
    assigned_names: ['Rachel Green'],
  },
  {
    id: 7006,
    ticket_ID: 'TICK-CS-106',
    title: 'Asian Hospital - Urgent Bio-Containment Unit Service Dispatch Request',
    description: 'Isolation ward negative pressure controller alerting. Immediate technician dispatch required.',
    priority: 'Critical',
    status: 'In Progress',
    department: 'Customer Service',
    category: 'Emergency Dispatch',
    created_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    sla_due_date: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
    assigned: [1056],
    assigned_names: ['Yara Shahidi'],
  },
  {
    id: 7007,
    ticket_ID: 'TICK-CS-107',
    title: 'Cardinal Santos Medical Center - Service Agreement Annual Tier Renewal',
    description: 'Verification of SLA commitments, guaranteed response times, and after-hours escalation matrix.',
    priority: 'Medium',
    status: 'Pending Assignment',
    department: 'Customer Service',
    category: 'Support',
    created_at: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    sla_due_date: new Date(Date.now() + 36 * 3600 * 1000).toISOString(),
    assigned: [],
    assigned_names: [],
  },
];

export default function CSManagerTickets() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Data state
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filter toolbar state
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [assigneeFilter, setAssigneeFilter] = useState('All');

  // Modals state
  const [assignModalTicket, setAssignModalTicket] = useState(null);
  const [assignEmployees, setAssignEmployees] = useState([]);
  const [assignDepartments, setAssignDepartments] = useState([]);
  const [detailModalTicket, setDetailModalTicket] = useState(null);

  // Fetch CS Tickets
  const loadTickets = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    try {
      const apiTickets = await getCSIncomingTickets({ limit: 100, forceRefresh: true });
      const csScoped = (apiTickets || []).filter((t) => {
        const dept = (t.department || t.department_target || '').toLowerCase();
        const cat = (t.category || '').toLowerCase();
        return (
          dept.includes('customer') ||
          dept.includes('cs') ||
          dept.includes('support') ||
          cat.includes('support') ||
          cat.includes('inquiry') ||
          cat.includes('account') ||
          cat.includes('billing') ||
          cat.includes('access') ||
          cat.includes('contract') ||
          t.ticket_type === 'External' ||
          !t.is_internal
        );
      });

      const merged = csScoped.length > 0 ? csScoped : MOCK_CS_TICKETS;
      setTickets(merged);
    } catch (err) {
      console.warn('Failed to load CS tickets, falling back to mock tickets:', err);
      setTickets(MOCK_CS_TICKETS);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  // Fetch assignable employees & departments
  useEffect(() => {
    Promise.all([
      getAssignableEmployees({ forceRefresh: false }).catch(() => []),
      getDepartments().catch(() => []),
    ]).then(([emps, deps]) => {
      const formattedStaff = [
        { id: 1, name: 'Ava Santos (CS Manager)', email: 'cs@gmail.com', role: 'Customer Support Lead', department: 'Customer Service' },
        { id: 1037, name: 'Fiona Gallagher', email: 'fiona.gallagher@hospital.com', role: 'Customer Support Specialist', department: 'Customer Service' },
        { id: 1042, name: 'Kevin Bacon', email: 'kevin.bacon@hospital.com', role: 'Senior Customer Care Representative', department: 'Customer Service' },
        { id: 1049, name: 'Rachel Green', email: 'rachel.green@hospital.com', role: 'Client Relations Specialist', department: 'Customer Service' },
        { id: 1056, name: 'Yara Shahidi', email: 'yara.shahidi@hospital.com', role: 'Support Representative', department: 'Customer Service' },
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
            department: e.department || 'Customer Service',
          });
        }
      });

      setAssignEmployees(mergedEmps);
      setAssignDepartments(deps && deps.length > 0 ? deps.map((d) => d.name || d) : ['Customer Service', 'Service', 'IT Department']);
    });
  }, []);

  // Filtered & Evaluated Tickets
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
        ? `Agent #${assignedList[0]}`
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

  const filteredTickets = useMemo(() => {
    return evaluatedTickets.filter((t) => {
      if (search) {
        const q = search.toLowerCase();
        const matchesId = (t.ticket_ID || `TICK-${t.id}`).toLowerCase().includes(q);
        const matchesTitle = (t.title || '').toLowerCase().includes(q);
        const matchesDesc = (t.description || '').toLowerCase().includes(q);
        const matchesAssignee = (t.assigneeName || '').toLowerCase().includes(q);
        const matchesCategory = (t.category || '').toLowerCase().includes(q);
        if (!matchesId && !matchesTitle && !matchesDesc && !matchesAssignee && !matchesCategory) {
          return false;
        }
      }

      if (statusFilter !== 'All') {
        const status = (t.status || '').toLowerCase();
        if (statusFilter === 'Pending Assignment' && !t.isUnassigned && !status.includes('pending assignment')) {
          return false;
        }
        if (statusFilter !== 'Pending Assignment' && !status.includes(statusFilter.toLowerCase())) {
          return false;
        }
      }

      if (priorityFilter !== 'All') {
        if ((t.priority || '').toLowerCase() !== priorityFilter.toLowerCase()) {
          return false;
        }
      }

      if (assigneeFilter !== 'All') {
        if (assigneeFilter === 'Unassigned') {
          if (!t.isUnassigned) return false;
        } else {
          if (!t.assigneeName.toLowerCase().includes(assigneeFilter.toLowerCase())) {
            return false;
          }
        }
      }

      return true;
    });
  }, [evaluatedTickets, search, statusFilter, priorityFilter, assigneeFilter]);

  const assigneeOptions = useMemo(() => {
    const names = new Set();
    evaluatedTickets.forEach((t) => {
      if (!t.isUnassigned && t.assigneeName && t.assigneeName !== 'Unassigned') {
        names.add(t.assigneeName);
      }
    });
    return Array.from(names);
  }, [evaluatedTickets]);

  const hasActiveFilters = search || statusFilter !== 'All' || priorityFilter !== 'All' || assigneeFilter !== 'All';

  const handleResetFilters = () => {
    setSearch('');
    setStatusFilter('All');
    setPriorityFilter('All');
    setAssigneeFilter('All');
  };

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

      setAssignModalTicket(null);
    } catch (err) {
      console.error('Failed to assign ticket:', err);
      window.alert('Failed to reassign ticket. Please try again.');
    }
  };

  return (
    <div className="w-full max-w-full space-y-6">
      {/* Page Header */}
      <PageHeader
        pattern="B"
        title="CS Ticket Queue & Assignment"
        subtitle="Manage assignments, triage incoming customer tickets, and track agent workload for Customer Support."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/cs-manager/dashboard')}
              className="text-xs gap-1.5 cursor-pointer text-[#252578] border-[#252578]/30 hover:bg-[#252578]/5"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>SLA Dashboard</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadTickets({ silent: false })}
              disabled={refreshing}
              className="text-xs gap-1.5 cursor-pointer"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
              <span>Refresh</span>
            </Button>
          </div>
        }
      />

      {/* Filter Toolbar Controls */}
      <div className="bg-card rounded-xl border border-border p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search by ticket ID, subject, assignee, customer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-border bg-page text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 rounded-lg border border-border bg-page px-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer"
            >
              <option value="All">All Statuses</option>
              <option value="Pending Assignment">Pending Assignment</option>
              <option value="In Progress">In Progress</option>
              <option value="Pending">Pending</option>
              <option value="Resolved">Resolved</option>
              <option value="Closed">Closed</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">Priority:</span>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="h-9 rounded-lg border border-border bg-page px-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer"
            >
              <option value="All">All Priorities</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">Assignee:</span>
            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              className="h-9 rounded-lg border border-border bg-page px-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary cursor-pointer"
            >
              <option value="All">All Assignees</option>
              <option value="Unassigned">Unassigned Only</option>
              {assigneeOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          {hasActiveFilters && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetFilters}
              className="h-9 text-xs gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </Button>
          )}
        </div>
      </div>

      {/* Ticket Queue Table Card */}
      <div className="rounded-xl border border-border bg-card shadow-xs overflow-hidden min-h-[500px] flex flex-col justify-between">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 border-b border-border">
                <TableHead className="w-28 font-semibold text-xs">Ticket ID</TableHead>
                <TableHead className="min-w-[260px] font-semibold text-xs">Subject &amp; Inquiry</TableHead>
                <TableHead className="w-28 font-semibold text-xs">Priority</TableHead>
                <TableHead className="w-32 font-semibold text-xs">Status</TableHead>
                <TableHead className="min-w-[180px] font-semibold text-xs">Assigned Agent</TableHead>
                <TableHead className="w-36 font-semibold text-xs">SLA Due Date</TableHead>
                <TableHead className="w-36 text-right font-semibold text-xs">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <DataTableSkeleton columns={7} rows={6} />
              ) : filteredTickets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-64 text-center">
                    <DataTableEmptyState
                      title="No CS tickets found"
                      description={hasActiveFilters ? "Try adjusting your search query or status filter." : "The Customer Service queue is currently up to date."}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                filteredTickets.map((t) => (
                  <TableRow
                    key={t.id || t.ticket_ID}
                    onClick={() => setDetailModalTicket(t)}
                    className={cn(
                      'cursor-pointer hover:bg-slate-50/80 transition-colors duration-150',
                      t.isBreached && 'bg-rose-50/20 hover:bg-rose-50/40'
                    )}
                  >
                    <TableCell className="font-mono text-xs font-bold text-primary">
                      {t.ticket_ID || `TICK-${t.id}`}
                    </TableCell>

                    <TableCell>
                      <div className="space-y-0.5">
                        <p
                          onClick={() => setDetailModalTicket(t)}
                          className="text-xs font-bold text-foreground hover:text-accent cursor-pointer transition-colors line-clamp-1"
                          title={t.title}
                        >
                          {t.title}
                        </p>
                        <p className="text-[11px] text-muted-foreground line-clamp-1">
                          {t.description || 'No additional inquiry details.'}
                        </p>
                      </div>
                    </TableCell>

                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(t.priority)} className="text-[10px]">
                        {t.priority}
                      </Badge>
                    </TableCell>

                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(t.status)} className="text-[10px]">
                        {t.status || 'Pending Assignment'}
                      </Badge>
                    </TableCell>

                    <TableCell>
                      {t.isUnassigned ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                          Unassigned
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
                      <SlaStatusBadge ticket={t} dueDate={t.dueDate} />
                    </TableCell>

                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAssignModalTicket(t);
                          }}
                          className="text-xs h-7 px-2.5 bg-[#252578] hover:bg-[#1d1d60] text-white font-medium gap-1 cursor-pointer"
                        >
                          {t.isUnassigned ? <UserPlus className="w-3 h-3" /> : <UserCheck className="w-3 h-3" />}
                          <span>{t.isUnassigned ? 'Assign' : 'Reassign'}</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="px-4 py-3 border-t border-border bg-slate-50/50 flex items-center justify-between text-xs text-muted-foreground">
          <span>Showing {filteredTickets.length} of {evaluatedTickets.length} tickets</span>
          <span>Customer Service Department Queue</span>
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
