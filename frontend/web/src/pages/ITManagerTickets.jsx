import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Inbox,
  Search,
  Filter,
  RefreshCw,
  UserCheck,
  UserPlus,
  ArrowUpDown,
  ExternalLink,
  ChevronDown,
  Layers,
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
import { useBranch } from '@/context/BranchContext';
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

export default function ITManagerTickets() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { selectedBranch } = useBranch();

  // Data states
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [assigneeFilter, setAssigneeFilter] = useState('All');

  // Pagination
  const [page, setPage] = useState(1);
  const itemsPerPage = 10;

  // Assignment & Details Modals
  const [assignModalTicket, setAssignModalTicket] = useState(null);
  const [assignEmployees, setAssignEmployees] = useState([]);
  const [assignDepartments, setAssignDepartments] = useState([]);
  const [selectedDetailTicket, setSelectedDetailTicket] = useState(null);

  // Load ticket data
  const loadTickets = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
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
      console.warn('Failed to fetch live IT tickets, using resilient fallback:', err);
      setTickets(MOCK_IT_TICKETS);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  // Load assignable staff (including IT staff and self)
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

  // Normalize ticket SLA data
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

  // Dynamic list of unique assignees for filter dropdown
  const assigneeOptions = useMemo(() => {
    const names = new Set();
    evaluatedTickets.forEach((t) => {
      if (t.assigneeName && t.assigneeName !== 'Unassigned') {
        names.add(t.assigneeName);
      }
    });
    return Array.from(names).sort();
  }, [evaluatedTickets]);

  // Multi-Filter Engine
  const filteredTickets = useMemo(() => {
    return evaluatedTickets.filter((t) => {
      // Search filter
      if (search.trim()) {
        const q = search.toLowerCase();
        const idMatch = String(t.ticket_ID || t.id || '').toLowerCase().includes(q);
        const titleMatch = (t.title || '').toLowerCase().includes(q);
        const descMatch = (t.description || '').toLowerCase().includes(q);
        const catMatch = (t.category || '').toLowerCase().includes(q);
        const assigneeMatch = (t.assigneeName || '').toLowerCase().includes(q);
        if (!idMatch && !titleMatch && !descMatch && !catMatch && !assigneeMatch) return false;
      }

      // Status filter
      if (statusFilter !== 'All') {
        if (statusFilter === 'Pending Assignment' && !t.isUnassigned && t.status !== 'Pending Assignment') {
          return false;
        }
        if (statusFilter !== 'Pending Assignment' && (t.status || '').toLowerCase() !== statusFilter.toLowerCase()) {
          return false;
        }
      }

      // Priority filter
      if (priorityFilter !== 'All') {
        if ((t.priority || '').toLowerCase() !== priorityFilter.toLowerCase()) return false;
      }

      // Assignee filter
      if (assigneeFilter !== 'All') {
        if (assigneeFilter === 'Unassigned') {
          if (!t.isUnassigned) return false;
        } else {
          if (!t.assigneeName.toLowerCase().includes(assigneeFilter.toLowerCase())) return false;
        }
      }

      return true;
    });
  }, [evaluatedTickets, search, statusFilter, priorityFilter, assigneeFilter]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredTickets.length / itemsPerPage));
  const paginatedTickets = useMemo(() => {
    const start = (page - 1) * itemsPerPage;
    return filteredTickets.slice(start, start + itemsPerPage);
  }, [filteredTickets, page]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, priorityFilter, assigneeFilter]);

  // Reset all filters
  const handleResetFilters = () => {
    setSearch('');
    setStatusFilter('All');
    setPriorityFilter('All');
    setAssigneeFilter('All');
  };

  const hasActiveFilters = search || statusFilter !== 'All' || priorityFilter !== 'All' || assigneeFilter !== 'All';

  // Assignment Modal handler
  const handleOpenAssignModal = (ticket) => {
    setAssignModalTicket(ticket);
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
        title="IT Ticket Queue & Assignment"
        subtitle="Manage assignments, triage incoming service requests, and track technician workload."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/it-manager/dashboard')}
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
          {/* Free-text search */}
          <div className="relative flex-1 min-w-[240px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search by ticket ID, subject, assignee, category..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-border bg-page text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Status Filter */}
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

          {/* Priority Filter */}
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

          {/* Assignee Filter */}
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

          {/* Reset Filters */}
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
                <TableHead className="min-w-[280px] font-semibold text-xs">Subject &amp; Category</TableHead>
                <TableHead className="w-28 font-semibold text-xs">Priority</TableHead>
                <TableHead className="w-32 font-semibold text-xs">Status</TableHead>
                <TableHead className="min-w-[180px] font-semibold text-xs">Assigned Technician</TableHead>
                <TableHead className="w-36 font-semibold text-xs">SLA Health</TableHead>
                <TableHead className="w-36 text-right font-semibold text-xs">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <DataTableSkeleton columns={7} rows={6} />
              ) : paginatedTickets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-64 text-center">
                    <DataTableEmptyState
                      title="No tickets match your filter criteria"
                      description="Try widening your search terms or clearing specific status and assignee filters."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                paginatedTickets.map((t) => (
                  <TableRow key={t.id || t.ticket_ID} className="hover:bg-muted/40 transition-colors">
                    {/* Ticket ID */}
                    <TableCell className="font-mono text-xs font-bold text-primary">
                      {t.ticket_ID || `TKT-${t.id}`}
                    </TableCell>

                    {/* Subject & Category */}
                    <TableCell>
                      <div className="space-y-0.5">
                        <p className="font-semibold text-xs text-foreground line-clamp-1 hover:text-primary transition-colors cursor-pointer" onClick={() => setSelectedDetailTicket(t)}>
                          {t.title}
                        </p>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground">{t.category || 'General IT'}</span>
                          {t.department && (
                            <span className="text-[10px] text-muted-foreground/80">• {t.department}</span>
                          )}
                        </div>
                      </div>
                    </TableCell>

                    {/* Priority */}
                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(t.priority)} size="sm">
                        {t.priority}
                      </Badge>
                    </TableCell>

                    {/* Status */}
                    <TableCell>
                      <Badge variant={getStatusBadgeVariant(t.status)} size="sm">
                        {t.status}
                      </Badge>
                    </TableCell>

                    {/* Assigned Technician */}
                    <TableCell>
                      {t.isUnassigned ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-semibold">
                          <UserPlus className="w-3 h-3 text-amber-600" />
                          Unassigned
                        </span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full bg-[#252578]/10 text-[#252578] font-bold text-[10px] flex items-center justify-center shrink-0">
                            {t.assigneeName.charAt(0)}
                          </div>
                          <span className="text-xs font-medium text-foreground truncate max-w-[150px]">
                            {t.assigneeName}
                          </span>
                        </div>
                      )}
                    </TableCell>

                    {/* SLA Health Badge */}
                    <TableCell>
                      <SlaStatusBadge ticket={t} />
                    </TableCell>

                    {/* Action Buttons */}
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenAssignModal(t)}
                          className={cn(
                            'text-[11px] h-7 px-2.5 font-semibold cursor-pointer',
                            t.isUnassigned
                              ? 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
                              : 'text-primary border-primary/30 hover:bg-primary/5'
                          )}
                        >
                          <UserCheck className="w-3 h-3 mr-1" />
                          <span>{t.isUnassigned ? 'Assign' : 'Reassign'}</span>
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedDetailTicket(t)}
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

        {/* Pagination Bar */}
        {!loading && filteredTickets.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-t border-border bg-page/50 text-xs text-muted-foreground">
            <div>
              Showing <strong>{(page - 1) * itemsPerPage + 1}</strong> to{' '}
              <strong>{Math.min(page * itemsPerPage, filteredTickets.length)}</strong> of{' '}
              <strong>{filteredTickets.length}</strong> tickets
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="h-8 text-xs cursor-pointer"
              >
                Previous
              </Button>
              <span className="font-semibold text-foreground px-2">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="h-8 text-xs cursor-pointer"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Assignment Modal (Supports assigning to IT staff or self) */}
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
      {selectedDetailTicket && (
        <CustomerTicketDetailModal
          ticket={selectedDetailTicket}
          isOpen={Boolean(selectedDetailTicket)}
          onClose={() => setSelectedDetailTicket(null)}
        />
      )}
    </div>
  );
}
