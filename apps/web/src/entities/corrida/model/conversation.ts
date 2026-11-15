import type {
  AgenteEntrega,
  CasoPrueba,
  Evento,
  HistoriaUsuario,
  HumanoResponde,
  Observacion,
  RevisorObserva,
} from '@/shared/api';

import { AGENTS, isAgentId, type AgentId } from './agents';
import { CRITERIO_LABEL, promedio } from './reducer';
import { observationLabel, ref, type ArtifactRef } from './refs';

export type Speaker = AgentId | 'tu';
export type Listener = Speaker | 'equipo';

export type MessageKind =
  'entrega' | 'correccion' | 'pendiente' | 'aprobacion' | 'calificacion' | 'error';

/** One thing a team member told another during the analysis. */
export interface TeamMessage {
  id: string;
  seq: number;
  ts: string;
  from: Speaker;
  to: Listener | null;
  kind: MessageKind;
  /** 0 for the first pass; corrections happen in later rounds. */
  ronda: number;
  text: string;
  /** The office bubble. */
  short: string;
  /** The diagram step: "Escribe casos", "9 casos · Gherkin". */
  title: string;
  sub: string;
  refs: ArtifactRef[];
}

export type MessageFilter = 'todo' | 'correcciones' | 'entregas' | 'aprobacion';

const FILTER_KINDS: Record<Exclude<MessageFilter, 'todo'>, readonly MessageKind[]> = {
  correcciones: ['correccion', 'pendiente'],
  entregas: ['entrega', 'calificacion'],
  aprobacion: ['aprobacion'],
};

export function filterMessages(
  messages: readonly TeamMessage[],
  filter: MessageFilter,
): TeamMessage[] {
  return filter === 'todo'
    ? [...messages]
    : messages.filter((m) => FILTER_KINDS[filter].includes(m.kind));
}

export const isCorrection = (m: TeamMessage) => m.kind === 'correccion' || m.kind === 'pendiente';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function conversationSummary(messages: readonly TeamMessage[]): string {
  const corrections = messages.filter(isCorrection).length;
  return `${plural(messages.length, 'mensaje', 'mensajes')} · ${plural(corrections, 'corrección', 'correcciones')}`;
}

/** "HU-1 · HU-2 · HU-3", or "CP-01 … CP-09" when there are more than three. */
function idList(ids: readonly string[]): string {
  return ids.length > 3 ? `${ids[0]} … ${ids.at(-1)}` : ids.join(' · ');
}

const sentence = (text: string) => {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

/** Every id in the list, or a single link for a long range, which opens its first item. */
function refsFor(kind: 'historia' | 'caso', ids: readonly string[]): ArtifactRef[] {
  if (ids.length > 3) return [ref(kind, ids[0]!, idList(ids))];
  return ids.map((id) => ref(kind, id));
}

function mentioned(observaciones: readonly Observacion[]): ArtifactRef[] {
  const ids = [...new Set(observaciones.flatMap((o) => o.referencias))];
  return ids.flatMap((id) => {
    if (id.startsWith('HU-')) return [ref('historia', id)];
    if (id.startsWith('CP-')) return [ref('caso', id)];
    return [];
  });
}

const sameStory = (a: HistoriaUsuario, b: HistoriaUsuario) =>
  JSON.stringify(a) === JSON.stringify(b);
const sameCase = (a: CasoPrueba, b: CasoPrueba) => JSON.stringify(a) === JSON.stringify(b);

interface Memory {
  historias: HistoriaUsuario[];
  casos: CasoPrueba[];
  observaciones: number;
  /** The last review's observations for QA, to say "la observación" or "las observaciones". */
  paraQa: number;
  otraVersion: boolean;
}

type Draft = Omit<TeamMessage, 'id' | 'seq' | 'ts'>;

function storiesMessage(
  evento: AgenteEntrega,
  historias: HistoriaUsuario[],
  memory: Memory,
): Draft {
  const ids = historias.map((h) => h.id);
  if (evento.ronda > 0) {
    const added = historias.filter((h) => !memory.historias.some((p) => p.id === h.id));
    const changed = historias.filter((h) => {
      const before = memory.historias.find((p) => p.id === h.id);
      return before && !sameStory(before, h);
    });
    const touched = [...added, ...changed].map((h) => h.id);
    const verbo = added.length && !changed.length ? 'Agregué' : 'Ajusté';
    return {
      from: 'analista',
      to: 'qa',
      kind: 'entrega',
      ronda: evento.ronda,
      text: touched.length
        ? `${verbo} ${idList(touched)} con las observaciones del Revisor.`
        : 'Revisé las historias con las observaciones del Revisor.',
      short: touched.length ? `${verbo} ${touched[0]}` : 'Historias revisadas',
      title:
        touched.length === 1
          ? `${verbo === 'Agregué' ? 'Agrega' : 'Ajusta'} ${touched[0]}`
          : 'Ajusta historias',
      sub: touched.length ? idList(touched) : 'Sin cambios',
      refs: refsFor('historia', touched),
    };
  }
  const again = memory.otraVersion;
  return {
    from: 'analista',
    to: 'tu',
    kind: 'entrega',
    ronda: 0,
    text: again
      ? `Escribí otra versión con ${plural(historias.length, 'historia', 'historias')}.`
      : `Entregué ${plural(historias.length, 'historia de usuario', 'historias de usuario')} a partir del requerimiento.`,
    short: again
      ? 'Otra versión lista'
      : plural(historias.length, 'historia lista', 'historias listas'),
    title: again ? 'Otra versión' : 'Escribe historias',
    sub: idList(ids),
    refs: refsFor('historia', ids),
  };
}

function casesMessage(evento: AgenteEntrega, casos: CasoPrueba[], memory: Memory): Draft {
  const ids = casos.map((c) => c.id);
  if (evento.ronda === 0 || memory.casos.length === 0) {
    return {
      from: 'qa',
      to: 'revisor',
      kind: 'entrega',
      ronda: evento.ronda,
      text: `Escribí ${plural(casos.length, 'caso de prueba', 'casos de prueba')} con sus escenarios Gherkin.`,
      short: plural(casos.length, 'caso listo', 'casos listos'),
      title: 'Escribe casos',
      sub: `${plural(casos.length, 'caso', 'casos')} · Gherkin`,
      refs: refsFor('caso', ids),
    };
  }
  const added = casos.filter((c) => !memory.casos.some((p) => p.id === c.id));
  const changed = casos.filter((c) => {
    const before = memory.casos.find((p) => p.id === c.id);
    return before && !sameCase(before, c);
  });
  if (added.length) {
    const addedIds = added.map((c) => c.id);
    return {
      from: 'qa',
      to: 'revisor',
      kind: 'entrega',
      ronda: evento.ronda,
      text: `Agregué ${idList(addedIds)} para atender ${memory.paraQa > 1 ? 'las observaciones' : 'la observación'} del Revisor.`,
      short: `Agregué ${addedIds[0]}`,
      title: `Agrega ${addedIds.length === 1 ? addedIds[0] : 'casos'}`,
      sub: addedIds.length === 1 ? added[0]!.titulo : idList(addedIds),
      refs: refsFor('caso', addedIds),
    };
  }
  const changedIds = changed.map((c) => c.id);
  return {
    from: 'qa',
    to: 'revisor',
    kind: 'entrega',
    ronda: evento.ronda,
    text: changedIds.length
      ? `Corregí ${idList(changedIds)} con las observaciones del Revisor.`
      : 'Revisé los casos con las observaciones del Revisor.',
    short: changedIds.length ? `Corregí ${changedIds[0]}` : 'Casos revisados',
    title: changedIds.length === 1 ? `Corrige ${changedIds[0]}` : 'Corrige casos',
    sub: changedIds.length ? idList(changedIds) : 'Sin cambios',
    refs: refsFor('caso', changedIds),
  };
}

function humanMessage(evento: HumanoResponde): Draft {
  if (evento.decision === 'otra_version') {
    return {
      from: 'tu',
      to: 'analista',
      kind: 'aprobacion',
      ronda: 0,
      text: 'Pediste otra versión de las historias.',
      short: 'Otra versión, por favor',
      title: 'Pides otra versión',
      sub: 'Sin aprobar',
      refs: [],
    };
  }
  const { agregadas, modificadas, eliminadas } = evento.cambios;
  const partes = [
    agregadas.length && plural(agregadas.length, 'agregada', 'agregadas'),
    modificadas.length && plural(modificadas.length, 'modificada', 'modificadas'),
    eliminadas.length && plural(eliminadas.length, 'quitada', 'quitadas'),
  ].filter((p): p is string => Boolean(p));
  return {
    from: 'tu',
    to: 'qa',
    kind: 'aprobacion',
    ronda: 0,
    text: partes.length
      ? `Editaste las historias (${partes.join(', ')}) y las aprobaste.`
      : 'Aprobaste las historias sin cambios.',
    short: partes.length ? 'Editado y aprobado' : 'Aprobado',
    title: 'Apruebas',
    sub: partes.length ? partes.join(' · ') : 'Sin cambios',
    refs: refsFor('historia', [...agregadas, ...modificadas]),
  };
}

function reviewMessages(evento: RevisorObserva, first: number): Draft[] {
  const numbered = evento.observaciones.map((observacion, i) => ({
    observacion,
    label: observationLabel(first + i),
  }));
  const destinos = (['analista', 'qa'] as const).filter((d) =>
    numbered.some((n) => n.observacion.destino === d),
  );
  return destinos.map((destino) => {
    const mine = numbered.filter((n) => n.observacion.destino === destino);
    const observaciones = mine.map((n) => n.observacion);
    const only = mine.length === 1 ? mine[0]!.observacion : null;
    const objeto = destino === 'analista' ? 'historias' : 'casos';
    const refs = [...mine.map((n) => ref('observacion', n.label)), ...mentioned(observaciones)];
    const firstRef = observaciones.flatMap((o) => o.referencias)[0];
    if (!evento.se_corrige) {
      return {
        from: 'revisor',
        to: destino,
        kind: 'pendiente',
        ronda: evento.ronda,
        text: `Quedan ${plural(mine.length, 'observación', 'observaciones')} sin corregir porque ya no hay rondas: ${observaciones.map((o) => sentence(o.descripcion)).join(' ')}`,
        short: 'Quedan pendientes',
        title: `Revisa ${objeto}`,
        sub: plural(mine.length, 'pendiente', 'pendientes'),
        refs,
      };
    }
    return {
      from: 'revisor',
      to: destino,
      kind: 'correccion',
      ronda: evento.ronda,
      text: only
        ? `${sentence(only.descripcion)} Sugerencia: ${sentence(only.sugerencia)}`
        : observaciones.map((o) => sentence(o.descripcion)).join(' '),
      short: `${AGENTS[destino].nombre}: corrige ${firstRef ?? objeto}`,
      title: `Revisa ${objeto}`,
      sub: plural(mine.length, 'observación', 'observaciones'),
      refs,
    };
  });
}

function scoreMessage(evento: AgenteEntrega): Draft | null {
  if (evento.artefactos.tipo !== 'puntajes') return null;
  const puntajes = evento.artefactos.puntajes;
  const media = promedio(puntajes);
  const weakest = [...puntajes].sort((a, b) => a.valor - b.valor)[0];
  const score = media === null ? 'sin puntaje' : `${media.toFixed(1)} de 5`;
  return {
    from: 'evaluador',
    to: 'equipo',
    kind: 'calificacion',
    // The Evaluator scores once, after the last round; it never works in a correction round.
    ronda: 0,
    text:
      media === null
        ? 'No pude calificar el análisis.'
        : `Califiqué el análisis con ${score}.${weakest ? ` Lo más débil: ${CRITERIO_LABEL[weakest.criterio].toLowerCase()} (${weakest.valor.toFixed(1)}).` : ''}`,
    short: score,
    title: 'Califica',
    sub: score,
    refs: [ref('rubrica', 'rubrica', 'Rúbrica')],
  };
}

function drafts(evento: Evento, memory: Memory): Draft[] {
  switch (evento.type) {
    case 'agente_entrega': {
      const artefactos = evento.artefactos;
      switch (artefactos.tipo) {
        case 'historias':
          return [storiesMessage(evento, artefactos.historias, memory)];
        case 'pruebas':
          return [casesMessage(evento, artefactos.casos, memory)];
        case 'revision':
          // Without approval the observations arrive next, in their own event.
          return artefactos.veredicto.aprobado
            ? [
                {
                  from: 'revisor',
                  to: 'evaluador',
                  kind: 'entrega',
                  ronda: evento.ronda,
                  text: 'Aprobé las historias y los casos; no quedan observaciones.',
                  short: 'Todo en orden',
                  title: 'Aprueba',
                  sub: 'Sin observaciones',
                  refs: [],
                },
              ]
            : [];
        case 'puntajes': {
          const score = scoreMessage(evento);
          return score ? [score] : [];
        }
      }
      return [];
    }
    case 'humano_responde':
      return [humanMessage(evento)];
    case 'revisor_observa':
      return reviewMessages(evento, memory.observaciones + 1);
    case 'agente_error':
      return isAgentId(evento.agent)
        ? [
            {
              from: evento.agent,
              to: null,
              kind: 'error',
              ronda: 0,
              text: sentence(evento.mensaje),
              short: 'No pude terminar',
              title: 'No pudo terminar',
              sub: 'Error',
              refs: [],
            },
          ]
        : [];
    default:
      return [];
  }
}

function remember(evento: Evento, memory: Memory): Memory {
  switch (evento.type) {
    case 'agente_entrega':
      if (evento.artefactos.tipo === 'historias') {
        return { ...memory, historias: evento.artefactos.historias, otraVersion: false };
      }
      if (evento.artefactos.tipo === 'pruebas')
        return { ...memory, casos: evento.artefactos.casos };
      return memory;
    case 'humano_responde':
      return {
        ...memory,
        historias: evento.historias ?? memory.historias,
        otraVersion: evento.decision === 'otra_version',
      };
    case 'revisor_observa':
      return {
        ...memory,
        observaciones: memory.observaciones + evento.observaciones.length,
        paraQa: evento.observaciones.filter((o) => o.destino === 'qa').length,
      };
    default:
      return memory;
  }
}

/**
 * What the team said to each other, built only from the events the person already received:
 * deliveries, the Reviewer's corrections, the person's approval and the score.
 */
export function teamMessages(eventos: readonly Evento[]): TeamMessage[] {
  const messages: TeamMessage[] = [];
  let memory: Memory = {
    historias: [],
    casos: [],
    observaciones: 0,
    paraQa: 0,
    otraVersion: false,
  };
  for (const evento of eventos) {
    drafts(evento, memory).forEach((draft, i) =>
      messages.push({ ...draft, id: `m-${evento.seq}-${i}`, seq: evento.seq, ts: evento.ts }),
    );
    memory = remember(evento, memory);
  }
  return messages;
}
