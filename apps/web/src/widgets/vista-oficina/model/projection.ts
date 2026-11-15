import {
  AGENT_IDS,
  AGENTS,
  promedio,
  type AgentId,
  type RunState,
  type TeamMessage,
} from '@/entities/corrida';

import { BOARD, WORK } from './places';

export type Momento = 'inactivo' | 'durante' | 'tu_turno' | 'terminado' | 'detenido';

export interface Globo {
  texto: string;
  tono: 'normal' | 'turno' | 'error';
}

export interface AgentPlan {
  /** For the agent row: "QA · escribiendo casos de prueba". */
  actividad: string;
  /** The place it must stand on, such as its work or the board; null leaves it to its routine. */
  lugar: string | null;
  /** Free agents follow their own routine around the office. */
  libre: boolean;
  trabajando: boolean;
  papeles: boolean;
  globo: Globo | null;
}

export interface Counters {
  historias: string;
  casos: string;
  observaciones: string;
  puntaje: string;
}

export interface OfficeSnapshot {
  momento: Momento;
  agentes: Record<AgentId, AgentPlan>;
  contadores: Counters;
  /** What the live region says; only the moments that need the person. */
  anuncio: string | null;
  /** The analysis just ended: the team gathers in the break room before going back to routine. */
  celebrar: boolean;
}

function free(actividad: string, globo: Globo | null = null): AgentPlan {
  return {
    actividad,
    lugar: null,
    libre: true,
    trabajando: false,
    papeles: false,
    globo,
  };
}

function atWork(id: AgentId, actividad: string, texto: string): AgentPlan {
  return {
    actividad,
    lugar: WORK[id].id,
    libre: false,
    trabajando: true,
    papeles: false,
    globo: { texto, tono: 'normal' },
  };
}

/** The first id the Reviewer pointed this agent to in the round being corrected, if any. */
function correcting(state: RunState, id: AgentId, prefix: string): string | null {
  const ronda = state.agentes[id].ronda - 1;
  const observacion = state.observaciones.find(
    (o) => o.ronda === ronda && o.observacion.destino === id,
  );
  return observacion?.observacion.referencias.find((r) => r.startsWith(prefix)) ?? null;
}

function working(state: RunState, id: AgentId): AgentPlan {
  const ronda = state.agentes[id].ronda;
  switch (id) {
    case 'analista': {
      if (!ronda) return atWork(id, 'redactando historias de usuario', 'Redactando historias');
      const ref = correcting(state, id, 'HU-');
      return atWork(
        id,
        'corrigiendo historias',
        ref ? `Corrigiendo ${ref}` : 'Corrigiendo historias',
      );
    }
    case 'qa': {
      if (!ronda) return atWork(id, 'escribiendo casos de prueba', 'Escribiendo casos');
      const ref = correcting(state, id, 'CP-') ?? correcting(state, id, 'CA-');
      return atWork(
        id,
        'corrigiendo casos de prueba',
        ref ? `Corrigiendo ${ref}` : 'Corrigiendo casos',
      );
    }
    case 'revisor':
      return ronda
        ? atWork(id, 'revisando las correcciones', 'Revisando correcciones')
        : atWork(id, 'revisando historias y casos', 'Revisando artefactos');
    case 'evaluador':
      return atWork(id, 'calificando con la rúbrica', 'Calificando');
  }
}

/** The Reviewer's latest corrections that are still being made, as "QA" or "Analista y QA". */
function pendingCorrections(state: RunState): string | null {
  if (state.revisorAprobo !== false) return null;
  const last = Math.max(-1, ...state.observaciones.map((o) => o.ronda));
  const destinos = new Set(
    state.observaciones
      .filter((o) => o.ronda === last && o.seCorrige)
      .map((o) => AGENTS[o.observacion.destino].nombre),
  );
  return destinos.size ? [...destinos].join(' y ') : null;
}

function during(state: RunState, id: AgentId, messages: readonly TeamMessage[]): AgentPlan {
  const agente = state.agentes[id];
  if (agente.estado === 'error') {
    return {
      ...atWork(id, 'no pudo terminar', 'No pude terminar'),
      trabajando: false,
      globo: { texto: 'No pude terminar', tono: 'error' },
    };
  }
  if (agente.estado === 'trabajando') return working(state, id);
  if (
    id === 'revisor' &&
    agente.estado === 'entrego' &&
    state.agentes.evaluador.estado === 'pendiente'
  ) {
    const destinos = pendingCorrections(state);
    if (destinos) {
      // The same short line the conversation gives this correction.
      const said = messages.findLast((m) => m.kind === 'correccion')?.short;
      return {
        ...atWork(id, `pidió correcciones a ${destinos}`, said ?? `Pide corrección a ${destinos}`),
        trabajando: false,
      };
    }
  }
  return free(agente.estado === 'pendiente' ? 'en espera' : 'terminó su parte');
}

function firstName(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

function counters(state: RunState, momento: Momento): Counters {
  const media = promedio(state.puntajes);
  const delRevisor = state.casos.filter((c) => c.origen === 'revisor').length;
  const historias = state.historias.length;
  const dash = '—';
  return {
    historias: historias ? `${historias}${momento === 'tu_turno' ? ' por aprobar' : ''}` : dash,
    casos: state.casos.length
      ? `${state.casos.length - delRevisor}${delRevisor ? ` +${delRevisor}` : ''}`
      : dash,
    observaciones: state.observaciones.length ? String(state.observaciones.length) : dash,
    puntaje: media === null ? dash : media.toFixed(1),
  };
}

function momentOf(state: RunState): Momento {
  switch (state.fase) {
    case 'inactiva':
      return 'inactivo';
    case 'en_curso':
      return 'durante';
    case 'esperando_aprobacion':
      return 'tu_turno';
    case 'completada':
      return 'terminado';
    case 'error':
      return 'detenido';
  }
}

const ANNOUNCEMENTS: Partial<Record<Momento, string>> = {
  tu_turno: 'Las historias están listas para tu revisión.',
  terminado: 'Análisis terminado.',
  detenido: 'El análisis se detuvo.',
};

/**
 * The office as a pure projection of the same run state the classic view reads: where each
 * agent is, what it does and what its bubble says. No event or endpoint of its own.
 */
export function projectOffice(
  state: RunState,
  name: string | null = null,
  messages: readonly TeamMessage[] = [],
): OfficeSnapshot {
  const momento = momentOf(state);
  const nombre = firstName(name);
  const agentes = Object.fromEntries(
    AGENT_IDS.map((id): [AgentId, AgentPlan] => {
      switch (momento) {
        case 'inactivo':
          return [id, free('en su rutina')];
        case 'tu_turno':
          if (id === 'analista') {
            return [
              id,
              {
                actividad: 'espera tu revisión de las historias',
                lugar: BOARD.id,
                libre: false,
                trabajando: false,
                papeles: true,
                globo: {
                  texto: nombre ? `${nombre}, necesito tu ayuda` : 'Hola, necesito tu ayuda',
                  tono: 'turno',
                },
              },
            ];
          }
          return [id, free('en espera')];
        case 'terminado':
          // The Evaluator's line shows while the team celebrates; the view decides when.
          return [
            id,
            id === 'evaluador'
              ? free('análisis listo', { texto: 'Análisis listo', tono: 'normal' })
              : free('celebrando'),
          ];
        case 'detenido':
        case 'durante':
          return [id, during(state, id, messages)];
      }
    }),
  ) as Record<AgentId, AgentPlan>;

  return {
    momento,
    agentes,
    contadores: counters(state, momento),
    anuncio: ANNOUNCEMENTS[momento] ?? null,
    celebrar: momento === 'terminado',
  };
}
