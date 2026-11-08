import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { updateEmployeeTicket } from '@/services/ticketService';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';
import useMaxFileCount from '@/hooks/useMaxFileCount';

function ProofFileItem({ file, onRemove }) {
  const [previewUrl, setPreviewUrl] = useState(null);

  useEffect(() => {
    const ext = file.name.split('.').pop().toLowerCase();
    const isImg = ['png', 'jpg', 'jpeg', 'gif'].includes(ext);
    if (isImg) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    }
  }, [file]);

  return (
    <div className="flex justify-between items-center text-[10px] text-gray-600 font-semibold bg-gray-50 p-2 rounded-xl border border-gray-100">
      <span className="truncate pr-4 flex items-center gap-1.5 min-w-0">
        {previewUrl ? (
          <img src={previewUrl} alt="preview" className="w-8 h-8 object-cover rounded border border-gray-200 shrink-0" />
        ) : (
          <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        )}
        <span className="truncate">{file.name}</span>
      </span>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-gray-400 font-medium">{(file.size / (1024 * 1024)).toFixed(2)} MB</span>
        <button
          type="button"
          onClick={onRemove}
          className="text-red-500 hover:text-red-700 font-bold ml-1 text-sm focus:outline-none"
          title="Remove file"
        >
          ×
        </button>
      </div>
    </div>
  );
}

export default function ProofCompletionModal({
  ticket,
  onClose,
  onStatusChange,
}) {
  useLockBodyScroll(Boolean(ticket));
  const navigate = useNavigate();
  const [proofFiles, setProofFiles] = useState([]);
  const maxFileCount = useMaxFileCount();
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [remarks, setRemarks] = useState('');

  useEffect(() => {
    setProofFiles([]);
    setErrorMessage('');
    setSuccessMessage('');
    setIsSubmitting(false);
    setRemarks('');
  }, [ticket]);

  if (!ticket) return null;

  const isInternal = Boolean(ticket?.title?.startsWith('[Internal]') || ticket?.is_internal || ticket?.ticket_type === 'Internal' || ticket?.type === 'Internal');
  const isProofRejected = ticket.proofRejected === true && ticket.status === 'In Progress';

  const ALLOWED_EXTENSIONS = ['pdf', 'png', 'docx', 'doc'];
  const MAX_FILE_SIZE_MB = 15;
  const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024; // 15MB
  const MAX_TOTAL_SIZE_MB = 45;
  const MAX_TOTAL_SIZE_BYTES = MAX_TOTAL_SIZE_MB * 1024 * 1024; // 45MB

  const totalSizeBytes = proofFiles.reduce((acc, f) => acc + (f.size || 0), 0);
  const totalSizeMB = (totalSizeBytes / (1024 * 1024)).toFixed(2);

  // Handle file validation (max 15MB each, max 45MB total, allowed PDF, PNG, Word)
  const validateFiles = (incomingFiles, currentFiles = []) => {
    for (let i = 0; i < incomingFiles.length; i++) {
      const file = incomingFiles[i];
      const extension = file.name.split('.').pop().toLowerCase();
      
      if (!ALLOWED_EXTENSIONS.includes(extension)) {
        return `Invalid file type: "${file.name}". Supported formats: PDF, PNG, Word (.docx, .doc).`;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        return `File too large: "${file.name}" (${(file.size / (1024 * 1024)).toFixed(2)} MB). Maximum allowed size is ${MAX_FILE_SIZE_MB}MB per file.`;
      }
    }

    const currentTotal = currentFiles.reduce((acc, f) => acc + (f.size || 0), 0);
    const incomingTotal = incomingFiles.reduce((acc, f) => acc + (f.size || 0), 0);
    if (currentTotal + incomingTotal > MAX_TOTAL_SIZE_BYTES) {
      const attemptedTotalMB = ((currentTotal + incomingTotal) / (1024 * 1024)).toFixed(2);
      return `Total attachments size exceeds ${MAX_TOTAL_SIZE_MB}MB limit (attempted: ${attemptedTotalMB} MB). Please remove some files.`;
    }

    return null;
  };

  const handleProofSubmit = async (e) => {
    e.preventDefault();
    if (proofFiles.length === 0) {
      setErrorMessage('Please select at least one proof of completion file.');
      return;
    }

    if (!remarks.trim()) {
      setErrorMessage('Remarks are required when submitting proof of completion.');
      return;
    }

    // Re-validate all selected files before submitting
    const fileError = validateFiles(proofFiles);
    if (fileError) {
      setErrorMessage(fileError);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');

    const numericId = ticket.ticket_ID || Number(String(ticket.id).replace(/\D/g, ''));
    const targetStatus = isInternal ? 'Resolved' : 'Pending Evaluation';
    const formData = new FormData();
    formData.append('is_proof', 'true');
    formData.append('status', targetStatus);
    formData.append('remarks', remarks.trim());
    proofFiles.forEach((file) => {
      formData.append('attachments[]', file);
    });

    try {
      await updateEmployeeTicket(numericId, formData);
      
      if (typeof onStatusChange === 'function') {
        onStatusChange(ticket.id, targetStatus);
      }

      setSuccessMessage(`Proof of completion submitted successfully! Status updated to ${targetStatus}.`);
      setErrorMessage('');
      setProofFiles([]);
      
      // Briefly delay closing and redirect to progress queue
      setTimeout(() => {
        onClose();
        navigate('/employee/machine');
      }, 1500);
    } catch (err) {
      if (err?.response?.data?.virus_detected || err?.response?.data?.has_threats) {
        setErrorMessage(
          'One or more uploaded proof files failed security scanning and were quarantined. Please remove or replace the flagged file with a clean document.'
        );
      } else {
        const msg = err?.response?.data?.message;
        setErrorMessage(msg || 'Failed to submit proof. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFileChange = (e) => {
    const selected = Array.from(e.target.files);
    if (!selected.length) return;

    // Filter out files already added
    const newFiles = selected.filter(
      (f) => !proofFiles.some((m) => m.name === f.name && m.size === f.size)
    );

    if (newFiles.length === 0) {
      setErrorMessage('Selected file(s) are already added.');
      e.target.value = null;
      return;
    }

    if (proofFiles.length + newFiles.length > maxFileCount) {
      setErrorMessage(`You can attach a maximum of ${maxFileCount} files.`);
      e.target.value = null;
      return;
    }

    const fileError = validateFiles(newFiles, proofFiles);
    if (fileError) {
      setErrorMessage(fileError);
      e.target.value = null;
      return;
    }
    setErrorMessage('');
    setProofFiles((prev) => [...prev, ...newFiles]);
    e.target.value = null;
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-[1.5px] overflow-y-auto py-10" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-xl mx-4 my-auto relative flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-gray-100 flex-shrink-0 relative">
          <button type="button" onClick={onClose} className="absolute top-5 right-5 p-2 rounded-full hover:bg-gray-100 transition-colors text-gray-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          <h2 className="text-xl font-bold text-gray-900 leading-snug">
            {isProofRejected ? 'Re-upload Proof of Completion' : (isInternal ? 'Upload Proof of Completion (Optional)' : 'Upload Proof of Completion')}
          </h2>
          <p className="text-xs text-gray-500 mt-1">Ticket ID: {ticket.id} · {ticket.title}</p>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {successMessage && (
            <div className="rounded-xl bg-green-50 border border-green-200 text-green-800 p-4 text-xs font-semibold flex items-center gap-2.5 font-sans">
              <svg className="w-5 h-5 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{successMessage}</span>
            </div>
          )}

          {errorMessage && (
            <div className={`rounded-xl p-4 text-xs font-semibold flex items-start gap-2.5 font-sans border transition-all ${
              errorMessage.includes('Security threat')
                ? 'bg-red-50/90 text-red-800 border-red-200 shadow-md ring-2 ring-red-500/20'
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}>
              <svg className="w-5 h-5 text-red-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                {errorMessage.includes('Security threat') ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                )}
              </svg>
              <div>{errorMessage}</div>
            </div>
          )}

          {/* Proof Rejected Alert Warning Banner */}
          {isProofRejected && (
            <div className="bg-orange-50 border border-orange-200 text-orange-800 p-4 rounded-xl text-xs font-semibold font-sans">
              <div className="flex items-center gap-2 mb-1.5 text-orange-900">
                <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                <span>Proof of Completion Rejected</span>
              </div>
              <p className="font-medium text-gray-700">Reason: &quot;{ticket.rejectionReason}&quot;</p>
              <p className="text-[10px] text-gray-500 mt-1 font-normal">Please address the feedback above and re-upload the correct documentation below.</p>
            </div>
          )}

          <div className="bg-gray-50/50 rounded-xl p-5 border border-gray-100">
            <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2.5 font-sans">
              Proof of Completion Requirements
            </h3>

            {/* Clear 3-card requirement summary */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-sans mb-3.5">
              <div className="bg-white border border-gray-150 rounded-xl p-2.5 flex flex-col justify-between">
                <div>
                  <span className="block text-[10px] uppercase font-bold text-gray-400">Supported Formats</span>
                  <span className="font-semibold text-gray-800 text-xs">PDF, PNG, Word</span>
                </div>
                <span className="text-[10px] text-gray-400 mt-1">.pdf, .png, .docx, .doc</span>
              </div>
              <div className="bg-white border border-gray-150 rounded-xl p-2.5 flex flex-col justify-between">
                <div>
                  <span className="block text-[10px] uppercase font-bold text-gray-400">Max File Size</span>
                  <span className="font-semibold text-gray-800 text-xs">{MAX_FILE_SIZE_MB} MB per file</span>
                </div>
                <span className="text-[10px] text-gray-400 mt-1">Individual file limit</span>
              </div>
              <div className="bg-white border border-gray-150 rounded-xl p-2.5 flex flex-col justify-between">
                <div>
                  <span className="block text-[10px] uppercase font-bold text-gray-400">Max Total Size</span>
                  <span className="font-semibold text-[#252578] text-xs">{MAX_TOTAL_SIZE_MB} MB total</span>
                </div>
                <span className="text-[10px] text-gray-400 mt-1">Combined all attachments</span>
              </div>
            </div>

            <form onSubmit={handleProofSubmit} className="mt-4 space-y-4">
              <div className="border-2 border-dashed border-gray-200 hover:border-[#252578] rounded-xl p-6 transition-all bg-white text-center cursor-pointer group relative">
                <input
                  type="file"
                  multiple
                  accept=".pdf,.png,.docx,.doc"
                  onChange={handleFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  required={proofFiles.length === 0}
                  disabled={isSubmitting}
                />
                <svg className="w-8 h-8 text-gray-400 group-hover:text-[#252578] mx-auto mb-2 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
                </svg>
                <p className="text-xs font-semibold text-[#252578] font-sans">Click to browse files</p>
                <p className="text-[10px] text-gray-400 mt-0.5 font-sans">PDF, PNG, Word · Up to 15MB each · 45MB total</p>
              </div>

              {proofFiles.length > 0 && (
                <div className="space-y-1.5 bg-white border border-gray-150 rounded-xl p-3 max-h-48 overflow-y-auto">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide font-sans">
                      Files Selected ({proofFiles.length})
                    </p>
                    <span className={`text-[10px] font-semibold font-sans px-2.5 py-0.5 rounded-full ${
                      totalSizeBytes > MAX_TOTAL_SIZE_BYTES
                        ? 'bg-red-100 text-red-700'
                        : 'bg-blue-50 text-[#252578] border border-blue-100'
                    }`}>
                      {totalSizeMB} MB / {MAX_TOTAL_SIZE_MB} MB Total
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {proofFiles.map((file, idx) => (
                      <ProofFileItem
                        key={idx}
                        file={file}
                        onRemove={() => setProofFiles((prev) => prev.filter((_, i) => i !== idx))}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="flex justify-between items-end mb-1.5">
                  <label className="block text-xs font-semibold text-gray-500 font-sans">
                    Remarks / Completion Notes <span className="text-red-500">*</span>
                  </label>
                  <span className={`text-[10px] font-medium font-sans ${remarks.length >= 250 ? 'text-red-500' : 'text-gray-400'}`}>
                    {remarks.length}/250 characters
                  </span>
                </div>
                <textarea
                  placeholder="Provide details of the resolution or notes for validation..."
                  value={remarks}
                  disabled={isSubmitting}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val.length <= 250) {
                      setRemarks(val);
                    }
                  }}
                  rows={3}
                  maxLength={250}
                  className="w-full text-xs border border-gray-200 rounded-xl p-3 bg-white text-gray-800 outline-none focus:ring-2 focus:ring-[#252578]/25 resize-none font-sans"
                  required
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting || proofFiles.length === 0 || !remarks.trim()}
                  className="flex-1 py-2.5 bg-green-700 hover:bg-green-800 disabled:bg-gray-300 text-white text-xs font-semibold rounded-xl transition-all shadow-md shadow-green-700/20 disabled:shadow-none disabled:cursor-not-allowed font-sans"
                >
                  {isSubmitting ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
