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
      screen.getByRole('button', { name: 'QA · escribiendo casos de prueba, abrir panel' }),
    );

    expect(onOpenAgent).toHaveBeenCalledWith('qa');
    expect(screen.getByText('Escribiendo casos')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Contadores' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Así trabajó el equipo' })).toHaveTextContent(
      'Los mensajes del equipo aparecen aquí en cuanto empiezan.',
    );
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

  it('moves the legs only while an agent walks its route, and settles it on arrival', () => {
    vi.useFakeTimers();
    motion(false);
    render(<OfficeView state={initialRunState()} seed={5} />);
    expect(screen.queryAllByTestId('ficha-walking')).toHaveLength(0);

    act(() => vi.advanceTimersByTime(1_000));
    const slot = document.querySelector<HTMLElement>('[data-walking]');
    expect(slot).not.toBeNull();
    expect(slot!.querySelector('[data-testid="ficha-walking"]')).not.toBeNull();

    // jsdom has no transitions: end each segment by hand until the walk is over.
    for (let i = 0; i < 20 && slot!.hasAttribute('data-walking'); i += 1) {
      act(() => {
        slot!.dispatchEvent(new Event('transitionend', { bubbles: true }));
      });
    }
    expect(slot!.hasAttribute('data-walking')).toBe(false);
    expect(slot!.querySelector('[data-testid="ficha-walking"]')).toBeNull();
  });

  it('keeps the Analyst at the board on their turn while the others follow their routine', () => {
    vi.useFakeTimers();
    motion(false);
    render(<OfficeView state={paused} seed={5} approval={{ busy: false, onAnswer: vi.fn() }} />);

    act(() => vi.advanceTimersByTime(90_000));

    const analyst = document.querySelector<HTMLElement>('[data-agent="analista"]')!;
    expect(analyst.textContent).toContain('necesito tu ayuda');
    expect(analyst.querySelector('[data-testid="ficha-papers"]')).not.toBeNull();
  });

  it('keeps the scene out of the accessibility tree; its agents still open the panel with the mouse', async () => {
    const onOpenAgent = vi.fn();
    render(<OfficeView state={initialRunState()} onOpenAgent={onOpenAgent} />);

    const scene = document.querySelector<HTMLButtonElement>('[data-scene-agent="revisor"]')!;
    expect(scene).toHaveAttribute('tabindex', '-1');
    expect(scene.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: /^Revisor/ })).toHaveLength(1);

    await userEvent.click(scene);
    expect(onOpenAgent).toHaveBeenCalledWith('revisor');
    const row = screen.getByRole('list', { name: 'Agentes' });
    expect(within(row).getAllByRole('button')).toHaveLength(4);
  });

  it('shows the latest team messages live and opens what they mention', async () => {
    const onOpenRef = vi.fn();
    render(<OfficeView state={reduce(fullRun())} onOpenRef={onOpenRef} />);

    const team = screen.getByRole('region', { name: 'Así trabajó el equipo' });
    expect(within(within(team).getByRole('log')).getAllByRole('listitem')).toHaveLength(4);
    expect(team).toHaveTextContent('7 mensajes · 1 corrección');
    await userEvent.click(within(team).getByRole('button', { name: 'Ver CP-90' }));
    expect(onOpenRef).toHaveBeenCalledWith({ kind: 'caso', id: 'CP-90', label: 'CP-90' });

    await userEvent.click(
      within(team).getByRole('button', { name: 'Ver toda la conversación (7)' }),
    );
    expect(within(team).getAllByRole('listitem')).toHaveLength(7);
    await userEvent.click(within(team).getByRole('button', { name: 'Correcciones' }));
    expect(within(team).getAllByRole('listitem')).toHaveLength(1);
  });
});
