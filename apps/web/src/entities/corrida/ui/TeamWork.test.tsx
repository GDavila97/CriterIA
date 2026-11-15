import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { fullRun } from '@/shared/lib/testing';

import { teamMessages } from '../model/conversation';
import { TeamWork } from './TeamWork';

function width(wide: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query === '(min-width: 768px)' ? wide : false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

const original = window.matchMedia;
afterEach(() => {
  window.matchMedia = original;
});

const messages = teamMessages(fullRun());
const start = fullRun()[0]!.ts;

describe('TeamWork', () => {
  it('switches to a diagram whose steps are buttons with their detail in a live region', async () => {
    width(true);
    const onOpen = vi.fn();
    render(<TeamWork messages={messages} start={start} onOpen={onOpen} />);

    await userEvent.click(screen.getByRole('radio', { name: 'Diagrama' }));

    const steps = screen.getAllByRole('button', { pressed: false });
    expect(screen.getByRole('button', { pressed: true })).toHaveAccessibleName(
      /^Revisor:\s*Revisa casos\s*1 observación$/,
    );
    expect(steps.length).toBeGreaterThanOrEqual(6);
    const detail = screen.getByRole('region', { name: 'Detalle del paso' });
    expect(detail).toHaveAttribute('aria-live', 'polite');
    expect(detail).toHaveTextContent('Revisor → QA');
    expect(detail).toHaveTextContent('Falta un caso de error.');

    await userEvent.click(
      screen.getByRole('button', { name: /^QA:\s*Agrega CP-90\s*Caso 90\s*, ronda 2$/ }),
    );
    expect(detail).toHaveTextContent('Agregué CP-90 para atender la observación del Revisor.');
    expect(detail).toHaveTextContent('01:48');
    await userEvent.click(within(detail).getByRole('button', { name: 'Ver CP-90' }));
    expect(onOpen).toHaveBeenCalledWith({ kind: 'caso', id: 'CP-90', label: 'CP-90' });

    await userEvent.click(screen.getByRole('radio', { name: 'Lista' }));
    expect(screen.queryByRole('region', { name: 'Detalle del paso' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
  });

  it('offers only the list below 768 px', () => {
    width(false);
    render(<TeamWork messages={messages} start={start} onOpen={vi.fn()} />);

    expect(screen.queryByRole('radiogroup', { name: 'Forma de ver' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
  });
});
