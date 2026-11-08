const TOKEN_STORAGE_KEY = 'access_token';

// In-memory access token storage (OWASP XSS defense: tokens are kept strictly in memory, never in browser storage)
let accessToken = null;

// Immediately purge any legacy tokens left in browser storage
try {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(TOKEN_STORAGE_KEY);
} catch {
  // Ignore storage access errors
}

export function setToken(token) {
  accessToken = token || null;

  try {
    // Defense-in-depth: Ensure access token is never persisted in browser storage
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage access errors
  }
}

export function getToken() {
  return accessToken;
}

export function clearToken() {
  accessToken = null;

  try {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage access errors
  }
}

export default { setToken, getToken, clearToken };
