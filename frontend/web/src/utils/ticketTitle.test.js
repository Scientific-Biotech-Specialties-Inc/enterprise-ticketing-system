import { describe, expect, it } from 'vitest';
import { buildTicketTitle, cleanProblemText, intakeSymptom, MAX_TITLE_LENGTH } from './ticketTitle';

describe('buildTicketTitle (spec 0043 AC-3)', () => {
  it('joins the machine name and the Gemini title', () => {
    expect(buildTicketTitle({ machineName: 'Mindray BC-5390', geminiTitle: 'results not reaching LIS' }))
      .toBe('Mindray BC-5390 - Results Not Reaching LIS');
  });

  it('falls back to the problem summary, then the intake symptom, then the literal', () => {
    expect(buildTicketTitle({ machineName: 'X1', problemSummary: 'screen flickers' })).toBe('X1 - Screen Flickers');
    expect(buildTicketTitle({
      machineName: 'X1',
      userMessages: ['hi', '1. Yumizen 2. Mindray BC-5390 3. SN-1 4. Results are not reaching the LIS. Since Monday.'],
    })).toBe('X1 - Results Are Not Reaching the LIS');
    expect(buildTicketTitle({ machineName: 'X1', userMessages: ['my analyzer is broken'] }))
      .toBe('X1 - Technical Support Request');
  });

  it('never uses a greeting as the problem', () => {
    expect(buildTicketTitle({ machineName: 'X1', geminiTitle: 'Hello' })).toBe('X1 - Technical Support Request');
  });

  it('uses the problem alone when there is no machine', () => {
    expect(buildTicketTitle({ geminiTitle: 'cannot log in to portal' })).toBe('Cannot Log in to Portal');
  });

  it('keeps the machine whole and shortens the problem past 70 characters', () => {
    const title = buildTicketTitle({
      machineName: 'Siemens Atellica Solution Immunoassay',
      geminiTitle: 'the sample probe keeps crashing into the cuvette wall during every run',
    });
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(title.startsWith('Siemens Atellica Solution Immunoassay - ')).toBe(true);
    expect(title.endsWith('...')).toBe(true);
  });
});

describe('helpers', () => {
  it('cleans greetings and list markers', () => {
    expect(cleanProblemText('Hi, 1. printer jams')).toBe('printer jams');
    expect(cleanProblemText('Problem: no power.')).toBe('no power');
  });

  it('returns no symptom for ordinary text', () => {
    expect(intakeSymptom('the machine is down')).toBe('');
  });
});
