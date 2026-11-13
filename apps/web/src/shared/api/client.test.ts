import { ApiError, createApiClient } from './client';
import type { TokenStore } from './token';

function tokens(values: (string | null)[] = ['t1', 't2']): TokenStore & { cleared: number } {
  const store = {
    cleared: 0,
    get: vi.fn(async () => values[0] ?? null),
    clear: () => {
      store.cleared += 1;
      values.shift();
    },
  };
  return store;
}

afterEach(() => vi.unstubAllGlobals());

describe('createApiClient', () => {
  it('sends the token, a JSON body and returns the parsed response', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetchMock);
    const request = createApiClient({ baseUrl: 'http://api.test', tokens: tokens() });

    const result = await request<{ ok: boolean }>('/runs', { method: 'POST', body: { a: 1 } });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/runs', {
      method: 'POST',
      headers: { authorization: 'Bearer t1', 'content-type': 'application/json' },
      body: '{"a":1}',
      signal: undefined,
      cache: 'no-store',
    });
  });

  it('retries once with a fresh token after a 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const store = tokens();
    const request = createApiClient({ baseUrl: 'http://api.test', tokens: store });

    await request('/me/runs', { method: 'DELETE' });

    expect(store.cleared).toBe(1);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ headers: { authorization: 'Bearer t2' } });
  });

  it('turns API errors into ApiError with the code and the interface wording', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json(
            { code: 'limite_hora', message: 'Alcanzaste el límite de corridas por hora.' },
            { status: 429 },
          ),
        )
        .mockResolvedValueOnce(
          Response.json(
            { code: 'clave_invalida', message: 'El proveedor rechazó la clave.' },
            {
              status: 422,
            },
          ),
        ),
    );
    const request = createApiClient({ baseUrl: 'http://api.test', tokens: tokens() });

    await expect(request('/runs')).rejects.toMatchObject({
      status: 429,
      code: 'limite_hora',
      message: 'Alcanzaste el límite de análisis por hora.',
    });
    await expect(request('/me/credentials')).rejects.toMatchObject({
      code: 'clave_invalida',
      message: 'El proveedor rechazó la clave.',
    });
  });

  it('uses a generic error for unexpected bodies and network failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>', { status: 502 })),
    );
    const request = createApiClient({ baseUrl: 'http://api.test', tokens: tokens() });
    await expect(request('/x')).rejects.toMatchObject({ code: 'error_interno' });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(request('/x')).rejects.toMatchObject({ code: 'sin_conexion' });
  });

  it('lets aborts through and skips the token on public endpoints', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('x', 'AbortError')));
    const store = tokens([]);
    const request = createApiClient({ baseUrl: 'http://api.test', tokens: store });
    await expect(request('/evaluation', { auth: false })).rejects.toMatchObject({
      name: 'AbortError',
    });

    await expect(request('/me/settings')).rejects.toBeInstanceOf(ApiError);
    expect(store.get).toHaveBeenCalledTimes(1);
  });
});
