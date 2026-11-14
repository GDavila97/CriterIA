import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { initialRunState, runReducer, runSession, type RunState } from '@/entities/corrida';
import { EXAMPLES, type RunController } from '@/features/ejecutar-corrida';
import { ApiError, type RunCreatedBody } from '@/shared/api';
import {
  agentsGuide,
  catalog,
  eventsFrom,
  fullRun,
  inicia,
  settings,
  usage,
} from '@/shared/lib/testing';

import { RunWorkspace } from './RunWorkspace';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/analisis',
}));
vi.mock('@/shared/lib/auth/client', () => ({ authClient: {} }));

const user = { name: 'Ana Pérez', email: 'ana@example.test' };

function client() {
  return {
    catalog: vi.fn(async () => catalog()),
    settings: vi.fn(async () => settings()),
    usage: vi.fn(async () => usage(1)),
    agents: vi.fn(async () => agentsGuide()),
  };
}

function controller(
  state: RunState = initialRunState(),
  extra: Partial<RunController> = {},
): RunController {
  return {
    state,
    created: null,
    requerimiento: '',
    error: null,
    connection: 'cerrado',
    lastBeat: null,
    busy: false,
    start: vi.fn(async () => {}),
    respond: vi.fn(async () => {}),
    dismissError: vi.fn(),
    ...extra,
  };
}

describe('RunWorkspace', () => {
  it('loads the catalog, runs with the agent tuning and the history choice', async () => {
    const run = controller();
    render(
      <RunWorkspace
        user={user}
        officeEnabled={false}
        vistaParam={null}
        client={client()}
        useController={() => run}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Ver agente QA' }));
    fireEvent.change(screen.getByLabelText(/^Temperatura/), { target: { value: '0.6' } });
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ver agente Revisor' }));
    fireEvent.change(screen.getByLabelText('Rondas máx.'), { target: { value: '3' } });
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    await userEvent.click(screen.getByRole('button', { name: EXAMPLES[0].label }));
    await userEvent.click(screen.getByRole('button', { name: 'Ejecutar' }));

    expect(run.start).toHaveBeenCalledWith({
      requerimiento: EXAMPLES[0].texto,
      proveedor: 'groq',
      nivel: 'economico',
      modelo: null,
      juez: null,
      guardar_historial: false,
      max_rondas: 3,
      agentes: { qa: { temperatura: 0.6 } },
    });
    expect(screen.queryByRole('radiogroup', { name: 'Vista' })).not.toBeInTheDocument();
  });

  it('offers the free mode after a key failure and only then sends to Groq', async () => {
    const failed = eventsFrom(
      { ...inicia, proveedor: 'openai' },
      {
        type: 'agente_error',
        agent: 'analista',
        codigo: 'sin_saldo',
        mensaje: 'x',
        respaldo_sugerido: 'groq',
      },
    ).reduce((s, evento) => runReducer(s, { type: 'evento', evento }), initialRunState('r'));
    const run = controller(failed, {
      created: {
        run_id: 'r',
        agentes: { analista: { proveedor: 'openai' } },
      } as unknown as RunCreatedBody,
    });
    const c = client();
    render(
      <RunWorkspace
        user={user}
        officeEnabled
        vistaParam="clasica"
        client={c}
        useController={() => run}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: EXAMPLES[1].label }));
    await userEvent.click(screen.getByRole('button', { name: 'Ejecutar de nuevo' }));
    expect(run.start).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Usar el gratuito' }));

    expect(run.start).toHaveBeenLastCalledWith({
      requerimiento: EXAMPLES[1].texto,
      proveedor: 'groq',
      nivel: 'economico',
      juez: 'groq',
      guardar_historial: false,
      max_rondas: 2,
    });
    expect(screen.getByRole('radiogroup', { name: 'Vista' })).toBeInTheDocument();
    await waitFor(() => expect(c.usage).toHaveBeenCalledTimes(2));
  });

  it('shows API and loading errors', async () => {
    const run = controller(initialRunState(), {
      error: new ApiError(422, 'entrada_invalida', 'Revisa el requerimiento.'),
    });
    const { unmount } = render(
      <RunWorkspace
        user={user}
        officeEnabled={false}
        vistaParam={null}
        client={client()}
        useController={() => run}
      />,
    );
    expect(await screen.findByText('Revisa el requerimiento.')).toBeInTheDocument();
    unmount();

    const failing = {
      ...client(),
      catalog: vi
        .fn()
        .mockRejectedValue(
          new ApiError(401, 'no_autenticado', 'Tu sesión terminó. Vuelve a entrar.'),
        ),
    };
    render(
      <RunWorkspace
        user={user}
        officeEnabled={false}
        vistaParam={null}
        client={failing}
        useController={() => controller()}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tu sesión terminó. Vuelve a entrar.',
    );
  });

  it('uses a generic message for unexpected loading failures and ignores free mode without a run', async () => {
    const failing = { ...client(), agents: vi.fn().mockRejectedValue(new Error('x')) };
    render(
      <RunWorkspace
        user={user}
        officeEnabled={false}
        vistaParam={null}
        client={failing}
        useController={() => controller()}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la página');
  });

  it('shows a usage limit as a dialog instead of a notice and dismisses it', async () => {
    const run = controller(initialRunState(), {
      error: new ApiError(429, 'limite_hora', 'Alcanzaste el límite de análisis por hora.'),
    });
    render(
      <RunWorkspace
        user={user}
        officeEnabled={false}
        vistaParam={null}
        client={client()}
        useController={() => run}
      />,
    );

    const dialog = await screen.findByRole('alertdialog', {
      name: 'Alcanzaste el límite de análisis por hora',
    });
    expect(dialog).toHaveAccessibleDescription(
      'Puedes iniciar hasta 5 análisis por hora y 20 al día.',
    );
    expect(
      screen.queryByText('Alcanzaste el límite de análisis por hora.'),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(run.dismissError).toHaveBeenCalled();
  });

  it('starts over from a finished result, asking first when it was not saved', async () => {
    const done = fullRun().reduce(
      (s, evento) => runReducer(s, { type: 'evento', evento }),
      initialRunState('r'),
    );
    runSession.start({ run_id: 'r', guardar_historial: false } as RunCreatedBody, 'Requerimiento');
    fullRun().forEach((evento) => runSession.apply({ type: 'evento', evento }));
    const run = controller(done, {
      created: { run_id: 'r', guardar_historial: false } as RunCreatedBody,
    });
    const c = client();
    render(
      <RunWorkspace
        user={user}
        officeEnabled={false}
        vistaParam={null}
        client={c}
        useController={() => run}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: EXAMPLES[0].label }));
    const field = screen.getByLabelText(
      'Describe lo que el sistema debe hacer, en lenguaje natural',
    );
    expect(field).toHaveValue(EXAMPLES[0].texto);

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo análisis' }));
    await userEvent.click(
      within(screen.getByRole('alertdialog', { name: '¿Descartar el análisis?' })).getByRole(
        'button',
        { name: 'Descartar y continuar' },
      ),
    );

    expect(runSession.get().created).toBeNull();
    expect(run.dismissError).toHaveBeenCalled();
    expect(
      screen.getByLabelText('Describe lo que el sistema debe hacer, en lenguaje natural'),
    ).toHaveValue('');
    expect(c.settings).toHaveBeenCalledTimes(2);
  });
});
