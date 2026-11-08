import type { Evento } from '@/shared/api';
import {
  caso,
  delivers,
  eventsFrom,
  fullRun,
  historia,
  inicia,
  observacion,
} from '@/shared/lib/testing';

import { initialRunState, promedio, runReducer, type RunState } from './reducer';

const reduce = (events: Evento[], state: RunState = initialRunState('r')) =>
  events.reduce((s, evento) => runReducer(s, { type: 'evento', evento }), state);

describe('runReducer', () => {
  it('turns a full run into artifacts, rounds, scores and a readable log', () => {
    const state = reduce(fullRun());

    expect(state.fase).toBe('completada');
    expect(state.historias.map((h) => h.id)).toEqual(['HU-1', 'HU-2']);
    expect(state.casos.map((c) => [c.id, c.origen])).toEqual([
      ['CP-01', 'qa'],
      ['CP-02', 'qa'],
      ['CP-90', 'revisor'],
    ]);
    expect(state.observaciones).toHaveLength(1);
    expect(state.rondasRevision).toBe(1);
    expect(state.revisorAprobo).toBe(true);
    expect(state.puntajes).toHaveLength(4);
    expect(state.totales?.costo_usd).toBe(0.012);
    expect(state.agentes.qa.entregas).toBe(2);
    expect(state.registro.map((e) => e.texto)).not.toContain('Evaluador empezó la ronda 1');
    expect(state.registro.map((e) => e.texto)).toEqual(
      expect.arrayContaining([
        'Analista entregó 2 historias',
        'Aprobaste las historias sin cambios',
        'QA entregó 3 casos de prueba',
        'Revisor pidió 1 corrección a QA (ronda 1)',
        'QA empezó la ronda 1',
        'Evaluador calificó: 4.0 de 5',
        'La corrida terminó',
      ]),
    );
  });

  it('pauses for the person with the proposed stories', () => {
    const events = fullRun().slice(0, 5);

    const state = reduce(events);

    expect(state.fase).toBe('esperando_aprobacion');
    expect(state.historias).toHaveLength(2);
    expect(state.registro.at(-1)?.texto).toBe('Esperando tu revisión de las historias');
  });

  it('ignores repeated and older events, as after a reconnection', () => {
    const events = fullRun();
    const once = reduce(events.slice(0, 6));

    const again = reduce(events.slice(3, 6), once);

    expect(again).toBe(once);
  });

  it('keeps the stories the person approved', () => {
    const state = reduce(
      eventsFrom(
        inicia,
        delivers('analista', { tipo: 'historias', historias: [historia(1), historia(2)] }),
        {
          type: 'humano_responde',
          agent: 'analista',
          decision: 'editado',
          cambios: { agregadas: [], modificadas: ['HU-1'], eliminadas: ['HU-2'] },
          historias: [historia(1, 'pagar en línea')],
        },
      ),
    );

    expect(state.historias).toEqual([historia(1, 'pagar en línea')]);
  });

  it('counts requests for another version and describes edits', () => {
    const state = reduce(
      eventsFrom(
        inicia,
        {
          type: 'humano_responde',
          agent: 'analista',
          decision: 'otra_version',
          cambios: { agregadas: [], modificadas: [], eliminadas: [] },
        },
        {
          type: 'humano_responde',
          agent: 'analista',
          decision: 'editado',
          cambios: { agregadas: ['HU-3'], modificadas: ['HU-1', 'HU-2'], eliminadas: ['HU-4'] },
        },
      ),
    );

    expect(state.otrasVersiones).toBe(1);
    expect(state.registro.map((e) => e.texto).slice(1)).toEqual([
      'Pediste otra versión de las historias',
      'Editaste las historias (1 agregada, 2 modificadas, 1 quitada)',
    ]);
  });

  it('keeps the agent error and the suggested fallback', () => {
    const state = reduce(
      eventsFrom(
        inicia,
        { type: 'agente_inicia', agent: 'qa', ronda: 0 },
        {
          type: 'agente_error',
          agent: 'qa',
          codigo: 'sin_saldo',
          mensaje: 'Sin saldo.',
          respaldo_sugerido: 'groq',
        },
        {
          type: 'corrida_fin',
          estado: 'error',
          puntajes: [],
          totales: { tokens_entrada: 0, tokens_salida: 0, latencia_ms: 0, costo_usd: 0 },
          respaldo_sugerido: 'groq',
          codigo: null,
          mensaje: null,
        },
      ),
    );

    expect(state.fase).toBe('error');
    expect(state.agentes.qa.estado).toBe('error');
    expect(state.error).toEqual({
      agente: 'qa',
      codigo: 'sin_saldo',
      mensaje: 'Sin saldo.',
      respaldoSugerido: 'groq',
    });
    expect(state.registro.map((e) => e.texto)).toContain('QA no pudo terminar');
  });

  it('turns an internal failure without agent error into a run error', () => {
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

    expect(state.error).toMatchObject({ agente: 'sistema', codigo: 'error_interno' });
  });

  it('records system errors and reviews that leave observations pending', () => {
    const state = reduce(
      eventsFrom(
        inicia,
        delivers(
          'revisor',
          {
            tipo: 'revision',
            veredicto: { aprobado: false, observaciones: [observacion(), observacion('analista')] },
          },
          2,
        ),
        {
          type: 'revisor_observa',
          agent: 'revisor',
          ronda: 2,
          observaciones: [observacion(), observacion('analista')],
          se_corrige: false,
        },
        {
          type: 'agente_error',
          agent: 'sistema',
          codigo: 'error_interno',
          mensaje: 'x',
          respaldo_sugerido: null,
        },
        { type: 'agente_progreso', agent: 'sistema', mensaje: 'x' },
        { type: 'agente_inicia', agent: 'sistema', ronda: 0 },
        delivers('qa', { tipo: 'pruebas', criterios: [], casos: [caso(1)] }),
      ),
    );

    expect(state.registro.map((e) => e.texto)).toEqual(
      expect.arrayContaining([
        'Revisor encontró 2 observaciones',
        'Revisor dejó 2 observaciones pendientes',
        'La corrida no pudo terminar',
        'QA entregó 1 caso de prueba',
      ]),
    );
    expect(state.rondasRevision).toBe(2);
  });

  it('starts a fresh state for a new run and averages scores', () => {
    const state = runReducer(reduce(fullRun()), { type: 'iniciar', runId: 'otra' });

    expect(state).toEqual(initialRunState('otra'));
    expect(initialRunState().fase).toBe('inactiva');
    expect(promedio([])).toBeNull();
    expect(historia(3).id).toBe('HU-3');
  });
});
