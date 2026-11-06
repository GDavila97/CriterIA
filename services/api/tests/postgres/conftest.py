"""Integration fixtures: a throwaway database with the real roles and migrations.

Set TEST_DATABASE_ADMIN_URL to a superuser URL (the CI Postgres service or docker compose);
without it these tests are skipped.
"""

import os
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from alembic import command
from alembic.config import Config
from psycopg import sql
from sqlalchemy.engine import make_url

from criteria.config import SERVICE_ROOT

ADMIN_URL = os.environ.get("TEST_DATABASE_ADMIN_URL")
# Local and CI clusters only; never a real password.
ROLE_PASSWORD = "criteria-local"
ROLES = ("migrator_role", "api_role", "eval_writer", "web_role")

pytestmark = pytest.mark.integration


@dataclass(frozen=True)
class Database:
    name: str
    admin: str
    migrator: str
    api: str
    eval_writer: str


def _url(role: str, database: str) -> str:
    base = make_url(ADMIN_URL or "")
    return base.set(
        username=role, password=ROLE_PASSWORD, database=database, drivername="postgresql"
    ).render_as_string(hide_password=False)


def _alembic_config(url: str) -> Config:
    config = Config(str(SERVICE_ROOT / "alembic.ini"))
    config.attributes["url"] = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return config


@pytest.fixture(scope="session")
def database() -> Iterator[Database]:
    if ADMIN_URL is None:
        pytest.skip("TEST_DATABASE_ADMIN_URL is not set")
    name = f"criteria_test_{uuid4().hex[:10]}"
    admin_base = make_url(ADMIN_URL).set(drivername="postgresql")
    admin_root = admin_base.render_as_string(hide_password=False)
    with psycopg.connect(admin_root, autocommit=True) as conn:
        conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    admin = admin_base.set(database=name).render_as_string(hide_password=False)
    with psycopg.connect(admin, autocommit=True) as conn:
        conn.execute(Path(SERVICE_ROOT / "db" / "roles.sql").read_text(encoding="utf-8"))
        for role in ROLES:
            conn.execute(
                sql.SQL("ALTER ROLE {} PASSWORD {}").format(
                    sql.Identifier(role), sql.Literal(ROLE_PASSWORD)
                )
            )
    db = Database(
        name=name,
        admin=admin,
        migrator=_url("migrator_role", name),
        api=_url("api_role", name),
        eval_writer=_url("eval_writer", name),
    )
    command.upgrade(_alembic_config(db.migrator), "head")
    yield db
    with psycopg.connect(admin_root, autocommit=True) as conn:
        conn.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))
