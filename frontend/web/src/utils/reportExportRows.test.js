import { describe, it, expect } from 'vitest';
import { buildAnalyticsExportRows, buildPredictiveExportRows } from './reportExportUtils';

const find = (rows, section, metric) => rows.find((r) => r[0] === section && r[1] === metric);

describe('analytics export rows contain only real data', () => {
  it('writes branch figures from the server payload', () => {
    const rows = buildAnalyticsExportRows({
      kpis: {
        total_tickets: 15,
        resolved_tickets: 3,
        sla_compliance_rate: 60,
        avg_resolution_hours: 3.3,
        csat_score: null,
        total_csat_reviews: 0,
      },
      workload: { by_employee: { labels: ['Ana Cruz', 'Ben Diaz'], data: [5, 1] } },
      recurring_issues: { top_categories: [{ name: 'Hardware', count: 4, percentage: 26.7 }] },
      departments: { departments: [{ department: 'Service', has_data: true, total_tickets: 10, sla_compliance_rate: 50, open_tickets_count: 2, overdue_tickets_count: 5 }] },
    });

    expect(find(rows, 'Tickets', 'Total tickets')[2]).toBe(15);
    expect(find(rows, 'SLA', 'SLA compliance rate')).toEqual(['SLA', 'SLA compliance rate', 60, '%', '']);
    expect(find(rows, 'Employee workload', 'Ana Cruz')[2]).toBe(5);
    expect(find(rows, 'Recurring issues: categories', 'Hardware')[4]).toBe('26.7% of period tickets');
    expect(find(rows, 'Department: Service', 'Overdue (breached)')[2]).toBe(5);
  });

  it('marks missing CSAT as Unavailable with a reason, never a made up score', () => {
    const rows = buildAnalyticsExportRows({ kpis: { total_tickets: 1, csat_score: null } });
    const csat = find(rows, 'Customer satisfaction', 'Average CSAT');

    expect(csat[2]).toBe('Unavailable');
    expect(csat[4]).toMatch(/did not return a score/);
    expect(JSON.stringify(rows)).not.toMatch(/4\.67|4\.8|92\.5/);
  });

  it('does not invent employees, heatmaps or equipment when the data is absent', () => {
    const text = JSON.stringify(buildAnalyticsExportRows({ kpis: { total_tickets: 2 } }));

    expect(text).not.toMatch(/Alice Smith|Bob Jones|Charlie Brown|Centrifuge|Hematology|Bio-Freezer/);
    expect(text).not.toMatch(/Monday|Heatmap/);
  });

  it('writes the System dashboard figures and branch comparison', () => {
    const rows = buildAnalyticsExportRows({
      totalUsers: { total: 90, customer: 46, employee: 37, cs: 4, admin: 1, superAdmin: 2 },
      totalTickets: 16,
      activeEscalated: 10,
      escalatedTickets: 1,
      slaBreaches: 6,
      ticketsCreatedToday: 3,
      systemKpis: { overallSlaCompliance: 62.5, overallAvgCsat: null, overallResolutionTime: 3.3 },
      branchComparison: [
        { name: 'Main Branch', totalTickets: 12, resolvedTickets: 3, slaCompliance: 50, avgResolutionTime: 3.3, avgCsat: null },
        { name: 'Cebu', totalTickets: 0, resolvedTickets: 0, slaCompliance: 100, avgResolutionTime: 0, avgCsat: null },
      ],
    });

    expect(find(rows, 'Users', 'Total users')[2]).toBe(90);
    expect(find(rows, 'System KPIs', 'Overall average CSAT')[2]).toBe('Unavailable');
    expect(find(rows, 'Tickets', 'Created today')[4]).toMatch(/not filtered/);
    expect(find(rows, 'Branch: Main Branch', 'SLA compliance')[2]).toBe(50);
    // A branch with no tickets says so instead of reporting a perfect 100%.
    expect(find(rows, 'Branch: Cebu', 'SLA compliance')[2]).toBe('No data for this period');
  });

  it('says so when there is no dashboard data at all', () => {
    expect(buildAnalyticsExportRows(null)).toEqual([
      ['Report', 'Dashboard data', 'Unavailable', '', expect.stringMatching(/No dashboard data/)],
    ]);
  });
});

describe('predictive export rows', () => {
  it('writes the projected volume, rising issues and the basis', () => {
    const rows = buildPredictiveExportRows({
      status: 'success',
      historical_basis: { days_used: 60, model: '7-day weighted moving average' },
      volume_forecast: [{ date: '2026-11-05', day_of_week: 'Thu', predicted_volume: 6, lower_bound: 4, upper_bound: 9 }],
      recurring_issues: {
        categories: [{ item_name: 'Hardware', recent_frequency: 8, baseline_frequency: 4, change_percentage: 100 }],
        machines: [],
      },
    });

    expect(find(rows, 'Basis', 'Days of history used')[2]).toBe(60);
    expect(find(rows, 'Projected ticket volume', '2026-11-05')).toEqual([
      'Projected ticket volume', '2026-11-05', 6, 'tickets', 'Range 4 to 9 (Thu)',
    ]);
    expect(find(rows, 'Rising categories', 'Hardware')[4]).toBe('+100.0% vs baseline, baseline 4');
  });

  it('reports insufficient history plainly', () => {
    const rows = buildPredictiveExportRows({
      status: 'insufficient_data',
      historical_basis: { days_used: 4, minimum_days_required: 14 },
      message: 'Insufficient historical data for reliable projection.',
      volume_forecast: [],
      recurring_issues: { categories: [], machines: [] },
    });

    expect(find(rows, 'Basis', 'Status')[2]).toMatch(/Insufficient historical data/);
    expect(find(rows, 'Basis', 'Status')[4]).toBe('At least 14 days are needed');
    expect(rows.some((r) => r[0] === 'Projected ticket volume')).toBe(false);
  });

  it('marks the forecast unavailable when nothing was loaded', () => {
    expect(buildPredictiveExportRows(undefined)[0][2]).toBe('Unavailable');
    expect(buildPredictiveExportRows({})[0][2]).toBe('Unavailable');
  });
});
