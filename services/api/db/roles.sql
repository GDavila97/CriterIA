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

-- The evaluation CLI only inserts results; its table grants come with the migration that creates them.
GRANT USAGE ON SCHEMA app TO eval_writer;
