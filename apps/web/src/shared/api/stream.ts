import { publicEnv } from '@/shared/config';
import { createSseParser } from '@/shared/lib/sse';

import { ApiError, authHeaders } from './client';
import { userMessage } from './messages';
import { apiToken, type TokenStore } from './token';
import type { Evento } from './types.gen';

export type ConnectionState = 'conectando' | 'en_vivo' | 'reconectando';
export type StreamEnd = 'pausa' | 'fin' | 'cancelado';

export interface StreamOptions {
  runId: string;
  lastEventId: number;
  signal: AbortSignal;
  onEvent: (event: Evento) => void;
  onHeartbeat?: () => void;
  onConnection?: (state: ConnectionState) => void;
}

export interface StreamDeps {
  baseUrl: string;
  tokens: TokenStore;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Waits after each consecutive failure; the stream gives up after the last one. */
  retryDelaysMs: readonly number[];
  busyDelayMs: number;
}

const TERMINAL: Record<string, StreamEnd> = { en_espera_humano: 'pausa', corrida_fin: 'fin' };

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

const defaults: StreamDeps = {
  baseUrl: publicEnv.NEXT_PUBLIC_API_URL.replace(/\/$/, ''),
  tokens: apiToken,
  sleep: abortableSleep,
  retryDelaysMs: [1_000, 2_000, 4_000, 8_000, 8_000],
  busyDelayMs: 1_500,
};

async function errorFrom(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => ({}))) as { code?: string; message?: string };
  const code = body.code ?? 'error_interno';
  return new ApiError(
    response.status,
    code,
    userMessage(code, body.message ?? 'No se pudo abrir el análisis.'),
  );
}

/**
 * Follows a run's events with fetch, since EventSource cannot send Authorization. Reconnects
 * with Last-Event-ID after a cut, waits while another stream holds the run, and resolves when
 * the run pauses for the person, ends, or the signal aborts.
 */
export async function streamRun(
  options: StreamOptions,
  deps: StreamDeps = defaults,
): Promise<StreamEnd> {
  let last = options.lastEventId;
  let failures = 0;

  while (!options.signal.aborted) {
    options.onConnection?.(failures === 0 ? 'conectando' : 'reconectando');
    let response: Response;
    try {
      const headers = await authHeaders(deps.tokens);
      if (last > 0) headers['last-event-id'] = String(last);
      response = await fetch(`${deps.baseUrl}/runs/${encodeURIComponent(options.runId)}/stream`, {
        headers,
        signal: options.signal,
        cache: 'no-store',
      });
    } catch (error) {
      if (options.signal.aborted) return 'cancelado';
      if (error instanceof ApiError) throw error;
      failures += 1;
      if (failures > deps.retryDelaysMs.length)
        throw new ApiError(0, 'sin_conexion', 'Se perdió la conexión con el análisis.');
      await deps.sleep(deps.retryDelaysMs[failures - 1] ?? 0, options.signal);
      continue;
    }
    if (response.status === 409) {
      const error = await errorFrom(response);
      if (error.code !== 'stream_activo') throw error;
      await deps.sleep(deps.busyDelayMs, options.signal);
      continue;
    }
    if (response.status === 401) {
      deps.tokens.clear();
      failures += 1;
      if (failures > deps.retryDelaysMs.length) throw await errorFrom(response);
      continue;
    }
    if (!response.ok || !response.body) throw await errorFrom(response);

    options.onConnection?.('en_vivo');
    let end: StreamEnd | null = null;
    const parser = createSseParser(
      (message) => {
        const event = JSON.parse(message.data) as Evento;
        if (event.seq <= last) return;
        last = event.seq;
        failures = 0;
        options.onEvent(event);
        end = TERMINAL[event.type] ?? end;
      },
      () => options.onHeartbeat?.(),
    );
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(value);
      }
    } catch {
      if (options.signal.aborted) return 'cancelado';
    }
    if (end) return end;
    // The connection closed before the run paused or ended: resume from the last event.
    failures += 1;
    if (failures > deps.retryDelaysMs.length) {
      throw new ApiError(0, 'sin_conexion', 'Se perdió la conexión con el análisis.');
    }
    await deps.sleep(deps.retryDelaysMs[failures - 1] ?? 0, options.signal);
  }
  return 'cancelado';
}
