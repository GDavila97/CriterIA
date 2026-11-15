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

import {
  conversationSummary,
  filterMessages,
  teamMessages,
  type TeamMessage,
} from './conversation';

const brief = (m: TeamMessage) => [m.from, m.to, m.kind, m.ronda];

describe('teamMessages', () => {
  it('follows the real graph: Analista, you, QA, Revisor, the correction and the score', () => {
    const messages = teamMessages(fullRun());

    expect(messages.map(brief)).toEqual([
      ['analista', 'tu', 'entrega', 0],
      ['tu', 'qa', 'aprobacion', 0],
      ['qa', 'revisor', 'entrega', 0],
      ['revisor', 'qa', 'correccion', 0],
      ['qa', 'revisor', 'entrega', 1],
      ['revisor', 'evaluador', 'entrega', 1],
      ['evaluador', 'equipo', 'calificacion', 0],
    ]);
    expect(messages.map((m) => m.text)).toEqual([
      'Entregué 2 historias de usuario a partir del requerimiento.',
      'Aprobaste las historias sin cambios.',
      'Escribí 2 casos de prueba con sus escenarios Gherkin.',
      'Falta un caso de error. Sugerencia: Agregar un caso con datos vacíos.',
      'Agregué CP-90 para atender la observación del Revisor.',
      'Aprobé las historias y los casos; no quedan observaciones.',
      'Califiqué el análisis con 4.0 de 5. Lo más débil: completitud (3.0).',
    ]);
  });

  it('links what each message mentions', () => {
    const [stories, , cases, correction, added, , score] = teamMessages(fullRun());

    expect(stories!.refs.map((r) => r.id)).toEqual(['HU-1', 'HU-2']);
    expect(cases!.refs.map((r) => r.id)).toEqual(['CP-01', 'CP-02']);
    expect(correction!.refs).toEqual([
      { kind: 'observacion', id: 'O-1', label: 'O-1' },
      { kind: 'historia', id: 'HU-1', label: 'HU-1' },
    ]);
    expect(added!.refs).toEqual([{ kind: 'caso', id: 'CP-90', label: 'CP-90' }]);
    expect(score!.refs).toEqual([{ kind: 'rubrica', id: 'rubrica', label: 'Rúbrica' }]);
  });

  it('gives the office and the diagram their short texts', () => {
    const messages = teamMessages(fullRun());

    expect(messages.map((m) => m.short)).toEqual([
      '2 historias listas',
      'Aprobado',
      '2 casos listos',
      'QA: corrige HU-1',
      'Agregué CP-90',
      'Todo en orden',
      '4.0 de 5',
    ]);
    expect(messages.map((m) => [m.title, m.sub])).toEqual([
      ['Escribe historias', 'HU-1 · HU-2'],
      ['Apruebas', 'Sin cambios'],
      ['Escribe casos', '2 casos · Gherkin'],
      ['Revisa casos', '1 observación'],
      ['Agrega CP-90', 'Caso 90'],
      ['Aprueba', 'Sin observaciones'],
      ['Califica', '4.0 de 5'],
    ]);
  });

  it('summarizes long lists as a range that opens its first item', () => {
    const historias = Array.from({ length: 5 }, (_, i) => historia(i + 1));
    const [message] = teamMessages(
      eventsFrom(inicia, delivers('analista', { tipo: 'historias', historias })),
    );

    expect(message!.sub).toBe('HU-1 … HU-5');
    expect(message!.refs).toEqual([{ kind: 'historia', id: 'HU-1', label: 'HU-1 … HU-5' }]);
  });

  it('tells another version, an edit and a story correction apart', () => {
    const two = [historia(1), historia(2)];
    const fixed = [historia(1), historia(2, 'hacer la tarea 2 en 24 horas')];
    const messages = teamMessages(
      eventsFrom(
        inicia,
        delivers('analista', { tipo: 'historias', historias: two }),
        {
          type: 'humano_responde',
          agent: 'analista',
          decision: 'otra_version',
          cambios: { agregadas: [], modificadas: [], eliminadas: [] },
          historias: null,
        },
        delivers('analista', { tipo: 'historias', historias: two }),
        {
          type: 'humano_responde',
          agent: 'analista',
          decision: 'editado',
          cambios: { agregadas: ['HU-3'], modificadas: ['HU-1'], eliminadas: [] },
          historias: two,
        },
        {
          type: 'revisor_observa',
          agent: 'revisor',
          ronda: 0,
          observaciones: [
            observacion('analista'),
            { ...observacion('qa'), referencias: ['CP-02'] },
          ],
          se_corrige: true,
        },
        delivers('analista', { tipo: 'historias', historias: fixed }, 1),
        delivers('qa', { tipo: 'pruebas', criterios: [], casos: [caso(1), caso(2)] }, 1),
      ),
    );

    expect(messages.map((m) => [m.from, m.to, m.text])).toEqual([
      ['analista', 'tu', 'Entregué 2 historias de usuario a partir del requerimiento.'],
      ['tu', 'analista', 'Pediste otra versión de las historias.'],
      ['analista', 'tu', 'Escribí otra versión con 2 historias.'],
      ['tu', 'qa', 'Editaste las historias (1 agregada, 1 modificada) y las aprobaste.'],
      [
        'revisor',
        'analista',
        'Falta un caso de error. Sugerencia: Agregar un caso con datos vacíos.',
      ],
      ['revisor', 'qa', 'Falta un caso de error. Sugerencia: Agregar un caso con datos vacíos.'],
      ['analista', 'qa', 'Ajusté HU-2 con las observaciones del Revisor.'],
      ['qa', 'revisor', 'Escribí 2 casos de prueba con sus escenarios Gherkin.'],
    ]);
    expect(messages[4]!.refs.map((r) => r.id)).toEqual(['O-1', 'HU-1']);
    expect(
      teamMessages(
        eventsFrom(
          inicia,
          delivers('analista', { tipo: 'historias', historias: two }),
          delivers('analista', { tipo: 'historias', historias: [...two, historia(3)] }, 1),
        ),
      )[1],
    ).toMatchObject({
      text: 'Agregué HU-3 con las observaciones del Revisor.',
      title: 'Agrega HU-3',
    });
    expect(messages[5]!.refs.map((r) => r.id)).toEqual(['O-2', 'CP-02']);
  });

  it('marks observations left for lack of rounds and errors', () => {
    const messages = teamMessages(
      eventsFrom(
        inicia,
        {
          type: 'revisor_observa',
          agent: 'revisor',
          ronda: 1,
          observaciones: [observacion(), observacion()],
          se_corrige: false,
        },
        {
          type: 'agente_error',
          agent: 'evaluador',
          codigo: 'proveedor_no_disponible',
          mensaje: 'El proveedor no respondió',
          respaldo_sugerido: null,
          uso: null,
        },
        { type: 'agente_error', agent: 'sistema', codigo: 'error_interno', mensaje: 'x' },
      ),
    );

    expect(messages.map(brief)).toEqual([
      ['revisor', 'qa', 'pendiente', 1],
      ['evaluador', null, 'error', 0],
    ]);
    expect(messages[0]!.text).toMatch(/^Quedan 2 observaciones sin corregir/);
    expect(messages[1]!.text).toBe('El proveedor no respondió.');
  });

  it('corrects existing cases without adding any, and scores without numbers', () => {
    const changed = { ...caso(1), titulo: 'Caso 1 corregido' };
    const messages = teamMessages(
      eventsFrom(
        inicia,
        delivers('qa', { tipo: 'pruebas', criterios: [], casos: [caso(1)] }),
        delivers('qa', { tipo: 'pruebas', criterios: [], casos: [changed] }, 1),
        delivers('qa', { tipo: 'pruebas', criterios: [], casos: [changed] }, 2),
        delivers('evaluador', { tipo: 'puntajes', puntajes: [] }, 1),
      ),
    );

    expect(messages.at(-1)).toMatchObject({ from: 'evaluador', ronda: 0 });

    expect(messages.map((m) => m.text)).toEqual([
      'Escribí 1 caso de prueba con sus escenarios Gherkin.',
      'Corregí CP-01 con las observaciones del Revisor.',
      'Revisé los casos con las observaciones del Revisor.',
      'No pude calificar el análisis.',
    ]);
  });
});

describe('filters and summary', () => {
  const messages = teamMessages(fullRun());

  it('keeps the messages of each filter', () => {
    expect(filterMessages(messages, 'todo')).toHaveLength(7);
    expect(filterMessages(messages, 'correcciones').map((m) => m.from)).toEqual(['revisor']);
    expect(filterMessages(messages, 'entregas')).toHaveLength(5);
    expect(filterMessages(messages, 'aprobacion').map((m) => m.from)).toEqual(['tu']);
  });

  it('counts messages and corrections', () => {
    expect(conversationSummary(messages)).toBe('7 mensajes · 1 corrección');
    expect(conversationSummary([])).toBe('0 mensajes · 0 correcciones');
  });

  it('builds nothing from an empty or idle run', () => {
    expect(teamMessages([] as Evento[])).toEqual([]);
    expect(
      teamMessages(eventsFrom(inicia, { type: 'agente_inicia', agent: 'qa', ronda: 0 })),
    ).toEqual([]);
  });
});
