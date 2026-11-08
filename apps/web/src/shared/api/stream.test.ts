import { streamRun, type StreamDeps } from './stream';
import type { TokenStore } from './token';
import type { Evento } from './types.gen';

const encoder = new TextEncoder();

function event(seq: number, type: string, extra: Record<string, unknown> = {}): string {
  const data = JSON.stringify({
    type,
    seq,
    run_id: 'r',
    ts: '2026-11-07T00:00:00Z',
    agent: 'sistema',
    ...extra,
  });
  return `id: ${seq}\nevent: ${type}\ndata: ${data}\n\n`;
}

function body(...chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
}

const store: TokenStore = { get: async () => 'token', clear: vi.fn() };

function deps(overrides: Partial<StreamDeps> = {}): StreamDeps {
  return {
    baseUrl: 'http://api.test',
    tokens: store,
    sleep: vi.fn(async () => {}),
    retryDelaysMs: [10, 20],
    busyDelayMs: 5,
    ...overrides,
  };
}

function run(
  fetchMock: ReturnType<typeof vi.fn>,
  extra: Partial<StreamDeps> = {},
  lastEventId = 0,
) {
  vi.stubGlobal('fetch', fetchMock);
  const events: Evento[] = [];
  const heartbeats: number[] = [];
  const states: string[] = [];
  const controller = new AbortController();
  const done = streamRun(
    {
      runId: 'run-1',
      lastEventId,
      signal: controller.signal,
      onEvent: (e) => events.push(e),
      onHeartbeat: () => heartbeats.push(1),
      onConnection: (s) => states.push(s),
    },
    deps(extra),
  );
  return { done, events, heartbeats, states, controller };
}

afterEach(() => vi.unstubAllGlobals());

describe('streamRun', () => {
  it('delivers events, heartbeats and stops at the human pause', async () => {
    const fetchMock = vi.fn(async () =>
      body(event(1, 'corrida_inicia'), ': ping\n\n', event(2, 'en_espera_humano')),
    );
    const { done, events, heartbeats, states } = run(fetchMock);

    expect(await done).toBe('pausa');
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
    expect(heartbeats).toHaveLength(1);
    expect(states).toEqual(['conectando', 'en_vivo']);
  });

  it('reconnects with Last-Event-ID after a cut and skips repeated events', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(body(event(1, 'corrida_inicia'), event(2, 'agente_inicia')))
      .mockResolvedValueOnce(body(event(2, 'agente_inicia'), event(3, 'corrida_fin')));
    const { done, events, states } = run(fetchMock);

    expect(await done).toBe('fin');
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(fetchMock.mock.calls[1]?.[1].headers).toMatchObject({ 'last-event-id': '2' });
    expect(states).toContain('reconectando');
  });

  it('waits while another stream holds the run', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ code: 'stream_activo', message: 'x' }, { status: 409 }),
      )
      .mockResolvedValueOnce(body(event(5, 'corrida_fin')));
    const sleep = vi.fn(async () => {});
    const { done } = run(fetchMock, { sleep }, 4);

    expect(await done).toBe('fin');
    expect(sleep).toHaveBeenCalledWith(5, expect.any(AbortSignal));
    expect(fetchMock.mock.calls[0]?.[1].headers).toMatchObject({ 'last-event-id': '4' });
  });

  it('gives up after the last retry and reports other errors as they are', async () => {
    const offline = run(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(offline.done).rejects.toMatchObject({ code: 'sin_conexion' });

    const missing = run(
      vi.fn(async () =>
        Response.json({ code: 'no_encontrado', message: 'No existe.' }, { status: 404 }),
      ),
    );
    await expect(missing.done).rejects.toMatchObject({ status: 404, code: 'no_encontrado' });

    const conflict = run(
      vi.fn(async () => Response.json({ code: 'estado_invalido', message: 'x' }, { status: 409 })),
    );
    await expect(conflict.done).rejects.toMatchObject({ code: 'estado_invalido' });
  });

  it('renews the token after a 401 and stops when the session is gone', async () => {
    const clear = vi.fn();
    const tokens: TokenStore = { get: async () => 'token', clear };
    const unauthorized = () =>
      Response.json({ code: 'no_autenticado', message: 'x' }, { status: 401 });
    const fetchMock = vi.fn(async () => unauthorized());
    const { done } = run(fetchMock, { tokens });

    await expect(done).rejects.toMatchObject({ code: 'no_autenticado' });
    expect(clear).toHaveBeenCalledTimes(3);
  });

  it('ends quietly when the page leaves', async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(new DOMException('aborted', 'AbortError'));
          // Like fetch: an already aborted signal rejects at once.
          if (init.signal?.aborted) abort();
          init.signal?.addEventListener('abort', abort);
        }),
    );
    const { done, controller } = run(fetchMock);

    controller.abort();

    expect(await done).toBe('cancelado');
  });

  it('reconnects after a cut stream too many times and gives up', async () => {
    const fetchMock = vi.fn(async () => body(event(1, 'corrida_inicia')));
    const { done } = run(fetchMock, { retryDelaysMs: [1] });

    await expect(done).rejects.toMatchObject({ code: 'sin_conexion' });
  });
});
