import React, { useState } from 'react';
import { Lock, Loader2, Send } from 'lucide-react';
import { formatPHT } from './ticketModalUtils';

/**
 * StaffNotesTab component
 * Displays: Internal notes list, "Confidential - hidden from customer view" copy,
 * 1,000 char composer with character count, disabled Add Note until text exists.
 */
export default function StaffNotesTab({
  notes = [],
  onAddNote,
  isAdding = false,
  readOnly = false,
  className = '',
}) {
  const [newNote, setNewNote] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = newNote.trim();
    if (!trimmed || isAdding) return;
    await onAddNote?.(trimmed);
    setNewNote('');
  };

  return (
    <div className={`space-y-4 pt-1 ${className}`}>
      {/* Confidential Banner */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-amber-50/80 border border-amber-200 text-xs text-amber-900">
        <div className="flex items-center gap-2">
          <Lock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
          <span className="font-medium">
            Confidential — hidden from customer view
          </span>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-200/70 text-amber-900 px-2 py-0.5 rounded-full">
          Staff only
        </span>
      </div>

      {/* Composer */}
      {!readOnly && (
        <form onSubmit={handleSubmit} className="space-y-2 bg-[#F7F8FD] border border-[#D5D9E4] rounded-xl p-3.5">
          <label htmlFor="staff-note-input" className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
            Add Internal Staff Note
          </label>
          <textarea
            id="staff-note-input"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="Record internal diagnostic notes, technician handoffs, or customer follow-up context..."
            className="w-full text-xs sm:text-sm border border-[#D5D9E4] rounded-lg p-2.5 bg-white text-[#1B2033] outline-none focus:ring-2 focus:ring-[#1E2A78]/30 focus:border-[#1E2A78] leading-relaxed resize-none"
          />
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-[#5A6178]">
              {newNote.length}/1,000 characters
            </span>
            <button
              type="submit"
              disabled={!newNote.trim() || isAdding}
              title={!newNote.trim() ? 'Enter note text to enable adding note' : 'Add internal staff note'}
              className="min-h-[44px] px-4 bg-[#1E2A78] hover:bg-[#252578] text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              {isAdding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              <span>Add Note</span>
            </button>
          </div>
        </form>
      )}

      {/* Notes List */}
      <div className="space-y-2.5">
        <span className="text-xs font-bold uppercase tracking-wider text-[#5A6178] block">
          INTERNAL NOTES ({notes.length})
        </span>

        {notes.length === 0 ? (
          <div className="p-6 text-center text-xs text-[#5A6178] rounded-xl border border-dashed border-[#D5D9E4] bg-[#F5F6FA]">
            No internal notes yet. Internal notes are only visible to support staff and technicians.
          </div>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {notes.map((n, idx) => {
              const author = n.author || n.author_name || n.creator || 'Staff Member';
              const role = n.author_role || n.role || 'Staff';
              const dateStr = n.created_at || n.timestamp || n.date;
              const content = n.text || n.note || n.content || '';

              return (
                <div
                  key={n.id || idx}
                  className="bg-white border border-[#D5D9E4] rounded-xl p-3 text-xs shadow-2xs space-y-1"
                >
                  <div className="flex items-center justify-between gap-2 text-[#5A6178]">
                    <span className="font-bold text-[#1E2A78]">
                      {author} <span className="font-normal text-[11px] text-[#5A6178]">({role})</span>
                    </span>
                    <span className="text-[10px]">{formatPHT(dateStr)}</span>
                  </div>
                  <p className="text-[#1B2033] leading-relaxed break-words whitespace-pre-wrap">
                    {content}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

