import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { getTicketFormOptions, reclassifyTicket } from '@/services/ticketService';

/** Spec 0043 (AC-20): a ticket whose AI classification failed has no category yet. */
export const ticketNeedsClassification = (ticket) => Boolean(
  ticket && (
    ticket.needs_classification === true
    || (Object.prototype.hasOwnProperty.call(ticket, 'problem_category_ID') && (ticket.problem_category_ID === null || ticket.problem_category_ID === ''))
    || ticket.category === 'Unclassified'
  )
);

export const CLASSIFY_BEFORE_ASSIGN = 'Classify this ticket before assigning.';

/**
 * CS picks the category for an unclassified ticket. Service needs one of the customer's
 * registered machines when the ticket has none; Software clears the machine (server side).
 * The ticket number never changes.
 */
export default function ClassifyTicketPanel({ ticket, onClassified }) {
  const [categories, setCategories] = useState([]);
  const [categoryId, setCategoryId] = useState('');
  const [machineId, setMachineId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getTicketFormOptions()
      .then((opts) => { if (active) setCategories(opts?.problem_categories || []); })
      .catch(() => { if (active) setError('Could not load the categories. Close and try again.'); });
    return () => { active = false; };
  }, []);

  const machines = Array.isArray(ticket?.customer_machines) ? ticket.customer_machines : [];
  const picked = categories.find((c) => String(c.problem_category_ID) === String(categoryId)) || null;
  const isService = String(picked?.category_name || '').toLowerCase() === 'service';
  const needsMachine = isService && !ticket?.machine_ID;

  const handleClassify = async () => {
    setError('');
    if (!picked) {
      setError('Choose a category.');
      return;
    }
    if (needsMachine && !machineId) {
      setError("Choose one of the customer's registered machines for a Service ticket.");
      return;
    }
    setSaving(true);
    try {
      const res = await reclassifyTicket({
        ticketId: ticket.ticket_ID || ticket.id,
        problem_category_ID: picked.problem_category_ID,
        machine_ID: needsMachine ? machineId : undefined,
      });
      const data = res?.data || res || {};
      onClassified?.({
        problem_category_ID: Number(picked.problem_category_ID),
        category: picked.category_name,
        machine_ID: data.machine_ID ?? (needsMachine ? Number(machineId) : ticket.machine_ID ?? null),
        department_id: data.department_id ?? null,
        needs_classification: false,
      });
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not classify this ticket. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 mb-4 space-y-3" data-testid="classify-panel">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-amber-900">Needs Classification</p>
          <p className="text-xs text-amber-800">The AI could not decide this ticket's category. {CLASSIFY_BEFORE_ASSIGN}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="classify-category" className="block text-xs font-semibold text-slate-700 mb-1">Category</label>
          <select
            id="classify-category"
            value={categoryId}
            onChange={(e) => { setCategoryId(e.target.value); setError(''); }}
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-[#2E85D8]/40"
          >
            <option value="">Select a category</option>
            {categories.map((c) => (
              <option key={c.problem_category_ID} value={c.problem_category_ID}>{c.category_name}</option>
            ))}
          </select>
        </div>
        {needsMachine && (
          <div>
            <label htmlFor="classify-machine" className="block text-xs font-semibold text-slate-700 mb-1">Customer machine</label>
            <select
              id="classify-machine"
              value={machineId}
              onChange={(e) => { setMachineId(e.target.value); setError(''); }}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-[#2E85D8]/40"
            >
              <option value="">Select a machine</option>
              {machines.map((m) => (
                <option key={m.machine_ID} value={m.machine_ID}>{m.label || `${m.machine_name} - ${m.serial_number}`}</option>
              ))}
            </select>
            {machines.length === 0 && <p className="text-xs text-amber-800 mt-1">This customer has no registered machines.</p>}
          </div>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-red-600 font-medium">{error}</p>}
      <button
        type="button"
        onClick={handleClassify}
        disabled={saving}
        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#252578] hover:bg-[#1e1e60] rounded-lg cursor-pointer disabled:opacity-60"
      >
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
        Save Classification
      </button>
    </div>
  );
}
