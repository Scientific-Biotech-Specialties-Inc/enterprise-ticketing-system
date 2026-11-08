import { describe, it, expect, beforeEach } from 'vitest';
import tokenStore, { setToken, getToken, clearToken } from './tokenStore';

describe('tokenStore in-memory token security (OWASP XSS Mitigation)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    clearToken();
  });

  it('stores access token in-memory and leaves sessionStorage / localStorage empty', () => {
    setToken('sample-jwt-token');

    // Token must be accessible via memory getter
    expect(getToken()).toBe('sample-jwt-token');

    // Token must NEVER be written to sessionStorage or localStorage
    expect(sessionStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('access_token')).toBeNull();
  });

  it('purges legacy tokens from storage when setToken is called', () => {
    // Simulate legacy or stale token in storage
    sessionStorage.setItem('access_token', 'legacy-session-token');
    localStorage.setItem('access_token', 'legacy-local-token');

    setToken('new-fresh-token');

    expect(getToken()).toBe('new-fresh-token');
    expect(sessionStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('access_token')).toBeNull();
  });

  it('clears in-memory token and ensures storage remains clean on clearToken', () => {
    setToken('sample-jwt-token');
    expect(getToken()).toBe('sample-jwt-token');

    clearToken();

    expect(getToken()).toBeNull();
    expect(sessionStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('access_token')).toBeNull();
  });
});

