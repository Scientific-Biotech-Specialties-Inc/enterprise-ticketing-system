import React from 'react';
import { ImageOff } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useAttachmentBlobUrl } from '@/utils/attachmentFiles';
import { cn } from '@/lib/utils';

/**
 * An <img> for a private attachment (spec 0037). Loads the bytes through the
 * authenticated fetch and renders them from a blob URL. Shows a skeleton while
 * loading and a quiet placeholder when the file cannot be opened.
 */
export default function AuthenticatedImage({ src, alt = '', className, fallbackClassName, ...rest }) {
  const { url, loading, error } = useAttachmentBlobUrl(src);

  if (loading) {
    return <Skeleton className={cn(className, fallbackClassName)} aria-label={`Loading ${alt || 'image'}`} />;
  }

  if (error || !url) {
    return (
      <div
        className={cn('flex items-center justify-center bg-muted text-muted-foreground', className, fallbackClassName)}
        role="img"
        aria-label={alt ? `${alt} (unavailable)` : 'Image unavailable'}
      >
        <ImageOff className="h-4 w-4" aria-hidden="true" />
      </div>
    );
  }

  return <img src={url} alt={alt} className={className} {...rest} />;
}
