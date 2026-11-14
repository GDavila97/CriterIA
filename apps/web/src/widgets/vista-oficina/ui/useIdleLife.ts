'use client';

import { useEffect, useRef, useState } from 'react';

import type { AgentId } from '@/entities/corrida';

import { CHAT_MS, createIdlePlanner } from '../model/idle';

export interface IdleLife {
  /** Break-room spot each free agent walked to, by index. */
  spots: Partial<Record<AgentId, number>>;
  chatter: Partial<Record<AgentId, string>>;
}

export interface IdleOptions {
  seed: number;
  spotCount: number;
  /** Spots taken by agents that are not free, read when the next step is decided. */
  occupied: readonly number[];
  /** Where each agent rests before it wanders. */
  home: Readonly<Record<AgentId, number>>;
  /** False while the tab is hidden or motion is reduced: nothing moves or speaks. */
  active: boolean;
}

/** Gives free agents a quiet life: now and then one walks somewhere or says a short line. */
export function useIdleLife(
  free: readonly AgentId[],
  { seed, spotCount, active, occupied, home }: IdleOptions,
) {
  const planner = useRef(createIdlePlanner(seed));
  const [spots, setSpots] = useState<IdleLife['spots']>({});
  const latest = useRef({ occupied, spots, home });
  useEffect(() => {
    latest.current = { occupied, spots, home };
  });
  const [chatter, setChatter] = useState<IdleLife['chatter']>({});
  const freeKey = free.join(',');

  useEffect(() => {
    if (!active || !freeKey) return;
    const agents = freeKey.split(',') as AgentId[];
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const after = (ms: number, action: () => void) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        action();
      }, ms);
      timers.add(timer);
    };
    // Spots chosen in this run of the effect, before React renders them.
    const moved: IdleLife['spots'] = { ...latest.current.spots };
    const plan = () => {
      after(planner.current.pause(), () => {
        const now = latest.current;
        const taken = [...now.occupied, ...agents.map((id) => moved[id] ?? now.home[id])];
        const open = Array.from({ length: spotCount }, (_, i) => i).filter(
          (i) => !taken.includes(i),
        );
        const step = planner.current.next(agents, open);
        if (!step) return;
        if (step.kind === 'caminar') {
          moved[step.agent] = step.spot;
          setSpots((current) => ({ ...current, [step.agent]: step.spot }));
        } else {
          setChatter((current) => ({ ...current, [step.agent]: step.texto }));
          after(CHAT_MS, () =>
            setChatter((current) => {
              const next = { ...current };
              delete next[step.agent];
              return next;
            }),
          );
        }
        plan();
      });
    };
    plan();
    return () => timers.forEach(clearTimeout);
  }, [active, freeKey, spotCount]);

  // An agent that went back to work forgets where it wandered and what it was saying.
  const keep = <T>(values: Partial<Record<AgentId, T>>) =>
    Object.fromEntries(
      Object.entries(values).filter(([id]) => free.includes(id as AgentId)),
    ) as Partial<Record<AgentId, T>>;
  return { spots: keep(spots), chatter: keep(chatter) };
}
