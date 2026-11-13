import React from 'react';
import { Download, ImageOff } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { downloadAttachment, useAttachmentBlobUrl } from '@/utils/attachmentFiles';

/**
 * Image attachment inside a message bubble (spec 0038 AC-14 / AC-15).
 *
 * The bytes are fetched with the bearer token and rendered from a blob URL
 * (spec 0037 private storage), for customers and staff alike. When the fetch
 * fails, the bubble shows the file name, a download link, and a short
 * "Preview unavailable" note instead of a broken image.
 */
export default function MessageImageAttachment({ fileUrl, fileName, formattedSize, isMine }) {
  const { url, loading, error } = useAttachmentBlobUrl(fileUrl);
  const failed = !loading && (error || !url);

  const handleDownload = (e) => {
    e.preventDefault();
    downloadAttachment(fileUrl, fileName).catch(() =>
      window.alert('This file could not be downloaded. You may not have access to it.')
    );
  };

  return (
    <div className="space-y-1.5 text-left">
      <div
        className={`overflow-hidden rounded-xl border max-w-[280px] sm:max-w-[340px] ${
          isMine ? 'border-white/20 bg-black/10' : 'border-gray-200 bg-gray-50'
        }`}
      >
        {loading && <Skeleton className="w-full h-40" aria-label={`Loading ${fileName}`} />}
        {!loading && url && !error && (
          <img src={url} alt={fileName} className="w-full max-h-[260px] object-contain bg-white block" />
        )}
        {failed && (
          <div
            role="img"
            aria-label={`${fileName} (preview unavailable)`}
            className={`flex items-center gap-2 px-3 py-2 text-[11px] ${isMine ? 'text-white/80' : 'text-slate-500'}`}
          >
            <ImageOff size={14} className="shrink-0" aria-hidden="true" />
            <span>Preview unavailable</span>
          </div>
        )}
        <div
          className={`flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] ${
            isMine ? 'bg-white/10 text-white' : 'bg-gray-50 text-slate-800 border-t border-gray-200'
          }`}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold leading-tight">{fileName}</p>
            {formattedSize && (
              <p className={`text-[10px] ${isMine ? 'text-white/70' : 'text-slate-400'}`}>{formattedSize}</p>
            )}
          </div>
          <a
            href="#"
            role="button"
            onClick={handleDownload}
            className="shrink-0 opacity-80 hover:opacity-100 p-1 rounded"
            title={`Download ${fileName}`}
            aria-label={`Download ${fileName}`}
          >
            <Download size={14} />
          </a>
        </div>
      </div>
    </div>
  );
}
