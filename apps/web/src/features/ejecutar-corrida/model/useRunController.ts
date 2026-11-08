'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { initialRunState, runReducer } from '@/entities/corrida';
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

/** Creates a run, follows its stream, answers the human pause and stops when the page goes. */
export function useRunController(deps: RunControllerDeps = defaults) {
  const [state, dispatch] = useReducer(runReducer, undefined, () => initialRunState());
  const [created, setCreated] = useState<RunCreatedBody | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [connection, setConnection] = useState<Connection>('cerrado');
  const [lastBeat, setLastBeat] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const lastSeq = useRef(0);

  const follow = useCallback(
    async (runId: string) => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      try {
        await deps.stream({
          runId,
          lastEventId: lastSeq.current,
          signal: current.signal,
          onEvent: (evento) => {
            lastSeq.current = evento.seq;
            dispatch({ type: 'evento', evento });
          },
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
        lastSeq.current = 0;
        dispatch({ type: 'iniciar', runId: run.run_id });
        setCreated(run);
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

  useEffect(() => () => controller.current?.abort(), []);

  return { state, created, error, connection, lastBeat, busy, start, respond };
}

export type RunController = ReturnType<typeof useRunController>;
