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

  it('adds the role badge, legs and the working sway on request', () => {
    const { rerender } = render(<Ficha {...colors} size={34} />);
    expect(screen.queryByTestId('ficha-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ficha-working')).not.toBeInTheDocument();

    rerender(<Ficha {...colors} size={96} rol="lupa" patas trabajando />);

    expect(screen.getByTestId('ficha-badge')).toBeInTheDocument();
    expect(screen.getByTestId('ficha-legs')).toBeInTheDocument();
    expect(screen.getByTestId('ficha-working')).toBeInTheDocument();
    expect(screen.getByTestId('ficha')).toHaveAttribute('viewBox', '0 0 64 72');
  });

  it('keeps the plain look by default and adds glasses, papers and walking legs on request', () => {
    const { rerender } = render(<Ficha {...colors} size={96} patas />);
    expect(screen.queryByTestId('ficha-glasses')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ficha-papers')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ficha-walking')).not.toBeInTheDocument();
    expect(screen.getByTestId('ficha-lines')).toBeInTheDocument();

    rerender(<Ficha {...colors} size={96} patas lentes papeles andar />);

    expect(screen.getByTestId('ficha-glasses')).toBeInTheDocument();
    expect(screen.getByTestId('ficha-papers')).toBeInTheDocument();
    expect(screen.getByTestId('ficha-walking')).toBeInTheDocument();
    // The papers cover the lower half, where the text lines would be.
    expect(screen.queryByTestId('ficha-lines')).not.toBeInTheDocument();
  });

  it('leaves out glasses and papers when they would be too small to read', () => {
    render(<Ficha {...colors} size={20} lentes papeles />);

    expect(screen.queryByTestId('ficha-glasses')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ficha-papers')).not.toBeInTheDocument();
  });
});
