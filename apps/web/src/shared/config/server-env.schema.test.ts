import { parseServerEnv, ServerEnvError } from './server-env.schema';

const valid = {
  NEXT_PUBLIC_APP_ENV: 'development',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000',
  AUTH_DATABASE_URL: 'postgresql://web_role:pw@127.0.0.1:5432/criteria',
};

describe('parseServerEnv', () => {
  it('defaults to no email and no social providers', () => {
    const env = parseServerEnv({ ...valid, EMAIL_PROVIDER: '', GITHUB_CLIENT_ID: '' });

    expect(env.EMAIL_PROVIDER).toBe('none');
    expect(env.GITHUB_CLIENT_ID).toBeUndefined();
  });

  it('names what each email provider needs without echoing values', () => {
    expect(() => parseServerEnv({ ...valid, EMAIL_PROVIDER: 'smtp' })).toThrow(
      /EMAIL_FROM.*SMTP_URL/,
    );
    expect(() =>
      parseServerEnv({ ...valid, EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'a@b.c' }),
    ).toThrow(/RESEND_API_KEY/);
    expect(
      parseServerEnv({
        ...valid,
        EMAIL_PROVIDER: 'smtp',
        EMAIL_FROM: 'CriterIA <no-reply@criteria.test>',
        SMTP_URL: 'smtp://127.0.0.1:1025',
      }).EMAIL_PROVIDER,
    ).toBe('smtp');
  });

  it('requires OAuth client ids and secrets in pairs', () => {
    expect(() => parseServerEnv({ ...valid, GITHUB_CLIENT_ID: 'id' })).toThrow(
      /GITHUB_CLIENT_SECRET/,
    );
  });

  it('keeps short secrets and the GitHub stub out of real environments', () => {
    let message = '';
    try {
      parseServerEnv({
        ...valid,
        BETTER_AUTH_SECRET: 'short-secret-value',
        GITHUB_STUB_URL: 'http://127.0.0.1:4010',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ServerEnvError);
      message = (error as Error).message;
    }

    expect(message).toMatch(/BETTER_AUTH_SECRET.*GITHUB_STUB_URL/);
    expect(message).not.toContain('short-secret-value');
  });

  it('requires https in production', () => {
    expect(() => parseServerEnv({ ...valid, NEXT_PUBLIC_APP_ENV: 'production' })).toThrow(
      /BETTER_AUTH_URL \(must use https in production\)/,
    );
  });
});
