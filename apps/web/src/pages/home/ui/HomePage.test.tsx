import { render, screen } from '@testing-library/react';

import { HomePage } from './HomePage';

describe('HomePage', () => {
  it('renders the product name as the main heading', () => {
    render(<HomePage />);

    expect(screen.getByRole('heading', { level: 1, name: 'CriterIA' })).toBeInTheDocument();
  });

  it('shows the logo as decoration next to the name', () => {
    render(<HomePage />);

    expect(screen.getByTestId('ficha')).toHaveAttribute('aria-hidden', 'true');
  });
});
