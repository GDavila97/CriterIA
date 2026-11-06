"""Marks a run once its quota reservation was settled, so a retried close never settles twice.

Revision ID: 0003
Revises: 0002
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "run",
        sa.Column("settled", sa.Boolean, nullable=False, server_default=sa.false()),
        schema="app",
    )


def downgrade() -> None:
    op.drop_column("run", "settled", schema="app")
