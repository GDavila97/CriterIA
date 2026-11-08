import type { BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { jwt } from 'better-auth/plugins';

import type { ServerEnv } from '@/shared/config/server-env.schema';
import { resetPasswordEmail, verificationEmail, type EmailSender } from '@/shared/lib/email';

export const PASSWORD_MIN_LENGTH = 12;
export const JWT_LIFETIME = '5m';
export const VERIFIED_CLAIM = 'email_verified';
export const SOCIAL_PROVIDERS_WITHOUT_TOKENS = new Set(['github', 'google']);

export interface AuthDeps {
  env: ServerEnv;
  database: BetterAuthOptions['database'];
  email: EmailSender | null;
  /** Per-account sign-in limit; false means the account is over it. */
  allowSignIn: (email: string) => Promise<boolean>;
}

/** Only for sign-in: GitHub and Google tokens would be a liability we never use. */
async function withoutTokens<T extends { providerId?: string }>(account: T) {
  if (!account.providerId || !SOCIAL_PROVIDERS_WITHOUT_TOKENS.has(account.providerId)) return;
  return {
    data: { ...account, accessToken: null, refreshToken: null, idToken: null },
  };
}

export function buildAuthOptions({
  env,
  database,
  email,
  allowSignIn,
}: AuthDeps): BetterAuthOptions {
  const origin = new URL(env.BETTER_AUTH_URL).origin;
  const github =
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? {
          clientId: env.GITHUB_CLIENT_ID,
          clientSecret: env.GITHUB_CLIENT_SECRET,
          // user:email is enough to read the verified address; read:user is not needed.
          disableDefaultScope: true,
          scope: ['user:email'],
        }
      : undefined;
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
      : undefined;

  return {
    appName: 'CriterIA',
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database,
    trustedOrigins: [origin],
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: 128,
      requireEmailVerification: email !== null,
      autoSignIn: email === null,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: email
        ? async ({ user, url }) => email.send(resetPasswordEmail(user.email, url))
        : undefined,
    },
    emailVerification: email
      ? {
          sendOnSignUp: true,
          autoSignInAfterVerification: true,
          sendVerificationEmail: async ({ user, url }) =>
            email.send(verificationEmail(user.email, url)),
        }
      : undefined,
    socialProviders: { github, google },
    account: {
      accountLinking: {
        enabled: true,
        // Never attach a social login to a local account whose email nobody verified.
        requireLocalEmailVerified: true,
        trustedProviders: [],
        allowDifferentEmails: false,
      },
    },
    user: { deleteUser: { enabled: true } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        // Wide on purpose: a whole classroom at Cimat shares one public IP.
        '/sign-up/email': { window: 60 * 60, max: 20 },
        '/sign-in/email': { window: 15 * 60, max: 30 },
        '/request-password-reset': { window: 60 * 60, max: 5 },
        '/send-verification-email': { window: 60 * 60, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: env.NEXT_PUBLIC_APP_ENV === 'production',
      ipAddress: { ipAddressHeaders: ['x-real-ip', 'x-forwarded-for'] },
    },
    databaseHooks: {
      account: { create: { before: withoutTokens }, update: { before: withoutTokens } },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-in/email') return;
        const address: unknown = (ctx.body as { email?: unknown } | undefined)?.email;
        if (typeof address === 'string' && !(await allowSignIn(address))) {
          throw new APIError('TOO_MANY_REQUESTS', {
            code: 'DEMASIADOS_INTENTOS',
            message: 'Demasiados intentos con esta cuenta. Espera unos minutos.',
          });
        }
      }),
    },
    plugins: [
      jwt({
        jwks: { keyPairConfig: { alg: 'EdDSA', crv: 'Ed25519' } },
        jwt: {
          issuer: env.AUTH_JWT_ISSUER ?? origin,
          audience: env.AUTH_JWT_AUDIENCE ?? origin,
          expirationTime: JWT_LIFETIME,
          definePayload: ({ user }) => ({ [VERIFIED_CLAIM]: user.emailVerified }),
        },
      }),
    ],
  };
}
