/**
 * Registered machine resolution for the AI escalation flow (spec 0038, AC-1 / AC-2).
 *
 * A ticket may only ever be linked to one of the signed in customer's own
 * registered machines. Matching runs in strict tiers against the supplied texts
 * (chat messages, plus any machine string Gemini returned):
 *   1. exact serial number found in the text (case insensitive)
 *   2. exact model found in the text
 *   3. exact machine name found in the text
 * A brand alone never counts. When a tier matches more than one distinct
 * machine, that tier is treated as ambiguous and skipped, so we never guess.
 * When nothing matches, the result is null; there is no fallback to free text
 * or to the customer's first machine.
 */

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when `needle` appears in `haystack` as a whole token (case insensitive). */
const containsToken = (haystack, needle) => {
  const n = String(needle || '').trim();
  if (n.length < 2 || !haystack) return false;
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(n.toLowerCase())}($|[^a-z0-9])`, 'i');
  return pattern.test(haystack.toLowerCase());
};

const TIERS = ['serial_number', 'model', 'machine_name'];

/**
 * @param {Array<object>} machines   the customer's registered machines (ticketOptions.machines)
 * @param {Array<string>|string} texts text to search (chat messages, Gemini machine string)
 * @returns {object|null} the matched machine, or null
 */
export function resolveRegisteredMachine(machines, texts) {
  if (!Array.isArray(machines) || machines.length === 0) return null;
  const haystack = (Array.isArray(texts) ? texts : [texts])
    .filter((t) => typeof t === 'string' && t.trim() !== '')
    .join(' \n ');
  if (!haystack) return null;

  for (const field of TIERS) {
    const hits = machines.filter((m) => containsToken(haystack, m?.[field]));
    const distinct = [...new Map(hits.map((m) => [String(m.machine_ID), m])).values()];
    if (distinct.length === 1) return distinct[0];
  }
  return null;
}

/** Option label for a registered machine: `<machine_name> (<serial_number>)`. */
export function formatMachineLabel(machine) {
  if (!machine) return '';
  const name = machine.machine_name || machine.model || `Machine ${machine.machine_ID}`;
  return machine.serial_number ? `${name} (${machine.serial_number})` : name;
}

/** De-duplicate customer messages (case and whitespace insensitive), keeping first order. */
export function dedupeMessages(messages) {
  const seen = new Set();
  const out = [];
  for (const raw of messages || []) {
    const text = String(raw || '').trim().replace(/[.\s]+$/, '');
    const key = text.toLowerCase().replace(/\s+/g, ' ');
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/** AC-4 escalation description: no Machine line, problem details listed once. */
export function buildEscalationDescription(title, userMessages) {
  const details = dedupeMessages(userMessages);
  const detailText = details.length > 0 ? details.join('. ') : 'Issue reported via AI Assistant';
  return `Customer reported an issue regarding "${title}". Problem details: ${detailText}. Automated troubleshooting was attempted but the issue persists. Ticket escalated to technical team for follow-up.`;
}
