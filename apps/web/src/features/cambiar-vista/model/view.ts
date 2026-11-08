export type Vista = 'clasica' | 'oficina';

const KEY = 'criteria.vista';

export function readStoredView(): Vista | null {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === 'clasica' || value === 'oficina' ? value : null;
  } catch {
    return null;
  }
}

export function storeView(vista: Vista): void {
  try {
    window.localStorage.setItem(KEY, vista);
  } catch {
    // Private windows can refuse storage; the choice simply is not remembered.
  }
}

/** ?vista= wins, then the remembered choice; without the office view it is always classic. */
export function resolveView(param: string | null, officeEnabled: boolean): Vista {
  if (!officeEnabled) return 'clasica';
  if (param === 'clasica' || param === 'oficina') return param;
  return readStoredView() ?? 'clasica';
}
