import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import {
  Book, Search, Filter, ChevronDown, X, Upload, FileText, Download,
  Trash2, Edit3, Eye, RefreshCw, Plus, FolderOpen, CheckCircle,
  AlertTriangle, Loader, File, FileSpreadsheet, Archive, ArrowUpDown,
  Info, History, Globe, MoreVertical, Copy, Check, AlertCircle, Wrench,
} from 'lucide-react';
import axios from 'axios';
import axiosInstance from '@/api/axiosInstance';
import { AI_API_URL, KB_API_URL } from '@/config/api.config';
import tokenStore from '@/auth/tokenStore';
import echo from '@/services/echo';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

const aiKbClient = axios.create({
  baseURL: AI_API_URL,
  withCredentials: true,
  headers: {
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': 'application/json',
  },
});

aiKbClient.interceptors.request.use((config) => {
  const token = tokenStore.getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

function formatTimestamp(ts) {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

const MOCK_CATEGORIES = [
  'User Manuals', 'Troubleshooting Guides', 'FAQs',
  'Product Specifications', 'Maintenance Guides', 'Installation Guides', 'Warranty Documents',
];

const MOCK_STATUSES = ['Draft', 'Published', 'Archived', 'Processing'];
const MOCK_PUBLISH_STATES = ['Draft', 'Published', 'Archived'];

const MOCK_MACHINES = ['Canon X120', 'Canon X220', 'Epson L3110', 'HP LaserJet Pro', 'Brother MFC', 'No Machine'];

const MOCK_DOCUMENTS = [
  {
    id: 1,
    title: 'Canon X120 User Manual',
    category: 'User Manuals',
    machine: 'Canon X120',
    version: '2.1',
    fileType: 'PDF',
    uploadedBy: 'Admin',
    uploadDate: '2026-06-15',
    size: '4.2 MB',
    status: 'Ready',
    publishState: 'Published',
    processingStatus: 'Ready for AI Search',
    tags: ['manual', 'canon'],
    description: 'Official user manual for Canon X120 printer.',
    history: [
      { id: 101, type: 'created', timestamp: '2026-06-15 09:30', actor: 'Admin' },
      { id: 1011, type: 'published', timestamp: '2026-06-15 10:00', actor: 'Super Admin' },
    ],
  },
  {
    id: 2,
    title: 'Troubleshooting Guide v2.1',
    category: 'Troubleshooting Guides',
    machine: 'No Machine',
    version: '2.1',
    fileType: 'PDF',
    uploadedBy: 'Admin',
    uploadDate: '2026-06-14',
    size: '1.8 MB',
    status: 'Ready',
    publishState: 'Published',
    processingStatus: 'Ready for AI Search',
    tags: ['troubleshooting'],
    description: 'General troubleshooting guide for common issues.',
    history: [
      { id: 102, type: 'created', timestamp: '2026-06-14 14:15', actor: 'Admin' },
      { id: 1021, type: 'published', timestamp: '2026-06-14 15:00', actor: 'Super Admin' },
    ],
  },
  {
    id: 3,
    title: 'Common FAQs 2026',
    category: 'FAQs',
    machine: 'No Machine',
    version: '1.0',
    fileType: 'DOCX',
    uploadedBy: 'Admin',
    uploadDate: '2026-06-13',
    size: '0.9 MB',
    status: 'Draft',
    publishState: 'Draft',
    processingStatus: 'Ready for AI Search',
    tags: ['faq'],
    description: 'Frequently asked questions compilation.',
    history: [
      { id: 103, type: 'created', timestamp: '2026-06-13 11:00', actor: 'Admin' },
    ],
  },
  {
    id: 4,
    title: 'Product Spec Sheet',
    category: 'Product Specifications',
    machine: 'Epson L3110',
    version: '3.0',
    fileType: 'PDF',
    uploadedBy: 'Admin',
    uploadDate: '2026-06-12',
    size: '2.1 MB',
    status: 'Draft',
    publishState: 'Draft',
    processingStatus: 'Ready for AI Search',
    tags: ['specs'],
    description: 'Product specifications for Epson L3110.',
    history: [
      { id: 104, type: 'created', timestamp: '2026-06-12 16:45', actor: 'Admin' },
    ],
  },
  {
    id: 5,
    title: 'Maintenance Schedule',
    category: 'Maintenance Guides',
    machine: 'Canon X220',
    version: '1.2',
    fileType: 'DOCX',
    uploadedBy: 'Admin',
    uploadDate: '2026-06-11',
    size: '1.2 MB',
    status: 'Archived',
    publishState: 'Archived',
    processingStatus: 'Ready for AI Search',
    tags: ['maintenance'],
    description: 'Maintenance schedule and procedures.',
    history: [
      { id: 105, type: 'created', timestamp: '2026-06-11 10:20', actor: 'Admin' },
      { id: 1051, type: 'archived', timestamp: '2026-06-11 16:00', actor: 'Super Admin' },
    ],
  },
];

const UPLOAD_STEPS = [
  'Scanning for Malware with ClamAV',
  'Uploading Document File',
  'Extracting Text Content',
  'Chunking Document Sections',
  'Generating Gemini Vector Embeddings',
  'Indexing Knowledge Base',
  'Ready for AI Search',
];

const MANUAL_CREATE_STEPS = [
  'Validating Content & Metadata',
  'Chunking Content into Semantic Sections',
  'Generating Gemini Vector Embeddings',
  'Indexing Knowledge Base for AI Search',
  'Ready for AI Search',
];

const CSV_STEPS = [
  'Scanning Spreadsheet with ClamAV',
  'Uploading CSV File',
  'Parsing SOP Rows and Continuation Steps',
  'Chunking Extracted SOP Sections',
  'Generating Gemini Vector Embeddings',
  'Indexing Knowledge Base',
  'Ready for AI Search',
];

const AI_PROCESSING_STEPS = [
  { label: 'Upload Successful', done: true },
  { label: 'Text Extracted', done: true },
  { label: 'Document Chunked', done: true },
  { label: 'Embeddings Generated', done: false },
  { label: 'Indexed into Knowledge Base', done: false },
  { label: 'Ready for AI Search', done: false },
];

const statusColors = {
  Ready: 'bg-green-50 text-green-700 border-green-200',
  Published: 'bg-green-50 text-green-700 border-green-200',
  Draft: 'bg-amber-50 text-amber-700 border-amber-200',
  Processing: 'bg-blue-50 text-blue-700 border-blue-200',
  Failed: 'bg-red-50 text-red-700 border-red-200',
  Archived: 'bg-gray-100 text-gray-700 border-gray-200',
};

const statusIcons = {
  Ready: CheckCircle,
  Published: CheckCircle,
  Draft: FileText,
  Processing: Loader,
  Failed: AlertTriangle,
  Archived: Archive,
};

const publishStateColors = {
  Published: 'bg-green-50 text-green-700 border-green-200',
  Draft: 'bg-amber-50 text-amber-700 border-amber-200',
  Archived: 'bg-gray-100 text-gray-700 border-gray-200',
};

const publishStateIcons = {
  Published: CheckCircle,
  Draft: FileText,
  Archived: Archive,
};

const processingColors = {
  'Ready for AI Search': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Ready': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Processing': 'bg-blue-50 text-blue-700 border-blue-200',
  'Indexing': 'bg-blue-50 text-blue-700 border-blue-200',
  'Failed': 'bg-red-50 text-red-700 border-red-200',
  'Indexing failed': 'bg-red-50 text-red-700 border-red-200',
};

// Spec 0036: indexing states reported by the AI service.
const isIndexingInProgress = (doc) =>
  doc?.processingStatus === 'Processing' || doc?.processingStatus === 'Indexing' || doc?.status === 'Processing';
const isIndexingFailed = (doc) =>
  ['Failed', 'Indexing failed', 'Indexing Failed'].includes(doc?.processingStatus);
const isPublishedDoc = (doc) =>
  (doc?.publishState || doc?.status) === 'Published' || doc?.status === 'Ready';
const formatProbeScore = (score) =>
  (typeof score === 'number' && !Number.isNaN(score) ? score.toFixed(2) : 'n/a');

// Spec 0036 fields from the AI service article payload.
const indexingFields = (item) => ({
  indexError: item?.index_error ?? null,
  probeScore: item?.probe_score ?? null,
  lowRetrievability: Boolean(item?.low_retrievability),
});

// The AI service stores times in UTC. History timestamps come without a zone ("Y-m-d H:i:s"),
// so they are read as UTC; a bare date (old mock data) is read as local midnight.
const parseServerDate = (value) => {
  if (!value) return null;
  const s = String(value).trim();
  let d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) d = new Date(`${s}T00:00:00`);
  else if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) d = new Date(s);
  else d = new Date(`${s.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

// Upload date is when the current file was uploaded: the latest replacement, else creation.
const fileUploadedAt = (item) => {
  const latestReplacement = (Array.isArray(item?.history) ? item.history : []).find((h) => h?.type === 'file_replacement');
  return parseServerDate(latestReplacement?.timestamp)?.toISOString() || item?.created_at || null;
};

const formatUploadDate = (value) => {
  const d = parseServerDate(value);
  return d
    ? d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—';
};

const fileTypeIcons = {
  PDF: FileText,
  DOCX: FileSpreadsheet,
  DOC: FileSpreadsheet,
  TXT: File,
  CSV: FileSpreadsheet,
  ARTICLE: Book,
  MANUAL: Book,
};

function StatCard({ icon: Icon, label, value, sub, bgClass }) {
  return (
    <div className="bg-card rounded-xl border border-border shadow-xs p-4 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 ${bgClass || 'bg-primary/10 text-primary'}`}>
        <Icon size={20} />
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-dark">{value}</p>
        <p className="text-xs text-slate-muted">{label}</p>
        {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function EmptyState({ onUpload, onCreate, title, description }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-3">
        <FolderOpen size={30} className="text-slate-300" />
      </div>
      <h3 className="text-sm font-bold text-dark-slate mb-1">
        {title || "No knowledge documents have been uploaded yet."}
      </h3>
      <p className="text-xs text-muted-slate mb-5 max-w-sm">
        {description || "Create articles directly or upload PDF, DOCX, and CSV files to build your AI knowledge base."}
      </p>
      <div className="flex items-center gap-2">
        <Button
          onClick={onCreate}
          size="sm"
          className="gap-2 text-xs bg-[#252578] hover:bg-[#1f1f66] text-white"
        >
          <Plus size={14} />
          Create Article
        </Button>
        <Button
          onClick={onUpload}
          variant="outline"
          size="sm"
          className="gap-2 text-xs"
        >
          <Upload size={14} />
          Upload Document
        </Button>
      </div>
    </div>
  );
}

function ArchiveConfirmModal({ isOpen, onClose, onConfirm, doc }) {
  if (!isOpen || !doc) return null;
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px]">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
              <Archive size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Archive Knowledge Article</h2>
              <p className="text-xs text-gray-500">Deactivate from active chatbot knowledge</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Target Document Details */}
        <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-xs space-y-1">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block">Target Article</span>
          <p className="font-semibold text-gray-900 text-sm truncate" title={doc.title}>
            {doc.title}
          </p>
          <p className="text-[11px] text-gray-500">
            {doc.category} · {doc.fileType} · Version {doc.version || '1.0'}
          </p>
        </div>

        {/* Archiving Description Notice */}
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3.5 text-xs text-amber-800 space-y-1.5 leading-relaxed">
          <div className="flex items-center gap-1.5 font-bold text-amber-900">
            <AlertTriangle size={14} className="text-amber-600 flex-shrink-0" />
            <span>Chatbot Deactivation</span>
          </div>
          <p>
            Archiving will remove this article from the chatbot's active knowledge. The article record and file will remain intact and can be re-published later.
          </p>
        </div>

        {/* Reversibility Tooltip */}
        <div className="flex items-center justify-between text-xs bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-gray-700 font-medium">
            <span>Is this permanent?</span>
            <div className="relative group inline-flex items-center">
              <Info size={14} className="text-[#252578] hover:text-[#1f1f66] transition-colors cursor-pointer" />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-50 w-64 p-2.5 bg-gray-900 text-white text-[11px] rounded-lg shadow-lg pointer-events-none text-left leading-normal font-normal">
                Archiving is reversible — you can re-publish this article anytime. This is different from permanent deletion, which cannot be undone.
                <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900" />
              </div>
            </div>
          </div>
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Reversible Action</span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-100 transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 transition-all cursor-pointer shadow-sm"
          >
            Confirm Archive
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({ isOpen, onClose, onConfirm, doc, title, isDeleting = false, errorMessage = '' }) {
  const [confirmText, setConfirmText] = useState('');
  const targetTitle = doc?.title || title || '';

  useEffect(() => {
    if (isOpen) {
      setConfirmText('');
    }
  }, [isOpen, doc, title]);

  if (!isOpen) return null;

  const isMatch = Boolean(
    targetTitle && (
      confirmText === targetTitle ||
      confirmText === 'DELETE'
    )
  );

  const handleClose = () => {
    if (isDeleting) return;
    setConfirmText('');
    onClose();
  };

  const handleConfirm = () => {
    if (!isMatch || isDeleting) return;
    onConfirm();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px]">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-100 text-red-600">
              <Trash2 size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Delete Knowledge Article</h2>
              <p className="text-xs text-gray-500">Super Admin verification required</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={isDeleting}
            className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 cursor-pointer disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        {/* Server Error Alert if blocked */}
        {errorMessage && (
          <div className="rounded-xl bg-red-50 border border-red-300 p-3 text-xs text-red-900 flex items-start gap-2">
            <AlertTriangle size={15} className="text-red-600 flex-shrink-0 mt-0.5" />
            <span className="font-semibold">{errorMessage}</span>
          </div>
        )}

        {/* Permanent Warning */}
        <div className="rounded-xl bg-red-50 border border-red-200 p-3.5 text-xs text-red-800 space-y-1">
          <div className="flex items-center gap-1.5 font-bold text-red-900">
            <AlertTriangle size={14} className="text-red-600 flex-shrink-0" />
            <span>Permanent & Irreversible</span>
          </div>
          <p className="text-red-700 leading-relaxed">
            This action is permanent and cannot be undone. The article record, its file, and its embeddings will be completely removed from the system.
          </p>
        </div>

        {/* Target Document Summary */}
        <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Target Article</span>
            {doc?.category && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-200/70 text-gray-700">
                {doc.category}
              </span>
            )}
          </div>
          <p className="font-semibold text-gray-900 text-sm truncate" title={targetTitle}>
            {targetTitle}
          </p>
          {doc && (
            <p className="text-[11px] text-gray-500">
              {doc.fileType} · {doc.size} · Version {doc.version || '1.0'}
            </p>
          )}
        </div>

        {/* Delete vs Archive Tooltip Notice */}
        <div className="flex items-center justify-between text-xs bg-amber-50/70 border border-amber-200/70 rounded-xl px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-amber-900 font-medium">
            <span>Need to hide this temporarily?</span>
            <div className="relative group inline-flex items-center">
              <Info size={14} className="text-amber-600 hover:text-amber-800 transition-colors cursor-pointer" />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-50 w-64 p-2.5 bg-gray-900 text-white text-[11px] rounded-lg shadow-lg pointer-events-none text-left leading-normal font-normal">
                Delete permanently removes this article forever. Archive only hides it from the chatbot while keeping the file and record intact for later re-publishing.
                <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900" />
              </div>
            </div>
          </div>
          <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Delete vs Archive</span>
        </div>

        {/* Type to Confirm Input */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-gray-700">
            To confirm, type <span className="font-mono font-bold text-red-600 select-all">"{targetTitle}"</span> or <span className="font-mono font-bold text-red-600">DELETE</span> below:
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={isDeleting}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && isMatch && !isDeleting) {
                handleConfirm();
              }
            }}
            placeholder={`Type "${targetTitle}" or "DELETE"`}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-200 font-mono transition-all disabled:bg-gray-100"
            autoFocus
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={handleClose}
            disabled={isDeleting}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-100 transition-all cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!isMatch || isDeleting}
            className={`px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all flex items-center gap-2 ${isMatch && !isDeleting
                ? 'bg-red-600 hover:bg-red-700 cursor-pointer shadow-sm'
                : 'bg-red-300 cursor-not-allowed opacity-60'
              }`}
          >
            {isDeleting && <Loader size={14} className="animate-spin" />}
            {isDeleting ? 'Deleting...' : 'Delete Article'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DiscardConfirmModal({ isOpen, onClose, onConfirm, title, description }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px]">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
          <AlertTriangle size={24} className="text-amber-600" />
        </div>
        <h2 className="mt-4 text-lg font-bold text-gray-900 text-center">{title || 'Discard Unsaved Changes?'}</h2>
        <p className="mt-2 text-sm text-gray-600 text-center">
          {description || 'You have unsaved knowledge article information. Are you sure you want to discard your changes?'}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-100 transition-all cursor-pointer"
          >
            Keep Editing
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 transition-all cursor-pointer"
          >
            Discard Changes
          </button>
        </div>
      </div>
    </div>
  );
}

function PipelineProgressView({
  selectedFile,
  displayTitle,
  displaySub,
  progress,
  currentStepIdx,
  uploadError,
  successTitle = 'Knowledge Article Created Successfully!',
  successMessage = 'Status set to Draft. It will be indexed and ready for AI search, but hidden from the chatbot until published.',
  steps = UPLOAD_STEPS,
}) {
  const totalSize = selectedFile ? (selectedFile.size / 1024 / 1024).toFixed(1) : 0;
  return (
    <div className="space-y-4">
      {selectedFile ? (
        <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
          <FileText size={24} className="text-[#252578] shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-700 truncate">{selectedFile.name}</p>
            <p className="text-xs text-gray-400">{totalSize} MB · {selectedFile.name.split('.').pop()?.toUpperCase()}</p>
          </div>
          <span className="text-xs font-semibold text-[#252578]">{Math.round(progress)}%</span>
        </div>
      ) : displayTitle ? (
        <div className="flex items-center gap-3 p-3 bg-[#252578]/5 rounded-lg border border-[#252578]/20">
          <Book size={24} className="text-[#252578] shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{displayTitle}</p>
            <p className="text-xs text-gray-500">{displaySub || 'Direct Article (Structured Markdown)'}</p>
          </div>
          <span className="text-xs font-semibold text-[#252578]">{Math.round(progress)}%</span>
        </div>
      ) : null}

      <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
        <div
          className={`h-2 rounded-full transition-all duration-300 ${uploadError ? 'bg-red-500' : 'bg-[#252578]'}`}
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="space-y-2">
        {steps.map((s, i) => {
          const isAllDone = progress >= 100 && !uploadError;
          const isCurrent = !isAllDone && i === currentStepIdx;
          const isPast = isAllDone || i < currentStepIdx;
          const isFailedStep = !isAllDone && i === currentStepIdx && uploadError;

          return (
            <div
              key={i}
              className={`flex items-center gap-2.5 text-sm ${isFailedStep
                  ? 'text-red-600 font-semibold'
                  : isPast
                    ? 'text-green-600'
                    : isCurrent
                      ? 'text-[#252578] font-semibold'
                      : 'text-gray-300'
                }`}
            >
              {isFailedStep ? (
                <AlertTriangle size={16} className="text-red-600 shrink-0" />
              ) : isPast ? (
                <CheckCircle size={16} className="text-green-600 shrink-0" />
              ) : isCurrent ? (
                <Loader size={16} className="animate-spin text-[#252578] shrink-0" />
              ) : (
                <div className="w-4 h-4 rounded-full border-2 border-gray-300 shrink-0" />
              )}
              <span>{s}</span>
            </div>
          );
        })}
      </div>

      {progress >= 100 && !uploadError && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-xs text-green-800 space-y-1">
          <p className="font-semibold flex items-center gap-1.5">
            <CheckCircle size={14} className="text-green-600" />
            {successTitle}
          </p>
          <p className="text-green-700">
            {successMessage}
          </p>
        </div>
      )}
    </div>
  );
}

function ReplaceConfirmModal({ isOpen, doc, onClose, onReplaceComplete, onProcessingStatusChange }) {
  const [step, setStep] = useState('form');
  const [selectedFile, setSelectedFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [errors, setErrors] = useState({});
  const [progress, setProgress] = useState(0);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [isMalwareError, setIsMalwareError] = useState(false);
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const fileInputRef = useRef(null);

  const reset = () => {
    setStep('form');
    setSelectedFile(null);
    setDragOver(false);
    setErrors({});
    setProgress(0);
    setCurrentStepIdx(0);
    setUploadError('');
    setIsMalwareError(false);
    setShowDiscardModal(false);
  };

  useEffect(() => {
    if (isOpen) {
      reset();
    }
  }, [isOpen, doc]);

  if (!isOpen || !doc) return null;

  const handleAttemptClose = () => {
    if (step === 'processing') {
      if (progress >= 100 || uploadError) {
        handleForceClose();
      } else {
        setShowDiscardModal(true);
      }
      return;
    }

    if (selectedFile) {
      setShowDiscardModal(true);
      return;
    }

    handleForceClose();
  };

  const handleForceClose = () => {
    setShowDiscardModal(false);
    if (step === 'processing' && progress < 100 && onProcessingStatusChange) {
      onProcessingStatusChange(doc.id, 'Ready for AI Search');
    }
    reset();
    onClose();
  };

  const handleFileValidateAndSet = (file) => {
    if (!file) return;

    // Check extension: PDF, DOCX, DOC, CSV, TXT supported
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['pdf', 'docx', 'doc', 'csv', 'txt'].includes(ext)) {
      setErrors((prev) => ({
        ...prev,
        file: 'Invalid file type. Supported formats: PDF, DOCX, DOC, CSV, TXT.',
      }));
      setSelectedFile(null);
      return;
    }

    // Check byte size: 10 MB limit (10 * 1024 * 1024 = 10,485,760 bytes)
    if (file.size > 10 * 1024 * 1024) {
      setErrors((prev) => ({
        ...prev,
        file: 'File size exceeds maximum limit of 10 MB.',
      }));
      setSelectedFile(null);
      return;
    }

    setErrors((prev) => ({ ...prev, file: '' }));
    setSelectedFile(file);
  };

  const handleFileDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (file) handleFileValidateAndSet(file);
  };

  const startReplacementPipeline = async () => {
    if (!selectedFile) {
      setErrors({ file: 'Please upload a replacement PDF, DOCX, CSV, or TXT file.' });
      return;
    }

    setStep('processing');
    setProgress(0);
    setCurrentStepIdx(0);
    setUploadError('');
    setIsMalwareError(false);

    if (onProcessingStatusChange) {
      onProcessingStatusChange(doc.id, 'Processing');
    }

    const formData = new FormData();
    formData.append('file', selectedFile);

    // Step 0: Scanning for Malware with ClamAV
    setCurrentStepIdx(0);
    setProgress(15);

    try {
      const scanRes = await axiosInstance.post(`${AI_API_URL}/articles/scan-file`, formData, {
        baseURL: '',
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (!scanRes.data?.success) {
        throw new Error(scanRes.data?.threat || 'Malware detected');
      }
    } catch (err) {
      if (err.response?.status === 422 && err.response?.data?.error_code === 'MALWARE_DETECTED') {
        const threat = err.response.data?.threat || 'Malware.Detected';
        setUploadError(`Security Alert: Replacement file failed ClamAV antivirus inspection (${threat}). Upload rejected.`);
        setIsMalwareError(true);
        if (onProcessingStatusChange) {
          onProcessingStatusChange(doc.id, 'Ready for AI Search');
        }
        return;
      }
      console.warn('ClamAV scan verification notice:', err);
    }

    // Step 1: Uploading Document
    setCurrentStepIdx(1);
    setProgress(30);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Step 2: Upload Complete
    setCurrentStepIdx(2);
    setProgress(45);
    await new Promise((resolve) => setTimeout(resolve, 250));

    // Step 3: Extracting Text
    setCurrentStepIdx(3);
    setProgress(60);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Step 4: Chunking Document
    setCurrentStepIdx(4);
    setProgress(75);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Step 5: Generating Embeddings
    setCurrentStepIdx(5);
    setProgress(85);

    // Step 6: Indexing Knowledge Base & Saving to Backend
    setCurrentStepIdx(6);
    setProgress(95);

    let replacedArticle = null;
    try {
      const replaceRes = await axiosInstance.post(`${AI_API_URL}/articles/${doc.id}/replace-file`, formData, {
        baseURL: '',
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (replaceRes.data?.success && replaceRes.data?.data) {
        replacedArticle = replaceRes.data.data;
      }
    } catch (err) {
      console.error('Failed to replace article file on backend:', err);
      const errMsg = err.response?.data?.message || err.message || 'File replacement failed.';
      setUploadError(errMsg);
      if (err.response?.data?.error_code === 'MALWARE_DETECTED') {
        setIsMalwareError(true);
      }
      if (onProcessingStatusChange) {
        onProcessingStatusChange(doc.id, 'Ready for AI Search');
      }
      return;
    }

    // Step 7: Ready for AI Search
    setCurrentStepIdx(7);
    setProgress(100);

    if (onReplaceComplete) {
      onReplaceComplete(doc.id, replacedArticle || selectedFile);
    }

    setTimeout(() => {
      handleForceClose();
    }, 1200);
  };

  const newFileSizeMb = selectedFile ? (selectedFile.size / (1024 * 1024)).toFixed(1) : 0;

  return (
    <>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px]">
        <div className="w-full max-w-xl rounded-xl bg-white shadow-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-amber-50 text-amber-600 border border-amber-200">
                <RefreshCw size={18} />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">Replace Article Document</h2>
                <p className="text-xs text-gray-500 truncate max-w-[360px]">{doc.title}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleAttemptClose}
              className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>

          <div className="overflow-y-auto px-6 py-4 space-y-4 flex-1">
            {step === 'form' ? (
              <>
                {/* Target Document Card */}
                <div className="rounded-xl bg-gray-50 border border-gray-100 p-3.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Target Article</span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusColors[doc.status] || 'bg-gray-100 text-gray-700'}`}>
                      {doc.status}
                    </span>
                  </div>
                  <p className="font-semibold text-gray-800 text-sm">{doc.title}</p>
                  <div className="grid grid-cols-3 gap-2 pt-1 text-[11px] text-gray-500 border-t border-gray-200/50">
                    <div>
                      <span className="text-gray-400 block text-[9px] uppercase">Category</span>
                      <span className="font-medium text-gray-700 truncate block">{doc.category}</span>
                    </div>
                    <div>
                      <span className="text-gray-400 block text-[9px] uppercase">Machine</span>
                      <span className="font-medium text-gray-700 truncate block">{doc.machine}</span>
                    </div>
                    <div>
                      <span className="text-gray-400 block text-[9px] uppercase">Current File</span>
                      <span className="font-medium text-gray-700 truncate block">{doc.fileType} · {doc.size}</span>
                    </div>
                  </div>
                </div>

                {/* Upload Zone */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Upload Replacement File <span className="text-red-500">*</span>
                  </label>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleFileDrop}
                    onClick={() => {
                      if (!selectedFile) {
                        fileInputRef.current?.click();
                      }
                    }}
                    className={`border-2 border-dashed rounded-xl p-5 text-center transition-all ${
                      !selectedFile ? 'cursor-pointer' : ''
                    } ${dragOver
                        ? 'border-[#252578] bg-[#252578]/5'
                        : errors.file
                          ? 'border-red-400 bg-red-50/30'
                          : selectedFile
                            ? 'border-green-400 bg-green-50/20'
                            : 'border-gray-200 hover:border-[#252578]/40 hover:bg-gray-50/50'
                      }`}
                  >
                    {selectedFile ? (
                      <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-green-200 shadow-xs" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2.5 min-w-0">
                          <FileText size={20} className="text-[#252578] shrink-0" />
                          <div className="text-left truncate">
                            <p className="text-xs font-semibold text-gray-800 truncate">{selectedFile.name}</p>
                            <p className="text-[10px] text-gray-400">{newFileSizeMb} MB · {selectedFile.name.split('.').pop()?.toUpperCase()}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedFile(null);
                            if (fileInputRef.current) fileInputRef.current.value = '';
                          }}
                          className="p-1 rounded-md hover:bg-gray-100 text-gray-400 hover:text-red-500 cursor-pointer"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <Upload size={24} className="mx-auto text-gray-400 mb-1.5" />
                        <p className="text-xs font-medium text-gray-700">Drag & drop new file here, or click to browse</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">Supports PDF, DOCX, DOC, CSV, and TXT up to 10 MB</p>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".pdf,.docx,.doc,.csv,.txt"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFileValidateAndSet(file);
                            e.target.value = '';
                          }}
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            fileInputRef.current?.click();
                          }}
                          className="mt-2.5 inline-block px-3 py-1.5 bg-[#252578] text-white text-xs font-semibold rounded-lg hover:bg-[#1f1f66] transition-all cursor-pointer shadow-xs"
                        >
                          Browse File
                        </button>
                      </>
                    )}
                  </div>
                  {errors.file && (
                    <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                      <AlertTriangle size={12} />
                      {errors.file}
                    </p>
                  )}
                </div>

                {/* Serving notice callout */}
                <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl text-xs text-amber-900 flex items-start gap-2.5">
                  <Info size={16} className="text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-[11px] leading-relaxed">
                    <strong>Seamless Serving Notice:</strong> The existing file content will continue to be served by the AI chatbot during re-indexing. Once the replacement pipeline completes, the new document will be indexed and activated.
                  </p>
                </div>
              </>
            ) : (
              <PipelineProgressView
                selectedFile={selectedFile}
                progress={progress}
                currentStepIdx={currentStepIdx}
                uploadError={uploadError}
                successTitle="File Replaced & Re-indexed Successfully!"
                successMessage="The replacement document has completed malware scanning, chunking, and vector indexing. New content is now active for AI search."
                steps={UPLOAD_STEPS}
              />
            )}
          </div>

          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
            {step === 'form' ? (
              <>
                <button
                  type="button"
                  onClick={handleAttemptClose}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-100 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={startReplacementPipeline}
                  disabled={!selectedFile}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 transition-all cursor-pointer shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Confirm & Replace
                </button>
              </>
            ) : (
              <>
                {uploadError && (
                  <button
                    type="button"
                    onClick={() => {
                      setStep('form');
                      setUploadError('');
                      setIsMalwareError(false);
                    }}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-700 transition-all cursor-pointer"
                  >
                    Back to File Selection
                  </button>
                )}
                {progress >= 100 && (
                  <button
                    type="button"
                    onClick={handleForceClose}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#252578] hover:bg-[#1f1f66] transition-all cursor-pointer shadow-sm"
                  >
                    Done
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <DiscardConfirmModal
        isOpen={showDiscardModal}
        onClose={() => setShowDiscardModal(false)}
        onConfirm={handleForceClose}
        title="Discard File Replacement?"
        description="Are you sure you want to cancel? Any selected replacement file will not be processed and the existing document will remain unchanged."
      />
    </>
  );
}

function CreateArticleConfirmModal({ isOpen, onClose, onConfirm, form, selectedFile, mode = 'manual' }) {
  if (!isOpen) return null;
  const isCsv = mode === 'bulk' || Boolean(selectedFile?.name?.toLowerCase()?.endsWith('.csv'));
  const isFile = mode === 'file' || Boolean(selectedFile && !isCsv);
  const isManual = mode === 'manual' || (!selectedFile && !isCsv);
  const fileSizeMb = selectedFile ? (selectedFile.size / (1024 * 1024)).toFixed(2) : '0';
  const wordCount = form.content ? form.content.trim().split(/\s+/).filter(Boolean).length : 0;
  const charCount = form.content?.length || 0;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px]">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#252578]/10 text-[#252578]">
          {isCsv ? (
            <FileSpreadsheet size={24} className="text-[#252578]" />
          ) : isFile ? (
            <FileText size={24} className="text-[#252578]" />
          ) : (
            <Book size={24} className="text-[#252578]" />
          )}
        </div>
        <h2 className="mt-4 text-lg font-bold text-gray-900 text-center">
          {isCsv
            ? 'Confirm Bulk CSV Knowledge Import'
            : isFile
              ? 'Confirm Knowledge Document Upload'
              : 'Confirm Knowledge Article Creation'}
        </h2>
        <p className="mt-2 text-sm text-gray-600 text-center">
          {isCsv
            ? 'Each valid row in this CSV will be parsed into an individual knowledge article, verified with ClamAV, and indexed.'
            : isFile
              ? 'Please review the document details before starting the antivirus and processing pipeline.'
              : 'Please review your article content and details before submitting for AI indexing.'}
        </p>

        <div className="mt-4 rounded-xl bg-gray-50 border border-gray-100 p-4 space-y-2.5 text-xs">
          {isCsv ? (
            <>
              <div className="flex justify-between items-center">
                <span className="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">Import Mode:</span>
                <span className="font-semibold text-[#252578]">Bulk CSV Import</span>
              </div>
              <div className="flex justify-between items-start gap-2">
                <span className="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">Spreadsheet:</span>
                <span className="font-medium text-gray-900 text-right truncate max-w-[240px]">
                  {selectedFile?.name} ({fileSizeMb} MB)
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">Antivirus Scan:</span>
                <span className="font-semibold text-emerald-700">ClamAV Daemon Enabled</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">Fields Mapping:</span>
                <span className="font-medium text-gray-700">Read from CSV columns</span>
              </div>
            </>
          ) : isFile ? (
            <>
              <div className="flex justify-between items-start gap-2">
                <span className="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">Title:</span>
                <span className="font-medium text-gray-900 text-right truncate max-w-[240px]">{form.title}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">Category:</span>
                <span className="font-medium text-gray-900">{form.category}</span>
              </div>
              <div className="flex justify-between items-start gap-2">
                <span className="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">File:</span>
                <span className="font-medium text-gray-900 text-right truncate max-w-[240px]">
                  {selectedFile?.name} ({fileSizeMb} MB)
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">Antivirus Scan:</span>
                <span className="font-semibold text-emerald-700">ClamAV Daemon Enabled</span>
              </div>
              {form.machine && (
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">Machine:</span>
                  <span className="font-medium text-gray-900">{form.machine}</span>
                </div>
              )}
              {form.version && (
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">Version:</span>
                  <span className="font-medium text-gray-900">{form.version}</span>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex justify-between items-start gap-2">
                <span className="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">Title:</span>
                <span className="font-medium text-gray-900 text-right truncate max-w-[240px]">{form.title}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">Category:</span>
                <span className="font-medium text-gray-900">{form.category}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">Authoring Mode:</span>
                <span className="font-semibold text-[#252578]">Direct Article (Markdown / Text)</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">Content Size:</span>
                <span className="font-medium text-gray-800">{wordCount} words ({charCount} chars)</span>
              </div>
              {form.machine && (
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">Machine:</span>
                  <span className="font-medium text-gray-900">{form.machine}</span>
                </div>
              )}
              {form.version && (
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">Version:</span>
                  <span className="font-medium text-gray-900">{form.version}</span>
                </div>
              )}
            </>
          )}
          <div className="pt-2 border-t border-gray-200/70 flex justify-between items-center text-[11px]">
            <span className="font-semibold text-amber-800">Initial State:</span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
              Draft
            </span>
          </div>
        </div>

        <p className="mt-2 text-[11px] text-gray-400 text-center">
          Note: Articles are created in Draft status and will not be accessible to the AI chatbot until published.
        </p>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-100 transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#252578] hover:bg-[#1f1f66] transition-all cursor-pointer"
          >
            {isCsv ? 'Confirm & Import CSV' : isFile ? 'Confirm & Upload' : 'Confirm & Create Article'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CategoriesManager({ isOpen, onClose }) {
  const [categories, setCategories] = useState(MOCK_CATEGORIES);
  const [newCat, setNewCat] = useState('');
  const [editingIdx, setEditingIdx] = useState(null);
  const [editVal, setEditVal] = useState('');

  if (!isOpen) return null;

  const handleAdd = () => {
    const trimmed = newCat.trim();
    if (trimmed) { setCategories(prev => [...prev, trimmed]); setNewCat(''); }
  };

  const handleEdit = (idx) => {
    const trimmed = editVal.trim();
    if (trimmed) {
      setCategories(prev => prev.map((c, i) => i === idx ? trimmed : c));
      setEditingIdx(null);
    }
  };

  const handleDelete = (idx) => {
    setCategories(prev => prev.filter((_, i) => i !== idx));
    if (editingIdx === idx) setEditingIdx(null);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px]">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-lg font-bold text-gray-900">Manage Categories</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 cursor-pointer"><X size={20} /></button>
        </div>
        <div className="p-6 overflow-y-auto flex-1 space-y-3">
          {categories.map((cat, idx) => (
            <div key={idx} className="flex items-center gap-2">
              {editingIdx === idx ? (
                <input
                  type="text" value={editVal} autoFocus
                  onChange={e => setEditVal(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleEdit(idx); if (e.key === 'Escape') setEditingIdx(null); }}
                  className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578]"
                />
              ) : (
                <span className="flex-1 text-sm text-gray-700">{cat}</span>
              )}
              {editingIdx === idx ? (
                <div className="flex gap-1">
                  <button onClick={() => handleEdit(idx)} className="px-2 py-1 text-xs font-semibold text-white bg-[#252578] rounded-lg hover:bg-[#1f1f66] cursor-pointer">Save</button>
                  <button onClick={() => setEditingIdx(null)} className="px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-lg cursor-pointer">Cancel</button>
                </div>
              ) : (
                <div className="flex gap-1">
                  <button onClick={() => { setEditingIdx(idx); setEditVal(cat); }} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-[#252578] cursor-pointer"><Edit3 size={14} /></button>
                  <button onClick={() => handleDelete(idx)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-red-500 cursor-pointer"><Trash2 size={14} /></button>
                </div>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
            <input
              type="text" value={newCat} placeholder="New category name..."
              onChange={e => setNewCat(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
              className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578]"
            />
            <button onClick={handleAdd} disabled={!newCat.trim()} className="flex items-center gap-1.5 px-4 py-2 bg-[#252578] text-white rounded-lg text-sm font-semibold hover:bg-[#1f1f66] transition-all disabled:opacity-40 cursor-pointer"><Plus size={16} />Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function UploadModal({ isOpen, onClose, onUploadComplete, initialMode = 'manual' }) {
  const [uploadMode, setUploadMode] = useState(initialMode || 'manual'); // 'manual' | 'file' | 'bulk'
  const [step, setStep] = useState('form');
  const [progress, setProgress] = useState(0);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [form, setForm] = useState({ title: '', category: '', machine: '', version: '', description: '', tags: '', content: '' });
  const [errors, setErrors] = useState({});
  const [uploadError, setUploadError] = useState('');
  const [isMalwareError, setIsMalwareError] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showDiscardModal, setShowDiscardModal] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setUploadMode(initialMode || 'manual');
    }
  }, [isOpen, initialMode]);

  const reset = () => {
    setUploadMode(initialMode || 'manual');
    setStep('form');
    setProgress(0);
    setCurrentStepIdx(0);
    setSelectedFile(null);
    setForm({ title: '', category: '', machine: '', version: '', description: '', tags: '', content: '' });
    setErrors({});
    setUploadError('');
    setIsMalwareError(false);
    setShowConfirmModal(false);
    setShowDiscardModal(false);
  };

  if (!isOpen) return null;

  const hasUnsavedData = Boolean(
    form.title.trim() ||
    form.category ||
    form.content.trim() ||
    selectedFile ||
    form.machine.trim() ||
    form.version.trim() ||
    form.description.trim() ||
    form.tags.trim()
  );

  const handleAttemptClose = () => {
    if (step === 'uploading') {
      if (progress >= 100 || uploadError) {
        handleForceClose();
      } else {
        setShowDiscardModal(true);
      }
      return;
    }

    if (hasUnsavedData) {
      setShowDiscardModal(true);
      return;
    }

    handleForceClose();
  };

  const handleForceClose = () => {
    setShowDiscardModal(false);
    setShowConfirmModal(false);
    reset();
    onClose();
  };

  const isBulkMode = uploadMode === 'bulk' || Boolean(selectedFile?.name?.toLowerCase()?.endsWith('.csv'));
  const isManualMode = uploadMode === 'manual';
  const isFileMode = uploadMode === 'file' && !isBulkMode;

  const handleDownloadTemplate = () => {
    const csvContent =
      'Title,Steps,Symptoms,Machine_Model,Category,Warning,Tags\r\n' +
      '"Printer Paper Jam Error E-03","1. Turn off the printer power switch.","Error Code E-03 on screen; paper stuck in feed rollers","Canon X120","Troubleshooting Guides","Turn off power before touching internal rollers.","printer;paper jam;e-03"\r\n' +
      '"","2. Open Front Cover A.","","","","",""\r\n' +
      '"","3. Gently remove jammed paper in feed direction.","","","","",""\r\n' +
      '"","4. Close cover and turn on power.","","","","",""\r\n' +
      '"Centrifuge Rotor Balance Calibration","1. Power off centrifuge and wait for rotor standstill. | 2. Open lid manually using emergency release pin. | 3. Inspect four bucket trunnions with caliper and lubricate with silicone grease.","Vibration warning light blinking during 3000 RPM cycle","Centrifuge Heraeus Biofuge","Maintenance Guides","Wear safety goggles when inspecting rotor bowl.","centrifuge;rotor;calibration"\r\n';

    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'knowledge_base_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleInsertTemplate = (type) => {
    let tpl = '';
    if (type === 'troubleshooting') {
      tpl = `### Problem Description\nDescribe the observed error code, malfunction, or unexpected symptom here.\n\n### Prerequisites & Tools\n- Required safety gear, tools, or administrative permissions.\n\n### Troubleshooting Steps\n1. Check power connection and verify indicator lights.\n2. Open diagnostic menu and check event logs.\n3. Perform calibration and clean optical sensors.\n4. Restart the unit and test normal print/operation.\n\n### Verification\nConfirm that error indicators are cleared and system operates without failure.\n\n### Safety & Operational Warnings\nAlways isolate power before handling internal mechanical or high-voltage assemblies.`;
    } else if (type === 'faq') {
      tpl = `### Question / Common Issue\nWhat is this error and when does it typically occur?\n\n### Resolution & Explanation\nDetailed root cause explanation and exact corrective steps.\n\n### Additional Help\nContact the IT service desk if symptoms persist after following these steps.`;
    } else if (type === 'sop') {
      tpl = `### Purpose & Scope\nStandard operating procedure for maintenance and daily checks.\n\n### Step-by-Step Procedure\n1. Initial inspection and workspace preparation.\n2. Execute operational workflow according to specification.\n3. Final verification and recording in logbook.\n\n### Quality & Compliance Criteria\nEnsure all parameters meet company and manufacturer safety standards.`;
    }

    setForm((prev) => ({
      ...prev,
      content: prev.content ? `${prev.content}\n\n${tpl}` : tpl,
    }));
    if (errors.content) setErrors((prev) => ({ ...prev, content: '' }));
  };

  const handleFileValidateAndSet = (file) => {
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();

    // Auto-switch to bulk mode if user drops a CSV file
    if (ext === 'csv' && uploadMode !== 'bulk') {
      setUploadMode('bulk');
    }

    const validExtensions = (uploadMode === 'bulk' || ext === 'csv')
      ? ['csv']
      : ['pdf', 'docx', 'csv', 'txt'];

    if (!validExtensions.includes(ext)) {
      setErrors((prev) => ({
        ...prev,
        file: uploadMode === 'bulk'
          ? 'Invalid file type. Please upload a .CSV spreadsheet.'
          : 'Invalid file type. Only PDF and DOCX files are supported in document upload mode.',
      }));
      setSelectedFile(null);
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setErrors((prev) => ({
        ...prev,
        file: 'File size exceeds maximum limit of 10 MB.',
      }));
      setSelectedFile(null);
      return;
    }

    setErrors((prev) => ({ ...prev, file: '', title: '', category: '' }));
    setSelectedFile(file);
  };

  const handleFileDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (file) handleFileValidateAndSet(file);
  };

  const handleValidateAndPromptConfirm = (e) => {
    if (e) e.preventDefault();
    const newErrors = {};

    if (isManualMode) {
      if (!form.title.trim()) {
        newErrors.title = 'Document title is required.';
      }
      if (!form.category) {
        newErrors.category = 'Please select a category.';
      }
      if (!form.content.trim()) {
        newErrors.content = 'Article content & resolution steps are required.';
      }
    } else if (isBulkMode) {
      if (!selectedFile) {
        newErrors.file = 'Please upload a CSV spreadsheet to import.';
      }
    } else {
      // isFileMode
      if (!selectedFile) {
        newErrors.file = 'Please upload a PDF or DOCX file.';
      }
      if (!form.title.trim()) {
        newErrors.title = 'Document title is required.';
      }
      if (!form.category) {
        newErrors.category = 'Please select a category.';
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    setShowConfirmModal(true);
  };

  const startSimulatedUpload = async () => {
    setShowConfirmModal(false);
    setStep('uploading');
    setProgress(0);
    setCurrentStepIdx(0);
    setUploadError('');
    setIsMalwareError(false);

    if (isManualMode) {
      // Step 0: Validating Content & Metadata
      setCurrentStepIdx(0);
      setProgress(20);
      await new Promise(r => setTimeout(r, 200));

      // Step 1: Chunking Content into Semantic Sections
      setCurrentStepIdx(1);
      setProgress(40);
      await new Promise(r => setTimeout(r, 250));

      // Step 2: Generating Gemini Vector Embeddings
      setCurrentStepIdx(2);
      setProgress(60);

      let createdArticle = null;
      try {
        const payload = {
          title: form.title.trim(),
          category: form.category,
          machine: form.machine.trim() || null,
          version: form.version.trim() || '1.0',
          tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
          description: form.description.trim() || form.content.trim().slice(0, 250),
          content: form.content.trim(),
          file_type: 'ARTICLE',
          status: 'Draft',
        };

        const res = await aiKbClient.post('/articles', payload);
        if (res.data?.success && res.data?.data) {
          createdArticle = res.data.data;
        }
      } catch (err) {
        console.error('Failed to create article:', err);
        const errMsg = err.response?.data?.message || err.message || 'Failed to create and index article.';
        setUploadError(errMsg);
        return;
      }

      // Step 3: Indexing Knowledge Base for AI Search
      setCurrentStepIdx(3);
      setProgress(85);
      await new Promise(r => setTimeout(r, 300));

      // Step 4: Ready for AI Search
      setCurrentStepIdx(4);
      setProgress(100);

      if (onUploadComplete && createdArticle) {
        onUploadComplete(createdArticle);
      }

      setTimeout(() => {
        handleForceClose();
      }, 1400);
      return;
    }

    // Step 0: Mandatory ClamAV Antivirus Daemon Inspection
    setCurrentStepIdx(0);
    setProgress(15);

    const formData = new FormData();
    formData.append('file', selectedFile);

    const lowerName = (selectedFile?.name || '').toLowerCase();
    const isMockMalware = lowerName.includes('eicar') || lowerName.includes('malware') || lowerName.includes('virus') || lowerName.includes('infected');

    let isScanClean = !isMockMalware;
    let threatName = isMockMalware ? 'Eicar-Test-Signature' : null;

    if (!isMockMalware) {
      try {
        const scanRes = await axiosInstance.post(`${AI_API_URL}/articles/scan-file`, formData, {
          baseURL: '',
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        if (!scanRes.data?.success) {
          isScanClean = false;
          threatName = scanRes.data?.threat || 'Malware.Detected';
        }
      } catch (err) {
        if (err.response?.status === 422 && err.response?.data?.error_code === 'MALWARE_DETECTED') {
          isScanClean = false;
          threatName = err.response.data?.threat || 'Malware.Detected';
        } else {
          console.warn('ClamAV scan note, proceeding with verification:', err);
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 400));

    if (!isScanClean) {
      setUploadError(`Security Alert: File failed ClamAV antivirus inspection (${threatName || 'Malware.Detected'}). Upload rejected.`);
      setIsMalwareError(true);
      return;
    }

    // Step 1: Uploading Document
    setCurrentStepIdx(1);
    setProgress(28);
    await new Promise((resolve) => setTimeout(resolve, 300));

    if (isBulkMode) {
      // Step 2: Parsing CSV Rows
      setCurrentStepIdx(2);
      setProgress(48);
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Step 3: Chunking Extracted SOP Sections
      setCurrentStepIdx(3);
      setProgress(68);

      let importedDocs = [];
      try {
        const importRes = await axiosInstance.post(`${AI_API_URL}/articles/import-csv`, formData, {
          baseURL: '',
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        if (importRes.data?.success && Array.isArray(importRes.data?.data)) {
          importedDocs = importRes.data.data;
        }
      } catch (err) {
        console.error('Failed to import CSV:', err);
        const errMsg = err.response?.data?.message || err.message || 'Failed to process CSV file.';
        setUploadError(errMsg);
        return;
      }

      // Step 4: Generating Gemini Vector Embeddings
      setCurrentStepIdx(4);
      setProgress(84);
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Step 5: Indexing Knowledge Base
      setCurrentStepIdx(5);
      setProgress(95);
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Step 6: Ready for AI Search
      setCurrentStepIdx(6);
      setProgress(100);

      if (onUploadComplete && importedDocs.length > 0) {
        onUploadComplete(importedDocs);
      }

      setTimeout(() => {
        handleForceClose();
      }, 1400);
    } else {
      // Step 2: Extracting Text
      setCurrentStepIdx(2);
      setProgress(50);

      formData.append('title', form.title.trim());
      formData.append('category', form.category);
      if (form.machine.trim()) formData.append('machine', form.machine.trim());
      if (form.version.trim()) formData.append('version', form.version.trim());
      if (form.tags.trim()) formData.append('tags', form.tags.trim());
      if (form.description.trim()) formData.append('description', form.description.trim());
      formData.append('status', 'Draft');

      let createdDoc = null;
      try {
        const createRes = await axiosInstance.post(`${AI_API_URL}/articles`, formData, {
          baseURL: '',
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        if (createRes.data?.success && createRes.data?.data) {
          createdDoc = createRes.data.data;
        }
      } catch (err) {
        console.error('Failed to upload document:', err);
        const errMsg = err.response?.data?.message || err.message || 'Failed to process document file.';
        setUploadError(errMsg);
        return;
      }

      // Step 3: Chunking Document Sections
      setCurrentStepIdx(3);
      setProgress(70);
      await new Promise((resolve) => setTimeout(resolve, 350));

      // Step 4: Generating Vector Embeddings
      setCurrentStepIdx(4);
      setProgress(85);
      await new Promise((resolve) => setTimeout(resolve, 350));

      // Step 5: Indexing Knowledge Base
      setCurrentStepIdx(5);
      setProgress(95);
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Step 6: Ready for AI Search
      setCurrentStepIdx(6);
      setProgress(100);

      if (onUploadComplete && createdDoc) {
        onUploadComplete(createdDoc);
      }

      setTimeout(() => {
        handleForceClose();
      }, 1400);
    }
  };

  const wordCount = form.content ? form.content.trim().split(/\s+/).filter(Boolean).length : 0;
  const charCount = form.content?.length || 0;

  return (
    <>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px]">
        <div className="w-full max-w-3xl rounded-xl bg-white shadow-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                {isManualMode
                  ? 'Create Knowledge Article'
                  : isBulkMode
                    ? 'Bulk CSV Knowledge Import'
                    : 'Upload Knowledge Document'}
              </h2>
              <p className="text-xs text-gray-500">
                {isManualMode
                  ? 'Write structured SOPs, procedures, or FAQs directly for AI vector search'
                  : isBulkMode
                    ? 'Import and index multiple SOPs, procedures, or FAQs from a CSV spreadsheet'
                    : 'Add a PDF or DOCX manual to the AI knowledge base with ClamAV antivirus inspection'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleAttemptClose}
              className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>

          {step === 'form' && (
            <div className="overflow-y-auto px-6 py-4 space-y-4 flex-1">
              {/* 3 Ingestion Mode Selector Tabs */}
              <div className="flex p-1 bg-gray-100/90 rounded-xl border border-gray-200/80">
                <button
                  type="button"
                  onClick={() => {
                    setUploadMode('manual');
                    setErrors({});
                  }}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    isManualMode
                      ? 'bg-[#252578] text-white shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Edit3 size={15} />
                  <span>Write Article</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUploadMode('file');
                    if (selectedFile?.name?.toLowerCase()?.endsWith('.csv')) {
                      setSelectedFile(null);
                    }
                    setErrors({});
                  }}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    isFileMode
                      ? 'bg-[#252578] text-white shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <FileText size={15} />
                  <span>Upload Document (PDF / DOCX)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setUploadMode('bulk');
                    if (selectedFile && !selectedFile?.name?.toLowerCase()?.endsWith('.csv')) {
                      setSelectedFile(null);
                    }
                    setErrors({});
                  }}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    isBulkMode
                      ? 'bg-[#252578] text-white shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <FileSpreadsheet size={15} />
                  <span>Bulk Import (CSV)</span>
                </button>
              </div>

              {/* Mode 1: Manual Direct Article Creation */}
              {isManualMode && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                        Article Title <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={form.title}
                        onChange={(e) => {
                          setForm({ ...form, title: e.target.value });
                          if (errors.title) setErrors((prev) => ({ ...prev, title: '' }));
                        }}
                        placeholder="e.g. Printer Paper Jam Clearing Procedure (Error E-03)"
                        className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition-all ${
                          errors.title
                            ? 'border-red-500 focus:ring-2 focus:ring-red-200'
                            : 'border-gray-200 focus:border-transparent focus:ring-2 focus:ring-[#252578]'
                        }`}
                      />
                      {errors.title && (
                        <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                          <AlertTriangle size={12} />
                          {errors.title}
                        </p>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          Category <span className="text-red-500">*</span>
                        </label>
                        <div className="relative group inline-flex items-center">
                          <Info size={14} className="text-gray-400 hover:text-[#252578] transition-colors cursor-pointer" />
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-50 w-56 p-2 bg-gray-900 text-white text-[11px] rounded-lg shadow-lg pointer-events-none text-center leading-normal">
                            Category determines which chatbot topics this article will be indexed to answer.
                            <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900" />
                          </div>
                        </div>
                      </div>
                      <select
                        value={form.category}
                        onChange={(e) => {
                          setForm({ ...form, category: e.target.value });
                          if (errors.category) setErrors((prev) => ({ ...prev, category: '' }));
                        }}
                        className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition-all bg-white ${
                          errors.category
                            ? 'border-red-500 focus:ring-2 focus:ring-red-200'
                            : 'border-gray-200 focus:border-transparent focus:ring-2 focus:ring-[#252578]'
                        }`}
                      >
                        <option value="">Select category</option>
                        {MOCK_CATEGORIES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      {errors.category && (
                        <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                          <AlertTriangle size={12} />
                          {errors.category}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Machine Model</label>
                      <input
                        type="text"
                        value={form.machine}
                        onChange={(e) => setForm({ ...form, machine: e.target.value })}
                        placeholder="e.g. Canon X120, HP LaserJet Pro"
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Version</label>
                      <input
                        type="text"
                        value={form.version}
                        onChange={(e) => setForm({ ...form, version: e.target.value })}
                        placeholder="e.g. 1.0"
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Tags</label>
                      <input
                        type="text"
                        value={form.tags}
                        onChange={(e) => setForm({ ...form, tags: e.target.value })}
                        placeholder="Comma separated: printer, jam, e-03"
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578]"
                      />
                    </div>

                    <div className="col-span-2">
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Short Description</label>
                      <textarea
                        rows={2}
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578] resize-none"
                        placeholder="Brief 1-2 sentence summary of this guide..."
                      />
                    </div>
                  </div>

                  {/* Direct Article Content Editor Area */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Article Content & Resolution Instructions <span className="text-red-500">*</span>
                      </label>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-gray-400 font-medium">Quick Templates:</span>
                        <button
                          type="button"
                          onClick={() => handleInsertTemplate('troubleshooting')}
                          className="px-2 py-0.5 rounded-md bg-[#252578]/5 hover:bg-[#252578]/10 text-[#252578] text-[11px] font-semibold transition cursor-pointer border border-[#252578]/20"
                        >
                          + Troubleshooting SOP
                        </button>
                        <button
                          type="button"
                          onClick={() => handleInsertTemplate('faq')}
                          className="px-2 py-0.5 rounded-md bg-[#252578]/5 hover:bg-[#252578]/10 text-[#252578] text-[11px] font-semibold transition cursor-pointer border border-[#252578]/20"
                        >
                          + FAQ Answer
                        </button>
                        <button
                          type="button"
                          onClick={() => handleInsertTemplate('sop')}
                          className="px-2 py-0.5 rounded-md bg-[#252578]/5 hover:bg-[#252578]/10 text-[#252578] text-[11px] font-semibold transition cursor-pointer border border-[#252578]/20"
                        >
                          + General SOP
                        </button>
                      </div>
                    </div>

                    <textarea
                      rows={10}
                      value={form.content}
                      onChange={(e) => {
                        setForm({ ...form, content: e.target.value });
                        if (errors.content) setErrors((prev) => ({ ...prev, content: '' }));
                      }}
                      placeholder={`### Symptoms & Problem Description\nDescribe the issue or error codes here...\n\n### Prerequisites\nRequired tools or safety measures...\n\n### Troubleshooting Steps\n1. Step 1: Disconnect power.\n2. Step 2: Clear obstruction.\n\n### Verification\nConfirm error indicator is cleared and equipment operates normally.`}
                      className={`w-full font-mono text-xs leading-relaxed rounded-lg border p-3 outline-none transition-all ${
                        errors.content
                          ? 'border-red-500 focus:ring-2 focus:ring-red-200'
                          : 'border-gray-200 focus:border-transparent focus:ring-2 focus:ring-[#252578]'
                      }`}
                    />

                    <div className="flex items-center justify-between mt-1 text-[11px] text-gray-400">
                      <span>{wordCount} words · {charCount} characters</span>
                      {errors.content && (
                        <span className="text-red-600 flex items-center gap-1 font-semibold">
                          <AlertTriangle size={12} />
                          {errors.content}
                        </span>
                      )}
                    </div>

                    <div className="mt-3 flex items-center gap-2 text-[11px] text-[#252578] bg-[#252578]/5 border border-[#252578]/20 rounded-lg p-2.5 font-medium">
                      <CheckCircle size={14} className="text-[#252578] shrink-0" />
                      <span>Direct articles bypass PDF parsing noise, maximizing semantic accuracy and Gemini vector probe rank.</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Mode 2: Bulk CSV Knowledge Import */}
              {isBulkMode && (
                <div className="bg-[#252578]/5 border border-[#252578]/20 rounded-xl p-4.5 space-y-3 text-xs text-[#252578]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[#252578]/10 flex items-center justify-center shrink-0 text-[#252578]">
                        <FileSpreadsheet size={22} />
                      </div>
                      <div>
                        <p className="font-bold text-sm text-gray-900">Bulk Knowledge Spreadsheet Import</p>
                        <p className="text-gray-600 mt-0.5 leading-relaxed">
                          Titles, machine models, categories, symptoms, steps, and warnings will be parsed directly from your spreadsheet rows.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleDownloadTemplate}
                      className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 bg-[#252578] text-white rounded-lg text-xs font-semibold hover:bg-[#1f1f66] transition-all cursor-pointer shadow-xs"
                    >
                      <Download size={14} />
                      Download CSV Template
                    </button>
                  </div>

                  {/* 7 Columns Specification Box */}
                  <div className="bg-white/85 rounded-lg p-3 border border-gray-200/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-gray-800 uppercase tracking-wider text-[10px]">
                        7 Standard Columns Format:
                      </span>
                      <span className="text-[10px] text-amber-800 font-semibold bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                        Supports Multi-Row Steps (Option B)
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                      <div className="p-2 rounded bg-gray-50 border border-gray-100">
                        <span className="font-bold text-[#252578]">Title</span>
                        <p className="text-gray-500 text-[10px]">Document / SOP title (leave blank for step continuation)</p>
                      </div>
                      <div className="p-2 rounded bg-gray-50 border border-gray-100">
                        <span className="font-bold text-[#252578]">Steps</span>
                        <p className="text-gray-500 text-[10px]">Procedure instructions (1 per row or separated with | )</p>
                      </div>
                      <div className="p-2 rounded bg-gray-50 border border-gray-100">
                        <span className="font-bold text-[#252578]">Symptoms</span>
                        <p className="text-gray-500 text-[10px]">Problem description or error codes</p>
                      </div>
                      <div className="p-2 rounded bg-gray-50 border border-gray-100">
                        <span className="font-bold text-[#252578]">Machine_Model</span>
                        <p className="text-gray-500 text-[10px]">e.g. Canon X120, Sysmex 500</p>
                      </div>
                      <div className="p-2 rounded bg-gray-50 border border-gray-100">
                        <span className="font-bold text-[#252578]">Category</span>
                        <p className="text-gray-500 text-[10px]">Troubleshooting Guides, FAQs, User Manuals</p>
                      </div>
                      <div className="p-2 rounded bg-gray-50 border border-gray-100">
                        <span className="font-bold text-[#252578]">Warning</span>
                        <p className="text-gray-500 text-[10px]">Safety notices or caution instructions</p>
                      </div>
                      <div className="p-2 rounded bg-gray-50 border border-gray-100 col-span-2">
                        <span className="font-bold text-[#252578]">Tags</span>
                        <p className="text-gray-500 text-[10px]">Search keywords separated by semicolons (e.g. printer;paper jam)</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-[11px] text-emerald-800 bg-emerald-50/80 border border-emerald-200/70 rounded-lg px-3 py-1.5 font-medium">
                    <CheckCircle size={14} className="text-emerald-600 shrink-0" />
                    <span>ClamAV Antivirus Daemon Enabled: All CSV rows and contents are scanned for malware before indexing.</span>
                  </div>
                </div>
              )}

              {/* Mode 3: Single Document Upload (PDF / DOCX) */}
              {isFileMode && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Document Title <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.title}
                      onChange={(e) => {
                        setForm({ ...form, title: e.target.value });
                        if (errors.title) setErrors((prev) => ({ ...prev, title: '' }));
                      }}
                      placeholder="e.g. Canon X120 Official Service Manual"
                      className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition-all ${
                        errors.title
                          ? 'border-red-500 focus:ring-2 focus:ring-red-200'
                          : 'border-gray-200 focus:border-transparent focus:ring-2 focus:ring-[#252578]'
                      }`}
                    />
                    {errors.title && (
                      <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                        <AlertTriangle size={12} />
                        {errors.title}
                      </p>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        Category <span className="text-red-500">*</span>
                      </label>
                      <div className="relative group inline-flex items-center">
                        <Info size={14} className="text-gray-400 hover:text-[#252578] transition-colors cursor-pointer" />
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-50 w-56 p-2 bg-gray-900 text-white text-[11px] rounded-lg shadow-lg pointer-events-none text-center leading-normal">
                          Category determines which chatbot topics this article will be used to answer.
                          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900" />
                        </div>
                      </div>
                    </div>
                    <select
                      value={form.category}
                      onChange={(e) => {
                        setForm({ ...form, category: e.target.value });
                        if (errors.category) setErrors((prev) => ({ ...prev, category: '' }));
                      }}
                      className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition-all bg-white ${
                        errors.category
                          ? 'border-red-500 focus:ring-2 focus:ring-red-200'
                          : 'border-gray-200 focus:border-transparent focus:ring-2 focus:ring-[#252578]'
                      }`}
                    >
                      <option value="">Select category</option>
                      {MOCK_CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    {errors.category && (
                      <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                        <AlertTriangle size={12} />
                        {errors.category}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Machine Model</label>
                    <input
                      type="text"
                      value={form.machine}
                      onChange={(e) => setForm({ ...form, machine: e.target.value })}
                      placeholder="e.g. Canon X120"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Version</label>
                    <input
                      type="text"
                      value={form.version}
                      onChange={(e) => setForm({ ...form, version: e.target.value })}
                      placeholder="e.g. 1.0"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Tags</label>
                    <input
                      type="text"
                      value={form.tags}
                      onChange={(e) => setForm({ ...form, tags: e.target.value })}
                      placeholder="Comma separated"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578]"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Description</label>
                    <textarea
                      rows={2}
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578] resize-none"
                      placeholder="Brief summary of document content..."
                    />
                  </div>
                </div>
              )}

              {/* Upload File Zone (Only for File and Bulk Modes) */}
              {!isManualMode && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {isBulkMode ? 'Upload CSV Spreadsheet' : 'Upload File'} <span className="text-red-500">*</span>
                    </label>
                    {!isBulkMode && (
                      <button
                        type="button"
                        onClick={handleDownloadTemplate}
                        className="inline-flex items-center gap-1 text-xs text-[#252578] hover:text-[#2E85D8] font-medium transition-colors cursor-pointer"
                      >
                        <Download size={13} />
                        Download CSV Template
                      </button>
                    )}
                  </div>

                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleFileDrop}
                    className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${
                      errors.file
                        ? 'border-red-400 bg-red-50/20'
                        : dragOver
                          ? 'border-[#252578] bg-[#252578]/5'
                          : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {selectedFile ? (
                      <div className="space-y-2">
                        {isBulkMode ? (
                          <FileSpreadsheet size={34} className="mx-auto text-[#252578]" />
                        ) : (
                          <FileText size={34} className="mx-auto text-[#252578]" />
                        )}
                        <p className="text-sm font-semibold text-gray-700">{selectedFile.name}</p>
                        <p className="text-xs text-gray-400">
                          {(selectedFile.size / 1024).toFixed(1)} KB {isBulkMode ? '· Spreadsheet Ready for Parsing' : ''}
                        </p>
                        <button
                          type="button"
                          onClick={() => setSelectedFile(null)}
                          className="text-xs text-red-500 hover:underline cursor-pointer"
                        >
                          Remove file
                        </button>
                      </div>
                    ) : (
                      <>
                        {isBulkMode ? (
                          <FileSpreadsheet size={32} className="mx-auto text-gray-300 mb-2" />
                        ) : (
                          <Upload size={32} className="mx-auto text-gray-300 mb-2" />
                        )}
                        <p className="text-sm text-gray-500">
                          {isBulkMode
                            ? 'Drag & drop a CSV spreadsheet here, or '
                            : 'Drag & drop a file here, or '}
                          <span className="text-[#252578] font-semibold">browse</span>
                        </p>
                        <p className="text-xs text-gray-400 mt-1">
                          {isBulkMode ? 'Supported: .CSV spreadsheet (max 10 MB)' : 'Supported: PDF, DOCX, TXT (max 10 MB)'}
                        </p>
                        <input
                          type="file"
                          accept={isBulkMode ? '.csv' : '.pdf,.docx,.txt'}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFileValidateAndSet(file);
                          }}
                          className="hidden"
                          id="file-upload"
                        />
                        <label
                          htmlFor="file-upload"
                          className="inline-block mt-3 px-4 py-2 bg-white border border-gray-200 rounded-xl text-xs font-semibold text-gray-600 hover:border-[#252578] hover:text-[#252578] transition-all cursor-pointer shadow-2xs"
                        >
                          Choose File
                        </label>
                      </>
                    )}
                  </div>
                  {errors.file && (
                    <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
                      <AlertTriangle size={12} />
                      {errors.file}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 'uploading' && (
            <div className="px-6 py-6 space-y-5 flex-1">
              {uploadError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-4 flex items-start gap-3">
                  <AlertTriangle size={20} className="text-red-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold">{isMalwareError ? 'Security Alert' : 'Creation Failed'}</p>
                    <p className="text-xs text-red-600 mt-0.5">{uploadError}</p>
                  </div>
                </div>
              )}

              <PipelineProgressView
                selectedFile={selectedFile}
                displayTitle={form.title}
                displaySub={isManualMode ? `${wordCount} words · Direct Article` : null}
                progress={progress}
                currentStepIdx={currentStepIdx}
                uploadError={uploadError}
                successTitle={
                  isManualMode
                    ? 'Knowledge Article Created & Indexed Successfully!'
                    : isBulkMode
                      ? 'Knowledge Base Articles Imported Successfully!'
                      : 'Knowledge Document Uploaded & Indexed Successfully!'
                }
                successMessage="Status set to Draft. Indexed and ready for AI search, but hidden from the chatbot until published."
                steps={isManualMode ? MANUAL_CREATE_STEPS : isBulkMode ? CSV_STEPS : UPLOAD_STEPS}
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
            {step === 'form' && (
              <>
                <button
                  type="button"
                  onClick={handleAttemptClose}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-100 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleValidateAndPromptConfirm}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#252578] hover:bg-[#1f1f66] transition-all cursor-pointer shadow-sm"
                >
                  {isManualMode
                    ? 'Create & Index Article'
                    : isBulkMode
                      ? 'Import CSV Articles'
                      : 'Upload & Process'}
                </button>
              </>
            )}

            {step === 'uploading' && uploadError && (
              <button
                type="button"
                onClick={() => {
                  setStep('form');
                  setUploadError('');
                  setIsMalwareError(false);
                }}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-red-600 hover:bg-red-700 transition-all cursor-pointer"
              >
                Back to Form
              </button>
            )}

            {step === 'uploading' && progress >= 100 && (
              <button
                type="button"
                onClick={handleForceClose}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#252578] hover:bg-[#1f1f66] transition-all cursor-pointer shadow-sm"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>

      <CreateArticleConfirmModal
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        onConfirm={startSimulatedUpload}
        form={form}
        selectedFile={selectedFile}
        mode={uploadMode}
      />

      <DiscardConfirmModal
        isOpen={showDiscardModal}
        onClose={() => setShowDiscardModal(false)}
        onConfirm={handleForceClose}
        title="Discard Unsaved Article Changes?"
        description="You have unsaved changes in this article. Are you sure you want to discard your draft?"
      />
    </>
  );
}

function DocumentContentPreview({ doc, onReplacePrompt }) {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState('formatted'); // 'formatted' | 'raw'
  const content = (doc.content || '').trim();
  const description = (doc.description || '').trim();
  const displayContent = content || description;

  const handleCopy = () => {
    if (!displayContent) return;
    navigator.clipboard.writeText(displayContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!doc.id) return;
    window.open(`${AI_API_URL}/articles/${doc.id}/file`, '_blank');
  };

  // Helper to parse SOP sections if formatted text exists
  const parsedSections = useMemo(() => {
    if (!content) return null;
    const lines = content.split('\n');
    const sections = {
      symptoms: '',
      prerequisites: '',
      steps: [],
      warning: '',
      verify: '',
      other: [],
    };

    let currentSection = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (/^Symptoms\s*(\/|\&)?\s*Problem Description:/i.test(trimmed)) {
        currentSection = 'symptoms';
        continue;
      } else if (/^Prerequisites\s*(&|\/)?\s*Tools:/i.test(trimmed)) {
        currentSection = 'prerequisites';
        continue;
      } else if (/^Troubleshooting Steps:/i.test(trimmed)) {
        currentSection = 'steps';
        continue;
      } else if (/^Safety\s*(&|\/)?\s*Operational Warnings:/i.test(trimmed)) {
        currentSection = 'warning';
        continue;
      } else if (/^Verification:/i.test(trimmed)) {
        currentSection = 'verify';
        continue;
      } else if (/^(Machine Model|Category|Tags):/i.test(trimmed)) {
        currentSection = null;
        continue;
      }

      if (currentSection === 'steps') {
        if (trimmed) {
          sections.steps.push(trimmed);
        }
      } else if (currentSection === 'symptoms') {
        if (trimmed) {
          sections.symptoms = sections.symptoms ? `${sections.symptoms}\n${trimmed}` : trimmed;
        }
      } else if (currentSection === 'prerequisites') {
        if (trimmed) {
          sections.prerequisites = sections.prerequisites ? `${sections.prerequisites}\n${trimmed}` : trimmed;
        }
      } else if (currentSection === 'warning') {
        if (trimmed) {
          sections.warning = sections.warning ? `${sections.warning}\n${trimmed}` : trimmed;
        }
      } else if (currentSection === 'verify') {
        if (trimmed) {
          sections.verify = sections.verify ? `${sections.verify}\n${trimmed}` : trimmed;
        }
      } else if (trimmed) {
        sections.other.push(trimmed);
      }
    }

    const hasStructured = Boolean(
      sections.symptoms || sections.steps.length > 0 || sections.warning || sections.verify || sections.prerequisites
    );

    return hasStructured ? sections : null;
  }, [content]);

  const wordCount = useMemo(() => {
    if (!displayContent) return 0;
    return displayContent.split(/\s+/).filter(Boolean).length;
  }, [displayContent]);

  const isCsv = (doc.fileType === 'CSV' || doc.file_type === 'CSV');

  return (
    <div className="border-t border-gray-100 pt-4">
      {/* Preview Section Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
            {isCsv ? <FileSpreadsheet size={13} className="text-emerald-600" /> : <FileText size={13} className="text-[#252578]" />}
            Document Preview
          </p>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600 border border-gray-200">
            {doc.fileType || 'PDF'}
          </span>
          {wordCount > 0 && (
            <span className="text-[11px] text-gray-400">
              {wordCount} words · {displayContent.length} chars
            </span>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5">
          {parsedSections && (
            <div className="flex items-center bg-gray-100 p-0.5 rounded-lg border border-gray-200 mr-1 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab('formatted')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                  activeTab === 'formatted'
                    ? 'bg-white text-gray-800 shadow-xs'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Structured SOP
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('raw')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                  activeTab === 'raw'
                    ? 'bg-white text-gray-800 shadow-xs'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Raw Content
              </button>
            </div>
          )}

          {displayContent && (
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-600 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-all cursor-pointer"
              title="Copy text to clipboard"
            >
              {copied ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
              <span>{copied ? 'Copied!' : 'Copy'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleDownload}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-600 hover:text-[#252578] bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-all cursor-pointer"
            title="Download document / file"
          >
            <Download size={13} />
            <span>Download</span>
          </button>
        </div>
      </div>

      {/* Content Rendering */}
      {!displayContent ? (
        <div className="bg-gray-50 rounded-xl border border-dashed border-gray-200 p-6 text-center space-y-2">
          <FileText size={32} className="mx-auto text-gray-300" />
          <p className="text-xs font-medium text-gray-600">No content or text extracted for this document yet.</p>
          <p className="text-[11px] text-gray-400 max-w-sm mx-auto">
            You can replace this document with a full PDF, DOCX, or CSV standard operating procedure to enable AI search.
          </p>
          {onReplacePrompt && (
            <button
              type="button"
              onClick={() => onReplacePrompt(doc)}
              className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-all cursor-pointer shadow-xs"
            >
              <RefreshCw size={13} />
              Upload Replacement File
            </button>
          )}
        </div>
      ) : activeTab === 'formatted' && parsedSections ? (
        <div className="space-y-3.5 max-h-[420px] overflow-y-auto pr-1">
          {/* Warning Banner */}
          {parsedSections.warning && (
            <div className="p-3.5 rounded-xl bg-amber-50/80 border border-amber-200/90 text-amber-900 text-xs">
              <div className="flex items-center gap-2 font-bold text-amber-800 mb-1">
                <AlertTriangle size={15} className="text-amber-600 shrink-0" />
                <span>Safety & Operational Warnings</span>
              </div>
              <p className="whitespace-pre-wrap leading-relaxed pl-5 text-amber-950 font-medium">
                {parsedSections.warning}
              </p>
            </div>
          )}

          {/* Symptoms Card */}
          {parsedSections.symptoms && (
            <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200/80 text-blue-900 text-xs">
              <div className="flex items-center gap-2 font-bold text-blue-800 mb-1">
                <AlertCircle size={15} className="text-blue-600 shrink-0" />
                <span>Symptoms / Problem Description</span>
              </div>
              <p className="whitespace-pre-wrap leading-relaxed pl-5 text-blue-950">
                {parsedSections.symptoms}
              </p>
            </div>
          )}

          {/* Prerequisites Card */}
          {parsedSections.prerequisites && (
            <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 text-gray-800 text-xs">
              <div className="flex items-center gap-2 font-bold text-gray-700 mb-1">
                <Wrench size={15} className="text-gray-500 shrink-0" />
                <span>Prerequisites & Required Tools</span>
              </div>
              <p className="whitespace-pre-wrap leading-relaxed pl-5 text-gray-700">
                {parsedSections.prerequisites}
              </p>
            </div>
          )}

          {/* Troubleshooting Steps */}
          {parsedSections.steps.length > 0 && (
            <div className="p-3.5 rounded-xl bg-white border border-gray-200/90 shadow-2xs space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                  <CheckCircle size={15} className="text-emerald-600 shrink-0" />
                  Troubleshooting & Resolution Steps
                </span>
                <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  {parsedSections.steps.length} {parsedSections.steps.length === 1 ? 'step' : 'steps'}
                </span>
              </div>
              <div className="space-y-2">
                {parsedSections.steps.map((stepText, idx) => {
                  const cleanedText = stepText.replace(/^\d+[\.\)]\s*/, '');
                  return (
                    <div key={idx} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-gray-50/80 border border-gray-100 text-xs text-gray-800">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#252578]/10 text-[#252578] font-bold text-[11px] flex items-center justify-center mt-0.5">
                        {idx + 1}
                      </span>
                      <p className="leading-relaxed flex-1 pt-0.5 font-medium text-gray-800">
                        {cleanedText || stepText}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Verification Card */}
          {parsedSections.verify && (
            <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200/80 text-emerald-900 text-xs">
              <div className="flex items-center gap-2 font-bold text-emerald-800 mb-1">
                <CheckCircle size={15} className="text-emerald-600 shrink-0" />
                <span>Verification & Operational Sign-off</span>
              </div>
              <p className="whitespace-pre-wrap leading-relaxed pl-5 text-emerald-950 font-medium">
                {parsedSections.verify}
              </p>
            </div>
          )}

          {/* Remaining Text If Any */}
          {parsedSections.other.length > 0 && (
            <div className="p-3 rounded-lg bg-gray-50 border border-gray-100 text-xs text-gray-700 whitespace-pre-wrap">
              {parsedSections.other.join('\n')}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 max-h-[360px] overflow-y-auto">
          <pre className="text-xs text-gray-800 whitespace-pre-wrap font-sans leading-relaxed select-text">
            {displayContent}
          </pre>
        </div>
      )}
    </div>
  );
}

function DocumentDetailModal({ isOpen, doc, onClose, onPublish, onArchivePrompt, onReplacePrompt, onRetryIndex, isRetrying = false }) {
  if (!isOpen || !doc) return null;

  const indexing = isRetrying || isIndexingInProgress(doc);
  const indexFailed = !indexing && isIndexingFailed(doc);
  const lowRetrievability = !indexFailed && isPublishedDoc(doc) && doc.lowRetrievability;

  const isPublished = (doc.publishState || doc.status) === 'Published';
  const canPublish = (doc.processingStatus === 'Ready for AI Search' || doc.processingStatus === 'Ready') && doc.status !== 'Processing';
  const PublishStateIcon = publishStateIcons[doc.publishState || 'Draft'] || FileText;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px]">
      <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-lg font-bold text-gray-900 truncate" title={doc.title}>{doc.title}</h2>
            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border flex-shrink-0 ${publishStateColors[doc.publishState || 'Draft']}`}>
              {PublishStateIcon && <PublishStateIcon size={10} />}
              {doc.publishState || 'Draft'}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => onReplacePrompt && onReplacePrompt(doc)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-all cursor-pointer shadow-xs"
              title="Replace this article's document with a new file"
            >
              <RefreshCw size={14} />
              Replace File
            </button>
            {isPublished ? (
              <button
                type="button"
                onClick={() => onArchivePrompt && onArchivePrompt(doc)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-all cursor-pointer"
              >
                <Archive size={14} />
                Archive Article
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onPublish && onPublish(doc)}
                disabled={!canPublish}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${canPublish
                    ? 'text-white bg-green-600 hover:bg-green-700 cursor-pointer shadow-xs'
                    : 'text-gray-400 bg-gray-100 border border-gray-200 cursor-not-allowed opacity-60'
                  }`}
                title={
                  canPublish
                    ? "Publish to AI Chatbot"
                    : "This article's content hasn't been successfully processed yet. Fix or replace the file before publishing."
                }
              >
                <Globe size={14} />
                Publish Article
              </button>
            )}
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 cursor-pointer"><X size={20} /></button>
          </div>
        </div>

        <div className="overflow-y-auto px-6 py-4 space-y-5 flex-1">
          <div className="grid grid-cols-2 gap-4">
            <div><p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Category</p><p className="text-sm font-medium text-gray-800 mt-0.5">{doc.category}</p></div>
            <div><p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Machine Model</p><p className="text-sm font-medium text-gray-800 mt-0.5">{doc.machine}</p></div>
            <div><p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Version</p><p className="text-sm font-medium text-gray-800 mt-0.5">{doc.version || '—'}</p></div>
            <div><p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">File Type</p><p className="text-sm font-medium text-gray-800 mt-0.5">{doc.fileType}</p></div>
            <div><p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Uploaded By</p><p className="text-sm font-medium text-gray-800 mt-0.5">{doc.uploadedBy}</p></div>
            <div><p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Upload Date</p><p className="text-sm font-medium text-gray-800 mt-0.5">{formatUploadDate(doc.uploadDate)}</p></div>
            <div><p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">File Size</p><p className="text-sm font-medium text-gray-800 mt-0.5">{doc.size}</p></div>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Publish State</p>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border mt-1 ${publishStateColors[doc.publishState || 'Draft']}`}>
                {PublishStateIcon && <PublishStateIcon size={10} />}
                {doc.publishState || 'Draft'}
              </span>
            </div>
          </div>
          {doc.description && (
            <div><p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Description</p><p className="text-sm text-gray-700 bg-gray-50 p-3 rounded-lg border border-gray-100">{doc.description}</p></div>
          )}
          {doc.tags && (
            <div><p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Tags</p><div className="flex flex-wrap gap-1.5">{doc.tags.map(t => <span key={t} className="px-2 py-0.5 bg-[#252578]/5 text-[#252578] text-xs rounded-full font-medium">{t}</span>)}</div></div>
          )}
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">AI Processing Status</p>
              {(doc.publishState || doc.status) === 'Draft' && (
                <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
                  Publish State: Draft (Excluded from AI Chatbot)
                </span>
              )}
              {(doc.publishState || doc.status) === 'Archived' && (
                <span className="text-[10px] font-semibold text-gray-600 bg-gray-100 border border-gray-200 px-2.5 py-0.5 rounded-full">
                  Publish State: Archived (Excluded from AI Chatbot)
                </span>
              )}
              {(doc.publishState || doc.status) === 'Published' && (
                <span className="text-[10px] font-semibold text-green-700 bg-green-50 border border-green-200 px-2.5 py-0.5 rounded-full">
                  Publish State: Published (Active in AI Chatbot)
                </span>
              )}
            </div>
            {indexing && (
              <div className="flex items-center gap-2 mb-3 p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800">
                <Loader size={14} className="animate-spin flex-shrink-0" />
                <span>
                  Indexing for AI search.
                  {isPublishedDoc(doc) ? ' The AI keeps using the previous version until this finishes.' : ''}
                </span>
              </div>
            )}
            {indexFailed && (
              <div className="flex items-start justify-between gap-3 mb-3 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                <div className="flex items-start gap-2 min-w-0">
                  <AlertTriangle size={14} className="text-red-600 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="font-semibold">Indexing failed</p>
                    <p className="mt-0.5 break-words">{doc.indexError || 'The embedding service did not return a result.'}</p>
                    {isPublishedDoc(doc) && (
                      <p className="mt-1 text-red-700">The AI keeps using the previous indexed version of this article.</p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRetryIndex && onRetryIndex(doc)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-700 transition-all cursor-pointer flex-shrink-0"
                >
                  <RefreshCw size={14} />
                  Retry
                </button>
              </div>
            )}
            {lowRetrievability && (
              <div className="flex items-start gap-2 mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                <AlertCircle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Published, low retrievability (score {formatProbeScore(doc.probeScore)})</p>
                  <p className="mt-0.5">
                    When searched by its own title and description, this article did not rank in the AI's top 3 results,
                    or its match score is below the threshold. Try a clearer title or description using the words customers would use.
                  </p>
                </div>
              </div>
            )}
            <div className="space-y-2">
              {AI_PROCESSING_STEPS.map((step, i) => (
                <div key={i} className={`flex items-center gap-2.5 text-sm ${step.done ? 'text-gray-700' : 'text-gray-300'}`}>
                  {step.done ? <CheckCircle size={16} className="text-green-500" /> : <div className="w-4 h-4 rounded-full border-2 border-gray-300" />}
                  {step.label}
                </div>
              ))}
            </div>
          </div>

          {/* TS078 / TS080: Version & Change History (Audit Trail) */}
          <div className="border-t border-gray-100 pt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <History size={13} className="text-gray-400" />
                Version & Change History
              </p>
              <span className="text-[10px] text-gray-400 font-medium">
                {(doc.history || []).length} {(doc.history || []).length === 1 ? 'event' : 'events'} recorded
              </span>
            </div>

            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {(!doc.history || doc.history.length === 0) ? (
                <p className="text-xs text-gray-400 italic">No history records available.</p>
              ) : (
                doc.history.map((entry, idx) => {
                  const isReplacement = entry.type === 'file_replacement';
                  const isMetadata = entry.type === 'metadata';
                  const isPublishedEntry = entry.type === 'published';
                  const isArchivedEntry = entry.type === 'archived';

                  const Icon = isReplacement
                    ? RefreshCw
                    : isMetadata
                      ? Edit3
                      : isPublishedEntry
                        ? Globe
                        : isArchivedEntry
                          ? Archive
                          : Plus;

                  const badgeClass = isReplacement
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : isMetadata
                      ? 'bg-blue-50 text-blue-700 border-blue-200'
                      : isPublishedEntry
                        ? 'bg-green-50 text-green-700 border-green-200'
                        : isArchivedEntry
                          ? 'bg-gray-100 text-gray-700 border-gray-200'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200';

                  const typeLabel = isReplacement
                    ? 'File Replaced'
                    : isMetadata
                      ? 'Metadata Updated'
                      : isPublishedEntry
                        ? 'Article Published'
                        : isArchivedEntry
                          ? 'Article Archived'
                          : 'Article Created';

                  return (
                    <div key={entry.id || idx} className="flex items-start gap-3 p-2.5 rounded-lg bg-gray-50 border border-gray-100 text-xs">
                      <div className={`p-1.5 rounded-md border ${badgeClass} flex-shrink-0 mt-0.5`}>
                        <Icon size={12} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-gray-800">{typeLabel}</span>
                          <span className="text-[10px] text-gray-400 whitespace-nowrap">{formatTimestamp(entry.timestamp)}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-gray-500">
                          <span>By <strong className="text-gray-700">{entry.actor || 'Super Admin'}</strong></span>
                          {entry.fileName && (
                            <>
                              <span>·</span>
                              <span className="truncate max-w-[200px] text-gray-600 font-medium">{entry.fileName}</span>
                              {entry.fileSize && <span className="text-gray-400">({entry.fileSize})</span>}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <DocumentContentPreview doc={doc} onReplacePrompt={onReplacePrompt} />
        </div>
      </div>
    </div>
  );
}

function EditMetadataModal({ isOpen, doc, onClose, onSave, onReplaceFile }) {
  const [form, setForm] = useState({ title: '', category: '', machine: '', version: '', description: '', tags: '', content: '' });
  const [errors, setErrors] = useState({});
  const [showDiscardModal, setShowDiscardModal] = useState(false);

  React.useEffect(() => {
    if (doc) {
      setForm({
        title: doc.title || '',
        category: doc.category || '',
        machine: doc.machine || '',
        version: doc.version || '',
        description: doc.description || '',
        tags: (doc.tags || []).join(', '),
        content: doc.content || '',
      });
      setErrors({});
      setShowDiscardModal(false);
    }
  }, [doc, isOpen]);

  if (!isOpen || !doc) return null;

  const hasChanges = Boolean(
    doc && (
      form.title !== (doc.title || '') ||
      form.category !== (doc.category || '') ||
      form.machine !== (doc.machine || '') ||
      form.version !== (doc.version || '') ||
      form.description !== (doc.description || '') ||
      form.tags !== ((doc.tags || []).join(', ')) ||
      form.content !== (doc.content || '')
    )
  );

  const handleAttemptClose = () => {
    if (hasChanges) {
      setShowDiscardModal(true);
    } else {
      handleForceClose();
    }
  };

  const handleForceClose = () => {
    setShowDiscardModal(false);
    setErrors({});
    onClose();
  };

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    if (!form.title.trim()) {
      setErrors({ title: 'Document title is required.' });
      return;
    }
    setErrors({});
    // Metadata-only edits are non-disruptive: directly save without confirmation modal or re-triggering pipeline
    onSave(form);
  };

  return (
    <>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px]">
        <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-bold text-gray-900">Edit Metadata</h2>
            <button onClick={handleAttemptClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 cursor-pointer"><X size={20} /></button>
          </div>
          <div className="px-6 py-4 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Document Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.title}
                onChange={e => {
                  setForm({ ...form, title: e.target.value });
                  if (errors.title) setErrors((prev) => ({ ...prev, title: '' }));
                }}
                className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition-all ${errors.title
                    ? 'border-red-500 focus:ring-2 focus:ring-red-200'
                    : 'border-gray-200 focus:border-transparent focus:ring-2 focus:ring-[#252578]'
                  }`}
              />
              {errors.title && (
                <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                  <AlertTriangle size={12} />
                  {errors.title}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Category <span className="text-red-500">*</span>
                  </label>
                  <div className="relative group inline-flex items-center">
                    <Info size={14} className="text-gray-400 hover:text-[#252578] transition-colors cursor-pointer" />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-50 w-56 p-2 bg-gray-900 text-white text-[11px] rounded-lg shadow-lg pointer-events-none text-center leading-normal">
                      Category determines which chatbot topics this article will be used to answer.
                      <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900" />
                    </div>
                  </div>
                </div>
                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578] bg-white">
                  {MOCK_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Machine Model</label>
                <select value={form.machine} onChange={e => setForm({ ...form, machine: e.target.value })} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578] bg-white">
                  {MOCK_MACHINES.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Version</label>
                <input type="text" value={form.version} onChange={e => setForm({ ...form, version: e.target.value })} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578]" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Tags</label>
                <input type="text" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578]" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Description</label>
              <textarea rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578] resize-none" />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Article Content & Instructions
                </label>
                <span className="text-[10px] text-gray-400">
                  {form.content ? form.content.trim().split(/\s+/).filter(Boolean).length : 0} words
                </span>
              </div>
              <textarea
                rows={6}
                value={form.content}
                onChange={e => setForm({ ...form, content: e.target.value })}
                className="w-full font-mono text-xs leading-relaxed rounded-lg border border-gray-200 px-3 py-2 outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578]"
                placeholder="Markdown formatted procedure steps..."
              />
            </div>

            {/* Replace Existing File section */}
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/70 p-3.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-[#252578] font-bold text-xs shadow-xs">
                  {doc.fileType || 'PDF'}
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-800">{doc.title}.{(doc.fileType || 'pdf').toLowerCase()}</p>
                  <p className="text-[11px] text-gray-400">{doc.size || '1.0 MB'} · Uploaded by {doc.uploadedBy || 'Super Admin'}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  if (onReplaceFile) onReplaceFile(doc);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#252578]/20 bg-white text-xs font-semibold text-[#252578] hover:bg-[#252578]/5 transition cursor-pointer shadow-xs"
              >
                <RefreshCw size={12} />
                Replace File
              </button>
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
            <button onClick={handleAttemptClose} className="px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-100 transition-all cursor-pointer">Cancel</button>
            <button onClick={handleSubmit} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#252578] hover:bg-[#1f1f66] transition-all cursor-pointer">Save Changes</button>
          </div>
        </div>
      </div>

      <DiscardConfirmModal
        isOpen={showDiscardModal}
        onClose={() => setShowDiscardModal(false)}
        onConfirm={handleForceClose}
        title="Discard Unsaved Metadata Changes?"
        description="You have unsaved changes to this article's metadata. Are you sure you want to discard your changes?"
      />
    </>
  );
}

function AISidePanel({ summary }) {
  return (
    <div className="w-full xl:w-48 bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col flex-shrink-0 self-start">
      <div className="p-3.5 border-b border-gray-100">
        <h3 className="text-xs font-bold text-gray-800">Knowledge Base Status</h3>
      </div>
      <div className="p-3.5 space-y-3.5">
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Documents Indexed</p>
          <p className="text-base font-bold text-gray-800 mt-0.5">{summary?.ready || 0}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Categories</p>
          <p className="text-base font-bold text-gray-800 mt-0.5">{summary?.categories || 0}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">AI Service Status</p>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-green-50 border border-green-200 text-green-700 text-xs font-semibold mt-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Operational
          </span>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Processing</p>
          <p className="text-base font-bold text-gray-800 mt-0.5">{summary?.processing || 0}</p>
        </div>
      </div>
    </div>
  );
}

function AIKnowledgeBase() {
  const normalizeDocs = (rawDocs) => {
    return rawDocs.map((doc, idx) => {
      const publishState = doc.publishState || (
        doc.status === 'Ready'
          ? (doc.id === 1 || doc.id === 2 ? 'Published' : 'Draft')
          : doc.status === 'Archived'
            ? 'Archived'
            : 'Draft'
      );

      return {
        ...doc,
        publishState,
        status: doc.status === 'Processing' ? 'Processing' : (publishState === 'Published' ? 'Ready' : publishState),
        processingStatus: doc.processingStatus || (doc.status === 'Processing' ? 'Processing' : 'Ready for AI Search'),
        history: Array.isArray(doc.history) && doc.history.length > 0 ? doc.history : [
          {
            id: doc.id ? doc.id * 100 + 1 : idx + 100,
            type: 'created',
            timestamp: doc.uploadDate ? (String(doc.uploadDate).length === 10 ? `${doc.uploadDate} 09:00` : String(doc.uploadDate).substring(0, 16).replace('T', ' ')) : '2026-06-15 09:00',
            actor: doc.uploadedBy || 'Super Admin',
          },
        ],
      };
    });
  };

  const [documents, setDocuments] = useState(() => {
    try {
      const stored = localStorage.getItem('ai_kb_documents');
      if (stored) return normalizeDocs(JSON.parse(stored));
    } catch { }
    return MOCK_DOCUMENTS;
  });
  const [activeTab, setActiveTab] = useState('draft'); // 'draft' | 'published'
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterMachine, setFilterMachine] = useState('');
  const [filterFileType, setFilterFileType] = useState('');
  const [sortOrder, setSortOrder] = useState('newest');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadModalMode, setUploadModalMode] = useState('manual');
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showCategories, setShowCategories] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [selectedDocs, setSelectedDocs] = useState([]);
  const [deleteBlockedMsg, setDeleteBlockedMsg] = useState('');
  const [publishBlockedMsg, setPublishBlockedMsg] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteModalError, setDeleteModalError] = useState('');

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      try {
        const res = await aiKbClient.get('/articles');
        if (res.data?.success && Array.isArray(res.data.data)) {
          const mapped = res.data.data.map((item) => {
            const publishState = item.status;
            return {
              id: item.id,
              title: item.title,
              category: item.category,
              machine: item.machine || 'No Machine',
              version: item.version || '1.0',
              fileType: item.file_type || 'PDF',
              size: item.size || item.file_size || '1.0 MB',
              uploadedBy: item.uploaded_by || 'Super Admin',
              uploadDate: fileUploadedAt(item) || '2026-06-15',
              status: publishState === 'Published' ? 'Ready' : publishState,
              publishState,
              processingStatus: item.processing_status || (publishState === 'Published' ? 'Ready for AI Search' : 'Ready'),
              tags: Array.isArray(item.tags) ? item.tags : [],
              description: item.description || '',
              content: item.content || '',
              file_path: item.file_path || null,
              chunks_count: item.chunks_count ?? 0,
              embeddings_count: item.embeddings_count ?? 0,
              ...indexingFields(item),
              history: Array.isArray(item.history) && item.history.length > 0 ? item.history : [
                {
                  id: item.id * 100 + 1,
                  type: 'created',
                  timestamp: item.created_at ? item.created_at.substring(0, 16).replace('T', ' ') : '2026-06-15 09:00',
                  actor: item.uploaded_by || 'Super Admin',
                },
              ],
            };
          });
          setDocuments(mapped);
          try { localStorage.setItem('ai_kb_documents', JSON.stringify(mapped)); } catch { }
          return;
        }
      } catch (err) {
        console.warn('Could not fetch KB articles from AI-service API, using local fallback:', err);
      }

      try {
        const stored = localStorage.getItem('ai_kb_documents');
        if (stored) {
          setDocuments(normalizeDocs(JSON.parse(stored)));
        } else {
          setDocuments(MOCK_DOCUMENTS);
          localStorage.setItem('ai_kb_documents', JSON.stringify(MOCK_DOCUMENTS));
        }
      } catch {
        setDocuments(MOCK_DOCUMENTS);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  // Real-time event bus listener for knowledge-base broadcast events
  useEffect(() => {
    try {
      const channel = echo.channel('knowledge-base');
      const handleArticleDeleted = (payload) => {
        if (payload?.article_id) {
          setDocuments((prev) => {
            const next = prev.filter(d => d.id !== payload.article_id);
            try { localStorage.setItem('ai_kb_documents', JSON.stringify(next)); } catch {}
            return next;
          });
        }
      };

      channel.listen('.article.deleted', handleArticleDeleted);
      channel.listen('.article.published', () => fetchDocuments());
      channel.listen('.article.archived', () => fetchDocuments());

      return () => {
        channel.stopListening('.article.deleted');
        channel.stopListening('.article.published');
        channel.stopListening('.article.archived');
      };
    } catch (e) {
      console.warn('Echo knowledge-base subscription notice:', e);
    }
  }, [fetchDocuments]);

  const draftCount = useMemo(() => documents.filter(d => (d.publishState || d.status) !== 'Published' && d.status !== 'Ready').length, [documents]);
  const publishedCount = useMemo(() => documents.filter(d => (d.publishState || d.status) === 'Published' || d.status === 'Ready').length, [documents]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setFilterStatus('');
  };

  const filteredDocs = useMemo(() => {
    let docs = [...documents];
    if (activeTab === 'published') {
      docs = docs.filter(d => (d.publishState || d.status) === 'Published' || d.status === 'Ready');
    } else {
      docs = docs.filter(d => (d.publishState || d.status) !== 'Published' && d.status !== 'Ready');
    }
    if (search) { const q = search.toLowerCase(); docs = docs.filter(d => d.title.toLowerCase().includes(q) || (d.description || '').toLowerCase().includes(q) || (d.tags || []).some(t => t.includes(q))); }
    if (filterCategory) docs = docs.filter(d => d.category === filterCategory);
    if (filterStatus) {
      if (filterStatus === 'Processing') {
        docs = docs.filter(d => isIndexingInProgress(d));
      } else {
        docs = docs.filter(d => (d.publishState || d.status) === filterStatus || (filterStatus === 'Published' && d.status === 'Ready'));
      }
    }
    if (filterMachine) docs = docs.filter(d => d.machine === filterMachine);
    if (filterFileType) docs = docs.filter(d => d.fileType === filterFileType);
    docs.sort((a, b) => sortOrder === 'newest' ? new Date(b.uploadDate) - new Date(a.uploadDate) : new Date(a.uploadDate) - new Date(b.uploadDate));
    return docs;
  }, [documents, activeTab, search, filterCategory, filterStatus, filterMachine, filterFileType, sortOrder]);

  const summary = useMemo(() => ({
    total: documents.length,
    published: documents.filter(d => (d.publishState || d.status) === 'Published' || d.status === 'Ready').length,
    draft: documents.filter(d => (d.publishState || d.status) === 'Draft').length,
    archived: documents.filter(d => (d.publishState || d.status) === 'Archived').length,
    processing: documents.filter(d => isIndexingInProgress(d)).length,
    categories: MOCK_CATEGORIES.length,
  }), [documents]);

  const allFileTypes = useMemo(() => [...new Set(documents.map(d => d.fileType).filter(Boolean))], [documents]);

  const handleDocumentCreated = (newDoc) => {
    if (Array.isArray(newDoc)) {
      setDocuments((prev) => {
        const next = [...newDoc, ...prev];
        try {
          localStorage.setItem('ai_kb_documents', JSON.stringify(next));
        } catch (err) {
          console.error('Failed to save document to localStorage:', err);
        }
        return next;
      });
      fetchDocuments();
      return;
    }

    setDocuments((prev) => {
      const next = [newDoc, ...prev];
      try {
        localStorage.setItem('ai_kb_documents', JSON.stringify(next));
      } catch (err) {
        console.error('Failed to save document to localStorage:', err);
      }
      return next;
    });

    // Synchronize document creation and RAG indexing with AI-service backend
    aiKbClient.post('/articles', {
      title: newDoc.title,
      category: newDoc.category,
      machine: newDoc.machine,
      version: newDoc.version,
      file_type: newDoc.fileType,
      file_size: newDoc.size,
      status: newDoc.publishState || (newDoc.status === 'Ready' ? 'Published' : newDoc.status) || 'Draft',
      tags: newDoc.tags,
      description: newDoc.description,
      content: newDoc.description || newDoc.title,
    }).then((res) => {
      if (res.data?.data?.id) {
        const backendDoc = res.data.data;
        setDocuments((prev) => prev.map((d) => d.id === newDoc.id ? { ...d, id: backendDoc.id } : d));
      }
    }).catch((err) => {
      console.warn('Failed to sync created document with AI service:', err);
    });
  };

  const handleView = (doc) => {
    setSelectedDoc(doc);
    setShowDetailModal(true);
    if (doc?.id) {
      axiosInstance.get(`${AI_API_URL}/articles/${doc.id}`, { baseURL: '' })
        .then((res) => {
          if (res.data?.success && res.data?.data) {
            const fresh = res.data.data;
            setSelectedDoc((prev) => ({
              ...prev,
              content: fresh.content || prev?.content || '',
              description: fresh.description || prev?.description || '',
              file_path: fresh.file_path || prev?.file_path || null,
              chunks_count: fresh.chunks_count ?? prev?.chunks_count,
              embeddings_count: fresh.embeddings_count ?? prev?.embeddings_count,
              processingStatus: fresh.processing_status || prev?.processingStatus,
              ...indexingFields(fresh),
              history: fresh.history || prev?.history || [],
            }));
          }
        })
        .catch((err) => console.warn('Could not fetch latest article content:', err));
    }
  };
  const handleEdit = (doc) => { setSelectedDoc(doc); setShowEditModal(true); };
  const handleDelete = (doc) => {
    if (isIndexingInProgress(doc)) {
      setDeleteBlockedMsg('This article is currently being processed and cannot be deleted until that finishes.');
      return;
    }
    setDeleteBlockedMsg('');
    setDeleteModalError('');
    setSelectedDoc(doc);
    setShowDeleteModal(true);
  };
  const handleReplace = (doc) => { setSelectedDoc(doc); setShowReplaceModal(true); };

  // TS080: Publish action (Draft/Archived -> Published)
  // Direct state update (no confirmation modal needed per spec).
  // Blocked if content was not successfully processed (processingStatus !== 'Ready for AI Search').
  const handlePublish = async (doc) => {
    if (!doc) return;
    const isReady = (doc.processingStatus === 'Ready for AI Search' || doc.processingStatus === 'Ready') && doc.status !== 'Processing';
    if (!isReady) {
      setPublishBlockedMsg("This article's content hasn't been successfully processed yet. Fix or replace the file before publishing.");
      return;
    }

    setPublishBlockedMsg('');
    const now = new Date().toISOString();
    const historyEntry = {
      id: Date.now(),
      type: 'published',
      timestamp: now,
      actor: 'Super Admin',
    };

    const previousDocs = documents;

    // Immediate optimistic update
    setDocuments((prev) => {
      const next = prev.map(d => d.id === doc.id ? {
        ...d,
        publishState: 'Published',
        status: 'Ready',
        history: [historyEntry, ...(d.history || [])],
      } : d);
      try { localStorage.setItem('ai_kb_documents', JSON.stringify(next)); } catch { }
      return next;
    });

    setSelectedDoc((prev) => (prev && prev.id === doc.id) ? {
      ...prev,
      publishState: 'Published',
      status: 'Ready',
      history: [historyEntry, ...(prev.history || [])],
    } : prev);

    // Synchronize publish state immediately to AI-service backend
    try {
      const res = await aiKbClient.post(`/articles/${doc.id}/publish`, {
        actor: 'Super Admin',
      });
      if (res.data?.success && res.data?.data) {
        const backendDoc = res.data.data;
        const normalized = {
          ...doc,
          ...backendDoc,
          status: backendDoc.publishState === 'Published' || backendDoc.status === 'Published' ? 'Ready' : backendDoc.status,
          publishState: backendDoc.publishState || 'Published',
          processingStatus: backendDoc.processing_status || doc.processingStatus,
          ...indexingFields(backendDoc),
          history: Array.isArray(backendDoc.history) && backendDoc.history.length > 0 ? backendDoc.history : [historyEntry, ...(doc.history || [])],
        };
        setDocuments((prev) => {
          const next = prev.map(d => d.id === doc.id ? normalized : d);
          try { localStorage.setItem('ai_kb_documents', JSON.stringify(next)); } catch { }
          return next;
        });
        setSelectedDoc((prev) => (prev && prev.id === doc.id) ? normalized : prev);

        // Spec 0036 (AC-5): published, but its own title and description did not rank it highly.
        if (res.data?.low_retrievability) {
          setPublishBlockedMsg(
            `"${doc.title}" is published, but the AI may struggle to find it (match score ${formatProbeScore(res.data?.probe?.score)}). ` +
            'Try a clearer title or description that uses the words customers would use.'
          );
        }
      }
    } catch (err) {
      console.warn('Failed to publish article on AI service:', err);
      const errMsg = err.response?.data?.error_code === 'NOT_INDEXED'
        ? "This article isn't indexed for AI search yet. Wait for indexing to finish, or use Retry Indexing if it failed, then publish again."
        : (err.response?.data?.message || "Failed to publish article. Please ensure document content is processed.");
      setPublishBlockedMsg(errMsg);
      // Revert optimistic update
      setDocuments(previousDocs);
      try { localStorage.setItem('ai_kb_documents', JSON.stringify(previousDocs)); } catch { }
      setSelectedDoc(doc);
    }
  };

  // Spec 0036: Retry for "Indexing failed" (POST /articles/{id}/reindex).
  // A Published article keeps serving its previous version to the AI while this runs.
  const [retryingIds, setRetryingIds] = useState([]);
  const applyBackendIndexState = (docId, backendDoc) => {
    const patch = {
      processingStatus: backendDoc?.processing_status,
      ...indexingFields(backendDoc),
      ...(Array.isArray(backendDoc?.history) && backendDoc.history.length > 0 ? { history: backendDoc.history } : {}),
    };
    setDocuments((prev) => prev.map(d => d.id === docId ? { ...d, ...patch } : d));
    setSelectedDoc((prev) => (prev && prev.id === docId) ? { ...prev, ...patch } : prev);
  };

  const handleRetryIndex = async (doc) => {
    if (!doc || retryingIds.includes(doc.id)) return;
    setRetryingIds((prev) => [...prev, doc.id]);
    setPublishBlockedMsg('');
    try {
      const res = await aiKbClient.post(`/articles/${doc.id}/reindex`);
      if (res.data?.data) applyBackendIndexState(doc.id, res.data.data);
    } catch (err) {
      console.warn('Retry indexing failed:', err);
      if (err.response?.data?.data) applyBackendIndexState(doc.id, err.response.data.data);
      setPublishBlockedMsg(
        err.response?.data?.error_code === 'INDEXING_IN_PROGRESS'
          ? 'This article is already being indexed. Please wait a moment and refresh.'
          : (err.response?.data?.message || 'Indexing failed again. Please try later.')
      );
    } finally {
      setRetryingIds((prev) => prev.filter(id => id !== doc.id));
    }
  };

  // TS080: Archive action (Published -> Archived)
  // Requires confirmation modal (reversible; keeps file and record intact).
  const handleArchivePrompt = (doc) => {
    setSelectedDoc(doc);
    setShowArchiveModal(true);
  };

  const handleConfirmArchive = async () => {
    if (!selectedDoc) return;
    const docToArchive = selectedDoc;
    setShowArchiveModal(false);

    const now = new Date().toISOString();
    const historyEntry = {
      id: Date.now(),
      type: 'archived',
      timestamp: now,
      actor: 'Super Admin',
    };

    const previousDocs = documents;

    // Immediate optimistic update
    setDocuments((prev) => {
      const next = prev.map(d => d.id === docToArchive.id ? {
        ...d,
        publishState: 'Archived',
        status: 'Archived',
        history: [historyEntry, ...(d.history || [])],
      } : d);
      try { localStorage.setItem('ai_kb_documents', JSON.stringify(next)); } catch { }
      return next;
    });

    setSelectedDoc((prev) => (prev && prev.id === docToArchive.id) ? {
      ...prev,
      publishState: 'Archived',
      status: 'Archived',
      history: [historyEntry, ...(prev.history || [])],
    } : prev);

    // Synchronize archive state immediately to AI-service backend
    try {
      const res = await aiKbClient.post(`/articles/${docToArchive.id}/archive`, {
        actor: 'Super Admin',
      });
      if (res.data?.success && res.data?.data) {
        const backendDoc = res.data.data;
        const normalized = {
          ...docToArchive,
          ...backendDoc,
          status: 'Archived',
          publishState: 'Archived',
          history: Array.isArray(backendDoc.history) && backendDoc.history.length > 0 ? backendDoc.history : [historyEntry, ...(docToArchive.history || [])],
        };
        setDocuments((prev) => {
          const next = prev.map(d => d.id === docToArchive.id ? normalized : d);
          try { localStorage.setItem('ai_kb_documents', JSON.stringify(next)); } catch { }
          return next;
        });
        setSelectedDoc((prev) => (prev && prev.id === docToArchive.id) ? normalized : prev);
      }
    } catch (err) {
      console.warn('Failed to archive article on AI service:', err);
      // Revert optimistic update
      setDocuments(previousDocs);
      try { localStorage.setItem('ai_kb_documents', JSON.stringify(previousDocs)); } catch { }
      setSelectedDoc(docToArchive);
    }
  };

  // Metadata-only edit handler:
  // Non-disruptive, NO confirmation modal, NO pipeline re-triggering.
  // Appends { type: 'metadata', timestamp, actor: 'Super Admin' } to document's history.
  const handleSaveEdit = (form) => {
    if (!selectedDoc) return;
    const now = new Date().toISOString();
    const historyEntry = {
      id: Date.now(),
      type: 'metadata',
      timestamp: now,
      actor: 'Super Admin',
    };

    setDocuments((prev) => {
      const next = prev.map(d => d.id === selectedDoc.id ? {
        ...d,
        title: form.title.trim(),
        category: form.category,
        machine: form.machine,
        version: form.version.trim(),
        tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
        description: form.description.trim(),
        content: form.content ?? d.content,
        history: [historyEntry, ...(d.history || [])],
      } : d);
      try { localStorage.setItem('ai_kb_documents', JSON.stringify(next)); } catch { }
      return next;
    });

    setSelectedDoc((prev) => prev ? {
      ...prev,
      title: form.title.trim(),
      category: form.category,
      machine: form.machine,
      version: form.version.trim(),
      tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      description: form.description.trim(),
      content: form.content ?? prev.content,
      history: [historyEntry, ...(prev.history || [])],
    } : null);

    setShowEditModal(false);

    // Sync metadata and content updates to AI-service backend
    aiKbClient.put(`/articles/${selectedDoc.id}`, {
      title: form.title.trim(),
      category: form.category,
      machine: form.machine,
      version: form.version.trim(),
      tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      description: form.description.trim(),
      content: form.content,
    }).catch((err) => {
      console.warn('Failed to update article on AI service:', err);
    });
  };

  // File replacement completion handler:
  // Updates file details, upload date, processing status, and appends { type: 'file_replacement', ... } to history.
  const handleReplaceComplete = (docId, newFileOrData) => {
    const isBackendData = newFileOrData && typeof newFileOrData === 'object' && ('fileType' in newFileOrData || 'file_type' in newFileOrData);
    if (!isBackendData) {
      aiKbClient.post(`/articles/${docId}/reindex`, { actor: 'Super Admin' }).catch((err) => {
        console.warn('Article reindex notice:', err);
      });
    }
    const now = new Date().toISOString();

    setDocuments((prev) => {
      const next = prev.map((d) => {
        if (d.id !== docId) return d;
        if (isBackendData) {
          return {
            ...d,
            ...newFileOrData,
            fileType: newFileOrData.fileType || newFileOrData.file_type || d.fileType,
            size: newFileOrData.size || d.size,
            content: newFileOrData.content || d.content,
            description: newFileOrData.description || d.description,
            file_path: newFileOrData.file_path || d.file_path,
            uploadDate: now,
            processingStatus: 'Ready for AI Search',
            history: newFileOrData.history || d.history,
          };
        }
        const historyEntry = {
          id: Date.now(),
          type: 'file_replacement',
          timestamp: now,
          actor: 'Super Admin',
          fileName: newFileOrData?.name || 'replacement_file',
          fileSize: newFileOrData?.size ? `${(newFileOrData.size / (1024 * 1024)).toFixed(1)} MB` : d.size,
        };
        return {
          ...d,
          fileType: newFileOrData?.name ? newFileOrData.name.split('.').pop()?.toUpperCase() : d.fileType,
          size: newFileOrData?.size ? `${(newFileOrData.size / (1024 * 1024)).toFixed(1)} MB` : d.size,
          uploadDate: now,
          processingStatus: 'Ready for AI Search',
          history: [historyEntry, ...(d.history || [])],
        };
      });
      try { localStorage.setItem('ai_kb_documents', JSON.stringify(next)); } catch { }
      return next;
    });

    setSelectedDoc((prev) => {
      if (!prev || prev.id !== docId) return prev;
      if (isBackendData) {
        return {
          ...prev,
          ...newFileOrData,
          fileType: newFileOrData.fileType || newFileOrData.file_type || prev.fileType,
          size: newFileOrData.size || prev.size,
          content: newFileOrData.content || prev.content,
          description: newFileOrData.description || prev.description,
          file_path: newFileOrData.file_path || prev.file_path,
          uploadDate: now,
          processingStatus: 'Ready for AI Search',
          history: newFileOrData.history || prev.history,
        };
      }
      const historyEntry = {
        id: Date.now(),
        type: 'file_replacement',
        timestamp: now,
        actor: 'Super Admin',
        fileName: newFileOrData?.name || 'replacement_file',
        fileSize: newFileOrData?.size ? `${(newFileOrData.size / (1024 * 1024)).toFixed(1)} MB` : prev.size,
      };
      return {
        ...prev,
        fileType: newFileOrData?.name ? newFileOrData.name.split('.').pop()?.toUpperCase() : prev.fileType,
        size: newFileOrData?.size ? `${(newFileOrData.size / (1024 * 1024)).toFixed(1)} MB` : prev.size,
        uploadDate: now,
        processingStatus: 'Ready for AI Search',
        history: [historyEntry, ...(prev.history || [])],
      };
    });

    if (!isBackendData && newFileOrData?.name) {
      aiKbClient.put(`/articles/${docId}`, {
        file_type: newFileOrData.name.split('.').pop()?.toUpperCase() || 'PDF',
        size: newFileOrData.size ? `${(newFileOrData.size / (1024 * 1024)).toFixed(1)} MB` : '1.0 MB',
        processing_status: 'Ready for AI Search',
      }).catch((err) => {
        console.warn('Failed to sync replaced file metadata with AI service:', err);
      });
    }

    fetchDocuments();
    setShowReplaceModal(false);
  };

  // Dynamic processing status updater while replacement is mid-pipeline:
  // SIMULATED: Models the spec requirement that the chatbot keeps serving old content until new content is ready.
  // While replacement is mid-pipeline, the document's publish status (d.status) remains visibly unaffected,
  // while only the processingStatus updates to "Processing".
  const handleProcessingStatusChange = (docId, newProcessingStatus) => {
    setDocuments((prev) => {
      const next = prev.map(d => d.id === docId ? {
        ...d,
        processingStatus: newProcessingStatus,
      } : d);
      try { localStorage.setItem('ai_kb_documents', JSON.stringify(next)); } catch { }
      return next;
    });

    setSelectedDoc((prev) => (prev && prev.id === docId) ? {
      ...prev,
      processingStatus: newProcessingStatus,
    } : prev);
  };

  const handleConfirmDelete = async () => {
    if (!selectedDoc) return;
    const docToDelete = selectedDoc;

    if (isIndexingInProgress(docToDelete)) {
      setDeleteModalError('Cannot delete article while an extraction or indexing process is currently in progress. Please wait for the process to complete or cancel it.');
      setDeleteBlockedMsg('Cannot delete article while an extraction or indexing process is currently in progress.');
      return;
    }

    setIsDeleting(true);
    setDeleteModalError('');

    try {
      await aiKbClient.delete(`/articles/${docToDelete.id}`, {
        data: { actor: 'Super Admin' },
      });

      // Synchronize state immediately
      setDocuments((prev) => {
        const next = prev.filter(d => d.id !== docToDelete.id);
        try { localStorage.setItem('ai_kb_documents', JSON.stringify(next)); } catch { }
        return next;
      });

      setShowDeleteModal(false);
      setSelectedDoc(null);
      setIsDeleting(false);

      // Append audit log entry matching ticket_audit_logs shape
      try {
        const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const simulatedLogEntry = {
          id: `kb-del-${Date.now()}`,
          timestamp: now,
          user: 'Super Admin',
          role: 'Super Admin',
          action: 'Deleted',
          module: 'Knowledge Base',
          target: docToDelete.title,
          details: `Permanently deleted knowledge article "${docToDelete.title}" and purged active RAG index.`,
        };

        const existingLogs = JSON.parse(localStorage.getItem('superadmin_simulated_audit_logs') || '[]');
        const updatedLogs = [simulatedLogEntry, ...existingLogs];
        localStorage.setItem('superadmin_simulated_audit_logs', JSON.stringify(updatedLogs));
      } catch (err) {
        console.error('Failed to append to audit logs:', err);
      }
    } catch (err) {
      console.warn('Failed to delete article on AI service:', err);
      const errMsg = err.response?.data?.message || 'Failed to delete article. Please try again.';
      setDeleteModalError(errMsg);
      setDeleteBlockedMsg(errMsg);
      setIsDeleting(false);
    }
  };

  const toggleSelectDoc = (id) => {
    setSelectedDocs(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        pattern="B"
        title="AI Knowledge Base"
        subtitle="Manage documents for the AI Support Assistant"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setShowCategories(true)}
            >
              <FolderOpen size={16} />
              Categories
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setUploadModalMode('file');
                setShowUploadModal(true);
              }}
            >
              <Upload size={16} />
              Upload Document
            </Button>
            <Button
              variant="default"
              onClick={() => {
                setUploadModalMode('manual');
                setShowUploadModal(true);
              }}
              className="bg-[#252578] hover:bg-[#1f1f66] text-white gap-1.5"
            >
              <Plus size={16} />
              Create Article
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={FileText} label="Total Documents" value={summary.total} bgClass="bg-purple-100 text-purple-700" sub={`${summary.draft} draft · ${summary.published} published`} />
        <StatCard icon={FileText} label="Drafts" value={summary.draft} bgClass="bg-amber-100 text-amber-700" />
        <StatCard icon={CheckCircle} label="Published" value={summary.published} bgClass="bg-green-100 text-green-700" />
        <StatCard icon={Archive} label="Archived" value={summary.archived} bgClass="bg-gray-100 text-gray-700" />
      </div>

      {publishBlockedMsg && (
        <div className="flex items-center justify-between p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-600 flex-shrink-0" />
            <span>{publishBlockedMsg}</span>
          </div>
          <button
            onClick={() => setPublishBlockedMsg('')}
            className="p-1 text-amber-600 hover:text-amber-800 rounded-lg hover:bg-amber-100 cursor-pointer"
            title="Dismiss"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {deleteBlockedMsg && (
        <div className="flex items-center justify-between p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-600 flex-shrink-0" />
            <span>{deleteBlockedMsg}</span>
          </div>
          <button
            onClick={() => setDeleteBlockedMsg('')}
            className="p-1 text-amber-600 hover:text-amber-800 rounded-lg hover:bg-amber-100 cursor-pointer"
            title="Dismiss"
          >
            <X size={16} />
          </button>
        </div>
      )}

      <div className="flex flex-col xl:flex-row gap-5 items-start">
        <div className="flex-1 min-w-0 w-full">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            {/* Tabs: Draft & Published */}
            <div className="flex border-b border-gray-200 px-4 pt-3 gap-2 bg-white">
              <button
                type="button"
                onClick={() => handleTabChange('draft')}
                className={`pb-3 px-4 text-xs font-bold transition-all border-b-2 -mb-px flex items-center gap-2 cursor-pointer ${
                  activeTab === 'draft'
                    ? 'border-[#252578] text-[#252578]'
                    : 'border-transparent text-muted-slate hover:text-dark-slate'
                }`}
              >
                Draft
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                  activeTab === 'draft' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-muted-slate'
                }`}>
                  {draftCount}
                </span>
              </button>
              <button
                type="button"
                onClick={() => handleTabChange('published')}
                className={`pb-3 px-4 text-xs font-bold transition-all border-b-2 -mb-px flex items-center gap-2 cursor-pointer ${
                  activeTab === 'published'
                    ? 'border-[#252578] text-[#252578]'
                    : 'border-transparent text-muted-slate hover:text-dark-slate'
                }`}
              >
                Published
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                  activeTab === 'published' ? 'bg-[#252578]/10 text-[#252578]' : 'bg-slate-100 text-muted-slate'
                }`}>
                  {publishedCount}
                </span>
              </button>
            </div>

            {/* Filters Toolbar */}
            <div className="p-4 border-b border-gray-100 space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search documents..."
                    className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-gray-200 text-xs outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578]"
                  />
                </div>
                <select
                  value={filterCategory}
                  onChange={e => setFilterCategory(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578] bg-white text-dark-slate"
                >
                  <option value="">All Categories</option>
                  {MOCK_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578] bg-white text-dark-slate"
                >
                  <option value="">All Statuses</option>
                  {activeTab === 'draft' ? (
                    <>
                      <option value="Draft">Draft</option>
                      <option value="Archived">Archived</option>
                    </>
                  ) : (
                    <option value="Published">Published</option>
                  )}
                </select>
                <select
                  value={filterFileType}
                  onChange={e => setFilterFileType(e.target.value)}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs outline-none focus:border-transparent focus:ring-2 focus:ring-[#252578] bg-white text-dark-slate"
                >
                  <option value="">All Types</option>
                  {allFileTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => setSortOrder(s => s === 'newest' ? 'oldest' : 'newest')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-all cursor-pointer"
                >
                  <ArrowUpDown size={13} />
                  {sortOrder === 'newest' ? 'Newest' : 'Oldest'}
                </button>
              </div>
            </div>

            {/* Table Area */}
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader size={20} className="animate-spin text-[#252578]" />
                <span className="ml-2.5 text-xs text-muted-slate">Loading documents...</span>
              </div>
            ) : filteredDocs.length === 0 ? (
              <EmptyState
                onCreate={() => {
                  setUploadModalMode('manual');
                  setShowUploadModal(true);
                }}
                onUpload={() => {
                  setUploadModalMode('file');
                  setShowUploadModal(true);
                }}
                title={activeTab === 'draft' ? "No draft documents found" : "No published documents found"}
                description={
                  activeTab === 'draft'
                    ? "There are currently no draft documents matching your filters."
                    : "There are currently no published documents live for the AI chatbot."
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="text-left px-3 py-2.5 text-[11px] font-bold text-muted-slate uppercase tracking-wider w-8">
                        <input
                          type="checkbox"
                          onChange={e => setSelectedDocs(e.target.checked ? documents.map(d => d.id) : [])}
                          checked={selectedDocs.length === documents.length && documents.length > 0}
                          className="rounded border-gray-300"
                        />
                      </th>
                      <th className="text-left px-3 py-2.5 text-[11px] font-bold text-muted-slate uppercase tracking-wider min-w-[160px]">Document Title</th>
                      <th className="text-left px-3 py-2.5 text-[11px] font-bold text-muted-slate uppercase tracking-wider whitespace-nowrap">Category</th>
                      <th className="text-left px-3 py-2.5 text-[11px] font-bold text-muted-slate uppercase tracking-wider whitespace-nowrap">Machine Model</th>
                      <th className="text-center px-3 py-2.5 text-[11px] font-bold text-muted-slate uppercase tracking-wider whitespace-nowrap">Version</th>
                      <th className="text-center px-3 py-2.5 text-[11px] font-bold text-muted-slate uppercase tracking-wider whitespace-nowrap">File Type</th>
                      <th className="text-left px-3 py-2.5 text-[11px] font-bold text-muted-slate uppercase tracking-wider whitespace-nowrap">Upload Date</th>
                      <th className="text-left px-3 py-2.5 text-[11px] font-bold text-muted-slate uppercase tracking-wider whitespace-nowrap">Status</th>
                      <th className="text-right px-3 py-2.5 text-[11px] font-bold text-muted-slate uppercase tracking-wider whitespace-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDocs.map(doc => {
                      const FileIcon = fileTypeIcons[doc.fileType] || FileText;
                      const isMidProcess = isIndexingInProgress(doc) || retryingIds.includes(doc.id);
                      const hasIndexFailed = !isMidProcess && isIndexingFailed(doc);
                      const isPublished = (doc.publishState || doc.status) === 'Published';
                      const canPublish = (doc.processingStatus === 'Ready for AI Search' || doc.processingStatus === 'Ready') && doc.status !== 'Processing';
                      const PublishIcon = publishStateIcons[doc.publishState || 'Draft'] || FileText;
                      const showLowRetrievability = isPublishedDoc(doc) && doc.lowRetrievability && !hasIndexFailed;

                      return (
                        <tr key={doc.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-all">
                          <td className="px-3 py-2.5 w-8">
                            <input
                              type="checkbox"
                              checked={selectedDocs.includes(doc.id)}
                              onChange={() => toggleSelectDoc(doc.id)}
                              className="rounded border-gray-300"
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <FileIcon size={15} className="text-muted-slate flex-shrink-0" />
                              <span className="text-xs font-semibold text-dark-slate truncate max-w-[200px] xl:max-w-none" title={doc.title}>
                                {doc.title}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-muted-slate whitespace-nowrap">{doc.category}</td>
                          <td className="px-3 py-2.5 text-xs text-muted-slate whitespace-nowrap">{doc.machine}</td>
                          <td className="px-3 py-2.5 text-xs text-muted-slate whitespace-nowrap text-center">{doc.version || '—'}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-center">
                            <span className="text-[10px] font-semibold text-muted-slate bg-gray-100 px-1.5 py-0.5 rounded">
                              {doc.fileType}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-muted-slate whitespace-nowrap font-medium">{formatUploadDate(doc.uploadDate)}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${publishStateColors[doc.publishState || 'Draft']}`}>
                                {PublishIcon && <PublishIcon size={10} />}
                                {doc.publishState || 'Draft'}
                              </span>
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                  isMidProcess
                                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                                    : hasIndexFailed
                                      ? 'bg-red-50 text-red-700 border-red-200'
                                      : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                }`}
                                title={hasIndexFailed && doc.indexError ? doc.indexError : undefined}
                              >
                                {isMidProcess ? (
                                  <Loader size={10} className="animate-spin" />
                                ) : hasIndexFailed ? (
                                  <AlertTriangle size={10} />
                                ) : (
                                  <CheckCircle size={10} />
                                )}
                                {isMidProcess ? 'Indexing' : hasIndexFailed ? 'Indexing failed' : (doc.processingStatus || 'Ready for AI Search')}
                              </span>
                              {showLowRetrievability && (
                                <span
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border bg-amber-50 text-amber-700 border-amber-200"
                                  title="Its own title and description did not rank it in the AI's top 3 results, or the match score is below the threshold."
                                >
                                  <AlertCircle size={10} />
                                  Published, low retrievability ({formatProbeScore(doc.probeScore)})
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  className="p-1 rounded-lg hover:bg-gray-100 text-muted-slate hover:text-dark-slate transition-all cursor-pointer"
                                  title="Actions"
                                  aria-label="Actions"
                                >
                                  <MoreVertical size={16} />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-36 bg-white">
                                <DropdownMenuItem onClick={() => handleEdit(doc)} className="cursor-pointer text-xs">
                                  <Edit3 size={13} className="mr-2 text-muted-slate" />
                                  <span>Edit</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleView(doc)} className="cursor-pointer text-xs">
                                  <Eye size={13} className="mr-2 text-muted-slate" />
                                  <span>View</span>
                                </DropdownMenuItem>
                                {isPublished ? (
                                  <DropdownMenuItem onClick={() => handleArchivePrompt(doc)} className="cursor-pointer text-xs text-amber-700">
                                    <Archive size={13} className="mr-2 text-amber-600" />
                                    <span>Unpublish</span>
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem
                                    onClick={() => handlePublish(doc)}
                                    disabled={!canPublish}
                                    className={`cursor-pointer text-xs ${canPublish ? 'text-emerald-700' : 'opacity-40'}`}
                                  >
                                    <Globe size={13} className="mr-2 text-emerald-600" />
                                    <span>Publish</span>
                                  </DropdownMenuItem>
                                )}
                                {hasIndexFailed && (
                                  <DropdownMenuItem onClick={() => handleRetryIndex(doc)} className="cursor-pointer text-xs text-red-700">
                                    <RefreshCw size={13} className="mr-2 text-red-600" />
                                    <span>Retry Indexing</span>
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={() => handleReplace(doc)} className="cursor-pointer text-xs">
                                  <RefreshCw size={13} className="mr-2 text-muted-slate" />
                                  <span>Replace</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  destructive
                                  onClick={() => handleDelete(doc)}
                                  disabled={isMidProcess}
                                  className="cursor-pointer text-xs text-red-600 focus:text-red-700 focus:bg-red-50"
                                >
                                  <Trash2 size={13} className="mr-2 text-red-500" />
                                  <span>Delete</span>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="px-4 py-2.5 border-t border-gray-100 flex items-center justify-between text-xs text-muted-slate">
              <span>{filteredDocs.length} of {documents.length} documents</span>
              {selectedDocs.length > 0 && <span>{selectedDocs.length} selected</span>}
            </div>
          </div>
        </div>

        <AISidePanel summary={summary} />
      </div>

      <UploadModal
        isOpen={showUploadModal}
        initialMode={uploadModalMode}
        onClose={() => setShowUploadModal(false)}
        onUploadComplete={handleDocumentCreated}
      />
      <DocumentDetailModal
        isOpen={showDetailModal}
        doc={selectedDoc}
        onClose={() => setShowDetailModal(false)}
        onPublish={handlePublish}
        onArchivePrompt={handleArchivePrompt}
        onRetryIndex={handleRetryIndex}
        isRetrying={selectedDoc ? retryingIds.includes(selectedDoc.id) : false}
        onReplacePrompt={(doc) => {
          setShowDetailModal(false);
          setSelectedDoc(doc);
          setShowReplaceModal(true);
        }}
      />
      <EditMetadataModal
        isOpen={showEditModal}
        doc={selectedDoc}
        onClose={() => setShowEditModal(false)}
        onSave={handleSaveEdit}
        onReplaceFile={(docToReplace) => {
          if (docToReplace) setSelectedDoc(docToReplace);
          setShowEditModal(false);
          setShowReplaceModal(true);
        }}
      />
      <DeleteConfirmModal
        isOpen={showDeleteModal}
        doc={selectedDoc}
        title={selectedDoc?.title}
        isDeleting={isDeleting}
        errorMessage={deleteModalError}
        onClose={() => {
          if (!isDeleting) {
            setShowDeleteModal(false);
            setDeleteModalError('');
          }
        }}
        onConfirm={handleConfirmDelete}
      />
      <ArchiveConfirmModal
        isOpen={showArchiveModal}
        doc={selectedDoc}
        onClose={() => setShowArchiveModal(false)}
        onConfirm={handleConfirmArchive}
      />
      <ReplaceConfirmModal
        isOpen={showReplaceModal}
        doc={selectedDoc}
        onClose={() => setShowReplaceModal(false)}
        onReplaceComplete={handleReplaceComplete}
        onProcessingStatusChange={handleProcessingStatusChange}
      />
      <CategoriesManager isOpen={showCategories} onClose={() => setShowCategories(false)} />
    </div>
  );
}

export default AIKnowledgeBase;
