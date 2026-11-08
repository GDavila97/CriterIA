import { createTokenStore, fetchSessionToken } from './token';

function jwt(expSeconds: number): string {
  const payload = btoa(JSON.stringify({ exp: expSeconds })).replace(/=+$/, '');
  return `header.${payload}.signature`;
}

describe('createTokenStore', () => {
  it('reuses a token until it is about to expire, then renews it', async () => {
    let clock = 1_000_000;
    const tokens = [jwt(1_000 + 300), jwt(1_000 + 900)];
    const fetchToken = vi.fn(async () => tokens.shift() ?? null);
    const store = createTokenStore({ fetchToken, now: () => clock, refreshMarginMs: 60_000 });

    const first = await store.get();
    clock += 200_000;
    const reused = await store.get();
    clock += 50_000;
    const renewed = await store.get();

    expect(reused).toBe(first);
    expect(renewed).not.toBe(first);
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it('shares one request between concurrent callers', async () => {
    const fetchToken = vi.fn(async () => jwt(Date.now() / 1000 + 300));
    const store = createTokenStore({ fetchToken });

    const [a, b] = await Promise.all([store.get(), store.get()]);

    expect(a).toBe(b);
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it('treats tokens it cannot read as expired and forgets them on clear', async () => {
    const fetchToken = vi.fn(async () => 'not-a-jwt');
    const store = createTokenStore({ fetchToken });

    await store.get();
    await store.get();
    store.clear();

    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it('never writes the token to web storage or cookies', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const store = createTokenStore({ fetchToken: async () => jwt(Date.now() / 1000 + 300) });

    await store.get();

    expect(setItem).not.toHaveBeenCalled();
    expect(document.cookie).toBe('');
    setItem.mockRestore();
  });
});

describe('fetchSessionToken', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks Better Auth for a token with the session cookie', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ token: 'abc' })));
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchSessionToken()).toBe('abc');
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/token', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
  });

  it('returns null without a session or with an unexpected body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 401 })),
    );
    expect(await fetchSessionToken()).toBeNull();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({}))),
    );
    expect(await fetchSessionToken()).toBeNull();
  });
});
