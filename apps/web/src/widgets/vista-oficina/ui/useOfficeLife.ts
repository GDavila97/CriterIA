'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { AgentId } from '@/entities/corrida';

import { createOfficeLife, type AgentLife, type LifeInput } from '../model/life';

export interface OfficeLifeOptions {
  seed: number;
  /** False while the tab is hidden or motion is reduced: the clock stops and nothing changes. */
  active: boolean;
}

/**
 * Runs the office's routine on a clock that only advances while it is active, so a hidden tab
 * picks up exactly where it stopped.
 */
export function useOfficeLife(input: LifeInput, { seed, active }: OfficeLifeOptions) {
  const [life] = useState(() => createOfficeLife(seed, input, 0));
  const clock = useRef({ elapsed: 0, since: 0 });
  const listeners = useRef(new Set<() => void>());
  const snapshot = useRef<Record<AgentId, AgentLife>>(life.view(0));

  const now = useCallback(
    () => clock.current.elapsed + (active ? Date.now() - clock.current.since : 0),
    [active],
  );
  const publish = useCallback(
    (at: number) => {
      snapshot.current = life.view(at);
      listeners.current.forEach((notify) => notify());
    },
    [life],
  );

  const fixedKey = JSON.stringify(input.fixed);
  useEffect(() => {
    const at = now();
    life.sync(
      { fixed: JSON.parse(fixedKey) as LifeInput['fixed'], celebrate: input.celebrate },
      at,
    );
    publish(at);
  }, [fixedKey, input.celebrate, life, now, publish]);

  useEffect(() => {
    if (!active) return;
    const current = clock.current;
    current.since = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      const at = now();
      life.advance(at);
      publish(at);
      const next = life.nextChange(at);
      if (next !== null) timer = setTimeout(wake, Math.max(0, next - at));
    };
    wake();
    return () => {
      clearTimeout(timer);
      current.elapsed += Date.now() - current.since;
    };
  }, [active, life, now, publish]);

  return useSyncExternalStore(
    useCallback((notify: () => void) => {
      const set = listeners.current;
      set.add(notify);
      return () => set.delete(notify);
    }, []),
    () => snapshot.current,
    () => snapshot.current,
  );
}
