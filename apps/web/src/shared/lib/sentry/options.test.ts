import type { ErrorEvent } from '@sentry/nextjs';

import { scrubSensitiveData, sentryOptions } from './options';

const env = {
  NEXT_PUBLIC_APP_ENV: 'test',
  NEXT_PUBLIC_API_URL: 'http://localhost:8080',
  NEXT_PUBLIC_OFFICE_VIEW: false,
  NEXT_PUBLIC_CONTACT_URL: 'https://github.com/GDavila97',
} as const;

describe('sentryOptions', () => {
  it('returns null without a DSN so Sentry stays off', () => {
    expect(sentryOptions(env)).toBeNull();
  });

  it('never sends PII and always scrubs events', () => {
    const options = sentryOptions({
      ...env,
      NEXT_PUBLIC_SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1',
    });

    expect(options?.sendDefaultPii).toBe(false);
    expect(options?.beforeSend).toBe(scrubSensitiveData);
  });
});

describe('scrubSensitiveData', () => {
  it('removes authorization, cookie and provider key headers and cookies', () => {
    const event: ErrorEvent = {
      type: undefined,
      request: {
        url: '/runs',
        cookies: { session: 'secret' },
        headers: {
          Authorization: 'Bearer token',
          cookie: 'session=secret',
          'X-Provider-Key': 'sk-user',
          accept: 'text/html',
        },
      },
    };

    const scrubbed = scrubSensitiveData(event);

    expect(scrubbed.request).toEqual({ url: '/runs', headers: { accept: 'text/html' } });
  });

  it('leaves events without a request untouched', () => {
    const event: ErrorEvent = { type: undefined, message: 'boom' };

    expect(scrubSensitiveData(event)).toBe(event);
  });
});
