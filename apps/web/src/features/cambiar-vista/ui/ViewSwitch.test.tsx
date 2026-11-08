import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { readStoredView, resolveView, storeView } from '../model/view';
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
