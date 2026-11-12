import { describe, it, expect } from 'vitest';
import {
  resolveRegisteredMachine,
  formatMachineLabel,
  buildEscalationDescription,
} from './machineMatching';

const machines = [
  { machine_ID: 1, machine_name: 'Hematology Analyzer', model: 'XN-1000', brand: 'Sysmex', serial_number: 'HEM-100-B22' },
  { machine_ID: 2, machine_name: 'Patient Monitor', model: 'VS-900', brand: 'Philips', serial_number: 'MON-500-A11' },
];

describe('resolveRegisteredMachine (spec 0038 AC-1 / AC-2)', () => {
  it('matches on serial number first, case insensitive', () => {
    expect(resolveRegisteredMachine(machines, ['my unit mon-500-a11 keeps beeping'])?.machine_ID).toBe(2);
  });

  it('matches on exact model when no serial is present', () => {
    expect(resolveRegisteredMachine(machines, ['the XN-1000 shows error 42'])?.machine_ID).toBe(1);
  });

  it('matches on exact machine name last', () => {
    expect(resolveRegisteredMachine(machines, ['our patient monitor is dead'])?.machine_ID).toBe(2);
  });

  it('never matches on a brand alone', () => {
    expect(resolveRegisteredMachine(machines, ['the Philips device is broken'])).toBeNull();
  });

  it('returns null for an unregistered machine, with no first machine fallback', () => {
    expect(resolveRegisteredMachine(machines, ['Mindray BC-5390 will not start'])).toBeNull();
  });

  it('does not match a model as a substring of a longer token', () => {
    expect(resolveRegisteredMachine(machines, ['VS-9000 is a different unit'])).toBeNull();
  });

  it('skips an ambiguous tier instead of guessing', () => {
    const twins = [
      { machine_ID: 5, machine_name: 'Monitor A', model: 'VS-900', serial_number: 'S1' },
      { machine_ID: 6, machine_name: 'Monitor B', model: 'VS-900', serial_number: 'S2' },
    ];
    expect(resolveRegisteredMachine(twins, ['VS-900 failing'])).toBeNull();
    expect(resolveRegisteredMachine(twins, ['VS-900 Monitor B failing'])?.machine_ID).toBe(6);
  });

  it('resolves a Gemini machine string against the catalog', () => {
    expect(resolveRegisteredMachine(machines, ['it is broken', 'Philips VS-900'])?.machine_ID).toBe(2);
  });
});

describe('formatMachineLabel', () => {
  it('labels as name (serial)', () => {
    expect(formatMachineLabel(machines[1])).toBe('Patient Monitor (MON-500-A11)');
  });
});

describe('buildEscalationDescription (AC-4)', () => {
  it('has no Machine line and lists each detail once', () => {
    const text = buildEscalationDescription('Monitor Beeping', ['It beeps.', 'it beeps', 'Screen is blank']);
    expect(text).not.toMatch(/Machine:/);
    expect(text).toBe(
      'Customer reported an issue regarding "Monitor Beeping". Problem details: It beeps. Screen is blank. Automated troubleshooting was attempted but the issue persists. Ticket escalated to technical team for follow-up.'
    );
  });
});
