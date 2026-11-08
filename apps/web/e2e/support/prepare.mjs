// Fresh database for the end-to-end tests: roles, Better Auth tables, then the API migrations.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import pg from 'pg';

import {
  ADMIN_URL,
  API_DIR,
  DATABASE,
  databaseAdminUrl,
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
console.log(`e2e database ${DATABASE} is ready`);
