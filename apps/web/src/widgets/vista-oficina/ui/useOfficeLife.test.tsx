import { act, renderHook } from '@testing-library/react';

import { AGENT_IDS } from '@/entities/corrida';

import type { LifeInput } from '../model/life';
import { DESKS } from '../model/places';
import { useOfficeLife } from './useOfficeLife';

const FREE: LifeInput = { fixed: {}, celebrate: false };

describe('useOfficeLife', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts everyone at their desk and gets them moving on the seeded schedule', () => {
    const { result } = renderHook(() => useOfficeLife(FREE, { seed: 4, active: true }));
    for (const id of AGENT_IDS) expect(result.current[id].place).toBe(DESKS[id].id);

    act(() => vi.advanceTimersByTime(30_000));

    expect(AGENT_IDS.some((id) => result.current[id].walk > 0)).toBe(true);
  });

  it('plays the same for the same seed', () => {
    const a = renderHook(() => useOfficeLife(FREE, { seed: 4, active: true }));
    const b = renderHook(() => useOfficeLife(FREE, { seed: 4, active: true }));

    act(() => vi.advanceTimersByTime(45_000));

    expect(a.result.current).toEqual(b.result.current);
  });

  it('stops its clock while inactive and picks up where it was', () => {
    const { result, rerender } = renderHook(
      ({ active }) => useOfficeLife(FREE, { seed: 4, active }),
      { initialProps: { active: true } },
    );
    act(() => vi.advanceTimersByTime(10_000));
    const paused = result.current;

    rerender({ active: false });
    act(() => vi.advanceTimersByTime(120_000));
    expect(result.current).toEqual(paused);
    expect(vi.getTimerCount()).toBe(0);

    rerender({ active: true });
    act(() => vi.advanceTimersByTime(60_000));
    expect(result.current).not.toEqual(paused);
  });

  it('sends the team to celebrate when the analysis ends', () => {
    const { result, rerender } = renderHook(
      ({ input }) => useOfficeLife(input, { seed: 4, active: true }),
      {
        initialProps: { input: FREE },
      },
    );
    act(() => vi.advanceTimersByTime(5_000));

    rerender({ input: { fixed: {}, celebrate: true } });

    for (const id of AGENT_IDS) expect(result.current[id].activity).toBe('celebrar');
  });
});
