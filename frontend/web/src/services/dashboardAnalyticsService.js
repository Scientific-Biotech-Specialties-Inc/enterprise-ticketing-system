/**
 * Dashboard & Analytics Service (TS053, TS054, TS055, TS056)
 *
 * Provides metric calculations, calculation definitions, branch-scoping,
 * employee performance analytics, department aggregations, and live API fallback handling.
 */

import { DEFAULT_BRANCHES } from '@/data/branchConfig';

export const METRIC_DEFINITIONS = {
  totalTickets: 'Total number of tickets logged within the selected reporting period for this scope.',
  resolvedTickets: 'Total tickets marked as Resolved or Closed within the selected reporting period.',
  avgResolutionTime: 'Average duration from ticket creation to resolution, excluding duration spent in On Hold status.',
  slaCompliance: 'Percentage of tickets resolved within SLA target timeframe: (SLA Met / Total Evaluated) × 100.',
  avgCsat: 'Average customer rating score (1.0 to 5.0 stars) from completed post-resolution satisfaction feedback.',
  openVsClosed: 'Operational ratio between unresolved active tickets (Open, In Progress, On Hold) and completed tickets (Resolved, Closed).',
  recurringIssues: 'Top repeated issue categories, equipment models, and failure types ranked by frequency (Top N by count) within the period.',
  employeeWorkload: 'Active ticket distribution per technician to identify workload imbalance, under-utilization, or capacity bottlenecks.',
  reassignmentRate: 'Percentage of tickets assigned to this employee that were subsequently reassigned away to another technician: (Reassigned Tickets / Total Assigned) × 100.',
  resolutionRate: 'Percentage of assigned tickets resolved by this technician out of total tickets assigned to them in the period: (Resolved / Assigned) × 100.',
  overdueTickets: 'Active tickets that have exceeded their target SLA resolution deadline without closure.',
  totalUsers: 'Total active user accounts across the enterprise support ecosystem, broken down by system role.',
  ticketsToday: 'Tickets logged since 00:00:00 local time today (strictly unaffected by historical reporting date range filters).',
  activeEscalated: 'Tickets requiring urgent intervention: Active status tickets with Escalated or Critical priority flags.',
  branchComparison: 'Comparative ranking of hospital branches by ticket volume, SLA compliance %, resolution speed, and CSAT rating.',
};

// Department configuration across branches
export const BRANCH_DEPARTMENTS = [
  'Service Engineering',
  'Biomedical Support',
  'Customer Service',
  'Quality Assurance',
  'IT Systems & Hardware',
];

// Seeded staff directory scoped by branch
export const BRANCH_EMPLOYEES = {
  main: [
    { id: 101, name: 'Engr. Mark Reyes', role: 'Senior Field Engineer', department: 'Service Engineering', branchId: 'main' },
    { id: 102, name: 'Ava Santos', role: 'Support Specialist', department: 'Customer Service', branchId: 'main' },
    { id: 103, name: 'Jose Cruz', role: 'Biomedical Tech II', department: 'Biomedical Support', branchId: 'main' },
    { id: 104, name: 'Maria Dela Cruz', role: 'Systems QA Lead', department: 'Quality Assurance', branchId: 'main' },
    { id: 105, name: 'Carlo Tan', role: 'Hardware Technician', department: 'IT Systems & Hardware', branchId: 'main' },
    { id: 106, name: 'Anna Lim', role: 'Field Service Engineer', department: 'Service Engineering', branchId: 'main' },
  ],
  luzon: [
    { id: 201, name: 'Roberto Gomez', role: 'Regional Field Lead', department: 'Service Engineering', branchId: 'luzon' },
    { id: 202, name: 'Elena Bautista', role: 'Customer Care Rep', department: 'Customer Service', branchId: 'luzon' },
    { id: 203, name: 'Paolo Mendoza', role: 'Biomedical Specialist', department: 'Biomedical Support', branchId: 'luzon' },
    { id: 204, name: 'Grace Ramos', role: 'IT Support Analyst', department: 'IT Systems & Hardware', branchId: 'luzon' },
  ],
  visayas: [
    { id: 301, name: 'Francis Yap', role: 'Senior Biomedical Engineer', department: 'Biomedical Support', branchId: 'visayas' },
    { id: 302, name: 'Kristine Tan', role: 'Support Agent', department: 'Customer Service', branchId: 'visayas' },
    { id: 303, name: 'Dexter Sy', role: 'Field Service Tech', department: 'Service Engineering', branchId: 'visayas' },
    { id: 304, name: 'Camille Ocampo', role: 'Quality Control Officer', department: 'Quality Assurance', branchId: 'visayas' },
  ],
  mindanao: [
    { id: 401, name: 'Dante Navarro', role: 'Regional Maintenance Lead', department: 'Service Engineering', branchId: 'mindanao' },
    { id: 402, name: 'Sarah Joy Datu', role: 'CS Representative', department: 'Customer Service', branchId: 'mindanao' },
    { id: 403, name: 'Kenneth Alcantara', role: 'Medical Equipment Tech', department: 'Biomedical Support', branchId: 'mindanao' },
  ],
};

/**
 * Filter date preset helper
 */
export function calculateDateRange(preset, customStart = '', customEnd = '') {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  if (preset === 'Custom Range') {
    return {
      dateFrom: customStart || todayStr,
      dateTo: customEnd || todayStr,
    };
  }

  const d = new Date(now);
  if (preset === 'Today') {
    return { dateFrom: todayStr, dateTo: todayStr };
  }
  if (preset === 'This Week' || preset === 'Last 7 Days') {
    d.setDate(d.getDate() - 7);
    return { dateFrom: d.toISOString().split('T')[0], dateTo: todayStr };
  }
  if (preset === 'This Month' || preset === 'Last 30 Days') {
    d.setDate(d.getDate() - 30);
    return { dateFrom: d.toISOString().split('T')[0], dateTo: todayStr };
  }
  if (preset === 'Last 90 Days') {
    d.setDate(d.getDate() - 90);
    return { dateFrom: d.toISOString().split('T')[0], dateTo: todayStr };
  }

  d.setDate(d.getDate() - 7);
  return { dateFrom: d.toISOString().split('T')[0], dateTo: todayStr };
}

/**
 * Multiplier based on selected date period
 */
function getPeriodMultiplier(preset) {
  switch (preset) {
    case 'Today': return 0.2;
    case 'This Week':
    case 'Last 7 Days': return 1.0;
    case 'This Month':
    case 'Last 30 Days': return 4.2;
    case 'Last 90 Days': return 12.5;
    case 'Custom Range': return 1.8;
    default: return 1.0;
  }
}

/**
 * Branch Dashboard Data Provider (TS053)
 * Scoped exclusively to the given branchId
 */
export function getBranchDashboardData(branchId = 'main', period = 'Last 7 Days') {
  const branch = DEFAULT_BRANCHES.find((b) => b.id === branchId) || DEFAULT_BRANCHES[0];
  const mult = getPeriodMultiplier(period);

  // Branch base numbers
  const branchWeights = {
    main: 1.0,
    luzon: 0.72,
    visayas: 0.65,
    mindanao: 0.52,
  };
  const bW = branchWeights[branch.id] || 0.8;

  const totalTickets = Math.round(145 * mult * bW);
  const resolved = Math.round(totalTickets * 0.76);
  const closed = Math.round(totalTickets * 0.12);
  const open = Math.round(totalTickets * 0.07);
  const inProgress = Math.round(totalTickets * 0.04);
  const onHold = Math.max(1, totalTickets - (resolved + closed + open + inProgress));

  const slaCompliance = Math.min(99.4, Math.max(86.0, Number((92.4 + (bW * 3.2) - (mult * 0.4)).toFixed(1))));
  const avgResolutionTime = Number((2.4 + (1 / bW) * 0.3).toFixed(1));
  const avgCsat = Number((4.58 + (bW * 0.15) - 0.1).toFixed(2));

  // Time trend series
  const timeLabels = period === 'Today'
    ? ['6 AM', '8 AM', '10 AM', '12 PM', '2 PM', '4 PM', '6 PM', '8 PM']
    : period === 'Last 90 Days'
    ? ['Month 1', 'Month 2', 'Month 3']
    : period === 'This Month' || period === 'Last 30 Days'
    ? ['Week 1', 'Week 2', 'Week 3', 'Week 4']
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const trendCreated = timeLabels.map((_, i) => Math.max(2, Math.round((totalTickets / timeLabels.length) * (0.8 + (Math.sin(i * 1.2) * 0.35)))));
  const trendResolved = trendCreated.map((val) => Math.max(1, Math.round(val * 0.88)));

  // Recurring Issues (operational top N by count)
  const recurringIssues = [
    { rank: 1, type: 'Category', name: 'Reagent Cooler Calibration', count: Math.round(18 * mult * bW), delta: '+14%', severity: 'Critical' },
    { rank: 2, type: 'Machine', name: 'Centrifuge Sysmex KX-21N', count: Math.round(14 * mult * bW), delta: '+8%', severity: 'High' },
    { rank: 3, type: 'Complaint', name: 'Optical Sensor Firmware Desync', count: Math.round(11 * mult * bW), delta: '-3%', severity: 'Medium' },
    { rank: 4, type: 'Machine', name: 'Cobas C111 Photometer Drift', count: Math.round(9 * mult * bW), delta: '+2%', severity: 'High' },
    { rank: 5, type: 'Category', name: 'Hydraulic Pressure Fluctuation', count: Math.round(7 * mult * bW), delta: '-6%', severity: 'Low' },
  ];

  // Employee workload for this branch
  const staff = BRANCH_EMPLOYEES[branch.id] || BRANCH_EMPLOYEES.main;
  const employeeWorkload = staff.map((emp, idx) => {
    const assigned = Math.max(2, Math.round((totalTickets / staff.length) * (0.85 + (idx % 3) * 0.18)));
    const empResolved = Math.round(assigned * (0.75 + (idx % 2) * 0.1));
    return {
      employeeId: emp.id,
      name: emp.name,
      department: emp.department,
      assigned,
      resolved: empResolved,
      active: assigned - empResolved,
      throughputPerHour: Number((empResolved / Math.max(1, (8 * mult))).toFixed(2)),
      isOverloaded: assigned > (totalTickets / staff.length) * 1.25,
    };
  });

  return {
    branch,
    period,
    kpis: {
      totalTickets,
      resolvedTickets: resolved + closed,
      avgResolutionTime,
      slaCompliance,
      avgCsat,
      openVsClosed: {
        open: open + inProgress + onHold,
        closed: resolved + closed,
        ratio: ((resolved + closed) / Math.max(1, open + inProgress + onHold)).toFixed(1),
      },
      statusDistribution: {
        open,
        inProgress,
        onHold,
        resolved,
        closed,
      },
    },
    trend: {
      labels: timeLabels,
      created: trendCreated,
      resolved: trendResolved,
    },
    recurringIssues,
    employeeWorkload,
  };
}

/**
 * Super Admin System Dashboard Data Provider (TS054)
 * Aggregated across all branches without branch-level scoping restriction.
 */
export function getSystemDashboardData(period = 'Last 7 Days') {
  const mult = getPeriodMultiplier(period);

  // Tickets Created Today is fixed regardless of period selector
  const ticketsCreatedToday = 34;

  const totalTickets = Math.round(412 * mult);
  const activeEscalated = Math.round(28 * Math.max(1, mult * 0.6));
  const slaBreaches = Math.round(18 * Math.max(1, mult * 0.7));

  const systemKpis = {
    overallSlaCompliance: 93.6,
    overallAvgCsat: 4.72,
    overallResolutionTime: 2.3,
  };

  // Total users broken down by role
  const totalUsers = {
    total: 248,
    customer: 164,
    employee: 58,
    cs: 14,
    admin: 8,
    superAdmin: 4,
  };

  // Branch Comparison table data
  const branchComparison = DEFAULT_BRANCHES.map((b) => {
    const branchData = getBranchDashboardData(b.id, period);
    return {
      id: b.id,
      name: b.name,
      code: b.code,
      region: b.region,
      totalTickets: branchData.kpis.totalTickets,
      resolvedTickets: branchData.kpis.resolvedTickets,
      slaCompliance: branchData.kpis.slaCompliance,
      avgResolutionTime: branchData.kpis.avgResolutionTime,
      avgCsat: branchData.kpis.avgCsat,
      activeTickets: branchData.kpis.statusDistribution.open + branchData.kpis.statusDistribution.inProgress + branchData.kpis.statusDistribution.onHold,
      healthStatus: branchData.kpis.slaCompliance >= 92 ? 'Healthy' : branchData.kpis.slaCompliance >= 88 ? 'Attention' : 'Critical',
    };
  });

  // Recent Activity Feed with direct ticket links
  const recentActivity = [
    {
      id: 'EVT-1092',
      ticketId: 'TCK-2026-0891',
      ticketSubject: 'Cobas C111 Photometer Drift calibration needed',
      eventType: 'Escalation Triggered',
      branch: 'Main Branch',
      actor: 'System Automated Sentinel',
      timestamp: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
      priority: 'Critical',
      status: 'In Progress',
    },
    {
      id: 'EVT-1091',
      ticketId: 'TCK-2026-0890',
      ticketSubject: 'Centrifuge rotor latch replacement requested',
      eventType: 'Status Changed',
      branch: 'Luzon Regional Center',
      actor: 'Roberto Gomez',
      timestamp: new Date(Date.now() - 1000 * 60 * 24).toISOString(),
      priority: 'High',
      status: 'On Hold',
    },
    {
      id: 'EVT-1090',
      ticketId: 'TCK-2026-0889',
      ticketSubject: 'New biochemistry analyzer installation verification',
      eventType: 'Ticket Created',
      branch: 'Visayas Medical Hub',
      actor: 'St. Paul Hospital Lab Tech',
      timestamp: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
      priority: 'Medium',
      status: 'Open',
    },
    {
      id: 'EVT-1089',
      ticketId: 'TCK-2026-0888',
      ticketSubject: 'Emergency ultrasound probe transducer repair',
      eventType: 'SLA Breach Warning',
      branch: 'Mindanao Regional Branch',
      actor: 'SLA Monitor Engine',
      timestamp: new Date(Date.now() - 1000 * 60 * 65).toISOString(),
      priority: 'High',
      status: 'In Progress',
    },
    {
      id: 'EVT-1088',
      ticketId: 'TCK-2026-0885',
      ticketSubject: 'Periodic quarterly preventive maintenance complete',
      eventType: 'Ticket Resolved',
      branch: 'Main Branch',
      actor: 'Engr. Mark Reyes',
      timestamp: new Date(Date.now() - 1000 * 60 * 95).toISOString(),
      priority: 'Low',
      status: 'Resolved',
    },
  ];

  return {
    period,
    totalUsers,
    totalTickets,
    activeEscalated,
    slaBreaches,
    ticketsCreatedToday,
    systemKpis,
    branchComparison,
    recentActivity,
  };
}

/**
 * Individual Employee Performance Data Provider (TS055)
 * Scoped strictly to the Admin's branch
 */
export function getEmployeePerformanceData(branchId = 'main', period = 'Last 7 Days') {
  const staff = BRANCH_EMPLOYEES[branchId] || BRANCH_EMPLOYEES.main;
  const mult = getPeriodMultiplier(period);

  const metrics = staff.map((emp, index) => {
    // If period is Today, simulate that some employees had no assigned tickets yet
    if (period === 'Today' && index === staff.length - 1) {
      return {
        ...emp,
        hasData: false,
        totalAssigned: 0,
        resolvedCount: 0,
        resolutionRate: null,
        avgResolutionTime: null,
        slaComplianceRate: null,
        reassignmentRate: null,
        avgCsat: null,
        currentActive: 0,
        recentTickets: [],
      };
    }

    const totalAssigned = Math.max(3, Math.round((14 + (index * 4)) * mult * 0.8));
    const resolvedCount = Math.round(totalAssigned * (0.82 - (index * 0.03)));
    const resolutionRate = Number(((resolvedCount / totalAssigned) * 100).toFixed(1));
    const avgResolutionTime = Number((1.8 + (index * 0.35)).toFixed(1));
    const slaComplianceRate = Number((96.0 - (index * 2.8)).toFixed(1));
    const reassignedAwayCount = Math.max(0, Math.round(totalAssigned * (0.04 + (index * 0.02))));
    const reassignmentRate = Number(((reassignedAwayCount / totalAssigned) * 100).toFixed(1));
    const avgCsat = Number((4.85 - (index * 0.08)).toFixed(2));

    return {
      ...emp,
      hasData: true,
      totalAssigned,
      resolvedCount,
      resolutionRate,
      avgResolutionTime,
      slaComplianceRate,
      reassignmentRate,
      avgCsat,
      currentActive: Math.max(0, totalAssigned - resolvedCount),
      recentTickets: [
        { id: `TCK-${emp.id}-01`, subject: 'Preventive service run', priority: 'Medium', status: 'Resolved', slaMet: true, csat: 5 },
        { id: `TCK-${emp.id}-02`, subject: 'Sensor desync diagnosis', priority: 'High', status: 'Resolved', slaMet: true, csat: 4 },
        { id: `TCK-${emp.id}-03`, subject: 'Emergency component swap', priority: 'Critical', status: 'In Progress', slaMet: true, csat: null },
      ],
    };
  });

  return {
    branchId,
    period,
    employees: metrics,
  };
}

/**
 * Aggregated Department-level Performance Data Provider (TS056)
 * Scoped to departments within the Admin's branch
 */
export function getDepartmentPerformanceData(branchId = 'main', period = 'Last 7 Days') {
  const mult = getPeriodMultiplier(period);
  const staff = BRANCH_EMPLOYEES[branchId] || BRANCH_EMPLOYEES.main;

  const departments = BRANCH_DEPARTMENTS.map((deptName, i) => {
    const deptEmployees = staff.filter((e) => e.department === deptName);
    const empCount = Math.max(1, deptEmployees.length);

    // Simulate an empty department state if no tickets in short period
    if (period === 'Today' && i === BRANCH_DEPARTMENTS.length - 1) {
      return {
        id: `dept-${i + 1}`,
        name: deptName,
        head: 'TBD / Rotating Lead',
        employeeCount: empCount,
        employees: deptEmployees,
        hasData: false,
        totalTicketsHandled: 0,
        avgResolutionTime: null,
        slaCompliance: null,
        avgCsat: null,
        openCount: 0,
        overdueCount: 0,
        workloadPerEmployee: 0,
        imbalanceLevel: 'Normal',
      };
    }

    const totalHandled = Math.round((28 + (i * 9)) * mult);
    const openCount = Math.max(1, Math.round(totalHandled * 0.12));
    const overdueCount = Math.max(0, Math.round(totalHandled * (0.02 + (i * 0.015))));
    const avgResolutionTime = Number((2.1 + (i * 0.25)).toFixed(1));
    const slaCompliance = Number((95.5 - (i * 2.2)).toFixed(1));
    const avgCsat = Number((4.82 - (i * 0.09)).toFixed(2));
    const workloadPerEmployee = Number((totalHandled / empCount).toFixed(1));
    const imbalanceLevel = workloadPerEmployee > 24 ? 'High Imbalance' : workloadPerEmployee > 16 ? 'Moderate' : 'Balanced';

    return {
      id: `dept-${i + 1}`,
      name: deptName,
      head: deptEmployees[0]?.name || 'Department Supervisor',
      employeeCount: empCount,
      employees: deptEmployees,
      hasData: true,
      totalTicketsHandled: totalHandled,
      avgResolutionTime,
      slaCompliance,
      avgCsat,
      openCount,
      overdueCount,
      workloadPerEmployee,
      imbalanceLevel,
    };
  });

  return {
    branchId,
    period,
    departments,
  };
}

