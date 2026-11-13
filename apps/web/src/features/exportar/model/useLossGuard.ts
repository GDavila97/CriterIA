'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { runSession, wouldBeLost } from '@/entities/corrida';

/**
 * Runs an action that replaces the current analysis, asking first only when the analysis would be
 * lost for good: still running, or finished without history.
 */
export function useLossGuard() {
  const pending = useRef<(() => void) | null>(null);
  const [asking, setAsking] = useState(false);

  const guard = useCallback((action: () => void) => {
    if (!wouldBeLost(runSession.get())) {
      action();
      return;
    }
    pending.current = action;
    setAsking(true);
  }, []);

  const cancel = useCallback(() => {
    pending.current = null;
    setAsking(false);
  }, []);

  const proceed = useCallback(() => {
    const action = pending.current;
    pending.current = null;
    setAsking(false);
    action?.();
  }, []);

  return { guard, asking, cancel, proceed };
}

export type LossGuard = ReturnType<typeof useLossGuard>;

/** The browser's own prompt on closing or reloading the tab, only while something would be lost. */
export function useLeaveWarning() {
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!wouldBeLost(runSession.get())) return;
      event.preventDefault();
      // Older browsers show the prompt only with returnValue set.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
}
