import { parseServerEnv } from '@/shared/config/server-env.schema';

import { buildAuthOptions, VERIFIED_CLAIM } from './options';

const env = parseServerEnv({
  NEXT_PUBLIC_APP_ENV: 'test',
  BETTER_AUTH_SECRET: 's'.repeat(40),
  BETTER_AUTH_URL: 'http://localhost:3000',
  AUTH_DATABASE_URL: 'postgresql://web_role:pw@127.0.0.1:5432/criteria',
  GITHUB_CLIENT_ID: 'gh-id',
  GITHUB_CLIENT_SECRET: 'gh-secret',
});

const sender = { send: vi.fn(async () => {}) };

function options(overrides: Partial<Parameters<typeof buildAuthOptions>[0]> = {}) {
  return buildAuthOptions({
    env,
    database: undefined,
    email: null,
    allowSignIn: async () => true,
    ...overrides,
  });
}

describe('buildAuthOptions', () => {
  it('requires 12 characters and keeps verification off without email', () => {
    const built = options();

    expect(built.emailAndPassword).toMatchObject({
      enabled: true,
      minPasswordLength: 12,
      requireEmailVerification: false,
      autoSignIn: true,
    });
    expect(built.emailAndPassword?.sendResetPassword).toBeUndefined();
    expect(built.emailVerification).toBeUndefined();
  });

  it('turns verification and recovery on when an email provider is set', async () => {
    const built = options({ email: sender });

    expect(built.emailAndPassword?.requireEmailVerification).toBe(true);
    await built.emailVerification?.sendVerificationEmail?.(
      { user: { email: 'ana@example.test' } as never, url: 'http://v', token: 't' },
      undefined,
    );
    await built.emailAndPassword?.sendResetPassword?.(
      { user: { email: 'ana@example.test' } as never, url: 'http://r', token: 't' },
      undefined,
    );

    expect(sender.send).toHaveBeenCalledTimes(2);
  });

  it('asks GitHub only for the email scope and never auto-links unverified accounts', () => {
    const built = options();

    expect(built.socialProviders?.github).toMatchObject({
      disableDefaultScope: true,
      scope: ['user:email'],
    });
    expect(built.socialProviders?.google).toBeUndefined();
    expect(built.account?.accountLinking).toMatchObject({
      enabled: true,
      requireLocalEmailVerified: true,
      trustedProviders: [],
      allowDifferentEmails: false,
    });
  });

  it('stores rate limits in the database with a wide sign-up rule', () => {
    const built = options();

    expect(built.rateLimit).toMatchObject({ enabled: true, storage: 'database' });
    expect(built.rateLimit?.customRules?.['/sign-up/email']).toEqual({ window: 3600, max: 20 });
    expect(built.advanced?.useSecureCookies).toBe(false);
  });

  it('drops social tokens before they reach the database', async () => {
    const before = options().databaseHooks?.account?.create?.before;

    const github = await before?.(
      { providerId: 'github', accessToken: 'gho_x', refreshToken: 'r', idToken: 'i' } as never,
      null,
    );
    const password = await before?.({ providerId: 'credential', password: 'hash' } as never, null);

    expect(github).toEqual({
      data: { providerId: 'github', accessToken: null, refreshToken: null, idToken: null },
    });
    expect(password).toBeUndefined();
  });

  it('issues 5-minute EdDSA tokens with the verified-email claim', () => {
    const plugin = options().plugins?.find((p) => p.id === 'jwt') as {
      options?: Record<string, never>;
    };
    const jwt = plugin.options as unknown as {
      jwks: { keyPairConfig: { alg: string } };
      jwt: {
        issuer: string;
        audience: string;
        expirationTime: string;
        definePayload: (s: unknown) => unknown;
      };
    };

    expect(jwt.jwks.keyPairConfig.alg).toBe('EdDSA');
    expect(jwt.jwt).toMatchObject({
      issuer: 'http://localhost:3000',
      audience: 'http://localhost:3000',
      expirationTime: '5m',
    });
    expect(jwt.jwt.definePayload({ user: { emailVerified: true } })).toEqual({
      [VERIFIED_CLAIM]: true,
    });
  });

  it('uses secure cookies and Google only when configured', () => {
    const production = parseServerEnv({
      ...env,
      NEXT_PUBLIC_APP_ENV: 'production',
      BETTER_AUTH_URL: 'https://criteria.example',
      GOOGLE_CLIENT_ID: 'g',
      GOOGLE_CLIENT_SECRET: 's',
    } as unknown as Record<string, string>);

    const built = options({ env: production });

    expect(built.advanced?.useSecureCookies).toBe(true);
    expect(built.advanced?.ipAddress?.ipAddressHeaders).toEqual(['x-forwarded-for']);
    expect(built.socialProviders?.google).toEqual({ clientId: 'g', clientSecret: 's' });
  });
});

describe('sign-in hook', () => {
  const ctx = (path: string, body: unknown) => ({ path, body, context: {} }) as never;

  it('refuses an account over its attempt limit and ignores other paths', async () => {
    const allowSignIn = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const hook = options({ allowSignIn }).hooks?.before as unknown as (
      c: unknown,
    ) => Promise<unknown>;

    await expect(hook(ctx('/sign-in/email', { email: 'ana@example.test' }))).rejects.toMatchObject({
      body: { code: 'DEMASIADOS_INTENTOS' },
    });
    await expect(
      hook(ctx('/sign-in/email', { email: 'ana@example.test' })),
    ).resolves.toBeUndefined();
    await hook(ctx('/sign-up/email', { email: 'ana@example.test' }));
    await hook(ctx('/sign-in/email', {}));

    expect(allowSignIn).toHaveBeenCalledTimes(2);
  });
});
