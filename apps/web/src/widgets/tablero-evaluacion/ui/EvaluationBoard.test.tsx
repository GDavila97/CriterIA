import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { EvaluationBatchBody } from '@/shared/api';

import { EvaluationBoard } from './EvaluationBoard';

const batch = (over: Partial<EvaluationBatchBody>): EvaluationBatchBody => ({
  id: crypto.randomUUID(),
  created_at: '2026-11-09T12:00:00Z',
  provider: 'groq',
  model: 'openai/gpt-oss-20b',
  model_display_name: 'GPT-OSS 20B',
  prompt_version: 'v1',
  judge_model: 'anthropic:claude-haiku-5-5',
  judge_version: 'v1',
  judge_same_provider: false,
  output_mode: 'tool',
  completed: 15,
  score_mean: 3.2,
  cases: 15,
  valid_rate: 0.93,
  latency_p50_ms: 14_000,
  latency_p95_ms: 22_000,
  cost_usd_avg: 0.004,
  ...over,
});

describe('EvaluationBoard', () => {
  it('shows the empty state before the first batch', () => {
    render(<EvaluationBoard lotes={[]} />);

    expect(
      screen.getByText('Los resultados se publicarán tras la primera evaluación.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Versión de prompts')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cómo se mide' })).toBeInTheDocument();
  });

  it('compares the models of a version and flags same-provider judges', async () => {
    render(
      <EvaluationBoard
        lotes={[
          batch({}),
          batch({
            provider: 'anthropic',
            model: 'claude-haiku-5-5',
            model_display_name: 'Claude Haiku 5.5',
            judge_same_provider: true,
            score_mean: 3.85,
            completed: 14,
            valid_rate: 1,
            latency_p50_ms: 33_000,
          }),
          batch({
            provider: 'ollama',
            model: 'llama3.1:8b',
            model_display_name: 'Llama 3.1 8B',
            valid_rate: null,
            latency_p50_ms: null,
            latency_p95_ms: null,
            cost_usd_avg: null,
          }),
          batch({ prompt_version: 'v2', model: 'v2-model', model_display_name: 'v2-model' }),
        ]}
      />,
    );

    expect(screen.getByLabelText('Versión de prompts')).toHaveValue('v2');
    await userEvent.selectOptions(screen.getByLabelText('Versión de prompts'), 'v1');
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    const haiku = within(table)
      .getByText(/Anthropic · Claude Haiku 5\.5/)
      .closest('tr');
    expect(haiku).toHaveTextContent('Anthropic · Claude Haiku 5.5 *salida tool14 de 153.85100%');
    expect(
      within(screen.getByRole('region', { name: 'Mejor puntaje' })).getByText(
        'Anthropic · Claude Haiku 5.5',
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Más rápido' })).getByText('14 s'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Más salidas válidas a la primera' })).getByText(
        '100%',
      ),
    ).toBeInTheDocument();
    expect(within(table).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows the judge agreement with its interval and direction, or that it is pending', () => {
    const value = (valor: number, bajo: number, alto: number) => ({ valor, bajo, alto });
    const { unmount } = render(
      <EvaluationBoard
        lotes={[batch({})]}
        acuerdo={{
          pares: 32,
          kappa: value(0.62, 0.41, 0.79),
          spearman: value(0.58, 0.33, 0.77),
          exacto: value(0.5, 0.34, 0.66),
          mas_menos_uno: value(0.91, 0.81, 1),
          juez_menos_humano: { valor: -0.25, bajo: null, alto: null },
        }}
      />,
    );

    const section = screen.getByRole('region', { name: 'Acuerdo del juez con una persona' });
    expect(within(section).getByText('0.62 (0.41 a 0.79)')).toBeInTheDocument();
    expect(within(section).getByText('50% (34% a 66%)')).toBeInTheDocument();
    expect(section).toHaveTextContent('32 pares');
    expect(section).toHaveTextContent('califica 0.25 puntos más bajo que la persona');
    unmount();

    render(<EvaluationBoard lotes={[batch({})]} />);
    expect(screen.getByText(/Pendiente: se publica cuando termine/)).toBeInTheDocument();
  });

  it('a value without an interval shows alone', () => {
    render(
      <EvaluationBoard
        lotes={[batch({})]}
        acuerdo={{
          pares: 2,
          kappa: { valor: null, bajo: null, alto: null },
          spearman: { valor: 1, bajo: null, alto: null },
          exacto: { valor: 1, bajo: 1, alto: 1 },
          mas_menos_uno: { valor: 1, bajo: 1, alto: 1 },
          juez_menos_humano: { valor: 0.5, bajo: 0, alto: 1 },
        }}
      />,
    );

    const section = screen.getByRole('region', { name: 'Acuerdo del juez con una persona' });
    expect(within(section).getByText('—')).toBeInTheDocument();
    expect(within(section).getByText('1.00')).toBeInTheDocument();
    expect(section).toHaveTextContent('0.50 puntos más alto');
  });

  it('shows dashes when no batch has numbers', () => {
    render(<EvaluationBoard lotes={[batch({ valid_rate: null, latency_p50_ms: null })]} />);

    expect(
      within(screen.getByRole('region', { name: 'Más rápido' })).getAllByText('—'),
    ).toHaveLength(2);
  });
});
