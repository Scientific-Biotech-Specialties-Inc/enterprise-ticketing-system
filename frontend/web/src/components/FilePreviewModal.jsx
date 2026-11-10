import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Image as ImageIcon, FileText, File, X, Download, AlertTriangle, ExternalLink, Loader2 } from 'lucide-react';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';
import { useAttachmentBlobUrl, downloadAttachment, openAttachmentInNewTab } from '@/utils/attachmentFiles';
import { Button } from '@/components/ui/button';

export default function FilePreviewModal({ file, onClose }) {
  useLockBodyScroll(!!file);

  if (!file) return null;

  const fileName =
    file?.name ||
    file?.file_name ||
    (typeof file === 'string' ? file.split('/').pop() : '') ||
    'Attachment';

  const rawUrl =
    file?.url ||
    file?.file_path ||
    file?.path ||
    (typeof file === 'string' ? file : '');

  const [imgError, setImgError] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [actionError, setActionError] = useState('');

  const mimeType = String(file?.file_type || file?.type || file?.mime_type || '').toLowerCase();

  const getExt = (filename) => {
    if (!filename) return '';
    const clean = String(filename).split('?')[0].split('#')[0];
    return clean.includes('.') ? clean.split('.').pop().toLowerCase() : '';
  };

  const ext = getExt(fileName) || getExt(rawUrl) || (mimeType.startsWith('image/') ? 'png' : mimeType.includes('pdf') ? 'pdf' : '');
  const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext) || mimeType.startsWith('image/');
  const isPdf = ext === 'pdf' || mimeType.includes('pdf');
  const isDocx = ['docx', 'doc'].includes(ext) || mimeType.includes('word') || mimeType.includes('officedocument');

  let typeHint;
  if (isPdf) typeHint = 'application/pdf';

  // Spec 0037: files are private. Load them only through the authenticated fetch;
  // there is no fallback to a bare /storage/ URL.
  const { url: blobUrl, loading: blobLoading, error: blobError } = useAttachmentBlobUrl(rawUrl, { typeHint });
  const fetchError = Boolean(blobError);
  const previewUrl = blobUrl;

  useEffect(() => {
    setImgError(false);
    setActionError('');
  }, [rawUrl]);

  const handleDownload = async (e) => {
    if (e) e.preventDefault();
    setIsDownloading(true);
    setActionError('');
    try {
      await downloadAttachment(rawUrl, fileName);
    } catch {
      setActionError('The file could not be downloaded. You may not have access to it.');
    } finally {
      setIsDownloading(false);
    }
  };

  const handleOpenInNewTab = async (e) => {
    if (e) e.preventDefault();
    setActionError('');
    try {
      await openAttachmentInNewTab(rawUrl);
    } catch {
      setActionError('The file could not be opened. You may not have access to it.');
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 transition-all duration-300 font-sans"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-xl shadow-2xl border border-border w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-slate-50/50">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              {isImg ? (
                <ImageIcon className="w-4 h-4 text-primary" />
              ) : isPdf ? (
                <FileText className="w-4 h-4 text-red-600" />
              ) : isDocx ? (
                <FileText className="w-4 h-4 text-accent" />
              ) : (
                <File className="w-4 h-4 text-muted-slate" />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-dark-slate truncate" title={fileName}>
                {fileName}
              </h3>
              <p className="text-[11px] text-muted-slate uppercase font-semibold">
                {isImg ? 'Image File' : isPdf ? 'PDF Document' : isDocx ? 'Word Document' : ext ? `${ext.toUpperCase()} File` : 'Attachment'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-slate hover:text-dark-slate transition-colors p-1.5 hover:bg-slate-200/60 rounded-full cursor-pointer"
            title="Close Preview"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Preview Container */}
        <div className="flex-1 min-h-[45vh] max-h-[72vh] bg-slate-950 flex items-center justify-center p-4 overflow-auto">
          {blobLoading ? (
            <div className="text-center text-slate-400 py-16">
              <Loader2 className="w-9 h-9 animate-spin mx-auto mb-3 text-white/80" />
              <p className="text-xs font-medium">Loading preview...</p>
            </div>
          ) : fetchError ? (
            <div className="text-center text-slate-400 py-16 max-w-md mx-auto">
              <AlertTriangle className="w-12 h-12 mx-auto mb-3 opacity-75 text-amber-400" />
              <p className="text-sm font-semibold text-slate-200">Attachment preview unavailable</p>
              <p className="text-xs text-slate-400 mt-1">
                The file could not be displayed directly. You can try downloading it or opening it in a new window.
              </p>
              <div className="mt-5 flex items-center justify-center gap-3">
                <Button
                  size="sm"
                  onClick={handleDownload}
                  disabled={isDownloading}
                  className="cursor-pointer gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  {isDownloading ? 'Downloading...' : 'Download File'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenInNewTab}
                  className="cursor-pointer gap-1.5 bg-slate-900 border-slate-700 text-slate-200 hover:bg-slate-800"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open in New Tab
                </Button>
              </div>
            </div>
          ) : isImg && !imgError ? (
            <img
              src={previewUrl}
              alt={fileName}
              className="max-w-full max-h-[68vh] object-contain rounded-lg shadow-lg mx-auto"
              onError={() => setImgError(true)}
            />
          ) : isImg && imgError ? (
            <div className="text-center text-slate-400 py-16">
              <AlertTriangle className="w-14 h-14 mx-auto mb-3 opacity-60 text-red-400" />
              <p className="text-sm font-semibold text-slate-300">Could not render image</p>
              <p className="text-xs text-slate-500 mt-1">Please use the download button below to view the file.</p>
            </div>
          ) : isPdf ? (
            <object
              data={previewUrl}
              type="application/pdf"
              className="w-full h-[68vh] rounded-lg border-0 bg-white shadow-md"
            >
              <iframe
                src={previewUrl}
                title={fileName}
                className="w-full h-[68vh] rounded-lg border-0 bg-white"
              >
                <div className="p-8 text-center text-slate-400">
                  <p className="text-sm">Unable to render PDF preview in this browser.</p>
                  <button
                    type="button"
                    onClick={handleDownload}
                    className="mt-3 text-xs text-accent underline font-semibold cursor-pointer"
                  >
                    Click here to download and view PDF
                  </button>
                </div>
              </iframe>
            </object>
          ) : isDocx ? (
            <div className="bg-card rounded-xl p-8 max-w-md w-full shadow-2xl text-center border border-border">
              <div className="w-16 h-16 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-accent" />
              </div>
              <span className="inline-block px-2.5 py-1 bg-blue-100 text-primary text-[10px] font-bold uppercase rounded-full tracking-wider mb-2">
                Microsoft Word Document
              </span>
              <h4 className="text-base font-bold text-dark-slate break-words mb-2">{fileName}</h4>
              <p className="text-xs text-muted-slate mb-6 leading-relaxed">
                Word documents can be downloaded and viewed directly in Microsoft Word or any compatible office viewer.
              </p>
              <div className="flex flex-col gap-2.5">
                <Button
                  type="button"
                  onClick={handleDownload}
                  disabled={isDownloading}
                  className="w-full cursor-pointer gap-2"
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Downloading...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      Download & Open Document
                    </>
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center text-slate-400 py-16">
              <File className="w-14 h-14 mx-auto mb-3 opacity-60 text-slate-400" />
              <p className="text-sm font-semibold text-slate-300">No direct preview available</p>
              <p className="text-xs text-slate-500 mt-1">Please download the file below to view its contents.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 flex items-center justify-between border-t border-border">
          <p className="text-[11px] text-muted-slate truncate max-w-sm" title={actionError || fileName} role={actionError ? 'alert' : undefined}>
            {actionError || fileName}
          </p>
          <div className="flex items-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenInNewTab}
              disabled={!rawUrl}
              className="cursor-pointer gap-1.5"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open in New Tab
            </Button>
            <Button
              size="sm"
              onClick={handleDownload}
              disabled={isDownloading}
              className="cursor-pointer gap-1.5"
            >
              {isDownloading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Downloading...
                </>
              ) : (
                <>
                  <Download className="h-3.5 w-3.5" />
                  Download File
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

