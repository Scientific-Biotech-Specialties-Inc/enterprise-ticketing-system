import React, { useState, useEffect, useCallback } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getAdminEmployeePerformance } from '@/services/ticketService';

// Columns the server can sort by (spec 0029 AC-6, spec 0039 AC-18). Sorting is done by the API so
// ordering matches exports. Figures come from each person's own assignment periods (spec 0039).
const COLUMNS = [
  { key: 'name', label: 'Employee', numeric: false },
  { key: 'performance_score', label: 'Performance Score', numeric: true, suffix: '' },
  { key: 'pending_count', label: 'Pending', numeric: true, suffix: '' },
  { key: 'tickets_assigned', label: 'Assigned', numeric: true, suffix: '' },
  { key: 'tickets_resolved', label: 'Resolved', numeric: true, suffix: '' },
  { key: 'sla_compliance_rate', label: 'Resolution SLA', numeric: true, suffix: '%' },
  { key: 'response_sla_rate', label: 'Response SLA', numeric: true, suffix: '%' },
  { key: 'average_response_minutes', label: 'Avg Response', numeric: true, suffix: ' min' },
  { key: 'average_resolution_hours', label: 'Avg Resolution', numeric: true, suffix: ' h' },
  { key: 'csat_score', label: 'CSAT', numeric: true, suffix: '' },
];

// A missing value is shown as a dash, never as 0 or 100 (spec 0031 AC-6).
const show = (value, suffix = '') => (value === null || value === undefined ? '—' : `${value}${suffix}`);

// Score cell: too few judged periods reads "Not enough data" instead of a number (spec 0039 AC-17).
const showScore = (e) => (e.score_status === 'not_enough_data'
  ? <span className="text-gray-500 italic">Not enough data</span>
  : show(e.performance_score));

export default function EmployeePerformanceView({
  selectedPeriod = 'Last 7 Days',
  dateFrom = null,
  dateTo = null,
  branchId = null,
}) {
  const [sortBy, setSortBy] = useState('performance_score');
  const [sortDir, setSortDir] = useState('desc');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { preset: selectedPeriod, sort_by: sortBy, sort_dir: sortDir };
      // Superadmin picks a branch or all; a branch Admin sends none and gets their own branch.
      if (branchId) params.branch_id = branchId;
      if (selectedPeriod === 'Custom Range') {
        params.preset = 'custom';
        if (dateFrom) params.date_from = dateFrom;
        if (dateTo) params.date_to = dateTo;
      }
      const api = await getAdminEmployeePerformance(params);
      setRows(Array.isArray(api?.employees) ? api.employees : []);
    } catch (err) {
      setError(err?.response?.data?.message || 'Employee performance data is unavailable right now.');
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod, dateFrom, dateTo, branchId, sortBy, sortDir]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleSort = (key) => {
    if (key === sortBy) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const sortIcon = (key) => {
    if (key !== sortBy) return <ArrowUpDown className="w-3 h-3 opacity-50" />;
    return sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  };

  return (
    <div className="space-y-4" data-testid="employee-performance-view">
      <div>
        <h3 className="text-sm font-semibold text-gray-800">Employee Performance</h3>
        <p className="text-xs text-gray-500">
          Measured from each person&apos;s own assignments: the clock starts when a ticket reaches them.
          Pending is work assigned but not yet accepted and still within its accept time. Click a column header to sort.
        </p>
      </div>

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4" />{error}</span>
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-3 h-3 mr-1" />Retry</Button>
        </div>
      )}

      <div className="overflow-x-auto bg-white border border-gray-200 rounded-xl">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-gray-200 bg-[#F8F9FA]">
              {COLUMNS.map((col) => (
                <th key={col.key} className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className="inline-flex items-center gap-1 cursor-pointer hover:text-[#1E293B]"
                    aria-label={`Sort by ${col.label}`}
                  >
                    {col.label}
                    {sortIcon(col.key)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={`sk-${i}`} data-testid="employee-skeleton-row">
                  <td colSpan={COLUMNS.length} className="px-3 py-3">
                    <div className="h-4 bg-gray-100 rounded animate-pulse" />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 && !error ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-3 py-6 text-center text-xs text-gray-500">
                  No employees found for this branch.
                </td>
              </tr>
            ) : (
              rows.map((e) => (
                <tr key={e.employee_id} className="border-b border-gray-100 text-xs text-gray-700">
                  <td className="px-3 py-2 font-medium text-[#1E293B]">
                    {e.name}
                    <span className="block text-[11px] text-gray-500 font-normal">{e.department}</span>
                  </td>
                  {e.has_data ? (
                    <>
                      <td className="px-3 py-2 font-semibold text-[#1E293B]">{showScore(e)}</td>
                      {COLUMNS.slice(2).map((col) => (
                        <td key={col.key} className="px-3 py-2">{show(e[col.key], col.suffix)}</td>
                      ))}
                    </>
                  ) : (
                    <td colSpan={COLUMNS.length - 1} className="px-3 py-2 text-gray-500 italic">
                      No data recorded for this period
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
