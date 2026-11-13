import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { initialRunState, runReducer, type RunState } from '@/entities/corrida';
import type { Evento } from '@/shared/api';
import { caso, delivers, eventsFrom, fullRun, historia, inicia } from '@/shared/lib/testing';

import { ClassicView } from './ClassicView';

const reduce = (events: Evento[]) =>
  events.reduce<RunState>(
    (s, evento) => runReducer(s, { type: 'evento', evento }),
    initialRunState('r'),
  );

const REQ = 'La biblioteca necesita apartados en línea';

describe('ClassicView', () => {
  it('shows the finished run: agents, artifacts by tab with origin, rubric and log', async () => {
    const onOpenAgent = vi.fn();
    render(
      <ClassicView
        state={reduce(fullRun())}
        requerimiento={REQ}
        connection="cerrado"
        onOpenAgent={onOpenAgent}
      />,
    );

    expect(screen.getByText(/Corrida terminada · 1 ronda de revisión/)).toBeInTheDocument();
    const flow = screen.getByRole('region', { name: 'Flujo de agentes' });
    expect(within(flow).getByText('3 casos · corrigió 1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ver agente Revisor' }));
    expect(onOpenAgent).toHaveBeenCalledWith('revisor');

    expect(screen.getByText(/quiero hacer la tarea 1/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Casos de prueba' }));
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('Revisor')).toHaveLength(1);
    await userEvent.click(screen.getByRole('tab', { name: 'Gherkin' }));
    expect(screen.getByLabelText('Escenario de CP-01')).toHaveTextContent(
      'Dado una alumna con sesión',
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Observaciones' }));
    expect(screen.getByText('Falta un caso de error')).toBeInTheDocument();

    const rubric = screen.getByRole('region', { name: /Rúbrica/ });
    expect(within(rubric).getByText('/5').parentElement).toHaveTextContent('4.0/5');
    expect(within(rubric).getByText('Completitud').nextSibling).toHaveTextContent('3.0');
    expect(within(rubric).getByText(/El juez es del mismo proveedor/)).toBeInTheDocument();
    expect(screen.getByText('Evaluador calificó: 4.0 de 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exportar Markdown' })).toBeInTheDocument();
  });

  it('marks a finished analysis kept only in this tab next to its downloads', () => {
    const { rerender } = render(
      <ClassicView state={reduce(fullRun())} requerimiento={REQ} saved={false} />,
    );
    expect(screen.getByText('No guardado en tu historial')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exportar Markdown' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'JSON' })).toBeInTheDocument();

    rerender(<ClassicView state={reduce(fullRun())} requerimiento={REQ} saved />);
    expect(screen.queryByText('No guardado en tu historial')).not.toBeInTheDocument();
  });

  it('pages long artifact lists inside the card', async () => {
    const historias = Array.from({ length: 12 }, (_, i) => historia(i + 1));
    const casos = Array.from({ length: 13 }, (_, i) => caso(i + 1));
    const state = reduce(
      eventsFrom(
        inicia,
        delivers('analista', { tipo: 'historias', historias }),
        delivers('qa', { tipo: 'pruebas', criterios: [], casos }),
      ),
    );
    render(<ClassicView state={state} requerimiento={REQ} judgeLabel="Groq · GPT-OSS 20B" />);

    const stories = screen.getByRole('navigation', { name: 'Páginas de historias' });
    expect(within(stories).getByText('Página 1 de 2')).toBeInTheDocument();
    await userEvent.click(within(stories).getByRole('button', { name: 'Siguiente' }));
    expect(within(stories).getByText('Página 2 de 2')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Casos de prueba' }));
    const cases = screen.getByRole('navigation', { name: 'Páginas de casos de prueba' });
    expect(within(cases).getByText('Página 1 de 2')).toBeInTheDocument();
    const visibleRows = () =>
      screen.getAllByRole('row').filter((row) => !row.closest('[inert]') && row.closest('tbody'));
    expect(visibleRows()).toHaveLength(10);
    await userEvent.click(within(cases).getByRole('button', { name: 'Siguiente' }));
    expect(visibleRows()).toHaveLength(3);

    await userEvent.click(screen.getByRole('tab', { name: 'Gherkin' }));
    expect(
      screen.getByRole('navigation', { name: 'Páginas de escenarios Gherkin' }),
    ).toBeInTheDocument();
  });

  it('puts the approval inline while the run waits and shows the live connection', async () => {
    const onAnswer = vi.fn();
    render(
      <ClassicView
        state={reduce(fullRun().slice(0, 5))}
        requerimiento={REQ}
        connection="en_vivo"
        approval={{ busy: false, onAnswer }}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('En vivo');
    expect(screen.getByText('Tú · revisando')).toHaveAttribute('aria-current', 'step');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Aprobar 2 historias y continuar' }));
    expect(onAnswer).toHaveBeenCalledWith({ decision: 'aprobado' });
  });

  it('offers the free mode only after a key failure and never switches by itself', async () => {
    const onUseFree = vi.fn();
    const state = reduce(
      eventsFrom(
        { ...inicia, proveedor: 'openai' },
        {
          type: 'agente_error',
          agent: 'qa',
          codigo: 'sin_saldo',
          mensaje: 'Sin saldo.',
          respaldo_sugerido: 'groq',
        },
      ),
    );
    render(<ClassicView state={state} requerimiento={REQ} onUseFree={onUseFree} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Tu clave de OpenAI no tiene saldo');
    expect(alert).toHaveTextContent(
      'La corrida se detuvo en QA. No se envió nada a otro proveedor.',
    );
    expect(within(alert).getByRole('link', { name: 'Ir a Modelos y claves' })).toHaveAttribute(
      'href',
      '/ajustes/modelos',
    );
    expect(onUseFree).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Usar el gratuito' }));
    expect(onUseFree).toHaveBeenCalledTimes(1);
  });

  it('shows other errors and empty states', () => {
    const state = reduce(
      eventsFrom(inicia, {
        type: 'corrida_fin',
        estado: 'error',
        puntajes: [],
        totales: { tokens_entrada: 0, tokens_salida: 0, latencia_ms: 0, costo_usd: 0 },
        respaldo_sugerido: null,
        codigo: 'error_interno',
        mensaje: 'La corrida se detuvo por un error interno.',
      }),
    );
    render(<ClassicView state={state} requerimiento={REQ} connection="reconectando" />);

    expect(screen.getByRole('alert', { name: 'Error de la corrida' })).toHaveTextContent(
      'error interno',
    );
    expect(screen.getByText('Aún no hay historias.')).toBeInTheDocument();
    expect(screen.getByText('El Evaluador califica al final.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Reconectando…');
  });

  it('describes empty tabs before any artifact arrives', async () => {
    render(<ClassicView state={initialRunState()} requerimiento="" />);

    expect(screen.getByText('Los eventos aparecen aquí en vivo.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Casos de prueba' }));
    expect(screen.getByText('Aún no hay casos de prueba.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Gherkin' }));
    expect(screen.getByText('Aún no hay escenarios.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Observaciones' }));
    expect(screen.getByText('Aún no hay observaciones.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ver agente/ })).not.toBeInTheDocument();
  });
});
