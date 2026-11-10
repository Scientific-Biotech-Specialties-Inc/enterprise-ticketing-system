import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Pagination from './Pagination';

describe('ONE UI Pagination Component Tests', () => {
  it('renders Previous and Next pill buttons with chevrons and page numbers', () => {
    render(
      <Pagination
        totalItems={60}
        itemsPerPage={10}
        currentPage={2}
        onPageChange={vi.fn()}
      />
    );

    // Pill buttons
    const prevBtn = screen.getByRole('button', { name: /previous page/i });
    const nextBtn = screen.getByRole('button', { name: /next page/i });
    expect(prevBtn).toBeInTheDocument();
    expect(nextBtn).toBeInTheDocument();
    expect(prevBtn).toHaveTextContent('Previous');
    expect(nextBtn).toHaveTextContent('Next');

    // Page numbers 1 through 6
    for (let i = 1; i <= 6; i++) {
      expect(screen.getByRole('button', { name: `Page ${i}` })).toBeInTheDocument();
    }
  });

  it('highlights the active page with ONE UI primary token #252578 and aria-current="page"', () => {
    render(
      <Pagination
        totalItems={50}
        itemsPerPage={10}
        currentPage={2}
        onPageChange={vi.fn()}
      />
    );

    const activeBtn = screen.getByRole('button', { name: 'Page 2' });
    expect(activeBtn).toHaveAttribute('aria-current', 'page');
    expect(activeBtn.className).toContain('bg-[#252578]');
    expect(activeBtn.className).toContain('text-white');

    const inactiveBtn = screen.getByRole('button', { name: 'Page 1' });
    expect(inactiveBtn).not.toHaveAttribute('aria-current');
    expect(inactiveBtn.className).toContain('text-[#1E293B]');
  });

  it('disables Previous on page 1 and disables Next on last page', () => {
    const { rerender } = render(
      <Pagination
        totalItems={30}
        itemsPerPage={10}
        currentPage={1}
        onPageChange={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next page/i })).not.toBeDisabled();

    rerender(
      <Pagination
        totalItems={30}
        itemsPerPage={10}
        currentPage={3}
        onPageChange={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /previous page/i })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /next page/i })).toBeDisabled();
  });

  it('calls onPageChange with correct page numbers when buttons are clicked', () => {
    const handlePageChange = vi.fn();
    render(
      <Pagination
        totalItems={50}
        itemsPerPage={10}
        currentPage={3}
        onPageChange={handlePageChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Page 4' }));
    expect(handlePageChange).toHaveBeenCalledWith(4);

    fireEvent.click(screen.getByRole('button', { name: /previous page/i }));
    expect(handlePageChange).toHaveBeenCalledWith(2);

    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(handlePageChange).toHaveBeenCalledWith(4);
  });

  it('renders smart ellipsis when total pages exceeds maxVisible', () => {
    render(
      <Pagination
        totalItems={100}
        itemsPerPage={10}
        currentPage={5}
        onPageChange={vi.fn()}
      />
    );

    // Total pages = 10; current = 5 -> [1, '...', 4, 5, 6, '...', 10]
    expect(screen.getByRole('button', { name: 'Page 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 4' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 5' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 6' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 10' })).toBeInTheDocument();

    const ellipses = screen.getAllByText('…');
    expect(ellipses.length).toBe(2);
  });

  it('supports totalPages prop directly without totalItems', () => {
    render(
      <Pagination
        totalPages={4}
        currentPage={1}
        onPageChange={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Page 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Page 4' })).toBeInTheDocument();
  });

  it('respects hideOnSinglePage prop when totalPages is 1', () => {
    const { container, rerender } = render(
      <Pagination
        totalItems={5}
        itemsPerPage={10}
        currentPage={1}
        hideOnSinglePage={true}
        onPageChange={vi.fn()}
      />
    );

    expect(container.firstChild).toBeNull();

    rerender(
      <Pagination
        totalItems={5}
        itemsPerPage={10}
        currentPage={1}
        hideOnSinglePage={false}
        onPageChange={vi.fn()}
      />
    );

    expect(container.firstChild).not.toBeNull();
  });
});

