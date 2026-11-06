"""LangGraph checkpoint tables in the graph schema.

Revision ID: 0002
Revises: 0001
"""

from collections.abc import Sequence

import psycopg
from alembic import op
from langgraph.checkpoint.postgres import PostgresSaver
from psycopg.rows import dict_row
from sqlalchemy.engine import make_url

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _libpq_url() -> str:
    url = make_url(op.get_context().config.attributes.get("url") or op.get_bind().engine.url)
    return url.set(drivername="postgresql").render_as_string(hide_password=False)


def upgrade() -> None:
    # The saver's own migrations build indexes concurrently, which cannot run inside the
    # Alembic transaction, so they run on a separate autocommit connection.
    with psycopg.connect(
        _libpq_url(), autocommit=True, row_factory=dict_row, options="-c search_path=graph"
    ) as connection:
        PostgresSaver(connection).setup()
    op.execute("REVOKE INSERT, UPDATE, DELETE ON graph.checkpoint_migrations FROM api_role")


def downgrade() -> None:
    for table in ("checkpoint_writes", "checkpoint_blobs", "checkpoints", "checkpoint_migrations"):
        op.execute(f"DROP TABLE IF EXISTS graph.{table}")
