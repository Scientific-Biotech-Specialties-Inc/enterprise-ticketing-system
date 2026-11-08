import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { getCachedTicketFormOptions, getTicketFormOptions, saveTicketDraft, deleteTicketDraft } from '@/services/ticketService';
import TitleCasingModal from '@/components/TitleCasingModal';
import { formatProperTitleCase, needsProperCasing } from '@/utils/titleCaseUtils';
import { getMaxOpenTicketsLimit } from '@/data/ticketLimitConfig';
import { useAuth } from '@/context/AuthContext';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';

function BoundedSelect({
  value,
  onChange,
  onBlur,
  options = [],
  placeholder = 'Select an option',
  disabled = false,
  hasError = false,
  searchable = false,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef(null);

  const selectedOption = options.find((opt) => String(opt.value) === String(value));

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
        setSearchQuery('');
        onBlur?.();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onBlur]);

  const filteredOptions = searchable && searchQuery.trim()
    ? options.filter((opt) => String(opt.label || '').toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : options;

  return (
    <div ref={containerRef} className="relative w-full min-w-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setIsOpen((prev) => {
            if (prev) {
              setSearchQuery('');
              onBlur?.();
            }
            return !prev;
          });
        }}
        className={`flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border bg-white px-4 py-3 text-left text-sm outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-[#252578] disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer ${
          hasError ? 'border-red-400 bg-red-50' : isOpen ? 'border-[#252578] ring-2 ring-[#252578]/20' : 'border-gray-200'
        }`}
      >
        <span className={`min-w-0 flex-1 truncate ${selectedOption ? 'text-dark-slate font-medium' : 'text-gray-500'}`}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-gray-500 transition-transform duration-150 ${isOpen ? 'rotate-180 text-[#252578]' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
          {(searchable || options.length > 6) && (
            <div className="border-b border-gray-100 p-2 bg-gray-50/60">
              <div className="relative flex items-center">
                <Search className="absolute left-2.5 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search options..."
                  className="w-full rounded-lg border border-gray-200 bg-white pl-8 pr-3 py-1.5 text-xs text-dark-slate outline-none focus:border-[#252578]"
                  autoFocus
                />
              </div>
            </div>
          )}
          <div className="max-h-56 overflow-y-auto p-1">
            <button
              type="button"
              onClick={() => {
                onChange('');
                setIsOpen(false);
                setSearchQuery('');
                onBlur?.();
              }}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs sm:text-sm transition-colors cursor-pointer ${
                !value ? 'bg-[#252578]/10 font-semibold text-[#252578]' : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              <span className="truncate">{placeholder}</span>
              {!value && <Check className="h-3.5 w-3.5 shrink-0 text-[#252578]" />}
            </button>
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs text-gray-400">No matching options found</div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = String(opt.value) === String(value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      onChange(String(opt.value));
                      setIsOpen(false);
                      setSearchQuery('');
                      onBlur?.();
                    }}
                    className={`flex w-full items-start justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs sm:text-sm transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#252578] font-semibold text-white'
                        : 'text-dark-slate hover:bg-[#252578]/5'
                    }`}
                  >
                    <span className="min-w-0 flex-1 break-words leading-snug">{opt.label}</span>
                    {isSelected && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const initialFormData = {
  title: '',
  machine_ID: '',
  problem_category_ID: '',
  description: '',
  created_by: 1,
};

const allowedFileTypes = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
];

const MAX_TITLE_CHARS = 250;
const MAX_DESCRIPTION_CHARS = 500;
const MIN_TITLE_CHARS = 5;
const MIN_DESCRIPTION_CHARS = 20;

export default function TicketModal({
  isOpen,
  onClose,
  onSubmit,
  openTicketsCount = null,
  initialDraft = null,
  onDraftSaved = null,
}) {
  useLockBodyScroll(isOpen);
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [optionsError, setOptionsError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [options, setOptions] = useState({
    equipment_options: [],
    category_options: [],
    machines: [],
    problem_categories: [],
  });
  const [formData, setFormData] = useState(initialFormData);
  const [draftId, setDraftId] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [fileError, setFileError] = useState('');
  const [touched, setTouched] = useState({});
  const [titleCasingData, setTitleCasingData] = useState(null);
  const [showTitleCasingModal, setShowTitleCasingModal] = useState(false);

  const resolveCurrentUserId = () => {
    const authId = user?.client_ID ?? user?.client_id ?? user?.id ?? user?.emp_id;
    if (authId) return Number(authId);
    for (const key of ['auth_user', 'user']) {
      for (const store of [sessionStorage, localStorage]) {
        try {
          const parsed = JSON.parse(store.getItem(key) || 'null');
          const id = parsed?.client_ID ?? parsed?.client_id ?? parsed?.id ?? parsed?.emp_id;
          if (id) return Number(id);
        } catch { /* ignore */ }
      }
    }
    return 1;
  };

  const resolveTargetMyTicketsPath = () => {
    const path = location?.pathname || window.location.pathname || '';
    if (path.startsWith('/cs-manager')) return '/cs-manager/my-tickets';
    if (path.startsWith('/cs')) return '/cs/my-tickets';
    if (path.startsWith('/service-manager')) return '/service-manager/my-tickets';
    if (path.startsWith('/it-manager')) return '/it-manager/my-tickets';
    if (path.startsWith('/employee')) return '/employee/my-tickets';
    return '/my-tickets';
  };

  const touch = (field) => setTouched((prev) => ({ ...prev, [field]: true }));

  const titleChars = formData.title?.length || 0;
  const descriptionChars = formData.description?.length || 0;
  const titleTrimmed = (formData.title || '').trim();
  const descTrimmed = (formData.description || '').trim();
  const titleError = !titleTrimmed
    ? 'Title is required.'
    : titleTrimmed.length < MIN_TITLE_CHARS
    ? `Title must be at least ${MIN_TITLE_CHARS} characters.`
    : titleChars > MAX_TITLE_CHARS
    ? `Title exceeds ${MAX_TITLE_CHARS} characters (${titleChars}).`
    : '';
  const categoryError = !formData.problem_category_ID ? 'Category is required.' : '';
  const equipmentError = !formData.machine_ID ? 'Equipment is required.' : '';
  const descriptionError = !descTrimmed
    ? 'Description is required.'
    : descTrimmed.length < MIN_DESCRIPTION_CHARS
    ? `Description must be at least ${MIN_DESCRIPTION_CHARS} characters.`
    : descriptionChars > MAX_DESCRIPTION_CHARS
    ? `Description exceeds ${MAX_DESCRIPTION_CHARS} characters (${descriptionChars}).`
    : '';

  const resetFormState = () => {
    setFormData(initialFormData);
    setDraftId(null);
    setAttachments([]);
    setFileError('');
    setSubmitError('');
    setTouched({});
    setTitleCasingData(null);
    setShowTitleCasingModal(false);
  };

  useEffect(() => {
    if (!isOpen) return;

    resetFormState();

    if (initialDraft) {
      setDraftId(initialDraft.id ?? null);
      setFormData({
        title: initialDraft.title || '',
        machine_ID: initialDraft.machine_ID ? String(initialDraft.machine_ID) : '',
        problem_category_ID: initialDraft.problem_category_ID ? String(initialDraft.problem_category_ID) : '',
        description: initialDraft.description || '',
        created_by: resolveCurrentUserId(),
      });
    }

    const cachedOptions = getCachedTicketFormOptions();
    if (cachedOptions) {
      setOptions(cachedOptions);
    }

    const loadOptions = async () => {
      if (!cachedOptions) setLoadingOptions(true);
      setOptionsError('');

      try {
        const data = await getTicketFormOptions({ forceRefresh: true });
        setOptions(data);
      } catch (error) {
        const status = error?.response?.status;
        if (status === 401) {
          setOptionsError('Session expired (401). Please log in again, then reopen this form.');
        } else {
          setOptionsError(error?.response?.data?.message || 'Failed to load options.');
        }
      } finally {
        setLoadingOptions(false);
      }
    };

    loadOptions();
  }, [isOpen, initialDraft]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    setFileError('');

    let currentTotal = attachments.reduce((acc, f) => acc + (f.size || 0), 0);
    const validFiles = [];
    for (const file of files) {
      const ext = file.name.split('.').pop().toLowerCase();
      const isAllowed = allowedFileTypes.includes(file.type) || ['pdf', 'png', 'docx', 'doc', 'jpg', 'jpeg'].includes(ext);
      if (!isAllowed) {
        setFileError(`Invalid file type: "${file.name}". Supported formats: PDF, PNG, Word (.docx, .doc).`);
        return;
      }

      if (file.size > 15 * 1024 * 1024) {
        setFileError(`File too large: "${file.name}" (${(file.size / (1024 * 1024)).toFixed(2)} MB). Max size is 15MB per file.`);
        return;
      }

      currentTotal += file.size || 0;
      validFiles.push(file);
    }

    if (currentTotal > 45 * 1024 * 1024) {
      setFileError(`Total attachments size exceeds 45MB limit (${(currentTotal / (1024 * 1024)).toFixed(2)} MB). Please remove some files.`);
      return;
    }

    setAttachments((prev) => [...prev, ...validFiles]);
    event.target.value = '';
  };

  const handleRemoveAttachment = (indexToRemove) => {
    setAttachments((prev) => prev.filter((_, idx) => idx !== indexToRemove));
    const fileInput = document.getElementById('ticket-modal-file-upload');
    if (fileInput) {
      fileInput.value = '';
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    // TS096: Before pre-submission validation block, enforce max open tickets limit if count provided
    const limitConfig = getMaxOpenTicketsLimit();
    if (!limitConfig.isUnlimited && typeof openTicketsCount === 'number' && openTicketsCount >= limitConfig.limit) {
      setSubmitError(`You've reached the maximum number of open tickets (${limitConfig.limit}). Resolve or close an existing ticket before submitting another.`);
      return;
    }

    const titleTrim = (formData.title || '').trim();
    const descTrim = (formData.description || '').trim();
    if (!titleTrim || titleTrim.length < MIN_TITLE_CHARS) {
      setSubmitError(`Title must be at least ${MIN_TITLE_CHARS} characters.`);
      setTouched((p) => ({ ...p, title: true }));
      return;
    }
    if (!descTrim || descTrim.length < MIN_DESCRIPTION_CHARS) {
      setSubmitError(`Description must be at least ${MIN_DESCRIPTION_CHARS} characters.`);
      setTouched((p) => ({ ...p, description: true }));
      return;
    }
    if (!formData.problem_category_ID || !formData.machine_ID) {
      setSubmitError('Please complete all required fields.');
      return;
    }

    const finalTitle = needsProperCasing(titleTrim) ? formatProperTitleCase(titleTrim) : titleTrim;
    setFormData((prev) => ({ ...prev, title: finalTitle }));

    setSubmitError('');
    setIsSubmitting(true);

    try {
      await onSubmit?.({
        ...formData,
        title: finalTitle,
        attachments,
        draftId,
      });
      if (draftId) {
        try {
          await deleteTicketDraft(draftId);
        } catch { /* ignore */ }
      }
      resetFormState();
    } catch (error) {
      setSubmitError(error?.response?.data?.message || error?.message || 'Failed to create ticket. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (isSubmitting || isSavingDraft) {
      return;
    }

    resetFormState();
    onClose();
  };

  const handleSaveAsDraft = async () => {
    if (isSubmitting || isSavingDraft) return;
    setSubmitError('');
    setIsSavingDraft(true);
    try {
      const clientId = resolveCurrentUserId();
      const draftPayload = {
        client_id: clientId,
        title: (formData.title || '').trim() || 'Untitled Draft',
        machine_ID: formData.machine_ID ? Number(formData.machine_ID) : null,
        problem_category_ID: formData.problem_category_ID ? Number(formData.problem_category_ID) : null,
        description: formData.description || '',
        priority_ID: 1,
        attachments: [],
      };
      if (draftId) {
        draftPayload.id = draftId;
      }

      const res = await saveTicketDraft(draftPayload);
      const savedDraft = res?.draft || {
        ...draftPayload,
        id: draftId || Date.now(),
        last_saved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const targetPath = resolveTargetMyTicketsPath();
      resetFormState();
      onClose();
      onDraftSaved?.(savedDraft);
      navigate(`${targetPath}?tab=drafts`, {
        state: { tab: 'drafts', draftSavedAt: Date.now() },
      });
    } catch (error) {
      setSubmitError(error?.response?.data?.message || error?.message || 'Failed to save draft. Please try again.');
    } finally {
      setIsSavingDraft(false);
    }
  };

  const equipmentOptions = options.equipment_options?.length
    ? options.equipment_options
    : options.machines.map((machine) => ({
      value: machine.machine_ID,
      label: `${machine.machine_name} - ${machine.serial_number}`,
    }));

  const categoryOptions = options.category_options?.length
    ? options.category_options
    : options.problem_categories.map((category) => ({
      value: category.problem_category_ID,
      label: category.category_name,
    }));

  const isFormValid = Boolean(
    titleTrimmed.length >= MIN_TITLE_CHARS &&
    titleChars <= MAX_TITLE_CHARS &&
    formData.problem_category_ID &&
    formData.machine_ID &&
    descTrimmed.length >= MIN_DESCRIPTION_CHARS &&
    descriptionChars <= MAX_DESCRIPTION_CHARS
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px] animate-in fade-in duration-200">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto overflow-x-hidden rounded-2xl bg-surface shadow-level-4">
        <div className="flex items-center justify-between border-b border-gray-150 bg-surface px-8 py-6 shrink-0">
          <div>
            <h2 className="text-xl font-bold text-dark-slate">{draftId ? 'Continue Draft Ticket' : 'Create New Ticket'}</h2>
            <p className="mt-1 text-xs text-muted-slate">Submit a new support request for your equipment</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="rounded-full p-2 text-muted-slate transition-colors hover:bg-page hover:text-dark-slate disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6 p-8 text-dark-slate">
          {optionsError && <p className="text-sm text-red-500">{optionsError}</p>}
          {submitError && <p className="text-sm text-red-500">{submitError}</p>}

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Ticket Title</label>
            <div className="relative">
              <input
                name="title"
                type="text"
                required
                placeholder="Brief description of the issue"
                value={formData.title}
                onChange={handleChange}
                onBlur={() => touch('title')}
                disabled={isSubmitting}
                className={`w-full rounded-xl border bg-white px-4 py-3 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-[#252578] ${touched.title && titleError ? 'border-red-400 bg-red-50' : 'border-gray-200'}`}
              />
              <span className={`absolute bottom-3 right-3 text-[10px] ${titleChars > MAX_TITLE_CHARS ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
                {titleChars}/{MAX_TITLE_CHARS}
              </span>
            </div>
            {touched.title && titleError && <p className="mt-1.5 text-xs text-red-500">{titleError}</p>}
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="min-w-0">
              <label className="mb-2 block text-sm font-medium text-gray-700">Category</label>
              <BoundedSelect
                value={formData.problem_category_ID}
                onChange={(val) => setFormData((prev) => ({ ...prev, problem_category_ID: val }))}
                onBlur={() => touch('category')}
                options={categoryOptions}
                placeholder="Select Category"
                disabled={loadingOptions || isSubmitting}
                hasError={Boolean(touched.category && categoryError)}
              />
              {touched.category && categoryError && <p className="mt-1.5 text-xs text-red-500">{categoryError}</p>}
            </div>

            <div className="min-w-0">
              <label className="mb-2 block text-sm font-medium text-gray-700">Equipment Name / ID</label>
              <BoundedSelect
                value={formData.machine_ID}
                onChange={(val) => setFormData((prev) => ({ ...prev, machine_ID: val }))}
                onBlur={() => touch('equipment')}
                options={equipmentOptions}
                placeholder="Select Equipment"
                disabled={loadingOptions || isSubmitting}
                hasError={Boolean(touched.equipment && equipmentError)}
                searchable
              />
              {touched.equipment && equipmentError && <p className="mt-1.5 text-xs text-red-500">{equipmentError}</p>}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Detailed Description</label>
            <textarea
              name="description"
              required
              rows="4"
              placeholder="Please provide as much detail as possible..."
              value={formData.description}
              onChange={handleChange}
              onBlur={() => touch('description')}
              disabled={isSubmitting}
              className={`w-full resize-none rounded-xl border bg-white px-4 py-3 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-[#252578] ${touched.description && descriptionError ? 'border-red-400 bg-red-50' : 'border-gray-200'}`}
            />
            <div className="mt-1 flex justify-end">
              <span className={`text-[10px] ${descriptionChars > MAX_DESCRIPTION_CHARS ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
                {descriptionChars}/{MAX_DESCRIPTION_CHARS}
              </span>
            </div>
            {touched.description && descriptionError && <p className="mt-1.5 text-xs text-red-500">{descriptionError}</p>}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Attachments (Optional)</label>
            <div className="rounded-xl border-2 border-dashed border-gray-300 p-8 text-center transition-colors hover:bg-gray-50">
              <input
                type="file"
                id="ticket-modal-file-upload"
                className="hidden"
                onChange={handleFileChange}
                accept=".pdf,.png,.docx,.doc,.jpg,.jpeg"
                disabled={isSubmitting}
                multiple
              />
              <label htmlFor="ticket-modal-file-upload" className="flex cursor-pointer flex-col items-center">
                <svg className="mb-3 h-10 w-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  />
                </svg>
                <span className="text-sm font-medium text-[#252578]">Click to upload</span>
                <span className="mt-1 text-xs text-gray-500">Supported formats: PDF, PNG, Word (max. 15MB per file, max. 45MB total)</span>
              </label>
            </div>
            {attachments.length > 0 && (
              <div className="mt-3 space-y-2">
                {attachments.map((file, idx) => (
                  <div key={idx} className="rounded-xl border border-gray-200 bg-gray-50 p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm text-green-600">
                      <svg className="h-5 w-5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      <span className="font-semibold truncate max-w-[200px]">{file.name}</span>
                      <span className="text-xs text-gray-400">({(file.size / (1024 * 1024)).toFixed(2)} MB)</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(idx)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {fileError && <p className="mt-2 text-sm text-red-500">{fileError}</p>}
          </div>

          <div className="mt-4 flex flex-wrap justify-end gap-3 border-t border-gray-150 pt-5">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting || isSavingDraft}
              className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-dark-slate hover:bg-page transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveAsDraft}
              disabled={loadingOptions || isSubmitting || isSavingDraft}
              className="rounded-xl border border-[#252578]/30 bg-white px-5 py-2.5 text-sm font-semibold text-[#252578] hover:bg-[#252578]/5 transition cursor-pointer disabled:opacity-50"
            >
              {isSavingDraft ? 'Saving Draft...' : 'Save as Draft'}
            </button>
            <button
              type="submit"
              disabled={loadingOptions || isSubmitting || isSavingDraft || !isFormValid}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-primary px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-brand-deep active:scale-98 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer shadow-level-1"
            >
              {isSubmitting && (
                <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {isSubmitting ? 'Creating Ticket...' : 'Submit Ticket'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}