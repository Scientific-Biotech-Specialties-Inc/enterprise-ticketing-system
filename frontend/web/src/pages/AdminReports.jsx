import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FileText,
  Download,
  ChevronDown,
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
import {
  DATE_RANGE_ERROR_MESSAGE,
  isDateRangeValid,
  resolveStartDateUpdate,
  resolveEndDateUpdate,
} from '@/utils/dateUtils';

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
  const [dateRangeError, setDateRangeError] = useState('');

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
    if (datePreset === 'Custom Range' && !isDateRangeValid(customStartDate, customEndDate)) {
      setDateRangeError(DATE_RANGE_ERROR_MESSAGE);
      setGenerationError(DATE_RANGE_ERROR_MESSAGE);
      return;
    }
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
    if (datePreset === 'Custom Range' && !isDateRangeValid(customStartDate, customEndDate)) {
      setDateRangeError(DATE_RANGE_ERROR_MESSAGE);
      setGenerationError(DATE_RANGE_ERROR_MESSAGE);
      return;
    }

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

      {/* ─── Filter Toolbar (Matches dropdown styling across other roles) ──── */}
      <div className="w-full space-y-2.5">
        <div className="flex flex-wrap items-center gap-2.5 w-full">
          {/* 1. Report Type Selector */}
          <select
            id="report-type-select"
            aria-label="Report Type"
            title="Report Type"
            value={selectedReportType}
            onChange={(e) => setSelectedReportType(e.target.value)}
            className="h-10 flex-1 min-w-[180px] rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors cursor-pointer"
          >
            {REPORT_TYPES.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>

          {/* 2. Date Range Presets */}
          <select
            id="report-date-range-select"
            aria-label="Date Range"
            title="Date Range"
            value={datePreset}
            onChange={(e) => {
              setDatePreset(e.target.value);
              setDateRangeError('');
            }}
            className="h-10 flex-1 min-w-[140px] rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors cursor-pointer"
          >
            {['Today', 'Last 7 Days', 'Last 30 Days', 'Last 90 Days', 'Custom Range'].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>

          {/* 3. Department Scope */}
          <select
            id="report-department-select"
            aria-label="Department Filter"
            title="Department Filter"
            value={selectedDepartment}
            onChange={(e) => setSelectedDepartment(e.target.value)}
            className="h-10 flex-1 min-w-[150px] rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors cursor-pointer"
          >
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>

          {/* 4. Priority Filter */}
          <select
            id="report-priority-select"
            aria-label="Severity / Priority"
            title="Severity / Priority"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="h-10 flex-1 min-w-[140px] rounded-lg border border-border bg-card px-3 text-xs font-semibold text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors cursor-pointer"
          >
            <option value="All">All Severity Levels</option>
            <option value="Critical Only">Critical Only</option>
            <option value="High">High Only</option>
            <option value="Medium">Medium Only</option>
            <option value="Low">Low Only</option>
          </select>
        </div>

        {datePreset === 'Custom Range' && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                aria-label="Start date"
                value={customStartDate}
                onChange={(e) => {
                  const next = resolveStartDateUpdate(e.target.value, customEndDate);
                  setCustomStartDate(next.startDate);
                  setCustomEndDate(next.endDate);
                  setDateRangeError(next.error);
                }}
                className="h-9 px-3 text-xs border border-border rounded-lg bg-card text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <input
                type="date"
                aria-label="End date"
                min={customStartDate || undefined}
                value={customEndDate}
                onChange={(e) => {
                  const next = resolveEndDateUpdate(customStartDate, e.target.value);
                  if (!next.valid) {
                    setDateRangeError(next.error);
                    return;
                  }
                  setCustomEndDate(next.endDate);
                  setDateRangeError('');
                }}
                className="h-9 px-3 text-xs border border-border rounded-lg bg-card text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>
            {dateRangeError && (
              <p role="alert" className="text-xs text-destructive font-medium">
                {dateRangeError}
              </p>
            )}
          </div>
        )}

        {isGenerating && generationNotice && (
          <p className="text-xs text-primary font-medium flex items-center gap-1.5">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            {generationNotice}
          </p>
        )}
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
        {/* Report Title & Export Action */}
        {appliedFilters && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground">Report:</span>
                <span className="text-primary font-semibold">{appliedFilters.reportType}</span>
              </div>
              {appliedFilters.generationTime && (
                <p className="text-muted-foreground text-[11px]">
                  Generated: <strong className="text-foreground">{appliedFilters.generationTime}</strong>
                </p>
              )}
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
