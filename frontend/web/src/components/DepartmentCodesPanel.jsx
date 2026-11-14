import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Loader2, Pencil, Plus, X } from 'lucide-react';
import {
  getDepartmentsWithCodes,
  suggestDepartmentCode,
  createDepartment,
  updateDepartment,
} from '@/services/ticketService';

export const DEPARTMENT_CODE_PATTERN = /^[A-Z0-9_-]{2,16}$/;
const CODE_RULE_MESSAGE = 'Code must be 2 to 16 characters: letters, digits, hyphens, or underscores.';

const normalizeCode = (value) => String(value || '').trim().toUpperCase();

/** Client side duplicate check (AC-10); the server repeats it and answers 422 or 409. */
export const duplicateCodeMessage = (code, departments, excludeId = null) => {
  const owner = departments.find((d) => normalizeCode(d.code) === code && d.id !== excludeId);
  return owner ? `Code ${code} is already used by ${owner.name}.` : '';
};

/**
 * Spec 0043 (AC-8 to AC-10): the departments table in Ticket Config, Prefix & Department.
 * Each department owns a unique code that becomes the ticket number's department segment.
 * Picking a row drives the live preview through `onSelectCode`.
 */
export default function DepartmentCodesPanel({ enabled = true, onSelectCode }) {
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  const [editingId, setEditingId] = useState(null);
  const [editCode, setEditCode] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');
  const suggestRequest = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const rows = await getDepartmentsWithCodes();
      setDepartments(rows);
      setSelectedId((current) => current ?? rows.find((d) => d.is_active)?.id ?? rows[0]?.id ?? null);
    } catch (err) {
      setLoadError(err?.response?.data?.message || 'Could not load departments.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const selected = departments.find((d) => d.id === selectedId);
    onSelectCode?.(selected ? normalizeCode(selected.code) : '');
  }, [departments, selectedId, onSelectCode]);

  // AC-9: typing a name fills the code with the server suggestion (debounced 300 ms),
  // until the superadmin edits the code by hand.
  useEffect(() => {
    if (codeTouched) return undefined;
    const name = newName.trim();
    if (!name) {
      setNewCode('');
      return undefined;
    }
    const requestId = ++suggestRequest.current;
    const timer = setTimeout(async () => {
      setSuggesting(true);
      try {
        const code = await suggestDepartmentCode(name);
        if (requestId === suggestRequest.current) setNewCode(code);
      } catch {
        // A failed suggestion leaves the field for manual entry.
      } finally {
        if (requestId === suggestRequest.current) setSuggesting(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [newName, codeTouched]);

  const handleAdd = async () => {
    setAddError('');
    const name = newName.trim();
    const code = normalizeCode(newCode);
    if (!name) {
      setAddError('Enter a department name.');
      return;
    }
    if (code && !DEPARTMENT_CODE_PATTERN.test(code)) {
      setAddError(CODE_RULE_MESSAGE);
      return;
    }
    const duplicate = code ? duplicateCodeMessage(code, departments) : '';
    if (duplicate) {
      setAddError(duplicate);
      return;
    }
    setAdding(true);
    try {
      const created = await createDepartment({ name, code });
      setNewName('');
      setNewCode('');
      setCodeTouched(false);
      await load();
      if (created?.id) setSelectedId(created.id);
    } catch (err) {
      setAddError(err?.response?.data?.message || 'Could not add the department.');
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (dept) => {
    setEditingId(dept.id);
    setEditCode(normalizeCode(dept.code));
    setEditError('');
  };

  const handleSaveEdit = async (dept) => {
    const code = normalizeCode(editCode);
    setEditError('');
    if (!DEPARTMENT_CODE_PATTERN.test(code)) {
      setEditError(CODE_RULE_MESSAGE);
      return;
    }
    const duplicate = duplicateCodeMessage(code, departments, dept.id);
    if (duplicate) {
      setEditError(duplicate);
      return;
    }
    setSavingEdit(true);
    try {
      await updateDepartment(dept.id, { code });
      setEditingId(null);
      await load();
    } catch (err) {
      setEditError(err?.response?.data?.message || 'Could not save the code.');
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className={`space-y-3 transition-all ${enabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`} aria-disabled={!enabled}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Department Codes</span>
        <span className="text-xs text-gray-500">Pick a row to preview its number</span>
      </div>

      {loadError && (
        <p role="alert" className="text-xs font-semibold text-red-600 flex items-center gap-1">
          <AlertCircle size={13} /> {loadError}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-[#F8F9FA] text-left text-xs font-semibold uppercase tracking-wider text-[#94A3B8]">
            <tr>
              <th scope="col" className="px-4 py-2">Department</th>
              <th scope="col" className="px-4 py-2">Code</th>
              <th scope="col" className="px-4 py-2">Status</th>
              <th scope="col" className="px-4 py-2 sr-only">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && [0, 1].map((i) => (
              <tr key={`skeleton-${i}`} className="border-t border-gray-100">
                {[0, 1, 2, 3].map((c) => (
                  <td key={c} className="px-4 py-3"><div className="h-4 w-16 rounded bg-gray-100 animate-pulse" /></td>
                ))}
              </tr>
            ))}
            {!loading && departments.map((dept) => {
              const isEditing = editingId === dept.id;
              const isSelected = selectedId === dept.id;
              return (
                <tr
                  key={dept.id}
                  onClick={() => setSelectedId(dept.id)}
                  aria-selected={isSelected}
                  className={`border-t border-gray-100 cursor-pointer ${isSelected ? 'bg-[#2E85D8]/5' : 'hover:bg-gray-50'}`}
                >
                  <td className="px-4 py-2 font-medium text-[#1E293B]">{dept.name}</td>
                  <td className="px-4 py-2" onClick={(e) => isEditing && e.stopPropagation()}>
                    {isEditing ? (
                      <input
                        aria-label={`Code for ${dept.name}`}
                        value={editCode}
                        maxLength={16}
                        onChange={(e) => { setEditCode(e.target.value.toUpperCase()); setEditError(''); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(dept); if (e.key === 'Escape') setEditingId(null); }}
                        className="w-28 rounded-lg border border-gray-200 px-2 py-1 font-mono text-sm uppercase outline-none focus:ring-2 focus:ring-[#2E85D8]"
                      />
                    ) : (
                      <span className="font-mono font-semibold text-[#252578]">{dept.code}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex rounded px-2 py-0.5 text-[11px] font-semibold border ${dept.is_active ? 'border-emerald-200 text-emerald-700' : 'border-gray-200 text-gray-500'}`}>
                      {dept.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    {isEditing ? (
                      <span className="inline-flex gap-1">
                        <button type="button" onClick={() => handleSaveEdit(dept)} disabled={savingEdit} aria-label="Save code" className="p-1 rounded hover:bg-gray-100 cursor-pointer">
                          {savingEdit ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                        </button>
                        <button type="button" onClick={() => setEditingId(null)} aria-label="Cancel" className="p-1 rounded hover:bg-gray-100 cursor-pointer"><X size={14} /></button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => startEdit(dept)} aria-label={`Edit code for ${dept.name}`} className="p-1 rounded hover:bg-gray-100 cursor-pointer">
                        <Pencil size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editError && (
        <p role="alert" className="text-xs font-semibold text-red-600 flex items-center gap-1">
          <AlertCircle size={13} /> {editError}
        </p>
      )}
      <p className="text-xs text-gray-500">Editing a code only affects tickets created afterwards.</p>

      <div className="rounded-xl border border-dashed border-gray-200 p-4 space-y-3">
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider block">Add Department</span>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem_auto] gap-2 items-start">
          <input
            aria-label="Department name"
            value={newName}
            onChange={(e) => { setNewName(e.target.value); setAddError(''); }}
            placeholder="e.g. Field Service"
            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2E85D8]"
          />
          <div className="relative">
            <input
              aria-label="Department code"
              value={newCode}
              maxLength={16}
              onChange={(e) => { setNewCode(e.target.value.toUpperCase()); setCodeTouched(true); setAddError(''); }}
              placeholder="Code"
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2 font-mono text-sm uppercase outline-none focus:ring-2 focus:ring-[#2E85D8]"
            />
            {suggesting && <Loader2 size={14} className="absolute right-3 top-3 animate-spin text-gray-400" aria-hidden="true" />}
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={adding}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#252578] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1e1e60] cursor-pointer disabled:opacity-60"
          >
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Add Department
          </button>
        </div>
        {addError && (
          <p role="alert" className="text-xs font-semibold text-red-600 flex items-center gap-1">
            <AlertCircle size={13} /> {addError}
          </p>
        )}
      </div>
    </div>
  );
}
