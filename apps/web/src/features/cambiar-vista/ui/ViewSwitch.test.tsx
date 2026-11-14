import { renderHook, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { readStoredView, resolveView, storeView, useView } from '../model/view';
import { ViewSwitch } from './ViewSwitch';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('view preference', () => {
  it('prefers ?vista=, then storage, and is classic while the office is off', () => {
    storeView('oficina');

    expect(resolveView(null, false)).toBe('clasica');
    expect(resolveView('clasica', true)).toBe('clasica');
    expect(resolveView(null, true)).toBe('oficina');
    expect(resolveView('rara', true)).toBe('oficina');
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(() => storeView('oficina')).not.toThrow();
    expect(readStoredView()).toBeNull();
  });
});

describe('ViewSwitch', () => {
  it('renders nothing while disabled and remembers the choice when enabled', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<ViewSwitch value="clasica" enabled={false} onChange={onChange} />);
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();

    rerender(<ViewSwitch value="clasica" enabled onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Oficina' }));

    expect(onChange).toHaveBeenCalledWith('oficina');
    expect(readStoredView()).toBe('oficina');
  });
});

describe('useView', () => {
  const original = window.matchMedia;
  const width = (wide: boolean) => {
    window.matchMedia = ((query: string) => ({
      matches: query === '(min-width: 768px)' ? wide : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  };
  afterEach(() => {
    window.matchMedia = original;
  });

  it('offers the office from 768 px and follows ?vista=oficina', () => {
    width(true);
    const { result } = renderHook(() => useView('oficina', true));

    expect(result.current).toMatchObject({ vista: 'oficina', available: true });
  });

  it('falls back to classic below 768 px or with the office turned off', () => {
    width(false);
    expect(renderHook(() => useView('oficina', true)).result.current).toMatchObject({
      vista: 'clasica',
      available: false,
    });

    width(true);
    expect(renderHook(() => useView('oficina', false)).result.current).toMatchObject({
      vista: 'clasica',
      available: false,
    });
  });
});
