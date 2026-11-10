import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricCard } from './metric-card';

describe('MetricCard KPI definition (spec 0028 AC-5)', () => {
  it('shows the title and value without a definition icon when no definition is given', () => {
    render(<MetricCard title="Total Tickets" value={7} />);

    expect(screen.getByText('Total Tickets')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('exposes the definition on hover and to assistive technology, and is reachable by keyboard', () => {
    render(
      <MetricCard
        title="SLA Compliance"
        value="60%"
        definition="Tickets that met their SLA target divided by all tickets with an SLA outcome."
      />
    );

    const icon = screen.getByRole('img', { name: /SLA Compliance: Tickets that met their SLA target/i });
    expect(icon).toHaveAttribute('title', 'Tickets that met their SLA target divided by all tickets with an SLA outcome.');
    expect(icon).toHaveAttribute('tabindex', '0');
  });

  it('shows skeleton placeholders while loading, with no definition icon', () => {
    const { container } = render(<MetricCard title="CSAT Score" value="4.5" definition="Average rating." loading />);

    expect(screen.queryByText('CSAT Score')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('applies responsive font sizing and truncation to prevent overflow with long values like Unavailable and No data', () => {
    const { container: unavailableContainer } = render(
      <MetricCard title="CSAT Score" value="Unavailable" />
    );
    const unavailableEl = unavailableContainer.querySelector('p.font-bold');
    expect(unavailableEl).toBeInTheDocument();
    expect(unavailableEl.className).toContain('text-sm');
    expect(unavailableEl.className).toContain('truncate');

    const { container: noDataContainer } = render(
      <MetricCard title="SLA Compliance" value="No data" />
    );
    const noDataEl = noDataContainer.querySelector('p.font-bold');
    expect(noDataEl).toBeInTheDocument();
    expect(noDataEl.className).toContain('text-base');
    expect(noDataEl.className).toContain('truncate');
  });
});
