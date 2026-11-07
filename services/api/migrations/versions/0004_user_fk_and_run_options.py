"""Ties every row of a user to auth.user so deleting the account deletes their data.

Also stores the per-agent plans and the history choice of each run. Requires the Better Auth
migrations to have created auth."user" first.

Revision ID: 0004
Revises: 0003
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "app"
USER_TABLES = (
    "user_settings",
    "provider_credential",
    "credential_check",
    "usage_daily",
    "run_start",
    "run",
    "saved_run",
)


def upgrade() -> None:
    for table in USER_TABLES:
        op.create_foreign_key(
            f"{table}_user_fk",
            table,
            "user",
            ["user_id"],
            ["id"],
            source_schema=SCHEMA,
            referent_schema="auth",
            ondelete="CASCADE",
        )
    op.add_column("run", sa.Column("agent_plans", JSONB), schema=SCHEMA)
    op.add_column(
        "run",
        sa.Column("save_history", sa.Boolean, nullable=False, server_default=sa.false()),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("run", "save_history", schema=SCHEMA)
    op.drop_column("run", "agent_plans", schema=SCHEMA)
    for table in USER_TABLES:
        op.drop_constraint(f"{table}_user_fk", table, schema=SCHEMA, type_="foreignkey")
