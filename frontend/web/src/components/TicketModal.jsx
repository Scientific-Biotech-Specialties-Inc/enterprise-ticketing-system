import React, { useEffect, useState } from 'react';
import { getCachedTicketFormOptions, getTicketFormOptions } from '@/services/ticketService';
import TitleCasingModal from '@/components/TitleCasingModal';
import { formatProperTitleCase, needsProperCasing } from '@/utils/titleCaseUtils';
import { getMaxOpenTicketsLimit } from '@/data/ticketLimitConfig';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';
import useMaxFileCount from '@/hooks/useMaxFileCount';

const initialFormData = {
  title: '',
  department_id: 1,
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

export default function TicketModal({ isOpen, onClose, onSubmit, openTicketsCount = null, showDepartmentSelector = false }) {
  useLockBodyScroll(isOpen);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [optionsError, setOptionsError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [options, setOptions] = useState({
    equipment_options: [],
    category_options: [],
    machines: [],
    problem_categories: [],
  });
  const [formData, setFormData] = useState(initialFormData);
  const [attachments, setAttachments] = useState([]);
  const maxFileCount = useMaxFileCount();
  const [fileError, setFileError] = useState('');
  const [touched, setTouched] = useState({});
  const [titleCasingData, setTitleCasingData] = useState(null);
  const [showTitleCasingModal, setShowTitleCasingModal] = useState(false);

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
  // Equipment is required for Service (1) and optional for IT (2).
  const isItDepartment = showDepartmentSelector && Number(formData.department_id) === 2;
  const equipmentError = !isItDepartment && !formData.machine_ID ? 'Equipment is required.' : '';
  const descriptionError = !descTrimmed
    ? 'Description is required.'
    : descTrimmed.length < MIN_DESCRIPTION_CHARS
    ? `Description must be at least ${MIN_DESCRIPTION_CHARS} characters.`
    : descriptionChars > MAX_DESCRIPTION_CHARS
    ? `Description exceeds ${MAX_DESCRIPTION_CHARS} characters (${descriptionChars}).`
    : '';

  const resetFormState = () => {
    setFormData(initialFormData);
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
  }, [isOpen]);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    setFileError('');

    if (attachments.length + files.length > maxFileCount) {
      setFileError(`You can attach a maximum of ${maxFileCount} files.`);
      event.target.value = '';
      return;
    }

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

  const buildSubmitData = () => {
    const { department_id, ...rest } = formData;
    return showDepartmentSelector ? { ...rest, department_id } : rest;
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
    if (!formData.problem_category_ID || (!isItDepartment && !formData.machine_ID)) {
      setSubmitError('Please complete all required fields.');
      return;
    }

    if (needsProperCasing(titleTrim)) {
      const proper = formatProperTitleCase(titleTrim);
      setTitleCasingData({
        original: titleTrim,
        formatted: proper,
      });
      setShowTitleCasingModal(true);
      return;
    }

    setSubmitError('');
    setIsSubmitting(true);

    try {
      await onSubmit?.({
        ...buildSubmitData(),
        title: titleTrim,
        attachments,
      });
      resetFormState();
    } catch (error) {
      setSubmitError(error?.response?.data?.message || error?.message || 'Failed to create ticket. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmTitleCasing = async () => {
    if (!titleCasingData) return;

    const limitConfig = getMaxOpenTicketsLimit();
    if (!limitConfig.isUnlimited && typeof openTicketsCount === 'number' && openTicketsCount >= limitConfig.limit) {
      setShowTitleCasingModal(false);
      setSubmitError(`You've reached the maximum number of open tickets (${limitConfig.limit}). Resolve or close an existing ticket before submitting another.`);
      return;
    }

    const formatted = titleCasingData.formatted;
    setFormData((prev) => ({ ...prev, title: formatted }));
    setShowTitleCasingModal(false);

    setSubmitError('');
    setIsSubmitting(true);

    try {
      await onSubmit?.({
        ...buildSubmitData(),
        title: formatted,
        attachments,
      });
      resetFormState();
    } catch (error) {
      setSubmitError(error?.response?.data?.message || error?.message || 'Failed to create ticket. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (isSubmitting) {
      return;
    }

    resetFormState();
    onClose();
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
    (isItDepartment || formData.machine_ID) &&
    descTrimmed.length >= MIN_DESCRIPTION_CHARS &&
    descriptionChars <= MAX_DESCRIPTION_CHARS
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px] animate-in fade-in duration-200">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-surface shadow-level-4">
        <div className="flex items-center justify-between border-b border-gray-150 bg-surface px-8 py-6 shrink-0">
          <div>
            <h2 className="text-xl font-bold text-dark-slate">Create New Ticket</h2>
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

          {showDepartmentSelector && (
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Department</label>
            <select
              name="department_id"
              value={formData.department_id}
              onChange={(event) => setFormData((prev) => ({ ...prev, department_id: Number(event.target.value) }))}
              disabled={isSubmitting}
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-[#252578]"
            >
              <option value={1}>Service</option>
              <option value={2}>IT</option>
            </select>
          </div>
          )}

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Category</label>
              <select
                name="problem_category_ID"
                required
                value={formData.problem_category_ID}
                onChange={handleChange}
                onBlur={() => touch('category')}
                disabled={loadingOptions || isSubmitting}
                className={`w-full rounded-xl border bg-white px-4 py-3 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-[#252578] ${touched.category && categoryError ? 'border-red-400 bg-red-50' : 'border-gray-200'}`}
              >
                <option value="">Select Category</option>
                {categoryOptions.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </select>
              {touched.category && categoryError && <p className="mt-1.5 text-xs text-red-500">{categoryError}</p>}
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Equipment Name / ID{isItDepartment && <span className="ml-1 text-xs font-normal text-muted-slate">(Optional for IT)</span>}</label>
              <select
                name="machine_ID"
                required={!isItDepartment}
                value={formData.machine_ID}
                onChange={handleChange}
                onBlur={() => touch('equipment')}
                disabled={loadingOptions || isSubmitting}
                className={`w-full rounded-xl border bg-white px-4 py-3 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-[#252578] ${touched.equipment && equipmentError ? 'border-red-400 bg-red-50' : 'border-gray-200'}`}
              >
                <option value="">{isItDepartment ? 'No equipment' : 'Select Equipment'}</option>
                {equipmentOptions.map((machine) => (
                  <option key={machine.value} value={machine.value}>
                    {machine.label}
                  </option>
                ))}
              </select>
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

          <div className="mt-4 flex justify-end gap-3 border-t border-gray-150 pt-5">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-dark-slate hover:bg-page transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loadingOptions || isSubmitting || !isFormValid}
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