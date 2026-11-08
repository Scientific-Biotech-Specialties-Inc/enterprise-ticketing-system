import '@testing-library/jest-dom';
import { vi } from 'vitest';

if (!window.HTMLElement.prototype.scrollIntoView) {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
}
