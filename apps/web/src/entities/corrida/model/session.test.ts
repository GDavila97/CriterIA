import { act, renderHook } from '@testing-library/react';

import type { RunCreatedBody } from '@/shared/api';
import { fullRun } from '@/shared/lib/testing';

import {
  isLive,
  isUnsavedResult,
  runSession,
  useRunSession,
  wouldBeLost,
  type RunSession,
} from './session';

const created = (guardar_historial: boolean) =>
  ({ run_id: 'run-1', guardar_historial }) as RunCreatedBody;

function playTo(seq: number) {
  for (const evento of fullRun().filter((e) => e.seq <= seq)) {
    runSession.apply({ type: 'evento', evento });
  }
}

const pause = () => fullRun().find((e) => e.type === 'en_espera_humano')?.seq ?? 0;

describe('runSession', () => {
  beforeEach(() => runSession.clear());

  it('keeps the analysis for every component that reads it until it is cleared', () => {
    runSession.start(created(false), 'Requerimiento');
    playTo(3);
    const { result, unmount } = renderHook(() => useRunSession());
    unmount();

    const again = renderHook(() => useRunSession());

    expect(again.result.current.requerimiento).toBe('Requerimiento');
    expect(again.result.current.state.ultimoSeq).toBe(3);
    expect(again.result.current).toBe(result.current);
    act(() => runSession.clear());
    expect(again.result.current.created).toBeNull();
  });

  it('never writes to cookies or browser storage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const cookie = vi.spyOn(document, 'cookie', 'set');

    runSession.start(created(false), 'Requerimiento');
    playTo(fullRun().length);
    renderHook(() => useRunSession());

    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(cookie).not.toHaveBeenCalled();
  });
});

describe('what would be lost', () => {
  beforeEach(() => runSession.clear());
  const now = (): RunSession => runSession.get();

  it('is nothing before an analysis starts', () => {
    expect(wouldBeLost(now())).toBe(false);
  });

  it('is a live analysis, with or without history', () => {
    for (const history of [false, true]) {
      runSession.start(created(history), 'Requerimiento');
      expect([isLive(now()), wouldBeLost(now())]).toEqual([true, true]);
      playTo(pause());
      expect(now().state.fase).toBe('esperando_aprobacion');
      expect(wouldBeLost(now())).toBe(true);
    }
  });

  it('is a finished result only when it is not in the history', () => {
    runSession.start(created(false), 'Requerimiento');
    playTo(fullRun().length);
    expect([isLive(now()), isUnsavedResult(now()), wouldBeLost(now())]).toEqual([
      false,
      true,
      true,
    ]);

    runSession.start(created(true), 'Requerimiento');
    playTo(fullRun().length);
    expect([isUnsavedResult(now()), wouldBeLost(now())]).toEqual([false, false]);
  });
});
