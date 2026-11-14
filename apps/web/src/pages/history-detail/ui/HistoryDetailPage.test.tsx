import { render, screen } from '@testing-library/react';

import { ApiError, type HistoryItemBody } from '@/shared/api';
import { historia, puntajes } from '@/shared/lib/testing';

import { HistoryDetailPage } from './HistoryDetailPage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/historial',
}));
vi.mock('@/shared/lib/auth/client', () => ({ authClient: {} }));

const user = { name: 'Ana', email: 'ana@example.test' };
const scores = puntajes() as unknown as HistoryItemBody['scores'];

describe('HistoryDetailPage', () => {
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
    };
    render(
      <HistoryDetailPage
        user={user}
        runId="r1"
        client={{ historyItem: vi.fn(async () => item) }}
      />,
    );

    expect(
      await screen.findByText('La biblioteca necesita apartados en línea'),
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
    };
    render(<HistoryDetailPage user={user} runId="x" client={client} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('No existe o no es tuyo.');
  });

  it('uses a generic message for unexpected failures', async () => {
    render(
      <HistoryDetailPage
        user={user}
        runId="x"
        client={{ historyItem: vi.fn().mockRejectedValue(new Error('x')) }}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo abrir el análisis.');
  });
});
