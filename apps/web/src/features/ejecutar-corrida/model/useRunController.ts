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
  type UsageBody,
} from '@/shared/api';

import { GIVE_UP_MS, READY_MS, runArrived, SHOW_AFTER_MS, type WaitStage } from './waiting';

export type Connection = ConnectionState | 'cerrado';

export interface RunControllerDeps {
  createRun: (body: RunCreateBody, signal?: AbortSignal) => Promise<RunCreatedBody>;
  approveRun: (runId: string, body: RespuestaHumana) => Promise<void>;
  stream: typeof streamRun;
  usage: () => Promise<UsageBody>;
}

const defaults: RunControllerDeps = {
  createRun: api.createRun,
  approveRun: api.approveRun,
  stream: streamRun,
  usage: api.usage,
};

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError(0, 'error_interno', 'Ocurrió un error inesperado. Intenta de nuevo.');
}

const isNetwork = (error: unknown) => error instanceof ApiError && error.code === 'sin_conexion';

/** The analysis being opened: its request, the usage before it, and its id once created. */
interface Attempt {
  body: RunCreateBody;
  before: UsageBody | null;
  runId: string | null;
}

/**
 * Creates an analysis, follows its stream and answers the human pause. The analysis lives in the
 * in-memory session, so leaving the page only closes the stream and coming back reconnects.
 * While a new analysis opens, `wait` drives the waiting layer: nothing under 1.5 s, then a notice,
 * and after 30 s or a network failure a retry that never creates a second analysis by mistake.
 */
export function useRunController(deps: RunControllerDeps = defaults) {
  const { state, created, requerimiento } = useRunSession();
  const [error, setError] = useState<ApiError | null>(null);
  const [connection, setConnection] = useState<Connection>('cerrado');
  const [lastBeat, setLastBeat] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWaitState] = useState<WaitStage>('oculta');
  const controller = useRef<AbortController | null>(null);
  const attempt = useRef<Attempt | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const waitRef = useRef<WaitStage>('oculta');

  const setWait = useCallback((stage: WaitStage) => {
    waitRef.current = stage;
    setWaitState(stage);
  }, []);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const later = useCallback((ms: number, action: () => void) => {
    timers.current.push(setTimeout(action, ms));
  }, []);

  const giveUp = useCallback(() => {
    clearTimers();
    controller.current?.abort();
    setBusy(false);
    setWait('sin_conexion');
  }, [clearTimers, setWait]);

  /** Arms the 1.5 s notice and the 30 s limit; `shown` keeps the layer up across a retry. */
  const watch = useCallback(
    (shown: boolean) => {
      clearTimers();
      setWait(shown ? 'preparando' : 'oculta');
      if (!shown) later(SHOW_AFTER_MS, () => setWait('preparando'));
      later(GIVE_UP_MS, giveUp);
    },
    [clearTimers, giveUp, later, setWait],
  );

  const opened = useCallback(() => {
    if (!attempt.current) return;
    attempt.current = null;
    clearTimers();
    if (waitRef.current === 'preparando') {
      setWait('listo');
      later(READY_MS, () => setWait('oculta'));
    } else {
      setWait('oculta');
    }
  }, [clearTimers, later, setWait]);

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
          onConnection: (next) => {
            setConnection(next);
            if (next === 'en_vivo') opened();
          },
        });
      } catch (failure) {
        if (current.signal.aborted) return;
        if (attempt.current && isNetwork(failure)) {
          giveUp();
          return;
        }
        attempt.current = null;
        clearTimers();
        setWait('oculta');
        setError(asApiError(failure));
      } finally {
        if (controller.current === current) setConnection('cerrado');
      }
    },
    [clearTimers, deps, giveUp, opened, setWait],
  );

  const create = useCallback(
    async (shown: boolean) => {
      const current = attempt.current;
      if (!current) return;
      setError(null);
      setBusy(true);
      watch(shown);
      const request = new AbortController();
      controller.current = request;
      let run: RunCreatedBody;
      try {
        run = await deps.createRun(current.body, request.signal);
      } catch (failure) {
        if (request.signal.aborted) return;
        if (isNetwork(failure)) {
          giveUp();
          return;
        }
        attempt.current = null;
        clearTimers();
        setWait('oculta');
        setError(asApiError(failure));
        setBusy(false);
        return;
      }
      if (request.signal.aborted) return;
      current.runId = run.run_id;
      runSession.start(run, current.body.requerimiento);
      setBusy(false);
      await follow(run.run_id);
    },
    [clearTimers, deps, follow, giveUp, setWait, watch],
  );

  /** `before` is the usage known before this request, to tell later whether it arrived. */
  const start = useCallback(
    async (body: RunCreateBody, before: UsageBody | null = null) => {
      attempt.current = { body, before, runId: null };
      await create(false);
    },
    [create],
  );

  const retry = useCallback(async () => {
    const current = attempt.current;
    if (!current) return;
    if (current.runId) {
      setBusy(true);
      watch(true);
      await follow(current.runId);
      return;
    }
    setWait('preparando');
    if (current.before) {
      let now: UsageBody;
      try {
        now = await deps.usage();
      } catch {
        setWait('sin_conexion');
        return;
      }
      // The first request did arrive: another one would start a second analysis.
      if (runArrived(current.before, now)) {
        setWait('creado_sin_abrir');
        return;
      }
    }
    await create(true);
  }, [create, deps, follow, setWait, watch]);

  /** After "Iniciar otro": the person chose a second analysis knowing the first exists. */
  const startAnyway = useCallback(async () => {
    if (!attempt.current) return;
    attempt.current.before = null;
    await create(true);
  }, [create]);

  const cancelWait = useCallback(() => {
    clearTimers();
    controller.current?.abort();
    // An analysis that never opened is left to expire; the requirement stays in the form.
    if (attempt.current?.runId) runSession.clear();
    attempt.current = null;
    setBusy(false);
    setWait('oculta');
  }, [clearTimers, setWait]);

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
      clearTimers();
    };
  }, [clearTimers, follow]);

  const dismissError = useCallback(() => setError(null), []);

  return {
    state,
    created,
    requerimiento,
    error,
    connection,
    lastBeat,
    busy,
    wait,
    start,
    respond,
    retry,
    startAnyway,
    cancelWait,
    dismissError,
  };
}

export type RunController = ReturnType<typeof useRunController>;
