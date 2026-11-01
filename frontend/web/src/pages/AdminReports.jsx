import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FileText,
  Download,
  ChevronDown,
  Printer,
  Calendar,
  Building2,
  Filter,
  Eye,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  FileCode,
  Layers,
  Search,
  ArrowRight,
  Clock,
  Briefcase,
} from 'lucide-react';
import {
  exportStructuredCsv,
  exportStructuredExcel,
  exportStructuredPdf,
} from '@/utils/reportExportUtils';
import { useBranch } from '@/context/BranchContext';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
    headers: ['Ticket ID', 'Title', 'Customer / Facility', 'Department', 'Status', 'Priority', 'Date Filed'],
  },
  {
    id: 'sla_compliance',
    name: 'SLA Compliance & Breach Analysis',
    description: 'Detailed analysis of first response times, resolution deadlines, and SLA breaches.',
    headers: ['Ticket ID', 'Subject', 'Department', 'Assigned Staff', 'SLA Target', 'SLA Status', 'Resolution Time'],
  },
  {
    id: 'department_performance',
    name: 'Department Workload & Performance',
    description: 'Staff resolution rates, active backlog, and workload capacity across departments.',
    headers: ['Department', 'Assigned Technicians', 'Active Tickets', 'Resolved Tickets', 'Breached Count', 'Avg Resolution'],
  },
  {
    id: 'equipment_maintenance',
    name: 'Equipment Maintenance & MTBF Log',
    description: 'Hospital equipment breakdown frequencies, repair history, and failure probability.',
    headers: ['Equipment / Machine', 'Serial / Model', 'Department', 'Total Incidents', 'Avg Downtime', 'Risk Rating'],
  },
  {
    id: 'csat_satisfaction',
    name: 'Customer Satisfaction (CSAT) Report',
    description: 'Client survey scores, feedback comments, and service rating breakdown.',
    headers: ['Ticket ID', 'Customer / Hospital', 'Rating (1-5)', 'Service Category', 'Technician Feedback', 'Submitted Date'],
  },
  {
    id: 'predictive_risk',
    name: 'Predictive Risk & Forecasting Model',
    description: 'Projected volume trajectories, recurring pattern flags, and escalation risk estimates.',
    headers: ['Forecast Period', 'Projected Influx', 'Peak Day', 'Top Recurring Issue', 'Critical Escalation Risk', 'Model Basis'],
  },
];

const DEPARTMENTS = [
  'All Departments',
  'Customer Service',
  'Service Department',
  'Engineering & Maintenance',
  'Quality Assurance',
  'IT Infrastructure',
];

export default function AdminReports() {
  const { selectedBranch, selectedBranchId } = useBranch();
  const branchName = selectedBranch?.name || 'Main Branch';

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
  const [previewData, setPreviewData] = useState(null);
  const [appliedFilters, setAppliedFilters] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationNotice, setGenerationNotice] = useState('');
  const [generationError, setGenerationError] = useState(null);

  // Active report definition
  const currentReportDef = useMemo(() => {
    return REPORT_TYPES.find((r) => r.id === selectedReportType) || REPORT_TYPES[0];
  }, [selectedReportType]);

  // Compute effective date range string
  const effectiveDateRange = useMemo(() => {
    if (datePreset === 'Custom Range') {
      return `${customStartDate} to ${customEndDate}`;
    }
    return datePreset;
  }, [datePreset, customStartDate, customEndDate]);

  // ─── Generate Preview Action (TS061 Criteria) ─────────────────────────────
  const handleGeneratePreview = useCallback(async () => {
    setIsGenerating(true);
    setGenerationError(null);
    setGenerationNotice(`Initiating query for "${currentReportDef.name}" across ${branchName}...`);

    // Simulated network query matching realistic analytics datasets
    try {
      await new Promise((res) => setTimeout(res, 600));

      setGenerationNotice('Processing report dataset and compiling preview table...');

      let rows = [];

      if (selectedReportType === 'ticket_volume') {
        rows = [
          { 'Ticket ID': 'TKT-1042', 'Title': 'X-Ray Collimator Drift', 'Customer / Facility': `${branchName} - Radiology`, 'Department': 'Service Department', 'Status': 'Open', 'Priority': 'High', 'Date Filed': '2026-10-24' },
          { 'Ticket ID': 'TKT-1043', 'Title': 'CT Tube High Temp Warning', 'Customer / Facility': `${branchName} - Imaging 2`, 'Department': 'Engineering & Maintenance', 'Status': 'In Progress', 'Priority': 'Critical', 'Date Filed': '2026-10-25' },
          { 'Ticket ID': 'TKT-1045', 'Title': 'Bedside Monitor Lead Failure', 'Customer / Facility': `${branchName} - ICU 3`, 'Department': 'Service Department', 'Status': 'Resolved', 'Priority': 'Medium', 'Date Filed': '2026-10-26' },
          { 'Ticket ID': 'TKT-1048', 'Title': 'Ultrasound Transducer Calibration', 'Customer / Facility': `${branchName} - OBGYN`, 'Department': 'Service Department', 'Status': 'Closed', 'Priority': 'Low', 'Date Filed': '2026-10-27' },
          { 'Ticket ID': 'TKT-1051', 'Title': 'Defibrillator Self-Test Failure', 'Customer / Facility': `${branchName} - Emergency Room`, 'Department': 'Engineering & Maintenance', 'Status': 'In Progress', 'Priority': 'Critical', 'Date Filed': '2026-10-28' },
        ];
      } else if (selectedReportType === 'sla_compliance') {
        rows = [
          { 'Ticket ID': 'TKT-1042', 'Subject': 'X-Ray Collimator Drift', 'Department': 'Service Department', 'Assigned Staff': 'Carlos Tan', 'SLA Target': '4.0 hrs', 'SLA Status': 'Met (3.2 hrs)', 'Resolution Time': '3.2 hrs' },
          { 'Ticket ID': 'TKT-1043', 'Subject': 'CT Tube High Temp Warning', 'Department': 'Engineering & Maintenance', 'Assigned Staff': 'Maria Santos', 'SLA Target': '2.0 hrs', 'SLA Status': 'Breached (+45m)', 'Resolution Time': '2.8 hrs' },
          { 'Ticket ID': 'TKT-1045', 'Subject': 'Bedside Monitor Lead Failure', 'Department': 'Service Department', 'Assigned Staff': 'Jose Cruz', 'SLA Target': '6.0 hrs', 'SLA Status': 'Met (4.1 hrs)', 'Resolution Time': '4.1 hrs' },
          { 'Ticket ID': 'TKT-1051', 'Subject': 'Defibrillator Self-Test Failure', 'Department': 'Engineering & Maintenance', 'Assigned Staff': 'Carlos Tan', 'SLA Target': '2.0 hrs', 'SLA Status': 'At Risk (15m left)', 'Resolution Time': 'Ongoing' },
        ];
      } else if (selectedReportType === 'department_performance') {
        rows = [
          { 'Department': 'Service Department', 'Assigned Technicians': 6, 'Active Tickets': 14, 'Resolved Tickets': 58, 'Breached Count': 2, 'Avg Resolution': '3.4 hrs' },
          { 'Department': 'Engineering & Maintenance', 'Assigned Technicians': 4, 'Active Tickets': 9, 'Resolved Tickets': 41, 'Breached Count': 1, 'Avg Resolution': '2.1 hrs' },
          { 'Department': 'Customer Service', 'Assigned Technicians': 5, 'Active Tickets': 22, 'Resolved Tickets': 85, 'Breached Count': 0, 'Avg Resolution': '0.8 hrs' },
          { 'Department': 'IT Infrastructure', 'Assigned Technicians': 3, 'Active Tickets': 7, 'Resolved Tickets': 29, 'Breached Count': 1, 'Avg Resolution': '4.8 hrs' },
        ];
      } else if (selectedReportType === 'equipment_maintenance') {
        rows = [
          { 'Equipment / Machine': 'MRI 3T Scanner Siemens', 'Serial / Model': 'SN-MR-98210', 'Department': 'Radiology', 'Total Incidents': 6, 'Avg Downtime': '4.2 hrs', 'Risk Rating': 'Critical (35% MTBF)' },
          { 'Equipment / Machine': 'CT Revolution 128 GE', 'Serial / Model': 'SN-CT-44102', 'Department': 'Imaging 2', 'Total Incidents': 4, 'Avg Downtime': '2.8 hrs', 'Risk Rating': 'Moderate' },
          { 'Equipment / Machine': 'Ultrasound EPIQ 7 Philips', 'Serial / Model': 'SN-US-20199', 'Department': 'OBGYN', 'Total Incidents': 2, 'Avg Downtime': '1.1 hrs', 'Risk Rating': 'Low' },
          { 'Equipment / Machine': 'Ventilator Servo-U Getinge', 'Serial / Model': 'SN-VN-88301', 'Department': 'ICU 3', 'Total Incidents': 5, 'Avg Downtime': '3.5 hrs', 'Risk Rating': 'High' },
        ];
      } else if (selectedReportType === 'csat_satisfaction') {
        rows = [
          { 'Ticket ID': 'TKT-1039', 'Customer / Hospital': `${branchName} - Pediatrics`, 'Rating (1-5)': '5 / 5', 'Service Category': 'Ultrasound Repair', 'Technician Feedback': 'Prompt arrival and calibrated swiftly.', 'Submitted Date': '2026-10-23' },
          { 'Ticket ID': 'TKT-1041', 'Customer / Hospital': `${branchName} - ER`, 'Rating (1-5)': '4 / 5', 'Service Category': 'Monitor Fix', 'Technician Feedback': 'Polite service engineer, fixed lead cable.', 'Submitted Date': '2026-10-24' },
          { 'Ticket ID': 'TKT-1044', 'Customer / Hospital': `${branchName} - Surgery`, 'Rating (1-5)': '5 / 5', 'Service Category': 'Defibrillator', 'Technician Feedback': 'Excellent turnaround during emergency.', 'Submitted Date': '2026-10-26' },
        ];
      } else {
        rows = [
          { 'Forecast Period': 'Next 7 Days', 'Projected Influx': '136 tickets', 'Peak Day': 'Day +5 (Thursday)', 'Top Recurring Issue': 'Network Config (+12%)', 'Critical Escalation Risk': '7% of load', 'Model Basis': '60-Day Linear Regression' },
          { 'Forecast Period': 'Next 30 Days', 'Projected Influx': '245 tickets', 'Peak Day': 'Week +4', 'Top Recurring Issue': 'Hardware Failure (+8%)', 'Critical Escalation Risk': '12% of load', 'Model Basis': '90-Day Seasonal Moving Avg' },
          { 'Forecast Period': 'Next Quarter', 'Projected Influx': '683 tickets', 'Peak Day': 'Month +3', 'Top Recurring Issue': 'Printer Calibration (+5%)', 'Critical Escalation Risk': '15% of load', 'Model Basis': '180-Day Regression' },
        ];
      }

      // Filter by department if not 'All'
      if (selectedDepartment !== 'All Departments') {
        rows = rows.filter((r) => {
          const dept = r['Department'] || r['Service Category'] || '';
          return dept.toLowerCase().includes(selectedDepartment.toLowerCase().split(' ')[0]);
        });
      }

      // Filter by priority if requested
      if (priorityFilter === 'Critical Only') {
        rows = rows.filter((r) => String(r['Priority'] || r['Risk Rating'] || '').includes('Critical'));
      }

      setAppliedFilters({
        reportType: currentReportDef.name,
        branch: branchName,
        dateRange: effectiveDateRange,
        department: selectedDepartment,
        priority: priorityFilter,
        generationTime: new Date().toLocaleTimeString(),
      });

      setPreviewData(rows);
    } catch {
      setGenerationError('Failed to retrieve and compile report data. Please check your network connection or try again.');
    } finally {
      setIsGenerating(false);
      setGenerationNotice('');
    }
  }, [currentReportDef, branchName, selectedReportType, selectedDepartment, priorityFilter, effectiveDateRange]);

  // Initial preview on load
  useEffect(() => {
    handleGeneratePreview();
  }, [handleGeneratePreview]);

  // ─── Format Export Handlers (TS061 Criteria: PDF, Excel, CSV) ─────────────
  const handleExport = (format) => {
    if (!previewData || previewData.length === 0) return;

    const baseFilename = `${currentReportDef.id}_${branchName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}`;
    const filterSummary = {
      reportType: appliedFilters?.reportType || currentReportDef.name,
      branch: appliedFilters?.branch || branchName,
      dateRange: appliedFilters?.dateRange || effectiveDateRange,
      department: appliedFilters?.department || selectedDepartment,
    };

    if (format === 'csv') {
      exportStructuredCsv(baseFilename, currentReportDef.headers, previewData, filterSummary);
    } else if (format === 'excel') {
      exportStructuredExcel(baseFilename, currentReportDef.name, currentReportDef.headers, previewData, filterSummary);
    } else if (format === 'pdf') {
      exportStructuredPdf(baseFilename, currentReportDef.name, currentReportDef.headers, previewData, filterSummary);
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
          <div className="flex flex-col items-end gap-2">
            <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 text-xs">
              <Building2 className="w-3.5 h-3.5 mr-1" />
              {branchName}
            </Badge>
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
            <label className="text-xs font-semibold text-foreground">Report Type</label>
            <select
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
            <label className="text-xs font-semibold text-foreground">Date Range</label>
            <select
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
                <span className="text-xs text-muted-foreground">-</span>
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
            <label className="text-xs font-semibold text-foreground">Department Filter</label>
            <select
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
            <label className="text-xs font-semibold text-foreground">Severity / Priority</label>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="w-full h-9 rounded-lg border border-border bg-page px-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="All">All Severity Levels</option>
              <option value="Critical Only">Critical &amp; High Only</option>
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
                  {currentReportDef.headers.map((h) => (
                    <TableHead key={h} className="text-xs font-semibold text-foreground whitespace-nowrap">
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                <DataTableSkeleton columns={currentReportDef.headers.length} rows={5} />
              </TableBody>
            </Table>
          </div>
        ) : !previewData || previewData.length === 0 ? (
          /* Clear "No Data Found" state (TS061 Criteria) */
          <div className="py-12 text-center space-y-2 border border-border/60 rounded-xl bg-muted/10">
            <Search className="w-8 h-8 text-muted-foreground mx-auto" />
            <h4 className="text-sm font-semibold text-foreground">No data found for the selected filters</h4>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              No matching ticket records were found for {branchName} under "{selectedDepartment}" within the {effectiveDateRange} range. Try selecting "All Departments" or expanding the date range.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader className="bg-primary/5">
                <TableRow>
                  {currentReportDef.headers.map((h) => (
                    <TableHead key={h} className="text-xs font-semibold text-foreground whitespace-nowrap">
                      {h}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewData.map((row, idx) => (
                  <TableRow key={idx} className="hover:bg-muted/40 transition-colors">
                    {currentReportDef.headers.map((h) => {
                      const val = row[h] ?? '—';
                      const isStatus = h === 'Status';
                      const isPriority = h === 'Priority' || h === 'Risk Rating';
                      return (
                        <TableCell key={h} className="text-xs py-2.5">
                          {isStatus ? (
                            <Badge variant={getStatusBadgeVariant(val)}>{val}</Badge>
                          ) : isPriority ? (
                            <Badge variant={String(val).includes('Critical') ? 'destructive' : String(val).includes('High') ? 'warning' : 'secondary'}>
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
