import type { HistoryItemBody, Uso } from '@/shared/api';

import type { AgentId } from './agents';
import { initialRunState, promedio, type RunState } from './reducer';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface AgentSummary {
  estado: string;
  detalle: string | null;
}

export function agentSummary(state: RunState, id: AgentId): AgentSummary {
  const agente = state.agentes[id];
  if (agente.estado === 'error') return { estado: 'No pudo terminar', detalle: null };
  if (agente.estado === 'trabajando') return { estado: 'Trabajando', detalle: agente.mensaje };
  if (id === 'analista' && state.fase === 'esperando_aprobacion') {
    return {
      estado: 'Esperándote',
      detalle: plural(state.historias.length, 'historia', 'historias'),
    };
  }
  if (agente.estado === 'pendiente') return { estado: 'En espera', detalle: null };
  switch (id) {
    case 'analista':
      return {
        estado: 'Entregó',
        detalle: plural(state.historias.length, 'historia', 'historias'),
      };
    case 'qa': {
      const corregidos = state.casos.filter((c) => c.origen === 'revisor').length;
      const casos = plural(state.casos.length, 'caso', 'casos');
      return {
        estado: 'Entregó',
        detalle: corregidos ? `${casos} · corrigió ${corregidos}` : casos,
      };
    }
    case 'revisor': {
      const rondas = plural(agente.entregas, 'ronda', 'rondas');
      const observaciones = plural(state.observaciones.length, 'observación', 'observaciones');
      return {
        estado: state.revisorAprobo ? 'Aprobó' : 'Revisó',
        detalle: `${rondas} · ${observaciones}`,
      };
    }
    case 'evaluador': {
      const media = promedio(state.puntajes);
      return {
        estado: 'Calificó',
        detalle: media === null ? null : `${media.toFixed(1)} de 5 en promedio`,
      };
    }
  }
}

export function formatElapsed(fromIso: string, toIso: string): string {
  const seconds = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;
}

export function formatClock(fromIso: string, atIso: string): string {
  const seconds = Math.max(0, Math.round((Date.parse(atIso) - Date.parse(fromIso)) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'sin precio';
  return `USD ${value < 0.01 ? value.toFixed(4) : value.toFixed(3)}`;
}

export function runHeadline(state: RunState): string {
  switch (state.fase) {
    case 'inactiva':
      return 'Escribe un requerimiento y ejecuta la corrida';
    case 'esperando_aprobacion':
      return 'Esperando tu revisión';
    case 'en_curso':
      return 'En curso';
    case 'completada':
    case 'error': {
      const partes = [state.fase === 'completada' ? 'Corrida terminada' : 'Corrida detenida'];
      if (state.rondasRevision) {
        partes.push(plural(state.rondasRevision, 'ronda de revisión', 'rondas de revisión'));
      }
      if (state.inicio && state.fin) partes.push(formatElapsed(state.inicio, state.fin));
      if (state.totales) partes.push(formatUsd(state.totales.costo_usd));
      return partes.join(' · ');
    }
  }
}

export function totalUse(usos: Uso[]): {
  tokens: number;
  latenciaMs: number;
  costo: number | null;
} {
  const costos = usos.map((u) => u.costo_usd);
  return {
    tokens: usos.reduce((sum, u) => sum + u.tokens_entrada + u.tokens_salida, 0),
    latenciaMs: usos.reduce((sum, u) => sum + u.latencia_ms, 0),
    costo: costos.some((c) => c === null) ? null : costos.reduce<number>((s, c) => s + (c ?? 0), 0),
  };
}

type Artifacts = {
  historias?: { historias?: RunState['historias'] };
  pruebas?: { criterios?: RunState['criterios']; casos?: RunState['casos'] };
  revision?: {
    veredicto?: {
      aprobado?: boolean;
      observaciones?: RunState['observaciones'][number]['observacion'][];
    };
  };
};

/** A saved run shown with the same views as a live one, read-only. */
export function stateFromSaved(item: HistoryItemBody): RunState {
  const artifacts = item.artifacts as Artifacts;
  const base = initialRunState(item.id);
  const delivered = (n: number) => ({
    ...base.agentes.analista,
    estado: 'entrego' as const,
    entregas: n,
  });
  return {
    ...base,
    fase: item.status === 'completada' ? 'completada' : 'error',
    proveedor: item.provider,
    modelos: { generacion: `${item.provider}:${item.model}`, juez: item.judge_model },
    versionPrompts: item.prompt_version,
    versionJuez: item.judge_version,
    agentes: {
      analista: delivered(1),
      qa: delivered(artifacts.pruebas ? 1 : 0),
      revisor: delivered(artifacts.revision ? 1 : 0),
      evaluador: delivered(item.scores.length ? 1 : 0),
    },
    historias: artifacts.historias?.historias ?? [],
    criterios: artifacts.pruebas?.criterios ?? [],
    casos: artifacts.pruebas?.casos ?? [],
    observaciones: (artifacts.revision?.veredicto?.observaciones ?? []).map((observacion) => ({
      ronda: 0,
      observacion,
      seCorrige: false,
    })),
    revisorAprobo: artifacts.revision?.veredicto?.aprobado ?? null,
    puntajes: item.scores as unknown as RunState['puntajes'],
    totales: item.totals as unknown as RunState['totales'],
  };
}
