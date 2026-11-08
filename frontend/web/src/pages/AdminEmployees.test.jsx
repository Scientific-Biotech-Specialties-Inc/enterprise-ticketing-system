import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AdminEmployees from './AdminEmployees';

describe('AdminEmployees Component Tests', () => {
  it('renders the Employee Management header and placeholder coming soon badge', () => {
    render(<AdminEmployees />);

    expect(screen.getAllByText('Employee Management').length).toBeGreaterThan(0);
    expect(screen.getByText('Coming Soon')).toBeInTheDocument();
    expect(screen.getByText(/This feature is currently under development/i)).toBeInTheDocument();
  });
});

