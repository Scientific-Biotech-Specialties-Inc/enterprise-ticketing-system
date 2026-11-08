/**
 * Returns the URL only when it is safe to put in an href/window.open:
 * relative paths and http(s)/blob URLs. Anything else (javascript:, data:, vbscript:) becomes ''.
 */
export function safeUrl(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  // Strip control chars/whitespace browsers ignore inside a scheme (e.g. "java\tscript:")
  const compact = trimmed.replace(/[\u0000- ]/g, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact);
  if (!scheme) return trimmed;
  // Inline raster images are harmless (SVG is excluded: it can carry script)
  if (/^data:image\/(png|jpe?g|gif|webp);/i.test(compact)) return trimmed;
  return ['http', 'https', 'blob'].includes(scheme[1].toLowerCase()) ? trimmed : '';
}
