-- Roles and schemas for CriterIA with least privilege. Idempotent: safe to run again.
-- Run as the database owner (local superuser or neondb_owner in Neon), before the migrations.
-- Passwords are not set here; see docs/deploy.md.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'migrator_role') THEN
    CREATE ROLE migrator_role LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'api_role') THEN
    CREATE ROLE api_role LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'eval_writer') THEN
    CREATE ROLE eval_writer LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'web_role') THEN
    CREATE ROLE web_role LOGIN;
  END IF;
END
$$;

-- Postgres 16 gives a non-superuser creator (neondb_owner in Neon) only ADMIN on the new roles;
-- handing the schemas and default privileges to them needs SET and INHERIT as well.
GRANT migrator_role, web_role TO CURRENT_USER WITH INHERIT TRUE, SET TRUE;

-- Neon's pooler runs in transaction mode and drops per-connection options, so the role carries it.
ALTER ROLE web_role SET search_path TO auth;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION migrator_role;
CREATE SCHEMA IF NOT EXISTS graph AUTHORIZATION migrator_role;
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION web_role;
REVOKE ALL ON SCHEMA app, graph, auth FROM PUBLIC;

-- The API reads and writes rows in app and graph, never changes the schema and never sees auth.
GRANT USAGE ON SCHEMA app, graph TO api_role;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator_role IN SCHEMA app, graph
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO api_role;
ALTER DEFAULT PRIVILEGES FOR ROLE migrator_role IN SCHEMA app, graph
  GRANT USAGE, SELECT ON SEQUENCES TO api_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app, graph TO api_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app, graph TO api_role;

-- Migrations tie app rows to auth."user" with foreign keys; references allow that and nothing else.
GRANT USAGE ON SCHEMA auth TO migrator_role;
ALTER DEFAULT PRIVILEGES FOR ROLE web_role IN SCHEMA auth
  GRANT REFERENCES ON TABLES TO migrator_role;

-- The evaluation CLI only inserts results; its table grants come with the migration that creates them.
GRANT USAGE ON SCHEMA app TO eval_writer;
