import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PredictiveAnalytics from './PredictiveAnalytics';

// Mock react-chartjs-2 to avoid canvas issues in jsdom
vi.mock('react-chartjs-2', () => ({
  Line: ({ data }) => (
    <div data-testid="line-chart" data-labels={JSON.stringify(data?.labels)}>
      {data?.datasets?.map((ds, idx) => (
        <span key={idx} data-testid={`line-dataset-${idx}`}>
          {ds.label}: {ds.data?.length} items, dash: {JSON.stringify(ds.borderDash || [])}
        </span>
      ))}
    </div>
  ),
  Bar: ({ data }) => (
    <div data-testid="bar-chart" data-labels={JSON.stringify(data?.labels)}>
      {data?.datasets?.map((ds, idx) => (
        <span key={idx} data-testid={`bar-dataset-${idx}`}>
          {ds.label || 'Bar'}: {ds.data?.length} items
        </span>
      ))}
    </div>
  ),
  Doughnut: ({ data }) => (
    <div data-testid="doughnut-chart">
      {data?.labels?.map((l, i) => (
        <span key={i}>{l}</span>
      ))}
    </div>
  ),
}));

describe('PredictiveAnalytics Component Tests', () => {
  const mockBranch = { id: 101, name: 'Metro Regional Hospital' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('covers AC-10 and AC-11: renders projected volume trend with distinct actual and projected datasets', () => {
    render(
      <PredictiveAnalytics
        selectedPreset="Next 7 Days"
        branch={mockBranch}
      />
    );

    expect(screen.getByText('Predictive Insights & Forecasting')).toBeInTheDocument();
    expect(screen.getByText('Metro Regional Hospital')).toBeInTheDocument();

    const lineChart = screen.getByTestId('line-chart');
    expect(lineChart).toBeInTheDocument();

    expect(screen.getAllByText(/Actual Historical/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Projected \(Forecast\)/).length).toBeGreaterThanOrEqual(1);

    const projectedDataset = screen.getByTestId('line-dataset-1');
    expect(projectedDataset.textContent).toContain('dash: [6,4]');
  });

  it('covers AC-10: updates projected total volume when horizon is Next 30 Days', () => {
    render(
      <PredictiveAnalytics
        selectedPreset="Next 30 Days"
        branch={mockBranch}
      />
    );

    expect(screen.getByText('Predicted Tickets')).toBeInTheDocument();
    expect(screen.getByText('245')).toBeInTheDocument();
  });

  it('covers AC-11: identifies recurring issue patterns and equipment failure probability', () => {
    render(
      <PredictiveAnalytics
        selectedPreset="Next 7 Days"
        branch={mockBranch}
      />
    );

    expect(screen.getByText('Recurring Issue Patterns')).toBeInTheDocument();
    expect(screen.getByText('+12% Frequency Growth')).toBeInTheDocument();
    expect(screen.getByText('Equipment Risk Probability')).toBeInTheDocument();
  });

  it('covers AC-12: provides plain language explanation of the 60 day historical basis', () => {
    render(
      <PredictiveAnalytics
        selectedPreset="Next 7 Days"
        branch={mockBranch}
      />
    );

    expect(
      screen.getByText(/Calculated from the last 60 days of ticket creation patterns across Metro Regional Hospital/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Linear regression and 7-day weighted moving averages estimate an upcoming volume/i)
    ).toBeInTheDocument();
  });

  it('covers AC-13: displays read only notice stating views do not mutate staffing or routing', () => {
    render(
      <PredictiveAnalytics
        selectedPreset="Next 7 Days"
        branch={mockBranch}
      />
    );

    expect(
      screen.getByText(/Read-only view — does not alter staffing or routing automatically/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /auto reassign/i })).not.toBeInTheDocument();
  });

  it('covers AC-10 and AC-12: toggles underlying historical and projected raw data table', () => {
    render(
      <PredictiveAnalytics
        selectedPreset="Next 7 Days"
        branch={mockBranch}
      />
    );

    const toggleBtn = screen.getByRole('button', { name: /view underlying data/i });
    expect(toggleBtn).toBeInTheDocument();
    expect(screen.queryByText('Underlying Historical & Projected Data Points')).not.toBeInTheDocument();

    fireEvent.click(toggleBtn);
    expect(screen.getByText('Underlying Historical & Projected Data Points')).toBeInTheDocument();
    expect(screen.getByText('Confidence Margin')).toBeInTheDocument();

    const hideBtn = screen.getByRole('button', { name: /hide underlying data/i });
    fireEvent.click(hideBtn);
    expect(screen.queryByText('Underlying Historical & Projected Data Points')).not.toBeInTheDocument();
  });

  it('covers AC-11 and AC-12: displays informative notice when branch has insufficient history', () => {
    const insufficientData = {
      predictive: {
        insufficient_data: true,
        total_historical_tickets: 8,
      },
    };

    render(
      <PredictiveAnalytics
        selectedPreset="Next 7 Days"
        analyticsData={insufficientData}
        branch={mockBranch}
      />
    );

    expect(screen.getByText('Insufficient History')).toBeInTheDocument();
    expect(screen.getByText(/Not Enough Historical Data for Metro Regional Hospital/i)).toBeInTheDocument();
    expect(screen.getByText(/Currently logged:/i)).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('covers AC-12: renders calculation error card and handles retry callback', () => {
    const onRetryMock = vi.fn();
    const errorData = {
      predictive_error: true,
    };

    render(
      <PredictiveAnalytics
        selectedPreset="Next 7 Days"
        analyticsData={errorData}
        branch={mockBranch}
        onRetry={onRetryMock}
      />
    );

    expect(screen.getByText('Predictive Forecast Unavailable')).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: /retry predictive calculation/i });
    fireEvent.click(retryBtn);
    expect(onRetryMock).toHaveBeenCalledTimes(1);
  });
});
