import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Bot, Send, Paperclip, ChevronDown, ChevronUp, X, CheckCircle, AlertTriangle, Plus, MessageSquare, Trash2, ArrowLeft, Clock } from 'lucide-react';
import axiosInstance from '@/api/axiosInstance';
import { AI_API_URL } from '@/config/api.config';
import { getTicketFormOptions, createTicket, getCustomerTickets, saveTicketDraft } from '@/services/ticketService';
import TitleCasingModal from '@/components/TitleCasingModal';
import DuplicateTicketModal from '@/components/DuplicateTicketModal';
import { formatProperTitleCase, needsProperCasing } from '@/utils/titleCaseUtils';

const formatTime = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const formatShortTime = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  const now = new Date();
  const diff = now - date;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

function FormattedText({ text }) {
  const [completedSteps, setCompletedSteps] = useState({});

  if (typeof text !== 'string') return text;

  const lines = text.split('\n');
  const stepRegex = /^(?:\*\*step\s*(\d+)[:\.\-]?\*\*|step\s*(\d+)[:\.\-]|(\d+)[\.\)])\s*(.*)$/i;

  const totalDetectedSteps = lines.reduce((acc, line) => {
    const trimmed = line.trim();
    const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ');
    const cleanLine = isBullet ? trimmed.substring(2) : trimmed;
    return stepRegex.test(cleanLine) ? acc + 1 : acc;
  }, 0);

  const completedCount = Object.values(completedSteps).filter(Boolean).length;

  const renderInlineTokens = (rawStr) =>
    rawStr.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/g).map((part, idx) => {
      if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
        return <strong key={idx} className="font-bold text-slate-900">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
        return <em key={idx} className="italic">{part.slice(1, -1)}</em>;
      }
      if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
        return <code key={idx} className="bg-white border border-gray-200 px-1.5 py-0.5 rounded text-xs font-mono text-[#252578]">{part.slice(1, -1)}</code>;
      }
      return part;
    });

  return (
    <div className="text-sm leading-relaxed break-words space-y-1.5">
      {totalDetectedSteps >= 2 && (
        <div className="mb-2.5 flex items-center justify-between gap-2 rounded-xl bg-[#252578]/5 border border-[#252578]/15 px-3 py-2 text-xs">
          <span className="font-bold text-[#252578] flex items-center gap-1.5">
            <CheckCircle2 size={14} className="text-[#2E85D8]" />
            Guided Troubleshooting Steps
          </span>
          <span className="text-[11px] font-semibold text-slate-600 bg-white px-2 py-0.5 rounded-full border border-slate-200">
            {completedCount} / {totalDetectedSteps} Completed
          </span>
        </div>
      )}
      {lines.map((line, lineIdx) => {
        const trimmed = line.trim();
        const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ');
        const cleanLine = isBullet ? trimmed.substring(2) : trimmed;

        // Structured step detection: "Step 1: ...", "**Step 1:** ...", "1. ...", "2) ..."
        const stepMatch = cleanLine.match(stepRegex);
        if (stepMatch) {
          const stepNum = stepMatch[1] || stepMatch[2] || stepMatch[3];
          const stepBody = stepMatch[4] || '';
          const isDone = Boolean(completedSteps[stepNum]);

          // Extract optional leading bold title e.g. "**Power Cycle Unit** — Unplug the main cord..."
          const titleMatch = stepBody.match(/^\*\*(.+?)\*\*\s*(?:[:\-—–]\s*)?(.*)$/);
          const stepTitle = titleMatch ? titleMatch[1] : null;
          const stepDesc = titleMatch ? titleMatch[2] : stepBody;

          return (
            <div
              key={lineIdx}
              onClick={() => setCompletedSteps((prev) => ({ ...prev, [stepNum]: !prev[stepNum] }))}
              className={`my-2 p-3.5 rounded-xl border transition-all cursor-pointer flex items-start gap-3 text-left shadow-xs ${
                isDone
                  ? 'bg-emerald-50/70 border-emerald-200'
                  : 'bg-blue-50/60 hover:bg-blue-50/90 border-blue-200/80'
              }`}
              title="Click to mark step as completed"
            >
              <div className="flex items-center gap-2 shrink-0 mt-0.5">
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${
                    isDone
                      ? 'bg-emerald-600 text-white'
                      : 'bg-[#252578] text-white'
                  }`}
                >
                  {isDone ? '✓' : stepNum}
                </span>
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                    isDone
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-[#252578]/10 text-[#252578]'
                  }`}
                >
                  Step {stepNum}
                </span>
              </div>
              <div className={`flex-1 text-xs leading-relaxed ${isDone ? 'line-through text-slate-500' : 'text-slate-800 font-medium'}`}>
                {stepTitle && (
                  <p className={`font-bold text-xs mb-0.5 ${isDone ? 'text-emerald-800' : 'text-[#252578]'}`}>
                    {stepTitle}
                  </p>
                )}
                <div>{renderInlineTokens(stepDesc || stepTitle || '')}</div>
              </div>
            </div>
          );
        }

        const elements = renderInlineTokens(cleanLine);

        if (isBullet) {
          return (
            <div key={lineIdx} className="flex items-start gap-2 pl-2">
              <span className="text-[#252578] font-bold flex-shrink-0 select-none">•</span>
              <div>{elements}</div>
            </div>
          );
        }

        return (
          <p key={lineIdx} className={lineIdx > 0 && line === '' ? 'h-2' : ''}>
            {elements}
          </p>
        );
      })}
    </div>
  );
}

const isTroubleshootingResponse = (content) => {
  if (typeof content !== 'string' || !content.trim()) return false;
  const lower = content.toLowerCase();

  // If it's a pure greeting, acknowledgment, or informational request without troubleshooting steps, do NOT prompt
  const isGreetingOrClarification =
    lower.startsWith('hello') ||
    lower.startsWith('hi') ||
    lower.startsWith('hey') ||
    lower.startsWith('greetings') ||
    lower.includes('describe the machine') ||
    lower.includes('what machine are you having') ||
    lower.includes('what is the brand') ||
    lower.includes('how can i assist you today') ||
    lower.includes('how can i help you today');

  // Check for troubleshooting steps or actionable directives
  const hasStructuredSteps = /^(?:step\s*\d+|[1-9]\s*[\.\)]|\*|\-)\s+/im.test(content);
  const hasTroubleshootingKeywords =
    lower.includes('step 1') ||
    lower.includes('troubleshoot') ||
    lower.includes('try the following') ||
    lower.includes('to resolve this') ||
    lower.includes('check if') ||
    lower.includes('power cycle') ||
    lower.includes('restart the') ||
    lower.includes('unplug') ||
    lower.includes('disconnect') ||
    lower.includes('clear the jam') ||
    lower.includes('reinstall') ||
    lower.includes('inspect the') ||
    lower.includes('replace the');

  if (isGreetingOrClarification && !hasStructuredSteps) {
    return false;
  }

  return hasStructuredSteps || hasTroubleshootingKeywords;
};

const suggestionChips = [
  'Machine Calibration Error',
  'Display Panel Unresponsive',
  'Sensor Connection Fault',
  'Power Supply / Startup Issue',
  'Software Sync Error',
  'Network Connectivity Issue',
];

const welcomeMessage = {
  id: 'welcome',
  role: 'ai',
  content: (
    <div>
      <p className="text-base font-semibold mb-2">Hello! I'm your AI Support Assistant.</p>
      <p className="text-sm leading-relaxed">
        I can help troubleshoot your purchased machines using the company's knowledge base, manuals, FAQs, and troubleshooting guides. If your issue cannot be resolved, I can also assist in preparing a support ticket for submission.
      </p>
    </div>
  ),
  timestamp: new Date().toISOString(),
};

const gatherDetailsMessage = {
  id: 'gather-details',
  role: 'ai',
  content: (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
        <p className="text-xs sm:text-sm font-bold text-[#252578]">
          Diagnostic Intake — 5 Quick Steps to Get Started
        </p>
        <span className="text-[10px] font-bold uppercase tracking-wider bg-[#252578]/10 text-[#252578] px-2 py-0.5 rounded-full shrink-0">
          Step-by-Step Guide
        </span>
      </div>
      <p className="text-xs text-slate-600 leading-relaxed">
        Share the details below in a single message (or one by one) so I can provide accurate, model-specific troubleshooting steps:
      </p>
      <div className="space-y-2">
        {[
          { step: 1, title: 'Equipment / Machine Name', desc: 'Which machine or equipment unit is experiencing the issue?' },
          { step: 2, title: 'Brand & Model', desc: 'What is the manufacturer brand and specific model number?' },
          { step: 3, title: 'Serial Number', desc: 'Provide the unit serial number (or reply "Not Available" if unknown).' },
          { step: 4, title: 'Symptom & Error Code', desc: 'Describe the exact fault, behavior, or error code displayed on screen.' },
          { step: 5, title: 'Prior Troubleshooting', desc: 'List any checks, restarts, or actions you have already tried.' },
        ].map((item) => (
          <div
            key={item.step}
            className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs"
          >
            <span className="bg-[#252578] text-white text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 mt-0.5">
              Step {item.step}
            </span>
            <div className="min-w-0 flex-1">
              <span className="font-bold text-slate-800">{item.title}: </span>
              <span className="text-slate-600">{item.desc}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  ),
  timestamp: new Date().toISOString(),
};

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-3 max-w-[75%]">
        <div className="w-8 h-8 rounded-full bg-[#252578] flex items-center justify-center flex-shrink-0">
          <Bot size={16} className="text-white" />
        </div>
        <div className="bg-white text-gray-800 border border-gray-100 rounded-2xl rounded-bl-md shadow-sm px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function AISourceList({ sources }) {
  const [expanded, setExpanded] = useState(false);
  if (!sources || sources.length === 0) return null;
  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs font-semibold text-[#252578] hover:underline cursor-pointer"
      >
        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        Sources ({sources.length})
      </button>
      {expanded && (
        <div className="mt-2 space-y-1">
          {sources.map((src, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs text-gray-600">
              <span className="w-1 h-1 rounded-full bg-gray-400" />
              {src}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TicketRecommendationCard({ onCreateTicket, onContinue }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[75%] w-full">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl rounded-bl-md shadow-sm p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-amber-800">Need Further Assistance?</p>
              <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                It appears that your issue requires technical support. Would you like to create a support ticket using the information we've gathered?
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={onCreateTicket}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-xl transition-all cursor-pointer"
                >
                  Create Ticket
                </button>
                <button
                  type="button"
                  onClick={onContinue}
                  className="px-4 py-2 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 text-xs font-semibold rounded-xl transition-all cursor-pointer"
                >
                  Continue Chatting
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TicketReviewModal({ isOpen, data, machines = [], onClose, onSubmit, onSaveDraft }) {
  const navigate = useNavigate();
  const [form, setForm] = useState(data || {});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [titleCasingData, setTitleCasingData] = useState(null);
  const [showTitleCasingModal, setShowTitleCasingModal] = useState(false);
  const [isTitleManuallyEdited, setIsTitleManuallyEdited] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    if (data) {
      setForm(data);
      setIsSubmitting(false);
      setIsSavingDraft(false);
      setTitleCasingData(null);
      setShowTitleCasingModal(false);
      setIsTitleManuallyEdited(false);
      setSubmitError(null);
    }
  }, [data, isOpen]);

  if (!isOpen) return null;

  const handleSaveDraft = async () => {
    if (isSubmitting || isSavingDraft || !onSaveDraft) return;
    setIsSavingDraft(true);
    setSubmitError(null);
    try {
      await onSaveDraft(form);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Failed to save draft.';
      setSubmitError(msg);
      setIsSavingDraft(false);
    }
  };

  const handleSubmit = async () => {
    if (isSubmitting || isSavingDraft) return;

    const summaryTrimmed = (form.problemSummary || '').trim();
    // Only prompt for proper casing if the user manually edited the title
    if (isTitleManuallyEdited && needsProperCasing(summaryTrimmed)) {
      const proper = formatProperTitleCase(summaryTrimmed);
      setTitleCasingData({
        original: summaryTrimmed,
        formatted: proper,
      });
      setShowTitleCasingModal(true);
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(form);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Failed to submit ticket.';
      setSubmitError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmTitleCasing = async () => {
    if (!titleCasingData) return;
    const formatted = titleCasingData.formatted;
    const updatedForm = { ...form, problemSummary: formatted };
    setForm(updatedForm);
    setShowTitleCasingModal(false);

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(updatedForm);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Failed to submit ticket.';
      setSubmitError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px]">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-lg font-bold text-gray-900">Review Support Ticket</h2>
          <button onClick={onClose} disabled={isSubmitting} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 cursor-pointer disabled:opacity-50">
            <X size={20} />
          </button>
        </div>
        {submitError && (
          <div className="mx-6 mt-4 p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 flex-shrink-0">
            <AlertTriangle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-xs text-red-700 font-medium leading-relaxed">
              <strong className="block text-red-800 font-bold mb-0.5">Ticket Submission Error</strong>
              {submitError}
            </div>
            <button onClick={() => setSubmitError(null)} className="text-red-400 hover:text-red-600 cursor-pointer">
              <X size={16} />
            </button>
          </div>
        )}
        <div className="overflow-y-auto px-6 py-4 space-y-4 flex-1">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Machine / Equipment <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                list="review-machines-list"
                value={form.machineModel || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  const matched = machines.find(m => 
                    m.machine_name?.toLowerCase() === val.toLowerCase() || 
                    m.model?.toLowerCase() === val.toLowerCase()
                  );
                  setForm({ 
                    ...form, 
                    machineModel: val,
                    machine_ID: matched ? matched.machine_ID : form.machine_ID 
                  });
                }}
                placeholder="Select or enter machine..."
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578]"
              />
              <datalist id="review-machines-list">
                {machines.map((m) => (
                  <option key={m.machine_ID} value={m.machine_name}>
                    {m.serial_number ? `${m.machine_name} (${m.serial_number})` : m.machine_name}
                  </option>
                ))}
              </datalist>
              <p className="text-[11px] text-gray-400 mt-1">
                Select the specific machine experiencing the problem. Tickets are tracked per machine.
              </p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Company Name</label>
              <input
                type="text"
                value={form.companyName || ''}
                onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578]"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Purchase Date</label>
              <input
                type="date"
                value={form.purchaseDate || ''}
                onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578]"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Suggested Category</label>
              <select
                value={form.category || 'Hardware'}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578] bg-white"
              >
                <option>Hardware</option>
                <option>Software</option>
                <option>Network</option>
                <option>Consumables</option>
                <option>Other</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Suggested Priority</label>
              <select
                value={form.priority || 'Medium'}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578] bg-white"
              >
                <option>Low</option>
                <option>Medium</option>
                <option>High</option>
                <option>Critical</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Problem Summary</label>
            <textarea
              rows={3}
              value={form.problemSummary || ''}
              onChange={(e) => {
                setIsTitleManuallyEdited(true);
                setForm({ ...form, problemSummary: e.target.value });
              }}
              onBlur={() => {
                const trimmed = (form.problemSummary || '').trim();
                if (isTitleManuallyEdited && needsProperCasing(trimmed)) {
                  const proper = formatProperTitleCase(trimmed);
                  setTitleCasingData({
                    original: trimmed,
                    formatted: proper,
                  });
                  setShowTitleCasingModal(true);
                }
              }}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578] resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Conversation Summary</label>
            <textarea
              rows={4}
              value={form.conversationSummary || ''}
              onChange={(e) => setForm({ ...form, conversationSummary: e.target.value })}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578] resize-none"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button
            type="button"
            onClick={() => {
              onClose();
              navigate('/create-ticket', {
                state: {
                  conversationId: activeConversationId,
                  conversation_id: activeConversationId,
                  fromConversationId: activeConversationId,
                  fromAiChat: true,
                  prefillData: {
                    title: form.problemSummary || form.title || '',
                    problemSummary: form.problemSummary || form.title || '',
                    machine_ID: form.machine_ID || '',
                    machineModel: form.machineModel || '',
                    machine_name: form.machineModel || '',
                    problem_category_ID: form.problem_category_ID || '',
                    category: form.category || '',
                    category_name: form.category || '',
                    description: form.conversationSummary || form.description || '',
                    conversationSummary: form.conversationSummary || form.description || '',
                  },
                },
              });
            }}
            className="text-xs text-[#252578] font-semibold hover:underline cursor-pointer"
          >
            Open in full ticket creation page →
          </button>
          <div className="flex items-center gap-3 ml-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting || isSavingDraft}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-100 transition-all cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            {onSaveDraft && (
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={isSubmitting || isSavingDraft}
                className="px-5 py-2.5 rounded-xl border border-[#252578] text-[#252578] hover:bg-[#252578]/5 text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2"
              >
                {isSavingDraft ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-[#252578] border-t-transparent rounded-full animate-spin" />
                    Saving Draft...
                  </>
                ) : (
                  'Save as Draft'
                )}
              </button>
            )}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || isSavingDraft}
              className={`px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all flex items-center gap-2 ${
                isSubmitting ? 'bg-gray-400 cursor-not-allowed' : 'bg-[#252578] hover:bg-[#1f1f66] cursor-pointer'
              }`}
            >
              {isSubmitting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Submitting...
                </>
              ) : (
                'Submit Ticket'
              )}
            </button>
          </div>
        </div>
      </div>

      <TitleCasingModal
        isOpen={showTitleCasingModal}
        originalTitle={titleCasingData?.original}
        formattedTitle={titleCasingData?.formatted}
        onConfirm={handleConfirmTitleCasing}
        onCancel={() => setShowTitleCasingModal(false)}
      />
    </div>
  );
}

function SuccessDialog({ isOpen, ticketNumber, onViewTicket, onClose }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px]">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl text-center" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
          <CheckCircle size={24} className="text-green-700" />
        </div>
        <h2 className="mt-4 text-lg font-bold text-gray-900">Support Ticket Successfully Created</h2>
        <p className="mt-2 text-sm text-gray-500">Ticket Number</p>
        <p className="text-2xl font-bold text-[#252578]">{ticketNumber}</p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={onViewTicket}
            className="rounded-xl bg-[#252578] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1f1f66] cursor-pointer"
          >
            View Ticket
          </button>
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100 cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function SubmissionErrorDialog({ isOpen, title, message, onViewTickets, onClose }) {
  if (!isOpen) return null;
  const isLimitError = typeof message === 'string' && message.toLowerCase().includes('limit');
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px]" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl text-center" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-600">
          <AlertTriangle size={28} />
        </div>
        <h2 className="mt-4 text-lg font-bold text-gray-900">{title || 'Ticket Submission Error'}</h2>
        
        <div className="mt-3 p-3.5 bg-red-50 border border-red-200/80 rounded-xl text-left">
          <p className="text-xs font-bold text-red-800 uppercase tracking-wider mb-1">
            {isLimitError ? 'Maximum Ticket Limit Reached' : 'Submission Details'}
          </p>
          <p className="text-sm text-red-700 leading-relaxed font-medium">
            {message}
          </p>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-100 cursor-pointer"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onViewTickets}
            className="rounded-xl bg-[#252578] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1f1f66] cursor-pointer shadow-sm"
          >
            View My Tickets
          </button>
        </div>
      </div>
    </div>
  );
}

const getStoredUser = () => {
  try {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

function AISupportPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const effectiveUser = user || getStoredUser();
  const currentUserId = effectiveUser?.id ?? effectiveUser?.client_ID ?? effectiveUser?.client_id;

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState('');
  const [messages, setMessages] = useState([welcomeMessage, gatherDetailsMessage]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showSuggestionChips, setShowSuggestionChips] = useState(true);
  const [showTicketCard, setShowTicketCard] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewData, setReviewData] = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [ticketNumber, setTicketNumber] = useState('');
  const [submissionError, setSubmissionError] = useState({ isOpen: false, title: '', message: '' });
  const [conversationPhase, setConversationPhase] = useState(0);
  const [escalationTicketData, setEscalationTicketData] = useState(null);
  const [ticketOptions, setTicketOptions] = useState(null);
  const [feedbackMap, setFeedbackMap] = useState({});

  useEffect(() => {
    if (!effectiveUser) return;
    getTicketFormOptions()
      .then(opts => setTicketOptions(opts))
      .catch(err => console.warn("Failed to load ticket form options:", err));
  }, [effectiveUser]);

  useEffect(() => {
    if (effectiveUser?.role && effectiveUser.role !== 'customer') {
      if (effectiveUser.role === 'employee') {
        navigate('/employee/dashboard', { replace: true });
      } else if (effectiveUser.role === 'cs') {
        navigate('/cs/dashboard', { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    }
  }, [effectiveUser, navigate]);

  // Store per-conversation state
  const conversationStateRef = useRef({});
  const conversationsRef = useRef(conversations);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // Load conversation state
  // Load conversation state
  const loadConversation = useCallback((convId) => {
    if (!convId) return;

    // Handle local draft conversations that have not been persisted to the backend yet
    const isLocalDraft = String(convId).startsWith('draft-') && !(conversationsRef.current || []).some(c => c.id === convId);
    if (isLocalDraft) {
      const saved = conversationStateRef.current[convId];
      if (saved) {
        setMessages(saved.messages);
        setShowSuggestionChips(saved.showSuggestionChips);
        setShowTicketCard(saved.showTicketCard);
        setConversationPhase(saved.conversationPhase);
        setEscalationTicketData(saved.escalationTicketData || null);
      } else {
        setMessages([welcomeMessage, gatherDetailsMessage]);
        setShowSuggestionChips(true);
        setShowTicketCard(false);
        setConversationPhase(0);
        setEscalationTicketData(null);
      }
      setActiveConversationId(convId);
      return;
    }

    axiosInstance.get(`${AI_API_URL}/conversations/${convId}`, { 
      baseURL: '',
      params: { user_id: currentUserId }
    })
      .then(res => {
        if (res.data.success && res.data.conversation) {
          const conv = res.data.conversation;
          let finalMessages = conv.messages || [];
          if (typeof finalMessages === 'string') {
            try {
              finalMessages = JSON.parse(finalMessages);
            } catch (e) {
              console.error("Failed to parse messages string:", e);
              finalMessages = [];
            }
          }
          
          if (finalMessages.length === 0) {
            finalMessages = [welcomeMessage, gatherDetailsMessage];
          } else {
            if (finalMessages[0] && finalMessages[0].role !== 'system') {
              finalMessages = [welcomeMessage, gatherDetailsMessage, ...finalMessages];
            }
          }

          finalMessages = finalMessages.map((m, idx) => ({
            ...m,
            id: m.id || m._id || `loaded-msg-${idx}-${m.timestamp || m.created_at || idx}`
          }));

          setMessages(finalMessages);
          setShowSuggestionChips(finalMessages.length <= 2);

          // Determine if ticket recommendation card should be displayed
          const isEscalatedStatus = conv.status === 'escalated' || conv.escalation_data != null;
          let shouldShowCard = isEscalatedStatus;

          if (!shouldShowCard && finalMessages.length > 0) {
            const aiMsgs = finalMessages.filter(m => m.role === 'ai' || m.role === 'assistant');
            const lastAiMsg = aiMsgs[aiMsgs.length - 1];
            const userMsgs = finalMessages.filter(m => m.role === 'user');
            const lastUserMsg = userMsgs[userMsgs.length - 1];

            if (lastAiMsg && typeof lastAiMsg.content === 'string') {
              const lower = lastAiMsg.content.toLowerCase();
              const suggestsTicket = lower.includes('support ticket') || 
                                     lower.includes('create a ticket') || 
                                     lower.includes('open a ticket') || 
                                     lower.includes('technician') ||
                                     lower.includes('escalate');
              
              const userDismissed = lastUserMsg && typeof lastUserMsg.content === 'string' &&
                (lastUserMsg.content.includes("I'll try the steps first") || 
                 lastUserMsg.content.includes("I'll try the steps") || 
                 lastUserMsg.content.includes("successfully created"));

              if (suggestsTicket && !userDismissed) {
                shouldShowCard = true;
              }
            }
          }

          if (conv.status === 'resolved' || conv.status === 'ticket_created') {
            shouldShowCard = false;
          }

          setShowTicketCard(shouldShowCard);
          setConversationPhase(shouldShowCard ? 3 : 0);
          setEscalationTicketData(conv.escalation_data || null);
          setActiveConversationId(convId);
          
          conversationStateRef.current[convId] = {
            messages: finalMessages,
            conversationPhase: shouldShowCard ? 3 : 0,
            showSuggestionChips: finalMessages.length <= 2,
            showTicketCard: shouldShowCard,
            escalationTicketData: conv.escalation_data || null,
          };
        }
      })
      .catch(err => {
        console.error("Failed to load conversation from backend:", err);
        const saved = conversationStateRef.current[convId];
        if (saved) {
          setMessages(saved.messages);
          setShowSuggestionChips(saved.showSuggestionChips);
          setShowTicketCard(saved.showTicketCard);
          setConversationPhase(saved.conversationPhase);
          setEscalationTicketData(saved.escalationTicketData || null);
        } else {
          setMessages([welcomeMessage, gatherDetailsMessage]);
          setShowSuggestionChips(true);
          setShowTicketCard(false);
          setConversationPhase(0);
          setEscalationTicketData(null);
        }
        setActiveConversationId(convId);
      });
  }, [currentUserId]);

  const handleNewChat = useCallback(() => {
    const list = conversationsRef.current || [];
    // If active conversation or an existing list item is already an unused conversation, just navigate to it
    const existingUnused = list.find(c =>
      (c.title === 'New Conversation' || c.title === 'New Chat') &&
      (!c.messageCount || c.messageCount <= 2)
    );
    if (existingUnused && existingUnused.id) {
      loadConversation(existingUnused.id);
      return;
    }

    const id = `draft-${Date.now()}`;
    const newConv = {
      id,
      title: 'New Conversation',
      timestamp: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      messageCount: 2,
    };

    setConversations(prev => {
      // Remove any prior empty local draft
      const filtered = prev.filter(c => !(String(c.id).startsWith('draft-') && c.title === 'New Conversation' && (!c.messageCount || c.messageCount <= 2)));
      return [newConv, ...filtered];
    });

    setActiveConversationId(id);
    setMessages([welcomeMessage, gatherDetailsMessage]);
    setShowSuggestionChips(true);
    setShowTicketCard(false);
    setConversationPhase(0);
    setEscalationTicketData(null);

    conversationStateRef.current[id] = {
      messages: [welcomeMessage, gatherDetailsMessage],
      conversationPhase: 0,
      showSuggestionChips: true,
      showTicketCard: false,
      escalationTicketData: null,
    };
  }, [loadConversation]);

  // Load all conversations from MongoDB / MySQL
  const fetchConversationsListOnly = useCallback(() => {
    if (!currentUserId) return;
    axiosInstance.get(`${AI_API_URL}/conversations`, { baseURL: '', params: { user_id: currentUserId } })
      .then(res => {
        if (res.data.success && Array.isArray(res.data.conversations)) {
          const cleanConvs = res.data.conversations
            .filter(c => !/paper jam/i.test(c.title || ''))
            .map(c => ({
              ...c,
              timestamp: c.updated_at || c.created_at || new Date().toISOString(),
              messageCount: c.message_count !== undefined ? c.message_count : (Array.isArray(c.messages) ? c.messages.length : (c.messageCount || 2)),
              title: c.title ? c.title.replace(/^(?:\d+[\.\)\-:]|\b[qQ]\d+[:\.]|\b(?:machine|problem|issue|item)[:\-])\s*/i, '').trim() : 'AI Support Session'
            }));
          setConversations(prev => {
            const activeDraft = prev.find(c => String(c.id).startsWith('draft-'));
            return activeDraft ? [activeDraft, ...cleanConvs] : cleanConvs;
          });
        }
      })
      .catch(err => {
        console.error("Failed to refresh conversations list:", err);
      });
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return;

    let isMounted = true;
    axiosInstance.get(`${AI_API_URL}/conversations`, { baseURL: '', params: { user_id: currentUserId } })
      .then(res => {
        if (!isMounted) return;
        if (res.data.success && Array.isArray(res.data.conversations)) {
          const fetched = res.data.conversations
            .filter(c => !/paper jam/i.test(c.title || ''))
            .map(c => ({
              ...c,
              timestamp: c.updated_at || c.created_at || new Date().toISOString(),
              messageCount: c.message_count !== undefined ? c.message_count : (Array.isArray(c.messages) ? c.messages.length : (c.messageCount || 2)),
              title: c.title ? c.title.replace(/^(?:\d+[\.\)\-:]|\b[qQ]\d+[:\.]|\b(?:machine|problem|issue|item)[:\-])\s*/i, '').trim() : 'AI Support Session'
            }));
          setConversations(fetched);
          // Always open on a clean New Support Session by default instead of loading stale test chats
          handleNewChat();
        } else {
          handleNewChat();
        }
      })
      .catch(err => {
        if (!isMounted) return;
        console.error("Failed to load conversations:", err);
        const list = conversationsRef.current || [];
        if (list.length === 0) {
          handleNewChat();
        }
      });

    return () => {
      isMounted = false;
    };
  }, [currentUserId, loadConversation, handleNewChat]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // Save conversation state
  const saveConversationState = useCallback((convId, msgs, phase, showSugg, showCard, escData) => {
    conversationStateRef.current[convId] = {
      messages: msgs,
      conversationPhase: phase,
      showSuggestionChips: showSugg,
      showTicketCard: showCard,
      escalationTicketData: escData !== undefined ? escData : null,
    };
    setConversations(prev => prev.map(c =>
      c.id === convId
        ? { ...c, timestamp: new Date().toISOString(), messageCount: msgs.length }
        : c
    ));
  }, []);

  const addMessage = useCallback((msg) => {
    setMessages(prev => {
      const updated = [...prev, msg];
      saveConversationState(activeConversationId, updated, conversationPhase, showSuggestionChips, showTicketCard, escalationTicketData);
      return updated;
    });
  }, [activeConversationId, conversationPhase, showSuggestionChips, showTicketCard, escalationTicketData, saveConversationState]);

  const simulateAIResponse = useCallback((content, sources) => {
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      addMessage({
        id: `ai-${Date.now()}`,
        role: 'ai',
        content,
        sources,
        timestamp: new Date().toISOString(),
      });
    }, 1500);
  }, [addMessage]);

  const handleSuggestionClick = useCallback((chip) => {
    setInput(chip);
    inputRef.current?.focus();
  }, []);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isTyping) return;

    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    addMessage(userMessage);
    setInput('');
    if (showSuggestionChips) setShowSuggestionChips(false);
    setIsTyping(true);

    const updatedMessages = [...messages, userMessage];
    const apiMessages = updatedMessages
      .filter(m => m.id !== 'welcome')
      .map(m => ({
        role: m.role === 'ai' ? 'assistant' : m.role,
        content: typeof m.content === 'string' ? m.content : ''
      }))
      .filter(m => m.content !== '');

    const activeIdToSend = String(activeConversationId).startsWith('draft-') ? null : activeConversationId;

    axiosInstance.post(`${AI_API_URL}/chat`, { 
      messages: apiMessages,
      conversation_id: activeIdToSend,
      user_id: currentUserId
    }, { baseURL: '' })
      .then(res => {
        setIsTyping(false);
        const returnedConvId = res.data.conversation_id || activeConversationId;
        if (returnedConvId !== activeConversationId) {
          setActiveConversationId(returnedConvId);
        }

        if (res.data.is_duplicate && res.data.conversation_id) {
          loadConversation(res.data.conversation_id);
          fetchConversationsListOnly();
          return;
        }
        const reply = res.data.content || 'I could not generate a response. Please try again.';
        
        const aiMessage = {
          id: `ai-${Date.now()}`,
          role: 'ai',
          content: reply,
          timestamp: new Date().toISOString(),
        };

        const isEscalated = res.data.escalate === true;
        const escTicketData = res.data.ticket_data || null;

        if (isEscalated && escTicketData) {
          setEscalationTicketData(escTicketData);
        }

        setMessages(prev => {
          const updated = [...prev, aiMessage];
          const lowerReply = reply.toLowerCase();
          // Only show create ticket card if AI explicitly escalates or fails to generate
          const shouldSuggestTicket = isEscalated === true || lowerReply.includes('could not generate');
          
          if (shouldSuggestTicket) {
            setShowTicketCard(true);
          } else {
            setShowTicketCard(false);
          }

          saveConversationState(returnedConvId, updated, conversationPhase, false, shouldSuggestTicket, escTicketData);
          fetchConversationsListOnly();
          return updated;
        });
      })
      .catch(err => {
        setIsTyping(false);
        console.error(err);
        const errorText = err.response?.data?.error || 'AI Assistant is currently offline or unreachable. You can create a support ticket manually with our technical support team.';
        
        const offlineErrorContent = (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-900 space-y-3 text-left">
            <div className="flex items-center gap-2 text-amber-800 font-bold text-sm">
              <AlertTriangle size={18} className="text-amber-600 shrink-0" />
              <span>AI Service Unavailable</span>
            </div>
            <p className="text-xs leading-relaxed text-amber-800 font-medium">{errorText}</p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleCreateTicket}
                className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-xl shadow-xs transition-all cursor-pointer inline-flex items-center gap-1.5"
              >
                <Plus size={14} />
                Create Ticket With Context
              </button>
              <button
                type="button"
                onClick={() => navigate('/create-ticket', { state: { prefillData: { problemSummary: text, description: text } } })}
                className="px-3.5 py-1.5 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 text-xs font-semibold rounded-xl transition-all cursor-pointer"
              >
                Standard Ticket Form
              </button>
            </div>
          </div>
        );

        const aiMessage = {
          id: `ai-${Date.now()}`,
          role: 'ai',
          content: offlineErrorContent,
          timestamp: new Date().toISOString(),
        };

        setMessages(prev => {
          const updated = [...prev, aiMessage];
          saveConversationState(activeConversationId, updated, conversationPhase, false, true, escalationTicketData);
          return updated;
        });
      });

  }, [input, conversationPhase, messages, showSuggestionChips, showTicketCard, activeConversationId, isTyping, addMessage, saveConversationState, escalationTicketData, fetchConversationsListOnly, currentUserId]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleDeleteConversation = useCallback((e, convId) => {
    if (e && e.stopPropagation) e.stopPropagation();
    delete conversationStateRef.current[convId];

    setConversations(prev => {
      const nextList = prev.filter(c => c.id !== convId);
      if (activeConversationId === convId) {
        if (nextList.length > 0 && nextList[0].id) {
          loadConversation(nextList[0].id);
        } else {
          handleNewChat();
        }
      }
      return nextList;
    });

    axiosInstance.delete(`${AI_API_URL}/conversations/${convId}`, {
      baseURL: '',
      params: { user_id: currentUserId }
    })
      .then(() => {
        fetchConversationsListOnly();
      })
      .catch(err => {
        console.warn("Conversation delete completed with notice:", err);
      });
  }, [activeConversationId, loadConversation, handleNewChat, fetchConversationsListOnly, currentUserId]);

  const handleDeleteMessage = useCallback((msgId) => {
    if (!msgId || msgId === 'welcome' || msgId === 'gather') return;

    setMessages(prev => {
      const updated = prev.filter(m => m.id !== msgId);
      saveConversationState(activeConversationId, updated, conversationPhase, showSuggestionChips, showTicketCard, escalationTicketData);
      return updated;
    });

    if (activeConversationId) {
      axiosInstance.delete(`${AI_API_URL}/conversations/${activeConversationId}/messages/${msgId}`, {
        baseURL: '',
        params: { user_id: currentUserId }
      }).catch(err => {
        console.warn("Message delete sync:", err);
      });
    }
  }, [activeConversationId, conversationPhase, showSuggestionChips, showTicketCard, escalationTicketData, saveConversationState, currentUserId]);

  const handleClearChat = useCallback(() => {
    if (window.confirm("Are you sure you want to clear this conversation's messages?")) {
      setMessages([welcomeMessage, gatherDetailsMessage]);
      setShowSuggestionChips(true);
      setShowTicketCard(false);
      setConversationPhase(0);
      setEscalationTicketData(null);

      if (activeConversationId) {
        delete conversationStateRef.current[activeConversationId];
        axiosInstance.delete(`${AI_API_URL}/conversations/${activeConversationId}`, {
          baseURL: '',
          params: { user_id: currentUserId }
        }).then(() => {
          fetchConversationsListOnly();
        }).catch(() => null);
      }
    }
  }, [activeConversationId, currentUserId, fetchConversationsListOnly]);

  const [duplicateModal, setDuplicateModal] = useState({
    isOpen: false,
    machineName: '',
    ticketNo: '',
    ticketStatus: '',
    existingTicket: null,
  });

  const generateRealReviewData = useCallback((escData) => {
    const activeConv = conversations.find(c => c.id === activeConversationId);

    const greetingsList = [
      'hi', 'hello', 'hey', 'good morning', 'good afternoon', 'good evening',
      'good day', 'greetings', 'yes', 'no', 'ok', 'okay', 'not working', 'help',
      'please help', 'test', 'support', 'hi there', 'hello there'
    ];

    const isPureGreeting = (str) => {
      if (!str) return true;
      const clean = str.trim().toLowerCase().replace(/[^\w\s]/g, '');
      return greetingsList.includes(clean);
    };

    const cleanProblemText = (str) => {
      if (!str) return '';
      let res = str.trim();
      const lower = res.toLowerCase();
      for (const g of greetingsList) {
        if (lower.startsWith(g + ' ') || lower.startsWith(g + ',')) {
          res = res.slice(g.length).replace(/^[\s,.\-!]+/, '');
        }
      }
      // Strip leading question numbers, bullets, list markers e.g. "1.", "1)", "1 -", "Q1:", "Machine:"
      res = res.replace(/^(?:\d+[\.\)\-:]|\b[qQ]\d+[:\.]|\b(?:machine|problem|issue|item)[:\-])\s*/i, '');
      return res.trim();
    };

    const userMsgs = messages
      .filter(m => m.role === 'user' && typeof m.content === 'string')
      .map(m => m.content.trim())
      .filter(txt => txt.length > 0 && !isPureGreeting(txt));

    let resolvedTitle = escData?.title || escData?.problemSummary || '';
    if (resolvedTitle) {
      resolvedTitle = cleanProblemText(resolvedTitle);
    }

    if (!resolvedTitle || isPureGreeting(resolvedTitle)) {
      if (activeConv?.title && !['New Conversation', 'New Chat', 'Support Inquiry'].includes(activeConv.title) && !isPureGreeting(activeConv.title)) {
        resolvedTitle = cleanProblemText(activeConv.title);
      }
    }
    if (!resolvedTitle || isPureGreeting(resolvedTitle)) {
      const substantive = userMsgs.map(cleanProblemText).filter(txt => txt.length >= 3 && !isPureGreeting(txt));
      // If substantive[0] is just a machine name and substantive[1] is the problem, combine them
      if (substantive.length >= 2 && substantive[0].length < 30) {
        resolvedTitle = `${substantive[0]} - ${substantive[1]}`;
      } else if (substantive.length > 0) {
        resolvedTitle = substantive[0];
      }
    }
    if (!resolvedTitle || isPureGreeting(resolvedTitle)) {
      resolvedTitle = 'Equipment Technical Support Request';
    }

    // Capitalize & apply proper title casing automatically for AI generated title
    resolvedTitle = cleanProblemText(resolvedTitle);
    if (resolvedTitle.length > 0) {
      resolvedTitle = formatProperTitleCase(resolvedTitle);
    }
    const convoTitle = resolvedTitle.length > 70 ? resolvedTitle.slice(0, 70) + '...' : resolvedTitle;

    const userOrg = user?.company_name || user?.organization || user?.client_name || user?.company ||
      (user?.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : '') || 'Customer Organization';

    // ─── DYNAMIC MACHINE MODEL RESOLUTION ─────────────────────
    let model = escData?.machineModel;
    let matchedMachineId = escData?.machine_ID || null;
    let isExplicitMachine = false;

    if (model && model.trim() !== '' && model.toLowerCase() !== 'unknown machine' && model.toLowerCase() !== 'general equipment') {
      model = cleanProblemText(model.trim());
      isExplicitMachine = true;
    } else {
      model = null;
    }

    // Match chat messages against database equipment list
    if (!model && ticketOptions?.machines && ticketOptions.machines.length > 0) {
      const combinedChatText = userMsgs.join(' ').toLowerCase();
      const matchedMachine = ticketOptions.machines.find(m => {
        const nameMatch = m.machine_name && combinedChatText.includes(m.machine_name.toLowerCase());
        const modelMatch = m.model && combinedChatText.includes(m.model.toLowerCase());
        const brandMatch = m.brand && combinedChatText.includes(m.brand.toLowerCase());
        return nameMatch || modelMatch || brandMatch;
      });

      if (matchedMachine) {
        matchedMachineId = matchedMachine.machine_ID;
        const brandStr = matchedMachine.brand ? `${matchedMachine.brand} ` : '';
        const modelStr = matchedMachine.model ? `${matchedMachine.model} ` : '';
        model = `${brandStr}${modelStr}(${matchedMachine.machine_name})`.trim();
        isExplicitMachine = true;
      }
    }

    // Fallback to user's chat message answers if no database match
    if (!model) {
      if (userMsgs.length >= 2 && userMsgs[1].length < 80) {
        model = cleanProblemText(`${userMsgs[1]} ${userMsgs[0]}`);
        isExplicitMachine = true;
      } else if (userMsgs.length >= 1 && userMsgs[0].length < 80) {
        model = cleanProblemText(userMsgs[0]);
        isExplicitMachine = true;
      } else if (ticketOptions?.machines && ticketOptions.machines.length > 0) {
        const first = ticketOptions.machines[0];
        matchedMachineId = first.machine_ID;
        model = `${first.brand || ''} ${first.model || ''} (${first.machine_name})`.trim();
        isExplicitMachine = false;
      } else {
        model = 'Equipment Support Request';
        isExplicitMachine = false;
      }
    }

    let convSummary = escData?.conversationSummary;
    if (convSummary && typeof convSummary === 'string') {
      convSummary = convSummary
        .replace(/(?:\b|\n)(?:\d+[\.\)]|Step \d+:|-|\*)\s+[^\n]+/gi, '')
        .replace(/\n{2,}/g, '\n\n')
        .trim();
    }

    if (!convSummary || convSummary.trim() === '') {
      const userProblemDetails = userMsgs.length > 0 ? userMsgs.join('. ') : 'Issue reported via AI Assistant.';
      convSummary = `Customer reported an issue regarding "${convoTitle}". Machine: ${model}. Problem details: ${userProblemDetails}. Automated troubleshooting was attempted but the issue persists. Ticket escalated to technical team for follow-up.`;
    }

    return {
      machineModel: model,
      machine_ID: matchedMachineId,
      isExplicitMachine,
      companyName: userOrg,
      purchaseDate: new Date().toISOString().split('T')[0],
      problemSummary: convoTitle,
      category: escData?.category || 'Hardware',
      priority: escData?.priority || 'Medium',
      conversationSummary: convSummary,
    };
  }, [conversations, activeConversationId, messages, user, ticketOptions]);

  const handleCreateTicket = useCallback(async () => {
    const review = generateRealReviewData(escalationTicketData);
    let targetMachineId = review.machine_ID || null;
    const targetModel = (review.machineModel || '').trim().toLowerCase();

    if (!targetMachineId && ticketOptions?.machines && targetModel) {
      const found = ticketOptions.machines.find(m =>
        m.machine_name?.toLowerCase().includes(targetModel) ||
        m.model?.toLowerCase().includes(targetModel) ||
        targetModel.includes(m.machine_name?.toLowerCase())
      );
      if (found) targetMachineId = found.machine_ID;
    }

    let targetCategoryId = review.problem_category_ID || null;
    const targetCategory = (review.category || '').trim().toLowerCase();
    if (!targetCategoryId && ticketOptions?.problem_categories && targetCategory) {
      const foundCat = ticketOptions.problem_categories.find(c =>
        c.category_name?.toLowerCase() === targetCategory ||
        targetCategory.includes(c.category_name?.toLowerCase())
      );
      if (foundCat) targetCategoryId = foundCat.problem_category_ID;
    }

    const prefill = {
      title: review.problemSummary || '',
      problemSummary: review.problemSummary || '',
      machine_ID: targetMachineId || review.machine_ID || '',
      machineModel: review.machineModel || '',
      machine_name: review.machineModel || '',
      problem_category_ID: targetCategoryId || review.problem_category_ID || '',
      category: review.category || '',
      category_name: review.category || '',
      description: review.conversationSummary || '',
      conversationSummary: review.conversationSummary || '',
    };

    navigate('/create-ticket', {
      state: {
        conversationId: activeConversationId,
        conversation_id: activeConversationId,
        fromConversationId: activeConversationId,
        fromAiChat: true,
        prefillData: prefill,
      },
    });
  }, [activeConversationId, escalationTicketData, generateRealReviewData, ticketOptions, navigate]);

  const handleSubmitTicket = useCallback(async (formData) => {
    try {
      const options = await getTicketFormOptions().catch(() => null);

      let matchedMachine = null;
      let machineId = 1;
      if (options?.machines && options.machines.length > 0) {
        matchedMachine = options.machines.find(m =>
          (m.machine_name && formData.machineModel && m.machine_name.toLowerCase().trim() === formData.machineModel.toLowerCase().trim()) ||
          (m.machine_name && formData.machineModel && formData.machineModel.toLowerCase().includes(m.machine_name.toLowerCase())) ||
          (m.machine_name && formData.machineModel && m.machine_name.toLowerCase().includes(formData.machineModel.toLowerCase())) ||
          (m.model && formData.machineModel && formData.machineModel.toLowerCase().includes(m.model.toLowerCase()))
        );
        if (matchedMachine) {
          machineId = matchedMachine.machine_ID;
        } else {
          machineId = formData.machine_ID || options.machines[0].machine_ID;
        }
      }

      // Check ongoing tickets for this user
      const existingTickets = await getCustomerTickets({ createdBy: currentUserId || 1, forceRefresh: true }).catch(() => []);
      
      // Duplicate protection: only block if active ticket is for the SAME machine
      const ongoingSameMachine = (existingTickets || []).find(t => {
        const s = (t.status || '').toLowerCase();
        const isActive = s !== 'closed' && s !== 'resolved' && s !== 'completed' && s !== 'cancelled' && s !== 'discarded';
        if (!isActive) return false;

        const isSameId = matchedMachine && t.machine_ID && Number(t.machine_ID) === Number(matchedMachine.machine_ID);
        const tEquip = (t.equipment || t.machine_name || '').trim().toLowerCase();
        const cand = (formData.machineModel || '').trim().toLowerCase();
        const isSameName = Boolean(cand && tEquip && (tEquip.includes(cand) || cand.includes(tEquip)));

        return isSameId || isSameName;
      });

      if (ongoingSameMachine) {
        const ticketNo = ongoingSameMachine.ticket_ID ? (String(ongoingSameMachine.ticket_ID).startsWith('TKT-') ? String(ongoingSameMachine.ticket_ID) : `TKT-${String(ongoingSameMachine.ticket_ID).padStart(4, '0')}`) : 'ongoing ticket';
        const machineLabel = ongoingSameMachine.equipment || ongoingSameMachine.machine_name || formData.machineModel || 'this machine';
        setDuplicateModal({
          isOpen: true,
          machineName: machineLabel,
          ticketNo,
          ticketStatus: ongoingSameMachine.status || 'Open',
          existingTicket: ongoingSameMachine,
        });
        return;
      }

      let categoryId = 1;
      if (options?.problem_categories && options.problem_categories.length > 0) {
        const found = options.problem_categories.find(c =>
          c.category_name?.toLowerCase() === (formData.category || '').toLowerCase()
        );
        if (found) categoryId = found.problem_category_ID;
        else categoryId = options.problem_categories[0].problem_category_ID;
      }

      let priorityId = 2;
      if (options?.ticket_priorities && options.ticket_priorities.length > 0) {
        const found = options.ticket_priorities.find(p =>
          p.priority_name?.toLowerCase() === (formData.priority || '').toLowerCase()
        );
        if (found) priorityId = found.priority_ID;
        else priorityId = options.ticket_priorities[0].priority_ID;
      }

      const activeConv = conversations.find(c => c.id === activeConversationId);
      let ticketTitle = (formData.problemSummary || activeConv?.title || 'Support Ticket').trim();
      ticketTitle = ticketTitle.replace(/^(?:\d+[\.\)\-:]|\b[qQ]\d+[:\.]|\b(?:machine|problem|issue|item)[:\-])\s*/i, '').trim();
      if (ticketTitle.length > 0) {
        ticketTitle = formatProperTitleCase(ticketTitle);
      } else {
        ticketTitle = 'Equipment Support Request';
      }

      const payload = new FormData();
      payload.append('title', ticketTitle);
      payload.append('machine_ID', machineId);
      payload.append('problem_category_ID', categoryId);
      payload.append('priority_ID', priorityId);
      payload.append('description', formData.conversationSummary || formData.problemSummary || 'Submitted via AI Support Assistant.');

      let response;
      try {
        response = await createTicket(payload);
      } catch (err1) {
        console.warn("FormData ticket creation attempt failed, attempting JSON payload fallback...", err1);
        const objPayload = {
          title: ticketTitle,
          machine_ID: machineId,
          problem_category_ID: categoryId,
          priority_ID: priorityId,
          description: formData.conversationSummary || formData.problemSummary || 'Submitted via AI Support Assistant.',
        };
        response = await createTicket(objPayload);
      }

      const rawTicketId = response?.ticket?.ticket_ID || response?.ticket_ID || response?.dashboard_ticket?.ticket_ID || response?.id;
      const serverTicketNumber = response?.ticket?.ticket_number || response?.dashboard_ticket?.ticket_number || response?.ticket_number;
      const formattedNo = serverTicketNumber
        || (rawTicketId ? (String(rawTicketId).startsWith('TKT-') ? String(rawTicketId) : `TKT-${String(rawTicketId).padStart(4, '0')}`) : 'TKT-0001');

      setShowReviewModal(false);
      setTicketNumber(formattedNo);
      setShowSuccess(true);
      setShowTicketCard(false);

      // Update active conversation status in AI service backend to ticket_created
      axiosInstance.post(`${AI_API_URL}/tickets`, {
        title: ticketTitle,
        description: formData.conversationSummary || formData.problemSummary || 'Submitted via AI Support Assistant.',
        conversation_id: activeConversationId
      }, { baseURL: '' }).catch(() => null);

      addMessage({
        id: `ai-${Date.now()}`,
        role: 'ai',
        content: `Support ticket **${formattedNo}** has been successfully created. Our technical support team will review your ticket and get back to you shortly.`,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Failed to submit support ticket to enterprise ticketing system:', err);
      const errorMsg = err?.response?.data?.message || err?.message || 'Failed to submit ticket. Please check enterprise ticketing service connection.';
      
      setShowReviewModal(false);
      setSubmissionError({
        isOpen: true,
        title: 'Ticket Submission Error',
        message: errorMsg,
      });

      addMessage({
        id: `err-${Date.now()}`,
        role: 'ai',
        isError: true,
        errorTitle: 'Ticket Submission Error',
        content: errorMsg,
        savedForm: formData,
        timestamp: new Date().toISOString(),
      });

      throw err;
    }
  }, [addMessage, conversations, activeConversationId, currentUserId]);

  const handleSaveTicketDraft = useCallback(async (formData) => {
    try {
      const options = ticketOptions || await getTicketFormOptions().catch(() => null);

      let matchedMachine = null;
      let machineId = 1;
      if (options?.machines && options.machines.length > 0) {
        matchedMachine = options.machines.find(m =>
          (m.machine_name && formData.machineModel && m.machine_name.toLowerCase().trim() === formData.machineModel.toLowerCase().trim()) ||
          (m.machine_name && formData.machineModel && formData.machineModel.toLowerCase().includes(m.machine_name.toLowerCase())) ||
          (m.machine_name && formData.machineModel && m.machine_name.toLowerCase().includes(formData.machineModel.toLowerCase())) ||
          (m.model && formData.machineModel && formData.machineModel.toLowerCase().includes(m.model.toLowerCase()))
        );
        if (matchedMachine) {
          machineId = matchedMachine.machine_ID;
        } else {
          machineId = formData.machine_ID || options.machines[0].machine_ID;
        }
      }

      // Check ongoing tickets for this user for duplicate detection
      const existingTickets = await getCustomerTickets({ createdBy: currentUserId || 1, forceRefresh: true }).catch(() => []);

      const activeConv = conversations.find(c => c.id === activeConversationId);
      let ticketTitle = (formData.problemSummary || activeConv?.title || 'Support Ticket').trim();
      ticketTitle = ticketTitle.replace(/^(?:\d+[\.\)\-:]|\b[qQ]\d+[:\.]|\b(?:machine|problem|issue|item)[:\-])\s*/i, '').trim();
      if (ticketTitle.length > 0) {
        ticketTitle = formatProperTitleCase(ticketTitle);
      } else {
        ticketTitle = 'Equipment Support Request';
      }

      // Duplicate protection: block if an active ongoing ticket exists for this machine or identical problem
      const ongoingSameMachine = (existingTickets || []).find(t => {
        const s = (t.status || '').toLowerCase();
        const isActive = s !== 'closed' && s !== 'resolved' && s !== 'completed' && s !== 'cancelled' && s !== 'discarded';
        if (!isActive) return false;

        const isSameId = matchedMachine && t.machine_ID && Number(t.machine_ID) === Number(matchedMachine.machine_ID);
        const tEquip = (t.equipment || t.machine_name || '').trim().toLowerCase();
        const cand = (formData.machineModel || '').trim().toLowerCase();
        const isSameName = Boolean(cand && tEquip && (tEquip.includes(cand) || cand.includes(tEquip)));
        const isSameTitle = t.title && ticketTitle && t.title.trim().toLowerCase() === ticketTitle.trim().toLowerCase();

        return isSameId || isSameName || isSameTitle;
      });

      if (ongoingSameMachine) {
        setShowReviewModal(false);
        const ticketNo = ongoingSameMachine.ticket_ID ? (String(ongoingSameMachine.ticket_ID).startsWith('TKT-') ? String(ongoingSameMachine.ticket_ID) : `TKT-${String(ongoingSameMachine.ticket_ID).padStart(4, '0')}`) : 'ongoing ticket';
        const machineLabel = ongoingSameMachine.equipment || ongoingSameMachine.machine_name || formData.machineModel || 'this machine';
        setDuplicateModal({
          isOpen: true,
          machineName: machineLabel,
          ticketNo,
          ticketStatus: ongoingSameMachine.status || 'Open',
          existingTicket: ongoingSameMachine,
        });
        return;
      }

      let categoryId = 1;
      if (options?.problem_categories && options.problem_categories.length > 0) {
        const found = options.problem_categories.find(c =>
          c.category_name?.toLowerCase() === (formData.category || '').toLowerCase()
        );
        if (found) categoryId = found.problem_category_ID;
        else categoryId = options.problem_categories[0].problem_category_ID;
      }

      let priorityId = 2;
      if (options?.ticket_priorities && options.ticket_priorities.length > 0) {
        const found = options.ticket_priorities.find(p =>
          p.priority_name?.toLowerCase() === (formData.priority || '').toLowerCase()
        );
        if (found) priorityId = found.priority_ID;
        else priorityId = options.ticket_priorities[0].priority_ID;
      }

      const draftPayload = {
        title: ticketTitle,
        machine_ID: machineId,
        problem_category_ID: categoryId,
        priority_ID: priorityId,
        description: formData.conversationSummary || formData.problemSummary || 'Draft created from AI Support Assistant.',
      };

      const res = await saveTicketDraft(draftPayload);
      const savedDraftId = res.draft?.id || res.id;

      setShowReviewModal(false);
      setShowTicketCard(false);

      // Redirect directly to My Drafts tab
      navigate('/my-tickets', { state: { tab: 'drafts', draftId: savedDraftId } });
    } catch (err) {
      console.error('Failed to save draft from AI Support:', err);
      throw err;
    }
  }, [currentUserId, conversations, activeConversationId, ticketOptions, navigate]);

  const handleViewTicket = useCallback(() => {
    setShowSuccess(false);
    navigate('/my-tickets');
  }, [navigate]);

  const handleCloseSuccess = useCallback(() => {
    setShowSuccess(false);
  }, []);

  const handleContinueChatting = useCallback(() => {
    setShowTicketCard(false);
    addMessage({
      id: `user-${Date.now()}`,
      role: 'user',
      content: 'I\'ll try the steps first and let you know.',
      timestamp: new Date().toISOString(),
    });
    setTimeout(() => {
      addMessage({
        id: `ai-${Date.now()}`,
        role: 'ai',
        content: 'Sounds good! Feel free to come back anytime if you need further assistance. I\'ll be here to help.',
        timestamp: new Date().toISOString(),
      });
    }, 1200);
  }, [addMessage]);

  const handleFeedbackResolved = useCallback((msgId) => {
    setFeedbackMap(prev => ({ ...prev, [msgId]: 'resolved' }));
    addMessage({
      id: `feedback-resolved-${Date.now()}`,
      role: 'ai',
      content: 'Glad to hear the troubleshooting steps resolved your issue! If you experience any other machine problems, feel free to start a new chat anytime.',
      timestamp: new Date().toISOString(),
    });
  }, [addMessage]);

  const handleFeedbackUnresolved = useCallback((msgId) => {
    setFeedbackMap(prev => ({ ...prev, [msgId]: 'unresolved' }));
  }, []);

  const handleContinueChattingFromPrompt = useCallback((msgId) => {
    setFeedbackMap(prev => ({ ...prev, [msgId]: 'continue' }));
    inputRef.current?.focus();
    addMessage({
      id: `ai-prompt-${Date.now()}`,
      role: 'ai',
      content: 'Please describe what happened when you tried the steps above, or share any specific error codes displayed on your machine.',
      timestamp: new Date().toISOString(),
    });
  }, [addMessage]);

  const handleBack = useCallback(() => {
    const dept = (user?.department || user?.profile?.department?.name || '').toLowerCase();
    const role = (user?.role || user?.profile?.role?.name || '').toLowerCase();
    const isCS = dept.includes('customer service') || dept.includes('customer support') || dept === 'cs' || role.includes('customer service') || role.includes('customer-service') || role === 'cs';
    const isEmployee = !isCS && (dept === 'service' || dept.includes('engineer') || role === 'employee' || role.includes('service') || role.includes('engineer'));

    if (isCS) navigate('/cs/dashboard');
    else if (isEmployee) navigate('/employee/dashboard');
    else navigate('/customer-dashboard');
  }, [navigate, user]);

  return (
    <div className="flex flex-col h-screen p-4 bg-page">
      <div className="flex flex-1 bg-card rounded-xl shadow-xs border border-border overflow-hidden min-h-0">
        {sidebarOpen && (
          <div className="w-[280px] lg:w-[300px] border-r border-border flex flex-col shrink-0 bg-slate-50/50">
            <div className="px-3 pt-6 pb-3 border-b border-border shrink-0 space-y-4">
              <button
                onClick={handleBack}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-muted hover:text-primary hover:bg-slate-100 rounded-lg transition-all cursor-pointer"
              >
                <ArrowLeft size={14} />
                Back to Dashboard
              </button>
              <button
                onClick={handleNewChat}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-card border border-border hover:border-primary hover:text-primary text-slate-dark rounded-lg text-xs font-semibold transition-all shadow-xs cursor-pointer"
              >
                <Plus size={14} />
                New Chat
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-2">
              {conversations.map((conv) => (                <div
                  key={conv.id}
                  onClick={() => loadConversation(conv.id)}
                  className={`group w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-all border-l-2 cursor-pointer ${
                    activeConversationId === conv.id
                      ? 'bg-primary/5 border-l-primary'
                      : 'border-l-transparent hover:bg-slate-100'
                  }`}
                >
                  <MessageSquare size={16} className="text-slate-muted mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs truncate ${activeConversationId === conv.id ? 'font-semibold text-primary' : 'font-medium text-slate-dark'}`}>
                      {conv.title}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] text-slate-muted">{formatShortTime(conv.timestamp || conv.updated_at || conv.created_at)}</span>
                      <span className="text-[10px] text-slate-300">·</span>
                      <span className="text-[10px] text-slate-muted">{conv.message_count !== undefined ? conv.message_count : (conv.messageCount || 0)} msgs</span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDeleteConversation(e, conv.id)}
                    className="p-1 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-slate-200 text-slate-muted hover:text-red-500 transition-all shrink-0 cursor-pointer"
                    title="Delete conversation"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>

            <div className="p-3 border-t border-border shrink-0">
              <div className="flex items-center gap-2.5 px-2 py-2">
                <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold shrink-0">
                  {(() => {
                    const name = user?.first_name || user?.name || 'User';
                    return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
                  })()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-dark truncate">
                    {user?.first_name ? `${user.first_name} ${user.last_name || ''}` : (user?.name || 'User')}
                  </p>
                  <p className="text-[10px] text-slate-muted truncate">{user?.email || ''}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-card shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-xs">
                <Bot size={20} className="text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="font-bold text-sm text-slate-dark">AI Support Assistant</h1>
                  <span className="bg-accent/10 border border-accent/20 text-primary text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                    Automated System
                  </span>
                </div>
                <p className="text-[11px] text-slate-muted">
                  Not a live human agent · AI searches technical manuals & knowledge base
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {messages.length > 2 && (
                <button
                  onClick={handleClearChat}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-slate-muted hover:text-red-600 hover:bg-red-50 rounded-lg transition-all border border-border hover:border-red-200 cursor-pointer"
                  title="Clear all messages in this conversation"
                >
                  <Trash2 size={13} />
                  <span>Clear Chat</span>
                </button>
              )}
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Online
              </span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 bg-page">
            {messages.map((msg, msgIndex) => {
              const isDeletable = msg.id !== 'welcome' && msg.id !== 'gather';
              const isErrorMessage = msg.isError || (typeof msg.content === 'string' && msg.content.startsWith('Ticket Submission Error:'));
              const displayErrorText = msg.isError
                ? (typeof msg.content === 'string' ? msg.content : msg.errorMessage)
                : (typeof msg.content === 'string' && msg.content.startsWith('Ticket Submission Error:')
                    ? msg.content.replace(/^Ticket Submission Error:\s*/, '')
                    : msg.content);
              const messageKey = msg.id || msg._id || `msg-${msgIndex}-${msg.timestamp || ''}`;

              return (
                <div key={messageKey} className={`group/msg flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className="max-w-[75%] flex flex-col">
                    <div className="flex items-start gap-3">
                      {(msg.role === 'ai' || msg.role === 'assistant') && (
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1 ${isErrorMessage ? 'bg-red-600' : 'bg-primary'}`}>
                          {isErrorMessage ? <AlertTriangle size={16} className="text-white" /> : <Bot size={16} className="text-white" />}
                        </div>
                      )}
                      <div>
                        {msg.role === 'ai' && !isErrorMessage && (
                          <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-bold text-[#252578]">
                            <Bot size={13} />
                            <span>AI Assistant (Automated)</span>
                          </div>
                        )}
                        {isErrorMessage ? (
                          <div className="bg-red-50 border border-red-200 rounded-2xl rounded-bl-md shadow-xs p-4 text-left">
                            <div className="flex items-start gap-3">
                              <AlertTriangle size={20} className="text-red-600 shrink-0 mt-0.5" />
                              <div className="flex-1">
                                <p className="text-sm font-bold text-red-800">
                                  {msg.errorTitle || 'Ticket Submission Error'}
                                </p>
                                <p className="text-xs text-red-700 mt-1.5 leading-relaxed font-medium">
                                  {displayErrorText}
                                </p>
                                <div className="flex flex-wrap gap-2 mt-3">
                                  <button
                                    onClick={() => navigate('/my-tickets')}
                                    className="px-3.5 py-1.5 bg-primary hover:bg-primary-hover text-white text-xs font-semibold rounded-xl transition-all cursor-pointer shadow-xs"
                                  >
                                    View My Tickets
                                  </button>
                                  {(msg.savedForm || reviewData) && (
                                    <button
                                      onClick={() => {
                                        if (msg.savedForm) setReviewData(msg.savedForm);
                                        setShowReviewModal(true);
                                      }}
                                      className="px-3.5 py-1.5 bg-card hover:bg-slate-50 border border-border text-slate-dark text-xs font-semibold rounded-xl transition-all cursor-pointer"
                                    >
                                      Edit & Retry
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className={msg.role === 'user'
                            ? 'px-4 py-2.5 bg-primary text-primary-foreground rounded-2xl rounded-br-md shadow-xs'
                            : 'bg-card text-slate-dark border border-border rounded-2xl rounded-bl-md shadow-xs px-4 py-3'
                          }>
                            {typeof msg.content === 'string' ? (
                              <FormattedText text={msg.content} />
                            ) : (
                              msg.content
                            )}

                            {/* "Did this help?" Interactive Feedback Prompt on substantive AI troubleshooting messages */}
                            {msg.role === 'ai' && !isErrorMessage && msg.id !== 'welcome' && msg.id !== 'gather-details' && (feedbackMap[msg.id] || isTroubleshootingResponse(msg.content)) && (
                              <div className="mt-3 pt-2.5 border-t border-gray-150 text-left">
                                {feedbackMap[msg.id] === 'resolved' ? (
                                  <div className="bg-green-50 border border-green-200 rounded-xl p-2.5 text-xs text-green-800 flex items-center gap-2">
                                    <CheckCircle size={15} className="text-green-600 shrink-0" />
                                    <span className="font-semibold">Thank you for confirming! Marked as resolved.</span>
                                  </div>
                                ) : feedbackMap[msg.id] === 'unresolved' ? (
                                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs space-y-2">
                                    <p className="font-semibold text-amber-900">Issue still unresolved. How would you like to proceed?</p>
                                    <div className="flex flex-wrap gap-2">
                                      <button
                                        type="button"
                                        onClick={() => handleContinueChattingFromPrompt(msg.id)}
                                        className="px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-semibold rounded-lg transition cursor-pointer text-xs"
                                      >
                                        Continue Troubleshooting
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setFeedbackMap(prev => ({ ...prev, [msg.id]: 'escalated' }));
                                          handleCreateTicket();
                                        }}
                                        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg transition cursor-pointer text-xs inline-flex items-center gap-1 shadow-xs"
                                      >
                                        <Plus size={13} />
                                        Create a Support Ticket
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex flex-wrap items-center justify-between gap-2 py-1 text-xs">
                                    <span className="text-gray-500 font-medium text-[11px]">Did this help resolve your concern?</span>
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => handleFeedbackResolved(msg.id)}
                                        className="px-2.5 py-1 bg-white hover:bg-green-50 text-gray-700 hover:text-green-800 border border-gray-200 hover:border-green-300 rounded-lg text-xs font-semibold transition cursor-pointer inline-flex items-center gap-1"
                                      >
                                        <CheckCircle size={12} className="text-green-600" />
                                        Yes
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleFeedbackUnresolved(msg.id)}
                                        className="px-2.5 py-1 bg-white hover:bg-amber-50 text-gray-700 hover:text-amber-800 border border-gray-200 hover:border-amber-300 rounded-lg text-xs font-semibold transition cursor-pointer inline-flex items-center gap-1"
                                      >
                                        <AlertTriangle size={12} className="text-amber-600" />
                                        No, need help
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        {msg.role === 'ai' && !isErrorMessage && msg.sources && msg.sources.length > 0 && (
                          <AISourceList sources={msg.sources} />
                        )}
                        <div className={`flex items-center gap-2 mt-1 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <p className="text-[10px] text-slate-muted">
                            {formatTime(msg.timestamp)}
                          </p>
                          {isDeletable && (
                            <button
                              onClick={() => handleDeleteMessage(msg.id)}
                              className="opacity-0 group-hover/msg:opacity-100 p-0.5 rounded text-slate-muted hover:text-destructive hover:bg-muted transition-all cursor-pointer"
                              title="Delete this message"
                            >
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {showSuggestionChips && messages.length === 1 && (
              <div className="flex justify-start pl-11">
                <div className="flex flex-wrap gap-2">
                  {suggestionChips.map((chip) => (
                    <button
                      key={chip}
                      onClick={() => handleSuggestionClick(chip)}
                      className="px-3 py-1.5 bg-card border border-border rounded-full text-xs font-medium text-slate-muted hover:border-accent hover:text-accent hover:bg-accent/5 transition-all cursor-pointer"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isTyping && <TypingIndicator />}

            {showTicketCard && (
              <TicketRecommendationCard
                onCreateTicket={handleCreateTicket}
                onContinue={handleContinueChatting}
              />
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className="px-6 py-3 border-t border-border bg-card shrink-0">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="p-2 rounded-xl text-slate-muted hover:text-slate-dark hover:bg-slate-100 transition-all shrink-0 cursor-pointer"
                title="Attach file"
              >
                <Paperclip size={18} />
              </button>
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm outline-none transition-all focus:border-accent focus:ring-2 focus:ring-accent/20 resize-none min-h-[42px] max-h-[120px] overflow-y-auto"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isTyping}
                className="bg-primary text-primary-foreground rounded-xl px-4 py-2.5 transition-all hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed shrink-0 cursor-pointer"
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <TicketReviewModal
        isOpen={showReviewModal}
        data={reviewData}
        machines={ticketOptions?.machines || []}
        onClose={() => setShowReviewModal(false)}
        onSubmit={handleSubmitTicket}
        onSaveDraft={handleSaveTicketDraft}
      />

      <SuccessDialog
        isOpen={showSuccess}
        ticketNumber={ticketNumber}
        onViewTicket={handleViewTicket}
        onClose={handleCloseSuccess}
      />

      <SubmissionErrorDialog
        isOpen={submissionError.isOpen}
        title={submissionError.title}
        message={submissionError.message}
        onViewTickets={() => {
          setSubmissionError(prev => ({ ...prev, isOpen: false }));
          navigate('/my-tickets');
        }}
        onClose={() => setSubmissionError(prev => ({ ...prev, isOpen: false }))}
      />

      <DuplicateTicketModal
        isOpen={duplicateModal.isOpen}
        machineName={duplicateModal.machineName}
        ticketNo={duplicateModal.ticketNo}
        ticketStatus={duplicateModal.ticketStatus}
        onClose={() => setDuplicateModal(prev => ({ ...prev, isOpen: false }))}
        onSelectDifferentMachine={() => {
          setDuplicateModal(prev => ({ ...prev, isOpen: false }));
          setReviewData(prev => ({ ...prev, machineModel: '', machine_ID: null }));
          setShowReviewModal(true);
        }}
        onViewTicket={() => {
          setDuplicateModal(prev => ({ ...prev, isOpen: false }));
          const targetId = duplicateModal.existingTicket?.ticket_ID || duplicateModal.ticketNo;
          navigate('/messages', { state: { selectedTicketId: targetId } });
        }}
      />
    </div>
  );
}

export default AISupportPage;
