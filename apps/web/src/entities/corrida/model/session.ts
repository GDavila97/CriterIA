'use client';

import { useSyncExternalStore } from 'react';

import type { RunCreatedBody } from '@/shared/api';

import { initialRunState, runReducer, type RunAction, type RunState } from './reducer';

export interface RunSession {
  state: RunState;
  created: RunCreatedBody | null;
  requerimiento: string;
}

const EMPTY: RunSession = { state: initialRunState(), created: null, requerimiento: '' };

let current = EMPTY;
const listeners = new Set<() => void>();

function emit(next: RunSession) {
  current = next;
  for (const listener of listeners) listener();
}

/**
 * The analysis on screen, held in this module for the life of the tab. It survives navigation
 * inside the app and is gone on reload; it never touches cookies or browser storage.
 */
export const runSession = {
  get: (): RunSession => current,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  start(created: RunCreatedBody, requerimiento: string) {
    const state = runReducer(initialRunState(), { type: 'iniciar', runId: created.run_id });
    emit({ state, created, requerimiento });
  },
  apply(action: RunAction) {
    emit({ ...current, state: runReducer(current.state, action) });
  },
  clear() {
    emit(EMPTY);
  },
};

export function useRunSession(): RunSession {
  // The server never holds a session: it renders the empty one.
  return useSyncExternalStore(runSession.subscribe, runSession.get, () => EMPTY);
}

/** Started and not finished: the next stream picks it up where it was (ADR 0018). */
export function isLive(session: RunSession): boolean {
  const { fase } = session.state;
  return session.created !== null && (fase === 'en_curso' || fase === 'esperando_aprobacion');
}

/** Finished without history: this tab holds the only copy. */
export function isUnsavedResult(session: RunSession): boolean {
  const { fase } = session.state;
  return (
    session.created !== null &&
    !session.created.guardar_historial &&
    (fase === 'completada' || fase === 'error')
  );
}

/** Leaving the tab or replacing the analysis now would lose it for good. */
export function wouldBeLost(session: RunSession): boolean {
  return isLive(session) || isUnsavedResult(session);
}
