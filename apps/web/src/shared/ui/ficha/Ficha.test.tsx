import { render, screen } from '@testing-library/react';

import { Ficha } from './Ficha';

const colors = { color: '#2541B2', shadow: '#1A2F85' };

describe('Ficha', () => {
  it('is exposed as an image when it has a title', () => {
    render(<Ficha {...colors} size={64} title="CriterIA" />);

    expect(screen.getByRole('img', { name: 'CriterIA' })).toBeInTheDocument();
  });

  it('is hidden from assistive technology when decorative', () => {
    render(<Ficha {...colors} size={64} />);

    expect(screen.getByTestId('ficha')).toHaveAttribute('aria-hidden', 'true');
  });

  it('drops the smile and text lines at small sizes', () => {
    render(<Ficha {...colors} size={20} />);

    expect(screen.queryByTestId('ficha-smile')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ficha-lines')).not.toBeInTheDocument();
  });

  it('shows the smile from 26 px and the text lines from 48 px', () => {
    const { rerender } = render(<Ficha {...colors} size={32} />);
    expect(screen.getByTestId('ficha-smile')).toBeInTheDocument();
    expect(screen.queryByTestId('ficha-lines')).not.toBeInTheDocument();

    rerender(<Ficha {...colors} size={48} />);
    expect(screen.getByTestId('ficha-lines')).toBeInTheDocument();
  });
});
