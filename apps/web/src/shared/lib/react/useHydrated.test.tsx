import { renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';

import { useHydrated } from './useHydrated';

function Probe() {
  return <span>{useHydrated() ? 'listo' : 'cargando'}</span>;
}

describe('useHydrated', () => {
  it('is false on the server and true in the browser', () => {
    expect(renderToString(<Probe />)).toContain('cargando');
    expect(renderHook(() => useHydrated()).result.current).toBe(true);
  });
});
