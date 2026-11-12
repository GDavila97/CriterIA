import { betterAuth } from 'better-auth';
import { Pool } from 'pg';

import { getServerEnv } from '@/shared/config/server-env';
import { createEmailSender } from '@/shared/lib/email';

import { createAccountLimiter } from './account-limit';
import { routeGithubToStub } from './github-stub';
import { buildAuthOptions } from './options';

function createAuth() {
  const env = getServerEnv();
  if (env.GITHUB_STUB_URL) routeGithubToStub(env.GITHUB_STUB_URL);
  // web_role carries search_path=auth (db/roles.sql), which also holds behind Neon's pooler.
  const pool = new Pool({ connectionString: env.AUTH_DATABASE_URL });
  return betterAuth(
    buildAuthOptions({
      env,
      database: pool,
      email: createEmailSender({
        provider: env.EMAIL_PROVIDER,
        from: env.EMAIL_FROM,
        smtpUrl: env.SMTP_URL,
        resendApiKey: env.RESEND_API_KEY,
      }),
      allowSignIn: createAccountLimiter(pool, { windowSeconds: 15 * 60, max: 10 }),
    }),
  );
}

let instance: ReturnType<typeof createAuth> | undefined;

/** Built on first use so `next build` never needs the server secrets. */
export function getAuth() {
  instance ??= createAuth();
  return instance;
}
