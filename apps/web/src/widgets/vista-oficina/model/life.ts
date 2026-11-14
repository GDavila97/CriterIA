import { AGENT_IDS, type AgentId } from '@/entities/corrida';

import { iso, type Point3 } from './layout';
import {
  CHAT_PAIRS,
  DESKS,
  PLACES,
  REST,
  placeById,
  route,
  routeLength,
  type Place,
  type PlaceKind,
} from './places';

/** Scene units per second; the same on every segment, so long walks take longer. */
export const WALK_SPEED = 110;
export const LINE_MS = 2_200;
const CHEER_MS = 1_600;
const CELEBRATION_HOLD_MS = 4_000;

/** Short, friendly lines agents say to each other. */
export const CHATTER = [
  '¿Café?',
  'Ahorita no',
  '¡Salió bien!',
  'Buen trabajo',
  '¿Otra ronda?',
  'Ya casi',
  'Me gustó ese caso',
  'Todo en orden',
] as const;

export const CHEERS = ['¡Salió bien!', '¡Bien hecho!', 'Buen equipo', '¡Listo!'] as const;

export type Activity =
  'escritorio' | 'descanso' | 'tablero' | 'juntas' | 'charla' | 'celebrar' | 'fijo';

/** How often each free activity is picked; working at the desk is the most common. */
export const WEIGHTS: readonly [Activity, number][] = [
  ['escritorio', 0.45],
  ['descanso', 0.2],
  ['charla', 0.2],
  ['juntas', 0.1],
  ['tablero', 0.05],
];

const STAY_MS: Partial<Record<Activity, readonly [number, number]>> = {
  escritorio: [7_000, 13_000],
  descanso: [4_000, 8_000],
  juntas: [4_000, 7_000],
  tablero: [3_000, 6_000],
};

const KIND: Partial<Record<Activity, PlaceKind>> = {
  descanso: 'descanso',
  juntas: 'juntas',
  tablero: 'tablero',
};

/** A small seeded generator, so the same seed always plays the same scene. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Facing = 'izquierda' | 'derecha';

export interface AgentLife {
  /** The place it stands on or walks to; no two agents share one. */
  place: string;
  /** The current walk, from where it was to `place`; a single point when it stays. */
  route: Point3[];
  /** Changes with every new walk, so the view knows to start it. */
  walk: number;
  arrivesAt: number;
  activity: Activity;
  facing: Facing;
  bubble: string | null;
}

export interface LifeInput {
  /** Agents that must stand somewhere: working, or waiting at the board. */
  fixed: Partial<Record<AgentId, string>>;
  /** True once the analysis ends; the team gathers in the break room first. */
  celebrate: boolean;
}

export interface Decision {
  at: number;
  agent: AgentId;
  activity: Activity;
  place: string;
  partner?: AgentId;
}

interface Talk {
  agents: [AgentId, AgentId];
  start: number;
  lines: string[];
}

interface Party {
  members: AgentId[];
  start: number;
  end: number;
}

interface State extends AgentLife {
  decideAt: number;
}

const screenX = (point: Point3) => iso(point)[0];

function facingOf(points: readonly Point3[], fallback: Facing): Facing {
  const last = points.at(-1);
  const before = points.at(-2);
  if (!last || !before || screenX(last) === screenX(before)) return fallback;
  return screenX(last) > screenX(before) ? 'derecha' : 'izquierda';
}

/**
 * The office's free life as a seeded event simulation: each free agent picks a weighted activity,
 * walks there along the corridors, stays a while and picks again. Two may meet to chat, and the
 * team gathers to celebrate when an analysis ends. Time is whatever the caller passes, so tests
 * run it without timers and the view pauses it with the tab.
 */
export function createOfficeLife(seed: number, input: LifeInput, now = 0) {
  const random = seededRandom(seed);
  const between = ([min, max]: readonly [number, number]) => min + random() * (max - min);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const agents = {} as Record<AgentId, State>;
  let talks: Talk[] = [];
  let party: Party | null = null;
  let celebrating = input.celebrate;
  let walks = 0;
  const log: Decision[] = [];

  AGENT_IDS.forEach((id, i) => {
    const fixed = input.fixed[id];
    const place = placeById(fixed ?? DESKS[id].id);
    agents[id] = {
      place: place.id,
      route: [place.point],
      walk: 0,
      arrivesAt: now,
      activity: fixed ? 'fijo' : 'escritorio',
      facing: 'derecha',
      bubble: null,
      // Staggered, so the room does not start moving all at once.
      decideAt: fixed ? Infinity : now + 800 + i * 900,
    };
  });

  const taken = (placeId: string, except?: AgentId) =>
    AGENT_IDS.some((id) => id !== except && agents[id].place === placeId);

  function walkTo(id: AgentId, target: Place, at: number) {
    const agent = agents[id];
    const path = route(placeById(agent.place), target);
    walks += 1;
    agent.place = target.id;
    agent.route = path;
    agent.walk = walks;
    agent.arrivesAt = at + (routeLength(path) / WALK_SPEED) * 1000;
    agent.facing = facingOf(path, agent.facing);
  }

  function talkOf(id: AgentId) {
    return talks.find((t) => t.agents.includes(id));
  }

  function endTalk(talk: Talk, at: number) {
    talks = talks.filter((t) => t !== talk);
    talk.agents.forEach((id, i) => {
      if (agents[id].activity === 'charla') agents[id].decideAt = at + i * 600;
    });
  }

  function available(id: AgentId, at: number) {
    const agent = agents[id];
    return (
      agent.activity !== 'fijo' &&
      agent.activity !== 'celebrar' &&
      agent.activity !== 'charla' &&
      agent.arrivesAt <= at &&
      agent.decideAt > at
    );
  }

  function startTalk(id: AgentId, at: number): boolean {
    const partners = AGENT_IDS.filter((other) => other !== id && available(other, at));
    const pairs = CHAT_PAIRS.filter(([a, b]) => !taken(a.id) && !taken(b.id));
    if (!partners.length || !pairs.length) return false;
    const partner = pick(partners);
    const [a, b] = pick(pairs);
    walkTo(id, a, at);
    walkTo(partner, b, at);
    const lines: string[] = [];
    const count = random() < 0.5 ? 2 : 3;
    while (lines.length < count) {
      const line = pick(CHATTER);
      if (line !== lines.at(-1)) lines.push(line);
    }
    talks.push({
      agents: [id, partner],
      start: Math.max(agents[id].arrivesAt, agents[partner].arrivesAt),
      lines,
    });
    for (const member of [id, partner]) {
      agents[member].activity = 'charla';
      agents[member].decideAt = Infinity;
    }
    log.push({ at, agent: id, activity: 'charla', place: a.id, partner });
    return true;
  }

  function decide(id: AgentId, at: number) {
    const roll = random();
    let total = 0;
    let activity: Activity = 'escritorio';
    for (const [option, weight] of WEIGHTS) {
      total += weight;
      if (roll < total) {
        activity = option;
        break;
      }
    }
    if (activity === 'charla' && startTalk(id, at)) return;
    const kind = KIND[activity];
    const options = kind ? PLACES.filter((p) => p.kind === kind && !taken(p.id, id)) : [];
    const target = options.length ? pick(options) : DESKS[id];
    if (!options.length) activity = 'escritorio';
    walkTo(id, target, at);
    agents[id].activity = activity;
    agents[id].decideAt = agents[id].arrivesAt + between(STAY_MS[activity] ?? [5_000, 9_000]);
    log.push({ at, agent: id, activity, place: target.id });
  }

  function gather(at: number) {
    const members = AGENT_IDS.filter((id) => agents[id].activity !== 'fijo');
    talks = [];
    members.forEach((id, i) => {
      walkTo(id, REST[i]!, at);
      agents[id].activity = 'celebrar';
      agents[id].decideAt = Infinity;
    });
    const start = Math.max(at, ...members.map((id) => agents[id].arrivesAt));
    party = {
      members,
      start,
      end: start + members.length * CHEER_MS + CELEBRATION_HOLD_MS,
    };
  }

  function disperse(at: number) {
    party?.members.forEach((id, i) => {
      if (agents[id].activity === 'celebrar') agents[id].decideAt = at + i * 700;
    });
    party = null;
  }

  /** The earliest pending event at or before `until`, with its kind; null when nothing is due. */
  function nextEvent(until: number) {
    let best: { at: number; run: () => void } | null = null;
    const consider = (at: number, run: () => void) => {
      if (at <= until && (!best || at < best.at)) best = { at, run };
    };
    if (party) {
      const end = party.end;
      consider(end, () => disperse(end));
    }
    for (const talk of talks) {
      const end = talk.start + talk.lines.length * LINE_MS;
      consider(end, () => endTalk(talk, end));
    }
    for (const id of AGENT_IDS) {
      const at = agents[id].decideAt;
      consider(at, () => decide(id, at));
    }
    return best as { at: number; run: () => void } | null;
  }

  function bubbleOf(id: AgentId, at: number): string | null {
    const talk = talkOf(id);
    if (talk && at >= talk.start) {
      const line = Math.floor((at - talk.start) / LINE_MS);
      return talk.agents[line % 2] === id ? (talk.lines[line] ?? null) : null;
    }
    if (party && at >= party.start) {
      const index = party.members.indexOf(id);
      const from = party.start + index * CHEER_MS;
      if (index >= 0 && at >= from && at < from + CHEER_MS) return CHEERS[index % CHEERS.length]!;
    }
    return null;
  }

  function facingAt(id: AgentId, at: number): Facing {
    const talk = talkOf(id);
    if (talk && at >= talk.start) {
      const other = talk.agents.find((a) => a !== id)!;
      const mine = screenX(placeById(agents[id].place).point);
      return mine < screenX(placeById(agents[other].place).point) ? 'derecha' : 'izquierda';
    }
    return agents[id].facing;
  }

  return {
    /** Runs every event due up to `at`, in time order. */
    advance(at: number) {
      for (let event = nextEvent(at); event; event = nextEvent(at)) event.run();
    },

    /** Applies who is fixed where and whether to celebrate; agents set free pick again. */
    sync(next: LifeInput, at: number) {
      for (const id of AGENT_IDS) {
        const want = next.fixed[id];
        const agent = agents[id];
        if (want && (agent.activity !== 'fijo' || agent.place !== want)) {
          const talk = talkOf(id);
          if (talk) endTalk(talk, at);
          if (party) party.members = party.members.filter((m) => m !== id);
          const squatter = AGENT_IDS.find(
            (other) => other !== id && agents[other].place === want && !next.fixed[other],
          );
          walkTo(id, placeById(want), at);
          agent.activity = 'fijo';
          agent.decideAt = Infinity;
          if (squatter) decide(squatter, at);
        } else if (!want && agent.activity === 'fijo') {
          agent.activity = 'escritorio';
          agent.decideAt = at + 400;
        }
      }
      if (next.celebrate && !celebrating) gather(at);
      if (!next.celebrate && celebrating) disperse(at);
      celebrating = next.celebrate;
    },

    /** Every agent at time `at`, ready to draw. */
    view(at: number): Record<AgentId, AgentLife> {
      return Object.fromEntries(
        AGENT_IDS.map((id) => {
          const { decideAt: _next, ...life } = agents[id];
          return [id, { ...life, facing: facingAt(id, at), bubble: bubbleOf(id, at) }];
        }),
      ) as Record<AgentId, AgentLife>;
    },

    /** The next moment something changes on screen, for the timer. */
    nextChange(after: number): number | null {
      const times: number[] = AGENT_IDS.map((id) => agents[id].decideAt);
      for (const talk of talks) {
        talk.lines.forEach((_, i) => times.push(talk.start + i * LINE_MS));
        times.push(talk.start + talk.lines.length * LINE_MS);
      }
      if (party) {
        party.members.forEach((_, i) => {
          times.push(party!.start + i * CHEER_MS, party!.start + (i + 1) * CHEER_MS);
        });
        times.push(party.end);
      }
      const future = times.filter((t) => Number.isFinite(t) && t > after);
      return future.length ? Math.min(...future) : null;
    },

    /** What each agent chose and when, for tests. */
    decisions: (): readonly Decision[] => log,
  };
}

export type OfficeLife = ReturnType<typeof createOfficeLife>;
