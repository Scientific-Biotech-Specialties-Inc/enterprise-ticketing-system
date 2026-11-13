/**
 * Utility functions for detecting and enforcing proper title casing in ticket titles.
 */

export const formatProperTitleCase = (str) => {
  if (!str || typeof str !== 'string') return '';
  const trimmed = str.trim();
  if (!trimmed) return '';

  const minorWords = new Set([
    'a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to', 'from', 'by', 'in', 'of', 'with'
  ]);
  const acronyms = new Set([
    'ai', 'id', 'uv', 'pc', 'ram', 'cpu', 'usb', 'sla', 'xl', 'cs', 'it', 'api', 'db', 'sql'
  ]);

  // When the whole title is shouted ("PRINTER NOT WORKING") every word gets recased. Otherwise words the
  // customer typed with capitals inside (model codes like BC-5390, acronyms like LIS) are kept as typed.
  const letters = trimmed.replace(/[^a-zA-Z]/g, '');
  const isShouting = letters.length > 4 && letters === letters.toUpperCase();

  const words = trimmed.split(/\s+/);
  return words.map((word, index) => {
    // Keep numbers or code-like tokens (e.g. #123, 106)
    if (/^[0-9#]/.test(word)) return word;

    // Handle punctuation attached to word, e.g. "error:" or "(hardware)"
    const cleanWord = word.replace(/^[^\w]+|[^\w]+$/g, '');
    if (!cleanWord) return word;

    const lower = cleanWord.toLowerCase();
    let formattedClean = '';

    if (!isShouting && (/\d/.test(cleanWord) || /[A-Z]/.test(cleanWord.slice(1)))) {
      formattedClean = cleanWord.charAt(0).toUpperCase() + cleanWord.slice(1);
    } else if (acronyms.has(lower)) {
      formattedClean = lower.toUpperCase();
    } else if (index > 0 && index < words.length - 1 && minorWords.has(lower)) {
      formattedClean = lower;
    } else {
      formattedClean = cleanWord.charAt(0).toUpperCase() + cleanWord.slice(1).toLowerCase();
    }

    // Re-attach leading/trailing non-word chars if any
    const lead = word.match(/^[^\w]+/)?.[0] || '';
    const trail = word.match(/[^\w]+$/)?.[0] || '';
    return `${lead}${formattedClean}${trail}`;
  }).join(' ');
};

export const needsProperCasing = (str) => {
  if (!str || typeof str !== 'string') return false;
  const trimmed = str.trim();
  if (trimmed.length < 2) return false;
  const formatted = formatProperTitleCase(trimmed);
  return trimmed !== formatted;
};

export const formatProperSentenceCase = (str) => {
  if (!str || typeof str !== 'string') return '';
  const trimmed = str.trim();
  if (!trimmed) return '';

  const acronyms = new Set([
    'ai', 'id', 'uv', 'pc', 'ram', 'cpu', 'usb', 'sla', 'xl', 'cs', 'it', 'api', 'db', 'sql'
  ]);

  const sentences = trimmed.split(/([.!?]\s+)/);
  return sentences.map((part) => {
    if (!part || /^[.!?]\s+$/.test(part)) return part;
    const words = part.split(/\s+/);
    return words.map((w, idx) => {
      const clean = w.replace(/^[^\w]+|[^\w]+$/g, '').toLowerCase();
      if (acronyms.has(clean)) {
        return w.replace(new RegExp(clean, 'i'), clean.toUpperCase());
      }
      if (idx === 0) {
        return w.charAt(0).toUpperCase() + w.slice(1);
      }
      return w;
    }).join(' ');
  }).join('');
};
