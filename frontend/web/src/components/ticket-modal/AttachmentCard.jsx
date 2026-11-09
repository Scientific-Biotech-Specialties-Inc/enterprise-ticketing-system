import React from 'react';
import { ShieldAlert, Download, Eye } from 'lucide-react';
import { getFileName, getFileUrl, formatFileSize, isQuarantinedFile } from './ticketModalUtils';

/**
 * AttachmentCard component
 * Displays: File-type tile (PDF/PNG), file name, size/type subtitle, View/Download actions
 */
export default function AttachmentCard({
  file,
  onPreview = null,
  className = '',
}) {
  const fileName = getFileName(file);
  const fileUrl = getFileUrl(file);
  const isQuarantined = isQuarantinedFile(file);

  const ext = fileName.split('.').pop()?.toUpperCase() || 'FILE';
  const isPdf = ext === 'PDF';
  const isImg = ['PNG', 'JPG', 'JPEG', 'WEBP', 'GIF'].includes(ext);

  if (isQuarantined) {
    return (
      <div
        className={`flex items-center justify-between p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-800 gap-2.5 ${className}`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-rose-700 truncate line-through" title="Quarantined: Threat detected">
              {fileName}
            </p>
            <span className="text-[10px] text-rose-500 font-bold uppercase">Blocked & Quarantined</span>
          </div>
        </div>
        <span className="text-[10px] font-bold text-rose-600 bg-rose-200 px-2 py-0.5 rounded-full uppercase shrink-0">
          Blocked
        </span>
      </div>
    );
  }

  const badgeColor = isPdf
    ? 'bg-rose-100 text-rose-700'
    : isImg
    ? 'bg-sky-100 text-sky-700'
    : 'bg-slate-100 text-slate-700';

  const actionText = isPdf ? 'PDF · Download' : isImg ? 'Image · Preview' : `${ext} · View`;

  return (
    <div
      onClick={() => onPreview?.({ name: fileName, url: fileUrl })}
      className={`flex items-center justify-between p-3 rounded-xl border border-[#D5D9E4] bg-white hover:bg-[#F5F6FA] cursor-pointer transition-colors shadow-2xs gap-3 ${className}`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-[10px] shrink-0 ${badgeColor}`}
        >
          {ext.slice(0, 4)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-[#1B2033] truncate" title={fileName}>
            {fileName}
          </p>
          <span className="text-[10px] text-[#5A6178]">
            {file?.size ? `${formatFileSize(file.size)} · ` : ''}
            {actionText}
          </span>
        </div>
      </div>

      {fileUrl && (
        <a
          href={fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            e.stopPropagation();
            if (onPreview) {
              e.preventDefault();
              onPreview({ name: fileName, url: fileUrl });
            }
          }}
          className="text-xs font-semibold text-[#1E2A78] hover:underline px-2 py-1 shrink-0"
        >
          {isPdf ? 'Download' : 'View'}
        </a>
      )}
    </div>
  );
}

