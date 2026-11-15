import type { Evento, HistoryItemBody } from '@/shared/api';
import { eventsFrom, fullRun, historia, inicia, puntajes, uso } from '@/shared/lib/testing';

import { initialRunState, runReducer, type RunState } from './reducer';
import {
  agentSummary,
  analysisTitle,
  formatClock,
  formatElapsed,
  formatUsd,
  runHeadline,
  stateFromHistory,
  stateFromSaved,
  totalUse,
} from './selectors';

const reduce = (events: Evento[]) =>
  events.reduce<RunState>(
    (s, evento) => runReducer(s, { type: 'evento', evento }),
    initialRunState('r'),
  );

describe('agentSummary', () => {
  it('describes each finished agent like the mockup', () => {
    const state = reduce(fullRun());

    expect(agentSummary(state, 'analista')).toEqual({ estado: 'Entregó', detalle: '2 historias' });
    expect(agentSummary(state, 'qa')).toEqual({
      estado: 'Entregó',
      detalle: '3 casos · corrigió 1',
    });
    expect(agentSummary(state, 'revisor')).toEqual({
      estado: 'Aprobó',
      detalle: '2 rondas · 1 observación',
    });
    expect(agentSummary(state, 'evaluador')).toEqual({
      estado: 'Calificó',
      detalle: '4.0 de 5 en promedio',
    });
  });

  it('shows who is working, who waits for the person and who failed', () => {
    const working = reduce(fullRun().slice(0, 3));
    const waiting = reduce(fullRun().slice(0, 5));
    const failed = reduce(
      eventsFrom(inicia, {
        type: 'agente_error',
        agent: 'qa',
        codigo: 'sin_saldo',
        mensaje: 'x',
        respaldo_sugerido: 'groq',
      }),
    );

    expect(agentSummary(working, 'analista')).toEqual({
      estado: 'Trabajando',
      detalle: 'Redactando historias de usuario',
    });
    expect(agentSummary(working, 'qa')).toEqual({ estado: 'En espera', detalle: null });
    expect(agentSummary(waiting, 'analista')).toEqual({
      estado: 'Esperándote',
      detalle: '2 historias',
    });
    expect(agentSummary(failed, 'qa').estado).toBe('No pudo terminar');
  });

  it('handles reviews without approval, empty scores and single counts', () => {
    const state: RunState = {
      ...initialRunState('r'),
      agentes: {
        ...initialRunState().agentes,
        qa: { estado: 'entrego', ronda: 0, mensaje: null, entregas: 1, usos: [] },
        revisor: { estado: 'entrego', ronda: 0, mensaje: null, entregas: 1, usos: [] },
        evaluador: { estado: 'entrego', ronda: 0, mensaje: null, entregas: 1, usos: [] },
      },
      revisorAprobo: false,
    };

    expect(agentSummary(state, 'qa').detalle).toBe('0 casos');
    expect(agentSummary(state, 'revisor')).toEqual({
      estado: 'Revisó',
      detalle: '1 ronda · 0 observaciones',
    });
    expect(agentSummary(state, 'evaluador').detalle).toBeNull();
  });
});

describe('formatting', () => {
  it('formats durations, clocks and dollars', () => {
    expect(formatElapsed('2026-11-07T12:00:00Z', '2026-11-07T12:01:12Z')).toBe('1 min 12 s');
    expect(formatElapsed('2026-11-07T12:00:00Z', '2026-11-07T12:00:09Z')).toBe('9 s');
    expect(formatClock('2026-11-07T12:00:00Z', '2026-11-07T12:01:03Z')).toBe('01:03');
    expect(formatUsd(0.012)).toBe('USD 0.012');
    expect(formatUsd(0.0042)).toBe('USD 0.0042');
    expect(formatUsd(null)).toBe('sin precio');
  });

  it('sums an agent use and keeps an unknown price unknown', () => {
    expect(totalUse([uso(0.001), uso(0.002)])).toEqual({
      tokens: 2400,
      latenciaMs: 3000,
      costo: 0.003,
    });
    expect(totalUse([uso(null)]).costo).toBeNull();
  });

  it('summarizes the run in one line for each phase', () => {
    const done = reduce(fullRun());

    expect(runHeadline(initialRunState())).toBe('Escribe un requerimiento y ejecuta el análisis');
    expect(runHeadline(reduce(fullRun().slice(0, 3)))).toBe('En curso');
    expect(runHeadline(reduce(fullRun().slice(0, 5)))).toBe('Esperando tu revisión');
    expect(runHeadline(done)).toBe(
      'Análisis terminado · 1 ronda de revisión · 2 min 33 s · USD 0.012',
    );
    expect(runHeadline({ ...done, fase: 'error', rondasRevision: 0, totales: null })).toBe(
      'Análisis detenido · 2 min 33 s',
    );
  });
});

const savedItem = (overrides: Partial<HistoryItemBody> = {}): HistoryItemBody => ({
  id: 'r1',
  status: 'completada',
  requirement: 'La biblioteca necesita apartados en línea',
  artifacts: { historias: { historias: [historia(1)] } },
  scores: puntajes() as unknown as HistoryItemBody['scores'],
  provider: 'groq',
  model: 'openai/gpt-oss-20b',
  model_display_name: 'GPT-OSS 20B',
  judge_model: 'groq:openai/gpt-oss-20b',
  judge_display_name: 'GPT-OSS 20B',
  prompt_version: 'v1',
  judge_version: 'v1',
  experimental: false,
  totals: { tokens_entrada: 1, tokens_salida: 1, latencia_ms: 1, costo_usd: 0 },
  created_at: '2026-11-07T12:00:00Z',
  events: null,
  events_version: null,
  ...overrides,
});

describe('stateFromHistory', () => {
  const events = fullRun() as unknown as HistoryItemBody['events'];

  it('replays the saved events, rounds included, when their version is known', () => {
    const state = stateFromHistory(savedItem({ events, events_version: 1 }));

    expect(state.fase).toBe('completada');
    expect(state.rondasRevision).toBe(1);
    expect(state.casos.map((c) => c.id)).toEqual(['CP-01', 'CP-02', 'CP-90']);
    expect(state.registro.length).toBeGreaterThan(5);
  });

  it('falls back to the artifacts with an unknown version or without events', () => {
    for (const item of [
      savedItem({ events, events_version: 2 }),
      savedItem({ events: [], events_version: 1 }),
      savedItem(),
    ]) {
      const state = stateFromHistory(item);
      expect(state.registro).toEqual([]);
      expect(state.historias).toHaveLength(1);
    }
  });
});

describe('analysisTitle', () => {
  it('takes the first sentence without its period', () => {
    expect(
      analysisTitle(
        'La clínica quiere que los pacientes agenden citas en línea. Las citas deben ser rápidas.',
      ),
    ).toBe('La clínica quiere que los pacientes agenden citas en línea');
    expect(analysisTitle('  ¿Qué pasa si cancelo?  Nada.')).toBe('¿Qué pasa si cancelo');
    expect(analysisTitle('Sin punto final')).toBe('Sin punto final');
    expect(analysisTitle('Versión 2.1 del portal. Otra frase.')).toBe('Versión 2.1 del portal');
  });

  it('cuts a long sentence at a word and adds an ellipsis', () => {
    const long =
      'El portal de trámites escolares debe permitir inscripciones, pagos, constancias, citas y avisos a las familias';
    const title = analysisTitle(long);

    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThanOrEqual(81);
    expect(long.startsWith(title.slice(0, -1))).toBe(true);
    expect(title).not.toMatch(/[ ,]…$/);
    expect(analysisTitle('a'.repeat(100), 10)).toBe(`${'a'.repeat(10)}…`);
  });
});

describe('stateFromSaved', () => {
  it('rebuilds the views of a saved run', () => {
    const item: HistoryItemBody = {
      id: 'r1',
      status: 'completada',
      requirement: 'La biblioteca necesita apartados en línea',
      artifacts: {
        historias: { historias: [historia(1)] },
        pruebas: { criterios: [], casos: [] },
        revision: { veredicto: { aprobado: false, observaciones: [] } },
      },
      scores: puntajes() as unknown as HistoryItemBody['scores'],
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
      model_display_name: 'GPT-OSS 20B',
      judge_model: 'groq:openai/gpt-oss-20b',
      judge_display_name: 'GPT-OSS 20B',
      prompt_version: 'v1',
      judge_version: 'v1',
      experimental: false,
      totals: { tokens_entrada: 1, tokens_salida: 1, latencia_ms: 1, costo_usd: 0 },
      created_at: '2026-11-07T12:00:00Z',
      events: null,
      events_version: null,
    };

    const state = stateFromSaved(item);
    const failed = stateFromSaved({ ...item, status: 'error', artifacts: {}, scores: [] });

    expect(state.fase).toBe('completada');
    expect(state.historias).toHaveLength(1);
    expect(state.revisorAprobo).toBe(false);
    expect(state.modelos?.generacion).toBe('groq:openai/gpt-oss-20b');
    expect(failed.fase).toBe('error');
    expect(failed.agentes.qa.entregas).toBe(0);
  });
});
