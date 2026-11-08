import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { buildXlsx, XLSX_MIME } from './xlsx';

/**
 * Downloads raw CSV spreadsheet file formatted for Microsoft Excel / Google Sheets data analysis.
 */
export function downloadCsv(filename, csvContent) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Direct PDF Download helper: Captures DOM element using html2canvas & jsPDF and downloads .pdf file.
 */
export async function downloadPdfFromElement(elementId, filename = 'Report.pdf') {
  const element = document.getElementById(elementId);
  if (!element) {
    console.error(`Element #${elementId} not found for PDF export.`);
    window.print();
    return;
  }

  try {
    const canvas = await html2canvas(element, {
      scale: 1.5,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      windowWidth: document.documentElement.offsetWidth,
      windowHeight: document.documentElement.offsetHeight,
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4',
    });

    const imgWidth = 297; // A4 landscape width in mm
    const pageHeight = 210; // A4 landscape height in mm
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft >= 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    pdf.save(filename);
  } catch (err) {
    console.error('Canvas capture failed, generating fallback PDF document:', err);
    generateFallbackPdf(filename);
  }
}

function generateFallbackPdf(filename) {
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text('Enterprise Analytics & Performance Report', 14, 20);
  doc.setFontSize(11);
  doc.text(`Generated Date: ${new Date().toLocaleDateString()}`, 14, 30);
  doc.text('Report export generated successfully.', 14, 40);
  doc.save(filename);
}

export function triggerPdfPrint() {
  window.print();
}

// ─── Shared helpers for analytics exports ───────────────────────────────────
// Exports only ever contain figures the server returned. A value that is missing is written as
// "Unavailable" so a shared report can never present an invented number as fact.

const UNAVAILABLE = 'Unavailable';
const EXPORT_HEADERS = ['Section', 'Metric', 'Value', 'Unit', 'Note'];

const isPresent = (v) => v !== null && v !== undefined && v !== '' && !(typeof v === 'number' && Number.isNaN(v));
const val = (v) => (isPresent(v) ? v : UNAVAILABLE);

const csvCell = (value) => {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

function rowsToCsv(headers, rows, metaLines = []) {
  const lines = [...metaLines.map((m) => m.map(csvCell).join(',')), ...(metaLines.length ? [''] : [])];
  lines.push(headers.map(csvCell).join(','));
  rows.forEach((r) => lines.push(r.map(csvCell).join(',')));
  return lines.join('\r\n') + '\r\n';
}

/** Branch dashboard payload: `{ kpis, status_distribution, sla, csat, workload, departments, employee_performance, recurring_issues }`. */
function branchAnalyticsRows(data) {
  const k = data.kpis || {};
  const rows = [];
  const add = (section, metric, value, unit = '', note = '') => rows.push([section, metric, val(value), unit, note]);

  add('Tickets', 'Total tickets', k.total_tickets);
  add('Tickets', 'Resolved tickets', k.resolved_tickets, '', 'Resolved plus closed');
  add('Tickets', 'Open tickets', k.open_tickets);
  add('Tickets', 'In progress tickets', k.in_progress_tickets);
  add('Tickets', 'On hold tickets', k.on_hold_tickets);
  add('Tickets', 'Closed tickets', k.closed_tickets);
  add('Resolution', 'Average resolution time', k.avg_resolution_hours, 'hours');
  add('SLA', 'SLA compliance rate', k.sla_compliance_rate, '%');
  add('SLA', 'Within SLA', k.sla_met_count, 'tickets');
  add('SLA', 'Breached', k.sla_breached_count, 'tickets');
  add('Customer satisfaction', 'Average CSAT', k.csat_score, 'out of 5',
    isPresent(k.csat_score) ? '' : 'Customer feedback service did not return a score');
  add('Customer satisfaction', 'Feedback reviews', k.total_csat_reviews, 'reviews');
  add('Staffing', 'Active employees', k.active_employees_count);

  (data.recurring_issues?.top_categories || []).forEach((c) =>
    add('Recurring issues: categories', c.name, c.count, 'tickets', isPresent(c.percentage) ? `${c.percentage}% of period tickets` : ''));
  (data.recurring_issues?.top_equipment || []).forEach((m) =>
    add('Recurring issues: equipment', m.name, m.count, 'tickets', isPresent(m.percentage) ? `${m.percentage}% of period tickets` : ''));

  const byEmployee = data.workload?.by_employee;
  (byEmployee?.labels || []).forEach((label, i) =>
    add('Employee workload', label, byEmployee.data?.[i], 'open tickets'));

  (data.departments?.departments || data.departments || []).forEach((d) => {
    if (!d || !d.department) return;
    add(`Department: ${d.department}`, 'Tickets handled', d.has_data === false ? 'No data for this period' : d.total_tickets);
    add(`Department: ${d.department}`, 'SLA compliance', d.sla_compliance_rate, '%');
    add(`Department: ${d.department}`, 'Open (within SLA)', d.open_tickets_count, 'tickets');
    add(`Department: ${d.department}`, 'Overdue (breached)', d.overdue_tickets_count, 'tickets');
  });

  return rows;
}

/** Super Admin system dashboard payload after adaptSystemDashboard(). */
function systemAnalyticsRows(data) {
  const rows = [];
  const add = (section, metric, value, unit = '', note = '') => rows.push([section, metric, val(value), unit, note]);
  const u = data.totalUsers || {};
  const kp = data.systemKpis || {};

  add('Users', 'Total users', u.total);
  add('Users', 'Customers', u.customer);
  add('Users', 'Employees', u.employee);
  add('Users', 'Customer service', u.cs);
  add('Users', 'Admins', u.admin);
  add('Users', 'Super admins', u.superAdmin);
  add('Tickets', 'Total tickets', data.totalTickets);
  add('Tickets', 'Active tickets', data.activeEscalated);
  add('Tickets', 'Escalated tickets', data.escalatedTickets);
  add('Tickets', 'SLA breaches', data.slaBreaches);
  add('Tickets', 'Created today', data.ticketsCreatedToday, '', 'Always today, not filtered by period');
  add('System KPIs', 'Overall SLA compliance', kp.overallSlaCompliance, '%');
  add('System KPIs', 'Overall average CSAT', kp.overallAvgCsat, 'out of 5',
    isPresent(kp.overallAvgCsat) ? '' : 'Customer feedback service did not return a score');
  add('System KPIs', 'Overall resolution time', kp.overallResolutionTime, 'hours');

  (data.branchComparison || []).forEach((b) => {
    add(`Branch: ${b.name}`, 'Total tickets', b.totalTickets);
    add(`Branch: ${b.name}`, 'Resolved tickets', b.resolvedTickets);
    add(`Branch: ${b.name}`, 'SLA compliance', b.totalTickets === 0 ? 'No data for this period' : b.slaCompliance, '%');
    add(`Branch: ${b.name}`, 'Average resolution time', b.avgResolutionTime, 'hours');
    add(`Branch: ${b.name}`, 'Average CSAT', b.avgCsat, 'out of 5');
  });

  return rows;
}

/** One entry point for both dashboards. Returns Section / Metric / Value / Unit / Note rows. */
export function buildAnalyticsExportRows(data) {
  if (data?.kpis) return branchAnalyticsRows(data);
  if (data?.systemKpis) return systemAnalyticsRows(data);
  return [['Report', 'Dashboard data', UNAVAILABLE, '', 'No dashboard data was loaded when the export was requested']];
}

/** Predictive payload from `GET /admin-reports/predictive-insights`. */
export function buildPredictiveExportRows(data) {
  const rows = [];
  const add = (section, metric, value, unit = '', note = '') => rows.push([section, metric, val(value), unit, note]);

  if (!data || (!data.volume_forecast && !data.recurring_issues && !data.status)) {
    return [['Forecast', 'Predictive data', UNAVAILABLE, '', 'The forecast was not available when the export was requested']];
  }

  const basis = data.historical_basis || {};
  add('Basis', 'Model', basis.model);
  add('Basis', 'Days of history used', basis.days_used, 'days', 'A forecast is an estimate, not a guarantee');
  if (data.status === 'insufficient_data') {
    add('Basis', 'Status', data.message || 'Not enough history for a reliable forecast', '', `At least ${basis.minimum_days_required ?? 14} days are needed`);
  }

  (data.volume_forecast || []).forEach((d) =>
    add('Projected ticket volume', d.date, d.predicted_volume, 'tickets', `Range ${d.lower_bound ?? '?'} to ${d.upper_bound ?? '?'} (${d.day_of_week || ''})`.trim()));

  const trendNote = (t) => {
    const change = isPresent(t.change_percentage) ? `${Number(t.change_percentage) > 0 ? '+' : ''}${Number(t.change_percentage).toFixed(1)}% vs baseline` : '';
    return [change, isPresent(t.baseline_frequency) ? `baseline ${t.baseline_frequency}` : ''].filter(Boolean).join(', ');
  };
  (data.recurring_issues?.categories || []).forEach((t) =>
    add('Rising categories', t.item_name, t.recent_frequency, 'tickets (recent)', trendNote(t)));
  (data.recurring_issues?.machines || []).forEach((t) =>
    add('Rising equipment', t.item_name, t.recent_frequency, 'tickets (recent)', trendNote(t)));

  return rows;
}

const todayStamp = () => new Date().toISOString().split('T')[0];

/** CSV for the operational dashboards (Branch and System). */
export function exportAnalyticsToCsv(data, period = '') {
  const rows = buildAnalyticsExportRows(data);
  const meta = [['Operational Analytics Report'], ['Generated', new Date().toISOString()], ...(period ? [['Period', period]] : [])];
  downloadCsv(`Operational_Analytics_${todayStamp()}.csv`, rowsToCsv(EXPORT_HEADERS, rows, meta));
}

/** CSV for the predictive forecast. */
export function exportPredictiveToCsv(data, period = '') {
  const rows = buildPredictiveExportRows(data);
  const meta = [['Predictive Analytics Report'], ['Generated', new Date().toISOString()], ...(period ? [['Period', period]] : [])];
  downloadCsv(`Predictive_Analytics_${todayStamp()}.csv`, rowsToCsv(EXPORT_HEADERS, rows, meta));
}

/** Kept for existing callers: the master report is the operational analytics report. */
export function exportMasterReportToCsv(data) {
  exportAnalyticsToCsv(data);
}

/**
 * Structured CSV Export with Header and Filter Metadata (TS061)
 */
export function exportStructuredCsv(filename, headers, rows, filterSummary = {}) {
  const dateStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
  let csv = `"ENTERPRISE SERVICE DESK REPORT"\n`;
  csv += `"Generated At","${dateStr}"\n`;
  if (filterSummary.reportType) csv += `"Report Type","${filterSummary.reportType}"\n`;
  if (filterSummary.dateRange) csv += `"Date Range","${filterSummary.dateRange}"\n`;
  if (filterSummary.branch) csv += `"Branch Scope","${filterSummary.branch}"\n`;
  if (filterSummary.department) csv += `"Department","${filterSummary.department}"\n`;
  csv += `\n`;

  // Headers
  csv += headers.map((h) => `"${String(h).replace(/"/g, '""')}"`).join(',') + '\n';

  // Rows
  rows.forEach((r) => {
    const rowValues = headers.map((h) => {
      const val = r[h] !== undefined ? r[h] : (r[h.toLowerCase().replace(/\s+/g, '_')] ?? '');
      return `"${String(val).replace(/"/g, '""')}"`;
    });
    csv += rowValues.join(',') + '\n';
  });

  downloadCsv(filename.endsWith('.csv') ? filename : `${filename}.csv`, csv);
}

function downloadBytes(filename, bytes, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const ensureXlsx = (filename) => filename.replace(/\.(xlsx|csv|pdf)$/i, '') + '.xlsx';

/**
 * Structured Excel export (spec 0029 AC-16): a genuine .xlsx workbook with a title, filter summary,
 * a frozen filterable header row and real numeric cells.
 */
export function exportStructuredExcel(filename, reportTitle, headers, rows, filterSummary = {}) {
  const generated = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const matrix = rows.map((r) =>
    headers.map((h) => (r[h] !== undefined ? r[h] : (r[h.toLowerCase().replace(/\s+/g, '_')] ?? '')))
  );

  const bytes = buildXlsx({
    sheetName: 'Report',
    title: reportTitle,
    meta: [
      ['Generated At:', generated],
      ['Branch Scope:', filterSummary.branch || 'All Branches'],
      ['Date Range:', filterSummary.dateRange || 'Standard Period'],
      ['Department:', filterSummary.department || 'All Departments'],
    ],
    headers,
    rows: matrix,
  });
  downloadBytes(ensureXlsx(filename), bytes, XLSX_MIME);
}

/** Excel for the operational dashboards (Branch and System). */
export function exportAnalyticsToExcel(data, period = 'Active Period') {
  const rows = buildAnalyticsExportRows(data).map(([section, metric, value, unit, note]) => ({
    Section: section, Metric: metric, Value: value, Unit: unit, Note: note,
  }));
  exportStructuredExcel(`Operational_Analytics_${todayStamp()}.xlsx`, 'Operational Analytics Report', EXPORT_HEADERS, rows, {
    dateRange: period,
    department: 'All Departments',
  });
}

/** Excel for the predictive forecast. */
export function exportPredictiveToExcel(data, period = '') {
  const rows = buildPredictiveExportRows(data).map(([section, metric, value, unit, note]) => ({
    Section: section, Metric: metric, Value: value, Unit: unit, Note: note,
  }));
  exportStructuredExcel(`Predictive_Analytics_${todayStamp()}.xlsx`, 'Predictive Analytics Report', EXPORT_HEADERS, rows, {
    dateRange: period || 'Next 7 and 30 days',
    department: 'Branch forecast',
  });
}

/**
 * Structured PDF Export using jsPDF with proper page layout & headers (TS061)
 */
export function exportStructuredPdf(filename, reportTitle, headers, rows, filterSummary = {}) {
  const cleanFilename = filename.replace(/\.(pdf|csv|xlsx)$/i, '') + '.pdf';
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const dateStr = new Date().toISOString().replace('T', ' ').substring(0, 19);

  const pageWidth = 297;
  const pageHeight = 210;
  const margin = 14;
  let currentY = 18;

  // Header Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(37, 37, 120); // Brand primary
  doc.text(reportTitle, margin, currentY);

  currentY += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated on: ${dateStr} | Enterprise IT Service Desk`, margin, currentY);

  // Filter Summary Box
  currentY += 5;
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, currentY, pageWidth - margin * 2, 12, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);
  const filterText = `Filters: Branch Scope: [${filterSummary.branch || 'All'}] | Range: [${filterSummary.dateRange || 'All'}] | Dept: [${filterSummary.department || 'All'}]`;
  doc.text(filterText, margin + 4, currentY + 7);

  // Table Setup
  currentY += 18;
  const colWidth = (pageWidth - margin * 2) / headers.length;

  // Draw Table Headers
  doc.setFillColor(37, 37, 120);
  doc.rect(margin, currentY, pageWidth - margin * 2, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);

  headers.forEach((h, idx) => {
    doc.text(String(h), margin + idx * colWidth + 2, currentY + 5.5);
  });

  currentY += 8;

  // Draw Rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);

  let pageNum = 1;

  rows.forEach((r, rowIdx) => {
    if (currentY + 7 > pageHeight - 15) {
      // Add page break
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(`Page ${pageNum}`, pageWidth - margin - 15, pageHeight - 8);

      doc.addPage();
      pageNum++;
      currentY = 16;

      // Repeat Table Header
      doc.setFillColor(37, 37, 120);
      doc.rect(margin, currentY, pageWidth - margin * 2, 8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      headers.forEach((h, idx) => {
        doc.text(String(h), margin + idx * colWidth + 2, currentY + 5.5);
      });
      currentY += 8;
    }

    // Row alternating background
    if (rowIdx % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, currentY, pageWidth - margin * 2, 7, 'F');
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(30, 41, 59);

    headers.forEach((h, colIdx) => {
      const val = r[h] !== undefined ? r[h] : (r[h.toLowerCase().replace(/\s+/g, '_')] ?? '');
      const text = String(val).substring(0, 32);
      doc.text(text, margin + colIdx * colWidth + 2, currentY + 4.8);
    });

    currentY += 7;
  });

  // Footer page number
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(`Page ${pageNum}`, pageWidth - margin - 15, pageHeight - 8);

  doc.save(cleanFilename);
}
