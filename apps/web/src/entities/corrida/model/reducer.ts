import type {
  AgenteError,
  CasoPrueba,
  CriterioAceptacion,
  Evento,
  HistoriaUsuario,
  ModelosCorrida,
  Observacion,
  Puntaje,
  Totales,
  Uso,
} from '@/shared/api';

import { AGENTS, isAgentId, type AgentId } from './agents';

export type AgentStatus = 'pendiente' | 'trabajando' | 'entrego' | 'error';
export type RunPhase = 'inactiva' | 'en_curso' | 'esperando_aprobacion' | 'completada' | 'error';

export interface AgentState {
  estado: AgentStatus;
  ronda: number;
  mensaje: string | null;
  entregas: number;
  usos: Uso[];
}

export interface ObservacionRonda {
  ronda: number;
  observacion: Observacion;
  seCorrige: boolean;
}

export interface LogEntry {
  seq: number;
  ts: string;
  agent: AgentId | 'sistema';
  texto: string;
}

export interface RunError {
  agente: AgentId | 'sistema';
  codigo: AgenteError['codigo'];
  mensaje: string;
  respaldoSugerido: 'groq' | null;
}

export interface RunState {
  runId: string | null;
  fase: RunPhase;
  ultimoSeq: number;
  inicio: string | null;
  fin: string | null;
  proveedor: string | null;
  modelos: ModelosCorrida | null;
  versionPrompts: string | null;
  versionJuez: string | null;
  juezMismoProveedor: boolean;
  maxRondas: number;
  agentes: Record<AgentId, AgentState>;
  historias: HistoriaUsuario[];
  criterios: CriterioAceptacion[];
  casos: CasoPrueba[];
  observaciones: ObservacionRonda[];
  rondasRevision: number;
  revisorAprobo: boolean | null;
  puntajes: Puntaje[];
  totales: Totales | null;
  otrasVersiones: number;
  registro: LogEntry[];
  error: RunError | null;
}

export type RunAction = { type: 'iniciar'; runId: string } | { type: 'evento'; evento: Evento };

const idleAgent: AgentState = {
  estado: 'pendiente',
  ronda: 0,
  mensaje: null,
  entregas: 0,
  usos: [],
};

export function initialRunState(runId: string | null = null): RunState {
  return {
    runId,
    fase: runId ? 'en_curso' : 'inactiva',
    ultimoSeq: 0,
    inicio: null,
    fin: null,
    proveedor: null,
    modelos: null,
    versionPrompts: null,
    versionJuez: null,
    juezMismoProveedor: false,
    maxRondas: 0,
    agentes: { analista: idleAgent, qa: idleAgent, revisor: idleAgent, evaluador: idleAgent },
    historias: [],
    criterios: [],
    casos: [],
    observaciones: [],
    rondasRevision: 0,
    revisorAprobo: null,
    puntajes: [],
    totales: null,
    otrasVersiones: 0,
    registro: [],
    error: null,
  };
}

export const CRITERIO_LABEL: Record<Puntaje['criterio'], string> = {
  claridad: 'Claridad',
  verificabilidad: 'Verificabilidad',
  completitud: 'Completitud',
  consistencia: 'Consistencia',
};

export const OBSERVACION_LABEL: Record<Observacion['tipo'], string> = {
  ambiguedad: 'Ambigüedad',
  inconsistencia: 'Inconsistencia',
  faltante: 'Faltante',
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function promedio(puntajes: Puntaje[]): number | null {
  if (puntajes.length === 0) return null;
  return puntajes.reduce((sum, p) => sum + p.valor, 0) / puntajes.length;
}

function withAgent(state: RunState, id: AgentId, patch: Partial<AgentState>): RunState {
  return { ...state, agentes: { ...state.agentes, [id]: { ...state.agentes[id], ...patch } } };
}

function log(state: RunState, evento: Evento, texto: string): RunState {
  const agent = isAgentId(evento.agent) ? evento.agent : 'sistema';
  return {
    ...state,
    registro: [...state.registro, { seq: evento.seq, ts: evento.ts, agent, texto }],
  };
}

function cambiosTexto(agregadas: number, modificadas: number, eliminadas: number): string {
  const partes = [
    agregadas && plural(agregadas, 'agregada', 'agregadas'),
    modificadas && plural(modificadas, 'modificada', 'modificadas'),
    eliminadas && plural(eliminadas, 'quitada', 'quitadas'),
  ].filter(Boolean);
  return partes.length
    ? `Editaste las historias (${partes.join(', ')})`
    : 'Aprobaste las historias sin cambios';
}

function apply(state: RunState, evento: Evento): RunState {
  switch (evento.type) {
    case 'corrida_inicia':
      return log(
        {
          ...state,
          runId: evento.run_id,
          fase: 'en_curso',
          inicio: evento.ts,
          proveedor: evento.proveedor,
          modelos: evento.modelos,
          versionPrompts: evento.version_prompts,
          versionJuez: evento.version_juez,
          juezMismoProveedor: evento.juez_mismo_proveedor,
          maxRondas: evento.max_rondas,
        },
        evento,
        'La corrida empezó',
      );
    case 'agente_inicia': {
      if (!isAgentId(evento.agent)) return state;
      const next = withAgent({ ...state, fase: 'en_curso' }, evento.agent, {
        estado: 'trabajando',
        ronda: evento.ronda,
      });
      const quien = AGENTS[evento.agent].nombre;
      return log(
        next,
        evento,
        // The Evaluador scores once; only the agents that correct work in rounds.
        evento.ronda && evento.agent !== 'evaluador'
          ? `${quien} empezó la ronda ${evento.ronda}`
          : `${quien} empezó`,
      );
    }
    case 'agente_progreso':
      return isAgentId(evento.agent)
        ? withAgent(state, evento.agent, { mensaje: evento.mensaje })
        : state;
    case 'agente_entrega': {
      if (!isAgentId(evento.agent)) return state;
      const agente = state.agentes[evento.agent];
      let next = withAgent(state, evento.agent, {
        estado: 'entrego',
        mensaje: null,
        entregas: agente.entregas + 1,
        usos: [...agente.usos, evento.uso],
      });
      const artefactos = evento.artefactos;
      let texto: string;
      switch (artefactos.tipo) {
        case 'historias':
          next = { ...next, historias: artefactos.historias };
          texto = `Analista entregó ${plural(artefactos.historias.length, 'historia', 'historias')}`;
          break;
        case 'pruebas':
          next = { ...next, criterios: artefactos.criterios, casos: artefactos.casos };
          texto = `QA entregó ${plural(artefactos.casos.length, 'caso de prueba', 'casos de prueba')}`;
          break;
        case 'revision':
          next = {
            ...next,
            rondasRevision: Math.max(next.rondasRevision, evento.ronda),
            revisorAprobo: artefactos.veredicto.aprobado,
          };
          texto = artefactos.veredicto.aprobado
            ? 'Revisor aprobó los artefactos'
            : `Revisor encontró ${plural(artefactos.veredicto.observaciones.length, 'observación', 'observaciones')}`;
          break;
        case 'puntajes': {
          next = { ...next, puntajes: artefactos.puntajes };
          const media = promedio(artefactos.puntajes);
          texto = `Evaluador calificó: ${media === null ? 'sin puntaje' : `${media.toFixed(1)} de 5`}`;
          break;
        }
      }
      return log(next, evento, texto);
    }
    case 'en_espera_humano':
      return log(
        withAgent(
          { ...state, fase: 'esperando_aprobacion', historias: evento.historias },
          'analista',
          {
            estado: 'entrego',
          },
        ),
        evento,
        'Esperando tu revisión de las historias',
      );
    case 'humano_responde': {
      const otra = evento.decision === 'otra_version';
      const next = {
        ...state,
        fase: 'en_curso' as const,
        otrasVersiones: state.otrasVersiones + (otra ? 1 : 0),
        historias: evento.historias ?? state.historias,
      };
      const { agregadas, modificadas, eliminadas } = evento.cambios;
      return log(
        next,
        evento,
        otra
          ? 'Pediste otra versión de las historias'
          : cambiosTexto(agregadas.length, modificadas.length, eliminadas.length),
      );
    }
    case 'revisor_observa': {
      const nuevas = evento.observaciones.map((observacion) => ({
        ronda: evento.ronda,
        observacion,
        seCorrige: evento.se_corrige,
      }));
      const destinos = new Set(evento.observaciones.map((o) => AGENTS[o.destino].nombre));
      const texto = evento.se_corrige
        ? `Revisor pidió ${plural(evento.observaciones.length, 'corrección', 'correcciones')} a ${[...destinos].join(' y ')} (ronda ${evento.ronda + 1})`
        : `Revisor dejó ${plural(evento.observaciones.length, 'observación pendiente', 'observaciones pendientes')}`;
      return log({ ...state, observaciones: [...state.observaciones, ...nuevas] }, evento, texto);
    }
    case 'agente_error': {
      const agente = isAgentId(evento.agent) ? evento.agent : 'sistema';
      const next =
        agente === 'sistema' ? state : withAgent(state, agente, { estado: 'error', mensaje: null });
      const quien = agente === 'sistema' ? 'La corrida' : AGENTS[agente].nombre;
      return log(
        {
          ...next,
          error: {
            agente,
            codigo: evento.codigo,
            mensaje: evento.mensaje,
            respaldoSugerido: evento.respaldo_sugerido,
          },
        },
        evento,
        `${quien} no pudo terminar`,
      );
    }
    case 'corrida_fin': {
      const fallo = evento.estado === 'error';
      const error =
        state.error ??
        (fallo && evento.codigo
          ? {
              agente: 'sistema' as const,
              codigo: evento.codigo,
              mensaje: evento.mensaje ?? 'La corrida se detuvo por un error.',
              respaldoSugerido: evento.respaldo_sugerido,
            }
          : null);
      return log(
        {
          ...state,
          fase: fallo ? 'error' : 'completada',
          fin: evento.ts,
          puntajes: evento.puntajes.length ? evento.puntajes : state.puntajes,
          totales: evento.totales,
          error,
        },
        evento,
        fallo ? 'La corrida terminó con un error' : 'La corrida terminó',
      );
    }
  }
}

/** Reduces the run's events to the state every view reads; repeated events are ignored. */
export function runReducer(state: RunState, action: RunAction): RunState {
  if (action.type === 'iniciar') return initialRunState(action.runId);
  if (action.evento.seq <= state.ultimoSeq) return state;
  return { ...apply(state, action.evento), ultimoSeq: action.evento.seq };
}
