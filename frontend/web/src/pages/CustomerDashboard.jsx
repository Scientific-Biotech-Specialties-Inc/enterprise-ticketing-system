import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Inbox, Clock, CheckCircle2, Archive, Bot, Eye, ArrowRight, Plus } from 'lucide-react';
import TicketModal from '@/components/TicketModal';
import CustomerTicketDetailModal from '@/components/CustomerTicketDetailModal';
import useRealtimeRefresh from '@/hooks/useRealtimeRefresh';
import {
  createTicket,
  discardCustomerTicket,
  getCustomerDashboard,
  prefetchTicketFormOptions,
  getTicketDetails,
  updateTicket,
  reopenTicket,
} from '@/services/ticketService';
import { useAuth } from '@/context/AuthContext';
import { parseUTCDate } from '@/utils/dateUtils';
import { getMaxOpenTicketsLimit, OPEN_STATUS_SET } from '@/data/ticketLimitConfig';
import { DashboardHeader } from '@/components/ui/page-header';
import { MetricCard } from '@/components/ui/metric-card';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { DataTableSkeleton } from '@/components/ui/data-table';
import { ConfirmationModal } from '@/components/ui/confirmation-modal';
import { Button } from '@/components/ui/button';
import { useToast } from '@/context/ToastContext';

const getStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
};

export default function CustomerDashboard() {
  const [isTicketModalOpen, setIsTicketModalOpen] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState('');

  const [selectedTicket, setSelectedTicket] = useState(null);
  const [confirmDiscard, setConfirmDiscard] = useState(null);
  const [summary, setSummary] = useState({
    open: 0,
    in_progress: 0,
    resolved: 0,
    closed: 0,
  });
  const [recentTickets, setRecentTickets] = useState([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('Loading...');
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const effectiveUser = user || getStoredUser();
  const customerName = effectiveUser?.first_name
    ? `${effectiveUser.first_name}${effectiveUser.last_name ? ' ' + effectiveUser.last_name : ''}`
    : (effectiveUser?.name || 'Customer');
  const customerId = effectiveUser?.id || 1;

  useEffect(() => {
    if (!effectiveUser) return;
    window.history.pushState(null, '', window.location.href);
    const handlePopState = () => {
      window.history.pushState(null, '', window.location.href);
      navigate('/customer-dashboard', { replace: true });
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [effectiveUser, navigate]);

  const loadDashboardData = useCallback(async ({ forceRefresh = false, source = 'manual' } = {}) => {
    if (source !== 'websocket' && source !== 'poll') {
      setDashboardLoading(true);
    }
    setDashboardError('');

    try {
      const data = await getCustomerDashboard({ createdBy: customerId, forceRefresh });
      const stats = data?.summary || { open: 0, in_progress: 0, resolved: 0, closed: 0 };
      setSummary({
        open: stats.open ?? 0,
        in_progress: stats.in_progress ?? 0,
        resolved: stats.resolved ?? 0,
        closed: stats.closed ?? 0,
      });

      const apiTickets = (data?.recent_tickets || []);
      const combined = apiTickets.filter(
        t => t.status !== 'Discarded' && t.status !== 'Discarded by Customer'
      );
      setRecentTickets(combined);
    } catch (error) {
      setDashboardError('Failed to load dashboard data.');
    } finally {
      setDashboardLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    try {
      localStorage.removeItem('demo_external_tickets');
    } catch {
      // ignore
    }

    prefetchTicketFormOptions().catch(() => {});
    loadDashboardData({ forceRefresh: false }).catch(() => {});
  }, [loadDashboardData]);

  useRealtimeRefresh({
    refresh: loadDashboardData,
    channels: [{ name: 'ticket-updates', event: 'ticket.changed' }],
    intervalMs: 0,
    deferRefresh: false,
  });

  const handleConfirmDiscard = async () => {
    if (!confirmDiscard) return;

    const isMock = !!confirmDiscard.isMock;
    if (isMock) {
      const stored = JSON.parse(localStorage.getItem('customer_created_tickets') || '[]');
      const updatedList = stored.map(t => {
        if (t.id === confirmDiscard.id) {
          return { ...t, status: 'Discarded' };
        }
        return t;
      });
      localStorage.setItem('customer_created_tickets', JSON.stringify(updatedList));
      setConfirmDiscard(null);
      setSelectedTicket(null);
      toast.success('Ticket discarded successfully.');
      loadDashboardData();
      return;
    }

    try {
      const ticketId = confirmDiscard.ticket_ID || parseInt(String(confirmDiscard.id || '').replace(/\D/g, ''), 10);
      await discardCustomerTicket(ticketId);
      setConfirmDiscard(null);
      setSelectedTicket(null);
      toast.success('Ticket discarded successfully.');
      loadDashboardData();
    } catch (err) {
      console.error('Failed to discard ticket:', err);
      toast.error(err?.response?.data?.message || 'Failed to discard ticket.');
    }
  };

  const handleViewTicket = async (t) => {
    const isMock = !!t.isMock;
    if (isMock) {
      setSelectedTicket({
        ...t,
        description: t.description || '',
        resolved_at: t.resolved_at || null,
        proofAttachments: t.proofAttachments || [],
        proofFiles: t.proofFiles || [],
        can_discard: t.status === 'Open' && !t.assigned_to,
      });
      return;
    }

    setLoadingText('Loading ticket details...');
    setModalLoading(true);
    try {
      const ticketId = t.ticket_ID || parseInt(String(t.id || '').replace(/\D/g, ''), 10);
      const fullTicket = await getTicketDetails(ticketId);
      setSelectedTicket({
        ...t,
        ...fullTicket,
        description: fullTicket.description || t.description || '',
        resolved_at: fullTicket.resolved_at || null,
        proofAttachments: fullTicket.proofAttachments || [],
        proofFiles: fullTicket.proofFiles || [],
        can_discard: (fullTicket.status || t.status) === 'Open' && !fullTicket.assigned_to,
      });
    } catch (err) {
      console.error('Failed to load ticket details:', err);
      setSelectedTicket(t);
    } finally {
      setModalLoading(false);
    }
  };

  const handleResolveTicket = async (ticketId) => {
    const isMock = selectedTicket ? !!selectedTicket.isMock : false;
    if (isMock) {
      const stored = JSON.parse(localStorage.getItem('customer_created_tickets') || '[]');
      const updatedList = stored.map(t => {
        if (t.id === ticketId || t.ticket_ID === ticketId) {
          const timestamp = new Date().toISOString();
          const timeline = t.timeline || [
            { id: 'creation', type: 'system', text: 'Ticket created.', timestamp: t.date_created }
          ];
          return {
            ...t,
            status: 'Resolved',
            resolved_at: timestamp,
            last_updated: timestamp,
            timeline: [
              ...timeline,
              {
                id: `status-resolved-${Date.now()}`,
                type: 'status',
                text: 'Ticket resolved by creator.',
                timestamp,
              }
            ]
          };
        }
        return t;
      });
      localStorage.setItem('customer_created_tickets', JSON.stringify(updatedList));
      setSelectedTicket(null);
      toast.success('Ticket resolved successfully.');
      loadDashboardData();
      return;
    }

    setLoadingText('Resolving ticket...');
    setModalLoading(true);
    try {
      const numericId = Number(String(ticketId).replace(/\D/g, ''));
      await updateTicket({
        ticketId: numericId,
        statusId: 3, // Resolved
      });
      setSelectedTicket(null);
      toast.success('Ticket resolved successfully.');
      loadDashboardData({ forceRefresh: true });
    } catch (err) {
      console.error('Failed to resolve ticket:', err);
      toast.error(err?.response?.data?.message || 'Failed to resolve ticket.');
    } finally {
      setModalLoading(false);
    }
  };

  const handleReopenTicket = async (ticketId, reason) => {
    const isMock = selectedTicket ? !!selectedTicket.isMock : false;
    if (isMock) {
      const stored = JSON.parse(localStorage.getItem('customer_created_tickets') || '[]');
      const timestamp = new Date().toISOString();
      const updatedList = stored.map(t => {
        if (t.id === ticketId || t.ticket_ID === ticketId) {
          const timeline = t.timeline || [
            { id: 'creation', type: 'system', text: 'Ticket created.', timestamp: t.date_created }
          ];
          return {
            ...t,
            status: 'Reopened',
            last_updated: timestamp,
            timeline: [
              ...timeline,
              {
                id: `status-reopened-${Date.now()}`,
                type: 'status',
                text: `Ticket reopened. Reason: "${reason}"`,
                timestamp,
              }
            ]
          };
        }
        return t;
      });
      localStorage.setItem('customer_created_tickets', JSON.stringify(updatedList));
      setSelectedTicket(null);
      toast.success('Ticket reopened successfully.');
      loadDashboardData();
      return { success: true };
    }

    try {
      const numericId = Number(String(ticketId).replace(/\D/g, ''));
      const res = await reopenTicket(numericId, reason);
      setSelectedTicket(null);
      toast.success('Ticket reopened successfully.');
      loadDashboardData();
      return res;
    } catch (err) {
      console.error('Failed to reopen ticket:', err);
      toast.error(err?.response?.data?.message || 'Failed to reopen ticket.');
      throw err;
    }
  };

  const customerOpenCount = useMemo(() => {
    return (recentTickets || []).filter(
      (t) => !t.is_internal && OPEN_STATUS_SET.includes(t.status)
    ).length;
  }, [recentTickets]);

  const handleCreateTicket = async (payload) => {
    const limitConfig = getMaxOpenTicketsLimit();
    if (!limitConfig.isUnlimited && customerOpenCount >= limitConfig.limit) {
      throw new Error(`You've reached the maximum number of open tickets (${limitConfig.limit}). Resolve or close an existing ticket before submitting another.`);
    }

    setLoadingText('Creating ticket...');
    setModalLoading(true);
    try {
      const response = await createTicket({
        ...payload,
        created_by: customerId,
      });
      
      const newTicketId = response.ticket?.ticket_ID || response.ticket_ID;
      setIsTicketModalOpen(false);
      toast.success('RECORD ADDED SUCCESSFULLY');
      setTimeout(() => {
        loadDashboardData({ forceRefresh: true });
        if (newTicketId) {
          navigate('/messages', { state: { selectedTicketId: newTicketId } });
        }
      }, 500);
    } catch (err) {
      console.error(err);
      toast.error(err?.response?.data?.message || 'Failed to create ticket.');
    } finally {
      setModalLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 font-sans">
      {/* Pattern A Dashboard Header (DESIGN.md Section VI.3) */}
      <DashboardHeader
        eyebrow="CUSTOMER PORTAL"
        userName={customerName}
        subtitle="Here is your equipment support and ticket status summary."
      />

      {/* Action banner with AI Assistant link */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-primary to-accent text-white shadow-sm">
        <div>
          <h2 className="text-lg font-bold">Need instant diagnostic assistance?</h2>
          <p className="text-xs text-white/80 mt-0.5">Consult with our AI Support Assistant for immediate troubleshooting before creating a ticket.</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Link to="/ai-support">
            <Button variant="secondary" className="bg-white/20 hover:bg-white/30 text-white border border-white/30 text-xs">
              <Bot className="h-4 w-4 mr-1.5" />
              AI Support Assistant
            </Button>
          </Link>
          <Button
            variant="secondary"
            onClick={() => setIsTicketModalOpen(true)}
            className="bg-white text-primary hover:bg-white/90 text-xs font-semibold"
          >
            <Plus className="h-4 w-4 mr-1" />
            Create Ticket
          </Button>
        </div>
      </div>

      {dashboardError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-destructive font-medium">
          {dashboardError}
        </div>
      )}

      {/* Summary Metric Cards (DESIGN.md Section VI.4) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          title="Open Tickets"
          value={summary.open}
          icon={<Inbox className="h-5 w-5 text-sky-600" />}
          iconBg="bg-sky-50"
          loading={dashboardLoading}
        />
        <MetricCard
          title="In Progress"
          value={summary.in_progress}
          icon={<Clock className="h-5 w-5 text-amber-600" />}
          iconBg="bg-amber-50"
          loading={dashboardLoading}
        />
        <MetricCard
          title="Resolved"
          value={summary.resolved}
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
          iconBg="bg-emerald-50"
          loading={dashboardLoading}
        />
        <MetricCard
          title="Closed"
          value={summary.closed}
          icon={<Archive className="h-5 w-5 text-slate-600" />}
          iconBg="bg-slate-100"
          loading={dashboardLoading}
        />
      </div>

      {/* Recent Tickets Table Section (DESIGN.md Section VI.10) */}
      <div className="p-6 rounded-2xl bg-surface border border-slate-100 shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-lg font-bold text-dark-slate">Recent Support Tickets</h2>
            <p className="text-xs text-muted-slate mt-0.5">Latest equipment maintenance and service requests</p>
          </div>
          <Link
            to="/my-tickets"
            className="text-xs font-semibold text-accent hover:underline flex items-center gap-1"
          >
            View All <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {dashboardLoading ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Ticket ID</TableHead>
                <TableHead>Title & Equipment</TableHead>
                <TableHead className="w-36">Status</TableHead>
                <TableHead className="w-20 text-center">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <DataTableSkeleton columns={4} rows={4} />
            </TableBody>
          </Table>
        ) : recentTickets.length === 0 ? (
          <div className="text-center py-10 text-muted-slate text-xs">
            No tickets found. Submit a support ticket to get started.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Ticket ID</TableHead>
                <TableHead>Title & Equipment</TableHead>
                <TableHead className="w-36">Status</TableHead>
                <TableHead className="w-20 text-center">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentTickets.map((t) => (
                <TableRow key={t.id || t.ticket_ID}>
                  <TableCell className="font-semibold text-primary text-xs">
                    {t.id || t.ticket_ID}
                  </TableCell>
                  <TableCell className="max-w-[280px]">
                    <div className="font-semibold text-dark-slate text-xs truncate" title={t.title}>
                      {t.title}
                    </div>
                    {t.equipment && (
                      <div className="text-[11px] text-muted-slate truncate mt-0.5" title={t.equipment}>
                        {t.equipment}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={getStatusBadgeVariant(t.status)} dot>
                      {t.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <button
                      type="button"
                      onClick={() => handleViewTicket(t)}
                      aria-label={`View ticket ${t.id}`}
                      className="p-1.5 rounded-lg text-muted-slate hover:text-accent hover:bg-slate-100 transition-colors"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Ticket Modal */}
      <TicketModal
        isOpen={isTicketModalOpen}
        onClose={() => setIsTicketModalOpen(false)}
        onSubmit={handleCreateTicket}
        openTicketsCount={customerOpenCount}
      />

      {/* Ticket Detail Modal */}
      {selectedTicket && (
        <CustomerTicketDetailModal
          ticket={selectedTicket}
          onClose={() => setSelectedTicket(null)}
          onDiscard={(ticket) => setConfirmDiscard(ticket)}
          onReopen={(ticketId, reason) => handleReopenTicket(ticketId, reason)}
          onResolve={(ticketId) => handleResolveTicket(ticketId)}
          customerName={customerName}
          onFeedbackSubmitted={() => {
            loadDashboardData({ forceRefresh: true });
          }}
        />
      )}

      {/* Confirm Discard Modal (using ONE UI ConfirmationModal) */}
      <ConfirmationModal
        isOpen={!!confirmDiscard}
        onClose={() => setConfirmDiscard(null)}
        onConfirm={handleConfirmDiscard}
        title="Discard Ticket"
        description={`Are you sure you want to discard ticket ${confirmDiscard?.id}? This action will cancel the request.`}
        confirmLabel="Discard"
        variant="destructive"
      />
    </div>
  );
}