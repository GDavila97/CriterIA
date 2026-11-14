import { act, renderHook } from '@testing-library/react';

import { useMediaQuery, usePageVisible, useReducedMotion } from './useMediaQuery';

function fakeMatchMedia(matches: Record<string, boolean>) {
  const listeners = new Map<string, Set<() => void>>();
  window.matchMedia = ((query: string) => ({
    get matches() {
      return matches[query] ?? false;
    },
    addEventListener: (_: string, fn: () => void) => {
      listeners.set(query, (listeners.get(query) ?? new Set()).add(fn));
    },
    removeEventListener: (_: string, fn: () => void) => listeners.get(query)?.delete(fn),
  })) as unknown as typeof window.matchMedia;
  return (query: string, value: boolean) => {
    matches[query] = value;
    listeners.get(query)?.forEach((fn) => fn());
  };
}

describe('media hooks', () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });

  it('follows a media query as it changes', () => {
    const set = fakeMatchMedia({ '(min-width: 768px)': true });
    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(result.current).toBe(true);

    act(() => set('(min-width: 768px)', false));
    expect(result.current).toBe(false);
  });

  it('reads reduced motion and treats a missing matchMedia as no match', () => {
    fakeMatchMedia({ '(prefers-reduced-motion: reduce)': true });
    expect(renderHook(() => useReducedMotion()).result.current).toBe(true);

    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    expect(renderHook(() => useMediaQuery('(min-width: 768px)')).result.current).toBe(false);
  });

  it('knows when the tab is hidden', () => {
    const { result } = renderHook(() => usePageVisible());
    expect(result.current).toBe(true);

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toBe(false);
    visibility.mockRestore();
  });
});
