import { act, renderHook } from '@testing-library/react';

import type { AgentId } from '@/entities/corrida';

import { HOME_REST } from '../model/layout';
import { createIdlePlanner } from '../model/idle';
import { useIdleLife, type IdleOptions } from './useIdleLife';

const FREE: AgentId[] = ['qa', 'revisor'];
const options = (active = true): IdleOptions => ({
  seed: 11,
  spotCount: 5,
  active,
  occupied: [],
  home: HOME_REST,
});

describe('useIdleLife', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('follows the seeded plan step by step, walking only to open spots', () => {
    const planner = createIdlePlanner(11);
    const pause = planner.pause();
    // qa and revisor rest on spots 1 and 2.
    const expected = planner.next(FREE, [0, 3, 4])!;
    const { result } = renderHook(() => useIdleLife(FREE, options()));

    act(() => vi.advanceTimersByTime(pause - 1));
    expect(result.current).toEqual({ spots: {}, chatter: {} });
    act(() => vi.advanceTimersByTime(1));

    if (expected.kind === 'caminar') {
      expect(result.current.spots).toEqual({ [expected.agent]: expected.spot });
    } else {
      expect(result.current.chatter).toEqual({ [expected.agent]: expected.texto });
    }
  });

  it('does the same in two runs with the same seed', () => {
    const a = renderHook(() => useIdleLife(FREE, options()));
    const b = renderHook(() => useIdleLife(FREE, options()));

    act(() => vi.advanceTimersByTime(40_000));

    expect(a.result.current).toEqual(b.result.current);
  });

  it('stops while inactive, as with the tab hidden or reduced motion', () => {
    const { result, rerender } = renderHook(({ active }) => useIdleLife(FREE, options(active)), {
      initialProps: { active: false },
    });

    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).toEqual({ spots: {}, chatter: {} });
    expect(vi.getTimerCount()).toBe(0);

    rerender({ active: true });
    act(() => vi.advanceTimersByTime(60_000));
    const moved = result.current;
    rerender({ active: false });
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current.spots).toEqual(moved.spots);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('forgets an agent that goes back to work', () => {
    const { result, rerender } = renderHook(({ free }) => useIdleLife(free, options()), {
      initialProps: { free: FREE },
    });
    act(() => vi.advanceTimersByTime(60_000));
    expect(
      Object.keys({ ...result.current.spots, ...result.current.chatter }).length,
    ).toBeGreaterThan(0);

    rerender({ free: [] });

    expect(result.current).toEqual({ spots: {}, chatter: {} });
  });
});

describe('useIdleLife spots', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('never sends two agents to the same spot', () => {
    const all: AgentId[] = ['analista', 'qa', 'revisor', 'evaluador'];
    const { result } = renderHook(() => useIdleLife(all, options()));

    for (let i = 0; i < 40; i += 1) {
      act(() => vi.advanceTimersByTime(3_000));
      const places = all.map((id) => result.current.spots[id] ?? HOME_REST[id]);
      expect(new Set(places).size).toBe(places.length);
    }
  });
});
