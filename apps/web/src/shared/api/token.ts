export interface TokenStore {
  /** A valid token, renewed when it is about to expire; null without a session. */
  get(): Promise<string | null>;
  clear(): void;
}

export interface TokenStoreOptions {
  fetchToken: () => Promise<string | null>;
  now?: () => number;
  /** Renew this long before expiry so a request never leaves with an expiring token. */
  refreshMarginMs?: number;
}

function expiresAt(token: string): number {
  try {
    const payload = token.split('.')[1] ?? '';
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const exp: unknown = JSON.parse(json).exp;
    return typeof exp === 'number' ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/** Keeps the API token only in this closure: never in storage, cookies or React state. */
export function createTokenStore({
  fetchToken,
  now = Date.now,
  refreshMarginMs = 60_000,
}: TokenStoreOptions): TokenStore {
  let current: { value: string; expiresAt: number } | null = null;
  let pending: Promise<string | null> | null = null;

  return {
    get() {
      if (current && current.expiresAt - refreshMarginMs > now()) {
        return Promise.resolve(current.value);
      }
      pending ??= fetchToken()
        .then((value) => {
          current = value ? { value, expiresAt: expiresAt(value) } : null;
          return value;
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
    clear() {
      current = null;
    },
  };
}

export async function fetchSessionToken(): Promise<string | null> {
  const response = await fetch('/api/auth/token', {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!response.ok) return null;
  const body: unknown = await response.json();
  const token = (body as { token?: unknown }).token;
  return typeof token === 'string' ? token : null;
}

export const apiToken = createTokenStore({ fetchToken: fetchSessionToken });
