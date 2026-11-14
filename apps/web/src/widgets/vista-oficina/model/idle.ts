import type { AgentId } from '@/entities/corrida';

/** Short, friendly lines free agents say to each other. */
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

export const CHAT_MS = 2_600;
const MIN_PAUSE_MS = 2_500;
const EXTRA_PAUSE_MS = 3_500;
const CHAT_CHANCE = 0.35;

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

export type IdleStep =
  | { agent: AgentId; kind: 'caminar'; spot: number }
  | { agent: AgentId; kind: 'decir'; texto: string };

/** Picks how long the room stays quiet and then what a free agent does. */
export function createIdlePlanner(seed: number) {
  const random = seededRandom(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  return {
    pause(): number {
      return Math.round(MIN_PAUSE_MS + random() * EXTRA_PAUSE_MS);
    },
    /** `open` lists the spots nobody stands on; with none, the agent says something instead. */
    next(free: readonly AgentId[], open: readonly number[]): IdleStep | null {
      if (!free.length) return null;
      const agent = pick(free);
      if (random() < CHAT_CHANCE || !open.length) {
        return { agent, kind: 'decir', texto: pick(CHATTER) };
      }
      return { agent, kind: 'caminar', spot: pick(open) };
    },
  };
}
