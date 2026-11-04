import { EnvError, parsePublicEnv } from './env.schema';

const valid = {
  NEXT_PUBLIC_APP_ENV: 'development',
  NEXT_PUBLIC_API_URL: 'http://localhost:8080',
};

describe('parsePublicEnv', () => {
  it('accepts the required variables and treats an empty DSN as absent', () => {
    const env = parsePublicEnv({ ...valid, NEXT_PUBLIC_SENTRY_DSN: '' });

    expect(env.NEXT_PUBLIC_API_URL).toBe('http://localhost:8080');
    expect(env.NEXT_PUBLIC_SENTRY_DSN).toBeUndefined();
  });

  it('fails with a message naming every missing variable', () => {
    expect(() => parsePublicEnv({})).toThrow(EnvError);
    expect(() => parsePublicEnv({})).toThrow(/NEXT_PUBLIC_APP_ENV.*NEXT_PUBLIC_API_URL/);
  });

  it('rejects non-http API URLs', () => {
    expect(() => parsePublicEnv({ ...valid, NEXT_PUBLIC_API_URL: 'javascript:alert(1)' })).toThrow(
      /NEXT_PUBLIC_API_URL/,
    );
  });

  it('requires https for the API in production', () => {
    expect(() => parsePublicEnv({ ...valid, NEXT_PUBLIC_APP_ENV: 'production' })).toThrow(
      /NEXT_PUBLIC_API_URL \(must use https in production\)/,
    );
  });
});
