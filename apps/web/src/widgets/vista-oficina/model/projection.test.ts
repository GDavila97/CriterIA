import { initialRunState, runReducer, type RunState } from '@/entities/corrida';
import type { Evento } from '@/shared/api';
import { delivers, eventsFrom, fullRun, historia, inicia } from '@/shared/lib/testing';

import { BOARD_SPOT, WORK_SPOTS } from './layout';
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
  it('rests everyone in the break room before any analysis', () => {
    const office = projectOffice(initialRunState(), 'Ana Pérez');

    expect(office.momento).toBe('inactivo');
    expect(Object.values(office.agentes).every((a) => a.zona === 'descanso' && a.libre)).toBe(true);
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
      zona: 'escritorios',
      punto: WORK_SPOTS.analista,
      trabajando: true,
      libre: false,
      actividad: 'redactando historias de usuario',
      globo: { texto: 'Redactando historias', tono: 'normal' },
    });
    expect(office.agentes.qa).toMatchObject({
      zona: 'descanso',
      libre: true,
      actividad: 'en espera',
    });
    expect(office.ultimoEvento).toBe('Analista empezó');
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
      zona: 'juntas',
      trabajando: false,
      globo: { texto: 'Pide corrección a QA' },
    });

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
      zona: 'tablero',
      punto: BOARD_SPOT,
      papeles: true,
      globo: { texto: 'Ana, necesito tu ayuda', tono: 'turno' },
    });
    expect(office.contadores.historias).toBe('2 por aprobar');
    expect(office.anuncio).toBe('Las historias están listas para tu revisión.');
    expect(projectOffice(state, '  ').agentes.analista.globo?.texto).toBe(
      'Hola, necesito tu ayuda',
    );
  });

  it('sends everyone to rest at the end, with the Evaluator saying the analysis is ready', () => {
    const office = projectOffice(reduce(fullRun()));

    expect(office.momento).toBe('terminado');
    expect(Object.values(office.agentes).every((a) => a.zona === 'descanso')).toBe(true);
    expect(office.agentes.evaluador).toMatchObject({
      libre: false,
      globo: { texto: 'Análisis listo' },
    });
    expect(office.agentes.qa.libre).toBe(true);
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
      zona: 'escritorios',
      globo: { texto: 'No pude terminar', tono: 'error' },
    });
  });
});
