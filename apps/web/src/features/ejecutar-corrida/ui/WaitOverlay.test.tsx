import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { WaitOverlay } from './WaitOverlay';

const handlers = () => ({ onRetry: vi.fn(), onCancel: vi.fn(), onStartAnyway: vi.fn() });

describe('WaitOverlay', () => {
  it('keeps an empty live region while hidden, so the first message is announced', () => {
    render(<WaitOverlay stage="oculta" {...handlers()} />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toBeEmptyDOMElement();
  });

  it('walks the Evaluador with glasses and papers while preparing, and stops when ready', () => {
    const { rerender } = render(<WaitOverlay stage="preparando" {...handlers()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Estamos preparando todo');
    expect(screen.getByTestId('ficha-walking')).toBeInTheDocument();
    expect(screen.getByTestId('ficha-glasses')).toBeInTheDocument();
    expect(screen.getByTestId('ficha-papers')).toBeInTheDocument();

    rerender(<WaitOverlay stage="listo" {...handlers()} />);
    expect(screen.getByRole('status')).toHaveTextContent('¡Todo listo!');
    expect(screen.queryByTestId('ficha-walking')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ficha-papers')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).not.toHaveTextContent(/cupo/);
  });

  it('offers Cancelar on the left and Reintentar on the right, with the focus on Reintentar', async () => {
    const h = handlers();
    render(<WaitOverlay stage="sin_conexion" {...h} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Cancelar', 'Reintentar']);
    expect(screen.getByRole('button', { name: 'Reintentar' })).toHaveFocus();
    await userEvent.click(buttons[1]!);
    await userEvent.click(buttons[0]!);
    expect(h.onRetry).toHaveBeenCalled();
    expect(h.onCancel).toHaveBeenCalled();
  });

  it('explains an analysis that was created but could not open, and starts another only on request', async () => {
    const h = handlers();
    render(<WaitOverlay stage="creado_sin_abrir" {...h} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Tu análisis sí se creó, pero no pudimos abrirlo. Se liberará solo en una hora.',
    );
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar otro' }));
    expect(h.onStartAnyway).toHaveBeenCalled();
    expect(h.onRetry).not.toHaveBeenCalled();
  });
});
