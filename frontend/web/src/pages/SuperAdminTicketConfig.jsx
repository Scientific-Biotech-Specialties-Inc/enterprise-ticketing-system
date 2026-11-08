import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Search, Plus, MoreVertical, Clock, Save, Building2, ChevronRight, ChevronDown, ChevronUp, ArrowLeft, CheckCircle2, Edit3, Trash2, Power, AlertCircle, RotateCcw, GitBranch, ArrowRight, Lock, Info, ShieldCheck, ShieldAlert, FileUp, Check, HardDrive, Bell, Users, UserCheck, Mail, Layers, Star, MessageSquare, Hash, Eye, Calendar, Tag, EyeOff, Send, Key, RefreshCw, X, Sparkles, Sliders, Settings, Table, ArrowUpDown } from 'lucide-react';
import { createPortal } from 'react-dom';
import NotificationModal from '@/components/NotificationModal';
import { PageHeader } from '@/components/ui/page-header';
import { useAuth } from '@/context/AuthContext';
import {
  getSuperAdminConfig,
  createSuperAdminEquipment,
  updateSuperAdminEquipment,
  deleteSuperAdminEquipment,
  createSuperAdminTicketCategory,
  updateSuperAdminTicketCategory,
  deleteSuperAdminTicketCategory,
  createSuperAdminPriority,
  updateSuperAdminPriority,
  deleteSuperAdminPriority,
  getTicketLimitConfig,
  updateTicketLimitConfig,
  resetTicketLimitConfig,
  getTicketNumberFormatConfig,
  updateTicketNumberFormatConfig,
  resetTicketNumberFormatConfig,
  getTicketDefaultsConfig,
  updateTicketDefaultsConfig,
  resetTicketDefaultsConfig,
  getSLARules,
  saveDepartmentSLARules,
  recalculateOpenTicketSlas,
  getDepartments,
  getWorkflowStatuses,
  createWorkflowStatus,
  updateWorkflowStatus,
  deleteWorkflowStatus,
  resetWorkflowStatuses,
  getEscalationRules,
  createEscalationRule,
  updateEscalationRule,
  toggleEscalationRule,
  deleteEscalationRule,
  getTicketFormOptions,
  getBranchPriorities,
  createBranchPriority,
  updateBranchPriority,
  deleteBranchPriority,
  getBranchCategoriesAndSla,
  createBranchCategory,
  updateBranchCategory,
  deleteBranchCategory,
  resetBranchCategoriesToDefaults,
  saveBranchSlaPolicy,
  deleteBranchSlaPolicy
} from '@/services/ticketService';

import {
  getEmailConfiguration,
  saveEmailConfiguration,
  updateEmailConfiguration,
  updateEmailApiKey,
  removeEmailConfiguration,
  sendTestEmail,
  getEmailTemplates,
  updateEmailTemplate,
  toggleEmailTemplate,
  resetEmailTemplate,
  sendTestTemplateEmail,
  getNotificationChannels,
  updateNotificationChannels,
  resetNotificationChannels,
  getFeedbackQuestions,
  createFeedbackQuestion,
  updateFeedbackQuestion,
  toggleFeedbackQuestion,
  reorderFeedbackQuestions,
  deleteFeedbackQuestion,
  resetFeedbackQuestions,
  seedFeedbackCategory,
  getFeedbackFormStatus,
  updateFeedbackFormStatus,
  getCategoryFeedbackToggles,
  setCategoryFeedbackToggle,
  disableFeedbackCategory,
  getCachedWindowConfiguration,
  getWindowConfiguration,
  updateWindowConfiguration,
  resetWindowConfiguration,
  getNotificationRouting,
  updateNotificationRouting,
  resetNotificationRouting,
  getTransitionRulesConfig,
  updateTransitionRulesConfig,
  resetTransitionRulesConfig,
  getBusinessHoursConfig,
  updateBusinessHoursConfig,
  getFileLimitsConfig,
  updateFileLimitsConfig,
  resetFileLimitsConfig,
  getMessagingConfiguration,
  updateMessagingConfiguration,
  resetMessagingConfiguration,
} from '@/services/configurationService';
import EmailVisualEditor from '@/components/EmailVisualEditor';

import useRealtimeRefresh from '@/hooks/useRealtimeRefresh';
import { isFeedbackFormEnabled, setFeedbackFormEnabled } from '@/data/mockFeedbackData';
import { getMaxOpenTicketsLimit, setMaxOpenTicketsLimit, OPEN_STATUS_SET } from '@/data/ticketLimitConfig';
import {
  isMessageArchivalOnClosureEnabled,
  setMessageArchivalOnClosureEnabled,
} from '@/data/messageArchivalConfig';
import BranchSelector from '@/components/BranchSelector';
import { useBranch } from '@/context/BranchContext';
import {
  SYSTEM_DEFAULT_CATEGORIES,
  SYSTEM_DEFAULT_CATEGORY_SLAS,
  INITIAL_BRANCH_CATEGORIES,
  INITIAL_BRANCH_SLA_POLICIES,
  getStoredBranchCategories,
  setStoredBranchCategories,
  getStoredBranchSlaPolicies,
  setStoredBranchSlaPolicies,
} from '@/data/branchCategoryConfig';

export const GROUP_CLASSIFICATION = 'classification';
export const GROUP_LIFECYCLE = 'lifecycle';
export const GROUP_SLA_ESCALATION = 'sla-escalation';
export const GROUP_NOTIFICATIONS = 'notifications';
export const GROUP_SECURITY = 'security';

export const TAB_TICKET_CATEGORIES = 'ticket-categories';
export const TAB_EQUIPMENT = 'equipment';
export const TAB_PRIORITY = 'priority';
export const TAB_BRANCH_CONFIG = 'branch-config';
export const TAB_BRANCH_PRIORITY = 'branch-priority';
export const TAB_BRANCH_CATEGORIES = 'branch-categories';
export const TAB_DEFAULTS = 'defaults';
export const TAB_NUMBER_FORMAT = 'number-format';
export const TAB_LIMITS = 'limits';
export const TAB_SLA = 'sla';
export const TAB_WORKFLOW = 'workflow';
export const TAB_TRANSITIONS = 'transitions';
export const TAB_FILES = 'files';
export const TAB_WINDOWS = 'windows';
export const TAB_NOTIFICATIONS = 'notifications';
export const TAB_ESCALATION = 'escalation';
export const TAB_FEEDBACK = 'feedback';
export const TAB_MESSAGING = 'messaging';

export const BRANCH_SUBTAB_CATEGORIES = 'categories';
export const BRANCH_SUBTAB_PRIORITIES = 'priorities-sla';

export const NOTIF_SUBTAB_RECIPIENTS = 'recipients';
export const NOTIF_SUBTAB_CHANNELS = 'channels';
export const NOTIF_SUBTAB_EMAIL_DELIVERY = 'email-delivery';
export const NOTIF_SUBTAB_EMAIL_TEMPLATES = 'email-templates';

export const GROUPS_CONFIG = [
  {
    id: GROUP_CLASSIFICATION,
    label: 'Classification',
    defaultSubTab: TAB_TICKET_CATEGORIES,
    subTabs: [
      { id: TAB_TICKET_CATEGORIES, label: 'Ticket Categories' },
      { id: TAB_EQUIPMENT, label: 'Equipment Categories' },
      { id: TAB_PRIORITY, label: 'Priority Levels' },
      { id: TAB_BRANCH_CONFIG, label: 'Branch Configuration' },
      { id: TAB_DEFAULTS, label: 'Ticket Defaults' },
      { id: TAB_NUMBER_FORMAT, label: 'Ticket Number Format' },
      { id: TAB_LIMITS, label: 'Max Open Tickets' },
    ],
  },
  {
    id: GROUP_LIFECYCLE,
    label: 'Lifecycle & Workflow',
    defaultSubTab: TAB_WORKFLOW,
    subTabs: [
      { id: TAB_WORKFLOW, label: 'Statuses & Sequence' },
      { id: TAB_TRANSITIONS, label: 'Transition Matrix' },
      { id: TAB_WINDOWS, label: 'Closure Windows' },
      { id: TAB_FEEDBACK, label: 'Feedback Form' },
      { id: TAB_MESSAGING, label: 'Messaging' },
    ],
  },
  {
    id: GROUP_SLA_ESCALATION,
    label: 'SLA & Escalations',
    defaultSubTab: TAB_SLA,
    subTabs: [
      { id: TAB_SLA, label: 'Department SLAs' },
      { id: TAB_ESCALATION, label: 'Escalation Rules' },
    ],
  },
  {
    id: GROUP_NOTIFICATIONS,
    label: 'Notifications',
    defaultSubTab: NOTIF_SUBTAB_RECIPIENTS,
    subTabs: [
      { id: NOTIF_SUBTAB_RECIPIENTS, label: 'Recipients' },
      { id: NOTIF_SUBTAB_CHANNELS, label: 'Channels' },
      { id: NOTIF_SUBTAB_EMAIL_DELIVERY, label: 'Email Delivery' },
      { id: NOTIF_SUBTAB_EMAIL_TEMPLATES, label: 'Email Templates' },
    ],
  },
  {
    id: GROUP_SECURITY,
    label: 'Storage & Security',
    defaultSubTab: TAB_FILES,
    subTabs: [
      { id: TAB_FILES, label: 'File Limits & Security' },
    ],
  },
];

export const SUBTAB_METADATA = {
  // Classification
  [TAB_TICKET_CATEGORIES]: {
    icon: Tag,
    subtitle: 'Problem categories & default classifications',
  },
  [TAB_EQUIPMENT]: {
    icon: HardDrive,
    subtitle: 'Hardware, equipment, and device categories',
  },
  [TAB_PRIORITY]: {
    icon: AlertCircle,
    subtitle: 'Urgency tiers, response targets & colors',
  },
  [TAB_BRANCH_CONFIG]: {
    icon: Building2,
    subtitle: 'Branch-level categories & SLA overrides',
  },
  [TAB_DEFAULTS]: {
    icon: Sliders,
    subtitle: 'Default status, priority, and dynamic SLA',
  },
  [TAB_NUMBER_FORMAT]: {
    icon: Hash,
    subtitle: 'Ticket ID prefix, date format & sequence padding',
  },
  [TAB_LIMITS]: {
    icon: Users,
    subtitle: 'Concurrency thresholds & max open ticket limits',
  },

  // Lifecycle & Workflow
  [TAB_WORKFLOW]: {
    icon: GitBranch,
    subtitle: 'Progression stages from submission to closure',
  },
  [TAB_TRANSITIONS]: {
    icon: ArrowRight,
    subtitle: 'Allowed state transitions & workflow matrix',
  },
  [TAB_WINDOWS]: {
    icon: Clock,
    subtitle: 'Reopening grace periods & auto-closure timers',
  },
  [TAB_FEEDBACK]: {
    icon: Star,
    subtitle: 'CSAT rating questions & feedback triggers',
  },
  [TAB_MESSAGING]: {
    icon: MessageSquare,
    subtitle: 'Ticket messaging participant rules & delegation access',
  },

  // SLA & Escalations
  [TAB_SLA]: {
    icon: ShieldCheck,
    subtitle: 'Department SLA response & resolution hours',
  },
  [TAB_ESCALATION]: {
    icon: ShieldAlert,
    subtitle: 'Automated breach escalation & alert stages',
  },

  // Notifications
  [NOTIF_SUBTAB_RECIPIENTS]: {
    icon: Users,
    subtitle: 'Alert recipient groups, managers & technicians',
  },
  [NOTIF_SUBTAB_CHANNELS]: {
    icon: Bell,
    subtitle: 'In-app, browser notification & sound channels',
  },
  [NOTIF_SUBTAB_EMAIL_DELIVERY]: {
    icon: Send,
    subtitle: 'SMTP / Resend API delivery configuration',
  },
  [NOTIF_SUBTAB_EMAIL_TEMPLATES]: {
    icon: Mail,
    subtitle: 'Transactional email notification templates',
  },

  // Storage & Security
  [TAB_FILES]: {
    icon: FileUp,
    subtitle: 'File size limits, allowed extensions & ClamAV',
  },
};


// ==========================================
// TS094: Ticket Number Format Configuration Constants
// ==========================================
export const TS094_DEFAULT_FORMAT = {
  prefix: 'TKT',
  includeDeptCode: false,
  deptCode: '',
  dateSegment: 'none',
  digitLength: 4,
};

export const TS095_DEFAULT_CONFIG = {
  status: 'Open',
  priority: 'Low',
  slaPolicy: 'dynamic',
};

export const getCachedDefaultsConfig = () => {
  try {
    const saved = localStorage.getItem('superadmin_ticket_defaults_config');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object') {
        return {
          status: String(parsed.status || 'Open'),
          priority: String(parsed.priority || 'Low'),
          slaPolicy: String(parsed.slaPolicy || 'dynamic'),
        };
      }
    }
  } catch {}
  return TS095_DEFAULT_CONFIG;
};

export const getCachedNumberFormatConfig = () => {
  try {
    const saved = localStorage.getItem('superadmin_ticket_number_format_config');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object') {
        return {
          prefix: String(parsed.prefix || 'TKT').toUpperCase(),
          includeDeptCode: Boolean(parsed.includeDeptCode ?? false),
          deptCode: String(parsed.deptCode || '').toUpperCase(),
          dateSegment: String(parsed.dateSegment || 'none'),
          digitLength: Number(parsed.digitLength ?? 4),
        };
      }
    }
  } catch {}
  return TS094_DEFAULT_FORMAT;
};

export const TS094_DATE_OPTIONS = [
  { value: 'none', label: 'None (Omit date segment) — Current behavior' },
  { value: 'YYYY', label: 'YYYY (e.g. 2026)' },
  { value: 'YYYYMM', label: 'YYYYMM (e.g. 202609)' },
  { value: 'YYYYMMDD', label: 'YYYYMMDD (e.g. 20260925)' },
];

// ==========================================
// TS104: Feedback Form Configuration Constants
// ==========================================
// Category source is provisional — pending confirmation with PM on whether this should map to the Departments API or remain a dedicated Feedback Form category concept. Do not assume these values match items.departments.
export const FEEDBACK_CATEGORIES = ['IT', 'Service', 'Others'];

export const TS104_RESPONSE_TYPES = ['Star Rating', 'Yes / No', 'Multiple Choice', 'Checkbox', 'Free Text'];

export const TS104_DEFAULT_QUESTIONS = {
  'IT': [
    {
      id: 'it-1',
      text: "How would you rate the technician's technical knowledge?",
      responseType: 'Star Rating',
      isEnabled: true,
    },
    {
      id: 'it-2',
      text: 'Was your issue resolved on the first visit?',
      responseType: 'Multiple Choice',
      isEnabled: true,
    },
    {
      id: 'it-3',
      text: 'Do you have any additional feedback about the IT support provided?',
      responseType: 'Free Text',
      isEnabled: false,
    },
  ],
  'Service': [
    {
      id: 'svc-1',
      text: 'How satisfied are you with the timeliness and professionalism of the service engineer?',
      responseType: 'Star Rating',
      isEnabled: true,
    },
    {
      id: 'svc-2',
      text: 'Did the technician explain the issue and repair clearly?',
      responseType: 'Multiple Choice',
      isEnabled: true,
    },
    {
      id: 'svc-3',
      text: 'Any suggestions for improving our on-site service experience?',
      responseType: 'Free Text',
      isEnabled: true,
    },
  ],
  'Others': [
    {
      id: 'oth-1',
      text: 'How would you rate your overall support experience?',
      responseType: 'Star Rating',
      isEnabled: true,
    },
    {
      id: 'oth-2',
      text: 'Would you recommend our support team to others?',
      responseType: 'Multiple Choice',
      isEnabled: true,
    },
    {
      id: 'oth-3',
      text: 'Please share any additional comments or suggestions for our team.',
      responseType: 'Free Text',
      isEnabled: false,
    },
  ],
};

export const DEFAULT_WORKFLOW_TRANSITION_RULES = {
  'New': {
    allowed: ['Assigned', 'Closed'],
    type: 'editable',
    description: 'Initial ticket state upon customer or employee submission.',
  },
  'Assigned': {
    allowed: ['In Progress', 'Pending Reassignment', 'Pending Parts', 'Closed'],
    type: 'editable',
    description: 'Ticket has been assigned to a technician and is awaiting action.',
  },
  'Pending Reassignment': {
    allowed: ['Assigned', 'In Progress'],
    type: 'editable',
    description: 'Awaiting CS decision on reassignment request. Returns to Assigned or In Progress if rejected/failed.',
  },
  'In Progress': {
    allowed: ['Pending Parts', 'Pending Evaluation', 'Pending Reassignment', 'Resolved', 'Assigned'],
    type: 'editable',
    description: 'Technician is actively working to diagnose and resolve the issue.',
  },
  'Pending Parts': {
    allowed: ['In Progress', 'Assigned', 'Resolved'],
    type: 'editable',
    description: 'Waiting for replacement parts, external vendor, or requester response.',
  },
  'Pending Evaluation': {
    allowed: ['Resolved', 'In Progress'],
    type: 'editable',
    description: 'Work order or proof submitted, awaiting CS or customer evaluation.',
  },
  'Resolved': {
    allowed: ['Closed', 'In Progress'],
    type: 'editable',
    description: 'Service completed and pending confirmation from the requester.',
  },
  'Closed': {
    allowed: ['In Progress', 'New'],
    type: 'editable',
    caption: 'Reopening is permitted within the configured reopen window (48h).',
    description: 'Final confirmed state. Can transition back to In Progress or New if reopened.',
  },
};

// The transition matrix edits the ticket state machine that the backend actually
// enforces (employee-service / ticket-service TicketStateMachine). These names are
// the keys the backend reads from the "transitions" configuration, so they must not
// be replaced by the display names from "Statuses & Sequence".
export const STATE_MACHINE_TRANSITION_STATES = [
  { id: 'sm-open', name: 'Open', order: 1, bgColor: '#DBEAFE', textColor: '#1D4ED8', isSystem: true, description: 'Initial ticket state upon customer or internal creation.' },
  { id: 'sm-in-progress-cs', name: 'In Progress (CS-owned)', order: 2, bgColor: '#FEE2E2', textColor: '#B91C1C', isSystem: true, description: 'Ticket being triaged or actively handled directly by Customer Service.' },
  { id: 'sm-assigned', name: 'Assigned', order: 3, bgColor: '#FFEDD5', textColor: '#C2410C', isSystem: true, description: 'Ticket dispatched to an engineer or technician and awaiting their acceptance.' },
  { id: 'sm-reassigned', name: 'Reassigned', order: 4, bgColor: '#FEF9C3', textColor: '#A16207', isSystem: true, description: 'Ticket reassignment requested or approved for re-dispatch.' },
  { id: 'sm-in-progress-employee', name: 'In Progress (Employee-owned)', order: 5, bgColor: '#FEE2E2', textColor: '#B91C1C', isSystem: true, description: 'Service engineer has accepted the assignment and is actively working on it.' },
  { id: 'sm-on-hold', name: 'On Hold/Pending', order: 6, bgColor: '#F3E8FF', textColor: '#7E22CE', isSystem: true, description: 'Ticket paused awaiting parts, customer feedback, or an external dependency.' },
  { id: 'sm-resolved', name: 'Resolved', order: 7, bgColor: '#DCFCE7', textColor: '#15803D', isSystem: true, description: 'Work is marked complete with proof of completion pending evaluation.' },
  { id: 'sm-closed', name: 'Closed', order: 8, bgColor: '#F3F4F6', textColor: '#4B5563', isSystem: true, description: 'Final confirmed state. Can transition to Reopened within the reopen window.' },
  { id: 'sm-escalated', name: 'Escalated', order: 9, bgColor: '#FCE7F3', textColor: '#BE185D', isSystem: true, description: 'Ticket escalated to supervisory or department leadership.' },
  { id: 'sm-reopened', name: 'Reopened', order: 10, bgColor: '#CCFBF1', textColor: '#0F766E', isSystem: true, description: 'Ticket reopened by the customer within the window; routes automatically to CS.' },
  { id: 'sm-cancelled', name: 'Cancelled', order: 11, bgColor: '#F3F4F6', textColor: '#4B5563', isSystem: true, description: 'Ticket discarded or cancelled before assignment.' },
];

// Mirrors TicketStateMachine::DEFAULT_TRANSITIONS on the backend.
export const DEFAULT_STATE_MACHINE_TRANSITION_RULES = {
  'Open': { allowed: ['In Progress (CS-owned)', 'Assigned', 'In Progress (Employee-owned)', 'Closed', 'Cancelled', 'Escalated'], type: 'editable', description: STATE_MACHINE_TRANSITION_STATES[0].description },
  'In Progress (CS-owned)': { allowed: ['On Hold/Pending', 'Assigned', 'Resolved', 'Closed', 'Escalated'], type: 'editable', description: STATE_MACHINE_TRANSITION_STATES[1].description },
  'Assigned': { allowed: ['Reassigned', 'In Progress (Employee-owned)', 'On Hold/Pending', 'Escalated'], type: 'editable', description: STATE_MACHINE_TRANSITION_STATES[2].description },
  'Reassigned': { allowed: ['In Progress (Employee-owned)', 'Assigned', 'On Hold/Pending', 'Escalated'], type: 'editable', description: STATE_MACHINE_TRANSITION_STATES[3].description },
  'In Progress (Employee-owned)': { allowed: ['On Hold/Pending', 'Reassigned', 'Resolved', 'Assigned', 'Closed', 'Escalated'], type: 'editable', description: STATE_MACHINE_TRANSITION_STATES[4].description },
  'On Hold/Pending': { allowed: [], type: 'contextual', caption: 'Contextual transition: resumes back to whichever In Progress state it came from. This is non-editable.', description: STATE_MACHINE_TRANSITION_STATES[5].description },
  'Resolved': { allowed: ['Closed', 'In Progress (Employee-owned)'], type: 'editable', description: STATE_MACHINE_TRANSITION_STATES[6].description },
  'Closed': { allowed: ['Reopened'], type: 'editable', caption: 'Reopening is permitted only within the configured reopen window.', description: STATE_MACHINE_TRANSITION_STATES[7].description },
  'Escalated': { allowed: ['Assigned', 'In Progress (Employee-owned)', 'In Progress (CS-owned)', 'Resolved', 'Closed'], type: 'editable', description: 'Ticket escalated to supervisory or department leadership.' },
  'Reopened': { allowed: ['In Progress (CS-owned)'], type: 'fixed', caption: 'Automatic transition: Reopened tickets route to Customer Service. This is non-editable.', description: STATE_MACHINE_TRANSITION_STATES[9].description },
  'Cancelled': { allowed: [], type: 'terminal', caption: 'Terminal status: no further transitions permitted from Cancelled.', description: STATE_MACHINE_TRANSITION_STATES[10].description },
};

export const TS093_STATUSES = [
  'New',
  'Assigned',
  'Pending Reassignment',
  'In Progress',
  'Pending Parts',
  'Pending Evaluation',
  'Resolved',
  'Closed',
];

export const TS093_DEFAULT_RULES = DEFAULT_WORKFLOW_TRANSITION_RULES;

export const TS098_AVAILABLE_EXTENSIONS = [
  { ext: 'PDF', label: 'PDF Document', desc: 'Adobe Acrobat (.pdf)', mime: 'application/pdf' },
  { ext: 'DOCX', label: 'Word Document', desc: 'Microsoft Word XML (.docx)', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { ext: 'DOC', label: 'Legacy Word', desc: 'Microsoft Word 97-2003 (.doc)', mime: 'application/msword' },
  { ext: 'JPG', label: 'JPEG Image', desc: 'Standard JPEG (.jpg)', mime: 'image/jpeg' },
  { ext: 'JPEG', label: 'JPEG Alt Image', desc: 'Joint Photographic Experts (.jpeg)', mime: 'image/jpeg' },
  { ext: 'PNG', label: 'PNG Image', desc: 'Portable Network Graphics (.png)', mime: 'image/png' },
  { ext: 'TXT', label: 'Plain Text', desc: 'ASCII / UTF-8 Text (.txt)', mime: 'text/plain' },
];

export const TS098_DEFAULT_FILE_CONFIG = {
  maxFileSizeMB: 15,
  allowedFileTypes: ['PDF', 'DOCX', 'DOC', 'JPG', 'JPEG', 'PNG'],
  maxFileCount: 5,
  malwareScanningEnabled: true,
};

export const TS100_DEFAULT_WINDOW_CONFIG = {
  reopenEnabled: true,
  reopenWindowDays: 2, // 48 hours (in active codebase: TicketService.php & CustomerTicketDetailModal.jsx)
  autoCloseEnabled: true,
  autoCloseWindowDays: 2, // 48 hours (in active codebase: AutoCloseInternalTickets.php command)
  archiveOnClosureEnabled: true, // TS067: Archive message thread on ticket closure
};

export const TS099_ALERT_TYPES = [
  {
    key: 'new_ticket',
    title: 'New Ticket Alert',
    badge: 'Creation',
    badgeColor: 'bg-blue-50 text-blue-700 border-blue-200',
    description: 'Dispatched immediately when an end-customer or internal employee submits a new ticket.',
    defaultSummary: 'Default: Customer Service (CS)',
  },
  {
    key: 'new_message',
    title: 'New Message Alert',
    badge: 'Messaging',
    badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    description: 'Dispatched when a new comment, message, or diagnostic update is posted to the ticket thread.',
    defaultSummary: 'Default: Assigned Employee (Contextual)',
  },
  {
    key: 'overdue_ticket',
    title: 'Overdue Ticket Alert',
    badge: 'SLA Escalation',
    badgeColor: 'bg-amber-50 text-amber-700 border-amber-200',
    description: 'Dispatched when an active ticket breaches its defined SLA response or resolution deadline.',
    defaultSummary: 'Default: Customer Service (CS)',
  },
];

export const TS099_STATIC_ROLES = [
  { id: 'role_cs', label: 'Customer Service (CS)', desc: 'All active customer service agents', type: 'role', badge: 'Role' },
  { id: 'role_service', label: 'Service Engineer / Employee', desc: 'All technicians in service & maintenance', type: 'role', badge: 'Role' },
  { id: 'role_it_admin', label: 'IT Admin', desc: 'Branch IT and system administrators', type: 'role', badge: 'Role' },
  { id: 'role_superadmin', label: 'Super Admin', desc: 'System administrators with global oversight', type: 'role', badge: 'Role' },
];

export const TS099_CONTEXTUAL_RECIPIENTS = [
  { id: 'contextual_assigned', label: 'Assigned Employee', desc: 'The specific technician actively assigned to the ticket (resolves dynamically)', isContextual: true },
  { id: 'contextual_requester', label: 'Ticket Requester / Customer', desc: 'The customer or employee who created the ticket (resolves dynamically)', isContextual: true },
];

export const TS099_DEFAULT_ROUTING = {
  new_ticket: ['role_cs'],
  new_message: ['contextual_assigned'],
  overdue_ticket: ['role_cs'],
};

export const TS103_CHANNEL_OPTIONS = [
  { id: 'email', label: 'Email only' },
  { id: 'in_app', label: 'In-App only' },
  { id: 'both', label: 'Both' },
];

export const TS103_ALERT_TYPES = [
  {
    key: 'new_ticket',
    title: 'New Ticket',
    badge: 'Creation',
    badgeColor: 'bg-blue-50 text-blue-700 border-blue-200',
    description: 'Triggered immediately when an end-customer or internal employee submits a new ticket.',
    defaultChannel: 'both',
  },
  {
    key: 'status_update',
    title: 'Status Update',
    badge: 'Lifecycle',
    badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    description: 'Triggered when a ticket transitions between statuses (e.g. Open, In Progress, Resolved).',
    defaultChannel: 'both',
  },
  {
    key: 'escalation_delegation',
    title: 'Escalation & Assignment',
    badge: 'Escalation',
    badgeColor: 'bg-purple-50 text-purple-700 border-purple-200',
    description: 'Triggered when a ticket SLA approaches breach or an engineer is assigned/delegated.',
    defaultChannel: 'both',
  },
  {
    key: 'reassignment',
    title: 'Reassignment',
    badge: 'Staff Transfer',
    badgeColor: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    description: 'Triggered when ticket ownership is transferred to another technician or department.',
    defaultChannel: 'email',
  },
  {
    key: 'new_message',
    title: 'New Message',
    badge: 'Messaging',
    badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    description: 'Triggered when a customer or staff member posts a message in the ticket thread.',
    defaultChannel: 'in_app',
  },
  {
    key: 'overdue_sla_breach',
    title: 'Overdue & SLA Breach',
    badge: 'SLA Warning',
    badgeColor: 'bg-amber-50 text-amber-700 border-amber-200',
    description: 'Triggered when a ticket response or resolution SLA has officially breached its deadline.',
    defaultChannel: 'both',
  },
  {
    key: 'system_alert',
    title: 'System Alert',
    badge: 'System Critical',
    badgeColor: 'bg-rose-50 text-rose-700 border-rose-200',
    description: 'Critical infrastructure, security, or service desk failures requiring global administrative attention.',
    defaultChannel: 'both',
    isSystemAlert: true,
  },
];

export const TS103_DEFAULT_CHANNELS = {
  new_ticket: 'both',
  status_update: 'both',
  escalation_delegation: 'both',
  reassignment: 'email',
  new_message: 'in_app',
  overdue_sla_breach: 'both',
  system_alert: 'both',
};

const priorityColorOptions = [
  { value: 'bg-red-100 text-red-700', label: 'Red' },
  { value: 'bg-orange-100 text-orange-700', label: 'Orange' },
  { value: 'bg-yellow-100 text-yellow-700', label: 'Yellow' },
  { value: 'bg-green-100 text-green-700', label: 'Green' },
  { value: 'bg-blue-100 text-blue-700', label: 'Blue' },
  { value: 'bg-purple-100 text-purple-700', label: 'Purple' },
  { value: 'bg-indigo-100 text-indigo-700', label: 'Indigo' },
  { value: 'bg-pink-100 text-pink-700', label: 'Pink' },
  { value: 'bg-gray-100 text-gray-700', label: 'Gray' },
];

// Display hints for well known priority names. The priority list itself always
// comes from the database (ticket_priorities); unknown names fall back to gray.
const PRIORITY_STYLE_HINTS = {
  critical: { badgeClass: 'bg-red-100 text-red-700 border-red-200', defaultResp: 15, defaultRes: 240 },
  high: { badgeClass: 'bg-orange-100 text-orange-700 border-orange-200', defaultResp: 30, defaultRes: 480 },
  medium: { badgeClass: 'bg-yellow-100 text-yellow-700 border-yellow-200', defaultResp: 120, defaultRes: 1440 },
  low: { badgeClass: 'bg-green-100 text-green-700 border-green-200', defaultResp: 240, defaultRes: 4320 },
};
const FALLBACK_PRIORITY_STYLE = { badgeClass: 'bg-gray-100 text-gray-700 border-gray-200', defaultResp: 60, defaultRes: 1440 };

const buildSlaPriorityList = (priorities = []) => (
  [...priorities]
    .filter((p) => p && p.name)
    // Higher priority_ID = more urgent in ticket_priorities, so list most urgent first.
    .sort((a, b) => Number(b.id) - Number(a.id))
    .map((p) => ({ name: p.name, ...(PRIORITY_STYLE_HINTS[String(p.name).toLowerCase()] || FALLBACK_PRIORITY_STYLE) }))
);

const DURATION_UNITS = [
  { value: 'mins', label: 'Minutes', factor: 1 },
  { value: 'hours', label: 'Hours', factor: 60 },
  { value: 'days', label: 'Days', factor: 1440 },
];

// ISO weekday numbering (1 = Monday ... 7 = Sunday), matching the backend.
const BUSINESS_WEEKDAYS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

const DEFAULT_BUSINESS_HOURS = { enabled: true, timezone: 'UTC', startTime: '08:00', endTime: '17:00', workingDays: [1, 2, 3, 4, 5] };

const getBrowserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const getTimezoneOptions = () => {
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      const list = Intl.supportedValuesOf('timeZone');
      return list.includes('UTC') ? list : ['UTC', ...list];
    }
  } catch {
    // fall through
  }
  return ['UTC', getBrowserTimezone()].filter((v, i, a) => a.indexOf(v) === i);
};

// Convert an "HH:MM" wall time in one timezone to "HH:MM" in another (for today's date).
const formatTimeInZone = (hhmm, fromZone, toZone) => {
  try {
    const [h, m] = String(hhmm).split(':').map(Number);
    const now = new Date();
    // Offset of fromZone at this moment, in minutes.
    const zoned = (zone) => {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        .formatToParts(now).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
      return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
    };
    const fromOffset = (zoned(fromZone) - now.getTime()) / 60000;
    const utcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m) - fromOffset * 60000;
    return new Intl.DateTimeFormat('en-US', { timeZone: toZone, hour: 'numeric', minute: '2-digit' }).format(new Date(utcMs));
  } catch {
    return hhmm;
  }
};

const describeBusinessHours = (bh) => {
  if (!bh?.enabled) return 'around the clock (24/7)';
  const days = BUSINESS_WEEKDAYS.filter((d) => (bh.workingDays || []).includes(d.value)).map((d) => d.label).join(', ');
  return `${bh.startTime} to ${bh.endTime} (${bh.timezone}) on ${days || 'no days'}`;
};

const pickDurationUnit = (minutes) => {
  const m = parseInt(minutes, 10);
  if (!m || Number.isNaN(m)) return 'mins';
  if (m % 1440 === 0) return 'days';
  if (m % 60 === 0) return 'hours';
  return 'mins';
};

const durationToMinutes = (text, unit) => {
  if (text === '' || text === null || text === undefined) return '';
  const num = parseFloat(text);
  if (Number.isNaN(num)) return '';
  const factor = DURATION_UNITS.find((u) => u.value === unit)?.factor || 1;
  return String(Math.round(num * factor));
};

/**
 * Number input with a minutes / hours / days picker. Always reports minutes
 * (as a string) through onChange so the SLA payload stays in minutes.
 */
const DurationInput = ({ minutes, onChange, placeholderMinutes, ariaLabel }) => {
  const [unit, setUnit] = useState(() => pickDurationUnit(minutes));
  const [text, setText] = useState(() => {
    if (minutes === '' || minutes === null || minutes === undefined) return '';
    const factor = DURATION_UNITS.find((u) => u.value === pickDurationUnit(minutes)).factor;
    return String(parseInt(minutes, 10) / factor);
  });

  // Re-sync when the value changes from outside (e.g. switching department).
  useEffect(() => {
    if (String(minutes ?? '') === durationToMinutes(text, unit)) return;
    if (minutes === '' || minutes === null || minutes === undefined) {
      setText('');
      return;
    }
    const nextUnit = pickDurationUnit(minutes);
    const factor = DURATION_UNITS.find((u) => u.value === nextUnit).factor;
    setUnit(nextUnit);
    setText(String(parseInt(minutes, 10) / factor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minutes]);

  const placeholderUnitFactor = DURATION_UNITS.find((u) => u.value === unit).factor;
  const placeholderValue = placeholderMinutes ? +(placeholderMinutes / placeholderUnitFactor).toFixed(2) : '';

  return (
    <div className="flex gap-2">
      <input
        type="number"
        min="0"
        step="any"
        aria-label={ariaLabel}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(durationToMinutes(e.target.value, unit));
        }}
        placeholder={placeholderValue ? `e.g. ${placeholderValue}` : ''}
        className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50/50 px-3.5 py-2.5 text-sm font-medium outline-none focus:bg-white focus:ring-2 focus:ring-[#252578]"
      />
      <select
        aria-label={ariaLabel ? `${ariaLabel} unit` : 'Unit'}
        value={unit}
        onChange={(e) => {
          setUnit(e.target.value);
          onChange(durationToMinutes(text, e.target.value));
        }}
        className="rounded-xl border border-gray-200 bg-white px-2 py-2.5 text-sm font-medium outline-none focus:ring-2 focus:ring-[#252578]"
      >
        {DURATION_UNITS.map((u) => (
          <option key={u.value} value={u.value}>{u.label}</option>
        ))}
      </select>
    </div>
  );
};

const defaultWorkflowStatuses = [
  { id: 1, name: 'New', description: 'Ticket has been submitted and is awaiting review', bgColor: '#DBEAFE', textColor: '#1D4ED8', order: 1, isSystem: true, requiresPreviousFulfilled: false, prerequisiteStatusId: null },
  { id: 2, name: 'Assigned', description: 'Ticket has been assigned to a technician', bgColor: '#FFEDD5', textColor: '#C2410C', order: 2, isSystem: true, requiresPreviousFulfilled: true, prerequisiteStatusId: 1 },
  { id: 3, name: 'Pending Reassignment', description: 'Technician requested ticket reassignment, awaiting review', bgColor: '#FEF9C3', textColor: '#A16207', order: 3, isSystem: true, requiresPreviousFulfilled: false, prerequisiteStatusId: null },
  { id: 4, name: 'In Progress', description: 'Technician is actively working on the ticket', bgColor: '#FEE2E2', textColor: '#B91C1C', order: 4, isSystem: true, requiresPreviousFulfilled: true, prerequisiteStatusId: 2 },
  { id: 5, name: 'Pending Parts', description: 'Waiting for replacement parts to arrive', bgColor: '#F3E8FF', textColor: '#7E22CE', order: 5, isSystem: true, requiresPreviousFulfilled: false, prerequisiteStatusId: null },
  { id: 6, name: 'Pending Evaluation', description: 'Work completed and proof submitted, awaiting CS or customer evaluation', bgColor: '#CCFBF1', textColor: '#0F766E', order: 6, isSystem: true, requiresPreviousFulfilled: true, prerequisiteStatusId: 4 },
  { id: 7, name: 'Resolved', description: 'Issue has been resolved pending confirmation', bgColor: '#DCFCE7', textColor: '#15803D', order: 7, isSystem: true, requiresPreviousFulfilled: true, prerequisiteStatusId: 6 },
  { id: 8, name: 'Closed', description: 'Ticket has been closed and confirmed by the requester', bgColor: '#F3F4F6', textColor: '#4B5563', order: 8, isSystem: true, requiresPreviousFulfilled: true, prerequisiteStatusId: 7 },
];

const defaultEscalationRules = [
  {
    id: 1,
    name: 'Response Deadline Escalation',
    isActive: true,
    trigger: 'Response deadline approaching',
    condition: { text: 'No response within 30 minutes before deadline', highlight: '30 minutes' },
    action: 'Auto-escalate to Senior Engineer',
    notify: 'CS + Manager',
  },
  {
    id: 2,
    name: 'Critical Priority Escalation',
    isActive: true,
    trigger: 'Critical ticket unresolved',
    condition: { text: 'No resolution within 50% of SLA target', highlight: '50%' },
    action: 'Auto-escalate to Department Head',
    notify: 'CS + Manager + Department Head',
  },
  {
    id: 3,
    name: 'SLA Breach Prevention',
    isActive: false,
    trigger: 'Resolution deadline approaching',
    condition: { text: 'No resolution within 15 minutes before deadline', highlight: '15 minutes' },
    action: 'Auto-escalate to Senior Engineer',
    notify: 'CS + Manager',
  },
  {
    id: 4,
    name: 'Customer Reopen Escalation',
    isActive: true,
    trigger: 'Ticket reopened by customer',
    condition: { text: 'Same issue reopened within 7 days', highlight: '7 days' },
    action: 'Auto-assign to previous technician',
    notify: 'Previous Technician + Manager',
  },
];

const workflowColorOptions = [
  { bgColor: '#DBEAFE', textColor: '#1D4ED8', label: 'Blue' },
  { bgColor: '#FFEDD5', textColor: '#C2410C', label: 'Orange' },
  { bgColor: '#FEE2E2', textColor: '#B91C1C', label: 'Red' },
  { bgColor: '#F3E8FF', textColor: '#7E22CE', label: 'Purple' },
  { bgColor: '#DCFCE7', textColor: '#15803D', label: 'Green' },
  { bgColor: '#F3F4F6', textColor: '#4B5563', label: 'Gray' },
  { bgColor: '#FEF9C3', textColor: '#A16207', label: 'Yellow' },
  { bgColor: '#FCE7F3', textColor: '#BE185D', label: 'Pink' },
  { bgColor: '#CCFBF1', textColor: '#0F766E', label: 'Teal' },
];

const formatMinutes = (mins) => {
  if (mins === '' || mins === null || mins === undefined) return '';
  const m = parseInt(mins, 10);
  if (isNaN(m) || m <= 0) return '0 mins';
  if (m < 60) return `${m} mins`;
  const hours = m / 60;
  if (hours < 24) {
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} ${hours === 1 ? 'hr' : 'hrs'}`;
  }
  const days = hours / 24;
  return `${Number.isInteger(days) ? days : days.toFixed(1)} ${days === 1 ? 'day' : 'days'}`;
};

const formatFileSize = (mb) => {
  if (mb === '' || mb === null || mb === undefined) return '';
  const num = parseFloat(mb);
  if (isNaN(num) || num <= 0) return 'Invalid size';
  const bytes = Math.round(num * 1024 * 1024);
  return `${num} MB (${bytes.toLocaleString()} bytes)`;
};

const formatFileCount = (count) => {
  if (count === '' || count === null || count === undefined) return '';
  const num = parseInt(count, 10);
  if (isNaN(num) || num <= 0) return 'Invalid count';
  return num === 1 ? '1 file per upload' : `Up to ${num} files per upload`;
};

const formatWindowDays = (days, type) => {
  if (days === '' || days === null || days === undefined) return '';
  const num = parseInt(days, 10);
  if (isNaN(num) || num <= 0) return 'Invalid duration';
  const hours = num * 24;
  if (type === 'reopen') {
    return num === 1
      ? 'Tickets can be reopened for 1 day (24 hours) after closing'
      : `Tickets can be reopened for ${num} days (${hours} hours) after closing`;
  } else {
    return num === 1
      ? 'Tickets auto-close after 1 day (24 hours) with no customer response'
      : `Tickets auto-close after ${num} days (${hours} hours) with no customer response`;
  }
};

function TicketConfigTabSkeleton({ currentSubTab }) {
  const isTableLayout = [
    TAB_TICKET_CATEGORIES,
    TAB_EQUIPMENT,
    TAB_PRIORITY,
  ].includes(currentSubTab);

  const isGridLayout = [
    TAB_WORKFLOW,
    TAB_SLA,
    TAB_ESCALATION,
    TAB_TRANSITIONS,
  ].includes(currentSubTab);

  return (
    <div className="flex flex-col gap-6 animate-pulse" aria-busy="true" aria-label="Loading configuration">
      {/* Header Skeleton */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 space-y-2">
          <div className="h-7 w-60 bg-gray-200 rounded-lg" />
          <div className="h-4 w-96 max-w-full bg-gray-200 rounded-md" />
        </div>
        <div className="flex items-center gap-2.5">
          <div className="h-10 w-24 bg-gray-200 rounded-xl" />
          <div className="h-10 w-32 bg-gray-200 rounded-xl" />
        </div>
      </div>

      {isTableLayout ? (
        <div className="flex flex-col gap-4">
          <div className="h-11 w-full bg-gray-200 rounded-xl" />
          <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
            <div className="h-12 bg-gray-50 border-b border-gray-100 px-5 flex items-center gap-6">
              <div className="h-4 w-12 bg-gray-200 rounded" />
              <div className="h-4 w-36 bg-gray-200 rounded" />
              <div className="h-4 w-48 bg-gray-200 rounded" />
              <div className="h-4 w-24 bg-gray-200 rounded ml-auto" />
            </div>
            <div className="divide-y divide-gray-100">
              {[1, 2, 3, 4, 5].map((idx) => (
                <div key={idx} className="px-5 py-4 flex items-center gap-6">
                  <div className="h-4 w-10 bg-gray-200 rounded" />
                  <div className="h-4 w-32 bg-gray-200 rounded" />
                  <div className="h-4 w-64 bg-gray-200 rounded" />
                  <div className="h-6 w-20 bg-gray-200 rounded-full ml-auto" />
                  <div className="h-7 w-7 bg-gray-200 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : isGridLayout ? (
        <div className="flex flex-col gap-6">
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm flex justify-between gap-4">
            {[1, 2, 3, 4].map((step) => (
              <div key={step} className="flex flex-col items-center flex-1 gap-2">
                <div className="h-12 w-12 rounded-full bg-gray-200" />
                <div className="h-4 w-20 bg-gray-200 rounded" />
                <div className="h-3 w-28 bg-gray-100 rounded" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((idx) => (
              <div key={idx} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="h-5 w-28 bg-gray-200 rounded" />
                  <div className="h-5 w-16 bg-gray-200 rounded-full" />
                </div>
                <div className="h-3.5 w-full bg-gray-100 rounded" />
                <div className="h-3.5 w-3/4 bg-gray-100 rounded" />
                <div className="pt-2 border-t border-gray-100 flex items-center justify-between">
                  <div className="h-4 w-20 bg-gray-200 rounded" />
                  <div className="h-6 w-6 bg-gray-200 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm space-y-6">
          <div className="space-y-2">
            <div className="h-5 w-48 bg-gray-200 rounded" />
            <div className="h-3.5 w-80 bg-gray-100 rounded" />
          </div>
          <div className="space-y-4">
            <div className="h-10 w-full bg-gray-200 rounded-xl" />
            <div className="h-36 w-full bg-gray-100 rounded-xl" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="h-12 bg-gray-50 rounded-xl" />
              <div className="h-12 bg-gray-50 rounded-xl" />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <div className="h-10 w-24 bg-gray-200 rounded-xl" />
            <div className="h-10 w-32 bg-gray-200 rounded-xl" />
          </div>
        </div>
      )}
    </div>
  );
}

export default function SuperAdminTicketConfig() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const params = useParams();

  const storageKey = useMemo(() => {
    return user?.id ? `superadmin_ticket_config_state_${user.id}` : 'superadmin_ticket_config_state';
  }, [user?.id]);

  const initialSavedState = useMemo(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }, [storageKey]);

  const normalizeGroupId = useCallback((rawGroup) => {
    if (!rawGroup) return null;
    const g = rawGroup.toLowerCase();
    if (g === 'classification') return GROUP_CLASSIFICATION;
    if (g === 'lifecycle') return GROUP_LIFECYCLE;
    if (g === 'sla-escalation' || g === 'sla_escalation' || g === 'sla') return GROUP_SLA_ESCALATION;
    if (g === 'notifications') return GROUP_NOTIFICATIONS;
    if (g === 'security' || g === 'files') return GROUP_SECURITY;
    if (g === 'feedback') return GROUP_LIFECYCLE;
    return null;
  }, []);

  const normalizeSubTabId = useCallback((groupId, rawSubTab) => {
    if (!rawSubTab) return null;
    const s = rawSubTab.toLowerCase();
    if (groupId === GROUP_CLASSIFICATION) {
      if (s === 'ticket-categories' || s === 'ticket_categories' || s === 'ticket-category' || s === 'ticketcategories') {
        return TAB_TICKET_CATEGORIES;
      }
      if (s === 'branch-config' || s === 'branch-configuration' || s === 'branch' || s === 'branch_config') {
        return TAB_BRANCH_CONFIG;
      }
      if (s === 'branch-priority' || s === 'branch_priority') {
        setBranchSubSection(BRANCH_SUBTAB_PRIORITIES);
        return TAB_BRANCH_CONFIG;
      }
      if (s === 'branch-categories' || s === 'branch_categories') {
        setBranchSubSection(BRANCH_SUBTAB_CATEGORIES);
        return TAB_BRANCH_CONFIG;
      }
    }
    const groupDef = GROUPS_CONFIG.find((g) => g.id === groupId);
    if (!groupDef) return null;
    return groupDef.subTabs.find((st) => st.id.toLowerCase() === s)?.id || null;
  }, []);

  const findGroupBySubTabId = useCallback((rawSubTab) => {
    if (!rawSubTab) return null;
    const s = rawSubTab.toLowerCase();
    if (
      s === 'ticket-categories' || s === 'ticket_categories' || s === 'ticket-category' || s === 'ticketcategories' ||
      s === 'branch-config' || s === 'branch-configuration' || s === 'branch' || s === 'branch_config' ||
      s === 'branch-priority' || s === 'branch_priority' || s === 'branch-categories' || s === 'branch_categories' ||
      s === 'equipment' || s === 'priority' || s === 'defaults' || s === 'number-format' || s === 'limits'
    ) {
      return GROUP_CLASSIFICATION;
    }
    for (const group of GROUPS_CONFIG) {
      if (group.subTabs.some((st) => st.id.toLowerCase() === s)) {
        return group.id;
      }
    }
    return null;
  }, []);

  // The URL is the sole source of truth for what is rendered. Local storage only
  // remembers each group's last valid sub-tab for the next group navigation.
  const [activeSubTabs, setActiveSubTabs] = useState(() => ({
    [GROUP_CLASSIFICATION]: TAB_TICKET_CATEGORIES,
    [GROUP_LIFECYCLE]: TAB_WORKFLOW,
    [GROUP_SLA_ESCALATION]: TAB_SLA,
    [GROUP_NOTIFICATIONS]: NOTIF_SUBTAB_RECIPIENTS,
    [GROUP_SECURITY]: TAB_FILES,
    ...(initialSavedState?.activeSubTabs || {}),
  }));

  // Resolve active group and subtab from clean short routes (/superadmin/config/:subtab) or legacy routes
  const rawParam = params.subtab || params.group;
  const isDirectSubTab = findGroupBySubTabId(rawParam);
  const isDirectGroup = normalizeGroupId(rawParam);

  let routeGroup = null;
  let routeSubTab = null;

  if (params.group && params.subtab) {
    // Legacy dual-param route: /superadmin/ticket-config/:group/:subtab
    routeGroup = normalizeGroupId(params.group);
    if (routeGroup) {
      routeSubTab = normalizeSubTabId(routeGroup, params.subtab);
    }
  } else if (isDirectSubTab) {
    // Clean shortened 4-segment route: /superadmin/config/:subtab (e.g. email-templates, sla, workflow)
    routeGroup = isDirectSubTab;
    routeSubTab = normalizeSubTabId(routeGroup, rawParam);
  } else if (isDirectGroup) {
    // Shortened group route: /superadmin/config/:group (e.g. notifications)
    routeGroup = isDirectGroup;
    routeSubTab = normalizeSubTabId(routeGroup, activeSubTabs[routeGroup]);
  }

  const savedGroup = normalizeGroupId(initialSavedState?.activeGroup);
  const activeGroup = routeGroup || savedGroup || GROUP_CLASSIFICATION;

  const currentGroup = useMemo(() => {
    return GROUPS_CONFIG.find((g) => g.id === activeGroup) || GROUPS_CONFIG[0];
  }, [activeGroup]);

  const rememberedSubTab = normalizeSubTabId(activeGroup, activeSubTabs[activeGroup]);
  const currentSubTab = routeSubTab || rememberedSubTab || currentGroup.defaultSubTab;

  const tab = currentSubTab;
  const notifSubtab = currentSubTab;

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ activeGroup, activeSubTabs }));
    } catch {
      // Navigation remains URL-driven if storage is unavailable.
    }
  }, [storageKey, activeGroup, activeSubTabs]);

  useEffect(() => {
    const isLegacyRoute = window.location.pathname.includes('/ticket-config');
    const currentParam = params.subtab || params.group;
    if (isLegacyRoute || currentParam !== currentSubTab) {
      navigate(`/superadmin/config/${currentSubTab}`, { replace: true });
    }
  }, [params.group, params.subtab, currentSubTab, navigate]);

  useEffect(() => {
    if (!activeGroup || !currentSubTab) return;
    setActiveSubTabs((prev) => (
      prev[activeGroup] === currentSubTab
        ? prev
        : { ...prev, [activeGroup]: currentSubTab }
    ));
  }, [activeGroup, currentSubTab]);

  const handleSelectGroup = useCallback((groupId) => {
    const validGroup = normalizeGroupId(groupId) || GROUP_CLASSIFICATION;
    const groupDef = GROUPS_CONFIG.find((g) => g.id === validGroup) || GROUPS_CONFIG[0];
    const targetSubTab = normalizeSubTabId(validGroup, activeSubTabs[validGroup]) || groupDef.defaultSubTab;
    setSelectedDeptId(null);
    navigate(`/superadmin/config/${targetSubTab}`);
  }, [activeSubTabs, normalizeGroupId, normalizeSubTabId, navigate]);

  const handleSelectSubTab = useCallback((subTabId) => {
    const validSubTab = normalizeSubTabId(activeGroup, subTabId) || currentGroup.defaultSubTab;
    setSelectedDeptId(null);
    navigate(`/superadmin/config/${validSubTab}`);
  }, [activeGroup, currentGroup.defaultSubTab, normalizeSubTabId, navigate]);

  const setNotifSubtab = handleSelectSubTab;
  const [items, setItems] = useState({ ticketCategories: [], equipment: [], priorities: [], slaRules: [], departments: [], slas: [] });
  // SLA priorities always mirror the real ticket_priorities table.
  const priorityList = useMemo(() => buildSlaPriorityList(items.priorities), [items.priorities]);

  // SLA business hours (working hours in which SLA minutes are counted)
  const browserTimezone = useMemo(() => getBrowserTimezone(), []);
  const timezoneOptions = useMemo(() => getTimezoneOptions(), []);
  const [businessHours, setBusinessHours] = useState(DEFAULT_BUSINESS_HOURS);
  const [savedBusinessHours, setSavedBusinessHours] = useState(DEFAULT_BUSINESS_HOURS);
  const [businessHoursLoading, setBusinessHoursLoading] = useState(true);
  const [businessHoursSaving, setBusinessHoursSaving] = useState(false);
  const [businessHoursError, setBusinessHoursError] = useState('');

  useEffect(() => {
    let isMounted = true;
    Promise.resolve()
      .then(() => getBusinessHoursConfig())
      .then((cfg) => {
        if (!isMounted || !cfg || typeof cfg !== 'object') return;
        const next = {
          enabled: Boolean(cfg.enabled ?? true),
          timezone: cfg.timezone || 'UTC',
          startTime: cfg.startTime || '08:00',
          endTime: cfg.endTime || '17:00',
          workingDays: Array.isArray(cfg.workingDays) ? cfg.workingDays.map(Number) : [1, 2, 3, 4, 5],
        };
        setBusinessHours(next);
        setSavedBusinessHours(next);
      })
      .catch((err) => console.warn('Failed to load SLA business hours:', err))
      .finally(() => { if (isMounted) setBusinessHoursLoading(false); });
    return () => { isMounted = false; };
  }, []);

  const businessHoursDirty = JSON.stringify(businessHours) !== JSON.stringify(savedBusinessHours);
  const [loading, setLoading] = useState(true);
  const [savingSla, setSavingSla] = useState(false);
  const [search, setSearch] = useState('');
  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuPos, setMenuPos] = useState(null);
  const tabContentRef = useRef(null);
  const isInitialMount = useRef(true);

  // Equipment / Priority / Ticket Categories Edit state
  const [editingItem, setEditingItem] = useState(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editColor, setEditColor] = useState(priorityColorOptions[0].value);

  // SLA Selected Department for detailed rule view (null = Department List view)
  const [selectedDeptId, setSelectedDeptId] = useState(null);
  const [departmentSlaForm, setDepartmentSlaForm] = useState({
    Critical: { response_time_limit: '15', resolution_time_limit: '240' },
    High: { response_time_limit: '30', resolution_time_limit: '480' },
    Medium: { response_time_limit: '120', resolution_time_limit: '1440' },
    Low: { response_time_limit: '240', resolution_time_limit: '4320' },
  });

  const [notification, setNotification] = useState(null);

  // Workflow Rules state
  const [workflowStatuses, setWorkflowStatuses] = useState(defaultWorkflowStatuses);
  const [escalationRules, setEscalationRules] = useState(defaultEscalationRules);

  // Active sorted workflow statuses (Sequence Order source of truth)
  const activeWorkflowStatuses = useMemo(() => {
    return (workflowStatuses || []).slice().sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  }, [workflowStatuses]);

  // Workflow / Escalation edit state
  const [editingWorkflow, setEditingWorkflow] = useState(null);
  const [editingEscalation, setEditingEscalation] = useState(null);

  // Transition Rules state: keyed by the backend ticket state machine states.
  const transitionStatuses = STATE_MACHINE_TRANSITION_STATES;
  const [transitionRules, setTransitionRules] = useState(() => {
    try {
      const stored = localStorage.getItem('superadmin_ticket_transitions_config');
      if (stored) {
        const parsed = JSON.parse(stored);
        // Ignore stale caches keyed by workflow display names (e.g. "New").
        if (parsed && typeof parsed === 'object' && parsed.Open) {
          return parsed;
        }
      }
    } catch {}
    return DEFAULT_STATE_MACHINE_TRANSITION_RULES;
  });
  const [selectedTransitionStatus, setSelectedTransitionStatus] = useState('Open');
  const [savingTransitions, setSavingTransitions] = useState(false);
  const [hasTransitionChanges, setHasTransitionChanges] = useState(false);
  const transitionDraftDirtyRef = useRef(false);

  // Synchronize selected transition status when active workflow statuses change
  useEffect(() => {
    if (transitionStatuses.length > 0) {
      const names = transitionStatuses.map((s) => s.name);
      if (!selectedTransitionStatus || !names.includes(selectedTransitionStatus)) {
        setSelectedTransitionStatus(names[0]);
      }
    }
  }, [transitionStatuses, selectedTransitionStatus]);

  // Ensure all active workflow statuses have rules and prune deleted targets
  useEffect(() => {
    if (transitionStatuses.length === 0) return;
    setTransitionRules((prev) => {
      const statusNames = transitionStatuses.map((s) => s.name);
      const hasAnyMatch = statusNames.some((name) => Boolean(prev && prev[name]));
      let next = hasAnyMatch ? { ...(prev || {}) } : { ...DEFAULT_STATE_MACHINE_TRANSITION_RULES };
      let changed = false;

      transitionStatuses.forEach((st) => {
        if (!next[st.name]) {
          next[st.name] = { ...DEFAULT_STATE_MACHINE_TRANSITION_RULES[st.name] };
          changed = true;
        } else {
          const currentAllowed = next[st.name].allowed || [];
          const validAllowed = currentAllowed.filter((target) => statusNames.includes(target));
          if (validAllowed.length !== currentAllowed.length) {
            next[st.name] = {
              ...next[st.name],
              allowed: validAllowed,
            };
            changed = true;
          }
        }
      });

      return changed ? next : prev;
    });
  }, [transitionStatuses]);

  // Fast independent fetch for transition rules
  useEffect(() => {
    let isMounted = true;
    getTransitionRulesConfig()
      .then((cfg) => {
        if (isMounted && cfg && typeof cfg === 'object') {
          const val = cfg.value || cfg;
          if (Object.keys(val).length > 0) {
            if (!transitionDraftDirtyRef.current) {
              setTransitionRules((prev) => {
                const statusNames = transitionStatuses.map((s) => s.name);
                const hasMatch = statusNames.some((name) => Boolean(val[name]));
                if (!hasMatch) {
                  // Server holds rules keyed by workflow display names, which the backend
                  // state machine ignores. Fall back to the backend defaults.
                  return prev && prev.Open ? prev : DEFAULT_STATE_MACHINE_TRANSITION_RULES;
                }
                const merged = { ...DEFAULT_STATE_MACHINE_TRANSITION_RULES };
                statusNames.forEach((name) => { if (val[name]) merged[name] = val[name]; });
                return merged;
              });
            }
            try {
              localStorage.setItem('superadmin_ticket_transitions_config', JSON.stringify(val));
            } catch {}
          }
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [transitionStatuses]);

  // File Upload & Security Limits state
  const [fileConfig, setFileConfig] = useState(TS098_DEFAULT_FILE_CONFIG);
  const [fileConfigErrors, setFileConfigErrors] = useState({});
  const [fileConfigLoading, setFileConfigLoading] = useState(false);
  const [fileConfigSaving, setFileConfigSaving] = useState(false);

  // Fetch File Upload & Security Limits from backend
  useEffect(() => {
    let isMounted = true;
    setFileConfigLoading(true);
    getFileLimitsConfig()
      .then((cfg) => {
        if (isMounted && cfg && typeof cfg === 'object') {
          const val = cfg.value || cfg;
          setFileConfig({
            maxFileSizeMB: Number(val.maxFileSizeMB ?? 15),
            allowedFileTypes: Array.isArray(val.allowedFileTypes)
              ? val.allowedFileTypes.map((t) => String(t).toUpperCase())
              : TS098_DEFAULT_FILE_CONFIG.allowedFileTypes,
            maxFileCount: Number(val.maxFileCount ?? 5),
            malwareScanningEnabled: Boolean(val.malwareScanningEnabled ?? true),
          });
        }
      })
      .catch((err) => {
        console.warn('Failed to fetch file limits config:', err);
      })
      .finally(() => {
        if (isMounted) setFileConfigLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // Reopen & Auto-Close Windows state (local component state for this sprint)
  const [windowConfig, setWindowConfig] = useState(() => {
    const cached = getCachedWindowConfiguration();
    if (cached && typeof cached.reopenWindowDays !== 'undefined') {
      return {
        reopenEnabled: Boolean(cached.reopenEnabled ?? true),
        reopenWindowDays: Number(cached.reopenWindowDays ?? 2),
        autoCloseEnabled: Boolean(cached.autoCloseEnabled ?? true),
        autoCloseWindowDays: Number(cached.autoCloseWindowDays ?? 2),
        archiveOnClosureEnabled: isMessageArchivalOnClosureEnabled(),
      };
    }
    return {
      ...TS100_DEFAULT_WINDOW_CONFIG,
      archiveOnClosureEnabled: isMessageArchivalOnClosureEnabled(),
    };
  });
  const [windowConfigErrors, setWindowConfigErrors] = useState({});

  // Fast independent fetch for window configuration to avoid waiting on other heavy endpoints
  useEffect(() => {
    let isMounted = true;
    getWindowConfiguration()
      .then((cfg) => {
        if (isMounted && cfg) {
          setWindowConfig({
            reopenEnabled: Boolean(cfg.reopenEnabled ?? true),
            reopenWindowDays: Number(cfg.reopenWindowDays ?? 2),
            autoCloseEnabled: Boolean(cfg.autoCloseEnabled ?? true),
            autoCloseWindowDays: Number(cfg.autoCloseWindowDays ?? 2),
          });
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  const [messagingConfig, setMessagingConfig] = useState({
    default_participants: 'customer_cs',
    allow_delegated_employee: true,
    allow_full_history: true,
    notify_on_employee_join: true,
    internal: {
      mode: 'requestor_cs_delegated',
      allow_direct_assigned: true,
      allow_full_history: true,
      notify_on_activity: true,
    },
  });
  const [messagingSubTab, setMessagingSubTab] = useState('external'); // 'external' | 'internal'
  const [messagingSaving, setMessagingSaving] = useState(false);

  // Fast independent fetch for messaging participation configuration
  useEffect(() => {
    let isMounted = true;
    getMessagingConfiguration()
      .then((cfg) => {
        if (isMounted && cfg) {
          const defaultInternal = {
            mode: 'requestor_cs_delegated',
            allow_direct_assigned: true,
            allow_full_history: true,
            notify_on_activity: true,
          };
          setMessagingConfig({
            default_participants: cfg.default_participants || 'customer_cs',
            allow_delegated_employee: Boolean(cfg.allow_delegated_employee ?? true),
            allow_full_history: Boolean(cfg.allow_full_history ?? true),
            notify_on_employee_join: Boolean(cfg.notify_on_employee_join ?? true),
            internal: {
              ...defaultInternal,
              ...(cfg.internal || {}),
            },
          });
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  // Fast independent fetch for defaults and number format to render instantly without waiting for heavy background tabs
  useEffect(() => {
    let isMounted = true;
    Promise.all([
      getTicketDefaultsConfig().catch(() => null),
      getTicketNumberFormatConfig().catch(() => null),
    ]).then(([defaultsRes, numberFormatRes]) => {
      if (!isMounted) return;
      if (defaultsRes) {
        const val = defaultsRes.value || defaultsRes;
        const normalizedDefaults = {
          status: val.status || 'Open',
          priority: val.priority || 'Low',
          slaPolicy: val.slaPolicy || 'dynamic',
        };
        if (!defaultsDraftDirtyRef.current) {
          setDefaultsConfig(normalizedDefaults);
        }
        try {
          localStorage.setItem('superadmin_ticket_defaults_config', JSON.stringify(normalizedDefaults));
        } catch {}
      }
      if (numberFormatRes) {
        const val = numberFormatRes.value || numberFormatRes;
        const loadedFormat = {
          prefix: String(val.prefix || 'TKT').toUpperCase(),
          includeDeptCode: Boolean(val.includeDeptCode ?? false),
          deptCode: String(val.deptCode || '').toUpperCase(),
          dateSegment: String(val.dateSegment || 'none'),
          digitLength: Number(val.digitLength ?? 4),
        };
        setSavedNumberFormat(loadedFormat);
        setHasEverSavedFormat(true);
        if (!numberFormatDraftDirtyRef.current) {
          setNumberFormatConfig(loadedFormat);
        }
        try {
          localStorage.setItem('superadmin_ticket_number_format_config', JSON.stringify(loadedFormat));
        } catch {}
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // Notifications state (managed via two-level activeGroup / activeSubTabs state)

  // Notification Recipient Routing state
  const [routingConfig, setRoutingConfig] = useState(TS099_DEFAULT_ROUTING);
  const [configuredAlerts, setConfiguredAlerts] = useState({});
  const [routingErrors, setRoutingErrors] = useState({});
  const [expandedRecipientAlert, setExpandedRecipientAlert] = useState(null);
  const [routingLoading, setRoutingLoading] = useState(true);
  const [routingSaving, setRoutingSaving] = useState(false);

  // TS103: Notification Channel Configuration state
  const [channelConfig, setChannelConfig] = useState(TS103_DEFAULT_CHANNELS);
  const [configuredChannels, setConfiguredChannels] = useState({});
  const [channelErrors, setChannelErrors] = useState({});
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [channelsSaving, setChannelsSaving] = useState(false);

  // Feedback Form Configuration state
  // feedbackQuestions is keyed by category name from the DB (dynamic, not hardcoded)
  const [feedbackQuestions, setFeedbackQuestions] = useState(TS104_DEFAULT_QUESTIONS);
  // feedbackCategories is derived from Ticket Categories (items.ticketCategories), NOT equipment categories!
  const [knownFeedbackCategories, setKnownFeedbackCategories] = useState([]);
  const feedbackCategories = useMemo(() => {
    const ticketCatNames = (items.ticketCategories || []).map((c) => c.name);
    const all = Array.from(new Set([...ticketCatNames, ...knownFeedbackCategories, ...FEEDBACK_CATEGORIES]));
    return all.length > 0 ? all : FEEDBACK_CATEGORIES;
  }, [items.ticketCategories, knownFeedbackCategories]);
  const [activeFeedbackCategory, setActiveFeedbackCategory] = useState(FEEDBACK_CATEGORIES[0]);
  const [editingQuestion, setEditingQuestion] = useState(null);
  const [feedbackInlineError, setFeedbackInlineError] = useState('');

  //  Feedback Form Master Toggle state (defaults to true / read from localStorage)
  const [feedbackMasterEnabled, setFeedbackMasterEnabled] = useState(() => isFeedbackFormEnabled());

  // Per-category feedback enabled state: { [categoryName]: boolean }
  // Defaults to true for unknown categories (enabled unless explicitly disabled)
  const [categoryFeedbackToggles, setCategoryFeedbackToggles] = useState({});

  //  Ticket Defaults state (local component state for this sprint)
  // Low priority and dynamic SLA policy are active system defaults, so they start as configured
  const [defaultsConfig, setDefaultsConfig] = useState(getCachedDefaultsConfig);
  const defaultsDraftDirtyRef = useRef(false);
  const [configuredDefaults, setConfiguredDefaults] = useState({
    priority: true,
    slaPolicy: true,
  });
  const [defaultsErrors, setDefaultsErrors] = useState({});

  // TS094: Ticket Number Format state (local component state for this sprint)
  const [numberFormatConfig, setNumberFormatConfig] = useState(getCachedNumberFormatConfig);
  const [savedNumberFormat, setSavedNumberFormat] = useState(getCachedNumberFormatConfig);
  const numberFormatDraftDirtyRef = useRef(false);
  const [numberFormatDraftDirty, setNumberFormatDraftDirty] = useState(false);
  const [savingNumberFormat, setSavingNumberFormat] = useState(false);
  const [hasEverSavedFormat, setHasEverSavedFormat] = useState(false);
  const [numberFormatErrors, setNumberFormatErrors] = useState({});

  // TS096: Max Open Tickets per Requester state (shared with ticket creation flows)
  const [ticketLimitConfig, setTicketLimitConfigState] = useState(() => getMaxOpenTicketsLimit());
  const [savedTicketLimit, setSavedTicketLimit] = useState(() => getMaxOpenTicketsLimit());
  const savedTicketLimitRef = useRef(savedTicketLimit);
  const ticketLimitDraftDirtyRef = useRef(false);
  const [ticketLimitDraftDirty, setTicketLimitDraftDirty] = useState(false);
  const [ticketLimitConflict, setTicketLimitConflict] = useState(null);
  const [savingTicketLimit, setSavingTicketLimit] = useState(false);
  const [limitError, setLimitError] = useState('');

  // Email Delivery Configuration state
  const [emailConfig, setEmailConfig] = useState(null);
  const [emailConfigLoading, setEmailConfigLoading] = useState(true);
  const isEmailConfigured = Boolean(emailConfig && (emailConfig.isConfigured || emailConfig.is_configured));
  const [isAddingEmailConfig, setIsAddingEmailConfig] = useState(false);
  const [newEmailConfig, setNewEmailConfig] = useState({
    provider: 'Resend',
    apiKey: '',
    fromName: '',
    fromEmail: '',
  });
  const [newEmailConfigErrors, setNewEmailConfigErrors] = useState({});
  const [showNewApiKey, setShowNewApiKey] = useState(false);
  const [showChangeApiKeyModal, setShowChangeApiKeyModal] = useState(false);
  const [showChangeApiKey, setShowChangeApiKey] = useState(false);
  const [changeApiKeyInput, setChangeApiKeyInput] = useState('');
  const [changeApiKeyError, setChangeApiKeyError] = useState(null);
  const [emailConfigErrors, setEmailConfigErrors] = useState({});
  const [isTestingEmail, setIsTestingEmail] = useState(false);
  const [showTestEmailModal, setShowTestEmailModal] = useState(false);
  const [testEmailRecipient, setTestEmailRecipient] = useState(() => user?.email || 'support@sbs-med.com');

  // Email Templates state
  const [emailTemplates, setEmailTemplates] = useState([]);
  const [emailTemplatePlaceholders, setEmailTemplatePlaceholders] = useState({});
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [expandedTemplate, setExpandedTemplate] = useState(null);
  const [editingTemplates, setEditingTemplates] = useState({});
  const [templateSaving, setTemplateSaving] = useState({});
  const [templateErrors, setTemplateErrors] = useState({});
  const [testingTemplate, setTestingTemplate] = useState({});

  // TS092: Branch-Specific Priority Levels & SLA Overrides state
  const { selectedBranch } = useBranch();
  const activeBranchKey = selectedBranch?.id || selectedBranch?.slug || 'system';
  const activeBranchName = selectedBranch?.name || 'All Branches (Global Scope)';
  const isGlobalBranchScope = !selectedBranch || activeBranchKey === 'all' || activeBranchKey === 'system' || selectedBranch.id === null;
  const [branchSubSection, setBranchSubSection] = useState(BRANCH_SUBTAB_CATEGORIES);
  // Server-backed branch priorities keyed by branch id (never persisted client-side)
  const [branchPriorityData, setBranchPriorityData] = useState({});
  const [branchPriorityLoading, setBranchPriorityLoading] = useState(true);
  const [branchPrioritySaving, setBranchPrioritySaving] = useState(false);
  const [branchOverrideError, setBranchOverrideError] = useState(null);
  const [editingBranchOverride, setEditingBranchOverride] = useState(null);
  const [branchModalErrors, setBranchModalErrors] = useState({});

  // TS090: Branch-Specific Ticket Categories & SLA Policies state
  // Categories: System-wide default categories are ['IT', 'Service', 'Others'] — confirmed to map onto
  // the real Department concept (Service, IT from items.departments) plus a local "Others" catch-all,
  // same pattern already established for TS104's FEEDBACK_CATEGORIES.
  // This is a DIFFERENT concept from "Equipment Categories" (hardware types in machine_categories)
  // and "Problem Categories" (issue types in problem_categories).
  const [branchCategoryData, setBranchCategoryData] = useState({});
  const [branchCategoryLoading, setBranchCategoryLoading] = useState(true);
  const [branchCategorySaving, setBranchCategorySaving] = useState(false);
  const [categoryError, setCategoryError] = useState(null);
  const [editingCategory, setEditingCategory] = useState(null); // { isNew, id, name, originalName }
  const [categoryModalError, setCategoryModalError] = useState('');
  const [editingSlaPolicy, setEditingSlaPolicy] = useState(null); // { isNew, categoryName, priorityName, resolutionTimeLimit, originalResolutionTimeLimit, sysDefaultResolution, priorityColor }
  const [slaPolicyModalError, setSlaPolicyModalError] = useState('');
  const [slaCategoryFilter, setSlaCategoryFilter] = useState('ALL');

  const closeNotif = () => setNotification(null);
  const showError = (title, message) => setNotification({ type: 'error', title, message });
  const showSuccess = (title, message) => {
    const isErr = /error|fail|invalid|warning/i.test(String(title || ''));
    setNotification({ type: isErr ? 'error' : 'success', title, message });
  };
  const showConfirm = (title, message, onConfirm, opts = {}) => setNotification({ type: 'confirm', title, message, onConfirm, onCancel: closeNotif, ...opts });

  const handleTestTemplate = async (template, draft) => {
    if (!isEmailConfigured) {
      showConfirm(
        'Email Delivery Not Configured',
        'Resend transactional email delivery is not configured yet. Would you like to configure your Resend API credentials now?',
        () => {
          closeNotif();
          handleSelectSubTab(NOTIF_SUBTAB_EMAIL_DELIVERY);
        },
        { confirmText: 'Go to Email Delivery', cancelText: 'Close' }
      );
      return;
    }

    const recipient = user?.email || 'admin@sbs-med.com';
    setTestingTemplate((prev) => ({ ...prev, [template.event_key]: true }));

    try {
      const res = await sendTestTemplateEmail(template.event_key, {
        recipientEmail: recipient,
        subject: draft.subject,
        body: draft.body,
      });

      showSuccess(
        'Test Email Sent',
        res.message || `A preview test email for "${template.event_label}" was sent to ${recipient}.`
      );
    } catch (err) {
      const msg = err?.response?.data?.error || err?.response?.data?.message || 'Failed to dispatch test template email.';
      showConfirm(
        'Test Email Failed',
        msg,
        () => closeNotif(),
        { confirmText: 'OK', cancelText: null }
      );
    } finally {
      setTestingTemplate((prev) => ({ ...prev, [template.event_key]: false }));
    }
  };

  const loadConfig = useCallback(async (context = {}) => {
    const isBackgroundRefresh = Boolean(context?.source);
    if (!isBackgroundRefresh) {
      setLoading(true);
      setEmailConfigLoading(true);
      setTemplatesLoading(true);
      setChannelsLoading(true);
      setRoutingLoading(true);
    }
    try {
      const [configData, slaData, deptsData, workflowData, escalationData, formOptionsData, emailRes, tplRes, channelsRes, feedbackRes, feedbackStatusRes, catTogglesRes, windowRes, routingRes, limitRes, numberFormatRes, defaultsRes] = await Promise.all([
        getSuperAdminConfig().catch(() => ({ equipment: [], priorities: [] })),
        getSLARules().catch(() => ({ sla_rules: [] })),
        getDepartments().catch(() => ({ departments: [] })),
        getWorkflowStatuses().catch(() => ({ workflow_statuses: [] })),
        getEscalationRules().catch(() => ({ escalation_rules: [] })),
        getTicketFormOptions().catch(() => ({ slas: [] })),
        getEmailConfiguration().catch(() => null),
        getEmailTemplates().catch(() => null),
        getNotificationChannels().catch(() => null),
        getFeedbackQuestions().catch(() => null),
        getFeedbackFormStatus().catch(() => null),
        getCategoryFeedbackToggles().catch(() => null),
        getWindowConfiguration().catch(() => null),
        getNotificationRouting().catch(() => null),
        getTicketLimitConfig().catch(() => null),
        getTicketNumberFormatConfig().catch(() => null),
        getTicketDefaultsConfig().catch(() => null),
      ]);

      const depts = deptsData.departments || deptsData || [];
      const rules = slaData.sla_rules || [];
      const slas = (formOptionsData?.slas && formOptionsData.slas.length > 0)
        ? formOptionsData.slas
        : [
          { sla_ID: 1, sla_name: 'Standard SLA', response_time_minutes: 240, resolution_time_minutes: 1440 },
          { sla_ID: 2, sla_name: 'Critical SLA', response_time_minutes: 30, resolution_time_minutes: 240 },
        ];

      setItems({
        ticketCategories: configData.ticket_categories || [],
        equipment: configData.equipment || [],
        priorities: configData.priorities || [],
        slaRules: rules,
        departments: depts,
        slas,
      });

      if (workflowData.workflow_statuses && workflowData.workflow_statuses.length > 0) {
        setWorkflowStatuses(
          workflowData.workflow_statuses.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description || '',
            bgColor: s.bg_color || '#DBEAFE',
            textColor: s.text_color || '#1D4ED8',
            order: s.order_position || 1,
            isSystem: Boolean(s.is_system),
            requiresPreviousFulfilled: Boolean(s.requires_previous_fulfilled),
            prerequisiteStatusId: s.prerequisite_status_id || null,
            prerequisite: s.prerequisite || null,
          }))
        );
      }

      if (escalationData.escalation_rules && escalationData.escalation_rules.length > 0) {
        setEscalationRules(
          escalationData.escalation_rules.map((r) => ({
            id: r.id,
            name: r.name,
            isActive: Boolean(r.is_active),
            trigger: r.trigger,
            condition: {
              text: r.condition_text || '',
              highlight: r.condition_highlight || '',
            },
            action: r.action,
            notify: r.notify,
          }))
        );
      }

      if (emailRes) {
        const data = emailRes?.data;
        if ((emailRes?.is_configured || emailRes?.isConfigured) && data) {
          setEmailConfig({
            ...data,
            isConfigured: true,
            is_configured: true,
            fromName: data.fromName || data.from_name || '',
            from_name: data.fromName || data.from_name || '',
            fromEmail: data.fromEmail || data.from_email || '',
            from_email: data.fromEmail || data.from_email || '',
            apiKey: data.apiKey || data.api_key || 're_•••••••••',
            api_key: data.apiKey || data.api_key || 're_•••••••••',
            lastTested: data.lastTested || data.last_tested || null,
            last_tested: data.lastTested || data.last_tested || null,
          });
        } else {
          setEmailConfig(null);
        }
      }

      if (tplRes?.templates) {
        setEmailTemplates(tplRes.templates);
        setEmailTemplatePlaceholders(tplRes.placeholders || {});
        // Seed editing state with current values
        const editing = {};
        tplRes.templates.forEach((t) => {
          editing[t.event_key] = { subject: t.subject, body: t.body };
        });
        setEditingTemplates(editing);
      }

      if (channelsRes?.channels && Array.isArray(channelsRes.channels)) {
        const loadedChannels = {};
        const configured = {};
        channelsRes.channels.forEach((c) => {
          const key = c.key || c.alert_key;
          if (key) {
            loadedChannels[key] = c.channel;
            configured[key] = true;
          }
        });
        setChannelConfig((prev) => ({
          ...prev,
          ...(channelsRes.channelMap || {}),
          ...loadedChannels,
        }));
        setConfiguredChannels(configured);
      } else if (channelsRes?.channelMap) {
        setChannelConfig((prev) => ({
          ...prev,
          ...channelsRes.channelMap,
        }));
      }

      if (feedbackRes?.grouped) {
        setFeedbackQuestions(feedbackRes.grouped);
      }

      // Capture the categories list from the backend (the union of all categories that have questions)
      if (feedbackRes?.categories?.length > 0) {
        setKnownFeedbackCategories(feedbackRes.categories);
      }

      if (catTogglesRes?.categories) {
        setCategoryFeedbackToggles(catTogglesRes.categories);
      }

      if (feedbackStatusRes && (feedbackStatusRes.is_enabled !== undefined || feedbackStatusRes.isEnabled !== undefined)) {
        const isMasterOn = Boolean(feedbackStatusRes.is_enabled ?? feedbackStatusRes.isEnabled);
        setFeedbackMasterEnabled(isMasterOn);
        setFeedbackFormEnabled(isMasterOn);
      }

      if (windowRes) {
        setWindowConfig({
          reopenEnabled: Boolean(windowRes.reopenEnabled ?? true),
          reopenWindowDays: Number(windowRes.reopenWindowDays ?? 2),
          autoCloseEnabled: Boolean(windowRes.autoCloseEnabled ?? true),
          autoCloseWindowDays: Number(windowRes.autoCloseWindowDays ?? 2),
        });
      }

      if (numberFormatRes) {
        const val = numberFormatRes.value || numberFormatRes;
        const loadedFormat = {
          prefix: String(val.prefix || 'TKT').toUpperCase(),
          includeDeptCode: Boolean(val.includeDeptCode ?? false),
          deptCode: String(val.deptCode || '').toUpperCase(),
          dateSegment: String(val.dateSegment || 'none'),
          digitLength: Number(val.digitLength ?? 4),
        };
        setSavedNumberFormat(loadedFormat);
        setHasEverSavedFormat(true);
        if (!numberFormatDraftDirtyRef.current) {
          setNumberFormatConfig(loadedFormat);
        }
        try {
          localStorage.setItem('superadmin_ticket_number_format_config', JSON.stringify(loadedFormat));
        } catch {}
      }

      if (routingRes) {
        const val = routingRes?.value || routingRes;
        if (typeof val === 'object' && val !== null) {
          setRoutingConfig((prev) => ({
            ...prev,
            ...val,
          }));
        }
      }

      if (limitRes) {
        const normalizedLimit = {
          isUnlimited: Boolean(limitRes.isUnlimited ?? true),
          limit: Number(limitRes.limit ?? 5),
        };
        const previousSavedLimit = savedTicketLimitRef.current;
        const serverLimitChanged = previousSavedLimit.isUnlimited !== normalizedLimit.isUnlimited
          || Number(previousSavedLimit.limit) !== normalizedLimit.limit;

        savedTicketLimitRef.current = normalizedLimit;
        setSavedTicketLimit(normalizedLimit);
        setMaxOpenTicketsLimit(normalizedLimit);

        if (isBackgroundRefresh && ticketLimitDraftDirtyRef.current) {
          if (serverLimitChanged) {
            setTicketLimitConflict(normalizedLimit);
          }
        } else {
          ticketLimitDraftDirtyRef.current = false;
          setTicketLimitDraftDirty(false);
          setTicketLimitConflict(null);
          setTicketLimitConfigState(normalizedLimit);
        }
      }

      if (defaultsRes) {
        const val = defaultsRes.value || defaultsRes;
        const normalizedDefaults = {
          status: val.status || 'Open',
          priority: val.priority || 'Low',
          slaPolicy: val.slaPolicy || 'dynamic',
        };
        if (!defaultsDraftDirtyRef.current) {
          setDefaultsConfig(normalizedDefaults);
          setConfiguredDefaults({ priority: true, slaPolicy: true });
        }
        try {
          localStorage.setItem('superadmin_ticket_defaults_config', JSON.stringify(normalizedDefaults));
        } catch {}
      }
    } catch (err) {
      console.error('Failed to load superadmin config:', err);
    } finally {
      if (!isBackgroundRefresh) {
        setLoading(false);
        setEmailConfigLoading(false);
        setTemplatesLoading(false);
        setChannelsLoading(false);
        setRoutingLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // When selected department or SLA rules change, populate form for that department
  useEffect(() => {
    if (!selectedDeptId) return;

    const deptRules = items.slaRules.filter((r) => String(r.department_id) === String(selectedDeptId));

    // Start every DB priority empty so unsaved priorities read as "Not set" here too,
    // instead of showing hardcoded defaults that look like saved values.
    const newForm = {};
    priorityList.forEach((p) => {
      newForm[p.name] = { response_time_limit: '', resolution_time_limit: '' };
    });

    deptRules
      .filter((rule) => rule.category_id === null || rule.category_id === undefined)
      // Oldest first so the most recently updated duplicate wins (matches backend lookup).
      .sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')) || Number(a.id) - Number(b.id))
      .forEach((rule) => {
        const match = priorityList.find((p) => p.name.toLowerCase() === String(rule.priority || '').toLowerCase());
        if (match) {
          newForm[match.name] = {
            response_time_limit: String(rule.response_time_limit || ''),
            resolution_time_limit: String(rule.resolution_time_limit || ''),
          };
        }
      });

    setDepartmentSlaForm(newForm);
  }, [selectedDeptId, items.slaRules, priorityList]);

  useRealtimeRefresh({
    refresh: loadConfig,
    channels: [
      { name: 'ticket-updates', event: 'ticket.changed' },
      { name: 'ticket-updates', event: 'ticket.limit.config.updated' },
    ],
    shouldRefresh: ({ source, payload }) => source !== 'websocket' || payload?.type === 'config',
    intervalMs: 15000,
  });

  useEffect(() => {
    if (!openMenuId) return;
    const handler = (e) => {
      if (!e.target.closest('[data-menu-id]') && !e.target.closest('.menu-trigger')) {
        setOpenMenuId(null);
        setMenuPos(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openMenuId]);

  // Smooth scroll back to top of tab content area on tab/sub-tab switch
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    if (tabContentRef.current) {
      const headerOffset = 150; // Clearance for fixed Header (~96px) + Sub-tab bar (~41px)
      const elementTop = tabContentRef.current.getBoundingClientRect().top;
      const targetScroll = window.pageYOffset + elementTop - headerOffset;

      // Only scroll if user was scrolled down below the content area
      if (window.pageYOffset > targetScroll) {
        window.scrollTo({
          top: Math.max(0, targetScroll),
          behavior: 'smooth',
        });
      }
    }
  }, [activeGroup, currentSubTab, branchSubSection]);

  const list = tab === TAB_TICKET_CATEGORIES
    ? (items.ticketCategories || [])
    : tab === TAB_EQUIPMENT
    ? (items.equipment || [])
    : (items.priorities || []);

  const filtered = useMemo(() => {
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter((item) => (item.name && item.name.toLowerCase().includes(q)) || (item.description && item.description.toLowerCase().includes(q)));
  }, [list, search]);

  const handleAdd = () => {
    setEditingItem({ id: null, name: '', description: '' });
    setEditName('');
    setEditDescription('');
    setEditColor(priorityColorOptions[0].value);
  };

  const handleEdit = (item) => {
    setOpenMenuId(null);
    setMenuPos(null);
    setEditingItem(item);
    setEditName(item.name);
    setEditDescription(item.description || '');
    setEditColor(item.color || priorityColorOptions[0].value);
  };

  const handleSaveItem = async () => {
    if (!editName.trim()) return;
    try {
      if (tab === TAB_TICKET_CATEGORIES) {
        const isNew = editingItem.id === null;
        if (isNew) {
          await createSuperAdminTicketCategory({ name: editName.trim(), description: editDescription?.trim() || null });
        } else {
          await updateSuperAdminTicketCategory(editingItem.id, { name: editName.trim(), description: editDescription?.trim() || null });
        }
        showSuccess('Saved', 'Ticket category has been saved.');
        if (isNew) {
          try {
            const seedRes = await seedFeedbackCategory(editName.trim());
            if (seedRes?.seeded && seedRes?.questions?.length > 0) {
              setFeedbackQuestions((prev) => ({
                ...prev,
                [editName.trim()]: seedRes.questions,
              }));
            }
          } catch (seedErr) {
            console.warn('Failed to seed feedback questions for new ticket category:', seedErr);
          }
        }
      } else if (tab === TAB_EQUIPMENT) {
        const isNew = editingItem.id === null;
        if (isNew) {
          await createSuperAdminEquipment({ name: editName.trim() });
        } else {
          await updateSuperAdminEquipment(editingItem.id, { name: editName.trim() });
        }
        showSuccess('Saved', 'Equipment category has been saved.');
      } else {
        if (editingItem.id === null) {
          await createSuperAdminPriority({ name: editName.trim(), color: editColor });
        } else {
          await updateSuperAdminPriority(editingItem.id, { name: editName.trim(), color: editColor });
        }
        showSuccess('Saved', 'Priority has been saved.');
      }
      setEditingItem(null);
      try {
        const fresh = await getSuperAdminConfig();
        if (fresh) {
          setItems((prev) => ({
            ...prev,
            ticketCategories: fresh.ticket_categories || prev.ticketCategories,
            equipment: fresh.equipment || prev.equipment,
            priorities: fresh.priorities || prev.priorities,
          }));
        }
      } catch {}
      await loadConfig({ source: 'background' });
    } catch (err) {
      console.error(err);
      showError('Error', err?.response?.data?.message || 'Failed to save configuration settings.');
    }
  };

  const handleDelete = (item) => {
    setOpenMenuId(null);
    setMenuPos(null);
    if (tab === TAB_TICKET_CATEGORIES) {
      if (item.is_system_default) {
        showError('Action Prohibited', `"${item.name}" is a core system default ticket category and cannot be deleted.`);
        return;
      }
      showConfirm(
        `Delete Ticket Category?`,
        `Are you sure you want to delete the "${item.name}" ticket category?\n\n⚠️ Feedback Form Impact: The feedback questions for this category will be deactivated. Existing feedback submissions will remain in analytics and history reports.`,
        () => confirmDelete(item),
        { confirmText: 'Delete Category', confirmClassName: 'bg-red-600 hover:bg-red-700' }
      );
    } else if (tab === TAB_EQUIPMENT) {
      showConfirm(
        `Delete Equipment Category?`,
        `Are you sure you want to delete "${item.name}"?`,
        () => confirmDelete(item),
        { confirmText: 'Delete Category', confirmClassName: 'bg-red-600 hover:bg-red-700' }
      );
    } else {
      showConfirm(`Delete priority?`, `Are you sure you want to delete "${item.name}"?`, () => confirmDelete(item), { confirmText: 'Delete', confirmClassName: 'bg-red-600 hover:bg-red-700' });
    }
  };

  const confirmDelete = async (item) => {
    closeNotif();
    try {
      if (tab === TAB_TICKET_CATEGORIES) {
        await deleteSuperAdminTicketCategory(item.id);
        try {
          await disableFeedbackCategory(item.name);
          setCategoryFeedbackToggles((prev) => ({ ...prev, [item.name]: false }));
        } catch (fbErr) {
          console.warn('Could not disable category feedback (non-critical):', fbErr);
        }
        showSuccess('Deleted', `${item.name} has been deleted.`);
      } else if (tab === TAB_EQUIPMENT) {
        await deleteSuperAdminEquipment(item.id);
        showSuccess('Deleted', `${item.name} has been deleted.`);
      } else {
        await deleteSuperAdminPriority(item.id);
        showSuccess('Deleted', `${item.name} has been deleted.`);
      }

      // Optimistically remove from state immediately so UI updates in 0ms without requiring page refresh
      setItems((prev) => ({
        ...prev,
        ticketCategories: tab === TAB_TICKET_CATEGORIES
          ? (prev.ticketCategories || []).filter((c) => c.id !== item.id)
          : prev.ticketCategories,
        equipment: tab === TAB_EQUIPMENT
          ? (prev.equipment || []).filter((e) => e.id !== item.id)
          : prev.equipment,
        priorities: tab === TAB_PRIORITY
          ? (prev.priorities || []).filter((p) => p.id !== item.id)
          : prev.priorities,
      }));

      await loadConfig({ source: 'background' });
    } catch (err) {
      console.error(err);
      showError('Error', err?.response?.data?.message || 'Failed to delete item.');
      await loadConfig({ source: 'background' });
    }
  };

  // Workflow CRUD
  const handleAddWorkflow = () => {
    const nextOrder = workflowStatuses.length > 0
      ? Math.max(...workflowStatuses.map((s) => s.order || 0)) + 1
      : 1;
    const preceding = workflowStatuses.slice().sort((a, b) => a.order - b.order).slice(-1)[0];
    setEditingWorkflow({
      id: null,
      name: '',
      description: '',
      bgColor: workflowColorOptions[0].bgColor,
      textColor: workflowColorOptions[0].textColor,
      order: nextOrder,
      isSystem: false,
      requiresPreviousFulfilled: false,
      prerequisiteStatusId: preceding ? preceding.id : '',
    });
  };

  const handleEditWorkflow = (status) => {
    setEditingWorkflow({
      ...status,
      requiresPreviousFulfilled: Boolean(status.requiresPreviousFulfilled),
      prerequisiteStatusId: status.prerequisiteStatusId || '',
    });
  };

  const handleSaveWorkflow = async () => {
    if (!editingWorkflow.name.trim()) return;
    try {
      const payload = {
        name: editingWorkflow.name.trim(),
        description: editingWorkflow.description,
        bg_color: editingWorkflow.bgColor,
        text_color: editingWorkflow.textColor,
        order_position: parseInt(editingWorkflow.order, 10) || 1,
        requires_previous_fulfilled: Boolean(editingWorkflow.requiresPreviousFulfilled),
        prerequisite_status_id: editingWorkflow.requiresPreviousFulfilled && editingWorkflow.prerequisiteStatusId
          ? parseInt(editingWorkflow.prerequisiteStatusId, 10)
          : null,
      };

      if (editingWorkflow.id === null) {
        await createWorkflowStatus(payload);
      } else {
        await updateWorkflowStatus(editingWorkflow.id, payload);
      }
      setEditingWorkflow(null);
      showSuccess('Saved', 'Workflow status has been saved.');
      await loadConfig();
    } catch (err) {
      console.error('Failed to save workflow status:', err);
      const errMsg = err?.response?.data?.message || 'Failed to save workflow status.';
      showError('Error', errMsg);
    }
  };

  const handleDeleteWorkflow = (status) => {
    if (status.isSystem) {
      showError('Protected Status', 'Core system workflow statuses cannot be deleted.');
      return;
    }
    showConfirm('Delete Status?', `Are you sure you want to delete "${status.name}"?`, async () => {
      closeNotif();
      try {
        await deleteWorkflowStatus(status.id);
        showSuccess('Deleted', `${status.name} has been deleted.`);
        setWorkflowStatuses((prev) => prev.filter((s) => s.id !== status.id));
        await loadConfig({ source: 'background' });
      } catch (err) {
        console.error('Failed to delete workflow status:', err);
        const errMsg = err?.response?.data?.message || 'Failed to delete workflow status.';
        showError('Error', errMsg);
        await loadConfig({ source: 'background' });
      }
    }, { confirmText: 'Delete', confirmClassName: 'bg-red-600 hover:bg-red-700' });
  };

  const handleResetDefaultWorkflow = () => {
    showConfirm('Restore Workflow Defaults?', 'This will re-synchronize and restore the 6 canonical system workflow stages without removing custom statuses.', async () => {
      closeNotif();
      try {
        await resetWorkflowStatuses();
        showSuccess('Restored', 'Canonical workflow statuses restored.');
        await loadConfig();
      } catch (err) {
        console.error('Failed to reset workflow statuses:', err);
        const errMsg = err?.response?.data?.message || 'Failed to restore default workflow statuses.';
        showError('Error', errMsg);
      }
    }, { confirmText: 'Restore Defaults', confirmClassName: 'bg-[#252578] hover:bg-[#1e1e62]' });
  };

  // Escalation CRUD
  const handleAddEscalation = () => {
    setEditingEscalation({ id: null, name: '', isActive: true, trigger: '', condition: { text: '', highlight: '' }, action: '', notify: '' });
  };

  const handleEditEscalation = (rule) => {
    setEditingEscalation({ ...rule, condition: { ...rule.condition } });
  };

  const handleToggleEscalation = async (ruleId) => {
    try {
      await toggleEscalationRule(ruleId);
      await loadConfig();
    } catch (err) {
      console.error('Failed to toggle escalation rule:', err);
      showError('Error', 'Failed to update escalation rule status.');
    }
  };

  const handleSaveEscalation = async () => {
    if (!editingEscalation.name.trim()) return;
    try {
      const payload = {
        name: editingEscalation.name.trim(),
        is_active: editingEscalation.isActive,
        trigger: editingEscalation.trigger,
        condition_text: editingEscalation.condition?.text || '',
        condition_highlight: editingEscalation.condition?.highlight || '',
        action: editingEscalation.action,
        notify: editingEscalation.notify,
      };

      if (editingEscalation.id === null) {
        await createEscalationRule(payload);
      } else {
        await updateEscalationRule(editingEscalation.id, payload);
      }
      setEditingEscalation(null);
      showSuccess('Saved', 'Escalation rule has been saved.');
      await loadConfig();
    } catch (err) {
      console.error('Failed to save escalation rule:', err);
      showError('Error', 'Failed to save escalation rule.');
    }
  };

  const handleDeleteEscalation = (rule) => {
    showConfirm('Delete Rule?', `Are you sure you want to delete "${rule.name}"?`, async () => {
      closeNotif();
      try {
        await deleteEscalationRule(rule.id);
        showSuccess('Deleted', `${rule.name} has been deleted.`);
        setEscalationRules((prev) => prev.filter((r) => r.id !== rule.id));
        await loadConfig({ source: 'background' });
      } catch (err) {
        console.error('Failed to delete escalation rule:', err);
        showError('Error', 'Failed to delete escalation rule.');
        await loadConfig({ source: 'background' });
      }
    }, { confirmText: 'Delete', confirmClassName: 'bg-red-600 hover:bg-red-700' });
  };

  const handleSlaInputChange = (priorityName, field, value) => {
    setDepartmentSlaForm((prev) => ({
      ...prev,
      [priorityName]: {
        ...prev[priorityName],
        [field]: value,
      },
    }));
  };

  const handleSaveDepartmentSla = () => {
    if (!selectedDeptId) return;

    for (const p of priorityList) {
      const data = departmentSlaForm[p.name];
      if (!(parseInt(data?.response_time_limit, 10) >= 1) || !(parseInt(data?.resolution_time_limit, 10) >= 1)) {
        showError('Validation Error', `Please fill out valid response and resolution time limits for ${p.name} priority.`);
        return;
      }
    }

    const deptName = currentDeptObj?.name || 'this department';
    showConfirm(
      'Save SLA Rules?',
      savedBusinessHours.enabled
        ? `SLA limits for ${deptName} only count during working hours: ${describeBusinessHours(savedBusinessHours)}. Time outside working hours (nights, weekends, non working days) is not counted, so deadlines may land on the next working day. The new limits apply to tickets created or reclassified from now on.`
        : `SLA limits for ${deptName} count around the clock (24/7), because business hours are turned off. The new limits apply to tickets created or reclassified from now on.`,
      () => {
        closeNotif();
        persistDepartmentSla();
      },
      { confirmText: 'Save SLA Rules', cancelText: 'Cancel' }
    );
  };

  const handleSaveBusinessHours = () => {
    setBusinessHoursError('');
    if (!businessHours.workingDays.length) {
      setBusinessHoursError('Select at least one working day.');
      return;
    }
    if (!businessHours.startTime || !businessHours.endTime || businessHours.startTime >= businessHours.endTime) {
      setBusinessHoursError('End time must be later than start time.');
      return;
    }

    showConfirm(
      'Update Business Hours?',
      businessHours.enabled
        ? `SLA limits will only count during ${describeBusinessHours(businessHours)}. Deadlines of all open tickets will be recalculated with these hours, and new tickets will use them too.`
        : 'SLA limits will count around the clock (24/7). Deadlines of all open tickets will be recalculated, and new tickets will use this too.',
      async () => {
        closeNotif();
        setBusinessHoursSaving(true);
        try {
          const saved = await updateBusinessHoursConfig(businessHours);
          const next = saved && typeof saved === 'object' && saved.timezone ? { ...businessHours, ...saved } : businessHours;
          setBusinessHours(next);
          setSavedBusinessHours(next);
          // Existing open tickets must follow the new hours too, otherwise their
          // deadlines stay on the old clock (e.g. 7:00 PM outside working hours).
          let recalcText = '';
          try {
            const res = await recalculateOpenTicketSlas();
            recalcText = ` ${res?.message || 'Open ticket deadlines were recalculated.'}`;
          } catch (recalcErr) {
            recalcText = ' Open ticket deadlines could not be recalculated; use "Recalculate Open Tickets" to retry.';
          }
          showSuccess('Business Hours Saved', `SLA limits now count ${describeBusinessHours(next)}.${recalcText}`);
        } catch (err) {
          const errors = err?.response?.data?.errors;
          const firstError = errors ? Object.values(errors).flat()[0] : null;
          setBusinessHoursError(firstError || err?.response?.data?.message || 'Failed to save business hours.');
        } finally {
          setBusinessHoursSaving(false);
        }
      },
      { confirmText: 'Save Business Hours', cancelText: 'Cancel' }
    );
  };

  const [recalculatingSlas, setRecalculatingSlas] = useState(false);
  const handleRecalculateOpenTickets = () => {
    showConfirm(
      'Recalculate Open Ticket Deadlines?',
      `Every open ticket gets new SLA deadlines from its current SLA rule, counted ${describeBusinessHours(savedBusinessHours)}. Use this after changing business hours or SLA limits so existing tickets match the new settings.`,
      async () => {
        closeNotif();
        setRecalculatingSlas(true);
        try {
          const res = await recalculateOpenTicketSlas();
          showSuccess('Deadlines Recalculated', res?.message || 'Open ticket SLA deadlines were recalculated.');
        } catch (err) {
          showError('Recalculation Failed', err?.response?.data?.message || 'Could not recalculate open ticket deadlines.');
        } finally {
          setRecalculatingSlas(false);
        }
      },
      { confirmText: 'Recalculate', cancelText: 'Cancel' }
    );
  };

  const persistDepartmentSla = async () => {
    setSavingSla(true);
    try {
      const rulesPayload = priorityList.map((p) => ({
        priority: p.name,
        response_time_limit: parseInt(departmentSlaForm[p.name].response_time_limit, 10),
        resolution_time_limit: parseInt(departmentSlaForm[p.name].resolution_time_limit, 10),
      }));

      await saveDepartmentSLARules(parseInt(selectedDeptId, 10), rulesPayload);

      const deptName = items.departments.find((d) => String(d.id) === String(selectedDeptId))?.name || 'Department';
      showSuccess('SLA Rules Saved', `SLA configuration for ${deptName} has been saved successfully.`);
      await loadConfig();
      setSelectedDeptId(null);
    } catch (err) {
      console.error('Failed to save department SLA rules:', err);
      showError('Error', 'Failed to save SLA rules for this department.');
    } finally {
      setSavingSla(false);
    }
  };

  const currentDeptObj = items.departments.find((d) => String(d.id) === String(selectedDeptId));

  const getDeptRuleSummary = (deptId) => {
    const rules = items.slaRules.filter((r) => String(r.department_id) === String(deptId));
    if (rules.length === 0) return { count: 0, text: 'No SLA rules configured' };
    return { count: rules.length, text: `${rules.length} Priority Rules Configured` };
  };

  const handleToggleTransition = (targetStatus) => {
    transitionDraftDirtyRef.current = true;
    setHasTransitionChanges(true);
    setTransitionRules((prev) => {
      const currentRule = prev[selectedTransitionStatus] || {
        allowed: [],
        type: 'editable',
        description: `Transitions originating from ${selectedTransitionStatus}`,
      };
      if (currentRule.type === 'terminal' || currentRule.type === 'fixed' || currentRule.type === 'contextual') return prev;
      const isAllowed = (currentRule.allowed || []).includes(targetStatus);
      const newAllowed = isAllowed
        ? currentRule.allowed.filter((s) => s !== targetStatus)
        : [...(currentRule.allowed || []), targetStatus];
      return {
        ...prev,
        [selectedTransitionStatus]: {
          ...currentRule,
          allowed: newAllowed,
        },
      };
    });
  };

  const handleToggleMatrixTransition = (sourceStatus, targetStatus) => {
    if (sourceStatus === targetStatus) return;
    transitionDraftDirtyRef.current = true;
    setHasTransitionChanges(true);
    setTransitionRules((prev) => {
      const currentRule = prev[sourceStatus] || {
        allowed: [],
        type: 'editable',
        description: `Transitions originating from ${sourceStatus}`,
      };
      if (currentRule.type === 'terminal' || currentRule.type === 'fixed' || currentRule.type === 'contextual') return prev;
      const isAllowed = (currentRule.allowed || []).includes(targetStatus);
      const newAllowed = isAllowed
        ? currentRule.allowed.filter((s) => s !== targetStatus)
        : [...(currentRule.allowed || []), targetStatus];
      return {
        ...prev,
        [sourceStatus]: {
          ...currentRule,
          allowed: newAllowed,
        },
      };
    });
  };

  const handleSaveTransitions = async () => {
    setSavingTransitions(true);
    try {
      await updateTransitionRulesConfig(transitionRules);
      transitionDraftDirtyRef.current = false;
      setHasTransitionChanges(false);
      try {
        localStorage.setItem('superadmin_ticket_transitions_config', JSON.stringify(transitionRules));
      } catch {}
      showSuccess('Saved Successfully', 'Ticket status transition rules have been saved and applied system-wide.');
    } catch (err) {
      showError('Save Failed', err.response?.data?.message || 'Failed to save transition rules.');
    } finally {
      setSavingTransitions(false);
    }
  };

  const handleResetTransitions = async () => {
    try {
      const res = await resetTransitionRulesConfig();
      const val = res?.value || res;
      transitionDraftDirtyRef.current = false;
      const baseRules = (val && typeof val === 'object' && Object.keys(val).length > 0)
        ? val
        : DEFAULT_STATE_MACHINE_TRANSITION_RULES;
      const next = { ...DEFAULT_STATE_MACHINE_TRANSITION_RULES };
      transitionStatuses.forEach((st) => {
        if (baseRules[st.name]) next[st.name] = baseRules[st.name];
      });
      setTransitionRules(next);
      setHasTransitionChanges(false);
      try {
        localStorage.setItem('superadmin_ticket_transitions_config', JSON.stringify(next));
      } catch {}
      showSuccess('Reset Complete', 'Transition rules have been restored to system defaults.');
    } catch {
      transitionDraftDirtyRef.current = false;
      const next = { ...DEFAULT_STATE_MACHINE_TRANSITION_RULES };
      setTransitionRules(next);
      setHasTransitionChanges(false);
      showSuccess('Reset Complete', 'Transition rules have been restored to system defaults.');
    }
  };

  // TS098 File Config Handlers
  const handleMaxFileSizeChange = (val) => {
    setFileConfig((prev) => ({ ...prev, maxFileSizeMB: val }));
    const num = parseFloat(val);
    if (isNaN(num) || num <= 0) {
      setFileConfigErrors((prev) => ({ ...prev, maxFileSizeMB: 'Max file size must be a positive number greater than 0 MB.' }));
    } else {
      setFileConfigErrors((prev) => {
        const next = { ...prev };
        delete next.maxFileSizeMB;
        return next;
      });
    }
  };

  const handleMaxFileCountChange = (val) => {
    setFileConfig((prev) => ({ ...prev, maxFileCount: val }));
    const num = parseInt(val, 10);
    if (isNaN(num) || num <= 0) {
      setFileConfigErrors((prev) => ({ ...prev, maxFileCount: 'Max file count must be a positive integer of at least 1.' }));
    } else {
      setFileConfigErrors((prev) => {
        const next = { ...prev };
        delete next.maxFileCount;
        return next;
      });
    }
  };

  const handleToggleFileType = (ext) => {
    setFileConfig((prev) => {
      const isAllowed = prev.allowedFileTypes.includes(ext);
      if (isAllowed) {
        if (prev.allowedFileTypes.length <= 1) {
          showError('Validation Warning', 'At least one file type must remain allowed.');
          setFileConfigErrors((e) => ({ ...e, allowedFileTypes: 'At least one file type must remain allowed.' }));
          return prev;
        }
        const updated = prev.allowedFileTypes.filter((t) => t !== ext);
        setFileConfigErrors((e) => {
          const next = { ...e };
          delete next.allowedFileTypes;
          return next;
        });
        return { ...prev, allowedFileTypes: updated };
      } else {
        setFileConfigErrors((e) => {
          const next = { ...e };
          delete next.allowedFileTypes;
          return next;
        });
        return { ...prev, allowedFileTypes: [...prev.allowedFileTypes, ext] };
      }
    });
  };

  const handleToggleMalwareScanning = () => {
    if (fileConfig.malwareScanningEnabled) {
      // Turning OFF requires confirmation
      showConfirm(
        'Disable Malware Scanning?',
        'Disabling malware scanning allows files to bypass virus checks before being stored. This is not recommended.',
        () => {
          closeNotif();
          setFileConfig((prev) => ({ ...prev, malwareScanningEnabled: false }));
        },
        {
          confirmText: 'Disable Scanning',
          confirmClassName: 'bg-red-600 hover:bg-red-700',
        }
      );
    } else {
      // Turning ON does not require confirmation
      setFileConfig((prev) => ({ ...prev, malwareScanningEnabled: true }));
    }
  };

  const handleResetFileConfig = () => {
    showConfirm(
      'Restore Default File Upload Limits?',
      'This will reset file size limits (15 MB), maximum file count (5 files), allowed extensions, and enable malware scanning to system defaults. Existing tickets and their attachments will remain unaffected.',
      async () => {
        closeNotif();
        setFileConfigSaving(true);
        try {
          const res = await resetFileLimitsConfig();
          const val = res?.value || res || TS098_DEFAULT_FILE_CONFIG;
          setFileConfig({
            maxFileSizeMB: Number(val.maxFileSizeMB ?? 15),
            allowedFileTypes: Array.isArray(val.allowedFileTypes)
              ? val.allowedFileTypes.map((t) => String(t).toUpperCase())
              : TS098_DEFAULT_FILE_CONFIG.allowedFileTypes,
            maxFileCount: Number(val.maxFileCount ?? 5),
            malwareScanningEnabled: Boolean(val.malwareScanningEnabled ?? true),
          });
          setFileConfigErrors({});
          showSuccess(
            'Reset Complete',
            'File upload settings have been restored to system defaults and persisted across services.'
          );
        } catch (err) {
          showError('Reset Failed', err.response?.data?.message || 'Failed to restore default file settings.');
        } finally {
          setFileConfigSaving(false);
        }
      },
      {
        confirmText: 'Reset to Defaults',
        confirmClassName: 'bg-[#252578] hover:bg-[#1b1b55]',
      }
    );
  };

  const handleSaveFileConfig = async () => {
    const sizeNum = parseFloat(fileConfig.maxFileSizeMB);
    const countNum = parseInt(fileConfig.maxFileCount, 10);

    const errors = {};
    if (isNaN(sizeNum) || sizeNum <= 0) {
      errors.maxFileSizeMB = 'Please enter a valid max file size greater than 0 MB.';
    } else if (sizeNum > 500) {
      errors.maxFileSizeMB = 'Max file size cannot exceed 500 MB.';
    }
    if (isNaN(countNum) || countNum <= 0) {
      errors.maxFileCount = 'Please enter a valid max file count of at least 1.';
    } else if (countNum > 50) {
      errors.maxFileCount = 'Max file count cannot exceed 50.';
    }
    if (!fileConfig.allowedFileTypes || fileConfig.allowedFileTypes.length === 0) {
      errors.allowedFileTypes = 'At least one file type must be selected.';
    }

    if (Object.keys(errors).length > 0) {
      setFileConfigErrors(errors);
      showError('Validation Error', 'Please correct the errors before saving.');
      return;
    }

    setFileConfigErrors({});
    setFileConfigSaving(true);
    try {
      const payload = {
        maxFileSizeMB: sizeNum,
        maxFileCount: countNum,
        allowedFileTypes: fileConfig.allowedFileTypes.map((t) => String(t).toUpperCase()),
        malwareScanningEnabled: Boolean(fileConfig.malwareScanningEnabled),
      };
      const res = await updateFileLimitsConfig(payload);
      const val = res?.value || res || payload;
      setFileConfig({
        maxFileSizeMB: Number(val.maxFileSizeMB ?? sizeNum),
        allowedFileTypes: Array.isArray(val.allowedFileTypes)
          ? val.allowedFileTypes.map((t) => String(t).toUpperCase())
          : payload.allowedFileTypes,
        maxFileCount: Number(val.maxFileCount ?? countNum),
        malwareScanningEnabled: Boolean(val.malwareScanningEnabled ?? payload.malwareScanningEnabled),
      });
      showSuccess(
        'File Security Settings Saved',
        'File upload limits and malware scanning policies have been updated. These restrictions apply immediately to newly uploaded files across tickets, messages, and knowledge base articles without modifying existing tickets.'
      );
    } catch (err) {
      showError(
        'Save Failed',
        err.response?.data?.message || err.response?.data?.errors?.attachments?.[0] || 'Failed to save file upload settings.'
      );
    } finally {
      setFileConfigSaving(false);
    }
  };

  // TS100 Reopen & Auto-Close Handlers
  const handleToggleReopen = () => {
    if (windowConfig.reopenEnabled) {
      showConfirm(
        'Disable Ticket Reopen Window?',
        'Disabling Reopen means all closed tickets are final and cannot be reopened by the customer.',
        () => {
          closeNotif();
          setWindowConfig((prev) => ({ ...prev, reopenEnabled: false }));
        },
        {
          confirmText: 'Disable Reopen',
          confirmClassName: 'bg-red-600 hover:bg-red-700',
        }
      );
    } else {
      setWindowConfig((prev) => ({ ...prev, reopenEnabled: true }));
    }
  };

  const handleToggleAutoClose = () => {
    if (windowConfig.autoCloseEnabled) {
      showConfirm(
        'Disable Auto-Close Window?',
        'Disabling Auto-Close means Resolved tickets stay open indefinitely until the customer manually closes them.',
        () => {
          closeNotif();
          setWindowConfig((prev) => ({ ...prev, autoCloseEnabled: false }));
        },
        {
          confirmText: 'Disable Auto-Close',
          confirmClassName: 'bg-red-600 hover:bg-red-700',
        }
      );
    } else {
      setWindowConfig((prev) => ({ ...prev, autoCloseEnabled: true }));
    }
  };

  // TS067 Archive Message Thread on Closure Toggle Handler
  const handleToggleArchiveOnClosure = () => {
    if (windowConfig.archiveOnClosureEnabled) {
      showConfirm(
        'Disable Message Thread Archival?',
        "Disabling this means closed tickets' message threads will no longer be automatically archived. This will not retroactively un-archive threads already archived under the current setting.",
        () => {
          closeNotif();
          setWindowConfig((prev) => ({ ...prev, archiveOnClosureEnabled: false }));
          setMessageArchivalOnClosureEnabled(false);
        },
        {
          confirmText: 'Disable Archival',
          confirmClassName: 'bg-red-600 hover:bg-red-700',
        }
      );
    } else {
      setWindowConfig((prev) => ({ ...prev, archiveOnClosureEnabled: true }));
      setMessageArchivalOnClosureEnabled(true);
    }
  };

  const handleReopenDaysChange = (val) => {
    setWindowConfig((prev) => ({ ...prev, reopenWindowDays: val }));
    const num = parseInt(val, 10);
    if (isNaN(num) || num <= 0) {
      setWindowConfigErrors((prev) => ({ ...prev, reopenWindowDays: 'Duration must be a positive number of days (at least 1).' }));
    } else {
      setWindowConfigErrors((prev) => {
        const next = { ...prev };
        delete next.reopenWindowDays;
        return next;
      });
    }
  };

  const handleAutoCloseDaysChange = (val) => {
    setWindowConfig((prev) => ({ ...prev, autoCloseWindowDays: val }));
    const num = parseInt(val, 10);
    if (isNaN(num) || num <= 0) {
      setWindowConfigErrors((prev) => ({ ...prev, autoCloseWindowDays: 'Duration must be a positive number of days (at least 1).' }));
    } else {
      setWindowConfigErrors((prev) => {
        const next = { ...prev };
        delete next.autoCloseWindowDays;
        return next;
      });
    }
  };

  const handleResetWindowConfig = async () => {
    try {
      await resetWindowConfiguration();
      setWindowConfig({
        ...TS100_DEFAULT_WINDOW_CONFIG,
        archiveOnClosureEnabled: TS100_DEFAULT_WINDOW_CONFIG.archiveOnClosureEnabled ?? false,
      });
      setWindowConfigErrors({});
      setMessageArchivalOnClosureEnabled(TS100_DEFAULT_WINDOW_CONFIG.archiveOnClosureEnabled ?? false);
      showSuccess('Reset Complete', 'Reopen, auto-close, and message archival window rules have been restored to system defaults.');
    } catch (err) {
      showError('Reset Error', err.response?.data?.message || 'Failed to reset window rules.');
    }
  };

  const handleSaveWindowConfig = async () => {
    const errors = {};
    if (windowConfig.reopenEnabled) {
      const num = parseInt(windowConfig.reopenWindowDays, 10);
      if (isNaN(num) || num <= 0) {
        errors.reopenWindowDays = 'Please enter a valid duration of at least 1 day.';
      }
    }
    if (windowConfig.autoCloseEnabled) {
      const num = parseInt(windowConfig.autoCloseWindowDays, 10);
      if (isNaN(num) || num <= 0) {
        errors.autoCloseWindowDays = 'Please enter a valid duration of at least 1 day.';
      }
    }

    if (Object.keys(errors).length > 0) {
      setWindowConfigErrors(errors);
      showError('Validation Error', 'Please correct the errors before saving.');
      return;
    }

    try {
      const updated = await updateWindowConfiguration({
        reopenEnabled: Boolean(windowConfig.reopenEnabled),
        reopenWindowDays: parseInt(windowConfig.reopenWindowDays, 10),
        autoCloseEnabled: Boolean(windowConfig.autoCloseEnabled),
        autoCloseWindowDays: parseInt(windowConfig.autoCloseWindowDays, 10),
      });

      setWindowConfigErrors({});
      setMessageArchivalOnClosureEnabled(windowConfig.archiveOnClosureEnabled);
      if (updated) {
        setWindowConfig((prev) => ({
          ...prev,
          reopenEnabled: Boolean(updated.reopenEnabled ?? prev.reopenEnabled),
          reopenWindowDays: Number(updated.reopenWindowDays ?? prev.reopenWindowDays),
          autoCloseEnabled: Boolean(updated.autoCloseEnabled ?? prev.autoCloseEnabled),
          autoCloseWindowDays: Number(updated.autoCloseWindowDays ?? prev.autoCloseWindowDays),
        }));
      }
      showSuccess('Settings Saved', 'Closure window policies and message thread archival rules updated and saved successfully.');
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.errors
        ? Object.values(err.response?.data?.errors || {}).flat().join(' ')
        : 'Failed to save window configuration.';
      showError('Save Error', msg);
    }
  };

  const handleSaveMessagingConfig = async () => {
    try {
      setMessagingSaving(true);
      const updated = await updateMessagingConfiguration(messagingConfig);
      if (updated) {
        setMessagingConfig((prev) => ({
          ...prev,
          default_participants: updated.default_participants ?? prev.default_participants,
          allow_delegated_employee: Boolean(updated.allow_delegated_employee ?? prev.allow_delegated_employee),
          allow_full_history: Boolean(updated.allow_full_history ?? prev.allow_full_history),
          notify_on_employee_join: Boolean(updated.notify_on_employee_join ?? prev.notify_on_employee_join),
          internal: {
            mode: updated.internal?.mode ?? prev.internal?.mode ?? 'requestor_cs_delegated',
            allow_direct_assigned: Boolean(updated.internal?.allow_direct_assigned ?? prev.internal?.allow_direct_assigned ?? true),
            allow_full_history: Boolean(updated.internal?.allow_full_history ?? prev.internal?.allow_full_history ?? true),
            notify_on_activity: Boolean(updated.internal?.notify_on_activity ?? prev.internal?.notify_on_activity ?? true),
          },
        }));
      }
      showSuccess('Settings Saved', 'Ticket messaging participation configuration updated and saved successfully.');
    } catch (err) {
      showError('Save Error', err.response?.data?.message || 'Failed to save messaging configuration.');
    } finally {
      setMessagingSaving(false);
    }
  };

  const handleResetMessagingConfig = async () => {
    try {
      setMessagingSaving(true);
      const res = await resetMessagingConfiguration();
      const updated = res?.data || res?.value || res;
      if (updated) {
        setMessagingConfig({
          default_participants: updated.default_participants || 'customer_cs',
          allow_delegated_employee: Boolean(updated.allow_delegated_employee ?? true),
          allow_full_history: Boolean(updated.allow_full_history ?? true),
          notify_on_employee_join: Boolean(updated.notify_on_employee_join ?? true),
          internal: {
            mode: updated.internal?.mode || 'requestor_cs_delegated',
            allow_direct_assigned: Boolean(updated.internal?.allow_direct_assigned ?? true),
            allow_full_history: Boolean(updated.internal?.allow_full_history ?? true),
            notify_on_activity: Boolean(updated.internal?.notify_on_activity ?? true),
          },
        });
      }
      showSuccess('Reset Complete', 'Ticket messaging configuration has been reset to system defaults.');
    } catch (err) {
      showError('Reset Error', err.response?.data?.message || 'Failed to reset messaging configuration.');
    } finally {
      setMessagingSaving(false);
    }
  };

  // TS099: Compute full recipient options combining contextual actors, static roles, and dynamic departments
  const ts099RecipientOptions = useMemo(() => {
    const deptList = (items.departments && items.departments.length > 0)
      ? items.departments.map((d) => ({
        id: `dept_${d.id}`,
        label: `${d.name} Department`,
        desc: d.description || `All staff in ${d.name} department`,
        type: 'department',
        badge: 'Dept',
      }))
      : [
        { id: 'dept_1', label: 'Service Department', desc: 'All staff in Service department', type: 'department', badge: 'Dept' },
        { id: 'dept_2', label: 'IT Department', desc: 'All staff in IT department', type: 'department', badge: 'Dept' },
      ];

    return {
      contextual: TS099_CONTEXTUAL_RECIPIENTS,
      staticGroup: [
        ...TS099_STATIC_ROLES,
        ...deptList,
      ],
    };
  }, [items.departments]);

  const handleToggleRecipient = (alertKey, recipientId) => {
    const currentRecipients = routingConfig[alertKey] || [];
    const isSelected = currentRecipients.includes(recipientId);
    const nextRecipients = isSelected
      ? currentRecipients.filter((id) => id !== recipientId)
      : [...currentRecipients, recipientId];

    // Validation: block selecting zero recipients with an inline error
    if (nextRecipients.length === 0) {
      const alertMeta = TS099_ALERT_TYPES.find((a) => a.key === alertKey);
      setRoutingErrors((prev) => ({
        ...prev,
        [alertKey]: `At least one recipient is required for ${alertMeta?.title || 'this alert'}.`,
      }));
      return;
    }

    // Clear any existing error for this alertKey
    setRoutingErrors((prev) => {
      if (!prev[alertKey]) return prev;
      const next = { ...prev };
      delete next[alertKey];
      return next;
    });

    const isAlreadyConfigured = configuredAlerts[alertKey];
    const allRecipients = [
      ...TS099_CONTEXTUAL_RECIPIENTS,
      ...TS099_STATIC_ROLES,
      ...(items.departments || []).map((d) => ({ id: `dept_${d.id}`, label: `${d.name} Department` })),
      { id: 'dept_1', label: 'Service Department' },
      { id: 'dept_2', label: 'IT Department' },
    ];
    const recipientMeta = allRecipients.find((r) => r.id === recipientId);
    const recipientLabel = recipientMeta?.label || recipientId;
    const alertMeta = TS099_ALERT_TYPES.find((a) => a.key === alertKey);
    const actionText = isSelected ? 'remove' : 'add';

    if (isAlreadyConfigured) {
      showConfirm(
        `Update ${alertMeta?.title || 'Alert'} Recipients?`,
        `Are you sure you want to ${actionText} "${recipientLabel}" ${isSelected ? 'from' : 'to'} ${alertMeta?.title || 'this alert'}? This changes who receives notifications for this event.`,
        () => {
          closeNotif();
          setRoutingConfig((prev) => ({
            ...prev,
            [alertKey]: nextRecipients,
          }));
          showSuccess('Recipient Updated', `Updated recipient routing for ${alertMeta?.title}.`);
        },
        {
          confirmText: isSelected ? 'Remove Recipient' : 'Add Recipient',
          confirmClassName: isSelected ? 'bg-amber-600 hover:bg-amber-700' : 'bg-[#252578] hover:bg-[#1a1a5e]',
          onCancel: () => {
            closeNotif();
            // Revert: state remains untouched at currentRecipients
          },
        }
      );
    } else {
      // First-time configuration: no modal
      setRoutingConfig((prev) => ({
        ...prev,
        [alertKey]: nextRecipients,
      }));
      setConfiguredAlerts((prev) => ({
        ...prev,
        [alertKey]: true,
      }));
    }
  };

  const handleResetRoutingConfig = () => {
    showConfirm(
      'Reset Recipient Routing to Defaults?',
      'Are you sure you want to restore all notification routing rules to their system defaults? Any recipient customizations will be reverted.',
      async () => {
        closeNotif();
        try {
          const res = await resetNotificationRouting();
          const nextRouting = res?.value || res || TS099_DEFAULT_ROUTING;
          setRoutingConfig(nextRouting);
          setConfiguredAlerts({});
          setRoutingErrors({});
          showSuccess('Reset to Defaults', 'Notification recipient routing has been restored to defaults.');
        } catch (err) {
          showError('Reset Failed', err.response?.data?.message || 'Failed to reset recipient routing to defaults.');
        }
      },
      {
        confirmText: 'Reset to Defaults',
        confirmClassName: 'bg-amber-600 hover:bg-amber-700',
      }
    );
  };

  const handleSaveRoutingConfig = async () => {
    const errors = {};
    for (const alert of TS099_ALERT_TYPES) {
      const list = routingConfig[alert.key] || [];
      if (list.length === 0) {
        errors[alert.key] = `At least one recipient is required for ${alert.title}.`;
      }
    }

    if (Object.keys(errors).length > 0) {
      setRoutingErrors(errors);
      showError('Validation Error', 'Please ensure all alert types have at least one recipient selected.');
      return;
    }

    setRoutingErrors({});
    setRoutingSaving(true);
    try {
      const res = await updateNotificationRouting({
        new_ticket: routingConfig.new_ticket,
        new_message: routingConfig.new_message,
        overdue_ticket: routingConfig.overdue_ticket,
      });
      const savedRouting = res?.value || res || routingConfig;
      setRoutingConfig(savedRouting);
      setConfiguredAlerts({
        new_ticket: true,
        new_message: true,
        overdue_ticket: true,
      });
      showSuccess(
        'Routing Saved',
        'Notification recipient routing has been successfully saved and applied to subsequent alerts.'
      );
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to save recipient routing.';
      const backendErrors = err.response?.data?.errors;
      if (backendErrors && typeof backendErrors === 'object') {
        const mappedErrors = {};
        for (const [k, v] of Object.entries(backendErrors)) {
          mappedErrors[k] = Array.isArray(v) ? v[0] : v;
        }
        setRoutingErrors(mappedErrors);
      }
      showError('Save Failed', msg);
    } finally {
      setRoutingSaving(false);
    }
  };

  // TS103 Notification Channel Handlers
  const handleChangeChannel = (alertKey, newChannel) => {
    const currentChannel = channelConfig[alertKey];
    if (currentChannel === newChannel) return;

    // Clear any existing error for this alertKey
    setChannelErrors((prev) => {
      if (!prev[alertKey]) return prev;
      const next = { ...prev };
      delete next[alertKey];
      return next;
    });

    setChannelConfig((prev) => ({
      ...prev,
      [alertKey]: newChannel,
    }));
  };

  const handleResetChannelConfig = () => {
    showConfirm(
      'Reset Notification Channels to Defaults?',
      'Are you sure you want to restore all notification delivery channels to system defaults? Any channel customizations will be reverted.',
      async () => {
        closeNotif();
        setChannelsSaving(true);
        try {
          const res = await resetNotificationChannels();
          if (res?.channels && Array.isArray(res.channels)) {
            const defaults = {};
            res.channels.forEach((c) => {
              defaults[c.alert_key] = c.channel;
            });
            setChannelConfig(defaults);
          } else {
            setChannelConfig(TS103_DEFAULT_CHANNELS);
          }
          setConfiguredChannels({});
          setChannelErrors({});
          showSuccess('Reset to Defaults', res.message || 'Notification channel configuration has been restored to defaults.');
        } catch (err) {
          const msg = err.response?.data?.message || err.message || 'Failed to reset notification channels.';
          showError('Reset Failed', msg);
        } finally {
          setChannelsSaving(false);
        }
      },
      {
        confirmText: 'Reset to Defaults',
        confirmClassName: 'bg-amber-600 hover:bg-amber-700',
      }
    );
  };

  const handleSaveChannelConfig = async () => {
    const errors = {};
    const validChannels = ['email', 'in_app', 'both'];
    for (const alert of TS103_ALERT_TYPES) {
      const ch = channelConfig[alert.key];
      if (!ch || !validChannels.includes(ch)) {
        errors[alert.key] = `Please select a valid delivery channel for ${alert.title}.`;
      }
    }

    if (Object.keys(errors).length > 0) {
      setChannelErrors(errors);
      showError('Validation Error', 'Please select a delivery channel for all alert types.');
      return;
    }

    setChannelErrors({});
    setChannelsSaving(true);
    try {
      const res = await updateNotificationChannels(channelConfig);
      const allConfigured = {};
      TS103_ALERT_TYPES.forEach((a) => {
        allConfigured[a.key] = true;
      });
      setConfiguredChannels(allConfigured);
      if (res?.channelMap) {
        setChannelConfig((prev) => ({
          ...prev,
          ...res.channelMap,
        }));
      }
      showSuccess(
        'Configuration Saved',
        res.message || 'Notification channel configuration has been saved in the database successfully.'
      );
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to save notification channel configuration.';
      showError('Save Failed', msg);
    } finally {
      setChannelsSaving(false);
    }
  };

  // TS095 Ticket Defaults Handlers
  const handlePriorityChange = (newPriority) => {
    if (!newPriority) {
      setDefaultsErrors((prev) => ({ ...prev, priority: 'Please select a valid default priority level.' }));
      return;
    }
    setDefaultsErrors((prev) => {
      const next = { ...prev };
      delete next.priority;
      return next;
    });

    if (newPriority === defaultsConfig.priority) return;

    const previousPriority = defaultsConfig.priority;
    defaultsDraftDirtyRef.current = true;
    // Optimistically update UI so select doesn't immediately snap back
    setDefaultsConfig((prev) => ({ ...prev, priority: newPriority }));

    const performSave = async () => {
      try {
        const payload = {
          status: defaultsConfig.status || 'Open',
          priority: newPriority,
          slaPolicy: defaultsConfig.slaPolicy || 'dynamic',
        };
        const res = await updateTicketDefaultsConfig(payload);
        const updated = res.value || res;
        const finalConfig = {
          status: updated.status || defaultsConfig.status || 'Open',
          priority: updated.priority || newPriority,
          slaPolicy: updated.slaPolicy || defaultsConfig.slaPolicy || 'dynamic',
        };
        defaultsDraftDirtyRef.current = false;
        setDefaultsConfig(finalConfig);
        setConfiguredDefaults((prev) => ({ ...prev, priority: true }));
        try {
          localStorage.setItem('superadmin_ticket_defaults_config', JSON.stringify(finalConfig));
        } catch {}
        showSuccess('Default Priority Updated', `Default priority has been updated to "${newPriority}" for new tickets.`);
      } catch (err) {
        defaultsDraftDirtyRef.current = false;
        setDefaultsConfig((prev) => ({ ...prev, priority: previousPriority }));
        const msg = err.response?.data?.message || err.message || 'Failed to update default priority.';
        showError('Update Failed', msg);
      }
    };

    if (configuredDefaults.priority || defaultsConfig.priority) {
      showConfirm(
        'Change Default Priority?',
        'This affects all new tickets going forward across the system. Existing tickets will not be changed.',
        () => {
          closeNotif();
          performSave();
        },
        {
          confirmText: 'Change Priority',
          confirmClassName: 'bg-[#252578] hover:bg-[#1a1a5e]',
          onCancel: () => {
            closeNotif();
            defaultsDraftDirtyRef.current = false;
            setDefaultsConfig((prev) => ({ ...prev, priority: previousPriority }));
          },
        }
      );
    } else {
      performSave();
    }
  };

  const handleSlaPolicyChange = (newSlaPolicy) => {
    if (newSlaPolicy === defaultsConfig.slaPolicy) return;

    const getPolicyLabel = (key) => {
      if (key === 'dynamic') return 'Dynamic (Department & Priority Rule)';
      const found = (items.slas || []).find((s) => String(s.sla_ID) === String(key) || s.sla_name === key);
      return found?.sla_name || key;
    };
    const newLabel = getPolicyLabel(newSlaPolicy);
    const previousSlaPolicy = defaultsConfig.slaPolicy;
    defaultsDraftDirtyRef.current = true;

    // Optimistically update UI so select doesn't immediately snap back
    setDefaultsConfig((prev) => ({ ...prev, slaPolicy: newSlaPolicy }));

    const performSave = async () => {
      try {
        const payload = {
          status: defaultsConfig.status || 'Open',
          priority: defaultsConfig.priority || 'Low',
          slaPolicy: newSlaPolicy,
        };
        const res = await updateTicketDefaultsConfig(payload);
        const updated = res.value || res;
        const finalConfig = {
          status: updated.status || defaultsConfig.status || 'Open',
          priority: updated.priority || defaultsConfig.priority || 'Low',
          slaPolicy: updated.slaPolicy || newSlaPolicy,
        };
        defaultsDraftDirtyRef.current = false;
        setDefaultsConfig(finalConfig);
        setConfiguredDefaults((prev) => ({ ...prev, slaPolicy: true }));
        try {
          localStorage.setItem('superadmin_ticket_defaults_config', JSON.stringify(finalConfig));
        } catch {}
        showSuccess('Default SLA Policy Updated', `Default SLA policy has been updated to "${newLabel}" for new tickets.`);
      } catch (err) {
        defaultsDraftDirtyRef.current = false;
        setDefaultsConfig((prev) => ({ ...prev, slaPolicy: previousSlaPolicy }));
        const msg = err.response?.data?.message || err.message || 'Failed to update default SLA policy.';
        showError('Update Failed', msg);
      }
    };

    if (configuredDefaults.slaPolicy || defaultsConfig.slaPolicy) {
      showConfirm(
        'Change Default SLA Policy?',
        'This affects all new tickets going forward across the system. Existing tickets will not be changed.',
        () => {
          closeNotif();
          performSave();
        },
        {
          confirmText: 'Change SLA Policy',
          confirmClassName: 'bg-[#252578] hover:bg-[#1a1a5e]',
          onCancel: () => {
            closeNotif();
            defaultsDraftDirtyRef.current = false;
            setDefaultsConfig((prev) => ({ ...prev, slaPolicy: previousSlaPolicy }));
          },
        }
      );
    } else {
      performSave();
    }
  };

  const handleResetDefaults = () => {
    showConfirm(
      'Reset Ticket Defaults?',
      'This will restore default ticket values (Open status, Low priority, Dynamic SLA Policy). Already created tickets will remain untouched.',
      async () => {
        closeNotif();
        try {
          const res = await resetTicketDefaultsConfig();
          const val = res.value || res;
          const resetConfig = {
            status: val.status || 'Open',
            priority: val.priority || 'Low',
            slaPolicy: val.slaPolicy || 'dynamic',
          };
          setDefaultsConfig(resetConfig);
          setDefaultsErrors({});
          try {
            localStorage.setItem('superadmin_ticket_defaults_config', JSON.stringify(resetConfig));
          } catch {}
          showSuccess('Reset Complete', 'Ticket defaults have been reset to system baseline.');
        } catch (err) {
          const msg = err.response?.data?.message || err.message || 'Failed to reset ticket defaults.';
          showError('Reset Failed', msg);
        }
      },
      { confirmText: 'Reset Defaults', confirmClassName: 'bg-red-600 hover:bg-red-700' }
    );
  };

  // TS094 Ticket Number Format Handlers & Live Preview Computations
  const livePreviewDatePart = useMemo(() => {
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');

    if (numberFormatConfig.dateSegment === 'YYYY') return yyyy;
    if (numberFormatConfig.dateSegment === 'YYYYMM') return `${yyyy}${mm}`;
    if (numberFormatConfig.dateSegment === 'YYYYMMDD') return `${yyyy}${mm}${dd}`;
    return null;
  }, [numberFormatConfig.dateSegment]);

  const livePreviewSeqPart = useMemo(() => {
    const rawLen = parseInt(String(numberFormatConfig.digitLength || '').trim(), 10);
    const padLen = !isNaN(rawLen) && rawLen >= 1 && rawLen <= 12 ? rawLen : 4;
    return String(1).padStart(padLen, '0');
  }, [numberFormatConfig.digitLength]);

  const livePreviewTicketNumber = useMemo(() => {
    const p = (numberFormatConfig.prefix || '').trim().toUpperCase() || 'TKT';
    const dCode = numberFormatConfig.includeDeptCode
      ? (numberFormatConfig.deptCode || '').trim().toUpperCase() || 'DEPT'
      : null;
    const datePart = livePreviewDatePart;
    const seqPart = livePreviewSeqPart;

    return [p, dCode, datePart, seqPart].filter(Boolean).join('-');
  }, [numberFormatConfig.prefix, numberFormatConfig.includeDeptCode, numberFormatConfig.deptCode, livePreviewDatePart, livePreviewSeqPart]);

  const validateNumberFormat = (config) => {
    const errors = {};

    // Prefix validation
    if (!config.prefix || !config.prefix.trim()) {
      errors.prefix = 'A prefix is required.';
    } else if (!/^[A-Za-z0-9_-]+$/.test(config.prefix.trim())) {
      errors.prefix = 'Prefix can only contain letters, numbers, hyphens, and underscores.';
    }

    // Branch/Department code validation (if enabled)
    if (config.includeDeptCode) {
      if (!config.deptCode || !config.deptCode.trim()) {
        errors.deptCode = 'Please enter a department code or disable this segment.';
      } else if (!/^[A-Za-z0-9_-]+$/.test(config.deptCode.trim())) {
        errors.deptCode = 'Department code can only contain letters, numbers, and hyphens.';
      }
    }

    // Sequential digit length validation
    const rawLen = String(config.digitLength ?? '').trim();
    if (!rawLen || rawLen === '0' || !/^\d+$/.test(rawLen)) {
      errors.digitLength = 'A sequential number is required to prevent duplicate ticket IDs.';
    } else {
      const num = parseInt(rawLen, 10);
      if (num < 3 || num > 8) {
        errors.digitLength = 'Sequential digit length must be between 3 and 8 digits.';
      }
    }

    return errors;
  };

  const handlePrefixChange = (val) => {
    numberFormatDraftDirtyRef.current = true;
    setNumberFormatDraftDirty(true);
    setNumberFormatConfig((prev) => ({ ...prev, prefix: val }));
    if (numberFormatErrors.prefix) {
      setNumberFormatErrors((prev) => {
        const next = { ...prev };
        delete next.prefix;
        return next;
      });
    }
  };

  const handleIncludeDeptCodeChange = (checked) => {
    numberFormatDraftDirtyRef.current = true;
    setNumberFormatDraftDirty(true);
    setNumberFormatConfig((prev) => ({ ...prev, includeDeptCode: checked }));
    if (numberFormatErrors.deptCode) {
      setNumberFormatErrors((prev) => {
        const next = { ...prev };
        delete next.deptCode;
        return next;
      });
    }
  };

  const handleDeptCodeChange = (val) => {
    numberFormatDraftDirtyRef.current = true;
    setNumberFormatDraftDirty(true);
    setNumberFormatConfig((prev) => ({ ...prev, deptCode: val }));
    if (numberFormatErrors.deptCode) {
      setNumberFormatErrors((prev) => {
        const next = { ...prev };
        delete next.deptCode;
        return next;
      });
    }
  };

  const handleDateSegmentChange = (val) => {
    numberFormatDraftDirtyRef.current = true;
    setNumberFormatDraftDirty(true);
    setNumberFormatConfig((prev) => ({ ...prev, dateSegment: val }));
  };

  const handleDigitLengthChange = (val) => {
    numberFormatDraftDirtyRef.current = true;
    setNumberFormatDraftDirty(true);
    setNumberFormatConfig((prev) => ({ ...prev, digitLength: val }));
    if (numberFormatErrors.digitLength) {
      setNumberFormatErrors((prev) => {
        const next = { ...prev };
        delete next.digitLength;
        return next;
      });
    }
  };

  const handleSaveNumberFormat = () => {
    const errors = validateNumberFormat(numberFormatConfig);
    if (Object.keys(errors).length > 0) {
      setNumberFormatErrors(errors);
      showError('Validation Error', 'Please correct the errors in the format configuration before saving.');
      return;
    }

    setNumberFormatErrors({});

    showConfirm(
      'Save Ticket Number Format?',
      'This will change how all tickets are numbered going forward, across all branches. Existing tickets will remain unchanged.',
      async () => {
        closeNotif();
        setSavingNumberFormat(true);
        const normalized = {
          prefix: (numberFormatConfig.prefix || 'TKT').trim().toUpperCase(),
          includeDeptCode: Boolean(numberFormatConfig.includeDeptCode),
          deptCode: numberFormatConfig.includeDeptCode ? (numberFormatConfig.deptCode || '').trim().toUpperCase() : '',
          dateSegment: numberFormatConfig.dateSegment,
          digitLength: parseInt(String(numberFormatConfig.digitLength).trim(), 10),
        };

        try {
          const res = await updateTicketNumberFormatConfig(normalized);
          const saved = res?.value || res || normalized;
          const cleanSaved = {
            prefix: String(saved.prefix || normalized.prefix).toUpperCase(),
            includeDeptCode: Boolean(saved.includeDeptCode ?? normalized.includeDeptCode),
            deptCode: String(saved.deptCode || normalized.deptCode).toUpperCase(),
            dateSegment: String(saved.dateSegment || normalized.dateSegment),
            digitLength: Number(saved.digitLength || normalized.digitLength),
          };
          numberFormatDraftDirtyRef.current = false;
          setNumberFormatDraftDirty(false);
          setNumberFormatConfig(cleanSaved);
          setSavedNumberFormat(cleanSaved);
          setHasEverSavedFormat(true);
          try {
            localStorage.setItem('superadmin_ticket_number_format_config', JSON.stringify(cleanSaved));
          } catch {}
          showSuccess('Ticket Format Saved', 'Ticket number format has been saved. New tickets will use this format going forward.');
        } catch (err) {
          const errMsg = err?.response?.data?.message || err?.message || 'Failed to save ticket number format.';
          showError('Save Failed', errMsg);
        } finally {
          setSavingNumberFormat(false);
        }
      },
      {
        confirmText: 'Save Format',
        confirmClassName: 'bg-[#252578] hover:bg-[#1a1a5e]',
        onCancel: () => {
          closeNotif();
          numberFormatDraftDirtyRef.current = false;
          setNumberFormatDraftDirty(false);
          // If cancelled, revert to prior saved format
          setNumberFormatConfig({ ...savedNumberFormat });
          setNumberFormatErrors({});
        },
      }
    );
  };

  const handleResetNumberFormat = () => {
    showConfirm(
      'Reset Ticket Number Format?',
      'This will restore the ticket number format to default (TKT-0001). Existing tickets will remain unchanged.',
      async () => {
        closeNotif();
        setSavingNumberFormat(true);
        try {
          const res = await resetTicketNumberFormatConfig();
          const saved = res?.value || res || TS094_DEFAULT_FORMAT;
          const cleanSaved = {
            prefix: String(saved.prefix || TS094_DEFAULT_FORMAT.prefix).toUpperCase(),
            includeDeptCode: Boolean(saved.includeDeptCode ?? TS094_DEFAULT_FORMAT.includeDeptCode),
            deptCode: String(saved.deptCode || TS094_DEFAULT_FORMAT.deptCode).toUpperCase(),
            dateSegment: String(saved.dateSegment || TS094_DEFAULT_FORMAT.dateSegment),
            digitLength: Number(saved.digitLength || TS094_DEFAULT_FORMAT.digitLength),
          };
          numberFormatDraftDirtyRef.current = false;
          setNumberFormatDraftDirty(false);
          setNumberFormatConfig(cleanSaved);
          setSavedNumberFormat(cleanSaved);
          setHasEverSavedFormat(false);
          setNumberFormatErrors({});
          try {
            localStorage.setItem('superadmin_ticket_number_format_config', JSON.stringify(cleanSaved));
          } catch {}
          showSuccess('Reset to Defaults', 'Ticket number format has been reset to system default (TKT-0001).');
        } catch (err) {
          const errMsg = err?.response?.data?.message || err?.message || 'Failed to reset ticket number format.';
          showError('Reset Failed', errMsg);
        } finally {
          setSavingNumberFormat(false);
        }
      },
      {
        confirmText: 'Reset Format',
        confirmClassName: 'bg-amber-600 hover:bg-amber-700',
      }
    );
  };

  // TS096 Max Open Tickets per Requester Handlers
  const updateTicketLimitDraftState = (nextConfig) => {
    const latestSaved = savedTicketLimitRef.current;
    const isDirty = Boolean(nextConfig.isUnlimited) !== Boolean(latestSaved.isUnlimited)
      || Number(nextConfig.limit) !== Number(latestSaved.limit);

    ticketLimitDraftDirtyRef.current = isDirty;
    setTicketLimitDraftDirty(isDirty);
    if (!isDirty) {
      setTicketLimitConflict(null);
    }
    setTicketLimitConfigState(nextConfig);
  };

  const handleToggleUnlimited = (checked) => {
    updateTicketLimitDraftState({
      ...ticketLimitConfig,
      isUnlimited: checked,
    });
    setLimitError('');
  };

  const handleLimitNumberChange = (val) => {
    updateTicketLimitDraftState({
      ...ticketLimitConfig,
      limit: val,
    });
    if (limitError) {
      setLimitError('');
    }
  };

  const handleReloadLatestTicketLimit = () => {
    const latest = { ...savedTicketLimitRef.current };
    ticketLimitDraftDirtyRef.current = false;
    setTicketLimitDraftDirty(false);
    setTicketLimitConflict(null);
    setTicketLimitConfigState(latest);
    setLimitError('');
  };

  const handleSaveTicketLimit = () => {
    if (ticketLimitConflict) {
      showError('Reload Required', 'The saved max-open-ticket policy changed while you were editing. Reload the latest value before saving.');
      return;
    }
    if (!ticketLimitConfig.isUnlimited) {
      const parsed = parseInt(String(ticketLimitConfig.limit).trim(), 10);
      if (isNaN(parsed) || parsed <= 0 || parsed > 1000) {
        setLimitError('Please enter a whole-number ticket limit from 1 to 1000.');
        showError('Validation Error', 'Please enter a whole-number ticket limit from 1 to 1000.');
        return;
      }
    }

    setLimitError('');
    const normalized = {
      isUnlimited: Boolean(ticketLimitConfig.isUnlimited),
      limit: parseInt(String(ticketLimitConfig.limit || 5).trim(), 10) || 5,
    };

    showConfirm(
      'Save Max Open Tickets Limit?',
      'This will affect ticket submission for all customers and requestors going forward.',
      async () => {
        closeNotif();
        setSavingTicketLimit(true);
        try {
          const updated = await updateTicketLimitConfig(normalized);
          setMaxOpenTicketsLimit(updated);
          savedTicketLimitRef.current = updated;
          ticketLimitDraftDirtyRef.current = false;
          setTicketLimitDraftDirty(false);
          setTicketLimitConflict(null);
          setTicketLimitConfigState(updated);
          setSavedTicketLimit(updated);
          showSuccess(
            'Limit Saved',
            updated.isUnlimited
              ? 'Max open tickets is now Unlimited.'
              : `Each customer or requestor can now have up to ${updated.limit} tickets that count toward the limit.`
          );
        } catch (err) {
          ticketLimitDraftDirtyRef.current = false;
          setTicketLimitDraftDirty(false);
          setTicketLimitConflict(null);
          setTicketLimitConfigState({ ...savedTicketLimitRef.current });
          const backendErrors = err.response?.data?.errors;
          const message = backendErrors
            ? Object.values(backendErrors).flat().join(' ')
            : err.response?.data?.message || 'Failed to save the max open tickets limit.';
          setLimitError(message);
          showError('Save Failed', message);
        } finally {
          setSavingTicketLimit(false);
        }
      },
      {
        confirmText: 'Save Limit',
        confirmClassName: 'bg-[#252578] hover:bg-[#1a1a5e]',
        onCancel: () => {
          closeNotif();
          ticketLimitDraftDirtyRef.current = false;
          setTicketLimitDraftDirty(false);
          setTicketLimitConflict(null);
          setTicketLimitConfigState({ ...savedTicketLimitRef.current });
          setLimitError('');
        },
      }
    );
  };

  const handleResetTicketLimit = () => {
    if (ticketLimitConflict) {
      showError('Reload Required', 'The saved max-open-ticket policy changed while you were editing. Reload the latest value before resetting.');
      return;
    }

    showConfirm(
      'Reset Max Open Tickets Limit?',
      'This will restore the system default of Unlimited.',
      async () => {
        closeNotif();
        setSavingTicketLimit(true);
        try {
          const updated = await resetTicketLimitConfig();
          setMaxOpenTicketsLimit(updated);
          savedTicketLimitRef.current = updated;
          ticketLimitDraftDirtyRef.current = false;
          setTicketLimitDraftDirty(false);
          setTicketLimitConflict(null);
          setTicketLimitConfigState(updated);
          setSavedTicketLimit(updated);
          setLimitError('');
          showSuccess('Reset to Defaults', 'Max open tickets has been restored to Unlimited.');
        } catch (err) {
          showError('Reset Failed', err.response?.data?.message || 'Failed to reset the max open tickets limit.');
        } finally {
          setSavingTicketLimit(false);
        }
      },
      {
        confirmText: 'Reset Limit',
        confirmClassName: 'bg-amber-600 hover:bg-amber-700',
      }
    );
  };

  // TS101 Feedback Form Master Toggle Handler
  const handleToggleFeedbackMaster = () => {
    if (feedbackMasterEnabled) {
      showConfirm(
        'Disable Feedback Form?',
        'Disabling this switch will immediately stop presenting feedback forms to customers across the entire portal and pause collecting new feedback data points. Historical CSAT and feedback data will not be deleted, archived, or hidden.',
        async () => {
          closeNotif();
          setFeedbackMasterEnabled(false);
          setFeedbackFormEnabled(false);
          try {
            const res = await updateFeedbackFormStatus(false);
            showSuccess('Feedback Form Disabled', res.message || 'Feedback forms and analytics collection are now disabled.');
          } catch (err) {
            setFeedbackMasterEnabled(true);
            setFeedbackFormEnabled(true);
            const msg = err.response?.data?.message || 'Failed to update feedback form status.';
            showError('Update Failed', msg);
          }
        },
        {
          confirmText: 'Disable Feedback Form',
          confirmClassName: 'bg-amber-600 hover:bg-amber-700',
        }
      );
    } else {
      setFeedbackMasterEnabled(true);
      setFeedbackFormEnabled(true);
      updateFeedbackFormStatus(true).then((res) => {
        showSuccess('Feedback Form Enabled', res.message || 'Feedback forms and analytics collection are now active.');
      }).catch((err) => {
        setFeedbackMasterEnabled(false);
        setFeedbackFormEnabled(false);
        const msg = err.response?.data?.message || 'Failed to update feedback form status.';
        showError('Update Failed', msg);
      });
    }
  };

  // TS104 Feedback Form Handlers
  // Keep activeFeedbackCategory in sync: if the dynamic category list changes and the active one
  // is no longer present (e.g. after adding new equipment categories), reset to first available
  useEffect(() => {
    if (feedbackCategories.length > 0 && !feedbackCategories.includes(activeFeedbackCategory)) {
      setActiveFeedbackCategory(feedbackCategories[0]);
    }
  }, [feedbackCategories, activeFeedbackCategory]);

  const handleSelectFeedbackCategory = (cat) => {
    setActiveFeedbackCategory(cat);
    setFeedbackInlineError('');
  };

  const handleToggleFeedbackQuestion = async (category, questionId) => {
    setFeedbackInlineError('');
    const questions = feedbackQuestions[category] || [];
    const target = questions.find((q) => q.id === questionId);
    if (!target) return;

    if (target.isEnabled) {
      const enabledCount = questions.filter((q) => q.isEnabled).length;
      if (enabledCount <= 1) {
        setFeedbackInlineError(`At least one question must stay enabled for ${category}.`);
        return;
      }
    }

    // Optimistic update
    setFeedbackQuestions((prev) => ({
      ...prev,
      [category]: (prev[category] || []).map((q) =>
        q.id === questionId ? { ...q, isEnabled: !q.isEnabled } : q
      ),
    }));

    try {
      const res = await toggleFeedbackQuestion(questionId, category);
      if (res.question) {
        setFeedbackQuestions((prev) => ({
          ...prev,
          [category]: (prev[category] || []).map((q) =>
            String(q.id) === String(questionId) || String(q.id) === String(res.question.id) ? res.question : q
          ),
        }));
      }
    } catch (err) {
      // Revert optimistic update
      setFeedbackQuestions((prev) => ({
        ...prev,
        [category]: (prev[category] || []).map((q) =>
          String(q.id) === String(questionId) ? { ...q, isEnabled: target.isEnabled } : q
        ),
      }));
      const msg = err.response?.data?.message || 'Failed to toggle feedback question.';
      setFeedbackInlineError(msg);
      showError('Action Failed', msg);
    }
  };

  const handleMoveFeedbackQuestion = async (category, index, direction) => {
    setFeedbackInlineError('');
    const questions = feedbackQuestions[category] || [];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= questions.length) return;

    const updated = [...questions];
    const [moved] = updated.splice(index, 1);
    updated.splice(targetIndex, 0, moved);

    setFeedbackQuestions((prev) => ({
      ...prev,
      [category]: updated,
    }));

    try {
      await reorderFeedbackQuestions(category, updated.map((q) => q.id));
    } catch (err) {
      // Revert
      setFeedbackQuestions((prev) => ({
        ...prev,
        [category]: questions,
      }));
      const msg = err.response?.data?.message || 'Failed to reorder feedback questions.';
      setFeedbackInlineError(msg);
    }
  };

  const handleAddFeedbackQuestion = () => {
    setFeedbackInlineError('');
    setEditingQuestion({
      id: null,
      category: activeFeedbackCategory,
      text: '',
      responseType: 'Star Rating',
      options: null,
      isEnabled: true,
    });
  };

  const handleEditFeedbackQuestion = (question) => {
    setFeedbackInlineError('');
    let opts = question.options;
    if (question.responseType === 'Yes / No') {
      opts = ['Yes', 'No'];
    } else if (question.responseType === 'Multiple Choice' || question.responseType === 'Checkbox') {
      opts = Array.isArray(opts) && opts.length > 0 ? opts : ['Option 1', 'Option 2'];
    }
    setEditingQuestion({
      ...question,
      options: opts,
      category: activeFeedbackCategory,
    });
  };

  const handleSaveFeedbackQuestion = async () => {
    if (!editingQuestion || !editingQuestion.text.trim()) return;
    const trimmedText = editingQuestion.text.trim();
    const cat = editingQuestion.category || activeFeedbackCategory;
    const resType = editingQuestion.responseType || 'Star Rating';

    let options = null;
    if (resType === 'Yes / No') {
      options = ['Yes', 'No'];
    } else if (resType === 'Multiple Choice' || resType === 'Checkbox') {
      options = Array.isArray(editingQuestion.options)
        ? editingQuestion.options.map((o) => String(o).trim()).filter(Boolean)
        : ['Option 1', 'Option 2'];
      if (options.length === 0) {
        options = ['Option 1', 'Option 2'];
      }
    }

    try {
      if (editingQuestion.id === null || String(editingQuestion.id).startsWith('custom-')) {
        const res = await createFeedbackQuestion({
          category: cat,
          text: trimmedText,
          responseType: resType,
          options,
          isEnabled: editingQuestion.isEnabled !== undefined ? editingQuestion.isEnabled : true,
        });
        const created = res.question;
        setFeedbackQuestions((prev) => ({
          ...prev,
          [cat]: [...(prev[cat] || []), created],
        }));
        showSuccess('Question Created', `Feedback question added to ${cat}.`);
      } else {
        const res = await updateFeedbackQuestion(editingQuestion.id, {
          category: cat,
          text: trimmedText,
          responseType: resType,
          options,
          isEnabled: editingQuestion.isEnabled !== undefined ? editingQuestion.isEnabled : true,
        });
        const updated = res.question;
        setFeedbackQuestions((prev) => ({
          ...prev,
          [cat]: (prev[cat] || []).map((q) =>
            String(q.id) === String(editingQuestion.id) || String(q.id) === String(updated?.id) ? updated : q
          ),
        }));
        showSuccess('Question Updated', `Feedback question updated successfully.`);
      }
      setEditingQuestion(null);
      setFeedbackInlineError('');
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to save feedback question.';
      setFeedbackInlineError(msg);
      showError('Save Failed', msg);
    }
  };

  const handleRemoveFeedbackQuestion = (category, question) => {
    setFeedbackInlineError('');
    const questions = feedbackQuestions[category] || [];
    if (question.isEnabled) {
      const enabledCount = questions.filter((q) => q.isEnabled).length;
      if (enabledCount <= 1) {
        setFeedbackInlineError(`At least one question must stay enabled for ${category}.`);
        return;
      }
    }

    showConfirm(
      'Remove Question?',
      'This action will remove the question from future customer feedback forms. Historical responses tied to this question remain completely preserved.',
      async () => {
        closeNotif();
        try {
          await deleteFeedbackQuestion(question.id, category);
          setFeedbackQuestions((prev) => ({
            ...prev,
            [category]: (prev[category] || []).filter((q) => String(q.id) !== String(question.id)),
          }));
          showSuccess('Question Removed', 'Question removed successfully while historical answers remain preserved.');
        } catch (err) {
          const msg = err.response?.data?.message || 'Failed to remove question.';
          setFeedbackInlineError(msg);
          showError('Removal Blocked', msg);
        }
      },
      { confirmText: 'Remove', confirmClassName: 'bg-red-600 hover:bg-red-700' }
    );
  };

  const handleResetFeedback = () => {
    showConfirm(
      'Reset Questions to Defaults?',
      `This will restore all default questions for ${activeFeedbackCategory}. Any custom questions will be removed from future forms while historical responses remain preserved.`,
      async () => {
        closeNotif();
        try {
          const res = await resetFeedbackQuestions(activeFeedbackCategory);
          if (res.grouped) {
            setFeedbackQuestions(res.grouped);
          }
          setFeedbackInlineError('');
          showSuccess('Questions Reset', `Default questions restored for ${activeFeedbackCategory}.`);
        } catch (err) {
          const msg = err.response?.data?.message || 'Failed to reset questions.';
          setFeedbackInlineError(msg);
          showError('Reset Failed', msg);
        }
      },
      { confirmText: 'Reset', confirmClassName: 'bg-red-600 hover:bg-red-700' }
    );
  };

  /**
   * TS104: Toggle the per-category feedback form enabled/disabled state.
   * Disabling stops feedback collection for that category only (master toggle unaffected).
   * Historical feedback data and questions are always preserved regardless of this toggle.
   */
  const handleToggleCategoryFeedback = (cat) => {
    const currentlyEnabled = categoryFeedbackToggles[cat] !== false; // default true
    if (currentlyEnabled) {
      // Turning OFF — show confirmation explaining the impact
      showConfirm(
        `Disable Feedback for "${cat}"?`,
        `Customers with tickets in the "${cat}" category will no longer be prompted for feedback when this category is active. Existing questions and historical feedback data will remain preserved and visible in reports.`,
        async () => {
          closeNotif();
          setCategoryFeedbackToggles((prev) => ({ ...prev, [cat]: false }));
          try {
            await setCategoryFeedbackToggle(cat, false);
            showSuccess('Category Feedback Disabled', `Feedback form for "${cat}" has been disabled.`);
          } catch (err) {
            setCategoryFeedbackToggles((prev) => ({ ...prev, [cat]: true }));
            const msg = err.response?.data?.message || 'Failed to update category feedback state.';
            showError('Update Failed', msg);
          }
        },
        { confirmText: 'Disable', confirmClassName: 'bg-amber-600 hover:bg-amber-700', cancelText: 'Cancel' }
      );
    } else {
      // Turning ON — immediate, no confirmation needed
      setCategoryFeedbackToggles((prev) => ({ ...prev, [cat]: true }));
      setCategoryFeedbackToggle(cat, true)
        .then((res) => showSuccess('Category Feedback Enabled', res.message || `Feedback form for "${cat}" has been enabled.`))
        .catch((err) => {
          setCategoryFeedbackToggles((prev) => ({ ...prev, [cat]: false }));
          const msg = err.response?.data?.message || 'Failed to enable category feedback.';
          showError('Update Failed', msg);
        });
    }
  };

  // Email Delivery Configuration Handlers
  const handleAddEmailConfig = () => {
    const errors = {};
    if (!newEmailConfig.apiKey || !newEmailConfig.apiKey.trim()) {
      errors.apiKey = 'API Key is required and cannot be null or empty.';
    } else if (!newEmailConfig.apiKey.trim().startsWith('re_')) {
      errors.apiKey = 'Resend API Key must start with "re_".';
    } else if (newEmailConfig.apiKey.trim().length < 8) {
      errors.apiKey = 'API Key must be at least 8 characters.';
    }

    if (!newEmailConfig.fromName || !newEmailConfig.fromName.trim()) {
      errors.fromName = 'From Name is required and cannot be null or empty.';
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!newEmailConfig.fromEmail || !newEmailConfig.fromEmail.trim()) {
      errors.fromEmail = 'From Email is required and cannot be null or empty.';
    } else if (!emailRegex.test(newEmailConfig.fromEmail.trim())) {
      errors.fromEmail = 'Please provide a valid sender email address.';
    }

    if (Object.keys(errors).length > 0) {
      setNewEmailConfigErrors(errors);
      return;
    }

    setNewEmailConfigErrors({});
    showConfirm(
      'Save Email Configuration?',
      'Once you save, you cannot see the API key again. It will be permanently masked for security. Are you sure you want to proceed?',
      async () => {
        closeNotif();
        try {
          const res = await saveEmailConfiguration({
            apiKey: newEmailConfig.apiKey.trim(),
            fromName: newEmailConfig.fromName.trim(),
            fromEmail: newEmailConfig.fromEmail.trim(),
          });
          const configData = res?.data || res;
          setEmailConfig({
            ...configData,
            isConfigured: true,
            is_configured: true,
            fromName: configData.fromName || configData.from_name || newEmailConfig.fromName.trim(),
            from_name: configData.fromName || configData.from_name || newEmailConfig.fromName.trim(),
            fromEmail: configData.fromEmail || configData.from_email || newEmailConfig.fromEmail.trim(),
            from_email: configData.fromEmail || configData.from_email || newEmailConfig.fromEmail.trim(),
            apiKey: configData.apiKey || configData.api_key || 're_•••••••••',
            api_key: configData.apiKey || configData.api_key || 're_•••••••••',
            lastTested: configData.lastTested || configData.last_tested || null,
            last_tested: configData.lastTested || configData.last_tested || null,
          });
          setIsAddingEmailConfig(false);
          setNewEmailConfig({ provider: 'Resend', apiKey: '', fromName: '', fromEmail: '' });
          showSuccess(
            'Email Configuration Saved',
            'Resend email delivery gateway has been verified and configured successfully.'
          );
        } catch (err) {
          const errMsg = err?.response?.data?.errors?.apiKey || err?.response?.data?.message || err?.message || 'Failed to verify and save email configuration.';
          setNewEmailConfigErrors((prev) => ({ ...prev, apiKey: errMsg }));
        }
      },
      {
        confirmText: 'Save Configuration',
        cancelText: 'Cancel',
        confirmClassName: 'bg-[#252578] hover:bg-[#1a1a5e]',
      }
    );
  };

  const handleOpenTestEmailFromAdd = () => {
    const errors = {};
    if (!newEmailConfig.apiKey || !newEmailConfig.apiKey.trim()) {
      errors.apiKey = 'API Key is required to send a test email.';
    }
    if (!newEmailConfig.fromName || !newEmailConfig.fromName.trim()) {
      errors.fromName = 'From Name is required to send a test email.';
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!newEmailConfig.fromEmail || !newEmailConfig.fromEmail.trim()) {
      errors.fromEmail = 'From Email is required to send a test email.';
    } else if (!emailRegex.test(newEmailConfig.fromEmail.trim())) {
      errors.fromEmail = 'Please provide a valid sender email address.';
    }

    if (Object.keys(errors).length > 0) {
      setNewEmailConfigErrors(errors);
      return;
    }

    setShowTestEmailModal(true);
  };

  const handleChangeApiKey = () => {
    if (!changeApiKeyInput || !changeApiKeyInput.trim()) {
      setChangeApiKeyError('API Key is required and cannot be null or empty.');
      return;
    }
    if (!changeApiKeyInput.trim().startsWith('re_')) {
      setChangeApiKeyError('Resend API Key must start with "re_".');
      return;
    }
    if (changeApiKeyInput.trim().length < 8) {
      setChangeApiKeyError('API Key must be at least 8 characters.');
      return;
    }

    showConfirm(
      'Change API Key?',
      'Once you save, you cannot see the API key again. It will be permanently masked for security. Are you sure you want to update the key?',
      async () => {
        closeNotif();
        try {
          const res = await updateEmailApiKey(changeApiKeyInput.trim());
          const configData = res?.data || res;
          setEmailConfig((prev) => ({
            ...(prev || {}),
            ...configData,
            isConfigured: true,
            is_configured: true,
            apiKey: 're_•••••••••',
            api_key: 're_•••••••••',
          }));
          setShowChangeApiKeyModal(false);
          setChangeApiKeyInput('');
          setChangeApiKeyError(null);
          showSuccess('API Key Updated', 'Resend API key has been verified and changed successfully.');
        } catch (err) {
          const errMsg = err?.response?.data?.errors?.apiKey || err?.response?.data?.message || err?.message || 'Failed to verify new API key with Resend.';
          setChangeApiKeyError(errMsg);
        }
      },
      {
        confirmText: 'Update API Key',
        cancelText: 'Cancel',
        confirmClassName: 'bg-[#252578] hover:bg-[#1a1a5e]',
      }
    );
  };

  const handleSaveEmailConfig = async () => {
    if (!emailConfig) return;
    const errors = {};
    const currentFromName = emailConfig.fromName || emailConfig.from_name || '';
    const currentFromEmail = emailConfig.fromEmail || emailConfig.from_email || '';

    if (!currentFromName.trim()) {
      errors.fromName = 'From Name is required and cannot be null or empty.';
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!currentFromEmail.trim()) {
      errors.fromEmail = 'From Email is required and cannot be null or empty.';
    } else if (!emailRegex.test(currentFromEmail.trim())) {
      errors.fromEmail = 'Please provide a valid sender email address.';
    }

    if (Object.keys(errors).length > 0) {
      setEmailConfigErrors(errors);
      return;
    }

    setEmailConfigErrors({});
    try {
      const res = await updateEmailConfiguration({
        fromName: currentFromName.trim(),
        fromEmail: currentFromEmail.trim(),
      });
      const configData = res?.data || res;
      setEmailConfig({
        ...configData,
        isConfigured: true,
        is_configured: true,
        fromName: configData.fromName || configData.from_name || currentFromName.trim(),
        from_name: configData.fromName || configData.from_name || currentFromName.trim(),
        fromEmail: configData.fromEmail || configData.from_email || currentFromEmail.trim(),
        from_email: configData.fromEmail || configData.from_email || currentFromEmail.trim(),
        apiKey: configData.apiKey || configData.api_key || 're_•••••••••',
        api_key: configData.apiKey || configData.api_key || 're_•••••••••',
      });
      showSuccess(
        'Email Configuration Saved',
        'Transactional email sender settings for Resend have been updated successfully.'
      );
    } catch (err) {
      const errMsg = err?.response?.data?.message || err?.message || 'Failed to update email configuration.';
      setEmailConfigErrors({ fromEmail: errMsg });
    }
  };

  const handleRemoveEmailConfig = () => {
    showConfirm(
      'Remove Email Configuration?',
      'Are you sure you want to remove the Resend email configuration? Email alerts will be suspended until a new configuration is added.',
      async () => {
        closeNotif();
        try {
          await removeEmailConfiguration();
        } catch {
          // ignore
        }
        setEmailConfig(null);
        setEmailConfigErrors({});
        setIsAddingEmailConfig(false);
        showSuccess('Configuration Removed', 'Email configuration has been removed successfully.');
      },
      {
        confirmText: 'Remove Configuration',
        confirmClassName: 'bg-red-600 hover:bg-red-700',
      }
    );
  };

  const handleTestEmail = async () => {
    const configToUse = emailConfig || (newEmailConfig.apiKey ? newEmailConfig : null);
    if (!configToUse || (!configToUse.apiKey && !emailConfig)) {
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!testEmailRecipient || !emailRegex.test(testEmailRecipient.trim())) {
      setEmailConfigErrors((prev) => ({ ...prev, testEmail: 'Please enter a valid recipient email address.' }));
      return;
    }

    setIsTestingEmail(true);
    setEmailConfigErrors((prev) => {
      const next = { ...prev };
      delete next.testEmail;
      return next;
    });

    try {
      const isUnsaved = !emailConfig && Boolean(newEmailConfig.apiKey);
      const res = await sendTestEmail({
        recipientEmail: testEmailRecipient.trim(),
        apiKey: isUnsaved ? newEmailConfig.apiKey.trim() : null,
        fromName: isUnsaved ? newEmailConfig.fromName.trim() : null,
        fromEmail: isUnsaved ? newEmailConfig.fromEmail.trim() : null,
      });

      setIsTestingEmail(false);
      setShowTestEmailModal(false);
      if (emailConfig && res.last_tested) {
        setEmailConfig((prev) => prev ? { ...prev, lastTested: res.last_tested, last_tested: res.last_tested } : prev);
      }
      showSuccess(
        'Test Email Sent',
        res.message || `A test verification email was successfully delivered to ${testEmailRecipient} via Resend.`
      );
    } catch (err) {
      setIsTestingEmail(false);
      const errMsg = err?.response?.data?.error || err?.response?.data?.message || err?.message || 'Failed to dispatch test email through Resend.';
      setEmailConfigErrors((prev) => ({ ...prev, testEmail: errMsg }));
    }
  };

  // ==========================================
  // TS092: Branch-Specific Priority Levels & SLA Overrides Handlers
  // ==========================================

  const BRANCH_SLA_POLICY_FALLBACK = {
    mode: 'new_tickets_only',
    recalculatesExistingOpenTickets: false,
    tooltip: 'Changes to a branch SLA apply to tickets created after the change. Existing open tickets keep the response and resolution deadlines they were created with.',
  };

  const branchSlaPolicy = branchPriorityData[activeBranchKey]?.slaChangePolicy || BRANCH_SLA_POLICY_FALLBACK;

  // Always read from the API so the UI is correct immediately after a reload.
  const loadBranchPriorities = useCallback(async () => {
    const branchId = activeBranchKey;
    try {
      const data = await getBranchPriorities(branchId);
      setBranchPriorityData((prev) => ({ ...prev, [branchId]: data }));
    } catch (err) {
      console.error('Failed to load branch priorities:', err);
    } finally {
      setBranchPriorityLoading(false);
    }
  }, [activeBranchKey]);

  useEffect(() => {
    setBranchPriorityLoading(true);
    loadBranchPriorities();
  }, [loadBranchPriorities]);

  // Live updates from other admins/tabs via the event bus (poll is only a safety net)
  useRealtimeRefresh({
    refresh: loadBranchPriorities,
    channels: [{ name: 'ticket-updates', event: 'branch.priority.changed' }],
    intervalMs: 30000,
  });

  const currentBranchOverrides = useMemo(
    () => branchPriorityData[activeBranchKey]?.priorities || [],
    [branchPriorityData, activeBranchKey]
  );

  const applyBranchPriorityResponse = (data) => {
    if (data?.priorities) {
      setBranchPriorityData((prev) => ({
        ...prev,
        [activeBranchKey]: {
          branch: data.branch,
          priorities: data.priorities,
          slaChangePolicy: data.slaChangePolicy || prev[activeBranchKey]?.slaChangePolicy,
        },
      }));
    }
  };

  const handleOpenBranchOverrideModal = (override) => {
    if (isGlobalBranchScope) {
      showError(
        'Branch Selection Required',
        'Priority SLA overrides apply to individual physical branches. Please select an operational branch (Main Office, North Luzon Hub, Cebu City Office) from the selector above to set an override.'
      );
      return;
    }
    setBranchOverrideError(null);
    setBranchModalErrors({});
    setEditingBranchOverride({
      overrideId: override.id,
      priorityName: override.name,
      basePriorityId: override.basePriorityId,
      responseTimeLimit: String(override.responseTimeLimit),
      resolutionTimeLimit: String(override.resolutionTimeLimit),
      isNew: override.isInherited,
      color: override.color,
      systemDefault: override.systemDefault,
      inUse: override.inUse,
      activeTicketCount: override.activeTicketCount,
    });
  };

  const handleSaveBranchOverrideConfirmed = async (editing, resp, res) => {
    setBranchPrioritySaving(true);
    try {
      const payload = {
        name: editing.priorityName,
        color: editing.color || null,
        response_time_limit: resp,
        resolution_time_limit: res,
      };
      const data = editing.isNew
        ? await createBranchPriority(activeBranchKey, { ...payload, base_priority_id: editing.basePriorityId })
        : await updateBranchPriority(activeBranchKey, editing.overrideId, payload);

      applyBranchPriorityResponse(data);
      setEditingBranchOverride(null);
      showSuccess(
        editing.isNew ? 'Override Created' : 'Override Updated',
        `${editing.priorityName} Priority SLA override for ${activeBranchName} set to ${formatMinutes(resp)} response / ${formatMinutes(res)} resolution. ${branchSlaPolicy.tooltip}`
      );
    } catch (err) {
      const body = err.response?.data;
      if (body?.errors) {
        setBranchModalErrors({
          responseTimeLimit: body.errors.response_time_limit?.[0],
          resolutionTimeLimit: body.errors.resolution_time_limit?.[0] || body.errors.name?.[0] || body.errors.color?.[0],
        });
      } else {
        showError('Could not save override', body?.message || 'Something went wrong. Please try again.');
      }
      // Re-sync in case another admin changed this record (409 / 404)
      if (err.response?.status === 404 || err.response?.status === 409) {
        loadBranchPriorities();
      }
    } finally {
      setBranchPrioritySaving(false);
    }
  };

  const handleSaveBranchOverride = () => {
    if (!editingBranchOverride || branchPrioritySaving) return;

    const resp = parseInt(editingBranchOverride.responseTimeLimit, 10);
    const res = parseInt(editingBranchOverride.resolutionTimeLimit, 10);
    const errs = {};

    if (isNaN(resp) || resp <= 0) {
      errs.responseTimeLimit = 'Please enter a valid response time limit (greater than 0 minutes).';
    }
    if (isNaN(res) || res <= 0) {
      errs.resolutionTimeLimit = 'Please enter a valid resolution time limit (greater than 0 minutes).';
    } else if (!isNaN(resp) && res <= resp) {
      errs.resolutionTimeLimit = 'Resolution time limit must be greater than response time limit.';
    }

    if (Object.keys(errs).length > 0) {
      setBranchModalErrors(errs);
      return;
    }

    setBranchModalErrors({});
    const editing = editingBranchOverride;

    // First-time creation for a given priority in this branch: no confirmation modal
    if (editing.isNew) {
      handleSaveBranchOverrideConfirmed(editing, resp, res);
      return;
    }

    // Editing an existing override's SLA values: confirmation modal (new tickets only, per server policy)
    showConfirm(
      'Confirm SLA Modification',
      branchSlaPolicy.tooltip,
      () => {
        closeNotif();
        handleSaveBranchOverrideConfirmed(editing, resp, res);
      },
      {
        confirmText: 'Confirm & Save',
        confirmClassName: 'bg-[#252578] hover:bg-[#1f1f60]',
        cancelText: 'Cancel',
      }
    );
  };

  const handleRemoveBranchOverride = (override) => {
    setBranchOverrideError(null);

    // Fast client-side hint; the server enforces this check authoritatively.
    if (override.inUse || (override.referencedTicketCount && override.referencedTicketCount > 0)) {
      setBranchOverrideError({
        priorityName: override.name,
        message: `This priority level is currently referenced by ${override.referencedTicketCount || override.activeTicketCount || 1} ticket(s) in this branch and cannot be removed.`,
      });
      return;
    }

    showConfirm(
      `Remove ${override.name} Override?`,
      `Are you sure you want to remove the custom SLA override for ${override.name} Priority at ${activeBranchName}? It will revert to the system-wide default SLA for new tickets.`,
      async () => {
        closeNotif();
        try {
          const data = await deleteBranchPriority(activeBranchKey, override.id);
          applyBranchPriorityResponse(data);
          showSuccess(
            'Override Removed',
            `${override.name} Priority has been reverted to the system-wide default for ${activeBranchName}.`
          );
        } catch (err) {
          const body = err.response?.data;
          if (err.response?.status === 409) {
            setBranchOverrideError({
              priorityName: override.name,
              message: body?.message || 'This priority level is referenced by tickets in this branch and cannot be removed.',
            });
          } else {
            showError('Could not remove override', body?.message || 'Something went wrong. Please try again.');
          }
          loadBranchPriorities();
        }
      },
      {
        confirmText: 'Remove Override',
        confirmClassName: 'bg-red-600 hover:bg-red-700',
        cancelText: 'Cancel',
      }
    );
  };

  // ==========================================
  // TS090: Branch-Specific Ticket Categories & SLA Policies Handlers
  // ==========================================

  const loadBranchCategoriesAndSla = useCallback(async () => {
    const branchId = activeBranchKey;
    try {
      const data = await getBranchCategoriesAndSla(branchId);
      setBranchCategoryData((prev) => ({ ...prev, [branchId]: data }));
    } catch (err) {
      console.error('Failed to load branch categories and SLA policies:', err);
    } finally {
      setBranchCategoryLoading(false);
    }
  }, [activeBranchKey]);

  useEffect(() => {
    setBranchCategoryLoading(true);
    loadBranchCategoriesAndSla();
  }, [loadBranchCategoriesAndSla]);

  useRealtimeRefresh({
    refresh: loadBranchCategoriesAndSla,
    channels: [
      { name: 'ticket-updates', event: 'branch.category.changed' },
      { name: 'ticket-updates', event: 'branch.sla_policy.changed' },
    ],
    intervalMs: 30000,
  });

  // Active branch categories (system defaults + branch-added categories) from backend
  const currentBranchCategories = useMemo(() => {
    return branchCategoryData[activeBranchKey]?.categories || [];
  }, [branchCategoryData, activeBranchKey]);

  // Computed Category x Priority SLA matrix for active branch from backend
  const currentBranchSlaMatrix = useMemo(() => {
    const policies = branchCategoryData[activeBranchKey]?.slaPolicies || [];
    const colorMap = {
      Critical: 'bg-red-100 text-red-700',
      High: 'bg-orange-100 text-orange-700',
      Medium: 'bg-yellow-100 text-yellow-700',
      Low: 'bg-green-100 text-green-700',
    };
    return policies.map((p) => ({
      id: p.id,
      key: p.key,
      branchId: p.branchId,
      categoryId: p.categoryId,
      categoryName: p.categoryName,
      priorityName: p.priority,
      isOverride: p.isOverride,
      isInherited: !p.isOverride,
      resolutionTimeLimit: p.resolutionTimeLimit,
      responseTimeLimit: p.responseTimeLimit,
      systemDefaultResolution: p.systemDefaultResolution,
      sysDefaultResponse: p.systemDefaultResponse,
      priorityColor: colorMap[p.priority] || 'bg-gray-100 text-gray-700',
    }));
  }, [branchCategoryData, activeBranchKey]);

  const branchCatSlaPolicy = useMemo(() => {
    return branchCategoryData[activeBranchKey]?.slaChangePolicy || {
      mode: 'new_tickets_only',
      recalculatesExistingOpenTickets: false,
      tooltip: 'Changes to branch category SLA policies apply to tickets created after the update. Existing open tickets retain the deadlines calculated at creation.',
    };
  }, [branchCategoryData, activeBranchKey]);

  // Open modal to add a new category for this branch
  const handleOpenAddCategoryModal = () => {
    if (isGlobalBranchScope) {
      showError(
        'Branch Selection Required',
        'Branch custom categories are scoped to an individual physical branch. Please select an operational branch (Main Office, North Luzon Hub, Cebu City Office) from the selector above to add a custom category.'
      );
      return;
    }
    setCategoryError(null);
    setCategoryModalError('');
    setEditingCategory({
      isNew: true,
      name: '',
      description: '',
    });
  };

  // Open modal to edit an existing custom category
  const handleOpenEditCategoryModal = (cat) => {
    setCategoryError(null);
    setCategoryModalError('');
    setEditingCategory({
      isNew: false,
      id: cat.id,
      name: cat.name,
      description: cat.description || '',
      originalName: cat.name,
    });
  };

  // Save new or edited category
  const handleSaveCategory = async () => {
    if (!editingCategory || branchCategorySaving) return;
    const trimmed = (editingCategory.name || '').trim();
    if (!trimmed) {
      setCategoryModalError('Please enter a category name.');
      return;
    }

    setCategoryModalError('');
    setBranchCategorySaving(true);
    try {
      if (editingCategory.isNew) {
        const res = await createBranchCategory(activeBranchKey, {
          category_name: trimmed,
          description: editingCategory.description || null,
        });
        showSuccess('Category Created', res.message || `Category "${trimmed}" created for ${activeBranchName}.`);
      } else {
        const res = await updateBranchCategory(activeBranchKey, editingCategory.id, {
          category_name: trimmed,
          description: editingCategory.description || null,
        });
        showSuccess('Category Updated', res.message || `Category "${trimmed}" updated.`);
      }
      setEditingCategory(null);
      await loadBranchCategoriesAndSla();
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to save category.';
      setCategoryModalError(msg);
    } finally {
      setBranchCategorySaving(false);
    }
  };

  // Remove a branch-specific category
  const handleRemoveCategory = (cat) => {
    setCategoryError(null);

    // Fast client-side hint; backend authoritatively enforces open ticket block
    if (cat.inUse || (cat.openTicketCount && cat.openTicketCount > 0)) {
      setCategoryError({
        categoryName: cat.name,
        message: `Cannot remove "${cat.name}": it is referenced by ${cat.openTicketCount || 1} active open ticket(s) in this branch. Resolve or reassign active tickets before deleting.`,
      });
      return;
    }

    showConfirm(
      `Remove "${cat.name}" Category?`,
      `Are you sure you want to remove the "${cat.name}" category from ${activeBranchName}? This action cannot be undone.`,
      async () => {
        closeNotif();
        try {
          const res = await deleteBranchCategory(activeBranchKey, cat.id);
          showSuccess('Category Removed', res.message || `Category "${cat.name}" removed.`);
          // Reload from the server (the list lives in branchCategoryData per branch).
          await loadBranchCategoriesAndSla();
        } catch (err) {
          const body = err.response?.data;
          if (err.response?.status === 409 || err.response?.status === 422) {
            setCategoryError({
              categoryName: cat.name,
              message: body?.message || `Cannot remove "${cat.name}": open tickets currently reference this category.`,
            });
          } else {
            showError('Could Not Remove Category', body?.message || 'Something went wrong. Please try again.');
          }
          loadBranchCategoriesAndSla();
        }
      },
      {
        confirmText: 'Remove Category',
        confirmClassName: 'bg-red-600 hover:bg-red-700',
        cancelText: 'Cancel',
      }
    );
  };

  // Open modal to set or edit an SLA policy
  const handleOpenSlaPolicyModal = (item) => {
    if (isGlobalBranchScope) {
      showError(
        'Branch Selection Required',
        'SLA policy overrides are branch specific. Please select an operational branch (Main Office, North Luzon Hub, Cebu City Office) from the selector above before setting an override.'
      );
      return;
    }
    setSlaPolicyModalError('');
    setEditingSlaPolicy({
      isNew: item.isInherited,
      categoryName: item.categoryName,
      priorityName: item.priorityName,
      priorityColor: item.priorityColor,
      resolutionTimeLimit: String(item.resolutionTimeLimit),
      originalResolutionTimeLimit: item.resolutionTimeLimit,
      sysDefaultResolution: item.sysDefaultResolution,
    });
  };

  // Confirmed save for an SLA policy
  const handleSaveSlaPolicyConfirmed = async (categoryName, priorityName, resolutionMinutes, isNew) => {
    setBranchCategorySaving(true);
    try {
      const res = await saveBranchSlaPolicy(activeBranchKey, {
        category_name: categoryName,
        priority: priorityName,
        resolution_time_limit: resolutionMinutes,
      });
      setEditingSlaPolicy(null);
      showSuccess(
        isNew ? 'SLA Policy Created' : 'SLA Policy Updated',
        res.message || `Resolution SLA for ${categoryName} (${priorityName} Priority) set to ${formatMinutes(resolutionMinutes)} at ${activeBranchName}. ${branchCatSlaPolicy.tooltip}`
      );
      await loadBranchCategoriesAndSla();
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to save SLA policy.';
      setSlaPolicyModalError(msg);
    } finally {
      setBranchCategorySaving(false);
    }
  };

  // Save SLA Policy handler
  const handleSaveSlaPolicy = () => {
    if (!editingSlaPolicy) return;

    const resMinutes = parseInt(editingSlaPolicy.resolutionTimeLimit, 10);
    if (isNaN(resMinutes) || resMinutes <= 0) {
      setSlaPolicyModalError('Please enter a valid resolution time limit (greater than 0 minutes).');
      return;
    }

    setSlaPolicyModalError('');

    // Creating a new SLA policy for a category/priority combo for the first time: no confirmation modal
    if (editingSlaPolicy.isNew) {
      handleSaveSlaPolicyConfirmed(
        editingSlaPolicy.categoryName,
        editingSlaPolicy.priorityName,
        resMinutes,
        true
      );
      return;
    }

    // Editing an existing SLA policy's resolution time: confirmation modal with explicit tooltip
    showConfirm(
      'Confirm SLA Policy Modification',
      branchCatSlaPolicy.tooltip,
      () => {
        closeNotif();
        handleSaveSlaPolicyConfirmed(
          editingSlaPolicy.categoryName,
          editingSlaPolicy.priorityName,
          resMinutes,
          false
        );
      },
      {
        confirmText: 'Confirm & Save',
        confirmClassName: 'bg-[#252578] hover:bg-[#1f1f60]',
        cancelText: 'Cancel',
      }
    );
  };

  // Revert SLA policy override back to system-wide default
  const handleRemoveSlaPolicy = (item) => {
    showConfirm(
      `Revert SLA for ${item.categoryName} (${item.priorityName})?`,
      `Are you sure you want to revert the resolution SLA for ${item.categoryName} (${item.priorityName} Priority) to the system-wide default (${formatMinutes(item.sysDefaultResolution)}) for ${activeBranchName}?`,
      async () => {
        closeNotif();
        try {
          const res = await deleteBranchSlaPolicy(activeBranchKey, {
            category_name: item.categoryName,
            priority: item.priorityName,
          });
          showSuccess(
            'SLA Policy Reverted',
            res.message || `Resolution SLA for ${item.categoryName} (${item.priorityName}) reverted to system default.`
          );
          await loadBranchCategoriesAndSla();
        } catch (err) {
          const msg = err.response?.data?.message || err.message || 'Failed to revert SLA policy.';
          showError('Revert Failed', msg);
          loadBranchCategoriesAndSla();
        }
      },
      {
        confirmText: 'Revert to Default',
        confirmClassName: 'bg-red-600 hover:bg-red-700',
        cancelText: 'Cancel',
      }
    );
  };

  // Reset categories and SLA policies to seeded defaults
  const handleResetBranchCategories = () => {
    if (isGlobalBranchScope) {
      showError(
        'Branch Selection Required',
        'Cannot reset global system defaults. Choose an operational branch from the selector above to reset its custom categories and SLA overrides.'
      );
      return;
    }
    showConfirm(
      'Reset Branch Categories & SLAs?',
      `Are you sure you want to reset all custom categories and SLA policies for ${activeBranchName} to the system defaults?`,
      async () => {
        closeNotif();
        setCategoryError(null);
        try {
          const res = await resetBranchCategoriesToDefaults(activeBranchKey);
          showSuccess('Reset Complete', res.message || `Categories and SLA policies for ${activeBranchName} restored to system defaults.`);
          await loadBranchCategoriesAndSla();
        } catch (err) {
          const msg = err.response?.data?.message || err.message || 'Failed to reset branch configuration.';
          showError('Reset Failed', msg);
        }
      },
      {
        confirmText: 'Reset Defaults',
        confirmClassName: 'bg-red-600 hover:bg-red-700',
        cancelText: 'Cancel',
      }
    );
  };

  return (
    <div className="flex flex-col gap-6 max-w-[1440px] mx-auto w-full">
      {/* Interactive Hierarchical Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-xs text-slate-muted">
        <button
          type="button"
          onClick={() => handleSelectGroup(GROUP_CLASSIFICATION)}
          className="hover:text-primary hover:underline cursor-pointer font-medium transition-colors"
        >
          Ticket Configuration
        </button>
        <ChevronRight size={13} className="text-slate-300 shrink-0" />
        <button
          type="button"
          onClick={() => handleSelectGroup(currentGroup.id)}
          className="hover:text-primary hover:underline cursor-pointer font-medium transition-colors"
        >
          {currentGroup.label}
        </button>
        <ChevronRight size={13} className="text-slate-300 shrink-0" />
        <span className="text-slate-dark font-semibold cursor-default select-none" aria-current="page">
          {currentGroup.subTabs.find((s) => s.id === currentSubTab)?.label || currentSubTab}
        </span>
      </nav>

      <PageHeader
        pattern="B"
        title="Ticket Configuration"
        subtitle="Configure ticket classification, lifecycle state machines, service level agreements, and system policies."
      />

      {/* Level 1: 5 Group Pills (Centered & Fully Responsive) */}
      <div className="flex gap-1.5 rounded-xl bg-slate-100 p-1.5 w-full sm:w-fit flex-wrap shadow-2xs">
        {GROUPS_CONFIG.map((group) => {
          const isActive = activeGroup === group.id;
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => handleSelectGroup(group.id)}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${isActive
                  ? 'bg-white text-[#252578] shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
                }`}
            >
              {group.label}
            </button>
          );
        })}
      </div>

      {/* Level 2 & 3: Centered Master-Detail Workspace (Facebook Settings style) */}
      <div className="flex flex-col lg:flex-row gap-6 items-start w-full">
        {/* Left: Facebook Settings Vertical Sub-Category List */}
        <aside className="w-full lg:w-80 shrink-0 lg:sticky lg:top-24" aria-label={`${currentGroup.label} Subcategories`}>
          <div className="rounded-2xl border border-gray-200/80 bg-white p-3 shadow-xs">
            <div className="px-3 py-2.5 mb-2 border-b border-gray-100 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  Settings Menu
                </span>
                <h2 className="text-sm font-bold text-gray-800">
                  {currentGroup.label}
                </h2>
              </div>
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-[#252578] border border-blue-100">
                {currentGroup.subTabs.length} items
              </span>
            </div>

            <nav className="flex flex-col gap-1.5 max-h-64 sm:max-h-80 lg:max-h-[calc(100vh-170px)] overflow-y-auto [scrollbar-width:thin]" aria-label={`${currentGroup.label} Subcategories`}>
              {currentGroup.subTabs.map((sub) => {
                const isSubActive = currentSubTab === sub.id;
                const meta = SUBTAB_METADATA[sub.id] || { icon: Settings, subtitle: '' };
                const IconComponent = meta.icon || Settings;

                return (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => handleSelectSubTab(sub.id)}
                    className={`group flex items-center gap-3 w-full p-2.5 rounded-xl text-left transition-all cursor-pointer ${
                      isSubActive
                        ? 'bg-[#252578]/5 border-l-4 border-[#252578] shadow-xs text-[#252578]'
                        : 'text-gray-700 hover:bg-gray-50 hover:text-gray-900 border-l-4 border-transparent'
                    }`}
                  >
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                        isSubActive
                          ? 'bg-[#252578] text-white shadow-xs'
                          : 'bg-gray-100 text-gray-500 group-hover:bg-gray-200 group-hover:text-gray-700'
                      }`}
                    >
                      <IconComponent size={18} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-semibold truncate ${isSubActive ? 'text-[#252578]' : 'text-gray-800'}`}>
                        {sub.label}
                      </div>
                      {meta.subtitle && (
                        <div className="text-[11px] text-gray-400 truncate mt-0.5">
                          {meta.subtitle}
                        </div>
                      )}
                    </div>

                    <ChevronRight
                      size={15}
                      className={`shrink-0 transition-transform group-hover:translate-x-0.5 ${
                        isSubActive ? 'text-[#252578]' : 'text-gray-300 group-hover:text-gray-400'
                      }`}
                    />
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* Right: Tab Content Area */}
        <div
          ref={tabContentRef}
          key={`${activeGroup}-${currentSubTab}-${branchSubSection}`}
          className="flex-1 min-w-0 w-full animate-fade-slide-in flex flex-col gap-6 scroll-mt-36"
        >
        {loading ? (
          <TicketConfigTabSkeleton currentSubTab={currentSubTab} />
        ) : tab === TAB_WORKFLOW ? (
          <div className="flex flex-col gap-6">
          {/* Page Header */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg sm:text-xl font-bold text-gray-900">Workflow Status Sequence</h2>
              <p className="text-xs sm:text-sm text-gray-500 mt-0.5">Define progression stages and prerequisite guardrails tickets move through from submission to closure.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <button
                type="button"
                onClick={handleResetDefaultWorkflow}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 hover:text-[#252578] transition-all shrink-0 cursor-pointer shadow-xs"
              >
                <RotateCcw size={13} />
                <span>Reset to Defaults</span>
              </button>
              <button
                type="button"
                onClick={handleAddWorkflow}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#252578] px-3.5 py-2 text-xs font-semibold text-white transition-all hover:shadow-md shrink-0 cursor-pointer"
              >
                <Plus size={16} />
                <span>Add Status</span>
              </button>
            </div>
          </div>

          {/* Stepper / Sequence Diagram */}
          <div className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
            <div className="relative">
              {/* Background connecting line */}
              <div className="absolute top-7 left-[calc(7%+28px)] right-[calc(7%+28px)] h-0.5 bg-gray-200" />
              <div className="relative flex justify-between">
                {workflowStatuses.slice().sort((a, b) => a.order - b.order).map((status, idx) => (
                  <div key={status.id} className="flex flex-col items-center" style={{ flex: '1 1 0%' }}>
                    <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full font-semibold text-lg shadow-sm"
                      style={{ backgroundColor: status.bgColor, color: status.textColor }}>
                      {idx + 1}
                      {status.requiresPreviousFulfilled && (
                        <div className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white shadow-xs" title="Requires prerequisite completion">
                          <Lock size={10} />
                        </div>
                      )}
                    </div>
                    <span className="mt-2.5 text-sm font-semibold flex items-center gap-1 text-center" style={{ color: status.textColor }}>
                      {status.name}
                    </span>
                    <span className="mt-1 text-[11px] text-gray-500 text-center leading-tight px-1 max-w-[130px]">{status.description}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Status Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {workflowStatuses.slice().sort((a, b) => a.order - b.order).map((status, idx) => (
              <div key={status.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm flex items-start gap-4 hover:shadow-md transition-all">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-semibold text-sm"
                  style={{ backgroundColor: status.bgColor, color: status.textColor }}>
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-semibold text-gray-900">{status.name}</h4>
                      {status.isSystem ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 border border-blue-200">
                          <ShieldCheck size={10} />
                          System
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-700 border border-purple-200">
                          Custom
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleEditWorkflow(status)} className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors" title="Edit">
                        <Edit3 size={14} />
                      </button>
                      {status.isSystem ? (
                        <span className="rounded-full p-1.5 text-gray-300 cursor-not-allowed" title="System statuses cannot be deleted">
                          <Lock size={14} />
                        </span>
                      ) : (
                        <button onClick={() => handleDeleteWorkflow(status)} className="rounded-full p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors" title="Delete">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">{status.description}</p>
                  {status.requiresPreviousFulfilled && (
                    <div className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800 border border-amber-200/60 w-fit">
                      <Lock size={11} className="shrink-0 text-amber-600" />
                      <span>
                        {status.prerequisite ? `Requires "${status.prerequisite.name}" fulfilled` : 'Requires preceding status fulfilled'}
                      </span>
                    </div>
                  )}

                  {/* Connected Allowed Next Transitions Summary */}
                  {(() => {
                    const rule = transitionRules[status.name];
                    const allowedList = rule?.allowed || [];
                    return (
                      <div className="mt-3 pt-3 border-t border-gray-100 flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-gray-500">Allowed Transitions:</span>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedTransitionStatus(status.name);
                              handleSelectSubTab(TAB_TRANSITIONS);
                            }}
                            className="text-[#252578] font-semibold hover:underline inline-flex items-center gap-0.5 cursor-pointer text-[11px]"
                          >
                            <span>Matrix</span>
                            <ArrowRight size={10} />
                          </button>
                        </div>
                        {allowedList.length > 0 ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {allowedList.map((targetName) => {
                              const targetObj = activeWorkflowStatuses.find((s) => s.name === targetName);
                              return (
                                <span
                                  key={targetName}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border"
                                  style={{
                                    backgroundColor: targetObj?.bgColor || '#F3F4F6',
                                    color: targetObj?.textColor || '#4B5563',
                                    borderColor: 'rgba(0,0,0,0.08)',
                                  }}
                                >
                                  {targetName}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-[11px] text-gray-400 italic">No transitions permitted</span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            ))}
          </div>

          {/* Transition Matrix Connection Callout */}
          <div className="rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50/70 via-indigo-50/40 to-white p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#252578] text-white shadow-xs">
                <Sliders size={20} />
              </div>
              <div>
                <h4 className="text-sm font-bold text-gray-900">Synchronized with Transition Matrix</h4>
                <p className="text-xs text-gray-600 mt-0.5">
                  These {activeWorkflowStatuses.length} sequence stages directly power the Transition Matrix. Configure state changes, rollback paths, and prerequisite checks between each stage.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleSelectSubTab(TAB_TRANSITIONS)}
              className="inline-flex items-center gap-2 rounded-xl bg-[#252578] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#1e1e62] transition-all shrink-0 cursor-pointer shadow-xs"
            >
              <span>Open Transition Matrix</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      ) : tab === TAB_TRANSITIONS ? (
        <div className="flex flex-col gap-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-bold text-gray-900">Ticket Status Transition Matrix & Lifecycle Rules</h2>
                {hasTransitionChanges ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 border border-amber-200">
                    <AlertCircle size={12} className="shrink-0" />
                    <span>Unsaved Changes</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                    <CheckCircle2 size={12} className="shrink-0" />
                    <span>Active Rules Enforced</span>
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-gray-500 mt-1">
                Configure valid next-status transitions, sequence flows, and prerequisite guardrails connected to your active workflow.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <button
                type="button"
                onClick={handleResetTransitions}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 hover:text-[#252578] transition-all shrink-0 cursor-pointer shadow-xs"
              >
                <RotateCcw size={13} />
                <span>Reset to Defaults</span>
              </button>
              <button
                type="button"
                onClick={handleSaveTransitions}
                disabled={savingTransitions || !hasTransitionChanges}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition-all shrink-0 cursor-pointer ${
                  savingTransitions || !hasTransitionChanges
                    ? 'bg-[#252578]/60 cursor-not-allowed'
                    : 'bg-[#252578] hover:bg-[#1e1e62]'
                }`}
              >
                {savingTransitions ? (
                  <>
                    <RefreshCw size={13} className="animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Save size={13} />
                    <span>Save Changes</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Synchronized Sequence Notification Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50/60 p-4 shadow-2xs">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#252578] text-white">
                <Sliders size={18} />
              </div>
              <div>
                <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wide">
                  Ticket State Machine ({transitionStatuses.length} States Enforced)
                </h4>
                <p className="text-xs text-gray-600 mt-0.5">
                  These are the lifecycle states the ticket engine enforces. Saved rules apply immediately to every status change (assign, hold, resolve, close, escalate). A blocked change shows an "invalid transition" error to the user, and the Incoming queue only offers "Close Ticket" while Open → Closed is allowed. Every save is recorded in the Audit Logs.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleSelectSubTab(TAB_WORKFLOW)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 hover:text-[#252578] transition-all cursor-pointer shadow-xs shrink-0"
            >
              <Settings size={13} />
              <span>Edit Status Sequence</span>
            </button>
          </div>

          {/* Status Selector & Summary Card */}
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm flex flex-col gap-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              {/* Left Column: Status Picker */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Select Source Status
                </label>
                <div className="relative">
                  <select
                    value={selectedTransitionStatus}
                    onChange={(e) => setSelectedTransitionStatus(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-3 text-sm font-semibold text-gray-800 outline-none focus:bg-white focus:ring-2 focus:ring-[#252578] cursor-pointer appearance-none pr-10"
                  >
                    {transitionStatuses.map((st, idx) => (
                      <option key={st.id || st.name} value={st.name}>
                        Step {st.order || idx + 1}: {st.name} {st.isSystem ? '(System)' : '(Custom)'}
                      </option>
                    ))}
                  </select>
                  <ChevronRight size={18} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 rotate-90 pointer-events-none" />
                </div>
                <p className="text-xs text-gray-400">
                  Select a workflow status to configure which next stages tickets can transition into.
                </p>
              </div>

              {/* Right Column: Status Information Card */}
              {(() => {
                const currentStatusObj = transitionStatuses.find((s) => s.name === selectedTransitionStatus);
                const currentRule = transitionRules[selectedTransitionStatus];
                const currentOrder = Number(currentStatusObj?.order) || 1;

                return (
                  <div className="lg:col-span-2 rounded-xl border border-gray-100 bg-gray-50/60 p-5 flex flex-col gap-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="flex h-9 w-9 items-center justify-center rounded-xl font-bold text-sm shadow-2xs"
                          style={{
                            backgroundColor: currentStatusObj?.bgColor || '#DBEAFE',
                            color: currentStatusObj?.textColor || '#1D4ED8',
                          }}
                        >
                          {currentOrder}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-bold text-gray-900">{selectedTransitionStatus}</h3>
                            <span
                              className="px-2 py-0.5 rounded text-[10px] font-semibold"
                              style={{
                                backgroundColor: currentStatusObj?.bgColor || '#DBEAFE',
                                color: currentStatusObj?.textColor || '#1D4ED8',
                              }}
                            >
                              Step {currentOrder} of {transitionStatuses.length}
                            </span>
                            {currentStatusObj?.isSystem ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 border border-blue-200">
                                <ShieldCheck size={10} />
                                System
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-700 border border-purple-200">
                                Custom
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-gray-500">Source status in workflow sequence</span>
                        </div>
                      </div>

                      {/* Status Type Badge */}
                      {(() => {
                        if (!currentRule) return null;
                        if (currentRule.type === 'terminal') {
                          return (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 border border-red-200">
                              <Lock size={12} />
                              Terminal Status
                            </span>
                          );
                        }
                        if (currentRule.type === 'fixed') {
                          return (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 border border-blue-200">
                              <Lock size={12} />
                              Automated / Non-Editable
                            </span>
                          );
                        }
                        if (currentRule.type === 'contextual') {
                          return (
                            <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-3 py-1 text-xs font-semibold text-purple-700 border border-purple-200">
                              <Lock size={12} />
                              Contextual / Non-Editable
                            </span>
                          );
                        }
                        return (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700 border border-green-200">
                            <CheckCircle2 size={12} />
                            Configurable Transitions ({(currentRule.allowed || []).length} Allowed)
                          </span>
                        );
                      })()}
                    </div>

                    <p className="text-sm text-gray-600 leading-relaxed">
                      {currentStatusObj?.description || currentRule?.description || 'Active lifecycle stage.'}
                    </p>

                    {/* Prerequisite rule notification */}
                    {currentStatusObj?.requiresPreviousFulfilled && (
                      <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
                        <Lock size={15} className="text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-semibold">Prerequisite Guardrail Enforced: </span>
                          <span>
                            Tickets moving into "{selectedTransitionStatus}" require "{currentStatusObj.prerequisite?.name || 'the preceding stage'}" to be fulfilled first.
                          </span>
                        </div>
                      </div>
                    )}

                    {currentRule?.caption && (
                      <div className="flex items-start gap-2 rounded-lg bg-white border border-gray-200 p-3 text-xs text-gray-700">
                        <Info size={16} className="text-[#252578] shrink-0 mt-0.5" />
                        <span>{currentRule.caption}</span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Next Allowed Transitions Section */}
            <div className="border-t border-gray-100 pt-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
                    Permitted Next Transitions
                  </h4>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {transitionRules[selectedTransitionStatus]?.type === 'editable'
                      ? 'Select which statuses tickets are permitted to transition into from this source status.'
                      : 'Next transitions for this status are governed by system lifecycle rules.'}
                  </p>
                </div>
              </div>

              {/* Conditional Transition Rendering based on status type */}
              {(() => {
                const currentRule = transitionRules[selectedTransitionStatus] || { allowed: [], type: 'editable' };
                const currentStatusObj = transitionStatuses.find((s) => s.name === selectedTransitionStatus);
                const currentOrder = Number(currentStatusObj?.order) || 1;

                if (currentRule.type === 'terminal') {
                  return (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center flex flex-col items-center gap-2">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-200 text-gray-600 mb-1">
                        <Lock size={22} />
                      </div>
                      <h5 className="text-base font-semibold text-gray-800">Terminal Status</h5>
                      <p className="text-sm text-gray-500 max-w-md">
                        {currentRule.caption || 'This is a terminal status. No further transitions are permitted.'}
                      </p>
                      <div className="mt-2 text-xs text-gray-400">
                        (Next-status list is empty and disabled)
                      </div>
                    </div>
                  );
                }

                if (currentRule.type === 'fixed') {
                  return (
                    <div className="space-y-4">
                      <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 text-xs text-blue-900 flex items-start gap-2.5">
                        <Lock size={16} className="text-blue-600 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold">System-Enforced Automated Transition</p>
                          <p className="mt-0.5 text-blue-800 leading-relaxed">{currentRule.caption}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {(currentRule.allowed || []).map((targetStatus) => (
                          <div
                            key={targetStatus}
                            className="flex items-center justify-between rounded-xl border border-blue-200 bg-white p-4 shadow-xs"
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                checked={true}
                                disabled={true}
                                className="h-4 w-4 rounded border-gray-300 text-[#252578] opacity-70 cursor-not-allowed"
                              />
                              <div>
                                <span className="text-sm font-semibold text-gray-900">{targetStatus}</span>
                                <p className="text-xs text-blue-600 font-medium">Automatic target (read-only)</p>
                              </div>
                            </div>
                            <span className="flex items-center gap-1 text-xs text-gray-400">
                              <ArrowRight size={14} />
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }

                if (currentRule.type === 'contextual') {
                  return (
                    <div className="rounded-xl border border-purple-200 bg-purple-50/70 p-6 text-center flex flex-col items-center gap-2">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-100 text-purple-700 mb-1">
                        <RotateCcw size={22} />
                      </div>
                      <h5 className="text-base font-semibold text-purple-900">Contextual Resume Transition</h5>
                      <p className="text-sm text-purple-800 max-w-lg leading-relaxed">
                        {currentRule.caption}
                      </p>
                    </div>
                  );
                }

                // Dynamically list all other workflow statuses sorted by sequence order
                const otherStatuses = transitionStatuses.filter((s) => s.name !== selectedTransitionStatus);

                if (otherStatuses.length === 0) {
                  return (
                    <div className="p-8 text-center text-sm text-gray-500 bg-gray-50 rounded-xl border border-gray-200">
                      No other workflow statuses available. Add more statuses in the Statuses & Sequence tab.
                    </div>
                  );
                }

                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                    {otherStatuses.map((targetStatus) => {
                      const isChecked = (currentRule.allowed || []).includes(targetStatus.name);
                      const targetOrder = Number(targetStatus.order) || 1;
                      const isNextSequential = targetOrder === currentOrder + 1;
                      const isForward = targetOrder > currentOrder;
                      const isRollback = targetOrder < currentOrder;

                      return (
                        <label
                          key={targetStatus.id || targetStatus.name}
                          className={`flex items-start gap-3.5 rounded-xl border p-4 transition-all cursor-pointer select-none ${
                            isChecked
                              ? 'border-[#252578] bg-[#252578]/5 shadow-xs'
                              : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleTransition(targetStatus.name)}
                            className="mt-1 h-4 w-4 rounded border-gray-300 text-[#252578] focus:ring-[#252578] cursor-pointer"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1 flex-wrap">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold"
                                  style={{
                                    backgroundColor: targetStatus.bgColor || '#DBEAFE',
                                    color: targetStatus.textColor || '#1D4ED8',
                                  }}
                                >
                                  {targetOrder}
                                </span>
                                <span className={`text-sm font-semibold ${isChecked ? 'text-[#252578]' : 'text-gray-800'}`}>
                                  {targetStatus.name}
                                </span>
                              </div>
                              {isChecked && (
                                <span className="inline-block rounded-full bg-[#252578] px-2 py-0.5 text-[10px] font-semibold text-white uppercase tracking-wider shrink-0">
                                  Allowed
                                </span>
                              )}
                            </div>

                            {/* Sequence relationship indicator */}
                            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                              {isNextSequential && (
                                <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                                  <ArrowRight size={10} />
                                  Next in Sequence
                                </span>
                              )}
                              {isForward && !isNextSequential && (
                                <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 border border-blue-200">
                                  <ArrowRight size={10} />
                                  Forward (+{targetOrder - currentOrder} steps)
                                </span>
                              )}
                              {isRollback && (
                                <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-200">
                                  <RotateCcw size={10} />
                                  Rollback / Return
                                </span>
                              )}
                            </div>

                            {/* Prerequisite note */}
                            {targetStatus.requiresPreviousFulfilled && (
                              <div className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-700 font-medium">
                                <Lock size={10} className="shrink-0" />
                                <span className="truncate">
                                  Requires "{targetStatus.prerequisite?.name || 'preceding stage'}" first
                                </span>
                              </div>
                            )}

                            <div className="flex items-center gap-1 text-[11px] text-gray-500 mt-2">
                              <span>Step {currentOrder}</span>
                              <ArrowRight size={11} className="text-gray-400 shrink-0" />
                              <span className="font-medium text-gray-700 truncate">Step {targetOrder} ({targetStatus.name})</span>
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Interactive 2D Transition Matrix Grid Table */}
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm flex flex-col gap-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Table size={18} className="text-[#252578]" />
                  <h3 className="text-base font-bold text-gray-900">Complete Transition Matrix (2D View)</h3>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  Full overview of all source-to-target lifecycle paths. Click any cell to toggle whether a transition is allowed.
                </p>
              </div>

              {/* Matrix Stats */}
              {(() => {
                const totalPossible = transitionStatuses.length * (transitionStatuses.length - 1);
                let allowedCount = 0;
                transitionStatuses.forEach((source) => {
                  const allowed = transitionRules[source.name]?.allowed || [];
                  allowedCount += allowed.length;
                });

                return (
                  <div className="flex items-center gap-2 bg-gray-50 px-3.5 py-1.5 rounded-xl border border-gray-200 text-xs font-semibold text-gray-700 self-start sm:self-auto">
                    <CheckCircle2 size={14} className="text-emerald-600" />
                    <span>{allowedCount} of {totalPossible} Permitted Paths</span>
                  </div>
                );
              })()}
            </div>

            {/* Matrix Table */}
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="p-3 font-bold text-gray-700 min-w-[170px] sticky left-0 bg-gray-50 z-10 border-r border-gray-200 shadow-2xs">
                      From \ To Target
                    </th>
                    {transitionStatuses.map((colStatus, cIdx) => (
                      <th key={colStatus.id || colStatus.name} className="p-3 text-center min-w-[120px] font-semibold text-gray-700">
                        <div className="flex flex-col items-center gap-1">
                          <span
                            className="inline-flex items-center justify-center px-2 py-0.5 rounded text-[11px] font-bold"
                            style={{
                              backgroundColor: colStatus.bgColor || '#DBEAFE',
                              color: colStatus.textColor || '#1D4ED8',
                            }}
                          >
                            Step {colStatus.order || cIdx + 1}
                          </span>
                          <span className="text-xs font-semibold text-gray-900 truncate max-w-[110px]" title={colStatus.name}>
                            {colStatus.name}
                          </span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {transitionStatuses.map((rowStatus, rIdx) => {
                    const rowRule = transitionRules[rowStatus.name] || { allowed: [], type: 'editable' };
                    const isSelectedRow = rowStatus.name === selectedTransitionStatus;

                    return (
                      <tr
                        key={rowStatus.id || rowStatus.name}
                        className={`transition-colors ${isSelectedRow ? 'bg-indigo-50/40' : 'hover:bg-gray-50/60'}`}
                      >
                        {/* Source Status Row Header */}
                        <td className="p-3 font-semibold text-gray-900 sticky left-0 bg-white z-10 border-r border-gray-200 shadow-2xs">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span
                                className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold shrink-0"
                                style={{
                                  backgroundColor: rowStatus.bgColor || '#DBEAFE',
                                  color: rowStatus.textColor || '#1D4ED8',
                                }}
                              >
                                {rowStatus.order || rIdx + 1}
                              </span>
                              <span className="font-bold text-gray-900 text-xs truncate max-w-[100px]" title={rowStatus.name}>
                                {rowStatus.name}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setSelectedTransitionStatus(rowStatus.name)}
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer ${
                                isSelectedRow
                                  ? 'bg-[#252578] text-white'
                                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
                              }`}
                              title="Focus in single status editor above"
                            >
                              {isSelectedRow ? 'Active' : 'Edit'}
                            </button>
                          </div>
                        </td>

                        {/* Transition Cells */}
                        {transitionStatuses.map((colStatus) => {
                          const isSelf = rowStatus.name === colStatus.name;
                          const isAllowed = (rowRule.allowed || []).includes(colStatus.name);
                          const isEditable = rowRule.type === 'editable';

                          if (isSelf) {
                            return (
                              <td key={colStatus.name} className="p-2.5 text-center bg-gray-50/40">
                                <span className="text-gray-300 font-bold select-none">—</span>
                              </td>
                            );
                          }

                          return (
                            <td key={colStatus.name} className="p-2 text-center">
                              <button
                                type="button"
                                onClick={() => handleToggleMatrixTransition(rowStatus.name, colStatus.name)}
                                disabled={!isEditable}
                                className={`w-full py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-all inline-flex items-center justify-center gap-1 cursor-pointer ${
                                  isAllowed
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                                    : 'bg-gray-50 text-gray-400 border border-gray-200 hover:bg-gray-100 hover:text-gray-600'
                                } ${!isEditable ? 'opacity-50 cursor-not-allowed' : ''}`}
                                title={`${rowStatus.name} → ${colStatus.name}: Click to ${isAllowed ? 'disallow' : 'allow'}`}
                              >
                                {isAllowed ? (
                                  <>
                                    <Check size={12} className="text-emerald-600" />
                                    <span>Allowed</span>
                                  </>
                                ) : (
                                  <span>Blocked</span>
                                )}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : tab === TAB_FILES ? (
        <div className="flex flex-col gap-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-bold text-gray-900">File Upload & Security Limits</h2>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                  <CheckCircle2 size={12} className="shrink-0" />
                  <span>Active & Enforced</span>
                </span>
              </div>
              <p className="text-xs sm:text-sm text-gray-500 mt-1">
                Configure system-wide file upload constraints and malware scanning policies across ticket attachments, messages, and knowledge base articles.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <button
                type="button"
                onClick={handleResetFileConfig}
                disabled={fileConfigSaving}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 hover:text-[#252578] transition-all shrink-0 cursor-pointer shadow-xs disabled:opacity-50"
              >
                <RotateCcw size={13} />
                <span>Reset to Defaults</span>
              </button>
              <button
                type="button"
                onClick={handleSaveFileConfig}
                disabled={fileConfigSaving}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#252578] px-3.5 py-2 text-xs font-semibold text-white transition-all hover:shadow-md shrink-0 cursor-pointer disabled:opacity-50"
              >
                <Save size={13} />
                <span>{fileConfigSaving ? 'Saving...' : 'Save Settings'}</span>
              </button>
            </div>
          </div>

          {/* Non-Destructive Enforcement Callout */}
          <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
            <Info size={18} className="text-[#252578] shrink-0 mt-0.5" />
            <div className="text-xs text-gray-700 leading-relaxed">
              <span className="font-semibold text-gray-900">Non-Destructive Enforcement: </span>
              File upload limits and malware scanning rules strictly govern <strong>newly uploaded files</strong> on subsequent ticket interactions. Historical tickets and their existing attachments remain fully intact and unaltered.
            </div>
          </div>

          {/* Section 1: Upload Limits (Size & Count) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Max File Size */}
            <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    <HardDrive size={16} className="text-[#252578]" />
                    Max File Size per Upload (MB)
                  </label>
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Per File</span>
                </div>
                <p className="text-xs text-gray-500 mb-4 leading-relaxed">
                  Maximum permitted file size for any single uploaded attachment or document.
                </p>
                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={fileConfig.maxFileSizeMB}
                    onChange={(e) => handleMaxFileSizeChange(e.target.value)}
                    placeholder="e.g. 15"
                    className={`w-full rounded-xl border px-4 py-3 text-sm font-semibold outline-none transition-all ${fileConfigErrors.maxFileSizeMB
                        ? 'border-red-300 bg-red-50/50 text-red-900 focus:ring-2 focus:ring-red-400'
                        : 'border-gray-200 bg-gray-50/50 text-gray-900 focus:bg-white focus:ring-2 focus:ring-[#252578]'
                      }`}
                  />
                </div>
                {fileConfigErrors.maxFileSizeMB ? (
                  <p className="mt-2 text-xs font-medium text-red-600 flex items-center gap-1">
                    <AlertCircle size={13} /> {fileConfigErrors.maxFileSizeMB}
                  </p>
                ) : (
                  <p className="mt-2 text-xs font-medium text-[#252578] flex items-center gap-1 min-h-[18px]">
                    <Clock size={12} /> {formatFileSize(fileConfig.maxFileSizeMB)}
                  </p>
                )}
              </div>
              <div className="mt-4 pt-3 border-t border-gray-100 text-[11px] text-gray-400">
                System default: 15 MB. Files exceeding this size will be rejected prior to transfer.
              </div>
            </div>

            {/* Max File Count */}
            <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    <FileUp size={16} className="text-[#252578]" />
                    Max File Count per Upload
                  </label>
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Per Batch</span>
                </div>
                <p className="text-xs text-gray-500 mb-4 leading-relaxed">
                  Maximum number of files a user is allowed to upload in a single ticket or action.
                </p>
                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={fileConfig.maxFileCount}
                    onChange={(e) => handleMaxFileCountChange(e.target.value)}
                    placeholder="e.g. 5"
                    className={`w-full rounded-xl border px-4 py-3 text-sm font-semibold outline-none transition-all ${fileConfigErrors.maxFileCount
                        ? 'border-red-300 bg-red-50/50 text-red-900 focus:ring-2 focus:ring-red-400'
                        : 'border-gray-200 bg-gray-50/50 text-gray-900 focus:bg-white focus:ring-2 focus:ring-[#252578]'
                      }`}
                  />
                </div>
                {fileConfigErrors.maxFileCount ? (
                  <p className="mt-2 text-xs font-medium text-red-600 flex items-center gap-1">
                    <AlertCircle size={13} /> {fileConfigErrors.maxFileCount}
                  </p>
                ) : (
                  <p className="mt-2 text-xs font-medium text-[#252578] flex items-center gap-1 min-h-[18px]">
                    <CheckCircle2 size={12} /> {formatFileCount(fileConfig.maxFileCount)}
                  </p>
                )}
              </div>
              <div className="mt-4 pt-3 border-t border-gray-100 text-[11px] text-gray-400">
                System default: 5 files. Users cannot select more than this count in one file dialog.
              </div>
            </div>
          </div>

          {/* Section 2: Allowed File Types (Chip / Pill Multi-Select Grid) */}
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-4">
              <div>
                <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-[#252578]" />
                  Allowed File Types
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Select which file extensions are permitted across ticket attachments, messages, and knowledge base documents.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-[#252578]/5 px-3 py-1 text-xs font-semibold text-[#252578] border border-[#252578]/20">
                  {fileConfig.allowedFileTypes.length} of {TS098_AVAILABLE_EXTENSIONS.length} Types Allowed
                </span>
              </div>
            </div>

            {fileConfigErrors.allowedFileTypes && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex items-center gap-2">
                <AlertCircle size={15} className="shrink-0 text-red-600" />
                <span>{fileConfigErrors.allowedFileTypes}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5 pt-2">
              {TS098_AVAILABLE_EXTENSIONS.map((item) => {
                const isChecked = fileConfig.allowedFileTypes.includes(item.ext);
                return (
                  <button
                    key={item.ext}
                    type="button"
                    onClick={() => handleToggleFileType(item.ext)}
                    className={`flex items-center justify-between p-4 rounded-xl border text-left transition-all cursor-pointer select-none ${isChecked
                        ? 'border-[#252578] bg-[#252578]/5 shadow-xs ring-1 ring-[#252578]'
                        : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50 opacity-75'
                      }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-xl font-semibold text-xs transition-colors shrink-0 ${isChecked ? 'bg-[#252578] text-white' : 'bg-gray-100 text-gray-500'
                          }`}
                      >
                        {item.ext}
                      </div>
                      <div className="truncate">
                        <p className={`text-sm font-semibold truncate ${isChecked ? 'text-[#252578]' : 'text-gray-700'}`}>
                          {item.label}
                        </p>
                        <p className="text-[11px] text-gray-400 truncate mt-0.5">
                          {item.desc}
                        </p>
                      </div>
                    </div>

                    <div className="ml-3 shrink-0">
                      {isChecked ? (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#252578] text-white">
                          <Check size={12} strokeWidth={3} />
                        </span>
                      ) : (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 bg-white" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-2 text-xs text-gray-400 flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-gray-50">
              <span>Extensions correspond to MIME validation in TicketCreation, EmployeeTicketUpdate, and AIKnowledgeBase.</span>
              <span className="font-semibold text-gray-500">At least 1 format must remain enabled.</span>
            </div>
          </div>

          {/* Section 3: Malware & Antivirus Scanning */}
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-4">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-50 text-purple-700 border border-purple-100">
                  <ShieldCheck size={20} />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-gray-900">Malware & Antivirus Scanning</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    ClamAV antivirus daemon inspection for all inbound uploads before permanent storage.
                  </p>
                </div>
              </div>

              {/* Inline Architecture Notice Badge */}
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 border border-emerald-200/80 w-fit">
                <ShieldCheck size={13} className="text-emerald-600 shrink-0" />
                <span>Enforced via ClamAV Antivirus Daemon</span>
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 p-4 rounded-xl bg-gray-50/60 border border-gray-100">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-gray-900">ClamAV In-Stream Daemon Inspection</h4>
                  <div className="relative group inline-flex items-center">
                    <Info size={15} className="text-gray-400 hover:text-[#252578] cursor-pointer" />
                    <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden w-72 rounded-xl bg-gray-900 p-3 text-center text-xs text-white shadow-xl group-hover:block z-50 leading-relaxed">
                      Disabling malware scanning allows files to bypass virus checks before being stored. This is not recommended.
                      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                    </div>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed max-w-2xl">
                  Inspects all incoming file payloads using the containerized ClamAV daemon (`clamav:3310`) via `zINSTREAM`. Infected or unrecognized macro binaries are rejected with HTTP 422 before reaching the storage volume.
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {fileConfig.malwareScanningEnabled ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700 border border-green-200">
                    <ShieldCheck size={13} />
                    Active Scanning
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 border border-red-200">
                    <ShieldAlert size={13} />
                    Scanning Bypassed
                  </span>
                )}

                {/* iOS-style slider switch */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={fileConfig.malwareScanningEnabled}
                  onClick={handleToggleMalwareScanning}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#252578]/20 cursor-pointer ${fileConfig.malwareScanningEnabled ? 'bg-green-500' : 'bg-gray-300'
                    }`}
                  title={fileConfig.malwareScanningEnabled ? 'Click to disable scanning' : 'Click to enable scanning'}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${fileConfig.malwareScanningEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : tab === TAB_WINDOWS ? (
        <div className="flex flex-col gap-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-bold text-gray-900">Reopen & Auto-Close Windows</h2>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                  <CheckCircle2 size={12} className="shrink-0" />
                  <span>Active Operational Policy</span>
                </span>
              </div>
              <p className="text-xs sm:text-sm text-gray-500 mt-1">
                Configure time windows and operational policies for customer ticket reopening and automated closure of resolved tickets.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <button
                type="button"
                onClick={handleResetWindowConfig}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 hover:text-[#252578] transition-all shrink-0 cursor-pointer shadow-xs"
              >
                <RotateCcw size={13} />
                <span>Reset to Defaults</span>
              </button>
              <button
                type="button"
                onClick={handleSaveWindowConfig}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#252578] px-3.5 py-2 text-xs font-semibold text-white transition-all hover:shadow-md shrink-0 cursor-pointer"
              >
                <Save size={13} />
                <span>Save Settings</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Feature 1: Customer Ticket Reopen Window */}
            <div className={`rounded-2xl border bg-white p-6 shadow-sm flex flex-col justify-between transition-all ${windowConfig.reopenEnabled ? 'border-gray-100' : 'border-gray-200 bg-gray-50/40'
              }`}>
              <div>
                {/* Header with Switch */}
                <div className="flex items-start justify-between gap-4 pb-4 border-b border-gray-100">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-gray-900">Customer Reopen Window</h3>
                      <div className="relative group inline-flex items-center">
                        <Info size={15} className="text-gray-400 hover:text-[#252578] cursor-pointer" />
                        <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden w-72 rounded-xl bg-gray-900 p-3 text-center text-xs text-white shadow-xl group-hover:block z-50 leading-relaxed">
                          Disabling Reopen means all closed tickets are final and cannot be reopened by the customer.
                          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                      Allow customers to reopen recently closed tickets if their issue remains unresolved.
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {windowConfig.reopenEnabled ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700 border border-green-200">
                        <CheckCircle2 size={12} />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600 border border-gray-200">
                        <Lock size={12} />
                        Disabled
                      </span>
                    )}

                    {/* iOS-style slider switch */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={windowConfig.reopenEnabled}
                      onClick={handleToggleReopen}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#252578]/20 cursor-pointer ${windowConfig.reopenEnabled ? 'bg-green-500' : 'bg-gray-300'
                        }`}
                      title={windowConfig.reopenEnabled ? 'Click to disable reopen' : 'Click to enable reopen'}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${windowConfig.reopenEnabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Duration Input & Caption */}
                <div className="mt-5">
                  {windowConfig.reopenEnabled ? (
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider block">
                        Reopen Window Duration (Days)
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={windowConfig.reopenWindowDays}
                          onChange={(e) => handleReopenDaysChange(e.target.value)}
                          placeholder="e.g. 2"
                          className={`w-full rounded-xl border px-4 py-3 text-sm font-semibold outline-none transition-all ${windowConfigErrors.reopenWindowDays
                              ? 'border-red-300 bg-red-50/50 text-red-900 focus:ring-2 focus:ring-red-400'
                              : 'border-gray-200 bg-gray-50/50 text-gray-900 focus:bg-white focus:ring-2 focus:ring-[#252578]'
                            }`}
                        />
                      </div>

                      {windowConfigErrors.reopenWindowDays ? (
                        <p className="mt-2 text-xs font-medium text-red-600 flex items-center gap-1">
                          <AlertCircle size={13} /> {windowConfigErrors.reopenWindowDays}
                        </p>
                      ) : (
                        <p className="mt-2 text-xs font-medium text-[#252578] flex items-center gap-1 min-h-[18px]">
                          <Clock size={12} /> {formatWindowDays(windowConfig.reopenWindowDays, 'reopen')}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-500 flex items-start gap-2.5">
                      <Lock size={15} className="text-gray-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-gray-700">Reopen Disabled</p>
                        <p className="mt-0.5 text-gray-500 leading-relaxed">
                          All closed tickets are final. Customers cannot reopen tickets after closing; a new ticket must be submitted.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 pt-3 border-t border-gray-100 text-[11px] text-gray-400">
                System default: 2 days (48h). Once this window elapses, the reopen button in customer views is disabled.
              </div>
            </div>

            {/* Feature 2: Resolved Ticket Auto-Close Window */}
            <div className={`rounded-2xl border bg-white p-6 shadow-sm flex flex-col justify-between transition-all ${windowConfig.autoCloseEnabled ? 'border-gray-100' : 'border-gray-200 bg-gray-50/40'
              }`}>
              <div>
                {/* Header with Switch */}
                <div className="flex items-start justify-between gap-4 pb-4 border-b border-gray-100">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-gray-900">Auto-Close Resolved Tickets</h3>
                      <div className="relative group inline-flex items-center">
                        <Info size={15} className="text-gray-400 hover:text-[#252578] cursor-pointer" />
                        <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden w-72 rounded-xl bg-gray-900 p-3 text-center text-xs text-white shadow-xl group-hover:block z-50 leading-relaxed">
                          Disabling Auto-Close means Resolved tickets stay open indefinitely until the customer manually closes them.
                          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                      Automatically transition Resolved tickets to Closed after a configured period of inactivity.
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {windowConfig.autoCloseEnabled ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 border border-blue-200">
                        <Clock size={12} />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600 border border-gray-200">
                        <AlertCircle size={12} />
                        Disabled
                      </span>
                    )}

                    {/* iOS-style slider switch */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={windowConfig.autoCloseEnabled}
                      onClick={handleToggleAutoClose}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#252578]/20 cursor-pointer ${windowConfig.autoCloseEnabled ? 'bg-green-500' : 'bg-gray-300'
                        }`}
                      title={windowConfig.autoCloseEnabled ? 'Click to disable auto-close' : 'Click to enable auto-close'}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${windowConfig.autoCloseEnabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Duration Input & Caption */}
                <div className="mt-5">
                  {windowConfig.autoCloseEnabled ? (
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider block">
                        Auto-Close Window Duration (Days)
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={windowConfig.autoCloseWindowDays}
                          onChange={(e) => handleAutoCloseDaysChange(e.target.value)}
                          placeholder="e.g. 2"
                          className={`w-full rounded-xl border px-4 py-3 text-sm font-semibold outline-none transition-all ${windowConfigErrors.autoCloseWindowDays
                              ? 'border-red-300 bg-red-50/50 text-red-900 focus:ring-2 focus:ring-red-400'
                              : 'border-gray-200 bg-gray-50/50 text-gray-900 focus:bg-white focus:ring-2 focus:ring-[#252578]'
                            }`}
                        />
                      </div>

                      {windowConfigErrors.autoCloseWindowDays ? (
                        <p className="mt-2 text-xs font-medium text-red-600 flex items-center gap-1">
                          <AlertCircle size={13} /> {windowConfigErrors.autoCloseWindowDays}
                        </p>
                      ) : (
                        <p className="mt-2 text-xs font-medium text-[#252578] flex items-center gap-1 min-h-[18px]">
                          <CheckCircle2 size={12} /> {formatWindowDays(windowConfig.autoCloseWindowDays, 'autoclose')}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-500 flex items-start gap-2.5">
                      <AlertCircle size={15} className="text-gray-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-gray-700">Auto-Close Disabled</p>
                        <p className="mt-0.5 text-gray-500 leading-relaxed">
                          Resolved tickets will remain in Resolved status indefinitely until explicitly confirmed or closed by the customer or staff.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 pt-3 border-t border-gray-100 text-[11px] text-gray-400">
                System default: 2 days (48h). Processed by the scheduled backend worker (`tickets:auto-close-internal`).
              </div>
            </div>

            {/* Feature 3: Archive Message Thread on Closure (TS067) */}
            <div className={`rounded-2xl border bg-white p-6 shadow-sm flex flex-col justify-between transition-all ${windowConfig.archiveOnClosureEnabled ? 'border-gray-100' : 'border-gray-200 bg-gray-50/40'
              }`}>
              <div>
                {/* Header with Switch */}
                <div className="flex items-start justify-between gap-4 pb-4 border-b border-gray-100">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-gray-900">Archive Message Thread on Closure</h3>
                      <div className="relative group inline-flex items-center">
                        <Info size={15} className="text-gray-400 hover:text-[#252578] cursor-pointer" />
                        <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden w-72 rounded-xl bg-gray-900 p-3 text-center text-xs text-white shadow-xl group-hover:block z-50 leading-relaxed">
                          When enabled, a ticket's message thread is automatically locked and archived (read-only) the moment it's closed. No user, including CS and the Assigned Employee, can edit, delete, or add messages to an archived thread.
                          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                      Automatically lock and archive ticket chat threads into read-only mode upon ticket closure.
                    </p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {windowConfig.archiveOnClosureEnabled ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700 border border-green-200">
                        <CheckCircle2 size={12} />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600 border border-gray-200">
                        <Lock size={12} />
                        Disabled
                      </span>
                    )}

                    {/* iOS-style slider switch */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={windowConfig.archiveOnClosureEnabled}
                      onClick={handleToggleArchiveOnClosure}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#252578]/20 cursor-pointer ${windowConfig.archiveOnClosureEnabled ? 'bg-green-500' : 'bg-gray-300'
                        }`}
                      title={windowConfig.archiveOnClosureEnabled ? 'Click to disable thread archival' : 'Click to enable thread archival'}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${windowConfig.archiveOnClosureEnabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Description & Operational Status */}
                <div className="mt-5">
                  {windowConfig.archiveOnClosureEnabled ? (
                    <div className="rounded-xl border border-green-100 bg-green-50/50 p-4 text-xs text-gray-600 flex items-start gap-2.5">
                      <ShieldCheck size={16} className="text-green-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-gray-800">Thread Archival Active</p>
                        <p className="mt-0.5 text-gray-500 leading-relaxed">
                          Closed tickets are immediately read-only across all roles. Conversations are moved to the Archive tab to preserve the historical audit trail.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-500 flex items-start gap-2.5">
                      <Lock size={15} className="text-gray-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-gray-700">Thread Archival Disabled</p>
                        <p className="mt-0.5 text-gray-500 leading-relaxed">
                          Closed tickets will not be automatically locked or moved to the Archive tab. Communication remains accessible unless manually restricted.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 pt-3 border-t border-gray-100 text-[11px] text-gray-400">
                System policy: TS067 thread archival applies strictly on ticket closure (Closed status). Reopening restores active chat.
              </div>
            </div>
          </div>
        </div>
      ) : tab === TAB_FEEDBACK ? (
        <div className="flex flex-col gap-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-bold text-gray-900">Feedback Form Configuration</h2>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                  <CheckCircle2 size={12} className="shrink-0 text-emerald-600" />
                  <span>Database Connected</span>
                </span>
              </div>
              <p className="text-xs sm:text-sm text-gray-500 mt-1">
                Configure, scope, and order customer satisfaction survey questions across service categories.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <button
                type="button"
                onClick={handleResetFeedback}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 hover:text-[#252578] transition-all shrink-0 cursor-pointer shadow-xs"
              >
                <RotateCcw size={13} />
                <span>Reset Questions to Defaults</span>
              </button>
            </div>
          </div>

          {/* TS101 Feedback Form Master Toggle Card */}
          <div className={`rounded-2xl border p-5 sm:p-6 shadow-xs transition-all ${feedbackMasterEnabled ? 'border-gray-200 bg-white' : 'border-amber-200 bg-amber-50/20'
            }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h3 className="text-base font-bold text-gray-900">Feedback Form</h3>
                  <div className="relative group inline-flex items-center">
                    <button
                      type="button"
                      aria-label="Feedback Form master toggle information"
                      className="text-gray-400 hover:text-[#252578] cursor-help p-0.5 rounded-sm transition-colors"
                    >
                      <Info size={15} />
                    </button>
                    <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden w-80 rounded-xl bg-gray-900 p-3 text-center text-xs text-white shadow-xl group-hover:block z-50 leading-relaxed animate-in fade-in zoom-in-95 duration-150">
                      Disabling this stops both the feedback prompt shown to customers and the feedback-related analytics (like CSAT scores) that depend on it, since the two are tied together.
                      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                    </div>
                  </div>
                  {feedbackMasterEnabled ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-700 border border-green-200">
                      <CheckCircle2 size={12} />
                      Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600 border border-gray-200">
                      <Lock size={12} />
                      Disabled
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">
                  Existing feedback and CSAT data already collected will remain visible in dashboards and reports.
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {/* iOS-style slider switch */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={feedbackMasterEnabled}
                  onClick={handleToggleFeedbackMaster}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#252578]/20 cursor-pointer ${feedbackMasterEnabled ? 'bg-green-500' : 'bg-gray-300'
                    }`}
                  title={feedbackMasterEnabled ? 'Click to disable Feedback Form' : 'Click to enable Feedback Form'}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${feedbackMasterEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Dynamic Live State Notice (TS101) */}
          <div className={`rounded-2xl border p-4 sm:p-5 flex items-start gap-3.5 shadow-xs transition-colors ${feedbackMasterEnabled ? 'border-blue-100 bg-blue-50/70' : 'border-amber-200 bg-amber-50/80'
            }`}>
            <div className={`flex h-8 w-8 items-center justify-center rounded-xl shrink-0 mt-0.5 ${feedbackMasterEnabled ? 'bg-blue-600/10 text-blue-600' : 'bg-amber-600/10 text-amber-700'
              }`}>
              <Info size={18} />
            </div>
            <div className={`text-xs sm:text-sm ${feedbackMasterEnabled ? 'text-blue-900' : 'text-amber-900'
              }`}>
              <span className="font-semibold">Feature Notice: </span>
              {feedbackMasterEnabled ? (
                <span>
                  Feedback Form is currently enabled system-wide — customers will be prompted for feedback on closed external tickets.
                </span>
              ) : (
                <span>
                  Feedback Form is currently disabled system-wide — this configuration remains editable, but no form is shown to customers until it's re-enabled.
                </span>
              )}
            </div>
          </div>

          {/* Category Tabs & Tooltip Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200/80 pb-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex gap-1 rounded-xl bg-gray-100 p-1 shadow-xs flex-wrap">
                {feedbackCategories.map((cat) => {
                  const isCatActive = activeFeedbackCategory === cat;
                  const catList = feedbackQuestions[cat] || [];
                  const enabledCount = catList.filter((q) => q.isEnabled).length;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => handleSelectFeedbackCategory(cat)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${isCatActive
                          ? 'bg-white text-[#252578] shadow-sm'
                          : 'text-gray-600 hover:text-gray-800'
                        }`}
                    >
                      <span>{cat}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold transition-colors ${isCatActive
                            ? 'bg-[#252578]/10 text-[#252578]'
                            : 'bg-gray-200/70 text-gray-500'
                          }`}
                      >
                        {enabledCount}/{catList.length}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Scoping Information Icon with Tooltip */}
              <div className="relative group inline-flex items-center">
                <button
                  type="button"
                  aria-label="Question scoping information"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:text-[#252578] hover:bg-gray-100 transition-colors cursor-help"
                  title="Questions are scoped per category — changes to IT's questions don't affect Service or Others."
                >
                  <Info size={16} />
                </button>
                <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden w-72 rounded-xl bg-gray-900 p-3 text-center text-xs text-white shadow-xl group-hover:block z-50 leading-relaxed animate-in fade-in zoom-in-95 duration-150">
                  Questions are scoped per category — changes to IT's questions don't affect Service or Others.
                  <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                </div>
              </div>

              {/* Inactive badge when master toggle is OFF */}
              {!feedbackMasterEnabled && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 border border-amber-300 shadow-2xs">
                  <Lock size={12} />
                  Forms currently hidden from customers
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={handleAddFeedbackQuestion}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#252578] px-3.5 py-2 text-xs font-semibold text-white transition-all hover:shadow-md cursor-pointer shrink-0"
            >
              <Plus size={14} />
              <span>Add Question</span>
            </button>
          </div>

          {/* Inactive Banner when Master Toggle is OFF */}
          {!feedbackMasterEnabled && (
            <div className="rounded-xl border border-amber-200/90 bg-amber-50/70 p-3.5 text-xs text-amber-900 flex items-center justify-between gap-3 shadow-2xs animate-in fade-in duration-150">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-200/80 px-2 py-0.5 font-bold text-amber-900 shrink-0">
                  <Lock size={12} /> Inactive for Customers
                </span>
                <span>
                  The Feedback Form master toggle is currently OFF. You can still create, edit, reorder, or toggle questions below, but customers will not see any feedback prompts until the feature is re-enabled.
                </span>
              </div>
            </div>
          )}

          {/* Per-Category Feedback Toggle */}
          {feedbackMasterEnabled && activeFeedbackCategory && (
            <div className={`rounded-2xl border p-4 flex items-center justify-between gap-4 shadow-xs transition-colors ${
              categoryFeedbackToggles[activeFeedbackCategory] !== false
                ? 'border-green-100 bg-green-50/50'
                : 'border-amber-100 bg-amber-50/50'
            }`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-gray-900">
                    {activeFeedbackCategory} Category Feedback
                  </span>
                  {categoryFeedbackToggles[activeFeedbackCategory] !== false ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700 border border-green-200">
                      <CheckCircle2 size={11} /> Active
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 border border-amber-200">
                      <EyeOff size={11} /> Disabled
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                  {categoryFeedbackToggles[activeFeedbackCategory] !== false
                    ? `Customers closing "${activeFeedbackCategory}" tickets will be prompted for feedback using the questions below.`
                    : `Feedback prompts are currently suppressed for the "${activeFeedbackCategory}" category. Questions and historical data are preserved.`
                  }
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={categoryFeedbackToggles[activeFeedbackCategory] !== false}
                onClick={() => handleToggleCategoryFeedback(activeFeedbackCategory)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#252578]/20 cursor-pointer ${
                  categoryFeedbackToggles[activeFeedbackCategory] !== false ? 'bg-green-500' : 'bg-gray-300'
                }`}
                title={
                  categoryFeedbackToggles[activeFeedbackCategory] !== false
                    ? `Click to disable feedback for ${activeFeedbackCategory}`
                    : `Click to enable feedback for ${activeFeedbackCategory}`
                }
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
                    categoryFeedbackToggles[activeFeedbackCategory] !== false ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          )}

          {/* Inline Error Message */}
          {feedbackInlineError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs sm:text-sm text-red-800 flex items-center justify-between gap-3 animate-in fade-in duration-150 shadow-xs">
              <div className="flex items-center gap-2.5">
                <AlertCircle size={16} className="text-red-600 shrink-0" />
                <span className="font-semibold">{feedbackInlineError}</span>
              </div>
              <button
                type="button"
                onClick={() => setFeedbackInlineError('')}
                className="text-red-500 hover:text-red-700 text-xs font-semibold px-2 py-1 hover:bg-red-100 rounded-lg cursor-pointer transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Questions Cards List */}
          {(!feedbackQuestions[activeFeedbackCategory] || feedbackQuestions[activeFeedbackCategory].length === 0) ? (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-12 text-center shadow-xs">
              <p className="text-sm font-semibold text-gray-700">No questions configured for {activeFeedbackCategory}.</p>
              <p className="text-xs text-gray-400 mt-1">Get started by creating your first survey question.</p>
              <button
                type="button"
                onClick={handleAddFeedbackQuestion}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#252578] px-4 py-2 text-xs font-semibold text-white hover:shadow-md transition-all cursor-pointer"
              >
                <Plus size={14} /> Add Question
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3.5">
              {feedbackQuestions[activeFeedbackCategory].map((q, idx) => {
                const currentList = feedbackQuestions[activeFeedbackCategory];
                const typeBadgeClass =
                  q.responseType === 'Star Rating'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : q.responseType === 'Yes / No'
                      ? 'bg-purple-50 text-purple-700 border-purple-200'
                      : q.responseType === 'Multiple Choice'
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : q.responseType === 'Checkbox'
                          ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200';

                return (
                  <div
                    key={q.id}
                    className={`rounded-2xl border bg-white p-5 transition-all shadow-xs ${q.isEnabled
                        ? 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                        : 'border-gray-100 bg-gray-50/60 opacity-65'
                      }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      {/* Left: Order index, badge & text */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className="flex h-6 min-w-6 px-1.5 items-center justify-center rounded-lg bg-gray-100 text-xs font-semibold text-gray-600">
                            #{idx + 1}
                          </span>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${typeBadgeClass}`}>
                            {q.responseType}
                          </span>
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${q.isEnabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                              }`}
                          >
                            {q.isEnabled ? 'Active' : 'Disabled'}
                          </span>
                        </div>
                        <h4 className="mt-3 text-sm sm:text-base font-semibold text-gray-900 leading-snug break-words">
                          {q.text}
                        </h4>

                        {/* Options preview for Multiple Choice or Checkbox */}
                        {Array.isArray(q.options) && q.options.length > 0 && (
                          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-semibold text-gray-400 mr-1">Choices:</span>
                            {q.options.map((opt, optIdx) => (
                              <span
                                key={optIdx}
                                className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-gray-100 text-gray-700 border border-gray-200"
                              >
                                {opt}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Right: Controls & actions */}
                      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t border-gray-100 sm:border-t-0">
                        {/* Up / Down Reorder Arrows */}
                        <div className="flex items-center rounded-xl border border-gray-200 bg-gray-50/50 p-0.5">
                          <button
                            type="button"
                            onClick={() => handleMoveFeedbackQuestion(activeFeedbackCategory, idx, 'up')}
                            disabled={idx === 0}
                            className="p-1.5 rounded-lg text-gray-500 hover:text-[#252578] hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-500 cursor-pointer transition-colors"
                            title="Move Question Up"
                            aria-label="Move question up"
                          >
                            <ChevronUp size={16} />
                          </button>
                          <div className="h-4 w-px bg-gray-200" />
                          <button
                            type="button"
                            onClick={() => handleMoveFeedbackQuestion(activeFeedbackCategory, idx, 'down')}
                            disabled={idx === currentList.length - 1}
                            className="p-1.5 rounded-lg text-gray-500 hover:text-[#252578] hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-500 cursor-pointer transition-colors"
                            title="Move Question Down"
                            aria-label="Move question down"
                          >
                            <ChevronDown size={16} />
                          </button>
                        </div>

                        {/* iOS-slider switch toggle */}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={q.isEnabled}
                            onClick={() => handleToggleFeedbackQuestion(activeFeedbackCategory, q.id)}
                            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#252578]/20 cursor-pointer ${q.isEnabled ? 'bg-green-500' : 'bg-gray-300'
                              }`}
                            title={q.isEnabled ? 'Click to disable question' : 'Click to enable question'}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${q.isEnabled ? 'translate-x-6' : 'translate-x-1'
                                }`}
                            />
                          </button>
                        </div>

                        {/* Edit & Remove Action Buttons */}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleEditFeedbackQuestion(q)}
                            className="rounded-lg p-2 text-gray-400 hover:text-[#252578] hover:bg-gray-100 transition-colors cursor-pointer"
                            title="Edit Question"
                            aria-label="Edit question"
                          >
                            <Edit3 size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveFeedbackQuestion(activeFeedbackCategory, q)}
                            className="rounded-lg p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                            title="Remove Question"
                            aria-label="Remove question"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* TS104 Create / Edit Question Modal */}
          {editingQuestion !== null && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
              <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
                <div className="flex items-start justify-between border-b border-gray-150 pb-4">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">
                      {editingQuestion.id ? 'Edit Question' : 'Add Question'}
                    </h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Configuring survey question for category: <span className="font-semibold text-[#252578]">{editingQuestion.category || activeFeedbackCategory}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingQuestion(null)}
                    className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>

                <div className="mt-5 space-y-4">
                  {/* Question Text Input */}
                  <div>
                    <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider block mb-1.5">
                      Question Text <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      rows={3}
                      value={editingQuestion.text}
                      onChange={(e) => setEditingQuestion({ ...editingQuestion, text: e.target.value })}
                      placeholder="e.g. How would you rate the technician's technical knowledge?"
                      className="w-full rounded-xl border border-gray-200 bg-gray-50/50 p-3 text-sm text-gray-900 outline-none transition-all focus:bg-white focus:ring-2 focus:ring-[#252578]"
                    />
                  </div>

                  {/* Response Type Dropdown */}
                  <div>
                    <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider block mb-1.5">
                      Response Type <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={editingQuestion.responseType}
                      onChange={(e) => {
                        const newType = e.target.value;
                        let newOptions = editingQuestion.options;
                        if (newType === 'Yes / No') {
                          newOptions = ['Yes', 'No'];
                        } else if (newType === 'Multiple Choice' || newType === 'Checkbox') {
                          newOptions = Array.isArray(newOptions) && newOptions.length > 0 ? newOptions : ['Option 1', 'Option 2'];
                        } else {
                          newOptions = null;
                        }
                        setEditingQuestion({ ...editingQuestion, responseType: newType, options: newOptions });
                      }}
                      className="w-full rounded-xl border border-gray-200 bg-gray-50/50 p-3 text-sm font-semibold text-gray-900 outline-none transition-all focus:bg-white focus:ring-2 focus:ring-[#252578]"
                    >
                      {TS104_RESPONSE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1.5 text-xs text-gray-400 leading-relaxed">
                      {editingQuestion.responseType === 'Star Rating' && 'Presents an interactive 1–5 star rating scale to the customer.'}
                      {editingQuestion.responseType === 'Yes / No' && 'Presents a dedicated Yes or No binary choice to the customer.'}
                      {editingQuestion.responseType === 'Multiple Choice' && 'Offers single select customizable answer choices.'}
                      {editingQuestion.responseType === 'Checkbox' && 'Offers multi select customizable checkbox choices.'}
                      {editingQuestion.responseType === 'Free Text' && 'Provides an open-ended multiline text area for written suggestions.'}
                    </p>
                  </div>

                  {/* Choices Manager for Multiple Choice and Checkbox */}
                  {(editingQuestion.responseType === 'Multiple Choice' || editingQuestion.responseType === 'Checkbox') && (
                    <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50/60 p-3.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Custom Choices ({editingQuestion.responseType === 'Multiple Choice' ? 'Single Select' : 'Multi Select'}) <span className="text-red-500">*</span>
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            const current = Array.isArray(editingQuestion.options) ? editingQuestion.options : [];
                            const nextOpts = [...current, `Option ${current.length + 1}`];
                            setEditingQuestion({ ...editingQuestion, options: nextOpts });
                          }}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#252578] hover:underline cursor-pointer"
                        >
                          <Plus size={13} />
                          <span>Add Choice</span>
                        </button>
                      </div>

                      <div className="space-y-2 pt-1 max-h-48 overflow-y-auto pr-1">
                        {(editingQuestion.options || ['Option 1', 'Option 2']).map((opt, optIdx) => (
                          <div key={optIdx} className="flex items-center gap-2">
                            <span className="text-xs font-bold text-gray-400 w-5 text-center">{optIdx + 1}.</span>
                            <input
                              type="text"
                              value={opt}
                              onChange={(e) => {
                                const current = Array.isArray(editingQuestion.options) ? [...editingQuestion.options] : ['Option 1', 'Option 2'];
                                current[optIdx] = e.target.value;
                                setEditingQuestion({ ...editingQuestion, options: current });
                              }}
                              placeholder={`Choice ${optIdx + 1}`}
                              className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-900 outline-none focus:ring-2 focus:ring-[#252578]"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const current = Array.isArray(editingQuestion.options) ? editingQuestion.options : ['Option 1', 'Option 2'];
                                if (current.length <= 2) return;
                                const nextOpts = current.filter((_, i) => i !== optIdx);
                                setEditingQuestion({ ...editingQuestion, options: nextOpts });
                              }}
                              disabled={(editingQuestion.options || []).length <= 2}
                              className="p-1.5 text-gray-400 hover:text-red-600 disabled:opacity-30 disabled:hover:text-gray-400 cursor-pointer rounded-lg hover:bg-red-50"
                              title="Delete choice"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                      <p className="text-[11px] text-gray-400">
                        At least 2 choices required. Choices will be rendered on the customer satisfaction survey form.
                      </p>
                    </div>
                  )}
                </div>

                {/* Modal Actions: Cancel & Save immediately */}
                <div className="mt-6 flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
                  <button
                    type="button"
                    onClick={() => setEditingQuestion(null)}
                    className="rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveFeedbackQuestion}
                    disabled={!editingQuestion.text.trim()}
                    className="rounded-xl bg-[#252578] px-5 py-2.5 text-sm font-semibold text-white transition-all hover:shadow-lg disabled:opacity-50 cursor-pointer"
                  >
                    Save Question
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : activeGroup === GROUP_NOTIFICATIONS ? (
        <div className="flex flex-col gap-6">
          {currentSubTab === NOTIF_SUBTAB_RECIPIENTS ? (
            <div className="flex flex-col gap-6">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Notification Recipient Routing</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Choose who receives each notification event across ticket actors, roles, and departments.
                </p>
              </div>

              <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 text-sm text-blue-900 flex items-start gap-3">
                <Info size={18} className="text-blue-600 shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  Configure notification recipient routing for creation, messaging, and SLA escalation alerts. Changes apply to subsequent alerts and do not affect queued or sent notifications. System Alerts are excluded because they are hard-coded to Super Admin at dispatch level.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                {TS099_ALERT_TYPES.map((alert) => {
                  const selectedRecipients = routingConfig[alert.key] || [];
                  const alertError = routingErrors[alert.key];
                  const isExpanded = expandedRecipientAlert === alert.key;
                  const panelId = `recipient-panel-${alert.key}`;

                  return (
                    <div key={alert.key} className={`rounded-2xl border bg-white shadow-sm overflow-hidden transition-colors ${
                      isExpanded ? 'border-[#252578]/25' : 'border-gray-100'
                    }`}>
                      <button
                        type="button"
                        onClick={() => setExpandedRecipientAlert((current) => current === alert.key ? null : alert.key)}
                        aria-expanded={isExpanded}
                        aria-controls={panelId}
                        className="w-full p-4 sm:p-5 flex items-center justify-between gap-4 text-left hover:bg-gray-50/70 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#252578]/10 text-[#252578] shrink-0">
                            <Bell size={18} />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2.5 flex-wrap">
                              <h3 className="text-sm sm:text-base font-bold text-gray-900">{alert.title}</h3>
                              <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${alert.badgeColor}`}>
                                {alert.badge}
                              </span>
                            </div>
                            <p className="text-xs text-gray-500 mt-1 truncate">{alert.description}</p>
                            {alertError && <p className="text-xs font-semibold text-red-600 mt-1">{alertError}</p>}
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <span className="inline-flex items-center rounded-full bg-[#252578]/5 px-2.5 sm:px-3 py-1 text-xs font-bold text-[#252578] border border-[#252578]/20">
                            <span className="sm:hidden">{selectedRecipients.length}</span>
                            <span className="hidden sm:inline">{selectedRecipients.length} selected</span>
                          </span>
                          <ChevronDown
                            size={19}
                            aria-hidden="true"
                            className={`text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180 text-[#252578]' : ''}`}
                          />
                        </div>
                      </button>

                      {isExpanded && (
                        <div id={panelId} className="border-t border-gray-100 p-4 sm:p-6 flex flex-col gap-5">
                          <div className="sm:hidden">
                            <span className="inline-flex items-center rounded-full bg-[#252578]/5 px-3 py-1 text-xs font-bold text-[#252578] border border-[#252578]/20">
                              {selectedRecipients.length} Recipient{selectedRecipients.length === 1 ? '' : 's'} Selected
                            </span>
                          </div>

                          {alertError && (
                            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex items-center gap-2">
                              <AlertCircle size={15} className="shrink-0 text-red-600" />
                              <span className="font-semibold">{alertError}</span>
                            </div>
                          )}

                          <div>
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 mb-2.5">
                              <div className="flex items-center gap-2">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700">Contextual Recipients</h4>
                                <span className="rounded-md bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-700 border border-purple-200">
                                  Dynamic Actors
                                </span>
                              </div>
                              <span className="text-[11px] text-gray-400">Resolves dynamically at runtime per ticket</span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {ts099RecipientOptions.contextual.map((item) => {
                                const isChecked = selectedRecipients.includes(item.id);
                                return (
                                  <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => handleToggleRecipient(alert.key, item.id)}
                                    className={`flex items-center justify-between p-3.5 rounded-xl border text-left transition-all cursor-pointer select-none ${
                                      isChecked
                                        ? 'border-[#252578] bg-[#252578]/5 shadow-xs ring-1 ring-[#252578]'
                                        : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50 opacity-75'
                                    }`}
                                  >
                                    <div className="flex items-center gap-3 min-w-0">
                                      <div className={`flex h-9 w-9 items-center justify-center rounded-xl font-bold text-xs transition-colors shrink-0 ${
                                        isChecked ? 'bg-[#252578] text-white' : 'bg-gray-100 text-gray-500'
                                      }`}>
                                        <UserCheck size={16} />
                                      </div>
                                      <div className="truncate">
                                        <div className="flex items-center gap-1.5">
                                          <p className={`text-sm font-bold truncate ${isChecked ? 'text-[#252578]' : 'text-gray-800'}`}>{item.label}</p>
                                          <span className="rounded bg-purple-100 px-1.5 py-0.2 text-[9px] font-bold text-purple-700 border border-purple-200 shrink-0">
                                            Contextual
                                          </span>
                                        </div>
                                        <p className="text-[11px] text-gray-400 truncate mt-0.5">{item.desc}</p>
                                      </div>
                                    </div>
                                    <div className="ml-3 shrink-0">
                                      {isChecked ? (
                                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#252578] text-white">
                                          <Check size={12} strokeWidth={3} />
                                        </span>
                                      ) : (
                                        <span className="flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 bg-white" />
                                      )}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div className="border-t border-gray-100" />

                          <div>
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 mb-2.5">
                              <div className="flex items-center gap-2">
                                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700">Static Roles & Departments</h4>
                                <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-200">
                                  Fixed Groups
                                </span>
                              </div>
                              <span className="text-[11px] text-gray-400">Notifies all active staff members in the selected group</span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                              {ts099RecipientOptions.staticGroup.map((item) => {
                                const isChecked = selectedRecipients.includes(item.id);
                                const isDept = item.type === 'department';
                                return (
                                  <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => handleToggleRecipient(alert.key, item.id)}
                                    className={`flex items-center justify-between p-3.5 rounded-xl border text-left transition-all cursor-pointer select-none ${
                                      isChecked
                                        ? 'border-[#252578] bg-[#252578]/5 shadow-xs ring-1 ring-[#252578]'
                                        : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50 opacity-75'
                                    }`}
                                  >
                                    <div className="flex items-center gap-3 min-w-0">
                                      <div className={`flex h-9 w-9 items-center justify-center rounded-xl font-bold text-xs transition-colors shrink-0 ${
                                        isChecked ? 'bg-[#252578] text-white' : 'bg-gray-100 text-gray-500'
                                      }`}>
                                        {isDept ? <Building2 size={16} /> : <Users size={16} />}
                                      </div>
                                      <div className="truncate">
                                        <div className="flex items-center gap-1.5">
                                          <p className={`text-sm font-bold truncate ${isChecked ? 'text-[#252578]' : 'text-gray-800'}`}>{item.label}</p>
                                          <span className={`rounded px-1.5 py-0.2 text-[9px] font-bold shrink-0 border ${
                                            isDept ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-blue-50 text-blue-700 border-blue-200'
                                          }`}>
                                            {item.badge}
                                          </span>
                                        </div>
                                        <p className="text-[11px] text-gray-400 truncate mt-0.5">{item.desc}</p>
                                      </div>
                                    </div>
                                    <div className="ml-3 shrink-0">
                                      {isChecked ? (
                                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#252578] text-white">
                                          <Check size={12} strokeWidth={3} />
                                        </span>
                                      ) : (
                                        <span className="flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 bg-white" />
                                      )}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div className="pt-3 border-t border-gray-100 text-[11px] text-gray-400">
                            {alert.defaultSummary}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3">
                <button
                  type="button"
                  disabled={routingSaving}
                  onClick={handleResetRoutingConfig}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 hover:text-[#252578] transition-all cursor-pointer shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RotateCcw size={14} />
                  Reset to Defaults
                </button>
                <button
                  type="button"
                  disabled={routingSaving}
                  onClick={handleSaveRoutingConfig}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#252578] px-5 py-2.5 text-xs font-semibold text-white transition-all hover:shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {routingSaving ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      Saving Recipients...
                    </>
                  ) : (
                    <>
                      <Save size={14} />
                      Save Recipients
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : currentSubTab === NOTIF_SUBTAB_CHANNELS ? (
            <div className="flex flex-col gap-6">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Notification Channel Configuration</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Choose whether each system-generated alert type is delivered by email, in-app notification, or both.
                </p>
              </div>

              <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 text-sm text-indigo-900 flex items-start gap-3">
                <Info size={18} className="text-[#252578] shrink-0 mt-0.5" />
                <div className="text-xs leading-relaxed space-y-1">
                  <p className="font-semibold text-[#252578]">Real-time Channel Dispatch Engine</p>
                  <p className="text-slate-600">
                    Channel configurations apply immediately to all newly generated ticket events and notifications. Changing delivery preferences preserves past in-app notifications and previously sent emails intact and immutable.
                  </p>
                </div>
              </div>

              {channelsLoading ? (
                <div className="rounded-2xl border border-gray-100 bg-white p-12 text-center shadow-sm">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#252578]" />
                  <p className="mt-3 text-sm text-gray-500 font-medium">Loading channel configurations…</p>
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  {TS103_ALERT_TYPES.map((alert) => {
                    const selectedChannel = channelConfig[alert.key] || alert.defaultChannel;
                    const alertError = channelErrors[alert.key];

                    return (
                      <div key={alert.key} className="rounded-2xl border border-gray-100 bg-white p-4 sm:p-6 shadow-sm flex flex-col gap-5">
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-gray-100 pb-4">
                          <div className="flex items-start gap-3.5">
                            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#252578]/10 text-[#252578] shrink-0">
                              {alert.key === 'reassignment' ? <Mail size={20} /> : <Bell size={20} />}
                            </div>
                            <div>
                              <div className="flex items-center gap-2.5 flex-wrap">
                                <h3 className="text-base font-semibold text-gray-900">{alert.title}</h3>
                                <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold border ${alert.badgeColor}`}>
                                  {alert.badge}
                                </span>
                              </div>
                              <p className="text-xs text-gray-500 mt-1 leading-relaxed">{alert.description}</p>
                            </div>
                          </div>

                          <div className="flex items-center shrink-0 overflow-x-auto">
                            <div className="inline-flex rounded-xl bg-gray-100 p-1 border border-gray-200 min-w-max">
                              {TS103_CHANNEL_OPTIONS.map((opt) => {
                                const isActive = selectedChannel === opt.id;
                                return (
                                  <button
                                    key={opt.id}
                                    type="button"
                                    disabled={channelsSaving}
                                    onClick={() => handleChangeChannel(alert.key, opt.id)}
                                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer select-none flex items-center gap-1.5 disabled:opacity-50 ${
                                      isActive ? 'bg-[#252578] text-white shadow-xs' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
                                    }`}
                                  >
                                    {opt.id === 'email' && <Mail size={13} />}
                                    {opt.id === 'in_app' && <Bell size={13} />}
                                    {opt.id === 'both' && <Layers size={13} />}
                                    <span>{opt.label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        {alert.isSystemAlert && (
                          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-800 flex items-start gap-2.5">
                            <Info size={16} className="text-amber-600 shrink-0 mt-0.5" />
                            <span className="font-medium leading-relaxed">
                              System Alert always goes to Super Admin only, regardless of the channel chosen here.
                            </span>
                          </div>
                        )}

                        {alertError && (
                          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex items-center gap-2">
                            <AlertCircle size={15} className="shrink-0 text-red-600" />
                            <span className="font-semibold">{alertError}</span>
                          </div>
                        )}

                        <div className="pt-3 border-t border-gray-100 text-[11px] text-gray-400">
                          Default: {TS103_CHANNEL_OPTIONS.find((o) => o.id === alert.defaultChannel)?.label || alert.defaultChannel}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3">
                <button
                  type="button"
                  disabled={channelsSaving || channelsLoading}
                  onClick={handleResetChannelConfig}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 hover:text-[#252578] transition-all cursor-pointer shadow-xs disabled:opacity-50"
                >
                  <RotateCcw size={14} />
                  Reset to Defaults
                </button>
                <button
                  type="button"
                  id="save-channel-config-btn"
                  disabled={channelsSaving || channelsLoading}
                  onClick={handleSaveChannelConfig}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#252578] px-5 py-2.5 text-xs font-semibold text-white transition-all hover:shadow-lg cursor-pointer disabled:opacity-50"
                >
                  {channelsSaving ? (
                    <>
                      <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Saving Configuration…
                    </>
                  ) : (
                    <>
                      <Save size={14} />
                      Save Configuration
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : currentSubTab === NOTIF_SUBTAB_EMAIL_DELIVERY ? (
            <div className="flex flex-col gap-6">
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-xl font-bold text-gray-900">Email Configuration</h2>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border ${
                    emailConfigLoading
                      ? 'border-blue-200 bg-blue-50 text-blue-700'
                      : isEmailConfigured 
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700' 
                        : 'border-amber-200 bg-amber-50 text-amber-700'
                  }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${
                      emailConfigLoading 
                        ? 'bg-blue-500 animate-pulse' 
                        : isEmailConfigured 
                          ? 'bg-emerald-500 animate-pulse' 
                          : 'bg-amber-500'
                    }`} />
                    {emailConfigLoading ? 'Checking Configuration...' : isEmailConfigured ? 'Connected & Active' : 'Not Configured'}
                  </span>
                  {!emailConfigLoading && (emailConfig?.lastTested || emailConfig?.last_tested) && (
                    <span className="text-xs text-gray-400">
                      Last tested: {emailConfig.lastTested || emailConfig.last_tested}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  Configure Resend transactional email delivery provider, API credentials, and default sender identity for ticket alerts.
                </p>
              </div>

              {emailConfigLoading ? (
                /* Loading Skeleton Card */
                <div className="rounded-2xl border border-gray-100 bg-white p-8 sm:p-10 shadow-sm flex flex-col gap-6 animate-pulse">
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-xl bg-gray-200" />
                    <div className="space-y-2 flex-1">
                      <div className="h-3.5 w-28 bg-gray-200 rounded" />
                      <div className="h-5 w-56 bg-gray-200 rounded" />
                    </div>
                  </div>
                  <div className="space-y-4 pt-4 border-t border-gray-100">
                    <div className="h-11 w-full bg-gray-100 rounded-xl" />
                    <div className="h-11 w-full bg-gray-100 rounded-xl" />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="h-11 bg-gray-100 rounded-xl" />
                      <div className="h-11 bg-gray-100 rounded-xl" />
                    </div>
                  </div>
                </div>
              ) : !isEmailConfigured ? (
                /* Unconfigured state */
                !isAddingEmailConfig ? (
                  <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 sm:p-14 flex flex-col items-center justify-center text-center shadow-xs">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#252578]/10 text-[#252578] mb-4">
                      <Mail size={32} />
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 mb-1">No Email Configuration</h3>
                    <p className="text-sm text-gray-500 max-w-md mb-6">
                      No transactional email delivery gateway is configured yet. Add your Resend account credentials to enable automated ticket alerts, status updates, and notifications.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddingEmailConfig(true);
                        setNewEmailConfigErrors({});
                      }}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#252578] px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-[#1a1a5e] hover:shadow-lg cursor-pointer"
                    >
                      <Plus size={18} />
                      Add Email Configuration
                    </button>
                  </div>
                ) : (
                  /* Add Email Configuration Form */
                  <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden flex flex-col">
                    <div className="p-5 sm:p-6 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-gradient-to-r from-gray-50/50 via-white to-gray-50/30">
                      <div className="flex items-center gap-3.5">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#252578]/10 text-[#252578] shrink-0">
                          <Mail size={20} />
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Transactional Gateway</p>
                          <h3 className="text-lg font-bold text-gray-900">Add Resend Email Configuration</h3>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#252578]/15 bg-[#252578]/5 px-3 py-1 text-xs font-bold text-[#252578]">
                          <Key size={13} />
                          Resend API v1
                        </span>
                      </div>
                    </div>

                    <div className="p-5 sm:p-8 flex flex-col gap-6">
                      {/* Provider Field (Fixed to Resend) */}
                      <div className="flex flex-col gap-2">
                        <label className="text-sm font-bold text-gray-800 flex items-center justify-between">
                          <span>Provider</span>
                          <span className="text-xs font-normal text-gray-400">Dedicated delivery engine</span>
                        </label>
                        <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50/80 px-4 py-3 text-sm font-semibold text-gray-800">
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
                            <span>Resend</span>
                            <span className="text-xs font-normal text-gray-500">(Modern Developer-First Email API)</span>
                          </div>
                          <span className="text-xs font-medium text-gray-400 bg-gray-200/60 px-2 py-0.5 rounded-md">Fixed</span>
                        </div>
                      </div>

                      {/* API Key Field */}
                      <div className="flex flex-col gap-2">
                        <label className="text-sm font-bold text-gray-800 flex items-center justify-between">
                          <span>API Key <span className="text-red-500">*</span></span>
                          <span className="text-xs font-normal text-gray-400">Secret key from Resend API dashboard</span>
                        </label>
                        <div className="relative flex items-center">
                          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-gray-400">
                            <Key size={16} />
                          </div>
                          <input
                            type={showNewApiKey ? 'text' : 'password'}
                            value={newEmailConfig.apiKey}
                            onChange={(e) => {
                              setNewEmailConfig({ ...newEmailConfig, apiKey: e.target.value });
                              if (newEmailConfigErrors.apiKey) {
                                setNewEmailConfigErrors((prev) => {
                                  const n = { ...prev };
                                  delete n.apiKey;
                                  return n;
                                });
                              }
                            }}
                            placeholder="re_••••••••••••••••••••••••"
                            className={`w-full rounded-xl border pl-10 pr-11 py-3 text-sm font-mono outline-none transition-all ${
                              newEmailConfigErrors.apiKey
                                ? 'border-red-300 bg-red-50/30 text-red-900 focus:ring-2 focus:ring-red-200'
                                : 'border-gray-200 bg-gray-50/50 text-gray-900 focus:border-[#252578] focus:bg-white focus:ring-2 focus:ring-[#252578]/10'
                            }`}
                          />
                          <button
                            type="button"
                            onClick={() => setShowNewApiKey(!showNewApiKey)}
                            aria-label={showNewApiKey ? 'Hide API key' : 'Show API key'}
                            className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
                          >
                            {showNewApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                        {newEmailConfigErrors.apiKey ? (
                          <p className="text-xs font-medium text-red-600 mt-0.5">{newEmailConfigErrors.apiKey}</p>
                        ) : (
                          <p className="text-xs text-amber-600 font-medium mt-0.5">⚠️ Once you save, you cannot see the API key again. It will be permanently masked.</p>
                        )}
                      </div>

                      {/* From Name & From Email Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        {/* From Name */}
                        <div className="flex flex-col gap-2">
                          <label className="text-sm font-bold text-gray-800 flex items-center justify-between">
                            <span>From Name <span className="text-red-500">*</span></span>
                            <span className="text-xs font-normal text-gray-400">Sender display name</span>
                          </label>
                          <input
                            type="text"
                            value={newEmailConfig.fromName}
                            onChange={(e) => {
                              setNewEmailConfig({ ...newEmailConfig, fromName: e.target.value });
                              if (newEmailConfigErrors.fromName) {
                                setNewEmailConfigErrors((prev) => {
                                  const n = { ...prev };
                                  delete n.fromName;
                                  return n;
                                });
                              }
                            }}
                            placeholder="e.g. SBSI Support"
                            className={`w-full rounded-xl border px-4 py-3 text-sm outline-none transition-all ${
                              newEmailConfigErrors.fromName
                                ? 'border-red-300 bg-red-50/30 text-red-900 focus:ring-2 focus:ring-red-200'
                                : 'border-gray-200 bg-gray-50/50 text-gray-900 focus:border-[#252578] focus:bg-white focus:ring-2 focus:ring-[#252578]/10'
                            }`}
                          />
                          {newEmailConfigErrors.fromName ? (
                            <p className="text-xs font-medium text-red-600 mt-0.5">{newEmailConfigErrors.fromName}</p>
                          ) : (
                            <p className="text-xs text-gray-400">Visible to customers and employees in their email client headers.</p>
                          )}
                        </div>

                        {/* From Email */}
                        <div className="flex flex-col gap-2">
                          <label className="text-sm font-bold text-gray-800 flex items-center justify-between">
                            <span>From Email <span className="text-red-500">*</span></span>
                            <span className="text-xs font-normal text-gray-400">Verified domain address</span>
                          </label>
                          <input
                            type="email"
                            value={newEmailConfig.fromEmail}
                            onChange={(e) => {
                              setNewEmailConfig({ ...newEmailConfig, fromEmail: e.target.value });
                              if (newEmailConfigErrors.fromEmail) {
                                setNewEmailConfigErrors((prev) => {
                                  const n = { ...prev };
                                  delete n.fromEmail;
                                  return n;
                                });
                              }
                            }}
                            placeholder="support@sbs-med.com"
                            className={`w-full rounded-xl border px-4 py-3 text-sm outline-none transition-all ${
                              newEmailConfigErrors.fromEmail
                                ? 'border-red-300 bg-red-50/30 text-red-900 focus:ring-2 focus:ring-red-200'
                                : 'border-gray-200 bg-gray-50/50 text-gray-900 focus:border-[#252578] focus:bg-white focus:ring-2 focus:ring-[#252578]/10'
                            }`}
                          />
                          {newEmailConfigErrors.fromEmail ? (
                            <p className="text-xs font-medium text-red-600 mt-0.5">{newEmailConfigErrors.fromEmail}</p>
                          ) : (
                            <p className="text-xs text-gray-400">Must be a verified sending domain or email configured in your Resend account.</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Form Action Footer */}
                    <div className="border-t border-gray-100 bg-gray-50/60 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <ShieldCheck size={16} className="text-emerald-600 shrink-0" />
                        <span>Credentials validated and protected by client-side encryption.</span>
                      </div>

                      <div className="flex items-center gap-2.5 justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            setIsAddingEmailConfig(false);
                            setNewEmailConfigErrors({});
                          }}
                          className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-semibold text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>

                        <button
                          type="button"
                          onClick={handleOpenTestEmailFromAdd}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#252578]/20 bg-white px-5 py-2.5 text-xs font-bold text-[#252578] hover:bg-[#252578]/5 transition-all cursor-pointer shadow-xs"
                        >
                          <Send size={14} />
                          Test Email
                        </button>

                        <button
                          type="button"
                          onClick={handleAddEmailConfig}
                          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#252578] px-6 py-2.5 text-xs font-bold text-white transition-all hover:bg-[#1a1a5e] hover:shadow-lg cursor-pointer"
                        >
                          <Save size={14} />
                          Save Configuration
                        </button>
                      </div>
                    </div>
                  </div>
                )
              ) : (
                /* Configured Email Delivery Card */
                <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden flex flex-col">
                  <div className="p-5 sm:p-6 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-gradient-to-r from-gray-50/50 via-white to-gray-50/30">
                    <div className="flex items-center gap-3.5">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#252578]/10 text-[#252578] shrink-0">
                        <Mail size={20} />
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Transactional Gateway</p>
                        <h3 className="text-lg font-bold text-gray-900">Provider & Sender Setup</h3>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#252578]/15 bg-[#252578]/5 px-3 py-1 text-xs font-bold text-[#252578]">
                        <Key size={13} />
                        Resend API v1
                      </span>
                    </div>
                  </div>

                  <div className="p-5 sm:p-8 flex flex-col gap-6">
                    {/* Provider Field (Fixed to Resend) */}
                    <div className="flex flex-col gap-2">
                      <label className="text-sm font-bold text-gray-800 flex items-center justify-between">
                        <span>Provider</span>
                        <span className="text-xs font-normal text-gray-400">Primary delivery engine</span>
                      </label>
                      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50/80 px-4 py-3 text-sm font-semibold text-gray-800">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
                          <span>Resend</span>
                          <span className="text-xs font-normal text-gray-500">(Modern Developer-First Email API)</span>
                        </div>
                        <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-md">Active</span>
                      </div>
                    </div>

                    {/* API Key Field (Masked - only shows re_•••••••••) */}
                    <div className="flex flex-col gap-2">
                      <label className="text-sm font-bold text-gray-800 flex items-center justify-between">
                        <span>API Key</span>
                        <span className="text-xs font-normal text-emerald-600 flex items-center gap-1 font-medium">
                          <Lock size={12} /> Key Secured & Encrypted
                        </span>
                      </label>
                      <div className="relative flex items-center">
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-gray-400">
                          <Key size={16} />
                        </div>
                        <input
                          type="text"
                          readOnly
                          disabled
                          value="re_•••••••••"
                          aria-label="Masked Resend API Key"
                          className="w-full rounded-xl border border-gray-200 bg-gray-100/80 py-3 pl-10 pr-36 font-mono text-sm text-gray-600 select-none cursor-not-allowed tracking-wider"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setChangeApiKeyInput('');
                            setChangeApiKeyError(null);
                            setShowChangeApiKeyModal(true);
                          }}
                          className="absolute right-2.5 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#252578] shadow-xs hover:bg-gray-50 hover:border-[#252578]/30 transition-all cursor-pointer"
                        >
                          <Key size={13} />
                          Change API Key
                        </button>
                      </div>
                      <p className="text-xs text-gray-400">API key is protected and masked. To enter a new secret key, use Change API Key.</p>
                    </div>

                    {/* From Name & From Email Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      {/* From Name */}
                      <div className="flex flex-col gap-2">
                        <label className="text-sm font-bold text-gray-800 flex items-center justify-between">
                          <span>From Name <span className="text-red-500">*</span></span>
                          <span className="text-xs font-normal text-gray-400">Sender display name</span>
                        </label>
                        <input
                          type="text"
                          value={emailConfig?.fromName ?? emailConfig?.from_name ?? ''}
                          onChange={(e) => {
                            setEmailConfig({
                              ...emailConfig,
                              fromName: e.target.value,
                              from_name: e.target.value,
                            });
                            if (emailConfigErrors.fromName) {
                              setEmailConfigErrors((prev) => {
                                const n = { ...prev };
                                delete n.fromName;
                                return n;
                              });
                            }
                          }}
                          placeholder="e.g. SBSI Support"
                          className={`w-full rounded-xl border px-4 py-3 text-sm outline-none transition-all ${
                            emailConfigErrors.fromName
                              ? 'border-red-300 bg-red-50/30 text-red-900 focus:ring-2 focus:ring-red-200'
                              : 'border-gray-200 bg-gray-50/50 text-gray-900 focus:border-[#252578] focus:bg-white focus:ring-2 focus:ring-[#252578]/10'
                          }`}
                        />
                        {emailConfigErrors.fromName ? (
                          <p className="text-xs font-medium text-red-600 mt-0.5">{emailConfigErrors.fromName}</p>
                        ) : (
                          <p className="text-xs text-gray-400">Visible to customers and employees in their email client headers.</p>
                        )}
                      </div>

                      {/* From Email */}
                      <div className="flex flex-col gap-2">
                        <label className="text-sm font-bold text-gray-800 flex items-center justify-between">
                          <span>From Email <span className="text-red-500">*</span></span>
                          <span className="text-xs font-normal text-gray-400">Verified domain address</span>
                        </label>
                        <input
                          type="email"
                          value={emailConfig?.fromEmail ?? emailConfig?.from_email ?? ''}
                          onChange={(e) => {
                            setEmailConfig({
                              ...emailConfig,
                              fromEmail: e.target.value,
                              from_email: e.target.value,
                            });
                            if (emailConfigErrors.fromEmail) {
                              setEmailConfigErrors((prev) => {
                                const n = { ...prev };
                                delete n.fromEmail;
                                return n;
                              });
                            }
                          }}
                          placeholder="support@sbs-med.com"
                          className={`w-full rounded-xl border px-4 py-3 text-sm outline-none transition-all ${
                            emailConfigErrors.fromEmail
                              ? 'border-red-300 bg-red-50/30 text-red-900 focus:ring-2 focus:ring-red-200'
                              : 'border-gray-200 bg-gray-50/50 text-gray-900 focus:border-[#252578] focus:bg-white focus:ring-2 focus:ring-[#252578]/10'
                          }`}
                        />
                        {emailConfigErrors.fromEmail ? (
                          <p className="text-xs font-medium text-red-600 mt-0.5">{emailConfigErrors.fromEmail}</p>
                        ) : (
                          <p className="text-xs text-gray-400">Must be a verified sending domain or email configured in your Resend account.</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Bottom Action Footer */}
                  <div className="border-t border-gray-100 bg-gray-50/60 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <ShieldCheck size={16} className="text-emerald-600 shrink-0" />
                      <span>Credentials protected by enterprise client-side encryption.</span>
                    </div>

                    <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap justify-end">
                      <button
                        type="button"
                        onClick={handleRemoveEmailConfig}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition-all cursor-pointer shadow-xs"
                      >
                        <Trash2 size={14} />
                        Remove Configuration
                      </button>

                      <button
                        type="button"
                        onClick={() => setShowTestEmailModal(true)}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#252578]/20 bg-white px-5 py-2.5 text-xs font-bold text-[#252578] hover:bg-[#252578]/5 transition-all cursor-pointer shadow-xs"
                      >
                        <Send size={14} />
                        Test Email
                      </button>

                      <button
                        type="button"
                        onClick={handleSaveEmailConfig}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#252578] px-6 py-2.5 text-xs font-bold text-white transition-all hover:bg-[#1a1a5e] hover:shadow-lg cursor-pointer"
                      >
                        <Save size={14} />
                        Save Configuration
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : currentSubTab === NOTIF_SUBTAB_EMAIL_TEMPLATES ? (
            <div className="flex flex-col gap-6">
              {/* Header */}
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-xl font-bold text-gray-900">Email Templates</h2>
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border border-[#252578]/20 bg-[#252578]/5 text-[#252578]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#252578]" />
                    {emailTemplates.length} Templates
                  </span>
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  Customize the subject line and rich body content of each automated email notification. Use the visual editor with formatting tools and <code className="bg-gray-100 px-1.5 py-0.5 rounded text-[#252578] font-mono text-xs">{'{placeholder}'}</code> tokens to insert dynamic ticket values.
                </p>
              </div>

              {/* Placeholder Reference */}
              {Object.keys(emailTemplatePlaceholders).length > 0 && (
                <details className="rounded-2xl border border-[#252578]/15 bg-[#252578]/3 overflow-hidden">
                  <summary className="flex items-center gap-2 px-5 py-3.5 cursor-pointer select-none text-sm font-semibold text-[#252578] hover:bg-[#252578]/5 transition-colors list-none">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-[#252578]/10 text-[#252578]">
                      <Info size={12} />
                    </span>
                    Available Placeholders — click to expand
                    <ChevronRight size={14} className="ml-auto opacity-60 details-chevron transition-transform" />
                  </summary>
                  <div className="px-5 pb-4 pt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {Object.entries(emailTemplatePlaceholders).map(([token, desc]) => (
                      <div key={token} className="flex items-start gap-2 rounded-lg bg-white border border-gray-100 px-3 py-2">
                        <code className="text-[11px] font-mono text-[#252578] bg-[#252578]/8 px-1.5 py-0.5 rounded shrink-0 mt-0.5">{token}</code>
                        <span className="text-xs text-gray-500">{desc}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Template Cards */}
              <div className="flex flex-col gap-3">
                {templatesLoading && emailTemplates.length === 0 ? (
                  <div className="space-y-3 animate-pulse">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-20 rounded-2xl border border-gray-200 bg-white p-5 flex items-center justify-between">
                        <div className="space-y-2">
                          <div className="h-4 w-40 bg-gray-200 rounded" />
                          <div className="h-3 w-64 bg-gray-100 rounded" />
                        </div>
                        <div className="h-5 w-12 bg-gray-200 rounded-full" />
                      </div>
                    ))}
                  </div>
                ) : emailTemplates.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 flex flex-col items-center justify-center text-center">
                    <Mail size={32} className="text-gray-300 mb-3" />
                    <p className="text-sm text-gray-500">No email templates found. Templates will appear here after configuration loads.</p>
                  </div>
                ) : (
                  emailTemplates.map((template) => {
                    const isExpanded = expandedTemplate === template.event_key;
                    const draft = editingTemplates[template.event_key] || { subject: template.subject, body: template.body };
                    const isSaving = templateSaving[template.event_key];
                    const isTestingThis = Boolean(testingTemplate[template.event_key]);
                    const errors = templateErrors[template.event_key] || {};
                    const isDirty = draft.subject !== template.subject || draft.body !== template.body;
                    const combinedText = `${draft.subject || ''} ${draft.body || ''}`;
                    const hasPlaceholders = /\{{1,2}[a-zA-Z0-9_]+\}{1,2}/.test(combinedText);
                    const isMissingPlaceholders = !hasPlaceholders;

                    return (
                      <div
                        key={template.event_key}
                        className={`rounded-2xl border transition-all overflow-hidden ${
                          isExpanded
                            ? 'border-[#252578]/25 shadow-md'
                            : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                        }`}
                      >
                        {/* Card Header — always visible */}
                        <div
                          className={`flex items-center gap-4 px-5 py-4 cursor-pointer select-none transition-colors ${
                            isExpanded ? 'bg-gradient-to-r from-[#252578]/5 via-white to-transparent' : 'bg-white'
                          }`}
                          onClick={() => setExpandedTemplate(isExpanded ? null : template.event_key)}
                        >
                          {/* Toggle Switch */}
                          <div
                            role="switch"
                            aria-checked={template.is_enabled}
                            tabIndex={0}
                            title={template.is_enabled ? 'Disable this template' : 'Enable this template'}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#252578]/30 ${
                              template.is_enabled ? 'bg-[#252578]' : 'bg-gray-200'
                            }`}
                            onClick={async (e) => {
                              e.stopPropagation();
                              const newVal = !template.is_enabled;
                              try {
                                const res = await toggleEmailTemplate(template.event_key, newVal);
                                if (res?.template) {
                                  setEmailTemplates((prev) =>
                                    prev.map((t) => (t.event_key === template.event_key ? res.template : t))
                                  );
                                }
                              } catch {
                                // no-op
                              }
                            }}
                            onKeyDown={async (e) => {
                              if (e.key === ' ' || e.key === 'Enter') {
                                e.preventDefault();
                                const newVal = !template.is_enabled;
                                try {
                                  const res = await toggleEmailTemplate(template.event_key, newVal);
                                  if (res?.template) {
                                    setEmailTemplates((prev) =>
                                      prev.map((t) => (t.event_key === template.event_key ? res.template : t))
                                    );
                                  }
                                } catch { /* no-op */ }
                              }
                            }}
                          >
                            <span
                              aria-hidden="true"
                              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                template.is_enabled ? 'translate-x-4' : 'translate-x-0'
                              }`}
                            />
                          </div>

                          {/* Event Label & Meta */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-bold text-gray-900">{template.event_label}</p>
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                template.is_enabled
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : 'bg-gray-100 text-gray-500 border border-gray-200'
                              }`}>
                                {template.is_enabled ? 'Active' : 'Disabled'}
                              </span>
                              {isDirty && (
                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                  Unsaved Changes
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400 mt-0.5 truncate">
                              Subject: <span className="text-gray-600">{template.subject}</span>
                            </p>
                          </div>

                          {/* Quick Test Button on collapsed card */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleTestTemplate(template, draft);
                            }}
                            disabled={isTestingThis}
                            title={`Send test email to SuperAdmin (${user?.email || 'admin@sbs-med.com'})`}
                            className="hidden sm:inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:border-[#252578]/40 hover:text-[#252578] hover:bg-[#252578]/5 transition-all shadow-2xs"
                          >
                            {isTestingThis ? (
                              <RefreshCw size={12} className="animate-spin text-[#252578]" />
                            ) : (
                              <Send size={12} className="text-[#252578]" />
                            )}
                            <span>Test</span>
                          </button>

                          {/* Expand chevron */}
                          <ChevronRight
                            size={16}
                            className={`text-gray-400 shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                          />
                        </div>

                        {/* Expanded Editor */}
                        {isExpanded && (
                          <div className="border-t border-gray-100 bg-white">
                            <div className="p-5 sm:p-6 flex flex-col gap-5">
                              {/* Subject Field */}
                              <div className="flex flex-col gap-1.5">
                                <label className="text-sm font-bold text-gray-800 flex items-center justify-between">
                                  <span>Email Subject <span className="text-red-500">*</span></span>
                                  <span className="text-xs font-normal text-gray-400">Supports dynamic placeholders</span>
                                </label>
                                <input
                                  type="text"
                                  value={draft.subject}
                                  onChange={(e) =>
                                    setEditingTemplates((prev) => ({
                                      ...prev,
                                      [template.event_key]: { ...draft, subject: e.target.value },
                                    }))
                                  }
                                  className={`w-full rounded-xl border px-4 py-3 text-sm outline-none transition-all ${
                                    errors.subject
                                      ? 'border-red-300 bg-red-50/30 focus:ring-2 focus:ring-red-200'
                                      : 'border-gray-200 bg-gray-50/50 focus:border-[#252578] focus:bg-white focus:ring-2 focus:ring-[#252578]/10'
                                  }`}
                                  placeholder="e.g. Your Ticket #{ticket_number} Has Been Created"
                                />
                                {errors.subject && <p className="text-xs text-red-600 font-medium">{errors.subject}</p>}
                              </div>

                              {/* Body Field - Rich Visual & HTML Editor */}
                              <div className="flex flex-col gap-1.5">
                                <label className="text-sm font-bold text-gray-800 flex items-center justify-between">
                                  <span>Email Body Content <span className="text-red-500">*</span></span>
                                  <span className="text-xs font-normal text-gray-400">Format text, insert variables, or switch to HTML</span>
                                </label>

                                <EmailVisualEditor
                                  value={draft.body}
                                  onChange={(body) =>
                                    setEditingTemplates((prev) => ({
                                      ...prev,
                                      [template.event_key]: { ...draft, body },
                                    }))
                                  }
                                  placeholders={emailTemplatePlaceholders}
                                  error={errors.body}
                                  subject={draft.subject}
                                  onSendTest={() => handleTestTemplate(template, draft)}
                                  isTesting={isTestingThis}
                                  superAdminEmail={user?.email}
                                />
                              </div>

                              {isMissingPlaceholders && (
                                <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50/90 p-3.5 text-xs text-amber-900 shadow-xs animate-in fade-in">
                                  <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                                  <div className="flex-1">
                                    <span className="font-bold text-amber-950">You are not allowed to remove all placeholders.</span>
                                    <p className="mt-0.5 text-amber-800 leading-relaxed">
                                      Every email notification template must contain at least one dynamic placeholder (e.g. <code className="bg-amber-100/90 px-1.5 py-0.5 rounded font-mono font-semibold text-[11px]">{'{ticket_number}'}</code> or <code className="bg-amber-100/90 px-1.5 py-0.5 rounded font-mono font-semibold text-[11px]">{'{customer_name}'}</code>) so recipients receive essential context. Saving is disabled until at least one placeholder token is present.
                                    </p>
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Action Footer */}
                            <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-3.5 flex items-center justify-between gap-3 flex-wrap">
                              <div className="flex items-center gap-2 text-xs text-gray-500">
                                {template.updated_at && (
                                  <span>Last updated: <span className="text-gray-700 font-medium">{template.updated_at}</span></span>
                                )}
                              </div>

                              <div className="flex items-center gap-2.5 flex-wrap justify-end">
                                {/* Reset to default */}
                                <button
                                  type="button"
                                  title="Reset to system default"
                                  onClick={() => {
                                    showConfirm(
                                      `Reset "${template.event_label}"?`,
                                      'This will restore the factory default subject and body for this template. Your custom edits will be lost.',
                                      async () => {
                                        closeNotif();
                                        try {
                                          const res = await resetEmailTemplate(template.event_key);
                                          if (res?.template) {
                                            setEmailTemplates((prev) =>
                                              prev.map((t) => (t.event_key === template.event_key ? res.template : t))
                                            );
                                            setEditingTemplates((prev) => ({
                                              ...prev,
                                              [template.event_key]: {
                                                subject: res.template.subject,
                                                body: res.template.body,
                                              },
                                            }));
                                            showSuccess('Template Reset', res.message || 'Template restored to defaults.');
                                          }
                                        } catch {
                                          // no-op
                                        }
                                      },
                                      { confirmText: 'Reset Template', confirmClassName: 'bg-red-600 hover:bg-red-700' }
                                    );
                                  }}
                                  className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all cursor-pointer"
                                >
                                  <RotateCcw size={13} />
                                  Reset
                                </button>

                                {/* Send Test Email to SuperAdmin */}
                                <button
                                  type="button"
                                  disabled={isTestingThis}
                                  onClick={() => handleTestTemplate(template, draft)}
                                  title={`Send a preview test email to SuperAdmin (${user?.email || 'admin@sbs-med.com'})`}
                                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#252578]/20 bg-white px-4 py-2 text-xs font-bold text-[#252578] hover:bg-[#252578]/5 transition-all cursor-pointer shadow-xs disabled:opacity-50"
                                >
                                  {isTestingThis ? (
                                    <>
                                      <RefreshCw size={13} className="animate-spin" />
                                      Sending Test…
                                    </>
                                  ) : (
                                    <>
                                      <Send size={13} />
                                      Send Test to SuperAdmin
                                    </>
                                  )}
                                </button>

                                {isMissingPlaceholders && (
                                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-amber-100/80 text-amber-900 border border-amber-300">
                                    <AlertCircle size={13} className="text-amber-600 shrink-0" />
                                    Placeholders required to save
                                  </span>
                                )}

                                {/* Save */}
                                <button
                                  type="button"
                                  disabled={isSaving || !isDirty || isMissingPlaceholders}
                                  title={
                                    isMissingPlaceholders
                                      ? 'You are not allowed to remove all placeholders. Insert at least one dynamic placeholder before saving.'
                                      : !isDirty
                                      ? 'No changes to save'
                                      : 'Save template'
                                  }
                                  onClick={async () => {
                                    const errs = {};
                                    if (!draft.subject?.trim()) errs.subject = 'Subject is required.';
                                    if (!draft.body?.trim()) errs.body = 'Body is required.';
                                    const combinedText = `${draft.subject || ''} ${draft.body || ''}`;
                                    if (!/\{{1,2}[a-zA-Z0-9_]+\}{1,2}/.test(combinedText)) {
                                      errs.body = 'Email template must contain at least one dynamic placeholder (e.g. {{ticket_number}} or {ticket_number}). Removing all placeholders is not permitted.';
                                    }
                                    if (Object.keys(errs).length > 0) {
                                      setTemplateErrors((prev) => ({ ...prev, [template.event_key]: errs }));
                                      return;
                                    }
                                    setTemplateErrors((prev) => ({ ...prev, [template.event_key]: {} }));
                                    setTemplateSaving((prev) => ({ ...prev, [template.event_key]: true }));
                                    try {
                                      const res = await updateEmailTemplate(template.event_key, {
                                        subject: draft.subject.trim(),
                                        body: draft.body.trim(),
                                        is_enabled: template.is_enabled,
                                      });
                                      if (res?.template) {
                                        setEmailTemplates((prev) =>
                                          prev.map((t) => (t.event_key === template.event_key ? res.template : t))
                                        );
                                        setEditingTemplates((prev) => ({
                                          ...prev,
                                          [template.event_key]: {
                                            subject: res.template.subject,
                                            body: res.template.body,
                                          },
                                        }));
                                        showSuccess('Template Saved', res.message || `"${template.event_label}" template updated.`);
                                      }
                                    } catch (err) {
                                      const msg = err?.response?.data?.message || 'Failed to save template.';
                                      setTemplateErrors((prev) => ({ ...prev, [template.event_key]: { body: msg } }));
                                    } finally {
                                      setTemplateSaving((prev) => ({ ...prev, [template.event_key]: false }));
                                    }
                                  }}
                                  className={`inline-flex items-center gap-1.5 rounded-xl px-5 py-2 text-xs font-bold text-white transition-all shadow-xs ${
                                    isDirty && !isSaving && !isMissingPlaceholders
                                      ? 'bg-[#252578] hover:bg-[#1a1a5e] hover:shadow-md cursor-pointer'
                                      : 'bg-gray-300 cursor-not-allowed opacity-75'
                                  }`}
                                >
                                  {isSaving ? (
                                    <>
                                      <RefreshCw size={13} className="animate-spin" />
                                      Saving…
                                    </>
                                  ) : (
                                    <>
                                      <Save size={13} />
                                      Save Template
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : tab === TAB_MESSAGING ? (
        <div className="flex flex-col gap-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-bold text-gray-900">Ticket Messaging Configuration</h2>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                  <CheckCircle2 size={12} className="shrink-0 text-emerald-600" />
                  <span>Database Connected</span>
                </span>
              </div>
              <p className="text-xs sm:text-sm text-gray-500 mt-1">
                Configure who participates in ticket messaging across external customer tickets and internal employee tickets.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <button
                type="button"
                onClick={handleResetMessagingConfig}
                disabled={messagingSaving}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 hover:text-[#252578] transition-all shrink-0 cursor-pointer shadow-xs disabled:opacity-50"
              >
                <RotateCcw size={13} className={messagingSaving ? 'animate-spin' : ''} />
                <span>Reset to Defaults</span>
              </button>
              <button
                type="button"
                onClick={handleSaveMessagingConfig}
                disabled={messagingSaving}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#252578] px-3.5 py-2 text-xs font-semibold text-white transition-all hover:bg-[#1f1f63] hover:shadow-md shrink-0 cursor-pointer disabled:opacity-50"
              >
                <Save size={13} />
                <span>{messagingSaving ? 'Saving...' : 'Save Settings'}</span>
              </button>
            </div>
          </div>

          {/* Segmented Subtab: External Tickets vs Internal Tickets */}
          <div className="flex items-center gap-2 border-b border-gray-200 pb-3">
            <button
              type="button"
              onClick={() => setMessagingSubTab('external')}
              className={`px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-2 ${
                messagingSubTab === 'external'
                  ? 'bg-[#252578] text-white shadow-xs'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              <Users size={14} />
              <span>External Tickets</span>
            </button>
            <button
              type="button"
              onClick={() => setMessagingSubTab('internal')}
              className={`px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-2 ${
                messagingSubTab === 'internal'
                  ? 'bg-[#252578] text-white shadow-xs'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              <MessageSquare size={14} />
              <span>Internal Tickets</span>
            </button>
          </div>

          {messagingSubTab === 'external' ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Card 1: Default Channel Baseline */}
              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-4 border-b border-gray-100">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-blue-50 text-[#252578] flex items-center justify-center font-bold">
                        <Users size={18} />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-gray-900">Baseline Participants</h3>
                        <p className="text-xs text-gray-500">Core ticket chat channel</p>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-[#252578] border border-blue-200">
                      <Lock size={11} />
                      System Core
                    </span>
                  </div>

                  <div className="mt-4 space-y-3">
                    <p className="text-xs text-gray-600 leading-relaxed">
                      By default, ticket messaging connects the ticket creator and Customer Service. This core baseline channel ensures all customer requests receive immediate initial triage.
                    </p>

                    <div className="bg-gray-50 rounded-xl p-3.5 border border-gray-100 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-gray-700 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                          Customer / Requester
                        </span>
                        <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                          Always Connected
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-gray-700 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-[#252578]"></span>
                          Customer Support (CS)
                        </span>
                        <span className="text-[11px] font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
                          Always Connected
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-gray-100 text-[11px] text-gray-400">
                  Default direction: Customer &harr; Customer Support
                </div>
              </div>

              {/* Card 2: Delegated Employee Participation */}
              <div className={`rounded-2xl border p-6 shadow-xs flex flex-col justify-between transition-all ${
                messagingConfig.allow_delegated_employee ? 'border-[#252578]/30 bg-white ring-1 ring-[#252578]/10' : 'border-gray-200 bg-gray-50/40'
              }`}>
                <div>
                  <div className="flex items-start justify-between gap-4 pb-4 border-b border-gray-100">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center font-bold">
                        <MessageSquare size={18} />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-gray-900">Employee Delegation</h3>
                        <p className="text-xs text-gray-500">Field staff &amp; technician access</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      {messagingConfig.allow_delegated_employee ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                          <CheckCircle2 size={11} />
                          Enabled
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600 border border-gray-200">
                          Disabled
                        </span>
                      )}

                      <button
                        type="button"
                        role="switch"
                        aria-checked={messagingConfig.allow_delegated_employee}
                        onClick={() => setMessagingConfig(prev => ({
                          ...prev,
                          allow_delegated_employee: !prev.allow_delegated_employee
                        }))}
                        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#252578]/20 cursor-pointer ${
                          messagingConfig.allow_delegated_employee ? 'bg-emerald-600' : 'bg-gray-300'
                        }`}
                        title="Toggle delegated employee messaging participation"
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
                            messagingConfig.allow_delegated_employee ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 space-y-4">
                    <p className="text-xs text-gray-600 leading-relaxed">
                      When enabled, if a ticket is delegated or assigned to an employee or engineer, that ticket automatically appears in their employee messages list at <code className="text-[#252578] font-semibold bg-gray-100 px-1 py-0.5 rounded">/employee/messages</code>.
                    </p>

                    <div className="space-y-3 pt-1">
                      <label className="flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={messagingConfig.allow_full_history}
                          disabled={!messagingConfig.allow_delegated_employee}
                          onChange={(e) => setMessagingConfig(prev => ({
                            ...prev,
                            allow_full_history: e.target.checked
                          }))}
                          className="mt-0.5 rounded border-gray-300 text-[#252578] focus:ring-[#252578]"
                        />
                        <div>
                          <span className="text-xs font-semibold text-gray-800 block">
                            Full Conversation History Access
                          </span>
                          <span className="text-[11px] text-gray-500 block leading-tight">
                            Delegated employees can read prior customer support messages to gain diagnostic context.
                          </span>
                        </div>
                      </label>

                      <label className="flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={messagingConfig.notify_on_employee_join}
                          disabled={!messagingConfig.allow_delegated_employee}
                          onChange={(e) => setMessagingConfig(prev => ({
                            ...prev,
                            notify_on_employee_join: e.target.checked
                          }))}
                          className="mt-0.5 rounded border-gray-300 text-[#252578] focus:ring-[#252578]"
                        />
                        <div>
                          <span className="text-xs font-semibold text-gray-800 block">
                            Notify Participants on Employee Activity
                          </span>
                          <span className="text-[11px] text-gray-500 block leading-tight">
                            Broadcast real-time notification alerts to CS and Customer when the employee joins the discussion.
                          </span>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-gray-100 text-[11px] text-gray-400">
                  Connected route: <code className="text-gray-600">/ticketing/employee/messages</code>
                </div>
              </div>

              {/* Card 3: Architecture & Flow Status */}
              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2.5 pb-4 border-b border-gray-100">
                    <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center font-bold">
                      <Layers size={18} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">How Messages Flow</h3>
                      <p className="text-xs text-gray-500">Three party conversation map</p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs space-y-2">
                      <div className="flex items-center justify-between text-slate-700">
                        <span className="font-semibold">Message Store</span>
                        <span className="font-mono text-[11px] text-slate-500">MongoDB 7 / messages</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-700">
                        <span className="font-semibold">Real-Time Engine</span>
                        <span className="font-mono text-[11px] text-slate-500">Laravel Reverb :6002</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-700">
                        <span className="font-semibold">Cache Layer</span>
                        <span className="font-mono text-[11px] text-slate-500">Redis SCAN chunking</span>
                      </div>
                    </div>

                    <div className="text-xs text-gray-500 space-y-2 leading-relaxed">
                      <p className="flex items-start gap-1.5">
                        <CheckCircle2 size={13} className="text-emerald-600 shrink-0 mt-0.5" />
                        <span><strong>Historical Message Safety:</strong> Configuration updates only govern future messages. All previous chat messages remain permanently preserved and are never deleted or destroyed.</span>
                      </p>
                      <p className="flex items-start gap-1.5">
                        <CheckCircle2 size={13} className="text-emerald-600 shrink-0 mt-0.5" />
                        <span>Employee replies appear in the shared ticket timeline with a <strong className="text-purple-700">Staff / Engineer</strong> badge.</span>
                      </p>
                      <p className="flex items-start gap-1.5">
                        <CheckCircle2 size={13} className="text-emerald-600 shrink-0 mt-0.5" />
                        <span>Archival policies configured in <strong className="text-gray-700">Closure Windows</strong> apply uniformly across all participants upon closure.</span>
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-gray-100 text-[11px] text-gray-400">
                  Policy updates apply instantly to new messages without server restart.
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Internal Card 1: Communication Mode */}
              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-4 border-b border-gray-100">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center font-bold">
                        <Users size={18} />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-gray-900">Internal Communication Mode</h3>
                        <p className="text-xs text-gray-500">Employee ticket collaboration model</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    <p className="text-xs text-gray-600 leading-relaxed">
                      Choose how employees collaborate on internal service tickets. Select whether the requestor messages Customer Support exclusively, or communicates directly with the assigned employee.
                    </p>

                    <div className="space-y-3 pt-2">
                      {/* Mode Option 1: Requestor -> CS Only */}
                      <label
                        className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                          messagingConfig.internal?.mode === 'requestor_cs_only'
                            ? 'border-[#252578] bg-blue-50/40 ring-1 ring-[#252578]'
                            : 'border-gray-200 bg-gray-50/50 hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="internal_mode"
                          value="requestor_cs_only"
                          checked={messagingConfig.internal?.mode === 'requestor_cs_only'}
                          onChange={() => setMessagingConfig(prev => ({
                            ...prev,
                            internal: {
                              ...(prev.internal || {}),
                              mode: 'requestor_cs_only',
                              allow_direct_assigned: false,
                            }
                          }))}
                          className="mt-1 text-[#252578] focus:ring-[#252578]"
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-gray-900">Requestor &rarr; CS Only</span>
                            <span className="text-[10px] font-semibold bg-gray-150 text-gray-700 px-2 py-0.5 rounded-full">
                              Triage Only
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-500 mt-1 leading-normal">
                            Employee requestors can only communicate with Customer Support coordinators. Assigned technicians do not have access to direct replies.
                          </p>
                        </div>
                      </label>

                      {/* Mode Option 2: Requestor -> CS -> Employee Delegated */}
                      <label
                        className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                          messagingConfig.internal?.mode === 'requestor_cs_delegated'
                            ? 'border-[#252578] bg-blue-50/40 ring-1 ring-[#252578]'
                            : 'border-gray-200 bg-gray-50/50 hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="internal_mode"
                          value="requestor_cs_delegated"
                          checked={messagingConfig.internal?.mode !== 'requestor_cs_only'}
                          onChange={() => setMessagingConfig(prev => ({
                            ...prev,
                            internal: {
                              ...(prev.internal || {}),
                              mode: 'requestor_cs_delegated',
                              allow_direct_assigned: true,
                            }
                          }))}
                          className="mt-1 text-[#252578] focus:ring-[#252578]"
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-gray-900">Requestor &rarr; CS &rarr; Employee Delegated</span>
                            <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                              Recommended
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-500 mt-1 leading-normal">
                            Requestors and assigned technicians message each other directly within the internal ticket thread. CS maintains continuous supervision.
                          </p>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-gray-100 text-[11px] text-gray-400">
                  Active Mode: <strong className="text-gray-700">{messagingConfig.internal?.mode === 'requestor_cs_only' ? 'Requestor -> CS Only' : 'Requestor -> CS -> Employee Delegated'}</strong>
                </div>
              </div>

              {/* Internal Card 2: Collaboration Settings */}
              <div className={`rounded-2xl border p-6 shadow-xs flex flex-col justify-between transition-all ${
                messagingConfig.internal?.mode !== 'requestor_cs_only'
                  ? 'border-[#252578]/30 bg-white ring-1 ring-[#252578]/10'
                  : 'border-gray-200 bg-gray-50/40 opacity-80'
              }`}>
                <div>
                  <div className="flex items-start justify-between gap-4 pb-4 border-b border-gray-100">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-blue-50 text-[#252578] flex items-center justify-center font-bold">
                        <MessageSquare size={18} />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-gray-900">Direct Collaboration Rules</h3>
                        <p className="text-xs text-gray-500">Technician response &amp; continuity</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      {messagingConfig.internal?.mode !== 'requestor_cs_only' && messagingConfig.internal?.allow_direct_assigned ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                          <CheckCircle2 size={11} />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600 border border-gray-200">
                          Restricted
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 space-y-4">
                    <p className="text-xs text-gray-600 leading-relaxed">
                      Configure thread continuity and direct messaging permissions between the requesting employee and assigned staff.
                    </p>

                    <div className="space-y-3 pt-1">
                      <label className="flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(messagingConfig.internal?.allow_direct_assigned)}
                          disabled={messagingConfig.internal?.mode === 'requestor_cs_only'}
                          onChange={(e) => setMessagingConfig(prev => ({
                            ...prev,
                            internal: {
                              ...(prev.internal || {}),
                              allow_direct_assigned: e.target.checked
                            }
                          }))}
                          className="mt-0.5 rounded border-gray-300 text-[#252578] focus:ring-[#252578]"
                        />
                        <div>
                          <span className="text-xs font-semibold text-gray-800 block">
                            Direct Assigned Employee Replies
                          </span>
                          <span className="text-[11px] text-gray-500 block leading-tight">
                            Assigned employees and engineers can send direct replies to the requestor within the ticket thread.
                          </span>
                        </div>
                      </label>

                      <label className="flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(messagingConfig.internal?.allow_full_history)}
                          onChange={(e) => setMessagingConfig(prev => ({
                            ...prev,
                            internal: {
                              ...(prev.internal || {}),
                              allow_full_history: e.target.checked
                            }
                          }))}
                          className="mt-0.5 rounded border-gray-300 text-[#252578] focus:ring-[#252578]"
                        />
                        <div>
                          <span className="text-xs font-semibold text-gray-800 block">
                            Full Thread Continuity Across Reassignments
                          </span>
                          <span className="text-[11px] text-gray-500 block leading-tight">
                            When an internal ticket is reassigned or escalated, the new assignee sees the complete chronological chat history without visual disruption.
                          </span>
                        </div>
                      </label>

                      <label className="flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(messagingConfig.internal?.notify_on_activity)}
                          onChange={(e) => setMessagingConfig(prev => ({
                            ...prev,
                            internal: {
                              ...(prev.internal || {}),
                              notify_on_activity: e.target.checked
                            }
                          }))}
                          className="mt-0.5 rounded border-gray-300 text-[#252578] focus:ring-[#252578]"
                        />
                        <div>
                          <span className="text-xs font-semibold text-gray-800 block">
                            Notify Participants on Thread Activity
                          </span>
                          <span className="text-[11px] text-gray-500 block leading-tight">
                            Sends in-app and email notifications to the Requestor and Assigned Employee whenever a new message is posted.
                          </span>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-gray-100 text-[11px] text-gray-400">
                  Applies to: Internal Tickets (<code className="text-gray-600">is_internal: true</code>)
                </div>
              </div>

              {/* Internal Card 3: Security & Isolation Safeguards */}
              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2.5 pb-4 border-b border-gray-100">
                    <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center font-bold">
                      <ShieldAlert size={18} />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">Security &amp; AI Isolation</h3>
                      <p className="text-xs text-gray-500">Internal ticket data safeguards</p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs space-y-2">
                      <div className="flex items-center justify-between text-slate-700">
                        <span className="font-semibold">AI / RAG Pipeline</span>
                        <span className="font-semibold text-xs text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">Excluded (No Training)</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-700">
                        <span className="font-semibold">Ownership Verification</span>
                        <span className="font-semibold text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">Enforced</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-700">
                        <span className="font-semibold">Role Attribution</span>
                        <span className="font-semibold text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">Immutable at Send</span>
                      </div>
                    </div>

                    <div className="text-xs text-gray-500 space-y-2 leading-relaxed">
                      <p className="flex items-start gap-1.5">
                        <CheckCircle2 size={13} className="text-emerald-600 shrink-0 mt-0.5" />
                        <span><strong>Strict Ownership:</strong> An employee can only read and post to internal tickets they requested, tickets assigned to them, or if authorized by CS/Admin roles.</span>
                      </p>
                      <p className="flex items-start gap-1.5">
                        <CheckCircle2 size={13} className="text-emerald-600 shrink-0 mt-0.5" />
                        <span><strong>Malware Scanner Pipeline:</strong> File attachments on internal messages are checked by the ClamAV daemon before being stored.</span>
                      </p>
                      <p className="flex items-start gap-1.5">
                        <CheckCircle2 size={13} className="text-emerald-600 shrink-0 mt-0.5" />
                        <span><strong>AI Exclusion Guarantee:</strong> Internal message contents are permanently tagged with <code className="text-[#252578] font-semibold">exclude_ai: true</code> to ensure confidential company data is never processed by chatbots.</span>
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-gray-100 text-[11px] text-gray-400">
                  Audited via SHA-256 event integrity &amp; audit logging.
                </div>
              </div>
            </div>
          )}
        </div>
      ) : tab === TAB_DEFAULTS ? (
        <div className="flex flex-col gap-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-xl font-bold text-gray-900">Ticket Defaults</h2>
                <div className="relative group inline-flex items-center">
                  <button
                    type="button"
                    aria-label="Ticket Defaults fallback explanation"
                    className="text-gray-400 hover:text-[#252578] cursor-help p-0.5 rounded-sm transition-colors"
                  >
                    <Info size={16} />
                  </button>
                  <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden w-80 rounded-xl bg-gray-900 p-3 text-center text-xs text-white shadow-xl group-hover:block z-50 leading-relaxed animate-in fade-in zoom-in-95 duration-150">
                    These are fallback values only — they apply when no more specific rule (category, priority, or branch SLA policy) already determines the value. This is not an override.
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700 border border-green-200">
                  <CheckCircle2 size={13} className="shrink-0" />
                  <span>Configured & active for new tickets</span>
                </span>
              </div>
              <p className="text-sm text-gray-500 mt-1">
                Configure baseline fallback attributes applied to newly created tickets across the system.
              </p>
            </div>
            <button
              type="button"
              onClick={handleResetDefaults}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 hover:text-[#252578] transition-all shrink-0 cursor-pointer shadow-xs"
            >
              <RotateCcw size={14} />
              Reset to Defaults
            </button>
          </div>

          {/* Informational Non-Retroactive Callout Card */}
          <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 sm:p-5 flex items-start gap-3.5 shadow-xs">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600/10 text-blue-600 shrink-0 mt-0.5">
              <Info size={18} />
            </div>
            <div className="text-xs sm:text-sm text-blue-900 leading-relaxed">
              <span className="font-semibold">Non-Retroactive Notice: </span>
              Changing these defaults will not affect tickets already created under the previous defaults. These settings only apply to new tickets going forward.
            </div>
          </div>

          {/* Configuration Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
            {/* 1. Default Status (Locked / Non-Editable) */}
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-gray-900">Default Status</h3>
                    <div className="relative group inline-flex items-center">
                      <button
                        type="button"
                        aria-label="Status locked information"
                        className="text-gray-400 hover:text-[#252578] cursor-help p-0.5"
                      >
                        <Info size={14} />
                      </button>
                      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden w-72 rounded-xl bg-gray-900 p-3 text-center text-xs text-white shadow-xl group-hover:block z-50 leading-relaxed">
                        Tickets cannot start in any other state without violating the system transition lifecycle.
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                      </div>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600 border border-gray-200">
                    <Lock size={12} />
                    Locked
                  </span>
                </div>

                <div className="mt-5 space-y-2">
                  <label className="text-xs font-semibold text-gray-700 uppercase tracking-wider block">
                    Initial Ticket State
                  </label>
                  <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50/80 px-4 py-3 select-none">
                    <div className="flex items-center gap-2.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                      <span className="text-sm font-bold text-gray-900">{defaultsConfig.status}</span>
                    </div>
                    <span className="text-xs font-medium text-gray-400 flex items-center gap-1">
                      <Lock size={12} /> Read-only
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-xs text-gray-500 mt-5 pt-3 border-t border-gray-100 leading-relaxed">
                All newly created tickets start in Open status, per the system's transition rules. This cannot be changed.
              </p>
            </div>

            {/* 2. Default Priority (Editable Dropdown) */}
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-gray-900">Default Priority</h3>
                    <div className="relative group inline-flex items-center">
                      <button
                        type="button"
                        aria-label="Default Priority info"
                        className="text-gray-400 hover:text-[#252578] cursor-help p-0.5"
                      >
                        <Info size={14} />
                      </button>
                      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden w-72 rounded-xl bg-gray-900 p-3 text-center text-xs text-white shadow-xl group-hover:block z-50 leading-relaxed">
                        Fallback priority level applied when requestors do not explicitly set a priority level.
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                      </div>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
                    Configurable
                  </span>
                </div>

                <div className="mt-5 space-y-2">
                  <label htmlFor="default-priority-select" className="text-xs font-semibold text-gray-700 uppercase tracking-wider block">
                    Baseline Priority Level
                  </label>
                  <div className="relative">
                    <select
                      id="default-priority-select"
                      value={defaultsConfig.priority}
                      onChange={(e) => handlePriorityChange(e.target.value)}
                      className={`w-full rounded-xl border bg-white px-4 py-3 text-sm font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-[#252578] cursor-pointer appearance-none pr-10 shadow-2xs ${defaultsErrors.priority ? 'border-red-300 ring-1 ring-red-300' : 'border-gray-200'
                        }`}
                    >
                      {(() => {
                        const fallbackPriorities = ['Low', 'Medium', 'High', 'Critical'];
                        const loadedPriorities = (items.priorities && items.priorities.length > 0)
                          ? items.priorities.map((p) => p.name)
                          : fallbackPriorities;
                        const hasCurrent = loadedPriorities.some((p) => p.toLowerCase() === (defaultsConfig.priority || '').toLowerCase());
                        const optionsToRender = hasCurrent ? loadedPriorities : [defaultsConfig.priority, ...loadedPriorities].filter(Boolean);

                        return optionsToRender.map((pName) => (
                          <option key={pName} value={pName}>
                            {pName} Priority
                          </option>
                        ));
                      })()}
                    </select>
                    <ChevronDown size={18} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                  {defaultsErrors.priority && (
                    <p className="text-xs font-semibold text-red-600 flex items-center gap-1 mt-1">
                      <AlertCircle size={13} /> {defaultsErrors.priority}
                    </p>
                  )}
                </div>
              </div>

              <p className="text-xs text-gray-500 mt-5 pt-3 border-t border-gray-100 leading-relaxed">
                Matches current standard ticket intake baseline (Low). Selecting a different priority assigns that tier as the default intake severity.
              </p>
            </div>

            {/* 3. Default SLA Policy (Editable Dropdown) */}
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-gray-900">Default SLA Policy</h3>
                    <div className="relative group inline-flex items-center">
                      <button
                        type="button"
                        aria-label="Default SLA Policy info"
                        className="text-gray-400 hover:text-[#252578] cursor-help p-0.5"
                      >
                        <Info size={14} />
                      </button>
                      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden w-80 rounded-xl bg-gray-900 p-3 text-center text-xs text-white shadow-xl group-hover:block z-50 leading-relaxed">
                        Determines default response and resolution windows when no category-specific or contract-specific SLA applies.
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                      </div>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
                    Configurable
                  </span>
                </div>

                <div className="mt-5 space-y-2">
                  <label htmlFor="default-sla-select" className="text-xs font-semibold text-gray-700 uppercase tracking-wider block">
                    Response & Resolution Policy
                  </label>
                  <div className="relative">
                    <select
                      id="default-sla-select"
                      value={(() => {
                        const policy = String(defaultsConfig.slaPolicy || 'dynamic').trim();
                        if (!policy || policy.toLowerCase() === 'dynamic') return 'dynamic';
                        const found = (items.slas || []).find(
                          (s) => String(s.sla_ID) === policy || s.sla_name?.toLowerCase() === policy.toLowerCase()
                        );
                        return found?.sla_name || policy;
                      })()}
                      onChange={(e) => handleSlaPolicyChange(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-[#252578] cursor-pointer appearance-none pr-10 shadow-2xs"
                    >
                      <option value="dynamic">
                        Dynamic (Department & Priority Rule) [Current Behavior]
                      </option>
                      {(items.slas || []).map((sla) => (
                        <option key={sla.sla_ID} value={sla.sla_name}>
                          {sla.sla_name} (Fixed override: {sla.response_time_minutes ? `${sla.response_time_minutes}m` : 'N/A'} resp / {sla.resolution_time_minutes ? `${Math.round(sla.resolution_time_minutes / 60)}h` : 'N/A'} res)
                        </option>
                      ))}
                      {(() => {
                        const policy = String(defaultsConfig.slaPolicy || 'dynamic').trim();
                        if (!policy || policy.toLowerCase() === 'dynamic') return null;
                        const exists = (items.slas || []).some(
                          (s) => String(s.sla_ID) === policy || s.sla_name?.toLowerCase() === policy.toLowerCase()
                        );
                        if (!exists) {
                          return (
                            <option key={policy} value={policy}>
                              {policy} (Active SLA Policy)
                            </option>
                          );
                        }
                        return null;
                      })()}
                    </select>
                    <ChevronDown size={18} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                </div>
              </div>

              <p className="text-xs text-gray-500 mt-5 pt-3 border-t border-gray-100 leading-relaxed">
                Choosing "Dynamic" derives SLA targets from the assigned department and priority rules. Choosing a named tier overrides that dynamic behavior as a fixed baseline.
              </p>
            </div>
          </div>

          {/* Current Defaults Summary Card */}
          <div className="rounded-2xl border border-gray-200 bg-gradient-to-r from-gray-50 via-white to-gray-50 p-5 sm:p-6 shadow-xs">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">
              Active Defaults Snapshot
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-xl border border-gray-200/80 bg-white p-4 shadow-2xs">
                <span className="text-xs text-gray-500 block">Initial Status</span>
                <span className="mt-1 inline-flex items-center gap-1.5 font-bold text-gray-900">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  {defaultsConfig.status}
                  <Lock size={12} className="text-gray-400" />
                </span>
              </div>
              <div className="rounded-xl border border-gray-200/80 bg-white p-4 shadow-2xs">
                <span className="text-xs text-gray-500 block">Baseline Priority</span>
                <span className="mt-1 inline-flex items-center gap-1.5 font-bold text-[#252578]">
                  <CheckCircle2 size={13} className="text-green-600" />
                  {defaultsConfig.priority}
                </span>
              </div>
              <div className="rounded-xl border border-gray-200/80 bg-white p-4 shadow-2xs">
                <span className="text-xs text-gray-500 block">Default SLA Policy</span>
                <span className="mt-1 inline-flex items-center gap-1.5 font-bold text-gray-900 truncate">
                  <CheckCircle2 size={13} className="text-blue-600 shrink-0" />
                  <span className="truncate">
                    {defaultsConfig.slaPolicy === 'dynamic'
                      ? 'Dynamic (Department Rule)'
                      : (items.slas || []).find((s) => String(s.sla_ID) === String(defaultsConfig.slaPolicy) || s.sla_name?.toLowerCase() === String(defaultsConfig.slaPolicy).toLowerCase())?.sla_name || defaultsConfig.slaPolicy}
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : tab === TAB_NUMBER_FORMAT ? (
        <div className="flex flex-col gap-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-xl font-bold text-gray-900">Ticket Number Format</h2>
                <div className="relative group inline-flex items-center">
                  <button
                    type="button"
                    aria-label="Ticket Number Format explanation"
                    className="text-gray-400 hover:text-[#252578] cursor-help p-0.5 rounded-sm transition-colors"
                  >
                    <Info size={16} />
                  </button>
                  <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden w-80 rounded-xl bg-gray-900 p-3 text-center text-xs text-white shadow-xl group-hover:block z-50 leading-relaxed animate-in fade-in zoom-in-95 duration-150">
                    Changing this format only affects tickets created after the change. Existing ticket numbers will never be altered or regenerated.
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
                  <CheckCircle2 size={13} className="shrink-0 text-emerald-600" />
                  <span>Active Configuration — Persisted System-wide</span>
                </span>
              </div>
              <p className="text-sm text-gray-500 mt-1">
                Configure how unique ticket identifiers are structured and generated across the system.
              </p>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={handleResetNumberFormat}
                disabled={savingNumberFormat}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 hover:text-[#252578] transition-all cursor-pointer shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw size={14} />
                Reset to Defaults
              </button>
              <button
                type="button"
                onClick={handleSaveNumberFormat}
                disabled={savingNumberFormat}
                className="inline-flex items-center gap-2 rounded-xl bg-[#252578] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#1a1a5e] transition-all cursor-pointer shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingNumberFormat ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                {savingNumberFormat ? 'Saving…' : numberFormatDraftDirty ? 'Save Changes' : 'Save Format'}
              </button>
            </div>
          </div>

          {/* Informational Non-Retroactive Callout Card */}
          <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 sm:p-5 flex items-start gap-3.5 shadow-xs">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600/10 text-blue-600 shrink-0 mt-0.5">
              <Info size={18} />
            </div>
            <div className="text-xs sm:text-sm text-blue-900 leading-relaxed">
              <span className="font-semibold">Non-Retroactive Notice: </span>
              Changing this format only affects tickets created after the change. Existing ticket numbers will never be altered or regenerated.
            </div>
          </div>

          {/* Live Preview Hero Card */}
          <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-white via-indigo-50/20 to-purple-50/30 p-5 sm:p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-indigo-100/70">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#252578] text-white shadow-xs">
                  <Eye size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Live Ticket Number Preview</h3>
                  <p className="text-xs text-gray-500">Real-time preview generated from your current configuration</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200 shrink-0 self-start sm:self-auto">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                Real-time Preview
              </span>
            </div>

            {/* Display Box */}
            <div className="mt-5 flex flex-col items-center justify-center rounded-xl border border-gray-200/80 bg-slate-900 p-6 sm:p-8 text-center shadow-inner relative overflow-hidden group">
              <div className="absolute -top-12 -left-12 h-32 w-32 rounded-full bg-indigo-500/10 blur-2xl pointer-events-none" />
              <div className="absolute -bottom-12 -right-12 h-32 w-32 rounded-full bg-purple-500/10 blur-2xl pointer-events-none" />

              <span className="text-[11px] font-bold uppercase tracking-widest text-indigo-300/80 mb-2">
                Sample Ticket Identifier
              </span>
              <div className="font-mono text-2xl sm:text-4xl font-extrabold tracking-wider text-white drop-shadow-sm select-all">
                {livePreviewTicketNumber}
              </div>
              <p className="text-xs text-slate-400 mt-2 max-w-md">
                Sample sequence #1 applied to the selected format pattern.
              </p>

              {/* Segment Breakdown Chips */}
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2 pt-4 border-t border-slate-800 w-full text-xs">
                <span className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-indigo-300 font-mono">
                  <span className="text-slate-400 font-sans text-[10px]">Prefix:</span> {numberFormatConfig.prefix?.trim().toUpperCase() || 'TKT'}
                </span>
                {numberFormatConfig.includeDeptCode && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-amber-300 font-mono">
                    <span className="text-slate-400 font-sans text-[10px]">Dept:</span> {numberFormatConfig.deptCode?.trim().toUpperCase() || 'DEPT'}
                  </span>
                )}
                {numberFormatConfig.dateSegment !== 'none' && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-sky-300 font-mono">
                    <span className="text-slate-400 font-sans text-[10px]">Date:</span> {livePreviewDatePart}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-emerald-300 font-mono">
                  <span className="text-slate-400 font-sans text-[10px]">Seq:</span> {livePreviewSeqPart}
                </span>
              </div>
            </div>
          </div>

          {/* Format Builder Form Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
            {/* Card 1: Prefix & Department Code */}
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs flex flex-col justify-between space-y-6">
              <div>
                <div className="pb-3 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Tag size={16} className="text-[#252578]" />
                    <h3 className="text-base font-bold text-gray-900">Prefix & Department</h3>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
                    Segment 1 & 2
                  </span>
                </div>

                <div className="mt-5 space-y-5">
                  {/* Field 1: Prefix */}
                  <div className="space-y-1.5">
                    <label htmlFor="format-prefix-input" className="text-xs font-semibold text-gray-700 uppercase tracking-wider block">
                      Ticket Prefix <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="format-prefix-input"
                      type="text"
                      maxLength={10}
                      value={numberFormatConfig.prefix ?? ''}
                      onChange={(e) => handlePrefixChange(e.target.value)}
                      placeholder="TKT"
                      className={`w-full rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold uppercase text-gray-800 outline-none focus:ring-2 focus:ring-[#252578] shadow-2xs transition-all ${
                        numberFormatErrors.prefix ? 'border-red-300 ring-1 ring-red-300' : 'border-gray-200'
                      }`}
                    />
                    {numberFormatErrors.prefix ? (
                      <p className="text-xs font-semibold text-red-600 flex items-center gap-1 mt-1">
                        <AlertCircle size={13} /> {numberFormatErrors.prefix}
                      </p>
                    ) : (
                      <p className="text-xs text-gray-500">
                        Default prefix is <span className="font-semibold text-gray-700">TKT</span>. Appears at the start of every generated ticket number.
                      </p>
                    )}
                  </div>

                  {/* Field 2: Branch / Department Code Segment */}
                  <div className="pt-4 border-t border-gray-100 space-y-3">
                    <div className="flex items-start gap-3">
                      <input
                        id="include-dept-checkbox"
                        type="checkbox"
                        checked={numberFormatConfig.includeDeptCode}
                        onChange={(e) => handleIncludeDeptCodeChange(e.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-[#252578] focus:ring-[#252578] cursor-pointer"
                      />
                      <label htmlFor="include-dept-checkbox" className="text-xs font-bold text-gray-900 cursor-pointer select-none">
                        Include Branch / Department Code Segment
                        <span className="block text-[11px] font-normal text-gray-500 mt-0.5">
                          Adds an organizational code segment between prefix and timestamp (e.g. TKT-IT-0001).
                        </span>
                      </label>
                    </div>

                    <div className={`space-y-1.5 transition-all ${numberFormatConfig.includeDeptCode ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                      <label htmlFor="dept-code-input" className="text-xs font-semibold text-gray-700 uppercase tracking-wider block">
                        Branch / Department Code {numberFormatConfig.includeDeptCode && <span className="text-red-500">*</span>}
                      </label>
                      <input
                        id="dept-code-input"
                        type="text"
                        maxLength={10}
                        disabled={!numberFormatConfig.includeDeptCode}
                        value={numberFormatConfig.deptCode}
                        onChange={(e) => handleDeptCodeChange(e.target.value)}
                        placeholder="e.g. IT, SVC, HQ"
                        className={`w-full rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold uppercase text-gray-800 outline-none focus:ring-2 focus:ring-[#252578] shadow-2xs transition-all ${
                          numberFormatErrors.deptCode ? 'border-red-300 ring-1 ring-red-300' : 'border-gray-200'
                        }`}
                      />
                      {numberFormatErrors.deptCode ? (
                        <p className="text-xs font-semibold text-red-600 flex items-center gap-1 mt-1">
                          <AlertCircle size={13} /> {numberFormatErrors.deptCode}
                        </p>
                      ) : (
                        <p className="text-xs text-gray-500">
                          Enter a short code manually (e.g. IT, SVC) — departments don't have a standardized code yet.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-gray-100 text-xs text-gray-400">
                Current system behavior omits department codes from ticket numbers.
              </div>
            </div>

            {/* Card 2: Date & Sequential Number Segments */}
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs flex flex-col justify-between space-y-6">
              <div>
                <div className="pb-3 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar size={16} className="text-[#252578]" />
                    <h3 className="text-base font-bold text-gray-900">Date & Sequential Counter</h3>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
                    Segment 3 & 4
                  </span>
                </div>

                <div className="mt-5 space-y-5">
                  {/* Field 3: Date Segment */}
                  <div className="space-y-1.5">
                    <label htmlFor="date-segment-select" className="text-xs font-semibold text-gray-700 uppercase tracking-wider block">
                      Date Segment Pattern
                    </label>
                    <div className="relative">
                      <select
                        id="date-segment-select"
                        value={numberFormatConfig.dateSegment}
                        onChange={(e) => handleDateSegmentChange(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-[#252578] cursor-pointer appearance-none pr-10 shadow-2xs"
                      >
                        {TS094_DATE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={18} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                    <p className="text-xs text-gray-500">
                      Select date segmentation embedded in the ticket ID based on ticket creation timestamp.
                    </p>
                  </div>

                  {/* Field 4: Sequential Number Digit Length */}
                  <div className="pt-4 border-t border-gray-100 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label htmlFor="digit-length-input" className="text-xs font-semibold text-gray-700 uppercase tracking-wider block">
                        Sequential Digit Length <span className="text-red-500">*</span>
                      </label>
                      <span className="text-[11px] font-semibold text-gray-400">Min: 3, Max: 8</span>
                    </div>
                    <div className="relative">
                      <input
                        id="digit-length-input"
                        type="number"
                        min={3}
                        max={8}
                        step={1}
                        value={numberFormatConfig.digitLength}
                        onChange={(e) => handleDigitLengthChange(e.target.value)}
                        className={`w-full rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-[#252578] shadow-2xs transition-all pr-12 ${
                          numberFormatErrors.digitLength ? 'border-red-300 ring-1 ring-red-300' : 'border-gray-200'
                        }`}
                      />
                      <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 pointer-events-none">
                        digits
                      </span>
                    </div>
                    {numberFormatErrors.digitLength ? (
                      <p className="text-xs font-semibold text-red-600 flex items-center gap-1 mt-1">
                        <AlertCircle size={13} /> {numberFormatErrors.digitLength}
                      </p>
                    ) : (
                      <p className="text-xs text-gray-500">
                        Default length is <span className="font-semibold text-gray-700">4</span> (e.g. 0001). This field is mandatory to guarantee unique ticket numbers.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-gray-100 text-xs text-gray-400">
                Sequential counter increments globally upon every newly registered ticket.
              </div>
            </div>
          </div>

          {/* Active Configuration Summary Card */}
          <div className="rounded-2xl border border-gray-200 bg-gradient-to-r from-gray-50 via-white to-gray-50 p-5 sm:p-6 shadow-xs">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">
              Configured Format Breakdown
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-xl border border-gray-200/80 bg-white p-4 shadow-2xs">
                <span className="text-xs text-gray-500 block">Prefix</span>
                <span className="mt-1 inline-flex items-center gap-1.5 font-bold text-gray-900 font-mono">
                  <CheckCircle2 size={13} className="text-green-600" />
                  {numberFormatConfig.prefix?.trim().toUpperCase() || 'TKT'}
                </span>
              </div>
              <div className="rounded-xl border border-gray-200/80 bg-white p-4 shadow-2xs">
                <span className="text-xs text-gray-500 block">Department Segment</span>
                <span className="mt-1 inline-flex items-center gap-1.5 font-bold text-gray-900 font-mono">
                  {numberFormatConfig.includeDeptCode ? (
                    <>
                      <CheckCircle2 size={13} className="text-amber-600" />
                      {numberFormatConfig.deptCode?.trim().toUpperCase() || 'DEPT'}
                    </>
                  ) : (
                    <span className="text-gray-400 font-sans text-xs font-semibold">Excluded</span>
                  )}
                </span>
              </div>
              <div className="rounded-xl border border-gray-200/80 bg-white p-4 shadow-2xs">
                <span className="text-xs text-gray-500 block">Date Segment</span>
                <span className="mt-1 inline-flex items-center gap-1.5 font-bold text-gray-900">
                  <CheckCircle2 size={13} className="text-blue-600" />
                  {TS094_DATE_OPTIONS.find((o) => o.value === numberFormatConfig.dateSegment)?.value || 'none'}
                </span>
              </div>
              <div className="rounded-xl border border-gray-200/80 bg-white p-4 shadow-2xs">
                <span className="text-xs text-gray-500 block">Digit Length</span>
                <span className="mt-1 inline-flex items-center gap-1.5 font-bold text-gray-900 font-mono">
                  <CheckCircle2 size={13} className="text-purple-600" />
                  {numberFormatConfig.digitLength} digits ({livePreviewSeqPart})
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : tab === TAB_LIMITS ? (
        <div className="flex flex-col gap-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-xl font-bold text-gray-900">Max Open Tickets</h2>
                <div className="relative group inline-flex items-center">
                  <button
                    type="button"
                    aria-label="Open tickets definition"
                    className="text-gray-400 hover:text-[#252578] cursor-help p-0.5 rounded-sm transition-colors"
                  >
                    <Info size={16} />
                  </button>
                  <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden w-80 rounded-xl bg-gray-900 p-3 text-center text-xs text-white shadow-xl group-hover:block z-50 leading-relaxed animate-in fade-in zoom-in-95 duration-150">
                    Active workflow statuses count toward the limit. Closed tickets also count while they remain eligible for reopening; resolved, discarded/cancelled, and closed tickets outside that window do not count.
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
                  <ShieldCheck size={13} className="shrink-0" />
                  <span>Persisted and enforced server-side</span>
                </span>
              </div>
              <p className="text-sm text-gray-500 mt-1">
                The policy is stored system-wide and checked atomically whenever a customer or employee requestor creates a ticket.
              </p>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={handleResetTicketLimit}
                disabled={savingTicketLimit || Boolean(ticketLimitConflict)}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 hover:text-[#252578] transition-all cursor-pointer shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw size={14} />
                Reset to Defaults
              </button>
              <button
                type="button"
                onClick={handleSaveTicketLimit}
                disabled={savingTicketLimit || Boolean(ticketLimitConflict)}
                className="inline-flex items-center gap-2 rounded-xl bg-[#252578] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#1a1a5e] transition-all cursor-pointer shadow-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingTicketLimit ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                {savingTicketLimit ? 'Saving…' : ticketLimitDraftDirty ? 'Save Changes' : 'Save Limit'}
              </button>
            </div>
          </div>

          {ticketLimitConflict && (
            <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3.5 shadow-xs">
              <div className="flex items-start gap-3.5 flex-1">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-600/10 text-amber-700 shrink-0 mt-0.5">
                  <AlertCircle size={18} />
                </div>
                <div className="text-xs sm:text-sm text-amber-950 leading-relaxed">
                  <span className="font-semibold">Configuration changed elsewhere. </span>
                  Your unsaved draft was preserved, but the saved policy is now {ticketLimitConflict.isUnlimited ? 'Unlimited' : `${ticketLimitConflict.limit} tickets`}. Reload the latest value before saving or resetting.
                </div>
              </div>
              <button
                type="button"
                onClick={handleReloadLatestTicketLimit}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 transition-all cursor-pointer shrink-0"
              >
                <RefreshCw size={14} />
                Reload Latest
              </button>
            </div>
          )}

          {/* Informational Non-Retroactive Callout Card */}
          <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 sm:p-5 flex items-start gap-3.5 shadow-xs">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600/10 text-blue-600 shrink-0 mt-0.5">
              <Info size={18} />
            </div>
            <div className="text-xs sm:text-sm text-blue-900 leading-relaxed">
              <span className="font-semibold">Non-Retroactive Notice: </span>
              Lowering this limit will not cancel or close anyone's existing tickets — it will only block new submissions until they fall back under the limit.
            </div>
          </div>

          {/* Configuration Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            {/* Left Card: Threshold Settings */}
            <div className="lg:col-span-2 rounded-2xl border border-gray-200 bg-white p-6 shadow-xs space-y-6">
              <div className="pb-3 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-gray-900">Requester Ticket Limit</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Cap the maximum number of concurrent unresolved tickets a single requester can hold.</p>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                  ticketLimitConfig.isUnlimited
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-blue-50 text-blue-700 border-blue-200'
                }`}>
                  {ticketLimitConfig.isUnlimited ? 'Unlimited Active' : `${ticketLimitConfig.limit} Tickets Limit`}
                </span>
              </div>

              {/* Unlimited Toggle */}
              <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 flex items-start gap-3.5">
                <input
                  id="unlimited-tickets-checkbox"
                  type="checkbox"
                  checked={ticketLimitConfig.isUnlimited}
                  onChange={(e) => handleToggleUnlimited(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-[#252578] focus:ring-[#252578] cursor-pointer"
                />
                <label htmlFor="unlimited-tickets-checkbox" className="text-xs font-bold text-gray-900 cursor-pointer select-none">
                  Unlimited Open Tickets (Default)
                  <span className="block text-[11px] font-normal text-gray-500 mt-0.5">
                    When checked, requesters can submit tickets without any quota restrictions. Matches standard baseline system behavior.
                  </span>
                </label>
              </div>

              {/* Numeric Limit Input */}
              <div className={`space-y-2 transition-all ${ticketLimitConfig.isUnlimited ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>
                <div className="flex items-center justify-between">
                  <label htmlFor="max-tickets-input" className="text-xs font-semibold text-gray-700 uppercase tracking-wider block">
                    Maximum Open Tickets Allowed {!ticketLimitConfig.isUnlimited && <span className="text-red-500">*</span>}
                  </label>
                  <span className="text-[11px] font-semibold text-gray-400">Recommended: 3 – 10 tickets</span>
                </div>
                <div className="relative">
                  <input
                    id="max-tickets-input"
                    type="number"
                    min={1}
                    max={1000}
                    step={1}
                    disabled={ticketLimitConfig.isUnlimited}
                    value={ticketLimitConfig.limit}
                    onChange={(e) => handleLimitNumberChange(e.target.value)}
                    placeholder="5"
                    className={`w-full rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-[#252578] shadow-2xs transition-all pr-14 ${
                      limitError ? 'border-red-300 ring-1 ring-red-300' : 'border-gray-200'
                    }`}
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 pointer-events-none">
                    tickets
                  </span>
                </div>
                {limitError ? (
                  <p className="text-xs font-semibold text-red-600 flex items-center gap-1 mt-1">
                    <AlertCircle size={13} /> {limitError}
                  </p>
                ) : (
                  <p className="text-xs text-gray-500">
                    New submissions are blocked at the limit until a counted ticket becomes exempt or a recently closed ticket leaves the configured reopen window.
                  </p>
                )}
              </div>

              <div className="pt-4 border-t border-gray-100 text-xs text-gray-500 flex items-center justify-between flex-wrap gap-2">
                <span>Customer tickets and Employee internal tickets are counted separately.</span>
                <span className="font-semibold text-indigo-700">Enforced atomically by ticket-service</span>
              </div>
            </div>

            {/* Right Card: Status Inclusion Legend */}
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xs space-y-4">
              <div className="pb-3 border-b border-gray-100">
                <h4 className="text-sm font-bold text-gray-900">What Counts as "Open"?</h4>
                <p className="text-xs text-gray-500 mt-0.5">Statuses evaluated by the quota guard.</p>
              </div>

              <div className="space-y-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 block">
                  Counts Toward Limit (8 Statuses)
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {OPEN_STATUS_SET.map((st) => (
                    <span key={st} className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800 border border-emerald-200/70">
                      <Check size={11} className="text-emerald-600" />
                      {st}
                    </span>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-gray-100 space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700 block">
                  Conditionally Counts
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800 border border-amber-200">
                    <Clock size={11} /> Closed — inside reopen window
                  </span>
                </div>
              </div>

              <div className="pt-3 border-t border-gray-100 space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block">
                  Exempt / Terminal (Do Not Count)
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {['Resolved', 'Discarded / Cancelled', 'Closed — outside reopen window'].map((st) => (
                    <span key={st} className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-500 border border-gray-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
                      {st}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (tab === TAB_BRANCH_CONFIG || tab === TAB_BRANCH_PRIORITY || tab === TAB_BRANCH_CATEGORIES) ? (
        <div className="flex flex-col gap-6">
          {/* Header & Prominent Branch Scope */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-xl font-bold text-gray-900">Branch Configuration</h2>
                  <div className="relative group inline-flex items-center">
                    <Info size={16} className="text-gray-400 hover:text-[#252578] cursor-pointer" />
                    <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden w-80 rounded-xl bg-gray-900 p-3 text-center text-xs text-white shadow-xl group-hover:block z-50 leading-relaxed">
                      Branch-specific categories, priority levels, and SLA policies only apply to the selected branch and override system-wide defaults. If no override is defined, the system-wide default applies.
                      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                    </div>
                  </div>
                  {branchSubSection === BRANCH_SUBTAB_CATEGORIES && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span>Live & Synced with Branch Database</span>
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  {branchSubSection === BRANCH_SUBTAB_CATEGORIES
                    ? 'Manage branch-specific ticket categories and override Category × Priority resolution SLAs for this physical location.'
                    : 'Configure branch-specific response and resolution SLAs per priority level. Settings override system defaults for this physical location.'}
                </p>
              </div>

              <div className="flex items-center gap-3">
                {branchSubSection === BRANCH_SUBTAB_CATEGORIES ? (
                  <button
                    type="button"
                    onClick={handleResetBranchCategories}
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 hover:text-[#252578] transition-all shrink-0 cursor-pointer shadow-xs"
                  >
                    <RotateCcw size={14} />
                    Reset to Defaults
                  </button>
                ) : null}
              </div>
            </div>

            {/* Prominent Branch Selector Banner - Rendered ONCE */}
            <BranchSelector variant="banner" />

            {isGlobalBranchScope && (
              <div className="rounded-xl border border-blue-200 bg-blue-50/80 p-4 text-xs text-blue-900 flex items-start gap-3 shadow-xs">
                <Info size={18} className="text-blue-600 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <p className="font-bold text-blue-950">Global Scope (Viewing System Defaults)</p>
                  <p className="mt-0.5 text-blue-800">
                    You are currently viewing baseline system wide categories and SLA targets. To configure branch specific SLA overrides or supplementary categories for a physical facility, choose an operational branch (Main Office, North Luzon Hub, Cebu City Office) in the branch selector above.
                  </p>
                </div>
              </div>
            )}

            {/* Secondary Pill Toggle: Categories | Priorities & SLA */}
            <div className="flex gap-1 rounded-xl bg-gray-100 p-1 w-fit shadow-xs">
              <button
                type="button"
                onClick={() => setBranchSubSection(BRANCH_SUBTAB_CATEGORIES)}
                className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                  branchSubSection === BRANCH_SUBTAB_CATEGORIES
                    ? 'bg-white text-[#252578] shadow-sm'
                    : 'text-gray-600 hover:text-gray-800'
                }`}
              >
                <Tag size={15} />
                <span>Categories</span>
              </button>
              <button
                type="button"
                onClick={() => setBranchSubSection(BRANCH_SUBTAB_PRIORITIES)}
                className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                  branchSubSection === BRANCH_SUBTAB_PRIORITIES
                    ? 'bg-white text-[#252578] shadow-sm'
                    : 'text-gray-600 hover:text-gray-800'
                }`}
              >
                <Clock size={15} />
                <span>Priorities & SLA</span>
              </button>
            </div>
          </div>

          {/* Sub-Section Content: Categories (TS090) */}
          {branchSubSection === BRANCH_SUBTAB_CATEGORIES ? (
            <div className="flex flex-col gap-8">
              {/* Section 1: Category Management */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm flex flex-col gap-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                  <Tag size={16} className="text-[#252578]" />
                  1. Branch Ticket Categories
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  System defaults ({SYSTEM_DEFAULT_CATEGORIES.join(', ')}) apply everywhere. Define supplementary categories exclusive to {activeBranchName}.
                </p>
              </div>
              <button
                type="button"
                onClick={handleOpenAddCategoryModal}
                className="inline-flex items-center gap-2 rounded-xl bg-[#252578] px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#1f1f60] transition-all cursor-pointer shrink-0"
              >
                <Plus size={14} />
                Add Category
              </button>
            </div>

            {/* Inline Simulation Blocked Error Banner */}
            {categoryError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800 flex items-start justify-between gap-3 shadow-xs animate-fade-slide-in">
                <div className="flex items-start gap-2.5">
                  <AlertCircle size={17} className="shrink-0 text-red-600 mt-0.5" />
                  <div>
                    <p className="font-bold text-red-900">
                      Cannot Remove "{categoryError.categoryName}" Category
                    </p>
                    <p className="mt-0.5 text-red-700 leading-relaxed">
                      {categoryError.message}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setCategoryError(null)}
                  className="text-red-400 hover:text-red-700 text-xs font-bold px-2 py-1 rounded cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Categories Grid */}
            {branchCategoryLoading ? (
              <div className="flex flex-col items-center justify-center p-12 text-center bg-gray-50/50 rounded-xl border border-dashed border-gray-200">
                <RefreshCw size={24} className="animate-spin text-[#252578] mb-3" />
                <p className="text-sm font-semibold text-gray-700">Loading branch categories from server...</p>
                <p className="text-xs text-gray-400 mt-1">Fetching live category records for {activeBranchName}</p>
              </div>
            ) : currentBranchCategories.length === 0 ? (
              <div className="p-8 text-center bg-gray-50 rounded-xl border border-gray-200">
                <p className="text-sm text-gray-500">No categories found for {activeBranchName}. Click "Add Category" above to create one.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {currentBranchCategories.map((cat) => (
                  <div
                    key={cat.id || cat.name}
                    className={`rounded-xl border p-4.5 flex flex-col justify-between gap-4 transition-all hover:shadow-xs ${
                      cat.isSystemDefault
                        ? 'border-gray-200 bg-gray-50/50'
                        : 'border-indigo-100 bg-white ring-1 ring-indigo-50'
                    }`}
                  >
                    <div className="flex flex-col gap-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-sm font-bold text-gray-900 leading-snug break-words">
                          {cat.name}
                        </h4>
                        {cat.isSystemDefault ? (
                          <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-semibold text-gray-600 border border-gray-200">
                            System Default
                          </span>
                        ) : (
                          <span className="shrink-0 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 border border-indigo-200">
                            Branch Custom
                          </span>
                        )}
                      </div>

                      {cat.description && (
                        <p className="text-xs text-gray-500 line-clamp-2">
                          {cat.description}
                        </p>
                      )}

                      <div className="flex items-center gap-2">
                        {cat.inUse ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                            {cat.openTicketCount ?? cat.activeTicketCount ?? 1} Open Ticket(s) in Branch
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                            0 open tickets
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-gray-100 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-gray-400">
                        {cat.isSystemDefault ? 'Applies system-wide' : `Scoped to ${activeBranchName}`}
                      </span>

                      <div className="flex items-center gap-1.5">
                        {cat.isSystemDefault ? (
                          <span className="text-[11px] font-medium text-gray-400 italic">
                            Protected default
                          </span>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => handleRemoveCategory(cat)}
                              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 transition-all cursor-pointer"
                              title="Remove category from this branch"
                            >
                              <Trash2 size={13} />
                              Remove
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenEditCategoryModal(cat)}
                              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-all cursor-pointer shadow-xs"
                            >
                              <Edit3 size={13} />
                              Edit
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 2: SLA Policy Management */}
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                  <Clock size={16} className="text-[#252578]" />
                  2. Category × Priority SLA Policies
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Resolution time limits per Category and Priority combination for {activeBranchName}. Combos with no override inherit the system-wide baseline.
                </p>
              </div>

              {/* Category Filter Pills */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setSlaCategoryFilter('ALL')}
                  className={`rounded-lg px-3 py-1 text-xs font-semibold transition-all cursor-pointer ${
                    slaCategoryFilter === 'ALL'
                      ? 'bg-[#252578] text-white shadow-xs'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  All ({currentBranchCategories.length})
                </button>
                {currentBranchCategories.map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => setSlaCategoryFilter(c.name)}
                    className={`rounded-lg px-3 py-1 text-xs font-semibold transition-all cursor-pointer ${
                      slaCategoryFilter === c.name
                        ? 'bg-[#252578] text-white shadow-xs'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Matrix grouped by Category */}
            <div className="flex flex-col gap-5">
              {currentBranchCategories
                .filter((c) => slaCategoryFilter === 'ALL' || slaCategoryFilter === c.name)
                .map((cat) => {
                  const combos = currentBranchSlaMatrix.filter(
                    (m) => m.categoryName.toLowerCase() === cat.name.toLowerCase()
                  );
                  const overrideCount = combos.filter((m) => !m.isInherited).length;

                  return (
                    <div
                      key={cat.name}
                      className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs flex flex-col gap-4"
                    >
                      {/* Category Header */}
                      <div className="flex items-center justify-between border-b border-gray-100 pb-3 flex-wrap gap-2">
                        <div className="flex items-center gap-2.5">
                          <h4 className="text-sm font-bold text-gray-900">{cat.name}</h4>
                          {cat.isSystemDefault ? (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600 border border-gray-200">
                              System Default Category
                            </span>
                          ) : (
                            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 border border-indigo-200">
                              Branch Custom Category
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-gray-500">
                          {overrideCount > 0 ? (
                            <span className="text-indigo-700 font-semibold">
                              {overrideCount} Override{overrideCount > 1 ? 's' : ''} Active
                            </span>
                          ) : (
                            'All 4 priorities using system-wide defaults'
                          )}
                        </span>
                      </div>

                      {/* 4 Priorities Grid */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                        {combos.map((item) => (
                          <div
                            key={item.priorityName}
                            className={`rounded-xl border p-4 flex flex-col justify-between gap-3.5 transition-all ${
                              item.isInherited
                                ? 'border-gray-200 bg-gray-50/60'
                                : 'border-indigo-200 bg-indigo-50/30 ring-1 ring-indigo-100'
                            }`}
                          >
                            <div className="flex flex-col gap-2.5">
                              {/* Priority Badge + Inherited Status Badge */}
                              <div className="flex items-center justify-between gap-1 flex-wrap">
                                <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${item.priorityColor}`}>
                                  {item.priorityName}
                                </span>
                                {item.isInherited ? (
                                  <span className="text-[10px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full border border-gray-200">
                                    System default
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#252578] bg-[#252578]/10 px-2 py-0.5 rounded-full border border-[#252578]/20">
                                    <Sparkles size={10} />
                                    Override
                                  </span>
                                )}
                              </div>

                              {/* Target Resolution Time */}
                              <div>
                                <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">
                                  Resolution Target
                                </span>
                                <div className="mt-0.5 flex items-baseline gap-1.5">
                                  <span className="text-base font-bold text-gray-900">
                                    {formatMinutes(item.resolutionTimeLimit)}
                                  </span>
                                  <span className="text-[11px] text-gray-400">
                                    ({item.resolutionTimeLimit}m)
                                  </span>
                                </div>
                              </div>

                              {/* Baseline Reference */}
                              <div className="text-[11px] text-gray-500 pt-2 border-t border-gray-100/80">
                                <span className="text-gray-400">System default: </span>
                                <span className="font-semibold text-gray-700">
                                  {formatMinutes(item.sysDefaultResolution)}
                                </span>
                              </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="pt-2 border-t border-gray-100 flex items-center justify-end gap-1.5">
                              {item.isInherited ? (
                                <button
                                  type="button"
                                  onClick={() => handleOpenSlaPolicyModal(item)}
                                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#252578] px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-[#1f1f60] transition-all cursor-pointer"
                                >
                                  <Plus size={12} />
                                  Set Override
                                </button>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveSlaPolicy(item)}
                                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 transition-all cursor-pointer"
                                    title="Revert to system default"
                                  >
                                    <RotateCcw size={12} />
                                    Revert
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenSlaPolicyModal(item)}
                                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-all cursor-pointer shadow-xs"
                                  >
                                    <Edit3 size={12} />
                                    Edit
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* TS090: Add / Edit Category Modal */}
          {editingCategory && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px] animate-fade-slide-in">
              <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl flex flex-col gap-5">
                <div className="flex items-start justify-between border-b border-gray-100 pb-3">
                  <div>
                    <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md">
                      {activeBranchName}
                    </span>
                    <h3 className="text-lg font-bold text-gray-900 mt-1">
                      {editingCategory.isNew ? 'Add Branch Ticket Category' : 'Edit Branch Ticket Category'}
                    </h3>
                  </div>
                </div>

                {categoryModalError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex items-center gap-2">
                    <AlertCircle size={15} className="shrink-0 text-red-600" />
                    <span>{categoryModalError}</span>
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                    Category Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={editingCategory.name}
                    onChange={(e) => {
                      setEditingCategory({ ...editingCategory, name: e.target.value });
                      setCategoryModalError('');
                    }}
                    placeholder="e.g. Biomedical Facility Maintenance"
                    className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 focus:border-[#252578] focus:ring-1 focus:ring-[#252578] outline-none"
                    autoFocus
                  />
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    This category will only apply to tickets assigned to {activeBranchName}.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-600">
                    Description <span className="text-gray-400 font-normal">(Optional)</span>
                  </label>
                  <textarea
                    rows={2}
                    value={editingCategory.description || ''}
                    onChange={(e) => {
                      setEditingCategory({ ...editingCategory, description: e.target.value });
                      setCategoryModalError('');
                    }}
                    placeholder="Brief description of when to select this category"
                    className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 focus:border-[#252578] focus:ring-1 focus:ring-[#252578] outline-none resize-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setEditingCategory(null)}
                    disabled={branchCategorySaving}
                    className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-all cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveCategory}
                    disabled={branchCategorySaving}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#252578] px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#1f1f60] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {branchCategorySaving && <RefreshCw size={13} className="animate-spin" />}
                    {editingCategory.isNew ? 'Create Category' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TS090: Set / Edit SLA Policy Modal */}
          {editingSlaPolicy && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px] animate-fade-slide-in">
              <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl flex flex-col gap-5">
                <div className="flex items-start justify-between border-b border-gray-100 pb-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-gray-800 bg-gray-100 px-2 py-0.5 rounded-md">
                        {editingSlaPolicy.categoryName}
                      </span>
                      <span className="text-xs font-bold text-gray-400">•</span>
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${editingSlaPolicy.priorityColor}`}>
                        {editingSlaPolicy.priorityName} Priority
                      </span>
                      <span className="text-xs font-bold text-gray-400">•</span>
                      <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md">
                        {activeBranchName}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 mt-1">
                      {editingSlaPolicy.isNew ? 'Set Category SLA Override' : 'Edit Category SLA Policy'}
                    </h3>
                  </div>
                </div>

                {/* Precedence & Due-Date Info Callout */}
                <div className="rounded-xl border border-blue-100 bg-blue-50/80 p-3.5 text-xs text-blue-900 flex items-start gap-2.5">
                  <Info size={16} className="shrink-0 text-blue-600 mt-0.5" />
                  <div className="leading-relaxed">
                    <p className="font-semibold text-blue-950">Resolution Target Policy (Non-Recalculating)</p>
                    <p className="mt-0.5 text-blue-800">
                      {branchCatSlaPolicy.tooltip}
                    </p>
                  </div>
                </div>

                {slaPolicyModalError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex items-center gap-2">
                    <AlertCircle size={15} className="shrink-0 text-red-600" />
                    <span>{slaPolicyModalError}</span>
                  </div>
                )}

                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
                      <Clock size={13} className="text-[#252578]" />
                      Resolution Time Limit (Minutes) <span className="text-red-500">*</span>
                    </label>
                    <span className="text-xs font-bold text-[#252578]">
                      {formatMinutes(parseInt(editingSlaPolicy.resolutionTimeLimit, 10) || 0) || '0 mins'}
                    </span>
                  </div>

                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={editingSlaPolicy.resolutionTimeLimit}
                    onChange={(e) => {
                      setEditingSlaPolicy({ ...editingSlaPolicy, resolutionTimeLimit: e.target.value });
                      setSlaPolicyModalError('');
                    }}
                    placeholder="e.g. 480"
                    className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 focus:border-[#252578] focus:ring-1 focus:ring-[#252578] outline-none"
                    autoFocus
                  />

                  {/* Preset Chips */}
                  <div>
                    <span className="text-[11px] font-semibold text-gray-500">Quick Presets:</span>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {[
                        { label: '1 hour', mins: 60 },
                        { label: '2 hours', mins: 120 },
                        { label: '4 hours', mins: 240 },
                        { label: '6 hours', mins: 360 },
                        { label: '8 hours', mins: 480 },
                        { label: '24 hours', mins: 1440 },
                        { label: '48 hours', mins: 2880 },
                        { label: '72 hours', mins: 4320 },
                      ].map((preset) => (
                        <button
                          key={preset.mins}
                          type="button"
                          onClick={() => {
                            setEditingSlaPolicy({ ...editingSlaPolicy, resolutionTimeLimit: String(preset.mins) });
                            setSlaPolicyModalError('');
                          }}
                          className={`rounded-lg px-2.5 py-1 text-xs font-medium border transition-all cursor-pointer ${
                            String(editingSlaPolicy.resolutionTimeLimit) === String(preset.mins)
                              ? 'bg-[#252578] text-white border-[#252578]'
                              : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg bg-gray-50 p-2.5 text-xs text-gray-500 flex items-center justify-between border border-gray-100">
                    <span>System default for {editingSlaPolicy.priorityName}:</span>
                    <span className="font-semibold text-gray-800">
                      {formatMinutes(editingSlaPolicy.sysDefaultResolution)} ({editingSlaPolicy.sysDefaultResolution}m)
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setEditingSlaPolicy(null)}
                    disabled={branchCategorySaving}
                    className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-all cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveSlaPolicy}
                    disabled={branchCategorySaving}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#252578] px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#1f1f60] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {branchCategorySaving && <RefreshCw size={13} className="animate-spin" />}
                    {editingSlaPolicy.isNew ? 'Create SLA Override' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          )}
            </div>
          ) : (
            /* Sub-Section Content: Priorities & SLA (TS092) */
            <div className="flex flex-col gap-6">
              {/* Inline Simulation Blocked Error Banner */}
          {branchOverrideError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-800 flex items-start justify-between gap-3 shadow-xs animate-fade-slide-in">
              <div className="flex items-start gap-2.5">
                <AlertCircle size={17} className="shrink-0 text-red-600 mt-0.5" />
                <div>
                  <p className="font-bold text-red-900">
                    Cannot Remove {branchOverrideError.priorityName} Priority Override
                  </p>
                  <p className="mt-0.5 text-red-700 leading-relaxed">
                    {branchOverrideError.message}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setBranchOverrideError(null)}
                className="text-red-400 hover:text-red-700 text-xs font-bold px-2 py-1 rounded cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* SLA change policy (server-provided so the text always matches real behaviour) */}
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3.5 text-xs text-indigo-900 flex items-start gap-2" data-testid="branch-sla-policy-notice">
            <Info size={16} className="text-indigo-600 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <span className="font-bold">When do SLA changes take effect?</span>{' '}
              {branchSlaPolicy.tooltip}
              {branchPriorityLoading && <span className="ml-2 text-indigo-500">Loading…</span>}
            </div>
          </div>

          {/* Priority Level Overrides Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {currentBranchOverrides.map((override) => {
              const sysDefault = override.systemDefault || { responseTimeLimit: 60, resolutionTimeLimit: 1440 };

              return (
                <div
                  key={override.name}
                  className={`rounded-2xl border bg-white p-6 shadow-sm flex flex-col justify-between gap-5 transition-all hover:shadow-md ${
                    override.isInherited ? 'border-gray-200' : 'border-indigo-200 ring-1 ring-indigo-100'
                  }`}
                >
                  <div>
                    {/* Top Row: Priority Badge + Scope Indicator Badge */}
                    <div className="flex items-center justify-between border-b border-gray-100 pb-4 gap-3 flex-wrap">
                      <div className="flex items-center gap-2.5">
                        <span className={`inline-block rounded-full px-3.5 py-1 text-xs font-semibold ${override.color}`}>
                          {override.name} Priority
                        </span>
                        {override.inUse && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                            {override.activeTicketCount} Active Tickets
                          </span>
                        )}
                      </div>

                      {override.isInherited ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600 border border-gray-200">
                          <span>Using system-wide default</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#252578]/10 px-3 py-1 text-xs font-bold text-[#252578] border border-[#252578]/20">
                          <Sparkles size={12} />
                          <span>Branch Override</span>
                        </span>
                      )}
                    </div>

                    {/* Middle: Active Response & Resolution SLAs */}
                    <div className="grid grid-cols-2 gap-3 mt-4">
                      {/* Response Time Card */}
                      <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-3.5">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1">
                          <Clock size={12} className="text-[#252578]" />
                          First Response
                        </span>
                        <div className="mt-1 flex items-baseline gap-1.5">
                          <span className="text-lg font-bold text-gray-900">
                            {formatMinutes(override.responseTimeLimit)}
                          </span>
                          <span className="text-[11px] text-gray-400">
                            ({override.responseTimeLimit}m)
                          </span>
                        </div>
                      </div>

                      {/* Resolution Time Card */}
                      <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-3.5">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 flex items-center gap-1">
                          <Clock size={12} className="text-[#252578]" />
                          Resolution Target
                        </span>
                        <div className="mt-1 flex items-baseline gap-1.5">
                          <span className="text-lg font-bold text-gray-900">
                            {formatMinutes(override.resolutionTimeLimit)}
                          </span>
                          <span className="text-[11px] text-gray-400">
                            ({override.resolutionTimeLimit}m)
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Read-only System-wide Baseline Reference */}
                    <div className="mt-3.5 px-3 py-2 rounded-xl bg-gray-50 border border-gray-100 text-[11px] text-gray-500 flex items-center justify-between flex-wrap gap-2">
                      <span className="font-medium text-gray-600">System-wide Reference:</span>
                      <span className="font-semibold text-gray-700">
                        {formatMinutes(sysDefault.responseTimeLimit)} response / {formatMinutes(sysDefault.resolutionTimeLimit)} resolution
                      </span>
                    </div>
                  </div>

                  {/* Actions Footer */}
                  <div className="pt-3 border-t border-gray-100 flex items-center justify-between gap-3">
                    <span className="text-[11px] text-gray-400">
                      Scope: {activeBranchName} ({selectedBranch?.code || 'GLOBAL'})
                    </span>

                    <div className="flex items-center gap-2">
                      {override.isInherited ? (
                        <button
                          type="button"
                          onClick={() => handleOpenBranchOverrideModal(override)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-[#252578] px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-[#1f1f60] transition-all cursor-pointer"
                        >
                          <Plus size={13} />
                          Set Override
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleRemoveBranchOverride(override)}
                            className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition-all cursor-pointer"
                            title="Remove override and revert to system-wide default"
                          >
                            <Trash2 size={13} />
                            Remove
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenBranchOverrideModal(override)}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-gray-800 shadow-xs hover:bg-gray-50 transition-all cursor-pointer"
                          >
                            <Edit3 size={13} />
                            Edit
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* TS092: Edit / Set Override Modal */}
          {editingBranchOverride && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px] animate-fade-slide-in">
              <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl flex flex-col gap-5">
                {/* Modal Header */}
                <div className="flex items-start justify-between border-b border-gray-100 pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${editingBranchOverride.color}`}>
                        {editingBranchOverride.priorityName} Priority
                      </span>
                      <span className="text-xs font-bold text-gray-400">•</span>
                      <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md">
                        {activeBranchName}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 mt-1">
                      {editingBranchOverride.isNew ? 'Set Branch Priority Override' : 'Edit Branch Priority Override'}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingBranchOverride(null)}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 cursor-pointer"
                  >
                    ✕
                  </button>
                </div>

                {/* Form Fields */}
                <div className="flex flex-col gap-4">
                  {/* Response Time Limit */}
                  <div>
                    <label className="text-xs font-semibold text-gray-700 flex items-center gap-1.5 mb-1">
                      <Clock size={14} className="text-[#252578]" />
                      Response Time Limit (Minutes)
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={editingBranchOverride.responseTimeLimit}
                      onChange={(e) =>
                        setEditingBranchOverride((prev) => ({
                          ...prev,
                          responseTimeLimit: e.target.value,
                        }))
                      }
                      placeholder="e.g. 15"
                      className={`w-full rounded-xl border px-4 py-2.5 text-sm font-semibold outline-none transition-all ${
                        branchModalErrors.responseTimeLimit
                          ? 'border-red-300 bg-red-50/40 text-red-900 focus:ring-2 focus:ring-red-400'
                          : 'border-gray-200 bg-gray-50/50 text-gray-900 focus:bg-white focus:ring-2 focus:ring-[#252578]'
                      }`}
                    />
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-[#252578] font-medium flex items-center gap-1">
                        <Clock size={12} />
                        {formatMinutes(editingBranchOverride.responseTimeLimit) || '0 mins'}
                      </span>
                      <span className="text-gray-400 text-[11px]">
                        System default: {formatMinutes(editingBranchOverride.systemDefault?.responseTimeLimit)}
                      </span>
                    </div>
                    {branchModalErrors.responseTimeLimit && (
                      <p className="text-xs text-red-600 font-semibold mt-1">
                        {branchModalErrors.responseTimeLimit}
                      </p>
                    )}
                  </div>

                  {/* Resolution Time Limit */}
                  <div>
                    <label className="text-xs font-semibold text-gray-700 flex items-center gap-1.5 mb-1">
                      <Clock size={14} className="text-[#252578]" />
                      Resolution Time Limit (Minutes)
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={editingBranchOverride.resolutionTimeLimit}
                      onChange={(e) =>
                        setEditingBranchOverride((prev) => ({
                          ...prev,
                          resolutionTimeLimit: e.target.value,
                        }))
                      }
                      placeholder="e.g. 240"
                      className={`w-full rounded-xl border px-4 py-2.5 text-sm font-semibold outline-none transition-all ${
                        branchModalErrors.resolutionTimeLimit
                          ? 'border-red-300 bg-red-50/40 text-red-900 focus:ring-2 focus:ring-red-400'
                          : 'border-gray-200 bg-gray-50/50 text-gray-900 focus:bg-white focus:ring-2 focus:ring-[#252578]'
                      }`}
                    />
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-[#252578] font-medium flex items-center gap-1">
                        <Clock size={12} />
                        {formatMinutes(editingBranchOverride.resolutionTimeLimit) || '0 mins'}
                      </span>
                      <span className="text-gray-400 text-[11px]">
                        System default: {formatMinutes(editingBranchOverride.systemDefault?.resolutionTimeLimit)}
                      </span>
                    </div>
                    {branchModalErrors.resolutionTimeLimit && (
                      <p className="text-xs text-red-600 font-semibold mt-1">
                        {branchModalErrors.resolutionTimeLimit}
                      </p>
                    )}
                  </div>

                  {/* Operational Impact Notice with Tooltip */}
                  {/* ASSUMPTION: This affects new tickets going forward; existing open tickets' due dates are not recalculated (consistent with TS090/TS100 pattern, pending explicit backend confirmation). */}
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3.5 text-xs text-indigo-900 flex items-start gap-2">
                    <Info size={16} className="text-indigo-600 shrink-0 mt-0.5" />
                    <div className="leading-relaxed">
                      <span className="font-bold">Due-Date Calculation Impact:</span>{' '}
                      {branchSlaPolicy.tooltip} Applies to <strong>{activeBranchName}</strong>.
                    </div>
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setEditingBranchOverride(null)}
                    className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveBranchOverride}
                    className="rounded-xl bg-[#252578] px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#1f1f60] transition-all cursor-pointer"
                  >
                    {branchPrioritySaving ? 'Saving…' : editingBranchOverride.isNew ? 'Create Override' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          )}
            </div>
          )}
        </div>
      ) : tab === TAB_ESCALATION ? (
        <div className="flex flex-col gap-6">
          {/* Page Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Escalation Rules</h2>
              <p className="text-sm text-gray-500 mt-0.5">Define when and how tickets are automatically escalated</p>
            </div>
            <button onClick={handleAddEscalation} className="inline-flex items-center gap-2 rounded-xl bg-[#252578] px-5 py-2.5 text-sm font-semibold text-white transition-all hover:shadow-lg shrink-0">
              <Plus size={18} />
              Add Rule
            </button>
          </div>

          {/* Escalation Rule Cards */}
          <div className="flex flex-col gap-4">
            {escalationRules.length === 0 && (
              <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center text-sm text-gray-500">
                No escalation rules configured.
              </div>
            )}
            {escalationRules.map((rule) => (
              <div
                key={rule.id}
                className={`rounded-2xl border bg-white p-6 shadow-sm transition-all ${rule.isActive ? 'border-gray-200' : 'border-gray-100 opacity-55'
                  }`}
              >
                {/* Header: rule name + status badge + actions */}
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3">
                    <h3 className="text-base font-semibold text-gray-900">{rule.name}</h3>
                    <span className={`inline-block rounded-full px-3 py-0.5 text-xs font-semibold ${rule.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                      {rule.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleToggleEscalation(rule.id)}
                      className={`rounded-full p-2 transition-colors ${rule.isActive ? 'text-gray-400 hover:bg-gray-100' : 'text-gray-300 hover:bg-gray-100'
                        }`}
                      title={rule.isActive ? 'Deactivate' : 'Activate'}
                    >
                      <Power size={16} />
                    </button>
                    <button onClick={() => handleEditEscalation(rule)} className="rounded-full p-2 text-gray-400 hover:bg-gray-100 transition-colors" title="Edit">
                      <Edit3 size={16} />
                    </button>
                    <button onClick={() => handleDeleteEscalation(rule)} className="rounded-full p-2 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors" title="Delete">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                {/* Rule details grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Trigger</p>
                    <p className="text-sm text-gray-800">{rule.trigger}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Condition</p>
                    <p className="text-sm text-gray-800">
                      {(() => {
                        const parts = rule.condition.text.split(rule.condition.highlight);
                        return parts.map((part, i) => (
                          <React.Fragment key={i}>
                            {i > 0 && <span className="font-semibold text-orange-600">{rule.condition.highlight}</span>}
                            {part}
                          </React.Fragment>
                        ));
                      })()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Action</p>
                    <p className="text-sm text-gray-800">{rule.action}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Notify</p>
                    <p className="text-sm font-semibold text-[#252578]">{rule.notify}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : tab === TAB_SLA ? (
        <div className="flex flex-col gap-6">
          {selectedDeptId === null ? (
            /* DEPARTMENT LIST VIEW */
            <div className="flex flex-col gap-5">
              {/* SLA BUSINESS HOURS */}
              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm flex flex-col gap-5">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#252578]/10 text-[#252578]">
                      <Clock size={20} />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-gray-900">Business Hours</h2>
                      <p className="text-sm text-gray-500 mt-0.5">
                        SLA limits only count time inside these working hours, in the selected local timezone.
                      </p>
                    </div>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700 cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      aria-label="Count SLA only during business hours"
                      checked={businessHours.enabled}
                      disabled={businessHoursLoading}
                      onChange={(e) => setBusinessHours((prev) => ({ ...prev, enabled: e.target.checked }))}
                      className="h-4 w-4 accent-[#252578]"
                    />
                    Count SLA only during business hours
                  </label>
                </div>

                {!businessHoursLoading && businessHours.enabled && businessHours.timezone !== browserTimezone && (
                  <div role="alert" className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="flex items-start gap-2 text-sm text-amber-800">
                      <AlertCircle size={16} className="mt-0.5 shrink-0" />
                      <span>
                        Working hours are counted in <strong>{businessHours.timezone}</strong>, not your local time (<strong>{browserTimezone}</strong>).
                        {' '}{businessHours.startTime} to {businessHours.endTime} {businessHours.timezone} is{' '}
                        <strong>{formatTimeInZone(businessHours.startTime, businessHours.timezone, browserTimezone)} to {formatTimeInZone(businessHours.endTime, businessHours.timezone, browserTimezone)}</strong> on your clock, so SLA deadlines will look shifted.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setBusinessHours((prev) => ({ ...prev, timezone: browserTimezone }))}
                      className="inline-flex items-center justify-center rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 shrink-0"
                    >
                      Use {browserTimezone}
                    </button>
                  </div>
                )}

                {businessHoursLoading ? (
                  <div className="h-24 rounded-xl bg-gray-100 animate-pulse" />
                ) : businessHours.enabled ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label htmlFor="bh-timezone" className="mb-1.5 block text-xs font-semibold text-gray-700">Timezone</label>
                      <select
                        id="bh-timezone"
                        value={businessHours.timezone}
                        onChange={(e) => setBusinessHours((prev) => ({ ...prev, timezone: e.target.value }))}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium outline-none focus:ring-2 focus:ring-[#252578]"
                      >
                        {(timezoneOptions.includes(businessHours.timezone) ? timezoneOptions : [businessHours.timezone, ...timezoneOptions]).map((tz) => (
                          <option key={tz} value={tz}>{tz}</option>
                        ))}
                      </select>
                      {businessHours.timezone !== browserTimezone && (
                        <button
                          type="button"
                          onClick={() => setBusinessHours((prev) => ({ ...prev, timezone: browserTimezone }))}
                          className="mt-1.5 text-xs font-semibold text-[#252578] hover:text-[#2E85D8] underline"
                        >
                          Use my local timezone ({browserTimezone})
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="bh-start" className="mb-1.5 block text-xs font-semibold text-gray-700">Start Time</label>
                        <input
                          id="bh-start"
                          type="time"
                          value={businessHours.startTime}
                          onChange={(e) => setBusinessHours((prev) => ({ ...prev, startTime: e.target.value }))}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium outline-none focus:ring-2 focus:ring-[#252578]"
                        />
                      </div>
                      <div>
                        <label htmlFor="bh-end" className="mb-1.5 block text-xs font-semibold text-gray-700">End Time</label>
                        <input
                          id="bh-end"
                          type="time"
                          value={businessHours.endTime}
                          onChange={(e) => setBusinessHours((prev) => ({ ...prev, endTime: e.target.value }))}
                          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium outline-none focus:ring-2 focus:ring-[#252578]"
                        />
                      </div>
                    </div>
                    <div>
                      <span className="mb-1.5 block text-xs font-semibold text-gray-700">Working Days</span>
                      <div className="flex flex-wrap gap-2">
                        {BUSINESS_WEEKDAYS.map((d) => {
                          const active = businessHours.workingDays.includes(d.value);
                          return (
                            <button
                              key={d.value}
                              type="button"
                              aria-pressed={active}
                              onClick={() => setBusinessHours((prev) => ({
                                ...prev,
                                workingDays: active
                                  ? prev.workingDays.filter((v) => v !== d.value)
                                  : [...prev.workingDays, d.value].sort((a, b) => a - b),
                              }))}
                              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${active ? 'border-[#252578] bg-[#252578] text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-[#252578]/40'}`}
                            >
                              {d.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Business hours are off. SLA limits count around the clock, including nights and weekends.
                  </p>
                )}

                {businessHoursError && <p className="text-sm font-medium text-red-600">{businessHoursError}</p>}

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-gray-100 pt-4">
                  <p className="text-xs text-gray-500">
                    Currently saved: SLA limits count {describeBusinessHours(savedBusinessHours)}.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleRecalculateOpenTickets}
                      disabled={businessHoursLoading || recalculatingSlas || businessHoursDirty}
                      title={businessHoursDirty ? 'Save business hours first' : undefined}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:border-[#252578]/40 hover:text-[#252578] disabled:opacity-50"
                    >
                      <RefreshCw size={16} className={recalculatingSlas ? 'animate-spin' : ''} />
                      {recalculatingSlas ? 'Recalculating...' : 'Recalculate Open Tickets'}
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveBusinessHours}
                      disabled={businessHoursLoading || businessHoursSaving || !businessHoursDirty}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#252578] px-5 py-2.5 text-sm font-semibold text-white transition-all hover:shadow-lg disabled:opacity-50"
                    >
                      <Save size={16} />
                      {businessHoursSaving ? 'Saving...' : 'Save Business Hours'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Departments</h2>
                  <p className="text-sm text-gray-500 mt-0.5">Click a department below to view and configure its SLA priority rules.</p>
                </div>
              </div>

              {items.departments.length === 0 ? (
                <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center text-sm text-gray-500">
                  No departments found.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-5">
                  {items.departments.map((dept) => {
                    const summary = getDeptRuleSummary(dept.id);
                    const deptRules = items.slaRules.filter((r) => String(r.department_id) === String(dept.id));

                    return (
                      <div
                        key={dept.id}
                        onClick={() => setSelectedDeptId(String(dept.id))}
                        className="group relative cursor-pointer rounded-2xl border border-gray-200 bg-white p-6 transition-all duration-200 hover:border-[#252578] hover:shadow-lg flex flex-col justify-between gap-5"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-center gap-3.5">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#252578]/10 text-[#252578] transition-all group-hover:bg-[#252578] group-hover:text-white">
                              <Building2 size={24} />
                            </div>
                            <div>
                              <h3 className="text-lg font-semibold text-gray-900 group-hover:text-[#252578] transition-colors">{dept.name}</h3>
                              <p className="text-xs text-gray-500">{dept.description || 'Department support team'}</p>
                            </div>
                          </div>

                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-50 text-gray-400 transition-all group-hover:bg-[#252578]/10 group-hover:text-[#252578]">
                            <ChevronRight size={18} />
                          </div>
                        </div>

                        {/* Summary Rules Preview Chips */}
                        <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
                          {priorityList.map((p) => {
                            const matchedRule = deptRules
                              .filter((r) => String(r.priority || '').toLowerCase() === p.name.toLowerCase())
                              .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')) || Number(b.id) - Number(a.id))[0];
                            return (
                              <div
                                key={p.name}
                                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium border ${p.badgeClass}`}
                              >
                                <span>{p.name}:</span>
                                {matchedRule ? (
                                  <span className="font-semibold">{formatMinutes(matchedRule.response_time_limit)} / {formatMinutes(matchedRule.resolution_time_limit)}</span>
                                ) : (
                                  <span className="italic text-gray-400">Not set</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* SELECTED DEPARTMENT DETAILED SLA RULES VIEW */
            <div className="flex flex-col gap-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <button
                  onClick={() => setSelectedDeptId(null)}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-[#252578] hover:text-[#1a1a5c] transition-colors w-fit"
                >
                  <ArrowLeft size={18} />
                  Back to All Departments
                </button>

                <button
                  onClick={handleSaveDepartmentSla}
                  disabled={savingSla}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#252578] px-6 py-2.5 text-sm font-semibold text-white transition-all hover:shadow-lg disabled:opacity-50 shrink-0"
                >
                  <Save size={18} />
                  {savingSla ? 'Saving...' : `Save SLA Rules for ${currentDeptObj?.name || 'Department'}`}
                </button>
              </div>

              <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm flex flex-col gap-6">
                <div className="flex items-center gap-3.5 border-b border-gray-100 pb-5">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#252578] text-white">
                    <Building2 size={24} />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">{currentDeptObj?.name} Department SLA Rules</h2>
                    <p className="text-xs text-gray-500 mt-0.5">Fill out response and resolution time limits (in minutes, hours, or days) for every ticket priority level.</p>
                    <p className="text-xs font-medium text-[#252578] mt-1 flex items-center gap-1">
                      <Clock size={12} />
                      Limits count {describeBusinessHours(savedBusinessHours)}.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {priorityList.map((p) => {
                    const formData = departmentSlaForm[p.name] || { response_time_limit: '', resolution_time_limit: '' };
                    return (
                      <div key={p.name} className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs flex flex-col gap-4 transition-all hover:border-[#252578]/30 hover:shadow-md">
                        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                          <span className={`inline-block rounded-full px-3.5 py-1 text-xs font-semibold border ${p.badgeClass}`}>
                            {p.name} Priority
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          {/* Response Time Limit */}
                          <div>
                            <label className="mb-1.5 block text-xs font-semibold text-gray-700">
                              Response Limit
                            </label>
                            <DurationInput
                              ariaLabel={`${p.name} response limit`}
                              minutes={formData.response_time_limit}
                              onChange={(mins) => handleSlaInputChange(p.name, 'response_time_limit', mins)}
                              placeholderMinutes={p.defaultResp}
                            />
                            <p className="mt-1 text-xs font-medium text-[#252578] flex items-center gap-1 min-h-[18px]">
                              {formData.response_time_limit ? (
                                <>
                                  <Clock size={12} />
                                  {formatMinutes(formData.response_time_limit)}
                                </>
                              ) : ''}
                            </p>
                          </div>

                          {/* Resolution Time Limit */}
                          <div>
                            <label className="mb-1.5 block text-xs font-semibold text-gray-700">
                              Resolution Limit
                            </label>
                            <DurationInput
                              ariaLabel={`${p.name} resolution limit`}
                              minutes={formData.resolution_time_limit}
                              onChange={(mins) => handleSlaInputChange(p.name, 'resolution_time_limit', mins)}
                              placeholderMinutes={p.defaultRes}
                            />
                            <p className="mt-1 text-xs font-medium text-[#252578] flex items-center gap-1 min-h-[18px]">
                              {formData.resolution_time_limit ? (
                                <>
                                  <Clock size={12} />
                                  {formatMinutes(formData.resolution_time_limit)}
                                </>
                              ) : ''}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex justify-end pt-3 border-t border-gray-100">
                  <button
                    onClick={handleSaveDepartmentSla}
                    disabled={savingSla}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#252578] px-6 py-3 text-sm font-semibold text-white transition-all hover:shadow-lg disabled:opacity-50"
                  >
                    <Save size={18} />
                    {savingSla ? 'Saving SLA Rules...' : `Save SLA Rules for ${currentDeptObj?.name}`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-4">
            {(tab === TAB_TICKET_CATEGORIES || tab === TAB_EQUIPMENT) && (
              <div className="relative w-full max-w-none flex-1">
                <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder={`Search ${tab === TAB_TICKET_CATEGORIES ? 'ticket categories' : 'categories'}...`}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-[#252578]"
                />
              </div>
            )}
            {tab === TAB_PRIORITY && <div className="flex-1" />}
            <button onClick={handleAdd} className="inline-flex items-center gap-2 rounded-xl bg-[#252578] px-5 py-2.5 text-sm font-semibold text-white transition-all hover:shadow-lg shrink-0">
              <Plus size={18} />
              Add {tab === TAB_TICKET_CATEGORIES ? 'Ticket Category' : tab === TAB_EQUIPMENT ? 'Category' : 'Priority'}
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-gray-100 bg-gray-50/50 text-[11px] font-bold uppercase tracking-wider text-muted-slate">
                <tr>
                  <th className="px-3 py-2.5">ID</th>
                  <th className="px-3 py-2.5">Name</th>
                  {tab === TAB_TICKET_CATEGORIES && <th className="px-3 py-2.5">Description</th>}
                  {tab === TAB_TICKET_CATEGORIES && <th className="px-3 py-2.5">Type</th>}
                  <th className="px-3 py-2.5 text-center w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={tab === TAB_TICKET_CATEGORIES ? 5 : 3} className="px-3 py-8 text-center text-xs text-muted-slate">
                      No {tab === TAB_TICKET_CATEGORIES ? 'ticket categories' : tab === TAB_EQUIPMENT ? 'categories' : 'priorities'} found.
                    </td>
                  </tr>
                )}
                {filtered.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-3 py-2.5 text-xs font-semibold text-[#252578]">{item.id}</td>
                    <td className="px-3 py-2.5 text-xs text-dark-slate font-medium">
                      {tab === TAB_PRIORITY && item.color ? (
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${item.color}`}>{item.name}</span>
                      ) : (
                        item.name
                      )}
                    </td>
                    {tab === TAB_TICKET_CATEGORIES && (
                      <td className="px-3 py-2.5 text-xs text-muted-slate max-w-xs truncate">
                        {item.description || '—'}
                      </td>
                    )}
                    {tab === TAB_TICKET_CATEGORIES && (
                      <td className="px-3 py-2.5 text-xs">
                        {item.is_system_default ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700 border border-blue-200">
                            Core Default
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-semibold text-gray-600 border border-gray-200">
                            Custom
                          </span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={(e) => {
                          if (openMenuId === item.id) { setOpenMenuId(null); setMenuPos(null); return; }
                          const rect = e.currentTarget.getBoundingClientRect();
                          setMenuPos({ x: rect.right - 132, y: rect.bottom + 4 });
                          setOpenMenuId(item.id);
                        }}
                        className="rounded-full p-1.5 text-muted-slate hover:bg-gray-100 hover:text-dark-slate menu-trigger cursor-pointer"
                        aria-label="Actions"
                      >
                        <MoreVertical size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
        </div>
      </div>

      {openMenuId && menuPos && createPortal(
        (() => {
          const t = filtered.find((x) => x.id === openMenuId);
          return t ? (
            <div data-menu-id={t.id} style={{ position: 'fixed', left: menuPos.x, top: menuPos.y, zIndex: 9999 }}
              className="w-36 rounded-xl border border-gray-200 bg-white shadow-lg">
              <button onClick={() => { handleEdit(t); }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 rounded-t-xl">
                Edit
              </button>
              {tab === TAB_TICKET_CATEGORIES && t.is_system_default ? (
                <button disabled title="System default categories cannot be deleted"
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-gray-400 cursor-not-allowed rounded-b-xl opacity-60">
                  Delete
                </button>
              ) : (
                <button onClick={() => { handleDelete(t); }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 rounded-b-xl">
                  Delete
                </button>
              )}
            </div>
          ) : null;
        })(),
        document.body
      )}

      {/* Equipment / Priority / Ticket Category Modal */}
      {editingItem !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px]">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-5">
              <h2 className="text-lg font-bold text-gray-900">{editingItem.id === null ? 'Add' : 'Edit'} {tab === TAB_TICKET_CATEGORIES ? 'Ticket Category' : tab === TAB_EQUIPMENT ? 'Category' : 'Priority'}</h2>
              <button type="button" onClick={() => setEditingItem(null)} className="p-2 text-gray-400 hover:text-gray-600">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 flex flex-col gap-5">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder={`Enter ${tab === TAB_TICKET_CATEGORIES ? 'ticket category (e.g. IT, Service, Network)' : tab === TAB_EQUIPMENT ? 'category' : 'priority'} name`}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#252578]"
                />
              </div>
              {tab === TAB_TICKET_CATEGORIES && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">Description (Optional)</label>
                  <textarea
                    rows={3}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="Brief description of issues covered by this category..."
                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#252578] resize-none"
                  />
                </div>
              )}
              {tab === TAB_PRIORITY && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">Color</label>
                  <div className="flex flex-wrap gap-2">
                    {priorityColorOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setEditColor(opt.value)}
                        className={`h-8 w-8 rounded-full border-2 transition-all ${opt.value.split(' ')[0]} ${editColor === opt.value ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                        title={opt.label}
                      />
                    ))}
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-1">
                <button onClick={() => setEditingItem(null)} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-100">Cancel</button>
                <button onClick={handleSaveItem} disabled={!editName.trim()} className="rounded-xl bg-[#252578] px-5 py-2.5 text-sm font-semibold text-white transition-all hover:shadow-lg disabled:opacity-50">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Workflow Status Modal */}
      {editingWorkflow !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px]">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-5">
              <h2 className="text-lg font-bold text-gray-900">{editingWorkflow.id === null ? 'Add' : 'Edit'} Workflow Status</h2>
              <button type="button" onClick={() => setEditingWorkflow(null)} className="p-2 text-gray-400 hover:text-gray-600">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 flex flex-col gap-5">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Status Name</label>
                <input
                  type="text"
                  value={editingWorkflow.name}
                  onChange={(e) => setEditingWorkflow({ ...editingWorkflow, name: e.target.value })}
                  placeholder="Enter status name"
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#252578]"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Description</label>
                <textarea
                  value={editingWorkflow.description}
                  onChange={(e) => setEditingWorkflow({ ...editingWorkflow, description: e.target.value })}
                  placeholder="Enter description"
                  rows={3}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#252578] resize-none"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Color</label>
                <div className="flex flex-wrap gap-2">
                  {workflowColorOptions.map((opt) => (
                    <button
                      key={opt.bgColor}
                      type="button"
                      onClick={() => setEditingWorkflow({ ...editingWorkflow, bgColor: opt.bgColor, textColor: opt.textColor })}
                      className={`h-8 w-8 rounded-full border-2 transition-all ${editingWorkflow.bgColor === opt.bgColor ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: opt.bgColor }}
                      title={opt.label}
                    />
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Order / Position</label>
                <input
                  type="number"
                  min="1"
                  value={editingWorkflow.order}
                  onChange={(e) => setEditingWorkflow({ ...editingWorkflow, order: parseInt(e.target.value, 10) || 1 })}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#252578]"
                />
              </div>

              {/* Prerequisite Progression Gate */}
              <div className="rounded-xl border border-gray-200/80 bg-gray-50/70 p-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(editingWorkflow.requiresPreviousFulfilled)}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      const preceding = workflowStatuses
                        .filter((s) => s.id !== editingWorkflow.id && s.order < editingWorkflow.order)
                        .sort((a, b) => a.order - b.order)
                        .slice(-1)[0];
                      setEditingWorkflow({
                        ...editingWorkflow,
                        requiresPreviousFulfilled: checked,
                        prerequisiteStatusId: checked ? (editingWorkflow.prerequisiteStatusId || (preceding?.id || '')) : '',
                      });
                    }}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#252578] focus:ring-[#252578]"
                  />
                  <div className="flex-1">
                    <span className="text-sm font-semibold text-gray-900">Require preceding status to be fulfilled</span>
                    <p className="text-xs text-gray-500 mt-0.5">Tickets cannot transition into this status unless the prerequisite status has been satisfied.</p>
                  </div>
                </label>

                {editingWorkflow.requiresPreviousFulfilled && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <label className="mb-1.5 block text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Specify Prerequisite Status
                    </label>
                    <select
                      value={editingWorkflow.prerequisiteStatusId || ''}
                      onChange={(e) => setEditingWorkflow({ ...editingWorkflow, prerequisiteStatusId: e.target.value ? parseInt(e.target.value, 10) : '' })}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-medium text-gray-800 outline-none focus:ring-2 focus:ring-[#252578]"
                    >
                      <option value="">Immediate preceding status in sequence</option>
                      {workflowStatuses
                        .filter((s) => s.id !== editingWorkflow.id)
                        .sort((a, b) => a.order - b.order)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            Stage {s.order}: {s.name} {s.isSystem ? '(System)' : ''}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-1">
                <button onClick={() => setEditingWorkflow(null)} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-100">Cancel</button>
                <button onClick={handleSaveWorkflow} disabled={!editingWorkflow.name.trim()} className="rounded-xl bg-[#252578] px-5 py-2.5 text-sm font-semibold text-white transition-all hover:shadow-lg disabled:opacity-50">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Escalation Rule Modal */}
      {editingEscalation !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[1.5px]">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-5">
              <h2 className="text-lg font-bold text-gray-900">{editingEscalation.id === null ? 'Add' : 'Edit'} Escalation Rule</h2>
              <button type="button" onClick={() => setEditingEscalation(null)} className="p-2 text-gray-400 hover:text-gray-600">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 flex flex-col gap-5 max-h-[70vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <label className="mb-2 block text-sm font-medium text-gray-700">Rule Name</label>
                  <input
                    type="text"
                    value={editingEscalation.name}
                    onChange={(e) => setEditingEscalation({ ...editingEscalation, name: e.target.value })}
                    placeholder="Enter rule name"
                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#252578]"
                  />
                </div>
                <div className="flex items-center gap-2 ml-4 mt-6">
                  <span className="text-sm text-gray-600">Active</span>
                  <button
                    type="button"
                    onClick={() => setEditingEscalation({ ...editingEscalation, isActive: !editingEscalation.isActive })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${editingEscalation.isActive ? 'bg-green-500' : 'bg-gray-300'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${editingEscalation.isActive ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Trigger</label>
                <input
                  type="text"
                  value={editingEscalation.trigger}
                  onChange={(e) => setEditingEscalation({ ...editingEscalation, trigger: e.target.value })}
                  placeholder="e.g. Response deadline approaching"
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#252578]"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">Condition Text</label>
                  <input
                    type="text"
                    value={editingEscalation.condition.text}
                    onChange={(e) => setEditingEscalation({ ...editingEscalation, condition: { ...editingEscalation.condition, text: e.target.value } })}
                    placeholder="e.g. No response within 30 minutes before deadline"
                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#252578]"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">Highlight Value</label>
                  <input
                    type="text"
                    value={editingEscalation.condition.highlight}
                    onChange={(e) => setEditingEscalation({ ...editingEscalation, condition: { ...editingEscalation.condition, highlight: e.target.value } })}
                    placeholder="e.g. 30 minutes"
                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-orange-400"
                  />
                  <p className="mt-1 text-xs text-gray-400">This value will appear highlighted in orange.</p>
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Action</label>
                <input
                  type="text"
                  value={editingEscalation.action}
                  onChange={(e) => setEditingEscalation({ ...editingEscalation, action: e.target.value })}
                  placeholder="e.g. Auto-escalate to Senior Engineer"
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#252578]"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Notify</label>
                <input
                  type="text"
                  value={editingEscalation.notify}
                  onChange={(e) => setEditingEscalation({ ...editingEscalation, notify: e.target.value })}
                  placeholder="e.g. CS + Manager"
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#252578]"
                />
              </div>
              <div className="flex justify-end gap-3 pt-1">
                <button onClick={() => setEditingEscalation(null)} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-100">Cancel</button>
                <button onClick={handleSaveEscalation} disabled={!editingEscalation.name.trim()} className="rounded-xl bg-[#252578] px-5 py-2.5 text-sm font-semibold text-white transition-all hover:shadow-lg disabled:opacity-50">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Test Email Modal */}
      {showTestEmailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-gray-100 flex flex-col gap-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#252578]/10 text-[#252578]">
                  <Send size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Send Test Email</h3>
                  <p className="text-xs text-gray-500">Verify your Resend delivery gateway setup</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowTestEmailModal(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                Recipient Email Address
              </label>
              <input
                type="email"
                value={testEmailRecipient}
                onChange={(e) => setTestEmailRecipient(e.target.value)}
                placeholder="your.email@example.com"
                className="w-full rounded-xl border border-gray-200 bg-gray-50/50 px-4 py-2.5 text-sm outline-none focus:border-[#252578] focus:bg-white focus:ring-2 focus:ring-[#252578]/10"
              />
              {emailConfigErrors.testEmail && (
                <p className="text-xs font-semibold text-red-600">{emailConfigErrors.testEmail}</p>
              )}
              <p className="text-[11px] text-gray-400">
                A sample verification alert will be sent from <span className="font-semibold text-gray-600">{emailConfig?.fromName || emailConfig?.from_name || newEmailConfig.fromName || 'SBSI Support'}</span> ({emailConfig?.fromEmail || emailConfig?.from_email || newEmailConfig.fromEmail || 'support@sbs-med.com'}) via Resend.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setShowTestEmailModal(false)}
                disabled={isTestingEmail}
                className="rounded-xl px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleTestEmail}
                disabled={isTestingEmail || !testEmailRecipient.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#252578] px-5 py-2 text-xs font-bold text-white transition-all hover:bg-[#1a1a5e] disabled:opacity-60 cursor-pointer shadow-xs"
              >
                {isTestingEmail ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send size={14} />
                    Send Test Email
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change API Key Modal */}
      {showChangeApiKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-gray-100 flex flex-col gap-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#252578]/10 text-[#252578]">
                  <Key size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Change Resend API Key</h3>
                  <p className="text-xs text-gray-500">Enter a new secret key from your Resend dashboard</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowChangeApiKeyModal(false);
                  setChangeApiKeyInput('');
                  setChangeApiKeyError(null);
                }}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                New API Key <span className="text-red-500">*</span>
              </label>
              <div className="relative flex items-center">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-gray-400">
                  <Key size={16} />
                </div>
                <input
                  type={showChangeApiKey ? 'text' : 'password'}
                  value={changeApiKeyInput}
                  onChange={(e) => {
                    setChangeApiKeyInput(e.target.value);
                    setChangeApiKeyError(null);
                  }}
                  placeholder="re_••••••••••••••••••••••••"
                  autoFocus
                  className={`w-full rounded-xl border pl-10 pr-11 py-2.5 text-sm font-mono outline-none transition-all ${
                    changeApiKeyError
                      ? 'border-red-300 bg-red-50/30 text-red-900 focus:ring-2 focus:ring-red-200'
                      : 'border-gray-200 bg-gray-50/50 text-gray-900 focus:border-[#252578] focus:bg-white focus:ring-2 focus:ring-[#252578]/10'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowChangeApiKey(!showChangeApiKey)}
                  aria-label={showChangeApiKey ? 'Hide API key' : 'Show API key'}
                  className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-gray-400 hover:text-gray-700 transition-colors cursor-pointer"
                >
                  {showChangeApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {changeApiKeyError && (
                <p className="text-xs font-semibold text-red-600">{changeApiKeyError}</p>
              )}
              <p className="text-[11px] text-amber-600 font-medium">
                ⚠️ Once you save, you cannot see the API key again. It will be permanently masked as <span className="font-mono font-semibold text-gray-700">re_•••••••••</span>.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => {
                  setShowChangeApiKeyModal(false);
                  setChangeApiKeyInput('');
                  setChangeApiKeyError(null);
                }}
                className="rounded-xl px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleChangeApiKey}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#252578] px-5 py-2 text-xs font-bold text-white transition-all hover:bg-[#1a1a5e] cursor-pointer shadow-xs"
              >
                <Save size={14} />
                Update API Key
              </button>
            </div>
          </div>
        </div>
      )}

      <NotificationModal
        isOpen={!!notification}
        type={notification?.type}
        title={notification?.title}
        message={notification?.message}
        onClose={closeNotif}
        onConfirm={notification?.onConfirm}
        onCancel={notification?.onCancel}
        confirmText={notification?.confirmText}
        confirmClassName={notification?.confirmClassName}
      />
    </div>
  );
}
