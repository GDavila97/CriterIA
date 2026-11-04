import type { ErrorEvent } from '@sentry/nextjs';

import type { PublicEnv } from '@/shared/config';

const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'x-provider-key']);

export function scrubSensitiveData(event: ErrorEvent): ErrorEvent {
  const request = event.request;
  if (!request) {
    return event;
  }
  const headers = request.headers
    ? Object.fromEntries(
        Object.entries(request.headers).filter(
          ([name]) => !SENSITIVE_HEADERS.has(name.toLowerCase()),
        ),
      )
    : undefined;
  const { cookies: _cookies, ...rest } = request;
  return { ...event, request: { ...rest, ...(headers && { headers }) } };
}

export function sentryOptions(env: PublicEnv) {
  if (!env.NEXT_PUBLIC_SENTRY_DSN) {
    return null;
  }
  return {
    dsn: env.NEXT_PUBLIC_SENTRY_DSN,
    environment: env.NEXT_PUBLIC_APP_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubSensitiveData,
  };
}
