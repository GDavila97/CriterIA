import { act, renderHook, waitFor } from '@testing-library/react';

import { ApiError, type RunCreatedBody } from '@/shared/api';
import { fullRun } from '@/shared/lib/testing';

import { useRunController, type RunControllerDeps } from './useRunController';

const created = { run_id: 'run-1' } as RunCreatedBody;
const events = fullRun();

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
    ...overrides,
  };
}

describe('useRunController', () => {
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
    const limit = new ApiError(429, 'limite_hora', 'Alcanzaste el límite de corridas por hora.');
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
});
