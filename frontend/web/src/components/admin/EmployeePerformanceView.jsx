import React, { useState, useEffect, useCallback } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getAdminEmployeePerformance } from '@/services/ticketService';

// Columns the server can sort by (spec 0029 AC-6). Sorting is done by the API so ordering matches exports.
const COLUMNS = [
  { key: 'name', label: 'Employee', numeric: false },
  { key: 'tickets_assigned', label: 'Assigned', numeric: true },
  { key: 'resolution_rate', label: 'Resolution Rate', numeric: true, suffix: '%' },
  { key: 'average_resolution_hours', label: 'Avg Resolution', numeric: true, suffix: ' h' },
  { key: 'sla_compliance_rate', label: 'SLA Compliance', numeric: true, suffix: '%' },
  { key: 'reassignment_rate', label: 'Reassignment Rate', numeric: true, suffix: '%' },
  { key: 'csat_score', label: 'CSAT', numeric: true, suffix: '' },
];

const show = (value, suffix = '') => (value === null || value === undefined ? 'Unavailable' : `${value}${suffix}`);

export default function EmployeePerformanceView({
  selectedPeriod = 'Last 7 Days',
  dateFrom = null,
  dateTo = null,
}) {
  const [sortBy, setSortBy] = useState('resolution_rate');
  const [sortDir, setSortDir] = useState('desc');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { preset: selectedPeriod, sort_by: sortBy, sort_dir: sortDir };
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
  }, [selectedPeriod, dateFrom, dateTo, sortBy, sortDir]);

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
          Counts tickets where the employee is the assigned employee. Click a column header to sort.
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
                  <td className="px-3 py-2">{e.tickets_assigned}</td>
                  {e.has_data ? (
                    COLUMNS.slice(2).map((col) => (
                      <td key={col.key} className="px-3 py-2">{show(e[col.key], col.suffix)}</td>
                    ))
                  ) : (
                    <td colSpan={COLUMNS.length - 2} className="px-3 py-2 text-gray-500 italic">
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
