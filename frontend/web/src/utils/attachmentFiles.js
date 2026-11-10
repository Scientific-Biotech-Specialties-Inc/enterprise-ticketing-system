import { useEffect, useState } from 'react';
import tokenStore from '@/auth/tokenStore';

/**
 * Spec 0037: attachments live on a private disk. The server answers file routes only
 * with a bearer token, so <img src> and plain links can no longer open them. Every
 * viewer loads the bytes through an authenticated fetch and shows them as a blob URL.
 */

const STORAGE_PREFIX = '/api/ticketing/attachment/storage/';
const DOWNLOAD_PREFIX = '/api/ticketing/attachment/download/';

/**
 * Turn any stored attachment reference (legacy `/storage/...` URL, gateway URL,
 * absolute URL, or bare file_path) into its relative file path.
 */
export function toAttachmentPath(input) {
  if (!input) return '';
  let cleaned = String(input).trim().replace(/^https?:\/\/[^/]+/, '');
  const markers = [STORAGE_PREFIX, DOWNLOAD_PREFIX, '/storage/', '/download/'];
  let changed = true;
  while (changed) {
    changed = false;
    for (const marker of markers) {
      if (cleaned.includes(marker)) {
        cleaned = cleaned.substring(cleaned.indexOf(marker) + marker.length);
        changed = true;
        break;
      }
    }
    if (cleaned.startsWith('storage/')) {
      cleaned = cleaned.substring('storage/'.length);
      changed = true;
    }
    if (cleaned.startsWith('download/')) {
      cleaned = cleaned.substring('download/'.length);
      changed = true;
    }
  }
  return cleaned.split('?')[0].split('#')[0].replace(/^\/+/, '');
}

/** Gateway URL for an attachment. `download` asks for a Content-Disposition attachment. */
export function attachmentUrl(input, { download = false } = {}) {
  if (!input) return '';
  const str = String(input);
  if (str.startsWith('blob:') || str.startsWith('data:')) return str;
  const path = toAttachmentPath(str);
  if (!path) return '';
  return `${download ? DOWNLOAD_PREFIX : STORAGE_PREFIX}${path}`;
}

/**
 * Fetch an attachment with the signed in user's bearer token. Resolves to a Blob.
 * Throws on 401, 404, or any non file answer. Never falls back to a public URL.
 */
export async function fetchAttachmentBlob(input, { download = false, typeHint } = {}) {
  const url = attachmentUrl(input, { download });
  if (!url) throw new Error('No attachment path');
  if (url.startsWith('blob:') || url.startsWith('data:')) {
    const res = await fetch(url);
    return res.blob();
  }

  const headers = {};
  const token = tokenStore?.getToken ? tokenStore.getToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers, credentials: 'include' });
  const contentType = res.headers.get('content-type') || '';
  if (!res.ok || contentType.includes('text/html')) {
    const err = new Error(`Attachment request failed (HTTP ${res.status})`);
    err.status = res.status;
    throw err;
  }

  const blob = await res.blob();
  if (typeHint && blob.type !== typeHint) {
    return new Blob([blob], { type: typeHint });
  }
  return blob;
}

/** Download an attachment to the user's device through the authenticated fetch. */
export async function downloadAttachment(input, fileName) {
  const blob = await fetchAttachmentBlob(input, { download: true });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.setAttribute('download', fileName || toAttachmentPath(input).split('/').pop() || 'attachment');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

/**
 * Open an attachment in a new tab. The tab is opened synchronously (so popup blockers
 * allow it) and pointed at the blob once the authenticated fetch finishes.
 */
export async function openAttachmentInNewTab(input) {
  const win = typeof window !== 'undefined' ? window.open('', '_blank') : null;
  try {
    const blob = await fetchAttachmentBlob(input);
    const objectUrl = URL.createObjectURL(blob);
    if (win) {
      win.location.href = objectUrl;
    } else {
      window.open(objectUrl, '_blank');
    }
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  } catch (err) {
    if (win) win.close();
    throw err;
  }
}

/**
 * React hook: load an attachment into a blob URL. Returns { url, loading, error }.
 * The blob URL is revoked when the input changes or the component unmounts.
 */
export function useAttachmentBlobUrl(input, { typeHint, enabled = true } = {}) {
  const [state, setState] = useState({ url: '', loading: Boolean(input && enabled), error: null });

  useEffect(() => {
    if (!input || !enabled) {
      setState({ url: '', loading: false, error: null });
      return undefined;
    }

    let cancelled = false;
    let objectUrl = '';
    setState({ url: '', loading: true, error: null });

    fetchAttachmentBlob(input, { typeHint })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setState({ url: objectUrl, loading: false, error: null });
      })
      .catch((error) => {
        if (!cancelled) setState({ url: '', loading: false, error });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [input, typeHint, enabled]);

  return state;
}
