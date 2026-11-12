import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import NotificationModal from '@/components/NotificationModal';
import TitleCasingModal from '@/components/TitleCasingModal';
import AIDepartmentModal from '@/components/AIDepartmentModal';
import {
  getTicketFormOptions,
  createTicket,
  getCustomerTickets,
  saveTicketDraft,
  getTicketDraft,
  uploadAttachments,
  getEscalateHandoff,
  classifyDepartment,
  suggestProblemCategory,
} from '@/services/ticketService';
import { getSystemStatus, getFileLimitsConfig } from '@/services/configurationService';
import { normalizeCasing } from '@/utils/normalizeCasing';
import { formatProperTitleCase, needsProperCasing } from '@/utils/titleCaseUtils';
import { useAuth } from '@/context/AuthContext';
import { getMaxOpenTicketsLimit, OPEN_STATUS_SET } from '@/data/ticketLimitConfig';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { PersistentBanner } from '@/components/ui/alert-banner';
import { resolveRegisteredMachine } from '@/utils/machineMatching';
import { useToast } from '@/context/ToastContext';
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  Trash2,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';

export default function TicketCreation() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const toast = useToast();
  const effectiveUser = user || JSON.parse(sessionStorage.getItem('user') || localStorage.getItem('user') || 'null');
  const customerId = effectiveUser?.client_ID || effectiveUser?.client_id || effectiveUser?.id || null;

  const [draftId, setDraftId] = useState(location.state?.draftId || null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftMessage, setDraftMessage] = useState('');
  const [existingDraftAttachments, setExistingDraftAttachments] = useState([]);

  const incomingPrefill = location.state?.prefillData || null;
  const isFromAi = Boolean(
    location.state?.fromAiChat ||
    location.state?.conversationId ||
    location.state?.conversation_id ||
    location.state?.fromConversationId ||
    incomingPrefill
  );

  const [formData, setFormData] = useState({
    title: incomingPrefill?.title || incomingPrefill?.problemSummary || '',
    machine_ID: incomingPrefill?.machine_ID || '',
    problem_category_ID: incomingPrefill?.problem_category_ID || '',
    description: incomingPrefill?.description || incomingPrefill?.conversationSummary || '',
    priority_ID: 1, // default to Low (1)
    origin: isFromAi ? 'ai_chatbot' : undefined,
    conversation_id: location.state?.conversationId || location.state?.conversation_id || location.state?.fromConversationId || undefined,
  });

  const handleCancelOrBack = useCallback(() => {
    if (isFromAi || incomingPrefill || location.state?.fromAiChat) {
      navigate('/ai-support');
      return;
    }
    if (draftId || location.state?.draftId) {
      navigate('/my-tickets', { state: { tab: 'drafts' } });
      return;
    }
    if (window.history.length > 2) {
      navigate(-1);
    } else {
      navigate('/customer-dashboard');
    }
  }, [isFromAi, incomingPrefill, location.state, draftId, navigate]);

  // Helper to resolve machine ID from options given ID or name/model
  const resolveMachineId = useCallback((val, machineList) => {
    if (!val || !machineList || !machineList.length) return '';
    const numericVal = Number(val);
    if (!isNaN(numericVal) && numericVal > 0) {
      const exists = machineList.some((m) => Number(m.machine_ID) === numericVal);
      if (exists) return numericVal;
    }
    // Spec 0038 AC-1: a machine string from the AI flow only links one of the customer's
    // registered machines by exact serial, then model, then name. A brand never counts.
    const matched = resolveRegisteredMachine(machineList, [String(val)]);
    return matched ? matched.machine_ID : '';
  }, []);

  // Helper to resolve category ID from options given ID or category name
  const resolveCategoryId = useCallback((val, categoryList) => {
    if (!val || !categoryList || !categoryList.length) return '';
    const numericVal = Number(val);
    if (!isNaN(numericVal) && numericVal > 0) {
      const exists = categoryList.some((c) => Number(c.problem_category_ID) === numericVal);
      if (exists) return numericVal;
    }
    const search = String(val).trim().toLowerCase();
    if (!search) return '';
    const matched = categoryList.find((c) => {
      const name = (c.category_name || '').toLowerCase();
      return name === search || search.includes(name) || name.includes(search);
    });
    return matched ? matched.problem_category_ID : '';
  }, []);
  const [options, setOptions] = useState({
    equipment_options: [],
    category_options: [],
    machines: [],
    problem_categories: [],
    ticket_priorities: [],
  });
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [error, setError] = useState('');
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState('');
  // Upload limits are owned by the superadmin (configuration-service). These defaults
  // only apply until the live config loads or if it cannot be fetched.
  const [fileLimits, setFileLimits] = useState({
    maxFileSizeMB: 15,
    maxFileCount: 5,
    allowedFileTypes: ['PDF', 'PNG', 'DOCX', 'DOC', 'JPG', 'JPEG'],
  });

  useEffect(() => {
    let active = true;
    getFileLimitsConfig()
      .then((cfg) => {
        if (!active || !cfg) return;
        setFileLimits((prev) => ({
          maxFileSizeMB: Number(cfg.maxFileSizeMB) > 0 ? Number(cfg.maxFileSizeMB) : prev.maxFileSizeMB,
          maxFileCount: Number(cfg.maxFileCount) > 0 ? Number(cfg.maxFileCount) : prev.maxFileCount,
          allowedFileTypes: Array.isArray(cfg.allowedFileTypes) && cfg.allowedFileTypes.length > 0
            ? cfg.allowedFileTypes.map((t) => String(t).toUpperCase())
            : prev.allowedFileTypes,
        }));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const [successModal, setSuccessModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createdTicketId, setCreatedTicketId] = useState(null);
  const [titleCasingData, setTitleCasingData] = useState(null);
  const [showTitleCasingModal, setShowTitleCasingModal] = useState(false);
  const [customerOpenCount, setCustomerOpenCount] = useState(0);
  const [systemStatus, setSystemStatus] = useState('Operational');

  // AI problem category suggestion (pre-selects the dropdown; the customer can always change it)
  const [aiCategoryHint, setAiCategoryHint] = useState(null);

  // AI Department Triage State
  const [selectedDepartment, setSelectedDepartment] = useState('IT');
  const [departmentConfirmed, setDepartmentConfirmed] = useState(false);
  const [aiClassification, setAiClassification] = useState(null);
  const [showAIDepartmentModal, setShowAIDepartmentModal] = useState(false);
  const [isClassifying, setIsClassifying] = useState(false);
  const [lastClassifiedText, setLastClassifiedText] = useState('');

  const fetchCustomerOpenCount = useCallback(async () => {
    try {
      const ticketsList = await getCustomerTickets({ createdBy: customerId, limit: 100, forceRefresh: true }).catch(() => []);
      const seenIds = new Set();
      const all = [];
      for (const t of (ticketsList || [])) {
        const id = t.ticket_id || t.ticket_ID || t.id;
        if (id && seenIds.has(id)) continue;
        if (id) seenIds.add(id);
        all.push(t);
      }
      const count = all.filter((t) => {
        const matchesCustomer = !t.created_by || String(t.created_by) === String(customerId);
        return !t.is_internal && matchesCustomer && OPEN_STATUS_SET.includes(t.status);
      }).length;
      setCustomerOpenCount(count);
      return count;
    } catch {
      return customerOpenCount;
    }
  }, [customerId, customerOpenCount]);

  useEffect(() => {
    fetchCustomerOpenCount();
    const handleConfigChange = () => {
      fetchCustomerOpenCount();
    };
    window.addEventListener('ticket_limit_config_changed', handleConfigChange);
    return () => window.removeEventListener('ticket_limit_config_changed', handleConfigChange);
  }, [fetchCustomerOpenCount]);

  useEffect(() => {
    getSystemStatus()
      .then((status) => setSystemStatus(status))
      .catch(() => setSystemStatus('Operational'));

    const loadOptions = async () => {
      setLoadingOptions(true);
      setError('');
      try {
        const data = await getTicketFormOptions({ forceRefresh: true });
        setOptions(data);
        if (data.ticket_priorities?.length > 0) {
          setFormData((prev) => ({
            ...prev,
            priority_ID: data.ticket_priorities[0].priority_ID,
          }));
        }
      } catch (err) {
        setError('Failed to load ticket configuration options. Please refresh the page.');
        console.error(err);
      } finally {
        setLoadingOptions(false);
      }
    };
    loadOptions();
  }, []);

  // Load existing draft if opened from "My Drafts"
  useEffect(() => {
    const draftIdFromNav = location.state?.draftId;
    if (draftIdFromNav) {
      getTicketDraft(draftIdFromNav)
        .then((draft) => {
          if (draft) {
            setDraftId(draft.id);
            setFormData((prev) => ({
              ...prev,
              title: draft.raw_title ?? (draft.title === 'Untitled draft' ? '' : draft.title),
              machine_ID: draft.machine_ID || '',
              problem_category_ID: draft.problem_category_ID || '',
              description: draft.description || '',
              priority_ID: draft.priority_ID || 1,
            }));
            if (draft.attachments && Array.isArray(draft.attachments)) {
              setExistingDraftAttachments(draft.attachments);
            }
          }
        })
        .catch((err) => console.error('Failed to load draft:', err));
    }
  }, [location.state]);

  // Load escalated AI handoff prefill if redirected from AI Support triage or route state
  useEffect(() => {
    const prefill = location.state?.prefillData;
    if (prefill) {
      setFormData((prev) => {
        const nextTitle = prev.title || prefill.title || prefill.problemSummary || '';
        const nextDesc = prev.description || prefill.description || prefill.conversationSummary || '';
        const rawMachine = prefill.machine_ID || prefill.machineModel || prefill.machine_name || prefill.machine;
        const resolvedMachine = prev.machine_ID || resolveMachineId(rawMachine, options.machines);
        const rawCategory = prefill.problem_category_ID || prefill.category || prefill.category_name;
        const resolvedCategory = prev.problem_category_ID || resolveCategoryId(rawCategory, options.problem_categories);

        return {
          ...prev,
          title: nextTitle,
          description: nextDesc,
          machine_ID: resolvedMachine || prev.machine_ID,
          problem_category_ID: resolvedCategory || prev.problem_category_ID,
          origin: 'ai_chatbot',
          conversation_id: location.state?.conversationId || location.state?.conversation_id || location.state?.fromConversationId || prev.conversation_id,
        };
      });
    }

    const convId = location.state?.conversationId || location.state?.conversation_id || location.state?.fromConversationId;
    if (convId && !draftId) {
      getEscalateHandoff(convId)
        .then((res) => {
          const handoff = res?.data || res;
          if (handoff) {
            setFormData((prev) => {
              const nextTitle = prev.title || handoff.title || '';
              const nextDesc = prev.description || handoff.description || '';
              const rawMachine = handoff.machine || handoff.machine_ID;
              const resolvedMachine = prev.machine_ID || resolveMachineId(rawMachine, options.machines);
              const rawCategory = handoff.category || handoff.problem_category_ID;
              const resolvedCategory = prev.problem_category_ID || resolveCategoryId(rawCategory, options.problem_categories);

              return {
                ...prev,
                title: nextTitle,
                description: nextDesc,
                machine_ID: resolvedMachine || prev.machine_ID,
                problem_category_ID: resolvedCategory || prev.problem_category_ID,
                origin: 'ai_chatbot',
                conversation_id: convId,
              };
            });
          }
        })
        .catch((err) => {
          console.warn('Could not prefill escalation handoff payload:', err);
        });
    }
  }, [location.state, options.machines, options.problem_categories, draftId, resolveMachineId, resolveCategoryId]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    if (name === 'problem_category_ID') {
      setAiCategoryHint(null); // a manual choice replaces the AI suggestion
      const selectedCat = (options.problem_categories || []).find(
        (c) => String(c.problem_category_ID) === String(value)
      );
      const catName = (selectedCat?.category_name || '').toLowerCase();
      if (catName.includes('it') || catName.includes('software') || catName.includes('system') || catName.includes('network')) {
        setSelectedDepartment('IT');
      } else if (catName.includes('service') || catName.includes('biomedical') || catName.includes('maintenance') || catName.includes('hardware')) {
        setSelectedDepartment('Service');
      }
      setDepartmentConfirmed(false);
    }
  };

  const handleCasingBlur = (field) => () => {
    setFormData((prev) => ({
      ...prev,
      [field]: normalizeCasing(prev[field]),
    }));
  };

  const handleDescriptionBlur = async () => {
    const raw = formData.description || '';
    const normalized = normalizeCasing(raw);
    if (normalized !== raw) {
      setFormData((prev) => ({ ...prev, description: normalized }));
    }

    const trimmed = normalized.trim();
    if (trimmed.length >= 20 && trimmed !== lastClassifiedText) {
      setLastClassifiedText(trimmed);

      // Suggest a category in parallel, but only fill the dropdown if the customer has not chosen one.
      if (!formData.problem_category_ID) {
        suggestProblemCategory(formData.title || '', trimmed, options.problem_categories || [])
          .then((suggestion) => {
            if (!suggestion?.category_id) return;
            setFormData((prev) => (
              prev.problem_category_ID
                ? prev
                : { ...prev, problem_category_ID: suggestion.category_id }
            ));
            setAiCategoryHint(suggestion);
          })
          .catch(() => {});
      }

      try {
        setIsClassifying(true);
        const classification = await classifyDepartment(formData.title || '', trimmed);
        setAiClassification(classification);
        if (classification?.department) {
          setSelectedDepartment(classification.department);
        }
      } catch (err) {
        console.warn('AI triage blur error:', err);
      } finally {
        setIsClassifying(false);
      }
    }
  };

  const handleConfirmAIDepartment = async () => {
    setDepartmentConfirmed(true);
    setShowAIDepartmentModal(false);

    if (selectedDepartment === 'Service' && !formData.machine_ID) {
      const msg = 'Equipment selection is required for Service hardware tickets. Please select an equipment item.';
      setError(msg);
      if (toast?.show) {
        toast.show(msg, 'warning');
      }
      return;
    }

    const titleTrim = (formData.title || '').trim();
    const descTrim = (formData.description || '').trim();

    if (titleTrim && descTrim && formData.problem_category_ID) {
      const finalTitle = needsProperCasing(titleTrim) ? formatProperTitleCase(titleTrim) : titleTrim;
      setFormData((prev) => ({ ...prev, title: finalTitle }));
      await submitTicketWithTitle(finalTitle);
    }
  };

  const handleSaveDraft = async () => {
    setSavingDraft(true);
    setDraftMessage('');
    setError('');

    const hasScanning = files.some((f) => f.status === 'scanning');
    if (hasScanning) {
      setError('Please wait for file scanning to complete before saving draft.');
      setSavingDraft(false);
      return;
    }

    try {
      const cleanNewFiles = files.filter((f) => f.status === 'clean');
      const preparedNewAttachments = [];
      for (const f of cleanNewFiles) {
        if (f.attachmentId) {
          preparedNewAttachments.push({
            id: f.attachmentId,
            attachment_id: f.attachmentId,
            name: f.name,
            url: f.url || null,
            size: f.size || null,
          });
        } else if (f.file) {
          const uploaded = await uploadAttachments([f.file]);
          const upItem = Array.isArray(uploaded) ? uploaded[0] : (uploaded?.attachments?.[0] || uploaded?.data?.[0]);
          if (upItem?.id || upItem?.attachment_ID) {
            preparedNewAttachments.push({
              id: upItem.id || upItem.attachment_ID,
              attachment_id: upItem.id || upItem.attachment_ID,
              name: f.name,
              url: upItem.url || null,
              size: f.size || null,
            });
          }
        }
      }

      const allDraftAttachments = [
        ...existingDraftAttachments,
        ...preparedNewAttachments,
      ];

      const payload = {
        client_id: customerId,
        title: (formData.title || '').trim(),
        machine_ID: formData.machine_ID ? Number(formData.machine_ID) : null,
        problem_category_ID: formData.problem_category_ID ? Number(formData.problem_category_ID) : null,
        description: formData.description || '',
        priority_ID: formData.priority_ID ? Number(formData.priority_ID) : (options.ticket_priorities?.[0]?.priority_ID || 1),
        attachments: allDraftAttachments,
      };
      if (draftId) {
        payload.id = draftId;
      }
      const res = await saveTicketDraft(payload);
      if (res?.draft?.id) {
        setDraftId(res.draft.id);
      }
      if (res?.draft?.attachments) {
        setExistingDraftAttachments(res.draft.attachments);
        setFiles([]);
      }
      setDraftMessage('Draft saved successfully! Redirecting to My Drafts...');
      navigate('/my-tickets?tab=drafts', { state: { tab: 'drafts', draftSavedAt: Date.now() } });
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to save draft. Please try again.');
    } finally {
      setSavingDraft(false);
    }
  };

  const scanUploadedFile = async (fileItem) => {
    try {
      const res = await uploadAttachments([fileItem.file]);
      const uploaded = Array.isArray(res) ? res[0] : (res?.attachments?.[0] || res?.data?.[0]);

      if (uploaded?.status === 'quarantined') {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === fileItem.id
              ? {
                  ...f,
                  status: 'quarantined',
                  attachmentId: uploaded.id || uploaded.attachment_ID,
                  threatName: uploaded.threat_name || 'Malware detected',
                }
              : f
          )
        );
      } else {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === fileItem.id
              ? {
                  ...f,
                  status: 'clean',
                  attachmentId: uploaded?.id || uploaded?.attachment_ID,
                  url: uploaded?.url,
                }
              : f
          )
        );
      }
    } catch (err) {
      console.warn('Security scan inspection error:', err);
      // Fallback: If upload endpoint returned a 422 with quarantine or security error
      if (err?.response?.status === 422 && /malware|threat|virus|quarantin/i.test(err?.response?.data?.message || '')) {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === fileItem.id
              ? {
                  ...f,
                  status: 'quarantined',
                  threatName: 'Threat signature identified',
                }
              : f
          )
        );
      } else {
        // The server rejected the file (size, type, count, or an outage). Never mark it clean:
        // a file without a stored attachment id would be silently dropped on submit.
        const serverMessage =
          err?.response?.data?.errors?.attachments?.[0] ||
          err?.response?.data?.message ||
          'This file could not be uploaded. Please remove it and try again.';
        setFileError(serverMessage);
        setFiles((prev) => prev.filter((f) => f.id !== fileItem.id));
      }
    }
  };

  const handleFileChange = (e) => {
    setFileError('');
    const selectedFiles = Array.from(e.target.files);
    if (selectedFiles.length > 0) {
      const { maxFileSizeMB, maxFileCount, allowedFileTypes } = fileLimits;
      const maxIndividual = maxFileSizeMB * 1024 * 1024;
      const maxTotal = maxIndividual * maxFileCount;
      const allowedExts = allowedFileTypes.map((t) => '.' + t.toLowerCase());

      if (files.length + selectedFiles.length > maxFileCount) {
        setFileError(`You can attach a maximum of ${maxFileCount} files.`);
        e.target.value = '';
        return;
      }

      let currentTotalSize = files.reduce((acc, f) => acc + f.size, 0);

      const newItems = [];
      for (const file of selectedFiles) {
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        if (!allowedExts.includes(ext)) {
          setFileError(`Invalid file type "${file.name}". Supported formats: ${allowedFileTypes.join(', ')}.`);
          e.target.value = '';
          return;
        }

        if (file.size > maxIndividual) {
          setFileError(`File "${file.name}" exceeds the maximum limit of ${maxFileSizeMB}MB.`);
          e.target.value = '';
          return;
        }

        currentTotalSize += file.size;
        if (currentTotalSize > maxTotal) {
          setFileError(`Total attachments size exceeds the maximum limit of ${maxFileSizeMB * maxFileCount}MB.`);
          e.target.value = '';
          return;
        }

        newItems.push({
          id: Math.random().toString(36).substring(2, 9),
          file,
          name: file.name,
          size: file.size,
          status: 'scanning',
        });
      }

      setFiles((prev) => [...prev, ...newItems]);
      e.target.value = '';

      for (const item of newItems) {
        scanUploadedFile(item);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    if (systemStatus === 'Under Maintenance') {
      setError('Ticket submission is currently disabled. The system is undergoing scheduled maintenance.');
      return;
    }

    const limitConfig = getMaxOpenTicketsLimit();
    if (!limitConfig.isUnlimited) {
      let openCount = customerOpenCount;
      try {
        const freshCount = await fetchCustomerOpenCount();
        if (typeof freshCount === 'number') {
          openCount = freshCount;
        }
      } catch (err) {
        console.warn('Failed to refresh open ticket count before submit:', err);
      }

      if (openCount >= limitConfig.limit) {
        setError(`You've reached the maximum number of open tickets (${limitConfig.limit}). Resolve or close an existing ticket before submitting another.`);
        return;
      }
    }

    const titleTrim = (formData.title || '').trim();
    const descTrim = (formData.description || '').trim();
    if (!titleTrim || !formData.problem_category_ID || !descTrim) {
      setError('Please complete all required fields.');
      return;
    }
    if (titleTrim.length < 5) {
      setError('Title must be at least 5 characters.');
      return;
    }
    if (descTrim.length < 20) {
      setError('Description must be at least 20 characters.');
      return;
    }

    // AI Department confirmation check before letting user create ticket
    if (!departmentConfirmed) {
      const selectedCat = (options.problem_categories || []).find(
        (c) => String(c.problem_category_ID) === String(formData.problem_category_ID)
      );
      const catName = (selectedCat?.category_name || '').toLowerCase();
      const text = `${titleTrim} ${descTrim} ${catName}`.toLowerCase();
      const isSoftware = /(software|app|login|password|account|portal|bug|glitch|crash|freeze|network|wifi|database|timeout|license)/i.test(text)
        || catName.includes('it')
        || catName.includes('software');

      const initialDept = isSoftware ? 'IT' : 'Service';
      setSelectedDepartment(initialDept);
      setAiClassification({
        department: initialDept,
        department_id: isSoftware ? 2 : 1,
        is_software: isSoftware,
        requires_equipment: !isSoftware,
        confidence: 0.9,
        reasoning: isSoftware
          ? 'Identified as a software, application, or account issue. Physical equipment selection is optional.'
          : 'Identified as a physical machine or hardware maintenance issue. Equipment selection is required.'
      });

      setShowAIDepartmentModal(true);

      // In background, call AI to refine classification if needed
      classifyDepartment(titleTrim, descTrim).then((fresh) => {
        if (fresh?.department) {
          setAiClassification(fresh);
        }
      }).catch(() => {});

      return; // STOP! Block submission until confirmed in modal
    }

    // If Service (Hardware), equipment is mandatory
    if (selectedDepartment === 'Service' && !formData.machine_ID) {
      setError('Equipment selection is required for Service hardware tickets. Please select an equipment item.');
      return;
    }

    const finalTitle = needsProperCasing(titleTrim) ? formatProperTitleCase(titleTrim) : titleTrim;
    setFormData((prev) => ({ ...prev, title: finalTitle }));
    await submitTicketWithTitle(finalTitle);
  };

  const submitTicketWithTitle = async (finalTitle) => {
    setError('');

    const hasScanning = files.some((f) => f.status === 'scanning');
    if (hasScanning) {
      setError('Security scan in progress. Please wait for attachment verification to complete before submitting.');
      return;
    }

    const hasQuarantined = files.some((f) => f.status === 'quarantined');
    if (hasQuarantined) {
      setError('One or more attachments were blocked and quarantined by the security scanner. Please remove quarantined files to proceed.');
      return;
    }

    setSubmitting(true);

    try {
      const normalizedDesc = normalizeCasing(formData.description);
      setFormData((prev) => ({ ...prev, title: finalTitle, description: normalizedDesc }));
      const payload = new FormData();
      payload.append('title', finalTitle);
      if (formData.machine_ID) {
        payload.append('machine_ID', formData.machine_ID);
      }
      payload.append('problem_category_ID', formData.problem_category_ID);
      payload.append('description', normalizedDesc);
      payload.append('priority_ID', formData.priority_ID || options.ticket_priorities?.[0]?.priority_ID || 1);
      payload.append('department_id', selectedDepartment === 'Service' ? 1 : 2);
      if (draftId) {
        payload.append('draft_id', draftId);
      }
      if (formData.origin) {
        payload.append('origin', formData.origin);
      }
      if (formData.conversation_id) {
        payload.append('conversation_id', formData.conversation_id);
      }
      if (existingDraftAttachments && existingDraftAttachments.length > 0) {
        existingDraftAttachments.forEach((att) => {
          const id = typeof att === 'number'
            ? att
            : (att.id || att.attachment_id || att.attachment_ID || (Number(att) || null));
          if (id) {
            payload.append('attachments[]', id);
          }
        });
      }
      if (files && files.length > 0) {
        const cleanFiles = files.filter((f) => f.status === 'clean');
        cleanFiles.forEach((f) => {
          if (f.attachmentId) {
            payload.append('attachments[]', f.attachmentId);
          } else if (f.file) {
            payload.append('attachments[]', f.file);
          }
        });
      }
      
      const response = await createTicket(payload);
      const newTicketId = response.ticket?.ticket_ID || response.ticket_ID;
      setCreatedTicketId(newTicketId);
      setSuccessModal(true);
      fetchCustomerOpenCount();
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to submit ticket. Please try again.');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSuccessClose = () => {
    setSuccessModal(false);
    if (createdTicketId) {
      navigate('/messages', { state: { selectedTicketId: createdTicketId } });
    } else {
      navigate('/customer-dashboard');
    }
  };

  const equipmentOptions = options.equipment_options?.length
    ? options.equipment_options
    : (options.machines || []).map((machine) => ({
      value: machine.machine_ID,
      label: `${machine.machine_name} - ${machine.serial_number}`,
    }));

  const categoryOptions = options.category_options?.length
    ? options.category_options
    : (options.problem_categories || []).map((category) => {
      const nameLower = (category.category_name || '').toLowerCase();
      let label = category.category_name;
      if (nameLower === 'it') {
        label = 'IT (Software / Applications / Network — Equipment Optional)';
      } else if (nameLower === 'service') {
        label = 'Service (Hardware Diagnostic & Repair — Equipment Required)';
      } else if (nameLower.includes('biomedical')) {
        label = `${category.category_name} (Equipment Required)`;
      } else if (nameLower.includes('others')) {
        label = `${category.category_name} (General Inquiry)`;
      }
      return {
        value: category.problem_category_ID,
        label,
      };
    });

  const priorityOptions = options.priority_options?.length
    ? options.priority_options
    : (options.ticket_priorities || []).map((p) => ({
      value: p.priority_ID,
      label: p.priority_name,
    }));

  return (
    <>
      <div className="max-w-4xl mx-auto space-y-6 font-sans">
        <PageHeader
          title="Create New Ticket"
          subtitle="Submit a new support and diagnostic request for your equipment."
          actions={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCancelOrBack}
              className="cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Back
            </Button>
          }
        />

        {isFromAi && (
          <div className="rounded-xl p-3.5 bg-blue-50/80 border border-blue-200 text-xs text-primary flex items-center justify-between shadow-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold uppercase tracking-wider text-[10px] bg-blue-100 text-[#252578] px-2 py-0.5 rounded-md">AI Support Prefill</span>
              <span className="font-medium text-slate-700">Problem details from your AI Support conversation have been prefilled. Review and complete your submission.</span>
            </div>
          </div>
        )}

        {draftMessage && (
          <div className="mb-6 rounded-xl p-4 text-sm font-medium border border-emerald-200 bg-emerald-50 text-emerald-800 flex items-start gap-3 transition-all animate-fadeIn">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="flex-1 flex justify-between items-center">
              <span>{draftMessage}</span>
              <button
                type="button"
                onClick={() => navigate('/my-tickets', { state: { tab: 'drafts' } })}
                className="text-xs font-bold text-emerald-900 underline hover:no-underline ml-3 cursor-pointer"
              >
                View My Drafts
              </button>
            </div>
          </div>
        )}

        {draftId && (
          <div className="mb-6 rounded-xl p-3.5 bg-blue-50/70 border border-blue-200 text-xs text-primary flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-bold uppercase tracking-wider text-[10px] bg-blue-100 px-2 py-0.5 rounded-md text-primary">Draft Mode</span>
              <span>You are editing draft #{draftId}. Your changes can be re-saved as draft or submitted.</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setDraftId(null);
                setFormData({ title: '', machine_ID: '', problem_category_ID: '', description: '', priority_ID: 1 });
                setExistingDraftAttachments([]);
                setFiles([]);
              }}
              className="text-muted-slate hover:text-dark-slate text-xs font-semibold underline hover:no-underline cursor-pointer"
            >
              Clear and start fresh
            </button>
          </div>
        )}

        {error && (
          <PersistentBanner
            variant="error"
            message={error}
          />
        )}

        {systemStatus === 'Under Maintenance' && (
          <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 flex items-start gap-3 shadow-xs">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold">System Under Maintenance</h3>
              <p className="text-xs text-amber-800 mt-1">
                The ticketing system is currently undergoing scheduled maintenance. Ticket creation is temporarily disabled. Please check back later.
              </p>
            </div>
          </div>
        )}

        <div className="bg-card border border-border rounded-xl p-6 sm:p-8 shadow-xs">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <Label htmlFor="ticket-title">Ticket Title <span className="text-destructive">*</span></Label>
                <Input
                  id="ticket-title"
                  name="title"
                  type="text"
                  required
                  value={formData.title}
                  onChange={handleChange}
                  placeholder="Brief description of the issue"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="ticket-machine">
                    Equipment Name / ID {selectedDepartment === 'Service' ? <span className="text-destructive">*</span> : <span className="text-muted-slate text-xs font-normal ml-1">(Optional for IT)</span>}
                  </Label>
                  {selectedDepartment === 'IT' && (
                    <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                      Optional (Software)
                    </span>
                  )}
                </div>
                <select
                  id="ticket-machine"
                  name="machine_ID"
                  required={selectedDepartment === 'Service'}
                  value={formData.machine_ID}
                  onChange={handleChange}
                  disabled={loadingOptions}
                  className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-dark-slate shadow-xs focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 outline-none disabled:opacity-50"
                >
                  <option value="">{selectedDepartment === 'IT' ? 'None / Not Applicable (Software Issue)' : 'Select Equipment'}</option>
                  {equipmentOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <Label htmlFor="ticket-category">Problem Category <span className="text-destructive">*</span></Label>
                <select
                  id="ticket-category"
                  name="problem_category_ID"
                  required
                  value={formData.problem_category_ID}
                  onChange={handleChange}
                  disabled={loadingOptions}
                  className="flex h-10 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-dark-slate shadow-xs focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 outline-none disabled:opacity-50"
                >
                  <option value="">Select Category</option>
                  {categoryOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                {aiCategoryHint && String(aiCategoryHint.category_id) === String(formData.problem_category_ID) && (
                  <p className="text-xs text-muted-slate" data-testid="ai-category-hint">
                    Suggested by AI based on your description. You can change it.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ticket-description">Detailed Description <span className="text-destructive">*</span></Label>
              <Textarea
                id="ticket-description"
                name="description"
                required
                rows={5}
                value={formData.description}
                onChange={handleChange}
                onBlur={handleDescriptionBlur}
                placeholder="Please describe symptoms, error messages, and current machine status in detail..."
              />
            </div>


            <div className="space-y-2">
              <Label>Attachments (Optional)</Label>
              <div className="border-2 border-dashed border-border rounded-xl p-6 text-center hover:bg-slate-50 transition-colors">
                <input
                  type="file"
                  id="ticket-creation-file-upload"
                  className="hidden"
                  onChange={handleFileChange}
                  accept=".pdf,.png,.docx,.doc,.jpg,.jpeg"
                  multiple
                />
                <label htmlFor="ticket-creation-file-upload" className="cursor-pointer flex flex-col items-center">
                  <div className="h-10 w-10 rounded-full bg-blue-50 text-accent flex items-center justify-center mb-2">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <span className="text-sm font-semibold text-primary">Click to upload files</span>
                  <span className="text-xs text-muted-slate mt-1 uppercase tracking-wider">
                    {fileLimits.allowedFileTypes.join(', ')} — max {fileLimits.maxFileSizeMB}MB per file, {fileLimits.maxFileCount} files
                  </span>
                </label>
              </div>

              {/* Saved Draft Attachments */}
              {existingDraftAttachments.length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs font-semibold text-muted-slate uppercase tracking-wide">Saved Draft Attachments ({existingDraftAttachments.length})</p>
                  {existingDraftAttachments.map((att, idx) => {
                    const attName = att.name || att.file_name || (typeof att === 'string' ? att.split('/').pop() : `Attachment #${idx + 1}`);
                    return (
                      <div key={`existing-${idx}`} className="rounded-xl border border-blue-200 bg-blue-50/40 p-3 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm text-primary">
                          <span className="font-medium truncate max-w-xs">{attName}</span>
                          <span className="text-[10px] text-accent font-semibold px-2 py-0.5 rounded-full bg-blue-100">Draft File</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setExistingDraftAttachments((prev) => prev.filter((_, i) => i !== idx))}
                          className="p-1 text-muted-slate hover:text-destructive hover:bg-red-50 rounded-full transition-colors cursor-pointer"
                          title="Remove draft attachment"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Uploaded Files with Malware Inspection States */}
              {files.length > 0 && (
                <div className="mt-3 space-y-2.5">
                  {files.map((item, idx) => {
                    const isScanning = item.status === 'scanning';
                    const isQuarantined = item.status === 'quarantined';
                    const isClean = item.status === 'clean';

                    return (
                      <div
                        key={item.id || idx}
                        className={`rounded-xl border p-3.5 transition-all ${
                          isQuarantined
                            ? 'border-destructive/40 bg-destructive/5 shadow-xs'
                            : isScanning
                              ? 'border-amber-200 bg-amber-50/40 shadow-xs'
                              : 'border-emerald-200 bg-emerald-50/30'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            {isScanning ? (
                              <RefreshCw size={18} className="animate-spin text-amber-600 shrink-0" />
                            ) : isQuarantined ? (
                              <ShieldAlert size={18} className="text-destructive shrink-0" />
                            ) : (
                              <ShieldCheck size={18} className="text-emerald-600 shrink-0" />
                            )}

                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span
                                  className={`text-sm font-semibold truncate max-w-xs ${
                                    isQuarantined ? 'text-destructive line-through' : 'text-dark-slate'
                                  }`}
                                >
                                  {item.name}
                                </span>
                                <span className="text-xs text-muted-slate">
                                  ({(item.size / (1024 * 1024)).toFixed(2)} MB)
                                </span>

                                {isScanning && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                                    Scanning…
                                  </span>
                                )}
                                {isClean && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                                    Clean &amp; Verified
                                  </span>
                                )}
                                {isQuarantined && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-destructive/15 text-destructive border border-destructive/30">
                                    Blocked
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                            className={`p-1.5 rounded-lg transition-colors cursor-pointer shrink-0 ${
                              isQuarantined
                                ? 'text-destructive hover:text-white hover:bg-destructive bg-destructive/10'
                                : 'text-muted-slate hover:text-destructive hover:bg-red-50'
                            }`}
                            title="Remove attachment"
                            aria-label="Remove attachment"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>

                        {isQuarantined && (
                          <div className="mt-2.5 pt-2 border-t border-destructive/20 text-xs text-destructive flex items-start justify-between gap-3">
                            <p className="leading-relaxed">
                              <strong>Security Alert:</strong> This file was flagged by security scanning and quarantined for your protection. Please remove it and select a clean file.
                            </p>
                            <button
                              type="button"
                              onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                              className="shrink-0 text-xs font-bold text-destructive hover:underline cursor-pointer"
                            >
                              Remove file
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {fileError && <p className="text-xs text-destructive mt-1 font-medium">{fileError}</p>}
            </div>

            <div className="flex flex-wrap justify-end gap-3 pt-4 border-t border-border">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancelOrBack}
                className="cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleSaveDraft}
                disabled={loadingOptions || savingDraft || submitting || systemStatus === 'Under Maintenance'}
                className="cursor-pointer"
              >
                {savingDraft ? 'Saving Draft...' : 'Save as Draft'}
              </Button>
              <Button
                type="submit"
                variant="default"
                disabled={loadingOptions || submitting || savingDraft || systemStatus === 'Under Maintenance'}
                className="cursor-pointer"
              >
                {submitting ? 'Submitting...' : systemStatus === 'Under Maintenance' ? 'Maintenance Active' : 'Submit Ticket'}
              </Button>
            </div>
          </form>
        </div>
      </div>

      <AIDepartmentModal
        isOpen={showAIDepartmentModal}
        classification={aiClassification}
        selectedDepartment={selectedDepartment}
        onSelectDepartment={(dept) => setSelectedDepartment(dept)}
        onConfirm={handleConfirmAIDepartment}
        onCancel={() => setShowAIDepartmentModal(false)}
      />

      <NotificationModal
        isOpen={successModal}
        type="success"
        title="Ticket Submitted Successfully!"
        message="Your support ticket has been created and will be reviewed shortly."
        onClose={handleSuccessClose}
      />
    </>
  );
}
