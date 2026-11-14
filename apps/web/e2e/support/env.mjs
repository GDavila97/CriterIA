import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Everything here is for a throwaway local or CI database; nothing is a real credential.
const derive = (label) => createHash('sha256').update(`criteria-e2e:${label}`).digest('base64');

export const WEB_DIR = fileURLToPath(new URL('../..', import.meta.url));
export const API_DIR = fileURLToPath(new URL('../../../../services/api', import.meta.url));
// The API reads a .env from its working directory; this folder has none, so a developer's local
// settings never reach the end-to-end API and it runs exactly as in CI.
export const API_RUN_DIR = fileURLToPath(new URL('.', import.meta.url));

export const PORTS = { web: 3100, mailWeb: 3200, api: 8090, githubStub: 4010 };
export const WEB_URL = `http://127.0.0.1:${PORTS.web}`;
export const MAIL_WEB_URL = `http://127.0.0.1:${PORTS.mailWeb}`;
export const API_URL = `http://127.0.0.1:${PORTS.api}`;
export const GITHUB_STUB_URL = `http://127.0.0.1:${PORTS.githubStub}`;
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:8025';

export const ADMIN_URL =
  process.env.E2E_DATABASE_ADMIN_URL ?? 'postgresql://criteria:criteria@127.0.0.1:5432/criteria';
export const DATABASE = 'criteria_e2e';
export const ROLE_PASSWORD = 'criteria-local';

const roleUrl = (role) => {
  const url = new URL(ADMIN_URL);
  url.username = role;
  url.password = ROLE_PASSWORD;
  url.pathname = `/${DATABASE}`;
  return url.toString();
};

export const ISSUER = WEB_URL;

export const webEnv = {
  NEXT_PUBLIC_APP_ENV: 'test',
  NEXT_PUBLIC_API_URL: API_URL,
  BETTER_AUTH_SECRET: derive('auth-secret'),
  BETTER_AUTH_URL: WEB_URL,
  AUTH_DATABASE_URL: roleUrl('web_role'),
  AUTH_JWT_ISSUER: ISSUER,
  AUTH_JWT_AUDIENCE: ISSUER,
  EMAIL_PROVIDER: 'none',
  GITHUB_CLIENT_ID: 'e2e-github-client',
  GITHUB_CLIENT_SECRET: derive('github-client'),
  GITHUB_STUB_URL,
};

export const mailWebEnv = {
  ...webEnv,
  BETTER_AUTH_URL: MAIL_WEB_URL,
  EMAIL_PROVIDER: 'smtp',
  SMTP_URL: process.env.E2E_SMTP_URL ?? 'smtp://127.0.0.1:1025',
  EMAIL_FROM: 'CriterIA <no-reply@criteria.test>',
};

export const apiEnv = {
  APP_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: String(PORTS.api),
  LOG_LEVEL: 'warning',
  MODEL_BACKEND: 'fake',
  FAKE_MODEL_DELAY_MS: '600',
  DATABASE_URL: roleUrl('api_role'),
  WEB_ORIGIN: WEB_URL,
  AUTH_JWKS_URL: `${WEB_URL}/api/auth/jwks`,
  AUTH_ISSUER: ISSUER,
  AUTH_AUDIENCE: ISSUER,
  AUTH_REQUIRE_VERIFIED_EMAIL: 'false',
  CREDENTIALS_KEYS: `1:${derive('credentials')}`,
  CREDENTIALS_ACTIVE_KEY: '1',
  SERVER_KEY_PROVIDERS: 'groq',
  GROQ_API_KEY: 'unused-with-fake-models',
  USER_RUNS_PER_HOUR: '100',
  USER_RUNS_PER_DAY: '200',
  SSE_HEARTBEAT_SECONDS: '1',
};

export const migratorUrl = roleUrl('migrator_role');
export const evalWriterUrl = roleUrl('eval_writer');
export const databaseAdminUrl = (() => {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${DATABASE}`;
  return url.toString();
})();
