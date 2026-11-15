import { initialRunState, runReducer, teamMessages, type RunState } from '@/entities/corrida';
import type { Evento } from '@/shared/api';
import { delivers, eventsFrom, fullRun, historia, inicia } from '@/shared/lib/testing';

import { BOARD, WORK } from './places';
import { projectOffice } from './projection';

type Body = Parameters<typeof eventsFrom>[number];

const pausa = (historias: ReturnType<typeof historia>[]): Body => ({
  type: 'en_espera_humano',
  agent: 'analista',
  solicitud: 'aprobar_historias',
  historias,
});

const reduce = (events: Evento[]): RunState =>
  events.reduce((s, evento) => runReducer(s, { type: 'evento', evento }), initialRunState('r'));

describe('projectOffice', () => {
  it('leaves everyone to their routine before any analysis', () => {
    const office = projectOffice(initialRunState(), 'Ana Pérez');

    expect(office.momento).toBe('inactivo');
    expect(Object.values(office.agentes).every((a) => a.lugar === null && a.libre)).toBe(true);
    expect(office.celebrar).toBe(false);
    expect(office.contadores).toEqual({
      historias: '—',
      casos: '—',
      observaciones: '—',
      puntaje: '—',
    });
    expect(office.anuncio).toBeNull();
  });

  it('sends a working agent to its zone with a short bubble taken from the events', () => {
    const state = reduce(
      eventsFrom(inicia, { type: 'agente_inicia', agent: 'analista', ronda: 0 }),
    );

    const office = projectOffice(state);

    expect(office.momento).toBe('durante');
    expect(office.agentes.analista).toMatchObject({
      lugar: WORK.analista.id,
      trabajando: true,
      libre: false,
      actividad: 'redactando historias de usuario',
      globo: { texto: 'Redactando historias', tono: 'normal' },
    });
    expect(office.agentes.qa).toMatchObject({ lugar: null, libre: true, actividad: 'en espera' });
  });

  it('names the case being corrected and has the Reviewer ask for it from the meeting room', () => {
    const observa: Body = {
      type: 'revisor_observa',
      agent: 'revisor',
      ronda: 0,
      se_corrige: true,
      observaciones: [
        {
          tipo: 'faltante',
          destino: 'qa',
          referencias: ['CP-09'],
          descripcion: 'Falta un caso',
          sugerencia: 'Agrégalo',
        },
      ],
    };
    const base: Body[] = [
      inicia,
      delivers('analista', { tipo: 'historias', historias: [historia(1)] }),
      { type: 'agente_inicia', agent: 'revisor', ronda: 0 },
      delivers('revisor', { tipo: 'revision', veredicto: { aprobado: false, observaciones: [] } }),
      observa,
    ];
    const asked = projectOffice(reduce(eventsFrom(...base)));
    expect(asked.agentes.revisor).toMatchObject({
      lugar: WORK.revisor.id,
      trabajando: false,
      globo: { texto: 'Pide corrección a QA' },
    });
    const said = projectOffice(
      reduce(eventsFrom(...base)),
      null,
      teamMessages(eventsFrom(...base)),
    );
    expect(said.agentes.revisor.globo?.texto).toBe('QA: corrige CP-09');

    const fixing = projectOffice(
      reduce(eventsFrom(...base, { type: 'agente_inicia', agent: 'qa', ronda: 1 })),
    );
    expect(fixing.agentes.qa).toMatchObject({
      actividad: 'corrigiendo casos de prueba',
      globo: { texto: 'Corrigiendo CP-09' },
    });
    expect(fixing.agentes.revisor.globo?.texto).toBe('Pide corrección a QA');
  });

  it('brings the Analyst to the board with papers and an amber call by first name on your turn', () => {
    const state = reduce(eventsFrom(inicia, pausa([historia(1), historia(2)])));

    const office = projectOffice(state, 'Ana Pérez');

    expect(office.momento).toBe('tu_turno');
    expect(office.agentes.analista).toMatchObject({
      lugar: BOARD.id,
      libre: false,
      papeles: true,
      globo: { texto: 'Ana, necesito tu ayuda', tono: 'turno' },
    });
    expect(office.contadores.historias).toBe('2 por aprobar');
    expect(office.anuncio).toBe('Las historias están listas para tu revisión.');
    expect(projectOffice(state, '  ').agentes.analista.globo?.texto).toBe(
      'Hola, necesito tu ayuda',
    );
  });

  it('sets everyone free to celebrate at the end, with the Evaluator saying the analysis is ready', () => {
    const office = projectOffice(reduce(fullRun()));

    expect(office.momento).toBe('terminado');
    expect(office.celebrar).toBe(true);
    expect(Object.values(office.agentes).every((a) => a.libre && a.lugar === null)).toBe(true);
    expect(office.agentes.evaluador).toMatchObject({ globo: { texto: 'Análisis listo' } });
    expect(office.contadores).toMatchObject({ casos: '2 +1', puntaje: '4.0' });
    expect(office.anuncio).toBe('Análisis terminado.');
  });

  it('keeps an agent that failed at its post with a gray bubble', () => {
    const state = reduce(
      eventsFrom(inicia, {
        type: 'agente_error',
        agent: 'qa',
        codigo: 'salida_invalida',
        mensaje: 'x',
        respaldo_sugerido: null,
      }),
    );

    const office = projectOffice(state);

    expect(office.agentes.qa).toMatchObject({
      lugar: WORK.qa.id,
      libre: false,
      globo: { texto: 'No pude terminar', tono: 'error' },
    });
  });
});
