import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FileText,
  Download,
  ChevronDown,
  Filter,
  Eye,
  RefreshCw,
  AlertCircle,
  FileSpreadsheet,
  FileCode,
  Search,
} from 'lucide-react';
import { exportAdminReport, getAdminReports } from '@/services/ticketService';
import { useBranch } from '@/context/BranchContext';
import BranchSelector from '@/components/BranchSelector';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Badge, getStatusBadgeVariant } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { DataTableSkeleton } from '@/components/ui/data-table';

// ─── Available Report Types ──────────────────────────────────────────────────
const REPORT_TYPES = [
  {
    id: 'ticket_volume',
    name: 'Ticket Volume & Status Summary',
    description: 'Breakdown of incoming, active, resolved, and closed tickets.',
    headers: ['Ticket ID', 'Subject', 'Category', 'Equipment', 'Branch', 'Department', 'Assigned Technician', 'Priority', 'Status', 'Created Date'],
  },
  {
    id: 'sla_compliance',
    name: 'SLA Compliance & Breach Analysis',
    description: 'Detailed analysis of first response times, resolution deadlines, and SLA breaches.',
    headers: ['Ticket ID', 'Subject', 'Branch', 'Department', 'Assigned Technician', 'Priority', 'Response Time (mins)', 'Resolution Time (hrs)', 'SLA Status', 'Created Date'],
  },
  {
    id: 'department_performance',
    name: 'Department Workload & Performance',
    description: 'Staff resolution rates, active backlog, and workload capacity across departments.',
    headers: ['Department', 'Staff Count', 'Total Tickets', 'Resolved Tickets', 'Open Tickets', 'Overdue Tickets', 'Avg Resolution (hrs)', 'SLA Compliance (%)', 'CSAT Score'],
  },
  {
    id: 'equipment_maintenance',
    name: 'Equipment Maintenance & MTBF Log',
    description: 'Hospital equipment breakdown frequencies, repair history, and failure probability.',
    headers: ['Equipment / Model', 'Serial Number', 'Category', 'Incident Count', 'Active Issues', 'Avg Resolution (hrs)', 'Last Incident Date', 'Reliability Status'],
  },
  {
    id: 'csat_satisfaction',
    name: 'Customer Satisfaction (CSAT) Report',
    description: 'Client survey scores, feedback comments, and service rating breakdown.',
    headers: ['Ticket ID', 'Subject', 'Customer', 'Assigned Technician', 'Department', 'CSAT Rating', 'Status', 'Resolved Date'],
  },
  {
    id: 'predictive_risk',
    name: 'Predictive Risk & Forecasting Model',
    description: 'Projected volume trajectories, recurring pattern flags, and escalation risk estimates.',
    headers: ['Target Scope', 'Metric Type', 'Forecast Date / Period', 'Predicted Value', 'Confidence / Risk Level', 'Alert Triggered', 'Recommended Action'],
  },
];

const DEPARTMENTS = [
  'All Departments',
  'Service',
  'Engineering',
  'Customer Service',
  'IT',
  'Quality Assurance',
];

export default function AdminReports() {
  const { selectedBranch, selectedBranchId, isSuperAdmin } = useBranch();
  const branchName = selectedBranch?.name || (isSuperAdmin ? 'All Branches' : 'Main Branch');

  // ─── Filter Configuration State (TS061 Criteria) ──────────────────────────
  const [selectedReportType, setSelectedReportType] = useState(REPORT_TYPES[0].id);
  const [datePreset, setDatePreset] = useState('Last 30 Days');
  const [customStartDate, setCustomStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [customEndDate, setCustomEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedDepartment, setSelectedDepartment] = useState('All Departments');
  const [priorityFilter, setPriorityFilter] = useState('All');

  // ─── Preview Display State ────────────────────────────────────────────────
  const [previewData, setPreviewData] = useState([]);
  const [previewHeaders, setPreviewHeaders] = useState(REPORT_TYPES[0].headers);
  const [appliedFilters, setAppliedFilters] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationNotice, setGenerationNotice] = useState('');
  const [generationError, setGenerationError] = useState(null);

  // Active report definition
  const currentReportDef = useMemo(() => {
    return REPORT_TYPES.find((r) => r.id === selectedReportType) || REPORT_TYPES[0];
  }, [selectedReportType]);

  const activeHeaders = useMemo(() => {
    return Array.isArray(previewHeaders) && previewHeaders.length > 0
      ? previewHeaders
      : currentReportDef.headers;
  }, [previewHeaders, currentReportDef]);

  // Compute effective date range string
  const effectiveDateRange = useMemo(() => {
    if (datePreset === 'Custom Range') {
      return `${customStartDate} to ${customEndDate}`;
    }
    return datePreset;
  }, [datePreset, customStartDate, customEndDate]);

  // Filters shared by the preview and the server side export so both read the same snapshot.
  const buildFilterParams = useCallback(() => {
    const params = { preset: datePreset };

    if (datePreset === 'Custom Range') {
      params.date_from = customStartDate;
      params.date_to = customEndDate;
    }

    if (selectedDepartment && selectedDepartment !== 'All Departments') {
      params.department = selectedDepartment;
    }

    if (priorityFilter && priorityFilter !== 'All') {
      params.priority = priorityFilter === 'Critical Only' ? 'Critical' : priorityFilter;
    }

    if (isSuperAdmin && selectedBranchId) {
      params.branch_id = selectedBranchId;
    }

    return params;
  }, [datePreset, customStartDate, customEndDate, selectedDepartment, priorityFilter, isSuperAdmin, selectedBranchId]);

  // ─── Generate Live Preview Action ─────────────────────────────────────────
  const handleGeneratePreview = useCallback(async () => {
    setIsGenerating(true);
    setGenerationError(null);
    setGenerationNotice(`Querying live "${currentReportDef.name}" records across ${branchName}...`);

    try {
      const params = { report_type: selectedReportType, ...buildFilterParams() };

      const res = await getAdminReports(params);
      const rows = Array.isArray(res?.rows) ? res.rows : [];
      const headers = Array.isArray(res?.headers) && res.headers.length > 0
        ? res.headers
        : currentReportDef.headers;

      setPreviewHeaders(headers);
      setPreviewData(rows);
      setAppliedFilters({
        reportType: currentReportDef.name,
        branch: res?.branch?.name || branchName,
        dateRange: effectiveDateRange,
        department: selectedDepartment,
        priority: priorityFilter,
        generationTime: new Date().toLocaleTimeString(),
      });
    } catch (err) {
      setGenerationError(
        err?.response?.data?.message ||
          'Failed to retrieve and compile live report data. Please check your connection or try again.'
      );
      setPreviewData([]);
    } finally {
      setIsGenerating(false);
      setGenerationNotice('');
    }
  }, [
    currentReportDef,
    branchName,
    selectedReportType,
    buildFilterParams,
    datePreset,
    customStartDate,
    customEndDate,
    selectedDepartment,
    priorityFilter,
    effectiveDateRange,
  ]);

  // Initial preview on load and when filters change
  useEffect(() => {
    handleGeneratePreview();
  }, [handleGeneratePreview]);

  // ─── Format Export Handlers (TS061 Criteria: PDF, Excel, CSV) ─────────────
  const handleExport = async (format) => {
    if (!previewData || previewData.length === 0) return;

    // The server renders PDF, Excel and CSV from the same query as the preview, so files match what is on screen.
    const apiFormat = format === 'excel' ? 'xlsx' : format;
    const resolvedBranch = (appliedFilters?.branch || branchName).replace(/\s+/g, '_');
    const fallbackName = `${currentReportDef.id}_${resolvedBranch}_${new Date().toISOString().split('T')[0]}.${apiFormat}`;

    try {
      const response = await exportAdminReport({
        reportType: selectedReportType,
        format: apiFormat,
        filters: buildFilterParams(),
      });

      const disposition = response?.headers?.['content-disposition'] || '';
      const match = /filename="?([^";]+)"?/i.exec(disposition);
      const url = window.URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = match ? match[1] : fallbackName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setGenerationError(
        err?.response?.status === 403
          ? 'You do not have access to export this report.'
          : 'The export could not be generated. Please try again.'
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        pattern="B"
        title="Report Generator & Document Exporter"
        subtitle="Configure filters, preview live data tables, and export executive documents in PDF, Excel (.xlsx), or CSV."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <BranchSelector variant="inline" />
            <Button
              variant="default"
              size="sm"
              onClick={handleGeneratePreview}
              disabled={isGenerating}
              className="gap-1.5 text-xs bg-[#252578] hover:bg-[#1d1d60] text-white shadow-xs font-semibold cursor-pointer"
            >
              {isGenerating ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
              <span>{isGenerating ? 'Generating Preview...' : 'Generate & Preview Report'}</span>
            </Button>
          </div>
        }
      />

      {/* ─── STEP 1 & 2: CONFIGURATION CONTROLS (TS061 Criteria) ─────────── */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-xs space-y-5">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-bold text-foreground">Configure Report Scope &amp; Filters</h2>
          </div>
          <span className="text-xs text-muted-foreground">Branch Scoped: <strong>{branchName}</strong></span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 1. Report Type Selector */}
          <div className="space-y-1.5">
            <label htmlFor="report-type-select" className="text-xs font-semibold text-foreground">Report Type</label>
            <select
              id="report-type-select"
              aria-label="Report Type"
              value={selectedReportType}
              onChange={(e) => setSelectedReportType(e.target.value)}
              className="w-full h-9 rounded-lg border border-border bg-page px-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
            >
              {REPORT_TYPES.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground line-clamp-1">{currentReportDef.description}</p>
          </div>

          {/* 2. Date Range Presets */}
          <div className="space-y-1.5">
            <label htmlFor="report-date-range-select" className="text-xs font-semibold text-foreground">Date Range</label>
            <select
              id="report-date-range-select"
              aria-label="Date Range"
              value={datePreset}
              onChange={(e) => setDatePreset(e.target.value)}
              className="w-full h-9 rounded-lg border border-border bg-page px-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
            >
              {['Today', 'Last 7 Days', 'Last 30 Days', 'Last 90 Days', 'Custom Range'].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            {datePreset === 'Custom Range' ? (
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="w-1/2 h-7 px-1.5 text-[11px] border border-border rounded bg-page"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="w-1/2 h-7 px-1.5 text-[11px] border border-border rounded bg-page"
                />
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">Applied timeframe: {effectiveDateRange}</p>
            )}
          </div>

          {/* 3. Department Scope */}
          <div className="space-y-1.5">
            <label htmlFor="report-department-select" className="text-xs font-semibold text-foreground">Department Filter</label>
            <select
              id="report-department-select"
              aria-label="Department Filter"
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              className="w-full h-9 rounded-lg border border-border bg-page px-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
            >
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">Departmental allocation</p>
          </div>

          {/* 4. Priority Filter */}
          <div className="space-y-1.5">
            <label htmlFor="report-priority-select" className="text-xs font-semibold text-foreground">Severity / Priority</label>
            <select
              id="report-priority-select"
              aria-label="Severity / Priority"
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="w-full h-9 rounded-lg border border-border bg-page px-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="All">All Severity Levels</option>
              <option value="Critical Only">Critical Only</option>
              <option value="High">High Only</option>
              <option value="Medium">Medium Only</option>
              <option value="Low">Low Only</option>
            </select>
            <p className="text-[11px] text-muted-foreground">Filter by ticket criticality</p>
          </div>
        </div>

        {/* Generate / Regenerate Preview Action Button */}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <div className="text-xs text-muted-foreground">
            {isGenerating && generationNotice ? (
              <span className="text-primary font-medium flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                {generationNotice}
              </span>
            ) : appliedFilters ? (
              <span>Last preview generated at <strong>{appliedFilters.generationTime}</strong></span>
            ) : null}
          </div>

          <Button
            variant="default"
            size="sm"
            onClick={handleGeneratePreview}
            disabled={isGenerating}
            className="gap-1.5 text-xs bg-[#252578] hover:bg-[#1d1d60] text-white shadow-xs font-semibold cursor-pointer"
          >
            {isGenerating ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Eye className="w-3.5 h-3.5" />
            )}
            <span>{isGenerating ? 'Generating Preview...' : 'Generate & Preview Report'}</span>
          </Button>
        </div>
      </div>

      {/* ─── ERROR STATE ───────────────────────────────────────────────────── */}
      {generationError && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-xs text-destructive flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
            <span>{generationError}</span>
          </div>
          <Button variant="outline" size="sm" onClick={handleGeneratePreview} className="h-7 text-xs">
            Retry
          </Button>
        </div>
      )}

      {/* ─── STEP 3: PREVIEW DISPLAY & FILTER SUMMARY (TS061 Criteria) ─────── */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-xs space-y-4">
        {/* Applied Filter Summary Banner */}
        {appliedFilters && (
          <div className="p-3.5 bg-muted/40 rounded-xl border border-border flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground">Report:</span>
                <span className="text-primary font-semibold">{appliedFilters.reportType}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-[11px]">
                <span>Branch: <strong className="text-foreground">{appliedFilters.branch}</strong></span>
                <span>Range: <strong className="text-foreground">{appliedFilters.dateRange}</strong></span>
                <span>Department: <strong className="text-foreground">{appliedFilters.department}</strong></span>
                <span>Priority: <strong className="text-foreground">{appliedFilters.priority}</strong></span>
              </div>
            </div>

            {/* Export Format Dropdown (PDF, Excel, CSV) */}
            <div className="flex items-center gap-2 shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="default"
                    size="sm"
                    disabled={!previewData || previewData.length === 0}
                    className="h-8 text-xs gap-1.5 font-medium shadow-xs cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-white" />
                    <span>Export</span>
                    <ChevronDown className="w-3 h-3 text-white/80 ml-0.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 p-1">
                  <DropdownMenuItem
                    onClick={() => handleExport('pdf')}
                    className="cursor-pointer gap-2 py-2"
                  >
                    <FileText className="w-4 h-4 text-rose-600 shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-semibold text-xs text-foreground">Export as PDF</span>
                      <span className="text-[10px] text-muted-foreground">Multi-page formatted document (.pdf)</span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleExport('excel')}
                    className="cursor-pointer gap-2 py-2"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-semibold text-xs text-foreground">Export as Excel (.xlsx)</span>
                      <span className="text-[10px] text-muted-foreground">Standard spreadsheet workbook (.xlsx)</span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleExport('csv')}
                    className="cursor-pointer gap-2 py-2"
                  >
                    <FileCode className="w-4 h-4 text-sky-600 shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-semibold text-xs text-foreground">Export as CSV</span>
                      <span className="text-[10px] text-muted-foreground">Raw comma-separated table (.csv)</span>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )}

        {/* Data Table Preview */}
        {isGenerating ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader className="bg-primary/5">
                <TableRow>
                  {activeHeaders.map((h) => (
                    <TableHead key={h} className="text-xs font-semibold text-foreground whitespace-nowrap">
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                <DataTableSkeleton columns={activeHeaders.length} rows={5} />
              </TableBody>
            </Table>
          </div>
        ) : !previewData || previewData.length === 0 ? (
          /* Clear "No Data Found" state (TS061 Criteria) */
          <div className="py-12 text-center space-y-2 border border-border/60 rounded-xl bg-muted/10">
            <Search className="w-8 h-8 text-muted-foreground mx-auto" />
            <h4 className="text-sm font-semibold text-foreground">No data found for the selected filters</h4>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              No matching ticket records were found for {branchName} under &ldquo;{selectedDepartment}&rdquo; within the {effectiveDateRange} range. Try selecting &ldquo;All Departments&rdquo; or expanding the date range.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader className="bg-primary/5">
                <TableRow>
                  {activeHeaders.map((h) => (
                    <TableHead key={h} className="text-xs font-semibold text-foreground whitespace-nowrap">
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewData.map((row, idx) => (
                  <TableRow key={idx} className="hover:bg-muted/40 transition-colors">
                    {activeHeaders.map((h) => {
                      const val = row[h] ?? '—';
                      const isStatus = h === 'Status' || h === 'SLA Status' || h === 'Reliability Status';
                      const isPriority = h === 'Priority' || h === 'Confidence / Risk Level';
                      return (
                        <TableCell key={h} className="text-xs py-2.5">
                          {isStatus ? (
                            <Badge variant={getStatusBadgeVariant(val)}>{val}</Badge>
                          ) : isPriority ? (
                            <Badge variant={String(val).includes('Critical') || String(val).includes('High') ? 'destructive' : 'secondary'}>
                              {val}
                            </Badge>
                          ) : (
                            <span className="text-foreground font-medium">{val}</span>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Preview Footer summary */}
        {previewData && previewData.length > 0 && (
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-2">
            <span>Showing {previewData.length} records ready for export</span>
            <span className="italic">Preview accurately reflects the data scope that will be downloaded.</span>
          </div>
        )}
      </div>
    </div>
  );
}
