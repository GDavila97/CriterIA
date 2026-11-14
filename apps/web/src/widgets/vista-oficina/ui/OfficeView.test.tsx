import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { initialRunState, runReducer, type RunState } from '@/entities/corrida';
import type { Evento } from '@/shared/api';
import { eventsFrom, fullRun, historia, inicia } from '@/shared/lib/testing';

import { OfficeView } from './OfficeView';

const reduce = (events: Evento[]): RunState =>
  events.reduce((s, evento) => runReducer(s, { type: 'evento', evento }), initialRunState('r'));

const paused = reduce(
  eventsFrom(inicia, {
    type: 'en_espera_humano',
    agent: 'analista',
    solicitud: 'aprobar_historias',
    historias: [historia(1), historia(2)],
  }),
);

function motion(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)' ? reduced : false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

const original = window.matchMedia;
afterEach(() => {
  window.matchMedia = original;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('OfficeView', () => {
  it('makes each agent a button named with its activity that opens its panel', async () => {
    const onOpenAgent = vi.fn();
    const working = reduce(eventsFrom(inicia, { type: 'agente_inicia', agent: 'qa', ronda: 0 }));
    render(<OfficeView state={working} onOpenAgent={onOpenAgent} />);

    await userEvent.click(
      screen.getByRole('button', { name: 'QA: escribiendo casos de prueba, abrir panel' }),
    );

    expect(onOpenAgent).toHaveBeenCalledWith('qa');
    expect(screen.getByText('Escribiendo casos')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Contadores' })).toBeInTheDocument();
    expect(screen.getByText(/Registro:/).parentElement).toHaveTextContent('QA empezó');
    expect(document.querySelector('svg[aria-hidden="true"] polygon')).not.toBeNull();
  });

  it('calls the person by first name on their turn and opens the same approval in a drawer', async () => {
    const onAnswer = vi.fn();
    render(<OfficeView state={paused} userName="Ana Pérez" approval={{ busy: false, onAnswer }} />);

    expect(screen.getByText('Ana, necesito tu ayuda')).toBeInTheDocument();
    expect(screen.getByText('Las historias están listas para tu revisión')).toBeInTheDocument();
    expect(screen.getByText('Las historias están listas para tu revisión.')).toHaveAttribute(
      'aria-live',
      'polite',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Revisar historias' }));
    const drawer = screen.getByRole('dialog', { name: 'Revisar historias' });
    await userEvent.click(within(drawer).getByRole('button', { name: /^Aprobar/ }));

    expect(onAnswer).toHaveBeenCalledWith({ decision: 'aprobado' });
  });

  it('hides the turn card without a way to answer and announces the end', () => {
    const { rerender } = render(<OfficeView state={paused} />);
    expect(screen.queryByRole('button', { name: 'Revisar historias' })).not.toBeInTheDocument();

    rerender(<OfficeView state={reduce(fullRun())} />);
    expect(screen.getByText('Análisis listo')).toBeInTheDocument();
    expect(screen.getByText('Análisis terminado.')).toHaveAttribute('aria-live', 'polite');
  });

  it('lets free agents wander over time, and keeps them still with reduced motion', () => {
    const places = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>('[data-agent]'),
        (el) => el.style.transform,
      );
    vi.useFakeTimers();
    motion(false);
    const lively = render(<OfficeView state={initialRunState()} seed={5} />);
    const before = places();
    act(() => vi.advanceTimersByTime(60_000));
    expect(places()).not.toEqual(before);
    lively.unmount();

    motion(true);
    render(<OfficeView state={initialRunState()} seed={5} />);
    const still = places();
    act(() => vi.advanceTimersByTime(60_000));

    expect(places()).toEqual(still);
    expect(vi.getTimerCount()).toBe(0);
    expect(document.querySelector('[data-walking]')).toBeNull();
  });

  it('pauses its animations while the tab is hidden', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    render(<OfficeView state={initialRunState()} />);

    expect(screen.getByRole('region', { name: 'Oficina' }).className).toMatch(/paused/);
  });
});
