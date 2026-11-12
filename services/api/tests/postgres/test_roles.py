import psycopg
import pytest
from psycopg import errors

from criteria.config import SERVICE_ROOT
from tests.postgres.database import Database


def _fails(url: str, statement: str) -> None:
    with psycopg.connect(url, autocommit=True) as conn, pytest.raises(errors.InsufficientPrivilege):
        conn.execute(statement)


@pytest.fixture(scope="module", autouse=True)
def auth_table(database: Database) -> None:
    # Stands in for the Better Auth tables that F4 creates.
    with psycopg.connect(database.admin, autocommit=True) as conn:
        conn.execute('CREATE TABLE IF NOT EXISTS auth."user" (id text PRIMARY KEY, email text)')
        conn.execute('ALTER TABLE auth."user" OWNER TO web_role')


@pytest.mark.parametrize(
    "statement",
    [
        "CREATE TABLE app.intruder (id int)",
        "CREATE TABLE graph.intruder (id int)",
        "CREATE TABLE public.intruder (id int)",
        "ALTER TABLE app.run ADD COLUMN extra text",
        "DROP TABLE app.run_event",
        'SELECT * FROM auth."user"',
        "INSERT INTO app.eval_case (id, title, text, difficulty) "
        "VALUES (gen_random_uuid(), 't', 'x', 'facil')",
        "UPDATE app.alembic_version SET version_num = 'x'",
        "DELETE FROM graph.checkpoint_migrations",
    ],
)
def test_api_role_cannot_change_the_schema_or_read_auth(database: Database, statement: str) -> None:
    _fails(database.api, statement)


def test_api_role_reads_and_writes_its_own_tables(database: Database) -> None:
    database.ensure_user("u-roles")
    with psycopg.connect(database.api, autocommit=True) as conn:
        conn.execute("INSERT INTO app.user_settings (user_id) VALUES ('u-roles')")
        conn.execute("UPDATE app.user_settings SET save_history = true WHERE user_id = 'u-roles'")
        assert conn.execute("SELECT count(*) FROM app.eval_batch").fetchone() is not None
        assert conn.execute("SELECT count(*) FROM graph.checkpoints").fetchone() is not None
        conn.execute("DELETE FROM app.user_settings WHERE user_id = 'u-roles'")


def test_eval_writer_only_inserts_evaluation_rows(database: Database) -> None:
    with psycopg.connect(database.eval_writer, autocommit=True) as conn:
        conn.execute(
            "INSERT INTO app.eval_case (id, title, text, difficulty) "
            "VALUES (gen_random_uuid(), 't', 'x', 'facil')"
        )
    _fails(database.eval_writer, "SELECT * FROM app.run")
    _fails(database.eval_writer, "DELETE FROM app.eval_case")


def test_web_role_lands_in_auth_without_connection_options(database: Database) -> None:
    with psycopg.connect(database.web, autocommit=True) as conn:
        assert conn.execute("SHOW search_path").fetchone() == ("auth",)
        conn.execute("CREATE TABLE IF NOT EXISTS probe (id int)")
        located = conn.execute("SELECT to_regclass('auth.probe') IS NOT NULL").fetchone()
        conn.execute("DROP TABLE probe")
    assert located == (True,)
    _fails(database.web, "SELECT * FROM app.run")


def test_roles_script_is_idempotent(database: Database) -> None:
    script = (SERVICE_ROOT / "db" / "roles.sql").read_text(encoding="utf-8")
    with psycopg.connect(database.admin, autocommit=True) as conn:
        conn.execute(script)
        conn.execute(script)
