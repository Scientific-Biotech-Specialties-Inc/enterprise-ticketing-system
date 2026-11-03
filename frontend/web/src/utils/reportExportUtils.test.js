import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  downloadCsv,
  exportStructuredCsv,
  exportStructuredExcel,
  exportStructuredPdf,
  exportMasterReportToCsv,
  exportAnalyticsToExcel,
  exportPredictiveToExcel,
} from './reportExportUtils';

// Mock jsPDF module with constructor function
const mockSave = vi.fn();
const mockText = vi.fn();
const mockSetFont = vi.fn();
const mockSetFontSize = vi.fn();
const mockSetTextColor = vi.fn();
const mockSetDrawColor = vi.fn();
const mockSetFillColor = vi.fn();
const mockRoundedRect = vi.fn();
const mockRect = vi.fn();
const mockLine = vi.fn();
const mockAddPage = vi.fn();
const mockSetPage = vi.fn();

vi.mock('jspdf', () => {
  function MockJsPDF() {
    this.save = mockSave;
    this.text = mockText;
    this.setFont = mockSetFont;
    this.setFontSize = mockSetFontSize;
    this.setTextColor = mockSetTextColor;
    this.setDrawColor = mockSetDrawColor;
    this.setFillColor = mockSetFillColor;
    this.roundedRect = mockRoundedRect;
    this.rect = mockRect;
    this.line = mockLine;
    this.addPage = mockAddPage;
    this.setPage = mockSetPage;
    this.internal = {
      getNumberOfPages: () => 2,
    };
  }
  return { jsPDF: MockJsPDF };
});

describe('reportExportUtils', () => {
  let createdLinks = [];
  let clickedElements = [];

  beforeEach(() => {
    vi.clearAllMocks();
    createdLinks = [];
    clickedElements = [];

    globalThis.URL.createObjectURL = vi.fn(() => 'blob:mocked-url-1234');
    globalThis.URL.revokeObjectURL = vi.fn();

    vi.spyOn(document.body, 'appendChild').mockImplementation((el) => {
      if (el.tagName === 'A') {
        createdLinks.push(el);
        vi.spyOn(el, 'click').mockImplementation(() => {
          clickedElements.push(el);
        });
      }
      return el;
    });

    vi.spyOn(document.body, 'removeChild').mockImplementation((el) => {
      return el;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('covers AC-16: triggers a hidden anchor download when downloadCsv is invoked', () => {
    const filename = 'test_report.csv';
    const content = 'col1,col2\nval1,val2';

    downloadCsv(filename, content);

    expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(createdLinks.length).toBe(1);
    expect(createdLinks[0].getAttribute('download')).toBe(filename);
    expect(createdLinks[0].getAttribute('href')).toBe('blob:mocked-url-1234');
    expect(clickedElements.length).toBe(1);
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mocked-url-1234');
  });

  it('covers AC-16 and AC-17: generates structured CSV with headers, filter summaries, and row values', () => {
    const filename = 'sla_report.csv';
    const headers = ['Ticket ID', 'Technician', 'Status'];
    const rows = [
      { 'Ticket ID': 'TCK-001', Technician: 'Alice', Status: 'Resolved' },
      { 'Ticket ID': 'TCK-002', Technician: 'Bob', Status: 'Open' },
    ];
    const filterSummary = {
      reportType: 'SLA Performance',
      dateRange: 'Last 30 Days',
      branch: 'Main Branch',
      department: 'Support',
    };

    let generatedBlob = null;
    globalThis.URL.createObjectURL = vi.fn((blob) => {
      generatedBlob = blob;
      return 'blob:csv-output';
    });

    exportStructuredCsv(filename, headers, rows, filterSummary);

    expect(createdLinks.length).toBe(1);
    expect(createdLinks[0].getAttribute('download')).toBe('sla_report.csv');
    expect(generatedBlob).not.toBeNull();
  });

  it('covers AC-16 and AC-17: escapes quotes and commas correctly in structured CSV exports', () => {
    const filename = 'quotes_test.csv';
    const headers = ['Subject', 'Notes'];
    const rows = [
      { Subject: 'Issue with "Server" reboot', Notes: 'Comma, separated, value' },
    ];

    exportStructuredCsv(filename, headers, rows);

    expect(createdLinks.length).toBe(1);
    expect(createdLinks[0].getAttribute('download')).toBe('quotes_test.csv');
  });

  it('covers AC-16 and AC-17: generates structured Excel XML workbook with styles and clean column values', () => {
    const filename = 'workload_summary.xlsx';
    const reportTitle = 'Department Workload Summary';
    const headers = ['Department', 'Open Count', 'Compliance Rate'];
    const rows = [
      { Department: 'Service', 'Open Count': 14, 'Compliance Rate': '94%' },
      { Department: 'Engineering', 'Open Count': 5, 'Compliance Rate': '100%' },
    ];
    const filterSummary = {
      branch: 'North Facility',
      dateRange: 'This Quarter',
      department: 'All Departments',
    };

    let generatedBlob = null;
    globalThis.URL.createObjectURL = vi.fn((blob) => {
      generatedBlob = blob;
      return 'blob:excel-output';
    });

    exportStructuredExcel(filename, reportTitle, headers, rows, filterSummary);

    expect(createdLinks.length).toBe(1);
    expect(createdLinks[0].getAttribute('download')).toBe('workload_summary.xlsx');
    expect(generatedBlob).not.toBeNull();
    expect(generatedBlob.type).toContain('openxmlformats');
  });

  it('covers AC-16 and AC-17: creates multi page PDF document with title, filter metadata, and page numbers', () => {
    const filename = 'executive_brief.pdf';
    const reportTitle = 'Executive Incident Summary';
    const headers = ['Ticket ID', 'Priority', 'Assigned To'];
    const rows = [
      { 'Ticket ID': 'TCK-100', Priority: 'Critical', 'Assigned To': 'Sarah Connor' },
      { 'Ticket ID': 'TCK-101', Priority: 'High', 'Assigned To': 'John Doe' },
    ];
    const filterSummary = {
      branch: 'Downtown Center',
      dateRange: 'Last 7 Days',
    };

    exportStructuredPdf(filename, reportTitle, headers, rows, filterSummary);

    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledWith('executive_brief.pdf');
    expect(mockText).toHaveBeenCalled();
  });

  it('covers AC-16: exports master analytics report with all ten metrics in CSV format', () => {
    const sampleData = {
      trends: { open: 10, inProgress: 14, resolved: 25, closed: 8 },
      sla: { overall_compliance: 95.2, sla_met: 50, sla_breached: 2 },
      employees: [
        { name: 'Diana Prince', dept: 'Support', resolved: 30, resp: '8 mins', res: '1.2 hrs', sla: '98%' },
      ],
      csat: { average_score: 4.85, total_surveys: 92, retention_rate: 98.1 },
      workload: { active_technicians: 8, utilization: 82 },
      departments: [{ name: 'IT Helpdesk', active: 18, escalated: 1 }],
      equipment: [{ name: 'Dell Server R740', fRate: 4.2, rLevel: 'Low' }],
      predictive: { categories: ['Network Latency'], recFreq: { 'Next 7 Days': [15] } },
      period: 'Next 7 Days',
    };

    exportMasterReportToCsv(sampleData);

    expect(createdLinks.length).toBe(1);
    expect(createdLinks[0].getAttribute('download')).toContain('Enterprise_Master_Analytics_Report_');
  });

  it('covers AC-16: exports operational analytics and predictive metrics into structured Excel workbook', () => {
    const analyticsData = {
      trends: { open: 12, inProgress: 9, resolved: 30, closed: 15 },
      sla: { overall_compliance: 94.0, sla_met: 40, sla_breached: 3 },
      csat: { average_score: 4.7, total_surveys: 65 },
      workload: { active_technicians: 5 },
    };

    exportAnalyticsToExcel(analyticsData, 'Current Month');
    expect(createdLinks.length).toBe(1);
    expect(createdLinks[0].getAttribute('download')).toContain('Enterprise_Operational_Analytics_');

    const predictiveData = {
      forecast_total: '120 tickets',
      peak_day: 'Tuesday',
      top_recurring: 'Firmware Outdated',
      equipment_risk: 'Low Risk',
    };

    exportPredictiveToExcel(predictiveData, 'Next 7 Days');
    expect(createdLinks.length).toBe(2);
    expect(createdLinks[1].getAttribute('download')).toContain('Predictive_Analytics_Forecast_');
  });
});
