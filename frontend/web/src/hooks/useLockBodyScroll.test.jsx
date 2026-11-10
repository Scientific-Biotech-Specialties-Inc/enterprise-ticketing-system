import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import useLockBodyScroll from './useLockBodyScroll';

function ModalHarness({ open }) {
  useLockBodyScroll(open);
  return open ? <div data-testid="modal">Open</div> : null;
}

describe('useLockBodyScroll', () => {
  beforeEach(() => {
    cleanup();
    document.body.removeAttribute('style');
    document.documentElement.removeAttribute('style');
  });

  it('locks background scrolling when active and restores styles when closed', () => {
    const { rerender } = render(<ModalHarness open={true} />);

    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.documentElement.style.overscrollBehavior).toBe('none');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.overscrollBehavior).toBe('none');
    expect(document.body.style.position).toBe('fixed');

    rerender(<ModalHarness open={false} />);

    expect(document.documentElement.style.overflow).toBe('');
    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.position).toBe('');
  });

  it('maintains scroll lock until nested modals have all closed', () => {
    const outer = render(<ModalHarness open={true} />);
    const inner = render(<ModalHarness open={true} />);

    expect(document.body.style.overflow).toBe('hidden');

    inner.unmount();
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.style.position).toBe('fixed');

    outer.unmount();
    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.position).toBe('');
  });
});

