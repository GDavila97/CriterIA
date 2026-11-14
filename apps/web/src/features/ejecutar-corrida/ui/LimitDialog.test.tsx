import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApiError, type UsageBody } from '@/shared/api';

import { isLimitError, LimitDialog } from './LimitDialog';

const usage: UsageBody = { corridas_hora: 5, limite_hora: 5, corridas_dia: 7, limite_dia: 20 };
const limit = (code: string) => new ApiError(429, code, 'Mensaje de la API');

describe('LimitDialog', () => {
  it('explains the hourly limit with the account limits and no invented time', async () => {
    const onClose = vi.fn();
    render(<LimitDialog error={limit('limite_hora')} usage={usage} onClose={onClose} />);

    const dialog = screen.getByRole('alertdialog', {
      name: 'Alcanzaste el límite de análisis por hora',
    });
    expect(dialog).toHaveAccessibleDescription(
      'Puedes iniciar hasta 5 análisis por hora y 20 al día.',
    );
    expect(dialog).not.toHaveTextContent(/a las|podrás/i);
    expect(within(dialog).getByRole('link', { name: 'Ver historial' })).toHaveAttribute(
      'href',
      '/historial',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Entendido' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('has its own text for the daily limit and the free quota', () => {
    const { rerender } = render(
      <LimitDialog error={limit('limite_dia')} usage={usage} onClose={vi.fn()} />,
    );
    expect(
      screen.getByRole('alertdialog', { name: 'Alcanzaste el límite de análisis del día' }),
    ).toBeInTheDocument();

    rerender(
      <LimitDialog error={limit('cupo_gratuito_agotado')} usage={usage} onClose={vi.fn()} />,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Se agotó el cupo gratuito de hoy' });
    expect(within(dialog).getByRole('link', { name: 'Modelos y claves' })).toHaveAttribute(
      'href',
      '/ajustes/modelos',
    );
  });

  it('stays closed for other errors and only limits count as limits', () => {
    render(<LimitDialog error={limit('entrada_invalida')} usage={null} onClose={vi.fn()} />);

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(isLimitError(limit('limite_dia'))).toBe(true);
    expect(isLimitError(limit('sin_conexion'))).toBe(false);
    expect(isLimitError(null)).toBe(false);
  });
});
