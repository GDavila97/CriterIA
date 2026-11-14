import { act, renderHook, waitFor } from '@testing-library/react';

import { runSession } from '@/entities/corrida';
import { ApiError, type RunCreatedBody, type UsageBody } from '@/shared/api';
import { fullRun } from '@/shared/lib/testing';

import { useRunController, type RunControllerDeps } from './useRunController';

const created = { run_id: 'run-1' } as RunCreatedBody;
const events = fullRun();
const used = (n: number): UsageBody => ({
  corridas_hora: n,
  limite_hora: 5,
  corridas_dia: n,
  limite_dia: 20,
});
const body = { requerimiento: 'x'.repeat(30) };
const offline = () => new ApiError(0, 'sin_conexion', 'Sin conexión');
/** Settles when told to; the test decides when the API answers. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function deps(overrides: Partial<RunControllerDeps> = {}): RunControllerDeps {
  return {
    createRun: vi.fn(async () => created),
    approveRun: vi.fn(async () => {}),
    stream: vi.fn(async ({ onEvent, onConnection, onHeartbeat, lastEventId }) => {
      onConnection?.('en_vivo');
      onHeartbeat?.();
      events
        .filter((e) => e.seq > lastEventId)
        .slice(0, lastEventId ? undefined : 5)
        .forEach(onEvent);
      return lastEventId ? 'fin' : 'pausa';
    }),
    usage: vi.fn(async () => used(1)),
    ...overrides,
  };
}

describe('useRunController', () => {
  beforeEach(() => runSession.clear());

  it('creates the run, follows it to the pause and resumes after the answer', async () => {
    const d = deps();
    const { result } = renderHook(() => useRunController(d));

    await act(() => result.current.start({ requerimiento: 'x'.repeat(30) }));
    expect(result.current.state.fase).toBe('esperando_aprobacion');
    expect(result.current.created).toBe(created);
    expect(result.current.lastBeat).not.toBeNull();
    expect(result.current.connection).toBe('cerrado');

    await act(() => result.current.respond({ decision: 'aprobado' }));

    expect(d.approveRun).toHaveBeenCalledWith('run-1', { decision: 'aprobado' });
    expect(vi.mocked(d.stream).mock.calls[1]?.[0].lastEventId).toBe(5);
    expect(result.current.state.fase).toBe('completada');
  });

  it('keeps API errors to show them and ignores answers without a run', async () => {
    const limit = new ApiError(429, 'limite_hora', 'Alcanzaste el límite de análisis por hora.');
    const d = deps({ createRun: vi.fn().mockRejectedValue(limit) });
    const { result } = renderHook(() => useRunController(d));

    await act(() => result.current.respond({ decision: 'aprobado' }));
    await act(() => result.current.start({ requerimiento: 'x'.repeat(30) }));

    expect(result.current.error).toBe(limit);
    expect(result.current.busy).toBe(false);
    expect(d.approveRun).not.toHaveBeenCalled();
  });

  it('reports stream and approval failures, wrapping unknown ones', async () => {
    const d = deps({
      stream: vi.fn().mockRejectedValueOnce(new Error('boom')),
      approveRun: vi
        .fn()
        .mockRejectedValue(new ApiError(409, 'versiones_agotadas', 'Ya pediste dos.')),
    });
    const { result } = renderHook(() => useRunController(d));

    await act(() => result.current.start({ requerimiento: 'x'.repeat(30) }));
    expect(result.current.error?.code).toBe('error_interno');

    await act(() => result.current.respond({ decision: 'otra_version' }));
    expect(result.current.error?.code).toBe('versiones_agotadas');
  });

  it('cancels the stream when the page goes away', async () => {
    let signal: AbortSignal | undefined;
    const d = deps({
      stream: vi.fn(async (options) => {
        signal = options.signal;
        return new Promise<never>(() => {});
      }),
    });
    const { result, unmount } = renderHook(() => useRunController(d));

    act(() => {
      void result.current.start({ requerimiento: 'x'.repeat(30) });
    });
    await waitFor(() => expect(signal).toBeDefined());
    unmount();

    expect(signal?.aborted).toBe(true);
  });

  it('keeps the analysis after leaving the page and reconnects from the last event on return', async () => {
    const d = deps({
      stream: vi.fn(async ({ onEvent, lastEventId, signal }) => {
        events.filter((e) => e.seq > lastEventId && e.seq <= lastEventId + 3).forEach(onEvent);
        // Stays open like a live stream until the page goes.
        return new Promise<never>((_, reject) => signal?.addEventListener('abort', reject));
      }),
    });
    const first = renderHook(() => useRunController(d));
    act(() => {
      void first.result.current.start({ requerimiento: 'Requerimiento de prueba largo' });
    });
    await waitFor(() => expect(first.result.current.state.ultimoSeq).toBe(3));
    first.unmount();

    const back = renderHook(() => useRunController(d));

    expect(back.result.current.created?.run_id).toBe('run-1');
    expect(back.result.current.requerimiento).toBe('Requerimiento de prueba largo');
    await waitFor(() => expect(back.result.current.state.ultimoSeq).toBe(6));
    expect(vi.mocked(d.stream).mock.calls[1]?.[0]).toMatchObject({
      runId: 'run-1',
      lastEventId: 3,
    });
    back.unmount();
  });

  it('does not reconnect to a finished analysis', async () => {
    const d = deps();
    const first = renderHook(() => useRunController(d));
    await act(() => first.result.current.start({ requerimiento: 'x'.repeat(30) }));
    await act(() => first.result.current.respond({ decision: 'aprobado' }));
    first.unmount();

    const back = renderHook(() => useRunController(d));

    expect(back.result.current.state.fase).toBe('completada');
    expect(d.stream).toHaveBeenCalledTimes(2);
  });

  describe('while a new analysis opens', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

    it('shows nothing when the API answers within 1.5 s', async () => {
      const d = deps();
      const { result } = renderHook(() => useRunController(d));
      const seen: string[] = [];

      await act(() => result.current.start(body, used(1)));
      seen.push(result.current.wait);
      await advance(5_000);
      seen.push(result.current.wait);

      expect(seen).toEqual(['oculta', 'oculta']);
      expect(result.current.state.fase).toBe('esperando_aprobacion');
    });

    it('shows the layer after 1.5 s, then Todo listo for 700 ms once the stream is live', async () => {
      const answer = deferred<RunCreatedBody>();
      const d = deps({ createRun: vi.fn(() => answer.promise) });
      const { result } = renderHook(() => useRunController(d));

      act(() => void result.current.start(body, used(1)));
      await advance(1_499);
      expect(result.current.wait).toBe('oculta');
      await advance(1);
      expect(result.current.wait).toBe('preparando');

      await act(async () => answer.resolve(created));
      expect(result.current.wait).toBe('listo');
      await advance(699);
      expect(result.current.wait).toBe('listo');
      await advance(1);
      expect(result.current.wait).toBe('oculta');
    });

    it('gives up after 30 s and does not create a second analysis if the first one arrived', async () => {
      let signal: AbortSignal | undefined;
      const createRun = vi.fn((_: unknown, s?: AbortSignal) => {
        signal = s;
        return new Promise<RunCreatedBody>(() => {});
      });
      const usage = vi.fn(async () => used(2));
      const d = deps({ createRun, usage });
      const { result } = renderHook(() => useRunController(d));

      act(() => void result.current.start(body, used(1)));
      await advance(30_000);
      expect(result.current.wait).toBe('sin_conexion');
      expect(signal?.aborted).toBe(true);
      expect(result.current.busy).toBe(false);

      await act(() => result.current.retry());

      expect(usage).toHaveBeenCalledTimes(1);
      expect(result.current.wait).toBe('creado_sin_abrir');
      expect(createRun).toHaveBeenCalledTimes(1);

      createRun.mockImplementation(async () => created);
      await act(() => result.current.startAnyway());
      expect(createRun).toHaveBeenCalledTimes(2);
    });

    it('retries the request after a network error only when the first one never arrived', async () => {
      const createRun = vi
        .fn<RunControllerDeps['createRun']>()
        .mockRejectedValueOnce(offline())
        .mockResolvedValue(created);
      const d = deps({ createRun, usage: vi.fn(async () => used(1)) });
      const { result } = renderHook(() => useRunController(d));

      await act(() => result.current.start(body, used(1)));
      expect(result.current.wait).toBe('sin_conexion');
      expect(result.current.error).toBeNull();

      await act(() => result.current.retry());

      expect(createRun).toHaveBeenCalledTimes(2);
      expect(result.current.wait).toBe('listo');
      expect(result.current.state.fase).toBe('esperando_aprobacion');
    });

    it('keeps the error layer when the usage check also fails', async () => {
      const createRun = vi.fn<RunControllerDeps['createRun']>().mockRejectedValue(offline());
      const d = deps({ createRun, usage: vi.fn().mockRejectedValue(offline()) });
      const { result } = renderHook(() => useRunController(d));

      await act(() => result.current.start(body, used(1)));
      await act(() => result.current.retry());

      expect(result.current.wait).toBe('sin_conexion');
      expect(createRun).toHaveBeenCalledTimes(1);
    });

    it('reopens the same analysis when only the stream failed to connect', async () => {
      const stream = vi
        .fn<RunControllerDeps['stream']>()
        .mockRejectedValueOnce(offline())
        .mockImplementation(async ({ onConnection }) => {
          onConnection?.('en_vivo');
          return 'pausa';
        });
      const d = deps({ stream });
      const { result } = renderHook(() => useRunController(d));

      await act(() => result.current.start(body, used(1)));
      expect(result.current.wait).toBe('sin_conexion');
      await act(() => result.current.retry());

      expect(d.createRun).toHaveBeenCalledTimes(1);
      expect(d.usage).not.toHaveBeenCalled();
      expect(vi.mocked(stream).mock.calls[1]?.[0].runId).toBe('run-1');
      expect(result.current.wait).toBe('listo');
    });

    it('cancels back to the form, dropping an analysis that never opened', async () => {
      const d = deps({ stream: vi.fn().mockRejectedValue(offline()) });
      const { result } = renderHook(() => useRunController(d));

      await act(() => result.current.start(body, used(1)));
      expect(result.current.created?.run_id).toBe('run-1');
      act(() => result.current.cancelWait());

      expect(result.current.wait).toBe('oculta');
      expect(result.current.created).toBeNull();
      expect(result.current.busy).toBe(false);
    });

    it('hides the layer for errors that are not about the connection', async () => {
      const limit = new ApiError(429, 'limite_hora', 'Límite');
      const d = deps({ createRun: vi.fn().mockRejectedValue(limit) });
      const { result } = renderHook(() => useRunController(d));

      await act(() => result.current.start(body, used(5)));

      expect(result.current.wait).toBe('oculta');
      expect(result.current.error).toBe(limit);
    });
  });
});
