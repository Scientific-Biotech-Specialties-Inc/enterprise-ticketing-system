import { formatProperTitleCase } from '@/utils/titleCaseUtils';

/**
 * Spec 0043 (AC-3): the auto generated ticket title is `<machine_name> - <Problem>`.
 *
 * Problem comes, in order, from the Gemini escalation title / problem summary (cleaned of
 * greetings and list markers), then the intake symptom (same rule as the AI service's
 * IntakeTitleBuilder), then `Technical Support Request`. The customer's first chat message is
 * never used on its own. With no machine (Software) the title is the Problem alone.
 */

export const MAX_TITLE_LENGTH = 70;
export const FALLBACK_PROBLEM = 'Technical Support Request';
const SEPARATOR = ' - ';

const GREETINGS = [
  'hi there', 'hello there', 'good morning', 'good afternoon', 'good evening', 'good day',
  'please help', 'greetings', 'hello', 'hey', 'hi',
];

const NON_PROBLEMS = new Set([
  ...GREETINGS, 'yes', 'no', 'ok', 'okay', 'help', 'test', 'support', 'not working',
  'new conversation', 'new chat', 'support inquiry',
]);

const EMPTY_ANSWERS = new Set(['n/a', 'na', 'none', 'not available', 'unknown', '-']);

/** Strips greetings, list markers, and `Problem:` style labels from a candidate problem. */
export const cleanProblemText = (value) => {
  let text = String(value || '').trim();
  let changed = true;
  while (changed && text) {
    changed = false;
    const lower = text.toLowerCase();
    for (const greeting of GREETINGS) {
      if (lower === greeting || lower.startsWith(`${greeting} `) || lower.startsWith(`${greeting},`) || lower.startsWith(`${greeting}!`)) {
        text = text.slice(greeting.length).replace(/^[\s,.\-!]+/, '');
        changed = true;
        break;
      }
    }
  }
  text = text.replace(/^(?:[-*•]\s+|\d+[.)\-:](?!\d)\s*|[qQ]\d+[:.]\s*|(?:machine|problem|issue|item|symptom)\s*[:-]\s*)/i, '');
  return text.replace(/[\s.!?;,]+$/, '').trim();
};

const isUsableProblem = (value) => {
  const clean = String(value || '').trim().toLowerCase().replace(/[^\w\s]/g, '');
  return clean.length >= 3 && !NON_PROBLEMS.has(clean);
};

/** Shortens text at a word boundary, ending in `...`. */
const shorten = (text, max) => {
  if (text.length <= max) return text;
  if (max <= 3) return '...';
  const cut = text.slice(0, max - 3);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > Math.floor((max - 3) / 2) ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[\s,;:]+$/, '')}...`;
};

/**
 * Port of AI-service IntakeTitleBuilder: returns the symptom from a numbered intake answer
 * ("1. machine 2. model 3. serial 4. symptom"), or '' when the text is not one.
 */
export const intakeSymptom = (text) => {
  const source = String(text || '').trim();
  const pattern = /(?:^|\s)(\d{1,2})[.)]\s+([\s\S]*?)(?=\s+\d{1,2}[.)]\s+|\s*$)/g;
  const matches = [...source.matchAll(pattern)];
  if (matches.length < 2 || Number(matches[0][1]) !== 1) return '';

  const answers = {};
  for (const match of matches) {
    const value = match[2]
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[\w/&\s]{0,25}?(?:machine|equipment|brand|model|serial|s\/n|symptom|issue|problem|fault|troubleshooting)(?:\s*name|\s*number|\s*code)?\s*[:-]\s*/i, '')
      .trim();
    if (value && !EMPTY_ANSWERS.has(value.replace(/\.$/, '').toLowerCase())) {
      answers[Number(match[1])] = value;
    }
  }

  let key = answers[4] ? 4 : null;
  if (key === null) {
    let bestWords = 2;
    for (const [k, value] of Object.entries(answers)) {
      const words = value.split(/\s+/).length;
      if (words > bestWords) {
        key = Number(k);
        bestWords = words;
      }
    }
  }
  if (key === null) return '';

  const firstSentence = answers[key].split(/(?<=[.!?])\s+/)[0].replace(/[\s.!?;,]+$/, '');
  return firstSentence;
};

/**
 * @param {object} args
 * @param {string} [args.machineName] matched registered machine's machine_name
 * @param {string} [args.geminiTitle] Gemini escalation `title`
 * @param {string} [args.problemSummary] Gemini escalation `problemSummary`
 * @param {string[]} [args.userMessages] the customer's chat messages, searched for a numbered intake answer
 */
export const buildTicketTitle = ({ machineName = '', geminiTitle = '', problemSummary = '', userMessages = [] } = {}) => {
  const candidates = [geminiTitle, problemSummary, ...userMessages.map(intakeSymptom)];
  let problem = '';
  for (const candidate of candidates) {
    const cleaned = cleanProblemText(candidate);
    if (isUsableProblem(cleaned)) {
      problem = cleaned;
      break;
    }
  }
  if (!problem) problem = FALLBACK_PROBLEM;

  problem = formatProperTitleCase(problem);
  const machine = String(machineName || '').trim();

  if (!machine) {
    return shorten(problem, MAX_TITLE_LENGTH);
  }

  // A problem that already names the machine would repeat it.
  if (problem.toLowerCase().startsWith(machine.toLowerCase())) {
    problem = problem.slice(machine.length).replace(/^[\s\-:]+/, '') || FALLBACK_PROBLEM;
    problem = formatProperTitleCase(problem);
  }

  const room = MAX_TITLE_LENGTH - machine.length - SEPARATOR.length;
  return `${machine}${SEPARATOR}${shorten(problem, Math.max(room, 3))}`;
};
