import { publicEnv } from '@/shared/config';

import { userMessage } from './messages';
import { apiToken, type TokenStore } from './token';

export class ApiError extends Error {
  override name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const NETWORK_MESSAGE =
  'No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Public endpoints skip the token. */
  auth?: boolean;
}

export interface ApiClientDeps {
  baseUrl: string;
  tokens: TokenStore;
}

async function errorFrom(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown };
    if (typeof body.code === 'string' && typeof body.message === 'string') {
      return new ApiError(response.status, body.code, userMessage(body.code, body.message));
    }
  } catch {
    // A body that is not the API's error shape falls through to the generic error.
  }
  return new ApiError(response.status, 'error_interno', 'Ocurrió un error inesperado.');
}

export async function authHeaders(tokens: TokenStore): Promise<Record<string, string>> {
  const token = await tokens.get();
  if (!token) throw new ApiError(401, 'no_autenticado', 'Tu sesión terminó. Vuelve a entrar.');
  return { authorization: `Bearer ${token}` };
}

export function createApiClient({ baseUrl, tokens }: ApiClientDeps) {
  async function send(path: string, options: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = options.auth === false ? {} : await authHeaders(tokens);
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    try {
      return await fetch(`${baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
        cache: 'no-store',
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new ApiError(0, 'sin_conexion', NETWORK_MESSAGE);
    }
  }

  return async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    let response = await send(path, options);
    if (response.status === 401 && options.auth !== false) {
      // The token may have expired between the check and the request: one fresh try.
      tokens.clear();
      response = await send(path, options);
    }
    if (!response.ok) throw await errorFrom(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  };
}

export const apiRequest = createApiClient({
  baseUrl: publicEnv.NEXT_PUBLIC_API_URL.replace(/\/$/, ''),
  tokens: apiToken,
});
