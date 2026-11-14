'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { isLive, runSession, useRunSession } from '@/entities/corrida';
import {
  api,
  ApiError,
  streamRun,
  type ConnectionState,
  type RespuestaHumana,
  type RunCreateBody,
  type RunCreatedBody,
} from '@/shared/api';

export type Connection = ConnectionState | 'cerrado';

export interface RunControllerDeps {
  createRun: (body: RunCreateBody) => Promise<RunCreatedBody>;
  approveRun: (runId: string, body: RespuestaHumana) => Promise<void>;
  stream: typeof streamRun;
}

const defaults: RunControllerDeps = {
  createRun: api.createRun,
  approveRun: api.approveRun,
  stream: streamRun,
};

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError(0, 'error_interno', 'Ocurrió un error inesperado. Intenta de nuevo.');
}

/**
 * Creates an analysis, follows its stream and answers the human pause. The analysis lives in the
 * in-memory session, so leaving the page only closes the stream and coming back reconnects.
 */
export function useRunController(deps: RunControllerDeps = defaults) {
  const { state, created, requerimiento } = useRunSession();
  const [error, setError] = useState<ApiError | null>(null);
  const [connection, setConnection] = useState<Connection>('cerrado');
  const [lastBeat, setLastBeat] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const follow = useCallback(
    async (runId: string) => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      try {
        await deps.stream({
          runId,
          lastEventId: runSession.get().state.ultimoSeq,
          signal: current.signal,
          onEvent: (evento) => runSession.apply({ type: 'evento', evento }),
          onHeartbeat: () => setLastBeat(Date.now()),
          onConnection: setConnection,
        });
      } catch (failure) {
        setError(asApiError(failure));
      } finally {
        if (controller.current === current) setConnection('cerrado');
      }
    },
    [deps],
  );

  const start = useCallback(
    async (body: RunCreateBody) => {
      setError(null);
      setBusy(true);
      try {
        const run = await deps.createRun(body);
        runSession.start(run, body.requerimiento);
        setBusy(false);
        await follow(run.run_id);
      } catch (failure) {
        setError(asApiError(failure));
        setBusy(false);
      }
    },
    [deps, follow],
  );

  const respond = useCallback(
    async (respuesta: RespuestaHumana) => {
      const runId = created?.run_id;
      if (!runId) return;
      setError(null);
      setBusy(true);
      try {
        await deps.approveRun(runId, respuesta);
        setBusy(false);
        await follow(runId);
      } catch (failure) {
        setError(asApiError(failure));
        setBusy(false);
      }
    },
    [created, deps, follow],
  );

  // Coming back to the page picks up an analysis that was still going.
  useEffect(() => {
    let left = false;
    const session = runSession.get();
    if (session.created && isLive(session)) {
      const runId = session.created.run_id;
      void Promise.resolve().then(() => (left ? undefined : follow(runId)));
    }
    return () => {
      left = true;
      controller.current?.abort();
    };
  }, [follow]);

  const dismissError = useCallback(() => setError(null), []);

  return {
    state,
    created,
    requerimiento,
    error,
    connection,
    lastBeat,
    busy,
    start,
    respond,
    dismissError,
  };
}

export type RunController = ReturnType<typeof useRunController>;
