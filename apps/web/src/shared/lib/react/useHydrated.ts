import { useSyncExternalStore } from 'react';

const noop = () => () => {};

/**
 * False during server rendering and before hydration. Forms with secrets keep their submit
 * disabled until then, so the browser never sends them natively in a GET query string.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
