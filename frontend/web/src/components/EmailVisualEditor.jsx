import React, { useState, useRef, useEffect, useCallback } from 'react';
import DOMPurify from 'dompurify';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Code,
  Eye,
  Edit3,
  Sparkles,
  Minus,
  RemoveFormatting,
  ChevronDown,
  Info,
  Send,
  RefreshCw,
  Check,
  Tag
} from 'lucide-react';

const SAMPLE_PLACEHOLDERS = {
  '{customer_name}': 'Jane Doe',
  '{ticket_number}': 'TKT-2026-0042',
  '{ticket_subject}': 'Unable to connect to diagnostic ultrasound scanner',
  '{ticket_priority}': 'High',
  '{ticket_status}': 'In Progress',
  '{previous_status}': 'Open',
  '{agent_name}': 'Alex Smith',
  '{sender_name}': 'Sarah Lee (Support)',
  '{message_preview}': 'We have received your diagnostic log files and ordered the replacement transducer.',
  '{resolved_at}': 'Sep 30, 2026, 10:45 AM',
  '{closed_at}': 'Sep 30, 2026, 11:00 AM',
  '{sla_deadline}': 'Sep 30, 2026, 02:00 PM',
  '{from_name}': 'SBSI Support Team',
};

export default function EmailVisualEditor({
  value = '',
  onChange,
  placeholders = {},
  error,
  subject = '',
  onSendTest,
  isTesting = false,
  superAdminEmail = '',
}) {
  const [mode, setMode] = useState('visual'); // 'visual' | 'html' | 'preview'
  const [showVariableDropdown, setShowVariableDropdown] = useState(false);
  const editorRef = useRef(null);
  const isUpdatingRef = useRef(false);

  // Sync value into contentEditable editor div when switching or loading
  useEffect(() => {
    if (editorRef.current && mode === 'visual') {
      if (editorRef.current.innerHTML !== value) {
        editorRef.current.innerHTML = value || '<p><br></p>';
      }
    }
  }, [value, mode]);

  const handleEditorInput = useCallback(() => {
    if (editorRef.current && onChange) {
      isUpdatingRef.current = true;
      const html = editorRef.current.innerHTML;
      onChange(html);
      setTimeout(() => {
        isUpdatingRef.current = false;
      }, 0);
    }
  }, [onChange]);

  const execCommand = (cmd, val = null) => {
    if (mode !== 'visual') {
      setMode('visual');
      setTimeout(() => {
        if (editorRef.current) {
          editorRef.current.focus();
          document.execCommand(cmd, false, val);
          handleEditorInput();
        }
      }, 50);
      return;
    }

    if (editorRef.current) {
      editorRef.current.focus();
      document.execCommand(cmd, false, val);
      handleEditorInput();
    }
  };

  const insertPlaceholderAtCursor = (token) => {
    if (mode === 'html') {
      // In HTML mode, append or insert token
      const current = value || '';
      onChange(current + token);
      return;
    }

    if (mode !== 'visual') {
      setMode('visual');
    }

    setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.focus();
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const textNode = document.createTextNode(token);
          range.insertNode(textNode);
          range.setStartAfter(textNode);
          range.setEndAfter(textNode);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          document.execCommand('insertText', false, token);
        }
        handleEditorInput();
      }
    }, 50);

    setShowVariableDropdown(false);
  };

  // Generate preview HTML with simulated values
  const previewHtml = React.useMemo(() => {
    let rendered = value || '';
    Object.entries(SAMPLE_PLACEHOLDERS).forEach(([token, val]) => {
      rendered = rendered.split(token).join(val);
    });
    return DOMPurify.sanitize(rendered);
  }, [value]);

  const previewSubject = React.useMemo(() => {
    let rendered = subject || '';
    Object.entries(SAMPLE_PLACEHOLDERS).forEach(([token, val]) => {
      rendered = rendered.split(token).join(val);
    });
    return rendered;
  }, [subject]);

  const availablePlaceholderKeys = Object.keys(placeholders).length > 0
    ? Object.keys(placeholders)
    : Object.keys(SAMPLE_PLACEHOLDERS);

  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white overflow-hidden shadow-xs focus-within:border-[#252578] focus-within:ring-2 focus-within:ring-[#252578]/10 transition-all">
      {/* Top Bar: Mode Switcher & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50/80 px-3 py-2">
        {/* Editor Mode Tabs */}
        <div className="flex items-center gap-1 rounded-lg bg-gray-200/70 p-1">
          <button
            type="button"
            onClick={() => setMode('visual')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              mode === 'visual'
                ? 'bg-white text-[#252578] shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Edit3 size={13} />
            Visual Editor
          </button>

          <button
            type="button"
            onClick={() => setMode('html')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              mode === 'html'
                ? 'bg-white text-[#252578] shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Code size={13} />
            HTML Source
          </button>

          <button
            type="button"
            onClick={() => setMode('preview')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              mode === 'preview'
                ? 'bg-white text-[#252578] shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Eye size={13} />
            Live Preview
          </button>
        </div>

        {/* Right side helper info */}
        <div className="flex items-center gap-2">
          {onSendTest && (
            <button
              type="button"
              disabled={isTesting}
              onClick={onSendTest}
              title={`Send test email with this template to SuperAdmin (${superAdminEmail || 'Admin'})`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#252578]/25 bg-white px-3 py-1.5 text-xs font-bold text-[#252578] hover:bg-[#252578]/5 transition-all cursor-pointer shadow-xs disabled:opacity-50"
            >
              {isTesting ? (
                <>
                  <RefreshCw size={12} className="animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send size={12} />
                  Test Email
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Formatting Toolbar (Active in Visual and HTML Mode) */}
      {mode !== 'preview' && (
        <div className="flex flex-wrap items-center gap-1 border-b border-gray-100 bg-white px-3 py-2 text-gray-700">
          {/* Text Style: Bold, Italic, Underline, Strike */}
          <div className="flex items-center gap-0.5 pr-2 border-r border-gray-200">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                execCommand('bold');
              }}
              title="Bold (Ctrl+B)"
              className="flex h-7 w-7 items-center justify-center rounded hover:bg-gray-100 hover:text-[#252578] transition-colors cursor-pointer"
            >
              <Bold size={14} />
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                execCommand('italic');
              }}
              title="Italic (Ctrl+I)"
              className="flex h-7 w-7 items-center justify-center rounded hover:bg-gray-100 hover:text-[#252578] transition-colors cursor-pointer"
            >
              <Italic size={14} />
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                execCommand('underline');
              }}
              title="Underline (Ctrl+U)"
              className="flex h-7 w-7 items-center justify-center rounded hover:bg-gray-100 hover:text-[#252578] transition-colors cursor-pointer"
            >
              <Underline size={14} />
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                execCommand('strikeThrough');
              }}
              title="Strikethrough"
              className="flex h-7 w-7 items-center justify-center rounded hover:bg-gray-100 hover:text-[#252578] transition-colors cursor-pointer"
            >
              <Strikethrough size={14} />
            </button>
          </div>

          {/* Heading Formatting */}
          <div className="flex items-center gap-0.5 px-2 border-r border-gray-200">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                execCommand('formatBlock', '<h2>');
              }}
              title="Heading 2"
              className="px-1.5 py-0.5 text-xs font-bold rounded hover:bg-gray-100 hover:text-[#252578] transition-colors cursor-pointer"
            >
              H2
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                execCommand('formatBlock', '<h3>');
              }}
              title="Heading 3"
              className="px-1.5 py-0.5 text-xs font-bold rounded hover:bg-gray-100 hover:text-[#252578] transition-colors cursor-pointer"
            >
              H3
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                execCommand('formatBlock', '<p>');
              }}
              title="Normal Paragraph"
              className="px-1.5 py-0.5 text-xs font-medium rounded hover:bg-gray-100 hover:text-[#252578] transition-colors cursor-pointer"
            >
              Normal
            </button>
          </div>

          {/* Lists & Blockquote */}
          <div className="flex items-center gap-0.5 px-2 border-r border-gray-200">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                execCommand('insertUnorderedList');
              }}
              title="Bullet List"
              className="flex h-7 w-7 items-center justify-center rounded hover:bg-gray-100 hover:text-[#252578] transition-colors cursor-pointer"
            >
              <List size={14} />
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                execCommand('insertOrderedList');
              }}
              title="Numbered List"
              className="flex h-7 w-7 items-center justify-center rounded hover:bg-gray-100 hover:text-[#252578] transition-colors cursor-pointer"
            >
              <ListOrdered size={14} />
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                execCommand('formatBlock', '<blockquote>');
              }}
              title="Quote Block"
              className="flex h-7 w-7 items-center justify-center rounded hover:bg-gray-100 hover:text-[#252578] transition-colors cursor-pointer"
            >
              <Quote size={14} />
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                execCommand('insertHorizontalRule');
              }}
              title="Horizontal Divider"
              className="flex h-7 w-7 items-center justify-center rounded hover:bg-gray-100 hover:text-[#252578] transition-colors cursor-pointer"
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                execCommand('removeFormat');
              }}
              title="Clear Formatting"
              className="flex h-7 w-7 items-center justify-center rounded hover:bg-gray-100 hover:text-red-600 transition-colors cursor-pointer"
            >
              <RemoveFormatting size={14} />
            </button>
          </div>

          {/* Variable Insertion Dropdown */}
          <div className="relative ml-auto">
            <button
              type="button"
              onClick={() => setShowVariableDropdown(!showVariableDropdown)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#252578]/20 bg-[#252578]/5 px-2.5 py-1 text-xs font-semibold text-[#252578] hover:bg-[#252578]/10 transition-colors cursor-pointer"
            >
              <Sparkles size={12} className="text-[#252578]" />
              <span>Insert Variable</span>
              <ChevronDown size={12} className={`transition-transform ${showVariableDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showVariableDropdown && (
              <div className="absolute right-0 top-full mt-1.5 w-64 max-h-72 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl z-50 animate-in fade-in zoom-in-95 duration-150">
                <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                  Dynamic Placeholders
                </div>
                {availablePlaceholderKeys.map((token) => (
                  <button
                    key={token}
                    type="button"
                    onClick={() => insertPlaceholderAtCursor(token)}
                    className="w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-[#252578]/5 hover:text-[#252578] transition-colors cursor-pointer group"
                  >
                    <span className="font-mono text-[#252578] font-semibold">{token}</span>
                    <span className="text-[10px] text-gray-400 truncate max-w-[110px]">
                      {placeholders[token] || SAMPLE_PLACEHOLDERS[token] || ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quick Variable Pills Bar */}
      {mode !== 'preview' && (
        <div className="flex items-center gap-1.5 overflow-x-auto px-3 py-1.5 bg-gray-50/50 border-b border-gray-100 scrollbar-none">
          <span className="text-[11px] font-semibold text-gray-400 shrink-0 mr-1 flex items-center gap-1">
            <Tag size={11} /> Quick Tokens:
          </span>
          {availablePlaceholderKeys.slice(0, 5).map((token) => (
            <button
              key={token}
              type="button"
              onClick={() => insertPlaceholderAtCursor(token)}
              title={placeholders[token] || SAMPLE_PLACEHOLDERS[token] || ''}
              className="inline-flex items-center rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-mono font-medium text-gray-700 hover:border-[#252578]/40 hover:bg-[#252578]/5 hover:text-[#252578] shrink-0 transition-colors cursor-pointer"
            >
              + {token}
            </button>
          ))}
        </div>
      )}

      {/* Editor Body depending on mode */}
      {mode === 'visual' ? (
        <div
          ref={editorRef}
          contentEditable
          onInput={handleEditorInput}
          onBlur={handleEditorInput}
          spellCheck={false}
          className="min-h-[220px] max-h-[480px] overflow-y-auto p-4 text-sm text-gray-800 outline-none leading-relaxed prose max-w-none focus:outline-none"
          style={{
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          }}
        />
      ) : mode === 'html' ? (
        <textarea
          rows={10}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="<p>Dear {customer_name},</p><p>...</p>"
          className="min-h-[220px] max-h-[480px] w-full p-4 font-mono text-xs text-gray-800 bg-gray-900/5 outline-none resize-y leading-relaxed border-none focus:ring-0"
        />
      ) : (
        /* Live Preview Container */
        <div className="p-4 sm:p-6 bg-gray-100/70">
          <div className="max-w-2xl mx-auto rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            {/* Mock Email Header */}
            <div className="border-b border-gray-100 bg-gray-50/80 p-4 flex flex-col gap-1.5 text-xs text-gray-600">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-gray-900 text-sm">{previewSubject || '(No Subject)'}</span>
                <span className="rounded bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold">
                  Sample Preview
                </span>
              </div>
              <div className="flex items-center gap-2 text-gray-500">
                <span className="font-semibold text-gray-700">From:</span>
                <span>SBSI Support &lt;support@sbs-med.com&gt;</span>
              </div>
              <div className="flex items-center gap-2 text-gray-500">
                <span className="font-semibold text-gray-700">To:</span>
                <span>Jane Doe &lt;jane.doe@hospital.ph&gt;</span>
              </div>
            </div>

            {/* Rendered Email Content */}
            <div
              className="p-5 sm:p-6 text-sm text-gray-800 leading-relaxed prose max-w-none"
              dangerouslySetInnerHTML={{ __html: previewHtml || '<p className="text-gray-400 italic">No template content to preview.</p>' }}
            />

            {/* Email Footer Notice */}
            <div className="border-t border-gray-100 bg-gray-50 p-3 text-[11px] text-gray-400 text-center">
              This preview replaces template variables with sample diagnostic values.
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-100 text-xs text-red-600 font-medium">
          {error}
        </div>
      )}
    </div>
  );
}
