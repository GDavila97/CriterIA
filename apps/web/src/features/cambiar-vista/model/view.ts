'use client';

import { useState, useSyncExternalStore } from 'react';

import { useMediaQuery } from '@/shared/lib/react';

export type Vista = 'clasica' | 'oficina';

const KEY = 'criteria.vista';

/** The office needs room: below this width the switch hides and the page stays classic. */
export const OFFICE_MIN_WIDTH = '(min-width: 768px)';

export function readStoredView(): Vista | null {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === 'clasica' || value === 'oficina' ? value : null;
  } catch {
    return null;
  }
}

export function storeView(vista: Vista): void {
  try {
    window.localStorage.setItem(KEY, vista);
  } catch {
    // Private windows can refuse storage; the choice simply is not remembered.
  }
}

/** ?vista= wins, then the remembered choice; without the office view it is always classic. */
export function resolveView(param: string | null, officeEnabled: boolean): Vista {
  if (!officeEnabled) return 'clasica';
  if (param === 'clasica' || param === 'oficina') return param;
  return readStoredView() ?? 'clasica';
}

const noop = () => () => {};

/**
 * The view on screen and whether the switch can be offered. The server and the first client
 * render are always classic, so hydration matches; the remembered choice applies right after.
 */
export function useView(param: string | null, officeEnabled: boolean) {
  const wide = useMediaQuery(OFFICE_MIN_WIDTH);
  const resolved = useSyncExternalStore(
    noop,
    () => resolveView(param, officeEnabled),
    () => 'clasica' as const,
  );
  const [chosen, setChosen] = useState<Vista | null>(null);
  const available = officeEnabled && wide;
  return {
    vista: available ? (chosen ?? resolved) : ('clasica' as const),
    available,
    choose: setChosen,
  };
}
