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
  output_mode: 'tool',
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
    expect(within(table).getByText('Anthropic · Claude Haiku 5.5 *')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Más rápido' })).getByText('14 s'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Más salidas válidas' })).getByText('100%'),
    ).toBeInTheDocument();
    expect(within(table).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows dashes when no batch has numbers', () => {
    render(<EvaluationBoard lotes={[batch({ valid_rate: null, latency_p50_ms: null })]} />);

    expect(
      within(screen.getByRole('region', { name: 'Más rápido' })).getAllByText('—'),
    ).toHaveLength(2);
  });
});
