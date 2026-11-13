import { describe, it, expect } from 'vitest';
import { BREVO_API_KEY_MASK, getBrevoApiKeyFormatError } from './brevoApiKey';

describe('getBrevoApiKeyFormatError (spec 0040)', () => {
  it('accepts an API v3 key', () => {
    expect(getBrevoApiKeyFormatError('  xkeysib-abc123-def456  ')).toBeNull();
  });

  it('rejects a Brevo SMTP key with a specific message', () => {
    expect(getBrevoApiKeyFormatError('xsmtpsib-abc123')).toMatch(/SMTP key/);
  });

  it('rejects other formats, including old Resend keys and empty input', () => {
    expect(getBrevoApiKeyFormatError('re_abc123')).toMatch(/xkeysib-/);
    expect(getBrevoApiKeyFormatError('')).toMatch(/xkeysib-/);
    expect(getBrevoApiKeyFormatError(undefined)).toMatch(/xkeysib-/);
  });

  it('masks keys with the Brevo prefix', () => {
    expect(BREVO_API_KEY_MASK.startsWith('xkeysib-')).toBe(true);
  });
});
