// Brevo API v3 key checks (spec 0040). The backend verifies the key live; these give fast feedback.
// Brevo SMTP keys (xsmtpsib-) only work on the SMTP relay, never on the REST API.

export const BREVO_API_KEY_MASK = 'xkeysib-•••••••••';

export const getBrevoApiKeyFormatError = (rawKey) => {
  const key = (rawKey || '').trim();
  if (key.startsWith('xsmtpsib-')) return 'This is a Brevo SMTP key. Paste an API v3 key instead.';
  if (!key.startsWith('xkeysib-')) return 'Brevo API Key must start with "xkeysib-".';
  return null;
};
