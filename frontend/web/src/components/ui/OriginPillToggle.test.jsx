import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OriginPillToggle } from './OriginPillToggle';

describe('OriginPillToggle', () => {
  it('renders all three origin options: ALL, EXTERNAL, INTERNAL', () => {
    render(<OriginPillToggle value="all" onChange={vi.fn()} />);

    expect(screen.getByRole('tab', { name: 'ALL' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'EXTERNAL' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'INTERNAL' })).toBeInTheDocument();
  });

  it('marks the active option with aria-selected and active styling', () => {
    const { rerender } = render(<OriginPillToggle value="all" onChange={vi.fn()} />);

    const allPill = screen.getByRole('tab', { name: 'ALL' });
    const externalPill = screen.getByRole('tab', { name: 'EXTERNAL' });

    expect(allPill).toHaveAttribute('aria-selected', 'true');
    expect(allPill.className).toContain('bg-brand-primary');
    expect(allPill.className).toContain('text-white');

    expect(externalPill).toHaveAttribute('aria-selected', 'false');
    expect(externalPill.className).toContain('text-muted-slate');

    // Switch to external
    rerender(<OriginPillToggle value="external" onChange={vi.fn()} />);
    expect(allPill).toHaveAttribute('aria-selected', 'false');
    expect(externalPill).toHaveAttribute('aria-selected', 'true');
    expect(externalPill.className).toContain('bg-brand-primary');
  });

  it('calls onChange with lowercase and uppercase tokens when clicked', () => {
    const handleChange = vi.fn();
    render(<OriginPillToggle value="all" onChange={handleChange} />);

    fireEvent.click(screen.getByRole('tab', { name: 'EXTERNAL' }));
    expect(handleChange).toHaveBeenCalledWith('external', 'EXTERNAL');

    fireEvent.click(screen.getByRole('tab', { name: 'INTERNAL' }));
    expect(handleChange).toHaveBeenCalledWith('internal', 'INTERNAL');
  });
});

