import os

from alembic import context
from sqlalchemy import create_engine, pool

# Migrations always run as migrator_role, the only role with DDL on app and graph.
MIGRATION_URL_ENV = "MIGRATION_DATABASE_URL"


def database_url() -> str:
    url = context.config.attributes.get("url") or os.environ.get(MIGRATION_URL_ENV)
    if not url:
        raise RuntimeError(f"{MIGRATION_URL_ENV} is required to run the migrations")
    return str(url)


def run_migrations() -> None:
    engine = create_engine(database_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            version_table_schema="app",
            transactional_ddl=True,
        )
        with context.begin_transaction():
            context.run_migrations()


run_migrations()
