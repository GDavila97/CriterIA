// Fresh database for the end-to-end tests: roles, Better Auth tables, then the API migrations.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import pg from 'pg';

import {
  ADMIN_URL,
  API_DIR,
  DATABASE,
  databaseAdminUrl,
  evalWriterUrl,
  migratorUrl,
  ROLE_PASSWORD,
  WEB_DIR,
  webEnv,
} from './env.mjs';

async function sql(url, statements) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    for (const statement of statements) await client.query(statement);
  } finally {
    await client.end();
  }
}

await sql(ADMIN_URL, [
  `DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`,
  `CREATE DATABASE ${DATABASE}`,
]);
await sql(databaseAdminUrl, [
  readFileSync(join(API_DIR, 'db', 'roles.sql'), 'utf8'),
  ...['migrator_role', 'api_role', 'eval_writer', 'web_role'].map(
    (role) => `ALTER ROLE ${role} PASSWORD '${ROLE_PASSWORD}'`,
  ),
]);

const run = (command, args, cwd, env) =>
  execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });

run(
  'pnpm',
  ['exec', 'auth', 'migrate', '--config', 'src/shared/lib/auth/cli.ts', '--yes'],
  WEB_DIR,
  webEnv,
);
const { VIRTUAL_ENV: _ignored, ...withoutVenv } = process.env;
execFileSync('uv', ['run', 'alembic', 'upgrade', 'head'], {
  cwd: API_DIR,
  stdio: 'inherit',
  env: { ...withoutVenv, MIGRATION_DATABASE_URL: migratorUrl },
});
// The board is checked with the real v1 results, published the same way as in production.
const results = join(API_DIR, 'eval', 'results', 'v1');
const publish = (...args) =>
  execFileSync('uv', ['run', 'criteria', 'eval', 'publish', ...args], {
    cwd: API_DIR,
    stdio: 'inherit',
    // CI and fresh clones have no services/api/.env, and the CLI requires APP_ENV.
    env: { ...withoutVenv, APP_ENV: 'test', EVAL_DATABASE_URL: evalWriterUrl },
  });
const notBatches = new Set(['human.json', 'estabilidad.json', 'reporte.json']);
for (const file of readdirSync(results).filter((f) => f.endsWith('.json') && !notBatches.has(f))) {
  publish('--file', join(results, file));
}
publish('--human');
console.log(`e2e database ${DATABASE} is ready`);
