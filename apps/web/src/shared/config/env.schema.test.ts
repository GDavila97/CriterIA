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

  it('links the contact to the GitHub profile unless another https or mailto URL is set', () => {
    expect(parsePublicEnv(valid).NEXT_PUBLIC_CONTACT_URL).toBe('https://github.com/GDavila97');
    expect(
      parsePublicEnv({ ...valid, NEXT_PUBLIC_CONTACT_URL: 'mailto:hola@example.com' })
        .NEXT_PUBLIC_CONTACT_URL,
    ).toBe('mailto:hola@example.com');
    expect(() =>
      parsePublicEnv({ ...valid, NEXT_PUBLIC_CONTACT_URL: 'javascript:alert(1)' }),
    ).toThrow(/NEXT_PUBLIC_CONTACT_URL/);
  });

  it('rejects non-http API URLs', () => {
    expect(() => parsePublicEnv({ ...valid, NEXT_PUBLIC_API_URL: 'javascript:alert(1)' })).toThrow(
      /NEXT_PUBLIC_API_URL/,
    );
  });

  it('keeps the office view off unless it is set to true', () => {
    expect(parsePublicEnv(valid).NEXT_PUBLIC_OFFICE_VIEW).toBe(false);
    expect(parsePublicEnv({ ...valid, NEXT_PUBLIC_OFFICE_VIEW: '' }).NEXT_PUBLIC_OFFICE_VIEW).toBe(
      false,
    );
    expect(
      parsePublicEnv({ ...valid, NEXT_PUBLIC_OFFICE_VIEW: 'true' }).NEXT_PUBLIC_OFFICE_VIEW,
    ).toBe(true);
  });

  it('requires https for the API in production', () => {
    expect(() => parsePublicEnv({ ...valid, NEXT_PUBLIC_APP_ENV: 'production' })).toThrow(
      /NEXT_PUBLIC_API_URL \(must use https in production\)/,
    );
  });
});
