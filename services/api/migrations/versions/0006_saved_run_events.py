"""The events of a saved analysis, so its history can show how the agents worked.

Both columns are nullable: an API one version behind keeps saving and reading without them.

Revision ID: 0006
Revises: 0005
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "app"


def upgrade() -> None:
    op.add_column("saved_run", sa.Column("events", JSONB), schema=SCHEMA)
    op.add_column("saved_run", sa.Column("events_version", sa.Integer), schema=SCHEMA)


def downgrade() -> None:
    op.drop_column("saved_run", "events_version", schema=SCHEMA)
    op.drop_column("saved_run", "events", schema=SCHEMA)
