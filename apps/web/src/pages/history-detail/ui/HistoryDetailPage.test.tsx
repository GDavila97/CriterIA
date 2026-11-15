import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApiError, type HistoryItemBody } from '@/shared/api';
import { fullRun, historia, puntajes } from '@/shared/lib/testing';

import { HistoryDetailPage } from './HistoryDetailPage';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => '/historial',
}));
vi.mock('@/shared/lib/auth/client', () => ({ authClient: {} }));

const user = { name: 'Ana', email: 'ana@example.test' };
const scores = puntajes() as unknown as HistoryItemBody['scores'];

const savedItem = (overrides: Partial<HistoryItemBody> = {}): HistoryItemBody => ({
  id: 'r1',
  status: 'completada',
  requirement: 'La biblioteca necesita apartados en línea. Los libros se recogen en 48 horas.',
  artifacts: { historias: { historias: [historia(1)] } },
  scores,
  provider: 'groq',
  model: 'openai/gpt-oss-20b',
  model_display_name: 'GPT-OSS 20B',
  judge_model: 'groq:openai/gpt-oss-20b',
  judge_display_name: 'GPT-OSS 20B',
  prompt_version: 'v1',
  judge_version: 'v1',
  experimental: false,
  totals: { tokens_entrada: 1, tokens_salida: 1, latencia_ms: 1, costo_usd: 0.008 },
  created_at: '2026-11-15T17:20:00Z',
  events: null,
  events_version: null,
  ...overrides,
});

const clientFor = (item: HistoryItemBody, deleteHistoryItem = vi.fn(async () => undefined)) => ({
  historyItem: vi.fn(async () => item),
  deleteHistoryItem,
});

describe('HistoryDetailPage', () => {
  it('heads the analysis with its first sentence, a summary and its actions', async () => {
    render(<HistoryDetailPage user={user} runId="r1" client={clientFor(savedItem())} />);

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'La biblioteca necesita apartados en línea',
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('main')).getByRole('link', { name: 'Historial' }),
    ).toHaveAttribute('href', '/historial');
    expect(screen.getByText(/^Guardado el 15 nov 2026 · /)).toBeInTheDocument();
    const summary = within(screen.getByRole('list', { name: 'Resumen del análisis' }));
    expect(summary.getByText('GPT-OSS 20B')).toBeInTheDocument();
    expect(summary.getByText('USD 0.0080')).toBeInTheDocument();
    expect(summary.getByText('Historias').nextSibling).toHaveTextContent('1');
    expect(summary.getByText('Puntaje').nextSibling).toHaveTextContent('4.0');
    expect(screen.getByText('Requerimiento').closest('details')).toHaveAttribute('open');
    expect(screen.getAllByRole('button', { name: 'Descargar' })).toHaveLength(1);
  });

  it('replays the saved events, so the rounds and corrections show', async () => {
    const events = fullRun() as unknown as HistoryItemBody['events'];
    render(
      <HistoryDetailPage
        user={user}
        runId="r1"
        client={clientFor(savedItem({ events, events_version: 1 }))}
      />,
    );

    const summary = within(await screen.findByRole('list', { name: 'Resumen del análisis' }));
    expect(summary.getByText('Casos').nextSibling).toHaveTextContent('3');
    expect(summary.getByText('Observaciones').nextSibling).toHaveTextContent('1');
  });

  it('deletes the analysis after asking, then goes back to the history', async () => {
    const remove = vi.fn(async () => undefined);
    render(<HistoryDetailPage user={user} runId="r1" client={clientFor(savedItem(), remove)} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar' }));
    const dialog = screen.getByRole('alertdialog', { name: '¿Eliminar este análisis?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Eliminar' }));

    expect(remove).toHaveBeenCalledWith('r1');
    expect(push).toHaveBeenCalledWith('/historial');
  });

  it('says why the analysis could not be deleted', async () => {
    const remove = vi
      .fn()
      .mockRejectedValue(new ApiError(404, 'no_encontrado', 'No existe o no es tuyo.'));
    render(<HistoryDetailPage user={user} runId="r1" client={clientFor(savedItem(), remove)} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar' }));
    await userEvent.click(
      within(
        screen.getByRole('alertdialog', { name: '¿Eliminar este análisis?', hidden: true }),
      ).getByRole('button', {
        name: 'Eliminar',
        hidden: true,
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('No existe o no es tuyo.');
  });

  it('shows a saved run with the same views as a live one', async () => {
    const item: HistoryItemBody = {
      id: 'r1',
      status: 'completada',
      requirement: 'La biblioteca necesita apartados en línea',
      artifacts: { historias: { historias: [historia(1)] } },
      scores,
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
      model_display_name: 'GPT-OSS 20B',
      judge_model: 'groq:openai/gpt-oss-20b',
      judge_display_name: 'GPT-OSS 20B',
      prompt_version: 'v1',
      judge_version: 'v1',
      experimental: false,
      totals: { tokens_entrada: 1, tokens_salida: 1, latencia_ms: 1, costo_usd: 0.004 },
      created_at: '2026-11-07T12:00:00Z',
      events: null,
      events_version: null,
    };
    render(<HistoryDetailPage user={user} runId="r1" client={clientFor(item)} />);

    expect(
      await screen.findByText('La biblioteca necesita apartados en línea', { selector: 'p' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/quiero hacer la tarea 1/)).toBeInTheDocument();
    expect(
      screen.getByText(/Calificado por el Evaluador \(Groq · GPT-OSS 20B\)/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar' })).toBeInTheDocument();
  });

  it('reports a run that is gone', async () => {
    const client = {
      historyItem: vi
        .fn()
        .mockRejectedValue(new ApiError(404, 'no_encontrado', 'No existe o no es tuyo.')),
      deleteHistoryItem: vi.fn(),
    };
    render(<HistoryDetailPage user={user} runId="x" client={client} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('No existe o no es tuyo.');
  });

  it('uses a generic message for unexpected failures', async () => {
    render(
      <HistoryDetailPage
        user={user}
        runId="x"
        client={{
          historyItem: vi.fn().mockRejectedValue(new Error('x')),
          deleteHistoryItem: vi.fn(),
        }}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo abrir el análisis.');
  });
});
